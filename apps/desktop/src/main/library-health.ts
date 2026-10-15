// apps/desktop/src/main/library-health.ts —— 库完整性自检（T-15a ①）
//
// 回答一个问题：**这个库的索引与元数据现在还能用吗？坏在哪？**
//   · `<库根>/.gs-index.bin` ⇒ 交给**引擎**的五道校验（readIndexFile → readIndexBin，AGENTS P1：不实现第二份解析）
//   · `<库根>/.gs.db`        ⇒ 只读打开 + schema 版本 + PRAGMA integrity_check + 表是否在 + 能不能读
//
// 两条口径（照 AGENTS 的写法要求来）：
//   1. **每一项都要有：ok · 机器可读 code · 人话 reason**（reason 在 ok 时也非空：要说清"检查了什么、看到什么"）。
//   2. **不假装**：库根都不在时，后面的检查全都无从谈起 ⇒ 只报这一项，不编出"db-open 通过"这种假绿。
//
// 「能不能重建」与「检查是否通过」是两件事，所以分两个标志位：
//   · needsDbRebuild    = 有 rebuildable 的检查失败（删库重建能修好）
//   · needsIndexRebuild = 索引那项失败（删库重建**修不好**：索引要重新编码，见 T-13/T-16）
//   把两者合成一个 "needsRebuild" 会让界面把"索引损坏"显示成"点一下重建就好"——那是假的。
//
// 本模块只**读**：只读打开 .gs.db、只读索引；不建目录、不改素材、不迁移（迁移是 openGsDb 非只读路径的事）。
// 不 import electron；路径全部由调用方传入（与 storage-roots / index-file 同一套纪律）。

import fs from 'node:fs';
import path from 'node:path';

import { GS_DB_NAME } from './storage-roots.ts';
import { GsDbError, describeError } from './db/errors.ts';
import { EXPECTED_TABLES, TARGET_SCHEMA_VERSION, readSchemaVersion } from './db/migrations.ts';
import { openGsDb } from './db/open.ts';
import { readIndexSummaryAt } from './index-file.ts';
import { resolveIndexLocation } from '../../../../packages/engine/src/index-layout.ts';
import type { IndexLayout } from '../../../../packages/engine/src/index-layout.ts';
import type { SqlDatabase } from './db/sqlite-adapter.ts';

export type HealthCheckId =
  | 'library-root'
  | 'items-file'
  | 'index'
  | 'db-file'
  | 'db-open'
  | 'db-schema'
  | 'db-integrity'
  | 'db-tables'
  | 'db-read';

export interface HealthCheck {
  id: HealthCheckId;
  ok: boolean;
  /** 机器可读失败码；ok 时为空串（**不要**按 reason 分支） */
  code: string;
  /** 人话理由；ok 时也非空（说明检查了什么、看到了什么） */
  reason: string;
  /** "删库重建"能不能修好这一项（索引不行 ⇒ false） */
  rebuildable: boolean;
}

export interface LibraryHealthReport {
  libId: string;
  root: string;
  dbPath: string | null;
  /** 实际查/应放的索引路径（`none` 时是**首选**路径） */
  indexPath: string;
  /** 用的是哪套布局：库根（新）/ 旧布局回退 / 两处都没有（T-44） */
  indexLayout: IndexLayout;
  checks: HealthCheck[];
  /** 所有检查通过 */
  ok: boolean;
  /** 有可重建的失败项 ⇒ 调 rebuildLibraryDb 有意义 */
  needsDbRebuild: boolean;
  /** 索引那项失败 ⇒ 需要**重新建索引**（不是重建元数据） */
  needsIndexRebuild: boolean;
  /** 人读总结（一行；日志/界面直接用） */
  reason: string;
}

export interface CheckLibraryHealthOptions {
  libId: string;
  /** 库根 */
  root: string;
  /** .gs.db 落点；省略 = <库根>/.gs.db；显式 null = 没有可用落点（T-04 回退也失败） */
  dbPath?: string | null;
  /** items.json 落点；给了就一并检查（重建要用它）。不给则**不出这一项**，不编一个假的 */
  itemsJsonPath?: string | null;
  /**
   * 旧布局的 libraries 根（`<dataDir>/libraries`）。给了 ⇒ 索引查不到新布局时会**回退到旧布局**
   * （`<该目录>/<libId>/index.bin`），并如实报告用的是哪套布局 —— T-44。
   * 判定唯一来源 = 引擎的 `resolveIndexLocation`（与引擎读索引用的是同一个函数）。
   */
  legacyLibrariesDir?: string | null;
}

// ---------------------------------------------------------------- 小工具

function codeOf(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c) return c;
  }
  return 'UNKNOWN';
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------- 自检

/**
 * 自检一个库。**只读**、不抛异常（失败也是结构化结果的一部分 —— 让调用方能显示"坏在哪"，
 * 而不是拿一个异常去猜）。唯一的例外是输入为空：那是调用方的 bug，直接报参数错。
 */
export function checkLibraryHealth(opts: CheckLibraryHealthOptions): LibraryHealthReport {
  const libId = typeof opts.libId === 'string' ? opts.libId.trim() : '';
  const rootRaw = typeof opts.root === 'string' ? opts.root.trim() : '';
  if (!libId || !rootRaw) {
    throw new GsDbError('IMPORT_INPUT_INVALID', 'checkLibraryHealth 需要非空的 libId 与 root');
  }
  const root = path.resolve(rootRaw);
  // 索引落点：**唯一判据**（引擎 index-layout.ts）—— 与引擎读索引用的是同一个函数（T-44）。
  const loc = resolveIndexLocation({
    libId,
    libraryRoot: root,
    legacyLibrariesDir: opts.legacyLibrariesDir ?? null,
  });
  const indexPath = loc.indexPath ?? loc.preferredPath;
  const dbPath =
    opts.dbPath === null ? null : opts.dbPath === undefined ? path.join(root, GS_DB_NAME) : path.resolve(opts.dbPath);
  const checks: HealthCheck[] = [];

  // ---- 库根：不在的话后面全是空谈 ⇒ 只报这一项，直接返回
  if (!isDir(root)) {
    checks.push({
      id: 'library-root',
      ok: false,
      code: 'LIB_ROOT_MISSING',
      reason: '库根不存在或不是目录：' + root + ' —— 盘没挂载 / 库被移走时就是这样；后面几项无从检查（不假装它们通过）',
      rebuildable: false,
    });
    return summarize(libId, root, dbPath, indexPath, loc.layout, checks);
  }
  checks.push({ id: 'library-root', ok: true, code: '', reason: '库根是目录：' + root, rebuildable: false });

  // ---- items.json（重建的输入；不参与"索引/元数据好不好"的判断，但不检查它就没法说重建能不能跑）
  const itemsJsonPath =
    opts.itemsJsonPath === undefined || opts.itemsJsonPath === null
      ? null
      : path.resolve(opts.itemsJsonPath);
  if (itemsJsonPath !== null) {
    const size = sizeOf(itemsJsonPath);
    if (size <= 0) {
      checks.push({
        id: 'items-file',
        ok: false,
        code: 'ITEMS_JSON_MISSING',
        reason: '条目表不存在或为空：' + itemsJsonPath + '（size=' + String(size) + '）—— 没有它就无法重建元数据',
        rebuildable: false,
      });
    } else {
      checks.push({
        id: 'items-file',
        ok: true,
        code: '',
        reason: '条目表存在：' + itemsJsonPath + '（' + String(size) + ' 字节）',
        rebuildable: false,
      });
    }
  }

  // ---- 索引：交给引擎的五道校验（本模块不做任何字节级判断）
  //
  // ⚠️ **只有「两处都没有」才是 INDEX_MISSING**（T-44）：旧布局下索引是**存在且可用**的
  //    （实测 data/libraries/L1/index.bin 过得了五道校验），把它说成「缺失」是**假因果**。
  if (loc.layout === 'none') {
    checks.push({
      id: 'index',
      ok: false,
      code: 'INDEX_MISSING',
      reason: loc.reason + ' —— 需要**重新建索引**（删库重建修不好它）',
      rebuildable: false,
    });
  } else {
    try {
      const idx = readIndexSummaryAt(indexPath);
      checks.push({
        id: 'index',
        ok: true,
        code: '',
        reason: '索引通过引擎五道校验（布局=' + loc.layout + '）：count=' + String(idx.count) +
          ' · dim=' + String(idx.dim) + ' · ' + String(idx.bytes) + ' 字节 —— ' + loc.reason,
        rebuildable: false,
      });
    } catch (e) {
      checks.push({
        id: 'index',
        ok: false,
        code: codeOf(e),
        reason: '索引损坏（引擎五道校验未通过，布局=' + loc.layout + '）：' + describeError(e) +
          ' —— 需要**重新建索引**，删库重建修不好它',
        rebuildable: false,
      });
    }
  }

  // ---- .gs.db
  if (dbPath === null) {
    checks.push({
      id: 'db-file',
      ok: false,
      code: 'DB_PATH_MISSING',
      reason: '没有可用的 .gs.db 落点（T-04 的解析结果与 userData 回退都失败了）',
      rebuildable: false,
    });
    return summarize(libId, root, dbPath, indexPath, loc.layout, checks);
  }

  if (!fs.existsSync(dbPath)) {
    checks.push({
      id: 'db-file',
      ok: false,
      code: 'DB_MISSING',
      reason: '.gs.db 不存在：' + dbPath + ' —— 删库重建会把它建出来（后面的 db 检查跳过，不假装通过）',
      rebuildable: true,
    });
    return summarize(libId, root, dbPath, indexPath, loc.layout, checks);
  }
  checks.push({ id: 'db-file', ok: true, code: '', reason: '.gs.db 存在：' + dbPath + '（' + String(sizeOf(dbPath)) + ' 字节）', rebuildable: false });

  let db: SqlDatabase | null = null;
  try {
    const opened = openGsDb({ dbPath, readOnly: true });
    db = opened.db;
    checks.push({
      id: 'db-open',
      ok: true,
      code: '',
      reason: '只读打开成功（journal_mode=' + opened.journalMode + '）—— 只读打开不会迁移、不会写入',
      rebuildable: false,
    });
  } catch (e) {
    checks.push({
      id: 'db-open',
      ok: false,
      code: codeOf(e),
      reason: '只读打开失败：' + describeError(e) + ' —— 删库重建能修好（.gs.db 是可重建的派生数据，SPEC §2.1）',
      rebuildable: true,
    });
  }

  if (db !== null) {
    try {
      // 版本
      try {
        const version = readSchemaVersion(db);
        if (version === TARGET_SCHEMA_VERSION) {
          checks.push({
            id: 'db-schema',
            ok: true,
            code: '',
            reason: 'schema_version=' + String(version) + '（= 目标 ' + String(TARGET_SCHEMA_VERSION) + '）',
            rebuildable: false,
          });
        } else {
          checks.push({
            id: 'db-schema',
            ok: false,
            code: version > TARGET_SCHEMA_VERSION ? 'SCHEMA_TOO_NEW' : 'SCHEMA_OUTDATED',
            reason:
              'schema_version=' + String(version) + '，本程序是 ' + String(TARGET_SCHEMA_VERSION) +
              (version > TARGET_SCHEMA_VERSION ? '（库比程序新）' : '（库比程序旧）') +
              ' —— 按 SPEC §2.1：版本不符 ⇒ 删除重建',
            rebuildable: true,
          });
        }
      } catch (e) {
        checks.push({
          id: 'db-schema',
          ok: false,
          code: codeOf(e),
          reason: '读 schema_version 失败：' + describeError(e),
          rebuildable: true,
        });
      }

      // 结构完整性（SQLite 自己的检查）
      try {
        const rows = db.prepare('PRAGMA integrity_check').all();
        const bad = rows
          .map((r) => r['integrity_check'])
          .filter((v) => v !== 'ok');
        if (bad.length === 0) {
          checks.push({ id: 'db-integrity', ok: true, code: '', reason: 'PRAGMA integrity_check = ok', rebuildable: false });
        } else {
          checks.push({
            id: 'db-integrity',
            ok: false,
            code: 'DB_INTEGRITY',
            reason: 'PRAGMA integrity_check 报告 ' + String(bad.length) + ' 处问题：' + bad.slice(0, 3).join(' / '),
            rebuildable: true,
          });
        }
      } catch (e) {
        checks.push({
          id: 'db-integrity',
          ok: false,
          code: codeOf(e),
          reason: 'PRAGMA integrity_check 执行失败：' + describeError(e),
          rebuildable: true,
        });
      }

      // 表是否在（清单从 DDL 派生：EXPECTED_TABLES）
      try {
        const have = new Set<string>();
        for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
          const name = row['name'];
          if (typeof name === 'string') have.add(name);
        }
        const missing = EXPECTED_TABLES.filter((t) => !have.has(t));
        if (missing.length === 0) {
          checks.push({
            id: 'db-tables',
            ok: true,
            code: '',
            reason: '应有的 ' + String(EXPECTED_TABLES.length) + ' 张表都在',
            rebuildable: false,
          });
        } else {
          checks.push({
            id: 'db-tables',
            ok: false,
            code: 'DB_TABLE_MISSING',
            reason: '缺 ' + String(missing.length) + ' 张表：' + missing.join(', ') + ' —— 删库重建会补齐',
            rebuildable: true,
          });
        }
      } catch (e) {
        checks.push({
          id: 'db-tables',
          ok: false,
          code: codeOf(e),
          reason: '查 sqlite_master 失败：' + describeError(e),
          rebuildable: true,
        });
      }

      // 能不能读（最朴素的一步：真去数一下）
      // ⚠️ S2：绿地口径下**没有 items / library 两张表**（旧宽表已拆成 asset + asset_file + asset_index_state，
      //    库注册表搬到 app.db 的 library_registry）⇒ 照旧读旧表会抛 no such table，
      //    于是**好库被判成坏库**（db-read: SQLITE_ERROR）。这里改成数事实层的两张表。
      try {
        const assets = db.prepare('SELECT COUNT(*) AS n FROM asset').get();
        const files = db.prepare('SELECT COUNT(*) AS n FROM asset_file').get();
        checks.push({
          id: 'db-read',
          ok: true,
          code: '',
          reason: '可读：asset=' + String(assets === undefined ? '?' : assets['n']) +
            ' 行 · asset_file=' + String(files === undefined ? '?' : files['n']) + ' 行',
          rebuildable: false,
        });
      } catch (e) {
        checks.push({
          id: 'db-read',
          ok: false,
          code: codeOf(e),
          reason: '读 asset / asset_file 失败：' + describeError(e),
          rebuildable: true,
        });
      }
    } finally {
      try {
        db.close();
      } catch {
        // 关不掉不影响结论：报告已经写完了
      }
    }
  }

  return summarize(libId, root, dbPath, indexPath, loc.layout, checks);
}

function summarize(
  libId: string,
  root: string,
  dbPath: string | null,
  indexPath: string,
  indexLayout: IndexLayout,
  checks: HealthCheck[],
): LibraryHealthReport {
  const failed = checks.filter((c) => !c.ok);
  const needsDbRebuild = failed.some((c) => c.rebuildable);
  const indexCheck = checks.find((c) => c.id === 'index');
  const needsIndexRebuild = indexCheck !== undefined && !indexCheck.ok;
  const reason = failed.length === 0
    ? '自检通过（' + String(checks.length) + ' 项）'
    : '自检发现 ' + String(failed.length) + ' 项问题：' + failed.map((c) => c.id + '(' + c.code + ')').join(' / ') +
      (needsDbRebuild ? ' ⇒ 可以删库重建' : '') +
      (needsIndexRebuild ? ' ⇒ 索引需要重新编码（删库重建修不好）' : '');
  return { libId, root, dbPath, indexPath, indexLayout, checks, ok: failed.length === 0, needsDbRebuild, needsIndexRebuild, reason };
}

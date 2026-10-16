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
// ⚠️ 复用引擎的扫描器（**不写第二份**）：孤包/缺包的判据只有一份（AGENTS P1）
import { scanLibrary } from '../../../../packages/engine/src/scanner.ts';
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

/** 一个孤包（只有包、没有图）—— 相对库根，供界面显示/跳到该文件 */
export interface OrphanArchiveFinding {
  relPath: string;
  ext: string;
}

/**
 * **独立异常类别**：孤包（只有包、没有图）。口径见 checkLibraryHealth 里那段注释（TASKS §4 U12）。
 *
 * ⚠️ 它**不是**失败检查项，也不是"损坏"：它是**不完整**。所以：
 *   · 不翻 `report.ok`（健康库不该因为"少了一半素材"被显示成"有问题"）；
 *   · 不参与 `needsDbRebuild`（重建元数据修不好它 —— 缺的是素材本身）。
 */
export interface OrphanArchiveCategory {
  /** 孤包计数 —— **不**计入 `materialCount` */
  count: number;
  /** 明细（相对库根；最多 {@link MAX_ORPHAN_LISTED} 条）—— "可跳到该文件"的数据来源 */
  samples: OrphanArchiveFinding[];
  /** count > samples.length ⇒ 明细被截断（计数仍然真实） */
  truncated: boolean;
  /** 是否真的扫过：库根不在 / 扫描抛错 ⇒ false，此时 count=0 **不代表**"没有孤包" */
  scanned: boolean;
  /** 扫描本身失败的原因（scanned=false 时非空） */
  error: string | null;
}

/** 孤包明细最多列几条（**计数**不受影响）—— 与引擎 `maxSkippedListed` 同一态度 */
export const MAX_ORPHAN_LISTED = 50;

export interface LibraryHealthReport {
  libId: string;
  root: string;
  dbPath: string | null;
  /** 实际查/应放的索引路径（`none` 时是**首选**路径） */
  indexPath: string;
  /** 用的是哪套布局：库根（新）/ 旧布局回退 / 两处都没有（T-44） */
  indexLayout: IndexLayout;
  checks: HealthCheck[];
  /**
   * 素材数 = **预览图条目**（引擎扫描口径）。**孤包不算素材** ⇒ 这个数里没有它们。
   * `null` = 没扫（库根不存在/不合法）—— 不编一个 0 冒充"这个库没有素材"。
   */
  materialCount: number | null;
  /** 独立异常类别：孤包（只有包、没有图）—— 不算素材、不是损坏、重建修不好 */
  orphanArchive: OrphanArchiveCategory;
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

/** 空类别（没扫 / 库根不在时的默认值）—— 一处定义，避免两处各拼一个字面量 */
function EMPTY_ORPHANS(): OrphanArchiveCategory {
  return { count: 0, samples: [], truncated: false, scanned: false, error: null };
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
    opts.dbPath === null
      ? null
      : opts.dbPath === undefined
        ? path.join(root, GS_DB_NAME)
        : path.resolve(opts.dbPath);
  const checks: HealthCheck[] = [];

  // ---- 库根：不在的话后面全是空谈 ⇒ 只报这一项，直接返回
  if (!isDir(root)) {
    checks.push({
      id: 'library-root',
      ok: false,
      code: 'LIB_ROOT_MISSING',
      reason:
        '库根不存在或不是目录：' +
        root +
        ' —— 盘没挂载 / 库被移走时就是这样；后面几项无从检查（不假装它们通过）',
      rebuildable: false,
    });
    return summarize(libId, root, dbPath, indexPath, loc.layout, checks, null, EMPTY_ORPHANS());
  }
  checks.push({
    id: 'library-root',
    ok: true,
    code: '',
    reason: '库根是目录：' + root,
    rebuildable: false,
  });

  // ---- 孤包（只有包、没有图）—— **独立异常类别**，不是失败检查项（TASKS §4 U12，所有者已批）
  //
  // 口径（别再改）：
  //   · 「素材」= **预览图条目**（SPEC 口径）⇒ 孤包**不算素材**、不进 materialCount
  //     （否则污染「100 条素材」的口径）；
  //   · 但**不许静默忽略** ⇒ 独立类别 = 计数 + 明细（界面可显示到具体文件）；
  //   · **缺包 ≠ 孤包**：缺包（有图无包）是 SPEC §1 **明文允许**的状态（登记为 missing-archive），
  //     孤包（有包无图）是**不完整**。两者的判据都只有一份 —— 引擎 scanner 的 missingArchive /
  //     missingImage；本模块只**复用**它的结果（AGENTS P1），所以文案**不许**写成「损坏」
  //     （它不是坏，是缺了一半）。
  //   · 与「重复 / 坏索引」的关系：那两类都是**可处置**的问题（去重 / 重新编码）；
  //     孤包是**素材本身缺了一半** ⇒ 重建元数据（删 .gs.db 重导）**修不好**它 ⇒ 不是 rebuildable。
  //   · 为什么不把它做成「失败检查项」：那会翻 report.ok，让**健康库**在界面上显示成「有问题」，
  //     而且重建后的复检**永远**过不了（缺的文件不会因为重建而出现）—— 那是把「不完整」谎报成「坏」。
  //
  // ⚠️ 扫描是**只读**的（scanner 的硬约束：只用 readdir/stat/open(r)），且健康检查本来就是用户
  //    主动点「运行体检」才跑的重活（已经要读整个索引）。库根不在时压根不扫（上面已 return）。
  let materialCount: number | null = null;
  let orphanArchive: OrphanArchiveCategory = EMPTY_ORPHANS();
  try {
    const scan = scanLibrary(root, { libId });
    materialCount = scan.counts.images;
    orphanArchive = {
      count: scan.counts.missingImage,
      samples: scan.missingImage.slice(0, MAX_ORPHAN_LISTED),
      truncated: scan.counts.missingImage > MAX_ORPHAN_LISTED,
      scanned: true,
      error: null,
    };
  } catch (e) {
    // 扫描失败**不许静默**：scanned=false + error 非空 ⇒ 界面不能说「没有孤包」（那是不知道）
    orphanArchive = {
      count: 0,
      samples: [],
      truncated: false,
      scanned: false,
      error: describeError(e),
    };
  }

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
        reason:
          '条目表不存在或为空：' +
          itemsJsonPath +
          '（size=' +
          String(size) +
          '）—— 没有它就无法重建元数据',
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
        reason:
          '索引通过引擎五道校验（布局=' +
          loc.layout +
          '）：count=' +
          String(idx.count) +
          ' · dim=' +
          String(idx.dim) +
          ' · ' +
          String(idx.bytes) +
          ' 字节 —— ' +
          loc.reason,
        rebuildable: false,
      });
    } catch (e) {
      checks.push({
        id: 'index',
        ok: false,
        code: codeOf(e),
        reason:
          '索引损坏（引擎五道校验未通过，布局=' +
          loc.layout +
          '）：' +
          describeError(e) +
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
    return summarize(
      libId,
      root,
      dbPath,
      indexPath,
      loc.layout,
      checks,
      materialCount,
      orphanArchive,
    );
  }

  if (!fs.existsSync(dbPath)) {
    checks.push({
      id: 'db-file',
      ok: false,
      code: 'DB_MISSING',
      reason:
        '.gs.db 不存在：' + dbPath + ' —— 删库重建会把它建出来（后面的 db 检查跳过，不假装通过）',
      rebuildable: true,
    });
    return summarize(
      libId,
      root,
      dbPath,
      indexPath,
      loc.layout,
      checks,
      materialCount,
      orphanArchive,
    );
  }
  checks.push({
    id: 'db-file',
    ok: true,
    code: '',
    reason: '.gs.db 存在：' + dbPath + '（' + String(sizeOf(dbPath)) + ' 字节）',
    rebuildable: false,
  });

  let db: SqlDatabase | null = null;
  try {
    const opened = openGsDb({ dbPath, readOnly: true });
    db = opened.db;
    checks.push({
      id: 'db-open',
      ok: true,
      code: '',
      reason:
        '只读打开成功（journal_mode=' + opened.journalMode + '）—— 只读打开不会迁移、不会写入',
      rebuildable: false,
    });
  } catch (e) {
    checks.push({
      id: 'db-open',
      ok: false,
      code: codeOf(e),
      reason:
        '只读打开失败：' +
        describeError(e) +
        ' —— 删库重建能修好（.gs.db 是可重建的派生数据，SPEC §2.1）',
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
            reason:
              'schema_version=' +
              String(version) +
              '（= 目标 ' +
              String(TARGET_SCHEMA_VERSION) +
              '）',
            rebuildable: false,
          });
        } else {
          checks.push({
            id: 'db-schema',
            ok: false,
            code: version > TARGET_SCHEMA_VERSION ? 'SCHEMA_TOO_NEW' : 'SCHEMA_OUTDATED',
            reason:
              'schema_version=' +
              String(version) +
              '，本程序是 ' +
              String(TARGET_SCHEMA_VERSION) +
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
        const bad = rows.map((r) => r['integrity_check']).filter((v) => v !== 'ok');
        if (bad.length === 0) {
          checks.push({
            id: 'db-integrity',
            ok: true,
            code: '',
            reason: 'PRAGMA integrity_check = ok',
            rebuildable: false,
          });
        } else {
          checks.push({
            id: 'db-integrity',
            ok: false,
            code: 'DB_INTEGRITY',
            reason:
              'PRAGMA integrity_check 报告 ' +
              String(bad.length) +
              ' 处问题：' +
              bad.slice(0, 3).join(' / '),
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
            reason:
              '缺 ' +
              String(missing.length) +
              ' 张表：' +
              missing.join(', ') +
              ' —— 删库重建会补齐',
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
          reason:
            '可读：asset=' +
            String(assets === undefined ? '?' : assets['n']) +
            ' 行 · asset_file=' +
            String(files === undefined ? '?' : files['n']) +
            ' 行',
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

  return summarize(
    libId,
    root,
    dbPath,
    indexPath,
    loc.layout,
    checks,
    materialCount,
    orphanArchive,
  );
}

function summarize(
  libId: string,
  root: string,
  dbPath: string | null,
  indexPath: string,
  indexLayout: IndexLayout,
  checks: HealthCheck[],
  materialCount: number | null,
  orphanArchive: OrphanArchiveCategory,
): LibraryHealthReport {
  const failed = checks.filter((c) => !c.ok);
  const needsDbRebuild = failed.some((c) => c.rebuildable);
  const indexCheck = checks.find((c) => c.id === 'index');
  const needsIndexRebuild = indexCheck !== undefined && !indexCheck.ok;
  const baseReason =
    failed.length === 0
      ? '自检通过（' + String(checks.length) + ' 项）'
      : '自检发现 ' +
        String(failed.length) +
        ' 项问题：' +
        failed.map((c) => c.id + '(' + c.code + ')').join(' / ') +
        (needsDbRebuild ? ' ⇒ 可以删库重建' : '') +
        (needsIndexRebuild ? ' ⇒ 索引需要重新编码（删库重建修不好）' : '');
  // 孤包**不是**失败项（不进 failed），但必须在总结里可见 —— 否则「自检通过」会把
  // 「这个库少了 N 个素材的另一半」盖掉，那正是 U12 要禁的静默。
  const orphanNote =
    orphanArchive.count > 0
      ? ' · 另有 ' +
        String(orphanArchive.count) +
        ' 个孤包（只有包、没有图：不算素材 · 不是损坏 · 重建元数据修不好，见 orphanArchive）'
      : orphanArchive.scanned
        ? ''
        : ' · 孤包扫描未完成（' +
          String(orphanArchive.error ?? '未知原因') +
          '）—— 不能据此说「没有孤包」';
  const reason = baseReason + orphanNote;
  return {
    libId,
    root,
    dbPath,
    indexPath,
    indexLayout,
    checks,
    materialCount,
    orphanArchive,
    ok: failed.length === 0,
    needsDbRebuild,
    needsIndexRebuild,
    reason,
  };
}

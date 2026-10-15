// apps/desktop/src/main/library-rebuild.ts —— 库元数据的**重建入口**（T-15a ②③④）
//
// 把 T-11c 手工编排过的三步收成**一个生产入口**（并加上索引侧与复检）：
//   ① removeGsDbFiles(dbPath)      —— 删 .gs.db 连 -wal/-shm/-journal（只删 .gs-* 命名空间里的东西）
//   ② openGsDb({ dbPath })         —— 重新建表 + 跑迁移（v0 → TARGET）
//   ③ importItemsFromJson(...)     —— 从 items.json 全量镜像导入（幂等，T-11b）
//   ④ 索引侧：给了新字节就 writeIndexAtomically 原子写；没给就只**校验**（绝不动它）
//   ⑤ 复检：checkLibraryHealth 再来一遍，报告里同时给 before / after
//
// ── 硬约束：重建**不得改动任何素材文件**（SPEC §2.1）────────────────────────────
//   结构性保证：本模块只调上面这几个 API，它们的写入全部被 assertWritableGsPath 限制在
//   "<库根>/<.gs-* 名字>" 且必须是库根的**直接子项**；items.json 只读；索引替换走临时名 + rename。
//   ⇒ 本模块**没有任何**直接 fs.write / rename / unlink 的调用（唯一的 fs.* 是只读的 stat/readdir/read）。
//
//   机械断言：materialDigest() 在**重建前后**各算一次，两个摘要必须完全相同（测试与验收脚本都用它）。
//
//   ⚠️ 为什么 materialDigest **不**在 rebuildLibraryDb 内部自动做：
//      真实库里素材是几千张图 + 上 GB 的压缩包，算一遍内容哈希要几分钟、还要把几十 GB 从盘上读一遍。
//      把这个代价塞进"点一下重建"的路径里，用户会以为应用卡死了。
//      ⇒ 生产入口只保证"只碰 .gs-*"这条结构性质；**摘要比对留在验证侧**（测试/验收脚本），
//        那里素材规模是受控的。
//
// ── 幂等（T-11c 的口径）────────────────────────────────────────────────────────
//   重建两次 ⇒ items 的逻辑内容一致（行集 · uid→vectorRow 映射 · library 业务列 · schema 版本）。
//   **不比 .gs.db 的文件字节**：SQLite 的页布局 / freelist / WAL checkpoint / 文件内时间戳都不保证逐字节可复现，
//   比字节会把实现细节变化误报成数据不一致（T-11c 证据里已写明这条边界）。
//
// 本模块不 import electron；库根/路径由调用方传入；不建库根（Lead 裁定 U6）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ERR, fail } from '../../../../packages/engine/src/errors.ts';
import { isMaterialEntryName } from './gs-names.ts';
import { GS_DB_NAME } from './storage-roots.ts';
import { GsDbError, describeError } from './db/errors.ts';
import { importItemsFromJson } from './db/import.ts';
import type { ImportItemsReport, ImportLibraryRef } from './db/import.ts';
import { openGsDb, removeGsDbFiles } from './db/open.ts';
import { readIndexSummaryAt, writeIndexAtomically } from './index-file.ts';
import { resolveIndexLocation } from '../../../../packages/engine/src/index-layout.ts';
import { checkLibraryHealth } from './library-health.ts';
import type { LibraryHealthReport } from './library-health.ts';

// ---------------------------------------------------------------- 素材摘要（机械断言的载体）

export interface MaterialDigest {
  /** 非 .gs-* 条目的数量（素材 + 库根里的其它非保留文件） */
  count: number;
  /** 这些条目的总字节数 */
  bytes: number;
  digest: string;
  /** 是否把内容也算了进来（withContent）；false 时摘要只覆盖 路径|size|mtime */
  withContent: boolean;
}

export interface MaterialDigestOptions {
  /**
   * 是否把文件内容也纳入摘要（默认 false）。
   * true 的代价 = 把整个库读一遍 —— 只在**小夹具**上用；真实库请用 false（路径+size+mtime 已经能抓住改写）。
   */
  withContent?: boolean;
}

function sha1Text(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/**
 * 素材目录摘要（重建前后必须相同）。
 *
 * 覆盖：库根下递归的**全部非 .gs-* / 非 staging 条目** —— 路径 · size · mtimeMs（+ 可选内容 sha1），按路径排序后 sha1。
 * 为什么连 mtime 也要算：只看内容会漏掉"被原样重写了一遍"（那也是动过素材）。
 */
export function materialDigest(root: string, opts: MaterialDigestOptions = {}): MaterialDigest {
  const base = path.resolve(typeof root === 'string' ? root : '');
  let baseStat: fs.Stats;
  try {
    baseStat = fs.statSync(base);
  } catch {
    throw new Error('materialDigest 需要一个已存在的库根目录：' + base);
  }
  if (!baseStat.isDirectory()) throw new Error('materialDigest 的库根不是目录：' + base);

  const withContent = opts.withContent === true;
  const rows: string[] = [];
  let bytes = 0;

  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      // 「什么算素材」的唯一判据（gs-names.ts）：排除保留命名空间**与隐藏项** —— 与指纹/扫描器同口径（DF-3）
      if (!isMaterialEntryName(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      const st = fs.statSync(p);
      const rel = path.relative(base, p).split(path.sep).join('/');
      bytes += st.size;
      const content = withContent ? '|' + crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex') : '';
      rows.push(rel + '|' + String(st.size) + '|' + String(st.mtimeMs) + content);
    }
  };
  walk(base);
  rows.sort();
  return { count: rows.length, bytes, digest: sha1Text(rows.join('\n')), withContent };
}

// ---------------------------------------------------------------- 重建入口

export interface RebuildLibraryOptions {
  libId: string;
  /** 库根（.gs.db 与 .gs-index.bin 都落在它下面） */
  root: string;
  /** 条目表（重建的输入） */
  itemsJsonPath: string;
  /** .gs.db 落点；省略 = <库根>/.gs.db；显式 null = 没有落点（直接报错，不猜一个） */
  dbPath?: string | null;
  /** 期望计数（T-11c 裁定：优先用 meta.json 的 count；不默认读 11 MB 索引） */
  expectedCount?: number | null;
  /** 可选的重校验路径：.gs-index.bin（给了就顺带证明索引完好） */
  indexBinPath?: string | null;
  /** 新的索引字节（例如刚编码出来的）；**不给就绝不动索引** */
  indexBytes?: Uint8Array | null;
  /** library 行的其余字段（compat / dim / seq / metaJson / fallback…） */
  library?: Omit<ImportLibraryRef, 'libId' | 'root'>;
  now?: () => number;
  /** 是否做重建前自检（默认 true；报告里要有"为什么要重建"） */
  checkBefore?: boolean;
  /**
   * 旧布局的 libraries 根（`<dataDir>/libraries`）。给了 ⇒ 索引落点会**回退到旧布局**（T-44），
   * 自检与"索引处置"都按同一份判据说话。
   */
  legacyLibrariesDir?: string | null;
}

export type RebuildIndexAction = 'written' | 'kept' | 'still-broken';

export interface RebuildLibraryReport {
  libId: string;
  root: string;
  dbPath: string;
  indexPath: string;
  /** 重建前的自检（checkBefore=false 时为 null） */
  before: LibraryHealthReport | null;
  /** 真正删掉的 .gs.db 文件（含边车） */
  removedDbFiles: string[];
  /** .gs.db 是不是这次新建的 */
  created: boolean;
  schema: { fromVersion: number; toVersion: number; applied: number[] };
  import: ImportItemsReport;
  index: { action: RebuildIndexAction; detail: string; count: number | null; dim: number | null };
  /** 重建后的自检 */
  after: LibraryHealthReport;
  /** 所有 db-* 检查通过 —— **这才是重建本身的目标**（索引不在本入口的职责里） */
  dbOk: boolean;
  /** 索引项通过 */
  indexOk: boolean;
  /** = after.ok（**整个库**都好了才 true；索引仍然坏着 ⇒ false，绝不假装成功） */
  ok: boolean;
  reason: string;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function requireText(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new GsDbError('IMPORT_INPUT_INVALID', 'rebuildLibraryDb 需要非空的 ' + name);
  return text;
}

/**
 * 删库重建 .gs.db（并从 items.json 重新导入），可选地把新索引字节原子写进库根。
 *
 * @throws GsDbError(IMPORT_INPUT_INVALID | DB_PATH_REQUIRED | MKDIR_FAILED | DB_OPEN_FAILED |
 *                   IMPORT_* | MIGRATION_FAILED) · IndexFileError(INDEX_*)
 */
export function rebuildLibraryDb(opts: RebuildLibraryOptions): RebuildLibraryReport {
  const libId = requireText(opts.libId, 'libId');
  const root = path.resolve(requireText(opts.root, 'root'));
  const itemsJsonPath = path.resolve(requireText(opts.itemsJsonPath, 'itemsJsonPath'));
  const dbPath =
    opts.dbPath === null
      ? null
      : opts.dbPath === undefined
        ? path.join(root, GS_DB_NAME)
        : path.resolve(opts.dbPath);
  if (dbPath === null) {
    throw new GsDbError(
      'DB_PATH_REQUIRED',
      '重建需要一个 .gs.db 落点（T-04 的 resolveLibraryStorage().db），但现在没有：库根不可写且没有 userData 可回退',
    );
  }
  const now = opts.now ?? Date.now;
  // 索引落点：**唯一判据**（引擎 index-layout.ts）—— 与体检、与引擎读索引用的是同一个函数（T-44）
  const loc = resolveIndexLocation({
    libId,
    libraryRoot: root,
    legacyLibrariesDir: opts.legacyLibrariesDir ?? null,
  });
  const indexPath = loc.indexPath ?? loc.preferredPath;

  // ⓪ **库根必须先存在**（Lead 裁定 U6：不许静默建出一个空库根 = 幽灵库）
  //    ⚠️ 这一道必须挡在 openGsDb 之前 —— openGsDb 会对 dbPath 的父目录做 recursive mkdir
  //    （那是为 userData 回退落点准备的），盘没挂载时它会把"库根"凭空建出来。
  //    错误码用引擎的 LIB_ROOT_MISSING：错误码归引擎契约，UI 已有对应文案（SPEC F4）。
  if (!isDirectory(root)) {
    throw fail(ERR.LIB_ROOT_MISSING, '库根不存在或不是目录：' + root + ' —— 拒绝重建（不静默创建，见 U6）', { root });
  }

  // ① 重建前自检：报告里要说清"为什么要重建"
  const before = opts.checkBefore === false ? null : checkLibraryHealth({
    libId, root, dbPath, itemsJsonPath, legacyLibrariesDir: opts.legacyLibrariesDir ?? null,
  });

  // ② 删库（只删 .gs-* 命名空间里的文件，含 -wal/-shm/-journal）
  const removedDbFiles = removeGsDbFiles(dbPath);

  // ③ 建 schema + 跑迁移
  const opened = openGsDb({ dbPath, now });
  let importReport: ImportItemsReport;
  try {
    const library: ImportLibraryRef = Object.assign({ libId, root }, opts.library ?? {});
    importReport = importItemsFromJson({
      db: opened.db,
      library,
      itemsJsonPath,
      expectedCount: opts.expectedCount ?? null,
      indexBinPath: opts.indexBinPath ?? null,
      now,
    });
  } finally {
    // 关掉再动索引：Windows 上文件被占着 rename 会失败
    try {
      opened.db.close();
    } catch {
      // 关不掉不影响结论；真正的结论由下面的复检给出
    }
  }

  // ④ 索引侧：给字节就写；不给就只校验，**绝不动它**
  let index: RebuildLibraryReport['index'];
  if (opts.indexBytes !== undefined && opts.indexBytes !== null) {
    const written = writeIndexAtomically(root, opts.indexBytes);
    index = { action: 'written', detail: written.reason, count: written.count, dim: written.dim };
  } else {
    try {
      const kept = readIndexSummaryAt(indexPath);
      index = {
        action: 'kept',
        detail:
          '索引未改动（本次没有给新索引字节）：count=' + String(kept.count) + ' · dim=' + String(kept.dim),
        count: kept.count,
        dim: kept.dim,
      };
    } catch (e) {
      index = {
        action: 'still-broken',
        detail:
          '索引仍然不可用，**本入口修不好它**（索引要重新编码，见 T-13/T-16）：' + describeError(e),
        count: null,
        dim: null,
      };
    }
  }

  // ⑤ 复检
  const after = checkLibraryHealth({
    libId, root, dbPath, itemsJsonPath, legacyLibrariesDir: opts.legacyLibrariesDir ?? null,
  });
  const failed = after.checks.filter((c) => !c.ok);
  const dbOk = after.checks.filter((c) => c.id.startsWith('db-')).every((c) => c.ok);
  const indexCheck = after.checks.find((c) => c.id === 'index');
  const indexOk = indexCheck !== undefined && indexCheck.ok;
  const reason =
    '重建完成：删除 ' + String(removedDbFiles.length) + ' 个 .gs.db 文件 → schema v' + String(opened.migration.fromVersion) +
    '→v' + String(opened.migration.toVersion) + ' → 导入 ' + String(importReport.dbCount) + ' 条（新增 ' +
    String(importReport.inserted) + ' / 更新 ' + String(importReport.updated) + ' / 删除幽灵行 ' + String(importReport.deleted) +
    '）→ 索引 ' + index.action + '；复检 ' +
    (after.ok ? '通过（' + String(after.checks.length) + ' 项）' : '仍有 ' + String(failed.length) + ' 项问题：' + failed.map((c) => c.id + '(' + c.code + ')').join(' / '));

  return {
    libId,
    root,
    dbPath,
    indexPath,
    before,
    removedDbFiles,
    created: opened.created,
    schema: {
      fromVersion: opened.migration.fromVersion,
      toVersion: opened.migration.toVersion,
      applied: opened.migration.applied.map((m) => m.version),
    },
    import: importReport,
    index,
    after,
    dbOk,
    indexOk,
    ok: after.ok,
    reason,
  };
}

// apps/desktop/src/main/db/exports.ts —— **库级** `asset_export` 的唯一写入口（WIRE-B）
//
// 为什么单独一个模块：§2.3「每张表一个写入口」 ⇒ "谁写 asset_export"必须**一眼可查**。
//   本文件是**唯一**出现 `INSERT INTO asset_export` 的地方（测试会静态钉住）；业务侧只调这里的函数。
// 为什么在 `db/**` 而不是 `app-db.ts`：`asset_export` 是**库级**表（`.gs.db`，意图层），
//   与 `activity`（应用级 `app.db`）不在同一个库文件里 —— 两套账本、两个写入口，别混。
import type { SqlDatabase } from './index.ts';
import { changesOf } from './index.ts';

/** `asset_export.kind` 的合法值（与 DDL 的 CHECK 一致） */
export type ExportKind = 'collect' | 'deliver';

/** `asset_export.result` 的合法值（与 DDL 的 CHECK 一致；与 `activity.result` 同一套词） */
export type ExportResult = 'copied' | 'skipped' | 'failed';

export interface InsertExportRow {
  /** 批量内唯一的 id（基线写 nanoid；**本仓未装该依赖** ⇒ 用 crypto.randomUUID()，与 job_id 同一条处置，见 db/jobs.ts） */
  exportId: string;
  kind: ExportKind;
  /** 指向 `asset.uid`；**允许为空**（见下面 `insertExportRows` 的说明） */
  uid: string | null;
  /** 条目在**当时**的名字（导出历史要能显示它 —— 素材改名/移走后仍然看得懂） */
  assetName: string;
  /** 一次批量共用的 id = `activity.activity_id`（1:N 里的那个"1"） */
  batchId: string | null;
  targetDir: string;
  result: ExportResult | null;
  reason: string | null;
  atMs: number;
}

/**
 * 一批导出记录**整体写入**（单事务：要么 N 行全进，要么一行不进）。
 *
 * ⚠️ 为什么必须单事务：这 N 行是**同一件已发生的事**（一次取件/交付）的部分明细；
 *   写一半会造出一条"缺了 2 条明细"的历史，用户没法据此判断到底是哪几件没出去。
 * ⚠️ `uid` 为什么可空：引擎的索引与 `.gs.db` 的 `asset` 是**两份来源**（索引可由 items.json 重建，
 *   不保证每条都已在 `asset` 表里落行）。外键开着的库上，硬写一个 `asset` 里没有的 uid 会被
 *   数据库拒掉 ⇒ **整批都写不进去**（更糟）。于是：调用方先用 `existingAssetUids()` 过滤，
 *   **指向不到行的 uid 落 NULL**（DDL 本来就允许 NULL + `ON DELETE SET NULL`），
 *   而"名字/结果/时刻"这些事实照旧留下 —— 历史仍然可读，只是少一条可点的链接。
 * @returns 实际写入的行数（= rows.length；失败会抛，不会返回半截）
 */
export function insertExportRows(db: SqlDatabase, rows: readonly InsertExportRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    'INSERT INTO asset_export (export_id, kind, uid, asset_name, batch_id, target_dir, result, reason, at_ms) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of rows) {
      stmt.run(
        r.exportId,
        r.kind,
        r.uid,
        r.assetName,
        r.batchId,
        r.targetDir,
        r.result,
        r.reason,
        r.atMs,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败：原样抛出下面的错 */
    }
    throw e;
  }
  return rows.length;
}

/**
 * 哪些 uid **真的在 `asset` 表里**（用于上面那条"外键最佳努力"）。
 * 一次查询、不逐条问库；`asset` 表可能为空（索引来自 items.json），那不是错误。
 */
export function existingAssetUids(db: SqlDatabase, uids: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (uids.length === 0) return out;
  const marks = uids.map(() => '?').join(', ');
  const rows = db.prepare('SELECT uid FROM asset WHERE uid IN (' + marks + ')').all(...uids);
  for (const r of rows) out.add(String(r.uid));
  return out;
}

/**
 * 按 **export_id** 删掉**这一次写的**行（补偿用：活动记录写失败时撤回明细，避免留下"缺 1"的半条历史）。
 *
 * ⚠️ 为什么**不**按 `batch_id` 删（踩过）：同一 batch id 可能被**重放**（例如第一次写成功、
 *   第二次因为 activity 主键冲突而失败）—— 按 batch 删会把**上一次成功的那批行一起删掉**，
 *   历史里就只剩一条活动记录、没有明细了。按**本次生成的 id** 删，才只撤自己写的那一批。
 */
export function deleteExportsByIds(db: SqlDatabase, exportIds: readonly string[]): number {
  if (exportIds.length === 0) return 0;
  const marks = exportIds.map(() => '?').join(', ');
  const res = db
    .prepare('DELETE FROM asset_export WHERE export_id IN (' + marks + ')')
    .run(...exportIds);
  return changesOf(res, '撤回导出明细');
}

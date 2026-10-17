// apps/desktop/src/main/collect-ledger.ts —— **取件/交付的留痕**（唯一一处同时写 `activity` + `asset_export`）
//
// 为什么要有这个模块（P1 · §2.3）：
//   · `activity`（应用级 app.db）与 `asset_export`（库级 .gs.db）是**两张表、两个库文件**，
//     但"一次批量 = activity 1 行 + asset_export N 行、同一个 batch_id"是**一个事实**；
//   · 把"写这两张表"收在**这一个函数**里 ⇒ "谁在造这条历史"只有一处可查（测试静态钉住），
//     而且 1:N 的关系不会出现"两处各写一半、谁的 id 都对不上"的漂移。
//
// ⚠️ 失败策略（卡面要求）：**文件已经复制出去的事实不受影响**。
//   · 本函数**永不抛** —— 取件的成功/失败由引擎按文件复制结果裁决，不能因为"记历史失败"就把成功说成失败；
//   · 失败**必须出声**：如实写日志（`log` 落盘 data/_app.log）+ 返回非空 `warning`，
//     由 IPC 层挂到信封的 warnings 上（界面/日志都能看到，不静默）。
//   · 写 activity 失败时**补偿**：把这一批 export 明细删掉（否则会留下"N 条明细却没有活动记录"的半条历史，
//     下一次读历史的人无法判断这是不是一次完整操作）。补偿也失败 ⇒ 两条失败都记日志。
import crypto from 'node:crypto';

import { insertActivity, openAppDb } from './app-db.ts';
import { deleteExportsByIds, existingAssetUids, insertExportRows } from './db/exports.ts';
import { openGsDb } from './db/open.ts';
import { log } from './log.ts';

/**
 * 异常 → 可归档的一段文字。
 * ⚠️ 不 import `index.ts` 里那个同名局部函数（那是入口模块的私有件，import 主入口会**执行**整个应用装配）。
 * 这里只要有堆栈看就够（日志是给人排障的）。
 */
function stackText(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message;
  return String(e);
}

/** 一次取件里**每一条**的结局（来自引擎 collect 的 succeeded / skipped / failed 三个数组） */
export interface CollectOutcomeRow {
  uid: string;
  /** 条目在当时的名字（界面上要能看懂；失败时可能是 uid 或源文件名） */
  assetName: string;
  result: 'copied' | 'skipped' | 'failed';
  reason: string | null;
}

export interface RecordCollectBatchInput {
  /** `app.getPath('userData')` —— app.db 的落点根（为 null ⇒ 记不了，返回警告） */
  userDataDir: string | null;
  /** 该库 `.gs.db` 的落点（由 storage 端口解析；为 null ⇒ 记不了，返回警告） */
  libDbPath: string | null;
  libId: string;
  /** 批量 id = 引擎 collect 返回的 `jobId`（一次取件一个）⇒ 同时是 `activity_id` 与 `batch_id` */
  batchId: string;
  targetDir: string;
  targetDirName: string | null;
  bytesTotal: number;
  rows: readonly CollectOutcomeRow[];
  now?: () => number;
}

export interface CollectLedgerResult {
  /** 两张表**都**写成功 = true（1:N 完整）；否则 false 且 `warning` 非空 */
  written: boolean;
  exportRows: number;
  activity: boolean;
  /** 非空 ⇒ IPC 层要把它挂到信封 warnings（**不是**把取件判失败） */
  warning: string | null;
}

function failed(warning: string): CollectLedgerResult {
  return { written: false, exportRows: 0, activity: false, warning };
}

/**
 * 把一次取件的结果**留痕**：`asset_export` N 行（库级）+ `activity` 1 行（应用级），同一个 batch id。
 * @returns 永远返回结构化结果（**不抛**）；`written=false` 时一定带 `warning`
 */
export function recordCollectBatch(input: RecordCollectBatchInput): CollectLedgerResult {
  const atMs = (input.now ?? Date.now)();
  if (!input.userDataDir) return failed('取件文件已复制，但应用数据目录未就绪，操作记录没有写入');
  if (!input.libDbPath)
    return failed('取件文件已复制，但库的元数据落点没解析出来，导出历史没有写入');
  if (input.rows.length === 0) return failed('取件没有产生任何结果行，操作记录没有写入');
  if (!input.batchId) return failed('取件没有返回批量 id，操作记录没有写入（1:N 关系需要它）');

  let lib;
  let app;
  try {
    lib = openGsDb({ dbPath: input.libDbPath });
    app = openAppDb({ userDataDir: input.userDataDir });
  } catch (e) {
    log('!! [取件] 打开记录用的数据库失败（**文件已复制的事实不受影响**）:', stackText(e));
    return failed('取件文件已复制，但记录用的数据库打不开，操作记录没有写入');
  }

  try {
    // uid 指向 asset 表**最佳努力**：索引与 .gs.db 是两份来源，指向不到的行落 NULL（DDL 允许），
    // 否则一个不认识的外键会让**整批**写不进去（比"少一个链接"糟得多）。
    const known = existingAssetUids(
      lib.db,
      input.rows.map((r) => r.uid),
    );
    const exportRows = input.rows.map((r) => ({
      exportId: crypto.randomUUID(),
      kind: 'collect' as const,
      uid: known.has(r.uid) ? r.uid : null,
      assetName: r.assetName,
      batchId: input.batchId,
      targetDir: input.targetDir,
      result: r.result,
      reason: r.reason,
      atMs,
    }));

    const n = insertExportRows(lib.db, exportRows);
    // 补偿时用**本次生成的 id**（不是 batch_id —— 同一 batch 可能被重放，按 batch 删会连累上一次成功的行）
    const writtenIds = exportRows.map((r) => r.exportId);

    // 汇总成**一个**结论：有任何 failed ⇒ failed；否则有 copied ⇒ ok；全 skipped ⇒ skipped。
    let copied = 0;
    let skipped = 0;
    let failedCount = 0;
    for (const r of input.rows) {
      if (r.result === 'copied') copied++;
      else if (r.result === 'skipped') skipped++;
      else failedCount++;
    }
    const result = failedCount > 0 ? 'failed' : copied > 0 ? 'ok' : 'skipped';

    try {
      insertActivity(app.db, {
        activityId: input.batchId,
        atMs,
        kind: 'collect',
        // 一次取件作用于**一个库的一批条目** ⇒ 主体是那个库（subject_id 留空，明细在 detail 里）
        subjectKind: 'library',
        subjectId: input.libId,
        libId: input.libId,
        result,
        detail: {
          target_dir: input.targetDir,
          target_dir_name: input.targetDirName,
          bytes_total: input.bytesTotal,
          copied,
          skipped,
          failed: failedCount,
        },
      });
    } catch (e) {
      // 补偿：撤回这一批明细（不留"缺 1"的半条历史）
      let rolled = 0;
      try {
        rolled = deleteExportsByIds(lib.db, writtenIds);
      } catch (e2) {
        log('!! [取件] 写操作记录失败后，补偿删除导出明细也失败了（需要人工核对）:', stackText(e2));
      }
      log(
        '!! [取件] 写操作记录失败（**文件已复制**；已撤回 ' + String(rolled) + ' 条导出明细）：',
        stackText(e),
      );
      return failed('取件文件已复制，但操作记录写入失败（已撤回明细并记录日志，详见日志）');
    }

    log(
      '[取件] 已留痕：activity 1 行 + asset_export ' +
        String(n) +
        ' 行（batch=' +
        input.batchId +
        '，result=' +
        result +
        '）',
    );
    return { written: true, exportRows: n, activity: true, warning: null };
  } catch (e) {
    log('!! [取件] 写导出历史失败（**文件已复制的事实不受影响**）:', stackText(e));
    return failed('取件文件已复制，但导出历史写入失败（已记录日志）');
  } finally {
    lib.db.close();
    app.db.close();
  }
}

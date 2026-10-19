// apps/desktop/src/main/db/phash.ts —— 感知哈希的**存储 / 读 / 回填**（PHASH-1a）
//
// §2.3「每张表一个写入口」：`asset_file.phash` 的写入只在本文件（UPDATE asset_file SET phash …）。
// ⚠️ 三条口径（与迁移 v10 的注释一致，别在两处各写一半）：
//   ① **NULL = 坏图/缺图/还没算**；**绝不用 0 哈希**（那会让坏图看起来和所有图都像）；
//   ② **回填幂等 + 可断点**：只挑 `phash IS NULL` 的预览行；中断重跑不会重算已完成的；
//   ③ **阈值 k 不在这里定**：本层只存/读 64-bit hex（k 由 EVAL-1 校准，PHASH-1b 接入排序）。
import path from 'node:path';

import type { SqlDatabase } from './index.ts';
import { changesOf } from './index.ts';
import { dHashHex } from '../phash.ts';
import type { PhashDecoder } from '../phash.ts';

export interface PhashPendingRow {
  uid: string;
  relPath: string;
}

export interface PhashBackfillInput {
  /** 库根（relPath 是库内相对路径） */
  libRoot: string;
  decode: PhashDecoder['decodeGray9x8'];
  limit?: number;
  /** 每处理 **一条** 就回调一次（进度类状态必须不静默） */
  onProgress?: (p: { processed: number; done: number; nulled: number; failed: number }) => void;
}

export interface PhashBackfillResult {
  done: number;
  nulled: number;
  failed: number;
}

/** 读一条素材的感知哈希（**NULL 表示坏图/缺图/未算**，调用方别把它当 0） */
export function readPhash(db: SqlDatabase, uid: string): string | null {
  const row = db
    .prepare("SELECT phash FROM asset_file WHERE uid = ? AND role = 'preview'")
    .get(uid);
  if (!row || row.phash === null || row.phash === undefined) return null;
  return String(row.phash);
}

/**
 * 批量读（一次 SQL，给"检索结果近重复标注"用）。
 *
 * @returns `uid -> phash|null`；**查不到的 uid 不出现在 Map 里**（调用方把它当"未知"，不是 0）
 */
export function readPhashMap(db: SqlDatabase, uids: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const list = [...new Set(uids.filter((u) => typeof u === 'string' && u))];
  if (list.length === 0) return out;
  const holes = list.map(() => '?').join(',');
  const rows = db
    .prepare("SELECT uid, phash FROM asset_file WHERE role = 'preview' AND uid IN (" + holes + ')')
    .all(...list);
  for (const row of rows) {
    out.set(
      String(row.uid),
      row.phash === null || row.phash === undefined ? null : String(row.phash),
    );
  }
  return out;
}

/**
 * 写一条（`phash = null` 也允许：显式记"这条算不出来"）。
 * @returns 是否真的有行被更新（没有该 uid 的预览行 ⇒ false，不伪造）
 */
export function writePhash(db: SqlDatabase, uid: string, phash: string | null): boolean {
  if (phash !== null && !/^[0-9a-f]{16}$/.test(phash)) {
    throw new Error('phash 必须是 16 位小写 hex 或 null，实得 ' + String(phash));
  }
  const res = db
    .prepare("UPDATE asset_file SET phash = ? WHERE uid = ? AND role = 'preview'")
    .run(phash, uid);
  return changesOf(res, '写 phash') > 0;
}

/** 待回填的预览行（**只挑 phash IS NULL** ⇒ 幂等/可断点） */
export function listPhashPending(db: SqlDatabase, limit: number): PhashPendingRow[] {
  return db
    .prepare(
      "SELECT uid, rel_path FROM asset_file WHERE role = 'preview' AND phash IS NULL ORDER BY uid LIMIT ?",
    )
    .all(Math.max(1, Math.trunc(limit)))
    .map((row) => ({ uid: String(row.uid), relPath: String(row.rel_path) }));
}

/**
 * 回填：逐条解码 → dHash → 写回。
 * · 解码返回 null（坏图/缺图）⇒ 写 **NULL** + `nulled++`（**不写 0 哈希**）；
 * · 解码/写回抛错 ⇒ `failed++`（保持 NULL，下次重跑会再试）；
 * · 每条都回调 `onProgress`（不静默）。
 */
export async function backfillPhash(
  db: SqlDatabase,
  input: PhashBackfillInput,
): Promise<PhashBackfillResult> {
  const limit = typeof input.limit === 'number' ? input.limit : 200;
  const rows = listPhashPending(db, limit);
  const out: PhashBackfillResult = { done: 0, nulled: 0, failed: 0 };
  for (const row of rows) {
    try {
      const abs = path.join(input.libRoot, row.relPath);
      const gray = await input.decode(abs);
      if (gray === null) {
        writePhash(db, row.uid, null);
        out.nulled++;
      } else {
        writePhash(db, row.uid, dHashHex(gray));
        out.done++;
      }
    } catch {
      out.failed++;
    }
    input.onProgress?.({ processed: out.done + out.nulled + out.failed, ...out });
  }
  return out;
}

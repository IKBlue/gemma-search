// apps/desktop/src/main/near-dup.ts —— 检索结果的「近重复」标注（PHASH-1b 结果呈现 · U39 口径 B）
//
// 所有者 2026-10-19 裁 B：**结果卡加「近重复」角标**，判据用 PHASH-1a 的 dHash + PHASH-1b 复核出的阈值 k=10。
// 三条口径：
//   ① **只标注、不改结果**：分数与排序一个字不动（"近重复"是附加信息，不是重排依据）；
//   ② **未知 ≠ 不同**：查询图或结果图任一侧哈希缺失/为 NULL ⇒ `phashDistance = null`、
//      `nearDuplicate = false`（不要把"没算出来"说成"不重复"，也不要当成 0 距离）；
//   ③ 纯函数 + 注入读取：DB 访问由调用方（main/index.ts）注入 ⇒ 可在 node:test 里逐条钉边界。
import { hammingHex, PHASH_NEAR_DUP_K } from './phash.ts';

export interface NearDupRowLike {
  uid?: string;
  libId?: string;
}

export type AnnotatedRow<T extends NearDupRowLike> = T & {
  /** 与查询图的 dHash 汉明距离；**null = 未知**（查询图或该条没有可用 phash） */
  phashDistance: number | null;
  /** 是否近重复（`phashDistance !== null && <= k`）；未知一律 false */
  nearDuplicate: boolean;
};

const PHASH_RE = /^[0-9a-f]{16}$/;

/**
 * 给检索结果逐条标注近重复。
 *
 * @param rows 引擎原样结果（**不修改入参**，返回新数组）
 * @param queryPhash 查询图的 dHash（16 位小写 hex）；null/形状不对 ⇒ 全部标"未知"
 * @param phashOf 读取某条结果已存的 phash（缺失返回 null）—— 由调用方查库
 * @param k 阈值（默认 `PHASH_NEAR_DUP_K` = 10，来自生产解码复核；测试可注入边界值）
 */
export function annotateNearDuplicates<T extends NearDupRowLike>(
  rows: readonly T[],
  queryPhash: string | null,
  phashOf: (libId: string, uid: string) => string | null,
  k: number = PHASH_NEAR_DUP_K,
): Array<AnnotatedRow<T>> {
  const q = typeof queryPhash === 'string' && PHASH_RE.test(queryPhash) ? queryPhash : null;
  return rows.map((row) => {
    const libId = String(row.libId ?? '');
    const uid = String(row.uid ?? '');
    const stored = q && libId && uid ? phashOf(libId, uid) : null;
    const distance = q ? hammingHex(q, stored) : null;
    return {
      ...row,
      phashDistance: distance,
      nearDuplicate: distance !== null && distance <= k,
    };
  });
}

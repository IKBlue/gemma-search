// apps/desktop/src/main/gs-names.ts —— 库根"保留命名空间"的**唯一判据**
//
// 什么算"我们自己的东西"（扫描器要跳过、重建不许碰、素材摘要要排除）：
//   · `.gs-*`（`.gs-index.bin` · `.gs-journal` · `.gs-staging` · `.gs-write-probe-*` …）
//   · `.gs.db` **及其边车** `.gs.db-wal` / `.gs.db-shm` / `.gs.db-journal`
//   · staging 目录（名字的唯一来源是引擎的 STAGING_DIRNAME）
//
// ⚠️ **为什么不能只判断 `.gs-` 前缀**（2026-10-15 T-15a 实测踩到，两处症状都出现了）：
//     `.gs.db` 的第 4 个字符是 **`.`** 不是 `-` ⇒ `'.gs.db'.startsWith('.gs-') === false`，
//     它的三个边车同样不匹配。只按 `.gs-` 过滤会：
//       ① 让扫描器把 `.gs.db` 当成素材（F5 体检会把它报成"有包无图 / 零字节"这类假发现）；
//       ② 让"重建前后素材摘要一致"的机械断言把 SQLite 的 WAL 变化算成"素材被改了"（H11/H12 实测红）。
//     ⇒ 判据必须**逐字对齐 SPEC §2 的布局图**，而不是望文生义地看前缀。
//
// 常量（文件名）的唯一来源仍是 storage-roots.ts：本模块只**引**它们，不重新定义（P1）。
// 本模块不 import electron；不读写任何文件。

import { STAGING_DIRNAME } from '../../../../packages/engine/src/transactions/steps.ts';
import { GS_DB_NAME } from './storage-roots.ts';

/** `.gs-*` 名字（前缀后必须真的还有名字 —— 光一个 `.gs-` 不是文件名） */
export function isGsNamespaceName(name: unknown): boolean {
  return typeof name === 'string' && name.length > '.gs-'.length && name.startsWith('.gs-');
}

/** `.gs.db` 家族：主文件与它的 -wal / -shm / -journal 边车 */
export function isGsDbName(name: unknown): boolean {
  return typeof name === 'string' && (name === GS_DB_NAME || name.startsWith(GS_DB_NAME + '-'));
}

/**
 * 这个名字是不是库根的保留名（⇒ 不是素材）。
 *
 * 用途：扫描器跳过、写入约束、素材摘要排除 —— 三处都该用它，不各写一份（AGENTS P1）。
 */
export function isReservedLibraryName(name: unknown): boolean {
  if (typeof name !== 'string' || name === '') return false;
  if (isGsNamespaceName(name)) return true;
  if (isGsDbName(name)) return true;
  if (name === STAGING_DIRNAME) return true;
  return false;
}

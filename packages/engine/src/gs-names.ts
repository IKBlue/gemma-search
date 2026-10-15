// packages/engine/src/gs-names.ts —— 库根「保留命名空间」的**唯一判据**（引擎侧唯一来源）
//
// 什么算"我们自己的东西"（扫描器要跳过、重建不许碰、素材摘要要排除）：
//   · `.gs-*`（`.gs-index.bin` · `.gs-journal` · `.gs-staging` · `.gs-write-probe-*` …）
//   · `.gs.db` **及其边车** `.gs.db-wal` / `.gs.db-shm` / `.gs.db-journal`
//   · staging 目录（名字的唯一来源是 `transactions/steps.ts` 的 `STAGING_DIRNAME`）
//
// ⚠️ **为什么"只看 `.gs-` 前缀"不够**（2026-10-15 实测，TASKS §4 的 U11）：
//    `.gs.db` 的第 4 个字符是 **`.`** 不是 `-` ⇒ `'.gs.db'.startsWith('.gs-') === false`，
//    它的三个边车同样不匹配。只按前缀过滤会：
//      ① 让**扫描器把 `.gs.db` 当成素材**（体检会报"有包无图 / 零字节"这类**假发现**）；
//      ② 让"重建前后素材摘要一致"把 SQLite 的 WAL 变化算成"素材被改了"。
//    ⇒ 判据必须**逐字对齐 SPEC §2 的布局图**，而不是望文生义地看前缀。
//
// ⚠️ **唯一实现的位置**：本文件就是那一份。`apps/desktop/src/main/gs-names.ts` 原先自带一份同义实现；
//    main → engine 是这个仓库既有的依赖方向（main 早就 import 了引擎的 STAGING_DIRNAME），
//    反向 import（engine → main）会**成环**，也会破坏"引擎可脱离 Electron 单独测试"这条硬约束
//    （AGENTS §1）⇒ 唯一实现落引擎侧，main 侧改为 re-export —— 那一步在主进程的写入范围里，已上报 Lead。
//
// 本模块**不 import electron、不读写任何文件**：纯判定。
import { STAGING_DIRNAME } from './transactions/steps.ts';

// ── 名字的唯一来源（判定与拼路径都从这里取）─────────────────────────────
//
// ⚠️ 这三个文件名原先在 `apps/desktop/src/main/storage-roots.ts` 里**各有一份同值常量**
//    （main 用它拼路径、引擎用 GS_DB_NAME 判定）—— 同一件事两处定义就是 P1。
//    按 U11 的收敛方案：**唯一来源落在引擎侧**（零依赖、可脱离 Electron 测试），
//    main 侧改为 re-export（那一步在主进程写入范围里，由 Lead 执行）。
//
// ⚠️ 谁改这些字面量都必须同时确认 SPEC §2 的布局图 —— 它们是"用户素材之外的东西"的唯一清单。

/** 向量索引文件名（SPEC §2：落在**库根**，拷贝库即带走索引） */
export const GS_INDEX_NAME = '.gs-index.bin';

/** 元数据（SQLite）文件名；边车 `-wal` / `-shm` / `-journal` 由数据库自己创建 */
export const GS_DB_NAME = '.gs.db';

/** 事务日志**目录**名（SPEC §2：`<库根>/.gs-journal/`） */
export const GS_JOURNAL_NAME = '.gs-journal';

/** 写探测文件的点前缀（它本身就是 `.gs-*` 的一员，用于判断库根可写性） */
export const GS_WRITE_PROBE_PREFIX = '.gs-write-probe-';

/** `.gs-*` 名字（前缀后必须真的还有名字 —— 光一个 `.gs-` 不是文件名） */
export function isGsNamespaceName(name: unknown): boolean {
  return typeof name === 'string' && name.length > '.gs-'.length && name.startsWith('.gs-');
}

/** `.gs.db` 家族：主文件与它的 `-wal` / `-shm` / `-journal` 边车 */
export function isGsDbName(name: unknown): boolean {
  return typeof name === 'string' && (name === GS_DB_NAME || name.startsWith(GS_DB_NAME + '-'));
}

/**
 * 这个名字是不是库根的**保留名**（⇒ 不是素材）。
 *
 * 用途：扫描器跳过、写入约束、素材摘要排除 —— 三处都该用它，**不各写一份**（AGENTS P1）。
 * 注意它**不等于**"点开头"：`.gitignore` / `.gsfoo.jpg` 不是保留名（但它们仍是隐藏项，
 * 按 SPEC §1「跳过隐藏项」另外处理，两件事不要混）。
 */
export function isReservedLibraryName(name: unknown): boolean {
  if (typeof name !== 'string' || name === '') return false;
  if (isGsNamespaceName(name)) return true;
  if (isGsDbName(name)) return true;
  if (name === STAGING_DIRNAME) return true;
  return false;
}

// ── 「什么算素材」的唯一判据（DF-3）──────────────────────────────────────────
//
// 为什么要有它：`isReservedLibraryName` 只回答"是不是我们自己的东西"，而"素材"还要**排除隐藏项**
// （SPEC §1：`.gs-*` 与隐藏项都必须跳过）。三处调用方各写一遍判断就是 P1 —— 2026-10-15 实测出现过
// 指纹与扫描器**两套口径**（`fingerprint.ts` 只跳保留名 ⇒ 一个 `.DS_Store` 就能让"库指纹"变，
// 而扫描 diff 什么都不显示：用户被告知"库被改过"却查不出改了什么）。
// ⇒ 分类只在这里做一次：`reserved`（我们的派生数据）· `hidden`（隐藏项）· `material`（素材候选）。

/** 条目名字的三种归属（**目录与文件同判**：`.gs-staging` / `.git` 这类目录也必须跳过） */
export type EntryClass = 'reserved' | 'hidden' | 'material';

/**
 * 名字分类。`reserved` 与 `hidden` 都不是素材；空串 / 非字符串一律不算素材（按 hidden 处置）。
 * ⚠️ 顺序有意义：先保留命名空间、再隐藏项 —— `.gs.db` 既是点开头又是保留名，必须归 `reserved`
 *    （否则扫描器的 skippedReserved / skippedHidden 两个计数会与事实不符）。
 */
export function classifyEntryName(name: unknown): EntryClass {
  if (typeof name !== 'string' || name === '') return 'hidden';
  if (isReservedLibraryName(name)) return 'reserved';
  if (name.startsWith('.')) return 'hidden';
  return 'material';
}

/**
 * 「这个名字是素材候选吗」——**唯一判据**。
 * 调用方：scanner.ts（扫描器）· fingerprint.ts（库指纹）· main/library-rebuild.ts（素材摘要）。
 */
export function isMaterialEntryName(name: unknown): boolean {
  return classifyEntryName(name) === 'material';
}

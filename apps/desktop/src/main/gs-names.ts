// apps/desktop/src/main/gs-names.ts —— 库根「保留命名空间」判据的**主进程入口**
//
// ⚠️ 判据与名字的**唯一实现**在引擎侧：`packages/engine/src/gs-names.ts`。
//    为什么不是这里：main → engine 是本仓库既有的依赖方向（main 早就 import 了引擎的 STAGING_DIRNAME），
//    反向 import 会成环，也会破坏「引擎可脱离 Electron 单独测试」这条硬约束（AGENTS §1）。
//    本文件**只做 re-export**，不许再长出第二份实现
//    —— `apps/desktop/tests/gs-names-single-source.test.mjs` 会在你写第二份时当场变红。
//
// 历史（2026-10-15，TASKS §4 的 U11）：这里曾有一份同义实现，与引擎侧各自踩到
// 「`'.gs.db'.startsWith('.gs-') === false` ⇒ `.gs.db` 家族被当成素材 / WAL 变化被当成素材被改」。
// 两路独立撞上同一个洞 ⇒ 判据收敛成一份，而不是各修各的。
//
// 本模块不 import electron；不读写任何文件。
export {
  isGsNamespaceName,
  isGsDbName,
  isReservedLibraryName,
  // DF-3：'什么算素材'的判据（= 非保留名 **且** 非隐藏项）；扫描器/指纹/素材摘要共用同一份
  isMaterialEntryName,
  GS_INDEX_NAME,
  GS_DB_NAME,
  GS_JOURNAL_NAME,
  GS_WRITE_PROBE_PREFIX,
} from '../../../../packages/engine/src/gs-names.ts';

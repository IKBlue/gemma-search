// utils/gate.ts —— 「显示向导还是显示应用」的**判定**（Operation 层，纯函数，无 JSX）
//
// 为什么把判定从 `pages/LibraryGate.jsx` 里抽出来：
//   `node:test` 加载不了 `.jsx`，而"无库必须先给向导"是 **D2 修复的核心行为** ——
//   它此前靠已删的 DOM 守卫覆盖，守卫一走就**没有任何自动化**了。
//   抽成纯函数之后，这条行为可以用 `npm test` 钉住（`LibraryGate.jsx` 只负责把判定映射成界面）。
//
// 四种状态与 `LibraryGate.jsx` 的注释一一对应：
//   loading —— 还没问出来，什么都不显示（不要闪一下向导又消失）
//   error   —— 连配置都读不到，如实报 + 给重试
//   wizard  —— 一个库都没有 ⇒ 遮挡式首启向导
//   app     —— 有库 ⇒ 正常界面
//
// ⚠️ 判据是 `libraries` 的**长度**，不是"data 存不存在"：主进程可能返回
//    `{libraries: [], chosen: null}` 表示"四条路都没找到库"，那也必须进向导。

/** 判定结果（四个字面量就是界面的四个分支） */
export type GateDecision = 'loading' | 'error' | 'wizard' | 'app';

/** `useLibraryConfig()` 的返回（或任何**同形状**的注入源 —— 所以只要结构对就收） */
export type GateState = {
  loading?: boolean;
  error?: unknown;
  data?: { libraries?: unknown[] } | null;
};

/**
 * @param state `useLibraryConfig()` 的返回（或任何同形状的注入源）；`null` 按"什么都没读到"处理
 */
export function decideGate(state?: GateState | null): GateDecision {
  const s: GateState = state || {};
  if (s.loading) return 'loading';
  if (s.error) return 'error';
  const libs = (s.data && s.data.libraries) || [];
  return Array.isArray(libs) && libs.length > 0 ? 'app' : 'wizard';
}

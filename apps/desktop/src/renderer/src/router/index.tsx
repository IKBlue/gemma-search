// router/index.tsx —— 路由装配（**唯一**把路由表与组件连起来的地方）
//
// 为什么用 **hash 路由**：打包态是 `file://` 加载（`out/renderer/index.html`），
//   history 路由的深链没有服务器来 rewrite ⇒ 直接 404。hash 路由不需要服务器。
//
// 为什么这里有一条**启动期断言**（而不是只靠 `npm test`）：
//   `router/paths.ts` 是路由表的唯一来源，组件映射在本文件。两者若对不上，
//   最坏情况是**静默白屏** —— 那是最难查的一类问题。所以不匹配就当场抛，
//   宁可启动即失败，也不要让人对着空白界面猜。
//
// 路由匹配本身由 `apps/desktop/tests/router.test.mjs` 用 react-router 的 `matchRoutes()`
// 在纯 Node 里验证（不需要 DOM）—— 见 `router/paths.ts` 头部注释。
//
// ── ⚠️ 2026-10-16（PERF-1）：路由页改成**按需加载** ──────────────────────────
//   改之前：6 个页面全是**静态导入** ⇒ 全部钉进主 chunk。
//   BUILD-2 量到的机械证据：渲染层**只有 1 个 JS chunk / 1,245,068 B**。
//   改之后：每个页面一个 loader（`() => import(...)`）⇒ Rollup 才能按路由切 chunk。
//
//   ⚠️ 这条改动**与 `main.tsx` 的 glob 是耦合的**，两边必须同时改（见 main.tsx 的长注释）：
//     Rollup 只在「**同一个模块既被静态导入、又被动态导入**」时报警告，而静态导入正是把模块
//     钉进主 chunk 的原因 ⇒ 「一个模块只能走一条腿」。
//     路由页走**动态**，所以 main.tsx 那边的 pages glob 也必须把路由页排除在 eager 之外；
//     非路由页（LibraryGate / FirstRunWizard）走**静态**，那边就保持 eager。
//     只改一边的后果：要么 chunk 拆不出来（只改本文件、glob 仍 eager），
//     要么 BUILD-2 修掉的 19 条警告原样回来（只改 glob、本文件仍静态导入）。
import { Suspense, createElement, lazy } from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router';

import { ROUTES } from './paths.ts';

/**
 * 路由 key → **按需加载器**（模块形状只需有 `default` 导出）。
 *
 * ⚠️ 不能用 `import.meta.glob('./pages/*.tsx')` 一把抓：pages/ 下还有**不是路由**的页面，
 *    被别处静态导入（LibraryGate ← App、FirstRunWizard ← LibraryGate、AppHealthPanel ← DiagnosticsPage）
 *    ⇒ 纳入动态 glob 会造出"动态+静态"，正是 BUILD-2 修掉的警告。所以这里**逐个列出路由页**。
 *    ⚠️ 新增路由页时要**同时**改这里与本文件的断言；`ROUTES` 与它的对应关系由下面的启动期断言兜住。
 */
const LOADERS = {
  search: () => import('../pages/SearchPage.tsx'),
  item: () => import('../pages/ItemPage.tsx'),
  tasks: () => import('../pages/TasksPage.tsx'),
  activity: () => import('../pages/ActivityPage.tsx'),
  health: () => import('../pages/DiagnosticsPage.tsx'),
  browse: () => import('../pages/BrowsePage.tsx'),
} satisfies Record<string, () => Promise<unknown>>;

// 启动期断言：表里有 key 却没有加载器 ⇒ 立刻炸，别留白屏
// （原先断言的是 `typeof COMPONENTS[key] === 'function'`；现在映射的是 **loader**，
//  所以判据同样是 `function` —— 只是把"组件"换成了"加载器"，判据强度没降。）
const missing = ROUTES.filter((r) => !(r.key in LOADERS)).map((r) => r.key);
if (missing.length) {
  throw new Error(
    `路由表里的这些 key 没有对应加载器（router/index.tsx 的 LOADERS）：${missing.join(', ')}`,
  );
}

/** 加载器 → `React.lazy` 组件（**只在模块顶层建一次**：每次 render 新建会让 React 重挂载整棵子树） */
const PAGES = {
  search: lazy(LOADERS.search),
  item: lazy(LOADERS.item),
  tasks: lazy(LOADERS.tasks),
  activity: lazy(LOADERS.activity),
  health: lazy(LOADERS.health),
  browse: lazy(LOADERS.browse),
};

/**
 * 路由 chunk 到达前的占位。
 *
 * ⚠️ 刻意**几乎不可见**：**外壳（AppShell + 侧栏）在页面组件内部**（每个页面各自渲染，
 *    见 pages/*.tsx 的 `<AppShell>`），所以这里包住的是**整个窗口**。
 *    放一个带高度或骨架的 fallback 会先铺一块版式、再被页面替换 ⇒ **闪烁 + 版式跳动**。
 *    留一个空 div（附 `aria-busy`）把代价压到最小：chunk 到达前短暂空白。
 *    chunk 来自本地 `file://`，实测等待是毫秒级。
 */
function RouteFallback() {
  return <div data-testid="route-loading" aria-busy="true" />;
}

export const router = createHashRouter([
  ...ROUTES.map((r) => ({
    path: r.path,
    element: <Suspense fallback={<RouteFallback />}>{createElement(PAGES[r.key])}</Suspense>,
  })),
  // 未知 hash ⇒ 回搜索页（而不是白屏）。用户手改地址栏或旧书签都会走到这里。
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}

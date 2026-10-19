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
 * **落地页**：`search` 走**静态**（不 lazy）。
 *
 * ⚠️ 2026-10-16（PERF-2 · 实测依据）：PERF-1 把 6 条路由**全部** lazy 之后，在新量具上做 PRE/POST A/B 发现：
 *   · first-paint 基本持平（344 → 352 ms）；
 *   · 但 **`#query` 可见**（冷启动到可交互）一致地 **1197 → 1550 ms（+约 370 ms）**，两批分布与改前**几乎不重叠**
 *     ⇒ **不是噪声**。
 *   机制：`#query` 在**本页**里，而它当时是独立 chunk ⇒ 必须等主 bundle 执行完 → React 挂载 → Suspense
 *   再去取第二个 chunk ⇒ **首屏多了一次往返**。懒加载把成本从**体积**换成了**往返**，
 *   而**落地页在关键路径上**，正是"不该多这一次往返"的那一个；其余 5 条路由不在首屏路径上，拆出去才是净收益。
 *
 * ⚠️ 因此规则升级为：**落地页静态、其余按需**（不再是"全部 lazy"）。
 *   同时**必须**遵守 BUILD-2 的教训 —— **一个模块只能走一条腿**：
 *   本页既然走静态，`main.tsx` 的 `ROUTE_PAGES` 就必须把它**移出去**（并入 `STATIC_PAGES`），
 *   否则"动态+静态"会把 BUILD-2 修掉的 19 条警告带回来。
 */
import SearchPage from '../pages/SearchPage.tsx';

/**
 * 其余 5 条路由 → **按需加载器**（模块形状只需有 `default` 导出）。
 *
 * ⚠️ 不能用 `import.meta.glob('./pages/*.tsx')` 一把抓：pages/ 下还有**不是路由**的页面，
 *    被别处静态导入（LibraryGate ← App、FirstRunWizard ← LibraryGate、AppHealthPanel ← DiagnosticsPage）
 *    ⇒ 纳入动态 glob 会造出"动态+静态"，正是 BUILD-2 修掉的警告。所以这里**逐个列出路由页**。
 *    ⚠️ 新增路由页时要**同时**改这里与本文件的断言；`ROUTES` 与它的对应关系由下面的启动期断言兜住。
 */
const LOADERS = {
  item: () => import('../pages/ItemPage.tsx'),
  tasks: () => import('../pages/TasksPage.tsx'),
  activity: () => import('../pages/ActivityPage.tsx'),
  health: () => import('../pages/DiagnosticsPage.tsx'),
  browse: () => import('../pages/BrowsePage.tsx'),
  settings: () => import('../pages/SettingsPage.tsx'),
} satisfies Record<string, () => Promise<unknown>>;

/**
 * 路由 key → 组件。**唯二的来源都在这里**：落地页是静态组件，其余是 `React.lazy`。
 * （`lazy(...)` **只在模块顶层建一次**：每次 render 新建会让 React 重挂载整棵子树。）
 */
const PAGES = {
  search: SearchPage, // ← 静态：落地页，见上面的长注释
  item: lazy(LOADERS.item),
  tasks: lazy(LOADERS.tasks),
  activity: lazy(LOADERS.activity),
  health: lazy(LOADERS.health),
  browse: lazy(LOADERS.browse),
  settings: lazy(LOADERS.settings),
};

// 启动期断言：表里有 key 却没有组件 ⇒ 立刻炸，别留白屏
// （PERF-1 时断的是 LOADERS 的 `function`；PERF-2 之后映射表是 `PAGES`，里面**静态组件与 lazy 混装**，
//  所以判据改成"这个 key 在不在映射表里" —— 查的仍是同一件事：路由表与组件表对不上就当场炸。
//  另外 PAGES 是字面量，`tsc` 在编译期已经保证 6 个 key 齐全，这条断言是运行期的兜底。）
const missing = ROUTES.filter((r) => !(r.key in PAGES)).map((r) => r.key);
if (missing.length) {
  throw new Error(
    `路由表里的这些 key 没有对应组件（router/index.tsx 的 PAGES）：${missing.join(', ')}`,
  );
}

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

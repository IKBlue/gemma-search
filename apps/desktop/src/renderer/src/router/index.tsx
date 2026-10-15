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
import { createHashRouter, RouterProvider, Navigate } from 'react-router';

import { ROUTES } from './paths.ts';
import SearchPage from '../pages/SearchPage.tsx';
import ItemPage from '../pages/ItemPage.tsx';
import TasksPage from '../pages/TasksPage.tsx';
import ActivityPage from '../pages/ActivityPage.tsx';
import DiagnosticsPage from '../pages/DiagnosticsPage.tsx';
import BrowsePage from '../pages/BrowsePage.tsx';

/** 路由 key → 组件。key 来自 `paths.ts`，两边必须一一对应 */
const COMPONENTS = {
  search: SearchPage,
  item: ItemPage,
  tasks: TasksPage,
  activity: ActivityPage,
  health: DiagnosticsPage,
  browse: BrowsePage,
};

// 启动期断言：表里有 key 却没有组件 ⇒ 立刻炸，别留白屏
const missing = ROUTES.filter((r) => typeof COMPONENTS[r.key] !== 'function').map((r) => r.key);
if (missing.length) {
  throw new Error(
    `路由表里的这些 key 没有对应组件（router/index.tsx 的 COMPONENTS）：${missing.join(', ')}`,
  );
}

export const router = createHashRouter([
  ...ROUTES.map((r) => ({ path: r.path, Component: COMPONENTS[r.key] })),
  // 未知 hash ⇒ 回搜索页（而不是白屏）。用户手改地址栏或旧书签都会走到这里。
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}

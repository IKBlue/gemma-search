// src/renderer/src/main.tsx —— 渲染进程入口（React）
//
// 视觉唯一来源：`packages/design-tokens/tokens.css`（tokens.css 的可执行版本 +
// §2.5 补齐的字号/布局/控件变量）。渲染层样式表 renderer.css **只消费 var(--…)**，
// 不再整张引入原型的 style.css —— 那份里的间距/字号是裸 px，不在 §4.1 的 4pt 阶梯上，
// 而 §4.1 要求接入时就近取整。
//
// 两条硬规矩（`SPEC.md` §6 非功能）：引擎返回的一切按纯文本渲染；不用 dangerouslySetInnerHTML。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { version as reactVersion } from 'react';
import type { ComponentType, ReactNode } from 'react';

import '../../../../../packages/design-tokens/tokens.css';
// 生成层（Tailwind v4，2026-10-13 T3）—— 必须在手写层**之前**：手写样式仍要能覆盖工具类，
// 这是迁移期的必要顺序（写反会让现有外观被工具类意外改掉）。见 styles/tailwind.css 头注释。
import './styles/tailwind.css';
import './renderer.css';

import App from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('缺少挂载点 #root（见 src/renderer/index.html）');

/** 引擎/守卫通过 `window.__DSH_RENDER` 重挂载一个组件时的实参形状 */
type RenderArgs = [
  rel: string,
  container?: HTMLElement | null,
  props?: Record<string, unknown> | null,
];

/** 动态 import 回来的组件模块（只要求有 default 导出） */
type ComponentModule = { default?: ComponentType<Record<string, unknown>> };

declare global {
  interface Window {
    __DSH_RENDER?: (...args: RenderArgs) => Promise<RenderResult>;
    __DSH_ROOT?: { unmount: () => void; element: HTMLElement };
  }
}

type RenderResult =
  { ok: true; host: HTMLElement; unmount: () => void } | { ok: false; error: string };

/**
 * 按**源码相对路径**挂载一个渲染层组件（构建期由 Vite 的 import.meta.glob 收集）。
 *
 * 为什么需要它：**曾经有过的守卫脚本**（`verify_renderer_dom`，已于 2026-10-13 移除）验的是**构建产物**，
 * 而产物里所有组件都被打平成一个 bundle —— 守卫无法 `import('pages/LibraryGate.jsx')`。
 * 于是「首启向导」这类**分支界面**就没法被无人值守地测到（只能靠人眼看）。
 * 这个钩子让守卫能重挂载任意一页，从而覆盖那些分支。
 *
 * ⚠️ 它**必须用 bundle 里这一份 React 去 render**，不能让守卫自己 import 'react'：
 * 那样会存在两个 React 实例，钩子派发直接抛 "Minified React error #321"
 * （invalid hook call）。所以这里把 createRoot 一起封在钩子里，守卫只传路径与容器。
 *
 * 它**不是调试后门**：`glob` 的范围在构建期就固化（pages/ 下有哪些文件），
 * 传进来的路径取不到模块就返回 null；也没有暴露任何新能力 —— 渲染层本来就只有 window.api。
 */
// ⚠️ 2026-10-16（PERF-1）：这一组 glob 的 eager/非 eager **不是随手配的**，它必须与
//    `router/index.tsx` 的静态/动态导入**配对**。规则只有一条：
//
//        **同一个模块只能走一条腿 —— 要么静态，要么动态，不能两条腿都占。**
//
//    为什么：动态 + 静态同时存在时，Rollup 会逐条警告
//    「dynamically imported … but also statically imported … will not move module into another chunk」，
//    而那句话的真正含义是「**这个动态导入一点懒加载都没实现**」（模块已被静态那条腿钉进主 chunk）。
//    BUILD-2 就是因为两个 glob 都 eager 之外还"顺手"覆盖了全部 pages/ui，吃过 **19 条**这样的警告；
//    那次的做法是全部改 eager（承认它们都在主 chunk 里）；**本次 PERF-1 要把路由页真的拆出去**，
//    所以改成按"这条腿是谁"分组：
//
//      · **路由页（6 个）**：`router/index.tsx` 用 `React.lazy(() => import(...))` ⇒ 走**动态**
//        ⇒ 这里也必须**非 eager**（默认就是不 eager），才能被切进独立的 route chunk。
//        ⚠️ 刻意**逐个列出**而不是写 `./pages/*.tsx`：见下一条。
//      · **非路由页（LibraryGate / FirstRunWizard）**：被 `App` / `LibraryGate` **静态**导入
//        （本来就在主 chunk）⇒ 这里只能 eager，否则又变成"动态+静态"。
//      · **ui/*（10 个）**：被各页与 `search/*` 大量静态引用 ⇒ 同样只能 eager。
//
//    ⚠️ `pages/AppHealthPanel.tsx` **刻意不在任何 glob 里**：它是 `DiagnosticsPage` 内部的**面板**
//       （由诊断页静态导入），而诊断页本身是 lazy 的 ⇒ 它自然落在**诊断页那个 chunk** 里。
//       若把它 eager 进这里，会把它从"诊断页 chunk"拖进**主 chunk**（首屏变大）—— 得不偿失。
//       代价：`__DSH_RENDER` 不能再按路径挂载它（它本来也不是可路由页面）。这是**有意的最小能力缩减**，
//       已记在 PERF-1 证据的「耦合」一节。
//
//    ⇒ 只改一边的后果（两边必须同时改）：
//       · 只改 router → chunk 拆不出来（glob 仍 eager 把页面钉在主 chunk）；
//       · 只改本文件 → BUILD-2 修掉的 19 条警告原样回来。
const ROUTE_PAGES = import.meta.glob([
  './pages/SearchPage.tsx',
  './pages/ItemPage.tsx',
  './pages/TasksPage.tsx',
  './pages/ActivityPage.tsx',
  './pages/BrowsePage.tsx',
  './pages/DiagnosticsPage.tsx',
]);
const STATIC_PAGES = import.meta.glob(['./pages/LibraryGate.tsx', './pages/FirstRunWizard.tsx'], {
  eager: true,
});
const COMPONENTS = import.meta.glob('./ui/*.tsx', { eager: true });

window.__DSH_RENDER = async (rel, container, props): Promise<RenderResult> => {
  const key = './' + String(rel || '').replace(/^\.?\//, '');
  // 两种形态并存（见上面 glob 的分组注释）：
  //   · eager（STATIC_PAGES / COMPONENTS）⇒ 拿到的**就是模块对象**；
  //   · 非 eager（ROUTE_PAGES）⇒ 拿到的是 `() => Promise<模块>`，要 await。
  // 外层仍然 async（签名与调用方不变）。
  let mod = (STATIC_PAGES[key] || COMPONENTS[key]) as ComponentModule | undefined;
  if (!mod) {
    const load = ROUTE_PAGES[key] as (() => Promise<ComponentModule>) | undefined;
    if (!load) return { ok: false, error: `没有这个组件：${key}` };
    mod = await load();
  }
  if (!mod.default) return { ok: false, error: `${key} 没有 default 导出` };
  const host = container || document.createElement('div');
  const r = createRoot(host);
  const Cmp = mod.default;
  const p = (props || {}) as Record<string, unknown>;
  r.render(<Cmp {...p} />);
  return {
    ok: true,
    host,
    unmount: () => {
      r.unmount();
      if (!container) host.remove();
    },
  };
};

/** 卸载应用本体并把它挂载用的容器交出来 —— 供守卫「从零复现首启」（见上一段注释） */
window.__DSH_ROOT = { unmount: () => appRoot.unmount(), element: root };

const appRoot = createRoot(root);
appRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 渲染进程没有终端：主进程会把这里的 console 转发到 data/_app.log，
// 所以这行是「界面真的起来了」的可核对证据。
console.log(`[ui] React 已挂载 · react ${reactVersion}`);

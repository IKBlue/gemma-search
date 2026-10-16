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
 * 为什么需要它：`tools/verify_renderer_dom.mjs` 验的是**构建产物**，
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
// ⚠️ 2026-10-16（BUILD-2 / 构建警告 19 → 0）：这两个 glob 必须 `{ eager: true }`。
//
// 【为什么】（不是"为了消警告"的取巧，是**把已经存在的事实写成显式**）
//   不带 eager 时，`import.meta.glob` 生成的是**动态 import** ⇒ `pages/*.tsx` 与 `ui/*.tsx`
//   每一个都成了"动态导入"。而它们**同时又都被静态导入**（`router/index.tsx` 引 4 个页面、
//   `LibraryGate` 引向导、`App`/`Sidebar` 引其余，`ui/*` 被各页与 `search/*` 大量静态引用）
//   ⇒ Rollup 逐条警告「dynamically imported … but also statically imported … will not move module
//   into another chunk」**19 条**（= pages 9 + ui 10，正好是这两个目录的全部文件）。
//
//   ⚠️ 关键：这条警告断言的正是「**那个动态导入一点懒加载都没实现**」—— 模块本来就在主 chunk 里。
//   ⇒ 所以这里**没有**"该不该 lazy"的可选空间：只要它们仍被静态导入（而那是必须的——路由/布局
//   本来就静态引用它们），它们就**不可能**被拆成独立 chunk。想真 lazy 就得删掉那些静态导入，
//   那会改变 `Suspense` 边界与首屏顺序 —— 本卡明令不许。
//   ⇒ 逐个决定的结果：**19/19 都应当 eager**，不存在需要保留 lazy 的那一条。
//   ⇒ 用 eager 把这件事写成显式：产物**不增反微降**（实测 renderer JS：
//      1,249,310 B → 1,245,068 B，−4,242 B ≈ −0.34% —— 省掉的是那层 import() 包装机器；
//      main / preload 两段**逐字节不变**）⇒ 首屏不会变大，也没有新的模块被拉进主 chunk。
//
// ⚠️ 别改回不 eager：那样警告会**全部回来**（能红探针见 reports/2026-10-15-wave3/build2.txt）。
const PAGES = import.meta.glob('./pages/*.tsx', { eager: true });
const COMPONENTS = import.meta.glob('./ui/*.tsx', { eager: true });

window.__DSH_RENDER = async (rel, container, props): Promise<RenderResult> => {
  const key = './' + String(rel || '').replace(/^\.?\//, '');
  // eager glob ⇒ 这里是**模块对象本身**（不再是 () => Promise）。外层仍保持 async：
  // 签名与调用方（window.__DSH_RENDER 的守卫）不变，只是少了一次必然立即 resolve 的 await。
  const mod = (PAGES[key] || COMPONENTS[key]) as ComponentModule | undefined;
  if (!mod) return { ok: false, error: `没有这个组件：${key}` };
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

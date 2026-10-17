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

import '../../../../../packages/design-tokens/tokens.css';
// 生成层（Tailwind v4，2026-10-13 T3）—— 必须在手写层**之前**：手写样式仍要能覆盖工具类，
// 这是迁移期的必要顺序（写反会让现有外观被工具类意外改掉）。见 styles/tailwind.css 头注释。
import './styles/tailwind.css';
import './renderer.css';

import App from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('缺少挂载点 #root（见 src/renderer/index.html）');

// ⚠️ 2026-10-17（U33 · 所有者决定）：这里原有 `window.__DSH_RENDER` / `window.__DSH_ROOT` 两个钩子
//    + 三组 `import.meta.glob`（ROUTE_PAGES / STATIC_PAGES / COMPONENTS）+ `ImportMeta.glob` 环境声明。
//    它们**只为那两个钩子服务**：钩子让一个**已删除**的 DOM 守卫（`tools/verify_renderer_dom.mjs`，
//    2026-10-13 移除）能在构建产物里重挂载任意一页（产物里组件被打平，守卫无法按路径 import）。
//    守卫删掉后**全仓零消费者** ⇒ 按「零消费者就删掉、不留悬挂引用」的决定**一并删除**。
//    ⚠️ 连带后果如实记：「**一个模块只能走一条腿**」（同一模块不能既静态导入又动态导入，否则 Rollup
//    警告"动态导入一点懒加载都没实现"）这条规则与页面的静态/动态分组，**唯一维护点现在是
//    `router/index.tsx`**（PERF-1/PERF-2 的长注释在那里）。本次删除**不改变**任何页面的腿：
//    路由页仍由 router 的 `LOADERS` 动态导入，落地页 SearchPage 仍静态导入。
const appRoot = createRoot(root);
appRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 渲染进程没有终端：主进程会把这里的 console 转发到 data/_app.log，
// 所以这行是「界面真的起来了」的可核对证据。
console.log(`[ui] React 已挂载 · react ${reactVersion}`);

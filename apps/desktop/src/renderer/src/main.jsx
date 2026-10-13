// src/renderer/src/main.jsx —— 渲染进程入口（React）
//
// 视觉唯一来源：`packages/design-tokens/tokens.css`（DESIGN-tokens.md §10 的可执行版本 +
// §2.5 补齐的字号/布局/控件变量）。渲染层样式表 renderer.css **只消费 var(--…)**，
// 不再整张引入原型的 style.css —— 那份里的间距/字号是裸 px，不在 §4.1 的 4pt 阶梯上，
// 而 §4.1 要求接入时就近取整。
//
// 两条硬规矩（SPEC-security §6）：引擎返回的一切按纯文本渲染；不用 dangerouslySetInnerHTML。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { version as reactVersion } from 'react'

import '../../../../../packages/design-tokens/tokens.css'
// 生成层（Tailwind v4，2026-10-13 T3）—— 必须在手写层**之前**：手写样式仍要能覆盖工具类，
// 这是迁移期的必要顺序（写反会让现有外观被工具类意外改掉）。见 styles/tailwind.css 头注释。
import './styles/tailwind.css'
import './renderer.css'

import App from './App.jsx'

const root = document.getElementById('root')
if (!root) throw new Error('缺少挂载点 #root（见 src/renderer/index.html）')

/**
 * 按**源码相对路径**挂载一个渲染层组件（构建期由 Vite 的 import.meta.glob 收集）。
 *
 * 为什么需要它：`tools/verify_renderer_dom.mjs` 验的是**构建产物**，
 * 而产物里所有组件都被打平成一个 bundle —— 守卫无法 `import('pages/LibraryGate.jsx')`。
 * 于是"首启向导"这类**分支界面**就没法被无人值守地测到（只能靠人眼看）。
 * 这个钩子让守卫能重挂载任意一页，从而覆盖那些分支。
 *
 * ⚠️ 它**必须用 bundle 里这一份 React 去 render**，不能让守卫自己 import 'react'：
 * 那样会存在两个 React 实例，钩子派发直接抛 "Minified React error #321"
 * （invalid hook call）。所以这里把 createRoot 一起封在钩子里，守卫只传路径与容器。
 *
 * 它**不是调试后门**：`glob` 的范围在构建期就固化（pages/ 下有哪些文件），
 * 传进来的路径取不到模块就返回 null；也没有暴露任何新能力 —— 渲染层本来就只有 window.api。
 */
const PAGES = import.meta.glob('./pages/*.jsx')
const COMPONENTS = import.meta.glob('./ui/*.jsx')

window.__DSH_RENDER = async (rel, container, props) => {
  const key = './' + String(rel || '').replace(/^\.?\//, '')
  const loader = PAGES[key] || COMPONENTS[key]
  if (!loader) return { ok: false, error: `没有这个组件：${key}` }
  const mod = await loader()
  if (!mod || !mod.default) return { ok: false, error: `${key} 没有 default 导出` }
  const host = container || document.createElement('div')
  const r = createRoot(host)
  r.render(<mod.default {...(props || {})} />)
  return { ok: true, host, unmount: () => { r.unmount(); if (!container) host.remove() } }
}

/** 卸载应用本体并把它挂载用的容器交出来 —— 供守卫"从零复现首启"（见上一段注释） */
window.__DSH_ROOT = { unmount: () => appRoot.unmount(), element: root }

const appRoot = createRoot(root)
appRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 渲染进程没有终端：主进程会把这里的 console 转发到 data/_app.log，
// 所以这行是"界面真的起来了"的可核对证据。
console.log(`[ui] React 已挂载 · react ${reactVersion}`)

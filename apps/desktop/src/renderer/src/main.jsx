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
import './renderer.css'

import App from './App.jsx'

const root = document.getElementById('root')
if (!root) throw new Error('缺少挂载点 #root（见 src/renderer/index.html）')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 渲染进程没有终端：主进程会把这里的 console 转发到 data/_app.log，
// 所以这行是"界面真的起来了"的可核对证据。
console.log(`[ui] React 已挂载 · react ${reactVersion}`)

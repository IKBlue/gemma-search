// utils/useDocumentTitle.ts —— 把当前页面名字写进窗口标题（Operation 层里最薄的那种"编排"）
//
// ── 为什么需要它（2026-10-13，T2 的人工核对发现的观感缺口）──────────────
//   多页应用里，"我现在在哪一页"应当反映在**窗口标题**上（任务栏、Alt+Tab、任务管理器都看它）。
//   而本应用此前 `document.title` **从头到尾不变** —— `index.html` 与主进程建窗时各硬编码了一份
//   `gemma-search · 素材库语义检索`，切到「索引任务」后窗口还写着"语义检索"。
//   实测证据：连点 3 条路由，`document.title` 的取值集合只有 **1** 个（`data/_t2-verify.mjs` 的输出）。
//
// ⚠️ 为什么做成 hook 而不是塞进路由：react-router 要读 `handle` 得先把路由改成"根布局 + Outlet"
//   的结构；那是一次更大的改动，而收益相同。这里 3 个页面各调一行，**实现只有一份**（不是 P2 的复制）。
//
// ⚠️ 应用名（后缀）与页面名（前缀）**都来自 `router/paths.ts`** —— 别在这里再写一遍字面量。
import { useEffect } from 'react'

import { APP_NAME } from '../router/paths.ts'

/**
 * @param pageLabel 当前页面名字；缺省则只显示应用名
 */
export function useDocumentTitle(pageLabel?: string): void {
  useEffect(() => {
    document.title = pageLabel ? `${pageLabel} · ${APP_NAME}` : APP_NAME
  }, [pageLabel])
}

export default useDocumentTitle

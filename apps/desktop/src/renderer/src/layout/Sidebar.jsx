// Sidebar —— 左侧栏（原型：.sidebar）
//
// 只提供结构与通用零件（品牌 / 分组标题 / 导航 / 底部说明），
// 具体内容由页面组合 —— 这样「索引任务」「操作记录」页可以复用同一套外壳。
import { NavLink } from 'react-router'

import { cn } from '../ui/cn.js'

export function Brand({ logo = 'G', name = 'Gemma Search', sub = 'LOCAL IMAGE INTELLIGENCE' }) {
  return (
    <div className="brand">
      <div className="logo">{logo}</div>
      <div>
        <div className="brand-name">{name}</div>
        <div className="brand-sub">{sub}</div>
      </div>
    </div>
  )
}

export function NavLabel({ children }) {
  return <div className="nav-label">{children}</div>
}

export function Nav({ children }) {
  return <nav className="nav">{children}</nav>
}

/**
 * 导航项。
 *   · 给了 `to` ⇒ 渲染成路由链接（`NavLink` 自己管 active 状态，地址栏会跟着变）
 *   · 没给 `to` ⇒ 保持原样：`href="#"` + `onClick`（未实现的项走 toast，**不假装有页面**）
 *
 * 为什么要分两种：2026-10-13 起应用是**多页**的（`router/paths.js`），
 * 已实现的页面必须能真的导航过去；没实现的项仍然如实 disabled + title 说明阶段。
 */
export function NavItem({ icon, children, active = false, disabled = false, title, to, onClick }) {
  if (to && !disabled) {
    return (
      <NavLink
        to={to}
        // `aria-current="page"` 由 **NavLink 自己**加（react-router 的既有行为）——
        // 这正是"当前在哪一页"的正确语义（不是 `aria-pressed`，那是切换按钮）。
        // 它由 E2E 的 `a11y.spec.mjs` 在真窗口里断言，别在这里手写一个。
        className={({ isActive }) => cn(active || isActive, false) || undefined}
        title={title}
      >
        <span className="ico" aria-hidden="true">{icon}</span>
        <span>{children}</span>
      </NavLink>
    )
  }
  return (
    <a
      href="#"
      className={cn(active && 'active', disabled && 'disabled')}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={(e) => { e.preventDefault(); if (!disabled && onClick) onClick() }}
    >
      <span className="ico" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </a>
  )
}

export function SideNote({ children }) {
  return <div className="side-note">{children}</div>
}

export default function Sidebar({ children }) {
  return <aside className="sidebar">{children}</aside>
}

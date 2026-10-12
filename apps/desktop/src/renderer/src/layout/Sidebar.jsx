// Sidebar —— 左侧栏（原型：.sidebar）
//
// 只提供结构与通用零件（品牌 / 分组标题 / 导航 / 底部说明），
// 具体内容由页面组合 —— 这样「索引任务」「操作记录」页可以复用同一套外壳。
import cx from '../ui/cx.js'

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

/** 导航项。当前只有「语义搜索」是实现了的，其余给 disabled + title 说明（不假装有页面） */
export function NavItem({ icon, children, active = false, disabled = false, title, onClick }) {
  return (
    <a
      href="#"
      className={cx(active && 'active', disabled && 'disabled')}
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

// AppShell —— 应用外壳：侧栏 + 主工作区（原型：.app > .sidebar + .main）
import type { ReactNode } from 'react'

export type AppShellProps = { sidebar?: ReactNode; children?: ReactNode }

export default function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="app">
      {sidebar}
      {children}
    </div>
  )
}

// AppShell —— 应用外壳：侧栏 + 主工作区（原型：.app > .sidebar + .main）
export default function AppShell({ sidebar, children }) {
  return (
    <div className="app">
      {sidebar}
      {children}
    </div>
  )
}

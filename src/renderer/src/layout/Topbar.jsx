// Topbar —— 顶栏（原型：.topbar > .crumb + .top-actions）
export default function Topbar({ crumb, actions }) {
  return (
    <header className="topbar">
      <div className="crumb">{crumb}</div>
      {actions ? <div className="top-actions">{actions}</div> : null}
    </header>
  )
}

// PageHead —— 页面标题区（原型：.page-head > .eyebrow / h1 / .subtitle / .head-buttons）
export default function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="head-buttons">{actions}</div> : null}
    </div>
  )
}

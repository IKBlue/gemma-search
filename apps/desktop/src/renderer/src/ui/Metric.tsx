// Metric —— 指标卡（原型：.metric > .metric-top / .metric-value / .metric-note）
//
// 视觉值全部走类（renderer.css 消费令牌）：数值默认用 --type-metric，
// 文字型数值用 variant="text"（--type-lede）——**组件里不写字号**。
// 图标是装饰性的，按 §9 加 aria-hidden。
import type { ReactNode } from 'react'

export type MetricProps = {
  label: ReactNode
  icon?: ReactNode
  value: ReactNode
  note?: ReactNode
  /** 'text' ⇒ 数值走 --type-lede（文字型指标） */
  variant?: 'text'
  good?: boolean
}

export default function Metric({ label, icon, value, note, variant, good = false }: MetricProps) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        {icon ? <span className="metric-icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className={variant === 'text' ? 'metric-value text' : 'metric-value'}>{value}</div>
      {note ? <div className={good ? 'metric-note good' : 'metric-note'}>{note}</div> : null}
    </div>
  )
}

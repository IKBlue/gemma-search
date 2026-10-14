// Progress —— 进度条（原型：.progress > span）
//
// 宽度是**数据**（百分比），必须内联；但它是 width 而非视觉令牌值，
// 颜色等视觉值一律由 renderer.css 里的 .progress > span 决定（组件不写颜色）。
export type ProgressProps = { percent?: number | string | null }

export default function Progress({ percent = 0 }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0))
  return (
    <span className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}

// Score —— 分数徽标（原型：.score.same / .score.like / .score.weak + 文案「0.9396 · 同款区间 · 2.3 MB」）
export function bandOf(score) {
  const s = Number(score)
  if (s >= 0.97) return 'same'
  if (s >= 0.93) return 'like'
  return 'weak'
}

const BAND_TEXT = { same: '同款区间', like: '很接近', weak: '较弱' }

/** 把字节数写成人类可读（与原型示例里的 "2.3 MB" 一致） */
export function humanSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export default function Score({ score, size }) {
  const band = bandOf(score)
  const tail = [BAND_TEXT[band], humanSize(size)].filter(Boolean).join(' · ')
  return (
    <span className={`score ${band}`}>
      {Number(score).toFixed(4)}{tail ? ` · ${tail}` : ''}
    </span>
  )
}

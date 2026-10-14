// utils/format.ts —— 展示用的格式化（Operation 层里的 utils，纯函数）
//
// ⚠️ `humanSize` 原先定义在 `ui/Score.jsx` 里并导出。2026-10-13 移到本文件：
//   「把字节数写成人类可读」是**格式化工具**，不是 UI 组件（`AGENTS.md` §2 四层架构）。
//   当时只有 Score 自己用它，所以搬家没有波及面；**实现逐字保留**，避免出现两份。
//   ⇒ 别在别处再写一个 "MB/KB" 的换算（同一个概念两份实现 = P1 违反）。

/** 把字节数写成人类可读（与原型示例里的 "2.3 MB" 一致） */
export function humanSize(bytes: unknown): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * 时间戳 → 本地可读时间。
 * ⚠️ 只给**展示**用；任何"多久以前 / 是否过期"的判断都不要在这里做
 *   （那属于领域判断，见 `utils/index-state.ts` 的分工）。
 */
export function humanTime(ms: unknown): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Chip —— 筛选胶囊（**可切换按钮**：`aria-pressed`）
//
// ⚠️ 2026-10-13（T3 迁到 Tailwind；T4 补 `aria-pressed` + 改用 `cn()`）。
//
// ── T4 补的是什么：`aria-pressed` ────────────────────────────────────────
//   T3 时注释里写着"选中态仍用类名 `active`，改 `aria-pressed` 属无障碍改造、不属 T3"。
//   **T4 就是那次改造**：Chip 语义上是**切换按钮**（toggle button），所以正确做法是
//   `aria-pressed={active}` —— 屏幕阅读器会读成"已按下/未按下"，而 `<button class="active">`
//   对它是**完全不可见**的。类名只负责视觉，语义由 aria 承担，两者并存。
//   ⇒ 这条由 `npm test`（`a11y.test.mjs`）与 E2E 的 `E4-e` 一起钉住。
//
// ── 尺寸仍走令牌阶梯 ─────────────────────────────────────────────────
//   `rounded-pill` = `--radius-pill`（999px）· `px-4 py-2` = 16px/8px = `--control-chip-padding`
//   （`8px 16px`）· `min-h-8` = 32px。
//
// ⚠️ **修饰态写"互斥"而不是"叠加"** —— T3 迁移时真栽过：叠加式
//   （`cn(BASE, active && 'bg-ink')`）里两个工具类**同优先级**，谁生效只取决于产出 CSS 的顺序；
//   旧 CSS 的 `.chip.active` 是独立规则所以永远赢，迁到 Tailwind 后这个保证没了 ⇒ 实测"点筛选
//   胶囊底色不变"。现在虽然 `cn()` 的 `tailwind-merge` **能**按"后者胜"消解冲突（叠加式已安全），
//   但互斥写法**不依赖任何顺序假设**，更稳 ⇒ 保持互斥。
import { cn } from './cn.js'

const BASE = 'border rounded-pill px-4 py-2 min-h-8 text-caption'
const IDLE = 'bg-surface-raised border-line text-ink-muted hover:border-accent'
const ACTIVE = 'bg-ink border-ink text-surface-raised'

export default function Chip({ active = false, onClick, children, className, ...rest }) {
  return (
    <button
      type="button"
      // 语义：这是**切换按钮**，不是"当前页"（那才是 aria-current）
      aria-pressed={active}
      className={cn(BASE, active ? ACTIVE : IDLE, className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}

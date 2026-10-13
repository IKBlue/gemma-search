// Button —— 按钮原语（shadcn/ui 的 `cva` 写法）
//
// ⚠️ 2026-10-13（T3 迁到 Tailwind；T4 改成 `cva` + `cn()`）。两点必须知道：
//
// ① **类名里的数字不是"随便挑的"** —— Tailwind 的数值档与设计令牌**恒等**：
//    `styles/tailwind.css` 里 `--spacing: var(--space-1)` ⇒ `N` 档 = `calc(var(--space-1) * N)` = 4px×N。
//    所以：`px-3` = 12px = `--space-3` · `py-2` = 8px = `--space-2` · `min-h-11` = 44px = `--touch-min`
//    · `w-9`/`h-9` = 36px = `--control-icon-btn` · `min-h-8` = 32px。
//    ⇒ **不要**换成任意值（`px-[11px]`），那会脱离令牌阶梯。
//    ⚠️ **改动本文件后必须跑 `npm run e2e`** —— `styles.spec.mjs` 的 E4-a/b/c 用真窗口的
//    `getComputedStyle` 断言这些值仍等于对应令牌；它是这次改写的安全网。
//
// ② `variant="outline-accent"` 取代了原先的上下文覆盖 `.card-acts .btn.pri`
//    （结果卡里的"定位"按钮）。用后代选择器表达"某容器里的按钮长这样"正是迁移要消灭的东西 ——
//    它让按钮的样子取决于**它在哪**，而不是**它是什么**。
//
// ③ **`cva` 而不是手写三元**（2026-10-13 T4）：变体是**声明式**的，新增变体只改一处；
//    而且 `cn()`（clsx + tailwind-merge）会**按冲突组消解**，所以 `className` 永远能覆盖默认样式 ——
//    这点比手写拼接可靠（手写拼接时两个同组工具类会同时留下，谁赢取决于 CSS 顺序）。
import { cva } from 'class-variance-authority'

import { cn } from './cn.js'

const button = cva('inline-flex items-center disabled:opacity-50 disabled:cursor-default', {
  variants: {
    variant: {
      default: 'gap-2 border rounded-xs font-semibold border-line bg-surface-raised text-ink hover:border-accent',
      primary: 'gap-2 border rounded-xs font-semibold bg-accent border-accent text-on-accent',
      'outline-accent': 'gap-2 border rounded-xs font-semibold border-accent text-accent',
      // 图标按钮：固定方形，**不参与 size 档**（原 `.icon-btn` 也没有 padding/min-height）
      icon: 'w-9 h-9 justify-center border border-line bg-surface-raised rounded-control text-caption text-ink-muted hover:border-accent hover:text-ink',
    },
    size: {
      none: '',
      md: 'px-3 py-2 min-h-11 text-caption',
      sm: 'px-2 py-1 min-h-8 text-caption font-medium',
    },
    block: { true: 'w-full', false: '' },
  },
  defaultVariants: { variant: 'default', size: 'md', block: false },
})

export default function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  block = false,
  children,
  ...rest
}) {
  // icon 变体自带尺寸，忽略 size（显式表达，别靠"后面的类覆盖前面的"）
  const resolvedSize = variant === 'icon' ? 'none' : size
  return (
    <button type={type} className={cn(button({ variant, size: resolvedSize, block }), className)} {...rest}>
      {children}
    </button>
  )
}

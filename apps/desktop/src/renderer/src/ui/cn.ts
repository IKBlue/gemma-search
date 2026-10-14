// cn —— class 合并（**全应用唯一一份**）
//
// ⚠️ 2026-10-13（T4）：本文件**取代**了 `ui/cx.js`（那个 4 行的「极小合并」，已删除）。
// 同一件事不留两份实现 —— 这是 `TODO.md` A-4 的收口，也是 P1 的最后一条。
//
// ── 为什么不能只留 `clsx`，为什么需要 `tailwind-merge` ────────────────────
// `clsx` 只会**拼接**：`clsx('px-3', 'px-2')` → `'px-3 px-2'`，两个类都在。
// 而 Tailwind 的工具类**优先级相同** ⇒ 谁生效只取决于它们在产出 CSS 里的**顺序**，
// 跟类名写在后面没关系。**T3 迁移时真栽在这上面**：Chip 的选中态写成叠加式
// （`cx(BASE, active && 'bg-ink')`），结果点筛选胶囊底色不变 —— 因为 `.bg-surface-raised`
// 在产物里排在 `.bg-ink` 之后。当时是靠互斥写法绕开的。
// `twMerge` 会**按冲突组消解、保留最后一个** ⇒ `cn('px-3', 'px-2')` → `'px-2'`。
//
// ── ⚠️⚠️ 必须 `extendTailwindMerge`：不然它会把我们的**字号**当**颜色**吃掉 ──────
// 这是 T4 真实踩到的坑（E2E `styles.spec.mjs` 的 E4-a/b/d 抓到）：
//   twMerge 的默认配置里，`text-*` 分两组 —— `font-size` 只认**内置档位**（t-shirt size 之类），
//   其余 `text-<任意>` 落到 `text-color` 的**通配**组。而我们用的是**自定义字号名**
//   （`text-caption` / `text-h1` / `text-title2`…，由 `@theme` 的 `--text-*` 生成）。
//   ⇒ twMerge 以为 `text-caption` 是个**颜色**，于是 `cn('text-caption', 'text-ink')` 判定两者冲突，
//     **丢掉前一个** ⇒ 字号静默消失。
//   症状极具误导性：构建通过、页面不白屏，只有**真窗口里量计算样式**才看得出来。
//   ⇒ 所以下面把 `--text-*` 那 8 个名字显式登记进 `font-size` 组。
//
// ⚠️ **加新字号档时，必须同时加到下面这个清单里**，否则它会被当成颜色而被合并掉。
//    `apps/desktop/tests/styles.test.mjs` 的 **T5/T6** 会钉住这件事（对 8 个档位逐个断言「两者都在」）。
//
// ── 用法 ─────────────────────────────────────────────────────────────
//   cn('base', cond && 'x', props.className)
// 传进来的 `className` 放最后 ⇒ 调用方永远能覆盖组件默认样式（这正是 twMerge 要解决的场景）。
import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** 来自 `styles/tailwind.css` 的 `@theme { --text-* }` —— 与那里保持一一对应 */
export const TEXT_SIZES = ['h1', 'title2', 'metric', 'lede', 'body', 'callout', 'caption', 'micro']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // 告诉 twMerge：这些也是**字号**，不是颜色
      'font-size': [{ text: TEXT_SIZES }],
    },
  },
})

/**
 * @param inputs `clsx` 接受的任何东西（字符串 / 条件 / 数组 / 对象）
 * @returns 合并后的 class 串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export default cn

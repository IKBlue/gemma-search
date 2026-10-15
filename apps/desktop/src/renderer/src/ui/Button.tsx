// Button —— 按钮原语（shadcn/ui 的 `cva` 写法）
//
// ⚠️ 2026-10-13（T3 迁到 Tailwind；T4 改成 `cva` + `cn()`；同日 `asChild` —— 见下）。三点必须知道：
//
// ① **类名里的数字不是「随便挑的」** —— Tailwind 的数值档与设计令牌**恒等**：
//    `styles/tailwind.css` 里 `--spacing: var(--space-1)` ⇒ `N` 档 = `calc(var(--space-1) * N)` = 4px×N。
//    所以：`px-3` = 12px = `--space-3` · `py-2` = 8px = `--space-2` · `min-h-11` = 44px = `--touch-min`
//    · `w-9`/`h-9` = 36px = `--control-icon-btn` · `min-h-8` = 32px。
//    ⇒ **不要**换成任意值（`px-[11px]`），那会脱离令牌阶梯。
//    ⚠️ **改动本文件后必须跑 `npm run e2e`** —— `styles.spec.mjs` 的 E4-a/b/c 用真窗口的
//    `getComputedStyle` 断言这些值仍等于对应令牌；它是这次改写的安全网。
//
// ② `variant="outline-accent"` 取代了原先的上下文覆盖 `.card-acts .btn.pri`
//    （结果卡里的「定位」按钮）。用后代选择器表达「某容器里的按钮长这样」正是迁移要消灭的东西 ——
//    它让按钮的样子取决于**它在哪**，而不是**它是什么**。
//
// ③ ⭐ **`asChild`：把按钮样式用在别的东西上（尤其 `<Link>`）—— 这是必须的，不是便利**
//    没有它，想让一个链接长得像按钮就只能写成 `<Button><Link>…</Link></Button>`，
//    而那会产出 **`<a>` 嵌在 `<button>` 里**：
//      · **HTML 规范禁止**（交互内容不得嵌套交互内容）
//      · 可访问性坏掉：变成两个可聚焦元素，读屏会念成「按钮里有个链接」
//      · 视觉坏掉：图标按钮的内容不居中（T2 的 ItemPage/TasksPage 真出过这个问题，截图可见）
//    `asChild` 用 Radix 的 `Slot` **把 props 与 className 合并到子元素上** ⇒ 最终只渲染一个
//    `<a href="#/...">`，带着按钮的类名。语义正确、可聚焦元素只有一个、样式不走样。
//    ⚠️ `Slot` 要求子元素**恰好一个**（且能接受 className/ref）—— 恰好一个，不是零个也不是数组。
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from './cn.ts';
import type { ButtonHTMLAttributes } from './types.ts';

// ⚠️ P4-1（2026-10-15）：变量名与导出改成 shadcn 约定的 `buttonVariants`（其他文件可以用它把
//    按钮样式套到别的元素上），变体值本身**一个字没改** —— 见文件头：等比照抄 shadcn 的
//    secondary/destructive/h-9 会同时改视觉与既有 E2E 断言（44px 命中区是 HIG 要求）。
const buttonVariants = cva('inline-flex items-center disabled:opacity-50 disabled:cursor-default', {
  variants: {
    variant: {
      default:
        'gap-2 border rounded-xs font-semibold border-line bg-surface-raised text-ink hover:border-accent',
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
});

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

/**
 * 组件自己的属性全部可选（HTML 属性类型里有必填成员，见 `ui/types.ts` 的 `UiAttrs` 注释）。
 * `block` 与原生同名属性冲突，故先 Omit 再重声明。
 */
export type ButtonProps = Omit<Partial<ButtonHTMLAttributes<HTMLButtonElement>>, 'block'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  asChild?: boolean;
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  block = false,
  asChild = false,
  children,
  ...rest
}: ButtonProps) {
  // icon 变体自带尺寸，忽略 size（显式表达，别靠「后面的类覆盖前面的」）
  const resolvedSize: ButtonSize = variant === 'icon' ? 'none' : size;
  const cls = cn(buttonVariants({ variant, size: resolvedSize, block }), className);

  if (asChild) {
    // ⚠️ 统一包 radix-ui 的 Slot 是**命名空间对象**（{ Root, Slot, Slottable, … }），
    //    直接写 <Slot> 会触发 React #130（Element type is invalid … got: object）。
    //    2026-10-14 实测踩到过：a11y E5-b 打开任务页即白屏。
    return (
      <Slot.Root data-slot="button" className={cls} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button type={type} data-slot="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

// shadcn 约定：导出具名的 variants 工厂（其他组件/页面可以拿它把按钮样式套到 <a>/<Link> 上）
export { buttonVariants };
export default Button;

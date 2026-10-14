// Field —— 原生控件包一层（原型：.field，用于排序下拉）
//
// 2026-10-14 转 TSX：`as` 是**多态**的（select / input 都可能），所以用泛型把
// 「渲染成哪个元素」与「该元素的属性类型」绑在一起 —— 否则 `value`/`onChange` 收不到类型。
// ⚠️ 实现里把 `as` 存进大写开头的局部变量（`const Comp = as`）：小写开头的变量在 JSX 里
//    会被当成 HTML 标签名，**多态写法会静默变成字符串标签**。
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

export type FieldProps<T extends ElementType> = {
  as?: T
  className?: string
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

export default function Field<T extends ElementType = 'select'>({
  as,
  className,
  children,
  ...rest
}: FieldProps<T>) {
  const Comp = (as ?? 'select') as ElementType
  return (
    <Comp className={['field', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Comp>
  )
}

// Button —— 按钮原语（类名沿用原型：.btn / .btn.primary / .icon-btn）
//
// variant: default（.btn）· primary（.btn.primary）· icon（.icon-btn，顶栏小按钮）
import cx from './cx.js'

export default function Button({
  variant = 'default',
  className,
  type = 'button',
  block = false,
  children,
  ...rest
}) {
  const cls = variant === 'icon'
    ? cx('icon-btn', className)
    : cx('btn', variant === 'primary' && 'primary', block && 'wide', className)
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  )
}

// Toast —— 轻提示（原型：.toast + .show）
//
// 原型用 `show` 类控制显隐；这里保持同一套类名，动画/位置由 style.css 决定。
//
// ⚠️ 2026-10-13（Apple Style 审查 **V-16**）：原先是**恒 `role="status"` + `aria-live="polite"`**，
//    也就是「出错」和「成功」对读屏是同一种播报。出错是**断言性**信息，必须走 `alert` / `assertive`。
//    同一条缺陷的另一半是「错误也 2.6 秒自动消失」，那在 `hooks/useToast.js` 里改。
//    判据出处：W3C **WCAG 2.2 SC 4.1.3** Status Messages；HIG › **Feedback**
//    （错误需要用户明确知晓，不能与普通提示同等对待）。
export type ToastProps = { message?: string; tone?: string }

export default function Toast({ message, tone = 'info' }: ToastProps) {
  const isErr = tone === 'err'
  return (
    <div
      className={message ? `toast show${isErr ? ' err' : ''}` : 'toast'}
      id="toast"
      role={isErr ? 'alert' : 'status'}
      aria-live={isErr ? 'assertive' : 'polite'}
    >
      {message}
    </div>
  )
}

// Toast —— 轻提示（原型：.toast + .show）
//
// 原型用 `show` 类控制显隐；这里保持同一套类名，动画/位置由 style.css 决定。
export default function Toast({ message, tone = 'info' }) {
  return (
    <div className={message ? `toast show${tone === 'err' ? ' err' : ''}` : 'toast'} id="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}

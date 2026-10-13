// ConfirmDialog —— 破坏性操作的确认弹窗（2026-10-13 T4）
//
// ── 为什么用 Radix 的 **AlertDialog** 而不是自己写个 overlay ────────────────
//   手写 overlay 最容易漏的恰恰是**无障碍里最难自己实现的那几件**：
//     · `role="alertdialog"` + `aria-modal`，且 `aria-labelledby`/`aria-describedby` 自动接上
//     · **焦点陷阱**（Tab 不会跑到背后的页面上）
//     · **打开时焦点自动落进弹窗**（不是落在背景）
//     · **ESC 关闭**
//     · 点遮罩**不**关闭（确认框不该被误关）
//   这些是 Radix 的既有行为 —— 正是"检索现有方案"该用到的地方（宪章第 1 条）。
//
// ── 为什么是 AlertDialog 而不是 Dialog ─────────────────────────────────
//   `AlertDialog` 语义上要求用户**明确回应**（不能点外面关掉、必须有 Action/Cancel），
//   正合"要不要真的执行这个破坏性操作"；`Dialog` 是通用对话框，可点遮罩关闭。
//
// ── 实测下来的真实行为（2026-10-13，E2E `confirm-dialog.spec.mjs` 在真窗口量的）──
//   · 打开后焦点落在 **「取消」**（不是「确认」）。这是**对的**：破坏性操作应当默认停在
//     **安全的那一侧** —— 照 macOS HIG 的破坏性确认惯例，误按 Enter 不该把文件搬走。
//     ⚠️ 别"顺手改成落在确认钮上"，那是把安全默认换成危险默认。
//   · 连按 6 次 Tab，焦点**始终在弹窗内**（陷阱生效）—— E7-b 实测。
//   · ESC 关闭，且此后**一个 `collect` IPC 都没发**（E7-c 实测）。
//
// ── ⚠️ 焦点归还必须自己写（这一条 Radix 帮不上）────────────────────────
//   第 8 行原本声称"Radix 会归还焦点"—— **在我们的用法下那是假的**。Radix 的归还依赖
//   `Dialog.Trigger` 记下的 `triggerRef`；而本组件的 `open` 是**受控**的、那个「取件」按钮
//   是个普通 `Button`（它调的是 store 的 `requestCollect`），**没有 Trigger** ⇒ 关闭后
//   Radix 把焦点落回 `document.body`，键盘/读屏用户就此"迷路"（E7-d 实测到 `activeElement === BODY`）。
//   为什么不让「取件」直接当 `Dialog.Trigger`？因为"该不该执行"这个**决策**刻意放在
//   Operation 层（`store/search.js` 的 pendingCollect 状态机）—— 唯有如此，
//   "取消 ⇒ 一个 IPC 都没发"才**可断言**（`search-store.test.mjs` Z13–Z15）。
//   代价就是这一段：**自己记住来源、关闭时还回去**。
//
// ── 分层 ──────────────────────────────────────────────────────────────
//   本文件是 **UI 层**（纯渲染 + 交互）—— 它**不含任何业务判断**：
//   "该不该执行、执行什么"由 Operation 层决定。
//
// ⚠️ 任意值说明：`max-w-dialog` = `--layout-dialog-width`（已在 tokens.css 登记来源）；
//    小屏用 `calc(100vw - var(--space-12))` 兜底 —— 仍然走令牌，没写死像素。
//    `z-40/50` 是**本图层内部**的层叠序（遮罩 < 内容），不跨层比较，故未上令牌。
import { useRef } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'

import Button from './Button.jsx'
import { cn } from './cn.js'

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
}) {
  /** 打开弹窗前，焦点在谁身上（就是那个「取件」按钮）—— 关闭时还回去 */
  const restoreRef = useRef(null)

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <AlertDialog.Content
          data-testid="confirm-dialog"
          // ⚠️ **必须在 `onOpenAutoFocus` 里记来源，不能用 `useEffect(…, [open])`。**
          //   实测教训：React 的 effect 是**子先父后** —— `AlertDialog.Content`（子）的挂载 effect
          //   已经把焦点移到「取消」了，父组件的 `useEffect` 才跑，于是抓到的是**弹窗里那个按钮**；
          //   关闭时它已卸载（`isConnected === false`）⇒ 不阻止 ⇒ 焦点落回 `body`。
          //   `onOpenAutoFocus` 是 Radix 在**移动焦点之前**的回调，此刻 `document.activeElement`
          //   仍是触发它的那个「取件」—— 这才是正确的取样时机。
          //   ⚠️ 这里**不** `preventDefault()`：我们**要** Radix 把焦点落进弹窗（落在「取消」上，见文件头）。
          onOpenAutoFocus={() => {
            const el = document.activeElement
            if (el && el !== document.body && typeof el.focus === 'function') restoreRef.current = el
          }}
          // 关闭时把焦点还给来源元素。
          // `preventDefault()` 是**必须的** —— 不阻止的话 Radix 会自己决定落点（本例落回 body）。
          // `isConnected` 判断是为了不还到一个已经被卸载的元素上（那样焦点会丢失）。
          onCloseAutoFocus={(event) => {
            const el = restoreRef.current
            if (el && el.isConnected) {
              event.preventDefault()
              el.focus()
            }
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-var(--space-12))] max-w-dialog rounded-panel border border-line',
            'bg-surface-raised p-6 shadow-raised',
          )}
        >
          <AlertDialog.Title className="text-title2 font-semibold text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-caption text-ink-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            {/* Cancel/Action 都用 `asChild` 让 Radix 把行为挂到我们自己的 Button 上 ——
                这样按钮的视觉只由 Button 决定，不会出现"弹窗里的按钮长得不一样" */}
            <AlertDialog.Cancel asChild>
              <Button>{cancelText}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={onConfirm}>{confirmText}</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

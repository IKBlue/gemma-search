// ConfirmDialog —— 破坏性操作的确认弹窗（2026-10-13 T4）
//
// ── 为什么用 Radix 的 **AlertDialog** 而不是自己写个 overlay ────────────────
//   手写 overlay 最容易漏的恰恰是**无障碍里最难自己实现的那几件**：
//     · `role="alertdialog"` + `aria-modal`，且 `aria-labelledby`/`aria-describedby` 自动接上
//     · **焦点陷阱**（Tab 不会跑到背后的页面上）
//     · **打开时焦点自动落在操作钮上**（不是落在背景）
//     · **ESC 关闭** · 关闭后**焦点归还**给触发元素
//     · 点遮罩**不**关闭（确认框不该被误关）
//   这些是 Radix 的既有行为 —— 正是"检索现有方案"该用到的地方（宪章第 1 条）。
//   `UI-REVIEW-and-migration.md` §1/§9 记的"焦点陷阱与 aria 缺失"就是缺口，本文件补它。
//
// ── 为什么是 AlertDialog 而不是 Dialog ─────────────────────────────────
//   `AlertDialog` 语义上要求用户**明确回应**（不能点外面关掉、必须有 Action/Cancel），
//   正合"要不要真的执行这个破坏性操作"；`Dialog` 是通用对话框，可用点遮罩关闭。
//
// ── 分层 ──────────────────────────────────────────────────────────────
//   本文件是 **UI 层**（纯渲染 + 交互）—— 它**不含任何业务判断**：
//   "该不该执行、执行什么"由 Operation 层（`store/search.js` 的 pendingCollect 状态机）决定。
//   ⇒ 所以"取消后动作未执行"能在 `npm test` 里被断言（不需要 DOM）。
//
// ⚠️ 任意值说明：`max-w-dialog` = `--layout-dialog-width`（已在 tokens.css 登记来源）；
//    小屏用 `calc(100vw - var(--space-12))` 兜底 —— 仍然走令牌，没写死像素。
//    `z-40/50` 是**本图层内部**的层叠序（遮罩 < 内容），不跨层比较，故未上令牌。
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
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <AlertDialog.Content
          data-testid="confirm-dialog"
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

// ConfirmDialog —— 破坏性操作的确认弹窗（2026-10-13 T4）
//
// ── 为什么用 Radix 的 **AlertDialog** 而不是自己写个 overlay ────────────────
//   手写 overlay 最容易漏的恰恰是**无障碍里最难自己实现的那几件**：
//     · `role="alertdialog"` + `aria-modal`，且 `aria-labelledby`/`aria-describedby` 自动接上
//     · **焦点陷阱**（Tab 不会跑到背后的页面上）
//     · **打开时焦点自动落进弹窗**（不是落在背景）
//     · **ESC 关闭**
//     · 点遮罩**不**关闭（确认框不该被误关）
//   这些是 Radix 的既有行为 —— 正是「检索现有方案」该用到的地方（宪章第 1 条）。
//
// ── 为什么是 AlertDialog 而不是 Dialog ─────────────────────────────────
//   `AlertDialog` 语义上要求用户**明确回应**（不能点外面关掉、必须有 Action/Cancel），
//   正合「要不要真的执行这个破坏性操作」；`Dialog` 是通用对话框，可点遮罩关闭。
//
// ── 实测下来的真实行为（2026-10-13，E2E `confirm-dialog.spec.mjs` 在真窗口量的）──
//   · 打开后焦点落在 **「取消」**（不是「确认」）。这是**对的**：破坏性操作应当默认停在
//     **安全的那一侧** —— 照 macOS HIG 的破坏性确认惯例，误按 Enter 不该把文件搬走。
//     ⚠️ 别「顺手改成落在确认钮上」，那是把安全默认换成危险默认。
//   · 连按 6 次 Tab，焦点**始终在弹窗内**（陷阱生效）—— E7-b 实测。
//   · ESC 关闭，且此后**一个 `collect` IPC 都没发**（E7-c 实测）。
//
// ── ⚠️ 焦点归还必须自己写（这一条 Radix 帮不上）────────────────────────
//   第 8 行原本声称「Radix 会归还焦点」—— **在我们的用法下那是假的**。Radix 的归还依赖
//   `Dialog.Trigger` 记下的 `triggerRef`；而本组件的 `open` 是**受控**的、那个「取件」按钮
//   是个普通 `Button`（它调的是 store 的 `requestCollect`），**没有 Trigger** ⇒ 关闭后
//   Radix 把焦点落回 `document.body`，键盘/读屏用户就此「迷路」（E7-d 实测到 `activeElement === BODY`）。
//   为什么不让「取件」直接当 `Dialog.Trigger`？因为「该不该执行」这个**决策**刻意放在
//   Operation 层（`store/search.js` 的 pendingCollect 状态机）—— 唯有如此，
//   「取消 ⇒ 一个 IPC 都没发」才**可断言**（`search-store.test.mjs` Z13–Z15）。
//   代价就是这一段：**自己记住来源、关闭时还回去**。
//
// ── 分层 ──────────────────────────────────────────────────────────────
//   本文件是 **UI 层**（纯渲染 + 交互）—— 它**不含任何业务判断**：
//   「该不该执行、执行什么」由 Operation 层决定。
//
// ⚠️ 任意值说明：`max-w-dialog` = `--layout-dialog-width`（已在 tokens.css 登记来源）；
//    小屏用 `calc(100vw - var(--space-12))` 兜底 —— 仍然走令牌，没写死像素。
//    `z-40/50` 是**本图层内部**的层叠序（遮罩 < 内容），不跨层比较，故未上令牌。
import { useEffect, useRef } from 'react';
import { AlertDialog } from 'radix-ui';

import Button from './Button.tsx';
import { cn } from './cn.ts';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
};

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
}: ConfirmDialogProps) {
  /** 打开弹窗前，焦点在谁身上（就是那个「取件」按钮）—— 关闭时还回去 */
  const restoreRef = useRef<HTMLElement | null>(null);
  /**
   * 最后一次**实际拿到焦点**的元素（全局跟踪）。
   *
   * ⚠️ 为什么需要这个兜底（2026-10-13 实测到的**偶发**，不是理论问题）：
   *   `onOpenAutoFocus` 里读 `document.activeElement` 是**对某一瞬间的一次采样**。
   *   全量 E2E（62 条、比之前重）跑起来后，E7-d 会**间歇**失败：那一刻 `activeElement`
   *   是 `BODY` ⇒ 什么都没存 ⇒ 关闭后焦点落回 body。单独跑该用例 3/3 全过 ⇒
   *   根因是**负载下 `mousedown`（聚焦按钮）与弹窗打开之间发生了重渲染**，把按钮换掉了。
   *   ⇒ 跟踪 `focusin` 相当于「记住用户上一次真的把焦点放在哪」，比单点采样稳，
   *     而且这是**真的无障碍改进**：键盘/读屏用户不该因为一次重渲染就丢失位置。
   */
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      // `focusin` 的 target 是 Document | Element：只有 HTMLElement 才可能能聚焦
      if (e.target instanceof HTMLElement) lastFocusedRef.current = e.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  /**
   * 挑出「焦点该还到哪」—— **候选链**，逐个要求**仍然连着 DOM**。
   *
   * ⚠️ 顺序不能反：`restoreRef`（打开那一瞬真的聚焦着的元素）优先于
   *   `lastFocusedRef`（全局最后聚焦的元素）。后者**会被 Radix 自己覆盖** ——
   *   焦点移进弹窗时又触发一次 `focusin`，于是它记的是弹窗里那个「取消」按钮；
   *   等关闭时那个按钮**已经卸载** ⇒ 必须由 `isConnected` 把它筛掉。
   *   这正是 2026-10-13 全量 E2E 下 E7-d 间歇失败（落回 `BODY`）的原因：
   *   只有一个候选、且没查 `isConnected`，链一断就没有备选。
   *
   * ⚠️ 它必须在**组件体**里，不能写在下面 JSX 的属性列表中 ——
   *   那里是属性位置，放 `const` 是语法错误（2026-10-13 实测：构建当场失败）。
   */
  const pickRestoreTarget = (): HTMLElement | null =>
    [restoreRef.current, lastFocusedRef.current].find(
      (c): c is HTMLElement => !!c && c !== document.body && c.isConnected,
    ) ?? null;

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
            const el = document.activeElement;
            if (el instanceof HTMLElement && el !== document.body) {
              restoreRef.current = el;
              return;
            }
            const last = pickRestoreTarget();
            if (last) restoreRef.current = last;
          }}
          // 关闭时把焦点还给来源元素。
          // `preventDefault()` 是**必须的** —— 不阻止的话 Radix 会自己决定落点（本例落回 body）。
          onCloseAutoFocus={(event) => {
            const el = pickRestoreTarget();
            if (!el) return;
            event.preventDefault();
            el.focus();
            // ⚠️ **下一帧复核一次**。负载下聚焦之后可能立刻被紧随其后的重渲染/Radix 收尾打断，
            //    焦点又回到 body（E7-d 实测到的间歇失败）。复核只做一件事：如果那时焦点不在目标上
            //    **且目标还活着**，再聚一次。这不是「重试到成功」，只在**一帧**后确认。
            requestAnimationFrame(() => {
              if (el.isConnected && document.activeElement !== el) el.focus();
            });
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-var(--space-12))] max-w-dialog rounded-panel border border-line',
            'bg-surface-raised p-6 shadow-raised',
          )}
        >
          <AlertDialog.Title className="text-title2 font-semibold text-ink">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-caption text-ink-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            {/* Cancel/Action 都用 `asChild` 让 Radix 把行为挂到我们自己的 Button 上 ——
                这样按钮的视觉只由 Button 决定，不会出现「弹窗里的按钮长得不一样」 */}
            <AlertDialog.Cancel asChild>
              <Button>{cancelText}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={onConfirm}>
                {confirmText}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

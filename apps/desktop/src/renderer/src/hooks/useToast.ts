// useToast.ts —— 轻提示状态（消息 + 语气 + 自动消失）
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 把任意输入变成**可显示**的提示文本。
 *
 * ⚠️ 为什么必须有这一步（Apple Style 审查 **V-42**，真窗口截图实测）：
 *   原先这里是 `setMessage(String(msg))`，而 **`String(undefined) === 'undefined'`** ——
 *   于是任何一个插值字段缺失的调用点（例如 `show(\`已回退 \${tx.txId}\`)` 而 `txId` 不存在）
 *   都会把 **"undefined" 原样弹给用户**。这不是"防御性编程"，是**已经发生过**的观感事故。
 *
 * 判据：**宁可什么都不弹，也绝不弹 "undefined"/"null"/"NaN"/空串**。
 * 返回空串时调用方（`show`）直接不弹 —— 见下面的 `if (!text) return`。
 */
export function normalizeMessage(msg: unknown): string {
  if (msg === undefined || msg === null) return '';
  const s = String(msg).trim();
  // 这三个是"插值缺失"的典型产物，不该出现在界面上
  if (s === 'undefined' || s === 'null' || s === 'NaN') return '';
  return s;
}

/**
 * 这条提示**多久自动消失**（毫秒；`0` = 不自动消失）。
 *
 * ⚠️ 为什么错误**不自动消失**（Apple Style 审查 **V-16**）：
 *   原先成功与出错共用同一条 toast、**都 2.6 秒自动消失** ⇒ 用户（尤其读屏用户）
 *   可能压根没看到错误，而错误恰恰是"必须知道"的信息。
 *   判据出处：**WCAG 2.2 SC 2.2.1**（时间限制）· **SC 4.1.3**（状态消息要能被播报）；
 *   HIG › **Feedback** 也要求错误与普通提示区别对待。
 *   ⇒ 错误**留在屏幕上**，直到下一条消息替换它（`show` 会覆盖上一条）。
 *
 * 抽成纯函数是为了**可断言**：`node:test` 加载不了 React 组件，但可以断言这个策略
 * （见 `apps/desktop/tests/copy.test.mjs` 的 CP-4）。
 */
export function autoDismissMs(tone: unknown, ms: number): number {
  return tone === 'err' ? 0 : ms;
}

/** `useToast()` 的返回（组件只吃这三个） */
export type UseToastResult = {
  message: string;
  tone: string;
  show: (msg: unknown, t?: string) => void;
};

export default function useToast(ms = 2600): UseToastResult {
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState('info'); // info | err
  // 计时器句柄：DOM 与 Node 的 `setTimeout` 返回类型不同（number vs Timeout），
  // 用 `ReturnType` 取当前环境的那一个，避免在两套 lib 之间二选一。
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (msg: unknown, t = 'info') => {
      const text = normalizeMessage(msg);
      // 不可显示 ⇒ **不弹**（也顺手清掉上一条，免得旧提示挂在那儿让人误解）
      if (!text) {
        setMessage('');
        return;
      }
      setMessage(text);
      setTone(t);
      if (timer.current) clearTimeout(timer.current);
      const alive = autoDismissMs(t, ms);
      if (alive > 0) timer.current = setTimeout(() => setMessage(''), alive);
      else timer.current = null; // 错误：不设计时器（见 autoDismissMs）
    },
    [ms],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, tone, show };
}

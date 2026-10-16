// store/app-health.ts —— `appHealth`（第 22 个只读方法）的界面状态（Operation 层 · U27 · 2026-10-16）
//
// 分层（AGENTS §2）：本文件是 **Operation 层** —— 它调 Adapter，**不 import React**，
// 所以 `entryText()` / `healthLine()` / `firstAtText()` 这些**文案判据**能在 `node:test` 里跑。
// React 那一侧只有 `hooks/useAppHealth.ts` 一层薄壳。
//
// ── 这个 store 刻意**很小**（三条纪律）─────────────────────────────────────
//   ① **不猜**：主进程说 `unhealthy:false` 就是「本次运行没出过事」；界面**不**按 `count` 自己推
//      「大概出过问题」，也**不**读日志去推断「上次崩溃」（那是日志的事，界面上只给「打开日志」）；
//   ② **不淡化**：不健康时必须看得见（顶栏有标记、面板有原因/次数/首条时间）—— 与本项目「最怕静默」同源；
//   ③ **不夸大**：健康时也**写一行**「没事发生」（不是空白），且**绝不弹窗、绝不阻塞**主流程
//      —— 未处理异常常常是**已经被兜住的一次**抖动，每次弹窗会把用户训练成无脑关掉。
//
// ── 为什么没有事件订阅 ────────────────────────────────────────────────────
//   契约（SPEC §6）没给 appHealth 任何事件，且进程内的不健康态只在**出事那一刻**变。
//   界面在「启动」与「打开诊断面板」各查一次就够 —— 轮询既没必要也会浪费 IPC（设计稿写明了这一点）。
import { create } from 'zustand';

import { invoke as apiInvoke } from '../adapter/api.ts';
import type { AdapterError } from '../adapter/api.ts';

/** 主进程 `app-health.ts` 的载荷（**拷贝**；渲染层不 import 主进程模块，同 store/health.ts 的口径） */
export type AppHealth = {
  unhealthy: boolean;
  count: number;
  reason: string | null;
  firstAt: string | null;
};

/** 健康时的空值：**恒成功**的方法查不到事实 ⇒ 这就是事实本身 */
export const HEALTHY: AppHealth = Object.freeze({
  unhealthy: false,
  count: 0,
  reason: null,
  firstAt: null,
});

/**
 * 顶栏入口那一小段文字（**低调**：它是入口，不是警报）。
 * 健康时说「诊断」，不健康时说「诊断 · N」—— 数字让「有点怪」变成一个可核对的事实。
 */
export function entryText(h: AppHealth | null): string {
  if (!h || h.unhealthy !== true) return '诊断';
  const n = typeof h.count === 'number' && h.count > 0 ? Math.floor(h.count) : 1;
  return '诊断 · ' + String(n);
}

/**
 * 面板里那一行结论。**健康时也有一行**（不是空白）—— 空白会被读成「没做这件事」。
 * ⚠️ 用户可见文案在这里**生成**（而不是在主进程）：主进程只给事实（unhealthy/count/reason/firstAt），
 *    句式属于界面。但**不许**在这里编造事实（例如把缺 reason 说成「未知原因」而其实没出过事）。
 */
export function healthLine(h: AppHealth | null): string {
  if (!h || h.unhealthy !== true) return '本次运行没有出现过未处理异常。';
  const n = typeof h.count === 'number' && h.count > 0 ? Math.floor(h.count) : 1;
  return '本次运行出现过未处理异常，共 ' + String(n) + ' 次。';
}

/**
 * 还要不要继续低频重查？
 *
 * · 已经拿到**不健康 + 原因** ⇒ 停（结论稳定，再查也不会有新信息；这条事实不需要持续采样）；
 * · 其余情况（还没读到 / 读到但健康）⇒ 继续查，直到出事被看见为止。
 * ⚠️ 这条判断放在 store（纯函数）而不是 hook 里：它是**判据**，必须能在 node:test 里钉住
 *    （AS6：命中即停 / 没命中就继续）。
 */
export function shouldKeepPolling(h: AppHealth | null): boolean {
  if (h && h.unhealthy === true && typeof h.reason === 'string' && h.reason.length > 0)
    return false;
  return true;
}

/**
 * 首条时间 → 本地可读（**认不出来就原样返回**，不猜一个时间）。
 * 只做「能被 Date 解析就本地化」这一件事；解析不了说明主进程给的不是 ISO ⇒ 如实展示原值。
 */
export function firstAtText(firstAt: string | null): string {
  if (typeof firstAt !== 'string' || firstAt === '') return '—';
  const t = Date.parse(firstAt);
  if (!Number.isFinite(t)) return firstAt;
  return new Date(t).toLocaleString();
}

export type AppHealthState = {
  loading: boolean;
  error: AdapterError | null;
  data: AppHealth | null;
};

export type AppHealthStore = AppHealthState & {
  /** 查一次（**恒成功**：主进程不给 ok:false ⇒ 这里只可能因通道缺失而 error） */
  load: () => Promise<void>;
  __reset: () => void;
};

const initial: AppHealthState = { loading: false, error: null, data: null };

export const useAppHealthStore = create<AppHealthStore>()((set) => ({
  ...initial,

  load: async () => {
    set({ loading: true, error: null });
    const r = await apiInvoke<AppHealth>('appHealth', {});
    if (!r.ok) {
      // 契约说它恒成功 ⇒ 走到这里只可能是**通道/来源**问题（例如 preload 没加载）。
      // 文案只用 Adapter 归一后的 userMessage（界面不许自造第二份兜底）。
      set({ loading: false, error: r.error, data: null });
      return;
    }
    set({ loading: false, error: null, data: r.data });
  },

  __reset: () => set({ ...initial }),
}));

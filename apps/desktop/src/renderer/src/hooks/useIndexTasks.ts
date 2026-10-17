// hooks/useIndexTasks.ts —— 索引任务的**操作**入口（Operation 层，IDX-3）
//
// 为什么要有这一层：UI **不许碰 window.api**（AGENTS §2）。TaskPage 只点按钮，
// 「调哪个方法 / 成功失败怎么落状态 / 哪些结果算"诚实结果"而不是错误」都在这里。
//
// 事件：进度是主进程**推**来的（`adapter.onEvent`）⇒ 这里订阅一次，交给 store 的纯归约器。
// ⚠️ 取消订阅必须返回（页面卸载就断），否则重进页面会累积多个订阅。
import { useCallback, useEffect, useState } from 'react';

import { invoke, onEvent } from '../adapter/api.ts';
import type { AdapterError } from '../adapter/api.ts';
import { useTaskStore } from '../store/tasks.ts';
import type { TaskEvent } from '../store/tasks.ts';

/** `indexStart` 的返回（只声明本层用到的字段；其余原样透出） */
type StartData = { jobId?: string; total?: number };
/** `indexCancel` 的返回 —— `cancelled:false` 是**诚实结果**（没有在跑的任务），不是失败 */
type CancelData = { cancelled?: boolean };

export type IndexTasksApi = {
  start: (libId: string) => Promise<void>;
  cancel: () => Promise<void>;
  resume: (libId: string) => Promise<void>;
  /** 最近一次操作的错误（null = 没有） */
  error: AdapterError | null;
};

/** 事件是 `unknown`（preload 只承诺"有事件"）—— 形状按 store 的 `TaskEvent` 认领 */
function asTaskEvent(evt: unknown): TaskEvent | null {
  return evt && typeof evt === 'object' ? (evt as TaskEvent) : null;
}

export default function useIndexTasks(onToast?: (msg: string, tone?: 'info' | 'err') => void) {
  const [error, setError] = useState<AdapterError | null>(null);
  // 注意：操作失败(IPC 层)与任务失败(引擎 outcome)是两件事，不混进 store 的 outcome

  // 事件 → 归约器（只订阅一次）
  useEffect(
    () =>
      onEvent((evt) => {
        const e = asTaskEvent(evt);
        if (e) useTaskStore.getState().applyEvent(e);
      }),
    [],
  );

  const start = useCallback(
    async (libId: string) => {
      if (!libId) {
        onToast?.('还没有可索引的库', 'err');
        return;
      }
      const r = await invoke<StartData>('indexStart', { libId });
      if (!r.ok) {
        setError(r.error);
        onToast?.(r.error.userMessage, 'err');
        return;
      }
      setError(null);
      // ⚠️ `total` 这里可能是 0（未知）——**不要**拿它当总数显示（会先显示 0 再跳变）。
      //    总数以**首条 progress 事件**为准（store 的 reduceEvent 用 `evt.total` 覆盖）。
      useTaskStore.getState().begin({ libId, jobId: r.data.jobId ?? null });
    },
    [onToast, setError],
  );

  const cancel = useCallback(async () => {
    const r = await invoke<CancelData>('indexCancel', {});
    if (!r.ok) {
      setError(r.error);
      onToast?.(r.error.userMessage, 'err');
      return;
    }
    setError(null);
    // ⚠️ `cancelled:false` = **没有在跑的任务**（诚实结果）⇒ 不报错，只如实说一句
    if (!r.data.cancelled) onToast?.('当前没有正在运行的索引任务');
  }, [onToast, setError]);

  const resume = useCallback(
    async (libId: string) => {
      const r = await invoke('indexResume', libId ? { libId } : {});
      if (!r.ok) {
        setError(r.error);
        onToast?.(r.error.userMessage, 'err');
        return;
      }
      setError(null);
      useTaskStore.getState().begin({ libId, jobId: null });
    },
    [onToast, setError],
  );

  return { start, cancel, resume, error } satisfies IndexTasksApi;
}

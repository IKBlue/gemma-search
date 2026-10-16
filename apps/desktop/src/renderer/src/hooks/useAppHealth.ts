// hooks/useAppHealth.ts —— `appHealth` 的 React 薄壳（U27 · 2026-10-16）
//
// 为什么是 hook 而不是「页面里 useEffect 各写一遍」：
//   顶栏要显示它、诊断面板要显示它、诊断页还要能手动刷新 ⇒ 三个调用点。
//   查询逻辑（判据、文案）已经在 `store/app-health.ts`；这里只负责**挂载时查一次**这一件事。
//
// ── 为什么**要**低频重查（更正一条我原先的判断）───────────────────────────
//   我一开始写的是「不轮询：启动查一次就够」。**真窗口里当场被证伪**：
//   出事之后顶栏的 `data-unhealthy` 一直是 `no` —— 因为顶栏只在**挂载时**查过一次，
//   而「进程级事实」不该要求用户先切页面/刷新才能看见（那又变回了「知道但不显示」）。
//   ⇒ 折中：**空闲期 5s 一次、命中即停**（`shouldKeepPolling`）。
//     它换来的是「出事后 ≤5s 内界面自己变」；代价是一次 0ms 的只读 IPC（实测 `invoke appHealth 0ms → ok`）。
//     停的条件很明确：已经有**不健康 + 原因**这个稳定结论，就不再查（低频事实不需要持续采样）。
import { useCallback, useEffect } from 'react';

import { useAppHealthStore, shouldKeepPolling } from '../store/app-health.ts';
import type { AppHealth } from '../store/app-health.ts';
import type { AdapterError } from '../adapter/api.ts';

export type UseAppHealth = {
  loading: boolean;
  error: AdapterError | null;
  data: AppHealth | null;
  refresh: () => void;
};

export default function useAppHealth(): UseAppHealth {
  const { loading, error, data, load } = useAppHealthStore();
  useEffect(() => {
    void load();
  }, [load]);

  // 空闲期重查（命中即停）—— 见文件头「为什么**要**低频重查」那段。
  useEffect(() => {
    if (!shouldKeepPolling(data)) return;
    const t = setInterval(() => {
      void useAppHealthStore.getState().load();
    }, 5000);
    return () => clearInterval(t);
  }, [data]);
  const refresh = useCallback(() => {
    void useAppHealthStore.getState().load();
  }, []);
  return { loading, error, data, refresh };
}

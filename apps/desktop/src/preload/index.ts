// apps/desktop/src/preload/index.ts —— 沙箱化 preload（**构建产物为 CJS**）
//
// 源文件是 ESM，但 electron-vite 会把它产出 `out/preload/index.cjs`（见 electron.vite.config.mjs）：
// `sandbox: true` 的渲染进程**不加载 ESM preload**。
//
// 只暴露三个成员，**不暴露 ipcRenderer 本体**、不暴露 require / process / fs。
// 渲染进程能做的事 = 这三个成员能做的事（SPEC-security §5）。
//
// 2026-10-14：由 index.js 转为 index.ts（全量 TypeScript）。**暴露面仍然恰好三个** —— E2E E0 会真窗口核对。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const CH_INVOKE = 'engine:invoke';
const CH_EVENT = 'engine:event';

type EventCallback = (evt: unknown) => void;

contextBridge.exposeInMainWorld('api', {
  /** 调引擎方法（方法名与参数由主进程 zod 白名单校验） */
  invoke: (method: string, params: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CH_INVOKE, { method, params }),

  /** 订阅主进程推送（索引进度、编码器就绪、恢复报告…）；返回取消订阅函数 */
  onEvent: (cb: EventCallback): (() => void) => {
    const h = (_e: IpcRendererEvent, evt: unknown): void => {
      try {
        cb(evt);
      } catch (err) {
        console.error('[preload] 事件回调异常', err);
      }
    };
    ipcRenderer.on(CH_EVENT, h);
    return () => ipcRenderer.removeListener(CH_EVENT, h);
  },

  /** 只读的平台信息（渲染进程不该自己去猜环境） */
  platform: process.platform,
});

// app/preload/index.cjs —— 沙箱化 preload（**必须 CJS**：sandbox:true 下不加载 ESM）
//
// 只暴露三个函数，**不暴露 ipcRenderer 本体**、不暴露 require / process / fs。
// 渲染进程能做的事 = 这三个函数能做的事（SPEC-security §5）。
const { contextBridge, ipcRenderer } = require('electron');

const CH_INVOKE = 'engine:invoke';
const CH_EVENT = 'engine:event';

contextBridge.exposeInMainWorld('api', {
  /** 调引擎方法（方法名与参数由主进程 zod 白名单校验） */
  invoke: (method, params) => ipcRenderer.invoke(CH_INVOKE, { method, params }),

  /** 订阅主进程推送（索引进度、编码器就绪、恢复报告…） */
  onEvent: (cb) => {
    const h = (_e, evt) => { try { cb(evt); } catch (err) { console.error('[preload] 事件回调异常', err); } };
    ipcRenderer.on(CH_EVENT, h);
    return () => ipcRenderer.removeListener(CH_EVENT, h);   // 返回取消订阅
  },

  /** 只读的平台信息（渲染进程不该自己去猜环境） */
  platform: process.platform,
});

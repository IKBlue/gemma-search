// adapter/api.js —— 全应用**唯一**接触 `window.api` 的地方（三层架构的 Adapter 层）
//
// 为什么必须有这一层（AGENTS.md §2）：此前渲染层有 3 个文件、6 处直接调 `window.api`，
// 且**同一套错误信封解包逻辑复制了 21 处**（`r.ok` / `(r.error && r.error.userMessage) || '默认文案'` /
// `catch (e) => '调用异常：…'`）。那是 P2（复制粘贴）与"同一件事两处说法"的温床：
// 主进程改了 `userMessage` 的语义，界面有 21 个地方要跟着改，漏一个就出现两套文案。
//
// 本文件把三件事收敛成**一处**：
//   ① 唯一的能力入口（`invoke` / `onEvent` / `platform`）
//   ② 唯一的一次信封解包（成功取 `data`，失败取 `error`）
//   ③ **`userMessage` 永远是非空字符串** —— 兜底文案只在这里出现一次
//
// 刻意**不 import React**：Adapter 是纯传输层，这样 `node:test` 能直接加载它做单测
// （见 `apps/desktop/tests/adapter.test.mjs`）。
//
// ⚠️ 本文件是 `window.api` 的**唯一**合法出现处。任何其他渲染层文件出现它，
//    都会被 `apps/desktop/tests/layering.test.mjs` 判红。

/** 拿不到 bridge 时的统一说明（例如在浏览器里直接开 renderer，或 preload 没加载） */
const NO_BRIDGE = '界面与主进程的通道没建立起来（preload 未加载）。'

/**
 * 把任意来源的错误整成**统一形状**。
 *
 * 形状与主进程的信封一致（见 `apps/desktop/src/shared/ipc.ts` 的 `ErrEnvelope`）：
 * `{ code, message, userMessage, details? }`。
 * **`userMessage` 一定会是可直接显示的字符串** —— 这是本函数存在的全部理由。
 *
 * @param {unknown} raw 主进程给的 `error`，或一个异常对象，或任何东西
 * @param {string} fallback 什么都没有时用的兜底文案
 */
export function normalizeError(raw, fallback = '请求失败。') {
  // 已符合信封形状
  if (raw && typeof raw === 'object') {
    const r = /** @type {Record<string, unknown>} */ (raw)
    const userMessage = typeof r.userMessage === 'string' && r.userMessage ? r.userMessage : null
    const message = typeof r.message === 'string' && r.message ? r.message : (userMessage || String(raw))
    if (userMessage) {
      return { code: typeof r.code === 'string' ? r.code : 'UNKNOWN', message, userMessage, details: r.details }
    }
    // 有 error 对象但缺 userMessage ⇒ **不编造业务文案**，用调用方给的兜底 + 原文进 message
    return { code: typeof r.code === 'string' ? r.code : 'UNKNOWN', message, userMessage: fallback, details: r.details }
  }
  if (typeof raw === 'string' && raw) {
    return { code: 'UNKNOWN', message: raw, userMessage: fallback }
  }
  return { code: 'UNKNOWN', message: fallback, userMessage: fallback }
}

/** 取 bridge；不存在时返回 null（**不抛** —— 让调用点统一走 ok:false 分支） */
function bridge() {
  const api = globalThis.window && globalThis.window.api
  return api && typeof api === 'object' ? api : null
}

/** preload 是否可用（界面据此显示"通道没起来"而不是一堆假失败） */
export function hasBridge() {
  const api = bridge()
  return !!(api && typeof api.invoke === 'function')
}

/**
 * 调一个主进程方法。**永不抛异常**，失败一律以 `{ok:false, error}` 返回。
 *
 * 这样调用点只有一种错误处理方式（判 `ok`），此前"既 try/catch 又判 r.ok"的两套机制
 * 就是文案分叉的来源。
 *
 * @param {string} method 契约里登记的方法名（`apps/desktop/src/shared/ipc.ts` 的 `Methods`）
 * @param {object} [params]
 * @returns {Promise<{ok:true, data:any, warnings:string[]} | {ok:false, error:{code:string,message:string,userMessage:string,details?:any}}>}
 */
export async function invoke(method, params = {}) {
  const api = bridge()
  if (!api || typeof api.invoke !== 'function') {
    return { ok: false, error: { code: 'NO_BRIDGE', message: 'window.api 不可用', userMessage: NO_BRIDGE } }
  }

  let raw
  try {
    raw = await api.invoke(method, params)
  } catch (e) {
    // ipcRenderer.invoke 在主进程 handler 抛异常时会 **reject** —— 这条路必须收进信封，
    // 否则每个调用点都要自己写一遍 try/catch（那正是被消灭的 21 处之一）。
    const msg = e && e.message ? e.message : String(e)
    return { ok: false, error: { code: 'INVOKE_THREW', message: msg, userMessage: `调用异常：${msg}` } }
  }

  // 防御：bridge 返回了非信封结构（正常不会发生，但静默当成功更糟）
  if (!raw || typeof raw !== 'object' || typeof raw.ok !== 'boolean') {
    return {
      ok: false,
      error: { code: 'BAD_ENVELOPE', message: `返回值不是信封：${JSON.stringify(raw)}`, userMessage: '主进程返回了无法识别的结果。' },
    }
  }

  if (!raw.ok) return { ok: false, error: normalizeError(raw.error, '请求失败。') }

  return {
    ok: true,
    data: raw.data,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  }
}

/**
 * 订阅主进程事件。返回**取消订阅函数**（preload 的 `onEvent` 本来就返回它）。
 *
 * handler 抛异常不会污染订阅（preload 侧已 try/catch，这里再兜一层是为了拿到可读日志）。
 */
export function onEvent(handler) {
  const api = bridge()
  if (!api || typeof api.onEvent !== 'function') return () => {}
  return api.onEvent((evt) => {
    try {
      handler(evt)
    } catch (e) {
      console.error('[adapter] 事件回调异常', e)
    }
  })
}

/** 平台标识（渲染进程不该自己嗅探环境，见 preload 暴露面的注释） */
export function platform() {
  const api = bridge()
  return api && typeof api.platform === 'string' ? api.platform : 'unknown'
}

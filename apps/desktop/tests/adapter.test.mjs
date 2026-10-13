// apps/desktop/tests/adapter.test.mjs —— Adapter 层的单测
//
// 为什么这个文件重要：Adapter 是**全应用唯一接触 `window.api` 的地方**，它把三件事收敛成一处 ——
// 唯一入口、唯一一次信封解包、`userMessage` 永远非空。此前这三件事复制了 21 处
// （3 个文件 6 处 `window.api` 直调 + 各写各的 `(r.error && r.error.userMessage) || '默认文案'`）。
//
// 所以这里要钉住的不是"函数存在"，而是**那些文案分叉不会回来**：
//   · 失败信封缺 `userMessage` 时，兜底文案在 Adapter 里**只出现一次**，不是每个调用点各编一套
//   · `ipcRenderer.invoke` 的 **reject 也被收进信封**（否则调用点又要自己 try/catch）
//   · 非信封返回值**不许被当成成功**（静默假成功是本仓库栽过的坑，见 F-01）
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { invoke, onEvent, normalizeError, hasBridge, platform } from '../src/renderer/src/adapter/api.js'

/** 造一个可控的假 bridge；`reply` 可以返回信封、抛异常、或返回垃圾 */
function fakeBridge(reply) {
  const calls = []
  const listeners = []
  globalThis.window = {
    api: {
      invoke: async (method, params) => {
        calls.push({ method, params })
        return reply(method, params)
      },
      onEvent: (cb) => {
        listeners.push(cb)
        return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) }
      },
      platform: 'win32',
    },
  }
  return { calls, listeners }
}

const OK = (data, warnings) => ({ ok: true, data, ...(warnings ? { warnings } : {}) })
const FAIL = (error) => ({ ok: false, error })

let savedWindow
beforeEach(() => { savedWindow = globalThis.window })
afterEach(() => { globalThis.window = savedWindow })

// ============================================================ 成功路径

test('A1：成功信封 ⇒ 取出 data，并把 warnings 归一成数组', async () => {
  fakeBridge(() => OK({ libs: [{ libId: 'L1' }] }, ['库根不存在']))
  const r = await invoke('indexStatus', {})
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, { libs: [{ libId: 'L1' }] })
  assert.deepEqual(r.warnings, ['库根不存在'])

  // 没给 warnings 时也必须是数组（调用点不该各自判 `warnings && warnings.length`）
  fakeBridge(() => OK({ libs: [] }))
  const r2 = await invoke('indexStatus', {})
  assert.deepEqual(r2.warnings, [])
})

test('A2：方法名与参数**原样**传给 bridge（Adapter 不篡改契约）', async () => {
  const { calls } = fakeBridge(() => OK(null))
  await invoke('libraryAdd', { root: 'X:\\lib' })
  assert.deepEqual(calls, [{ method: 'libraryAdd', params: { root: 'X:\\lib' } }])

  // 省略 params ⇒ 传 {}（主进程的 zod 都是 .strict() 空对象，别传 undefined）
  await invoke('indexStatus')
  assert.deepEqual(calls[1], { method: 'indexStatus', params: {} })
})

// ============================================================ 失败路径

test('A3：失败信封 ⇒ 保留主进程的 userMessage（界面不许自编文案）', async () => {
  fakeBridge(() => FAIL({ code: 'LIB_NOT_FOUND', message: '目录不存在：X', userMessage: '这个目录不存在，或不是文件夹。请重新选择。' }))
  const r = await invoke('libraryAdd', { root: 'X' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'LIB_NOT_FOUND')
  assert.equal(r.error.userMessage, '这个目录不存在，或不是文件夹。请重新选择。')
  assert.equal(r.error.message, '目录不存在：X')
})

test('A4：失败信封**缺 userMessage** ⇒ 用兜底文案，且原文进 message（不丢诊断信息）', async () => {
  fakeBridge(() => FAIL({ code: 'WEIRD', message: 'something odd' }))
  const r = await invoke('search', {})
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'WEIRD')
  assert.equal(r.error.userMessage, '请求失败。')     // 兜底**只在 Adapter 里出现一次**
  assert.equal(r.error.message, 'something odd')      // 原文没有被吞掉
})

test('A5：⭐ invoke 抛异常 ⇒ 收进信封，**不向调用点传播**', async () => {
  fakeBridge(() => { throw new Error('ipc 断了') })
  // 关键：这里不写 try/catch —— 若 Adapter 漏了这一步，本测试会直接失败
  const r = await invoke('indexStatus', {})
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'INVOKE_THREW')
  assert.match(r.error.userMessage, /调用异常：ipc 断了/)
})

test('A6：⭐ 非信封返回值**不许当成功**（静默假成功是本仓库栽过的坑）', async () => {
  for (const junk of [undefined, null, 'ok', 42, {}, { data: 1 }]) {
    fakeBridge(() => junk)
    const r = await invoke('indexStatus', {})
    assert.equal(r.ok, false, `返回值 ${JSON.stringify(junk)} 必须判失败，而不是成功`)
    assert.equal(r.error.code, 'BAD_ENVELOPE')
    assert.ok(r.error.userMessage.length > 0)
  }
})

test('A7：bridge 不存在（preload 没加载）⇒ NO_BRIDGE，仍然不抛', async () => {
  globalThis.window = {}
  assert.equal(hasBridge(), false)
  const r = await invoke('indexStatus', {})
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'NO_BRIDGE')
  assert.match(r.error.userMessage, /通道没建立起来/)
  assert.equal(platform(), 'unknown')
})

// ============================================================ 事件

test('A8：onEvent 转发事件，且返回**可用的取消订阅**', async () => {
  const { listeners } = fakeBridge(() => OK(null))
  const got = []
  const off = onEvent((e) => got.push(e))
  assert.equal(listeners.length, 1)

  listeners[0]({ type: 'encoder.ready', device: 'webgpu' })
  assert.deepEqual(got, [{ type: 'encoder.ready', device: 'webgpu' }])

  off()
  assert.equal(listeners.length, 0, '取消订阅必须真的摘掉监听器')
})

test('A9：handler 抛异常不影响订阅通道（后续事件仍能到达）', async () => {
  const { listeners } = fakeBridge(() => OK(null))
  const got = []
  onEvent((e) => { got.push(e); if (e.type === 'boom') throw new Error('handler 炸了') })
  listeners[0]({ type: 'boom' })       // preload 的 try/catch 也在这条链上；这里不能把异常抛穿
  listeners[0]({ type: 'after' })
  assert.deepEqual(got, [{ type: 'boom' }, { type: 'after' }])
})

test('A10：bridge 不可用时 onEvent 返回空函数（而不是 undefined）', () => {
  globalThis.window = {}
  const off = onEvent(() => {})
  assert.equal(typeof off, 'function')
  off()   // 不该抛
})

// ============================================================ 归一化本体

test('A11：normalizeError 对任意垃圾输入都给出可显示的 userMessage', () => {
  for (const junk of [undefined, null, 0, '', 'x', {}, [], new Error('e'), { message: 'm' }]) {
    const e = normalizeError(junk, '兜底。')
    assert.equal(typeof e.userMessage, 'string')
    assert.ok(e.userMessage.length > 0, `${JSON.stringify(junk)} ⇒ userMessage 不能为空`)
    assert.equal(typeof e.code, 'string')
  }
  // 显式反例：有 userMessage 时**不许**被兜底覆盖
  assert.equal(normalizeError({ userMessage: '业务文案' }, '兜底。').userMessage, '业务文案')
})

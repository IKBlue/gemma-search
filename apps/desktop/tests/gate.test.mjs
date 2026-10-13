// apps/desktop/tests/gate.test.mjs —— 「无库必须先给向导」的判定（**D2 的核心行为**）
//
// 为什么这个文件重要：D2 的修复让"一个库都没有时显示首启向导，而不是把用户丢进
// 必然报 LIB_NOT_FOUND 的检索界面"成为**应用可用性的前提**。此前这条行为由已删的
// DOM 守卫覆盖（`verify_renderer_dom.mjs` §8 的 7 条）；守卫一走，它就**没有任何自动化**了。
//
// 判定被抽成纯函数 `utils/gate.js`（`node:test` 加载不了 `.jsx`）—— 所以现在能钉住它。
//
// ⚠️ 这**证明不了**的：向导长什么样、点「选择文件夹」后发生什么。那些要 DOM，只能人工看。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decideGate } from '../src/renderer/src/utils/gate.js'

test('G1：还没问出来 ⇒ loading（留白，不要闪一下向导又消失）', () => {
  assert.equal(decideGate({ loading: true, data: null, error: null }), 'loading')
  // loading 优先级最高：即使同时带着旧 data / 旧 error，也不该先渲染别的
  assert.equal(decideGate({ loading: true, data: { libraries: [{ libId: 'L1' }] } }), 'loading')
  assert.equal(decideGate({ loading: true, error: '旧错误' }), 'loading')
})

test('G2：读不到配置 ⇒ error（如实报 + 给重试，不要假装没库）', () => {
  assert.equal(decideGate({ loading: false, data: null, error: 'IPC 断了' }), 'error')
  // error 优先于 wizard：这是"读失败"而不是"确实没有库"，两者文案不同，不能混
  assert.equal(decideGate({ loading: false, data: { libraries: [] }, error: 'IPC 断了' }), 'error')
})

test('G3：⭐ 一个库都没有 ⇒ wizard（D2 的核心：不能把用户丢进必然报错的检索页）', () => {
  assert.equal(decideGate({ loading: false, data: { libraries: [] }, error: null }), 'wizard')
  // `data` 存在但**没有 libraries 字段**也要进向导（主进程的四种"没找到库"形态之一）
  assert.equal(decideGate({ loading: false, data: { chosen: null }, error: null }), 'wizard')
  assert.equal(decideGate({ loading: false, data: null, error: null }), 'wizard')
})

test('G4：有库 ⇒ app（交给路由）', () => {
  assert.equal(decideGate({ loading: false, data: { libraries: [{ libId: 'L1' }] }, error: null }), 'app')
  assert.equal(decideGate({ loading: false, data: { libraries: [{}, {}] }, error: null }), 'app')
})

test('G5：垃圾输入不抛异常，且一律落到 wizard（宁可见向导，也不白屏）', () => {
  for (const junk of [undefined, null, {}, { data: 1 }, { data: { libraries: '不是数组' } }, 42, 'x']) {
    let got
    assert.doesNotThrow(() => { got = decideGate(junk) }, `${JSON.stringify(junk)} 不该抛`)
    assert.equal(got, 'wizard', `${JSON.stringify(junk)} 应落到 wizard`)
  }
})

test('G6：判定与「data 存不存在」无关，只看 libraries 的**长度**', () => {
  // 这是最容易写错的地方：写成 `data ? 'app' : 'wizard'` 会让"读到了但没库"进主界面
  const empty = { loading: false, error: null, data: { libraries: [], chosen: null, warnings: ['w'] } }
  assert.equal(decideGate(empty), 'wizard')
})

// apps/desktop/tests/source-scan.test.mjs —— 扫描器**自检**
//
// 为什么必须单独测它：`layering.test.mjs` 的全部结论都建立在"扫描器能正确区分代码与注释"之上。
// 如果扫描器坏了（例如把注释也算进去，或反过来把真的代码漏掉），分层检查会**静默通过** ——
// 那正是本仓库反复栽的坑（"断言看起来对，其实没测"）。
//
// 所以这里用的是**当年真栽过的用例**，不是编的：
//   · `AGENTS.md` §7 记录：`verify_app_build` §1b 的剥注释器**不认识正则字面量**，
//     含引号的正则（`/["']/g`）会让朴素实现误入字符串模式 ⇒ 被注释掉的接线重新可匹配。
//   · 同一份记录里的另一半：**注释掉一行正是禁用接线的常见手法** ⇒ 注释里的不能算。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { maskNonCode, maskComments, findInCode } from './helpers/source-scan.mjs'

const count = (src) => findInCode(src, /window\.api/g).length

test('S1：注释里的 `window.api` **不算**（行注释 / 块注释 / 多行块注释）', () => {
  assert.equal(count('// 渲染层只有 window.api\nconst a = 1;'), 0)
  assert.equal(count('/* window.api */ const a = 1;'), 0)
  assert.equal(count('/*\n window.api\n*/\nconst a = 1;'), 0)
})

test('S2：⭐ 被**注释掉**的接线不算（反向陷阱：注释掉一行是禁用接线的常见手法）', () => {
  assert.equal(count('// window.api.invoke(1)\nconst a = 1;'), 0)
  assert.equal(count('/* window.api.invoke(1) */'), 0)
})

test('S3：字符串 / 模板字面量里的不算；但**模板插值里的算**', () => {
  assert.equal(count("const s = 'window.api';"), 0)
  assert.equal(count('const s = "window.api";'), 0)
  assert.equal(count('const s = `window.api`;'), 0)
  assert.equal(count('const s = `${window.api.platform}`;'), 1, '插值里是**真代码**，必须算')
})

test('S4：⭐ 含引号的正则字面量之后仍能正确识别（当年栽过的那条）', () => {
  assert.equal(count('const re = /["\']/g; window.api.invoke(1);'), 1)
  assert.equal(count('const re = /[\\/]/g; window.api.x();'), 1)
})

test('S5：除法不被误判成正则起始', () => {
  assert.equal(count('const a = b / c; window.api.x();'), 1)
})

test('S6：行号准确（多行块注释不能把行号带偏）', () => {
  const hits = findInCode('/*\n window.api\n*/\nconst z = window.api.invoke();', /window\.api/g)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 4)
})

test('S7：maskNonCode 与原串**等长同结构**（否则行号与列号会全错）', () => {
  for (const src of [
    'const s = "abc"; // x\nconst t = 1;',
    '/* a\nb */\nconst x = `t${1}y`;',
    'const re = /["\']/g;\nconst y = 2;',
  ]) {
    const m = maskNonCode(src)
    assert.equal(m.length, src.length, '长度必须一致')
    assert.equal(m.split('\n').length, src.split('\n').length, '行数必须一致')
  }
})

test('S8：真正的代码**必须**被找到（否则检查会静默通过 —— 这是最危险的方向）', () => {
  assert.equal(count('const r = await window.api.invoke("x");'), 1)
  assert.equal(count('window.api.onEvent(cb)'), 1)
  assert.equal(count('const a = 1; const b = 2;'), 0)
})

// ============================================================ maskComments（只抹注释）
//
// 为什么需要第二个掩码：**色值 / 类名这类违例真实就写在字符串里**
// （`style={{ color: '#0071e3' }}`、`className="btn"`、Tailwind 任意值 `bg-[#0071e3]`）。
// 用 `maskNonCode` 查它们会**永远查不到** —— 2026-10-13 双向验证实测到这一步，差点交出一条空断言。

const colors = (src) => [...maskComments(src).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].length

test('S9：⭐ 字符串里的色值 maskComments **能找到**、而 maskNonCode **找不到**', () => {
  const src = "const s = { color: '#ff0000' }\n"
  assert.equal(colors(src), 1, 'maskComments 必须能看见字符串里的色值')
  // 反向：maskNonCode 看不见 —— 这正是它不能用于查色值的原因（记在这里防回退）
  assert.equal([...maskNonCode(src).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length, 0)
})

test('S10：maskComments 仍然正确跳过注释（两类注释都要）', () => {
  assert.equal(colors('// #ff0000\nconst a = 1'), 0)
  assert.equal(colors('/* #ff0000 */ const a = 1'), 0)
  assert.equal(colors('/*\n #ff0000\n*/'), 0)
})

test('S11：maskComments 不会把字符串里的 `//` 当成行注释（URL 用例）', () => {
  // 若把 'http://x' 当注释，后面那行代码会被整段吃掉 ⇒ 漏报
  const src = "const u = 'http://localhost/x'\nconst c = '#00ff00'\n"
  assert.equal(colors(src), 1, "'http://' 不该让后面的色值消失")
})

test('S12：maskComments 与原串**等长同结构**（行号才不会错）', () => {
  for (const src of ['const s = "abc"; // x\n', '/* a\nb */\nconst x = `t${1}y`;', "const a = '#fff';\nconst b = 2;"]) {
    const m = maskComments(src)
    assert.equal(m.length, src.length)
    assert.equal(m.split('\n').length, src.split('\n').length)
  }
})

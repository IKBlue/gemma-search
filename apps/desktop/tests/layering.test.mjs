// apps/desktop/tests/layering.test.mjs —— 三层架构的**机械检查**（进 `npm test`，不是守卫）
//
// 为什么要有它：`AGENTS.md` §2 的四层架构此前是**纯纪律** —— 靠人看。本仓库已被独立复核否过三次，
// 每一次的根因都是"抓不到回归的检查等于没有检查"。所以规则的机械部分必须上断言。
//
// ⚠️ 口径（所有者 2026-10-13）：**不新建守卫**（`tools/verify_*.mjs`），改成 `npm test` 里的断言。
//    这不是变通 —— 仓库已有先例：`permissions.test.mjs` 就是靠读源码断言"该模块不 import `fs`"。
//
// 规则来源（`AGENTS.md` §2 的分层表）：
//   UI(组件) ──> Operation(store/composable/utils) ──> Adapter(唯一 invoke 入口) ──> repo/service
//   · Adapter 是**全应用唯一**碰 `window.api` 的地方
//   · UI 层（pages/layout/ui/search）**不得**碰 `window.api`，也**不得**直接 import Adapter
//
// 依赖 `./helpers/source-scan.mjs` 区分"代码"与"注释" —— 那件事本身有自检
// （`source-scan.test.mjs`），否则本文件的结论会静默失效。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findInCode } from './helpers/source-scan.mjs'

const RENDERER = fileURLToPath(new URL('../src/renderer/src', import.meta.url))

/** UI 层目录（`AGENTS.md` §2 的表格） */
const UI_DIRS = ['pages', 'layout', 'ui', 'search']
/** Operation 层目录 */
const OPERATION_DIRS = ['hooks', 'store', 'utils']
const ADAPTER_DIR = 'adapter'

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(p)   // 全量 TS 迁移：扫描面必须含 .ts/.tsx
  }
  return out
}

const allFiles = () => walk(RENDERER)
const rel = (f) => path.relative(RENDERER, f).split(path.sep).join('/')
const topDir = (f) => rel(f).split('/')[0]
const read = (f) => fs.readFileSync(f, 'utf8')

/** 在**代码**里找模式，返回 `文件:行` 列表 */
function offenders(files, re) {
  const out = []
  for (const f of files) for (const h of findInCode(read(f), re)) out.push(`${rel(f)}:${h.line}`)
  return out
}

// ============================================================ 规则 1：Adapter 是唯一入口

test('L1 ⭐ `window.api` 只允许出现在 `adapter/` 里（全应用唯一接触点）', () => {
  const files = allFiles()
  assert.ok(files.length > 0, '扫不到渲染层文件 ⇒ 路径写错了，检查本身失效')

  const hits = offenders(files, /window\s*\.\s*api/g)
  const bad = hits.filter((h) => !h.startsWith(ADAPTER_DIR + '/'))

  assert.deepEqual(bad, [],
    `这些地方直接碰了 window.api，必须改走 adapter/api.js：\n    ${bad.join('\n    ')}`)
  assert.ok(hits.length > 0, 'Adapter 自己也该有 window.api —— 一处都没有说明扫描失效')
})

// ============================================================ 规则 2：UI 不得碰 window.api

test('L2 ⭐ UI 层（pages/layout/ui/search）零 `window.api`', () => {
  const files = allFiles().filter((f) => UI_DIRS.includes(topDir(f)))
  assert.ok(files.length > 0, `UI 层一个文件都扫不到 ⇒ 目录名改了？`)

  const bad = offenders(files, /window\s*\.\s*api/g)
  assert.deepEqual(bad, [], `UI 层不得直接碰 window.api（它连 Adapter 都不该碰）：\n    ${bad.join('\n    ')}`)
})

// ============================================================ 规则 3：UI 不得直接 import Adapter

test('L3 ⭐ UI 层不得直接 import Adapter（协议细节归 Operation 层）', () => {
  const files = allFiles().filter((f) => UI_DIRS.includes(topDir(f)))
  const bad = []
  for (const f of files) {
    // 只看 import 语句里的路径是否指向 adapter/
    for (const h of findInCode(read(f), /from\s+['"][^'"]*adapter\/[^'"]*['"]/g)) {
      bad.push(`${rel(f)}:${h.line}  ${h.text}`)
    }
  }
  assert.deepEqual(bad, [],
    `UI 层的协议交互必须经 Operation 层（hooks/），不得直接 import Adapter：\n    ${bad.join('\n    ')}`)
})

// ============================================================ 规则 4：Operation 层也不得碰 window.api

test('L4 Operation 层（hooks/store/utils）零 `window.api`', () => {
  const files = allFiles().filter((f) => OPERATION_DIRS.includes(topDir(f)))
  assert.ok(files.length > 0, 'Operation 层一个文件都扫不到 ⇒ 目录名改了？')
  const bad = offenders(files, /window\s*\.\s*api/g)
  assert.deepEqual(bad, [], `Operation 层必须经 Adapter，不得自己碰 window.api：\n    ${bad.join('\n    ')}`)
})

// ============================================================ 规则 5：Adapter 自己不 import React

test('L5 Adapter 不 import React（纯传输层，这样才能被 node:test 直接加载）', () => {
  const files = walk(path.join(RENDERER, ADAPTER_DIR))
  assert.ok(files.length > 0, 'adapter/ 不存在或为空')
  const bad = offenders(files, /from\s+['"]react['"]/g)
  assert.deepEqual(bad, [], `Adapter 一旦依赖 React 就测不动了：\n    ${bad.join('\n    ')}`)
})

// ============================================================ 规则 6：没有第二份"文案兜底"

/**
 * "userMessage 的兜底"判据。**只抓紧邻的** `||` / `??`。
 *
 * ⚠️ **2026-10-13 收紧过一次，原因是它误报了我自己的代码**：
 *   旧判据是 `/userMessage[^\n]*\|\||\|\|[^\n]*userMessage/` —— **同一行里只要出现过 `||` 就算**，
 *   于是这行被误判：
 *     `show(r.ok ? \`已重试 ${OP_TEXT[tx.op] || tx.op}\` : r.error.userMessage, …)`
 *   那个 `||` 是**模板串里选个显示名**，跟文案兜底毫无关系。
 *   假阳性的代价是真实的：它会逼人**不敢写注释、不敢在同一行用 `||`**，
 *   最后这条检查会被人关掉。所以收紧成"运算符必须紧挨着 userMessage"。
 *
 * ✅ 两个方向都断言（见 L6b）：真的兜底要抓到，同行的无关 `||` 要放过。
 */
const USERMSG_FALLBACK = /userMessage\s*(\|\||\?\?)|(\|\||\?\?)\s*[\w.?[\]]*userMessage/g

test('L6 ⭐ 用户文案兜底只允许在 Adapter 里出现一次（P2 的机械判据）', () => {
  const files = allFiles()
  const bad = offenders(files, USERMSG_FALLBACK)
    .filter((h) => !h.startsWith(ADAPTER_DIR + '/'))
  assert.deepEqual(bad, [],
    `兜底文案（userMessage 的 \`||\` / \`??\` 兜底）只该在 adapter/api.js 里出现一次：\n    ${bad.join('\n    ')}`)
})

test('L6b ⭐⭐ 判据本身要准：真兜底抓到、同行无关的 `||` 放过（否则会逼人不写注释）', () => {
  const hits = (src) => findInCode(src, USERMSG_FALLBACK).length

  // ① 真兜底（两种方向 + `??` 形态）—— 必须抓到
  assert.equal(hits("const m = e.userMessage || '默认'\n"), 1, '`userMessage || 默认` 是典型兜底')
  assert.equal(hits("const m = '默认' || e.userMessage\n"), 1, '反向写法同样是兜底')
  assert.equal(hits("const m = e.userMessage ?? '默认'\n"), 1, '`??` 也是兜底')
  assert.equal(hits("show(res.error.userMessage || res.error.message)\n"), 1, '链式取属性也要抓到')

  // ② 同行但**无关**的 `||` —— 必须放过（旧判据在这里误报，实测踩过）
  assert.equal(hits('show(r.ok ? `已重试 ${OP_TEXT[tx.op] || tx.op}` : r.error.userMessage, tone)\n'), 0,
    '模板串里选显示名的 `||` 与文案兜底无关')
  assert.equal(hits('const label = a || b; const msg = e.userMessage;\n'), 0,
    '分开的两个表达式不该被算成兜底')

  // ③ 注释里的不算（扫描器负责）
  assert.equal(hits("// 别写 `userMessage || 默认`\nconst a = 1\n"), 0)
})

// ============================================================ 反向自证：检查必须能红

test('L7 ⭐ 检查**能红**：给 UI 层喂一行 window.api，L1/L2 必须报出来', () => {
  // 不真的改磁盘文件：用同一套扫描逻辑在**内存里**跑一遍，证明它会命中。
  // （真·双向验证见回报：往 FirstRunWizard 注入一行 window.api.invoke ⇒ npm test 失败。）
  const injected = `export default function X() {\n  return window.api.invoke('search', {})\n}\n`
  const hits = findInCode(injected, /window\s*\.\s*api/g)
  assert.equal(hits.length, 1, '注入的违例必须被扫到，否则 L1/L2 是空断言')

  // 反向：同一行放进注释里就不该命中（否则检查会满屏假阳性，最后被人关掉）
  assert.equal(findInCode('// 改走 window.api\n', /window\s*\.\s*api/g).length, 0)
})

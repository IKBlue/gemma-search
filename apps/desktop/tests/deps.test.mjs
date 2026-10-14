// apps/desktop/tests/deps.test.mjs —— 依赖清账的**机械断言**（T4）
//
// 为什么要有它：`docs/audit/STACK-AUDIT.md` 与 `docs/spec/SPEC-security.md` §7.3 都记过
// 「**声明了但零 import**」的偏离 —— 2026-10-13 实测重数：**28 个**依赖零 import（25 生产 + 12 开发里的）。
// 那**不是一次性的历史问题，而是一种会反复发生的漂移**：有人为了"以后可能用"先装上，
// 然后再也没有然后。⇒ 把它变成断言，以后新增声明时 `npm test` 会立刻提醒。
//
// ⚠️ 两类"零 import 但必须留"的依赖（**不能一概删**）：
//   ① **隐式工具链**：`tsc`（typescript）· `esbuild/vite`（vite）· `electron-builder`（CLI 脚本）
//      · `@types/*`（由 tsconfig 的 `types` 解析，代码里绝不出现 import）
//   ② **peer / 引擎**：`tailwindcss` 由 `@tailwindcss/vite` 当 peer 用；CSS 引擎不经 JS import
//   ⇒ 所以断言不是"零 import 就报错"，而是"**零 import 必须在白名单里、且白名单必须写清理由**"。
//
// ⚠️ 扫描必须**同时覆盖静态与动态 import**。实测教训：第一版只匹配 `from`/`require`，
//    于是 `sharp`（`bmp_decode.mjs:139` 的 `await import('sharp')`）与 `bmp-js`（`:55`）
//    都被判成"零 import" —— **差一点就把编码路径的依赖删了**。见 `D-C` 那条用例。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskComments } from './helpers/source-scan.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }

const SKIP = /^(node_modules|out|data|docs|reports|\.git|\.npm-cache)/
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(rel(p))) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
/**
 * 扫描范围：**排除本文件自己**。
 *
 * ⚠️ 为什么必须排除（这不是"放宽检查"，是修一个自指的坑）：本文件为了写断言，
 * 必须把依赖名当**数据**写出来（`importers('@tanstack/react-virtual')`、"已在 T4 删除"这类）。
 * 若把自己算进扫描范围，那些字符串会被当成"有 import" ⇒ **D-A 永远绿、D-C 永远红**，
 * 断言变成自我实现。实测就是先踩了这个：删掉 `@tanstack/react-virtual` 后它仍报"有 import"。
 * ⇒ 排除的只有这一个"把依赖名当数据"的文件；`tests/` 下其余文件照常参与扫描。
 */
const SELF = 'apps/desktop/tests/deps.test.mjs'
const files = walk(ROOT).filter((f) => rel(f) !== SELF)

/** 在**非注释**部分找这个依赖被引用的地方（静态 / 动态 / require / 子路径都算） */
function importers(dep) {
  // 用 maskComments：依赖名写在**字符串**里（`from 'x'`），maskNonCode 会把它们抹掉
  const re = new RegExp(`['"]${dep.replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m)}(?:/[^'"]*)?['"]`)
  return files.filter((f) => re.test(maskComments(fs.readFileSync(f, 'utf8')))).map(rel)
}

/**
 * 零 import 但**必须留**的依赖 —— 每条都要有理由。
 * ⚠️ 往这里加东西之前先问：真的没有别的办法了吗？（它就是这份断言的"后门"，别让它变垃圾场）
 */
const IMPLICIT = {
  typescript: '`npm run typecheck` 跑 `tsc`；代码里不需要 import 编译器',
  vite: 'electron-vite / @vitejs/plugin-react 的 peer，且是实际打包器；不写 import',
  tailwindcss: '`@tailwindcss/vite` 的 peer，且是 CSS 引擎本身 —— 样式不经 JS import',
  'electron-builder': '`build:win` / `build:unpack` 脚本调它的 CLI',
  '@types/node': '由 tsconfig 的 `types` 解析，代码里绝不出现 import',
  '@types/react': '同上',
  '@types/react-dom': '同上',
}

// ============================================================ D-A 不许有"已装零 import"

test('D-A ⭐ 每个声明的依赖：要么有真实 import，要么在白名单里且写了理由', () => {
  const orphans = []
  for (const dep of Object.keys(declared)) {
    if (importers(dep).length > 0) continue
    if (IMPLICIT[dep]) continue
    orphans.push(dep)
  }
  assert.deepEqual(orphans, [],
    `这些依赖声明了但全仓零 import，也没在白名单里 —— 要么接上、要么删掉：\n    ${orphans.join('\n    ')}`)
})

test('D-B 白名单不许变成垃圾场：里面每个包都必须**仍然被声明**', () => {
  const stale = Object.keys(IMPLICIT).filter((d) => !declared[d])
  assert.deepEqual(stale, [], `白名单里这些包已经不在 package.json 里了，删掉它们：${stale.join(', ')}`)
})

test('D-C ⭐⭐ 断言本身有效：能看见**动态** `import()`（差点因此删错依赖）', () => {
  // 这条是"断言的断言"。实测教训：只匹配静态 import 时，sharp / bmp-js 会被误判为零 import。
  for (const [dep, file] of [['sharp', 'packages/indexer/src/bmp_decode.ts'], ['bmp-js', 'packages/indexer/src/bmp_decode.ts']]) {
    const hits = importers(dep)
    assert.ok(hits.includes(file), `${dep} 应被认出用在 ${file}（动态 import）—— 实得 ${JSON.stringify(hits)}`)
  }
  // 而真正没人用的，必须报 0（否则白名单/断言都失去意义）
  for (const dep of ['@tanstack/react-virtual', 'lucide-react']) {
    assert.equal(importers(dep).length, 0, `${dep} 应报零 import`)
    assert.ok(!declared[dep], `${dep} 已在 T4 删除，不该又被声明回来`)
  }
})

// ============================================================ D-D class 合并只有一份（A-4 / P1）

test('D-D ⭐ class 合并**只有一份实现**（`cn()`）—— `cx.js` 不得复活（A-4 的收口）', () => {
  const ui = fs.readdirSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui'))
  const impls = ui.filter((f) => /^(cx|cn|classnames?|clsx)\.(js|ts)$/i.test(f))
  assert.deepEqual(impls, ['cn.js'], `ui/ 下应只有 cn.js 一份 class 合并实现，实得 ${JSON.stringify(impls)}`)

  // 全渲染层不许再有人从别处挪一个 cx 回来
  const strays = files
    .filter((f) => f.includes('renderer') && /\.(js|jsx)$/.test(f))
    .filter((f) => /from\s+['"][^'"]*\bcx\.js['"]/.test(maskComments(fs.readFileSync(f, 'utf8'))))
    .map(rel)
  assert.deepEqual(strays, [], `这些文件还在 import 已删除的 cx.js：${strays.join(', ')}`)
})

test('D-E `cn()` 真的用了 clsx + tailwind-merge（不是自己手拼字符串）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/cn.js'), 'utf8')
  assert.match(src, /from 'clsx'/, 'cn 必须用 clsx')
  assert.match(src, /from 'tailwind-merge'/, 'cn 必须用 tailwind-merge（消解同组工具类冲突）')
  assert.match(src, /twMerge\(clsx\(/, 'cn 的实现应是 twMerge(clsx(...))')
})

// ============================================================ D-F 无障碍缺口真的补上了

test('D-F ⭐ Chip 用的是 `aria-pressed` 语义，不只是 class（T4 补的无障碍缺口）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/Chip.jsx'), 'utf8')
  assert.match(src, /aria-pressed=\{active\}/, '切换按钮必须暴露 aria-pressed（class 名对屏幕阅读器不可见）')
})

test('D-G 确认弹窗真的用 Radix 的**可访问原语**（不是手写 overlay 冒充）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/ConfirmDialog.jsx'), 'utf8')
  // 这几件是手写 overlay 最容易漏、也最难自己实现的（角色 / 焦点陷阱 / ESC / 焦点归还）
  for (const prim of ['AlertDialog.Root', 'AlertDialog.Overlay', 'AlertDialog.Content', 'AlertDialog.Title', 'AlertDialog.Description', 'AlertDialog.Cancel', 'AlertDialog.Action']) {
    assert.ok(src.includes(prim), `确认弹窗必须用 ${prim}（换成普通 div 就丢了角色与焦点管理）`)
  }
  assert.match(src, /data-testid="confirm-dialog"/, '需要一个稳定的测试挂点（E2E / 断言都用它）')
})

test('D-H 破坏性操作走"请求 → 确认"，不再直接执行（取件会写文件）', () => {
  const page = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/pages/SearchPage.jsx'), 'utf8')
  assert.match(page, /onCollect=\{requestCollect\}/, '取件必须先经过 requestCollect（弹确认框）')
  assert.ok(!/onCollect=\{\(item\) => collect\(/.test(page), '不许再直接调 collect —— 那会绕过确认')
  assert.match(page, /<ConfirmDialog/, 'SearchPage 必须挂确认弹窗')
})

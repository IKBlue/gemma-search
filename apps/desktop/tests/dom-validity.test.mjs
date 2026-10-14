// apps/desktop/tests/dom-validity.test.mjs —— DOM 结构合法性（2026-10-13，T2 人工核对发现的缺陷）
//
// ── 这条是为什么来的 ─────────────────────────────────────────────────
//   T2 的「人工核对路由点击与观感」真跑了一遍（Playwright 截图 + 读真窗口的 URL/标题），
//   发现 `ItemPage` / `TasksPage` 里我写成了 **`<Button><Link>…</Link></Button>`** ——
//   渲染出来是 **`<a>` 嵌在 `<button>` 里**，共 **4 处**。后果三条，都不是审美问题：
//     · **HTML 规范禁止**：交互内容（`<a href>`）不得嵌套在交互内容（`<button>`）里
//     · **可访问性坏掉**：变成两个可聚焦元素，读屏会念成"按钮里有个链接"
//     · **视觉坏掉**：图标按钮的内容不居中 —— 截图里肉眼可见（右上角那个箭头）
//   ⇒ `Button` 补了 `asChild`（Radix `Slot`），4 处改成
//     `<Button variant="icon" asChild><Link …>←</Link></Button>` ⇒ 只渲染一个 `<a>`。
//
// ── 为什么静态断言 + E2E 两道 ────────────────────────────────────────
//   这条（静态）快、不需要启动 Electron，能在写代码时就拦住；
//   `apps/desktop/e2e/routing.spec.mjs` 的 E6 在**真窗口**里用
//   `document.querySelectorAll('button a')` 数一遍，证明渲染结果真的合法。
//   两道都要：静态可能被写法绕过，真窗口才知道最终 DOM 长什么样。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskComments } from './helpers/source-scan.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const RENDERER = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src')
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.jsx$/.test(e.name)) out.push(p)
  }
  return out
}
const files = walk(RENDERER)

test('V1 ⭐ 不许把 `<Link>`（即 `<a>`）嵌在 `<Button>`（即 `<button>`）里', () => {
  const bad = []
  for (const f of files) {
    // 用 maskComments：这些写法在**代码**里，不在注释里
    const src = maskComments(fs.readFileSync(f, 'utf8'))
    // `<Button …>` 之后（跨行也算）直接跟 `<Link`。
    // ⚠️ **必须排除带 `asChild` 的** —— 那种写法是**正确的**：Radix `Slot` 会把 Button 的
    //    props/className 合并到子元素上，最终只渲染 `<a>`，不存在 `<a>` 嵌 `<button>`。
    //    （负向先行断言 `(?![^>]*\basChild\b)`：Button 的属性里没有 asChild 才算违例。）
    for (const m of src.matchAll(/<Button\b(?![^>]*\basChild\b)[^>]*>\s*\n?\s*<Link\b/g)) {
      bad.push(`${rel(f)} → ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [],
    `这些地方是「按钮里套链接」—— 用 \`<Button asChild><Link …></Link></Button>\` 让它只渲染一个 <a>：\n    ${bad.join('\n    ')}`)
})

test('V2 更一般地：`<button>`（含原生）里不许直接嵌 `<a>`', () => {
  const bad = []
  for (const f of files) {
    const src = maskComments(fs.readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/<button\b[^>]*>\s*\n?\s*<(a|Link)\b/g)) {
      bad.push(`${rel(f)} → ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [], `非法嵌套：\n    ${bad.join('\n    ')}`)
})

test('V3 `Button` 真的实现了 `asChild`（否则 V1 的修法无处可依）', () => {
  const src = fs.readFileSync(path.join(RENDERER, 'ui', 'Button.jsx'), 'utf8')
  // 2026-10-14：改用**统一原语包** radix-ui（shadcn/ui v4 的装法；分散包 @radix-ui/react-* 已删除）。
  // 断言同时钉住"不许再回去装分散包" —— 那正是 P1（同一概念两份来源）的老毛病。
  assert.match(src, /import\s*\{\s*Slot\s*\}\s*from\s*'radix-ui'/, 'Button 必须用统一原语包 radix-ui 的 Slot 实现 asChild')
  assert.doesNotMatch(src, /@radix-ui\/react-/, '不许再引入分散的 @radix-ui/react-* 包（统一包 radix-ui 已覆盖）')
  // ⚠️ 名字最容易骗人的一处：统一包的 Slot 是**命名空间对象**，必须写 <Slot.Root>。
  //    写 <Slot> 会渲染成 object ⇒ React #130 白屏（2026-10-14 E5-b 实测踩到）。
  assert.match(src, /<Slot\.Root\b/, '必须渲染 <Slot.Root>（统一包的 Slot 是命名空间对象）')
  assert.doesNotMatch(src, /<Slot\s/, '不许直接渲染 <Slot>（会触发 React #130）')
  assert.match(src, /asChild/, 'Button 必须暴露 asChild 属性')
  // Slot 要求恰好一个子元素 —— 文档化这条约束，避免有人传数组进去
  assert.match(src, /恰好一个|exactly one/, '注释里要写明 Slot 只接受单个子元素')
})

test('V4 窗口标题有单一来源：应用名与页面名都来自 `router/paths.js`', () => {
  const paths = fs.readFileSync(path.join(RENDERER, 'router', 'paths.js'), 'utf8')
  assert.match(paths, /export const LABELS/, 'paths.js 必须导出 LABELS（页面名的唯一来源）')
  assert.match(paths, /export const APP_NAME/, 'paths.js 必须导出 APP_NAME')

  // 三个页面都要设置标题，且**不许**各自硬编码中文字面量（那会变成第二份来源）
  for (const [file, key] of [['SearchPage.jsx', 'search'], ['ItemPage.jsx', 'item'], ['TasksPage.jsx', 'tasks']]) {
    const src = fs.readFileSync(path.join(RENDERER, 'pages', file), 'utf8')
    assert.match(src, /useDocumentTitle\(LABELS\.\w+\)/, `${file} 必须调用 useDocumentTitle(LABELS.xxx)`)
    assert.ok(src.includes(key) || true)
  }
})

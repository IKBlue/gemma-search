// apps/desktop/tests/styles.test.mjs —— 样式纪律的**机械断言**（T3）
//
// 为什么这些是 `npm test` 里的断言、不是 `tools/verify_*.mjs` 守卫：
//   所有者 2026-10-13 的口径是「**不引用已删守卫，也不新建守卫**」。原 `verify_renderer_styles.mjs`
//   已删除，它覆盖的样式纪律改由本文件承接 —— 仓库已有先例（`permissions.test.mjs` 也是读源码断言）。
//
// 本文件承接的两条（都是**曾经真出过问题**的）：
//   ① **色值只有一处定义** —— 曾经的纪律是"组件里不写死十六进制"，靠人看。现在是断言。
//      2026-10-13 起 Tailwind 成了新的样式生成层，它**最容易**引入第二份色值（`bg-[#0071e3]`），
//      所以这条比之前更重要：`styles/tailwind.css` 里的映射**只允许**出现 `var(--…)`。
//   ② **F-02 界面不得自算分数阈值** —— 曾经 `ui/Score.jsx` 硬编码 `0.97/0.93`，
//      后果是**每次文本检索的全部结果都被标成「较弱」**（真实 top-1 只有 0.74–0.80）。
//      档位只能来自引擎的 `item.band`。原由已删守卫覆盖，现在钉在这里。
//
// ⚠️ 扫描一律经 `helpers/source-scan.mjs`（能区分代码与注释）——
//    否则注释里的 `#0071e3` 会被当成违例，检查会满屏假阳性然后被人关掉。见 `source-scan.test.mjs`。
// ⚠️⚠️ **本文件用 `maskComments`（只抹注释、保留字符串），不是 `maskNonCode`** ——
//    色值/类名这类违例**真实就写在字符串里**（`style={{ color: '#0071e3' }}`、`className="btn"`、
//    Tailwind 任意值 `bg-[#0071e3]`）。一开始用了 `maskNonCode`，**双向验证时注入 hex 却不变红** ——
//    那是一条空断言。两种掩码的区别见 `source-scan.mjs` 头部与 `source-scan.test.mjs` S9–S12。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskComments } from './helpers/source-scan.mjs'
import { cn, TEXT_SIZES } from '../src/renderer/src/ui/cn.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const RENDERER = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer')
const TOKENS = path.join(ROOT, 'packages', 'design-tokens', 'tokens.css')
const TAILWIND = path.join(RENDERER, 'src', 'styles', 'tailwind.css')

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/')
const read = (f) => fs.readFileSync(f, 'utf8')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx|css)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 色值字面量：hex / rgb() / rgba() / hsl() / hsla() */
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g

/** 在**代码**里找色值字面量，返回 `文件:值` 列表 */
function colorLiteralsIn(files) {
  const out = []
  for (const f of files) {
    const code = maskComments(read(f))
    for (const m of code.matchAll(COLOR_RE)) out.push(`${rel(f)} → ${m[0]}`)
  }
  return out
}

// ============================================================ ① 色值唯一

test('T1 ⭐ 渲染层**零**色值字面量：所有颜色都必须经 var(--…) 引用令牌', () => {
  const files = walk(RENDERER)
  assert.ok(files.length > 5, `扫不到渲染层文件（${files.length}）⇒ 路径写错了，检查失效`)

  const bad = colorLiteralsIn(files)
  assert.deepEqual(bad, [],
    `这些地方写死了颜色，必须改成引用 tokens.css 的令牌：\n    ${bad.join('\n    ')}`)
})

test('T1b 唯一定义处是 `packages/design-tokens/tokens.css`，且它**确实**定义了色值', () => {
  const literals = [...maskComments(read(TOKENS)).matchAll(COLOR_RE)]
  // 它必须**有**色值 —— 否则 T1 就变成了"全仓都没颜色"这种空断言
  assert.ok(literals.length >= 20, `tokens.css 应定义大量色值，实测 ${literals.length}`)
})

test('T1c ⭐ Tailwind 的 `@theme` 映射**只允许** `var(--…)`，不许出现字面值', () => {
  const css = maskComments(read(TAILWIND))
  const block = css.match(/@theme[^{]*\{([\s\S]*?)\n\}/)
  assert.ok(block, '找不到 @theme 块 ⇒ 文件结构变了，这条检查失效')

  const bad = []
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i)
    if (!m) continue
    const value = m[2].trim()
    if (!/^var\(--[a-z0-9-]+\)$/i.test(value)) bad.push(`${m[1]}: ${value}`)
  }
  assert.deepEqual(bad, [],
    `@theme 里的值必须是 var(--令牌)，否则就在 Tailwind 侧复制了第二份值：\n    ${bad.join('\n    ')}`)
})

// ============================================================ ② F-02 不得自算阈值

test('T2 ⭐ F-02：渲染层不得出现分数阈值常量（0.6~0.99）—— 档位只能来自引擎的 band', () => {
  const files = walk(RENDERER).filter((f) => /\.(js|jsx)$/.test(f))
  const bad = []
  for (const f of files) {
    const code = maskComments(read(f))
    for (const m of code.matchAll(/\b0\.[6-9]\d*\b/g)) bad.push(`${rel(f)} → ${m[0]}`)
  }
  assert.deepEqual(bad, [],
    `界面不许自己判分数档，档位只能取引擎的 item.band：\n    ${bad.join('\n    ')}`)
})

test('T2b F-02 的正向面：`ui/Score.jsx` 确实消费 `band`，且缺失时不猜', () => {
  const src = read(path.join(RENDERER, 'src', 'ui', 'Score.jsx'))
  assert.match(src, /band/, 'Score 必须消费 band')
  // 必须存在"band 不在已知档位里 ⇒ 不显示档位文案"的分支
  assert.match(src, /hasOwnProperty\.call\(BAND_TEXT/, '必须有"未知 band ⇒ 拒绝定档"的判定')
})

// ============================================================ ③ 旧类不得复活（P1）

test('T3 ⭐ 已迁到 Tailwind 的旧类名不得复活（`.btn` / `.icon-btn` / `.chip`）', () => {
  // 迁完后旧类**已从 renderer.css 删除**。若它们又出现，说明同时存在两套实现（P1）。
  const css = maskComments(read(path.join(RENDERER, 'src', 'renderer.css')))
  const revived = [...css.matchAll(/^\s*\.(btn|icon-btn|chip)\b[^{]*\{/gm)].map((m) => m[0].trim())
  assert.deepEqual(revived, [], `renderer.css 里不该再有这些类（已迁到 Tailwind）：\n    ${revived.join('\n    ')}`)

  // 也不许在组件里用字符串写死（那是绕过 Button/Chip 组件的裸用法）
  // ⚠️ 这里**必须**用 maskComments：类名就写在字符串里，maskNonCode 会把整条 json 抹掉 ⇒ 永远查不到
  const bare = []
  for (const f of walk(RENDERER).filter((x) => /\.(jsx|tsx)$/.test(x))) {
    const code = maskComments(read(f))
    for (const m of code.matchAll(/className=['"][^'"]*\b(btn|icon-btn|chip)\b[^'"]*['"]/g)) {
      bare.push(`${rel(f)} → ${m[0]}`)
    }
  }
  assert.deepEqual(bare, [], `不许绕过组件裸用旧类名：\n    ${bare.join('\n    ')}`)
})

// ============================================================ ④ 生成层确实接上了

test('T4 构建配置接了 `@tailwindcss/vite`，且入口在 renderer.css **之前**被 import', () => {
  const cfg = read(path.join(ROOT, 'electron.vite.config.mjs'))
  assert.match(cfg, /@tailwindcss\/vite/, '构建配置必须引 @tailwindcss/vite')
  assert.match(cfg, /plugins:\s*\[[^\]]*tailwindcss\(\)/, 'renderer 段的 plugins 里必须有 tailwindcss()')
  // 顺序是迁移期的约定：手写层要能覆盖工具类
  const main = read(path.join(RENDERER, 'src', 'main.jsx'))
  const iTw = main.indexOf("styles/tailwind.css")
  const iRc = main.indexOf("'./renderer.css'")
  assert.ok(iTw > 0, 'main.jsx 必须 import Tailwind 入口')
  assert.ok(iRc > 0 && iTw < iRc, `Tailwind 入口必须在 renderer.css 之前（实际 ${iTw} vs ${iRc}）`)
  // 入口文件里的 @source 必须覆盖组件目录，否则类名扫不到 ⇒ 工具类不生成
  assert.match(read(TAILWIND), /@source\s+"/, 'Tailwind 入口必须显式给出 @source')
})

// ============================================================ ⑤ cn() 的合并语义
//
// ⚠️ 这一组是 T4 真实踩坑后补的（E2E `styles.spec.mjs` 的 E4-a/b/d 抓到）：
// `tailwind-merge` **不认识我们的自定义字号**（`text-caption` 等），把它归进 `text-color` 的
// **通配组** ⇒ 与 `text-ink` 判为冲突、**丢掉字号**。症状是"构建通过、页面不白屏，
// 只有真窗口量计算样式才发现字变小了"。
// ⇒ 修法是 `extendTailwindMerge` 把那 8 个名字登记为 `font-size`；这一组断言就是它的回归锁。
// 它们**不需要 DOM**（`cn` 是纯函数），所以跑得比 E2E 快得多、也更早失败。

test('T5 ⭐ 自定义字号不会被 `cn()` 当颜色吃掉（T4 踩过的坑）', () => {
  for (const size of TEXT_SIZES) {
    const out = cn(`text-${size}`, 'text-ink')
    assert.ok(out.includes(`text-${size}`), `字号 text-${size} 被丢掉了 ⇒ 它被 twMerge 当成颜色。实得：${out}`)
    assert.ok(out.includes('text-ink'), `颜色 text-ink 被丢掉了。实得：${out}`)
  }
})

test('T5b `TEXT_SIZES` 与 `@theme` 的 `--text-*` 一一对应（加档位时别只改一边）', () => {
  const css = maskComments(read(TAILWIND))
  const declared = [...css.matchAll(/^\s*--text-([a-z0-9-]+)\s*:/gim)].map((m) => m[1])
  assert.deepEqual([...TEXT_SIZES].sort(), declared.sort(),
    `cn.js 的 TEXT_SIZES 与 tailwind.css 的 --text-* 不一致：\n  cn.js=${TEXT_SIZES}\n  theme=${declared}`)
})

test('T6 `tailwind-merge` 真的在消解同组冲突（这是它存在的唯一理由）', () => {
  // 同组后者胜 —— 若退化成纯 clsx，两个类都会留下，谁生效就取决于 CSS 顺序了
  assert.equal(cn('px-3', 'px-2'), 'px-2')
  assert.equal(cn('bg-surface', 'bg-ink'), 'bg-ink')
  // 不同组都要保留
  assert.equal(cn('px-3', 'py-2', 'text-caption'), 'px-3 py-2 text-caption')
  // 假值被丢掉
  assert.equal(cn('px-3', false, null, undefined, ''), 'px-3')
})

// tools/verify_renderer_styles.mjs —— 设计令牌纪律（渲染层）
//
// 为什么需要：docs/design/DESIGN-tokens.md §12 说「改令牌只改本文件和变量表，**不要在组件里写死十六进制**」，
// 但原先的 tools/verify_tokens.py 只查原型套件（现归档在 docs/archive/prototype/），
// 渲染层迁移到 React 后
// 没有任何守卫看着它 —— 于是很容易在 JSX/CSS 里冒出孤立色值和内联视觉值。
//
// 本守卫查四件事（前三条是硬失败，第四条只报告）：
//   ① 渲染层的 .css/.jsx 里不许出现 hex / rgb() / hsl() 颜色字面量
//   ② .jsx 里不许写内联样式（唯一例外：数据驱动的 width，例如进度条百分比）
//   ③ .css 里引用的每个 var(--x) 必须在 tokens.css 里有定义（悬空变量 = 打错的令牌名）
//   ④ 报告 .css 里的裸 px 值，方便对照 DESIGN-tokens §4.1 的 4pt 阶梯（不判失败）
//
// 用法：node tools/verify_renderer_styles.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 packages/engine/src/engine.mjs）');
    p = up;
  }
})();

const SRC = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src');
const TOKENS = path.join(ROOT, 'packages', 'design-tokens', 'tokens.css');

const problems = [];
const notes = [];
const ok = (cond, label, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) problems.push(label);
};

/** 递归收集文件 */
function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p);

/** 扫之前先剥掉注释：注释里会写「不要用 #fff」「只用 var(--space-*)」这类示例，别当成违规 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const cssFiles = walk(SRC, ['.css']);
const jsxFiles = walk(SRC, ['.jsx']);

console.log('='.repeat(96));
console.log('渲染层令牌纪律（docs/design/DESIGN-tokens.md §12）');
console.log(`  CSS ${cssFiles.length} 个 · JSX ${jsxFiles.length} 个 · 令牌表 ${rel(TOKENS)}`);

// ---------------------------------------------------------------- ① 颜色字面量
console.log('\n--- 1) 颜色字面量（hex / rgb / hsl）---');
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
for (const f of [...cssFiles, ...jsxFiles]) {
  const lines = stripComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/);
  const hits = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => COLOR_RE.test(l))
    // 注释里的示例不算（本文件的说明性注释）
    .filter(([, l]) => !/^\s*(\/\*|\*|\/\/)/.test(l));
  ok(hits.length === 0, `${rel(f)} 无颜色字面量`, hits.slice(0, 3).map(([n, l]) => `${n}: ${l.trim()}`).join(' | '));
}

// ---------------------------------------------------------------- ② 内联样式
console.log('\n--- 2) 内联样式（只允许数据驱动的 width）---');
for (const f of jsxFiles) {
  const hits = fs.readFileSync(f, 'utf8').split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /style=\{\{/.test(l))
    .filter(([, l]) => !/style=\{\{\s*width:/.test(l));
  ok(hits.length === 0, `${rel(f)} 无内联视觉值`, hits.map(([n, l]) => `${n}: ${l.trim()}`).join(' | '));
}

// ---------------------------------------------------------------- ③ 悬空变量
console.log('\n--- 3) var(--x) 是否都在令牌表里有定义 ---');
const tokenText = fs.readFileSync(TOKENS, 'utf8');
const defined = new Set([...tokenText.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Map();
for (const f of cssFiles) {
  for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/var\((--[a-z0-9-]+)\s*[),]/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(rel(f));
  }
}
const dangling = [...used.keys()].filter((v) => !defined.has(v));
ok(dangling.length === 0, `${used.size} 个令牌引用全部有定义`,
  dangling.length ? `悬空：${dangling.join(', ')}` : '');

// ---------------------------------------------------------------- ④ 裸 px 报告（不判失败）
console.log('\n--- 4) 裸 px 报告（对照 §4.1 的 4pt 阶梯；仅提示）---');
const SCALE = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96, 1500, 44, 999]);
let rawCount = 0;
for (const f of cssFiles) {
  const offScale = [];
  stripComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(/(\d+)px/g)) {
      rawCount += 1;
      const v = Number(m[1]);
      // 1px/2px 描边、999px 药丸、容器上限等按约定放行
      if (!SCALE.has(v)) offScale.push(`${i + 1}:${m[0]}`);
    }
  });
  if (offScale.length) notes.push(`${rel(f)} 有 ${offScale.length} 处不在阶梯上的 px：${offScale.slice(0, 8).join(', ')}`);
}
console.log(`  裸 px 共 ${rawCount} 处；不在 4pt 阶梯上的：${notes.length ? '' : '无'}`);
for (const n of notes) console.log('  · ' + n);

console.log('\n' + '='.repeat(96));
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('渲染层令牌纪律通过（无死颜色 · 无内联视觉值 · 无悬空变量）。');
if (notes.length) console.log(`另有 ${notes.length} 条阶梯外 px 提示（见上，不判失败）。`);

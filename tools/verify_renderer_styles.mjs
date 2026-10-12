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
// ⚠️ 渲染层不只有 .jsx：`hooks/*.js`（useSearch / useEngine / useLibraryConfig）同样是渲染层。
// 原先只扫 .jsx/.css ⇒ 把阈值写进 .js 就能绕过 §5（独立复核 I-4 实测）。
const jsFiles = walk(SRC, ['.js']);

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

// ---------------------------------------------------------------- ③b 分数阈值不得落在渲染层（F-02）
//
// 为什么这条属于"令牌纪律"而不是别处：`band` 与颜色令牌是同一类东西 ——
// **一个由引擎统一决定的视觉语义**。界面自己再算一套阈值，就等于又定义了一份"什么是高相关"，
// 与 `docs/spec/CONTRACT-engine-v1.md` §2.1「界面只能用引擎给的 band」直接冲突。
//
// 这条以前只写在 Score.jsx 的注释里、靠人手 grep。注释不是守卫 —— 2026-10-12 的独立复核
// 就是这么指出的（B-2）。现在它真的会被执行。
//
// 判定范围：渲染层里出现 `0.7x / 0.8x / 0.9x` 这种**比值常量**。
// 为什么不用更窄的模式：阈值可以写成任何名字（`HIGH`、`SCORE_MIN`…），
// 而渲染层**本来就不需要**任何 0.7–0.99 的比值来做别的（尺寸用整数、透明度用 0–1 但通常写 0.5/0.8…）。
// ⚠️ 已知代价：0.8 之类的**透明度**会被误报。若将来真的需要，请把该值提成设计令牌
// （`packages/design-tokens/tokens.css`），而不是在这里开白名单 —— 令牌才有唯一出处。
console.log('\n--- 5) 渲染层不得自算分数阈值（F-02）---');
// ⚠️ 模式要**同时**认带前导零与不带的写法（独立复核 I-6）：
//   0.97 / 0.93（历史写法）· **.97 / .93**（省前导零，很常见，旧模式 `\b0\.` 会放行）
// 同时也认 `97/100` 这种比值写法。故意**不**追求完备（那要真做数据流分析）——
// 这里的目标是"让又有人开始自算阈值这件事在守卫里一眼可见"，不是形式化证明。
const SCORE_THRESHOLD_PATTERNS = [
  /(?<![\w.])(?:0)?\.[789]\d*(?![\w])/,   // .97 / 0.97 / 0.975
  /\b(?:9[0-9]|8[5-9])\s*\/\s*100\b/,      // 97/100、88/100
];
const thresholdHits = [];
for (const f of [...jsxFiles, ...jsFiles, ...cssFiles]) {   // ⚠️ 含 .js（I-4：hooks/useSearch.js 也是渲染层）
  stripComments(fs.readFileSync(f, 'utf8')).split(/\r?\n/).forEach((line, i) => {
    for (const re of SCORE_THRESHOLD_PATTERNS) {
      const m = line.match(re);
      if (m) { thresholdHits.push(`${rel(f)}:${i + 1}  ${m[0]}  ← ${line.trim().slice(0, 60)}`); break; }
    }
  });
}
ok(thresholdHits.length === 0,
  '渲染层没有 0.7x/0.8x/0.9x 比值常量（含 `.97` 省前导零写法；档位只能来自引擎的 band）',
  thresholdHits.length ? `发现 ${thresholdHits.length} 处（若确为透明度，请改用设计令牌）：\n      ${thresholdHits.join('\n      ')}` : '');
// 正例锚：确认 Score.jsx 确实在**用** band，否则"没有阈值"可能只是因为整个功能被删了
const scoreFile = path.join(SRC, 'ui', 'Score.jsx');
const scoreSrc = fs.existsSync(scoreFile) ? stripComments(fs.readFileSync(scoreFile, 'utf8')) : '';
ok(/band/.test(scoreSrc) && /BAND_TEXT/.test(scoreSrc),
  'Score.jsx 仍以 band 为档位来源（不是把功能删了来通过上一条）');
// 覆盖范围自证：确认 .js 真的进了扫描集（否则"扩到 .js"只是句空话）
ok(jsFiles.length > 0, `扫描集含 ${jsFiles.length} 个 .js 文件（hooks/*.js 也是渲染层）`,
  `jsx=${jsxFiles.length} js=${jsFiles.length} css=${cssFiles.length}`);

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

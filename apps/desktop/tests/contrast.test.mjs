// apps/desktop/tests/contrast.test.mjs —— C 类防线：WCAG 对比度（由**令牌计算**，不手算）
//
// ── 为什么要有它（Apple Style 审查里的一整类）────────────────────────────
//   审查 42 条里有 4 条是"颜色本身不可读"，而它们的共同点是：
//   **在代码里完全合法**（令牌名对、类名对、构建通过），只有**算出来**才知道不达标。
//   人眼看浅底上的红/绿也常常"觉得还行" —— 交给脚本。
//     · V-03 结果区主信号（分数档位）2.06–2.22:1，远低于 4.5:1
//     · V-05 4 个分类标签 11px 前景 3.96–4.29:1
//     · V-06 深色模式 CR+VR 标签 **2.55:1**
//     · V-43（本轮**新发现**，不在原 42 条里）：`.toast.err` 白字压 `--color-critical` = **3.55:1**
//   判据出处：**WCAG 2.2 SC 1.4.3**（正文 4.5:1）与 **SC 1.4.11**（非文字 3:1）。
//   ⚠️ 阈值**不在这里发明**（`reports/README.md` 的明文要求）—— 上面两个 SC 号就是出处。
//
// ── 与 `styles.test.mjs` 的分工（别读重了）────────────────────────────────
//   `styles.test.mjs` 管**结构**：色值只有一处定义、@theme 只许 var()、字号不被吃掉。
//   本文件管**可读性**：把令牌两两配对算对比度。两者互补，不重复。
//
// ── 实现要点：必须能合成 `color-mix(… , transparent)` ─────────────────────
//   分类标签的底色是 `color-mix(in srgb, var(--color-success) 14%, transparent)` ——
//   **半透明**，它的"实际颜色"取决于底下是什么。不合成就会算出一个不存在的比值。
//   （这正是审查报告 §4.1 用 `over()` 做的事。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../../../packages/design-tokens/tokens.css', import.meta.url));
const css = fs.readFileSync(TOKENS, 'utf8');

/** 取 marker 之后的第一个 `{ … }` 块（配平括号） */
function blockAfter(marker, from = 0) {
  const i = css.indexOf(marker, from);
  if (i < 0) throw new Error(`找不到块：${marker}`);
  const start = css.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') { depth -= 1; if (depth === 0) return css.slice(start + 1, j); }
  }
  throw new Error(`块未闭合：${marker}`);
}
const parseVars = (text) => {
  const out = {};
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
};

const light = parseVars(blockAfter(':root {'));
// 深色有两处块（`@media (prefers-color-scheme: dark)` 与 `[data-theme="dark"]`），两套都要过
const darkBlocks = [];
{
  let at = 0;
  for (;;) {
    const i = css.indexOf('@media (prefers-color-scheme: dark)', at);
    const j = css.indexOf('[data-theme="dark"]', at);
    const next = [i, j].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    if (next === undefined) break;
    const marker = css.startsWith('[data-theme="dark"]', next) ? '[data-theme="dark"]' : '@media (prefers-color-scheme: dark)';
    darkBlocks.push(parseVars(blockAfter(marker, next)));
    at = next + marker.length;
  }
}
if (darkBlocks.length < 2) throw new Error(`深色块应有 2 个（media + data-theme），实得 ${darkBlocks.length}`);

// ── 颜色工具（WCAG 2.2 的定义，别自己发明公式）──────────────────────────
const chan = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
/** alpha 合成：把前景按 alpha 压在背景上（`over()`） */
const over = (fg, alpha, bg) => ({
  r: fg.r * alpha + bg.r * (1 - alpha),
  g: fg.g * alpha + bg.g * (1 - alpha),
  b: fg.b * alpha + bg.b * (1 - alpha),
});

/**
 * 解析一个令牌到**不透明的 rgb**。
 * 支持三形态：十六进制字面量 · `var(--x)` 链 · `color-mix(in srgb, var(--x) N%, transparent)`。
 * 第三种必须按底色合成 —— 否则算出来的比值不是屏幕上真实的那个。
 */
function resolve(name, vars, backdrop, depth = 0) {
  if (depth > 12) throw new Error(`var 链太深：${name}`);
  const raw = vars[name] ?? light[name];
  if (raw === undefined) throw new Error(`令牌不存在：${name}（拼错了吗？）`);
  const v = raw.trim();
  if (v.startsWith('#')) return hex2rgb(v);
  const mx = /^color-mix\(in srgb,\s*var\((--[a-z0-9-]+)\)\s*([\d.]+)%\s*,\s*transparent\)/i.exec(v);
  if (mx) {
    const base = resolve(mx[1], vars, backdrop, depth + 1);
    return over(base, Number(mx[2]) / 100, backdrop);
  }
  const vr = /^var\((--[a-z0-9-]+)\)/.exec(v);
  if (vr) return resolve(vr[1], vars, backdrop, depth + 1);
  throw new Error(`看不懂的令牌值：${name} = ${v}`);
}

/**
 * 要守的配对。**每一条都写清它守的是哪条违规 / 哪个 SC**。
 * `min` 一律来自 SC：正文 4.5（1.4.3 AA）· 非文字 3.0（1.4.11 AA）。
 */
const PAIRS = [
  { id: '正文 / 主背景', fg: '--color-text-primary', bg: '--color-bg-primary', min: 4.5, sc: '1.4.3', why: '基线' },
  { id: '错误正文 / 主背景', fg: '--color-critical-text', bg: '--color-bg-primary', min: 4.5, sc: '1.4.3', why: 'V-15' },
  { id: '分类标签 VR', fg: '--cat-vr-fg', bg: '--cat-vr-bg', min: 4.5, sc: '1.4.3', why: 'V-05' },
  { id: '分类标签 CR', fg: '--cat-cr-fg', bg: '--cat-cr-bg', min: 4.5, sc: '1.4.3', why: 'V-05' },
  { id: '分类标签 CR+VR', fg: '--cat-crvr-fg', bg: '--cat-crvr-bg', min: 4.5, sc: '1.4.3', why: 'V-06（深色曾 2.55）' },
  { id: '分类标签 其他', fg: '--cat-other-fg', bg: '--cat-other-bg', min: 4.5, sc: '1.4.3', why: 'V-05' },
  { id: '分类标签 未分类', fg: '--cat-uncat-fg', bg: '--cat-uncat-bg', min: 4.5, sc: '1.4.3', why: 'V-05 / V-07' },
  { id: '分数档 high（文字）', fg: '--score-same', bg: '--color-bg-primary', min: 4.5, sc: '1.4.3', why: 'V-03' },
  { id: '分数档 mid（文字）', fg: '--score-like', bg: '--color-bg-primary', min: 4.5, sc: '1.4.3', why: 'V-03' },
  { id: '错误 toast 文字', fg: '--color-on-accent', bg: '--toast-err-bg', min: 4.5, sc: '1.4.3', why: 'V-43（本轮新发现）' },
  // ⚠️ V-44（本轮新发现，不在原 42 条里）：状态圆点是 **8px 非文字图形** ⇒ 阈值是 SC 1.4.11 的 **3.0**
  //    （不是 4.5）。原先它用 `--color-success` #34c759，压在浅色侧栏底上只有 **2.22:1** ⇒ 不达标。
  //    已改用可读变体 `--color-*-text`。**注意阈值不同** —— 别把非文字图形按正文阈值要求，
  //    也别反过来把它当正文放过。
  { id: '状态圆点 ok（非文字）', fg: '--color-success-text', bg: '--sidebar-bg', min: 3.0, sc: '1.4.11', why: 'V-44' },
  { id: '状态圆点 warn（非文字）', fg: '--color-warning-text', bg: '--sidebar-bg', min: 3.0, sc: '1.4.11', why: 'V-44' },
  { id: '状态圆点 err（非文字）', fg: '--color-critical-text', bg: '--sidebar-bg', min: 3.0, sc: '1.4.11', why: 'V-44' },
];

function evaluate(mode, vars, backdropName) {
  const backdrop = resolve(backdropName, vars, hex2rgb('#ffffff'));
  const rows = [];
  for (const p of PAIRS) {
    const bgVar = p.bg;
    // 半透明底色要压在"它实际所处的那个面"上：这里统一按该模式的 surface 合成
    const bg = p.bg.startsWith('--cat-') ? resolve(bgVar, vars, backdrop) : resolve(bgVar, vars, backdrop);
    const fg = resolve(p.fg, vars, bg);
    rows.push({ ...p, value: ratio(fg, bg) });
  }
  return rows;
}

test('CT-1 ⭐⭐ 令牌配对的对比度必须达 WCAG AA（浅色）', () => {
  const rows = evaluate('light', light, '--color-bg-primary');
  const bad = rows.filter((r) => r.value < r.min);
  const table = rows.map((r) => `${r.value.toFixed(2).padStart(5)}  ≥${r.min}  ${r.value < r.min ? '✖' : '✔'}  ${r.id}  [${r.sc}] ${r.why}`).join('\n    ');
  assert.deepEqual(bad.map((r) => `${r.id} = ${r.value.toFixed(2)} < ${r.min}`), [],
    `浅色档有不达标的配对（阈值来自 WCAG 2.2，不是这里定的）：\n    ${table}\n`);
});

test('CT-2 ⭐⭐ 令牌配对的对比度必须达 WCAG AA（深色，两套块都要过）', () => {
  const failures = [];
  darkBlocks.forEach((vars, i) => {
    const which = i === 0 ? '@media prefers-color-scheme' : '[data-theme="dark"]';
    for (const p of PAIRS) {
      const backdrop = resolve('--color-bg-primary', vars, hexToRgbSafe('#000000'));
      const bg = resolve(p.bg, vars, backdrop);
      const fg = resolve(p.fg, vars, bg);
      const v = ratio(fg, bg);
      if (v < p.min) failures.push(`${which} · ${p.id} = ${v.toFixed(2)} < ${p.min} [${p.sc}] ${p.why}`);
    }
  });
  assert.deepEqual(failures, [], '深色档有不达标的配对：\n    ' + failures.join('\n    '));
});

function hexToRgbSafe(h) { return hex2rgb(h); }

test('CT-0 自检：配对表非空、令牌都解析得出来（否则上面两条恒真）', () => {
  assert.ok(PAIRS.length >= 8, `配对只有 ${PAIRS.length} 条，太少了`);
  // ⚠️ 不写死 `=== 2`：文件里除两套主深色块外还有变体块（如固定深色侧栏）。
  //    CT-2 会把扫到的**每一块**都算一遍 ⇒ 块越多覆盖越广，不该因此判自检失败。
  assert.ok(darkBlocks.length >= 2, `深色块应至少 2 个（media + data-theme），实得 ${darkBlocks.length}`);
  for (const p of PAIRS) {
    const backdrop = resolve('--color-bg-primary', light, hexToRgbSafe('#ffffff'));
    resolve(p.fg, light, backdrop);
    resolve(p.bg, light, backdrop);
  }
});

// ⭐ 这条是审查建议里的"键集合相同"回归锁（`违规的UI.md` V-06 收口建议）。
//    实测踩过：`--cat-crvr-bg/-fg` 只在 `@media` 块里补了、`[data-theme="dark"]` 块漏了
//    ⇒ 固定深色主题下 V-06 依旧（前景只有 3.47:1）。**两套块必须同键**。
test('CT-3 ⭐ 两套深色块的**键集合必须一致**（V-06 那类漂移的回归锁）', () => {
  const mediaVars = darkBlocks[0];
  const themeVars = darkBlocks[1];
  const keysOf = (o) => new Set(Object.keys(o));
  const a = keysOf(mediaVars);
  const b = keysOf(themeVars);
  const onlyMedia = [...a].filter((k) => !b.has(k));
  const onlyTheme = [...b].filter((k) => !a.has(k));
  assert.deepEqual(
    { 只在media: onlyMedia, 只在dataTheme: onlyTheme },
    { 只在media: [], 只在dataTheme: [] },
    '两套深色块的键集合不一致 ⇒ 某一套里改过的令牌在另一套里没跟上（V-06 就是这么发生的）。\n'
    + '修法：把缺的键补到另一套，值保持一致。',
  );
});

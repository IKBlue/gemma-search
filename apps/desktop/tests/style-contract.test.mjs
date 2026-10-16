// apps/desktop/tests/style-contract.test.mjs —— 「界面写的类名 ↔ 样式层」契约断言
//
// ── 为什么要有这个文件（2026-10-13 Apple Style 审查的根因归纳）────────────────
//   审查的 42 条违规里有**一整类**是同一个病：**界面用了某个类/属性，样式层却没有对应规则**，
//   于是它**静默失效** —— 不报错、不白屏、只是"看起来没生效"：
//     · V-17 `text-err` —— `@theme` 里没有 `--color-err` ⇒ Tailwind 不生成这个类 ⇒ 颜色完全没变
//     · V-15 裸 `className="err"` —— CSS 里只有 `.toast.err`（复合选择器）⇒ 单独用没有规则
//     · V-04 `data-tone="ok"` —— 界面输出了属性，全仓 CSS **没有任何** `[data-tone]` 规则
//   这类病**只能靠机械断言防**：它不报错，人眼也容易漏（V-17 就是靠"读代码"才发现 `--color-err` 不存在）。
//
// ── ⚠️ 判据为什么**刻意只有两条**（这是本文件最重要的设计决定）────────────────
//   第一版想做"界面出现的**每个**类名都必须有定义"。**实测不成立**：
//   一次性测量（脚本未入库）显示 177 个 token 里 27 个"不认识"，
//   而其中绝大多数是**测量的伪影**，不是真问题 ——
//     · 粗提取把三元表达式的**结果串**当成了类名（`ok` / `warn` / `done` / `now` / `loading`）
//     · 把模板串残片当类名（`show${tone` / `text-ink${mono`）
//     · 没识别合法的 Tailwind 变体与常用工具类（`md:grid-cols-2` / `lg:w-1/2` / `first:border-t-0` / `font-semibold` / `border-b`）
//   ⇒ 硬做就得堆一大张白名单，而**白名单一大，防线就废了**（没人敢往里加东西，最后被关掉）。
//   ⇒ 所以这里只做两条**判据精确**的检查，并且**如实写明它们不覆盖什么**（见文件末尾）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';

const SRC = fileURLToPath(new URL('../src/renderer/src/', import.meta.url));
const CSS_FILE = path.join(SRC, 'renderer.css');
const TW_FILE = path.join(SRC, 'styles', 'tailwind.css');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(jsx|js|ts|tsx)$/.test(e.name) ? [p] : []; // 全量 TS 迁移：扫描面必须含 .ts/.tsx
  });
}
const rel = (p) => p.replace(/\\/g, '/').split('/src/renderer/src/')[1];

/** 从 `className={ ... }` 里取完整的大括号内容（要计数配对，不能 `[^}]*`） */
function braceBody(src, start) {
  let d = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') d += 1;
    else if (src[i] === '}') {
      d -= 1;
      if (d === 0) return src.slice(start + 1, i);
    }
  }
  return '';
}

/** 取一个文件里所有 className 的**文本值**（模板插值先挖掉，避免 `x${y}z` 这种残片） */
function classBodies(file) {
  const masked = maskComments(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const m of masked.matchAll(/\bclassName\s*=\s*(?:"([^"]*)"|\{)/g)) {
    if (m[1] !== undefined) {
      out.push(m[1]);
      continue;
    }
    const body = braceBody(masked, m.index + m[0].length - 1);
    out.push(body.replace(/\$\{[^}]*\}/g, ' ')); // 挖掉插值，别把残片当类名
  }
  return out;
}

/** 某个文件里 className 用到的 token（含三元/`&&` 里的字符串字面量） */
function classTokens(file) {
  const toks = new Set();
  for (const body of classBodies(file)) {
    // 字符串字面量里的整串 + 裸文本（`className="a b"` 直写的情形）
    const chunks = [body.replace(/['"`]/g, ' ')];
    for (const s of body.matchAll(/['"`]([^'"`]*)['"`]/g)) chunks.push(s[1]);
    for (const c of chunks)
      for (const t of c.split(/\s+/)) if (t && /^[\x21-\x7e]+$/.test(t)) toks.add(t);
  }
  return toks;
}

const css = fs.readFileSync(CSS_FILE, 'utf8');
const tw = fs.readFileSync(TW_FILE, 'utf8');
const themeTokens = new Set([...tw.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
/** `renderer.css` 里以 `.X` 形式出现的类名 */
const cssClasses = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

/**
 * 在**某一次实际的 `className` 用法**下，这个类拿不拿得到样式？
 *
 * @param {string} cssText
 * @param {string} tok        待判的类
 * @param {Set<string>} siblings **同一个 className 字面量里的其它类**
 *
 * ⚠️ 为什么要 `siblings`（这是本条判据的最后一个坑，实测踩到）：
 *   `Gallery.jsx:31` 写的是 `className="panel empty"`，CSS 是 `.panel.empty` ——
 *   两个类**都在同一个元素上**，样式**拿得到**，**不是缺陷**。
 *   只按单个 token 判会把它误报成"只在复合选择器里出现"。
 *   ⇒ 判据必须看**实际的那一次用法**里有没有带来所需的同伴类。
 */
function tokenGetsStyle(cssText, tok, siblings) {
  const flat = cssText.replace(/\{[^{}]*\}/g, '{}');
  const partHas = new RegExp(`\\.${tok.replace(/[-]/g, '\\-')}(?![\\w-])`);
  let sawSoloPart = false;
  let sawCompanionPart = false;
  for (const m of flat.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      for (const part of sel.split(/[\s>+~]+/)) {
        if (!partHas.test(part)) continue;
        const classesInPart = [...part.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((x) => x[1]);
        if (classesInPart.length <= 1)
          sawSoloPart = true; // 独自出现（可带标签/伪类）⇒ 有效
        else if (classesInPart.some((c) => c !== tok && siblings.has(c))) sawCompanionPart = true; // 这一次用法带了同伴 ⇒ 有效
      }
    }
  }
  return sawSoloPart || sawCompanionPart;
}

// ═══════════════════════════════════════════════════ 判据一：Tailwind 令牌类必须真能生成
// `text-err` 这类"看起来是颜色/字号、其实 @theme 里没有"的类，Tailwind **不会报错**，只是不生成。
// 白名单只收 Tailwind 自己的**无令牌特例**，逐条写清为什么 —— 它必须保持**小**。
const TAILWIND_SPECIALS = new Set([
  'text-left',
  'text-center',
  'text-right',
  'text-justify',
  'text-start',
  'text-end', // 对齐
  'text-wrap',
  'text-nowrap',
  'text-balance',
  'text-pretty',
  'text-ellipsis',
  'text-clip', // 折行/截断
  'bg-none',
  'bg-cover',
  'bg-contain',
  'bg-center',
  'bg-top',
  'bg-bottom',
  'bg-fixed',
  'bg-local',
  'bg-clip-text',
  'bg-clip-border',
  'bg-clip-padding',
  'bg-clip-content',
  'border-collapse',
  'border-separate',
  'border-solid',
  'border-dashed',
  'border-dotted',
  'border-double',
  'border-none',
  'border-hidden',
  'outline-none',
  'outline-hidden',
  'outline-solid',
  'outline-dashed',
  'outline-dotted',
  'outline-double',
  'divide-solid',
  'divide-dashed',
  'divide-dotted',
  'divide-double',
  'divide-none',
  // ⚠️ 方向型是 **宽度** 工具（`border-b` = `border-bottom-width:1px`），**永远不需要颜色令牌**。
  //    第一版漏了它们 ⇒ 6 条假阳性（实测）。判据只关心"颜色/字号这类**必须查令牌**"的类。
  'border-b',
  'border-t',
  'border-l',
  'border-r',
  'border-x',
  'border-y',
  'border-s',
  'border-e',
  'divide-x',
  'divide-y',
  'fill-none',
  'stroke-none',
  'ring-inset',
]);

test('SC-1 ⭐ Tailwind 的 `text-*`/`bg-*`/`border-*` 类必须能真的生成（否则静默失效）', () => {
  const bad = [];
  for (const file of walk(SRC)) {
    for (const tok of classTokens(file)) {
      const m = /^(text|bg|border|fill|stroke|ring|divide|outline|shadow)-(.+)$/.exec(tok);
      if (!m) continue;
      const [, prefix, name] = m;
      if (TAILWIND_SPECIALS.has(tok)) continue;
      if (name.startsWith('[') || name.startsWith('(')) continue; // 任意值 bg-[...] / 函数式
      if (
        /^\d/.test(name) ||
        /^(0|px|full|auto|screen|none|inherit|current|transparent|hidden|visible)$/.test(name)
      )
        continue;
      if (name.startsWith('[')) continue;
      // 变体已被 token 切分排除；这里只认「前缀 + 令牌名」两段形态
      if (name.includes(':') || name.includes('/')) continue;
      const ok =
        themeTokens.has(`--color-${name}`) ||
        themeTokens.has(`--text-${name}`) ||
        themeTokens.has(`--${prefix}-${name}`) ||
        themeTokens.has(`--shadow-${name}`) ||
        themeTokens.has(`--radius-${name}`);
      if (!ok) bad.push(`${rel(file)}  →  ${tok}`);
    }
  }
  assert.deepEqual(
    bad.sort(),
    [],
    '以下类名在 @theme 里找不到对应令牌 ⇒ Tailwind **不会生成**它，界面上完全没效果（静默失效）。\n' +
      '修法二选一：① 在 `styles/tailwind.css` 的 @theme 里补令牌；② 换成已存在的类。\n  ' +
      bad.join('\n  '),
  );
});

/** 只取 **`className="字面量"`** 这一种形态（不含表达式）—— 见 SC-2 的注释说明为什么要收窄 */
function plainClassBodies(file) {
  const masked = maskComments(fs.readFileSync(file, 'utf8'));
  return [...masked.matchAll(/\bclassName\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════ 判据二：单独使用的类必须有规则
/**
 * **带理由的显式豁免**（键 = `文件|类名`）。
 *
 * ⚠️ SC-2 是**纯静态**检查，它看不见"组件内部把 className 合成成什么"。
 *    所以凡是通过**组件封装**才凑齐复合选择器的用法，必须在这里逐条写明理由 —— 不许用"整个文件跳过"这种粗豁免。
 * ⚠️ 并且**豁免必须仍然命中**（见 SC-2 末尾的自检）：不命中的豁免说明代码已经改了，
 *    留着它只会让白名单慢慢烂掉 —— 本仓库反复栽在这上面（"白名单一大，防线就废了"）。
 */
const EXEMPT = new Map([
  [
    'search/SearchPanel.tsx|auto',
    "`ui/Field.tsx:4` 写的是 ['field', className].filter(Boolean).join(' ') ⇒ 实际渲染出 class=\"field auto\"，" +
      '`renderer.css:163` 的 `.field.auto { width: auto }` **生效**。静态检查看不见组件内部的合成，故豁免。',
  ],
  // ⚠️ 2026-10-15（P4-2）：浏览页两处筛选下拉是**同一个组件、同一条规则**（`<Field className="auto">`），
  //    理由与上一条**逐字相同**（同一个 Field、同一条 .field.auto 规则、同样的静态看不见）。
  //    这里只写「同上」而不重复一遍理由 —— 重复一遍就是同一份解释的第二处实现（P1）。
  [
    'pages/BrowsePage.tsx|auto',
    '同上：`ui/Field.tsx` 内部合成出 class="field auto"，`renderer.css` 的 `.field.auto` 生效。',
  ],
]);

test('SC-2 ⭐ `className="字面量"` 里的每个类都必须真有规则（只作复合选择器一部分的类，单独用无效）', () => {
  const bad = [];
  const usedExempt = new Set();
  for (const file of walk(SRC)) {
    for (const body of plainClassBodies(file)) {
      const toks = body.split(/\s+/).filter((t) => t && /^[\x21-\x7e]+$/.test(t));
      const sib = new Set(toks);
      for (const tok of toks) {
        if (!cssClasses.has(tok)) continue; // CSS 里根本没有 ⇒ 可能是 Tailwind 工具类，不属本判据
        if (tokenGetsStyle(css, tok, sib)) continue; // 这一次用法下拿得到样式 ⇒ 正常
        const key = `${rel(file)}|${tok}`;
        if (EXEMPT.has(key)) {
          usedExempt.add(key);
          continue;
        }
        bad.push(`${rel(file)}  →  ${tok}（同一 className 里只有：${toks.join(' ')}）`);
      }
    }
  }
  const stale = [...EXEMPT.keys()].filter((k) => !usedExempt.has(k));
  assert.deepEqual(
    stale,
    [],
    `以下豁免**已经不命中**了（代码改过了）⇒ 必须删掉，否则白名单会烂掉：${stale.join(', ')}`,
  );
  assert.deepEqual(
    bad.sort(),
    [],
    '以下类名在 CSS 里**只**出现在"同一元素还有别的类"的选择器里（如 `.toast.err` 的 `err`）⇒\n' +
      '这一次用法下**拿不到任何样式**（静态看着"有定义"，实际静默失效 —— 正是 V-15）。\n' +
      '修法：补一条独立规则、改用复合选择器要求的父元素结构，或在 EXEMPT 里**写明理由**豁免。\n  ' +
      bad.join('\n  '),
  );
});

// ═══════════════════════════════════════════════════ 判据三：输出的 data-* 语气属性必须有规则
test('SC-3 ⭐ 界面输出的 `data-tone` 值必须在 CSS 里有对应规则（否则"设计了但没渲染"）', () => {
  const emitted = new Set();
  for (const file of walk(SRC)) {
    const masked = maskComments(fs.readFileSync(file, 'utf8'));
    for (const m of masked.matchAll(/data-tone\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g)) {
      if (m[1]) emitted.add(m[1]);
      if (m[2]) for (const s of m[2].matchAll(/['"`]([^'"`]*)['"`]/g)) emitted.add(s[1]);
    }
  }
  if (emitted.size === 0) return; // 没有输出就不适用
  const missing = [...emitted].filter((v) => !new RegExp(`\\[data-tone=["']?${v}`).test(css));
  assert.deepEqual(
    missing,
    [],
    `界面输出了 data-tone=${missing.join('/')}，但 renderer.css 里没有对应的 [data-tone="…"] 规则 ⇒ 属性白输出了。\n` +
      '修法：补 `[data-tone="…"]` 规则，颜色取令牌。（这正是审查 V-04：索引状态四档徽标长得一模一样。）',
  );
});

// ═══════════════════════════════════════════════════ 自检：断言不是空的
test('SC-0 自检：扫描面覆盖到东西（否则上面三条恒真）', () => {
  const files = walk(SRC);
  assert.ok(files.length >= 40, `渲染层文件数 ${files.length} 偏少，扫描面可能坏了`);
  assert.ok(cssClasses.size >= 50, `renderer.css 类名数 ${cssClasses.size} 偏少，解析可能坏了`);
  assert.ok(
    themeTokens.size >= 20,
    `tailwind @theme 令牌数 ${themeTokens.size} 偏少，解析可能坏了`,
  );
  const all = new Set();
  for (const f of files) for (const t of classTokens(f)) all.add(t);
  assert.ok(all.size >= 100, `提取到的类名 token 只有 ${all.size} 个，提取逻辑可能坏了`);
});

// ───────────────────────────────────────────── 本文件**不覆盖**什么（如实写明）
// · **不检查** Tailwind 变体与常用工具类的**合法性**（`md:`/`lg:`/`hover:`/`font-semibold`/`border-b`…）——
//   要正确识别它们需要一份 Tailwind 自己的工具表或构建产物；本文件刻意不引（会把断言变成构建依赖）。
// · **不检查** 计算后的**视觉效果**（对比度、尺寸、是否被覆盖）—— 那是 `contrast` 与 E2E 的职责，
//   以及审查里的 C 类问题（V-03/V-05/V-06）。
// · **不检查** "条件类表达式恒假"（审查 V-01：`cn(x, false) || undefined`）—— 静态抓不到，
//   只有**真窗口**能证（E2E 断言侧栏当前项 className 非空且背景不透明）。

// apps/desktop/tests/copy.test.mjs —— D 类防线：用户可见**文案**
//
// ── 为什么要有它（Apple Style 审查里的一整类）────────────────────────────
//   这类违规的共同点：**代码完全合法、构建通过、单元测试也绿**，只有"把字打出来看"才发现：
//     · **V-40（High）** 界面直接显示未渲染的 Markdown（`**加粗**` 按字面渲染）
//     · **V-42** toast 里直接显示 **undefined**（真窗口截图实测）
//     · V-41 开发者术语外露（`thumb` / `compat` / `seq` / `dim` / `uid` / 错误码 / `canUndo`）
//
// ── V-42 的**真机制**（已定位到具体那一行，不是猜的）─────────────────────
//   `hooks/useToast.js` 原先是 `setMessage(String(msg))`，而
//   **`String(undefined) === 'undefined'`** ⇒ 任何插值字段缺失的调用点
//   （例如 `show(\`已回退 ${tx.txId}\`)` 而 `txId` 不存在）都会把 "undefined" 弹给用户。
//   ⇒ 修法是在**唯一那处**归一化（`normalizeMessage`），CP-1 直接断言它。
//
// ── V-41 **刻意不做成断言**（如实说明，别当成漏了）──────────────────────
//   审计自己的优先级表把 V-41 归在 P2，并写明"多为**登记决定**或删除死代码" ——
//   哪些开发者术语该留在界面上是**产品决定**，不是机械判据能定的。
//   做成断言只会逼出"关掉它"或"堆白名单"两种结局（本仓库反复栽过）。⇒ 不建。
//
// ── 与 adapter 测试的分工（P1：别重复建）────────────────────────────────
//   `adapter.test.mjs` 已断言 `error.userMessage` **永远非空**（A3/A4/A11）。
//   本文件不重复那条；这里管的是**消息渲染层**与源码里的可见文本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import { normalizeMessage, autoDismissMs } from '../src/renderer/src/hooks/useToast.ts';

const SRC = fileURLToPath(new URL('../src/renderer/src/', import.meta.url));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(jsx|js|ts|tsx)$/.test(e.name) ? [p] : [];   // 全量 TS 迁移：扫描面必须含 .ts/.tsx
  });
}
const rel = (p) => p.replace(/\\/g, '/').split('/src/renderer/src/')[1];

// ═══════════════════════════════════════════ CP-1：提示文案绝不许是 undefined
test('CP-1 ⭐⭐ `normalizeMessage` 把"不可显示"的输入挡掉（V-42 的真机制）', () => {
  // 这几条正是"插值缺失"的产物 —— 一个都不能出现在界面上
  for (const junk of [undefined, null, 'undefined', 'null', 'NaN', '  ', '']) {
    assert.equal(normalizeMessage(junk), '', `${JSON.stringify(junk)} 不该变成可显示文本`);
  }
  // 合法输入必须**原样保留**（别把归一化做成"什么都吃掉"）
  assert.equal(normalizeMessage('已回退 tx-1'), '已回退 tx-1');
  assert.equal(normalizeMessage('  有空格  '), '有空格', '只裁首尾空白，不改内容');
  assert.equal(normalizeMessage(0), '0', '数字 0 是合法文案（不能被当成 falsy 丢掉）');
  assert.equal(normalizeMessage(false), 'false', '布尔也是合法文案（同上）');
  // 关键反例：`String(undefined)` 是 'undefined' —— 这就是 V-42 的成因
  assert.equal(String(undefined), 'undefined', '（对照）说明为什么当初那一行会弹 undefined');
  assert.notEqual(normalizeMessage(undefined), String(undefined));
});

// ═══════════════════════════════════════════ CP-2：界面不许出现未渲染的 Markdown
test('CP-2 ⭐ 非注释代码里不得出现 `**加粗**`（V-40：会按字面显示）', () => {
  const bad = [];
  for (const file of walk(SRC)) {
    maskComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, i) => {
      // ⚠️ 只看**非注释**代码：本仓库的注释风格就是 Markdown，裸 grep 会满屏假阳性
      //    （`data/_uiux-capture/scan-markdown.mjs` 的头注释就记了这件事）。
      if (/\*\*[^*\n]+\*\*/.test(line)) bad.push(`${rel(file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [],
    '以下位置的 `**…**` 会**按字面**显示给用户（界面不渲染 Markdown）：\n  ' + bad.join('\n  ')
    + '\n修法：要么去掉星号，要么用真正的排版标签（<strong>/<b>）。');
});

// ═══════════════════════════════════════════ CP-3：可见文本里不许有字面 undefined
/**
 * **带理由的显式豁免**（键 = 渲染层相对路径）。
 * ⚠️ 与 `style-contract.test.mjs` 的 EXEMPT 同一套路：**逐条写明理由**，
 *    而且**豁免必须仍然命中**（见 CP-3 末尾）—— 不命中的豁免会让白名单慢慢烂掉。
 */
const EXEMPT_FILES = new Map([
  ['hooks/useToast.ts',
    '`normalizeMessage` 里那两个字符串**就是守卫本身**：它要判断输入是不是 "undefined"/"NaN" 才好挡掉。'
    + '这是"合法用途"而不是"用户可见文案"，且同文件 CP-0 已断言 show() 必经该归一化。'],
]);

test('CP-3 界面可见字符串里不得出现字面 `undefined` / `NaN`（V-42 的另一半）', () => {
  const bad = [];
  const usedExempt = new Set();
  for (const file of walk(SRC)) {
    const r = rel(file);
    if (EXEMPT_FILES.has(r)) { usedExempt.add(r); continue; }
    const code = maskComments(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      const text = m[2];
      if (/undefined|\bNaN\b/.test(text) && !/\/\/|http/.test(text)) {
        bad.push(`${r}  ${JSON.stringify(text.slice(0, 70))}`);
      }
    }
  }
  const stale = [...EXEMPT_FILES.keys()].filter((k) => !usedExempt.has(k));
  assert.deepEqual(stale, [], `以下豁免已不命中（文件被删/改名）⇒ 必须删掉：${stale.join(', ')}`);
  assert.deepEqual(bad, [],
    '以下字符串字面量里直接写着 undefined/NaN —— 它们会被当文案显示出来：\n  ' + bad.join('\n  '));
});

// ═══════════════════════════════════════════ CP-4：错误提示**必须能被看见/听见**
test('CP-4 ⭐ 错误提示不自动消失，且走 `alert` 而不是 `status`（V-16）', () => {
  // ① 消失策略（纯函数，可断言）
  assert.equal(autoDismissMs('err', 2600), 0, '错误提示**不许**自动消失（WCAG SC 2.2.1 / 4.1.3）');
  assert.equal(autoDismissMs('info', 2600), 2600, '普通提示保持原时长');
  assert.equal(autoDismissMs(undefined, 2600), 2600, '没给 tone 时按普通提示处理');

  // ② 角色映射：这部分在 `.jsx` 里，`node:test` 加载不了 ⇒ 断言**剥注释后的源码**
  //    （⚠️ 必须剥注释：本文件的注释里正当地引用了旧的 `role="status"`，
  //      裸匹配会把自己的说明当成违规 —— 这个坑在注入器与 CP-0 上各踩过一次。）
  const toastSrc = maskComments(fs.readFileSync(path.join(SRC, 'ui', 'Toast.jsx'), 'utf8'));
  assert.match(toastSrc, /role=\{isErr \? 'alert' : 'status'\}/,
    '错误必须是 `alert`、普通提示才是 `status` —— 恒 status 就等于"出错和成功对读屏一样"');
  assert.match(toastSrc, /aria-live=\{isErr \? 'assertive' : 'polite'\}/, '`aria-live` 要跟着角色一致');
  assert.doesNotMatch(toastSrc, /role="status"/, '不许退回恒 `role="status"`');

  // ③ 正向面：`useToast.show` 必须真的用这条策略（否则上面测的是没人用的函数）
  const hookSrc = maskComments(fs.readFileSync(path.join(SRC, 'hooks', 'useToast.ts'), 'utf8'));
  assert.match(hookSrc, /autoDismissMs\(t, ms\)/, '`show()` 必须走 `autoDismissMs`');
});

// ═══════════════════════════════════════════ CP-0：自检（否则上面三条恒真）
test('CP-0 自检：扫描面覆盖到东西、且 `show` 真的用了 `normalizeMessage`', () => {
  const files = walk(SRC);
  assert.ok(files.length >= 40, `渲染层文件数 ${files.length} 偏少，扫描面可能坏了`);
  const toastRaw = fs.readFileSync(path.join(SRC, 'hooks', 'useToast.ts'), 'utf8');
  // ⚠️⚠️ 必须断言**确切的调用表达式**，不能只断言"文件里出现过 normalizeMessage(msg)" ——
  //    后者会被**函数定义本身**（`export function normalizeMessage(msg) {`）满足，
  //    于是把调用点改回 `String(msg)` 也照样绿。**这是双向验证当场抓出来的剧场断言**
  //    （第一版就写成 `/normalizeMessage\(msg\)/`，注入 `String(msg)` 后仍然 pass）。
  assert.match(toastRaw, /const text = normalizeMessage\(msg\)/,
    '`show()` 里必须写成 `const text = normalizeMessage(msg)` —— 否则 CP-1 测的是一个没人用的函数（剧场）');
  // ⚠️ 这条**必须看剥掉注释后的代码**：本文件的注释里**正当地引用了**那句旧代码
  //    （"原先这里是 setMessage(String(msg))"），裸匹配会把自己的注释当成违规 ——
  //    实测踩过（同一个坑在注入器上也踩过：锚点命中了注释而不是代码）。
  const toastCode = maskComments(toastRaw);
  assert.doesNotMatch(toastCode, /setMessage\(String\(msg\)\)/,
    '不许退回 `setMessage(String(msg))`（那正是 V-42 的成因）');
  assert.ok(files.some((f) => /\.jsx$/.test(f)), '扫描面应包含 .jsx（否则 CP-2/CP-3 覆盖面不全）');
});

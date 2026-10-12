// verify_app_build.mjs —— electron-vite 构建产物的**形状**核对（不需要 Electron）
//
// 为什么需要：
//   我在受限沙箱里起不了 Electron（进程以 0xC0000003 静默退出），所以"能不能出窗"
//   只能由你在自己终端里验。但**构建产物形状**这类问题不必等 —— 而且它们一旦错，
//   症状全是误导性的：
//     · preload 若被产出 ESM → `sandbox: true` 下**静默不执行**（界面点了没反应，无报错）
//     · 原生模块（onnxruntime-node / sharp）若被 bundle 进去 → 打包/运行期才炸
//     · renderer 若用绝对路径引 asset → `file://` 加载时白屏
//   这三条都在这里用**文本断言**钉死。
//
// 用法：先 `npm run build`，然后
//   node verify_app_build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 项目根：向上找到含 packages/engine/src/engine.mjs 的那一级（搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 packages/engine/src/engine.mjs）');
    p = up;
  }
})();

const OUT = path.join(ROOT, 'out');
const MAIN = path.join(OUT, 'main', 'index.js');
const PRELOAD = path.join(OUT, 'preload', 'index.cjs');
const RENDERER_HTML = path.join(OUT, 'renderer', 'index.html');

const problems = [];
const ok = (cond, label, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) problems.push(label);
};

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

console.log('='.repeat(96));
console.log('应用构建产物形状核对（不需要 Electron）');
console.log('  产物目录 :', OUT);

// ---------- 0) 产物存在 ----------
console.log('\n--- 0) 三端产物 ---');
const main = read(MAIN);
const preload = read(PRELOAD);
const html = read(RENDERER_HTML);
ok(main !== null, 'out/main/index.js 存在');
ok(preload !== null, 'out/preload/index.cjs 存在');
ok(html !== null, 'out/renderer/index.html 存在');
if (!main || !preload || !html) {
  console.log('\n产物不齐 —— 先跑 `npm run build`。');
  process.exit(1);
}

// ---------- 1) main 是 ESM，且 `electron` 是外部导入 ----------
console.log('\n--- 1) 主进程 ---');
ok(/^import\s/m.test(main), 'main 是 ESM（有 import 语句）');
ok(/from\s+"electron"/.test(main) || /from\s+'electron'/.test(main), 'electron 是外部导入（未被 inline）');
ok(/externalizeDepsPlugin|"zod"/.test(main) && /from\s+"zod"/.test(main), 'zod 保持外部导入');

// 原生模块**绝不能**进 bundle：出现这些字样的内联代码就是打包事故
const nativeMarkers = ['onnxruntime_binding', 'libvips', 'sharp-win32', 'sharp.node'];
for (const f of walk(path.join(OUT, 'main'))) {
  const txt = read(f) || '';
  for (const m of nativeMarkers) {
    ok(!txt.includes(m), `未把原生模块内联进 ${path.relative(ROOT, f)}`, m);
  }
}

// ---------- 1b) 能力端口**真的接上了**（F-01 的接线回归锁定）----------
//
// 为什么这条必须在这里做：`reveal` 是"静默假成功"型缺陷 —— 引擎在端口缺失时会返回
// `PORT_MISSING`，界面就老老实实显示失败。**看起来什么都没坏**，但功能是死的。
// 而渲染层的守卫（verify_renderer_dom.mjs）只加载 `out/renderer/assets/*.js`，
// **从不加载 main** —— 所以"接线掉了"这件事在渲染层守卫里永远看不见。
// 2026-10-12 复核实测过：把 `shell:` 那行注释掉后，渲染层守卫仍 EXIT=0、`npm test` 仍全绿。
//
// ⚠️ **必须在剥掉注释之后再匹配**。这不是理论顾虑：实测这个 bundle **会保留源码行注释**，
// 所以直接 grep `shell:` 会命中 `// shell: createRevealPort(shell),` ——
// 而"注释掉一行"恰恰是禁用接线最常见的手法。不剥注释的守卫等于没守卫。
//
// 为什么手写而不是用现成的：`esbuild.transformSync` 在受限沙箱下**同样 spawn EPERM**
// （它也要起服务进程）⇒ 在守卫里用它会让守卫整体失效，比现在更糟。
// 而 TypeScript 7 没有经典 API（`typescript/unstable/*` 是未定型的实验面，不拿它做门禁）。
//
// 难点只有一个：`/` 既可能开始正则字面量，也可能是除号。判断依据是**前一个有意义 token**：
// 前面是"值"（标识符/数字/`)`/`]`/`}`）⇒ 除号；否则（运算符、`(`、`,`、`;`、关键字）⇒ 正则。
// 含引号的正则（如 `/["']/g`）正是旧实现（无正则感知）的破口：
// 它会让 `'` 被当成字符串开始，把其后文本全部原样保留 ⇒ 被注释掉的接线**重新变得可匹配**。
const stripComments = (src) => {
  let out = '';
  let i = 0;
  const n = src.length;
  // 往回看那个有意义的字符，决定 `/` 是除号还是正则开头
  const regexAllowedAfter = (pos) => {
    for (let j = pos - 1; j >= 0; j--) {
      const c = src[j];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
      if (/[A-Za-z0-9_$]/.test(c)) {
        // 例外：`return /re/`、`typeof /re/` 这类关键字后面**可以**跟正则
        let k = j;
        while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
        const word = src.slice(k + 1, j + 1);
        return /^(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await|throw)$/.test(word);
      }
      return !/[)\]}]/.test(c);
    }
    return true;   // 文件开头允许正则
  };

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {                       // 行注释
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {                       // 块注释
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {          // 字符串 / 模板：原样保留
      const q = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && regexAllowedAfter(i)) {            // 正则字面量：整体当字符串对待
      out += c; i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { out += ch; i++; break; }
        else if (ch === '\n') break;                    // 未闭合：当普通字符，别吞掉整份文件
        out += ch; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
};

/**
 * 取**调用点**的实参区间（括号配平）。
 *
 * ⚠️ 必须排除 `function createEngine(...)` 这种**函数声明**：
 * 引擎自己的签名里就写着 `shell = null` 这个形参，若把它当实参，
 * 那"端口有没有接上"就永远为真（声明里有、调用点没有）—— 这正是独立复核 I-2 的同型陷阱。
 * 判据：只认「赋值给某个东西」的调用（`engine = createEngine(`），并显式跳过前面的 `function`。
 */
const callArgsOf = (code, name) => {
  const re = new RegExp('([A-Za-z_$][\\w$]*\\s*=\\s*)?\\b' + name + '\\s*\\(', 'g');
  let mm;
  while ((mm = re.exec(code)) !== null) {
    if (!mm[1]) continue;                                   // 不是"赋值形式的调用"
    const before = code.slice(Math.max(0, mm.index - 12), mm.index);
    if (/\bfunction\s*$/.test(before)) continue;             // 函数声明，跳过
    const start = mm.index + mm[0].length - 1;               // 指向 '('
    let depth = 0;
    for (let i = start; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) return code.slice(start, i + 1); }
    }
    return null;
  }
  return null;
};

console.log('\n--- 1b) 引擎能力端口已注入（F-01 接线）---');
const mainCode = stripComments(main);
// 剥注释**本身**要被自证：用内联 fixture，且**用例本身正确**（下面是逐条推演过的）
const lexChecks = [
  ["// shell: createRevealPort(x)", false, '行注释里的接线要被剥掉'],
  ['/* shell: createRevealPort(x) */', false, '块注释里的接线要被剥掉'],
  ['shell: createRevealPort(x)', true, '真接线要保留'],
  // I-1 的破口：无正则感知的实现会把 `["']` 的引号当成字符串开始，从而**保留**后面被注释掉的接线
  ['const re = /["\']/g; // shell: createRevealPort(x)', false, '含引号的正则之后的注释仍要被剥掉'],
  ["const a = 'http://x'; const b = 'createRevealPort';", true, '字符串里的 // 与内容原样保留'],
];
let lexBad = 0;
for (const [src, shouldKeep, label] of lexChecks) {
  const got = stripComments(src).includes('createRevealPort');
  if (got !== shouldKeep) { lexBad += 1; ok(false, `剥注释自检：${label}`, `得到 ${got}（应为 ${shouldKeep}）`); }
}
ok(lexBad === 0, `剥注释自检 ${lexChecks.length} 条通过（含"含引号的正则"这个破口）`);
ok(mainCode.length < main.length, '剥注释在真实产物上生效（确实有注释被剥掉）',
  `原 ${main.length} → 剥后 ${mainCode.length}`);

ok(/createEngine\s*\(/.test(mainCode), 'main 里有 createEngine( 调用');
// ⚠️ 不是全文找子串：那样**把接线删掉、只在别处留一份同样文本**就能骗过去（独立复核 I-2 实测过）。
// 也不是找"第一个 createEngine(" —— 那是**函数声明**。必须限定在**调用点的实参**里。
const engineArgs = callArgsOf(mainCode, 'createEngine');
ok(engineArgs !== null, '能取出 createEngine **调用点**的实参区间', engineArgs ? `${engineArgs.length} 字符` : '取不到');
const shellInjected = !!engineArgs && /shell\s*:\s*createRevealPort\s*\(/.test(engineArgs);
ok(shellInjected,
  'createEngine 调用点的实参里含 shell: createRevealPort(...) —— 否则 reveal 会返回 PORT_MISSING',
  shellInjected ? '' : '在 createEngine 调用点的实参里找不到 shell 端口（接线掉了、被注释了、或改名了）');
ok(!!engineArgs && /createRevealPort/.test(engineArgs), '端口构造函数在调用点实参里（未被摇掉）');
ok(/\bshell\b/.test(mainCode) && /"electron"/.test(mainCode), 'main 仍导入 electron（shell 的来源）');

// ---------- 2) preload 必须是 CJS（sandbox 要求）----------
console.log('\n--- 2) preload（sandbox:true 下必须 CJS）---');
ok(/require\(\s*["']electron["']\s*\)/.test(preload), 'preload 用 require("electron")');
ok(!/^\s*import\s/m.test(preload) && !/^\s*export\s/m.test(preload), 'preload 里没有任何 ESM 语句');
ok(preload.includes('contextBridge.exposeInMainWorld'), 'preload 暴露面是 contextBridge');
ok(!/exposeInMainWorld\([^)]*ipcRenderer/.test(preload), '没有把 ipcRenderer 本体暴露出去');

// ---------- 3) 主进程引用的两个路径确实存在 ----------
console.log('\n--- 3) 主进程 → preload / renderer 的路径 ---');
ok(main.includes('"..", "preload", "index.cjs"') || main.includes("'..', 'preload', 'index.cjs'"),
   'main 里 preload 指向 ../preload/index.cjs');
ok(main.includes('"..", "renderer", "index.html"') || main.includes("'..', 'renderer', 'index.html'"),
   'main 里页面指向 ../renderer/index.html');
ok(fs.existsSync(PRELOAD) && fs.existsSync(RENDERER_HTML), '这两个路径的文件都真的存在');

// ---------- 4) renderer：相对路径 + CSP 还在 ----------
console.log('\n--- 4) 渲染进程 ---');
ok(/http-equiv="Content-Security-Policy"/.test(html), 'CSP meta 还在');
ok(!/'unsafe-eval'/.test(html), 'CSP 里没有 unsafe-eval');
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
ok(scripts.length > 0, 'HTML 里有外部脚本', scripts.join(', '));
ok(scripts.every((s) => !s.startsWith('/') && !/^[a-z]+:/i.test(s)),
   '脚本路径是**相对**的（file:// 下绝对路径会白屏）');
for (const s of scripts) {
  const f = path.join(OUT, 'renderer', s);
  ok(fs.existsSync(f), `脚本产物存在：${s}`);
}
const cssHrefs = [...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
for (const h of cssHrefs) {
  ok(fs.existsSync(path.join(OUT, 'renderer', h)), `样式产物存在：${h}`);
}
// 界面逻辑里对 thumb:// 的引用必须还在（缩略图是 P3b 的验收项）
const js = scripts.map((s) => read(path.join(OUT, 'renderer', s)) || '').join('\n');
ok(js.includes('thumb://'), '界面逻辑里仍有 thumb:// 引用');

console.log('\n' + '='.repeat(96));
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('全部通过。注意：这只证明**产物形状**正确 —— "能不能出窗"要你在自己终端跑 `npm run dev`。');

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

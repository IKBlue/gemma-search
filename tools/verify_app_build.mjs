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

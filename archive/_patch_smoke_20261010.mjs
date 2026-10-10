// _fix/patch-smoke.mjs —— 一次性补丁（每条都校验命中数，任一不命中即整体中止）
//
// 两件事：
//   1) tools/smoke_app.mjs：加 `--no-sandbox` 旁路（受限环境里 Chromium 沙箱起不来，
//      不加这个开关那条冒烟命令永远只能给"环境拦住了"的判定）
//   2) README：两处"最小 DOM 桩"的说法已过时（守卫改成 jsdom 真跑 React），并补上冒烟命令
import fs from 'node:fs';

const patches = [
  {
    file: 'tools/smoke_app.mjs',
    label: 'smoke_app 用法注释加 --no-sandbox',
    find: "//   node tools/smoke_app.mjs --keep     # 不自动杀进程（自己看窗口）",
    repl: "//   node tools/smoke_app.mjs --keep     # 不自动杀进程（自己看窗口）\n" +
      "//   node tools/smoke_app.mjs --no-sandbox  # 受限环境（Chromium 进程沙箱起不来）下自测出窗；\n" +
      "//                                          普通终端**不要**加 —— 那是安全降级",
  },
  {
    file: 'tools/smoke_app.mjs',
    label: 'smoke_app 解析 --no-sandbox',
    find: "const WAIT_MS = Number(arg('wait', 30)) * 1000;\nconst KEEP = argv.includes('--keep');",
    repl: "const WAIT_MS = Number(arg('wait', 30)) * 1000;\nconst KEEP = argv.includes('--keep');\n" +
      "// 受限环境下 Chromium 的进程沙箱初始化失败，Electron 会以 0x80000003 秒退 —— 实测加这个开关即正常。\n" +
      "// 它是**安全降级**（关掉浏览器进程沙箱），只在自测用；不要进产品配置。\n" +
      "const NO_SANDBOX = argv.includes('--no-sandbox');",
  },
  {
    file: 'tools/smoke_app.mjs',
    label: 'smoke_app 启动时带上参数',
    find: "const child = spawn(electronPath, ['.'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });",
    repl: "const child = spawn(electronPath, ['.', ...(NO_SANDBOX ? ['--no-sandbox'] : [])],\n" +
      "  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });",
  },
  {
    file: 'tools/smoke_app.mjs',
    label: 'smoke_app 判定里给出 --no-sandbox 建议',
    find: "  console.log('若后者能打出 1，说明二进制正常、是 GUI/多进程这条路径被禁 —— 换一个不受限的终端重跑本命令。');",
    repl: "  console.log('若后者能打出 1，说明二进制正常、是 GUI/多进程这条路径被禁 —— 换一个不受限的终端重跑本命令。');\n" +
      "  console.log('受限环境里想自测出窗：node tools/smoke_app.mjs --no-sandbox（它只关 Chromium 的进程沙箱）。');",
  },
  {
    file: 'README.md',
    label: 'README 守卫清单②：DOM 桩 → jsdom React',
    find: 'node tools/verify_renderer_dom.mjs  # 渲染进程逻辑在最小 DOM 桩里真跑（启动 / 搜索 / 交互，不需 Electron）',
    repl: 'node tools/verify_renderer_dom.mjs  # React 渲染层在 jsdom 里真跑（启动 / 搜索 / 交互 / 事件，不需 Electron）\n' +
      'node tools/smoke_app.mjs             # 应用冒烟：真启动构建产物并给判定（受限环境加 --no-sandbox）',
  },
  {
    file: 'README.md',
    label: 'README 守卫清单①：DOM 桩 → jsdom React',
    find: 'node tools\\verify_renderer_dom.mjs       # 渲染逻辑在最小 DOM 桩里真跑（启动/搜索/交互）',
    repl: 'node tools\\verify_renderer_dom.mjs       # React 渲染层在 jsdom 里真跑（启动/搜索/交互/事件）',
  },
];

const changed = new Map();
const failed = [];
for (const p of patches) {
  const src = changed.has(p.file) ? changed.get(p.file) : fs.readFileSync(p.file, 'utf8');
  const n = src.split(p.find).length - 1;
  if (n !== 1) { failed.push(`${p.label}（命中 ${n} 次）`); continue; }
  changed.set(p.file, src.replace(p.find, p.repl));
  console.log(`  [OK  ] ${p.label}`);
}
if (failed.length) {
  console.error('\n有补丁没命中，**一个文件都没写**：');
  for (const f of failed) console.error('  · ' + f);
  process.exit(1);
}
for (const [file, content] of changed) {
  fs.writeFileSync(file, content, 'utf8');
  console.log(`  写入 ${file}`);
}
console.log(`\n${patches.length} 条补丁已应用。`);

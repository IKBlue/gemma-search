// tools/smoke_app.mjs —— 启动应用并**给出判定**（不需要 electron-vite dev server）
//
// 为什么需要它：
//   `npm run dev` / `npm start` 出问题时，"什么都没发生"是最难查的一种 —— 因为
//   Windows 上 Electron 是 GUI 子系统程序，**主进程的 stdout 不连终端**，
//   于是"窗口没出来"和"主进程压根没启动"在终端上长得一模一样。
//   这条命令把两者区分开：它直接跑**构建产物**（out/main），把日志指到独立文件，
//   同时把子进程的 stdout/stderr 也接回来，最后按日志内容给出结论。
//
// 用法：
//   npm run build           # 先有产物
//   node tools/smoke_app.mjs            # 跑到出窗或超时（默认 30 秒）
//   node tools/smoke_app.mjs --wait 60  # 自定义等待
//   node tools/smoke_app.mjs --keep     # 不自动杀进程（自己看窗口）
//   node tools/smoke_app.mjs --no-sandbox  # 受限环境（Chromium 进程沙箱起不来）下自测出窗；
//                                          普通终端**不要**加 —— 那是安全降级
//
// 退出码：0 = 判定为"起来了"；1 = 产物缺失；2 = 主进程没跑到 JS；3 = 跑到 JS 但没出窗；4 = 起来了但有报错
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
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

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const WAIT_MS = Number(arg('wait', 30)) * 1000;
const KEEP = argv.includes('--keep');
// 受限环境下 Chromium 的进程沙箱初始化失败，Electron 会以 0x80000003 秒退 —— 实测加这个开关即正常。
// 它是**安全降级**（关掉浏览器进程沙箱），只在自测用；不要进产品配置。
const NO_SANDBOX = argv.includes('--no-sandbox');

const MAIN = path.join(ROOT, 'out', 'main', 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.cjs');
const LOG = path.join(ROOT, 'data', `_smoke-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.log`);

console.log('='.repeat(96));
console.log('应用冒烟（直接跑构建产物，不经 dev server）');
console.log('  项目根   :', ROOT);
console.log('  入口     :', path.relative(ROOT, MAIN));
console.log('  专用日志 :', path.relative(ROOT, LOG));

// ---------------------------------------------------------------- 0) 产物与环境
console.log('\n--- 0) 产物与环境 ---');
let electronPath = '';
try {
  electronPath = require('electron');           // 在普通 Node 里，这返回 electron.exe 的路径字符串
} catch (e) {
  console.log('  [FAIL] 取不到 electron 二进制路径：' + e.message);
}
const hasMain = fs.existsSync(MAIN);
const hasPreload = fs.existsSync(PRELOAD);
const hasElectron = !!(electronPath && fs.existsSync(electronPath));
console.log(`  ${hasMain ? '[OK  ]' : '[FAIL]'} out/main/index.js（先跑 npm run build）`);
console.log(`  ${hasPreload ? '[OK  ]' : '[FAIL]'} out/preload/index.cjs`);
console.log(`  ${hasElectron ? '[OK  ]' : '[FAIL]'} electron 二进制：${electronPath || '(none)'}`);
console.log(`  ELECTRON_RUN_AS_NODE = ${JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null)}` +
            (process.env.ELECTRON_RUN_AS_NODE ? '  ← 会让 Electron 以纯 Node 运行，本次启动会替你摘掉' : ''));
if (!hasMain || !hasPreload || !hasElectron) {
  console.log('\n产物或 electron 不齐 —— 先 `npm run build`。');
  process.exit(1);
}

// ---------------------------------------------------------------- 1) 启动
console.log(`\n--- 1) 启动（最多等 ${WAIT_MS / 1000}s）---`);
const env = { ...process.env, GEMMA_APP_LOG: LOG };
delete env.ELECTRON_RUN_AS_NODE;                 // 这个变量会让 Electron 变成纯 Node
fs.rmSync(LOG, { force: true });

// **刻意不用管道**接子进程 stdio：本环境实测 Electron 在 `stdio: 'pipe'` 下会以
// 0xC0000005（访问冲突）崩在 ready 之前，同样的参数改成不使用管道就正常出窗。
// 而 Windows 上 Electron 是 GUI 子系统程序，主进程 stdout 本来也不连终端 ——
// 日志的真正来源是 GEMMA_APP_LOG 指定的那个文件（下面会把它打印出来）。
// 传**主脚本路径**而不是目录 `.`：本环境实测目录形式会让主进程以 0xC0000005 崩在 ready 之前，
// 而脚本路径形式正常出窗（对照记录在 reports/G-D-p2-electron/README.md）。
const child = spawn(electronPath, [MAIN, ...(NO_SANDBOX ? ['--no-sandbox'] : [])],
  { cwd: ROOT, env, stdio: 'ignore' });

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });

const t0 = Date.now();
const deadline = t0 + WAIT_MS;
let logText = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400));
  logText = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  // "起来"的判据：窗口创建 + 渲染页加载完成（两条都出现就可以收工，不用等满）
  if (/渲染页加载完成/.test(logText)) break;
  if (exited) break;                              // 主进程自己退了，不必等
}

// ---------------------------------------------------------------- 2) 收尾
if (!KEEP) {
  if (!exited) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
}

// ---------------------------------------------------------------- 3) 判定
console.log('\n' + '='.repeat(96));
console.log('--- 2) 主进程日志（' + path.relative(ROOT, LOG) + '）---');
logText = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
if (!logText) {
  console.log('  （日志文件根本没生成）');
} else {
  process.stdout.write(logText.split('\n').map((l) => '  ' + l).join('\n'));
}

const has = (re) => re.test(logText);
const errLines = logText.split('\n').filter((l) => l.includes('!! '));
// Electron 的浏览器进程起不来时，Windows 会给出 0x80000003 / 0xC0000003（bash 里取模后显示为 3）
const GUI_BLOCKED = new Set([3, 0x80000003, 0xC0000003, -2147483645]);
const guiBlocked = !!exited && (GUI_BLOCKED.has(exited.code) || (exited.code & 0xff) === 3);
const verdicts = [];
if (!logText) verdicts.push(['主进程没跑到 JS', '日志文件不存在 —— Electron 启动后连第一行都没执行']);
else if (has(/数据库|Cannot find module|ERR_MODULE/)) verdicts.push(['主进程导入失败', '看日志里的 ERR_/Cannot find']);
if (has(/窗口已创建/)) verdicts.push(['窗口已创建', '主进程把 BrowserWindow 建起来了']);
if (has(/渲染页加载完成/)) verdicts.push(['渲染页加载完成', '页面（含 CSS/JS）真的加载完了']);
if (has(/thumb:\/\/ 已注册/)) verdicts.push(['thumb:// 已注册', '缩略图协议就绪']);
if (has(/引擎就绪/)) verdicts.push(['引擎就绪', '索引/库注册表读到了']);
if (has(/encode|编码器/)) verdicts.push(['编码器有动静', '见上方编码器相关行（WebGPU 成功/回落都在里面）']);

console.log('--- 3) 判定 ---');
for (const [t, d] of verdicts) console.log(`  · ${t} —— ${d}`);
if (errLines.length) {
  console.log(`  · 有 ${errLines.length} 条 "!!" 报错（上面日志里已标出）`);
}
if (exited) console.log(`  · 主进程已退出：code=${exited.code}（0x${(exited.code >>> 0).toString(16).toUpperCase()}）signal=${exited.signal ?? 'null'}` +
  (guiBlocked ? '　← 这是 Electron 浏览器进程起不来的典型退出码' : ''));

// ---------------------------------------------------------------- 4) 环境对照（只在"没跑到 JS"时才值得做）
function envControls(electronPath) {
  console.log('\n--- 4) 环境对照（同一二进制，不同启动方式）---');

  // 对照 A：Node 模式。能打出东西 = 二进制本身没问题，是 GUI/多进程那条路被禁。
  const r = spawnSync(electronPath, ['-e', 'console.log("node-mode ok")'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8', timeout: 20000,
  });
  const nodeOk = (r.stdout || '').includes('node-mode ok');
  console.log(`  ${nodeOk ? '[OK  ]' : '[FAIL]'} 对照 A · ELECTRON_RUN_AS_NODE=1 electron -e … → exit=${r.status} ${JSON.stringify((r.stdout || '').trim())}`);
  console.log(`         含义：${nodeOk ? '二进制正常，是 GUI/多进程启动路径的问题' : '连 Node 模式都跑不了 —— 安装/杀软问题'}`);

  // 对照 B：Windows 错误报告里有没有刚落下的崩溃记录（异常码与模块最有价值）
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Windows Error Reporting'; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'electron' } | ForEach-Object { $m=$_.Message; '{0} ex={1} off={2}' -f $_.TimeCreated.ToString('HH:mm:ss'), ([regex]::Match($m,'P7: (\\w+)')).Groups[1].Value, ([regex]::Match($m,'P8: (\\w+)')).Groups[1].Value }"],
      { encoding: 'utf8', timeout: 30000 });
    const wer = (ps.stdout || '').trim();
    console.log(`  ${wer ? '[warn]' : '[OK  ]'} 对照 B · 近 5 分钟的 EVENT/WER 崩溃记录：${wer || '（无）'}`);
    if (wer) console.log('         含义：ex=c0000005 访问冲突 / ex=80000003 断点异常，两者都是**启动期被杀**的典型表象');
  }

  // 对照 C：Electron 自己的 userData 目录有没有被创建过
  const ud = path.join(process.env.APPDATA || '', 'gemma-search');
  const udExists = fs.existsSync(ud);
  console.log(`  ${udExists ? '[OK  ]' : '[warn]'} 对照 C · userData 目录 ${ud}${udExists ? ' 存在' : ' **不存在**（连它都没建 → 死在很早期）'}`);
}

console.log('');
if (!logText && guiBlocked) {
  console.log('结论：**Electron 的浏览器进程在这个上下文里起不来**（不是应用代码的问题）。');
  console.log('先跑这两条分辨“环境还是代码”：\n' +
    '  node tools/probe_electron_start          # 最小 Electron 应用，看 probe.log 有没有生成\n' +
    '  set ELECTRON_RUN_AS_NODE=1 && node_modules\\electron\\dist\\electron.exe -e "console.log(1)"');
  console.log('若后者能打出 1，说明二进制正常、是 GUI/多进程这条路径被禁 —— 换一个不受限的终端重跑本命令。');
  console.log('受限环境里想自测出窗：node tools/smoke_app.mjs --no-sandbox（它只关 Chromium 的进程沙箱）。');
  console.log('日志路径：' + LOG);
  envControls(electronPath);
  process.exit(2);
}
if (!logText) {
  console.log('结论：主进程一行都没跑。下面是对照实验结果 —— 把**本次全部输出**贴回即可定位。');
  envControls(electronPath);
  process.exit(2);
}
if (!has(/窗口已创建/)) {
  console.log('结论：主进程跑起来了但没建窗口 —— 日志里的 !!! 行就是原因。');
  process.exit(3);
}
if (errLines.length) {
  console.log('结论：窗口起来了，但有报错（见上）。把这些 !!! 行贴回即可定位。');
  process.exit(4);
}
console.log('结论：窗口已创建' + (has(/渲染页加载完成/) ? '且页面加载完成' : '（未见"渲染页加载完成"）') + '。');
console.log('接下来人工确认：窗口里侧栏是否显示 3594/3594、搜一句话有没有结果、缩略图是否显示。');
if (KEEP) console.log('（--keep：进程没被杀，自己关窗口）');
process.exit(0);

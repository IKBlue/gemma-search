// scripts/electron-vite.mjs —— 启动 electron-vite 前后的两件必要的事
//
// 1) **清掉 `ELECTRON_RUN_AS_NODE`**
//    环境里若有它，electron-vite 拉起的 electron 会以**纯 Node** 运行 —— 主进程的 `app`
//    是 undefined，报错极具误导性（找不到 transformers / "does not provide an export
//    named 'BrowserWindow'"）。主进程里虽然有自愈，但 **dev 态不能自愈**：dev server
//    由 electron-vite 进程持有，重生会立刻失去它 —— 结果是"窗口开了但一片空白"。
//
// 2) **探测本机能否跑 Chromium 的进程沙箱**（2026-10-10 加）
//    本机实测：`electron.exe --version` 单独跑以 0x80000003 秒退（浏览器进程的沙箱初始化失败），
//    加 `--no-sandbox` 则正常。而 electron-vite 的 dev 默认把入口传成 `.`（目录形式），
//    在本机还会再撞一次 0xC0000005（崩在 `app.whenReady()` 之前）。
//    所以：探测失败就**只为这一次启动**附加 `--noSandbox --entry <主脚本>`。
//
//    ⚠️ **探测必须用清理后的环境**：本机 `ELECTRON_RUN_AS_NODE=1` 时，
//    `electron.exe --version` 会以纯 Node 运行并打印 **Node 的版本**（退出码 0）——
//    用它当判据会得出"沙箱可用"的错误结论（实测踩过一次）。所以下面 probe() 显式传 `env`。
//
//    探测只是**快速路径**，真正的兜底是"第一次失败就带参重试一次"（见 launch()）：
//    任何探测判断不了的情况都不会变成"窗口没出来但什么都不说"。
//
// 用法（package.json 的脚本就是这么调的）：
//   node scripts/electron-vite.mjs dev
//   node scripts/electron-vite.mjs dev --noSandbox --entry out/main/index.js
//   node scripts/electron-vite.mjs preview
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const say = (m) => process.stdout.write(m + '\n');

// ---------------------------------------------------------------- electron-vite CLI
// 不能 require.resolve('electron-vite/bin/electron-vite.js')：该包的 exports 只放出了
// "."/"./node"/"./package.json"，子路径会被 ERR_PACKAGE_PATH_NOT_EXPORTED 拦住。
const pkgDir = path.dirname(require.resolve('electron-vite/package.json'));
const CLI = path.join(pkgDir, 'bin', 'electron-vite.js');

const args = process.argv.slice(2);

// ---------------------------------------------------------------- 清理后的环境
const env = { ...process.env };
if (Object.prototype.hasOwnProperty.call(env, 'ELECTRON_RUN_AS_NODE')) {
  delete env.ELECTRON_RUN_AS_NODE;
  say('[run] 检测到 ELECTRON_RUN_AS_NODE —— 已为本次子进程摘掉（否则 Electron 会以纯 Node 运行）');
}

// ---------------------------------------------------------------- 辅助
/** Electron 主脚本（dev/preview 都用它当 `--entry`；目录形式在本机会崩，见文件头） */
function mainScript() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return String(pkg.main || 'out/main/index.js').replace(/^\.\//, '');
  } catch {
    return 'out/main/index.js';
  }
}

function electronExe() {
  try {
    const p = require('electron');          // 普通 Node 里返回 electron.exe 的路径字符串
    return typeof p === 'string' && fs.existsSync(p) ? p : '';
  } catch {
    return '';
  }
}

/** 极短探测：跑 `--version` 看能否正常退出（**必须传清理后的 env**，否则测的是 Node） */
function probe(exe, extraArgs) {
  const r = spawnSync(exe, [...extraArgs, '--version'], {
    encoding: 'utf8', timeout: 20000, stdio: 'pipe', windowsHide: true, env,
  });
  return { ok: r.status === 0, status: r.status, out: String(r.stdout || '').trim() };
}

const restrictedArgs = () => ['--noSandbox', '--entry', mainScript()];
const askedFlags = args.some((a) => a === '--noSandbox' || a === '--no-sandbox');
const isRunCmd = ['dev', 'serve', 'preview'].includes(args[0]);
const GUI_BLOCKED = new Set([3, 0x80000003, 0xc0000005]);   // 沙箱断言 / 访问冲突

// ---------------------------------------------------------------- 快速路径：探测
let extra = [];
if (isRunCmd && !askedFlags) {
  const exe = electronExe();
  if (!exe) {
    say('[run] 找不到 electron 二进制（npm install 没下平台包？见 README 的 ELECTRON_MIRROR 说明）');
  } else {
    const plain = probe(exe, []);
    if (!plain.ok) {
      const ns = probe(exe, ['--no-sandbox']);
      if (ns.ok) {
        say(`[run] 探测：本机 Chromium 的进程沙箱不可用（\`--version\` 退出码 0x${(plain.status >>> 0).toString(16).toUpperCase()}，加 --no-sandbox 正常 → ${ns.out}）`);
        say(`[run] 探测：本次附加 ${restrictedArgs().join(' ')}（**仅本次**，不写进配置；普通机器不会有这两行）`);
        extra = restrictedArgs();
      } else {
        say('[run] 探测：Electron 连 --no-sandbox 都跑不起来 —— 判定工具 smoke_app.mjs 已于 2026-10-13 移除，' + '现在看 tools/probe_electron_start/ 的判读表');
      }
    }
  }
}

// ---------------------------------------------------------------- 启动（第一次失败就带参重试一次）
let attempt = 0;
function launch() {
  attempt += 1;
  const child = spawn(process.execPath, [CLI, ...args, ...extra], { env, stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    if (signal) {
      say(`[run] electron-vite 被信号 ${signal} 结束`);
      process.exit(1);
    }
    const u = (code ?? 0) >>> 0;

    // 兜底：探测没判断出来，但事实就是"浏览器进程起不来" → 带参重试一次
    if (attempt === 1 && isRunCmd && !askedFlags && extra.length === 0 && GUI_BLOCKED.has(u)) {
      say(`[run] 第一次启动失败：Electron 以 0x${u.toString(16).toUpperCase()} 退出（浏览器进程没能起来）`);
      say(`[run] 判定：本机 Chromium 的进程沙箱不可用 → 带参重试一次：${restrictedArgs().join(' ')}`);
      extra = restrictedArgs();
      launch();
      return;
    }

    if (GUI_BLOCKED.has(u)) {
      say(`[run] Electron 以 0x${u.toString(16).toUpperCase()} 退出 —— 浏览器进程没能起来。`);
      say('[run] 受限环境直接显式指定：npm run dev:restricted   # dev --noSandbox --entry out/main/index.js');
      say('[run] 还起不来：判定工具已移除（2026-10-13），看 tools/probe_electron_start/');
    }
    process.exit(code ?? 0);
  });

  child.on('error', (e) => { say('[run] 无法启动 electron-vite：' + e.message); process.exit(1); });
  return child;
}

launch();

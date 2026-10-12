// app/main/bootstrap.cjs —— Electron 主进程入口（**故意用 CJS**）
//
// 为什么需要这一层：
//   1) Windows 上 Electron 是 **GUI 子系统程序**，主进程的 stdout **不连终端**
//      —— `console.log` 一条都看不到。所以必须**写日志文件**。
//   2) ESM 的静态 import 失败发生在"我的代码开始运行之前"，在 index.mjs 里
//      根本 catch 不到。这一层用 CommonJS 起步 + 动态 import，才能把
//      **任何** 失败（含导入错误）落到文件里。
//
// 用法：日志写在 <项目根>/data/_app.log
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG = process.env.GEMMA_APP_LOG || path.join(ROOT, 'data', '_app.log');

function stamp() { return new Date().toISOString().slice(11, 23); }
function w(...a) {
  const line = `[${stamp()}] ${a.map((x) => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ')}\n`;
  try { fs.appendFileSync(LOG, line, 'utf8'); } catch { /* 日志写不了也不能崩 */ }
  try { process.stdout.write(line); } catch { /* GUI 子系统没有 stdout */ }
}
globalThis.__GS_LOG = w;

// 清空上一轮日志（便于"本次运行"阅读）
try { fs.writeFileSync(LOG, '', 'utf8'); } catch { /* ignore */ }

w('=== gemma-search 启动 ===');
w('electron', process.versions.electron, '· chrome', process.versions.chrome, '· node', process.versions.node);
w('ELECTRON_RUN_AS_NODE =', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null));
w('argv =', JSON.stringify(process.argv.slice(1)));
w('日志文件 =', LOG);

// ---------- 自愈：ELECTRON_RUN_AS_NODE ----------
// 该变量会让 Electron 以纯 Node 运行，于是 `require('electron')` 拿到的是
// npm 包装包（一个 75 字符的 electron.exe 路径字符串），报错极具误导性：
//   找不到 @huggingface/transformers / 没有具名导出 BrowserWindow / protocol undefined
// 对"这是一个 Electron 应用"而言，意图毫无歧义 —— 所以去掉该变量重新拉起自己，
// 让 `npm start` 无论环境如何都能用（而不是要求用户记得手动清变量）。
if (process.env.ELECTRON_RUN_AS_NODE) {
  w('检测到 ELECTRON_RUN_AS_NODE，去掉它后重新拉起自身（自愈）');
  try {
    const { spawn } = require('node:child_process');
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, [ROOT], { env: cleanEnv, detached: true, stdio: 'ignore' });
    child.unref();
    w('已拉起新进程 pid =', child.pid);
    process.exit(0);
  } catch (e) {
    w('!! 自愈失败：', e);
  }
}

process.on('uncaughtException', (e) => { w('!! uncaughtException:', e); });
process.on('unhandledRejection', (e) => { w('!! unhandledRejection:', e); });
process.on('exit', (code) => { w('--- 进程退出，code =', code); });

const electron = require('electron');
const apiKeys = Object.keys(electron || {});
w('electron 模块：typeof =', typeof electron, '· 键数量 =', apiKeys.length, '· app =', typeof (electron && electron.app));

if (!electron || !electron.app || typeof electron.app.whenReady !== 'function') {
  w('!! 拿不到 Electron 运行时 API（这通常意味着 ELECTRON_RUN_AS_NODE 生效了）');
  w('   解决：PowerShell 里 $env:ELECTRON_RUN_AS_NODE=$null 后重试');
  process.exit(3);
}

import('./index.mjs')
  .then(() => w('index.mjs 已载入（后续日志由它继续写）'))
  .catch((e) => { w('!! index.mjs 载入失败：', e); process.exit(4); });

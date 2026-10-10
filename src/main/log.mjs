// src/main/log.mjs —— 主进程日志（**必须写文件**）
//
// 为什么不是只 console.log（本项目实测踩过，见 app/main/bootstrap.cjs 的记录）：
//   Windows 上 Electron 是 **GUI 子系统程序**，主进程的 stdout **不连终端** ——
//   `console.log` 一条都看不到，表现出来就是"启动后什么都没发生"。
//   所以日志同时写 `<根>/data/_app.log`（可用 GEMMA_APP_LOG 覆盖）与 stdout
//   （dev 态 electron-vite 把 stdout 接回终端，所以两种运行方式都能读到）。
//
// 模块导入即初始化：截断上一轮日志并写下本轮头部。副作用写在模块顶层是**故意的** ——
// 它必须早于任何可能抛错的导入执行，否则"导入期失败"会连一行日志都不留。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 应用根目录（`config.json` / `data/` 所在处）。
 *
 * dev / 未打包：`out/main` → 上两级 = 项目根。
 * 打包后（P6）：`out/main` 在 `app.asar` 内，`data/` 不能写在 asar 里 ——
 *   那时必须改用 `path.dirname(app.getPath('exe'))` 或 `app.getPath('userData')`。
 *   这里先只把事实**报出来**（见下面的 asar 警告），不在 P2 假装已经解决。
 */
export const ROOT = process.env.GEMMA_ROOT || path.resolve(HERE, '..', '..');

export const LOG_FILE = process.env.GEMMA_APP_LOG || path.join(ROOT, 'data', '_app.log');

const stamp = () => new Date().toISOString().slice(11, 23);
const fmt = (x) =>
  typeof x === 'string' ? x : x && x.stack ? x.stack : (() => {
    try { return JSON.stringify(x); } catch { return String(x); }
  })();

/** 写一行日志：文件 + stdout，两边都失败也不能让应用崩。 */
export function log(...args) {
  const line = `[${stamp()}] ${args.map(fmt).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch { /* 日志写不了不是致命错误 */ }
  try { process.stdout.write(line); } catch { /* GUI 子系统没有 stdout */ }
}

// ---------------------------------------------------------------- 初始化
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch { /* ignore */ }
try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch { /* ignore */ }

log('=== gemma-search 启动 ===');
log('electron', process.versions.electron, '· chrome', process.versions.chrome, '· node', process.versions.node);
log('ELECTRON_RUN_AS_NODE =', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null));
log('argv =', JSON.stringify(process.argv.slice(1)));
log('日志文件 =', LOG_FILE);
log('应用根 =', ROOT);
if (LOG_FILE.includes('app.asar')) {
  log('!! 注意：应用根落在 asar 内，`data/` 无法写入 —— 打包态需要改用 userData（P6）');
}

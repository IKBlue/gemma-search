// apps/desktop/e2e/helpers/launch.mjs —— 启动被测应用（**唯一**的 Electron 启动点）
//
// 三个必须做对的地方（都是本仓库实测踩过的坑，别"简化"掉）：
//
// ① **必须给主脚本路径，不能给目录**。
//    `docs/DEBT-CLEANUP.md:387` 记录：`electron .`（目录形式）在本环境**秒退**，
//    主进程以 `0xC0000005` 崩在 `app.whenReady()` 之前；改用 `out\main\index.js` 即正常出窗。
//
// ② **必须清掉 `ELECTRON_RUN_AS_NODE`**。
//    它在环境里残留时 Electron 会以**纯 Node** 运行 —— 表现是"像在跑 Node"，
//    日志一行没有、窗口永不出现。`scripts/electron-vite.mjs` 交互启动时也做同一件事。
//
// ③ **本沙箱必须 `--no-sandbox`**。
//    `tools/probe_electron_start/README.md`（2026-10-10 实测）：`electron.exe --version` 报
//    `0x80000003`、加 `--no-sandbox` 就 exit=0 ⇒ 卡住的是 **Chromium 沙箱初始化**，与项目代码无关。
//    ⚠️ 用户自己的终端**不需要**它；这里加是因为 agent 沙箱起不来进程沙箱。
//    **绝不把它固化进产品配置**（`AGENTS.md` §6.5）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';

/** 仓库根（本文件在 apps/desktop/e2e/helpers/ ⇒ 上溯四层） */
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** 构建产物入口（先跑 `npm run build`） */
export const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');

/** Electron 二进制（用仓库里那一份，不用 Playwright 自带的浏览器） */
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

/**
 * 启动应用。
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env] 追加/覆盖环境变量（例如 `GEMMA_LIB_ROOT`）
 * @param {string[]} [opts.extraArgs] 追加给 Electron 的参数
 *
 * ⚠️ 每次启动都用**独立的临时 userData**（除非调用方自己传了 --user-data-dir）：
 *    单实例锁是**按 userData** 的。默认 userData 一旦被别的实例占着锁（开发态挂着一个、
 *    上次崩溃留下的、或另一个 spec 还没退干净），这个实例就会因为
 *    `requestSingleInstanceLock() === false` 静默退出、窗口永不出现 ——
 *    表现为"e2e 莫名其妙红了"，而根因跟被测代码毫无关系（T-10a 实测踩到）。
 *    `app.mjs` 的三个场景 helper 早就各自带 --user-data-dir 了，这里补齐最后一条路。
 */
function hasUserDataDir(extraArgs) {
  return (extraArgs || []).some(
    (a) => a === '--user-data-dir' || String(a).startsWith('--user-data-dir='),
  );
}

export async function launchApp(opts = {}) {
  // env 在 Playwright 里是**整体替换** process.env，所以要先铺开再删/加
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  // 测试不该走真实用户数据目录（避免污染，也让每次跑都是"干净用户配置"）
  env.GEMMA_E2E = '1';

  // 调用方已经指了 userData（app.mjs 那三个 helper）就**原样尊重**，不覆盖
  // ⚠️ 前缀刻意与 `app.mjs` 的 `tmpDir('userdata')`（`gemma-e2e-userdata-`）**不同**：
  //    两者都在系统 temp 下，名字一样就分不清"哪个 helper 漏了没删"。
  const isolatedUserData = hasUserDataDir(opts.extraArgs)
    ? null
    : fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-e2e-launchapp-'));

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [
      '--no-sandbox',
      MAIN_ENTRY,
      ...(opts.extraArgs || []),
      ...(isolatedUserData ? ['--user-data-dir=' + isolatedUserData] : []),
    ],
    cwd: ROOT,
    env,
    timeout: 30_000,
  });

  if (isolatedUserData) {
    // 进程退出后收掉（与 app.mjs 的 rmTmp 同口径：删不掉不致命，但要试）
    app.on('close', () => {
      try {
        fs.rmSync(isolatedUserData, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    });
  }
  return app;
}

/** 等首个窗口出现（主进程在 whenReady 后才建窗） */
export async function firstWindow(app, timeout = 30_000) {
  const win = await app.firstWindow({ timeout });
  await win.waitForLoadState('domcontentloaded');
  return win;
}

/** 收集渲染进程的控制台错误 —— 界面白屏时这是唯一线索 */
export function collectConsoleErrors(win) {
  const errors = [];
  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

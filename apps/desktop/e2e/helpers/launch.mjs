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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from '@playwright/test'

/** 仓库根（本文件在 apps/desktop/e2e/helpers/ ⇒ 上溯四层） */
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** 构建产物入口（先跑 `npm run build`） */
export const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js')

/** Electron 二进制（用仓库里那一份，不用 Playwright 自带的浏览器） */
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

/**
 * 启动应用。
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env] 追加/覆盖环境变量（例如 `GEMMA_LIB_ROOT`）
 * @param {string[]} [opts.extraArgs] 追加给 Electron 的参数
 */
export async function launchApp(opts = {}) {
  // env 在 Playwright 里是**整体替换** process.env，所以要先铺开再删/加
  const env = { ...process.env, ...(opts.env || {}) }
  delete env.ELECTRON_RUN_AS_NODE
  // 测试不该走真实用户数据目录（避免污染，也让每次跑都是"干净用户配置"）
  env.GEMMA_E2E = '1'

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['--no-sandbox', MAIN_ENTRY, ...(opts.extraArgs || [])],
    cwd: ROOT,
    env,
    timeout: 30_000,
  })
  return app
}

/** 等首个窗口出现（主进程在 whenReady 后才建窗） */
export async function firstWindow(app, timeout = 30_000) {
  const win = await app.firstWindow({ timeout })
  await win.waitForLoadState('domcontentloaded')
  return win
}

/** 收集渲染进程的控制台错误 —— 界面白屏时这是唯一线索 */
export function collectConsoleErrors(win) {
  const errors = []
  win.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

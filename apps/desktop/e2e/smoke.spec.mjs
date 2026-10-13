// apps/desktop/e2e/smoke.spec.mjs —— E0 探针：Electron 起窗 + preload 桥真的接上了
//
// 这条测试的定位很特殊：**它是其余所有 E2E 的前提**。
// 如果它不过，说明本环境起不了窗（见 `tools/probe_electron_start/README.md`），
// 那后面所有 E2E 都无从谈起 —— 而不是"应用坏了"。
//
// 它同时覆盖一条**被删守卫丢掉的断言**：S9（渲染进程拿不到 Node 能力）。
// 原 `verify_app_build.mjs` §2b 只在**产物文本**上断言"暴露面恰好三键"，
// 现在这里是**在真窗口里读真的 `window.api`** —— 强度完全不同。
import { test, expect } from '@playwright/test'

import { launchApp, firstWindow, collectConsoleErrors } from './helpers/launch.mjs'

test('E0 探针：Electron 出窗，且 preload 暴露面恰好三键', async () => {
  const app = await launchApp()
  try {
    const win = await firstWindow(app)
    const errors = collectConsoleErrors(win)

    const info = await win.evaluate(() => ({
      keys: Object.keys(window.api || {}).sort(),
      hasApi: typeof window.api,
      requireType: typeof window.require,
      processType: typeof window.process,
      moduleType: typeof window.module,
    }))

    // 探针要留痕：这些值是后续判断"到底走到哪一步"的唯一依据
    console.log('  [E0] window.api =', info.hasApi, '· keys =', JSON.stringify(info.keys))
    console.log('  [E0] typeof window.require/module/process =',
      info.requireType, '/', info.moduleType, '/', info.processType)

    // ① 桥接上了
    expect(info.hasApi).toBe('object')
    // ② 暴露面**恰好**三键（多一个都是能力泄漏）
    expect(info.keys).toEqual(['invoke', 'onEvent', 'platform'])
    // ③ S9：渲染进程拿不到 Node 能力
    expect(info.requireType).toBe('undefined')
    expect(info.moduleType).toBe('undefined')
    // ④ 页面真的渲染了东西（不是白屏）
    const html = await win.evaluate(() => document.body.innerHTML.length)
    expect(html).toBeGreaterThan(0)

    console.log('  [E0] body.innerHTML 长度 =', html, '· 控制台错误 =', errors.length)
  } finally {
    await app.close()
  }
})

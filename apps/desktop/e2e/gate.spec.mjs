// apps/desktop/e2e/gate.spec.mjs —— E1：首启门禁**在真界面里**的行为（D2 的核心）
//
// 为什么这条必须用 Playwright 才算数：
//   T2 把判定抽成了纯函数 `utils/gate.js` 的 `decideGate()`，那能证明"判定逻辑对"，
//   但**证明不了"界面真的按判定渲染"** —— 组件接线错了、渲染抛了，纯函数测试照样绿。
//   本文件补的正是这一段：真的启动应用、真的看 DOM。
//
// 这是**被删守卫丢掉的 `verify_renderer_dom.mjs` §8（首启向导 7 条）**的替代，
// 而且更强：那套是 jsdom + 假 bridge，这里是真 Electron + 真 preload + 真 IPC。
import fs from 'node:fs'

import { test, expect } from '@playwright/test'

import { launchWithoutLibrary, launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

test('E1-a ⭐ 一个库都没有 ⇒ 显示首启向导，且**不显示**检索界面', async () => {
  const { app, cleanup } = await launchWithoutLibrary()
  try {
    const win = await firstWindow(app)

    // ① 向导真的渲染出来了（遮挡式 dialog）
    const wizard = win.getByRole('dialog')
    await expect(wizard).toBeVisible()
    await expect(win.getByRole('heading', { name: '先选一个素材库' })).toBeVisible()

    // ② 向导的两个操作按钮在（说明 Operation 层注入成功 —— T5 把那两个操作上移过）
    await expect(win.getByRole('button', { name: '选择文件夹…' })).toBeVisible()
    await expect(win.getByRole('button', { name: '添加这个库' })).toBeVisible()

    // ③ ⭐ **检索界面绝对不能出现** —— 这是 D2 的全部意义：
    //    一个库都没有时把用户放进检索页，他只会看到一堆莫名其妙的错误。
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toHaveCount(0)

    // ④ 无控制台错误（向导里抛异常是很容易漏的一类问题）
    const errs = []
    win.on('pageerror', (e) => errs.push(e.message))
    await win.waitForTimeout(500)
    expect(errs, `向导页不该有未捕获异常：${errs.join(' | ')}`).toEqual([])
  } finally {
    await app.close()
    cleanup()
  }
})

test('E1-b 有库 ⇒ 进检索界面，且**不显示**向导', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)

    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
    await expect(win.getByRole('dialog')).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E1-c 界面上有真实的库来源证据（侧栏显示库根，不是"未配置"）', async () => {
  const { app, libRoot, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    // 侧栏的"当前图库"显示的是主进程解析出来的 root ⇒ 证明 IPC 真的通了、配置真的读到了
    await expect(win.locator('.side-root')).toContainText('lib-mini', { timeout: 15_000 })
    // ⚠️⭐ 2026-10-15（T-43 / F-2）：**只断文本会假绿** —— 夹具路径写错时它的 basename 仍然是
    //    `lib-mini`，这条断言照样通过（当时实测：27 条全绿，而那个目录根本不存在）。
    //    要证明「真的读到了库」，判据必须落到磁盘上。这是 F-2 的直接回归防线。
    expect(fs.existsSync(libRoot) && fs.statSync(libRoot).isDirectory(),
      `侧栏显示的库根在磁盘上不存在（或不是目录）：${libRoot}`).toBe(true)
    console.log('  [E1-c] 侧栏库根 =', await win.locator('.side-root').innerText(), '· 期望含', libRoot)
  } finally {
    await app.close()
    cleanup()
  }
})

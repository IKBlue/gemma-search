// apps/desktop/e2e/browse.spec.mjs —— P4-2：F2 浏览页的**真窗口**验收
//
// ── 当前状态（重要）──────────────────────────────────────────────────────
//   F2 的读路径 `items`（SPEC §5.1 第 21 个方法）**实现是 S8（task-62），还没落地**
//   ⇒ 页面在真窗口里**故意**显示「列表方法还没接通」，而不是显示一个空的库
//     （空列表 = 「库是空的」是个事实断言，在方法不存在时断言它就是说谎）。
//
//   因此本文件现在只覆盖**已经能验的那一半**：页面可达 + 骨架渲染 + 未接通时**不假装空库**。
//   ⚠️ 任务书要求的三条（筛选生效 / 空态区分 / 虚拟滚动）**必须等 S8 落地后**才能真验 ——
//      到时在下面补 E14-b/c/d（我会在 S8 收口时接上，或由接手的人按同样的挂点写）。
import { test, expect } from '@playwright/test'

import { launchWithLibrary, launchFake } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

test('E14-a ⭐ /browse 真窗口可达：侧栏能点进去，骨架与工具条都在', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    // 真界面起来了（有库 ⇒ 不是首启向导）
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })

    // 走侧栏链接（这就是用户能点到的入口）
    await win.getByRole('link', { name: '浏览图库' }).click()
    await expect(win.getByRole('heading', { name: '浏览整库' })).toBeVisible({ timeout: 20_000 })
    expect(await win.evaluate(() => window.location.hash), 'hash 应当真的变成 /browse').toContain('/browse')
    // 窗口标题来自 router/paths.ts 的 LABELS（唯一来源）
    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('浏览图库')

    // 骨架：工具条（分类/有无包/扩展名/排序）与刷新按钮
    await expect(win.getByTestId('browse-toolbar')).toBeVisible()
    await expect(win.getByRole('button', { name: /刷新/ })).toBeVisible()
    await expect(win.getByLabel('排序方式')).toBeVisible()
    await expect(win.getByRole('button', { name: '全部' }).first()).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E14-b ⭐⭐ 读路径未接通时**如实说**，绝不显示成「这个库是空的」', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })
    await win.getByRole('link', { name: '浏览图库' }).click()
    await expect(win.getByRole('heading', { name: '浏览整库' })).toBeVisible({ timeout: 20_000 })

    // 错误面板在（Adapter 归一后的 userMessage + code），空库面板**不在**
    await expect(win.getByTestId('browse-error')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-error')).toContainText('还没接通')
    await expect(win.getByTestId('browse-empty')).toHaveCount(0)
    await expect(win.getByTestId('browse-no-match')).toHaveCount(0)
    // 诊断入口要在（读不出来时给用户一条能自救的路）
    await expect(win.getByRole('link', { name: '打开诊断与重建' })).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E14-c 模拟模式（GEMMA_FAKE=1）下浏览页同样可达且同样如实报未接通', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })
    await win.getByRole('link', { name: '浏览图库' }).click()
    await expect(win.getByRole('heading', { name: '浏览整库' })).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-error')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-empty')).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

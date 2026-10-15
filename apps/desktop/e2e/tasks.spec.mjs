// apps/desktop/e2e/tasks.spec.mjs —— E10：索引任务页的**诚实态**（S6 重写）
//
// ⚠️ 2026-10-15 · S6（绿地基线 §2.2）：indexStart / indexCancel / indexResume **已从契约删除**
//   （job 表本轮没建）⇒ 这一页没有后端了。Lead 的裁定：**不许留假按钮的用例** ——
//   要么删用例、要么断言「诚实态」文案。这里选后者（页面还在，只是如实说"等表上线"）。
//
// 旧用法（E10-a…f）测的是「阶段条 + 计数 + 条/秒 + 失败项 + 取消语 + GPU 回退 + 真实模式如实报」——
// 那些都建立在已删除的三个方法上，随方法一起退场（保留它们等于给不存在的功能留断言）。
import { test, expect } from '@playwright/test'

import { launchFake } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

test('E10-a ⭐ 索引任务页 = 诚实态：说明「等对应的数据表上线」，且**没有**开始索引按钮', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await win.evaluate(() => { window.location.hash = '#/tasks' })
    await expect.poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 }).toBe('#/tasks')

    await expect(win.getByTestId('tasks-unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('tasks-unavailable')).toContainText('该功能等对应的数据表上线')
    // 说清「为什么」：job 表还没建（页头副标题）＋ 三个方法已删（面板正文）
    await expect(win.getByText(/job 表/).first()).toBeVisible()
    await expect(win.getByTestId('tasks-unavailable')).toContainText('indexStart')
    await expect(win.getByTestId('tasks-unavailable')).toContainText('indexCancel')
    await expect(win.getByTestId('tasks-unavailable')).toContainText('indexResume')

    // ⚠️ 关键：**一个假按钮都不许有** —— 不许出现「开始索引 / 取消 / 续跑」这类点了不动的按钮
    await expect(win.getByRole('button', { name: /开始索引/ })).toHaveCount(0)
    await expect(win.getByRole('button', { name: /续跑/ })).toHaveCount(0)

    // 窗口标题仍然按 LABELS.tasks 设置（页面名唯一来源 = router/paths.ts）
    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('索引任务')
  } finally {
    await app.close()
    cleanup()
  }
})

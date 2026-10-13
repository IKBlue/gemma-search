// apps/desktop/e2e/routing.spec.mjs —— E2：3 条路由**真的能走**（退役 T2 的人工待办）
//
// 这条测试有很具体的来历：T2 做完时我留了一条待办 ——
//   「☐ 人工 `npm run dev` 确认 3 条路由可点、地址栏跟着变、无库时仍显示向导」，
//   因为 `router.test.mjs` 只能用 `matchRoutes()` 证明**路由表对**，
//   证明不了**组件真的挂在路由上**、**点击真的会导航**、**hash 真的会变**。
// Playwright 把这条待办变成自动的。
import { test, expect } from '@playwright/test'

import { launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

const hashOf = (win) => win.evaluate(() => window.location.hash)

test('E2-a 默认落在搜索页（hash 为空即 `/`）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
    // hash 路由下初始通常是空 hash（等价于 '/'）；断言"不是别的路由"更稳
    const h = await hashOf(win)
    expect(['', '#/', '#/search'].includes(h), `初始 hash 不该是子路由，实得 ${h}`).toBe(true)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-b ⭐ 侧栏点「索引任务」⇒ 真的导航，hash 与界面都变', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)

    // 侧栏那一项自 T2 起是 `NavLink`（此前是 disabled + toast）
    await win.getByRole('link', { name: '索引任务' }).click()

    await expect.poll(() => hashOf(win), { timeout: 10_000 }).toBe('#/tasks')
    await expect(win.getByRole('heading', { name: '索引任务与操作记录' })).toBeVisible()
    // 旧页面应该不在了（真的换了页，不是叠了一层）
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-c ⭐ `/item/:libId/:uid` 的参数**在真界面里**取到了（P3c 靠它拿两条路径）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)

    // 直接改 hash（等价于从结果卡点进去 —— 结果卡要模型，这里不依赖它）
    await win.evaluate(() => { window.location.hash = '#/item/L1/0123456789ab' })

    await expect(win.getByTestId('route-libId')).toHaveText('L1')
    await expect(win.getByTestId('route-uid')).toHaveText('0123456789ab')
    await expect(win.getByRole('heading', { name: '图片详情' })).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-d 未知 hash ⇒ 回搜索页（不白屏）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)

    await win.evaluate(() => { window.location.hash = '#/这个路由不存在' })

    // `router/index.jsx` 的 catch-all 是 `<Navigate to="/" replace />`
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
    await expect.poll(() => hashOf(win), { timeout: 10_000 }).toBe('#/')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-e 返回搜索页（从任务页导航回去）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await win.getByRole('link', { name: '索引任务' }).click()
    await expect(win.getByRole('heading', { name: '索引任务与操作记录' })).toBeVisible()

    await win.getByRole('link', { name: '语义搜索' }).click()
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
    await expect.poll(() => hashOf(win), { timeout: 10_000 }).toBe('#/')
  } finally {
    await app.close()
    cleanup()
  }
})

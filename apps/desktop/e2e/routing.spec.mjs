// apps/desktop/e2e/routing.spec.mjs —— E2：3 条路由**真的能走**（退役 T2 的人工待办）
//
// 这条测试有很具体的来历：T2 做完时我留了一条待办 ——
//   「☐ 人工 `npm run dev` 确认 3 条路由可点、地址栏跟着变、无库时仍显示向导」，
//   因为 `router.test.mjs` 只能用 `matchRoutes()` 证明**路由表对**，
//   证明不了**组件真的挂在路由上**、**点击真的会导航**、**hash 真的会变**。
// Playwright 把这条待办变成自动的。
import { test, expect } from '@playwright/test'

import { launchFake, launchWithLibrary } from './helpers/app.mjs'
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
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible()
    // 旧页面应该不在了（真的换了页，不是叠了一层）
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-c ⭐ `/item/:libId/:uid` 的参数**在真界面里**取到了（P3c 靠它拿两条路径）', async () => {
  // ⚠️ 2026-10-13 改写：P3c 从**占位页**变成真页面后，原先那两个 `route-libId`/`route-uid`
  //    回显元素没有了。现在改成断言**真页面真的消费了这两个参数** —— 比回显强：
  //    详情页会拿它们去调 `item`/`itemPaths`，uid 错一位就会报 UID_NOT_FOUND。
  //    场景换成模拟模式（`launchFake`）：`launchWithLibrary` 的迷你夹具库没有索引，
  //    页面只会停在错误态，证明不了"参数被正确使用"。
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)

    // 直接改 hash（等价于从结果卡点进去 —— 结果卡要模型，这里不依赖它）
    await win.evaluate(() => { window.location.hash = '#/item/L1/a00000000001' })

    // 参数被用上了：拉到的就是那一条（stem 来自 fixture）
    await expect(win.getByRole('heading', { name: 'VR-101' })).toBeVisible({ timeout: 20_000 })
    await expect(win.locator('[data-meta="uid"] > span:nth-child(2)')).toHaveText('a00000000001')
    await expect(win.locator('[data-meta="库"] > span:nth-child(2)')).toHaveText('L1')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E2-c2 `/item` 用错的 uid ⇒ 如实报错（参数**真的**被送到了引擎，不是被忽略）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await win.evaluate(() => { window.location.hash = '#/item/L1/deadbeefdead' })
    await expect(win.getByTestId('item-error')).toBeVisible({ timeout: 20_000 })
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
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible()

    await win.getByRole('link', { name: '语义搜索' }).click()
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
    await expect.poll(() => hashOf(win), { timeout: 10_000 }).toBe('#/')
  } finally {
    await app.close()
    cleanup()
  }
})

// ============================================================ E6：T2 人工核对发现的两处缺陷
//
// 2026-10-13 真跑了一遍「点路由 + 看观感」（截图 + 读真窗口的 URL/标题），发现两处：
//   ① `<Button><Link>` 渲染出 **`<a>` 嵌在 `<button>` 里**（4 处）—— 非法 HTML + 两个可聚焦元素 + 图标不居中
//   ② `document.title` **从不随路由变** —— 切到「索引任务」，任务栏还写着"素材语义检索"
// 两条都已修；下面把它们钉成**真窗口**断言（静态那半在 `tests/dom-validity.test.mjs`）。
// ⚠️ 这两条只能在这里验：静态读源码证明不了"最终 DOM 里没有 button>a"，
//    也证明不了"浏览器真的把 title 换掉了"。

test('E6-a ⭐ 真窗口 DOM 里没有 `<a>` 嵌在 `<button>` 里（T2 修的那 4 处）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)

    // 逐页都查一遍 —— 缺陷当初就在 tasks / item 两页
    for (const route of ['#/', '#/tasks', '#/item/L1/0123456789ab']) {
      await win.evaluate((h) => { window.location.hash = h }, route)
      await expect.poll(() => hashOf(win), { timeout: 10_000 }).toBe(route)
      const nested = await win.evaluate(() => ({
        count: document.querySelectorAll('button a').length,
        where: [...document.querySelectorAll('button a')].map((a) => a.getAttribute('href')),
      }))
      expect(nested.count, `${route} 上不该有 button 里套 a（实得 href: ${JSON.stringify(nested.where)}）`).toBe(0)
    }
  } finally {
    await app.close()
    cleanup()
  }
})

test('E6-b ⭐ 返回控件是**链接**（语义正确 + 只有一个可聚焦元素）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await win.getByRole('link', { name: '索引任务' }).click()
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible()

    // 顶栏的返回控件：asChild 之后应当是 link 而不是 button
    await expect(win.getByRole('link', { name: '返回搜索' })).toBeVisible()
    await expect(win.getByRole('button', { name: '返回搜索' })).toHaveCount(0)

    // 而且它真的能点回去
    await win.getByRole('link', { name: '返回搜索' }).click()
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E6-c ⭐ 窗口标题随路由变（修前：三条路由共用一个标题）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    const titleOf = () => win.evaluate(() => document.title)

    await win.evaluate(() => { window.location.hash = '#/' })
    await expect.poll(titleOf, { timeout: 10_000 }).toBe('语义搜索 · gemma-search')

    await win.evaluate(() => { window.location.hash = '#/tasks' })
    await expect.poll(titleOf, { timeout: 10_000 }).toBe('索引任务 · gemma-search')

    await win.evaluate(() => { window.location.hash = '#/item/L1/0123456789ab' })
    await expect.poll(titleOf, { timeout: 10_000 }).toBe('图片详情 · gemma-search')

    // 未知路由回退到搜索页 ⇒ 标题也应当跟着回退
    await win.evaluate(() => { window.location.hash = '#/不存在' })
    await expect.poll(titleOf, { timeout: 10_000 }).toBe('语义搜索 · gemma-search')
  } finally {
    await app.close()
    cleanup()
  }
})

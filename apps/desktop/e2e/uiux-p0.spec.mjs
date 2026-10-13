// apps/desktop/e2e/uiux-p0.spec.mjs —— UI/UX 治理 P0 的真窗口断言（E12 系列）
//
// 这两条**只能**在真窗口里证，静态扫描抓不到：
//   · **V-28（Critical）**：`/item/:libId/:uid` 详情页早就实现了，但**从界面走不到** ——
//     全仓 `PATHS.item` 只出现在路由表定义里，没有任何链接指向它。判据是"点得到、地址栏真的变"，
//     不是"源码里有个 href 字符串"。
//   · **V-01（High）**：侧栏当前项的 `className` 表达式**恒为 `undefined`**（`cn(x, false) || undefined`）。
//     判据是**计算结果**（类名 + 计算背景），不是源码文本 —— 这正是"静态断言会假绿"的典型。
//
// ⚠️ 这一套用的是**引擎桩**（`helpers/engine-stub.mjs`）：它证明的是**接线与可达性**，
//    **不是**检索质量、也不是详情页内容正确性（那两条各有 E9 与 TODO B-3 负责）。
import { test, expect } from '@playwright/test'

import { launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'
import { searchOnce } from './helpers/engine-stub.mjs'

/** 侧栏链接（真实渲染出来的 `<a>`） */
const navLink = (win, name) => win.locator('.nav a', { hasText: name })

test('E12-a ⭐ 结果卡的标题是**真链接**，指向详情页（V-28）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    const link = win.getByTestId('card-detail-link').first()
    await expect(link).toBeVisible()
    // 是 `<a>` 而不是 `<div>` —— 这条同时保证"能用键盘 Tab 到"
    expect(await link.evaluate((el) => el.tagName)).toBe('A')
    const href = await link.getAttribute('href')
    expect(href, `详情链接的 href 应指向 /item/L1/<uid>，实际 ${href}`).toContain('#/item/L1/aaa111aaa111')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E12-b ⭐ 点标题**真的能进详情页**（hash + 窗口标题都变）（V-28）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    // 点之前：在搜索页
    await expect(win).toHaveTitle(/语义搜索/)

    await win.getByTestId('card-detail-link').first().click()

    // ⭐ 判据是"地址栏真的变了 + 标题真的换了"，不是"链接存在"
    await expect.poll(() => win.evaluate(() => location.hash), { timeout: 10_000 })
      .toBe('#/item/L1/aaa111aaa111')
    await expect(win).toHaveTitle(/图片详情/)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E12-c ⭐ 侧栏当前页有 `active` 类（V-01：修前恒为 undefined）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    const current = navLink(win, '语义搜索')
    await expect(current).toBeVisible()
    const cls = await current.getAttribute('class')
    expect(cls, `当前项应带 active 类，实际 class=${JSON.stringify(cls)}`).toMatch(/\bactive\b/)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E12-d ⭐⭐ 侧栏当前项**计算背景不透明**（V-01 的真正判据：看得见）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    const current = navLink(win, '语义搜索')
    const styles = await current.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, shadow: s.boxShadow, color: s.color }
    })
    // 修前实测是 `rgba(0, 0, 0, 0)` + `none` —— 用户完全看不出自己在哪一页
    expect(styles.bg, `当前项背景不该是透明，实际 ${styles.bg}`).not.toBe('rgba(0, 0, 0, 0)')
    expect(styles.shadow, '当前项应有左侧强调条（inset box-shadow）').not.toBe('none')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E12-e ⭐ 换一页之后 active **跟着转移**（证明它不是恒真）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    await navLink(win, '索引任务').click()
    await expect.poll(() => win.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/tasks')

    const tasks = navLink(win, '索引任务')
    expect(await tasks.getAttribute('class')).toMatch(/\bactive\b/)
    const bg = await tasks.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E12-f ⭐ 非当前项**没有** active（防"全都带 active"这种假绿）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    // 起始在搜索页 ⇒ 其余三项都不该 active
    for (const name of ['索引任务', '操作记录']) {
      const other = navLink(win, name)
      await expect(other).toBeVisible()
      const cls = await other.getAttribute('class')
      expect(cls || '', `非当前项「${name}」不该带 active，实际 class=${JSON.stringify(cls)}`).not.toMatch(/\bactive\b/)
      const bg = await other.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg, `非当前项「${name}」背景不该是选中色`).toBe('rgba(0, 0, 0, 0)')
    }
  } finally {
    await app.close()
    cleanup()
  }
})

// apps/desktop/e2e/activity.spec.mjs —— E11：操作记录（事务表 / 待处理三条路）
//
// 规格出处：
//   · `UI-REVIEW-and-migration.md:76`「操作记录缺少**撤销状态**，这是本应用的安全底线」
//   · `:250` 失败/中断 ⇒ 进入「待处理」，给「**重试 / 回退 / 保持现状**」
//   · `SPEC-transactions.md:229`「界面据 id 查询状态、提供撤销入口」
//   · 契约 §5（`RECOVERY_NEEDED` 带 `canUndo`/`canRollback`，界面据此决定按钮）
//
// 数据源是新增的只读方法 `transactions`（契约 §2.11）；真实模式尚未实现 ⇒ 那半由 E11-e 钉。
import { test, expect } from '@playwright/test'

import { launchFake, launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

const open = async (win, hash = '#/activity') => {
  await win.evaluate((h) => { window.location.hash = h }, hash)
  await expect.poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 }).toBe(hash)
}

test('E11-a ⭐ 侧栏「操作记录」现在能点（不再是 disabled 占位）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    const link = win.getByRole('link', { name: '操作记录' })
    await expect(link).toBeVisible({ timeout: 20_000 })
    await link.click()
    await expect(win.getByRole('heading', { name: '操作记录' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => win.evaluate(() => window.location.hash)).toBe('#/activity')
    // 当前项语义（NavLink 自带）
    await expect(link).toHaveAttribute('aria-current', 'page')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E11-b ⭐ 事务表列出记录，每条都带**撤销状态**（UI-REVIEW:76 的安全底线）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await open(win)

    const table = win.getByTestId('tx-table')
    await expect(table).toBeVisible({ timeout: 20_000 })
    const rows = table.locator('[data-tx]')
    expect(await rows.count()).toBeGreaterThanOrEqual(3)

    // 每一行都要能看出"能不能撤销" —— 这正是原先缺的那一列
    const undoFlags = await table.locator('[data-tx-undo]').allTextContents()
    expect(undoFlags.length).toBe(await rows.count())
    for (const f of undoFlags) expect(f).toMatch(/可以|不可以/)

    // 状态列要有具体的 state 值（不是只有中文）
    const states = await table.locator('[data-tx-state]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tx-state')))
    expect(states).toContain('committed')
    expect(states).toContain('recovery_needed')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E11-c ⭐ 待处理项给**三条路**，且「保持现状」明说它不动磁盘', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await open(win)

    const panel = win.getByTestId('pending-panel')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('待处理操作')

    const txId = 'tx-2f9c'
    for (const [action, label] of [['retry', '重试'], ['rollback', '回退'], ['leave', '保持现状']]) {
      const btn = win.locator(`[data-action="${action}:${txId}"]`)
      await expect(btn).toBeVisible()
      await expect(btn).toHaveText(label)
    }
    // 「保持现状」必须说清它**不改文件**，否则用户会以为点了就等于处理好了
    await expect(panel).toContainText('不动磁盘')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E11-d ⭐ 回退真的改状态：待处理消失、事务变「已撤销」、`blocked` 不再提示', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await open(win)

    const row = win.locator('[data-tx="tx-2f9c"]')
    await expect(row.locator('[data-tx-state]')).toHaveAttribute('data-tx-state', 'recovery_needed', { timeout: 20_000 })
    await expect(row.locator('[data-tx-undo]')).toHaveText('可以')

    await win.locator('[data-action="rollback:tx-2f9c"]').click()

    // 状态变了、撤销列也跟着变（不是只弹个 toast）
    await expect(row.locator('[data-tx-state]')).toHaveAttribute('data-tx-state', 'undone', { timeout: 15_000 })
    await expect(row.locator('[data-tx-undo]')).toHaveText('不可以')
    // 待处理面板里那条消失
    await expect(win.locator('[data-pending="tx-2f9c"]')).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E11-e ⭐ 真实模式：如实报「还没做好」，**不返回空表假装"没有事务"**', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await open(win)
    await expect(win.getByTestId('activity-error')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('activity-error')).toContainText(/还没做好/)
    // 关键：**不能**显示"还没有任何写操作记录"（那会让人以为日志是通的、只是恰好为空）
    await expect(win.getByTestId('tx-table')).toHaveCount(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E11-f 不可撤销的事务：状态如实显示「不可以」，回退按钮禁用并说明原因', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await open(win)
    const row = win.locator('[data-tx="tx-2f9b"]')
    await expect(row.locator('[data-tx-state]')).toHaveAttribute('data-tx-state', 'committed', { timeout: 20_000 })
    await expect(row.locator('[data-tx-undo]')).toHaveText('不可以')
  } finally {
    await app.close()
    cleanup()
  }
})

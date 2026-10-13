// apps/desktop/e2e/tasks.spec.mjs —— E10：P3d 索引任务页（模拟模式下跑**真进度事件流**）
//
// 为什么这组现在可复跑：P3d 的验收要「阶段条/进度/ETA/失败项/取消在边界生效」，
// 而真实 `indexStart` 要 ONNX 模型（且主进程现在显式拒绝它）。
// `GEMMA_FAKE=1`（契约 §8）提供**假进度**（约 10s 走完、发真事件、取消立即收尾）⇒ 真窗口可验。
//
// 规格出处：`docs/design/UI-REVIEW-and-migration.md:240-244`；契约 §3（进度/取消/失败清单/GPU 回退）。
import { test, expect } from '@playwright/test'

import { launchFake, launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

const goto = async (win, hash = '#/tasks') => {
  await win.evaluate((h) => { window.location.hash = h }, hash)
  await expect.poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 }).toBe(hash)
}

test('E10-a 未跑过时是**诚实的空态**（不编进度、不假装在跑）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await goto(win)

    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible({ timeout: 20_000 })
    // 阶段条五步都在
    expect(await win.locator('[data-phase]').count()).toBe(5)
    // 取消按钮**不可点**（没在跑）
    await expect(win.locator('[data-action="cancel"]')).toBeDisabled()
    // 计数是 0 / —，不是编出来的 0%
    await expect(win.getByTestId('job-counts')).toContainText('0')
    await expect(win.getByTestId('job-eta')).toContainText('—')
    await expect(win.locator('[data-testid="job-bar"]')).toHaveAttribute('data-determinate', 'no')
    // 空态要说明"真实模式下这个功能还没做"，并给出模拟模式入口
    await expect(win.getByText(/GEMMA_FAKE=1/)).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E10-b ⭐ 开始索引 ⇒ 进度真的推进（阶段条 + 计数 + 条/秒）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await goto(win)
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible({ timeout: 20_000 })

    await win.locator('[data-action="start"]').click()

    // 进度必须真的动起来（fake 每 400ms 推一条）
    await expect.poll(async () => {
      const t = await win.getByTestId('job-counts').innerText()
      const m = t.match(/已处理\s*(\d+)/)
      return m ? Number(m[1]) : 0
    }, { timeout: 20_000 }).toBeGreaterThan(0)

    // 有阶段被标成"当前"或"已完成"
    const nowOrDone = await win.locator('[data-phase-state="now"], [data-phase-state="done"]').count()
    expect(nowOrDone).toBeGreaterThan(0)

    // 跑到收尾，看"复用 N · 新编码 M · 失败 K"
    await expect(win.getByTestId('job-summary')).toBeVisible({ timeout: 30_000 })
    const sum = await win.getByTestId('job-summary').innerText()
    expect(sum).toMatch(/复用/)
    expect(sum).toMatch(/新编码/)
    expect(sum).toMatch(/失败/)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E10-c ⭐ 失败项**可展开**，且每条能说清「哪条 / 哪个阶段 / 为什么」（UI-REVIEW:243）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await goto(win)
    await win.locator('[data-action="start"]').click()

    const list = win.getByTestId('failed-list')
    await expect(list).toBeVisible({ timeout: 30_000 })
    await expect(list.locator('summary')).toContainText('失败')

    // 用原生 <details> ⇒ 可键盘操作、可折叠，不用自己写 aria
    const items = list.locator('[data-failed]')
    expect(await items.count()).toBeGreaterThan(0)
    for (const li of await items.all()) {
      const t = await li.innerText()
      expect(t).toMatch(/阶段\s*\S+/)          // 哪个阶段
      expect(t).toMatch(/（\w+）/)             // 错误码
      expect(t.length).toBeGreaterThan(10)     // 有原因，不是空壳
    }
  } finally {
    await app.close()
    cleanup()
  }
})

test('E10-d ⭐ 取消：按钮标注了"当前批次结束后停止"，点完 done **停住**且结果标为已取消', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await goto(win)

    // 规格要求把这个承诺写在界面上
    await expect(win.getByTestId('cancel-note')).toContainText('当前批次结束后停止')

    await win.locator('[data-action="start"]').click()
    // 等进度真的动起来再取消（取消"边界"的意义就在这里）
    await expect.poll(async () => {
      const t = await win.getByTestId('job-counts').innerText()
      const m = t.match(/已处理\s*(\d+)/)
      return m ? Number(m[1]) : 0
    }, { timeout: 20_000 }).toBeGreaterThan(0)
    const before = Number((await win.getByTestId('job-counts').innerText()).match(/已处理\s*(\d+)/)[1])

    await win.locator('[data-action="cancel"]').click()

    // 契约 §3：取消后最多 2s 内收尾
    await expect(win.getByTestId('job-summary')).toBeVisible({ timeout: 10_000 })
    await expect(win.getByTestId('job-summary')).toContainText('已取消')

    const after = Number((await win.getByTestId('job-counts').innerText()).match(/已处理\s*(\d+)/)[1])
    expect(after).toBeGreaterThanOrEqual(before)
    expect(after).toBeLessThan(30)   // **停在中途**，不是跑完了
  } finally {
    await app.close()
    cleanup()
  }
})

test('E10-e ⭐ GPU 回退**显示在界面上**（契约 §3「不静默」）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    await goto(win)
    // 默认设备是 webgpu ⇒ fake 会在中途公告回退
    await win.locator('[data-action="start"]').click()
    await expect(win.getByTestId('device-fallback')).toBeVisible({ timeout: 30_000 })
    await expect(win.getByTestId('device-fallback')).toContainText('webgpu')
    await expect(win.getByTestId('device-fallback')).toContainText('cpu')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E10-f ⭐ 真实模式点「开始索引」⇒ **如实报"还没做好"**，不假装在跑', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await goto(win)
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible({ timeout: 20_000 })

    await win.locator('[data-action="start"]').click()

    // ⚠️⚠️ **靶子必须唯一** —— 这条断言原先写的是 `getByText(/这个功能还没做好/)`，
    //    而界面空态提示里**也**出现了同一句话 ⇒ Playwright strict mode 匹配到 2 个元素。
    //    更坏的是：toast 还没挂上时，它只匹配到**那一段提示** ⇒ 断言**假绿**
    //    （2026-10-13 实测：整套里挂 2/3 次，单独跑却"通过"）。
    //    ⇒ 改成盯 `#toast`（`ui/Toast.jsx` 的 id，始终存在于 DOM，只有带消息时才加 `show`）。
    //    用 `toContainText` 而不是 `toBeVisible`：不依赖那条 `show` 类对应的 CSS，判据更直接。
    const toast = win.locator('#toast')
    await expect(toast).toContainText('这个功能还没做好', { timeout: 15_000 })

    // 回归：空态提示**不许抄引擎那句原文**（抄了上面这条就又会歧义/假绿）
    await expect(win.getByTestId('tasks-empty-hint')).not.toContainText('这个功能还没做好')

    // 而且**不能**进入"运行中"的假象
    await expect(win.locator('[data-testid="job-bar"]')).toHaveAttribute('data-determinate', 'no')
    await expect(win.locator('[data-action="cancel"]')).toBeDisabled()
  } finally {
    await app.close()
    cleanup()
  }
})

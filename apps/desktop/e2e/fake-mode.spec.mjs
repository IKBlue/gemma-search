// apps/desktop/e2e/fake-mode.spec.mjs —— E8：契约 §8 模拟模式在**真窗口**里可用
//
// 这组补的是 P3c/P3d 的前置：没有它，那两个页面的"有结果 / 有进度 / 有失败项"状态
// 只能靠人工对着真库看（而真库要 ONNX 模型）。
//
// 引擎侧的形状已由 `packages/engine/tests/fake.test.mjs`（14 条）钉住；这里验的是**接线**：
//   `GEMMA_FAKE=1` → 主进程建模拟引擎 → 不拒绝那 4 个方法 → 界面真的显示样例数据。
//
// ⚠️ 这组**不**代替真实检索的验证：模拟模式证明的是"接线通、界面能渲染状态"，
//    不是"检索质量对"。别把它读成后者（`TODO.md` B-3 仍是那条边界）。
import { test, expect } from '@playwright/test'

import { launchFake, launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

test('E8-a ⭐ `GEMMA_FAKE=1` 能起来，且界面显示的是**样例库**（不是真库）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    // 样例索引的库是 L1「示例库」，root 是合成路径 Z:\__fake_library__（本机不该有它）
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })

    const root = await win.evaluate(() => document.body.innerText.includes('__fake_library__'))
    expect(root, '界面应显示样例库根（Z:\\__fake_library__）—— 说明走的是 fixture 而不是真库').toBe(true)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E8-b ⭐ 模拟模式能搜出结果（P3c/P3d 需要"有结果"这个状态）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    const input = win.locator('#query')
    await expect(input).toBeVisible({ timeout: 20_000 })
    await input.fill('吊灯')
    await input.press('Enter')

    await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible({ timeout: 20_000 })
    // 30 条样例（topK 默认 50）⇒ 结果计数应可读
    await expect(win.getByText(/搜索结果/)).toBeVisible()
    // 第一条固定是 VR-101（固定排序，契约 §8）
    await expect(win.getByText('VR-101.rar')).toBeVisible()
  } finally {
    await app.close()
    cleanup()
  }
})

test('E8-c `indexStatus` 在模拟模式下报 3 个库，且含"索引损坏"那个（状态演示用）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    const r = await win.evaluate(async () => {
      const res = await window.api.invoke('indexStatus', {})
      return res.ok ? { n: res.data.libs.length, ids: res.data.libs.map((l) => l.libId) } : { err: res.error.code }
    })
    expect(r.err).toBeUndefined()
    expect(r.n).toBe(3)
    expect(r.ids).toEqual(['L1', 'L2', 'L3'])
  } finally {
    await app.close()
    cleanup()
  }
})

test('E8-d ⭐⭐ 未登记方法在**模拟模式下也被拒**（白名单是唯一闸门，模拟模式不放行任何未登记方法）', async () => {
  // ⚠️ 2026-10-15 · S6：**断言变强**，不是放宽。
  //   改前：indexStart 在模拟模式下**必须成功**（返回值里 jobId 匹配 /^j-fake-/）——
  //         那是「引擎桩为诚实桩提供假实现」的年代。
  //   改后：indexStart 已按绿地基线 §2.2 从契约删除 ⇒ 现在要求它**无论如何都被拒**（BAD_REQUEST），
  //         并且**同一个窗口里** libraryList（启动期方法）照常可用 —— 证明拒绝来自白名单，而不是整个 IPC 坏了。
  //   为什么这不是放宽：旧断言保证「某个方法能跑」；新断言保证「删掉的方法在任何模式下都跑不了」，
  //         而且多了一条正向对照。删掉的方法越多，这条负向断言越有价值。
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    const r = await win.evaluate(async () => {
      const started = await window.api.invoke('indexStart', { libId: 'L1', device: 'cpu' })
      const bogus = await window.api.invoke('exec', { cmd: 'whoami' })
      const alive = await window.api.invoke('libraryList', {})
      const code = (res) => (res.ok ? null : res.error.code)
      return { started: code(started), bogus: code(bogus), aliveOk: alive.ok, aliveN: alive.ok ? alive.data.libraries.length : null }
    })
    expect(r.started, 'indexStart 已从契约删除 ⇒ 模拟模式下也必须 BAD_REQUEST').toBe('BAD_REQUEST')
    expect(r.bogus, '未登记方法（exec）同样必须 BAD_REQUEST').toBe('BAD_REQUEST')
    expect(r.aliveOk, '对照：已登记的启动期方法在同一个窗口里必须可用').toBe(true)
    expect(r.aliveN).toBeGreaterThan(0)
  } finally {
    await app.close()
    cleanup()
  }
})

test('E8-e `itemPaths` 在真窗口里返回两条绝对路径（P3c 的数据源）', async () => {
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    const r = await win.evaluate(async () => {
      const res = await window.api.invoke('itemPaths', { libId: 'L1', uid: 'a00000000001' })
      return res.ok ? res.data : { err: res.error.code }
    })
    expect(r.err).toBeUndefined()
    expect(r.imagePath).toBe('Z:\\__fake_library__\\VR\\VR-101.jpg')
    expect(r.archivePath).toBe('Z:\\__fake_library__\\VR\\VR-101.rar')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E8-f ⭐ 真实模式（不设 GEMMA_FAKE）**也拒绝**已删除的方法 —— 两种模式下口径一致', async () => {
  // ⚠️ 2026-10-15 · S6：这条原先证「模拟放行 / 真实拒绝」的**模式差异**；
  //   方法删除之后那个差异**不存在了** ⇒ 改成证「两种模式都拒」，并且都拒在**白名单**这一层。
  //   （旧断言在此已无意义：它要求模拟模式放行一个现在不存在的方法。）
  const real = await launchWithLibrary()
  try {
    const win = await firstWindow(real.app)
    const off = await win.evaluate(async () => {
      const res = await window.api.invoke('indexStart', { libId: 'L1' })
      return res.ok ? { ok: true } : { ok: false, code: res.error.code, msg: res.error.userMessage }
    })
    expect(off.ok, '真实模式不许假装成功').toBe(false)
    expect(off.code, '删掉的方法在真实模式下也必须是白名单拒绝（BAD_REQUEST）').toBe('BAD_REQUEST')
    expect(off.msg).toBeTruthy()

    // `itemPaths` 是**只读**方法，两种模式都该可用（它不是模拟专属）。
    // 要证的是"它真的进了 IPC 白名单" —— 判据是**不是 `BAD_REQUEST`**
    // （白名单外会被 zod 先拦成 BAD_REQUEST「请求参数不合法」）。
    // 夹具迷你库没有索引 ⇒ 走到引擎会是 `INDEX_MISSING`，那也是"过了白名单"的证据。
    const ip = await win.evaluate(async () => {
      const res = await window.api.invoke('itemPaths', { libId: 'L1', uid: 'a00000000001' })
      return { ok: res.ok, code: res.ok ? null : res.error.code }
    })
    expect(ip.code, `itemPaths 应已登记进白名单（BAD_REQUEST 就是没登记），实得 ${ip.code}`).not.toBe('BAD_REQUEST')
  } finally {
    await real.app.close()
    real.cleanup()
  }
})

// apps/desktop/e2e/confirm-dialog.spec.mjs —— E7：确认弹窗的 ESC / 焦点 / 取消不执行（T4 验收 #1）
//
// ── 为什么这条以前测不了，现在能测了 ──────────────────────────────────────
//   确认弹窗只在"有检索结果"时出现（结果卡上的「取件」）。而检索需要 ONNX 模型 + 已注册索引，
//   本环境跑不了（`TODO.md` B-3）⇒ 这条 T4 验收一直挂着"只能人工"。
//
//   ⭐ 破局点：**在正确的层打桩 —— 主进程的 IPC handler**（`main/index.mjs:207` 的 `ipcMain.handle(CH_INVOKE)`）。
//   在那里替换 = 只把"需要 300MB 模型的引擎"换成假的；**渲染进程侧全是真的**：
//     真 preload（contextBridge）→ 真 IPC 往返 → 真 adapter 解包 → 真 store → 真 PhotoCard → 真 ConfirmDialog → 真 Radix
//   ⇒ 于是"结果区 UI"这一整块**不再依赖模型**，可以自动化。
//
//   ⚠️ 试过但**不可行**的一条路（记下来省得再试）：替换 `window.api` —— 它是
//      `configurable:false / writable:false / frozen:true`（contextBridge 的安全加固，**是特性不是障碍**）。
//
// ── ⚠️⚠️ 两个**必须**照做的细节（都是本文件第一次跑红踩出来的）────────────────
//
//   ① **桩必须回答"启动期"的方法，不能对未知方法一律回 `{}`。**
//      第一版只懂 `search` / `collect`，其它回 `{ok:true,data:{}}` ⇒ `LibraryGate` 调 `libraryConfig`
//      拿到空 data ⇒ `decideGate()`（`utils/gate.js:26`，判据是 `data.libraries.length > 0`）判成
//      **`wizard`** ⇒ 界面显示**首启向导**、压根没有输入框 ⇒ 全部 6 条卡在 `locator.fill` 超时 30s。
//      **打桩打错形状 = 把被测应用打瘸**，症状还伪装成"选择器不对"。
//
//   ② **必须在装桩之后 `reload()`。**
//      `firstWindow()` 只等 `domcontentloaded`（`helpers/launch.mjs:58`），**React 还没挂载**；
//      于是应用的启动调用（`libraryConfig` / `indexStatus`）会**竞态**地落到桩上。reload 之后
//      应用是**对着桩**完成整个启动流程的 ⇒ 时序确定，不靠运气。
//
// ⚠️ 打桩的**边界**（别把它当成"什么都测了"）：它替换的是**引擎语义**，
//   所以被绕过的包括：zod 参数校验、1 MiB 载荷上限、真实 engine 的错误码。
//   那些由 `apps/desktop/tests/permissions.test.mjs`（13 条）与引擎单测覆盖，不在这里。
import { test, expect } from '@playwright/test'

import { launchWithLibrary } from './helpers/app.mjs'
import { firstWindow } from './helpers/launch.mjs'

/** 一条假的素材结果（字段与 `search/PhotoCard.jsx` 实际读的一致） */
const FAKE_ITEM = {
  libId: 'L1', uid: 'aaa111aaa111', stem: 'VR-101', relPath: 'VR/VR-101.jpg',
  folder: 'VR', score: 0.81, band: 'mid', imagePath: 'X:\\fake\\VR-101.jpg',
  archive: { name: 'VR-101.rar', ext: '.rar', size: 12345678 },
}

/**
 * 桩：把**引擎**换掉（不是把桥换掉）。
 * 必须覆盖启动期方法，否则门禁会把界面判成"没有库"（见文件头 ①）。
 */
async function stubEngine(app) {
  await app.evaluate(({ ipcMain }, item) => {
    const CH = 'engine:invoke'
    const stub = { calls: [] }
    globalThis.__engineStub = stub
    ipcMain.removeHandler(CH)
    ipcMain.handle(CH, async (_event, payload) => {
      const method = payload && payload.method
      const params = payload && payload.params
      stub.calls.push({ method, params })
      const ok = (data) => ({ ok: true, warnings: [], data })

      switch (method) {
        // ── 启动期：这两个决定"显示向导还是应用"
        case 'libraryConfig':
          return ok({ libraries: [{ libId: 'L1', root: 'X:\\fake' }], chosen: 'env', warnings: [], diagnostics: [] })
        case 'indexStatus':
          return ok({ libs: [{ libId: 'L1', root: 'X:\\fake', dim: 768, indexed: 2, encoded: 2, healthy: true }] })

        // ── 被测的两件事
        case 'search':
          return ok({
            tookMs: 12, libsUsed: ['L1'], libsSkipped: [],
            results: [
              item,
              { ...item, uid: 'bbb222bbb222', stem: 'CR-202', relPath: 'CR/CR-202.jpg', folder: 'CR', score: 0.77, archive: null },
            ],
          })
        case 'collect':
          return ok({ succeeded: params.uids, skipped: [], failed: [], targetDir: 'E:\\素材待用' })

        default:
          return ok({})
      }
    })
  }, FAKE_ITEM)
}

const stubCalls = (app) => app.evaluate(() => globalThis.__engineStub.calls)
const callsOf = (calls, method) => calls.filter((c) => c.method === method)

/** 把界面推到"有结果"状态：装桩 → reload（消除竞态）→ 等真界面 → 输入 → 回车 */
async function searchOnce(app, win) {
  await stubEngine(app)
  await win.reload()
  // 等到"真界面"起来（有库 ⇒ 搜索页；Chip 是搜索页独有的）
  await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })

  const input = win.locator('#query')
  await input.fill('吊灯')
  await input.press('Enter')

  await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible({ timeout: 20_000 })
}

const dialog = (win) => win.getByRole('alertdialog')

test('E7-a ⭐ 「取件」先弹确认框：不能点一下就把文件搬走', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)

    await expect(dialog(win)).toHaveCount(0)           // 还没点，不该有弹窗
    await win.getByRole('button', { name: '取件' }).first().click()

    await expect(dialog(win)).toBeVisible()
    await expect(dialog(win)).toContainText('把这套素材取件？')
    await expect(dialog(win)).toContainText('VR-101')   // 文案里带的是**真实那一项**
    await expect(dialog(win).getByRole('button', { name: '取件' })).toBeVisible()
    await expect(dialog(win).getByRole('button', { name: '取消' })).toBeVisible()

    // 关键：弹窗出现**不等于**已执行 —— 此刻一个 collect 都不能发
    expect(callsOf(await stubCalls(app), 'collect'), '弹窗弹出时不该发 collect').toEqual([])
  } finally {
    await app.close()
    cleanup()
  }
})

test('E7-b ⭐ 焦点被**捕获在弹窗内**，且 Tab 不会跑到背后的页面（焦点陷阱）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)
    await win.getByRole('button', { name: '取件' }).first().click()
    await expect(dialog(win)).toBeVisible()

    const focusInDialog = () => win.evaluate(() => {
      const el = document.activeElement
      const dlg = document.querySelector('[role="alertdialog"]')
      return {
        inDialog: !!dlg && !!el && dlg.contains(el),
        text: (el && (el.textContent || '').trim()) || '',
        tag: el ? el.tagName : null,
      }
    })

    // ① 打开后焦点**立刻**落进弹窗（不能留在背景按钮上）
    await expect.poll(async () => (await focusInDialog()).inDialog, { timeout: 5_000 }).toBe(true)
    const first = await focusInDialog()
    console.log('  [E7-b] 打开后焦点落在:', first.tag, JSON.stringify(first.text))

    // ② 连按 Tab 一圈，焦点始终在弹窗内（陷阱生效）
    for (let i = 0; i < 6; i++) {
      await win.keyboard.press('Tab')
      const st = await focusInDialog()
      expect(st.inDialog, `第 ${i + 1} 次 Tab 后焦点跑出弹窗了：${JSON.stringify(st)}`).toBe(true)
    }
    console.log('  [E7-b] 连按 6 次 Tab，焦点始终在弹窗内 ✅')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E7-c ⭐ ESC 关闭弹窗，且**动作未执行**（collect 一个都没发）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)
    await win.getByRole('button', { name: '取件' }).first().click()
    await expect(dialog(win)).toBeVisible()

    await win.keyboard.press('Escape')
    await expect(dialog(win)).toHaveCount(0)                       // ESC 真的关了
    await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible()  // 回到结果页

    expect(callsOf(await stubCalls(app), 'collect'), 'ESC 之后不许有任何 collect').toEqual([])
  } finally {
    await app.close()
    cleanup()
  }
})

test('E7-d ⭐ 点「取消」同样不执行；且焦点**归还**给触发它的那个按钮', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)
    const trigger = win.getByRole('button', { name: '取件' }).first()
    await trigger.click()
    await expect(dialog(win)).toBeVisible()

    await dialog(win).getByRole('button', { name: '取消' }).click()
    await expect(dialog(win)).toHaveCount(0)
    expect(callsOf(await stubCalls(app), 'collect')).toEqual([])

    // 焦点归还（无障碍：关掉弹窗后不该把焦点丢在 document.body 上）
    const restored = await win.evaluate(() => {
      const el = document.activeElement
      return { tag: el ? el.tagName : null, text: (el && (el.textContent || '').trim()) || '' }
    })
    console.log('  [E7-d] 关闭后焦点归还给:', restored.tag, JSON.stringify(restored.text))
    expect(restored.text).toBe('取件')
  } finally {
    await app.close()
    cleanup()
  }
})

test('E7-e ⭐ 确认才执行：collect 恰好一次，且参数是那一项', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)
    await win.getByRole('button', { name: '取件' }).first().click()
    await expect(dialog(win)).toBeVisible()

    await dialog(win).getByRole('button', { name: '取件' }).click()
    await expect(dialog(win)).toHaveCount(0)

    const collects = callsOf(await stubCalls(app), 'collect')
    expect(collects.length, '确认后应当**恰好**发一次 collect').toBe(1)
    expect(collects[0].params).toEqual({ libId: 'L1', uids: ['aaa111aaa111'] })
  } finally {
    await app.close()
    cleanup()
  }
})

test('E7-f 连点两次确认只发一次 collect（先清状态再执行）', async () => {
  const { app, cleanup } = await launchWithLibrary()
  try {
    const win = await firstWindow(app)
    await searchOnce(app, win)
    await win.getByRole('button', { name: '取件' }).first().click()
    await expect(dialog(win)).toBeVisible()

    const confirm = dialog(win).getByRole('button', { name: '取件' })
    // ⚠️ 不要用 `Promise.all([click(), click()])` —— 第一次点击后就地卸载按钮，
    //    Playwright 会卡在对第二个 locator 的稳定性等待上（实测超时 30s）。
    //    改成在**页面内同步连点两次**：这是真正的"连点"，绕开 Playwright 的元素生命周期等待。
    await confirm.evaluate((el) => { el.click(); el.click() })

    await expect(dialog(win)).toHaveCount(0)
    await win.waitForTimeout(500)

    expect(callsOf(await stubCalls(app), 'collect').length, '连点两次只该发一次').toBe(1)
  } finally {
    await app.close()
    cleanup()
  }
})

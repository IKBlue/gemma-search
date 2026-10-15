// apps/desktop/e2e/browse.spec.mjs —— P4-2：F2 浏览页的**真窗口**验收（S8 `items` 已落地）
//
// ── 夹具（2026-10-15 改，Lead 批准）────────────────────────────────────────
//   原先拿 `data/_schema100/lib` 当夹具 —— 那是 **6.3 GB / 205 文件**的地面真相，
//   实测**整目录递归拷贝 = 307,177 ms（5 分 7 秒）**（单个 `CR+VR/` 子目录就 131,583 ms），
//   而这里**每个测试都拷一次**、Playwright 单测时上限 **60s** ⇒ **拷贝没完测试就超时**，
//   `electron.launch` **根本没被执行到**（`_app.log` 无新行、electron 进程 0、只有 Test timeout）。
//   ⇒ 现在用**合成夹具**（`helpers/fixture-lib.mjs`）：~120 条、**169 KB**、建库 **~0.5s**，
//     走**生产建库入口**（`openGsDb` + `importItemsFromJson`），**不依赖** `data/_schema100`。
//   期望值**从同一张计划表推出来**（`synthExpectations()`），不手抄数字。
//
// 覆盖：
//   E14-a 可达 + 骨架（侧栏进得去、工具条在、窗口标题来自 LABELS）
//   E14-d ⭐ 筛选真的生效（分类 / 扩展名 / 有无包，计数与 total 一致）
//   E14-e ⭐ 空态区分（空库 vs 筛没了 —— 两句话不能是同一句）
//   E14-f ⭐ 只渲染视口内的行（虚拟滚动：DOM 里的格子数 << 总数；120 条才不是恒真）
//   E14-g ⭐ facets 是**整库**口径（筛了分类后下拉项仍全在、计数不变）
//   E14-h ⭐ 排序「大小 大→小」：能选、且**无包条目排在末尾**（NULL 位次以后端为准）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { test, expect } from '@playwright/test'

import { launchApp, firstWindow } from './helpers/launch.mjs'
import { buildSynthLibrary } from './helpers/fixture-lib.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** 建一份合成夹具 + 指向它的应用实例（userData 独立，避免单实例锁互相踩） */
async function openOn(lib) {
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_t46ud-'))
  const app = await launchApp({
    env: { GEMMA_CONFIG: '', GEMMA_LIB_ROOT: lib.root, GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '' },
    extraArgs: ['--user-data-dir=' + userData],
  })
  return { app, cleanupUserData: () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* 临时目录 */ } } }
}

/** 等「真界面起来」——失败时把现场打出来（否则只有一个超时，无法定位） */
async function openBrowse(win) {
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  try {
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })
  } catch (err) {
    const diag = {
      url: win.url(),
      title: await win.title().catch(() => '?'),
      body: String(await win.evaluate(() => document.body.innerText).catch(() => '?')).slice(0, 400),
      errors: errors.slice(0, 6),
    }
    console.log('[E14-diag] 界面没起来：' + JSON.stringify(diag))
    throw err
  }
  await win.getByRole('link', { name: '浏览图库' }).click()
  await expect(win.getByRole('heading', { name: '浏览整库' })).toBeVisible({ timeout: 20_000 })
}

test('E14-a ⭐ /browse 真窗口可达：侧栏能点进去，骨架与工具条都在', async () => {
  const lib = buildSynthLibrary()
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    expect(await win.evaluate(() => window.location.hash)).toContain('/browse')
    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('浏览图库')
    await expect(win.getByTestId('browse-toolbar')).toBeVisible()
    await expect(win.getByLabel('排序方式')).toBeVisible()
    await expect(win.getByTestId('browse-folders').getByRole('button', { name: '全部' })).toBeVisible()
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-d ⭐⭐ 筛选真的生效：分类 / 扩展名 / 有无包，且计数与 total 一致', async () => {
  const lib = buildSynthLibrary()
  const exp = lib.expectations
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const count = win.getByTestId('browse-count')
    const grid = win.getByTestId('browse-grid')
    await expect(grid).toHaveAttribute('data-total', String(exp.total), { timeout: 20_000 })
    await expect(count).toContainText(`共 ${exp.total} 条`)

    // 分类：取第一个分类（期望值来自同一张计划表）
    const [firstFolder, firstCount] = Object.entries(exp.folders)[0]
    await win.getByRole('button', { name: new RegExp(`^${firstFolder.replace(/[+]/g, '\\+')}（${firstCount}）$`) }).click()
    await expect(grid).toHaveAttribute('data-total', String(firstCount), { timeout: 20_000 })
    await expect(count).toContainText(`共 ${firstCount} 条`)

    // 扩展名：挑一个在该分类里**没有样本**的 ⇒ 必须是「筛没了」而不是「空库」
    const inFolder = lib.items.filter((it) => it.folder === firstFolder)
    const extInFolder = new Set(inFolder.map((it) => it.imageExt))
    const extOutside = Object.keys(exp.exts).find((x) => !extInFolder.has(x))
    expect(extOutside, '合成夹具必须有一个「该分类里没有」的扩展名，否则这条断言测不出东西').toBeTruthy()
    await win.getByLabel('扩展名').selectOption(extOutside)
    await expect(win.getByTestId('browse-no-match')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-empty')).toHaveCount(0)

    // 重置 → 缺包 / 有包（两个方向都要有样本）
    await win.locator('[data-action="browse-reset"]').click()
    await expect(grid).toHaveAttribute('data-total', String(exp.total), { timeout: 20_000 })
    // ⚠️ 必须限定在工具栏那一组里：卡片上的角标也写着「缺包」/「有包」（实测踩到）
    const archiveGroup = win.getByTestId('browse-archive')
    await archiveGroup.getByRole('button', { name: '缺包' }).click()
    await expect(grid).toHaveAttribute('data-total', String(exp.withoutArchive), { timeout: 20_000 })
    await archiveGroup.getByRole('button', { name: '有包' }).click()
    await expect(grid).toHaveAttribute('data-total', String(exp.withArchive), { timeout: 20_000 })
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-e ⭐⭐ 空态区分：真空库说「还没有素材」，筛没了说「筛选没有匹配」', async () => {
  const lib = buildSynthLibrary()
  // 真空库变体：结构在、表在、**零行**（用生产同一套 sqlite，不手写第二份 DDL）
  const db = new DatabaseSync(path.join(lib.root, '.gs.db'))
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('DELETE FROM asset_file')
    db.exec('DELETE FROM asset')
  } finally { db.close() }
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    await expect(win.getByTestId('browse-empty')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-empty')).toContainText('还没有素材')
    await expect(win.getByTestId('browse-no-match')).toHaveCount(0)
    await expect(win.getByTestId('browse-error')).toHaveCount(0)
    await expect(win.getByTestId('browse-grid')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-f ⭐⭐ 虚拟滚动：DOM 里只挂视口内的那几行（不是 120 个格子）', async () => {
  const lib = buildSynthLibrary()
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const exp = lib.expectations
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', String(exp.total), { timeout: 20_000 })
    const cells = await win.locator('[data-browse-cell]').count()
    console.log('[E14-f] DOM 里的格子数 =', cells, '（总数 ' + exp.total + '）')
    expect(cells, `虚拟化没生效：把 ${exp.total} 格全渲染了`).toBeLessThan(60)
    expect(cells, '一格都没渲染 ⇒ 虚拟化或布局坏了').toBeGreaterThan(0)
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-g ⭐⭐ facets 是**整库**口径：筛了分类之后，下拉项仍然全在、计数不变', async () => {
  const lib = buildSynthLibrary()
  const exp = lib.expectations
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const toolbar = win.getByTestId('browse-toolbar')
    for (const [folder, n] of Object.entries(exp.folders)) {
      await expect(toolbar).toContainText(`${folder}（${n}）`, { timeout: 20_000 })
    }
    // 筛到第一个分类之后：**别的分类仍然在**（facets 全库口径、不带筛选）
    const [firstFolder, firstCount] = Object.entries(exp.folders)[0]
    await win.getByRole('button', { name: new RegExp(`^${firstFolder.replace(/[+]/g, '\\+')}（${firstCount}）$`) }).click()
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', String(firstCount), { timeout: 20_000 })
    for (const [folder, n] of Object.entries(exp.folders)) {
      await expect(toolbar).toContainText(`${folder}（${n}）`)
    }
    // 3 个扩展名 < 200 ⇒ 不该出现「还有 N 个」
    await expect(win.getByTestId('facet-exts-hidden')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-h ⭐⭐ 排序「大小 大→小」：能选、且**无包条目排在末尾**（NULL 位次以后端为准）', async () => {
  const lib = buildSynthLibrary()
  const exp = lib.expectations
  // 合成夹具里**本来就有缺包条目**（期望值给得出条数）⇒ 不需要再造
  expect(exp.withoutArchive, '合成夹具必须有缺包条目，否则这条断言测不出 NULL 位次').toBeGreaterThan(0)
  const { app, cleanupUserData } = await openOn(lib)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const grid = win.getByTestId('browse-grid')
    await expect(grid).toHaveAttribute('data-total', String(exp.total), { timeout: 20_000 })

    // 选「大小 大→小」（wire = -archiveSize，后端按 SQLite 默认语义：倒序 NULL 最后）
    await win.getByLabel('排序方式').selectOption('size')
    await expect(win.getByTestId('browse-count')).toContainText('大→小', { timeout: 20_000 })

    // 滚到底再读最后一个格子：它必须是**缺包**的（无包条目排在末尾）
    const scroller = win.getByTestId('browse-grid').locator('div.overflow-auto')
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect(win.locator('[data-browse-cell]').last()).toHaveAttribute('data-hasarchive', 'no', { timeout: 20_000 })

    // 顺带钉住「缺包」是按库口径真算出来的（同样要限定到工具栏那一组）
    await win.getByTestId('browse-archive').getByRole('button', { name: '缺包' }).click()
    await expect(grid).toHaveAttribute('data-total', String(exp.withoutArchive), { timeout: 20_000 })
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

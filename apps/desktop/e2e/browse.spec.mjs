// apps/desktop/e2e/browse.spec.mjs —— P4-2：F2 浏览页的**真窗口**验收（S8 `items` 已落地）
//
// 真数据从哪来：`data/_schema100/lib`（S2 的 100 条自洽库：asset 100 · asset_file 200 = preview 100 + archive 100）。
//   ⚠️ 它是**本机夹具**（gitignored）⇒ 不存在就 `test.skip` 并写明原因，不假装跑过。
//   为什么用副本：库里要写 `.gs-*`、测试还要制造「空库」变体 ⇒ **绝不改夹具原件**。
//
// 覆盖（任务书第 2 段）：
//   E14-a 可达 + 骨架（侧栏进得去、工具条在、窗口标题来自 LABELS）
//   E14-d ⭐ 筛选真的生效（分类/扩展名/有无包，计数与 total 一致）
//   E14-e ⭐ 空态区分（空库 vs 筛没了 —— 两句话不能是同一句）
//   E14-f ⭐ 只渲染视口内的行（虚拟滚动：DOM 里的格子数 << 总数）
//   E14-g ⭐ facets 是**整库**口径（筛了分类之后下拉项仍然全在、计数不变）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { test, expect } from '@playwright/test'

import { launchApp, firstWindow } from './helpers/launch.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SRC_LIB = path.join(ROOT, 'data', '_schema100', 'lib')
const PREREQ = ['.gs.db', 'items.json']

function missingPrereq() {
  return PREREQ.filter((f) => !fs.existsSync(path.join(SRC_LIB, f)))
}

/** 夹具副本（可选：清空 asset/asset_file ⇒ 制造「空库」变体）。返回 { dir, cleanup } */
function makeLib({ empty = false } = {}) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'data', '_t46-'))
  fs.cpSync(SRC_LIB, dir, { recursive: true })
  // 边车文件（-shm/-wal）是上一个进程留下的，拷过去只会让 SQLite 犹豫 ⇒ 删掉
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.gs.db-shm') || f.endsWith('.gs.db-wal')) fs.rmSync(path.join(dir, f), { force: true })
  }
  if (empty) {
    // ⚠️ 只清**数据**、不动结构：用生产同一套 sqlite（不手写第二份 DDL），
    //    这样「空库」= `.gs.db` 在、表在、零行 —— 正是 items 会如实回 total=0 的那种处境。
    const db = new DatabaseSync(path.join(dir, '.gs.db'))
    try {
      db.exec('PRAGMA foreign_keys = ON')
      db.exec('DELETE FROM asset_file')
      db.exec('DELETE FROM asset')
    } finally { db.close() }
  }
  return { dir, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录 */ } } }
}

async function openBrowse(win) {
  await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })
  await win.getByRole('link', { name: '浏览图库' }).click()
  await expect(win.getByRole('heading', { name: '浏览整库' })).toBeVisible({ timeout: 20_000 })
}

async function launchOnLib(libDir) {
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_t46-userdata-'))
  const app = await launchApp({
    env: { GEMMA_CONFIG: '', GEMMA_LIB_ROOT: libDir, GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '' },
    extraArgs: ['--user-data-dir=' + userData],
  })
  return { app, cleanupUserData: () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* 临时目录 */ } } }
}

test('E14-a ⭐ /browse 真窗口可达：侧栏能点进去，骨架与工具条都在', async () => {
  test.skip(missingPrereq().length > 0, '缺 S2 夹具：' + missingPrereq().join('/') + '（data/_schema100/lib）')
  const lib = makeLib()
  const { app, cleanupUserData } = await launchOnLib(lib.dir)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    expect(await win.evaluate(() => window.location.hash)).toContain('/browse')
    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('浏览图库')
    await expect(win.getByTestId('browse-toolbar')).toBeVisible()
    await expect(win.getByLabel('排序方式')).toBeVisible()
    await expect(win.getByRole('button', { name: '全部' }).first()).toBeVisible()
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-d ⭐⭐ 筛选真的生效：分类 / 扩展名 / 有无包，且计数与 total 一致', async () => {
  test.skip(missingPrereq().length > 0, '缺 S2 夹具：' + missingPrereq().join('/'))
  const lib = makeLib()
  const { app, cleanupUserData } = await launchOnLib(lib.dir)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const count = win.getByTestId('browse-count')
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '100', { timeout: 20_000 })
    await expect(count).toContainText('共 100 条')

    // 分类筛选：CR = 22 条（夹具实测分布：CR 22 / CR+VR 78）
    await win.getByRole('button', { name: /^CR（22）$/ }).click()
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '22', { timeout: 20_000 })
    await expect(count).toContainText('共 22 条')

    // 扩展名：CR 里没有 .png ⇒ 「筛选没有匹配」（不是「空库」）
    await win.getByLabel('扩展名').selectOption('.png')
    await expect(win.getByTestId('browse-no-match')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('browse-empty')).toHaveCount(0)

    // 重置 → 缺包 = 0 条（夹具 100 条全有包）→ 有包 = 100 条
    await win.locator('[data-action="browse-reset"]').click()
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '100', { timeout: 20_000 })
    await win.getByRole('button', { name: '缺包' }).click()
    await expect(win.getByTestId('browse-no-match')).toBeVisible({ timeout: 20_000 })
    await win.getByRole('button', { name: '有包' }).click()
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '100', { timeout: 20_000 })
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-e ⭐⭐ 空态区分：真空库说「还没有素材」，筛没了说「筛选没有匹配」', async () => {
  test.skip(missingPrereq().length > 0, '缺 S2 夹具：' + missingPrereq().join('/'))
  const lib = makeLib({ empty: true })
  const { app, cleanupUserData } = await launchOnLib(lib.dir)
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

test('E14-f ⭐⭐ 虚拟滚动：DOM 里只挂视口内的那几行（不是 100 个格子）', async () => {
  test.skip(missingPrereq().length > 0, '缺 S2 夹具：' + missingPrereq().join('/'))
  const lib = makeLib()
  const { app, cleanupUserData } = await launchOnLib(lib.dir)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '100', { timeout: 20_000 })
    const cells = await win.locator('[data-browse-cell]').count()
    console.log('[E14-f] DOM 里的格子数 =', cells, '（总数 100）')
    expect(cells, '虚拟化没生效：把 100 格全渲染了').toBeLessThan(60)
    expect(cells, '一格都没渲染 ⇒ 虚拟化或布局坏了').toBeGreaterThan(0)
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

test('E14-g ⭐⭐ facets 是**整库**口径：筛了分类之后，下拉项仍然全在、计数不变', async () => {
  test.skip(missingPrereq().length > 0, '缺 S2 夹具：' + missingPrereq().join('/'))
  const lib = makeLib()
  const { app, cleanupUserData } = await launchOnLib(lib.dir)
  try {
    const win = await firstWindow(app)
    await openBrowse(win)
    const toolbar = win.getByTestId('browse-toolbar')
    await expect(toolbar).toContainText('CR（22）', { timeout: 20_000 })
    await expect(toolbar).toContainText('CR+VR（78）')

    // 筛到 CR 之后：CR+VR 的项**仍然在**（facets 是全库口径、不带筛选）
    await win.getByRole('button', { name: /^CR（22）$/ }).click()
    await expect(win.getByTestId('browse-grid')).toHaveAttribute('data-total', '22', { timeout: 20_000 })
    await expect(toolbar).toContainText('CR+VR（78）')
    await expect(toolbar).toContainText('CR（22）')
    // 3 个扩展名 < 200 ⇒ 不该出现「还有 N 个」
    await expect(win.getByTestId('facet-exts-hidden')).toHaveCount(0)
  } finally {
    await app.close()
    cleanupUserData()
    lib.cleanup()
  }
})

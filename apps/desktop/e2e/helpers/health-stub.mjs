// apps/desktop/e2e/helpers/health-stub.mjs —— 体检 / 重建 的真窗口桩（T-15b）
//
// 与 engine-stub.mjs 同一套路（把 engine:invoke 换成内存实现 + 记录调用），但这里多两件事：
//   ① **可编程的重建延迟**：libraryRebuild 挂 delayMs，让「正在重建元数据」这个忙碌态
//      在真窗口里**可被断言**（没有延迟就秒回，忙碌态一闪而过 —— 那是测不到的）。
//   ② **重建后复检会变好**：libraryHealth 的第二次回答是健康报告 —— 否则「完成后自动复检」
//      这条行为在界面上看不出来。
//
// ⚠️ 桩的边界（别把它当成端到端都测了）：它替换的是**主进程那两条方法的实现**，
//    被绕过的包括：zod 校验、库根解析（T-04）、真正的删库/导入/复检。
//    那些由 apps/desktop/tests/library-methods.test.mjs（L1–L7）与 health-rebuild.test.mjs 覆盖，
//    **不在这里**。真正过 IPC 的那一遍在 health.spec.mjs 的 E13-d（真库、真实现）。
//
// ⚠️ 桩**必须覆盖启动期方法**（libraryList / indexStatus）：漏了或形状错了，
//    门禁会把界面判成「没有库」⇒ 显示首启向导、压根没有诊断页（同 engine-stub 的坑①）。
import { expect } from '@playwright/test'

/** 一条**坏**的体检结论（形状与主进程 LibraryHealthReport 一致；文案抄主进程的 reason） */
function badReport() {
  return {
    libId: 'L1',
    root: 'X:\\fake',
    dbPath: 'X:\\fake\\.gs.db',
    indexPath: 'X:\\fake\\.gs-index.bin',
    checks: [
      { id: 'library-root', ok: true, code: '', reason: '库根是目录：X:\\fake', rebuildable: false },
      { id: 'items-file', ok: true, code: '', reason: '条目表存在：X:\\fake\\items.json（1234 字节）', rebuildable: false },
      { id: 'index', ok: true, code: '', reason: '索引通过引擎五道校验：count=2 · dim=768', rebuildable: false },
      {
        id: 'db-file', ok: false, code: 'DB_MISSING',
        reason: '.gs.db 不存在：X:\\fake\\.gs.db —— 删库重建会把它建出来（后面的 db 检查跳过，不假装通过）',
        rebuildable: true,
      },
    ],
    ok: false,
    needsDbRebuild: true,
    needsIndexRebuild: false,
    reason: '自检发现 1 项问题：db-file(DB_MISSING) ⇒ 可以删库重建',
  }
}

/** 重建后的**健康**结论（复检用） */
function okReport() {
  return {
    libId: 'L1', root: 'X:\\fake', dbPath: 'X:\\fake\\.gs.db', indexPath: 'X:\\fake\\.gs-index.bin',
    checks: [
      { id: 'library-root', ok: true, code: '', reason: '库根是目录：X:\\fake', rebuildable: false },
      { id: 'items-file', ok: true, code: '', reason: '条目表存在', rebuildable: false },
      { id: 'index', ok: true, code: '', reason: '索引通过引擎五道校验：count=2 · dim=768', rebuildable: false },
      { id: 'db-file', ok: true, code: '', reason: '.gs.db 存在：X:\\fake\\.gs.db（4096 字节）', rebuildable: false },
      { id: 'db-open', ok: true, code: '', reason: '只读打开成功（journal_mode=wal）', rebuildable: false },
      { id: 'db-read', ok: true, code: '', reason: '可读：items=2 行 · library=1 行', rebuildable: false },
    ],
    ok: true, needsDbRebuild: false, needsIndexRebuild: false, reason: '自检通过（6 项）',
  }
}

/** 重建报告（形状与主进程 RebuildLibraryReport 一致） */
function rebuildReport() {
  return {
    libId: 'L1', root: 'X:\\fake', dbPath: 'X:\\fake\\.gs.db', indexPath: 'X:\\fake\\.gs-index.bin',
    before: badReport(),
    removedDbFiles: ['X:\\fake\\.gs.db-wal'],
    created: true,
    schema: { fromVersion: 0, toVersion: 2, applied: [1, 2] },
    import: { dbCount: 2, inserted: 2, updated: 0, deleted: 0 },
    index: { action: 'kept', detail: '索引未改动（本次没有给新索引字节）：count=2 · dim=768', count: 2, dim: 768 },
    after: okReport(),
    dbOk: true, indexOk: true, ok: true,
    reason: '重建完成：删除 1 个 .gs.db 文件 → schema v0→v2 → 导入 2 条（新增 2 / 更新 0 / 删除幽灵行 0）→ 索引 kept；复检 通过（6 项）',
  }
}

/**
 * 装桩。delayMs 是 libraryRebuild 的应答延迟（用来断言忙碌态）。
 * 用 stubCalls(app) / callsOf(calls, 'libraryRebuild') 取调用记录。
 */
export async function stubHealthEngine(app, opts = {}) {
  const delayMs = opts.delayMs ?? 1200
  await app.evaluate(({ ipcMain }, cfg) => {
    const CH = 'engine:invoke'
    const stub = { calls: [], rebuilt: false }
    globalThis.__healthStub = stub
    ipcMain.removeHandler(CH)
    ipcMain.handle(CH, async (_event, payload) => {
      const method = payload && payload.method
      const params = payload && payload.params
      stub.calls.push({ method, params })
      const ok = (data) => ({ ok: true, warnings: [], data })
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

      switch (method) {
        // ⚠️ S6（2026-10-15）：libraryConfig → **libraryList**（基线 §2.2）；libraryHealth/Rebuild 保留
        case 'libraryList':
          return ok({ libraries: [{ libId: 'L1', root: cfg.root }], chosen: 'L1', warnings: [], diagnostics: [] })
        case 'indexStatus':
          return ok({ libs: [{ libId: 'L1', root: cfg.root, dim: 768, indexed: 2, encoded: 2, healthy: !stub.rebuilt }] })
        case 'libraryHealth':
          return ok(stub.rebuilt ? cfg.okReport : cfg.badReport)
        case 'libraryRebuild':
          await sleep(cfg.delayMs)
          stub.rebuilt = true
          return ok(cfg.rebuildReport)
        default:
          return ok({})
      }
    })
  }, { delayMs, root: 'X:\\fake', badReport: badReport(), okReport: okReport(), rebuildReport: rebuildReport() })
}

export const stubCalls = (app) => app.evaluate(() => globalThis.__healthStub.calls)
export const callsOf = (calls, method) => calls.filter((c) => c.method === method)

/** 装桩 → reload（消除启动竞态）→ 等真界面 → 进诊断页 */
export async function openDiagnostics(app, win) {
  await stubHealthEngine(app)
  await win.reload()
  // 真界面起来的标志：搜索页的 Chip（有库才渲染它）
  await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({ timeout: 20_000 })
  await win.getByRole('link', { name: '诊断与重建' }).click()
  await expect(win.getByRole('heading', { name: '诊断与重建' })).toBeVisible({ timeout: 20_000 })
}

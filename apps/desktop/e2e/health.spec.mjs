// apps/desktop/e2e/health.spec.mjs —— T-15b：体检结论 / 一键重建元数据的**真窗口**验收
//
// 四条覆盖（对应任务书 §4 的 e2e 要求）：
//   E13-a 体检的**坏项**在真窗口里显示出来（含错误码与主进程给的人话理由）
//   E13-b **取消 ⇒ 零 IPC**（破坏性操作两段式的第二段没点，就等于没发生）
//   E13-c 重建期间**有忙碌指示**（SPEC §2.3「不许装作没事」）+ 完成后报告 + 自动复检
//   E13-d **真库 · 真实现**（不经桩）：过真 IPC 调 libraryHealth；需要时真重建一次
//
// ⚠️ E13-a/b/c 用的是**主进程方法的桩**（helpers/health-stub.mjs）—— 它能精确控制「重建要花多久」
//    与「复检会不会变好」，那是断言忙碌态的唯一办法（真实现 700ms 就回来了，忙碌态一闪而过）。
//    但桩绕过 zod / 库根解析 / 真删库导入 ⇒ 所以另有一条 E13-d 走真实现。
// 环境限制：E13-d 需要本机有真实库 data/libraries/L1（本机存在）；没有就 skip 并**写明**，
//    不允许把「有真库」当成通用前提（AGENTS §4 证据协议第 4 条）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow, collectConsoleErrors } from './helpers/launch.mjs';
import { stubCalls, callsOf, openDiagnostics } from './helpers/health-stub.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');

/** 库根摘要：路径|size|mtime（只比前后，不实现第二份 materialDigest；.gs-* 一律跳过） */
function digest(root) {
  const rows = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (String(ent.name).startsWith('.gs-')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      const st = fs.statSync(p);
      rows.push(
        path.relative(root, p).split(path.sep).join('/') +
          '|' +
          String(st.size) +
          '|' +
          String(st.mtimeMs),
      );
    }
  };
  walk(root);
  return rows.sort().join('\n');
}

test('E13-a ⭐ 体检的坏项在真窗口里显示：错误码 + 主进程给的人话理由', async () => {
  const { app, cleanup } = await launchWithStub();
  try {
    const win = await firstWindow(app);
    await openDiagnostics(app, win);

    await win.locator('[data-action="health"]').click();
    const report = win.getByTestId('health-report');
    await expect(report).toBeVisible({ timeout: 20_000 });
    await expect(report).toHaveAttribute('data-health-ok', 'no');

    // 坏项：id / code / 人话理由 三样都要在（**理由来自主进程**，界面不摘要不改写）
    const bad = win.locator('[data-check="db-file"]');
    await expect(bad).toHaveAttribute('data-ok', 'no');
    await expect(bad).toHaveAttribute('data-code', 'DB_MISSING');
    await expect(bad).toContainText('DB_MISSING');
    await expect(bad).toContainText('.gs.db 不存在');
    // 好项也在（体检是逐项结论，不是一句总结）
    await expect(win.locator('[data-check="index"]')).toHaveAttribute('data-ok', 'yes');
    await expect(win.getByTestId('health-reason')).toContainText('可以删库重建');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E13-b ⭐⭐ 取消重建 ⇒ **零 IPC**（一个 libraryRebuild 都不许发）', async () => {
  const { app, cleanup } = await launchWithStub();
  try {
    const win = await firstWindow(app);
    await openDiagnostics(app, win);
    await win.locator('[data-action="health"]').click();
    await expect(win.getByTestId('health-report')).toBeVisible({ timeout: 20_000 });

    // 请求阶段：只弹确认框，**不发明细**
    await expect(win.locator('[data-action="rebuild"]')).toBeEnabled();
    await win.locator('[data-action="rebuild"]').click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('重建这个库的元数据？');
    expect(
      callsOf(await stubCalls(app), 'libraryRebuild').length,
      '请求阶段不该发 libraryRebuild',
    ).toBe(0);

    // 取消 ⇒ 弹窗消失、忙碌态不该出现、**仍然零 IPC**
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(win.getByTestId('rebuild-busy')).toHaveCount(0);
    await expect(win.getByTestId('rebuild-report')).toHaveCount(0);
    expect(
      callsOf(await stubCalls(app), 'libraryRebuild').length,
      '取消后仍然一个 libraryRebuild 都没有',
    ).toBe(0);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E13-c ⭐⭐ 确认后：忙碌指示「正在重建元数据」→ 重建报告 → 自动复检', async () => {
  const { app, cleanup } = await launchWithStub();
  try {
    const win = await firstWindow(app);
    await openDiagnostics(app, win);
    await win.locator('[data-action="health"]').click();
    await expect(win.getByTestId('health-report')).toHaveAttribute('data-health-ok', 'no', {
      timeout: 20_000,
    });

    await win.locator('[data-action="rebuild"]').click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重建元数据' }).click();

    // ⭐ 忙碌态（桩的 libraryRebuild 有 1200ms 延迟，所以这一瞬间必定看得到）
    await expect(win.getByTestId('rebuild-busy')).toBeVisible({ timeout: 5_000 });
    await expect(win.getByTestId('rebuild-busy')).toContainText('正在重建元数据');

    // 报告：删了什么 / 导入多少条 / 索引保留还是重写
    const report = win.getByTestId('rebuild-report');
    await expect(report).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('rebuild-ok')).toContainText('复检通过');
    await expect(win.getByTestId('rebuild-summary')).toContainText('删除 1 个 .gs.db 文件');
    await expect(win.getByTestId('rebuild-summary')).toContainText('导入 2 条');
    await expect(win.getByTestId('rebuild-summary')).toContainText('索引 kept');
    await expect(report).toContainText('schema：v0 → v2');

    // 自动复检：体检结论变成通过（第二次 libraryHealth 返回健康报告）
    await expect(win.getByTestId('health-report')).toHaveAttribute('data-health-ok', 'yes', {
      timeout: 20_000,
    });
    await expect(win.getByTestId('rebuild-busy')).toHaveCount(0);

    const calls = await stubCalls(app);
    expect(callsOf(calls, 'libraryRebuild').length, '确认后恰好发一次 libraryRebuild').toBe(1);
    expect(callsOf(calls, 'libraryHealth').length, '体检 + 重建后自动复检 = 2 次').toBe(2);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E13-d ⭐⭐ 真库 · 真实现（不经桩）：过真 IPC 体检，坏项如实显示（含主进程的 reason）', async () => {
  test.setTimeout(120_000);
  const missing = ['items.json', 'meta.json'].filter((f) => !fs.existsSync(path.join(REAL_LIB, f)));
  test.skip(
    missing.length > 0,
    '本机没有真实库 data/libraries/L1（缺 ' + missing.join('/') + '）—— 真实现那条无法执行',
  );

  // 夹具：库根的**临时副本**（绝不改真库）
  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_t15b-'));
  const libDir = path.join(work, 'lib');
  fs.cpSync(REAL_LIB, libDir, { recursive: true });
  const userData = path.join(work, 'userdata');
  fs.mkdirSync(userData, { recursive: true });

  // ⚠️ 本机真实库是**旧布局**：根下是 index.bin，而体检读的是库根里的 .gs-index.bin。
  //    补成 .gs-index.bin 之后，「索引好、元数据缺」这件事才是确定的（否则测的是另一种处境）。
  const legacyIndex = path.join(libDir, 'index.bin');
  const gsIndex = path.join(libDir, '.gs-index.bin');
  if (fs.existsSync(legacyIndex) && !fs.existsSync(gsIndex)) fs.copyFileSync(legacyIndex, gsIndex);

  // 制造一个**真实用户会遇到**的坏项：元数据 .gs.db 丢了
  for (const f of fs.readdirSync(libDir)) {
    if (f === '.gs.db' || f.startsWith('.gs.db-')) fs.rmSync(path.join(libDir, f), { force: true });
  }

  const app = await launchApp({
    env: { GEMMA_CONFIG: '', GEMMA_LIB_ROOT: libDir, GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '' },
    extraArgs: ['--user-data-dir=' + userData],
  });
  try {
    const win = await firstWindow(app, 60_000);
    const consoleErrors = collectConsoleErrors(win);

    // 真界面 → 诊断页（走侧栏链接：这就是用户能点到的入口）
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await win.getByRole('link', { name: '诊断与重建' }).click();
    await expect(win.getByRole('heading', { name: '诊断与重建' })).toBeVisible({ timeout: 20_000 });
    await win.locator('[data-action="health"]').click();

    const report = win.getByTestId('health-report');
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toHaveAttribute('data-health-ok', 'no');
    // 坏项：真实现给的 code 与 reason（**不是桩的字符串**）
    const dbFile = win.locator('[data-check="db-file"]');
    await expect(dbFile).toHaveAttribute('data-ok', 'no');
    await expect(dbFile).toHaveAttribute('data-code', 'DB_MISSING');
    await expect(dbFile).toContainText(libDir);
    // 索引这一项在真实现里是好的 ⇒ 证明体检真的逐项在查，不是整体一句话
    await expect(win.locator('[data-check="index"]')).toHaveAttribute('data-ok', 'yes');
    // 元数据可重建 ⇒ 按钮可点（门只挡「没体检」与「正在跑」）
    await expect(win.locator('[data-action="rebuild"]')).toBeEnabled();

    console.log('[E13-d] 真实现体检理由 =', await win.getByTestId('health-reason').innerText());
    expect(
      consoleErrors.filter((e) => e.startsWith('pageerror')),
      '不许有真的 JS 异常',
    ).toEqual([]);
  } finally {
    await app.close();
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

/** 装桩场景的通用启动（launchWithLibrary + 隔离 userData） */
async function launchWithStub() {
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_t15b-stub-userdata-'));
  const app = await launchApp({
    env: { GEMMA_CONFIG: '', GEMMA_LIB_ROOT: 'X:\\fake', GEMMA_FAKE: '' },
    extraArgs: ['--user-data-dir=' + userData],
  });
  return {
    app,
    cleanup: () => {
      try {
        fs.rmSync(userData, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    },
  };
}

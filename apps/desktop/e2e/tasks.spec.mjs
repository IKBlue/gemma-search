// apps/desktop/e2e/tasks.spec.mjs —— E10：索引任务页（IDX-3 **翻转** + 全流程）
//
// ⚠️ 2026-10-17 · IDX-3：本文件原先断言「诚实态」—— 因为 S6（2026-10-15）把
//   indexStart / indexCancel / indexResume 从契约删了。**U35 已恢复登记**、IDX-2a/2b 接了真实实现
//   ⇒ 那段文案与断言**同时过期**。翻转对照见 reports/2026-10-15-wave3/idx3.txt 的「文案翻转表」。
//
// E10-b 是**全流程**：与 IDX-2b2 的 index-task.spec.mjs **同一条注入路径**（GEMMA_FAKE_INDEX=1），
//   区别只有一处 —— **点界面按钮**、**读界面上的数**，而不是直接 invoke。
//   ⇒ 证明的是「用户真能点、真能看见」，不是"后端能跑"（后者已由 IDX-2b2 证过）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { launchApp, firstWindow } from './helpers/launch.mjs';
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');

/** 从界面上读「已处理 N」里的 N（读界面，不读事件 —— 这才是本用例要证的） */
async function doneFromUi(win) {
  const text = await win.locator('[data-testid="tasks-count"]').innerText();
  const m = /\d+/.exec(text);
  return m ? Number(m[0]) : 0;
}

test('E10-a ⭐ 索引任务页 = 真界面：开始/取消/续跑三个按钮 + 进度区，不再是"等表上线"', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await win.evaluate(() => {
      window.location.hash = '#/tasks';
    });
    await expect
      .poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toBe('#/tasks');

    await expect(win.getByTestId('tasks-panel')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('tasks-progress')).toBeVisible();
    await expect(win.locator('[data-action="index-start"]')).toHaveCount(1);
    await expect(win.locator('[data-action="index-cancel"]')).toHaveCount(1);
    await expect(win.locator('[data-action="index-resume"]')).toHaveCount(1);
    await expect(win.locator('[data-action="index-cancel"]')).toBeDisabled();
    await expect(win.getByText('该功能等对应的数据表上线')).toHaveCount(0);
    await expect(win.getByTestId('tasks-unavailable')).toHaveCount(0);
    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('索引任务');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E10-b ⭐⭐ 真窗口全流程（点界面）：开始 → 进度真的动 → 取消 → 已取消 → 续跑 → 复用 > 0', async () => {
  test.setTimeout(240_000);
  const missing = [path.join(REAL_LIB, 'items.json'), path.join(REAL_LIB, 'meta.json')].filter(
    (p) => !fs.existsSync(p),
  );
  test.skip(missing.length > 0, '缺真实库夹具：' + missing.join(' / '));

  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_idx3-'));
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_idx3-userdata-'));
  const libDir = path.join(work, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'meta.json'), 'utf8'));
  const itemsJsonPath = path.join(libDir, 'items.json');
  fs.copyFileSync(path.join(REAL_LIB, 'items.json'), itemsJsonPath);
  fs.copyFileSync(path.join(REAL_LIB, 'meta.json'), path.join(libDir, 'meta.json'));
  {
    const opened = openGsDb({ dbPath: path.join(libDir, '.gs.db') });
    try {
      importItemsFromJson({
        db: opened.db,
        library: { libId: meta.lib_id, root: libDir },
        itemsJsonPath,
        expectedCount: meta.count,
      });
    } finally {
      opened.db.close();
    }
  }
  const indexPath = path.join(libDir, '.gs-index.bin');
  expect(fs.existsSync(indexPath), '夹具里不该有索引（这样"取消零写"才可观测）').toBe(false);

  const cfgPath = path.join(work, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ data_dir: path.join(work, 'data'), device: 'cpu' }),
    'utf8',
  );

  const app = await launchApp({
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: libDir,
      GEMMA_FAKE: '',
      GEMMA_FAKE_INDEX: '1',
    },
    extraArgs: ['--user-data-dir=' + userData],
  });

  try {
    const win = await firstWindow(app, 60_000);
    await expect(win.locator('#query')).toBeVisible({ timeout: 30_000 });
    await win.evaluate(() => {
      window.location.hash = '#/tasks';
    });
    await expect(win.getByTestId('tasks-panel')).toBeVisible({ timeout: 20_000 });

    // ⚠️ 事件收集**必须在点开始之前**装好（preload 的 onEvent 是唯一通道）
    await win.evaluate(() => {
      window.__idxEvents = [];
      window.api.onEvent((e) => window.__idxEvents.push(e));
    });

    await expect(win.locator('[data-action="index-start"]')).toBeEnabled({ timeout: 20_000 });
    await win.locator('[data-action="index-start"]').click();

    // ⚠️ **每次轮询都记一个样本**（在 poll 回调里采集），采样完**立刻**点取消：
    //    假构建器跑得快，若先额外采样 1.5s，任务可能已经完成 ⇒ 取消按钮变禁用 ⇒ 点不动（第一版就栽在这）。
    const samples = [];
    await expect
      .poll(
        async () => {
          const d = await doneFromUi(win);
          samples.push(d);
          return d;
        },
        { timeout: 30_000, message: '界面上没看到进度前进' },
      )
      .toBeGreaterThan(0);

    // ⭐⭐ 单调性**以事件流为准**（样本密、来源真实）：
    //    界面只采到 1~2 个样本时，"界面单调"是验不出回退的（PERF 那次已经栽过一次）⇒
    //    真正的判据是引擎推来的 index.progress.done 序列单调不减。
    const eventDones = (
      await win.evaluate(() =>
        (window.__idxEvents || [])
          .filter((e) => e.type === 'index.progress')
          .map((e) => Number(e.done) || 0),
      )
    ).filter((n) => Number.isFinite(n));
    expect(eventDones.length, '至少要收到一条 index.progress 事件').toBeGreaterThan(0);
    for (let i = 1; i < eventDones.length; i++) {
      expect(
        eventDones[i],
        '事件流进度不许回退：' + JSON.stringify(eventDones),
      ).toBeGreaterThanOrEqual(eventDones[i - 1]);
    }

    // ⭐ 另一个出口：**界面显示的数**必须与事件一致 —— 每个界面样本都得是事件里真实出现过的 done 值
    for (const ui of samples) {
      expect(eventDones, '界面显示的已处理数必须是事件里出现过的：ui=' + ui).toContain(ui);
    }

    await win.locator('[data-action="index-cancel"]').click();
    await expect(win.getByTestId('tasks-outcome')).toContainText('已取消', { timeout: 30_000 });
    await expect(win.locator('[data-action="index-cancel"]')).toBeDisabled({ timeout: 20_000 });
    await expect(win.getByTestId('tasks-progress')).not.toContainText('进行中');
    expect(fs.existsSync(indexPath), '取消时不许写索引（停在边界）').toBe(false);

    await win.locator('[data-action="index-resume"]').click();
    await expect(win.getByTestId('tasks-outcome')).toContainText('复用', { timeout: 60_000 });
    const summaryText = await win.getByTestId('tasks-outcome').innerText();
    const reusedMatch = /复用\s*(\d+)/.exec(summaryText);
    expect(reusedMatch, '完成摘要里必须有复用条数；实际 = ' + summaryText).not.toBeNull();
    expect(Number(reusedMatch[1]), '复用的条数必须 > 0；实际 = ' + summaryText).toBeGreaterThan(0);
    await expect
      .poll(() => fs.existsSync(indexPath), {
        timeout: 30_000,
        message: '续跑完成后应有 .gs-index.bin',
      })
      .toBe(true);
  } finally {
    await app.close();
    try {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

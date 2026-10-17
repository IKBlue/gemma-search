// apps/desktop/e2e/index-task.spec.mjs —— IDX-2b2 真窗口 e2e：**索引任务的整条链路**
//
// 为什么用**假构建器**（`GEMMA_FAKE_INDEX=1`）：真构建器要加载 ONNX 模型、跑 3594 条编码（分钟级），
//   e2e 要证的是**接线**（注入端口 → 进度事件 → job 行 → 取消停在边界 → 续跑复用），不是编码质量。
//   假构建器走**同一条注入接口**（onProgress / signal / writeIndex）⇒ 被证的链路一点没少。
//
// 要证的（卡面原话）：开始 ⇒ 进度可见 ⇒ 取消 ⇒ 停在边界 ⇒ 续跑 ⇒ **复用计数 > 0**。
//   · 「进度可见」 = 渲染层真的收到 `index.progress`（通过 preload 的 onEvent）；
//   · 「停在边界」 = 取消时 **零写**：`.gs-index.bin` 根本不存在（原子写：旧索引完好）；
//   · 「复用」 = 续跑后有 `index.done.reused > 0`；
//   · 另外从 `.gs.db` 的 `job` 表读回：一个 cancelled 行 + 一个 done 行（job 生命周期真的落了库）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow } from './helpers/launch.mjs';
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');

const events = (win) =>
  win.evaluate(() => (Array.isArray(window.__idxEvents) ? window.__idxEvents : []));
const eventsOf = async (win, type) => (await events(win)).filter((e) => e.type === type);

test('IDX-2b2 ⭐⭐ 真窗口：开始 → 进度可见 → 取消（停在边界）→ 续跑 → 复用计数 > 0', async () => {
  test.setTimeout(180_000);
  const missing = [path.join(REAL_LIB, 'items.json'), path.join(REAL_LIB, 'meta.json')].filter(
    (p) => !fs.existsSync(p),
  );
  test.skip(missing.length > 0, '缺真实库夹具：' + missing.join(' / '));

  // ── 夹具：仓库内的库根副本（.gs.db 走生产导入路径）
  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_idx-'));
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_idx-userdata-'));
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
  // ⚠️ **刻意不复制 `.gs-index.bin`**：这样"取消时零写"才是可观测的（文件不存在），
  //    续跑完成后它才出现 ⇒ 「停在边界」与「真的写了」两件事都能断言。
  const indexPath = path.join(libDir, '.gs-index.bin');
  expect(fs.existsSync(indexPath), '夹具里不该有索引（见上）').toBe(false);

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
      GEMMA_FAKE: '', // 显式置空：父进程若设了 GEMMA_FAKE=1 会静默变成模拟模式
      GEMMA_FAKE_INDEX: '1', // **本 spec 的假构建器钩子**（产品默认走真实构建器）
    },
    extraArgs: ['--user-data-dir=' + userData],
  });

  try {
    const win = await firstWindow(app, 60_000);
    // 事件收集在页面里做（preload 的 onEvent 是唯一通道 —— 与界面看到的完全一样）
    await win.evaluate(() => {
      window.__idxEvents = [];
      window.api.onEvent((e) => window.__idxEvents.push(e));
    });
    // 等界面就绪（搜索输入框出现 = 库已注册、引擎已装配）
    await expect(win.locator('#query')).toBeVisible({ timeout: 30_000 });

    // ① 开始
    const start = await win.evaluate(() => window.api.invoke('indexStart', { libId: 'L1' }));
    expect(start.ok, 'indexStart 必须成功（端口已注入）；实际信封 = ' + JSON.stringify(start)).toBe(
      true,
    );
    const jobId = start.data?.jobId;
    expect(typeof jobId === 'string' && jobId.length > 0, 'indexStart 必须返回 jobId').toBe(true);

    // ② 进度可见（渲染层真的收到 index.progress）
    await expect
      .poll(async () => (await eventsOf(win, 'index.progress')).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const firstProgress = (await eventsOf(win, 'index.progress'))[0];
    expect(firstProgress.jobId).toBe(jobId);
    expect(firstProgress.libId).toBe('L1');

    // ③ 取消 ⇒ 停在边界（零写）
    const cancel = await win.evaluate(
      (id) => window.api.invoke('indexCancel', { jobId: id }),
      jobId,
    );
    expect(cancel.ok).toBe(true);
    await expect
      .poll(
        async () => (await eventsOf(win, 'index.done')).filter((e) => e.cancelled === true).length,
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);
    expect(fs.existsSync(indexPath), '取消时**不许**写索引（原子写：目标文件根本没被打开）').toBe(
      false,
    );

    // ④ 续跑（同进程内 main 会从 job 事件里补 libId；这里显式带上更稳）
    const resume = await win.evaluate(
      (id) => window.api.invoke('indexResume', { jobId: id, libId: 'L1' }),
      jobId,
    );
    expect(resume.ok, 'indexResume 必须成功').toBe(true);

    // ⑤ 完成 ⇒ 复用计数 > 0 + 索引真的落盘
    let doneSeen = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const dones = await eventsOf(win, 'index.done');
      doneSeen = dones.filter((e) => e.ok === true).length;
      if (doneSeen > 0) break;
    }
    if (doneSeen === 0) {
      const all = await events(win);
      console.log('[IDX e2e] 未能完成；事件数 =', all.length);
      console.log('[IDX e2e] 末尾 4 条 =', JSON.stringify(all.slice(-4)));
      console.log(
        '[IDX e2e] 该 job 的事件 =',
        JSON.stringify(all.filter((x) => x.jobId === all[2]?.jobId)),
      );
    }
    expect(doneSeen, '续跑必须完成（index.done.ok=true）；事件见上方日志').toBeGreaterThan(0);
    const doneOk = (await eventsOf(win, 'index.done')).find((e) => e.ok === true);
    expect(Number(doneOk.reused), '续跑必须复用已编码行（reused > 0）').toBeGreaterThan(0);
    await expect.poll(() => fs.existsSync(indexPath), { timeout: 10_000 }).toBe(true);
    expect(fs.statSync(indexPath).size).toBeGreaterThan(0);

    // ⑥ job 行生命周期真的落了库（读回 .gs.db）
    const opened = openGsDb({ dbPath: path.join(libDir, '.gs.db') });
    try {
      const rows = opened.db
        .prepare(
          "SELECT job_id, kind, state, progress_done, progress_total, progress_total FROM job WHERE kind = 'index'",
        )
        .all();
      const states = rows.map((r) => r.state).sort();
      expect(states.includes('cancelled'), '取消必须落成终态 cancelled').toBe(true);
      expect(states.includes('done'), '续跑必须落成终态 done').toBe(true);
      // 进度单调：done 行的 progress_done 不超过 total（且 > 0）
      const doneRow = rows.find((r) => r.state === 'done');
      expect(Number(doneRow.progress_done)).toBeGreaterThan(0);
      if (doneRow.progress_total !== null) {
        expect(Number(doneRow.progress_done)).toBeLessThanOrEqual(Number(doneRow.progress_total));
      }
    } finally {
      opened.db.close();
    }
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

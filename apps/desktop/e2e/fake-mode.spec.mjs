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
import { test, expect } from '@playwright/test';

import { launchFake, launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('E8-a ⭐ `GEMMA_FAKE=1` 能起来，且界面显示的是**样例库**（不是真库）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    // 样例索引的库是 L1「示例库」，root 是合成路径 Z:\__fake_library__（本机不该有它）
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const root = await win.evaluate(() => document.body.innerText.includes('__fake_library__'));
    expect(root, '界面应显示样例库根（Z:\\__fake_library__）—— 说明走的是 fixture 而不是真库').toBe(
      true,
    );
  } finally {
    await app.close();
    cleanup();
  }
});

test('E8-b ⭐ 模拟模式能搜出结果（P3c/P3d 需要"有结果"这个状态）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const input = win.locator('#query');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.fill('吊灯');
    await input.press('Enter');

    await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible({
      timeout: 20_000,
    });
    // 30 条样例（topK 默认 50）⇒ 结果计数应可读
    await expect(win.getByText(/搜索结果/)).toBeVisible();
    // 第一条固定是 VR-101（固定排序，契约 §8）
    await expect(win.getByText('VR-101.rar')).toBeVisible();
  } finally {
    await app.close();
    cleanup();
  }
});

test('E8-c `indexStatus` 在模拟模式下报 3 个库，且含"索引损坏"那个（状态演示用）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const r = await win.evaluate(async () => {
      const res = await window.api.invoke('indexStatus', {});
      return res.ok
        ? { n: res.data.libs.length, ids: res.data.libs.map((l) => l.libId) }
        : { err: res.error.code };
    });
    expect(r.err).toBeUndefined();
    expect(r.n).toBe(3);
    expect(r.ids).toEqual(['L1', 'L2', 'L3']);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E8-d ⭐⭐ 白名单是唯一闸门：U35 恢复的 indexStart 在模拟模式下**能演示**，未登记方法仍被拒', async () => {
  // ⚠️ 2026-10-17 · U35 **翻转**（历史保留）：
  //   改前（2026-10-15 · S6）：indexStart 已从契约删除 ⇒ 要求它**无论如何都被拒**（BAD_REQUEST）。
  //   改后（所有者「批」恢复登记，TASKS U35）：模拟模式下它必须**真的跑起来** ——
  //         假套件已实现（jobId 形如 j-fake-*），且同一个窗口里 exec 仍 BAD_REQUEST、libraryList 仍可用。
  //   为什么不是放宽：负向断言（exec 必拒）**原样保留**；新增的是**正向**断言（恢复的方法真的能用）。
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const r = await win.evaluate(async () => {
      const started = await window.api.invoke('indexStart', { libId: 'L1', device: 'cpu' });
      const bogus = await window.api.invoke('exec', { cmd: 'whoami' });
      const alive = await window.api.invoke('libraryList', {});
      const code = (res) => (res.ok ? null : res.error.code);
      return {
        started: code(started),
        jobId: started.ok ? started.data.jobId : null,
        bogus: code(bogus),
        aliveOk: alive.ok,
        aliveN: alive.ok ? alive.data.libraries.length : null,
      };
    });
    expect(r.started, 'U35 恢复后：模拟模式下 indexStart 必须可用（假套件已实现）').toBeNull();
    expect(r.jobId, '假套件的 jobId 形如 j-fake-*').toMatch(/^j-fake-/);
    expect(r.bogus, '未登记方法（exec）同样必须 BAD_REQUEST').toBe('BAD_REQUEST');
    expect(r.aliveOk, '对照：已登记的启动期方法在同一个窗口里必须可用').toBe(true);
    expect(r.aliveN).toBeGreaterThan(0);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E8-e `itemPaths` 在真窗口里返回两条绝对路径（P3c 的数据源）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const r = await win.evaluate(async () => {
      const res = await window.api.invoke('itemPaths', { libId: 'L1', uid: 'a00000000001' });
      return res.ok ? res.data : { err: res.error.code };
    });
    expect(r.err).toBeUndefined();
    expect(r.imagePath).toBe('Z:\\__fake_library__\\VR\\VR-101.jpg');
    expect(r.archivePath).toBe('Z:\\__fake_library__\\VR\\VR-101.rar');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E8-f ⭐⭐ 真实模式下 indexStart 已接线：未知库给**明确错误码**（不再是"未接线 INTERNAL"），绝不静默成功', async () => {
  // ⚠️ 2026-10-17 · E2E-RED-1 **二次翻转**（历史保留，见 reports/2026-10-15-wave3/e2e-red-1.txt 的翻转表）：
  //   · 改前①（S6）：方法不在契约 ⇒ BAD_REQUEST（白名单拒绝）；
  //   · 改前②（U35/IDX-2a）：已登记但未接线 ⇒ INTERNAL（message 含「IDX-2b 接入」）；
  //   · 改后（IDX-2b2 注入 indexing）：**接线了** ⇒ 真实模式会真的起任务；
  //     对**未知库**则在起任务前就明确失败（LIB_NOT_FOUND）。
  //   为什么不是放宽：仍然 ok === false（**不静默成功**，P6），而且判据更强了 ——
  //     不但要求"失败"，还要求**错误码来自真实链路**（LIB_NOT_FOUND），并明确**不再是**"未接线"那套。
  //   ⚠️ "未注入端口 ⇒ 仍 INTERNAL" 这条 IDX-2a 语义没有被破坏：用单测 index-unwired.test.mjs 钉住（引擎级）。
  const real = await launchWithLibrary();
  try {
    const win = await firstWindow(real.app);
    const off = await win.evaluate(async () => {
      // 用**不存在的库**：证明"接线了、但环境不满足 ⇒ 明确失败"，同时**不触发真实构建**
      // （在 e2e 里起一个真构建会加载模型、扫几千条 —— 那不是在测接线，是在烧时间）。
      const res = await window.api.invoke('indexStart', { libId: 'L-none' });
      return res.ok
        ? { ok: true }
        : {
            ok: false,
            code: res.error.code,
            msg: res.error.message,
            userMsg: res.error.userMessage,
          };
    });
    console.log('[E8-f] indexStart(未知库) 信封 =', JSON.stringify(off));
    expect(off.ok, '真实模式不许假装成功（未知库必须明确失败）').toBe(false);
    expect(
      off.code,
      'IDX-2b2 接线后不再返回"未接线 INTERNAL"；未知库应给真实链路里的明确错误码（LIB_NOT_FOUND）',
    ).toBe('LIB_NOT_FOUND');
    expect(
      String(off.msg),
      '不许再出现"还没接线（IDX-2b 接入）"这套旧语义 —— 那说明端口没注入或又被删了',
    ).not.toMatch(/还没接线|IDX-2b 接入/);
    expect(off.userMsg).toBeTruthy();

    // `itemPaths` 是**只读**方法，两种模式都该可用（它不是模拟专属）。
    // 要证的是「它真的进了 IPC 白名单」—— 判据是**不是 `BAD_REQUEST`**
    // （白名单外会被 zod 先拦成 BAD_REQUEST「请求参数不合法」）。
    // 夹具迷你库没有索引 ⇒ 走到引擎会是 `INDEX_MISSING`，那也是「过了白名单」的证据。
    const ip = await win.evaluate(async () => {
      const res = await window.api.invoke('itemPaths', { libId: 'L1', uid: 'a00000000001' });
      return { ok: res.ok, code: res.ok ? null : res.error.code };
    });
    expect(
      ip.code,
      `itemPaths 应已登记进白名单（BAD_REQUEST 就是没登记），实得 ${ip.code}`,
    ).not.toBe('BAD_REQUEST');
  } finally {
    await real.app.close();
    real.cleanup();
  }
});

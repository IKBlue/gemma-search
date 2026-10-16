// apps/desktop/e2e/app-health.spec.mjs —— U27：`appHealth` 在**真窗口**里可见（2026-10-16）
//
// 覆盖：
//   E15-a ⭐ 健康时顶栏就有那个低调入口（不是空白），且 `appHealth` 如实说「没出过事」
//   E15-b ⭐⭐ 注入一次**真实的**未处理异常 ⇒ 顶栏标记变化 + 面板给出 次数/首条原因/首条时间
//
// 怎么注入（**刻意不加产品注入接口**）：
//   直接往**主进程**投递一次 `unhandledRejection` 事件（`process.emit(...)`）——
//   那正是 Node 在真的未处理 rejection 时做的事，走的是 DF-6 **同一个处理器**
//   （`crash-policy.ts`：记日志 + 标记进程内不健康，**不退出**）。
//   ⚠️ 诚实标注：**事件本身是合成的**（不是等一个真的异步 bug 发生），
//      但它触发的处理器、状态、IPC 读口、界面渲染**全是真的** —— 这条断言能抓的是「接线断/状态没传出去/界面没说」；
//      它抓不到的是「Node 会不会真的把某类 rejection 交上来」（那是 Node 的语义，不是本方法的契约）。
//   （先试过 `utilityProcess.fork()` + `kill()`，实测**不产生** rejection：那条路不通，已放弃。）
import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

/** 读一次 appHealth（恒成功的方法；用它自己证明它自己是通的） */
async function readHealth(win) {
  return win.evaluate(() => window.api.invoke('appHealth', {}));
}

test('E15-a ⭐ 健康时顶栏就有那个低调入口，且 appHealth 如实说「没出过事」', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // ① 恒成功 + 四样字段齐全（不是 ok:false，也不是抛）
    const res = await readHealth(win);
    expect(res.ok, 'appHealth 必须恒成功：' + JSON.stringify(res)).toBe(true);
    expect(res.data.unhealthy).toBe(false);
    expect(res.data.count).toBe(0);
    expect(res.data.reason).toBe(null);
    expect(res.data.firstAt).toBe(null);

    // ② 顶栏入口**在**（低调：健康时也有一行字），且 data-unhealthy=no
    const entry = win.getByTestId('app-health-entry');
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry).toHaveAttribute('data-unhealthy', 'no');
    await expect(entry).toContainText('诊断');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E15-b ⭐⭐ 注入一次真实的未处理异常 ⇒ 标记可见 + 面板给出次数/首条原因/首条时间', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const before = await readHealth(win);
    expect(before.data.unhealthy).toBe(false);

    // 注入：往主进程投递一次未处理 rejection（走 DF-6 的同一个处理器）
    // ⚠️ 这行是这条用例唯一的「合成」之处，注释里写明了；处理器/状态/IPC/界面全是真的。
    const injected = await app.evaluate(async () => {
      const fake = new Error('e2e-injected-unhandled-rejection');
      process.emit(
        'unhandledRejection',
        fake,
        Promise.reject(fake).catch(() => {}),
      );
      // 给处理器一个同步执行的机会（它本身是同步的）
      return true;
    });
    expect(injected).toBe(true);

    // 标记是**异步**落地的（事件投递 + 处理器执行）⇒ 轮询而不是立刻断言
    await expect
      .poll(async () => (await readHealth(win)).data.unhealthy, { timeout: 20_000 })
      .toBe(true);
    const after = await readHealth(win);
    expect(after.data.count).toBeGreaterThan(0);
    expect(typeof after.data.reason).toBe('string');
    expect(after.data.reason.length).toBeGreaterThan(0);
    expect(typeof after.data.firstAt).toBe('string');
    // ⚠️ 摘要**不许**把绝对路径/用户名搬到界面上（唯一落点是 main/app-health.ts 的 summarizeReason）
    // ⚠️ ROOT 不在这里硬写：路径判据用**主进程自己**的 app 目录（唯一来源，不抄一份字面量）
    const appPath = await app.evaluate(({ app: electronApp }) => electronApp.getAppPath());
    expect(after.data.reason.includes(appPath), '摘要里出现了本机应用目录').toBe(false);
    expect(after.data.reason.includes('AppData'), '摘要里出现了用户目录').toBe(false);

    // 顶栏标记跟着变（**进程级事实**，不需要切页面）
    const entry = win.getByTestId('app-health-entry');
    await expect(entry).toHaveAttribute('data-unhealthy', 'yes', { timeout: 10_000 });
    await expect(entry).toContainText(String(after.data.count));

    // 诊断页的面板：三样事实都要在（次数 / 首条原因 / 首条时间）
    // ⚠️ 必须 exact：顶栏那个入口的 aria-label 也是「诊断与重建：…」⇒ 不限定会同时命中两个链接
    await win.getByRole('link', { name: '诊断与重建', exact: true }).click();
    const panel = win.getByTestId('app-health-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toHaveAttribute('data-unhealthy', 'yes');
    await expect(win.getByTestId('app-health-count')).toHaveText(String(after.data.count));
    await expect(win.getByTestId('app-health-reason')).toContainText(after.data.reason);
    await expect(win.getByTestId('app-health-firstat')).not.toHaveText('—');
    // 面板那行结论必须**不再是**「没出过事」（否则就是红色扮绿）
    await expect(win.getByTestId('app-health-line')).not.toContainText('没有出现过未处理异常');
  } finally {
    await app.close();
    cleanup();
  }
});

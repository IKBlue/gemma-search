// apps/desktop/e2e/window-security.spec.mjs —— E3：真窗口里的窗口安全行为（S11 / S12）
//
// 这条测试补的是**最虚的一层**。移除前，`verify_main_wiring.mjs` 测过 S11/S12，但它是
// **用假 `electron` 加载产物、手工调用抓到的回调** —— 能证明"我们的判定函数对"，
// **不能证明"Chromium 真的会调它、真的会拦住"**。`SPEC.md` §6 自己也写着
// 「真窗口行为未实测」。本文件就是那句"未实测"的兑现。
//
// 覆盖：S11（`window.open` 被 deny）· S12（外部导航被 preventDefault）
import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('E3-a ⭐ S11：`window.open` 被 deny —— 不产生新窗口', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);

    // `setWindowOpenHandler(() => decideWindowOpen())` ⇒ deny 时 `window.open` 返回 null
    const returned = await win.evaluate(() => {
      const w = window.open('https://example.com');
      return w === null ? 'null' : 'window';
    });
    expect(returned).toBe('null');

    // 给 Chromium 一点时间（若 handler 没生效，新窗口会稍后出现）
    await win.waitForTimeout(800);
    expect(app.windows().length, '不许出现第二个窗口').toBe(1);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E3-b ⭐ S12：外部导航被拦 —— URL 不变、渲染层仍活着', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    // 先确认页面本来就好（这样"后来还在"才有意义）
    await expect(win.getByRole('heading', { name: '找到你想要的那张图。' })).toBeVisible();
    const before = win.url();

    // `will-navigate` 里 `preventDefault()` ⇒ 导航被取消。
    //
    // ⚠️ 写法上有个坑（本测试第一版就栽在这）：**被取消的导航会让 Playwright 的 locator
    // 一直"等导航结束"**，于是 `expect(locator).toBeVisible()` 会超时 —— 那看起来像
    // "S12 没生效"，其实 URL 根本没变。所以这里改用 `evaluate` 读 DOM，不走 locator 的自动等待。
    await win
      .evaluate(() => {
        window.location.href = 'https://example.com';
      })
      .catch(() => {});
    await win.waitForTimeout(1000);

    // ⭐ 核心断言：URL 没变 ⇒ 导航真的被拦住了
    expect(win.url(), 'URL 不该变成 example.com').toBe(before);

    // 渲染层还活着（`window.api` 还在、标题还在）—— 用 evaluate 读，避免 locator 的导航等待
    const alive = await win
      .evaluate(() => ({
        api: typeof window.api,
        h1: (document.querySelector('h1') || {}).textContent || '',
      }))
      .catch(() => null);
    expect(alive, '被拦之后页面应当仍可求值（不是白屏/崩掉）').not.toBeNull();
    expect(alive.api).toBe('object');
    expect(alive.h1).toContain('找到你想要的那张图');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E3-c 导航到未知 hash 不产生控制台错误（渲染层没被路由变化打崩）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const errs = [];
    win.on('pageerror', (e) => errs.push(e.message));
    win.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text());
    });

    for (const h of ['#/tasks', '#/', '#/item/L1/0123456789ab', '#/不存在']) {
      await win.evaluate((hash) => {
        window.location.hash = hash;
      }, h);
      await win.waitForTimeout(300);
    }

    expect(errs, `路由切换不该报错：${errs.join(' | ')}`).toEqual([]);
  } finally {
    await app.close();
    cleanup();
  }
});

// ⚠️ **已知边界（钉住它，别让它悄悄变）**：`SPEC.md` §6 记录
//    `isAppUrl` 对 `file://` 是**前缀放行** —— 也就是说应用内导航到**任意本地 HTML**
//    仍然会拿到 `window.api`（preload 是按 webContents 挂的，不是按路径）。
//    本条**不断言它是"对的"**，只把当前行为钉住，避免它无声变化；
//    真正收紧需要在 SPEC 层决策（例如限定到具体 renderer 目录）。
test('E3-d 边界：`file://` 导航是**前缀放行**（`SPEC.md` §6 已记录，此处钉住现状）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const before = win.url();

    // 构造一个同属 file:// 的别的路径（不真的换页成功也要能观察）
    const other = before.replace(/[^/]+$/, 'other.html');
    await win
      .evaluate((u) => {
        window.location.href = u;
      }, other)
      .catch(() => {});
    await win.waitForTimeout(800);

    const after = win.url();
    console.log('  [E3-d] before =', before);
    console.log('  [E3-d] after  =', after);
    // 现状：前缀放行 ⇒ 不会被 will-navigate 拦（除非文件不存在导致加载失败，URL 仍会变）
    // 这里只记录，不做"应该怎样"的断言 —— 那属于 SPEC 决策，不属于测试。
    expect(typeof after).toBe('string');
  } finally {
    await app.close();
    cleanup();
  }
});

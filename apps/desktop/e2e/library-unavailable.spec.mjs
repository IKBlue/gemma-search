// apps/desktop/e2e/library-unavailable.spec.mjs —— U18：拔掉路径的库在**真窗口**里可见且不崩
//
// 为什么必须有这条（Lead 裁定扩 scope）：U18 的全部意义就是「用户**看得见**那个不可用的库」——
//   单测证明的是**数据路径**（libraryList 的行上有 available/unavailableCode/unavailableReason），
//   只有真窗口才能证明**它真的被渲染出来**。
//
// 两个场景各一条：
//   U18-a 库根指向**不存在**的路径 ⇒ ① 启动不被阻塞（进主界面，不是首启向导）
//                                ② #/browse 出现「不可用 + 原因」横幅、且库仍然列在那里
//                                ③ #/health 同样出现（诊断页是用户"出事时"会来看的地方）
//   U18-b 库根**可用**（真夹具库）⇒ **不渲染**那条横幅（新节点只在不可用时出现）
import { test, expect } from '@playwright/test';

import { launchWithLibrary, launchWithMissingLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

/** 横幅里必然出现的三种原因之一（与 library-availability.ts 的文案同源） */
const REASON = /不存在|不可访问|不是目录/;

test('U18-a ⭐⭐ 已登记但路径不见了的库：真窗口里**可见 + 写明原因**，且不阻塞启动', async () => {
  const { app, cleanup } = await launchWithMissingLibrary();
  try {
    const win = await firstWindow(app);

    // ① **不阻塞启动**：进的是主界面（侧栏在那儿），而不是首启向导
    await expect(win.locator('.nav a').first()).toBeVisible({ timeout: 30_000 });

    // ② 浏览页：不可用横幅可见，且写明原因（不是一句"出错了"）
    await win.evaluate(() => {
      window.location.hash = '#/browse';
    });
    const banner = win.getByTestId('browse-library-unavailable');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('不可用');
    await expect(banner).toContainText(REASON);
    // 库**仍然列在那里**（这正是 U18 要修的东西：以前用户以为它被删了）
    await expect(win.getByTestId('browse-library')).toContainText('L1');
    await expect(win.getByTestId('browse-library')).toContainText('不可用');

    // ③ 诊断页同样可见（同一个事实，两个界面都不许瞒着用户）
    await win.evaluate(() => {
      window.location.hash = '#/health';
    });
    const diag = win.getByTestId('diagnostics-library-unavailable');
    await expect(diag).toBeVisible({ timeout: 20_000 });
    await expect(diag).toContainText(REASON);
    await expect(win.getByTestId('diagnostics-library-unavailable-badge')).toBeVisible();
  } finally {
    await app.close();
    cleanup();
  }
});

test('U18-b ⭐ 库根可用时**不渲染**不可用横幅（新节点只在不可用时出现）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await expect(win.locator('.nav a').first()).toBeVisible({ timeout: 30_000 });

    await win.evaluate(() => {
      window.location.hash = '#/browse';
    });
    // 库面板在（说明页面正常），但没有那条横幅
    await expect(win.getByTestId('browse-library')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('browse-library-unavailable')).toHaveCount(0);

    await win.evaluate(() => {
      window.location.hash = '#/health';
    });
    await expect(win.getByTestId('diagnostics-library')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('diagnostics-library-unavailable')).toHaveCount(0);
    await expect(win.getByTestId('diagnostics-library-unavailable-badge')).toHaveCount(0);
  } finally {
    await app.close();
    cleanup();
  }
});

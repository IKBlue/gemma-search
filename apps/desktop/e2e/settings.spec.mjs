// apps/desktop/e2e/settings.spec.mjs —— SETTINGS-1：最小设置页（PRD-1 · M3 的「缺依赖跳设置」落点）
//
// 验的是**页面真的存在且可达**（不是"路由表里有个字符串"）：
//   · 侧栏「设置」从门控项变成真链接 → 点击后 hash 变成 #/settings；
//   · 四块内容都在：库 / 模型指引 / 索引任务（开始·取消·续跑）/ 可选能力说明；
//   · 索引任务按钮复用既有 hook（不另写一套），页面本身**不做**任何写操作直到用户点；
//   · 能回到搜索页。
import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('SETTINGS-1 ⭐⭐ 设置页可达：库 / 模型指引 / 索引任务 / 可选能力说明（模拟模式）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await expect(win.locator('#query')).toBeVisible({ timeout: 20_000 });

    // ① 侧栏「设置」不再是门控项：点它真的会导航
    const settingsNav = win.locator('[data-nav="settings"]');
    await expect(settingsNav).toBeVisible();
    await settingsNav.click();
    await expect
      .poll(() => win.evaluate(() => location.hash), { timeout: 10_000 })
      .toContain('#/settings');

    // ② 页面与四块内容
    await expect(win.getByTestId('settings-page')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('settings-libraries')).toBeVisible();
    await expect(win.getByTestId('settings-libraries')).toContainText('素材库');
    await expect(win.getByTestId('settings-model')).toContainText('用户指定');
    await expect(win.getByTestId('settings-index')).toContainText('索引任务');
    // 索引任务三按钮（复用既有 hook；只断言存在，不点“开始”以免在 e2e 里起真实任务）
    await expect(
      win.getByTestId('settings-index').getByRole('button', { name: '开始索引' }),
    ).toBeVisible();
    await expect(
      win.getByTestId('settings-index').getByRole('button', { name: '取消' }),
    ).toBeVisible();
    await expect(
      win.getByTestId('settings-index').getByRole('button', { name: '续跑' }),
    ).toBeVisible();

    // ③ 可选能力：如实写"默认关闭"，且不假装开关已持久化（P6）
    await expect(win.getByTestId('settings-optional')).toContainText('默认关闭');
    await expect(win.getByTestId('settings-optional')).toContainText('待批');

    // ④ 能回搜索页（← 返回搜索）
    await win.getByRole('link', { name: '返回搜索' }).click();
    await expect(win.locator('#query')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    cleanup();
  }
});

// apps/desktop/e2e/activity.spec.mjs —— E11：操作记录页的**诚实态**（S6 重写）
//
// ⚠️ 2026-10-15 · S6（绿地基线 §2.2）：transactions / mutate **已从契约删除**（意图层表本轮没建）
//   ⇒ 这一页没有数据源。裁定同上：不留假按钮的用例；改断言「诚实态」文案。
//
// 旧用法（E11-a…f）测的是「事务表 + 撤销状态 + 回退真的改状态 + blocked 提示 + 真实模式如实报」——
// 全部建立在已删除的两个方法上。
import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('E11-a ⭐ 操作记录页 = 诚实态：说清「表还没建」，且**不显示空表假装没有记录**', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await win.evaluate(() => {
      window.location.hash = '#/activity';
    });
    await expect
      .poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toBe('#/activity');

    await expect(win.getByTestId('activity-unavailable')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('activity-unavailable')).toContainText('该功能等对应的数据表上线');
    await expect(win.getByTestId('activity-unavailable')).toContainText('transactions');

    // ⚠️ 「没有记录」与「功能还没做」必须看得出区别：不许出现事务表 / 空表文案
    await expect(win.getByTestId('tx-table')).toHaveCount(0);
    await expect(win.getByText('还没有任何写操作记录。')).toHaveCount(0);

    await expect.poll(() => win.title(), { timeout: 5_000 }).toContain('操作记录');
  } finally {
    await app.close();
    cleanup();
  }
});

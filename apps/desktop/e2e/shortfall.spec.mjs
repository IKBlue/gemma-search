// apps/desktop/e2e/shortfall.spec.mjs —— NOMATCH-1（U38 口径 A）：弱匹配的**呈现与接线**
//
// 为什么用模拟模式：口径是"结果第一条的 band 是 low 时显示仅供参考、只留最近 N 条"。
// 用真模型制造 low 档**不确定**（无意义文本仍可能落在 mid：本机实测 0.70–0.72），
// 而模拟模式有 `__lowband__` 演示钩子（与 `__empty__` 同族，见 fake.ts 的注释）⇒ 能**确定地**触发。
//
// 分工：
//   · 判定逻辑（只看引擎 band、不自算阈值、N=10、边界）由 `tests/shortfall.test.mjs` 钉住；
//   · 本 spec 钉**接线与呈现**：提示真的出现/消失、卡片数真的被截到 10、正常查询不受影响。
import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('U38 ⭐⭐ 弱匹配：band 全 low ⇒ 提示"仅供参考"且只展示最近 10 条；正常查询不展示', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const input = win.locator('#query');
    const cards = win.locator('article.photo-card');
    await expect(input).toBeVisible({ timeout: 20_000 });
    // PRD-1：默认本地检索 L0；shortfall 是**语义检索**的呈现口径 ⇒ 先切「智能检索」
    await win.getByRole('button', { name: '智能检索' }).click();

    // ① 演示钩子：每条都落在 low 档 ⇒ shortfall 形态
    await input.fill('__lowband__');
    await input.press('Enter');
    await expect(win.getByTestId('shortfall-notice')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('shortfall-notice')).toContainText(/仅供参考/);
    await expect(cards).toHaveCount(10, { timeout: 20_000 });

    // ② 正常查询：提示必须消失，结果回到完整列表（模拟库 30 条）
    await input.fill('正常查询');
    await input.press('Enter');
    await expect(win.getByTestId('shortfall-notice')).toHaveCount(0, { timeout: 20_000 });
    await expect(cards).toHaveCount(30, { timeout: 20_000 });
  } finally {
    await app.close();
    cleanup();
  }
});

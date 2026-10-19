// apps/desktop/e2e/local-search.spec.mjs —— PRD-1 · LOCAL-2：默认「本地检索 L0」的真窗口验收
//
// 验的是**默认形态**（所有者 2026-10-19）：
//   · 打开应用 = 本地检索（不需要模型/索引）→ 输入 ID / 文件名 / ext: / 关键词 ⇒ 结果即时出现；
//   · 结果卡显示**命中类型**（ID / 文件名 / 扩展名 / 路径），不显示语义分数/档位；
//   · 无命中给"没有匹配"，不自动回退到语义检索。
//
// 用模拟模式：它没有模型、没有索引、没有 `.gs.db` —— 正好证明 L0 的"零模型可用"是**真的**
// （LOCAL-1 已给 fake 模式做内存演示实现，见 local-search.ts 的 runFakeLocalSearch）。
import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('LOCAL-2 ⭐⭐ 默认本地检索：ID/前缀/文件名/扩展名/路径命中 + 无命中（零模型）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    const input = win.locator('#query');
    const cards = win.locator('article.photo-card');
    await expect(input).toBeVisible({ timeout: 20_000 });

    // ① 默认就是「本地检索」（不是语义/以图搜图）
    const localBtn = win.getByRole('button', { name: '本地检索' });
    const smartBtn = win.getByRole('button', { name: '智能检索' });
    await expect(localBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(smartBtn).toHaveAttribute('aria-pressed', 'false');
    // 且智能检索入口在本地模式下**不隐藏**（P6：可选能力要可见，切过去才走设置/模型）
    await expect(smartBtn).toBeVisible();

    // ② 文件名子串 ⇒ hit=name
    await input.fill('VR-101');
    await input.press('Enter');
    await expect(cards).toHaveCount(1, { timeout: 20_000 });
    await expect(cards.first().getByTestId('hit-type')).toHaveAttribute('data-hit', 'name');

    // ③ 12 位 uid 精确 ⇒ hit=uid
    await input.fill('a00000000002');
    await input.press('Enter');
    await expect(cards).toHaveCount(1, { timeout: 20_000 });
    await expect(cards.first().getByTestId('hit-type')).toHaveAttribute('data-hit', 'uid');

    // ④ uid 前缀（4–11 位，允许 #）⇒ 全部 30 条示例（它们都以 a00000 开头）
    await input.fill('#a00000');
    await input.press('Enter');
    await expect(cards).toHaveCount(30, { timeout: 20_000 });

    // ⑤ ext: 前缀 ⇒ hit=ext（示例库有 2 张 png）
    await input.fill('ext:PNG');
    await input.press('Enter');
    await expect(cards).toHaveCount(2, { timeout: 20_000 });
    await expect(cards.first().getByTestId('hit-type')).toHaveAttribute('data-hit', 'ext');

    // ⑥ 只有路径命中 ⇒ hit=path（"其他"这个目录下有 4 条示例：MISC-401..404）
    await input.fill('其他');
    await input.press('Enter');
    await expect(cards).toHaveCount(4, { timeout: 20_000 });
    await expect(cards.first().getByTestId('hit-type')).toHaveAttribute('data-hit', 'path');

    // ⑦ 无命中 ⇒ 明确说"没有匹配"，不静默、不自动改走语义检索
    await input.fill('zzz-绝对不存在的关键词');
    await input.press('Enter');
    await expect(win.getByText('没有匹配的素材')).toBeVisible({ timeout: 20_000 });
    await expect(cards).toHaveCount(0);
  } finally {
    await app.close();
    cleanup();
  }
});

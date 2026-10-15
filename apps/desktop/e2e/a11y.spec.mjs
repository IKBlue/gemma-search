// apps/desktop/e2e/a11y.spec.mjs —— E5：无障碍缺口的**真窗口**验证（T4）
//
// 补的是什么：`UI-REVIEW-and-migration.md` §1/§9 记的两个缺口 ——
//   · 筛选胶囊只是个 `<button class="active">` —— **屏幕阅读器完全看不到"已选中"**
//   · 侧栏导航没有"当前页"语义
// 这两条**必须用真窗口验**：`aria-*` 是给辅助技术看的，静态读源码证明不了它真的出现在 DOM 上
// （React 可能把属性名写错、可能被 spread 覆盖掉）。
//
// ⚠️ **E5 覆盖不到、也不假装覆盖的**：确认弹窗（`ConfirmDialog`）的 **ESC 关闭 / 焦点落位**。
//   它要走到"有检索结果"才会出现，而检索需要 ONNX 模型 + 已注册索引 —— 本环境跑不了（`TODO.md` B-3）。
//   那两条只能人工 `npm run dev` 确认；能自动化的一半（取消 ⇒ 一个 IPC 都没发）在
//   `apps/desktop/tests/search-store.test.mjs` 的 Z13–Z16。
import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

test('E5-a ⭐ Chip 暴露 `aria-pressed`，且点击后真的翻转（不是只改 class）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const chip = win.getByRole('button', { name: 'VR', exact: true });
    await expect(chip).toBeVisible();

    // 初始：未选中
    await expect(chip).toHaveAttribute('aria-pressed', 'false');

    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // 换一个筛选 ⇒ 前一个回到 false（选中是互斥的，不是累积的）
    await win.getByRole('button', { name: 'CR', exact: true }).click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(win.getByRole('button', { name: 'CR', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await app.close();
    cleanup();
  }
});

test('E5-b ⭐ 侧栏导航暴露 `aria-current="page"`，且跟着路由走', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);

    // 搜索页：只有「语义搜索」是当前页
    const search = win.getByRole('link', { name: '语义搜索' });
    const tasks = win.getByRole('link', { name: '索引任务' });
    await expect(search).toHaveAttribute('aria-current', 'page');
    await expect(tasks).not.toHaveAttribute('aria-current', 'page');

    // 切到任务页 ⇒ aria-current 跟着搬过去
    await tasks.click();
    await expect(win.getByRole('heading', { name: '索引任务' })).toBeVisible();
    await expect(tasks).toHaveAttribute('aria-current', 'page');
    await expect(search).not.toHaveAttribute('aria-current', 'page');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E5-c 空闲时**不渲染**确认弹窗（破坏性操作的确认框不该常驻）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    // `pendingCollect` 为 null ⇒ 弹窗不该存在
    await expect(win.getByTestId('confirm-dialog')).toHaveCount(0);
    // 且不该有任何 alertdialog 角色（Radix 用的是 role="alertdialog"）
    await expect(win.getByRole('alertdialog')).toHaveCount(0);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E5-d 图标按钮有可读名字（无障碍名字不是只有图标）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    // 顶栏两个 icon 按钮：靠 aria-label 提供名字 —— 没有它屏幕阅读器只会读"按钮"
    await expect(win.getByRole('button', { name: '重新读取索引状态' })).toBeVisible();
    await expect(win.getByRole('button', { name: '帮助' })).toBeVisible();
  } finally {
    await app.close();
    cleanup();
  }
});

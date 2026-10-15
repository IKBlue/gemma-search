// apps/desktop/e2e/styles.spec.mjs —— E4：Tailwind 迁移的**保真度**验证（T3）
//
// 为什么必须有这条：
//   T3 把 Button / Chip 的样式从 `renderer.css` 手写 CSS 迁到了 Tailwind 类，并**删掉了旧规则**。
//   "构建通过 + 页面不白屏"证明不了外观没变 —— 迁移最典型的失败就是**悄悄差几像素**，
//   那种问题在代码评审里看不出来，只有真窗口的能量出来的值能抓住。
//
// 判据用的是**令牌本身**，不是写死的期望值：
//   迁移前那些规则写的是 `var(--radius-sm)` / `var(--touch-min)`；迁移后工具类必须仍然落在同一令牌上。
//   所以「计算值 === 该令牌的计算值」正是"外观没变"的可执行定义。
//   ⇒ 好处：改令牌时这条测试跟着变，不会变成"改了令牌就得改测试"的假门禁。
import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

/** 读某个元素的计算样式 */
const styleOf = (loc) =>
  loc.evaluate((el) => {
    const c = getComputedStyle(el);
    return {
      bg: c.backgroundColor,
      color: c.color,
      radius: c.borderRadius,
      minH: c.minHeight,
      padTop: c.paddingTop,
      padRight: c.paddingRight,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      borderWidth: c.borderTopWidth,
      borderColor: c.borderTopColor,
      width: c.width,
      height: c.height,
    };
  });

/** 读根上的令牌计算值（`--x` 原样返回，含单位；`--x` 是 token 名） */
const tokens = (win, names) =>
  win.evaluate(
    (ns) =>
      Object.fromEntries(
        ns.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]),
      ),
    names,
  );

test('E4-a ⭐ 迁移后 Button(default) 的每个视觉值都仍落在**设计令牌**上', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const btn = win.getByRole('button', { name: /添加图库/ });
    await expect(btn).toBeVisible();

    const st = await styleOf(btn);
    const tk = await tokens(win, [
      '--radius-sm',
      '--touch-min',
      '--space-2',
      '--space-3',
      '--type-caption',
      '--color-bg-elevated',
      '--color-text-primary',
      '--color-separator-subtle',
    ]);
    console.log('  [E4-a] 计算样式 =', JSON.stringify(st));
    console.log('  [E4-a] 令牌     =', JSON.stringify(tk));

    // 圆角：迁移前是 var(--radius-sm)（8px）
    expect(st.radius).toBe(tk['--radius-sm']);
    // 最小高度：迁移前是 var(--touch-min)（44px）—— Tailwind 侧是 min-h-11 = calc(var(--space-1)*11)
    expect(st.minH).toBe(tk['--touch-min']);
    // 内边距：迁移前是 var(--space-2) var(--space-3)
    expect(st.padTop).toBe(tk['--space-2']);
    expect(st.padRight).toBe(tk['--space-3']);
    // 字号 / 颜色 / 边框
    expect(st.fontSize).toBe(tk['--type-caption']);
    expect(st.bg).toBe('rgb(255, 255, 255)'); // --color-bg-elevated: #ffffff
    expect(st.color).toBe('rgb(29, 29, 31)'); // --color-text-primary: #1d1d1f
    expect(st.borderWidth).toBe('1px');
    expect(st.borderColor).toBe('rgb(229, 229, 234)'); // --color-separator-subtle: #e5e5ea
  } finally {
    await app.close();
    cleanup();
  }
});

test('E4-b ⭐ Button(primary) 仍是强调色填充 + 反白文字（--color-accent / --color-on-accent）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const btn = win.getByRole('button', { name: /更新索引/ });
    await expect(btn).toBeVisible();

    const st = await styleOf(btn);
    const tk = await tokens(win, ['--color-accent', '--color-on-accent']);
    console.log('  [E4-b] primary =', st.bg, '/', st.color, '· 令牌 =', JSON.stringify(tk));

    expect(st.bg).toBe('rgb(0, 113, 227)'); // --color-accent: #0071e3
    expect(st.color).toBe('rgb(255, 255, 255)'); // --color-on-accent
    expect(st.borderColor).toBe('rgb(0, 113, 227)');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E4-c ⭐ Button(icon) 仍是 36×36 方形（--control-icon-btn / --radius-md）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const btn = win.getByRole('button', { name: '重新读取索引状态' });
    await expect(btn).toBeVisible();

    const st = await styleOf(btn);
    const tk = await tokens(win, ['--control-icon-btn', '--radius-md', '--color-text-secondary']);
    console.log(
      '  [E4-c] icon =',
      st.width,
      '×',
      st.height,
      '· radius =',
      st.radius,
      '· 令牌 =',
      JSON.stringify(tk),
    );

    expect(st.width).toBe(tk['--control-icon-btn']);
    expect(st.height).toBe(tk['--control-icon-btn']);
    expect(st.radius).toBe(tk['--radius-md']);
    expect(st.color).toBe('rgb(110, 110, 115)'); // --color-text-secondary: #6e6e73
  } finally {
    await app.close();
    cleanup();
  }
});

test('E4-d ⭐ Chip 仍是胶囊（--radius-pill / --control-chip-padding / 32px 高）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    // CHIPS 里第一项是「全部」，其后是 VR / CR …
    const chip = win.getByRole('button', { name: 'VR', exact: true });
    await expect(chip).toBeVisible();

    const st = await styleOf(chip);
    const tk = await tokens(win, ['--radius-pill', '--type-caption', '--color-text-secondary']);
    console.log('  [E4-d] chip =', JSON.stringify(st), '· 令牌 =', JSON.stringify(tk));

    expect(st.radius).toBe(tk['--radius-pill']); // 999px
    expect(st.minH).toBe('32px'); // 迁移前就是硬写的 32px
    expect(st.padTop).toBe('8px'); // --control-chip-padding: 8px 16px
    expect(st.padRight).toBe('16px');
    expect(st.fontSize).toBe(tk['--type-caption']);
    expect(st.color).toBe('rgb(110, 110, 115)');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E4-e ⭐ Chip 选中态：底色变主文字色、文字反白（迁移前 .chip.active 的等价物）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    const chip = win.getByRole('button', { name: 'VR', exact: true });
    await expect(chip).toBeVisible();
    const before = await styleOf(chip);

    await chip.click();
    // 等一次状态回流
    await expect
      .poll(() => chip.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 5_000 })
      .not.toBe(before.bg);

    const after = await styleOf(chip);
    console.log('  [E4-e] 点击前 =', before.bg, before.color, '→ 点击后 =', after.bg, after.color);
    expect(after.bg).toBe('rgb(29, 29, 31)'); // --color-text-primary
    expect(after.color).toBe('rgb(255, 255, 255)'); // --color-bg-elevated
  } finally {
    await app.close();
    cleanup();
  }
});

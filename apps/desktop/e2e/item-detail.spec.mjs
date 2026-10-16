// apps/desktop/e2e/item-detail.spec.mjs —— E9：P3c 图片详情页（在**模拟模式**下跑真窗口）
//
// 为什么这组现在才写得出来：P3c 要"有这一条素材"才能显示，而真实库要 ONNX 模型 + 已注册索引。
// `GEMMA_FAKE=1`（契约 §8）让样例索引进到真窗口里 ⇒ 这条验收**从"只能人工"变成可复跑**。
//
// 规格出处：`SPEC.md` §4 / §3 F1（大图 / 元数据两条绝对路径 /
// 四分区动作 / 把"是否需重编码"标在按钮上）。ROADMAP:221 的验收：两条路径与索引状态正确显示。
//
// ⚠️ 模拟模式测的是**接线与渲染**，不是检索质量（`TODO.md` B-3 仍是那条边界）。
import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

/** 打开某条素材的详情页 */
async function openItem(win, uid = 'a00000000001') {
  await win.evaluate((u) => {
    window.location.hash = `#/item/L1/${u}`;
  }, uid);
  await expect
    .poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toBe(`#/item/L1/${uid}`);
}

/** 读某一行元数据的值 */
const metaValue = (win, label) =>
  win.locator(`[data-meta="${label}"] > span:nth-child(2)`).innerText();

test('E9-a ⭐ 显示大图 + 元数据 + **两条绝对路径**（P3c 的核心验收）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await openItem(win);

    // 页头用 stem 当标题
    await expect(win.getByRole('heading', { name: 'VR-101' })).toBeVisible({ timeout: 20_000 });

    // 大图走 thumb://（渲染层传不进路径，只给 libId+uid@size）。
    // ⚠️ 模拟模式下库里**没有真实文件** ⇒ `thumb://` 必然取不到 ⇒ `onError` 会把 <img> 换诚实的兜底。
    //    所以这里两种结果都接受，但**必须**是其中之一 —— 不允许"什么都没有还装作正常"。
    const fallback = win.getByTestId('image-fallback');
    const img = win.locator('img').first();
    if (await fallback.isVisible().catch(() => false)) {
      await expect(fallback).toContainText(/无预览/);
      await expect(fallback).toContainText(/文件可能已不在盘上/);
    } else {
      expect(await img.getAttribute('src')).toBe('thumb://L1/a00000000001@512');
    }

    // 元数据
    expect(await metaValue(win, 'ID')).toBe('VR-101');
    expect(await metaValue(win, '分类')).toBe('VR');
    expect(await metaValue(win, '库')).toBe('L1');

    // ⭐ 两条**绝对路径**（契约 §2.2a 的 `itemPaths`）
    expect(await metaValue(win, '图路径')).toBe('Z:\\__fake_library__\\VR\\VR-101.jpg');
    expect(await metaValue(win, '包路径')).toBe('Z:\\__fake_library__\\VR\\VR-101.rar');
    expect(await metaValue(win, '相对路径')).toBe('VR\\VR-101.jpg');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E9-b ⭐ 索引状态：正常条目「已编码」；盘上没了的是「已从索引移除」', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);

    await openItem(win, 'a00000000001');
    const ok = win.locator('[data-state]');
    await expect(ok).toBeVisible({ timeout: 20_000 });
    expect(await ok.getAttribute('data-state')).toBe('encoded');
    await expect(ok).toHaveText('已编码');

    // fixture 的 scan.missing 含 a0000000001e ⇒ 该条 exists.image=false ⇒ removed
    await openItem(win, 'a0000000001e');
    await expect(win.locator('[data-state]')).toHaveAttribute('data-state', 'removed', {
      timeout: 20_000,
    });
    await expect(win.locator('[data-state]')).toHaveText('已从索引移除');
    // 而且要**看得见**"文件没了"，不能只改个徽标
    await expect(win.getByText(/文件已不在盘上/)).toBeVisible();
  } finally {
    await app.close();
    cleanup();
  }
});

test('E9-c ⭐ 动作四分区**都在**，且每个按钮都带「需重编码 / 不重编码」角标（UI-REVIEW:236-237）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await openItem(win);
    await expect(win.getByTestId('action-groups')).toBeVisible({ timeout: 20_000 });

    // 四个分区，名字逐字对上规格。
    // ⚠️ 不能 `getByText('取件')` —— 分区标题与里面的按钮同名，strict mode 会因命中 2 个而报错。
    //    直接读分区标题那一行的文本。
    const titles = await win.locator('[data-group] > div:first-child').allTextContents();
    expect(titles).toEqual(['取件', '维护（复用向量）', '维护（需重编码，须提示）', '危险区']);
    expect(await win.locator('[data-group]').count()).toBe(4);

    // 规格明确要求「把是否需要重编码**直接标在按钮上**」⇒ 每个动作都要有角标
    const badges = await win.locator('[data-badge]').allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b).toMatch(/需重编码|不重编码/);

    // 规格点名的两类判断
    const badgeOf = async (id) =>
      win.locator(`[data-action="${id}"]`).locator('xpath=following-sibling::*[1]').innerText();
    expect(await badgeOf('rename')).toContain('不重编码');
    expect(await badgeOf('moveFolder')).toContain('不重编码');
    expect(await badgeOf('replaceImage')).toContain('需重编码');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E9-d ⭐ 没有后端的动作**禁用且写明原因**（不许静默点不动）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await openItem(win);
    await expect(win.getByTestId('action-groups')).toBeVisible({ timeout: 20_000 });

    // 契约里没有"替换预览图"的方法 ⇒ 必须禁用并说明
    const replace = win.locator('[data-action="replaceImage"]');
    await expect(replace).toBeDisabled();
    expect(await replace.getAttribute('title')).toMatch(/还没有这个方法/);

    // "重新编码这一条"也没有（只有整库 indexStart）⇒ 禁用，且原因要说清
    const re = win.locator('[data-action="reencode"]');
    await expect(re).toBeDisabled();
    const why = await re.getAttribute('title');
    expect(why).toMatch(/当前不需要|需要重编码/);
    expect(why.length).toBeGreaterThan(4);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E9-e ⭐ 「检查变更」跑一次 scan ⇒ 被外部改过的条目变成「待重编码」', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    // fixture 的 scan.changed 含 a00000000004
    await openItem(win, 'a00000000004');

    // 没扫之前：只可能是"已编码"（不知道它被改过）—— 这正是要人点一下的原因
    await expect(win.locator('[data-state]')).toHaveAttribute('data-state', 'encoded', {
      timeout: 20_000,
    });
    await expect(win.getByText(/要一次「检查变更」才知道/)).toBeVisible();

    await win.getByRole('button', { name: '检查变更' }).click();
    await expect(win.locator('[data-state]')).toHaveAttribute('data-state', 'stale', {
      timeout: 20_000,
    });
    await expect(win.locator('[data-state]')).toHaveText('待重编码');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E9-f 未知 uid ⇒ 如实报错，不白屏（错误码要露出来）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await openItem(win, 'ffffffffffff');
    await expect(win.getByTestId('item-error')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('item-error')).toContainText(/索引/);
    // 页面骨架仍在（没白屏）。⚠️ 「语义搜索」链接有**两个**（侧栏导航 + 面包屑）⇒ 用 .first()
    await expect(win.getByRole('link', { name: '语义搜索' }).first()).toBeVisible();
  } finally {
    await app.close();
    cleanup();
  }
});

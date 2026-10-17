// apps/desktop/e2e/item-detail.spec.mjs —— E9：P3c 图片详情页（在**模拟模式**下跑真窗口）
//
// 为什么这组现在才写得出来：P3c 要"有这一条素材"才能显示，而真实库要 ONNX 模型 + 已注册索引。
// `GEMMA_FAKE=1`（契约 §8）让样例索引进到真窗口里 ⇒ 这条验收**从"只能人工"变成可复跑**。
//
// 规格出处：`SPEC.md` §4 / §3 F1（大图 / 元数据两条绝对路径 /
// 四分区动作 / 把"是否需重编码"标在按钮上）。`TASKS.md` §1（P3c）的验收：两条路径与索引状态正确显示。
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

/**
 * 诊断用：把**图片区现在到底是什么形态**原样 dump 出来（只在失败路径调用，不参与判据）。
 * 为什么需要它：E9-a 偶发失败时，"既不是兜底、也不是带 src 的 <img>"是一个**未被识别**的第三形态；
 * 不抓住它，任何"修好了"的说法都是猜（AGENTS P6 / 纪律：先取证）。
 */
async function dumpImageArea(win) {
  return win.evaluate(() => {
    const fb = document.querySelector('[data-testid="image-fallback"]');
    const img = document.querySelector('img');
    const style = fb ? getComputedStyle(fb) : null;
    return {
      hash: location.hash,
      readyState: document.readyState,
      testids: [...document.querySelectorAll('[data-testid]')]
        .map((e) => e.getAttribute('data-testid'))
        .slice(0, 40),
      imgCount: document.querySelectorAll('img').length,
      imgSrc: img ? img.getAttribute('src') : null,
      fbCount: document.querySelectorAll('[data-testid="image-fallback"]').length,
      fbBox: fb
        ? {
            w: fb.clientWidth,
            h: fb.clientHeight,
            display: style.display,
            visibility: style.visibility,
          }
        : null,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
      rootHead: (document.getElementById('root')?.innerHTML ?? '').slice(0, 1500),
    };
  });
}

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
    // ⚠️ 2026-10-16（PERF-2）：这一段原先用**单次瞬时读**决定走哪个分支 ——
    //    `await fallback.isVisible()` 不重试、立刻返回，然后另一分支**假设 <img> 还在**。
    //    那是**依赖固定时序**的判据：只要"读那一眼"的时刻偏了一点（例如 img 刚 onError 完、
    //    已经被兜底换掉，而分支已按"还没换"选了 else），`img.getAttribute` 就会等一个**不存在的**
    //    元素直到超时。详情页改成**按需 chunk** 之后多了一次 Suspense 往返，时序整体后移，
    //    这个隐患就被放大了：Lead 的冻结门禁**第一次全量 e2e 挂了 E9-a**，复跑 68/4/0、单跑 6 passed。
    //    ⇒ 抖动不是"重跑就好"，而是**判据踩了时序**。改成**等图片区进入确定的两种形态之一**（就绪标记）
    //      再分叉：要么兜底可见，要么 <img> 带 src。这样"等待"是**显式且可重试**的，不再靠读一眼。
    const fallback = win.getByTestId('image-fallback');
    let imageState = 'pending';
    let imgSrc = null;
    try {
      await expect
        .poll(
          async () => {
            // ⚠️ 2026-10-16（E2E-FLAKE-1）：**每一轮都必须"不等待"**。
            //    上面那版用 locator 读（fallback.isVisible / img.getAttribute）——
            //    locator 调用带**自动等待**：一旦 <img> 已被兜底换掉，getAttribute('src')
            //    就会为这个"不存在的元素"等满 action timeout（30 s），而 poll 自己的预算只有 20 s
            //    ⇒ **第一轮就吃光预算，"重试"从来没发生过**，判据实际仍取决于第一眼的时刻。
            //    实测（repeat-each=25，1 次失败）失败瞬间的 DOM：兜底**存在且可见**（248×15）、
            //    imgCount=0 —— 也就是"再读一次就对了"，但因为上面那个自动等待，永远读不到第二次。
            //    ⇒ 改成一次 page.evaluate 的**纯 DOM 读**（无自动等待、无 strict mode）：有界、可重试。
            const s = await win.evaluate(() => {
              const fbEl = document.querySelector('[data-testid="image-fallback"]');
              const imgEl = document.querySelector('img');
              const visible = (el) =>
                !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
              return {
                fallbackVisible: visible(fbEl),
                imgSrc: imgEl ? imgEl.getAttribute('src') : null,
              };
            });
            // ① 已经换成诚实兜底了？
            if (s.fallbackVisible) {
              imageState = 'fallback';
              imgSrc = null;
              return imageState;
            }
            // ② 还是原图、且已经拿到 src？
            if (s.imgSrc) {
              imageState = 'img';
              imgSrc = s.imgSrc;
              return imageState;
            }
            // ③ 两个都还不是 ⇒ 还没就绪，继续等（而不是就此分叉）
            imageState = 'pending';
            imgSrc = null;
            return imageState;
          },
          { timeout: 20_000, message: '图片区既没进兜底、也没出现带 src 的 <img>（未就绪）' },
        )
        .not.toBe('pending');
    } catch (e) {
      console.log('[E9-a DUMP] ' + JSON.stringify(await dumpImageArea(win)));
      throw e;
    }

    if (imageState === 'fallback') {
      await expect(fallback).toContainText(/无预览/);
      await expect(fallback).toContainText(/文件可能已不在盘上/);
    } else {
      // 用**轮询落定的那一刻**观察到的 src —— 不再重新去读一个可能已经消失的元素
      expect(imgSrc).toBe('thumb://L1/a00000000001@512');
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

/**
 * UX-1b：复制路径。
 *
 * 判据（卡面原话）：「复制路径」的验收点不是"按钮点了没报错"，而是
 * **复制进去的是绝对路径**。所以这条用 Playwright 的 Electron 主进程求值去读**真实剪贴板**
 * （`electron.clipboard.readText()`）逐字比对 —— 不是在页面上找一句"已复制"就算过。
 *
 * 用模拟模式（`launchFake`）：样例索引里的路径是固定的 `Z:\__fake_library__\...`，
 * 于是"应该是哪条绝对路径"可以写死、可复跑；真实模式下同一件事受本机盘符影响。
 */
test('E9-g ⭐ 复制路径：剪贴板里逐字等于**绝对路径**（图路径 + 包路径）', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await openItem(win, 'a00000000001');
    await expect(win.getByRole('heading', { name: 'VR-101' })).toBeVisible({ timeout: 20_000 });

    // ① 图路径
    await win.getByTestId('copy-image-path').click();
    await expect(win.locator('#toast')).toHaveText('已复制图路径');
    const copiedImage = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copiedImage, '复制进去的必须是**绝对路径**（不是相对路径、不是 thumb:// URL）').toBe(
      'Z:\\__fake_library__\\VR\\VR-101.jpg',
    );
    expect(copiedImage, '形状必须真的是绝对路径').toMatch(/^[A-Za-z]:\\/);

    // ② 包路径（两条路径是**两段不同的文本**，不许复制成同一条）
    await win.getByTestId('copy-archive-path').click();
    await expect(win.locator('#toast')).toHaveText('已复制包路径');
    const copiedArchive = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copiedArchive).toBe('Z:\\__fake_library__\\VR\\VR-101.rar');
    expect(copiedArchive).not.toBe(copiedImage);
  } finally {
    await app.close();
    cleanup();
  }
});

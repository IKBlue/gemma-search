// apps/desktop/e2e/confirm-dialog.spec.mjs —— E7：确认弹窗的 ESC / 焦点 / 取消不执行（T4 验收 #1）
//
// ── 为什么这条以前测不了，现在能测了 ──────────────────────────────────────
//   确认弹窗只在"有检索结果"时出现（结果卡上的「取件」）。而检索需要 ONNX 模型 + 已注册索引，
//   本环境跑不了（`TODO.md` B-3）⇒ 这条 T4 验收一直挂着"只能人工"。
//
//   ⭐ 破局点：**在正确的层打桩 —— 主进程的 IPC handler**（`main/index.mjs:207` 的 `ipcMain.handle(CH_INVOKE)`）。
//   在那里替换 = 只把"需要 300MB 模型的引擎"换成假的；**渲染进程侧全是真的**：
//     真 preload（contextBridge）→ 真 IPC 往返 → 真 adapter 解包 → 真 store → 真 PhotoCard → 真 ConfirmDialog → 真 Radix
//   ⇒ 于是"结果区 UI"这一整块**不再依赖模型**，可以自动化。
//
//   ⚠️ 试过但**不可行**的一条路（记下来省得再试）：替换 `window.api` —— 它是
//      `configurable:false / writable:false / frozen:true`（contextBridge 的安全加固，**是特性不是障碍**）。
//
// ── ⚠️⚠️ 两个**必须**照做的细节（都是本文件第一次跑红踩出来的）────────────────
//
//   ① **桩必须回答"启动期"的方法，不能对未知方法一律回 `{}`。**
//      第一版只懂 `search` / `collect`，其它回 `{ok:true,data:{}}` ⇒ `LibraryGate` 调 `libraryConfig`
//      拿到空 data ⇒ `decideGate()`（`utils/gate.js:26`，判据是 `data.libraries.length > 0`）判成
//      **`wizard`** ⇒ 界面显示**首启向导**、压根没有输入框 ⇒ 全部 6 条卡在 `locator.fill` 超时 30s。
//      **打桩打错形状 = 把被测应用打瘸**，症状还伪装成"选择器不对"。
//
//   ② **必须在装桩之后 `reload()`。**
//      `firstWindow()` 只等 `domcontentloaded`（`helpers/launch.mjs:58`），**React 还没挂载**；
//      于是应用的启动调用（`libraryConfig` / `indexStatus`）会**竞态**地落到桩上。reload 之后
//      应用是**对着桩**完成整个启动流程的 ⇒ 时序确定，不靠运气。
//
// ⚠️ 打桩的**边界**（别把它当成"什么都测了"）：它替换的是**引擎语义**，
//   所以被绕过的包括：zod 参数校验、1 MiB 载荷上限、真实 engine 的错误码。
//   那些由 `apps/desktop/tests/permissions.test.mjs`（13 条）与引擎单测覆盖，不在这里。
import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';
// ⚠️ 2026-10-13（P2）：桩与 `searchOnce` 原先写在本文件内部，现提取到 helper ——
//    新的 UI/UX 治理 spec 也要"有结果"的界面，照抄一份就是同一段逻辑两处存在。
//    两条踩过的坑（启动期方法形状、装桩后必须 reload）也一并搬到 helper 头部注释里。
import { FAKE_ITEM, stubEngine, stubCalls, callsOf, searchOnce } from './helpers/engine-stub.mjs';

const dialog = (win) => win.getByRole('alertdialog');

test('E7-a ⭐ 「取件」先弹确认框：不能点一下就把文件搬走', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);

    await expect(dialog(win)).toHaveCount(0); // 还没点，不该有弹窗
    await win.getByRole('button', { name: '取件' }).first().click();

    await expect(dialog(win)).toBeVisible();
    await expect(dialog(win)).toContainText('把这套素材取件？');
    await expect(dialog(win)).toContainText('VR-101'); // 文案里带的是**真实那一项**
    await expect(dialog(win).getByRole('button', { name: '取件' })).toBeVisible();
    await expect(dialog(win).getByRole('button', { name: '取消' })).toBeVisible();

    // 关键：弹窗出现**不等于**已执行 —— 此刻一个 collect 都不能发
    expect(callsOf(await stubCalls(app), 'collect'), '弹窗弹出时不该发 collect').toEqual([]);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E7-b ⭐ 焦点被**捕获在弹窗内**，且 Tab 不会跑到背后的页面（焦点陷阱）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);
    await win.getByRole('button', { name: '取件' }).first().click();
    await expect(dialog(win)).toBeVisible();

    const focusInDialog = () =>
      win.evaluate(() => {
        const el = document.activeElement;
        const dlg = document.querySelector('[role="alertdialog"]');
        return {
          inDialog: !!dlg && !!el && dlg.contains(el),
          text: (el && (el.textContent || '').trim()) || '',
          tag: el ? el.tagName : null,
        };
      });

    // ① 打开后焦点**立刻**落进弹窗（不能留在背景按钮上）
    await expect.poll(async () => (await focusInDialog()).inDialog, { timeout: 5_000 }).toBe(true);
    const first = await focusInDialog();
    console.log('  [E7-b] 打开后焦点落在:', first.tag, JSON.stringify(first.text));

    // ② 连按 Tab 一圈，焦点始终在弹窗内（陷阱生效）
    for (let i = 0; i < 6; i++) {
      await win.keyboard.press('Tab');
      const st = await focusInDialog();
      expect(st.inDialog, `第 ${i + 1} 次 Tab 后焦点跑出弹窗了：${JSON.stringify(st)}`).toBe(true);
    }
    console.log('  [E7-b] 连按 6 次 Tab，焦点始终在弹窗内 ✅');
  } finally {
    await app.close();
    cleanup();
  }
});

test('E7-c ⭐ ESC 关闭弹窗，且**动作未执行**（collect 一个都没发）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);
    await win.getByRole('button', { name: '取件' }).first().click();
    await expect(dialog(win)).toBeVisible();

    await win.keyboard.press('Escape');
    await expect(dialog(win)).toHaveCount(0); // ESC 真的关了
    await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible(); // 回到结果页

    expect(callsOf(await stubCalls(app), 'collect'), 'ESC 之后不许有任何 collect').toEqual([]);
  } finally {
    await app.close();
    cleanup();
  }
});

test('E7-d ⭐ 点「取消」同样不执行；且焦点**归还**给触发它的那个按钮', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);
    const trigger = win.getByRole('button', { name: '取件' }).first();
    await trigger.click();
    await expect(dialog(win)).toBeVisible();

    await dialog(win).getByRole('button', { name: '取消' }).click();
    await expect(dialog(win)).toHaveCount(0);
    expect(callsOf(await stubCalls(app), 'collect')).toEqual([]);

    // 焦点归还（无障碍：关掉弹窗后不该把焦点丢在 document.body 上）
    //
    // ⚠️⚠️ **必须轮询"稳定后"的状态，不能同步读一次**（2026-10-13 双向/全量实测的教训）：
    //   组件侧的归还用了 `requestAnimationFrame` **下一帧复核**（负载下聚焦会被紧随其后的
    //   重渲染打断，见 `ui/ConfirmDialog.jsx` 的注释）。而这个断言原先是在弹窗消失后
    //   **同步**读 `document.activeElement` —— 它和组件自己的 rAF **在赛跑**：
    //   全量（62 条、比单跑重）时 rAF 还没跑就断言了 ⇒ 读到 `BODY` ⇒ 间歇失败。
    //   ⇒ 这不是"应用行为不对"，是**断言时机不对**：应当观察**收敛后**的焦点。
    //   `expect.poll` 会在超时内反复取，正好对应"下一帧复核"这个语义。
    await expect
      .poll(
        async () =>
          win.evaluate(() => {
            const el = document.activeElement;
            return {
              tag: el ? el.tagName : null,
              text: (el && (el.textContent || '').trim()) || '',
            };
          }),
        { timeout: 5_000, message: '关掉弹窗后焦点应归还给触发它的那个「取件」按钮' },
      )
      .toMatchObject({ tag: 'BUTTON', text: '取件' });
  } finally {
    await app.close();
    cleanup();
  }
});

test('E7-e ⭐ 确认才执行：collect 恰好一次，且参数是那一项', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);
    await win.getByRole('button', { name: '取件' }).first().click();
    await expect(dialog(win)).toBeVisible();

    await dialog(win).getByRole('button', { name: '取件' }).click();
    await expect(dialog(win)).toHaveCount(0);

    const collects = callsOf(await stubCalls(app), 'collect');
    expect(collects.length, '确认后应当**恰好**发一次 collect').toBe(1);
    expect(collects[0].params).toEqual({ libId: 'L1', uids: ['aaa111aaa111'] });
  } finally {
    await app.close();
    cleanup();
  }
});

test('E7-f 连点两次确认只发一次 collect（先清状态再执行）', async () => {
  const { app, cleanup } = await launchWithLibrary();
  try {
    const win = await firstWindow(app);
    await searchOnce(app, win);
    await win.getByRole('button', { name: '取件' }).first().click();
    await expect(dialog(win)).toBeVisible();

    const confirm = dialog(win).getByRole('button', { name: '取件' });
    // ⚠️ 不要用 `Promise.all([click(), click()])` —— 第一次点击后就地卸载按钮，
    //    Playwright 会卡在对第二个 locator 的稳定性等待上（实测超时 30s）。
    //    改成在**页面内同步连点两次**：这是真正的"连点"，绕开 Playwright 的元素生命周期等待。
    await confirm.evaluate((el) => {
      el.click();
      el.click();
    });

    await expect(dialog(win)).toHaveCount(0);
    await win.waitForTimeout(500);

    expect(callsOf(await stubCalls(app), 'collect').length, '连点两次只该发一次').toBe(1);
  } finally {
    await app.close();
    cleanup();
  }
});

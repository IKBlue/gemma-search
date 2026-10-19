// apps/desktop/e2e/helpers/engine-stub.mjs —— 「把**引擎**换掉」的公共桩
//
// ── 为什么提到 helper 里（2026-10-13，P2）──────────────────────────────────
//   这套桩原先**写在 `confirm-dialog.spec.mjs` 内部**。UI/UX 治理要加新的真窗口断言
//   （V-01 侧栏当前页、V-28 结果卡进详情），同样需要"有结果"的界面 ⇒
//   照抄一遍就是**同一段逻辑出现在两处**（`AGENTS.md` §0.1 P2 明令禁止）。
//   ⇒ 提取到这里，两个 spec 共用一份。
//
// ── 桩的**边界**（别把它当成"什么都测了"，两处 spec 都引这段）──────────────
//   它替换的是**引擎语义** ⇒ 被绕过的包括：zod 参数校验、1 MiB 载荷上限、真实 engine 的错误码。
//   那些由 `apps/desktop/tests/permissions.test.mjs` 与引擎单测覆盖，**不在这里**。
//
// ── 两条踩过的坑（写在 helper 里，新的 spec 自动继承）─────────────────────
//   ① **必须覆盖启动期方法**（`libraryList` / `indexStatus`），且形状要对 ——
//      漏了或形状错了，门禁会把界面判成"没有库"⇒ 显示**首启向导**、压根没有搜索框，
//      症状伪装成"选择器不对"、全部用例卡在 `locator.fill` 超时 30s。
//   ② **装桩之后必须 `reload()`** —— `firstWindow()` 只等 `domcontentloaded`，React 还没挂载；
//      于是启动调用会**竞态**地落到桩上。reload 之后应用是**对着桩**完成启动的 ⇒ 时序确定。
import { expect } from '@playwright/test';

/** 一条假的素材结果（字段与 `search/PhotoCard.jsx` 实际读的一致） */
export const FAKE_ITEM = {
  libId: 'L1',
  uid: 'aaa111aaa111',
  stem: 'VR-101',
  relPath: 'VR/VR-101.jpg',
  folder: 'VR',
  score: 0.81,
  band: 'mid',
  imagePath: 'X:\\fake\\VR-101.jpg',
  archive: { name: 'VR-101.rar', ext: '.rar', size: 12345678 },
};

/** 装桩：把 `engine:invoke` 换成内存实现，并记录每次调用供断言 */
export async function stubEngine(app) {
  await app.evaluate(({ ipcMain }, item) => {
    const CH = 'engine:invoke';
    const stub = { calls: [] };
    globalThis.__engineStub = stub;
    ipcMain.removeHandler(CH);
    ipcMain.handle(CH, async (_event, payload) => {
      const method = payload && payload.method;
      const params = payload && payload.params;
      stub.calls.push({ method, params });
      const ok = (data) => ({ ok: true, warnings: [], data });

      switch (method) {
        // ── 启动期：这两个决定"显示向导还是应用"
        // ⚠️ S6（2026-10-15）：方法名从 libraryConfig 改成 **libraryList**（基线 §2.2，删旧名不留两套）。
        //    桩必须跟着改：名字不对，界面启动就判成 wizard（"找不到 #query"那种症状）。
        case 'libraryList':
          return ok({
            libraries: [{ libId: 'L1', root: 'X:\\fake' }],
            chosen: 'env',
            warnings: [],
            diagnostics: [],
          });
        case 'indexStatus':
          return ok({
            libs: [
              { libId: 'L1', root: 'X:\\fake', dim: 768, indexed: 2, encoded: 2, healthy: true },
            ],
          });
        case 'search':
          return ok({
            tookMs: 12,
            libsUsed: ['L1'],
            libsSkipped: [],
            results: [
              item,
              {
                ...item,
                uid: 'bbb222bbb222',
                stem: 'CR-202',
                relPath: 'CR/CR-202.jpg',
                folder: 'CR',
                score: 0.77,
                archive: null,
              },
            ],
          });
        case 'collect':
          return ok({ succeeded: params.uids, skipped: [], failed: [], targetDir: 'E:\\素材待用' });
        default:
          return ok({});
      }
    });
  }, FAKE_ITEM);
}

export const stubCalls = (app) => app.evaluate(() => globalThis.__engineStub.calls);
export const callsOf = (calls, method) => calls.filter((c) => c.method === method);

/** 把界面推到"有结果"状态：装桩 → reload（消除竞态）→ 等真界面 → 输入 → 回车 */
export async function searchOnce(app, win) {
  await stubEngine(app);
  await win.reload();
  // 等到"真界面"起来（有库 ⇒ 搜索页；Chip 是搜索页独有的）
  await expect(win.getByRole('button', { name: 'VR', exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const input = win.locator('#query');
  // PRD-1：默认是本地检索 L0（localSearch）；桩引擎只会应答 `search` ⇒ 先显式切「智能检索」。
  await win.getByRole('button', { name: '智能检索' }).click();
  await input.fill('吊灯');
  await input.press('Enter');

  await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible({ timeout: 20_000 });
}

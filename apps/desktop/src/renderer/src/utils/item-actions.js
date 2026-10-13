// utils/item-actions.js —— 图片详情页的**动作四分区**（Operation 层，纯函数）
//
// ── 规格出处 ──────────────────────────────────────────────────────────
//   `docs/design/UI-REVIEW-and-migration.md:236`：
//     「动作分区：**取件** / **维护（复用向量）** / **维护（需重编码，须提示）** / **危险区**」
//   `:237`：「关键：把"**是否需要重编码**"直接标在按钮上（改目录/改ID 不重编码；换图/外部变更 要重编码）
//            ——这是本应用独有的判断，别让人猜」
//   `DESIGN-app-details.md:489` §7.4 逐操作列了"是否需重编码"。
//
// ── 为什么是纯函数、放在 Operation 层 ─────────────────────────────────────
//   ① `.jsx` 在 `node:test` 里加载不了 ⇒ 分区判断塞进组件就等于放弃自动化（本项目反复栽过）；
//   ② "这个动作要不要重编码"是**领域判断**，不是渲染细节（`AGENTS.md` §0.1：UI 层不写业务规则）。
//
// ── ⚠️ 与契约的关系（一条可检查的事实，不是口号）──────────────────────────
//   `mutate` 的 `op` 白名单（`shared/ipc.ts`）只有五个：
//     `rename · moveFolder · reattachArchive · moveOutOfLibrary · undo`
//   ⇒ UI 规格里的「替换预览图」（要重编码）**契约里没有对应方法**。
//   本文件照规格**把按钮画出来**（因为"是否需要重编码"正是要让人看见的判断），
//   但对没有后端方法的动作标 `op: null` + **如实的 `unavailableReason`**。
//   `apps/desktop/tests/item-actions.test.mjs` 的 **A3** 会拿 `ipc.ts` 的 op 白名单来核对这条，
//   避免"文档说没做、其实已经做了"或反过来 —— 那种漂移只能靠可执行的断言拦住。
import { INDEX_STATES } from './index-state.js';

/** 四个分区（顺序即界面上的顺序；文案只在这里写一份） */
export const ACTION_GROUPS = Object.freeze([
  Object.freeze({ key: 'take', title: '取件', note: '复制到取件目录；不移动、不删除库内文件' }),
  Object.freeze({ key: 'reuse', title: '维护（复用向量）', note: '只改路径与配对，不重新编码' }),
  Object.freeze({ key: 'reencode', title: '维护（需重编码，须提示）', note: '会重新编码这一条的向量 —— 慢' }),
  Object.freeze({ key: 'danger', title: '危险区', note: '把素材移出素材库（进事务日志，可撤销）' }),
]);

/**
 * 按当前条目算出可显示的动作。
 *
 * @param {{item: object|null, indexState?: object|null}} o
 * @returns {Array<{id:string, group:string, label:string, needsReencode:boolean,
 *                  op:string|null, disabled:boolean, reason:string|null}>}
 */
export function buildItemActions({ item, indexState = null } = {}) {
  const onDisk = Boolean(item) && !(item.exists && item.exists.image === false);
  const hasArchive = Boolean(item && item.archive);
  const state = indexState || (item ? INDEX_STATES.encoded : INDEX_STATES.pending);
  const gone = state.key === 'removed';

  /** 小工具：把"为什么不能点"写成一句话（不能点时 `reason` 必须非空，测试会查） */
  const off = (cond, reason) => (cond ? { disabled: false, reason: null } : { disabled: true, reason });

  return [
    {
      id: 'collect', group: 'take', label: '取件', needsReencode: false, op: 'collect', unavailable: null,
      ...off(onDisk, '文件不在盘上（已从索引移除）'),
    },
    {
      id: 'rename', group: 'reuse', label: '改 ID', needsReencode: false, op: 'mutate:rename', unavailable: null,
      ...off(onDisk, '文件不在盘上'),
    },
    {
      id: 'moveFolder', group: 'reuse', label: '改分类', needsReencode: false, op: 'mutate:moveFolder', unavailable: null,
      ...off(onDisk, '文件不在盘上'),
    },
    {
      id: 'reattachArchive', group: 'reuse', label: '重新配对压缩包', needsReencode: false, op: 'mutate:reattachArchive', unavailable: null,
      // ⚠️ 两个条件都要：盘上得在，**且**确实有个包可配。
      //    第一版只判 `hasArchive` ⇒ 条目已从盘上消失（exists.image=false，`archive` 对象还在）时
      //    按钮仍可点 —— 测试 IA2e 当场抓到。理由也要分清是哪一个。
      ...off(onDisk && hasArchive, onDisk ? '这条没有同名压缩包，无需配对' : '文件不在盘上'),
    },
    {
      // ⚠️ 契约里**没有**对应方法（`mutate` 的 op 白名单里没有它）⇒ `op: null` + 如实说明。
      //    按钮照规格画出来，是因为"是否需要重编码"正是要让人看见的判断（UI-REVIEW:237）。
      id: 'replaceImage', group: 'reencode', label: '替换预览图', needsReencode: true,
      op: null, unavailable: 'contract-no-method',
      ...off(false, '契约里还没有这个方法（P4/P5）—— 现在点不动，不是坏了'),
    },
    {
      // ⚠️⚠️ 这里我**第一版写错了**：给它标了 `op: 'indexStart'`。那会让按钮看起来能用，
      //    而 `indexStart` 是**整库重建** —— 按钮却写着"重新编码**这一条**"。那是误导。
      //    事实：契约里只有整库 `indexStart`，**没有"只重建一条"的方法**（P4 增量索引）。
      //    ⇒ `op: null` + 永远禁用；但**仍然**带「需重编码」角标 —— 需要与否是领域判断，
      //      能不能点是后端能力，两件事必须分开表达（`needsReencode` vs `disabled`）。
      id: 'reencode', group: 'reencode', label: '重新编码这一条', needsReencode: true,
      op: null, unavailable: 'contract-no-method',
      ...off(false, state.key === 'stale'
        ? '需要重编码：但当前只有「整库重建」，没有「只重建这一条」的方法（P4 增量索引未实现）'
        : `当前不需要：索引状态是「${state.label}」`),
    },
    {
      id: 'moveOutOfLibrary', group: 'danger', label: '移出素材库', needsReencode: false, op: 'mutate:moveOutOfLibrary', unavailable: null,
      ...off(onDisk && !gone, '文件不在盘上，没有可移出的东西'),
    },
  ];
}

/**
 * 把动作按四个分区摆好（**空分区也会出现** —— 分区本身是规格的一部分，
 * 少一个分区会让人以为"这个应用没有那类操作"）。
 */
export function groupActions(actions = []) {
  return ACTION_GROUPS.map((g) => ({
    ...g,
    actions: actions.filter((a) => a.group === g.key),
  }));
}

/** 给按钮加"是否需重编码"的角标文案（规格要求**标在按钮上**，不是写在说明里） */
export function reencodeBadge(action) {
  return action.needsReencode ? '需重编码' : '不重编码';
}

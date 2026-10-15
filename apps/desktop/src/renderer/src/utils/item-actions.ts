// utils/item-actions.ts —— 图片详情页的**动作四分区**（Operation 层，纯函数）
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
//   ② "这个动作要不要重编码"是**领域判断**，不是渲染细节（`AGENTS.md` §2：UI 层不写业务规则）。
//
// ── ⚠️ 与契约的关系（一条可检查的事实，不是口号）──────────────────────────
//   `mutate` 的 `op` 白名单（`shared/ipc.ts`）只有五个：
//     `rename · moveFolder · reattachArchive · moveOutOfLibrary · undo`
//   ⇒ UI 规格里的「替换预览图」（要重编码）**契约里没有对应方法**。
//   本文件照规格**把按钮画出来**（因为"是否需要重编码"正是要让人看见的判断），
//   但对没有后端方法的动作标 `op: null` + **如实的 `unavailableReason`**。
//   `apps/desktop/tests/item-actions.test.mjs` 的 **A3** 会拿 `ipc.ts` 的 op 白名单来核对这条，
//   避免"文档说没做、其实已经做了"或反过来 —— 那种漂移只能靠可执行的断言拦住。
import { INDEX_STATES, type IndexState } from './index-state.ts';

/** 四个分区（顺序即界面上的顺序；文案只在这里写一份） */
export const ACTION_GROUPS = Object.freeze([
  Object.freeze({ key: 'take', title: '取件', note: '复制到取件目录；不移动、不删除库内文件' }),
  Object.freeze({ key: 'reuse', title: '维护（复用向量）', note: '只改路径与配对，不重新编码' }),
  Object.freeze({ key: 'reencode', title: '维护（需重编码，须提示）', note: '会重新编码这一条的向量 —— 慢' }),
  Object.freeze({ key: 'danger', title: '危险区', note: '把素材移出素材库（进事务日志，可撤销）' }),
]);

/** 一个分区（`ACTION_GROUPS` 的元素形状） */
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/**
 * 一条可显示的动作。
 *
 * ⚠️ `needsReencode`（领域判断：这件事要不要重编码）与 `disabled`（后端能力：现在能不能点）
 *   是**两件事**，必须分开表达 —— 见 inferno 那两条注释。
 */
export type ItemAction = {
  id: string
  group: string
  label: string
  needsReencode: boolean
  op: string | null
  unavailable: string | null
  disabled: boolean
  reason: string | null
};

/** `item` 方法 data 里**本文件用得到**的那部分 */
export type ActionItem = {
  exists?: { image?: boolean; archive?: boolean } | null
  archive?: unknown
} | null | undefined;

/**
 * 按当前条目算出可显示的动作。
 */
export function buildItemActions({ item = null, indexState = null }: { item?: ActionItem; indexState?: IndexState | null } = {}): ItemAction[] {
  // 与旧写法 `Boolean(item) && !(item.exists …)` 等价（item 只可能是对象/null/undefined）
  const onDisk = item ? !(item.exists && item.exists.image === false) : false;
  const hasArchive = Boolean(item && item.archive);
  const state: IndexState = indexState || (item ? INDEX_STATES.encoded : INDEX_STATES.pending);
  const gone = state.key === 'removed';

  /** 小工具：把"为什么不能点"写成一句话（不能点时 `reason` 必须非空，测试会查） */
  const off = (cond: boolean, reason: string | null): { disabled: boolean; reason: string | null } =>
    (cond ? { disabled: false, reason: null } : { disabled: true, reason });

  return [
    {
      id: 'collect', group: 'take', label: '取件', needsReencode: false, op: 'collect', unavailable: null,
      ...off(onDisk, '文件不在盘上（已从索引移除）'),
    },
    {
      // ⚠️ S6（2026-10-15）：`mutate` 已从契约删除（它写的**意图层标注表**本轮没建）
      //    ⇒ 不再冒充"能改"：op=null + 永远禁用 + 一句说明（与 replaceImage / reencode 同一形态）。
      id: 'rename', group: 'reuse', label: '改 ID', needsReencode: false,
      op: null, unavailable: 'contract-no-method',
      ...off(false, '该功能等对应的数据表上线（契约里的 mutate 已按绿地口径删除）'),
    },
    {
      id: 'moveFolder', group: 'reuse', label: '改分类', needsReencode: false,
      op: null, unavailable: 'contract-no-method',
      ...off(false, '该功能等对应的数据表上线（契约里的 mutate 已按绿地口径删除）'),
    },
    {
      id: 'reattachArchive', group: 'reuse', label: '重新配对压缩包', needsReencode: false,
      op: null, unavailable: 'contract-no-method',
      // 历史：这里原先按"盘上在 + 确实有包可配"决定是否可点（IA2e 抓到过第一版的漏判）；
      // 现在 `mutate` 已从契约删除 ⇒ 与上面三条同样只报"等对应的表上线"，不再按领域条件装作可点。
      ...off(false, '该功能等对应的数据表上线（契约里的 mutate 已按绿地口径删除）'),
    },
    {
      // ⚠️ 契约里**没有**对应方法（S6 之后连 `mutate` 本身也删了）⇒ `op: null` + 如实说明。
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
      id: 'moveOutOfLibrary', group: 'danger', label: '移出素材库', needsReencode: false,
      op: null, unavailable: 'contract-no-method',
      ...off(false, '该功能等对应的数据表上线（契约里的 mutate 已按绿地口径删除）'),
    },
  ];
}

/**
 * 把动作按四个分区摆好（**空分区也会出现** —— 分区本身是规格的一部分，
 * 少一个分区会让人以为"这个应用没有那类操作"）。
 */
export function groupActions(actions: ItemAction[] = []): Array<ActionGroup & { actions: ItemAction[] }> {
  return ACTION_GROUPS.map((g) => ({
    ...g,
    actions: actions.filter((a) => a.group === g.key),
  }));
}

/** 给按钮加"是否需重编码"的角标文案（规格要求**标在按钮上**，不是写在说明里） */
export function reencodeBadge(action: ItemAction): string {
  return action.needsReencode ? '需重编码' : '不重编码';
}

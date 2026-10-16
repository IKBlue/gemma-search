// utils/index-state.ts —— 「这条素材的索引状态」四档（Operation 层，纯函数）
//
// ── 为什么是**派生**的，而不是引擎字段 ────────────────────────────────────
//   `SPEC.md` §4 要求每条标「已编码 / 待编码 / 待重编码 / 已从索引移除」。
//   我第一版把它做成引擎 `item` 的字段 —— **那是错的**，理由两条：
//     ① 真实引擎的 `item`（`packages/engine/src/engine.ts:427+`）**没有**这个字段。
//        在 fake 里造一个 ⇒ 页面"模拟模式能跑、真库上拿到 `undefined`"（最坏的假绿）。
//        `packages/engine/tests/fake.test.mjs` 的 **F12** 就是钉这条的。
//     ② 判「待重编码」必须知道"文件被外部改过"，那要一次**差分扫描**（`scan`）；
//        每次看详情都扫一遍全库是不可接受的。
//   ⇒ 状态由**已有信息**派生：`item.exists`（权威）+ 可选的 `scan` 差异。
//
// ── 判定顺序（顺序是有意的，别调）────────────────────────────────────────
//   `removed` 优先于一切：索引里有、盘上没了 —— 这时"待重编码"毫无意义。
// ⚠️ 没有归 Operation 层的 UI 分支判断（`AGENTS.md` §2 四层架构）。

/** 四档的定义（文案与语气色只在这里写一份） */
export const INDEX_STATES = Object.freeze({
  encoded: Object.freeze({
    key: 'encoded',
    label: '已编码',
    tone: 'ok',
    hint: '向量可用，可参与语义检索',
  }),
  pending: Object.freeze({
    key: 'pending',
    label: '待编码',
    tone: 'warn',
    hint: '已发现但还没编码 —— 尚不能参与检索',
  }),
  stale: Object.freeze({
    key: 'stale',
    label: '待重编码',
    tone: 'warn',
    hint: '文件被外部改过（size/mtime 变了），当前向量与内容已不对应',
  }),
  removed: Object.freeze({
    key: 'removed',
    label: '已从索引移除',
    tone: 'err',
    hint: '索引里有、磁盘上已找不到 —— 定位/取件都会失败',
  }),
});

/** 四档之一：`{key,label,tone,hint}`。组件只吃这个形状，不自己造文案 */
export type IndexState = (typeof INDEX_STATES)[keyof typeof INDEX_STATES];

/** `item` 方法 data 里**本文件用得到**的那部分（其余字段与本判定无关） */
export type IndexStateItem =
  | {
      uid?: string;
      exists?: { image?: boolean; archive?: boolean } | null;
    }
  | null
  | undefined;

/** 一次 `scan` 的差异（可选；没扫过就是 `null` —— 不自动扫，见 `needsScanToDecide`） */
export type ScanDiff = {
  changed?: string[];
  missing?: string[];
  added?: string[];
} | null;

/**
 * @param item `item` 方法的 data
 * @param scanDiff 一次 `scan` 的结果（可选）
 */
export function deriveIndexState(item: IndexStateItem, scanDiff: ScanDiff = null): IndexState {
  if (!item) return INDEX_STATES.pending;
  const uid = item.uid;
  const changed = new Set((scanDiff && scanDiff.changed) || []);
  const missing = new Set((scanDiff && scanDiff.missing) || []);
  const added = new Set((scanDiff && scanDiff.added) || []);

  // ① 盘上没了 —— 权威判据是 `exists`；`scan.missing` 是同义补充（两者不一致时以 exists 为准，
  //    因为它是每次 `item` 调用**当场** existsSync 出来的，比一次可能过期的扫描新）
  if (item.exists && item.exists.image === false) return INDEX_STATES.removed;
  if (uid && missing.has(uid)) return INDEX_STATES.removed;

  // ② 外部改过（只有扫描过才知道）
  if (uid && changed.has(uid)) return INDEX_STATES.stale;

  // ③ 已发现未编码（对"已在索引里的 uid"其实到不了这里；留着是为了 added 有 uid 的情形）
  if (uid && added.has(uid)) return INDEX_STATES.pending;

  return INDEX_STATES.encoded;
}

/**
 * 需要一次差分扫描才能判的档位 —— 界面据此决定要不要提示「检查变更」。
 * 刻意**不自动扫**：全库 stat 一遍是重活，且用户没要求时不该发生（**既有设计态度**：
 * 对"变更"的态度就是不自动动它）。
 */
export function needsScanToDecide(item: IndexStateItem): boolean {
  // 与旧写法 `Boolean(item) && !(item.exists …)` 等价（item 只可能是对象/null/undefined），
  // 写成早返回是为了让类型收窄，而不是加一次判断。
  if (!item) return false;
  return !(item.exists && item.exists.image === false);
}

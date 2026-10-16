// apps/desktop/src/main/db/schema-layers.ts —— 已建表的**四层分类**（唯一来源 · 当前 7 张）
//
// 提案（prototypes/PROPOSAL-schema-v1.html v1.2）自己的规矩：
//   **迁移建出的每一张表都必须在四组里被点名，忘分类就测试变红。**
//
// 2026-10-15 · S1b（**所有者裁定 B** · TASKS §4 U19）：**不一次建齐 20 张，只建 6 张**，
//   其余随功能上线。**2026-10-16 · B2-1**：`job`（任务台账）进 **过程层** ⇒ 现在 7 张：
//     事实 2（asset · asset_file）· 过程 2（asset_index_state · **job**）· 意图 **0** · 应用 3（app_meta · library_registry · collect_dir）。
//
// ⚠️ **空层是允许的**（intent 现在就是空的）—— 这一层一张表都没有，不代表这一层不存在。
//   保留四组的意义在于**第二批**：新表一进 DDL，`db-schema.test.mjs` 的
//   "每张建出的表都必须在四组里被点名"就失败，逼着加表的人当场分类
//   （临时删一条分类 ⇒ 立刻变红，当时实测过）。
//   这正是"只留 6 张"不丢能力的原因：机制在，分类在，只是表少了。
//
// 四层 = **持久性语义**（丢了要不要重建），不是物理文件：
//   · fact    事实层：可从素材/索引**重建**（丢掉可接受）
//   · process 过程层：尽量留（重建一次不至于让用户误解历史）
//   · intent  意图层：**必须留**（用户自己做的标注、集合、标签 —— 本轮还没有表）
//   · app     应用层：不参与库级重建（跨库的配置与用户行为 + 全局安全边界）
//
// ⚠️ 物理落点与层**一一对应**（被测试钉住）：
//   库级 `.gs.db` = fact ∪ process ∪ intent（现在 4 张）；应用级 `app.db` = app（3 张）。
//   所以下面四组同时充当：① "每张表归类到哪一层"；② "每张表落在哪个库文件"的唯一来源。
//
// 落点裁定（2026-10-15 Lead/所有者）：
//   · `collect_dir` 归**应用级**：取件白名单是**全局安全边界**（SPEC F1），
//     放库级等于"某个库的数据决定往哪写"，也不该由每个库各定义一份；
//   · `recent_view` 等 14 张**本轮不建**（原"对调"方案已被 B 取代，它直接进第二批）。

/** 四层的名字（顺序 = 展示/遍历顺序：事实 → 过程 → 意图 → 应用） */
export type SchemaLayer = 'fact' | 'process' | 'intent' | 'app';

export const SCHEMA_LAYER_ORDER: readonly SchemaLayer[] = Object.freeze([
  'fact',
  'process',
  'intent',
  'app',
]);

/**
 * 四组点名（**唯一来源**）。数组内顺序无特殊含义（表清单断言会排序）。
 * 空数组是**合法**的（intent 本轮为空）—— 见文件头"空层是允许的"。
 */
export const SCHEMA_LAYERS: Readonly<Record<SchemaLayer, readonly string[]>> = Object.freeze({
  /** 事实层：条目 + 两个文件角色 —— 全部可从素材重建 */
  fact: Object.freeze(['asset', 'asset_file']),

  /** 过程层：编码状态 + **任务台账** —— 尽量留，丢了能重算（任务历史丢了不至于让用户误解数据） */
  process: Object.freeze(['asset_index_state', 'job']),

  /** 意图层：用户自己做的（评分/备注/收藏/标签/集合/导出历史）—— 本轮一张都还没建 */
  intent: Object.freeze([]),

  /** 应用层：跨库的配置与全局安全边界（不参与库级重建） */
  app: Object.freeze(['app_meta', 'library_registry', 'collect_dir']),
});

/** 一层里的表名（副本，防调用方改到常量；空层返回空数组） */
export function tablesInLayer(layer: SchemaLayer): string[] {
  return [...SCHEMA_LAYERS[layer]];
}

/** 四组并集（排序去重）——"迁移建出的每张表都在四组里被点名"的右侧 */
export function schemaTables(): string[] {
  const out: string[] = [];
  for (const layer of SCHEMA_LAYER_ORDER) out.push(...SCHEMA_LAYERS[layer]);
  return [...new Set(out)].sort();
}

/** 落在**库级** `.gs.db` 里的表 = 事实 ∪ 过程 ∪ 意图 */
export function libraryLayerTables(): string[] {
  return [
    ...new Set([...SCHEMA_LAYERS.fact, ...SCHEMA_LAYERS.process, ...SCHEMA_LAYERS.intent]),
  ].sort();
}

/** 落在**应用级** `app.db` 里的表 = 应用层 */
export function appLayerTables(): string[] {
  return [...SCHEMA_LAYERS.app].sort();
}

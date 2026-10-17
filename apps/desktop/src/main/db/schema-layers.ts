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
  /**
   * 事实层：条目 + 两个文件角色 + **文件名全文索引** —— 全部可从素材重建
   * （`asset_name_fts` 是 FTS5 **虚拟表**：丢了重建一遍就有；重建路径见 migrations.ts 的 T_SEARCH 说明）
   */
  fact: Object.freeze(['asset', 'asset_file', 'asset_name_fts']),

  /**
   * 过程层：编码状态 + **任务台账** + **体检台账** + **续看** —— 尽量留，丢了能重算
   * （体检历史丢了 = 少一份对账依据；续看丢了 = 少一份便利，都不至于让用户误解数据；
   *   `health_run` 通过 `job_id` 关联 `job`，不复制进度字段 —— 见 migrations.ts 的 T_HEALTH 说明；
   *   `recent_view` 归这里：它是"**某个库里**最近看过什么"，**属于那个库** ⇒ 库级。
   *   ⚠️ B2-5FIX：`recent_query` **不在这里**（原来放错了）—— 它记的是**跨库**检索历史
   *   （`scope_lib_id` 为 NULL = 全部库），`SPEC.md:173` 把它列在**应用级** ⇒ 已挪到下面的 app 层。）
   */
  process: Object.freeze([
    'asset_index_state',
    'job',
    'health_run',
    'health_finding',
    'recent_view',
  ]),

  /**
   * 意图层：用户自己做的（评分 · 备注 · 收藏 · 标签 · 集合 · 导出历史）—— **必须留**，丢了没法重算。
   * 六张表落在这里（都**先核对了基线**四层分类表 `README.md:33` + `SPEC.md:172`「库级·意图」）：
   *   · `asset_export`（B2-2）= 「我在什么时候把哪一条导出到了哪个目录」；
   *   · `asset_user_meta`（B2-3）= 条目的**评分/备注/收藏**（**1:1**，`uid` 就是主键）；
   *   · `tag` + `asset_tag`（B2-7a）= **标签**（横切组织，复合主键 `(uid, tag_id)`，**无序**）；
   *   · `collection` + `collection_item`（B2-7b）= **集合**（有序分组，复合主键 `(collection_id, uid)`，
   *     **有序**：成员位置由 `added_at_ms` + `uid` 平局裁决决定 —— 这是与标签**唯一**的实质差别）。
   * 它们都是**用户做过的事**，重建元数据绝不能抹掉（对比过程层的定义"丢了能重算"：编码状态、体检台账）。
   * ⚠️ 标签**不并进** `asset_user_meta`：一个是"单条上的一个布尔"，一个是"多对多的组织" ——
   *   合并会让收藏的"取消/历史"变成删行（详见 `migrations.ts` 的 T_TAG 说明与测试 T5/T7）。
   * ⚠️ 标签与集合**基数相同、顺序语义不同**（别用"一个 N:M、一个 1:N"糊过去）——
   *   详见 `migrations.ts` 的 T_COLLECTION 说明与 `collection.test.mjs` 的 C3。
   */
  intent: Object.freeze([
    'asset_export',
    'asset_user_meta',
    'tag',
    'asset_tag',
    'collection',
    'collection_item',
  ]),

  /**
   * 应用层：跨库的配置与全局安全边界（不参与库级重建）
   * · `app_setting`（B2-6）：应用设置 —— `SPEC.md:173` 与基线四层表（`README.md:34`）都列在**应用级**；
   * · `activity`（B2-8）：操作记录 —— `SPEC.md:173` 列在**应用级**，且基线 `SPEC-COMPACT.md:197` 明说
   *   「`asset_export.batch_id` 复用 `activity.activity_id`，**不能建外键 —— activity 在应用级 DB**」
   *   （这一句只有把 activity 放 `app.db` 才自洽）。⚠️ `README.md:32` 把 activity 归"过程层"是**按层语义**分的，
   *   与本仓"层 == 物理文件"的规则冲突 ⇒ **以 SPEC 为准**（AGENTS §0），落在应用层。
   */
  app: Object.freeze([
    'app_meta',
    'library_registry',
    'collect_dir',
    'app_setting',
    'activity',
    // B2-5FIX：`recent_query` 从**库级/过程层**挪到这里 —— `SPEC.md:173` 把它列在应用级
    //   （它记的是**跨库**检索历史，`scope_lib_id` 为 NULL = 全部库 ⇒ 不属于某一个库）。
    //   库级那张旧表由库级链 **v7** 删掉（不搬运）；全仓只有这一张。
    'recent_query',
  ]),
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

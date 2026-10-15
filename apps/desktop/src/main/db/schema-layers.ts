// apps/desktop/src/main/db/schema-layers.ts —— 20 张表的**四层分类**（唯一来源）
//
// 提案（prototypes/PROPOSAL-schema-v1.html v1.2）自己的规矩：
//   **迁移建出的每一张表都必须在四组里被点名，忘分类就测试变红。**
// 而提案正文里表数出现过三个数（4/12 · 18 · 20），逐表分类节又和分组节对不上
//   ⇒ 本文件按 reports/2026-10-15-schema-diff/README.md §1 的**逐表分类节**定死，
//     并落实 Lead 的五条修正（表数 20 = 应用级 6 + 库级 14）。
//
// 四层 = **持久性语义**（丢了要不要重建），不是物理文件：
//   · fact    事实层：可从素材/索引**重建**（丢掉可接受）
//   · process 过程层：尽量留（重建一次不至于让用户误解历史）
//   · intent  意图层：**必须留**（用户自己做的标注、集合、标签、取件白名单）
//   · app     应用层：不参与库级重建（跨库的配置与用户行为）
//
// ⚠️ 物理落点与层**一一对应**（这一点被测试钉住）：
//   库级 `.gs.db` = fact ∪ process ∪ intent（14 张）；应用级 `app.db` = app（6 张）。
//   所以下面四组同时充当：
//     ① "每张表归类到哪一层"的唯一来源；② "每张表落在哪个库文件"的唯一来源。
//
// Lead 修正 #2 的落点后果（照做，但要如实记）：
//   `activity` / `recent_query` / `recent_view` 归**应用级**（跨库用户行为）⇒
//   库级补回 `collect_dir`（取件白名单，提案分类节本就把它列为意图层）才凑满 14。
//   ⚠️ 后果：`recent_view.uid` 在应用级库里**无法建 FK**（SQLite 不支持跨库外键），
//      提案写的 `FK asset.uid CASCADE` 只能降级为"由应用层在删除素材时清理"。

/** 四层的名字（顺序 = 展示/遍历顺序：事实 → 过程 → 意图 → 应用） */
export type SchemaLayer = 'fact' | 'process' | 'intent' | 'app';

export const SCHEMA_LAYER_ORDER: readonly SchemaLayer[] = Object.freeze([
  'fact',
  'process',
  'intent',
  'app',
]);

/**
 * 四组点名（**唯一来源**）。数组内顺序无特殊含义（表清单断言会排序），
 * 但保持"按提案卡出现顺序"便于人工比对。
 */
export const SCHEMA_LAYERS: Readonly<Record<SchemaLayer, readonly string[]>> = Object.freeze({
  /** 事实层：条目 / 两个文件角色 / 文件名全文索引 —— 全部可从素材重建 */
  fact: Object.freeze(['asset', 'asset_file', 'asset_name_fts']),

  /** 过程层：编码状态 / 任务台账 / 体检两表 —— 尽量留，丢了能重跑 */
  process: Object.freeze(['asset_index_state', 'job', 'health_run', 'health_finding']),

  /** 意图层：用户自己做的（评分/备注/收藏/标签/集合/导出历史/取件白名单）—— 必须留 */
  intent: Object.freeze([
    'asset_user_meta',
    'tag',
    'asset_tag',
    'collection',
    'collection_item',
    'asset_export',
    'collect_dir',
  ]),

  /** 应用层：跨库的配置与用户行为（不参与库级重建） */
  app: Object.freeze([
    'app_meta',
    'library_registry',
    'app_setting',
    'activity',
    'recent_query',
    'recent_view',
  ]),
});

/** 一层里的表名（副本，防调用方改到常量） */
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
  return [...new Set([
    ...SCHEMA_LAYERS.fact,
    ...SCHEMA_LAYERS.process,
    ...SCHEMA_LAYERS.intent,
  ])].sort();
}

/** 落在**应用级** `app.db` 里的表 = 应用层 */
export function appLayerTables(): string[] {
  return [...SCHEMA_LAYERS.app].sort();
}

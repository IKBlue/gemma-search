// apps/desktop/src/main/db/app-migrations.ts —— **应用级** `app.db` 的绿地 schema（6 张表）
//
// 2026-10-15 · S1。应用级数据库此前**根本不存在**（README §2.1）：库注册表在
// `userData/library-registry.json`，取件白名单在 `GEMMA_* env / config.json`，操作记录与检索历史没有落点。
//
// 表数口径（唯一来源 = 四层分类，见 schema-layers.ts）：**应用级 6 张**。
//   Lead 修正 #2：`activity` / `recent_query` / `recent_view` 归**应用级**
//   —— 它们是**跨库的用户行为**，不是某个库的属性；库级表用 `lib_id` 列做筛选就够。
//   ⇒ 6 张 = app_meta · library_registry · app_setting · activity · recent_query · recent_view。
//
// **账本**：应用级的迁移版本记在 `app_meta.schema_version`（提案 app_meta 卡的原设计：
//   单行守卫 + 迁移版本），与库级 `schema_version` **各自独立** ——
//   推进应用级版本**不得**动库级版本，反之亦然。机制共用 migration-engine.ts（一份实现）。
//
// 跨库外键的**硬约束**（SQLite 不支持跨库外键 —— 这是修正 #2 的真实代价，如实记）：
//   · `recent_view.uid` 提案写的是 `FK asset.uid CASCADE`，asset 在库级 ⇒ **建不了外键**。
//     降级为普通 TEXT：删除素材时由应用层清理（S2+ 接线），残留行要能在界面上识别为"条目已不在"。
//   · `activity.lib_id` / `recent_query.scope_lib_id` 同样是普通 TEXT，不做引用完整性。
//   · `asset_export.batch_id` → `activity.activity_id` 同理（该注释在库级的 migrations.ts 里）。

import {
  createdTableNames,
  migrateWithLedger,
  readVersionRow,
  targetVersionOf,
  uniqueSorted,
  type Migration,
  type MigrationLedger,
  type MigrationResult,
  type MigrateWithLedgerOptions,
} from './migration-engine.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

// ================================================================ 应用级账本（app_meta）

export const APP_META_TABLE: string = 'app_meta';
export const APP_META_ROW_ID: number = 1;

const CREATE_APP_META: string = `
CREATE TABLE IF NOT EXISTS app_meta (
  id             INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
  created_at_ms  INTEGER NOT NULL,
  updated_at_ms  INTEGER NOT NULL
);`;

/**
 * 应用级账本：`app_meta`（单行 id=1）。
 * 提案把 `schema_version` 放在 app_meta 里 ⇒ 它**就是**应用级的迁移账本，不再另建 `schema_version` 表
 * （否则同一个库文件里会有两个版本真相，P1）。
 */
export const APP_META_LEDGER: MigrationLedger = Object.freeze({
  table: APP_META_TABLE,
  rowId: APP_META_ROW_ID,
  ddl: Object.freeze([CREATE_APP_META]),

  seed(db: SqlDatabase, now: () => number): void {
    // created_at_ms 只在**首次**写入时落值（INSERT OR IGNORE），updated_at_ms 每次迁移都会刷新
    db.prepare(
      'INSERT OR IGNORE INTO app_meta (id, schema_version, created_at_ms, updated_at_ms) VALUES (1, 0, ?, ?)',
    ).run(now(), now());
  },

  readVersion(db: SqlDatabase): number {
    return readVersionRow(db, APP_META_TABLE, APP_META_ROW_ID, 'schema_version',
      'SELECT schema_version FROM app_meta WHERE id = 1');
  },

  writeVersion(db: SqlDatabase, version: number, now: () => number): void {
    db.prepare('UPDATE app_meta SET schema_version = ?, updated_at_ms = ? WHERE id = 1').run(version, now());
  },
});

// ================================================================ 应用级 DDL（5 张业务表）

/** `library_registry` —— 库注册表（取代 `userData/library-registry.json` 的权威副本） */
const T_LIBRARY_REGISTRY: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS library_registry (
  lib_id           TEXT    PRIMARY KEY NOT NULL CHECK (length(lib_id) BETWEEN 1 AND 32),
  root             TEXT    NOT NULL UNIQUE,
  display_name     TEXT    NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  compat_key       TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  registered_at_ms INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL
);`,
  // ⚠️ 两个 Windows 事实，落在**写入方**（不是这条 DDL）：
  //   ① `root` 的 UNIQUE 是**文本比较**：`G:\Model` 与 `g:\model`、`G:\PROGRA~1\x` 与
  //      `G:\Program Files\x` 是同一个目录却算两行 ⇒ 登记前必须规范化（大小写/短名/尾斜杠/分隔符），
  //      且库里**只存规范形**（README §5.2）。
  //   ② 名字是你的、路径是事实：display_name 与 root 分开存。
  'CREATE INDEX IF NOT EXISTS idx_library_registry_sort ON library_registry (sort_order, lib_id);',
];

/** `app_setting` —— 设置键值（值统一存 JSON，加设置不必迁移） */
const T_APP_SETTING: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS app_setting (
  key           TEXT    PRIMARY KEY NOT NULL,
  value_json    TEXT    NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`,
];

/** `activity` —— 操作记录（跨库用户行为；`activity_id` 同时是批量操作的 batch_id） */
const T_ACTIVITY: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS activity (
  activity_id  TEXT    PRIMARY KEY NOT NULL,
  at_ms        INTEGER NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN (
                 'collect', 'deliver', 'trash', 'restore', 'purge',
                 'tag.add', 'tag.remove', 'collection.add', 'index.exclude', 'index.in'
               )),
  subject_kind TEXT    NOT NULL CHECK (subject_kind IN ('asset', 'library', 'tag', 'collection', 'app')),
  subject_id   TEXT,
  lib_id       TEXT,
  result       TEXT    CHECK (result IN ('ok', 'skipped', 'failed')),
  detail_json  TEXT
);`,
  // at_ms DESC：列表页第一屏是索引扫描（倒序索引），不是"全表排一遍"
  'CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at_ms DESC);',
  'CREATE INDEX IF NOT EXISTS idx_activity_lib ON activity (lib_id, at_ms DESC) WHERE lib_id IS NOT NULL;',
  // 不存渲染好的文字：文案会变，结构化参数不会（subject_id 可空 = 批量操作，明细在 detail_json）
];

/** `recent_query` —— 检索历史（跨库；重跑必须还原当时的范围） */
const T_RECENT_QUERY: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS recent_query (
  query_id     TEXT    PRIMARY KEY NOT NULL,
  kind         TEXT    CHECK (kind IN ('text', 'image')),
  text         TEXT,
  image_ref    TEXT,
  scope_lib_id TEXT    NOT NULL DEFAULT '',
  result_count INTEGER,
  at_ms        INTEGER NOT NULL,
  CHECK (kind <> 'text'  OR text IS NOT NULL),
  CHECK (kind <> 'image' OR image_ref IS NOT NULL)
);`,
  // ⚠️ README §3.4 / Lead 修正 #4（提案自己的坑）：`scope_lib_id` 原本**可空**表示"全部库"，
  //    而 UNIQUE 里多个 NULL 互不冲突（SQLite 语义）⇒ 反复搜同一个词每次新增一行，真历史被挤掉。
  //    修法：改用**哨兵** —— `scope_lib_id TEXT NOT NULL DEFAULT ''`，`''` = 全部库。
  //    另：kind='image' 时 `text` 为 NULL，单靠 (kind,text,scope) 的 UNIQUE 同样去不了重
  //    （NULL 不参与唯一比较）⇒ 图片查询的天然键是 `image_ref`，故给**两条偏唯一索引**：
  //      · text  → (kind, text, scope_lib_id)   WHERE kind='text'
  //      · image → (kind, image_ref, scope_lib_id) WHERE kind='image'
  'CREATE INDEX IF NOT EXISTS idx_recent_query_at ON recent_query (at_ms DESC);',
  "CREATE UNIQUE INDEX IF NOT EXISTS uniq_recent_query_text ON recent_query (kind, text, scope_lib_id) WHERE kind = 'text';",
  "CREATE UNIQUE INDEX IF NOT EXISTS uniq_recent_query_image ON recent_query (kind, image_ref, scope_lib_id) WHERE kind = 'image';",
];

/** `recent_view` —— 最近查看（uid 即主键：同一条看多次只留最后一次，天然去重） */
const T_RECENT_VIEW: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS recent_view (
  uid          TEXT    PRIMARY KEY NOT NULL,
  viewed_at_ms INTEGER NOT NULL,
  view_count   INTEGER NOT NULL DEFAULT 1
);`,
  // ⚠️ `uid` **没有** REFERENCES asset(uid)：asset 在库级 `.gs.db`，SQLite 不支持跨库外键
  //    （修正 #2 把 recent_view 移到应用级后的真实代价）。删除素材时由应用层清理本表，
  //    残留行必须能被识别成"条目已不在"，而不是当成有效记录。
  'CREATE INDEX IF NOT EXISTS idx_recent_view_at ON recent_view (viewed_at_ms DESC);',
];

const APP_V1: readonly string[] = Object.freeze([
  ...T_LIBRARY_REGISTRY,
  ...T_APP_SETTING,
  ...T_ACTIVITY,
  ...T_RECENT_QUERY,
  ...T_RECENT_VIEW,
]);

export const APP_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'greenfield-app-6', statements: APP_V1 }),
]);

/** 本程序知道的**应用级**最高版本（从清单派生） */
export const APP_TARGET_SCHEMA_VERSION: number = targetVersionOf(APP_MIGRATIONS);

// ---------------------------------------------------------------- 应有表清单（从 DDL 派生）

/**
 * 应用级 6 张表 = 账本 `app_meta` + 迁移建的 5 张。
 * **从 DDL 派生**（账本 DDL 也算 DDL），不手写第二份。
 */
export const APP_TABLES: readonly string[] = Object.freeze(
  uniqueSorted([
    ...createdTableNames(APP_META_LEDGER.ddl),
    ...APP_MIGRATIONS.flatMap((m: Migration): string[] => createdTableNames(m.statements)),
  ]),
);

export interface MigrateAppOptions {
  /** 覆盖迁移清单（测试用） */
  migrations?: readonly Migration[];
  /** 时钟注入 */
  now?: () => number;
}

/**
 * 把应用级 `app.db` 推进到清单里的最高版本（账本 = `app_meta`）。
 * **与库级完全独立**：本函数不碰 `.gs.db`，也不读 `schema_version`。
 */
export function migrateApp(db: SqlDatabase, opts: MigrateAppOptions = {}): MigrationResult {
  const options: MigrateWithLedgerOptions = {
    migrations: opts.migrations ?? APP_MIGRATIONS,
    now: opts.now,
  };
  return migrateWithLedger(db, APP_META_LEDGER, options);
}

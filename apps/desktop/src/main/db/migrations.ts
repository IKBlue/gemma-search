// apps/desktop/src/main/db/migrations.ts —— **库级** `.gs.db` 的绿地 schema（14 张表）
//
// 2026-10-15 · S1：**绿地重写**。旧 v1/v2（library / items / doc_dirs / documents / doc_chunks /
//   health_runs / health_ledger 共 8 张）**整体丢弃**，不写兼容迁移 ——
//   所有者已裁定「全新项目，允许改/调，旧 schema 不迁移」。
//
// 表数口径（唯一来源 = 四层分类，见 schema-layers.ts）：
//   **20 张 = 库级 14 + 应用级 6**。本文件 = 库级 14 张（事实 3 + 过程 4 + 意图 7）。
//   `schema_version` 是**迁移账本**（机制表），不计入 20。
//   机械断言在 apps/desktop/tests/db-schema.test.mjs：DDL 派生清单 == 四层点名清单。
//
// 提案自身的 5 处问题按 reports/2026-10-15-schema-diff/README.md §3 修正（逐条落到 DDL 注释）：
//   3.1 表数统一为 20（以逐表分类节为唯一来源）；
//   3.2 activity / recent_query / recent_view 归**应用级**（见 app-migrations.ts）；
//   3.3 `UNIQUE (lib_id, rel_path)` 必须落在**真实列**上 ⇒ 给 `asset` 加 `rel_path`（扫描器写），
//       `asset_file` **不**冗余 `lib_id`（认账见 asset 表注释）；
//   3.4 recent_query 的哨兵列（在应用级库，见 app-migrations.ts）；
//   3.5 job 的"全局单任务"约束写明并落地（见 job 表的 uniq_job_single_active）。
//
// 存储纪律：**不存绝对路径**（索引/定位一律以库根相对路径为准，库整体搬盘后仍可用）。
// 迁移机制在 migration-engine.ts（库级/应用级共用一份实现）。

import {
  SCHEMA_VERSION_LEDGER,
  bootstrapLedger,
  createdTableNames,
  migrateWithLedger,
  targetVersionOf,
  uniqueSorted,
  validateMigrations,
  virtualTableNames,
  type Migration,
  type MigrationResult,
  type MigrateWithLedgerOptions,
} from './migration-engine.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

// ================================================================ 库级 DDL（14 张）

/** 事实层 ① `asset` —— 条目（一张预览图 = 一个条目；允许缺包） */
const T_ASSET: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset (
  uid                   TEXT    PRIMARY KEY NOT NULL
                        CHECK (length(uid) = 12 AND uid NOT GLOB '*[^0-9a-f]*'),
  lib_id                TEXT    NOT NULL,
  folder                TEXT    NOT NULL,
  stem                  TEXT    NOT NULL,
  display_name          TEXT    NOT NULL,
  rel_dir               TEXT    NOT NULL,
  rel_path              TEXT    NOT NULL,
  content_created_at_ms INTEGER,
  deleted_at_ms         INTEGER,
  dup_group_id          TEXT,
  discovered_at_ms      INTEGER NOT NULL,
  updated_at_ms         INTEGER NOT NULL,
  UNIQUE (lib_id, rel_path)
);`,

  // ⚠️ README §3.3：提案把 `UNIQUE (lib_id, rel_path)` 写在 asset 卡，但 asset **没有 rel_path**
  //    （只有 rel_dir），而 rel_path 在 asset_file、asset_file 又没有 lib_id ⇒ 建不出来。
  //    选法 ①（README 推荐）：`asset` 增加 `rel_path`（**由扫描器写**，与 asset_file 的
  //    role='image' 行同值）。认账：这确实让"图片的库根相对路径"在两处出现（asset.rel_path 与
  //    asset_file(image).rel_path）；接受这份冗余，因为 `asset` 是"这条素材在库里是谁"的身份表，
  //    「同一路径不许登记两次」这条唯一性必须落在**条目级**（跨 role 也成立），
  //    而 asset_file 没有 lib_id、单独无法表达"同库同路径唯一"。
  //    ⚠️ 副作用：`asset.rel_path` 与 `asset_file(role='image').rel_path` 改名/移动时必须同事务更新
  //      （S2 的扫描/改名路径负责；不一致就是"条目指向旧路径"的静默错误）。
  'CREATE INDEX IF NOT EXISTS idx_asset_content_created_at ON asset (content_created_at_ms);',
  'CREATE INDEX IF NOT EXISTS idx_asset_dup_group ON asset (dup_group_id) WHERE dup_group_id IS NOT NULL;',
  // 常规查询默认 WHERE deleted_at_ms IS NULL（软删除）⇒ 给"在用条目"一条偏索引
  'CREATE INDEX IF NOT EXISTS idx_asset_active ON asset (lib_id, discovered_at_ms DESC) WHERE deleted_at_ms IS NULL;',
  // 不再单独建 idx_asset_lib：UNIQUE (lib_id, rel_path) 的前缀就是 lib_id，重复索引只是写放大
];

/** 事实层 ② `asset_file` —— 两个文件角色（缺包 = 没有 role='archive' 的行） */
const T_ASSET_FILE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_file (
  uid                TEXT    NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  role               TEXT    NOT NULL CHECK (role IN ('image', 'archive')),
  rel_path           TEXT    NOT NULL,
  ext                TEXT    NOT NULL,
  size_bytes         INTEGER NOT NULL,
  mtime_ms           INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  thumb_hash         BLOB,
  content_hash_kind  TEXT    CHECK (content_hash_kind IN ('sha1', 'sha256')),
  content_hash_value TEXT,
  PRIMARY KEY (uid, role)
);`,
  // mtime_ms 的口径唯一：BigInt mtimeNs / 1_000_000n（截断）。判"文件被外部改过"就比它。
  // 与 asset.content_created_at_ms 是两件事：前者判过期，后者是内容时间（可空，很多素材没有 EXIF）。
  'CREATE INDEX IF NOT EXISTS idx_asset_file_rel_path ON asset_file (rel_path);',
  'CREATE INDEX IF NOT EXISTS idx_asset_file_width ON asset_file (width) WHERE width IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_asset_file_content_hash ON asset_file (content_hash_value) WHERE content_hash_value IS NOT NULL;',
];

/** 事实层 ③ `asset_name_fts` —— 文件名全文索引（FTS5 实测可用，见 README §5.1） */
const T_ASSET_NAME_FTS: readonly string[] = [
  // 提案卡没有字段行（"此卡不是数据表"），这里按用途给最小面：
  //   · uid UNINDEXED：只做回表连接用，不参与分词（uid 是 hex，不该进倒排）
  //   · stem / display_name：用户真正会搜的两列
  //   · 独立 FTS5（非 external-content）：由应用在改名/删除时同步维护；S2 接线。
  //   ⚠️ FTS5 会自建 5 张影子表（asset_name_fts_data/_idx/_content/_docsize/_config），
  //      它们**不是我们建的表** —— db-schema 测试按 virtualTableNames() 机械排除。
  `
CREATE VIRTUAL TABLE IF NOT EXISTS asset_name_fts USING fts5(
  uid UNINDEXED,
  stem,
  display_name,
  tokenize = 'unicode61'
);`,
];

/** 过程层 ① `asset_index_state` —— 编码状态（1:1，主键即外键） */
const T_ASSET_INDEX_STATE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_index_state (
  uid              TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  encoded_at_ms    INTEGER,
  encoded_mtime_ms INTEGER,
  compat_key       TEXT,
  needs_reencode   INTEGER NOT NULL DEFAULT 0 CHECK (needs_reencode IN (0, 1)),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_error_at_ms INTEGER,
  excluded_at_ms   INTEGER,
  checked_at_ms    INTEGER
);`,
  // 编码成功时刻存"快照"而不是布尔：快照还能回答"何时改的"
  'CREATE INDEX IF NOT EXISTS idx_asset_index_state_pending ON asset_index_state (uid) WHERE encoded_at_ms IS NULL;',
  'CREATE INDEX IF NOT EXISTS idx_asset_index_state_reencode ON asset_index_state (uid) WHERE needs_reencode = 1;',
  'CREATE INDEX IF NOT EXISTS idx_asset_index_state_excluded ON asset_index_state (uid) WHERE excluded_at_ms IS NOT NULL;',
];

/** 意图层 ① `asset_user_meta` —— 评分 / 备注 / 收藏（没有行 = 还没被标注过，合法状态） */
const T_ASSET_USER_META: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_user_meta (
  uid           TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  note          TEXT,
  updated_at_ms INTEGER NOT NULL,
  is_favorite   INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1))
);`,
  // 用 NULL 表示未评分（0 会分不清"没评"和"评了零分"，后者语义上不存在）
  'CREATE INDEX IF NOT EXISTS idx_asset_user_meta_favorite ON asset_user_meta (uid) WHERE is_favorite = 1;',
];

/** 意图层 ②③ `tag` / `asset_tag` */
const T_TAG: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS tag (
  tag_id        TEXT    PRIMARY KEY NOT NULL,
  name          TEXT    NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);`,
  `
CREATE TABLE IF NOT EXISTS asset_tag (
  uid         TEXT    NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  tag_id      TEXT    NOT NULL REFERENCES tag (tag_id) ON DELETE CASCADE,
  added_at_ms INTEGER NOT NULL,
  PRIMARY KEY (uid, tag_id)
);`,
  // 复合主键已给 (uid, …) 前缀；反过来"这个标签下有哪些条目"要单独一条
  'CREATE INDEX IF NOT EXISTS idx_asset_tag_tag ON asset_tag (tag_id);',
];

/** 意图层 ④⑤ `collection` / `collection_item` */
const T_COLLECTION: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS collection (
  collection_id TEXT    PRIMARY KEY NOT NULL,
  name          TEXT    NOT NULL,
  note          TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`,
  // name 故意不加 UNIQUE：同名集合合理（去年与今年的提案可以同名）
  `
CREATE TABLE IF NOT EXISTS collection_item (
  collection_id TEXT    NOT NULL REFERENCES collection (collection_id) ON DELETE CASCADE,
  uid           TEXT    NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  added_at_ms   INTEGER NOT NULL,
  PRIMARY KEY (collection_id, uid)
);`,
  'CREATE INDEX IF NOT EXISTS idx_collection_item_uid ON collection_item (uid);',
];

/** 意图层 ⑥ `asset_export` —— 取件 / 交付的历史（历史表存名字**快照**） */
const T_ASSET_EXPORT: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_export (
  export_id  TEXT    PRIMARY KEY NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('collect', 'deliver')),
  uid        TEXT    REFERENCES asset (uid) ON DELETE SET NULL,
  asset_name TEXT    NOT NULL,
  batch_id   TEXT,
  target_dir TEXT    NOT NULL,
  result     TEXT    CHECK (result IN ('copied', 'skipped', 'failed')),
  reason     TEXT,
  at_ms      INTEGER NOT NULL
);`,
  // uid 可空 + SET NULL（不是 CASCADE）：条目被彻底删除后"我导出过它"这件事仍然成立
  // batch_id **不能建外键**：activity 在应用级库，跨库无外键（README §2.2 #14）
  'CREATE INDEX IF NOT EXISTS idx_asset_export_uid ON asset_export (uid, at_ms DESC);',
  'CREATE INDEX IF NOT EXISTS idx_asset_export_batch ON asset_export (batch_id) WHERE batch_id IS NOT NULL;',
];

/** 过程层 ② `job` —— 任务台账（崩溃检测靠 heartbeat） */
const T_JOB: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS job (
  job_id          TEXT    PRIMARY KEY NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('scan', 'index', 'health', 'rebuild', 'ingest')),
  state           TEXT    NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress_done   INTEGER NOT NULL DEFAULT 0,
  progress_total  INTEGER,
  phase           TEXT,
  cursor_json     TEXT,
  heartbeat_at_ms INTEGER,
  summary_json    TEXT,
  error           TEXT,
  queued_at_ms    INTEGER,
  started_at_ms   INTEGER,
  finished_at_ms  INTEGER
);`,
  'CREATE INDEX IF NOT EXISTS idx_job_state ON job (state);',
  'CREATE INDEX IF NOT EXISTS idx_job_heartbeat ON job (heartbeat_at_ms) WHERE state = \'running\';',
  // ⚠️ README §3.5 / Lead 修正 #5：这是**产品决定**，不是疏忽 ——
  //    「同时只能有一个在跑的任务」⇒ 索引 / 扫描 / 体检 / 重建 / 入库**全部串行**。
  //    想改成"索引与体检可并行"就必须改这条约束（按 kind 分组），那是改行为，要先报所有者。
  //    常量表达式索引 ((1)) 让所有活跃行落在同一个键上 ⇒ 第二行必然冲突。
  'CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_single_active ON job ((1)) WHERE state IN (\'queued\', \'running\');',
];

/** 过程层 ③④ `health_run` / `health_finding` */
const T_HEALTH: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS health_run (
  run_id        TEXT    PRIMARY KEY NOT NULL,
  job_id        TEXT    REFERENCES job (job_id) ON DELETE SET NULL,
  state         TEXT    CHECK (state IN ('running', 'done', 'failed', 'cancelled')),
  started_at_ms INTEGER,
  finished_at_ms INTEGER,
  summary_json  TEXT
);`,
  // 体检复用同一套任务机制（job），不另写一份进度/取消（P1）
  'CREATE INDEX IF NOT EXISTS idx_health_run_job ON health_run (job_id) WHERE job_id IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_health_run_started ON health_run (started_at_ms);',
  `
CREATE TABLE IF NOT EXISTS health_finding (
  finding_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT    NOT NULL REFERENCES health_run (run_id) ON DELETE CASCADE,
  check_id        TEXT    NOT NULL,
  severity        TEXT    CHECK (severity IN ('info', 'warn', 'error')),
  target_uid      TEXT,
  target_rel_path TEXT,
  detail          TEXT    NOT NULL,
  detail_json     TEXT,
  created_at_ms   INTEGER NOT NULL
);`,
  // 提案明确要 AUTOINCREMENT（流水不需要跨库唯一，整数最省）。
  // 认账：AUTOINCREMENT 会带来一张 SQLite 内部表 sqlite_sequence —— 表清单断言必须排除它。
  'CREATE INDEX IF NOT EXISTS idx_health_finding_run ON health_finding (run_id, check_id);',
  'CREATE INDEX IF NOT EXISTS idx_health_finding_uid ON health_finding (target_uid) WHERE target_uid IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_health_finding_path ON health_finding (target_rel_path) WHERE target_rel_path IS NOT NULL;',
];

/** 意图层 ⑦ `collect_dir` —— 取件白名单（**安全边界**，落库才能审计与展示） */
const T_COLLECT_DIR: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS collect_dir (
  dir_id     TEXT    PRIMARY KEY NOT NULL,
  label      TEXT    NOT NULL UNIQUE,
  abs_path   TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);`,
  // 界面只应允许一个默认项 ⇒ 落成库级约束（常量表达式索引），而不是靠 UI 自觉
  'CREATE UNIQUE INDEX IF NOT EXISTS uniq_collect_dir_default ON collect_dir ((1)) WHERE is_default = 1;',
];

/**
 * 库级迁移清单（绿地：只有一条 v1）。
 *
 * 为什么只有一条：绿地模型不背历史 —— 旧 v1/v2 已整体丢弃，把 14 张表拆成多条只会在
 * 「版本推进」上制造没有意义的台阶。测试用**注入的自定义清单**覆盖"多条按序推进"。
 */
const LIBRARY_V1: readonly string[] = Object.freeze([
  ...T_ASSET,
  ...T_ASSET_FILE,
  ...T_ASSET_NAME_FTS,
  ...T_ASSET_INDEX_STATE,
  ...T_ASSET_USER_META,
  ...T_TAG,
  ...T_COLLECTION,
  ...T_ASSET_EXPORT,
  ...T_JOB,
  ...T_HEALTH,
  ...T_COLLECT_DIR,
]);

export const LIBRARY_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'greenfield-library-14', statements: LIBRARY_V1 }),
]);

/** 本程序知道的**库级**最高版本（从清单派生，不另写数字） */
export const TARGET_SCHEMA_VERSION: number = targetVersionOf(LIBRARY_MIGRATIONS);

// ---------------------------------------------------------------- 应有表清单（从 DDL 派生）

/** 库级 14 张业务表（**从 DDL 派生**，不手写第二份） */
export const LIBRARY_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => createdTableNames(m.statements))),
);

/** 库级虚拟表（FTS5）—— 影子表要按它排除，测试用 */
export const LIBRARY_VIRTUAL_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => virtualTableNames(m.statements))),
);

/**
 * 库级 `.gs.db` 里**应当存在**的全部表（含迁移账本 `schema_version`）。
 * 用途：T-15a 的完整性自检（apps/desktop/src/main/library-health.ts）。
 * ⚠️ 账本表不计入"20 张业务表"，但它确实在库里 ⇒ 这份清单必须含它。
 */
export const EXPECTED_TABLES: readonly string[] = Object.freeze(
  uniqueSorted([
    ...createdTableNames(SCHEMA_VERSION_LEDGER.ddl),
    ...LIBRARY_TABLES,
  ]),
);

// ---------------------------------------------------------------- 账本读写（库级便捷封装）

/** 建账本表并保证 id=1 那一行存在；每次 migrate 都调，代价是两条 no-op 语句 */
export function ensureSchemaVersionTable(db: SqlDatabase, now: () => number): void {
  bootstrapLedger(db, SCHEMA_VERSION_LEDGER, now);
}

/** 读库级当前版本；账本没有 id=1 的行 = 建表逻辑被绕过，抛错而不是"当成 0" */
export function readSchemaVersion(db: SqlDatabase): number {
  return SCHEMA_VERSION_LEDGER.readVersion(db);
}

/** `migrate` 的选项（与迁移引擎同形，只是 `migrations` 可缺省为库级清单） */
export interface MigrateOptions {
  /** 覆盖迁移清单（测试用它做"先跑一条、再跑全量"与"注入一条坏迁移"） */
  migrations?: readonly Migration[];
  /** 时钟注入（版本行时间可复现） */
  now?: () => number;
}

/**
 * 把库级 `.gs.db` 推进到清单里的最高版本。**幂等**：已是最新就什么都不做、也不报错。
 * 不负责：建父目录、开库（open.ts）、删库重建（removeGsDbFiles）。
 */
export function migrate(db: SqlDatabase, opts: MigrateOptions = {}): MigrationResult {
  const options: MigrateWithLedgerOptions = {
    migrations: opts.migrations ?? LIBRARY_MIGRATIONS,
    now: opts.now,
  };
  return migrateWithLedger(db, SCHEMA_VERSION_LEDGER, options);
}

// 既有调用方（open.ts / library-health.ts）从本文件取引擎件；统一在这里转出（不各自 import 引擎）
export { SCHEMA_VERSION_LEDGER, targetVersionOf, validateMigrations };
export { SCHEMA_VERSION_ROW_ID, SCHEMA_VERSION_TABLE } from './migration-engine.ts';
export type {
  AppliedMigration,
  Migration,
  MigrationLedger,
  MigrationResult,
} from './migration-engine.ts';

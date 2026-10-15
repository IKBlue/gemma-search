// apps/desktop/src/main/db/migrations.ts —— **库级** `.gs.db` 的绿地 schema（本轮 **3 张**）
//
// **字段/约束/索引的唯一依据 = reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md §1.2**
// （所有者口径：全新项目，先定数据表；B：只建现在就要用的 6 张）。提案（PROPOSAL-schema-v1.html）
// 里多出来的列**一律不加** —— 以后要用 = 一条迁移，绿地红利就在这里。
//
// 2026-10-15 · S1：绿地重写。旧 v1/v2（library / items / doc_dirs / documents / doc_chunks /
//   health_runs / health_ledger 共 8 张）**整体丢弃**，不写兼容迁移。
// 2026-10-15 · S1b：本文件 = 库级 **3 张**：`asset`（事实）· `asset_file`（事实）· `asset_index_state`（过程）。
//   其余 14 张随功能上线，各加一条迁移。`schema_version` 是**迁移账本**（机制表），不计入 6。
//
// 机制**没有跟着缩水**（这正是"只留 6 张"不丢能力的原因）：
//   · migration-engine.ts 仍是**唯一**迁移实现（库级/应用级共用一份）；
//   · 两套账本 —— 库级 `schema_version` / 应用级 `app_meta.schema_version` —— **各自独立**；
//   · 应有表清单**从 DDL 派生**，四层点名（schema-layers.ts）仍是唯一分类来源；
//     测试强制「迁移建出的每一张表都必须在四组里被点名」⇒ **第二批加表时会被逼着分类**。
//
// ⚠️ **跨库外键不存在**（SQLite 无此能力）⇒ `asset.lib_id` 只是普通 TEXT，**不做** REFERENCES。
//    这是"两个库"划分的必然代价（设计基线 §0）。
//
// 存储纪律：**不存绝对路径**（索引/定位一律以库根相对路径为准，库整体搬盘后仍可用）。

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

// ================================================================ 库级 DDL（本轮 3 张）

/** 事实层 ① `asset` —— 条目（一个条目 = 一张预览图 + 可选同名包） */
const T_ASSET: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset (
  uid              TEXT    PRIMARY KEY NOT NULL,
  lib_id           TEXT    NOT NULL,
  folder           TEXT    NOT NULL,
  stem             TEXT    NOT NULL,
  display_name     TEXT    NOT NULL,
  rel_dir          TEXT    NOT NULL,
  rel_path         TEXT    NOT NULL,
  discovered_at_ms INTEGER NOT NULL,
  UNIQUE (lib_id, rel_path)
);`,

  // ⚠️ uid 的"12 位小写 hex"形状由**唯一写入口**（扫描器/uid 生成器）保证，DDL **不**额外加 CHECK
  //    —— 约束集以设计基线 §1.2 为准（那列只写 PK）。同理 rel_dir 的"规范形（库根 ⇒ 空串）"
  //    也是写入口的事：DDL 只保证 NOT NULL。
  //
  // ⚠️ `UNIQUE (lib_id, rel_path)` 落在**真实列**上：提案把这条唯一约束写在 asset 卡，但 asset
  //    没有 rel_path（只有 rel_dir），而 rel_path 在 asset_file、asset_file 又没有 lib_id
  //    ⇒ 按提案原样**根本建不出来**（README §3.3）。设计基线 §1.2 的定稿就是给 asset.rel_path，
  //    与 asset_file(role='preview').rel_path 同值（扫描器同事务写两处）。
  //    接受这份冗余的理由：「同一路径不许登记两次」必须落在**条目级**（跨 role 也成立），
  //    而 asset_file 没有 lib_id、单独表达不了"同库同路径唯一"。
  //
  // 本批**刻意不加**的列（都随功能上线）：deleted_at_ms（回收站）· dup_group_id（重复分组）·
  //   content_created_at_ms（按内容时间浏览）。加它们 = 一条迁移，不要"迟早要用"提前加。
  'CREATE INDEX IF NOT EXISTS idx_asset_lib_folder ON asset (lib_id, folder);',
  'CREATE INDEX IF NOT EXISTS idx_asset_stem ON asset (stem);',
];

/** 事实层 ② `asset_file` —— 文件角色（**缺包 = 少一行**，不是一个 NULL 块） */
const T_ASSET_FILE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_file (
  uid        TEXT    NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('preview', 'archive')),
  rel_path   TEXT    NOT NULL,
  ext        TEXT    NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  PRIMARY KEY (uid, role)
);`,
  // mtime_ms 的口径**全库唯一**：BigInt mtimeNs / 1_000_000n（截断）。判"文件被外部改过"就比它。
  // width/height 只有 role='preview' 有值；**扫描就能拿到** ⇒ 现在就存，免得以后重扫。
  // 本批**不加**：thumb_hash（首屏占位图，UI 增强）· content_hash_kind/value（去重要真算哈希）。
  'CREATE INDEX IF NOT EXISTS idx_asset_file_path ON asset_file (rel_path);',
];

/** 过程层 ① `asset_index_state` —— 索引状态（**存时刻，不存枚举**） */
const T_ASSET_INDEX_STATE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_index_state (
  uid              TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  encoded_at_ms    INTEGER,
  encoded_mtime_ms INTEGER,
  compat_key       TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_error_at_ms INTEGER,
  excluded_at_ms   INTEGER,
  checked_at_ms    INTEGER
);`,
  // ⚠️ 本批**不物化** `needs_reencode`（提案有）：待重编码 = "当前 mtime ≠ encoded_mtime_ms" 或
  //    "库 compat_key ≠ 本行 compat_key"，都是**跨表比较**，物化成一列既无法索引又要对账
  //    （设计基线 §1.2）。等浏览页真要筛这一档，再加列 + 对账检查（一条迁移）。
  // 状态 8 档全部**派生**（已排除 > 编码失败 > 编码中 > 图片丢失 > 已移除 > 待重编码 > 待编码 > 已编码），
  // 一个字都不存 —— 理由是同一件事不设第二份真相。
  'CREATE INDEX IF NOT EXISTS idx_state_pending ON asset_index_state (encoded_at_ms) WHERE encoded_at_ms IS NULL;',
  'CREATE INDEX IF NOT EXISTS idx_state_excluded ON asset_index_state (excluded_at_ms) WHERE excluded_at_ms IS NOT NULL;',
];

/**
 * 库级迁移清单（绿地：只有一条 v1）。
 *
 * **第二批的表各加一条新迁移**（v2、v3…），机制与账本都不用动。
 * 测试用**注入的自定义清单**覆盖"多条按序推进"。
 */
const LIBRARY_V1: readonly string[] = Object.freeze([
  ...T_ASSET,
  ...T_ASSET_FILE,
  ...T_ASSET_INDEX_STATE,
]);

export const LIBRARY_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'greenfield-library-3', statements: LIBRARY_V1 }),
]);

/** 本程序知道的**库级**最高版本（从清单派生，不另写数字） */
export const TARGET_SCHEMA_VERSION: number = targetVersionOf(LIBRARY_MIGRATIONS);

// ---------------------------------------------------------------- 应有表清单（从 DDL 派生）

/** 库级 3 张业务表（**从 DDL 派生**，不手写第二份清单） */
export const LIBRARY_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => createdTableNames(m.statements))),
);

/** 库级虚拟表（本轮没有 FTS；第二批的 asset_name_fts 会在这里出现，影子表按它排除） */
export const LIBRARY_VIRTUAL_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => virtualTableNames(m.statements))),
);

/**
 * 库级 `.gs.db` 里**应当存在**的全部表（含迁移账本 `schema_version`）。
 * 用途：T-15a 的完整性自检（apps/desktop/src/main/library-health.ts）。
 * ⚠️ 账本表不计入"本轮 6 张"，但它确实在库里 ⇒ 这份清单必须含它。
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

// apps/desktop/src/main/db/app-migrations.ts —— **应用级** `app.db` 的绿地 schema（本轮 **3 张**）
//
// **字段/约束/索引的唯一依据 = reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md §1.1**
// （所有者口径：全新项目，先定数据表；B：只建现在就要用的 6 张）。
//
// 2026-10-15 · S1。应用级数据库此前**根本不存在**：库注册表在 `userData/library-registry.json`，
//   取件白名单在 `GEMMA_* env / config.json`。
// 2026-10-15 · S1b：本文件 = 应用级 **3 张**：`app_meta`（账本）· `library_registry` · `collect_dir`。
//   其余 4 张（app_setting · activity · recent_query · …）随功能上线，各加一条迁移。
//
// **账本**：应用级版本记在 `app_meta.schema_version`（单行守卫 + 迁移版本），与库级 `schema_version`
//   **各自独立** —— 推进应用级版本**不得**动库级版本，反之亦然。机制共用 migration-engine.ts（一份实现）。
//
// 本轮为什么保留 `collect_dir`：取件白名单决定"往哪写"，是**全局安全边界**（设计基线 §1.1）——
//   放库级等于"某个库的数据决定往哪写"，也不该由每个库各定义一份；放应用级 ⇒ 一条规则管全部库。
//
// ⚠️ **跨库外键不存在**（SQLite 无此能力）：本轮三张表都不引用库级表（root / abs_path 都是路径字符串）；
//    第二批的 `activity.lib_id` / `recent_query.scope_lib_id` 同样只会是普通 TEXT。

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
 * 设计基线 §1.1 把 `schema_version` 放在 app_meta 里 ⇒ 它**就是**应用级账本，
 * 不再另建 `schema_version` 表（否则同一个库文件里会有两个版本真相，P1）。
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
    return readVersionRow(
      db,
      APP_META_TABLE,
      APP_META_ROW_ID,
      'schema_version',
      'SELECT schema_version FROM app_meta WHERE id = 1',
    );
  },

  writeVersion(db: SqlDatabase, version: number, now: () => number): void {
    db.prepare('UPDATE app_meta SET schema_version = ?, updated_at_ms = ? WHERE id = 1').run(
      version,
      now(),
    );
  },
});

// ================================================================ 应用级 DDL（本轮 2 张业务表）

/** `library_registry` —— 库注册表（取代 `userData/library-registry.json` 的权威副本） */
const T_LIBRARY_REGISTRY: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS library_registry (
  lib_id           TEXT    PRIMARY KEY NOT NULL,
  root             TEXT    NOT NULL UNIQUE,
  display_name     TEXT    NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  compat_key       TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  registered_at_ms INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL
);`,
  // lib_id 的"1–32 字符"形状由**写入口**（library* 那组方法）保证，DDL 只写 PK —— 约束集以基线 §1.1 为准。
  // ⚠️ 两个 Windows 事实，落在**写入方**（不是这条 DDL）：
  //   ① `root` 的 UNIQUE 是**文本比较**：`G:\Model` 与 `g:\model`、`G:\PROGRA~1\x` 与
  //      `G:\Program Files\x` 是同一个目录却算两行 ⇒ 登记前必须规范化（大小写/短名/尾斜杠/分隔符），
  //      且库里**只存规范形**（设计基线 §1.1）。
  //   ② 名字是你的、路径是事实：display_name 与 root 分开存。
  // enabled=0 只影响"参与检索与入库"，**不动任何文件**（停用不等于删除）。
  'CREATE INDEX IF NOT EXISTS idx_library_registry_sort ON library_registry (sort_order, lib_id);',
];

/** `collect_dir` —— 取件白名单（**全局安全边界**；S1b 后归应用级） */
const T_COLLECT_DIR: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS collect_dir (
  dir_id        TEXT    PRIMARY KEY NOT NULL,
  label         TEXT    NOT NULL UNIQUE,
  abs_path      TEXT    NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at_ms INTEGER NOT NULL
);`,
  // 为什么归应用级：白名单决定"往哪写"，是**全局安全边界**。
  //   · 放库级 ⇒ 每个库各一份白名单，一份库数据就能决定写哪儿；首启还没有库时白名单也无处安放；
  //   · 放应用级 ⇒ 一条规则管全部库，可审计可展示。
  // 界面只应允许一个默认项 ⇒ 落成库级约束（常量表达式索引），而不是靠 UI 自觉。
  'CREATE UNIQUE INDEX IF NOT EXISTS uniq_collect_default ON collect_dir ((1)) WHERE is_default = 1;',
];

/**
 * **应用层** `app_setting` —— 应用设置（B2-6 · 字段照抄设计基线
 * `reports/2026-10-15-schema-diff/SPEC-COMPACT.md` §「app_setting [v1.2 新增] · 字段 3」，第 38-44 行）。
 *
 * ⚠️ **落点先核对了基线**：`SPEC.md:173` 把 `app_setting` 列在**应用级**（与 `activity` · `recent_query` 同组），
 *    四层分类表（`reports/2026-10-15-schema-diff/README.md:34`）同样列在**应用层**（不参与库级重建）。
 *    ⇒ 它是 **`app.db` 的表**，进的是**应用级迁移链**（本文件），**不是**库级 `.gs.db` 链（两条链各算各的版本）。
 *
 * 逐字段的"为什么"（照抄基线）：
 *   · `key` **PK** —— 设置键，形如 `theme` / `model.dir` / `collect.default`（层级靠命名约定，不加列）；
 *   · `value_json` **NOT NULL** —— 值**统一存 JSON**（字符串也是 JSON 字符串）：布尔/数组/对象不必各开一列，
 *     **加设置不需要迁移**（这就是"3 个字段能干很多事"的原因）；
 *   · `updated_at_ms` **NOT NULL** —— 最后修改时刻。
 *
 * ── ⚠️ 与 `config.json` 的关系（P1：**只在这两处定义，别处不许再定一套**）───────────────
 * 现状：设置落在 `config.json`；SPEC 把它定义为**兼容回退**。口径定死为**「库优先 + 旧文件只读回退」**：
 *   · **写**：只写 `app_setting`（新设置**不再**写回 `config.json`）；
 *   · **读**：`app_setting` 有该键 ⇒ 用它；没有 ⇒ **才**回退读旧 `config.json`；
 *   · **不回写**（读完不把旧值搬进库）：回写会让"用户删掉库里的键"被旧文件**复活** —— 那正是"两份真相"的经典 bug；
 *     真要搬运是一次性迁移脚本的事，不该藏在读取路径里。
 * ⇒ **可执行的那一份**在 `main/app-db.ts` 的 `resolveSetting()`（唯一实现；`app.db` 的写入也只许在那里，
 *    见 `app-db.test.mjs` 的 D4）。本注释是"口径"的那一份；两处互为指针，**不重复实现**。
 */
const T_APP_SETTING: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS app_setting (
  "key"           TEXT    PRIMARY KEY NOT NULL,
  value_json      TEXT    NOT NULL,
  updated_at_ms   INTEGER NOT NULL
);`,
];

const APP_V1: readonly string[] = Object.freeze([...T_LIBRARY_REGISTRY, ...T_COLLECT_DIR]);

const APP_V2: readonly string[] = Object.freeze([...T_APP_SETTING]);

/**
 * **应用层** `activity` —— 操作记录（B2-8 · 字段照抄设计基线
 * `reports/2026-10-15-schema-diff/SPEC-COMPACT.md` §「activity [v1.2 新增] · 字段 8」，第 46-57 行）。
 *
 * ⚠️ **归属先核对了基线**（卡面第 1 条要求）：
 *   · `SPEC.md:173`（第二批归属表）把 `activity` 列在**应用级**；
 *   · 设计基线 `SPEC-COMPACT.md:197` 更直白：「复用 `activity.activity_id` … **不能建外键 —— activity 在应用级 DB**」。
 *   ⇒ 它是 **`app.db` 的表**，进**应用级链**（本文件）。
 *   ⚠️ 与 `README.md:32`（把 `activity` 归"过程层"）**表面冲突**：那份按**层语义**分，而本仓的物理规则是
 *     「库级 = fact ∪ process ∪ intent」⇒ 按它会把 activity 放进 `.gs.db`，与上面两处（以及"跨库无外键"
 *     这条唯一自洽的解释）矛盾。**以 SPEC 为准**（AGENTS §0：行为冲突看 SPEC）。
 *
 * ── 与 `asset_export` 的边界（"一次批量 = 谁一行"）────────────────────────────
 * 基线原话：**一次批量 = `activity` 1 行 + `asset_export` N 行**。
 *   · `activity`（**应用级**）= 「谁在什么时候做了一次什么」—— 一次批量**一行**；
 *   · `asset_export`（**库级·意图**）= 「每条素材的结局」—— 一次批量 **N 行**；
 *   · 纽带 = **同一个 `batch_id`**（就是本表的 `activity_id`：基线原话「也是批量操作的 batch_id」）。
 * ⚠️ 两张表**在不同的数据库里** ⇒ 这条纽带只能是**逻辑**的、**不可能有物理外键**（这就是基线写"不能建外键"的原因）。
 *   ⇒ 测试用**同一批数据跨两库**证明 1:N（`activity.test.mjs` 的 C3）。
 *
 * 逐字段的"为什么"（照抄基线）：
 *   · `activity_id` **PK** —— nanoid；**同时是批量操作的 `batch_id`**（一族操作共用一个 id）；
 *   · `at_ms` NOT NULL + **DESC 索引** —— 倒序 ⇒ 列表页第一屏是索引扫描，不是全表排序；
 *   · `kind` NOT NULL + **CHECK 枚举**（collect/deliver/trash/restore/purge/tag.add/tag.remove/collection.add/index.exclude/index.in）；
 *   · `subject_kind` NOT NULL + **CHECK 枚举**（asset/library/tag/collection/app）；
 *   · `subject_id` 可空 —— 对象 id（uid/lib_id/tag_id…）；**批量操作时为空**，明细在 `detail_json`；
 *   · `lib_id` **可空** —— 有些操作（登记库）**不属于任何库**；
 *   · `result` CHECK ok/skipped/failed —— 与 `asset_export.result` **同一套词**；
 *   · `detail_json` 可空 —— 存**结构化参数**，不存渲染好的文字（渲染的唯一来源在界面那一侧）。
 */
const T_ACTIVITY: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS activity (
  activity_id   TEXT    PRIMARY KEY NOT NULL,
  at_ms         INTEGER NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('collect', 'deliver', 'trash', 'restore', 'purge',
                                                 'tag.add', 'tag.remove', 'collection.add',
                                                 'index.exclude', 'index.in')),
  subject_kind  TEXT    NOT NULL CHECK (subject_kind IN ('asset', 'library', 'tag', 'collection', 'app')),
  subject_id    TEXT,
  lib_id        TEXT,
  result        TEXT    CHECK (result IN ('ok', 'skipped', 'failed')),
  detail_json   TEXT
);`,
  // 基线在 at_ms 上点名 "INDEX DESC"：历史列表按时间倒序看 ⇒ 第一屏是索引扫描
  'CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at_ms DESC);',
];

const APP_V3: readonly string[] = Object.freeze([...T_ACTIVITY]);

export const APP_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'greenfield-app-3', statements: APP_V1 }),
  // B2-6：`app_setting` 走**应用级自己的链**（版本号与库级链各算各的，绝不混用）
  Object.freeze({ version: 2, name: 'batch2-app-setting', statements: APP_V2 }),
  // B2-8：`activity` 同样走应用级链（SPEC.md:173 把它列在应用级）
  Object.freeze({ version: 3, name: 'batch2-activity', statements: APP_V3 }),
]);

/** 本程序知道的**应用级**最高版本（从清单派生） */
export const APP_TARGET_SCHEMA_VERSION: number = targetVersionOf(APP_MIGRATIONS);

// ---------------------------------------------------------------- 应有表清单（从 DDL 派生）

/**
 * 应用级 3 张表 = 账本 `app_meta` + 迁移建的 2 张。
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

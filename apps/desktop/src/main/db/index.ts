// apps/desktop/src/main/db/index.ts —— .gs.db 层的公开出口（T-11a）
//
// 为什么给一个 barrel：调用方（T-11b 导入 / T-15 重建入口 / T-14 多库注册表）只该认这一处，
// 而不是各自去记"迁移在 migrations.ts、开库在 open.ts"。
// ⚠️ 本文件**不 import electron、不 import node:sqlite**：node:sqlite 只出现在 sqlite-adapter.ts 里
//    （薄适配层，见该文件头），这样整个 db 层都能在 node --test 里直接跑。
//
// 类型一律用 `export type`（isolatedModules 下必须显式区分值与类型）。

export { GsDbError, describeError } from './errors.ts';
export type { GsDbErrorCode } from './errors.ts';

export { openNodeSqlite, openOrThrow, DEFAULT_BUSY_TIMEOUT_MS } from './sqlite-adapter.ts';
export type {
  SqlDatabase,
  SqlOpenFn,
  SqlOpenOptions,
  SqlRow,
  SqlRunResult,
  SqlStatement,
  SqlValue,
} from './sqlite-adapter.ts';

export {
  MIGRATIONS,
  SCHEMA_VERSION_ROW_ID,
  SCHEMA_VERSION_TABLE,
  TARGET_SCHEMA_VERSION,
  ensureSchemaVersionTable,
  migrate,
  readSchemaVersion,
  targetVersionOf,
  validateMigrations,
} from './migrations.ts';
export type {
  AppliedMigration,
  MigrateOptions,
  Migration,
  MigrationResult,
} from './migrations.ts';

export {
  ITEM_COLUMNS,
  ITEM_FIELD_COLUMNS,
  ITEM_FIELDS,
  ITEM_INSERT_SQL,
  itemRecordToSqlValues,
} from './row-types.ts';
export type { ItemColumn, ItemField, ItemRecord } from './row-types.ts';

export { openGsDb, removeGsDbFiles } from './open.ts';
export type { OpenGsDbOptions, OpenGsDbResult } from './open.ts';

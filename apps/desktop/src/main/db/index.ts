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
// DF-2：行的取值器（bigint ⇒ Number + 安全整数校验，类型不对就抛）—— 全仓只此一份，别在各模块自己写收窄
export {
  changesOf, flagOf, numberOf, numberOrNullOf, textOf, textOrNullOf,
} from './sqlite-adapter.ts';
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
  EXPECTED_TABLES,
  LIBRARY_MIGRATIONS,
  LIBRARY_TABLES,
  LIBRARY_VIRTUAL_TABLES,
  SCHEMA_VERSION_LEDGER,
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
  MigrationLedger,
  MigrationResult,
} from './migrations.ts';

// 应用级 schema（独立账本：app_meta.schema_version）—— S1 绿地
export {
  APP_META_LEDGER,
  APP_META_ROW_ID,
  APP_META_TABLE,
  APP_MIGRATIONS,
  APP_TABLES,
  APP_TARGET_SCHEMA_VERSION,
  migrateApp,
} from './app-migrations.ts';
export type { MigrateAppOptions } from './app-migrations.ts';

// 20 张表的四层分类（唯一来源）
export {
  SCHEMA_LAYER_ORDER,
  SCHEMA_LAYERS,
  appLayerTables,
  libraryLayerTables,
  schemaTables,
  tablesInLayer,
} from './schema-layers.ts';
export type { SchemaLayer } from './schema-layers.ts';

// 迁移机制（库级/应用级共用）—— 表清单派生也在这里
export { createdTableNames, migrateWithLedger, virtualTableNames } from './migration-engine.ts';
export type { MigrateWithLedgerOptions } from './migration-engine.ts';

export {
  ITEM_COLUMNS,
  ITEM_FIELD_COLUMNS,
  ITEM_FIELDS,
  ITEM_INSERT_SQL,
  ITEM_NULLABLE_FIELDS,
  ASSET_ITEM_SELECT_ALL_SQL,
  ASSET_ITEM_SELECT_ONE_SQL,
  ITEM_UPSERT_SQL,
  itemRecordToSqlValues,
  joinedRowToItemRecord,
  parseItemRecord,
} from './row-types.ts';
export type { ItemColumn, ItemField, ItemRecord, ParsedItem } from './row-types.ts';

export { openGsDb, removeGsDbFiles } from './open.ts';
export type { OpenGsDbOptions, OpenGsDbResult } from './open.ts';

export { importItemsFromJson, readIndexItemCount } from './import.ts';
export type { ImportItemsOptions, ImportItemsReport, ImportLibraryRef } from './import.ts';

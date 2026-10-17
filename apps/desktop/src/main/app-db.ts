// apps/desktop/src/main/app-db.ts —— **应用级** app.db（6 张表里的 3 张：app_meta · library_registry · collect_dir）
//
// 依据：reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md §1.1 / §2.2 / §2.3（所有者已批准）。
//
// 为什么单独一个文件（而不是塞进 db/**）：
//   · 库级 `.gs.db` 与应用级 `app.db` 是**两个库文件、两套账本**（schema-layers.ts 的落点裁定）；
//   · 库级那条链（import.ts / row-types.ts）此刻正被 S2 改（storage-worker），S6 不碰它；
//   · §2.3 要求"每张表有唯一写入口" ⇒ 把 3 张应用表的读写**全部收在这一个文件**，
//     于是"谁写 library_registry / collect_dir"是**一眼可查**的（测试会静态钉住，见 tests/app-db.test.mjs）。
//
// ⚠️ 不 import electron：整个 db 侧都要能在 node --test 里直接跑。
// ⚠️ `app_meta` 的写入口**只有迁移**（migrateApp）—— §2.3。本文件只**读**它（诊断页要显示版本）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  changesOf,
  DEFAULT_BUSY_TIMEOUT_MS,
  flagOf,
  GsDbError,
  migrateApp,
  numberOf,
  openNodeSqlite,
  textOf,
  textOrNullOf,
} from './db/index.ts';
import type { MigrationResult, SqlDatabase, SqlRow } from './db/index.ts';

/** 应用级库文件名（唯一来源；落点 = <userData>/app.db） */
export const APP_DB_NAME: string = 'app.db';

/** app.db 的路径（**唯一**一处拼这个名字） */
export function appDbPath(userDataDir: string): string {
  const base = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (!base) throw new GsDbError('DB_PATH_REQUIRED', 'appDbPath 需要非空的 userDataDir');
  return path.join(base, APP_DB_NAME);
}

export interface AppDb {
  db: SqlDatabase;
  dbPath: string;
  migration: MigrationResult;
  close(): void;
}

export interface OpenAppDbOptions {
  userDataDir: string;
  /** 时钟注入（测试用） */
  now?: () => number;
  /** 驱动注入（测试用假驱动） */
  driver?: (filename: string, options?: { timeoutMs?: number }) => SqlDatabase;
}

/**
 * 打开（必要时创建）app.db 并推进到本程序知道的**应用级**版本。
 * 幂等；失败不留半个连接。**只碰应用级账本**，不读也不写 `.gs.db`。
 */
export function openAppDb(options: OpenAppDbOptions): AppDb {
  const dbPath = appDbPath(options.userDataDir);
  const driver = options.driver ?? openNodeSqlite;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = driver(dbPath, { timeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    const migration = migrateApp(db, options.now ? { now: options.now } : {});
    return {
      db,
      dbPath,
      migration,
      close: () => {
        try {
          db.close();
        } catch {
          /* 已关 */
        }
      },
    };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* 已经不可用 */
    }
    throw e;
  }
}

// ---------------------------------------------------------------- 行 → 记录

export interface LibraryRow {
  libId: string;
  root: string;
  displayName: string;
  enabled: boolean;
  compatKey: string | null;
  sortOrder: number;
  registeredAtMs: number;
  updatedAtMs: number;
}

export interface CollectDirRow {
  dirId: string;
  label: string;
  absPath: string;
  isDefault: boolean;
  createdAtMs: number;
}

export interface AppMetaRow {
  schemaVersion: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/**
 * ⚠️⚠️ DF-2（P0 静默数据损坏）：这里原来是自己写的
 *   `const text = (v) => (typeof v === 'string' ? v : '')` / `const num = (v) => (typeof v === 'number' ? v : 0)`，
 *   而适配层明确允许 **bigint** 透出（node:sqlite 的 readBigInts / 将来升级）⇒
 *   `enabled` 静默变 0（**库被悄悄停用**）、`sort_order` 静默变 0、`schema_version` 静默读成 0，
 *   **一句报错都没有**。现在取值统一走**适配层同一套收窄**（sqlite-adapter.ts）：
 *   bigint ⇒ Number() + 安全整数校验；类型不对/越界 ⇒ **抛**（响亮，不猜）。
 *   `enabled` / `is_default` 用 `flagOf` —— DDL 上有 CHECK (col IN (0,1))，读到 7 也必须抛，
 *   否则「7 → false」同样是一次静默停用。
 */
function toLibrary(row: SqlRow): LibraryRow {
  return {
    libId: textOf(row['lib_id'], 'library_registry.lib_id'),
    root: textOf(row['root'], 'library_registry.root'),
    displayName: textOf(row['display_name'], 'library_registry.display_name'),
    enabled: flagOf(row['enabled'], 'library_registry.enabled'),
    compatKey: textOrNullOf(row['compat_key'], 'library_registry.compat_key'),
    sortOrder: numberOf(row['sort_order'], 'library_registry.sort_order'),
    registeredAtMs: numberOf(row['registered_at_ms'], 'library_registry.registered_at_ms'),
    updatedAtMs: numberOf(row['updated_at_ms'], 'library_registry.updated_at_ms'),
  };
}

function toCollectDir(row: SqlRow): CollectDirRow {
  return {
    dirId: textOf(row['dir_id'], 'collect_dir.dir_id'),
    label: textOf(row['label'], 'collect_dir.label'),
    absPath: textOf(row['abs_path'], 'collect_dir.abs_path'),
    isDefault: flagOf(row['is_default'], 'collect_dir.is_default'),
    createdAtMs: numberOf(row['created_at_ms'], 'collect_dir.created_at_ms'),
  };
}

// ---------------------------------------------------------------- 读

/** library_registry 全部行（按 sort_order, lib_id —— 与索引 idx_library_registry_sort 同序） */
export function listLibraries(db: SqlDatabase): LibraryRow[] {
  return db
    .prepare('SELECT * FROM library_registry ORDER BY sort_order, lib_id')
    .all()
    .map(toLibrary);
}

export function getLibrary(db: SqlDatabase, libId: string): LibraryRow | null {
  const row = db.prepare('SELECT * FROM library_registry WHERE lib_id = ?').get(libId);
  return row === undefined ? null : toLibrary(row);
}

/** collect_dir 全部行（默认项排第一，其余按 label） */
export function listCollectDirs(db: SqlDatabase): CollectDirRow[] {
  return db
    .prepare('SELECT * FROM collect_dir ORDER BY is_default DESC, label')
    .all()
    .map(toCollectDir);
}

/** app_meta 单行（迁移写；这里只读 —— 诊断页显示应用级版本） */
export function readAppMeta(db: SqlDatabase): AppMetaRow | null {
  const row = db.prepare('SELECT * FROM app_meta WHERE id = 1').get();
  if (row === undefined) return null;
  // ⚠️ schema_version 走**同一套**收窄：bigint 静默变 0 会让诊断页把账本报成 0（DF-2）
  return {
    schemaVersion: numberOf(row['schema_version'], 'app_meta.schema_version'),
    createdAtMs: numberOf(row['created_at_ms'], 'app_meta.created_at_ms'),
    updatedAtMs: numberOf(row['updated_at_ms'], 'app_meta.updated_at_ms'),
  };
}

// ---------------------------------------------------------------- 写：library_registry（唯一写入口）

/**
 * 路径规范化（登记前必须做 —— DDL 注释里那两个 Windows 事实）：
 *   `root` 的 UNIQUE 是**文本比较**：`G:\Model`/`g:\model`、`G:\PROGRA~1\x`/`G:\Program Files\x`
 *   是同一个目录却算两行 ⇒ 落库前统一成规范形：**真实大小写 + 长名 + 无尾分隔符**。
 * 目录不存在时退回 `path.resolve`（登记前主进程会先校验存在性，这里只是兜底，不假装成功）。
 */
export function normalizeRootPath(root: string): string {
  const raw = typeof root === 'string' ? root.trim() : '';
  if (!raw) throw new GsDbError('IMPORT_INPUT_INVALID', 'normalizeRootPath 需要非空路径');
  let resolved = path.resolve(raw);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* 不存在/无权限：保持 resolve 的结果 */
  }
  const trimmed = resolved.replace(/[\\/]+$/, '');
  return trimmed || resolved;
}

export function nextSortOrder(db: SqlDatabase): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM library_registry')
    .get();
  // COALESCE(MAX(...), -1) 保证这行**一定存在**且是数字；不是就抛（不静默给 0）
  return numberOf(row === undefined ? undefined : row['n'], 'library_registry.MAX(sort_order)+1');
}

export interface InsertLibraryInput {
  libId: string;
  root: string;
  displayName?: string;
  compatKey?: string | null;
  enabled?: boolean;
  sortOrder?: number;
  now?: () => number;
}

/** 登记一个库（写 library_registry）。root 会先规范化；主键冲突/UNIQUE 冲突**如实抛**。 */
export function insertLibrary(db: SqlDatabase, input: InsertLibraryInput): LibraryRow {
  const now = input.now ?? Date.now;
  const ts = now();
  db.prepare(
    'INSERT INTO library_registry (lib_id, root, display_name, enabled, compat_key, sort_order, registered_at_ms, updated_at_ms) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.libId,
    normalizeRootPath(input.root),
    input.displayName && input.displayName.trim() ? input.displayName.trim() : input.libId,
    input.enabled === false ? 0 : 1,
    input.compatKey ?? null,
    typeof input.sortOrder === 'number' ? input.sortOrder : nextSortOrder(db),
    ts,
    ts,
  );
  const row = getLibrary(db, input.libId);
  if (row === null)
    throw new GsDbError('UNEXPECTED_SQL_VALUE', '登记后读不回这一行：' + input.libId);
  return row;
}

/** 停用/启用（**不动任何文件** —— 停用不等于删除） */
export function updateLibraryEnabled(
  db: SqlDatabase,
  libId: string,
  enabled: boolean,
  now: () => number = Date.now,
): LibraryRow | null {
  db.prepare('UPDATE library_registry SET enabled = ?, updated_at_ms = ? WHERE lib_id = ?').run(
    enabled ? 1 : 0,
    now(),
    libId,
  );
  return getLibrary(db, libId);
}

export function updateLibrarySortOrder(
  db: SqlDatabase,
  libId: string,
  sortOrder: number,
  now: () => number = Date.now,
): LibraryRow | null {
  db.prepare('UPDATE library_registry SET sort_order = ?, updated_at_ms = ? WHERE lib_id = ?').run(
    sortOrder,
    now(),
    libId,
  );
  return getLibrary(db, libId);
}

/**
 * 更新一个已登记库的 root / 显示名（**保持** enabled 与 sort_order —— 那两个是用户的意图）。
 * ⚠️ 为什么做成函数而不是让调用方自己写 SQL：§2.3 要求每张表**唯一写入口**，
 *    静态测试（tests/app-db.test.mjs 的 D4）会扫描 main/** 里的字面 SQL —— 调用方自己写就红。
 */
export function updateLibraryRootAndName(
  db: SqlDatabase,
  libId: string,
  root: string,
  displayName: string,
  now: () => number = Date.now,
): LibraryRow | null {
  db.prepare(
    'UPDATE library_registry SET root = ?, display_name = ?, updated_at_ms = ? WHERE lib_id = ?',
  ).run(normalizeRootPath(root), displayName, now(), libId);
  return getLibrary(db, libId);
}

export function deleteLibrary(db: SqlDatabase, libId: string): boolean {
  // changes 在适配层声明的类型就是 number | bigint ⇒ 走同一套收窄（不许 > 0 隐式比较 bigint）
  return (
    changesOf(
      db.prepare('DELETE FROM library_registry WHERE lib_id = ?').run(libId),
      'library_registry DELETE',
    ) > 0
  );
}

// ---------------------------------------------------------------- 应用设置（唯一写入口 + **唯一**优先级实现）

/** 一条应用设置。`valueJson` 是**原样**的 JSON 文本（解析走 `readSettingValue`）。 */
export interface AppSettingRow {
  key: string;
  valueJson: string;
  updatedAtMs: number;
}

/** 设置的来源：库 / 旧 config.json 回退 / 两侧都没有 */
export type SettingSource = 'db' | 'legacy' | 'missing';

export interface ResolvedSetting {
  key: string;
  value: unknown;
  source: SettingSource;
}

function toSettingRow(row: SqlRow): AppSettingRow {
  return {
    key: textOf(row['key'], 'app_setting.key'),
    valueJson: textOf(row['value_json'], 'app_setting.value_json'),
    updatedAtMs: numberOf(row['updated_at_ms'], 'app_setting.updated_at_ms'),
  };
}

/** 全部设置（按 key 升序；确定性顺序，测试/界面都靠它） */
export function listSettings(db: SqlDatabase): AppSettingRow[] {
  return db
    .prepare('SELECT "key", value_json, updated_at_ms FROM app_setting ORDER BY "key"')
    .all()
    .map(toSettingRow);
}

/** 读一条（没有 = null，**不编一个默认值** —— 缺省值属于调用方/界面的事） */
export function getSetting(db: SqlDatabase, key: string): AppSettingRow | null {
  const row = db
    .prepare('SELECT "key", value_json, updated_at_ms FROM app_setting WHERE "key" = ?')
    .get(key);
  return row === undefined ? null : toSettingRow(row);
}

/**
 * 把 `value_json` 解析回值。**坏 JSON 抛错**（`SETTING_VALUE_UNREADABLE`），不静默当"没有设置" ——
 * 后者会让用户以为"我的设置丢了"，而真相是那条记录坏了。
 */
export function readSettingValue<T = unknown>(row: AppSettingRow): T {
  try {
    return JSON.parse(row.valueJson) as T;
  } catch (e) {
    throw new GsDbError(
      'SETTING_VALUE_UNREADABLE',
      '设置 ' +
        row.key +
        ' 的值不是合法 JSON（' +
        (e instanceof Error ? e.message : String(e)) +
        '）',
      { cause: e },
    );
  }
}

/**
 * 写一条设置（upsert）。`value` 可以是字符串/数字/布尔/数组/对象 —— **统一存 JSON**，
 * 所以"加一个新设置"**不需要迁移**（这正是基线给 `value_json` 的理由）。
 */
export function writeSetting(
  db: SqlDatabase,
  key: string,
  value: unknown,
  now: () => number = Date.now,
): AppSettingRow {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) throw new GsDbError('SETTING_KEY_REQUIRED', 'writeSetting 需要一个非空的设置键');
  if (value === undefined) {
    // undefined 不是 JSON 能表达的值；静默写成 "null" 会让"我设过"和"没设过"混在一起
    throw new GsDbError(
      'SETTING_KEY_REQUIRED',
      '设置 ' + k + ' 的值不能是 undefined（JSON 表达不了）',
    );
  }
  db.prepare(
    'INSERT INTO app_setting ("key", value_json, updated_at_ms) VALUES (?, ?, ?) ' +
      'ON CONFLICT("key") DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms',
  ).run(k, JSON.stringify(value), now());
  const row = getSetting(db, k);
  if (!row) throw new GsDbError('META_ROW_MISSING', '写完设置却读不回来：' + k);
  return row;
}

/**
 * **与 `config.json` 的关系 —— 全仓唯一一处实现**（口径写在 `db/app-migrations.ts` 的 `T_APP_SETTING` 注释里）。
 *
 * 规则（**库优先 + 旧文件只读回退**）：
 *   ① `app_setting` 有该键 ⇒ 用它（`source: 'db'`）；
 *   ② 没有 ⇒ **才**回退到旧的 `config.json`（`source: 'legacy'`）；
 *   ③ 两侧都没有 ⇒ `source: 'missing'`（`value: undefined`）。
 * ⚠️ **不回写**：读完不把旧值搬进库。回写会让"用户删掉库里的键"被旧文件**复活** ——
 *    那正是"两份真相"的经典 bug（用户明明删了，重启又回来）。真要搬运 = 一次性迁移脚本的事。
 * ⚠️ 本函数是**唯一**决定优先级的地方：别处不许再写"先看 config 再看库"之类的第二套。
 */
export function resolveSetting(
  db: SqlDatabase,
  key: string,
  legacy: Record<string, unknown> | null,
): ResolvedSetting {
  const row = getSetting(db, key);
  if (row) return { key, value: readSettingValue(row), source: 'db' };
  if (legacy && Object.prototype.hasOwnProperty.call(legacy, key)) {
    return { key, value: legacy[key], source: 'legacy' };
  }
  return { key, value: undefined, source: 'missing' };
}

// ---------------------------------------------------------------- 写：collect_dir（唯一写入口）

export interface InsertCollectDirInput {
  absPath: string;
  label: string;
  makeDefault?: boolean;
  now?: () => number;
}

/** 追加一条白名单（dir_id 由本模块生成 —— 不自己拼随机，用 Node 内置 UUID） */
export function insertCollectDir(db: SqlDatabase, input: InsertCollectDirInput): CollectDirRow {
  const abs = path.resolve(String(input.absPath).trim());
  const label = String(input.label).trim();
  if (!abs || !label)
    throw new GsDbError('IMPORT_INPUT_INVALID', 'collectDirAdd 需要非空的 absPath 与 label');
  const dirId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO collect_dir (dir_id, label, abs_path, is_default, created_at_ms) VALUES (?, ?, ?, 0, ?)',
  ).run(dirId, label, abs, (input.now ?? Date.now)());
  const rows = listCollectDirs(db);
  const created = rows.find((r) => r.dirId === dirId);
  if (!created) throw new GsDbError('UNEXPECTED_SQL_VALUE', '写入后读不回这条白名单：' + dirId);
  return input.makeDefault === true ? (setDefaultCollectDir(db, dirId) as CollectDirRow) : created;
}

export function deleteCollectDir(db: SqlDatabase, dirId: string): boolean {
  return (
    changesOf(
      db.prepare('DELETE FROM collect_dir WHERE dir_id = ?').run(dirId),
      'collect_dir DELETE',
    ) > 0
  );
}

/**
 * 把某一条设成默认（其余清 0）。
 * ⚠️ **单事务**：表上有"只允许一个 is_default=1"的**唯一索引**（DDL 落成数据库约束，不靠 UI 自觉）
 *    ⇒ 先清后设必须在同一事务里，否则中途撞唯一索引。
 * 返回更新后的那一行；dirId 不存在返回 null（不改动任何行）。
 */
export function setDefaultCollectDir(db: SqlDatabase, dirId: string): CollectDirRow | null {
  const target = listCollectDirs(db).find((r) => r.dirId === dirId);
  if (!target) return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE collect_dir SET is_default = 0 WHERE is_default = 1').run();
    db.prepare('UPDATE collect_dir SET is_default = 1 WHERE dir_id = ?').run(dirId);
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败：原样抛出下面的错 */
    }
    throw e;
  }
  return listCollectDirs(db).find((r) => r.dirId === dirId) ?? null;
}

// ---------------------------------------------------------------- 操作记录 `activity`（WIRE-B：真正接上写入）

/** `activity.kind` 的合法值（与 DDL 的 CHECK 逐字一致）。写入口按它收窄，避免写进数据库会被拒的值。 */
export type ActivityKind =
  | 'collect'
  | 'deliver'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'tag.add'
  | 'tag.remove'
  | 'collection.add'
  | 'index.exclude'
  | 'index.in';

/** `activity.subject_kind` 的合法值（与 DDL 的 CHECK 逐字一致） */
export type ActivitySubjectKind = 'asset' | 'library' | 'tag' | 'collection' | 'app';

/** `activity.result` —— 与 `asset_export.result` **同一套词**（ok/skipped/failed） */
export type ActivityResult = 'ok' | 'skipped' | 'failed';

export interface InsertActivityInput {
  /** **一次批量操作共用一个 id**（它就是 `asset_export.batch_id`）；基线写 nanoid，本仓未装该依赖 ⇒ 由调用方用 crypto.randomUUID() 生成 */
  activityId: string;
  kind: ActivityKind;
  subjectKind: ActivitySubjectKind;
  atMs?: number;
  /** 对象 id；**批量操作时为空**（明细在 detail 里） */
  subjectId?: string | null;
  /** 操作发生在哪个库；**不属于任何库的操作**（如登记库）为空 */
  libId?: string | null;
  result?: ActivityResult | null;
  /**
   * **结构化参数**（会 `JSON.stringify` 进去）—— 不存渲染好的文字。
   * 界面那一侧才是渲染的唯一来源；这里只保证"当时的参数原样留在库里"。
   */
  detail?: unknown;
}

/**
 * 写一条操作记录 —— **`activity` 的唯一写入口**（§2.3「每张表一个写入口」；D4 会静态钉住"只有本文件写它"）。
 *
 * 为什么不在 `db/**`（业务层）里写：`activity` 是**应用级**表（`SPEC.md:173` ⇒ 在 `app.db`），
 *   而本文件就是应用级表的唯一写入口 —— 与 `library_registry`/`collect_dir`/`app_setting` 同一条纪律。
 * 为什么 `detail` 存 JSON 而不是文字：渲染是界面的事；写成文字就**固化了当时的措辞**，
 *   以后改文案要么改不动、要么得回头改数据（而且没法按参数统计）。
 *
 * ⚠️ 本函数**不吞错**：写失败就抛（调用方 —— `main/collect-ledger.ts` —— 会记日志并把它变成
 *   "文件已复制，但操作记录没写成"的**非静默**警告，而不是让取件假装失败）。
 */
export function insertActivity(db: SqlDatabase, input: InsertActivityInput): void {
  const atMs = typeof input.atMs === 'number' ? input.atMs : Date.now();
  const detail =
    input.detail === undefined || input.detail === null ? null : JSON.stringify(input.detail);
  db.prepare(
    'INSERT INTO activity (activity_id, at_ms, kind, subject_kind, subject_id, lib_id, result, detail_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.activityId,
    atMs,
    input.kind,
    input.subjectKind,
    input.subjectId ?? null,
    input.libId ?? null,
    input.result ?? null,
    detail,
  );
}

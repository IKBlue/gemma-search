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

import { DEFAULT_BUSY_TIMEOUT_MS, GsDbError, migrateApp, openNodeSqlite } from './db/index.ts';
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
    return { db, dbPath, migration, close: () => { try { db.close(); } catch { /* 已关 */ } } };
  } catch (e) {
    try { db.close(); } catch { /* 已经不可用 */ }
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

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

function toLibrary(row: SqlRow): LibraryRow {
  return {
    libId: text(row['lib_id']),
    root: text(row['root']),
    displayName: text(row['display_name']),
    enabled: num(row['enabled']) === 1,
    compatKey: typeof row['compat_key'] === 'string' ? row['compat_key'] : null,
    sortOrder: num(row['sort_order']),
    registeredAtMs: num(row['registered_at_ms']),
    updatedAtMs: num(row['updated_at_ms']),
  };
}

function toCollectDir(row: SqlRow): CollectDirRow {
  return {
    dirId: text(row['dir_id']),
    label: text(row['label']),
    absPath: text(row['abs_path']),
    isDefault: num(row['is_default']) === 1,
    createdAtMs: num(row['created_at_ms']),
  };
}

// ---------------------------------------------------------------- 读

/** library_registry 全部行（按 sort_order, lib_id —— 与索引 idx_library_registry_sort 同序） */
export function listLibraries(db: SqlDatabase): LibraryRow[] {
  return db.prepare('SELECT * FROM library_registry ORDER BY sort_order, lib_id').all().map(toLibrary);
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
  return { schemaVersion: num(row['schema_version']), createdAtMs: num(row['created_at_ms']), updatedAtMs: num(row['updated_at_ms']) };
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
  } catch { /* 不存在/无权限：保持 resolve 的结果 */ }
  const trimmed = resolved.replace(/[\\/]+$/, '');
  return trimmed || resolved;
}

export function nextSortOrder(db: SqlDatabase): number {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM library_registry').get();
  return num(row === undefined ? 0 : row['n']);
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
  if (row === null) throw new GsDbError('UNEXPECTED_SQL_VALUE', '登记后读不回这一行：' + input.libId);
  return row;
}

/** 停用/启用（**不动任何文件** —— 停用不等于删除） */
export function updateLibraryEnabled(db: SqlDatabase, libId: string, enabled: boolean, now: () => number = Date.now): LibraryRow | null {
  db.prepare('UPDATE library_registry SET enabled = ?, updated_at_ms = ? WHERE lib_id = ?').run(enabled ? 1 : 0, now(), libId);
  return getLibrary(db, libId);
}

export function updateLibrarySortOrder(db: SqlDatabase, libId: string, sortOrder: number, now: () => number = Date.now): LibraryRow | null {
  db.prepare('UPDATE library_registry SET sort_order = ?, updated_at_ms = ? WHERE lib_id = ?').run(sortOrder, now(), libId);
  return getLibrary(db, libId);
}

/**
 * 更新一个已登记库的 root / 显示名（**保持** enabled 与 sort_order —— 那两个是用户的意图）。
 * ⚠️ 为什么做成函数而不是让调用方自己写 SQL：§2.3 要求每张表**唯一写入口**，
 *    静态测试（tests/app-db.test.mjs 的 D4）会扫描 main/** 里的字面 SQL —— 调用方自己写就红。
 */
export function updateLibraryRootAndName(
  db: SqlDatabase, libId: string, root: string, displayName: string, now: () => number = Date.now,
): LibraryRow | null {
  db.prepare('UPDATE library_registry SET root = ?, display_name = ?, updated_at_ms = ? WHERE lib_id = ?')
    .run(normalizeRootPath(root), displayName, now(), libId);
  return getLibrary(db, libId);
}

export function deleteLibrary(db: SqlDatabase, libId: string): boolean {
  return db.prepare('DELETE FROM library_registry WHERE lib_id = ?').run(libId).changes > 0;
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
  if (!abs || !label) throw new GsDbError('IMPORT_INPUT_INVALID', 'collectDirAdd 需要非空的 absPath 与 label');
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
  return db.prepare('DELETE FROM collect_dir WHERE dir_id = ?').run(dirId).changes > 0;
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
    try { db.exec('ROLLBACK'); } catch { /* 回滚失败：原样抛出下面的错 */ }
    throw e;
  }
  return listCollectDirs(db).find((r) => r.dirId === dirId) ?? null;
}

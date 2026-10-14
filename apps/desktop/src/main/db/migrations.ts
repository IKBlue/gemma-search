// apps/desktop/src/main/db/migrations.ts —— .gs.db 的建表与迁移机制（T-11a 要求 ②③）
//
// 机制（为什么长这样）：
//   · 版本记在**元表 schema_version**（单行，id=1），不用 PRAGMA user_version。
//     理由：元表是普通表，能被 SQL 查询/断言，还能顺带记 updated_at；PRAGMA 只能走 C API。
//     **版本只有这一处真相来源** —— 不额外同步 user_version，两个来源迟早对不上（P1）。
//   · 迁移是**只追加**的有序清单。历史条目不许改、不许挖洞；版本号必须从 current+1 连续推进，
//     否则抛 SCHEMA_GAP（而不是"跳到最大版本"糊过去 —— 那会跳过没人跑过的中间态）。
//   · 每条迁移跑在**一个事务**里（BEGIN IMMEDIATE … COMMIT）。DDL 在 SQLite 里是事务性的，
//     所以中途失败整条回滚、schema_version 停在上一条 —— 不会留下"半张表 + 已记账"的中间态。
//   · **幂等**：没有任何 version > current 的迁移时，不执行任何 DDL、不报错；DDL 本身也全带
//     IF NOT EXISTS（双保险，应付"元表被手删但表还在"这种手工状态）。
//   · 库里的版本**高于**本程序知道的版本 ⇒ 抛 SCHEMA_TOO_NEW，不降级瞎改；
//     处置照 SPEC §2.1：.gs.db 是派生数据，删掉重建。
//
// 表覆盖（要求 ③）：
//   v1 core        : library（库元信息）· items（条目，18 字段对齐 items.json）
//   v2 docs+health : doc_dirs · documents · doc_chunks（P7 才用，**先建表**）· health_runs · health_ledger（体检台账）
//
// 为什么 doc_chunks 现在就建：P7 文档检索是**门控**项（进入条件 = 先拿到 10–30 份真实文档），
//   但表结构在 SPEC §1.2 已经定死。先把表建好，P7 开工时不必再改 schema（也就不必写一条新迁移）。
//
// 为什么拆成 v1/v2 而不是一条：拆分让"按序推进"这件事**可被测试**(先只跑 v1、再跑全量)，
//   也给了未来"只改了文档表"的改动一个不碰核心表的落点。

import { GsDbError } from './errors.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

/** 一条迁移：版本号 + 名字 + 一组幂等 SQL 语句 */
export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/** 元表名（唯一来源；测试与调用方都用它，不各自写字符串） */
export const SCHEMA_VERSION_TABLE: string = 'schema_version';

/** 元表只有一行，主键固定为 1（CHECK 一起把这条不变式钉在库里） */
export const SCHEMA_VERSION_ROW_ID: number = 1;

/**
 * 元表本身**不参与迁移**：它是迁移机制的账本，先于任何迁移存在。
 * CHECK (id = 1) 让"只允许一行"成为**库级**约束，而不是靠调用方自觉。
 */
const CREATE_SCHEMA_VERSION_TABLE: string = `
CREATE TABLE IF NOT EXISTS schema_version (
  id         INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  version    INTEGER NOT NULL CHECK (version >= 0),
  updated_at INTEGER NOT NULL
);`;

const INSERT_SCHEMA_VERSION_ROW: string =
  'INSERT OR IGNORE INTO schema_version (id, version, updated_at) VALUES (1, 0, ?)';
const READ_SCHEMA_VERSION: string = 'SELECT version FROM schema_version WHERE id = 1';
const UPDATE_SCHEMA_VERSION: string = 'UPDATE schema_version SET version = ?, updated_at = ? WHERE id = 1';

// ---------------------------------------------------------------- v1：核心表

/**
 * v1 · core：库元信息 + 条目。
 *
 * items 的 18 个字段与 data/libraries/L1/items.json 逐字对齐（字段↔列的配对在 row-types.ts，
 * 那里是唯一来源；本文件的列顺序必须与 ITEM_COLUMNS 一致，测试会核对）。
 */
const V1_CORE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS library (
  lib_id             TEXT    PRIMARY KEY NOT NULL,
  root               TEXT    NOT NULL,
  fallback           INTEGER NOT NULL DEFAULT 0 CHECK (fallback IN (0, 1)),
  compat             TEXT,
  compat_key_version INTEGER,
  model_repo         TEXT,
  model_revision     TEXT,
  dim                INTEGER,
  seq                INTEGER,
  item_count         INTEGER NOT NULL DEFAULT 0,
  meta_json          TEXT,
  registered_at      INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);`,

  `
CREATE TABLE IF NOT EXISTS items (
  uid              TEXT    PRIMARY KEY NOT NULL,
  lib_id           TEXT    NOT NULL REFERENCES library (lib_id) ON DELETE CASCADE,
  folder           TEXT    NOT NULL,
  stem             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  rel_path         TEXT    NOT NULL,
  abs_path         TEXT    NOT NULL,
  image_ext        TEXT    NOT NULL,
  image_size       INTEGER NOT NULL,
  image_mtime      INTEGER NOT NULL,
  archive_name     TEXT,
  archive_rel_path TEXT,
  archive_abs_path TEXT,
  archive_ext      TEXT,
  archive_size     INTEGER,
  archive_mtime    INTEGER,
  vector_row       INTEGER,
  vector_source    TEXT
);`,

  'CREATE INDEX IF NOT EXISTS idx_items_lib_folder ON items (lib_id, folder);',
  'CREATE INDEX IF NOT EXISTS idx_items_lib_vector_row ON items (lib_id, vector_row);',
  'CREATE INDEX IF NOT EXISTS idx_items_stem ON items (stem);',
  'CREATE INDEX IF NOT EXISTS idx_items_archive_name ON items (lib_id, archive_name);',
];

// ---------------------------------------------------------------- v2：文档分块 + 体检台账

/**
 * v2 · docs-and-health：SPEC §1.2 的文档/分块三张表 + F5 体检台账两张表。
 * 全部先建表，P7 只写数据不改 schema。
 *
 * 规范化取舍：doc_chunks **不**冗余 lib_id（documents 里已有），健康台账条目也**不**冗余 lib_id
 * （health_runs 里已有）—— 冗余列就是第二个真相来源，迟早和主表对不上（P1）。
 * 要按库筛就 join，SQLite 有索引，代价可忽略。
 */
const V2_DOCS_HEALTH: readonly string[] = [
  // ---- SPEC §1.2「文档目录登记」
  `
CREATE TABLE IF NOT EXISTS doc_dirs (
  dir_id       TEXT    PRIMARY KEY NOT NULL,
  lib_id       TEXT    NOT NULL REFERENCES library (lib_id) ON DELETE CASCADE,
  abs_path     TEXT    NOT NULL,
  added_at     INTEGER NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_scan_at INTEGER
);`,
  'CREATE INDEX IF NOT EXISTS idx_doc_dirs_lib ON doc_dirs (lib_id);',

  // ---- SPEC §1.2「文档」
  `
CREATE TABLE IF NOT EXISTS documents (
  doc_id     TEXT PRIMARY KEY NOT NULL,
  lib_id     TEXT NOT NULL REFERENCES library (lib_id) ON DELETE CASCADE,
  dir_id     TEXT REFERENCES doc_dirs (dir_id) ON DELETE SET NULL,
  abs_path   TEXT NOT NULL,
  rel_path   TEXT,
  ext        TEXT NOT NULL,
  size       INTEGER,
  mtime      INTEGER,
  sha1       TEXT,
  pages      INTEGER,
  status     TEXT NOT NULL DEFAULT 'ok',
  error      TEXT,
  indexed_at INTEGER
);`,
  'CREATE INDEX IF NOT EXISTS idx_documents_lib ON documents (lib_id);',
  'CREATE INDEX IF NOT EXISTS idx_documents_dir ON documents (dir_id);',
  'CREATE INDEX IF NOT EXISTS idx_documents_sha1 ON documents (sha1);',

  // ---- SPEC §1.2「分块」：chunkId · docId · seq · text · vectorRow · page
  //      + char_start/char_end（分块重叠需要知道原文区间）+ embed_state（P7 的编码进度）
  //      char_start/char_end/vector_row/page 可空：能取到就写，取不到不发明 0（0 是合法页号）
  `
CREATE TABLE IF NOT EXISTS doc_chunks (
  chunk_id    TEXT    PRIMARY KEY NOT NULL,
  doc_id      TEXT    NOT NULL REFERENCES documents (doc_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  char_start  INTEGER,
  char_end    INTEGER,
  page        INTEGER,
  vector_row  INTEGER,
  embed_state TEXT    NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL,
  UNIQUE (doc_id, seq)
);`,
  // UNIQUE (doc_id, seq) 自带索引，不再单独建 (doc_id, …)
  'CREATE INDEX IF NOT EXISTS idx_doc_chunks_vector_row ON doc_chunks (vector_row);',

  // ---- SPEC §F5 体检：一次运行 = 一组检查结果
  `
CREATE TABLE IF NOT EXISTS health_runs (
  run_id       TEXT    PRIMARY KEY NOT NULL,
  lib_id       TEXT    NOT NULL REFERENCES library (lib_id) ON DELETE CASCADE,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  status       TEXT    NOT NULL DEFAULT 'running',
  item_count   INTEGER,
  summary_json TEXT
);`,
  'CREATE INDEX IF NOT EXISTS idx_health_runs_lib ON health_runs (lib_id, started_at);',

  // ---- 体检台账：每条发现一行（缺包 / 有包无图 / 零字节 / 扩展名不符 / 精确重复 / 疑似重复 / 索引健康）
  //      不用 AUTOINCREMENT：台账按 run_id 分组，rowid 删除后复用对语义无影响，
  //      而 AUTOINCREMENT 会多出一张 sqlite_sequence 内部表，污染"表清单"这类断言。
  `
CREATE TABLE IF NOT EXISTS health_ledger (
  entry_id    INTEGER PRIMARY KEY,
  run_id      TEXT    NOT NULL REFERENCES health_runs (run_id) ON DELETE CASCADE,
  check_id    TEXT    NOT NULL,
  severity    TEXT    NOT NULL,
  target_uid  TEXT,
  target_path TEXT,
  detail      TEXT    NOT NULL,
  detail_json TEXT,
  created_at  INTEGER NOT NULL
);`,
  'CREATE INDEX IF NOT EXISTS idx_health_ledger_run ON health_ledger (run_id, check_id);',
  'CREATE INDEX IF NOT EXISTS idx_health_ledger_uid ON health_ledger (target_uid);',
];

/** 迁移清单（**只追加**；顺序即执行顺序） */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'core', statements: V1_CORE }),
  Object.freeze({ version: 2, name: 'docs-and-health', statements: V2_DOCS_HEALTH }),
]);

/**
 * 一份清单里的最高版本（空清单 = 0）。
 * 单独导出：open.ts 的只读路径也要报 targetVersion，不能各写一遍 reduce（P2）。
 */
export function targetVersionOf(migrations: readonly Migration[]): number {
  return migrations.reduce((max: number, m: Migration) => Math.max(max, m.version), 0);
}

/** 本程序知道的最高版本（MIGRATIONS 派生，不另写一个数字） */
export const TARGET_SCHEMA_VERSION: number = targetVersionOf(MIGRATIONS);

// ---------------------------------------------------------------- 结果类型

export interface AppliedMigration {
  version: number;
  name: string;
}

export interface MigrationResult {
  /** 迁移前库里的版本 */
  fromVersion: number;
  /** 迁移后库里的版本 */
  toVersion: number;
  /** 本次清单里的最高版本 */
  targetVersion: number;
  /** 本次**实际执行**的迁移（按序）；幂等重跑时为空数组 */
  applied: AppliedMigration[];
  /** applied 为空 ⇒ 库已经是目标版本，什么都没做 */
  upToDate: boolean;
}

export interface MigrateOptions {
  /** 覆盖迁移清单（测试用它做"先 v1 再 v2"和"注入一条坏迁移"） */
  migrations?: readonly Migration[];
  /** 时钟注入（applied_at 可复现） */
  now?: () => number;
}

// ---------------------------------------------------------------- 元表读写

/** 建元表（IF NOT EXISTS）并保证 id=1 那一行存在；每次 migrate 都调，代价是两条 no-op 语句 */
export function ensureSchemaVersionTable(db: SqlDatabase, now: () => number): void {
  db.exec(CREATE_SCHEMA_VERSION_TABLE);
  db.prepare(INSERT_SCHEMA_VERSION_ROW).run(now());
}

/** 读当前版本；元表没有 id=1 的行 = 建表逻辑被绕过，抛错而不是"当成 0" */
export function readSchemaVersion(db: SqlDatabase): number {
  const row = db.prepare(READ_SCHEMA_VERSION).get();
  const value = row === undefined ? undefined : row['version'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new GsDbError(
      'META_ROW_MISSING',
      `${SCHEMA_VERSION_TABLE} 里没有可用的 id=${SCHEMA_VERSION_ROW_ID} 版本行（读到 ${String(value)}）—— ` +
        '建表逻辑被绕过或文件被外部改过；删掉 .gs.db 会按 SPEC §2.1 重建。',
    );
  }
  return value;
}

/** 迁移清单自身的合法性：正整数版本、严格递增、名字非空 */
export function validateMigrations(migrations: readonly Migration[]): void {
  let prev = 0;
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version <= 0) {
      throw new GsDbError('MIGRATION_LIST_INVALID', `迁移版本号必须是正整数，实际是 ${String(m.version)}`);
    }
    if (!m.name) {
      throw new GsDbError('MIGRATION_LIST_INVALID', `迁移 v${m.version} 缺少名字`);
    }
    if (m.version <= prev) {
      throw new GsDbError(
        'MIGRATION_LIST_INVALID',
        `迁移版本必须严格递增：v${prev} 之后出现 v${m.version}`,
      );
    }
    prev = m.version;
  }
}

/** 执行一条迁移（自带事务与回滚；失败时版本号保持在上一条） */
function applyOne(db: SqlDatabase, m: Migration, now: () => number): void {
  let began = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    began = true;
    for (const statement of m.statements) db.exec(statement);
    db.prepare(UPDATE_SCHEMA_VERSION).run(m.version, now());
    db.exec('COMMIT');
    began = false;
  } catch (e) {
    let rollbackNote = '';
    if (began) {
      try {
        db.exec('ROLLBACK');
      } catch (re) {
        // 回滚失败也必须留痕 —— 否则下一次打开会看到一个没人解释得了的中间态
        rollbackNote = `；且回滚也失败了（${describe(e)}）`;
      }
    }
    throw new GsDbError(
      'MIGRATION_FAILED',
      `迁移 v${m.version}（${m.name}）失败，已回滚，库仍停在 v${m.version - 1}${rollbackNote}：${describe(e)}`,
      { cause: e },
    );
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- 总入口

/**
 * 把库推进到清单里的最高版本。**幂等**：已是最新就什么都不做、也不报错。
 *
 * 不负责：建父目录、开库（那是 open.ts）、删库重建（removeGsDbFiles）。
 */
export function migrate(db: SqlDatabase, opts: MigrateOptions = {}): MigrationResult {
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? Date.now;
  validateMigrations(migrations);
  ensureSchemaVersionTable(db, now);

  const fromVersion = readSchemaVersion(db);
  const targetVersion = targetVersionOf(migrations);

  if (fromVersion > targetVersion) {
    throw new GsDbError(
      'SCHEMA_TOO_NEW',
      `库里的 schema 版本 v${fromVersion} 高于本程序知道的 v${targetVersion} —— ` +
        '不降级瞎改（那会把新版本的列当成不存在）。.gs.db 是派生数据：删掉它（连 -wal/-shm）会按 SPEC §2.1 重建。',
    );
  }

  const pending = migrations
    .filter((m) => m.version > fromVersion)
    .slice()
    .sort((a, b) => a.version - b.version);

  const applied: AppliedMigration[] = [];
  let current = fromVersion;
  for (const m of pending) {
    if (m.version !== current + 1) {
      throw new GsDbError(
        'SCHEMA_GAP',
        `迁移清单断代：库在 v${current}，下一条却是 v${m.version}（必须是 v${current + 1}）—— 迁移历史只许追加`,
      );
    }
    applyOne(db, m, now);
    applied.push({ version: m.version, name: m.name });
    current = m.version;
  }

  return { fromVersion, toVersion: current, targetVersion, applied, upToDate: applied.length === 0 };
}

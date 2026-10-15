// apps/desktop/src/main/db/migration-engine.ts —— 迁移机制的**唯一实现**（库级与应用级共用）
//
// 为什么把「机制」与「DDL」拆开（2026-10-15 · S1 绿地 schema）：
//   绿地 schema 有**两套账本**：
//     · 库级 `.gs.db`   → 版本记在 `schema_version`（沿用既有机制）
//     · 应用级 `app.db` → 版本记在 `app_meta.schema_version`（提案 app_meta 卡的原始设计：
//       单行守卫 + schema_version，本身就是一张账本表）
//   两套账本必须**各自独立**推进（推进一个不得动另一个），但「建账本 → 读版本 → 逐条事务推进
//   → 写版本」这套机制**只能有一份实现**（AGENTS P1/P2）。
//   ⇒ 机制收在本文件；两侧（migrations.ts / app-migrations.ts）只提供「账本描述 + DDL 清单」。
//
// 账本自己带 **DDL 文本**（`ddl`）："应有表清单从 DDL 派生"这条纪律才落得下来 ——
//   测试拿 sqlite_master 与 DDL 派生出的清单机械核对，不另写第二份手写表名（P1）。
//
// 迁移语义（与 T-11a 逐条一致，只把账本参数化）：
//   · 只追加的有序清单；版本号从 current+1 连续推进，否则抛 SCHEMA_GAP（不跳到最大版本糊过去）；
//   · 每条迁移跑在一个事务里（BEGIN IMMEDIATE … COMMIT），中途失败整条回滚、版本停在上一条；
//   · 幂等：没有待跑迁移时**不执行任何 DDL**、不报错；
//   · 库里版本**高于**本程序知道的版本 ⇒ SCHEMA_TOO_NEW，不降级瞎改（删掉重建，SPEC §2.1）。

import { GsDbError } from './errors.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

/** 一条迁移：版本号 + 名字 + 一组幂等 SQL 语句 */
export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

/**
 * 迁移账本：一个库一份。表和列名由账本自己定，机制不认具体表名。
 *
 * `ddl` 是**建账本表的 DDL 文本**（表清单从它派生）；`seed` 保证单行存在（幂等）。
 */
export interface MigrationLedger {
  /** 账本表名（唯一来源） */
  readonly table: string;
  /** 单行守卫的主键值（两套账本都用 1） */
  readonly rowId: number;
  /** 账本表的建表 DDL（**应有表清单从它派生**，不另写手写清单） */
  readonly ddl: readonly string[];
  /** 保证账本单行存在；幂等（每次 migrate 都调） */
  seed(db: SqlDatabase, now: () => number): void;
  /** 读当前版本；读不到合法行 ⇒ 抛 META_ROW_MISSING（不静默当成 0） */
  readVersion(db: SqlDatabase): number;
  /** 写版本（**调用方保证在迁移事务内**） */
  writeVersion(db: SqlDatabase, version: number, now: () => number): void;
}

/**
 * 读一列的版本号并校验形状。
 * 单独抽出来给两套账本共用：错误码与"不静默当成 0"的口径只能有一处（P2）。
 */
export function readVersionRow(
  db: SqlDatabase,
  table: string,
  rowId: number,
  column: string,
  sql: string,
): number {
  const row = db.prepare(sql).get();
  const value = row === undefined ? undefined : row[column];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new GsDbError(
      'META_ROW_MISSING',
      `${table} 里没有可用的 id=${String(rowId)} 版本行（读到 ${String(value)}）—— ` +
        '建表逻辑被绕过或文件被外部改过；删掉这个库文件（连 -wal/-shm）会按 SPEC §2.1 重建。',
    );
  }
  return value;
}

/** 库级账本：`schema_version`（单行 id=1，元表本身不参与迁移） */
export const SCHEMA_VERSION_TABLE: string = 'schema_version';
export const SCHEMA_VERSION_ROW_ID: number = 1;

const CREATE_SCHEMA_VERSION_TABLE: string = `
CREATE TABLE IF NOT EXISTS schema_version (
  id         INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  version    INTEGER NOT NULL CHECK (version >= 0),
  updated_at INTEGER NOT NULL
);`;

export const SCHEMA_VERSION_LEDGER: MigrationLedger = Object.freeze({
  table: SCHEMA_VERSION_TABLE,
  rowId: SCHEMA_VERSION_ROW_ID,
  ddl: Object.freeze([CREATE_SCHEMA_VERSION_TABLE]),

  seed(db: SqlDatabase, now: () => number): void {
    db.prepare(
      'INSERT OR IGNORE INTO schema_version (id, version, updated_at) VALUES (1, 0, ?)',
    ).run(now());
  },

  readVersion(db: SqlDatabase): number {
    return readVersionRow(
      db,
      SCHEMA_VERSION_TABLE,
      SCHEMA_VERSION_ROW_ID,
      'version',
      'SELECT version FROM schema_version WHERE id = 1',
    );
  },

  writeVersion(db: SqlDatabase, version: number, now: () => number): void {
    db.prepare('UPDATE schema_version SET version = ?, updated_at = ? WHERE id = 1').run(
      version,
      now(),
    );
  },
});

// ---------------------------------------------------------------- 清单合法性

/** 一份清单里的最高版本（空清单 = 0）；两侧都从它派生，不各写一个数字 */
export function targetVersionOf(migrations: readonly Migration[]): number {
  return migrations.reduce((max: number, m: Migration) => Math.max(max, m.version), 0);
}

/** 迁移清单自身的合法性：正整数版本、严格递增、名字非空 */
export function validateMigrations(migrations: readonly Migration[]): void {
  let prev = 0;
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version <= 0) {
      throw new GsDbError(
        'MIGRATION_LIST_INVALID',
        `迁移版本号必须是正整数，实际是 ${String(m.version)}`,
      );
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

// ---------------------------------------------------------------- 表清单派生（DDL 是唯一来源）

/**
 * 从 DDL 文本里派生表名（普通表 + 虚拟表）。
 * `CREATE VIRTUAL TABLE` 也要认：`asset_name_fts` 是 FTS5 虚表，它同样是一张"我们建的表"。
 */
const CREATE_TABLE_RE: RegExp =
  /CREATE\s+(VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;

export function createdTableNames(statements: readonly string[]): string[] {
  const names: string[] = [];
  for (const sql of statements) {
    for (const match of sql.matchAll(CREATE_TABLE_RE)) names.push(match[2]);
  }
  return names;
}

/** 只取虚拟表名（FTS5 的**影子表**要按它排除，见 db-schema 测试） */
export function virtualTableNames(statements: readonly string[]): string[] {
  const names: string[] = [];
  for (const sql of statements) {
    for (const match of sql.matchAll(CREATE_TABLE_RE)) {
      if (match[1]) names.push(match[2]);
    }
  }
  return names;
}

/** 去重排序（表清单断言一律用有序数组，避免集合比较带来的浮动手感） */
export function uniqueSorted(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

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

export interface MigrateWithLedgerOptions {
  migrations: readonly Migration[];
  /** 时钟注入（updated_at 可复现） */
  now?: () => number;
}

// ---------------------------------------------------------------- 执行

/**
 * 建账本表并保证单行存在（幂等）。
 * 单独一个函数：`migrateWithLedger` 与「只要账本、不跑迁移」的调用方（open.ts 的只读路径）
 * 都要这一步，写两遍就会漂（P2）。
 */
export function bootstrapLedger(db: SqlDatabase, ledger: MigrationLedger, now: () => number): void {
  for (const sql of ledger.ddl) db.exec(sql);
  ledger.seed(db, now);
}

/** 执行一条迁移（自带事务与回滚；失败时版本号保持在上一条） */
function applyOne(db: SqlDatabase, ledger: MigrationLedger, m: Migration, now: () => number): void {
  let began = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    began = true;
    for (const statement of m.statements) db.exec(statement);
    ledger.writeVersion(db, m.version, now);
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

/**
 * 把库推进到清单里的最高版本。**幂等**：已是最新就什么都不做、也不报错。
 *
 * 不负责：建父目录、开库（那是 open.ts）、删库重建（removeGsDbFiles）。
 */
export function migrateWithLedger(
  db: SqlDatabase,
  ledger: MigrationLedger,
  opts: MigrateWithLedgerOptions,
): MigrationResult {
  const migrations = opts.migrations;
  const now = opts.now ?? Date.now;
  validateMigrations(migrations);

  // 账本先于任何迁移存在（它自己不是迁移的一部分）。
  bootstrapLedger(db, ledger, now);

  const fromVersion = ledger.readVersion(db);
  const targetVersion = targetVersionOf(migrations);

  if (fromVersion > targetVersion) {
    throw new GsDbError(
      'SCHEMA_TOO_NEW',
      `库里的 schema 版本 v${fromVersion} 高于本程序知道的 v${targetVersion} —— ` +
        '不降级瞎改（那会把新版本的列当成不存在）。这是派生数据：删掉它（连 -wal/-shm）会按 SPEC §2.1 重建。',
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
    applyOne(db, ledger, m, now);
    applied.push({ version: m.version, name: m.name });
    current = m.version;
  }

  return {
    fromVersion,
    toVersion: current,
    targetVersion,
    applied,
    upToDate: applied.length === 0,
  };
}

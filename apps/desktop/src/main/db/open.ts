// apps/desktop/src/main/db/open.ts —— 开一个 .gs.db：建父目录 → 打开 → 设 WAL → 迁移（T-11a）
//
// 本层**只接收路径**（T-11a 要求 ⑤）：
//   "库根能不能写、要不要回退 userData、回退了要告警"这些判断全在 T-04 的 storage-roots.ts，
//   由**调用方**做完，把最终 dbPath 传进来。本层不 import electron、不读 app.getPath()、
//   不猜落点 —— 所以它能在 node --test 里直接跑。
//
// 唯一一处"顺手创建"：dbPath 的**父目录**（recursive mkdir）。
//   为什么在这里：T-04 已裁定"回退目录尚未创建 —— 首次写入时按需创建"，
//   而真正首次写入的就是这里；让调用方先建目录只会把"谁负责建"变成口头约定。
//   只读打开时不建目录（只读不该有副作用）。
//
// 删除重建（SPEC §2.1「.gs.db 可安全删除（会重建）」）：
//   removeGsDbFiles() 一并删掉 -wal / -shm / -journal 三个边车文件。
//   ⚠️ 只删 .gs.db 是不够的：WAL 里可能还有**未 checkpoint 的事务**，
//      留着边车会让新库接着旧日志 —— 那是"删了但没真删"的静默错误。

import fs from 'node:fs';
import path from 'node:path';

import { GsDbError, describeError } from './errors.ts';
import {
  LIBRARY_MIGRATIONS,
  migrate,
  readSchemaVersion,
  targetVersionOf,
  type Migration,
  type MigrationResult,
} from './migrations.ts';
import { openNodeSqlite, openOrThrow, type SqlDatabase, type SqlOpenFn } from './sqlite-adapter.ts';

export interface OpenGsDbOptions {
  /** .gs.db 的落点；**由调用方（T-04 storage-roots）解析后传入**。相对路径会按 cwd 解析成绝对路径 */
  dbPath: string;
  /** 驱动；默认 node:sqlite。测试可注入假驱动 */
  driver?: SqlOpenFn;
  /** 覆盖迁移清单（默认 LIBRARY_MIGRATIONS） */
  migrations?: readonly Migration[];
  /** 时钟注入 */
  now?: () => number;
  /** 只读打开：不建目录、不设 WAL、不迁移，只读当前版本 */
  readOnly?: boolean;
  /** busy timeout（毫秒），透传给驱动 */
  timeoutMs?: number;
  /** 是否尝试 journal_mode = WAL（默认 true；只读与 :memory: 下自动跳过） */
  wal?: boolean;
}

export interface OpenGsDbResult {
  db: SqlDatabase;
  /** 实际使用的绝对路径（日志里打这个，别打调用方传进来的原始字符串） */
  dbPath: string;
  /** 打开之前文件是否**不存在**（= 这次是新建的库） */
  created: boolean;
  migration: MigrationResult;
  /** 打开后 SQLite 真正报告的 journal_mode（wal / delete / memory …）—— 报告事实，不报告期望 */
  journalMode: string;
  /** WAL 设置失败/退化的原因（空串 = 没问题）—— 不静默：网络盘上 WAL 会退回 delete */
  walNote: string;
}

/** PRAGMA 读回来的值 → 字符串（读不到就是 'unknown'，不猜成 'wal'） */
function readJournalMode(db: SqlDatabase): string {
  const row = db.prepare('PRAGMA journal_mode').get();
  const value = row === undefined ? undefined : row['journal_mode'];
  return typeof value === 'string' && value ? value : 'unknown';
}

/** 只读打开时的"迁移结果"：什么都没做，如实汇报库里的版本 */
function readOnlyMigrationResult(db: SqlDatabase, migrations: readonly Migration[]): MigrationResult {
  const version = readSchemaVersion(db);
  const targetVersion = targetVersionOf(migrations);
  return {
    fromVersion: version,
    toVersion: version,
    targetVersion,
    applied: [],
    upToDate: version === targetVersion,
  };
}

/**
 * 打开（必要时创建）一个 .gs.db 并把它迁移到本程序知道的版本。
 *
 * 幂等：已是最新版本时**不执行任何 DDL**、不报错（migrate 的语义，见 migrations.ts）。
 * 失败时不留下半个连接：打开之后的任何异常都会先 close 再抛。
 */
export function openGsDb(options: OpenGsDbOptions): OpenGsDbResult {
  const rawPath = typeof options.dbPath === 'string' ? options.dbPath.trim() : '';
  if (!rawPath) {
    throw new GsDbError(
      'DB_PATH_REQUIRED',
      'openGsDb 需要一个非空的 dbPath —— 落点由调用方（T-04 storage-roots.resolveLibraryStorage().db）解析后传入',
    );
  }
  const dbPath = path.resolve(rawPath);
  const driver = options.driver ?? openNodeSqlite;
  const readOnly = options.readOnly === true;
  const now = options.now ?? Date.now;
  const migrations = options.migrations ?? LIBRARY_MIGRATIONS;
  const created = !fs.existsSync(dbPath);

  if (!readOnly) {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch (e) {
      throw new GsDbError(
        'MKDIR_FAILED',
        `建 .gs.db 的父目录失败：${path.dirname(dbPath)}（${describeError(e)}）` +
          '—— 库根/回退落点不可写；可写性判断与告警在调用方（T-04）',
        { cause: e },
      );
    }
  }

  const db = openOrThrow(driver, dbPath, { readOnly, timeoutMs: options.timeoutMs });

  try {
    let walNote = '';
    if (!readOnly && options.wal !== false) {
      try {
        db.exec('PRAGMA journal_mode = WAL;');
      } catch (e) {
        // 网络盘/只读文件系统上 WAL 会失败或退化。这不致命，但**必须留痕**（本项目最怕静默降级）。
        walNote = `journal_mode=WAL 设置失败，已按 SQLite 的结果继续：${describeError(e)}`;
      }
    }
    const journalMode = readJournalMode(db);
    if (!walNote && !readOnly && options.wal !== false && journalMode !== 'wal') {
      walNote = `要求 WAL，但 SQLite 实际报告 journal_mode=${journalMode}（网络盘等场景会退化，不致命）`;
    }

    const migration = readOnly
      ? readOnlyMigrationResult(db, migrations)
      : migrate(db, { migrations, now });

    return { db, dbPath, created, migration, journalMode, walNote };
  } catch (e) {
    try {
      db.close();
    } catch (closeError) {
      // 连关都关不掉也不能覆盖原始错误；把事实拼进原错误消息（不吞）
      if (e instanceof Error) e.message += `（附带：关闭 .gs.db 也失败：${describeError(closeError)}）`;
    }
    if (e instanceof GsDbError) throw e;
    // 非本层的错误（几乎只有一种：文件不是 SQLite —— SQLite 是**懒**的，坏文件要等第一条语句才报）
    // 统一收成 DB_OPEN_FAILED，否则调用方要面对一个裸的 SqliteError。
    throw new GsDbError(
      'DB_OPEN_FAILED',
      `打开 .gs.db 后初始化失败：${dbPath}（${describeError(e)}）。` +
        '若是文件损坏，删掉 .gs.db（连 -wal/-shm）会按 SPEC §2.1 自动重建。',
      { cause: e },
    );
  }
}

/**
 * 删掉 .gs.db 及其边车文件（-wal / -shm / -journal），返回真正删掉的文件列表。
 *
 * 用途：SPEC §2.1「损坏或版本不符时删除重建」的唯一实现（T-15 的重建入口用它）。
 * ⚠️ 调用前必须已经 close 掉连接，否则 Windows 上文件被占着删不掉。
 */
export function removeGsDbFiles(dbPath: string): string[] {
  const raw = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!raw) throw new GsDbError('DB_PATH_REQUIRED', 'removeGsDbFiles 需要一个非空的 dbPath');
  const base = path.resolve(raw);
  // -journal 是回滚日志，-wal/-shm 是 WAL 模式的两个边车；三种都不能留
  const candidates = [base, `${base}-wal`, `${base}-shm`, `${base}-journal`];
  const removed: string[] = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      fs.rmSync(file, { force: true });
    } catch (e) {
      throw new GsDbError(
        'DB_REMOVE_FAILED',
        `删除 .gs.db 边车文件失败：${file}（${describeError(e)}）—— 多半是连接还没关`,
        { cause: e },
      );
    }
    removed.push(file);
  }
  return removed;
}

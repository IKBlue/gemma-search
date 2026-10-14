// apps/desktop/src/main/db/sqlite-adapter.ts —— node:sqlite 的**唯一**接触点（薄适配层）
//
// 为什么必须有这一层（T-11a 要求 ①）：
//   `node:sqlite` 是**实验性**内置模块。Node 24.18.1 实测每次进程启动都会打
//     "(node:PID) ExperimentalWarning: SQLite is an experimental feature and might change at any time"
//   （原始输出见 reports/2026-10-15-wave3/11a.txt）。它的 API（DatabaseSync / StatementSync）是**同步**的，
//   返回类型是 `SQLInputValue` / `SQLOutputValue` 这套 Node 自己的别名，版本间调整过。
//   ⇒ 把 `new DatabaseSync(...)` 散在各处 = 把"换实现 / 换 Node 版本"的成本摊到每个调用点。
//   ⇒ 全仓库**只有这一个文件** import 'node:sqlite'；其余模块只认下面这几个接口。
//     （机械自检见 apps/desktop/tests/db-schema.test.mjs 的 A1/A2 用例：扫 src/main/db/**，
//      除本文件外出现 node:sqlite 即失败。）
//
// 本层**只做三件事**：开库 / 跑 SQL / 取行。没有任何建表与迁移逻辑（那是 migrations.ts），
// 也没有任何业务判断 —— 这样它才能被换成假驱动做确定性测试。
//
// 类型为什么收窄成 SqlValue：SQLite 只认 null / number / bigint / string / blob。
// 收窄后调用方传 `undefined` 或普通对象会**编译期报错**，而不是在运行时被驱动拒掉。

import { DatabaseSync } from 'node:sqlite';

import { GsDbError, describeError } from './errors.ts';

/** SQLite 能接受的绑定值（**不含 undefined、不含普通对象**） */
export type SqlValue = null | number | bigint | string | Uint8Array;

/** 一行查询结果（列名 → 值） */
export type SqlRow = Record<string, SqlValue>;

/**
 * run() 的结果。
 * ⚠️ 字段类型**照抄** node:sqlite：它们可能是 bigint（readBigInts 打开时）。
 *    写成 number 会让适配层编译不过 —— 那不是"更严格"，是错的。
 */
export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/** 一条预编译语句的最小面 */
export interface SqlStatement {
  run(...params: SqlValue[]): SqlRunResult;
  get(...params: SqlValue[]): SqlRow | undefined;
  all(...params: SqlValue[]): SqlRow[];
}

/** 一个已打开的库连接的最小面 */
export interface SqlDatabase {
  /** 多语句执行（建表脚本用它；要绑参数请用 prepare） */
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
  readonly isOpen: boolean;
}

export interface SqlOpenOptions {
  /** 只读打开；**文件不存在会失败**（这是有意的：只读不该顺手建库） */
  readOnly?: boolean;
  /** busy timeout（毫秒）；库根可能被另一个进程（旧实例）占着，默认给 5s 而不是 0 */
  timeoutMs?: number;
  /** 是否打开外键约束（默认 true —— 本层的表之间存在真实 FK，见 migrations.ts） */
  enableForeignKeys?: boolean;
}

/** 打开一个库；由调用方注入，测试可换成假驱动 */
export type SqlOpenFn = (filename: string, options?: SqlOpenOptions) => SqlDatabase;

/** busy timeout 默认值：库根被另一个进程占用时给 5 秒重试窗口，而不是立刻 SQLITE_BUSY */
export const DEFAULT_BUSY_TIMEOUT_MS: number = 5000;

/**
 * 值的收窄。
 *
 * node:sqlite 的 `SQLOutputValue` 里 blob 是 `NodeJS.NonSharedUint8Array`；
 * 用 `instanceof Uint8Array` 判定即可覆盖。**判不出来就抛**，绝不静默返回 null
 * （静默把二进制变成 null 是本项目最怕的那种错误）。
 */
function narrowValue(value: unknown): SqlValue {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new GsDbError(
    'UNEXPECTED_SQL_VALUE',
    `从 SQLite 读回了本层不认识的类型（${typeof value}）—— 不许静默当成 null`,
  );
}

function narrowRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const key of Object.keys(row)) out[key] = narrowValue(row[key]);
  return out;
}

/**
 * 生产驱动：真正的 node:sqlite。
 *
 * ⚠️ 全仓库**只在这里** import 'node:sqlite'（见文件头）。
 */
export const openNodeSqlite: SqlOpenFn = (filename, options = {}) => {
  const db = new DatabaseSync(filename, {
    readOnly: options.readOnly === true,
    timeout: options.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    // 默认 true：本层的表之间有真实外键（items → library 等），关掉会出现孤儿行
    enableForeignKeyConstraints: options.enableForeignKeys !== false,
  });
  return {
    exec: (sql: string): void => {
      db.exec(sql);
    },
    prepare: (sql: string): SqlStatement => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: SqlValue[]): SqlRunResult => {
          const r = stmt.run(...params);
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        get: (...params: SqlValue[]): SqlRow | undefined => {
          const row = stmt.get(...params);
          return row === undefined ? undefined : narrowRow(row);
        },
        all: (...params: SqlValue[]): SqlRow[] => stmt.all(...params).map(narrowRow),
      };
    },
    close: (): void => {
      db.close();
    },
    get isOpen(): boolean {
      return db.isOpen;
    },
  };
};

/**
 * 打开失败的统一包装：把驱动的原始报错（含 SQLite 错误码）塞进 cause，并给一句能行动的提示。
 * 单独抽出来是为了让"打开失败"的错误路径**只有一处**（P2）。
 */
export function openOrThrow(open: SqlOpenFn, filename: string, options: SqlOpenOptions): SqlDatabase {
  try {
    return open(filename, options);
  } catch (e) {
    throw new GsDbError(
      'DB_OPEN_FAILED',
      `打开 .gs.db 失败：${filename}（${describeError(e)}）。` +
        '若是文件损坏，删掉 .gs.db（连 -wal/-shm）会按 SPEC §2.1 自动重建。',
      { cause: e },
    );
  }
}

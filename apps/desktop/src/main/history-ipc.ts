// apps/desktop/src/main/history-ipc.ts —— 三张"只写不读"的表的**读路径**（HIST-1）
//
// 为什么不写在 index.ts 里：index.ts import 了 electron ⇒ node:test 加载不了它 ⇒
//   「信封 + 错误码 + 永不抛」会零覆盖（与 library-ipc / meta-ipc 同一条理由）。
//
// 三条硬要求（每个方法都照做）：
//   ① **只读**：`readOnly:true` 打开；**缺库 ⇒ DB_MISSING**，绝不代建/迁移（warmup 回归的同族坑）；
//   ② **排序稳定**：`ORDER BY 时刻 DESC, 主键 DESC` —— 同毫秒用主键裁决，否则用户会看到"顺序自己变了"；
//   ③ **分页如实**：`total` = **筛选后**总数；`offset` 越界 ⇒ 空数组。
import fs from 'node:fs';

import type { Envelope } from '../shared/ipc.ts';
import { appDbPath } from './app-db.ts';
import { openNodeSqlite } from './db/index.ts';
import type { SqlDatabase } from './db/index.ts';
import { openGsDb } from './db/open.ts';
import { messageOf } from './errors.ts';
import { log } from './log.ts';
import { createLibraryResolverPort } from './storage-ports.ts';
import type { LibraryRootInput } from './storage-roots.ts';

export interface HistoryInput {
  userDataDir: string | null;
  libraries?: LibraryRootInput[];
  legacyLibrariesDir?: string | null;
}

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(1, n));
}
function clampOffset(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.max(0, n);
}

function failure(code: string, message: string, what: string): Envelope {
  log('!! ' + what + '失败 [' + code + ']', message);
  return {
    ok: false,
    error: {
      code,
      message,
      userMessage: what + '失败：这次没有读到历史记录。详情见日志。',
      details: {},
    },
  };
}

/** 只读打开**应用级** app.db；缺文件 ⇒ 不打开（也就不会由 openAppDb 建库+迁移） */
function withAppDbReadOnly<T>(
  input: HistoryInput,
  fn: (db: SqlDatabase) => T,
): { ok: true; value: T } | { ok: false; why: string } {
  if (!input.userDataDir) return { ok: false, why: 'userData 未初始化（应用还没准备好）' };
  const dbPath = appDbPath(input.userDataDir);
  if (!fs.existsSync(dbPath)) {
    return {
      ok: false,
      why: '应用数据库（app.db）不存在：读不到历史（本方法不会凭一次读取把库造出来）',
    };
  }
  try {
    const db = openNodeSqlite(dbPath, { readOnly: true });
    try {
      return { ok: true, value: fn(db) };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, why: messageOf(e) };
  }
}

/** `recentQueries`：搜索历史（应用级 `recent_query`）—— 时间降序，同毫秒按 `query_id` 裁决 */
export function runRecentQueries(input: HistoryInput & { limit?: unknown }): Envelope {
  const limit = clampLimit(input.limit);
  const r = withAppDbReadOnly(input, (db) => {
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM recent_query').get()?.n ?? 0);
    const rows = db
      .prepare(
        'SELECT query_id, text, scope_lib_id, result_count, at_ms FROM recent_query ' +
          'ORDER BY at_ms DESC, query_id DESC LIMIT ?',
      )
      .all(limit)
      .map((row) => ({
        q: row.text === null || row.text === undefined ? null : String(row.text),
        scopeLibId:
          row.scope_lib_id === null || row.scope_lib_id === undefined
            ? null
            : String(row.scope_lib_id),
        at: Number(row.at_ms),
        hits:
          row.result_count === null || row.result_count === undefined
            ? null
            : Number(row.result_count),
      }));
    return { total, rows };
  });
  if (!r.ok) return failure('DB_MISSING', r.why, '读取搜索历史');
  return { ok: true, data: r.value };
}

/** `activityList`：操作记录（应用级 `activity`）—— 时间降序，同毫秒按 `activity_id` 裁决；可按 kind 筛 */
export function runActivityList(
  input: HistoryInput & { limit?: unknown; offset?: unknown; kind?: unknown },
): Envelope {
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  const kind = typeof input.kind === 'string' && input.kind ? input.kind : null;
  const r = withAppDbReadOnly(input, (db) => {
    const where = kind ? ' WHERE kind = ?' : '';
    const args: string[] = kind ? [kind] : [];
    const total = Number(
      db.prepare('SELECT COUNT(*) AS n FROM activity' + where).get(...args)?.n ?? 0,
    );
    const rows = db
      .prepare(
        'SELECT activity_id, at_ms, kind, subject_kind, subject_id, lib_id, result, detail_json FROM activity' +
          where +
          ' ORDER BY at_ms DESC, activity_id DESC LIMIT ? OFFSET ?',
      )
      .all(...args, limit, offset)
      .map((row) => ({
        id: String(row.activity_id),
        kind: String(row.kind),
        subjectKind: String(row.subject_kind),
        subjectId:
          row.subject_id === null || row.subject_id === undefined ? null : String(row.subject_id),
        at: Number(row.at_ms),
        result: row.result === null || row.result === undefined ? null : String(row.result),
        detail:
          row.detail_json === null || row.detail_json === undefined
            ? null
            : String(row.detail_json),
      }));
    return { total, rows };
  });
  if (!r.ok) return failure('DB_MISSING', r.why, '读取操作记录');
  return { ok: true, data: r.value };
}

/** `exportList`：交付/取件历史（**库级** `asset_export`）—— 时间降序，同毫秒按 `export_id` 裁决 */
export function runExportList(
  input: HistoryInput & { libId?: unknown; limit?: unknown; offset?: unknown },
): Envelope {
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);
  if (!input.libId) {
    return failure('BAD_REQUEST', 'exportList 需要 libId（交付历史是库级表）', '读取交付历史');
  }
  const libId = String(input.libId);
  let dbPath: string;
  try {
    const port = createLibraryResolverPort({
      libraries: input.libraries ?? [],
      userDataDir: input.userDataDir ?? undefined,
      legacyLibrariesDir: input.legacyLibrariesDir ?? null,
    });
    dbPath = port.storageOf(libId).dbPath;
  } catch (e) {
    return failure('LIB_NOT_FOUND', messageOf(e), '读取交付历史');
  }
  if (!fs.existsSync(dbPath)) {
    return failure(
      'DB_MISSING',
      '库元数据（.gs.db）不存在：读不到交付历史（本方法不会凭一次读取把库造出来）',
      '读取交付历史',
    );
  }
  try {
    const opened = openGsDb({ dbPath, readOnly: true });
    try {
      const total = Number(
        opened.db.prepare('SELECT COUNT(*) AS n FROM asset_export').get()?.n ?? 0,
      );
      const rows = opened.db
        .prepare(
          'SELECT export_id, batch_id, uid, kind, result, at_ms FROM asset_export ' +
            'ORDER BY at_ms DESC, export_id DESC LIMIT ? OFFSET ?',
        )
        .all(limit, offset)
        .map((row) => ({
          exportId: String(row.export_id),
          batchId:
            row.batch_id === null || row.batch_id === undefined ? null : String(row.batch_id),
          uid: row.uid === null || row.uid === undefined ? null : String(row.uid),
          kind: String(row.kind),
          at: Number(row.at_ms),
          outcome: row.result === null || row.result === undefined ? null : String(row.result),
        }));
      return { ok: true, data: { total, rows } };
    } finally {
      opened.db.close();
    }
  } catch (e) {
    return failure('INTERNAL', messageOf(e), '读取交付历史');
  }
}

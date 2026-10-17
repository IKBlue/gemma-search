// apps/desktop/src/main/db/user-meta.ts —— **库级** `asset_user_meta` 的唯一读写入口（WIRE-C）
//
// §2.3「每张表一个写入口」：本文件是**唯一**出现 `INSERT INTO asset_user_meta` / `UPDATE asset_user_meta`
// 的地方（测试静态钉住）。为什么在 `db/**` 而不是 `app-db.ts`：这张表在**库级** `.gs.db`（意图层），
// 与 `activity`（应用级 `app.db`）不是一个库文件。
import type { SqlDatabase } from './index.ts';
import { GsDbError } from './errors.ts';

/** 一条标注（1:1：`uid` 就是主键 ⇒ 每条素材最多一行） */
export interface UserMeta {
  uid: string;
  /** NULL = **未评分**（不是 0） */
  rating: number | null;
  /** NULL = 从未填写；`''` = 用户清空过（两者不同） */
  note: string | null;
  isFavorite: boolean;
  updatedAtMs: number | null;
}

/** 读取（没有行 = 全空：rating/note 为 null · isFavorite false · updatedAtMs null） */
export function getUserMeta(db: SqlDatabase, uid: string): UserMeta {
  const row = db
    .prepare(
      'SELECT uid, rating, note, is_favorite, updated_at_ms FROM asset_user_meta WHERE uid = ?',
    )
    .get(uid);
  if (!row) return { uid, rating: null, note: null, isFavorite: false, updatedAtMs: null };
  return {
    uid,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    isFavorite: Number(row.is_favorite) === 1,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export interface SetUserMetaInput {
  rating?: number | null;
  note?: string | null;
  isFavorite?: boolean;
  now?: () => number;
}

/**
 * 写入（**唯一写入口**）。返回**实际写了的字段名**（`metaSet.applied`）。
 * ⚠️ 部分更新 = **只把传了的列放进 SQL**；不许"先读整行再覆盖"（那会把没传的字段写回旧值/默认值）。
 * ⚠️ `note` 的 `''` 与 `null` 都原样写（`''` = 用户清空过，`null` = 从未填写）。
 */
export function setUserMeta(
  db: SqlDatabase,
  uid: string,
  input: SetUserMetaInput,
): { applied: string[] } {
  const cols: string[] = [];
  const vals: Array<string | number | null> = [];
  if (input.rating !== undefined) {
    if (
      input.rating !== null &&
      (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    ) {
      throw new GsDbError(
        'UNEXPECTED_SQL_VALUE',
        'rating 只接受 1..5 或 null，实得 ' + String(input.rating),
      );
    }
    cols.push('rating');
    vals.push(input.rating);
  }
  if (input.note !== undefined) {
    cols.push('note');
    vals.push(input.note);
  }
  if (input.isFavorite !== undefined) {
    cols.push('is_favorite');
    vals.push(input.isFavorite ? 1 : 0);
  }
  const applied = cols.slice();
  const ts = (input.now ?? Date.now)();
  if (cols.length === 0) return { applied };

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT uid FROM asset_user_meta WHERE uid = ?').get(uid);
    if (!existing) {
      const insertCols = ['uid', ...cols, 'updated_at_ms'];
      const insertVals = [uid, ...vals, ts];
      db.prepare(
        'INSERT INTO asset_user_meta (' +
          insertCols.join(', ') +
          ') VALUES (' +
          insertCols.map(() => '?').join(', ') +
          ')',
      ).run(...insertVals);
    } else {
      const sets = cols.map((c) => c + ' = ?').join(', ');
      db.prepare('UPDATE asset_user_meta SET ' + sets + ', updated_at_ms = ? WHERE uid = ?').run(
        ...vals,
        ts,
        uid,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败：原样抛出 */
    }
    throw e;
  }
  return { applied };
}

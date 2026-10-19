// apps/desktop/src/main/local-search.ts —— 本地检索（L0）：零模型、零索引、只读 SQL
//
// 为什么需要它（PRD-1 / 所有者 2026-10-19 口径）：
//   · 默认产品形态 = 素材管理 + **简单 ID 搜索（uid 12 hex / 4–11 位前缀）+ 文件名/路径/备注关键词**；
//   · 现状 `search` 的模式（text/image）都依赖模型与索引，缺模型时主流程不可用 —— 那是可用性风险；
//   · 所以 L0 必须是**独立于引擎检索**的一条只读路径：SQL 匹配 + 分页，坏库/缺库**如实报**，绝不代建。
//
// 口径（与响应字段一一对应）：
//   · 输入若整体像 uid：`#?[0-9a-f]{4,12}` ⇒ ID 检索（12 位精确，4–11 位前缀）`hit:'uid'`；
//   · `ext:psd` ⇒ 扩展名检索 `hit:'ext'`；
//   · 其余 ⇒ 关键词检索：display_name / stem / rel_path 子串（大小写不敏感），
//     `hit` 区分 `name`（名称/主干命中）与 `path`（仅路径命中），排序让"名称命中"靠前；
//   · 结果只含**预览行**的元数据（ext/size/mtime/尺寸）；缺包=正常（LEFT JOIN）。
//
// 纪律：**永不抛**；只 SELECT；`.gs.db` 一律 readOnly 打开；缺库不代建（DB_MISSING / LIB_NOT_FOUND 如实给）。
import fs from 'node:fs';

import { ERR, USER_MESSAGE } from '../../../../packages/engine/src/errors.ts';
import type { Envelope } from '../shared/ipc.ts';
import { openGsDb } from './db/open.ts';
import { numberOf } from './db/index.ts';
import { codeOf, messageOf } from './errors.ts';
import { createLibraryResolverPort } from './storage-ports.ts';
import type { SqlOpenFn } from './db/sqlite-adapter.ts';
import type { LibraryRootInput } from './storage-roots.ts';

export interface LocalSearchInput {
  libraries: readonly LibraryRootInput[];
  userDataDir?: string | null;
  legacyLibrariesDir: string;
  /** 注入点（单测用；生产不传 ⇒ openGsDb 自己用 openNodeSqlite） */
  driver?: SqlOpenFn;
}

export interface LocalSearchParams {
  query: string;
  libIds?: string[];
  folder?: string;
  ext?: string;
  limit?: number;
  offset?: number;
}

export interface LocalSearchRow {
  uid: string;
  libId: string;
  folder: string;
  stem: string;
  displayName: string;
  relPath: string;
  ext: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
  width: number | null;
  height: number | null;
  hit: 'uid' | 'ext' | 'name' | 'path';
}

export interface LocalSearchResult {
  query: string;
  total: number;
  results: LocalSearchRow[];
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const UID_QUERY_RE = /^#?([0-9a-f]{4,12})$/i;
const EXT_QUERY_RE = /^ext:(.+)$/i;

type MatchPlan =
  | { kind: 'uid'; exact: boolean; uid: string }
  | { kind: 'ext'; ext: string }
  | { kind: 'text'; text: string };

/** LIKE 的通配符要转义，否则用户输入 `%` 会变成"匹配全部"（不是注入，但会静默错结果） */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function parseQuery(raw: string): MatchPlan {
  const q = raw.trim();
  const uid = UID_QUERY_RE.exec(q);
  if (uid) {
    const hex = uid[1].toLowerCase();
    return { kind: 'uid', exact: hex.length === 12, uid: hex };
  }
  const ext = EXT_QUERY_RE.exec(q);
  // 库里的 ext 带点（`.png`），输入允许 `ext:png` / `ext:.png` 两种写法 ⇒ 统一成带点形
  if (ext) return { kind: 'ext', ext: '.' + ext[1].trim().toLowerCase().replace(/^\./, '') };
  return { kind: 'text', text: q };
}

function fail(e: unknown, action: string, libId?: string): Envelope {
  const raw = codeOf(e);
  const code =
    raw && Object.prototype.hasOwnProperty.call(ERR, raw)
      ? raw
      : raw === 'DB_MISSING' || raw === 'LIB_NOT_FOUND' || raw === 'BAD_REQUEST'
        ? raw
        : 'INTERNAL';
  const own =
    code === 'DB_MISSING'
      ? '这个库还没有元数据（先扫描一次），或库根里没有 .gs.db。'
      : code === 'LIB_NOT_FOUND'
        ? '找不到这个素材库，可能已被移除。'
        : code === 'BAD_REQUEST'
          ? '检索条件不合法。'
          : undefined;
  return {
    ok: false,
    error: {
      code,
      message: messageOf(e),
      userMessage:
        own || USER_MESSAGE[code as keyof typeof USER_MESSAGE] || '本地检索失败，详情见日志。',
      details: libId ? { libId } : undefined,
    },
  };
}

const COLLIST =
  'SELECT a.uid AS uid, a.lib_id AS lib_id, a.folder AS folder, a.stem AS stem, ' +
  'a.display_name AS display_name, a.rel_path AS rel_path, ' +
  'p.ext AS ext, p.size_bytes AS size_bytes, p.mtime_ms AS mtime_ms, p.width AS width, p.height AS height ';
const JOINS = 'FROM asset a LEFT JOIN asset_file p ON p.uid = a.uid AND p.role = ' + "'preview' ";

/** 每库的 WHERE/参数（只拼固定片段，值全走参数 —— 不做字符串拼值） */
function perLibWhere(
  plan: MatchPlan,
  params: LocalSearchParams,
): { where: string; whereValues: unknown[]; order: string; orderValues: unknown[] } {
  const cond: string[] = [];
  const whereValues: unknown[] = [];
  const orderValues: unknown[] = [];
  let order = ' ORDER BY a.rel_path ASC, a.uid ASC'; // 兜底稳定分页

  if (plan.kind === 'uid') {
    if (plan.exact) {
      cond.push('a.uid = ?');
      whereValues.push(plan.uid);
    } else {
      cond.push("a.uid LIKE ? || '%'");
      whereValues.push(plan.uid);
    }
  } else if (plan.kind === 'ext') {
    cond.push('LOWER(p.ext) = ?');
    whereValues.push(plan.ext);
  } else {
    const pat = '%' + escapeLike(plan.text) + '%';
    const prefix = escapeLike(plan.text) + '%';
    cond.push(
      "(a.display_name LIKE ? ESCAPE '\\' OR a.stem LIKE ? ESCAPE '\\' OR a.rel_path LIKE ? ESCAPE '\\')",
    );
    whereValues.push(pat, pat, pat);
    order =
      " ORDER BY CASE WHEN a.display_name LIKE ? ESCAPE '\\' OR a.stem LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, LENGTH(a.rel_path) ASC, a.rel_path ASC, a.uid ASC";
    orderValues.push(prefix, prefix);
  }

  if (typeof params.folder === 'string' && params.folder !== '') {
    cond.push('a.folder = ?');
    whereValues.push(params.folder);
  }
  if (typeof params.ext === 'string' && params.ext !== '') {
    cond.push('LOWER(p.ext) = ?');
    // 与 ext: 前缀同一口径：统一成带点形（库里 ext 带点）
    whereValues.push('.' + params.ext.toLowerCase().replace(/^\./, ''));
  }
  return {
    where: cond.length ? ' WHERE ' + cond.join(' AND ') : '',
    whereValues,
    order,
    orderValues,
  };
}

function rowHit(plan: MatchPlan, row: Record<string, unknown>, q: string): LocalSearchRow['hit'] {
  if (plan.kind === 'uid') return 'uid';
  if (plan.kind === 'ext') return 'ext';
  const text = q.toLowerCase();
  const name = (String(row['display_name'] ?? '') + '|' + String(row['stem'] ?? '')).toLowerCase();
  return name.includes(text) ? 'name' : 'path';
}

function toRow(row: Record<string, unknown>, plan: MatchPlan, q: string): LocalSearchRow {
  const n = (v: unknown): number | null =>
    typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null;
  return {
    uid: String(row['uid'] ?? ''),
    libId: String(row['lib_id'] ?? ''),
    folder: String(row['folder'] ?? ''),
    stem: String(row['stem'] ?? ''),
    displayName: String(row['display_name'] ?? ''),
    relPath: String(row['rel_path'] ?? ''),
    ext: row['ext'] === null || row['ext'] === undefined ? null : String(row['ext']),
    sizeBytes: n(row['size_bytes']),
    mtimeMs: n(row['mtime_ms']),
    width: n(row['width']),
    height: n(row['height']),
    hit: rowHit(plan, row, q),
  };
}

/**
 * 模拟模式（`GEMMA_FAKE=1`）的 L0 演示实现：没有 `.gs.db`，用 `fixtures/sample-index.json` 的条目
 * 在内存里按**同一套匹配口径**过滤。为什么必须有它：LOCAL-2 的默认搜索框就是 L0，
 * 若 fake 模式直接返回 `DB_MISSING`，整套 fake e2e（界面开发/演示）会被挡住。
 * ⚠️ 这不是"假数据骗人"：fake 模式本就是契约 §8 的演示模式，条目来自仓库里的样例索引。
 */
export interface LocalFixtureItem {
  uid?: unknown;
  relPath?: unknown;
  stem?: unknown;
  folder?: unknown;
  imageExt?: unknown;
  displayName?: unknown;
  size?: unknown;
  mtime?: unknown;
}

export function runFakeLocalSearch(
  items: readonly LocalFixtureItem[],
  params: LocalSearchParams,
): Envelope {
  const q = typeof params.query === 'string' ? params.query.trim() : '';
  if (q === '') {
    return fail(
      Object.assign(new Error('本地检索的 query 不能为空'), { code: 'BAD_REQUEST' }),
      '本地检索',
    );
  }
  const plan = parseQuery(q);
  const offset = typeof params.offset === 'number' && params.offset > 0 ? params.offset : 0;
  const limit = Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      Math.trunc(typeof params.limit === 'number' ? params.limit : DEFAULT_LIMIT) || DEFAULT_LIMIT,
    ),
  );
  const wanted = Array.isArray(params.libIds) ? params.libIds.map(String) : [];
  const rows: LocalSearchRow[] = [];
  for (const it of items) {
    const uid = String(it.uid ?? '');
    const relPath = String(it.relPath ?? '');
    const stem = String(it.stem ?? '');
    const ext = typeof it.imageExt === 'string' ? it.imageExt.toLowerCase() : '';
    const displayName = String(it.displayName ?? stem + ext);
    const folder = String(it.folder ?? '');
    if (typeof params.folder === 'string' && params.folder && folder !== params.folder) continue;
    if (typeof params.ext === 'string' && params.ext) {
      if (ext !== '.' + params.ext.toLowerCase().replace(/^\./, '')) continue;
    }
    let matched = false;
    if (plan.kind === 'uid') {
      matched = plan.exact ? uid === plan.uid : uid.startsWith(plan.uid);
    } else if (plan.kind === 'ext') {
      matched = ext === plan.ext;
    } else {
      const text = plan.text.toLowerCase();
      matched =
        displayName.toLowerCase().includes(text) ||
        stem.toLowerCase().includes(text) ||
        relPath.toLowerCase().includes(text);
    }
    if (!matched) continue;
    rows.push({
      uid,
      libId: String((it as { libId?: unknown }).libId ?? 'L1'),
      folder,
      stem,
      displayName,
      relPath,
      ext: ext || null,
      sizeBytes: typeof it.size === 'number' ? it.size : null,
      mtimeMs: typeof it.mtime === 'number' ? it.mtime : null,
      width: null,
      height: null,
      hit: rowHit(plan, { display_name: displayName, stem }, q),
    });
  }
  const rank = (r: LocalSearchRow): number =>
    r.hit === 'uid' ? 0 : r.hit === 'ext' ? 0 : r.hit === 'name' ? 1 : 2;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.relPath.length - b.relPath.length ||
      a.relPath.localeCompare(b.relPath) ||
      a.uid.localeCompare(b.uid),
  );
  if (wanted.length && !rows.some((r) => wanted.includes(r.libId))) {
    // fake 模式下库 ID 不匹配 ⇒ 如实"无结果"（不编一条假库）
    return { ok: true, data: { query: q, total: 0, results: [] } } as Envelope;
  }
  const filtered = wanted.length ? rows.filter((r) => wanted.includes(r.libId)) : rows;
  const result: LocalSearchResult = {
    query: q,
    total: filtered.length,
    results: filtered.slice(offset, offset + limit),
  };
  return { ok: true, data: result } as Envelope;
}

/**
 * 本地检索（L0）。**永不抛**；多库结果按"名称命中优先 + 路径长度 + 路径"稳定合并。
 */
export function runLocalSearch(input: LocalSearchInput, params: LocalSearchParams): Envelope {
  const q = typeof params.query === 'string' ? params.query.trim() : '';
  if (q === '') {
    return fail(
      Object.assign(new Error('本地检索的 query 不能为空'), { code: 'BAD_REQUEST' }),
      '本地检索',
    );
  }
  const plan = parseQuery(q);
  const offset = typeof params.offset === 'number' && params.offset > 0 ? params.offset : 0;
  const limitRaw = typeof params.limit === 'number' ? params.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw) || DEFAULT_LIMIT));
  const wanted = new Set(
    Array.isArray(params.libIds) && params.libIds.length ? params.libIds.map(String) : [],
  );

  // 目标库：只查"存在且是目标"的库；一个库都没有 ⇒ 如实报（不返回空表假装"库里没有"）
  const targets: Array<{ libId: string; root: string; dbPath: string }> = [];
  try {
    for (const lib of input.libraries) {
      if (wanted.size > 0 && !wanted.has(lib.libId)) continue;
      const layout = createLibraryResolverPort({
        libraries: [...input.libraries],
        userDataDir: input.userDataDir ?? undefined,
        legacyLibrariesDir: input.legacyLibrariesDir,
      }).storageOf(lib.libId);
      targets.push({ libId: lib.libId, root: layout.root, dbPath: layout.dbPath });
    }
  } catch (e) {
    return fail(e, '本地检索');
  }
  if (targets.length === 0) {
    return fail(Object.assign(new Error('没有可检索的库'), { code: 'LIB_NOT_FOUND' }), '本地检索');
  }

  const rows: LocalSearchRow[] = [];
  let total = 0;
  let openedCount = 0;
  let lastDbError: unknown = null;
  try {
    for (const t of targets) {
      if (!fs.existsSync(t.dbPath)) {
        lastDbError = Object.assign(new Error('元数据文件不存在：' + t.dbPath), {
          code: 'DB_MISSING',
        });
        continue;
      }
      let opened;
      try {
        opened = input.driver
          ? openGsDb({ dbPath: t.dbPath, readOnly: true, driver: input.driver })
          : openGsDb({ dbPath: t.dbPath, readOnly: true });
      } catch (e) {
        lastDbError = e;
        continue;
      }
      openedCount++;
      const db = opened.db;
      try {
        const { where, whereValues, order, orderValues } = perLibWhere(plan, params);
        const totalRow = db
          .prepare('SELECT COUNT(*) AS n ' + JOINS + where)
          .get(...(whereValues as never[]));
        total += numberOf(totalRow === undefined ? undefined : totalRow['n'], 'localSearch.total');
        // 多库合并要保证"前面的页"完整：每库取 offset+limit 行足够
        const pageRows = db
          .prepare(COLLIST + JOINS + where + order + ' LIMIT ? OFFSET 0')
          .all(...(whereValues as never[]), ...(orderValues as never[]), offset + limit) as Array<
          Record<string, unknown>
        >;
        for (const r of pageRows) rows.push(toRow(r, plan, q));
      } finally {
        db.close();
      }
    }
  } catch (e) {
    return fail(e, '本地检索');
  }

  if (openedCount === 0) {
    return fail(
      lastDbError ?? Object.assign(new Error('没有可检索的库'), { code: 'DB_MISSING' }),
      '本地检索',
    );
  }

  // 跨库稳定排序（各库内部已按同一规则排；这里按 hit/路径再做一次稳定合并）
  const rank = (r: LocalSearchRow): number =>
    r.hit === 'uid' ? 0 : r.hit === 'ext' ? 0 : r.hit === 'name' ? 1 : 2;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.relPath.length - b.relPath.length ||
      a.relPath.localeCompare(b.relPath) ||
      a.uid.localeCompare(b.uid),
  );
  const result: LocalSearchResult = {
    query: q,
    total,
    results: rows.slice(offset, offset + limit),
  };
  return { ok: true, data: result } as Envelope;
}

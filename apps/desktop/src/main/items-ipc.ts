// apps/desktop/src/main/items-ipc.ts —— items（只读列表）的主进程实现（S8 · SPEC §5.1）
//
// 为什么要单独一个模块（同 library-ipc.ts 的理由）：index.ts import 了 electron ⇒ node:test 加载不了它，
// "分页/筛选/排序 + facets + 只读 + 永不抛"这些最该有测试的事会变成零自动化覆盖。
//
// ── 只读契约（SPEC §5.1）──────────────────────────────────────────────────────
//   · 不触发扫描、不进向量、**不写任何表**；打开 .gs.db 一律 readOnly: true；
//   · total = **筛选后**总数（**越界也如实给**）；rows 只给这一页；
//   · facets = 按**全库**统计（**不受筛选影响**）的一条 GROUP BY，count 降序前 200 + 总数；
//     ⚠️ **禁止**从当前页样本推导 —— 那会漏掉不在本页的值，而且随分页跳动（同一份数据翻页看到不同下拉项 = 说谎）。
//
// ── 与 S2 的读层的关系（P1：读映射只有一份）──────────────────────────────────
//   行 → 条目 的映射**复用** db/row-types.ts 的 joinedRowToItemRecord()（S2 的，我不改它）。
//   本文件只写**筛选/排序/分页/facets** 需要的 SQL；列别名必须与那个映射器读的键一一对应
//   （它的 JSDoc 里就是「列名约定」）。tests/items-ipc.test.mjs 有一条**耦合断言**：
//   把本文件产出的行喂给那个映射器，不许抛 —— 别名一改就会红，不会静默错位。
import fs from 'node:fs';

import { ERR, USER_MESSAGE } from '../../../../packages/engine/src/errors.ts';
import type { Envelope } from '../shared/ipc.ts';
import { joinedRowToItemRecord } from './db/row-types.ts';
import { openGsDb } from './db/open.ts';
import { numberOf, numberOrNullOf, textOf, textOrNullOf } from './db/index.ts';
import { codeOf, messageOf } from './errors.ts';
import { log } from './log.ts';
import { asEngineError, createLibraryResolverPort } from './storage-ports.ts';
import type { SqlOpenFn } from './db/sqlite-adapter.ts';
import type { LibraryRootInput } from './storage-roots.ts';

export interface ItemsQueryInput {
  libId: string;
  /** 已解析的库清单（由 index.ts 递进来；本模块不自己解析「库从哪来」） */
  libraries: LibraryRootInput[];
  userDataDir: string | null;
  legacyLibrariesDir?: string;
  /**
   * 驱动注入（**只给测试用**）：模拟 `readBigInts` 之类的另一种取值类型。
   * 生产路径不传 ⇒ openGsDb 自己用 openNodeSqlite。
   */
  driver?: SqlOpenFn;
}

/** 传给 items 的参数（已过 zod；这里再收一次类型） */
export interface ItemsQueryParams {
  libId: string;
  folder?: string;
  ext?: string;
  hasArchive?: boolean;
  sort?: string;
  offset?: number;
  limit?: number;
}

/** 返回给界面的一行（**不含绝对路径** —— 路径只走 itemPaths，SPEC §5.1） */
export interface ItemsWireRow {
  uid: string;
  libId: string;
  folder: string;
  stem: string;
  name: string;
  relPath: string;
  imageExt: string;
  imageSize: number | null;
  imageMtime: number | null;
  archiveRelPath: string | null;
  archiveExt: string | null;
  archiveSize: number | null;
  archiveMtime: number | null;
  vectorRow: number | null;
}

export interface FacetValue { value: string; count: number }
export interface ItemsFacets {
  folders: FacetValue[];
  exts: FacetValue[];
  foldersTotal: number;
  extsTotal: number;
}

export interface ItemsQueryResult {
  rows: ItemsWireRow[];
  total: number;
  facets: ItemsFacets;
  /** 回显实际生效的分页/排序（界面能如实说「第几页 / 按什么排」） */
  page: { offset: number; limit: number; sort: string };
}

/** facets 每个维度最多给多少项（SPEC §5.1：count 降序前 200 + 总数） */
export const FACET_LIMIT: number = 200;
export const DEFAULT_LIMIT: number = 100;
export const MAX_LIMIT: number = 500;

/**
 * 排序白名单（**列名 → SQL 列**）。键必须与 shared/ipc.ts 的 sort enum **逐字对上** ——
 * tests/items-ipc.test.mjs 的 I12 双向核对（少一个 ⇒ 界面点不动；多一个 ⇒ 契约先拒掉）。
 *
 * ⚠️ **NULL 位次（写明，不让调用方猜）**：
 *   imageSize / archiveSize 来自 **LEFT JOIN** ⇒ **没有那一行的条目是 NULL**
 *   （最常见的是**无包条目**的 archiveSize —— schema 上「缺包 = 少一行」，**不是 0 字节**）。
 *   SQLite 把 NULL 当**最小**值 ⇒ 本实现用默认语义：
 *     · 正序（imageSize / archiveSize）：**NULL 排最前**；
 *     · 倒序（-imageSize / -archiveSize）：**NULL 排最后**。
 *   ⇒ 界面「大小（大→小）」用 -imageSize 时，无预览/无包的条目落在**末尾**，不会被当成 0 混进中间。
 *   位次由 I10/I11 断言钉住（含「NULL ≠ 0」这一点）。
 */
const SORT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  relPath: 'a.rel_path',
  folder: 'a.folder',
  stem: 'a.stem',
  imageMtime: 'p.mtime_ms',
  imageSize: 'p.size_bytes',
  archiveSize: 'r.size_bytes',
});

/** 白名单键（每列正倒各一）—— 契约与实现对得上这件事靠它断言，不在测试里再抄一份 */
export const SORT_KEYS: readonly string[] = Object.freeze(
  Object.keys(SORT_COLUMNS).flatMap((k) => [k, '-' + k]),
);

/**
 * 列（表.列）→ 别名 的**唯一配对表**。
 *
 * 别名必须与 joinedRowToItemRecord 读的键一致（那份「列名约定」写在它的 JSDoc 里）。
 * 写成配对而不是字符串加工：改别名时只有一处要动，而且耦合测试能直接断言这个集合。
 */
const ALIAS_PAIRS: readonly (readonly [column: string, alias: string])[] = Object.freeze([
  ['a.uid', 'uid'],
  ['a.lib_id', 'lib_id'],
  ['a.folder', 'folder'],
  ['a.stem', 'stem'],
  ['a.display_name', 'display_name'],
  ['a.rel_path', 'rel_path'],
  ['p.ext', 'image_ext'],
  ['p.size_bytes', 'image_size'],
  ['p.mtime_ms', 'image_mtime'],
  ['r.rel_path', 'archive_rel_path'],
  ['r.ext', 'archive_ext'],
  ['r.size_bytes', 'archive_size'],
  ['r.mtime_ms', 'archive_mtime'],
  ['s.vector_row', 'vector_row'],
]);

/** 别名清单（耦合测试用 —— 「映射器读的键」必须都在这里） */
export const ITEMS_ALIASES: readonly string[] = Object.freeze(ALIAS_PAIRS.map(([, alias]) => alias));

const COLLIST: string = ALIAS_PAIRS.map(([column, alias]) => column + ' AS ' + alias).join(', ');

const JOINS: string =
  ' FROM asset a' +
  " LEFT JOIN asset_file p ON p.uid = a.uid AND p.role = 'preview'" +
  " LEFT JOIN asset_file r ON r.uid = a.uid AND r.role = 'archive'" +
  ' LEFT JOIN asset_index_state s ON s.uid = a.uid';

/** 把筛选条件编成 SQL 片段 + 参数（**只有白名单字段**，没有字符串拼接注入面） */
export function buildFilter(params: ItemsQueryParams): { where: string; values: unknown[] } {
  const parts: string[] = ['a.lib_id = ?'];
  const values: unknown[] = [params.libId];
  if (typeof params.folder === 'string') { parts.push('a.folder = ?'); values.push(params.folder); }
  if (typeof params.ext === 'string') { parts.push('p.ext = ?'); values.push(params.ext); }
  if (params.hasArchive === true) parts.push('r.rel_path IS NOT NULL');
  if (params.hasArchive === false) parts.push('r.rel_path IS NULL');
  return { where: ' WHERE ' + parts.join(' AND '), values };
}

// ⚠️ DF-2：DB 行的取值统一走**适配层同一套收窄**（bigint ⇒ Number + 安全整数校验；类型不对就抛）。
//    旧写法（typeof === 'number' ? v : null / : ''）会把 bigint 静默读成 null / ''：
//    facets 的 count 会变 0、total 会变 0、value 会变空串 —— 与 app-db.ts 那个 P0 同一类。

/** 一行（本文件的别名）→ wire 行；**经由 S2 的映射器**，不在这里重做类型判据 */
function toWire(row: Record<string, unknown>, root: string, where: string): ItemsWireRow {
  const rec = joinedRowToItemRecord(row, root, where) as unknown as Record<string, unknown>;
  const at = (k: string): string => where + '.' + k;
  return {
    // DF-2：类型不对就抛（bigint 的 TEXT 列 = schema 漂移，不许静默变空串）
    uid: textOf(rec['uid'], at('uid')),
    libId: textOf(rec['libId'], at('libId')),
    folder: textOf(rec['folder'], at('folder')),
    stem: textOf(rec['stem'], at('stem')),
    name: textOf(rec['name'], at('name')),
    relPath: textOf(rec['relPath'], at('relPath')),
    imageExt: textOf(rec['imageExt'], at('imageExt')),
    // 可空数值列：null 合法（缺包/未编码），bigint 走安全整数收窄，别的抛
    imageSize: numberOrNullOf(rec['imageSize'], at('imageSize')),
    imageMtime: numberOrNullOf(rec['imageMtime'], at('imageMtime')),
    archiveRelPath: textOrNullOf(rec['archiveRelPath'], at('archiveRelPath')),
    archiveExt: textOrNullOf(rec['archiveExt'], at('archiveExt')),
    archiveSize: numberOrNullOf(rec['archiveSize'], at('archiveSize')),
    archiveMtime: numberOrNullOf(rec['archiveMtime'], at('archiveMtime')),
    vectorRow: numberOrNullOf(rec['vectorRow'], at('vectorRow')),
  };
}

/** 主进程自有码的文案（引擎表里没有它们） */
const OWN_MESSAGE: Readonly<Record<string, string>> = Object.freeze({
  DB_MISSING: '这个素材库还没有元数据，先做一次扫描（浏览列表读的就是它）。',
});

/** 引擎契约码集合（唯一来源 = 引擎的 ERR）—— 已是契约码就原样透出，其余才走映射表 */
const ENGINE_CODES: ReadonlySet<string> = new Set(Object.values(ERR));

function failure(e: unknown, what: string, libId: string): Envelope {
  const raw = codeOf(e);
  // 本模块自有码（OWN_MESSAGE 里有文案的那些）**原样透出**，不被引擎映射表改写 ——
  // 否则 DB_MISSING 会变成 DB_OPEN_FAILED，界面就拿不到"先扫一次"这句准确的话。
  const code = Object.prototype.hasOwnProperty.call(OWN_MESSAGE, raw)
    ? raw
    : (ENGINE_CODES.has(raw) ? raw : asEngineError(e, what).code);
  const message = messageOf(e);
  log('!! ' + what + '失败 [' + code + ']', message);
  const own = OWN_MESSAGE[code];
  const table = (USER_MESSAGE as Record<string, string>)[code];
  return {
    ok: false,
    error: {
      code,
      message,
      userMessage: own || table || '读取列表时出了点问题，详情见日志。',
      details: { libId, rawCode: raw },
    },
  };
}

/** 只读列表查询。**永不抛**；只 SELECT；打开 .gs.db 用 readOnly。 */
export function runItemsQuery(input: ItemsQueryInput, params: ItemsQueryParams): Envelope {
  const libId = typeof params.libId === 'string' ? params.libId : input.libId;
  const offset = typeof params.offset === 'number' ? params.offset : 0;
  const limit = typeof params.limit === 'number' ? params.limit : DEFAULT_LIMIT;
  const sortKey = typeof params.sort === 'string' ? params.sort : 'relPath';
  const desc = sortKey.startsWith('-');
  const bare = desc ? sortKey.slice(1) : sortKey;
  const sortCol = SORT_COLUMNS[bare];
  if (!sortCol) return failure(Object.assign(new Error('排序字段不合法：' + sortKey), { code: 'BAD_REQUEST' }), '读取列表', libId);

  let layout;
  try {
    // ⚠️ probeWrites 保持默认 false：浏览是**只读**动作，不能在库根写探针文件
    layout = createLibraryResolverPort({
      libraries: input.libraries,
      userDataDir: input.userDataDir ?? undefined,
      legacyLibrariesDir: input.legacyLibrariesDir,
    }).storageOf(libId);
  } catch (e) {
    return failure(e, '读取列表', libId);
  }

  // 没有 .gs.db（还没扫过）⇒ **如实说**，不给空表假装「这个库是空的」。
  // 判据用文件在不在，而不是 SQLite 的报错文案（文案随版本变；只读打开本就不会建库）。
  if (!fs.existsSync(layout.dbPath)) {
    return failure(
      Object.assign(new Error('元数据文件不存在：' + layout.dbPath), { code: 'DB_MISSING' }),
      '读取列表', libId,
    );
  }
  const { where, values } = buildFilter({ ...params, libId });
  let opened;
  try {
    opened = openGsDb(input.driver ? { dbPath: layout.dbPath, readOnly: true, driver: input.driver } : { dbPath: layout.dbPath, readOnly: true });
  } catch (e) {
    return failure(e, '读取列表', libId);
  }
  const db = opened.db;
  try {
    const root = layout.root;

    // ① total（筛选后；**越界也如实给** —— 它就是 COUNT，不是 rows.length）
    const totalRow = db.prepare('SELECT COUNT(*) AS n' + JOINS + where).get(...(values as never[]));
    // ⚠️ DF-2：COUNT(*) 在 readBigInts 下是 bigint ⇒ 旧写法会静默读成 0（"整库 0 条"却无报错）
    const total = numberOf(totalRow === undefined ? undefined : totalRow['n'], 'items.total(COUNT(*))');

    // ② 这一页（排序带 a.uid 兜底 ⇒ 分页确定、不会同一行出现在两页）
    const order = ' ORDER BY ' + sortCol + (desc ? ' DESC' : ' ASC') + ', a.uid ASC';
    const rows = db
      .prepare('SELECT ' + COLLIST + JOINS + where + order + ' LIMIT ? OFFSET ?')
      .all(...(values as never[]), limit, offset)
      .map((r: Record<string, unknown>, i: number) => toWire(r, root, 'items[' + String(offset + i) + ']'));

    // ③ facets：**按库统计、不受筛选影响**（一条 GROUP BY；禁止从 rows 推导）
    const folderRows = db
      .prepare('SELECT a.folder AS value, COUNT(*) AS count FROM asset a WHERE a.lib_id = ? GROUP BY a.folder ORDER BY count DESC, value ASC LIMIT ?')
      .all(libId, FACET_LIMIT);
    const extRows = db
      .prepare("SELECT p.ext AS value, COUNT(*) AS count FROM asset a JOIN asset_file p ON p.uid = a.uid AND p.role = 'preview' WHERE a.lib_id = ? GROUP BY p.ext ORDER BY count DESC, value ASC LIMIT ?")
      .all(libId, FACET_LIMIT);
    const foldersTotal = db.prepare('SELECT COUNT(DISTINCT a.folder) AS n FROM asset a WHERE a.lib_id = ?').get(libId)?.['n'];
    const extsTotal = db.prepare("SELECT COUNT(DISTINCT p.ext) AS n FROM asset a JOIN asset_file p ON p.uid = a.uid AND p.role = 'preview' WHERE a.lib_id = ?").get(libId)?.['n'];

    const facets: ItemsFacets = {
      // ⚠️ DF-2：这里同样是 DB 行 —— count/total 在 readBigInts 下是 bigint（旧写法会静默变 0）
      folders: folderRows.map((r: Record<string, unknown>, i: number) => ({
        value: textOf(r['value'], 'items.facets.folders[' + String(i) + '].value'),
        count: numberOf(r['count'], 'items.facets.folders[' + String(i) + '].count'),
      })),
      exts: extRows.map((r: Record<string, unknown>, i: number) => ({
        value: textOf(r['value'], 'items.facets.exts[' + String(i) + '].value'),
        count: numberOf(r['count'], 'items.facets.exts[' + String(i) + '].count'),
      })),
      foldersTotal: numberOf(foldersTotal, 'items.facets.foldersTotal'),
      extsTotal: numberOf(extsTotal, 'items.facets.extsTotal'),
    };

    log('[列表]', libId, 'total=' + String(total), 'rows=' + String(rows.length),
        'offset=' + String(offset), 'limit=' + String(limit), 'sort=' + sortKey);
    const data: ItemsQueryResult = { rows, total, facets, page: { offset, limit, sort: sortKey } };
    return { ok: true, data };
  } catch (e) {
    return failure(e, '读取列表', libId);
  } finally {
    try { db.close(); } catch { /* 已关 */ }
  }
}

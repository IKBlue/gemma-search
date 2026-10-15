// apps/desktop/src/main/db/row-types.ts —— data/libraries/L1/items.json（源格式）与**绿地事实层**的字段对齐
//
// 为什么要单独一个文件：
//   items.json 是**驼峰**（libId / relPath / imageMtime），SQLite 列是**下划线**（lib_id / rel_path / image_mtime）。
//   这套映射如果写在导入代码里，它就会和 DDL 各自演化 —— 而本项目已经栽过"同一概念两份定义"（AGENTS P1）。
//   ⇒ 字段↔列的配对**只在这里定义一次**（ITEM_FIELD_COLUMNS），下面所有东西都从它派生：
//     ITEM_FIELDS / ITEM_FIELD_COLUMNS / parseItemRecord（源格式解析）· joinedRowToItemRecord（新读路径合成）。
//   ⇒ db-schema.test.mjs 拿**真的 items.json**（3594 条）核对字段集；db-import.test.mjs 再核对
//     「新表 NOT NULL 列集 ↔ ItemRecord 必填字段集」—— 任一漂移就红。
//   ⚠️ DF-5（2026-10-15）：原先这里还有 **指向已退役 items 表的写 SQL 生成器**
//     （旧宽表的列清单 / 绑定器 / 两条写 SQL）与旧读映射
//     （旧宽表的行映射）—— 绿地 schema 下那张表不存在 ⇒ 它们是**死代码**，已删除。
//     写路径现在是 import.ts 直连 asset / asset_file；读路径是 joinedRowToItemRecord。
//
// 实测形状（2026-10-14 读 data/libraries/L1/items.json：3594 条 × 18 字段，字段一个不少不多）：
//   uid · libId · folder · stem · name · relPath · absPath · imageExt · imageSize · imageMtime
//   · archiveName · archiveRelPath · archiveAbsPath · archiveExt · archiveSize · archiveMtime
//   · vectorRow · vectorSource
//
// 可空性（**有意为之，不是漏写**）：
//   · archive* 六个 —— SPEC §1.1「缺包时全部为空」；缺包是**合法状态**（登记为 missing-archive）
//   · vectorRow / vectorSource —— 刚登记、还没入索引的条目没有行号，也不该发明 -1 哨兵
//   · 其余 10 个 —— 定义上必然存在（没有 preview 图就不算一条条目），一律 NOT NULL

import path from 'node:path';

import { GsDbError } from './errors.ts';

/**
 * **唯一来源**：18 组 [JSON 字段名, SQLite 列名]，顺序 = 建表顺序 = 绑定顺序。
 *
 * ⚠️ 顺序是有意义的（parseItemRecord 的取值顺序按它来），所以它是**数组**而不是对象 ——
 *    对象的键序在规范上不承载语义。
 */
export const ITEM_FIELD_COLUMNS = Object.freeze([
  ['uid', 'uid'],
  ['libId', 'lib_id'],
  ['folder', 'folder'],
  ['stem', 'stem'],
  ['name', 'name'],
  ['relPath', 'rel_path'],
  ['absPath', 'abs_path'],
  ['imageExt', 'image_ext'],
  ['imageSize', 'image_size'],
  ['imageMtime', 'image_mtime'],
  ['archiveName', 'archive_name'],
  ['archiveRelPath', 'archive_rel_path'],
  ['archiveAbsPath', 'archive_abs_path'],
  ['archiveExt', 'archive_ext'],
  ['archiveSize', 'archive_size'],
  ['archiveMtime', 'archive_mtime'],
  ['vectorRow', 'vector_row'],
  ['vectorSource', 'vector_source'],
] as const);

/** items.json 的字段名（驼峰），顺序同 items.json */
export type ItemField = (typeof ITEM_FIELD_COLUMNS)[number][0];
/** items 表的列名（下划线），顺序同 DDL */
export type ItemColumn = (typeof ITEM_FIELD_COLUMNS)[number][1];

/** items.json 里一条条目的字段名列表（从同一份配对派生，不另写一遍） */
export const ITEM_FIELDS: readonly ItemField[] = ITEM_FIELD_COLUMNS.map((pair) => pair[0]);

/**
 * **可以写 null 的字段**（单一来源）。
 *
 * 为什么要有它：DDL 里的 NOT NULL 与导入时的校验必须**说同一件事**。
 * 两边各写一份的话，DDL 改成 NOT NULL 而校验还放行 null ⇒ 导入到一半炸在 SQLite 约束上
 * （错误发生在第 N 条，前面 N-1 条已经写了 —— 这正是"不静默但很难查"的形态）。
 * ⇒ db-import.test.mjs 机械核对本集合 ↔ PRAGMA table_info(items).notnull，且逐字段实测 null 的取舍。
 */
export const ITEM_NULLABLE_FIELDS: ReadonlySet<ItemField> = new Set<ItemField>([
  'archiveName',
  'archiveRelPath',
  'archiveAbsPath',
  'archiveExt',
  'archiveSize',
  'archiveMtime',
  'vectorRow',
  'vectorSource',
]);

/**
 * items.json 里一条条目的形状。
 *
 * 它同时是**编译期**的完备性检查：parseItemRecord 用对象字面量构造它，
 * 少写一个字段、或把 number 字段写成 string，都是编译错误。
 */
export interface ItemRecord {
  uid: string;
  libId: string;
  folder: string;
  stem: string;
  name: string;
  relPath: string;
  absPath: string;
  imageExt: string;
  imageSize: number;
  imageMtime: number;
  archiveName: string | null;
  archiveRelPath: string | null;
  archiveAbsPath: string | null;
  archiveExt: string | null;
  archiveSize: number | null;
  archiveMtime: number | null;
  vectorRow: number | null;
  vectorSource: string | null;
}

// ---------------------------------------------------------------- 写 SQL（DF-5：已删除）
//
// 这里原先有指向**已退役宽表**的两条写 SQL 与绑定器。
// 绿地 schema 拆表后 items 不再存在 ⇒ 它们是死代码（写路径已由 import.ts 直连 asset / asset_file），
// 已于 DF-5（2026-10-15）删除。**不要**在这里重新加回指向旧表的 SQL 生成器。

// ---------------------------------------------------------------- 严格解析（T-11b）

export interface ParsedItem {
  record: ItemRecord;
  /** 源记录里出现、但不属于 18 字段的键（**不致命**，如实报出来，便于发现契约漂移） */
  unknownFields: string[];
}

/** 值的可读描述（错误信息里用；**不打印整条记录**，避免日志被 3594 条淹没） */
function valueLabel(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'string("' + (v.length > 32 ? v.slice(0, 32) + '…' : v) + '")';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return typeof v + '(' + String(v) + ')';
  if (Array.isArray(v)) return 'array(' + String(v.length) + ')';
  return typeof v;
}

const ITEM_FIELD_SET: ReadonlySet<string> = new Set<string>(
  ITEM_FIELDS.map((f: ItemField): string => f),
);

function invalid(where: string, why: string): GsDbError {
  return new GsDbError('IMPORT_RECORD_INVALID', where + '：' + why);
}

function pick(rec: Record<string, unknown>, field: ItemField, where: string): unknown {
  if (!Object.hasOwn(rec, field)) {
    throw invalid(
      where,
      '缺少字段 ' + field + '（18 个字段一个都不能少 —— null 是"值"，缺字段是"数据不完整"）',
    );
  }
  const v = rec[field];
  if (v === null) {
    if (ITEM_NULLABLE_FIELDS.has(field)) return null;
    throw invalid(where, '字段 ' + field + ' 不允许 null（可空字段见 ITEM_NULLABLE_FIELDS）');
  }
  return v;
}

function requireText(rec: Record<string, unknown>, field: ItemField, where: string): string {
  const v = pick(rec, field, where);
  if (typeof v !== 'string')
    throw invalid(where, '字段 ' + field + ' 类型不对：期望 string，实际 ' + valueLabel(v));
  return v;
}

function requireInteger(rec: Record<string, unknown>, field: ItemField, where: string): number {
  const v = pick(rec, field, where);
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw invalid(where, '字段 ' + field + ' 类型不对：期望有限的 number，实际 ' + valueLabel(v));
  }
  return v;
}

function optionalText(
  rec: Record<string, unknown>,
  field: ItemField,
  where: string,
): string | null {
  const v = pick(rec, field, where);
  if (v === null) return null;
  if (typeof v !== 'string')
    throw invalid(where, '字段 ' + field + ' 类型不对：期望 string 或 null，实际 ' + valueLabel(v));
  return v;
}

function optionalInteger(
  rec: Record<string, unknown>,
  field: ItemField,
  where: string,
): number | null {
  const v = pick(rec, field, where);
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw invalid(
      where,
      '字段 ' + field + ' 类型不对：期望有限的 number 或 null，实际 ' + valueLabel(v),
    );
  }
  return v;
}

/**
 * 【DF-5 已删除】旧读映射（已退役宽表的行 → ItemRecord）。
 * 绿地读路径改用下面的 joinedRowToItemRecord（三表连接行 → ItemRecord）；两者共用同一套取值器。
 *
 * 保留此注释是**有意**的：下一个人搜旧映射名时会看到「为什么没了」，
 * 而不是以为漏写。**不要**为了"兼容"把它加回来 —— 它指向的表已不存在。
 */
/**
 * 读条目用的**唯一** SELECT（S2；ItemStorePort 与测试**共用同一条**）。
 *
 * ⚠️ 为什么要提成常量（AGENTS P1）：测试里再抄一份 SQL 就是**第二份实现** ——
 *    两份会各自漂移，测试最终会去验证一个**已经不存在**的查询。
 * ⚠️ 只提**只读** SELECT：写语句（INSERT/UPDATE/DELETE）不进这里，测试也不该拿它改夹具库。
 */
const ASSET_ITEM_COLUMNS: string =
  'a.uid AS uid, a.lib_id AS lib_id, a.folder AS folder, a.stem AS stem, a.display_name AS display_name,' +
  ' a.rel_path AS rel_path,' +
  ' p.ext AS image_ext, p.size_bytes AS image_size, p.mtime_ms AS image_mtime,' +
  ' r.rel_path AS archive_rel_path, r.ext AS archive_ext, r.size_bytes AS archive_size, r.mtime_ms AS archive_mtime,' +
  ' s.vector_row AS vector_row';
const ASSET_ITEM_JOINS: string =
  ' FROM asset a' +
  " LEFT JOIN asset_file p ON p.uid = a.uid AND p.role = 'preview'" +
  " LEFT JOIN asset_file r ON r.uid = a.uid AND r.role = 'archive'" +
  ' LEFT JOIN asset_index_state s ON s.uid = a.uid';

/** 全库条目（按 rel_path 升序 —— 摘要/对账用同一个次序，免得两边各有各的顺序） */
export const ASSET_ITEM_SELECT_ALL_SQL: string =
  'SELECT ' + ASSET_ITEM_COLUMNS + ASSET_ITEM_JOINS + ' WHERE a.lib_id = ? ORDER BY a.rel_path';

/** 单条（getItem 用） */
export const ASSET_ITEM_SELECT_ONE_SQL: string =
  'SELECT ' + ASSET_ITEM_COLUMNS + ASSET_ITEM_JOINS + ' WHERE a.lib_id = ? AND a.uid = ?';

/**
 * **绿地口径**：三表连接行 → ItemRecord（S2；ItemStorePort 的读路径用）。
 *
 * 为什么需要它：旧 `items` 是一张宽表（18 列正好等于 ItemRecord 的 18 个字段），
 * 新 schema 把它拆成 `asset`（条目）+ `asset_file`（文件角色）+ `asset_index_state`（索引状态）
 * ⇒ 读路径必须**合成**。取值器与旧宽表那条映射 **同一套**（类型/可空性判据仍然只有一份）。
 *
 * 三处**新 schema 里没有、只能合成**的字段（写在这里，而不是散到各个调用点）：
 *   · `absPath` / `archiveAbsPath` —— 新 schema 只存**相对路径**（设计基线 §1.2）
 *     ⇒ 绝对路径 = 库根 + 相对路径（`root` 由调用方给，本层不猜库根）；
 *   · `archiveName` —— = archiveRelPath 的主干名（没有包 ⇒ null）；
 *   · `vectorSource` —— 新 schema **不存**它（旧宽表的诊断列）⇒ 恒 null。
 *
 * 列名约定（SQL 里的别名与这里一一对应，改别名就要改这里）：
 *   uid · lib_id · folder · stem · display_name · rel_path
 *   image_ext/image_size/image_mtime（preview 行）· archive_rel_path/archive_ext/archive_size/archive_mtime（archive 行，LEFT JOIN ⇒ 可 null）
 *   vector_row（asset_index_state，LEFT JOIN ⇒ 未编码的条目为 null）
 *
 * @throws GsDbError(IMPORT_RECORD_INVALID) —— 缺列/类型不符**响亮报**，不把 null 悄悄塞进条目
 */
export function joinedRowToItemRecord(
  row: Record<string, unknown>,
  root: string,
  where: string,
): ItemRecord {
  const g = (key: string): unknown => (Object.hasOwn(row, key) ? row[key] : undefined);
  // 先把**别名列**翻成 ItemRecord 的字段名，再交给同一套取值器（不重写类型检查）
  const byField: Record<string, unknown> = {
    uid: g('uid'),
    libId: g('lib_id'),
    folder: g('folder'),
    stem: g('stem'),
    name: g('display_name'),
    relPath: g('rel_path'),
    imageExt: g('image_ext'),
    imageSize: g('image_size'),
    imageMtime: g('image_mtime'),
    archiveRelPath: g('archive_rel_path'),
    archiveExt: g('archive_ext'),
    archiveSize: g('archive_size'),
    archiveMtime: g('archive_mtime'),
    vectorRow: g('vector_row'),
  };
  const relPath = requireText(byField, 'relPath', where);
  const archiveRelPath = optionalText(byField, 'archiveRelPath', where);
  return {
    uid: requireText(byField, 'uid', where),
    libId: requireText(byField, 'libId', where),
    folder: requireText(byField, 'folder', where),
    stem: requireText(byField, 'stem', where),
    name: requireText(byField, 'name', where),
    relPath,
    absPath: path.join(root, relPath),
    imageExt: requireText(byField, 'imageExt', where),
    imageSize: requireInteger(byField, 'imageSize', where),
    imageMtime: requireInteger(byField, 'imageMtime', where),
    archiveName: archiveRelPath === null ? null : path.basename(archiveRelPath),
    archiveRelPath,
    archiveAbsPath: archiveRelPath === null ? null : path.join(root, archiveRelPath),
    archiveExt: optionalText(byField, 'archiveExt', where),
    archiveSize: optionalInteger(byField, 'archiveSize', where),
    archiveMtime: optionalInteger(byField, 'archiveMtime', where),
    vectorRow: optionalInteger(byField, 'vectorRow', where),
    vectorSource: null,
  };
}

/**
 * 把外部 JSON 的一条记录严格解析成 ItemRecord。
 *
 * ⚠️ 为什么**严格**（缺字段 / 多字段 / 类型不对都要能发现）：
 *   宽进（缺字段就当 null）会让"源文件被截断/换了格式"变成**静默少数据**；
 *   静默少数据在本项目是最危险的失败模式（检索结果变差但不报错）。
 *   多出来的键不报错（契约会演进），但会出现在 unknownFields 里，由调用方报出来。
 *
 * @throws GsDbError(IMPORT_RECORD_INVALID)
 */
export function parseItemRecord(value: unknown, where: string): ParsedItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(where, '不是对象（条目必须是对象，SPEC §1.1）：实际 ' + valueLabel(value));
  }
  // 已确认"非 null、非数组的对象" ⇒ 收成字典视图才能按字段名取值。
  // 这不是"把断言当检查"：每个字段的存在性与类型都在下面逐条真校验。
  const rec = value as Record<string, unknown>;

  const record: ItemRecord = {
    uid: requireText(rec, 'uid', where),
    libId: requireText(rec, 'libId', where),
    folder: requireText(rec, 'folder', where),
    stem: requireText(rec, 'stem', where),
    name: requireText(rec, 'name', where),
    relPath: requireText(rec, 'relPath', where),
    absPath: requireText(rec, 'absPath', where),
    imageExt: requireText(rec, 'imageExt', where),
    imageSize: requireInteger(rec, 'imageSize', where),
    imageMtime: requireInteger(rec, 'imageMtime', where),
    archiveName: optionalText(rec, 'archiveName', where),
    archiveRelPath: optionalText(rec, 'archiveRelPath', where),
    archiveAbsPath: optionalText(rec, 'archiveAbsPath', where),
    archiveExt: optionalText(rec, 'archiveExt', where),
    archiveSize: optionalInteger(rec, 'archiveSize', where),
    archiveMtime: optionalInteger(rec, 'archiveMtime', where),
    vectorRow: optionalInteger(rec, 'vectorRow', where),
    vectorSource: optionalText(rec, 'vectorSource', where),
  };

  const unknownFields = Object.keys(rec).filter((k) => !ITEM_FIELD_SET.has(k));
  return { record, unknownFields };
}

// apps/desktop/src/main/db/row-types.ts —— items 表与 data/libraries/L1/items.json 的**字段对齐**（T-11a ③ · T-11b）
//
// 为什么要单独一个文件：
//   items.json 是**驼峰**（libId / relPath / imageMtime），SQLite 列是**下划线**（lib_id / rel_path / image_mtime）。
//   这套映射如果写在导入代码里，它就会和 DDL 各自演化 —— 而本项目已经栽过"同一概念两份定义"（AGENTS P1）。
//   ⇒ 字段↔列的配对**只在这里定义一次**（ITEM_FIELD_COLUMNS），下面所有东西都从它派生：
//     ITEM_FIELDS / ITEM_COLUMNS / itemRecordToSqlValues / ITEM_INSERT_SQL / ITEM_UPSERT_SQL。
//   ⇒ db-schema.test.mjs 拿**真的 items.json**（3594 条）核对字段集，并拿 PRAGMA table_info(items)
//     核对列顺序；db-import.test.mjs 再核对"可空集合 ↔ DDL 的 notnull" —— 任一漂移就红。
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

import { GsDbError } from './errors.ts';
import type { SqlValue } from './sqlite-adapter.ts';

/**
 * **唯一来源**：18 组 [JSON 字段名, SQLite 列名]，顺序 = 建表顺序 = 绑定顺序。
 *
 * ⚠️ 顺序是有意义的（itemRecordToSqlValues / ITEM_INSERT_SQL / ITEM_UPSERT_SQL 都按它来），
 *    所以它是**数组**而不是对象 —— 对象的键序在规范上不承载语义。
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

/** items 表的列名列表（从同一份配对派生，不另写一遍） */
export const ITEM_COLUMNS: readonly ItemColumn[] = ITEM_FIELD_COLUMNS.map((pair) => pair[1]);

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

/**
 * ItemRecord → 绑定参数（顺序 = ITEM_COLUMNS 的顺序，即 DDL 的列序）。
 * 配合 ITEM_INSERT_SQL / ITEM_UPSERT_SQL 使用；都从 ITEM_FIELD_COLUMNS 派生，不可能错位。
 */
export function itemRecordToSqlValues(item: ItemRecord): SqlValue[] {
  return ITEM_FIELD_COLUMNS.map(([field]) => item[field]);
}

// ---------------------------------------------------------------- SQL（列名从同一份配对生成）

const PLACEHOLDERS: string = ITEM_COLUMNS.map(() => '?').join(', ');

/**
 * 导入一条条目的 INSERT（列名与占位符都从 ITEM_COLUMNS 生成）。
 *
 * 为什么把 SQL 也放这儿：T-11b 的导入只要 `prepare(ITEM_INSERT_SQL)` + `itemRecordToSqlValues`，
 * 就**没有机会**写错列名或漏列 —— 这是防止"18 个字段只导了 17 个"的唯一机械办法。
 */
export const ITEM_INSERT_SQL: string =
  'INSERT INTO items (' + ITEM_COLUMNS.join(', ') + ') VALUES (' + PLACEHOLDERS + ')';

/**
 * 幂等 UPSERT：uid 冲突时**整行覆盖**为非 uid 的全部列。
 *
 * 语义（T-11b 明确写死，避免下一个人猜）：
 *   · 同一个 uid 再来一次 ⇒ 更新那一行（不新增行）⇒ 重复导入后行数不变
 *   · 覆盖的是**全部**非 uid 列，包含 NULL —— 也就是说入库结果 = 源文件那一行的忠实拷贝，
 *     不会把上一次导入残留的旧值留在库里（"部分更新"会让库和源文件静默不一致）
 */
export const ITEM_UPSERT_SQL: string =
  'INSERT INTO items (' + ITEM_COLUMNS.join(', ') + ') VALUES (' + PLACEHOLDERS + ')' +
  ' ON CONFLICT(uid) DO UPDATE SET ' +
  ITEM_COLUMNS.filter((c) => c !== 'uid')
    .map((c) => c + ' = excluded.' + c)
    .join(', ');

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
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return typeof v + '(' + String(v) + ')';
  if (Array.isArray(v)) return 'array(' + String(v.length) + ')';
  return typeof v;
}

const ITEM_FIELD_SET: ReadonlySet<string> = new Set<string>(ITEM_FIELDS.map((f: ItemField): string => f));

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
  if (typeof v !== 'string') throw invalid(where, '字段 ' + field + ' 类型不对：期望 string，实际 ' + valueLabel(v));
  return v;
}

function requireInteger(rec: Record<string, unknown>, field: ItemField, where: string): number {
  const v = pick(rec, field, where);
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw invalid(where, '字段 ' + field + ' 类型不对：期望有限的 number，实际 ' + valueLabel(v));
  }
  return v;
}

function optionalText(rec: Record<string, unknown>, field: ItemField, where: string): string | null {
  const v = pick(rec, field, where);
  if (v === null) return null;
  if (typeof v !== 'string') throw invalid(where, '字段 ' + field + ' 类型不对：期望 string 或 null，实际 ' + valueLabel(v));
  return v;
}

function optionalInteger(rec: Record<string, unknown>, field: ItemField, where: string): number | null {
  const v = pick(rec, field, where);
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw invalid(where, '字段 ' + field + ' 类型不对：期望有限的 number 或 null，实际 ' + valueLabel(v));
  }
  return v;
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

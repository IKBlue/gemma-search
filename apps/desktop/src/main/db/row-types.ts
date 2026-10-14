// apps/desktop/src/main/db/row-types.ts —— items 表与 data/libraries/L1/items.json 的**字段对齐**（T-11a 要求 ③）
//
// 为什么要单独一个文件：
//   items.json 是**驼峰**（libId / relPath / imageMtime），SQLite 列是**下划线**（lib_id / rel_path / image_mtime）。
//   这套映射如果写在导入代码里，它就会和 DDL 各自演化 —— 而本项目已经栽过"同一概念两份定义"（AGENTS P1）。
//   ⇒ 字段↔列的配对**只在这里定义一次**（ITEM_FIELD_COLUMNS），下面所有东西都从它派生：
//     ITEM_FIELDS / ITEM_COLUMNS / itemRecordToSqlValues / ITEM_INSERT_SQL。
//   ⇒ db-schema.test.mjs 会拿**真的 items.json**（3594 条）核对字段集，并拿 PRAGMA table_info(items)
//     核对列顺序 —— 两边任一漂移，测试就红。
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

import type { SqlValue } from './sqlite-adapter.ts';

/**
 * **唯一来源**：18 组 [JSON 字段名, SQLite 列名]，顺序 = 建表顺序 = 绑定顺序。
 *
 * ⚠️ 顺序是有意义的（itemRecordToSqlValues 与 ITEM_INSERT_SQL 都按它来），
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
 * items.json 里一条条目的形状。
 *
 * `item[field]`（field: ItemField）在 itemRecordToSqlValues 里被使用 ⇒ 少写一个字段是**编译期**错误。
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
 * 配合 ITEM_INSERT_SQL 使用；两条都从 ITEM_FIELD_COLUMNS 派生，不可能错位。
 */
export function itemRecordToSqlValues(item: ItemRecord): SqlValue[] {
  return ITEM_FIELD_COLUMNS.map(([field]) => item[field]);
}

/**
 * 导入一条条目的 INSERT（列名与占位符都从 ITEM_COLUMNS 生成）。
 *
 * 为什么把 SQL 也放这儿：T-11b 的导入只要 `prepare(ITEM_INSERT_SQL)` + `itemRecordToSqlValues`，
 * 就**没有机会**写错列名或漏列 —— 这是防止"18 个字段只导了 17 个"的唯一机械办法。
 */
export const ITEM_INSERT_SQL: string = `INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')})`;

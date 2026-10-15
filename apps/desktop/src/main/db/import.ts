// apps/desktop/src/main/db/import.ts —— 从 items.json 导入条目（T-11b）
//
// 职责边界（老规矩：**只接收路径**，不 import electron、不读全局）：
//   · 源文件路径 = itemsJsonPath（调用方从库根/索引自举目录解析后传入）
//   · 计数来源 = **expectedCount 优先**（meta.json 的 count，读几百字节）；
//     .gs-index.bin 的 header.count 是**可选的重校验路径**（读整块 11 MB + sha1，只在要顺带证明索引完好时用）
//     —— 解析一律交给引擎的 readIndexBin，本层不实现第二份 GSIDX 解析（AGENTS P1）
//   · 落点路径 = 由调用方先用 openGsDb() 打开并把连接传进来
//
// ── 2026-10-15 · S2 改写：落点从**旧表**（library / items）换成**绿地 6 张表**的事实层 ──────
//   · 写 `asset`（条目）+ `asset_file`（文件角色，**缺包 = 少一行**，不是 NULL 块）；
//   · **不再**写 `library`：绿地口径下库注册表是 `library_registry`，它在 **app.db**（应用级），
//     唯一写入口是 library* 那组方法（DESIGN-6tables §1.1/§2.3）；本层只需要 libId 做 `asset.lib_id`。
//   · uid **认领**：先按 (lib_id, rel_path) 命中 ⇒ 沿用库里原 uid（"路径才是身份"，见 §1.2）；
//   · `discovered_at_ms` = **首次**被发现时刻 ⇒ 更新时**不覆盖**；
//   · 旧表时代的那条外键前置条件（先建 library 行）**随之消失**：`asset.lib_id` 是普通 TEXT（§0）。
//
// ── 导入语义：**镜像**（这件事必须写死，不能让下一个人猜）────────────────────────
//   导入完成后，`asset` 里属于该库的行集 == items.json 里的 rel_path 集：
//     · 源里有、库里没有 ⇒ INSERT          （inserted）
//     · 源里有、库里也有 ⇒ 整行覆盖为源值   （updated；**discovered_at_ms 除外**，它是首次时刻）
//     · 源里没有、库里有 ⇒ **删除**         （deleted；asset_file 由 ON DELETE CASCADE 跟着走）
//   ⇒ 本函数只接受**全量** items.json，不要拿它导增量/片段文件。
//   ⇒ 镜像让"导入后行数 == 文件行数"成为可断言的等式（要求①的计数校验就建立在它上面）。
//
// ── 为什么"先全验完再写"──────────────────────────────────────────────────────
//   缺字段 / 类型不对 / 重复 uid / libId 不匹配 / 期望计数不符 —— 全部在 BEGIN 之前查完。
//   坏源文件因此**一行都不会写**：不产生"导了一半"的中间态，也不用指望回滚来收拾。
//   BEGIN 之后只剩两类可能失败：SQLite 自身的约束（例如外键）与最终计数复核 —— 两者都整条回滚。
//
// ── 外键前置条件（T-11a 交接）────────────────────────────────────────────────
//   items.lib_id 有外键 → library(lib_id)，驱动默认 enableForeignKeyConstraints=true。
//   所以本函数在写 items **之前**先 upsert library 行（同一事务内），否则第一条就
//   FOREIGN KEY constraint failed（证据 reports/2026-10-15-wave3/11a.txt 的 B1b 留了反例）。

import { readIndexBin, readItems } from '../../../../../packages/engine/src/index.ts';
import type { IndexItem } from '../../../../../packages/engine/src/index.ts';
import { GsDbError, describeError } from './errors.ts';
import { parseItemRecord, type ItemRecord } from './row-types.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

/** 被导入的那个库（library 表的行；FK 的前置条件就是它） */
export interface ImportLibraryRef {
  libId: string;
  /** 库根（**只是元数据**：本层不拿它去读文件；读什么都由 itemsJsonPath / indexBinPath 显式给出） */
  root: string;
  /** 是否落在 userData 回退落点（T-04 的判定结果，由调用方给） */
  fallback?: boolean;
  compat?: string | null;
  compatKeyVersion?: number | null;
  modelRepo?: string | null;
  modelRevision?: string | null;
  dim?: number | null;
  seq?: number | null;
  /** meta.json 原文（派生数据，整份留着便于排查） */
  metaJson?: string | null;
}

export interface ImportItemsOptions {
  /** 已打开的 .gs.db 连接（先 openGsDb） */
  db: SqlDatabase;
  library: ImportLibraryRef;
  itemsJsonPath: string;
  /**
   * .gs-index.bin 落点 —— **可选的重校验路径**：给了就用它的 header.count 当期望计数，
   * 代价是读整块 11 MB 并算 sha1（引擎的五道校验）。默认推荐改用下面的 expectedCount。
   */
  indexBinPath?: string | null;
  /**
   * 期望计数（**默认推荐**：meta.json 的 count，几百字节就能读到）。
   * 与 indexBinPath 的 count **都要**与 items.json 的行数相等 —— 两个来源不一致时一定会报 IMPORT_COUNT_MISMATCH。
   */
  expectedCount?: number | null;
  now?: () => number;
}

export interface ImportItemsReport {
  libId: string;
  libRoot: string;
  itemsJsonPath: string;
  indexBinPath: string | null;
  /** 从 .gs-index.bin header.count 读到的期望值（没给 indexBinPath 就是 null） */
  indexCount: number | null;
  /** 本次实际参与校验的全部期望值（index.count 与/或 expectedCount） */
  expectedCounts: number[];
  /** items.json 解出的行数（引擎 readItems 口径） */
  read: number;
  /** 唯一 uid 数（当前实现里 read == uniqueUids，重复 uid 会先报错） */
  uniqueUids: number;
  /** 本次新插入的行数 */
  inserted: number;
  /** 本次被覆盖更新的行数 */
  updated: number;
  /** 本次因"源文件里已没有"而删除的行数（镜像语义） */
  deleted: number;
  /** 事务内复核得到的落库行数（应恒等于 read） */
  dbCount: number;
  /** 源记录里出现的、18 字段之外的键（不致命，如实报出来） */
  unknownFields: string[];
  /** 旧表时代是"library 行本次新建"；绿地后恒为 false（库注册表归 library* 方法写，本层不写） */
  libraryCreated: boolean;
  /** 本次写入的 asset_file 行里的**包行**数（预览行数 = 条目数；缺包的条目少一行） */
  archiveFileRows?: number;
  /** 恒为 'mirror'：见文件头的语义说明 */
  mode: 'mirror';
}

// ---------------------------------------------------------------- SQL

// 先插入（已存在则什么都不做），再单独 UPDATE：
// 这样"哪些可选字段本次没提供"就能用 null 表达（COALESCE(null, 旧值) = 保留旧值），
// 而 fallback 是 NOT NULL，不能靠 null 表达"没提供" —— 所以插入与更新分成两条语句。
// 绿地 6 张表口径的 SQL（DESIGN-6tables §1.2）：只有 asset / asset_file，**没有** items / library。
const SELECT_ASSET_UIDS_SQL: string = 'SELECT uid FROM asset WHERE lib_id = ?';
const SELECT_ASSET_UID_BY_PATH_SQL: string =
  'SELECT uid FROM asset WHERE lib_id = ? AND rel_path = ?';
const INSERT_ASSET_SQL: string =
  'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms)' +
  ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
/** 更新**不碰** discovered_at_ms：它是"首次被发现时刻"，认领与改名都要保留第一次的值 */
const UPDATE_ASSET_SQL: string =
  'UPDATE asset SET lib_id = ?, folder = ?, stem = ?, display_name = ?, rel_dir = ?, rel_path = ? WHERE uid = ?';
const DELETE_ASSET_SQL: string = 'DELETE FROM asset WHERE uid = ? AND lib_id = ?';
const COUNT_ASSETS_SQL: string = 'SELECT COUNT(*) AS n FROM asset WHERE lib_id = ?';
const DELETE_ASSET_FILES_SQL: string = 'DELETE FROM asset_file WHERE uid = ?';
/**
 * \`asset_index_state\` 的 1:1 行（设计基线 §1.2「1:1 于条目」）。
 *
 * ⚠️ S2 修 M0（真根因）：源 items.json **带着 vectorRow**，而它是"命中行 → 条目"的**唯一映射** ——
 *    GSIDX 是稠密矩阵，引擎靠 \`Item.vectorRow\` 把命中行还原成条目。
 *    只写 asset/asset_file 会让 vector_row 全 NULL ⇒ 检索命中一条都映射不回来 ⇒ **界面 0 条**
 *    （e2e m0-real 实测：invoke search → ok，但结果 0 条）。
 *    这里**只种这一列**；encoded_at_ms / compat_key 等编码态仍归索引任务写（唯一写入口不变）。
 */
const UPSERT_STATE_VECTOR_ROW_SQL: string =
  'INSERT INTO asset_index_state (uid, vector_row) VALUES (?, ?)' +
  ' ON CONFLICT(uid) DO UPDATE SET vector_row = excluded.vector_row';

const UPSERT_ASSET_FILE_SQL: string =
  'INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
  ' ON CONFLICT(uid, role) DO UPDATE SET rel_path = excluded.rel_path, ext = excluded.ext,' +
  ' size_bytes = excluded.size_bytes, mtime_ms = excluded.mtime_ms, width = excluded.width, height = excluded.height';

/** relPath ⇒ 相对目录的**规范形**（库根 ⇒ 空串）；'\' 与 '/' 都认（items.json 用 '\'） */
function relDirOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf('\\'), relPath.lastIndexOf('/'));
  return i < 0 ? '' : relPath.slice(0, i);
}

/** 扩展名（含点、小写）；没有扩展名就给空串 —— 只在源里缺 ext 时兜底 */
function extOf(relPath: string): string {
  const base = relPath.slice(Math.max(relPath.lastIndexOf('\\'), relPath.lastIndexOf('/')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

// ---------------------------------------------------------------- 入参校验

function requireNonEmptyText(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new GsDbError('IMPORT_INPUT_INVALID', name + ' 必须是非空字符串');
  return text;
}

function optionalPositiveInt(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new GsDbError(
      'IMPORT_INPUT_INVALID',
      name + ' 必须是正整数或省略，实际 ' + String(value),
    );
  }
  return value;
}

/**
 * 读 .gs-index.bin 的 header.count —— **可选的重校验路径**（不是默认计数来源）。
 *
 * ⚠️ 为什么它只是"可选"（T-11c 按 Lead 裁定降级，见 reports/2026-10-15-wave3/11c.txt）：
 *   为拿一个数字要把整块 11 MB 向量读进来、还要算一遍 sha1（引擎的五道校验里最贵的那道），
 *   而 meta.json 的 count 是**几百字节**的同名事实，读它几乎免费。
 *   ⇒ 默认计数来源 = expectedCount（meta.json 的 count，由调用方传）；
 *     本函数只在"需要顺带证明索引本身完好"时用（T-11c 的对账、T-15 的完整性自检）。
 *   两个都给也可以：本层**两个都要满足**（不会因为便宜的那个先比就跳过贵的那个）。
 *
 * ⚠️ 解析仍交给**引擎**（readIndexBin 跑完五道校验）—— 本层不实现第二份 GSIDX 解析（AGENTS P1）。
 */
export function readIndexItemCount(indexBinPath: string): number {
  const file = requireNonEmptyText(indexBinPath, 'indexBinPath');
  try {
    return readIndexBin(file).count;
  } catch (e) {
    throw new GsDbError(
      'IMPORT_INDEX_UNREADABLE',
      '读 .gs-index.bin 失败：' +
        file +
        '（' +
        describeError(e) +
        '）—— 索引缺失或损坏时先重建索引，别拿它当计数来源',
      { cause: e },
    );
  }
}

function readCount(db: SqlDatabase, libId: string): number {
  const row = db.prepare(COUNT_ASSETS_SQL).get(libId);
  const n = row === undefined ? undefined : row['n'];
  if (typeof n !== 'number') {
    throw new GsDbError('UNEXPECTED_SQL_VALUE', 'COUNT(*) 没有返回数字：实际 ' + String(n));
  }
  return n;
}

// ---------------------------------------------------------------- 总入口

/**
 * 把 items.json 全量导入 .gs.db（镜像语义，见文件头）。
 *
 * @throws GsDbError(IMPORT_INPUT_INVALID | IMPORT_SOURCE_INVALID | IMPORT_INDEX_UNREADABLE |
 *                  IMPORT_RECORD_INVALID | IMPORT_DUPLICATE_UID | IMPORT_COUNT_MISMATCH | IMPORT_FAILED)
 */
export function importItemsFromJson(options: ImportItemsOptions): ImportItemsReport {
  const db = options.db;
  if (db === undefined || db === null || db.isOpen !== true) {
    throw new GsDbError('IMPORT_INPUT_INVALID', '需要一个**已打开**的 .gs.db 连接（先 openGsDb）');
  }
  const libId = requireNonEmptyText(options.library?.libId, 'library.libId');
  const root = requireNonEmptyText(options.library?.root, 'library.root');
  const itemsJsonPath = requireNonEmptyText(options.itemsJsonPath, 'itemsJsonPath');
  const indexBinPath =
    options.indexBinPath === undefined || options.indexBinPath === null
      ? null
      : requireNonEmptyText(options.indexBinPath, 'indexBinPath');
  const now = options.now ?? Date.now;
  const explicitExpected = optionalPositiveInt(options.expectedCount, 'expectedCount');

  // ---- 期望计数：先收集（index.bin 的 count 与调用方给的都要满足）
  const expectedCounts: number[] = [];
  let indexCount: number | null = null;
  if (indexBinPath !== null) {
    indexCount = readIndexItemCount(indexBinPath);
    expectedCounts.push(indexCount);
  }
  if (explicitExpected !== null) expectedCounts.push(explicitExpected);

  // ---- ① 读源（items.json 的格式与解析归引擎，本层不重写一份 JSON 遍历）
  let rawItems: IndexItem[];
  try {
    rawItems = readItems(itemsJsonPath);
  } catch (e) {
    throw new GsDbError(
      'IMPORT_SOURCE_INVALID',
      '读 items.json 失败：' + itemsJsonPath + '（' + describeError(e) + '）',
      { cause: e },
    );
  }

  // ---- ② 全部先严格校验（坏数据 ⇒ 一行都不写）
  const records: ItemRecord[] = [];
  const unknownFields = new Set<string>();
  const uids = new Set<string>();
  const duplicates: string[] = [];
  rawItems.forEach((raw, index) => {
    const parsed = parseItemRecord(raw, 'items.json[' + String(index) + ']');
    for (const field of parsed.unknownFields) unknownFields.add(field);
    if (uids.has(parsed.record.uid)) duplicates.push(parsed.record.uid);
    uids.add(parsed.record.uid);
    records.push(parsed.record);
  });
  if (duplicates.length > 0) {
    throw new GsDbError(
      'IMPORT_DUPLICATE_UID',
      'items.json 里有 ' +
        String(duplicates.length) +
        ' 个重复 uid（例如 ' +
        duplicates.slice(0, 3).join(', ') +
        '）—— 重复 uid 会让"读入行数 == 入库行数"不成立；先修源文件或重建索引，别让它变成静默少导',
    );
  }
  const foreign = records.find((r) => r.libId !== libId);
  if (foreign !== undefined) {
    throw new GsDbError(
      'IMPORT_RECORD_INVALID',
      'items.json 里出现不属于 ' +
        libId +
        ' 的条目：uid=' +
        foreign.uid +
        ' libId=' +
        foreign.libId +
        ' —— 一张条目表只能导进它自己的库（否则外键会拒，或被导进别的库）',
    );
  }
  for (const expected of expectedCounts) {
    if (expected !== records.length) {
      throw new GsDbError(
        'IMPORT_COUNT_MISMATCH',
        '计数不符：期望 ' +
          String(expected) +
          '，items.json 实际 ' +
          String(records.length) +
          ' 条 —— 拒绝导入（宁可报错，也不静默少导 ' +
          String(Math.abs(expected - records.length)) +
          ' 条）',
      );
    }
  }

  // ---- ③ 单事务写：asset upsert（uid 认领）→ asset_file（每图一行 + 每包一行，缺包少一行）
  //      → 删幽灵行 → 计数复核
  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = new Set<string>();
    for (const row of db.prepare(SELECT_ASSET_UIDS_SQL).all(libId)) {
      const uid = row['uid'];
      if (typeof uid === 'string') existing.add(uid);
    }

    const selectByPath = db.prepare(SELECT_ASSET_UID_BY_PATH_SQL);
    const insertAsset = db.prepare(INSERT_ASSET_SQL);
    const updateAsset = db.prepare(UPDATE_ASSET_SQL);
    const deleteFiles = db.prepare(DELETE_ASSET_FILES_SQL);
    const upsertFile = db.prepare(UPSERT_ASSET_FILE_SQL);
    const upsertStateVectorRow = db.prepare(UPSERT_STATE_VECTOR_ROW_SQL);

    const claimed = new Set<string>();
    let inserted = 0;
    let updated = 0;
    let archiveRows = 0;

    for (const record of records) {
      const relPath = record.relPath;
      const relDir = relDirOf(relPath);
      // 认领：先按 (lib_id, rel_path) 命中 ⇒ 沿用库里那个 uid（"路径才是身份"，DESIGN §1.2）
      const hit = selectByPath.get(libId, relPath);
      const hitUid = hit === undefined ? undefined : hit['uid'];
      let uid: string;
      if (typeof hitUid === 'string') {
        uid = hitUid;
        updateAsset.run(libId, record.folder, record.stem, record.name, relDir, relPath, uid);
        updated += 1;
      } else if (existing.has(record.uid)) {
        uid = record.uid; // 同一 uid、路径变了（改名）⇒ 就地更新，不新建
        updateAsset.run(libId, record.folder, record.stem, record.name, relDir, relPath, uid);
        updated += 1;
      } else {
        uid = record.uid;
        insertAsset.run(
          uid,
          libId,
          record.folder,
          record.stem,
          record.name,
          relDir,
          relPath,
          startedAt,
        );
        inserted += 1;
      }
      claimed.add(uid);

      // 文件角色：**每图一行 + 每包一行**；缺包就**少一行**（不补 NULL 块）
      // width/height 留 NULL：只有扫描器才解像素（本层只搬 items.json 里已有的事实）
      deleteFiles.run(uid);
      upsertFile.run(
        uid,
        'preview',
        relPath,
        record.imageExt || extOf(relPath),
        record.imageSize,
        record.imageMtime,
        null,
        null,
      );
      // 命中行 → 条目的映射（M0 的根因就在这一行缺失；见 UPSERT_STATE_VECTOR_ROW_SQL 的注释）
      upsertStateVectorRow.run(uid, record.vectorRow);
      if (record.archiveRelPath !== null && record.archiveRelPath !== '') {
        // size/mtime 在 DDL 里是 NOT NULL；源里"包存在但没给 size/mtime"是源的不一致，
        // 这里记 0 而不是让整条导入失败（下一次扫描会用磁盘事实修正它）。
        upsertFile.run(
          uid,
          'archive',
          record.archiveRelPath,
          record.archiveExt ?? extOf(record.archiveRelPath),
          record.archiveSize ?? 0,
          record.archiveMtime ?? 0,
          null,
          null,
        );
        archiveRows += 1;
      }
    }

    // 镜像：源里没有的条目 ⇒ 删（asset_file 由 ON DELETE CASCADE 跟着走）
    const remove = db.prepare(DELETE_ASSET_SQL);
    let deleted = 0;
    for (const uid of existing) {
      if (claimed.has(uid)) continue;
      remove.run(uid, libId);
      deleted += 1;
    }

    const dbCount = readCount(db, libId);
    if (dbCount !== records.length) {
      throw new GsDbError(
        'IMPORT_COUNT_MISMATCH',
        '入库后计数不符：期望 ' +
          String(records.length) +
          '，库里实际 ' +
          String(dbCount) +
          ' —— 已回滚',
      );
    }
    db.exec('COMMIT');

    return {
      libId,
      libRoot: root,
      itemsJsonPath,
      indexBinPath,
      indexCount,
      expectedCounts,
      read: rawItems.length,
      uniqueUids: uids.size,
      inserted,
      updated,
      deleted,
      dbCount,
      unknownFields: [...unknownFields].sort(),
      archiveFileRows: archiveRows,
      // 绿地后库注册表 = app.db 的 library_registry，唯一写入口是 library* 那组方法
      // ⇒ 导入不建库行，这个字段恒为 false（保留字段是为了不动调用方的读取点）
      libraryCreated: false,
      mode: 'mirror',
    };
  } catch (e) {
    let rollbackNote = '';
    try {
      db.exec('ROLLBACK');
    } catch (re) {
      rollbackNote = '（回滚也失败了：' + describeError(re) + '）';
    }
    if (e instanceof GsDbError) {
      if (rollbackNote) e.message += rollbackNote;
      throw e;
    }
    throw new GsDbError(
      'IMPORT_FAILED',
      '导入写入阶段失败，已回滚（库里没有半份导入）：' + describeError(e) + rollbackNote,
      { cause: e },
    );
  }
}

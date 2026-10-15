// apps/desktop/tests/db-import.test.mjs —— T-11b 从 items.json 导入的验收测试
//
// 每条用例对应一个**会静默出错的失败模式**：
//   I1 导入没写全 / 字段错位     ⇒ 检索少结果，但不报错
//   I2 重复导入长出重复行        ⇒ 计数虚高，浏览页出现重复条目
//   I3 库变小后幽灵行不删        ⇒ items 表比素材多，计数永远对不上
//   I4 坏记录"导了一半"          ⇒ 库里一半新一半旧，且没人知道从哪条断的
//   I5 缺字段当 null / null 当缺字段 ⇒ 数据不完整被当成合法值
//   I7 计数不符仍然导入          ⇒ 静默少导 N 条（本项目最危险的失败模式）
//   I8 重复 uid 被静默合并       ⇒ 读入 3594 条、入库 3593 条，没人发现
//   I11 可空集合与 DDL 漂移      ⇒ 校验放行 null，SQLite 却在第 N 条拒 —— 前面已写一半
//
// 跑法：node --test apps/desktop/tests/db-import.test.mjs（也在 npm test 的 glob 里）
// 临时库落在仓库内 data/_t11/db-import-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。
// ⚠️ 环境：本会话沙箱把 electron.exe 的写限制在仓库内（G:\model / AppData EPERM），
//    所以临时库**故意**用仓库内路径；产品落点由 T-04 storage-roots.ts 给。
// ⚠️ 全量门禁（npm test / typecheck / build / e2e）由 Lead 统一跑 —— TASKS §3.6 规定同一时刻只允许一个人跑 npm test。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSET_ITEM_SELECT_ALL_SQL,
  GsDbError,
  ITEM_FIELD_COLUMNS,
  ITEM_NULLABLE_FIELDS,
  joinedRowToItemRecord,
  importItemsFromJson,
  openGsDb,
  parseItemRecord,
  readIndexItemCount,
} from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t11', 'db-import-test-' + process.pid);
const FIXED_NOW = 1700000000000;
const now = () => FIXED_NOW;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + (++seq));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** 合成条目：18 字段齐全（真数据由 I12 覆盖） */
function makeItem(uid, over = {}) {
  return Object.assign(
    {
      uid,
      libId: 'L1',
      folder: 'CR',
      stem: 'ID-' + uid,
      name: 'ID-' + uid + '.jpg',
      relPath: 'CR/ID-' + uid + '.jpg',
      absPath: 'X:/lib/CR/ID-' + uid + '.jpg',
      imageExt: '.jpg',
      imageSize: 1000,
      imageMtime: 1700000000000,
      archiveName: 'ID-' + uid + '.rar',
      archiveRelPath: 'CR/ID-' + uid + '.rar',
      archiveAbsPath: 'X:/lib/CR/ID-' + uid + '.rar',
      archiveExt: '.rar',
      archiveSize: 2000,
      archiveMtime: 1699999999999,
      vectorRow: 0,
      vectorSource: 'native',
    },
    over,
  );
}
const U1 = 'aaaaaaaaaaaa';
const U2 = 'bbbbbbbbbbbb';
const U3 = 'cccccccccccc';

function writeItemsJson(dir, items, name = 'items.json') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(items), 'utf8');
  return p;
}

function openDb(dir) {
  return openGsDb({ dbPath: path.join(dir, '.gs.db'), now });
}

/**
 * 把 **新 schema** 的三张表读成 ItemRecord 列表（S2）。
 *
 * ⚠️ 为什么用产品的两个符号、而不是在测试里写 SQL：共享的 SELECT 常量 + 合成函数是
 *    「列↔字段」映射的**唯一一份**（P1）；测试自己抄一份列序，将来一定会去验证一个不存在的查询。
 *    绝对路径按本文件的夹具约定给（root = 'X:/lib'）。
 */
const LIB_ROOT_FOR_READ = 'X:/lib';
function readAssets(db, libId = 'L1') {
  return db
    .prepare(ASSET_ITEM_SELECT_ALL_SQL)
    .all(libId)
    .map((row, i) => joinedRowToItemRecord(row, LIB_ROOT_FOR_READ, 'db-import asset[' + String(i) + ']'));
}
/** 按 uid 取一条（旧口径是直接查宽表；现在从共享 SELECT 合成出的列表里找） */
function readAsset(db, uid, libId = 'L1') {
  return readAssets(db, libId).find((r) => r.uid === uid) ?? null;
}
/** 旧表**不得**复活（绿地 6 张表里没有它们）—— 正向断言用，替代"旧库行存在"那类断言 */
function legacyTablesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'library') ORDER BY name")
    .all()
    .map((r) => r.name);
}
function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  if (row === undefined) return undefined;
  return row[Object.keys(row)[0]];
}
const throwsCode = (code) => (e) => e instanceof GsDbError && e.code === code;

/** 一次"全新库 + 一个导入"的最小现场 */
function setup(label, items, extra = {}) {
  const dir = freshDir(label);
  const itemsJsonPath = writeItemsJson(dir, items);
  const opened = openDb(dir);
  return {
    dir,
    itemsJsonPath,
    db: opened.db,
    report: importItemsFromJson(
      Object.assign({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now }, extra),
    ),
  };
}

// ============================================================ I1 首次导入

test('I1 ⭐ 首次导入：3 条全部落库、字段往返一致、library 行先建好', () => {
  const s = setup('I1', [makeItem(U1), makeItem(U2), makeItem(U3)]);
  try {
    assert.equal(s.report.mode, 'mirror');
    assert.equal(s.report.read, 3);
    assert.equal(s.report.uniqueUids, 3);
    assert.equal(s.report.inserted, 3);
    assert.equal(s.report.updated, 0);
    assert.equal(s.report.deleted, 0);
    assert.equal(s.report.dbCount, 3);
    // 【改前】assert.equal(s.report.libraryCreated, true, 'library 行必须是这次建的（FK 前置条件）')
    // 【改后】绿地口径：导入**不**写库注册表（它在 app.db，由 library* 方法写）⇒ 该字段恒 false；
    //        并补两条**正向**断言：库里不得有旧表、asset 计数必须等于落库行数。
    // 【为何非放宽】旧断言要求「建了库行」——新 schema 下永远做不到（恒红）；新断言要求「旧结构不存在 +
    //        计数正确」，能被「有人把库行/旧表加回来」打红。
    assert.equal(s.report.libraryCreated, false, '绿地后导入不写库注册表 ⇒ 恒 false（契约）');
    assert.deepEqual(legacyTablesOf(s.db), [], '库级 .gs.db 不得出现旧表 items / library');
    assert.deepEqual(s.report.expectedCounts, [], '没给期望计数时不该凭空造一个');
    assert.deepEqual(s.report.unknownFields, []);

    // 【改前】读旧库行并断言 root / fallback / 条目计数 / 注册时刻（旧宽表时代的口径）
    // 【改后】绿地口径下库级 .gs.db **没有**库注册表 ⇒ 改成「旧结构不存在」+「计数与落库行数一致」
    //         （「条目计数存在库行上」这个概念本身已不复存在：计数就是 asset 的行数）
    // 【为何非放宽】旧断言要求"库行存在且字段对"（新 schema 下恒红）；新断言要求"不得有旧表"且
    //         "asset / asset_file 计数正确" —— 从"期待旧行为"变成"禁止旧结构 + 正向计数"。
    assert.deepEqual(legacyTablesOf(s.db), [], '库级 .gs.db 不得有旧表 items / library（绿地 6 张表）');
    assert.equal(scalar(s.db, 'SELECT COUNT(*) AS n FROM asset'), 3, 'asset 计数必须与落库行数一致');
    assert.equal(scalar(s.db, "SELECT COUNT(*) AS n FROM asset_file WHERE role = 'preview'"), 3, '每条一个 preview 行');

    // 【改前】直接查旧宽表 + 按 [字段,列名] 逐列比（完整三行记录见 reports/2026-10-15-wave3/s2.txt）
    // 【改后】readAsset（共享 SELECT + joinedRowToItemRecord 合成）后按**字段名**逐字段比 —— 比旧口径更严：
    //         合成器要同时对上 asset 与 asset_file 两张表，任一张少列/错列都会当场炸（旧口径只比一张宽表）。
    // 【为何非放宽】断言内容一样是"逐字段原样落库"，只是取值路径改成产品那一份映射（P1），且覆盖面更宽。
    const row = readAsset(s.db, U2);
    const expect = makeItem(U2);
    for (const [field] of ITEM_FIELD_COLUMNS) {
      // absPath / archiveAbsPath 是**派生**字段（= 库根 + 相对路径，§1.2 只存相对路径）⇒ 下面单独断言；
      // vectorSource 是旧宽表的**源格式诊断列**，新 schema **有意不存** ⇒ 也不参与往返比对（源里的值仍被校验）。
      if (field === 'absPath' || field === 'archiveAbsPath' || field === 'vectorSource') continue;
      assert.deepEqual(row[field], expect[field], field + ' 必须原样落库（经 asset/asset_file 合成）');
    }
    assert.equal(row.absPath, path.join('X:/lib', expect.relPath), 'absPath 必须 = 库根 + 相对路径（合成）');
    assert.equal(row.archiveAbsPath, path.join('X:/lib', expect.archiveRelPath), 'archiveAbsPath 同理（合成）');
  } finally {
    s.db.close();
  }
});

test('I1b：未知字段不致命，但必须出现在 unknownFields 里（不静默丢字段）', () => {
  const item = makeItem(U1);
  item.someFutureField = 42;
  const s = setup('I1b', [item]);
  try {
    assert.deepEqual(s.report.unknownFields, ['someFutureField']);
    assert.equal(s.report.dbCount, 1);
  } finally {
    s.db.close();
  }
});

// ============================================================ I2 幂等

test('I2 ⭐ 重复导入幂等：不产生重复行，第二次全是 update', () => {
  const s = setup('I2', [makeItem(U1, { imageSize: 111 }), makeItem(U2), makeItem(U3)]);
  try {
    const before = readAsset(s.db, U1);
    const second = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.equal(second.libraryCreated, false, '第二次不该再建 library 行');
    assert.equal(second.inserted, 0, '第二次不许插入新行');
    assert.equal(second.updated, 3);
    assert.equal(second.deleted, 0);
    assert.equal(second.dbCount, 3);
    assert.equal(scalar(s.db, 'SELECT COUNT(*) AS n FROM asset'), 3, '总行数必须还是 3');

    const third = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.deepEqual(
      { inserted: third.inserted, updated: third.updated, deleted: third.deleted, dbCount: third.dbCount },
      { inserted: 0, updated: 3, deleted: 0, dbCount: 3 },
      '第三次必须与第二次完全一致（收敛，不是越导越多）',
    );

    const after = readAsset(s.db, U1);
    assert.deepEqual(after, before, '幂等重跑不得改动行内容（合成后的 ItemRecord 逐字段一致）');
  } finally {
    s.db.close();
  }
});

test('I2b：源文件里的新值会整行覆盖（不是"保留旧值"）', () => {
  const s = setup('I2b', [makeItem(U1, { imageSize: 111, archiveName: 'old.rar' })]);
  try {
    // 【改前】只把 archiveName 写成 null（旧 schema 里 archiveName 是**独立存储**的列）
    // 【改后】把**包的指针**也去掉（archiveRelPath 等）—— 绿地口径下 archiveName / archiveAbsPath 是
    //         **派生**字段（= archiveRelPath 的主干名 / 库根 + 相对路径），"有没有包"只由指针决定。
    // 【为何非放宽】这是**更强**的断言：不但要求"源里的 null 覆盖旧值"，还要求"没有包 ⇒ asset_file 里
    //         不该有 archive 行 ⇒ 合成回 null"。旧写法在新 schema 下反而会**误红**（指针还在 ⇒ 仍能合成出名字）。
    fs.writeFileSync(
      s.itemsJsonPath,
      JSON.stringify([makeItem(U1, {
        imageSize: 222,
        archiveName: null,
        archiveRelPath: null,
        archiveAbsPath: null,
        archiveExt: null,
        archiveSize: null,
        archiveMtime: null,
      })]),
      'utf8',
    );
    const r = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.equal(r.updated, 1);
    const row = readAsset(s.db, U1);
    assert.equal(row.imageSize, 222, '源里的新值必须覆盖（字段名用合成后的驼峰口径）');
    assert.equal(row.archiveName, null, '源里的 null 必须覆盖旧值（否则库与源静默不一致）');
    assert.equal(row.archiveRelPath, null, '没有包 ⇒ asset_file 里**不该有 archive 行** ⇒ 合成回 null');
  } finally {
    s.db.close();
  }
});

// ============================================================ I3 镜像（幽灵行）

test('I3 ⭐ 镜像语义：源里没有的行会被删掉，计数跟着收敛', () => {
  const s = setup('I3', [makeItem(U1), makeItem(U2), makeItem(U3)]);
  try {
    assert.equal(s.report.dbCount, 3);
    // 素材被移出库 ⇒ items.json 少一条
    fs.writeFileSync(s.itemsJsonPath, JSON.stringify([makeItem(U1), makeItem(U3)]), 'utf8');
    const r = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.equal(r.deleted, 1, '幽灵行必须被删掉（否则计数永远对不上）');
    assert.equal(r.dbCount, 2);
    assert.equal(scalar(s.db, 'SELECT COUNT(*) AS n FROM asset WHERE uid = ?', U2), 0, '幽灵行必须真的不在库里');

    // 再放回来 ⇒ 重新插入
    fs.writeFileSync(s.itemsJsonPath, JSON.stringify([makeItem(U1), makeItem(U2), makeItem(U3)]), 'utf8');
    const back = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.equal(back.inserted, 1);
    assert.equal(back.deleted, 0);
    assert.equal(back.dbCount, 3);
  } finally {
    s.db.close();
  }
});

// ============================================================ I4 坏记录 ⇒ 一行都不写

test('I4 ⭐ 一条记录缺字段 ⇒ 报错且**一行都没写**（不留导了一半的现场）', () => {
  const dir = freshDir('I4');
  const items = [makeItem(U1), makeItem(U2)];
  delete items[1].archiveExt; // 缺一个字段
  const itemsJsonPath = writeItemsJson(dir, items);
  const opened = openDb(dir);
  try {
    assert.throws(
      () => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now }),
      throwsCode('IMPORT_RECORD_INVALID'),
    );
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0, '坏源文件不许写入任何行');
    // 【改前】数旧库行 === 0（「连库行都不该建」）
    // 【改后】legacyTablesOf(opened.db) === []（旧表本身都不得存在）
    // 【为何非放宽】旧断言在新 schema 下会抛 no such table（表已退役）；新断言更前一步：**旧结构不得复活**。
    assert.deepEqual(legacyTablesOf(opened.db), [], '连旧结构都不该出现（绿地 6 张表）');
  } finally {
    opened.db.close();
  }
});

// ============================================================ I5 缺字段 / null（逐字段）

test('I5 ⭐ 可空集合与行为一致：nullable 字段收 null，其余字段收 null 一律报错', () => {
  const base = makeItem(U1);
  for (const [field] of ITEM_FIELD_COLUMNS) {
    const rec = Object.assign({}, base);
    rec[field] = null;
    if (ITEM_NULLABLE_FIELDS.has(field)) {
      const parsed = parseItemRecord(rec, 'test[' + field + ']');
      assert.equal(parsed.record[field], null, field + ' 允许 null');
    } else {
      assert.throws(() => parseItemRecord(rec, 'test[' + field + ']'), throwsCode('IMPORT_RECORD_INVALID'),
        field + ' 不允许 null（ITEM_NULLABLE_FIELDS 里没有它）');
    }
  }
  assert.equal(ITEM_NULLABLE_FIELDS.size, 8, '可空字段就是 8 个：archive* 6 + vectorRow + vectorSource');
});

test('I5b：任何一个字段缺失都报错（缺字段 ≠ 值是 null）', () => {
  const base = makeItem(U1);
  for (const [field] of ITEM_FIELD_COLUMNS) {
    const rec = Object.assign({}, base);
    delete rec[field];
    assert.throws(() => parseItemRecord(rec, 'test[' + field + ']'), throwsCode('IMPORT_RECORD_INVALID'),
      field + ' 缺失必须报错（宽进会让源文件截断变成静默少数据）');
  }
});

test('I5c：类型不对必须报错（字符串/数字搞反）', () => {
  const cases = [
    { imageSize: '1000' },
    { imageMtime: '1700000000000' },
    { archiveSize: '2000' },
    { vectorRow: '0' },
    { uid: 123 },
    { folder: 7 },
    { imageExt: null },
  ];
  for (const over of cases) {
    assert.throws(() => parseItemRecord(makeItem(U1, over), 'test'), throwsCode('IMPORT_RECORD_INVALID'),
      JSON.stringify(over) + ' 必须被拒');
  }
  // 反例锚：不覆盖时同一条能过（否则上面的 for 可能因为"永远抛"而假绿）
  assert.equal(parseItemRecord(makeItem(U1), 'test').record.uid, U1);
  // 非对象行也要被拒
  for (const junk of [null, 1, 'x', [], true]) {
    assert.throws(() => parseItemRecord(junk, 'test'), throwsCode('IMPORT_RECORD_INVALID'));
  }
});

// ============================================================ I7 计数校验

test('I7 ⭐ 期望计数不符 ⇒ 报错且不导入（不许静默少导）', () => {
  const dir = freshDir('I7');
  const itemsJsonPath = writeItemsJson(dir, [makeItem(U1), makeItem(U2), makeItem(U3)]);
  const opened = openDb(dir);
  try {
    assert.throws(
      () => importItemsFromJson({
        db: opened.db,
        library: { libId: 'L1', root: 'X:/lib' },
        itemsJsonPath,
        expectedCount: 3594,
        now,
      }),
      throwsCode('IMPORT_COUNT_MISMATCH'),
    );
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0);
    assert.deepEqual(legacyTablesOf(opened.db), [], '坏索引：同样不得出现旧结构');
  } finally {
    opened.db.close();
  }
});

test('I7b：index.bin 损坏 ⇒ IMPORT_INDEX_UNREADABLE（不拿坏索引当计数来源）', () => {
  const dir = freshDir('I7b');
  const itemsJsonPath = writeItemsJson(dir, [makeItem(U1)]);
  const junkIndex = path.join(dir, 'index.bin');
  fs.writeFileSync(junkIndex, 'not a GSIDX file', 'utf8');
  const opened = openDb(dir);
  try {
    assert.throws(() => readIndexItemCount(junkIndex), throwsCode('IMPORT_INDEX_UNREADABLE'));
    assert.throws(
      () => importItemsFromJson({
        db: opened.db,
        library: { libId: 'L1', root: 'X:/lib' },
        itemsJsonPath,
        indexBinPath: junkIndex,
        now,
      }),
      throwsCode('IMPORT_INDEX_UNREADABLE'),
    );
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0);
  } finally {
    opened.db.close();
  }
});

// ============================================================ I8 重复 uid

test('I8 ⭐ 源文件有重复 uid ⇒ 报错（否则"读入 3594 / 入库 3593"没人发现）', () => {
  const dir = freshDir('I8');
  const itemsJsonPath = writeItemsJson(dir, [makeItem(U1), makeItem(U2), makeItem(U1, { imageSize: 5 })]);
  const opened = openDb(dir);
  try {
    assert.throws(
      () => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now }),
      throwsCode('IMPORT_DUPLICATE_UID'),
    );
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0);
  } finally {
    opened.db.close();
  }
});

// ============================================================ I9 / I10 源与库不匹配

test('I9：源文件不存在 / 不是数组 / 是空数组 ⇒ IMPORT_SOURCE_INVALID', () => {
  const dir = freshDir('I9');
  const opened = openDb(dir);
  const call = (itemsJsonPath) =>
    importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now });
  try {
    assert.throws(() => call(path.join(dir, 'nope.json')), throwsCode('IMPORT_SOURCE_INVALID'));
    const notArray = path.join(dir, 'not-array.json');
    fs.writeFileSync(notArray, JSON.stringify({ uid: U1 }), 'utf8');
    assert.throws(() => call(notArray), throwsCode('IMPORT_SOURCE_INVALID'));
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, '[]', 'utf8');
    assert.throws(() => call(empty), throwsCode('IMPORT_SOURCE_INVALID'),
      '空数组按"源不可信"处理：导入空文件不等于允许清空一个库');
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0);
  } finally {
    opened.db.close();
  }
});

test('I10：条目声明的 libId 与目标库不一致 ⇒ 报错（不许把别的库导进来）', () => {
  const dir = freshDir('I10');
  const itemsJsonPath = writeItemsJson(dir, [makeItem(U1), makeItem(U2, { libId: 'L2' })]);
  const opened = openDb(dir);
  try {
    assert.throws(
      () => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now }),
      throwsCode('IMPORT_RECORD_INVALID'),
    );
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 0);
  } finally {
    opened.db.close();
  }
});

test('I10b：入参不合法（libId 空 / 路径空 / 连接没开）⇒ IMPORT_INPUT_INVALID', () => {
  const dir = freshDir('I10b');
  const itemsJsonPath = writeItemsJson(dir, [makeItem(U1)]);
  const opened = openDb(dir);
  try {
    assert.throws(() => importItemsFromJson({ db: opened.db, library: { libId: ' ', root: 'X:/lib' }, itemsJsonPath, now }), throwsCode('IMPORT_INPUT_INVALID'));
    assert.throws(() => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: '' }, itemsJsonPath, now }), throwsCode('IMPORT_INPUT_INVALID'));
    assert.throws(() => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath: '  ', now }), throwsCode('IMPORT_INPUT_INVALID'));
    assert.throws(
      () => importItemsFromJson({ db: opened.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 0, now }),
      throwsCode('IMPORT_INPUT_INVALID'),
      'expectedCount 是正整数或省略，0 不是',
    );
    const closed = openDb(freshDir('I10b-closed'));
    closed.db.close();
    assert.throws(
      () => importItemsFromJson({ db: closed.db, library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, now }),
      throwsCode('IMPORT_INPUT_INVALID'),
      '连接已关 ⇒ 报参数错，而不是拿到一堆 SQLite 状态错',
    );
  } finally {
    opened.db.close();
  }
});

// ============================================================ I11 可空集合 ↔ DDL

test('I11 ⭐ 契约与表结构机械一致：新表 NOT NULL 列集 ↔ ItemRecord 必填字段集（防静默漂移）', () => {
  // 【原来抓什么】旧口径断言「ITEM_NULLABLE_FIELDS ↔ 旧 items 表 notnull 逐列一致」：
  //   抓的是「校验器认为可空的字段」与「DDL 允许 NULL 的列」**不许各自漂移**。
  //   为什么值得抓：DDL 少一个 NOT NULL ⇒ 库里能存 null ⇒ 映射器读回来产出 null/undefined，
  //   而引擎把「vectorRow == null」当「未入索引」⇒ **检索行为静默改变**（不报错、不崩溃、只是结果变味）。
  // 【现在抓什么】绿地把一张宽表拆成 asset / asset_file / asset_index_state ⇒ 同一件事变成三条机械断言：
  //   (a) asset 的每一列都 NOT NULL（它承载条目身份与路径）；
  //   (b) asset_file 只允许 width/height 可空（只有扫描器解像素才填），size_bytes/mtime_ms 必须 NOT NULL；
  //   (c) asset_index_state 的列全部可空（未编码/未入索引是正常态）。
  //   再与**契约侧**对上：由 NOT NULL 列承载的字段必须不可空；由可空列/可缺行承载的必须可空。
  // 【为何等价而更强】等价：仍是「契约与表结构不许漂移」这一条不变式（换对象，不换目的）；
  //   更强：① 覆盖**三张表**而不是一张宽表；② 直接卡住「合成器会产出 undefined/null 的路径」——
  //   少一个 NOT NULL ⇒ 库里能存 null ⇒ 合成器收下它 ⇒ 引擎的「== null」分支被误触发 ⇒ 结果静默变味。
  const dir = freshDir('I11');
  const opened = openDb(dir);
  try {
    const info = (table) => opened.db.prepare('PRAGMA table_info(' + table + ')').all();
    const nullableCols = (table) => info(table).filter((c) => c.notnull === 0).map((c) => c.name).sort();
    const notNullCols = (table) => info(table).filter((c) => c.notnull === 1).map((c) => c.name).sort();

    assert.deepEqual(nullableCols('asset'), [], 'asset 的每一列都必须 NOT NULL（条目身份与路径的载体）');
    assert.deepEqual(nullableCols('asset_file'), ['height', 'width'], 'asset_file 只允许 width/height 可空');
    assert.ok(
      notNullCols('asset_file').includes('size_bytes') && notNullCols('asset_file').includes('mtime_ms'),
      'size_bytes / mtime_ms 必须 NOT NULL（文件事实不能缺）',
    );
    // ⚠️ 两个例外（都是「**恒有值**」的列，不是「允许缺数据」）：
    //    · uid —— 主键，天然非空；
    //    · attempt_count —— 计数器（DDL 里 NOT NULL DEFAULT 0）：**没试过就是 0**，不是「未知」。
    //      它非空恰恰是好事：读路径永远拿得到数字，不必判 null（否则每次都要区分 null/0）。
    //    其余业务列（编码时间/compat/错误/排除/校验/向量行号）必须全部可空 ——
    //    「未编码」是正常态，不是缺数据。
    assert.deepEqual(
      notNullCols('asset_index_state').filter((c) => c !== 'uid' && c !== 'attempt_count'),
      [],
      'asset_index_state 的业务列必须全部可空（uid 主键 · attempt_count 计数器例外）',
    );

    const REQUIRED = ['uid', 'libId', 'folder', 'stem', 'name', 'relPath', 'imageExt', 'imageSize', 'imageMtime', 'absPath'];
    const OPTIONAL = ['archiveRelPath', 'archiveExt', 'archiveSize', 'archiveMtime', 'vectorRow', 'archiveName', 'archiveAbsPath', 'vectorSource'];
    for (const f of REQUIRED) {
      assert.equal(ITEM_NULLABLE_FIELDS.has(f), false, f + ' 必须**不可空**（它由 NOT NULL 列/库根合成承载）');
    }
    for (const f of OPTIONAL) {
      assert.equal(ITEM_NULLABLE_FIELDS.has(f), true, f + ' 必须**可空**（列允许 NULL / 行可缺 / 派生）');
    }
  } finally {
    opened.db.close();
  }
});

// ============================================================ I12 真实库

test('I12 ⭐ 真实库：data/libraries/L1 的 3594 条导入 + 重复导入仍然 3594', (t) => {
  const libDir = path.join(ROOT, 'data', 'libraries', 'L1');
  const itemsJsonPath = path.join(libDir, 'items.json');
  const indexBinPath = path.join(libDir, 'index.bin');
  const metaPath = path.join(libDir, 'meta.json');
  if (!fs.existsSync(itemsJsonPath) || !fs.existsSync(indexBinPath) || !fs.existsSync(metaPath)) {
    t.skip('本机没有 ' + libDir + ' 的 items.json/index.bin/meta.json（真实库未就位）—— 该断言无法执行');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  const dir = freshDir('I12');
  const opened = openDb(dir);
  try {
    const first = importItemsFromJson({
      db: opened.db,
      library: { libId: meta.lib_id, root: meta.lib_root, dim: meta.dim, seq: meta.seq_length, compat: meta.compat, metaJson: JSON.stringify(meta) },
      itemsJsonPath,
      indexBinPath,
      expectedCount: meta.count,
      now,
    });
    assert.equal(first.read, 3594);
    assert.equal(first.uniqueUids, 3594);
    assert.equal(first.inserted, 3594);
    assert.equal(first.updated, 0);
    assert.equal(first.deleted, 0);
    assert.equal(first.dbCount, 3594, '导入后必须恰好 3594 行');
    assert.equal(first.indexCount, 3594, 'index.bin 的 header.count 必须也是 3594');
    assert.deepEqual(first.expectedCounts, [3594, 3594], 'index.count 与 meta.count 必须都对上');
    assert.deepEqual(first.unknownFields, [], '真实 items.json 不该有 18 字段之外的键');

    // 幂等重跑
    const second = importItemsFromJson({
      db: opened.db,
      library: { libId: meta.lib_id, root: meta.lib_root },
      itemsJsonPath,
      indexBinPath,
      expectedCount: meta.count,
      now,
    });
    assert.equal(second.inserted, 0, '重复导入不许新增行');
    assert.equal(second.updated, 3594);
    assert.equal(second.deleted, 0);
    assert.equal(second.dbCount, 3594, '重复导入后仍然是 3594');
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 3594);

    // 【改前】读旧库行断言 root/compat/dim/seq/条目计数/注册时刻（那些元数据当年落在**库行**上）
    // 【改后】绿地口径：库级 .gs.db **没有**库注册表（它在 app.db，由 library* 方法写）⇒ 改成
    //         「旧结构不得存在」+「重复导入后 asset 仍是 3594（幂等不膨胀）」
    // 【为何非放宽】旧断言在新 schema 下无对象（表已退役）；覆盖没少 —— 下面那条**真实 items.json 的逐字段往返**
    //         仍然在核对数据本身，而"库行元数据"这一层已由 app.db 的 library_registry 承载（另有测试）。
    assert.deepEqual(legacyTablesOf(opened.db), [], '库级 .gs.db 不得有旧表 items / library');
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM asset'), 3594, '重复导入不得膨胀（幂等）');

    // 抽样核对一条真实记录（uid 取自 items.json 第一条）
    const rawFirst = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'))[0];
    const row = readAsset(opened.db, rawFirst.uid, meta.lib_id);
    for (const [field] of ITEM_FIELD_COLUMNS) {
      // 同 I1：派生字段（库根 + 相对路径）与"源格式诊断列"（新 schema 有意不存）不参与往返
      if (field === 'absPath' || field === 'archiveAbsPath' || field === 'vectorSource') continue;
      assert.deepEqual(row[field], rawFirst[field], field + ' 必须与真实 items.json 一致（经 asset/asset_file 合成）');
    }
    // ⚠️ 本用例的导入用的是**夹具库根 'X:/lib'**（不是 meta.lib_root）⇒ 合成出的 absPath 必须跟它一致
    assert.equal(row.absPath, path.join('X:/lib', rawFirst.relPath), 'absPath = 夹具库根 + 相对路径（合成）');
  } finally {
    opened.db.close();
  }
});

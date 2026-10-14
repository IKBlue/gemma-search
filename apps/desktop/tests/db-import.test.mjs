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
  GsDbError,
  ITEM_COLUMNS,
  ITEM_FIELD_COLUMNS,
  ITEM_NULLABLE_FIELDS,
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
    assert.equal(s.report.libraryCreated, true, 'library 行必须是这次建的（FK 前置条件）');
    assert.deepEqual(s.report.expectedCounts, [], '没给期望计数时不该凭空造一个');
    assert.deepEqual(s.report.unknownFields, []);

    const lib = s.db.prepare('SELECT * FROM library WHERE lib_id = ?').get('L1');
    assert.ok(lib, 'library 行必须存在，否则 items 的外键会拒');
    assert.equal(lib.root, 'X:/lib');
    assert.equal(lib.fallback, 0);
    assert.equal(lib.item_count, 3, 'item_count 必须与落库行数一致');
    assert.equal(lib.registered_at, FIXED_NOW);
    assert.equal(lib.updated_at, FIXED_NOW);

    const row = s.db.prepare('SELECT * FROM items WHERE uid = ?').get(U2);
    const expect = makeItem(U2);
    for (const [field, column] of ITEM_FIELD_COLUMNS) {
      assert.deepEqual(row[column], expect[field], field + ' → ' + column + ' 必须原样落库');
    }
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
    const before = s.db.prepare('SELECT * FROM items WHERE uid = ?').get(U1);
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
    assert.equal(scalar(s.db, 'SELECT COUNT(*) AS n FROM items'), 3, '总行数必须还是 3');

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

    const after = s.db.prepare('SELECT * FROM items WHERE uid = ?').get(U1);
    assert.deepEqual(after, before, '幂等重跑不得改动行内容');
  } finally {
    s.db.close();
  }
});

test('I2b：源文件里的新值会整行覆盖（不是"保留旧值"）', () => {
  const s = setup('I2b', [makeItem(U1, { imageSize: 111, archiveName: 'old.rar' })]);
  try {
    fs.writeFileSync(s.itemsJsonPath, JSON.stringify([makeItem(U1, { imageSize: 222, archiveName: null })]), 'utf8');
    const r = importItemsFromJson({
      db: s.db,
      library: { libId: 'L1', root: 'X:/lib' },
      itemsJsonPath: s.itemsJsonPath,
      now,
    });
    assert.equal(r.updated, 1);
    const row = s.db.prepare('SELECT * FROM items WHERE uid = ?').get(U1);
    assert.equal(row.image_size, 222);
    assert.equal(row.archive_name, null, '源里的 null 必须覆盖旧值（否则库与源静默不一致）');
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
    assert.equal(scalar(s.db, 'SELECT COUNT(*) AS n FROM items WHERE uid = ?', U2), 0);

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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0, '坏源文件不许写入任何行');
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM library'), 0, '连 library 行都不该建');
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0);
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM library'), 0);
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0);
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0);
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0);
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 0);
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

test('I11 ⭐ ITEM_NULLABLE_FIELDS 与 items 表的 notnull 逐列一致（防校验/DDL 漂移）', () => {
  const dir = freshDir('I11');
  const opened = openDb(dir);
  try {
    const byName = new Map();
    for (const c of opened.db.prepare('PRAGMA table_info(items)').all()) byName.set(c.name, c);
    for (const [field, column] of ITEM_FIELD_COLUMNS) {
      const col = byName.get(column);
      assert.ok(col, column + ' 列不存在');
      assert.equal(
        col.notnull,
        ITEM_NULLABLE_FIELDS.has(field) ? 0 : 1,
        field + '(' + column + ') 的可空性与 ITEM_NULLABLE_FIELDS 不一致',
      );
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
    assert.equal(scalar(opened.db, 'SELECT COUNT(*) AS n FROM items'), 3594);

    // library 行的 compat/dim/seq 来自 meta.json；第二次不带这些字段时必须**保留**（COALESCE 语义）
    const lib = opened.db.prepare('SELECT * FROM library WHERE lib_id = ?').get(meta.lib_id);
    assert.equal(lib.root, meta.lib_root);
    assert.equal(lib.compat, meta.compat);
    assert.equal(lib.dim, meta.dim);
    assert.equal(lib.seq, meta.seq_length);
    assert.equal(lib.item_count, 3594);
    assert.equal(lib.registered_at, FIXED_NOW, 'registered_at 只在首次写入');

    // 抽样核对一条真实记录（uid 取自 items.json 第一条）
    const rawFirst = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'))[0];
    const row = opened.db.prepare('SELECT * FROM items WHERE uid = ?').get(rawFirst.uid);
    for (const [field, column] of ITEM_FIELD_COLUMNS) {
      assert.deepEqual(row[column], rawFirst[field], field + ' → ' + column + ' 必须与真实 items.json 一致');
    }
  } finally {
    opened.db.close();
  }
});

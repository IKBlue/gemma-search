// apps/desktop/tests/db-rebuild.test.mjs —— T-11c「删库重建结果一致」的验收测试
//
// 这条测试是 SPEC §2.1 / §3「.gs.db 是**可重建的派生数据**，损坏或版本不符时删掉重建」的**落地证明**：
// 不能只证明"能建出来"，必须证明"删掉重建之后与第一次**逐项一致**"，否则"删掉重建"这句话不可信
// （真实失败模式：重建后少几行、vectorRow 与索引对不上、library 行的 compat 丢了 —— 界面看起来正常，
//  检索却静默变少/错位）。
//
// 对账口径（对齐 T-11b 的 ImportItemsReport）：行数 dbCount · 期望计数 expectedCounts · index.bin 的 count；
// 再加 uid 集合、uid→vectorRow 映射、**全行规范化摘要（sha1）** 与 library 行。
//
// 计数来源按 Lead 裁定（T-11c）：**默认用 expectedCount**（meta.json 的 count，读几百字节）；
// readIndexItemCount（要读整块 11 MB + 算 sha1）只作**可选的重校验路径**，用在对账那一步。
//
// 跑法：node --test apps/desktop/tests/db-rebuild.test.mjs（也在 npm test 的 glob 里）
// 临时库落在仓库内 data/_t11/db-rebuild-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。
// ⚠️ 环境：本会话沙箱把 electron.exe 的写限制在仓库内（G:\model / AppData EPERM），临时库故意用仓库内路径。
// ⚠️ 全量门禁由 Lead 统一跑（TASKS §3.6：同一时刻只允许一个人跑 npm test）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GsDbError,
  ITEM_COLUMNS,
  TARGET_SCHEMA_VERSION,
  importItemsFromJson,
  openGsDb,
  readIndexItemCount,
  readSchemaVersion,
  removeGsDbFiles,
} from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t11', 'db-rebuild-test-' + process.pid);
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

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  if (row === undefined) return undefined;
  return row[Object.keys(row)[0]];
}

/** 合成条目（真数据由 R1 覆盖） */
function makeItem(uid, over = {}) {
  return Object.assign(
    {
      uid, libId: 'L1', folder: 'CR', stem: 'ID-' + uid, name: 'ID-' + uid + '.jpg',
      relPath: 'CR/ID-' + uid + '.jpg', absPath: 'X:/lib/CR/ID-' + uid + '.jpg',
      imageExt: '.jpg', imageSize: 1000, imageMtime: 1700000000000,
      archiveName: 'ID-' + uid + '.rar', archiveRelPath: 'CR/ID-' + uid + '.rar',
      archiveAbsPath: 'X:/lib/CR/ID-' + uid + '.rar', archiveExt: '.rar',
      archiveSize: 2000, archiveMtime: 1699999999999, vectorRow: 0, vectorSource: 'native',
    },
    over,
  );
}
const U1 = 'aaaaaaaaaaaa';
const U2 = 'bbbbbbbbbbbb';
const U3 = 'cccccccccccc';

/**
 * 一次"全库快照"：重建前后要逐项比的就是它。
 * digest = 全行按 uid 排序后的规范化序列化（列序取自 ITEM_COLUMNS，单一来源）的 sha1 —— 
 * 比"逐行 deepEqual"更省事，且差异一定来自真实内容（不是对象键序）。
 */
function snapshot(db, libId) {
  const rows = db
    .prepare('SELECT ' + ITEM_COLUMNS.join(', ') + ' FROM items WHERE lib_id = ? ORDER BY uid')
    .all(libId);
  const lines = rows.map((r) => ITEM_COLUMNS.map((c) => JSON.stringify(r[c])).join('|'));
  const digest = crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
  const rowToUid = new Map();
  for (const r of rows) rowToUid.set(r.vector_row, r.uid);
  return {
    version: readSchemaVersion(db),
    count: rows.length,
    sqlCount: scalar(db, 'SELECT COUNT(*) AS n FROM items WHERE lib_id = ?', libId),
    distinctUid: scalar(db, 'SELECT COUNT(DISTINCT uid) AS n FROM items WHERE lib_id = ?', libId),
    distinctRows: scalar(db, 'SELECT COUNT(DISTINCT vector_row) AS n FROM items WHERE lib_id = ?', libId),
    minRow: scalar(db, 'SELECT MIN(vector_row) AS n FROM items WHERE lib_id = ?', libId),
    maxRow: scalar(db, 'SELECT MAX(vector_row) AS n FROM items WHERE lib_id = ?', libId),
    digest,
    uids: rows.map((r) => r.uid),
    uidVectorRow: rows.map((r) => r.uid + ':' + String(r.vector_row)),
    vectorRowUid: [...rowToUid.entries()].map(([row, uid]) => String(row) + ':' + uid).sort(),
    lib: db.prepare('SELECT * FROM library WHERE lib_id = ?').get(libId),
  };
}

/** 一个完整周期：导入 → 快照 → 关库 */
function importAndSnapshot(dir, opts) {
  const dbPath = path.join(dir, '.gs.db');
  const opened = openGsDb({ dbPath, now });
  const report = importItemsFromJson(Object.assign({ db: opened.db, now }, opts));
  const snap = snapshot(opened.db, opts.library.libId);
  opened.db.close();
  return { dbPath, report, snap };
}

/** 删库（含边车）→ 重新打开 → 再导入 → 快照 */
function deleteAndRebuild(dir, opts) {
  const dbPath = path.join(dir, '.gs.db');
  const removed = removeGsDbFiles(dbPath);
  const left = fs.readdirSync(dir).filter((n) => n.startsWith('.gs.db'));
  const opened = openGsDb({ dbPath, now });
  const report = importItemsFromJson(Object.assign({ db: opened.db, now }, opts));
  const snap = snapshot(opened.db, opts.library.libId);
  opened.db.close();
  return { dbPath, removed, left, opened, report, snap };
}

// ============================================================ R1 真实库：删库重建逐项对账

test('R1 ⭐ 真实库删库重建：行数 / uid 集合 / vectorRow 对齐 / 全行摘要 / library 行全部一致', (t) => {
  const libDir = path.join(ROOT, 'data', 'libraries', 'L1');
  const itemsJsonPath = path.join(libDir, 'items.json');
  const indexBinPath = path.join(libDir, 'index.bin');
  const metaPath = path.join(libDir, 'meta.json');
  if (!fs.existsSync(itemsJsonPath) || !fs.existsSync(indexBinPath) || !fs.existsSync(metaPath)) {
    t.skip('本机没有 ' + libDir + ' 的 items.json/index.bin/meta.json（真实库未就位）—— 该断言无法执行');
    return;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const dir = freshDir('R1');
  // 计数来源 = expectedCount（meta.json 的 count，Lead 裁定的**默认**路径）
  const opts = {
    library: { libId: meta.lib_id, root: meta.lib_root, dim: meta.dim, seq: meta.seq_length, compat: meta.compat },
    itemsJsonPath,
    expectedCount: meta.count,
  };

  const first = importAndSnapshot(dir, opts);
  assert.equal(first.report.dbCount, 3594, '首次导入必须恰好 3594');
  assert.deepEqual(first.report.expectedCounts, [3594]);
  assert.equal(first.report.indexCount, null, '默认路径不读 index.bin（那是可选的重校验路径）');

  // ---- 第一次删库重建
  const rebuilt = deleteAndRebuild(dir, opts);
  assert.deepEqual(rebuilt.left, [], '删完之后目录里不许残留 .gs.db / -wal / -shm / -journal');
  assert.ok(rebuilt.removed.includes(rebuilt.dbPath), 'removeGsDbFiles 必须真的删掉主库文件');
  assert.equal(rebuilt.opened.created, true, '重建 = 文件本来不存在');
  assert.equal(rebuilt.opened.migration.fromVersion, 0, '重建必须从 v0 重新走一遍迁移');
  assert.equal(rebuilt.opened.migration.toVersion, TARGET_SCHEMA_VERSION);
  assert.equal(rebuilt.report.libraryCreated, true, '重建后 library 行是新建的');

  // ---- 逐项对账
  assert.equal(rebuilt.report.dbCount, first.report.dbCount, 'dbCount 必须一致');
  assert.equal(rebuilt.snap.count, first.snap.count, '行数必须一致');
  assert.equal(rebuilt.snap.sqlCount, first.snap.sqlCount);
  assert.equal(rebuilt.snap.distinctUid, first.snap.distinctUid, 'uid 去重数一致');
  assert.deepEqual(rebuilt.snap.uids, first.snap.uids, 'uid 集合必须逐条一致（排序后比对）');
  assert.deepEqual(rebuilt.snap.uidVectorRow, first.snap.uidVectorRow, 'uid→vectorRow 必须逐条一致');
  assert.deepEqual(rebuilt.snap.vectorRowUid, first.snap.vectorRowUid, 'vectorRow→uid 反向映射也必须一致');
  assert.equal(rebuilt.snap.digest, first.snap.digest, '全行规范化摘要必须一致（比逐行 deepEqual 更严）');
  assert.deepEqual(rebuilt.snap.lib, first.snap.lib, 'library 行必须一致（含 item_count / compat / dim / seq / 时间戳）');
  assert.equal(rebuilt.snap.version, first.snap.version);
  assert.equal(rebuilt.snap.version, TARGET_SCHEMA_VERSION);

  // ---- vectorRow 与 index.bin 对齐（这里才用**可选的重校验路径**）
  const indexCount = readIndexItemCount(indexBinPath);
  assert.equal(indexCount, 3594, 'index.bin header.count');
  assert.equal(rebuilt.snap.count, indexCount, '条目行数必须等于索引行数（否则 rowToRel 会错位）');
  assert.equal(rebuilt.snap.distinctRows, indexCount, 'vectorRow 必须两两不同');
  assert.equal(rebuilt.snap.minRow, 0);
  assert.equal(rebuilt.snap.maxRow, indexCount - 1, 'vectorRow 必须正好铺满 0..count-1');
  const rows = new Set(rebuilt.snap.uidVectorRow.map((s) => Number(s.split(':')[1])));
  assert.equal(rows.size, indexCount);
  for (let i = 0; i < indexCount; i += 1) assert.ok(rows.has(i), 'vectorRow 缺 ' + String(i));

  // ---- 第二次删库重建：重建本身是确定的，不是"碰巧对上了一次"
  const again = deleteAndRebuild(dir, opts);
  assert.equal(again.snap.digest, first.snap.digest, '第二次重建的摘要必须与首次导入一致（确定性）');
  assert.deepEqual(again.snap.uidVectorRow, first.snap.uidVectorRow);

  t.diagnostic(
    'R1 对账：count=' + String(first.snap.count) + ' · index.count=' + String(indexCount) +
      ' · digest=' + first.snap.digest + ' · 三次（首次/重建1/重建2）摘要全等',
  );
});

// ============================================================ R2 重建与"被删掉的那份状态"无关

test('R2 ⭐ 重建结果只取决于源文件：旧库的残留不会带进新库', () => {
  const dirOld = freshDir('R2-old');
  const items5 = writeItems(path.join(dirOld, 'items5.json'), [U1, U2, U3, 'dddddddddddd', 'eeeeeeeeeeee']);
  const old = importAndSnapshot(dirOld, {
    library: { libId: 'L1', root: 'X:/lib' },
    itemsJsonPath: items5,
    expectedCount: 5,
  });
  assert.equal(old.snap.count, 5);

  // 删库，然后从**另一份** items.json（3 条）重建
  const items3 = writeItems(path.join(dirOld, 'items3.json'), [U1, U2, U3]);
  const rebuilt = deleteAndRebuild(dirOld, {
    library: { libId: 'L1', root: 'X:/lib' },
    itemsJsonPath: items3,
    expectedCount: 3,
  });
  assert.equal(rebuilt.snap.count, 3, '重建后只该有 3 条（旧的 5 条里那 2 条不许残留）');

  // 反例锚：另开一个全新目录、什么都不删，直接导入同一份 3 条文件 —— 两者必须完全一致
  const dirFresh = freshDir('R2-fresh');
  const fresh = importAndSnapshot(dirFresh, {
    library: { libId: 'L1', root: 'X:/lib' },
    itemsJsonPath: items3,
    expectedCount: 3,
  });
  assert.equal(rebuilt.snap.digest, fresh.snap.digest, '重建结果必须等于"从零导入"的结果');
  assert.deepEqual(rebuilt.snap.uidVectorRow, fresh.snap.uidVectorRow);
  assert.deepEqual(rebuilt.snap.lib, fresh.snap.lib);
});

// ============================================================ R3 损坏文件：先报错，再重建

test('R3 ⭐ .gs.db 损坏 ⇒ 打开时响亮报错（不是"空库"），删掉重建即恢复', () => {
  const dir = freshDir('R3');
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), [U1, U2, U3]);
  const opts = { library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 3 };

  const first = importAndSnapshot(dir, opts);
  const dbPath = first.dbPath;
  assert.equal(first.snap.count, 3);

  // 破坏 SQLite 文件头（真实损坏的一种：文件被截断/被别的程序覆盖）
  const fd = fs.openSync(dbPath, 'r+');
  fs.writeSync(fd, Buffer.alloc(16, 0), 0, 16, 0);
  fs.closeSync(fd);

  assert.throws(
    () => openGsDb({ dbPath, now }),
    (e) => e instanceof GsDbError && e.code === 'DB_OPEN_FAILED',
    '损坏的 .gs.db 必须在打开时报 DB_OPEN_FAILED —— 静默返回一个空库等于把"数据没了"藏起来',
  );

  // SPEC §2.1 的处置：删掉重建
  const rebuilt = deleteAndRebuild(dir, opts);
  assert.equal(rebuilt.opened.created, true);
  assert.equal(rebuilt.snap.count, 3);
  assert.equal(rebuilt.snap.digest, first.snap.digest, '损坏后重建的结果必须与损坏前一致（源文件没变）');
});

// ============================================================ R4 计数来源：默认 expectedCount

test('R4 ⭐ 计数来源取舍：默认 expectedCount 不读索引；indexBinPath 是可选的重校验路径', () => {
  const libDir = freshDir('R4-lib');
  const itemsJsonPath = writeItems(path.join(libDir, 'items.json'), [U1, U2, U3]);
  const metaPath = path.join(libDir, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({ lib_id: 'L1', lib_root: 'X:/lib', count: 3 }), 'utf8');
  const junkIndex = path.join(libDir, 'index.bin');
  fs.writeFileSync(junkIndex, 'not a GSIDX file', 'utf8');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // ① 默认路径：meta.json 的 count —— 索引坏了也照样能重建（重建元数据不该被索引状态卡住）
  const dir = freshDir('R4');
  const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), now });
  try {
    const report = importItemsFromJson({
      db: opened.db,
      library: { libId: meta.lib_id, root: meta.lib_root },
      itemsJsonPath,
      expectedCount: meta.count,
      now,
    });
    assert.equal(report.indexCount, null);
    assert.deepEqual(report.expectedCounts, [3]);
    assert.equal(report.dbCount, 3);
  } finally {
    opened.db.close();
  }

  // ② 可选的重校验路径：显式要了索引，就必须拿到完好的索引 —— 坏了要响亮报错
  const opened2 = openGsDb({ dbPath: path.join(freshDir('R4b'), '.gs.db'), now });
  try {
    assert.throws(
      () => importItemsFromJson({
        db: opened2.db,
        library: { libId: meta.lib_id, root: meta.lib_root },
        itemsJsonPath,
        expectedCount: meta.count,
        indexBinPath: junkIndex,
        now,
      }),
      (e) => e instanceof GsDbError && e.code === 'IMPORT_INDEX_UNREADABLE',
    );
    assert.equal(scalar(opened2.db, 'SELECT COUNT(*) AS n FROM items'), 0, '索引坏了 ⇒ 一行都不导入');
  } finally {
    opened2.db.close();
  }
});

// ============================================================ R5 版本推进与边车

test('R5：重建会重新跑迁移（v0→v2），且不会留下旧的 -wal/-shm', () => {
  const dir = freshDir('R5');
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), [U1]);
  const first = importAndSnapshot(dir, { library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 1 });
  const rebuilt = deleteAndRebuild(dir, { library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 1 });
  assert.equal(rebuilt.opened.migration.fromVersion, 0);
  assert.deepEqual(rebuilt.opened.migration.applied.map((m) => m.version), [1, 2]);
  assert.deepEqual(rebuilt.left, [], '删库后不许残留边车文件（WAL 里可能有未 checkpoint 的事务）');
  assert.equal(rebuilt.snap.digest, first.snap.digest);
  assert.equal(rebuilt.snap.version, TARGET_SCHEMA_VERSION);
});

function writeItems(p, uids) {
  fs.writeFileSync(p, JSON.stringify(uids.map((uid, i) => makeItem(uid, { vectorRow: i }))), 'utf8');
  return p;
}

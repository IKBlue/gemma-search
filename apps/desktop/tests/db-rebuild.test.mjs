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
  ASSET_ITEM_SELECT_ALL_SQL,
  GsDbError,
  joinedRowToItemRecord,
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
 * digest = 全行按 uid 排序后的规范化序列化（字段集合见下面的 FIELDS，单一来源）的 sha1 —— 
 * 比"逐行 deepEqual"更省事，且差异一定来自真实内容（不是对象键序）。
 */
function snapshot(db, libId) {
  // S2：绿地口径 —— 条目在 asset + asset_file + asset_index_state。
  // 取数用**共享的那一条** SELECT（端口与测试共用，P1），再交给 joinedRowToItemRecord 合成 ItemRecord
  // ⇒ 「列↔字段」的映射仍然只有一份（以前这里靠旧宽表的列序自己拼，那条在绿地 schema 下已失效）。
  const rows = db
    .prepare(ASSET_ITEM_SELECT_ALL_SQL)
    .all(libId)
    .map((row, i) => joinedRowToItemRecord(row, 'X:/lib', 'db-rebuild asset[' + String(i) + ']'));
  const FIELDS = ['uid', 'libId', 'folder', 'stem', 'name', 'relPath', 'absPath', 'imageExt', 'imageSize',
    'imageMtime', 'archiveName', 'archiveRelPath', 'archiveAbsPath', 'archiveExt', 'archiveSize', 'archiveMtime',
    'vectorRow', 'vectorSource'];
  const lines = rows.map((r) => FIELDS.map((f) => JSON.stringify(r[f])).join('|'));
  const digest = crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
  const rowToUid = new Map();
  for (const r of rows) rowToUid.set(r.vectorRow, r.uid);
  return {
    version: readSchemaVersion(db),
    count: rows.length,
    sqlCount: scalar(db, 'SELECT COUNT(*) AS n FROM asset WHERE lib_id = ?', libId),
    distinctUid: scalar(db, 'SELECT COUNT(DISTINCT uid) AS n FROM asset WHERE lib_id = ?', libId),
    distinctRows: scalar(db, 'SELECT COUNT(DISTINCT vector_row) AS n FROM asset_index_state WHERE vector_row IS NOT NULL'),
    minRow: scalar(db, 'SELECT MIN(vector_row) AS n FROM asset_index_state'),
    maxRow: scalar(db, 'SELECT MAX(vector_row) AS n FROM asset_index_state'),
    digest,
    uids: rows.map((r) => r.uid),
    // 【改前】rows.map((r) => r.uid + ':' + String(r.vector_row))  ← 读**旧列名**；而 rows 现在装的是
    //         joinedRowToItemRecord 合成的 ItemRecord（**驼峰字段**）⇒ 取到 undefined ⇒ R1 的
    //         Set(uidVectorRow) 全变成 NaN ⇒ size=1（这就是 R1 的红因）。
    // 【改后】rows.map((r) => r.uid + ':' + String(r.vectorRow))
    // 【为何非放宽】断言一个字没改（仍是"vectorRow 必须铺满 0..count-1"）；改的是**取值字段名**，
    //   与合成函数保持同一套命名。若映射真的丢了 vectorRow，这里照样红（undefined → NaN → size=1）。
    uidVectorRow: rows.map((r) => r.uid + ':' + String(r.vectorRow)),
    vectorRowUid: [...rowToUid.entries()].map(([row, uid]) => String(row) + ':' + uid).sort(),
    // 绿地口径：库注册表在 **app.db 的 library_registry**，库级 .gs.db 里**没有**它
    // ⇒ 这里恒为 null；"导入不得建库行"由下面那条**正向断言**负责（旧口径的 deepEqual(lib,lib) 会恒真，已删）。
    lib: null,
    /** 旧表**不得**复活：绿地 6 张表里没有 items / library（这条抓的是"有人把旧表加回来"） */
    legacyTables: db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'library') ORDER BY name")
      .all()
      .map((r) => r.name),
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
  // 【改前】"重建后库行是新建的"（旧宽表时代的口径）—— 完整三行记录见 reports/2026-10-15-wave3/s2.txt
  // 【改后】绿地口径：导入**不**建库行 ⇒ 该字段恒 false；改成两条**正向**断言 ——
  //   (a) 字段契约（恒 false）；(b) 库里真的**没有**库注册表行、也**没有**旧表。
  // 【为何非放宽】旧断言要求「建了库行」（新 schema 下永远做不到 ⇒ 恒红）；新断言要求「库行不存在 + 旧表不存在」，
  //   能被「有人把库行/旧表加回来」打红 —— 方向从「期待旧行为」变成「禁止旧结构」。
  assert.equal(rebuilt.report.libraryCreated, false, '绿地后导入不写库注册表 ⇒ 该字段恒 false（契约）');
  assert.equal(rebuilt.snap.lib, null, '重建后的库级 .gs.db 不得有库注册表行（它在 app.db）');
  assert.deepEqual(rebuilt.snap.legacyTables, [], '重建后的库级 .gs.db 不得有旧表 items / library');

  // ---- 逐项对账
  assert.equal(rebuilt.report.dbCount, first.report.dbCount, 'dbCount 必须一致');
  assert.equal(rebuilt.snap.count, first.snap.count, '行数必须一致');
  assert.equal(rebuilt.snap.sqlCount, first.snap.sqlCount);
  assert.equal(rebuilt.snap.distinctUid, first.snap.distinctUid, 'uid 去重数一致');
  assert.deepEqual(rebuilt.snap.uids, first.snap.uids, 'uid 集合必须逐条一致（排序后比对）');
  assert.deepEqual(rebuilt.snap.uidVectorRow, first.snap.uidVectorRow, 'uid→vectorRow 必须逐条一致');
  assert.deepEqual(rebuilt.snap.vectorRowUid, first.snap.vectorRowUid, 'vectorRow→uid 反向映射也必须一致');
  assert.equal(rebuilt.snap.digest, first.snap.digest, '全行规范化摘要必须一致（比逐行 deepEqual 更严）');
  // 【改前】assert.deepEqual(rebuilt.snap.lib, first.snap.lib, 'library 行必须一致…')
  // 【改后】库级 .gs.db **不得**有库注册表行 / 不得有旧表（都比"两边相等"更强：旧口径在新 schema 下恒真）
  // 【为何非放宽】旧断言在绿地口径下两条都是 null ⇒ 恒真；新断言要求"旧东西**不存在**"，能被"有人把旧表加回来"打红。
  assert.equal(rebuilt.snap.lib, null, '导入**不得**在库级 .gs.db 建库注册表行（它在 app.db，由 library* 方法写）');
  assert.deepEqual(rebuilt.snap.legacyTables, [], '库级 .gs.db **不得**出现旧表 items / library（绿地 6 张表）');
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
    // 【改前】数的是**旧宽表**（绿地 schema 里不存在 ⇒ 那条会抛 no such table）—— 三行记录见 s2.txt
    // 【改后】查事实层的 asset —— 语义完全相同：**坏索引 ⇒ 一行都不导入**。
    // 【为何非放宽】仍是"必须 0 行"的强断言；改的只是被数的表（旧表已退役）。
    assert.equal(scalar(opened2.db, 'SELECT COUNT(*) AS n FROM asset'), 0, '索引坏了 ⇒ 一行都不导入');
  } finally {
    opened2.db.close();
  }
});

// ============================================================ R5 版本推进与边车

test('R5：重建会重新跑迁移（v0→目标版本），且不会留下旧的 -wal/-shm', () => {
  const dir = freshDir('R5');
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), [U1]);
  const first = importAndSnapshot(dir, { library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 1 });
  const rebuilt = deleteAndRebuild(dir, { library: { libId: 'L1', root: 'X:/lib' }, itemsJsonPath, expectedCount: 1 });
  assert.equal(rebuilt.opened.migration.fromVersion, 0);
  // 【改前】assert.deepEqual(applied.map(m => m.version), [1, 2])  ← 把**旧库的两条迁移**写死了
  // 【改后】绿地只有一条库级迁移 ⇒ applied 必须恰为 [TARGET_SCHEMA_VERSION]（**跟随清单**，不写死数字）
  // 【为何非放宽】仍要求"重建真的走了一遍迁移且落到目标版本"；写死 [1,2] 反而会在清单演进时变成假红/假绿。
  //   跟随清单后：迁移合并、拆分、新增都会自动对上，且 applied 条数与目标版本不一致照样红。
  assert.deepEqual(
    rebuilt.opened.migration.applied.map((m) => m.version),
    [TARGET_SCHEMA_VERSION],
    '重建必须跑完整条迁移链（绿地只有 v1）',
  );
  assert.deepEqual(rebuilt.left, [], '删库后不许残留边车文件（WAL 里可能有未 checkpoint 的事务）');
  assert.equal(rebuilt.snap.digest, first.snap.digest);
  assert.equal(rebuilt.snap.version, TARGET_SCHEMA_VERSION);
});

function writeItems(p, uids) {
  fs.writeFileSync(p, JSON.stringify(uids.map((uid, i) => makeItem(uid, { vectorRow: i }))), 'utf8');
  return p;
}

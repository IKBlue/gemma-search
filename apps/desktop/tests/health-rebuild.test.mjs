// apps/desktop/tests/health-rebuild.test.mjs —— T-15a 完整性自检 + 重建入口的验收测试
//
// 每条用例对应一个**会让用户误判**的失败模式：
//   H1 库根不在却报"其它项通过"    ⇒ 用户以为只是索引坏了
//   H2 没库文件时仍报 db-open ok   ⇒ 假绿（本文件专门钉"跳过就是跳过，不假装通过"）
//   H3 健康库被误报为坏            ⇒ 每次启动都提示重建
//   H4 索引坏了提示"重建元数据"    ⇒ 点了没用 —— 索引要重新编码，删库重建修不好
//   H5 .gs.db 损坏却报 ok          ⇒ 打不开的库被当成好的
//   H6/H7 版本落后 / 缺表不报      ⇒ 升级后静默读旧结构
//   H8 重建后没复检                ⇒ 重建失败也报成功
//   H9 重建两次结果不一致          ⇒ "可重建的派生数据"这句话不成立
//   H10 索引没修好却报 ok=true     ⇒ 最危险的一种假成功
//   H11 重建碰了素材               ⇒ 破 SPEC §2.1 的写入不变式（且不可逆）
//   H13 库根不存在被静默创建       ⇒ 幽灵库（Lead 裁定 U6）
//
// 跑法：node --test apps/desktop/tests/health-rebuild.test.mjs（也在 npm test 的 glob 里）
// 临时库落在仓库内 data/_t15/health-rebuild-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。
// ⚠️ 全量门禁 / npm test 由 Lead 统一跑（TASKS §3.6）。
// ⚠️ 合法索引字节只能用仓库里真实的那份（data/libraries/L1/index.bin）—— 自己拼 GSIDX = 在测试里实现第二份格式（P1）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSET_ITEM_SELECT_ALL_SQL,
  EXPECTED_TABLES,
  TARGET_SCHEMA_VERSION,
  importItemsFromJson,
  joinedRowToItemRecord,
  openGsDb,
  readSchemaVersion,
} from '../src/main/db/index.ts';
import { isReservedLibraryName } from '../src/main/gs-names.ts';
import { GS_DB_NAME } from '../src/main/storage-roots.ts';
import { writeIndexAtomically } from '../src/main/index-file.ts';
import { checkLibraryHealth, MAX_ORPHAN_LISTED } from '../src/main/library-health.ts';
// 缺包/孤包的判据只有一份（引擎 scanner）—— 测试直接拿它做交叉核对（P1：不重写判据）
import { scanLibrary } from '../../../packages/engine/src/scanner.ts';
import { materialDigest, rebuildLibraryDb } from '../src/main/library-rebuild.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t15', 'health-rebuild-test-' + process.pid);
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');
const REAL_INDEX = path.join(REAL_LIB, 'index.bin');
const FIXED_NOW = 1700000000000;
const now = () => FIXED_NOW;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

let cachedReal = null;
function realIndexBytes(t) {
  if (cachedReal) return cachedReal;
  if (!fs.existsSync(REAL_INDEX)) {
    t.skip('本机没有 ' + REAL_INDEX + '（真实库未就位）—— 需要合法索引字节的用例无法执行');
    return null;
  }
  cachedReal = fs.readFileSync(REAL_INDEX);
  return cachedReal;
}

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

function writeItems(p, uids) {
  fs.writeFileSync(
    p,
    JSON.stringify(uids.map((uid, i) => makeItem(uid, { vectorRow: i }))),
    'utf8',
  );
  return p;
}

/** 建一个"已经有 .gs.db + 已导入 N 条"的库根（没有索引 —— 索引单独写） */
function setupLibrary(label, uids) {
  const dir = freshDir(label);
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), uids);
  const dbPath = path.join(dir, '.gs.db');
  const opened = openGsDb({ dbPath, now });
  const report = importItemsFromJson({
    db: opened.db,
    library: { libId: 'L1', root: dir },
    itemsJsonPath,
    expectedCount: uids.length,
    now,
  });
  opened.db.close();
  return { dir, itemsJsonPath, dbPath, report };
}

const checkById = (report, id) => report.checks.find((c) => c.id === id);

/** 把 .gs.db 的文件头写坏（真实损坏的一种：被别的程序覆盖 / 截断） */
function corruptDb(dbPath) {
  const fd = fs.openSync(dbPath, 'r+');
  fs.writeSync(fd, Buffer.alloc(16, 0), 0, 16, 0);
  fs.closeSync(fd);
}

function allFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * 逻辑内容快照（T-11c 的口径：比逻辑内容，不比 .gs.db 文件字节）。
 *
 * ⚠️ S2b 更新：绿地口径下**没有 items / library 两张表** ⇒
 *   · 条目改经**产品那份三表连接**读回（ASSET_ITEM_SELECT_ALL_SQL + joinedRowToItemRecord）——
 *     测试**不重写列序/映射**（AGENTS P1），列漂移由产品那份改，这里跟着走；
 *   · 库注册表已搬到 app.db（库级库里**不该**有它）⇒ 旧的 lib 字段换成
 *     「注册表表有没有落在库级库里」的自证（比断言某一行等于某值更强：它拦的是**把注册表写回库级库**）。
 */
function logicalSnapshot(dbPath, libId, root) {
  const opened = openGsDb({ dbPath, readOnly: true });
  try {
    const joined = opened.db.prepare(ASSET_ITEM_SELECT_ALL_SQL).all(libId);
    const records = joined.map((row, i) =>
      joinedRowToItemRecord(row, root, 'snapshot[' + String(i) + ']'),
    );
    const tables = new Set(
      opened.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
    return {
      version: readSchemaVersion(opened.db),
      count: records.length,
      // 逐字段序列化：任何一列（含合成的 absPath）漂移都会让两次重建的快照不相等 —— 这就是 H9 要抓的
      rows: records.map((rec) =>
        Object.keys(rec)
          .sort()
          .map((k) => k + '=' + JSON.stringify(rec[k]))
          .join('|'),
      ),
      /** 库级库里**不得**有库注册表（它在应用级 app.db；旧的 library 宽表已无对应物） */
      registryTablesInLibraryDb: ['library', 'library_registry'].filter((t) => tables.has(t)),
    };
  } finally {
    opened.db.close();
  }
}

// ============================================================ H1/H2 自检的"不假装"

test('H1 ⭐ 自检：库根不存在 ⇒ **只报这一项**，不假装别的检查通过', () => {
  const missing = path.join(TMP, 'H1-nope', 'lib');
  const r = checkLibraryHealth({
    libId: 'L1',
    root: missing,
    itemsJsonPath: path.join(missing, 'items.json'),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.checks.map((c) => c.id),
    ['library-root'],
    '库根不在时后面的检查无从谈起（不许编出假绿）',
  );
  assert.equal(r.checks[0].code, 'LIB_ROOT_MISSING');
  assert.equal(r.checks[0].rebuildable, false);
  assert.equal(r.needsDbRebuild, false);
  assert.equal(r.needsIndexRebuild, false);
  assert.match(r.reason, /LIB_ROOT_MISSING/);
  assert.equal(fs.existsSync(missing), false, '自检是只读的，不许创建任何东西');
});

test('H2 ⭐ 自检：空库根（无 .gs.db / 无索引）⇒ 失败项各归各，db-* 后续检查**跳过而不是假绿**', () => {
  const dir = freshDir('H2');
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), [U1, U2, U3]);
  const r = checkLibraryHealth({ libId: 'L1', root: dir, itemsJsonPath });
  assert.deepEqual(
    r.checks.map((c) => c.id),
    ['library-root', 'items-file', 'index', 'db-file'],
  );
  assert.equal(checkById(r, 'library-root').ok, true);
  assert.equal(checkById(r, 'items-file').ok, true);
  assert.deepEqual(
    {
      ok: checkById(r, 'index').ok,
      code: checkById(r, 'index').code,
      rebuildable: checkById(r, 'index').rebuildable,
    },
    { ok: false, code: 'INDEX_MISSING', rebuildable: false },
  );
  assert.deepEqual(
    {
      ok: checkById(r, 'db-file').ok,
      code: checkById(r, 'db-file').code,
      rebuildable: checkById(r, 'db-file').rebuildable,
    },
    { ok: false, code: 'DB_MISSING', rebuildable: true },
  );
  assert.equal(r.needsDbRebuild, true, '缺 .gs.db ⇒ 重建有意义');
  assert.equal(r.needsIndexRebuild, true);
  assert.equal(r.ok, false);
});

// ============================================================ H3 健康库 + 表清单机械核对

test('H3 ⭐ 自检：健康库全绿；EXPECTED_TABLES 与 sqlite_master 机械一致', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const s = setupLibrary('H3', [U1, U2, U3]);
  writeIndexAtomically(s.dir, bytes, { seq: 1 });

  const r = checkLibraryHealth({ libId: 'L1', root: s.dir, itemsJsonPath: s.itemsJsonPath });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.needsDbRebuild, false);
  assert.equal(r.needsIndexRebuild, false);
  for (const c of r.checks) assert.equal(c.ok, true, c.id + ' 应为 ok：' + c.reason);
  assert.match(checkById(r, 'index').reason, /count=3594/);
  // 事实层两张表的**确切行数**：3 条素材 ⇒ 3 行 asset；都带包 ⇒ 3 preview + 3 archive = 6 行 asset_file
  assert.match(checkById(r, 'db-read').reason, /asset=3 行/);
  assert.match(checkById(r, 'db-read').reason, /asset_file=6 行/);
  assert.match(
    checkById(r, 'db-schema').reason,
    new RegExp('schema_version=' + String(TARGET_SCHEMA_VERSION)),
  );
  // db-tables 的"应有张数"也要被钉住：绿地库级 = 3 张业务表 + 账本（旧口径是 8 张）
  assert.match(checkById(r, 'db-tables').reason, /应有的 4 张表都在/);

  // EXPECTED_TABLES（从 DDL 派生）必须与实际表集合一致 —— 否则"表是否在"的检查会漂。
  // 内容按**绿地 6 张表**口径换新（方向不变：断言"派生清单 == 库里真实集合"）。
  assert.deepEqual(
    [...EXPECTED_TABLES],
    ['asset', 'asset_file', 'asset_index_state', 'schema_version'],
  );
  const opened = openGsDb({ dbPath: s.dbPath, readOnly: true });
  try {
    const have = opened.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(have, [...EXPECTED_TABLES]);
    // 更强的正向断言：旧设计的表**一张都不许**在（旧清单被删掉，但"它没回来"要单独钉）
    for (const gone of [
      'items',
      'library',
      'doc_dirs',
      'documents',
      'doc_chunks',
      'health_runs',
      'health_ledger',
    ]) {
      assert.equal(have.includes(gone), false, '绿地 schema 不得再有旧表 ' + gone);
    }
    // 库注册表属于应用级 app.db：库级库里出现它就是**越界写**
    assert.equal(
      have.includes('library_registry'),
      false,
      'library_registry 在 app.db，不许落在库级 .gs.db',
    );
  } finally {
    opened.db.close();
  }
});

// ============================================================ H4–H7 各类损坏各报各的

test('H4 ⭐ 自检：索引损坏 ⇒ INDEX_CORRUPT，且**不**提示重建元数据（删库重建修不好索引）', () => {
  const s = setupLibrary('H4', [U1, U2, U3]);
  fs.writeFileSync(
    path.join(s.dir, '.gs-index.bin'),
    Buffer.from('not a gsidx file at all'),
    'utf8',
  );
  const r = checkLibraryHealth({ libId: 'L1', root: s.dir, itemsJsonPath: s.itemsJsonPath });
  const idx = checkById(r, 'index');
  assert.equal(idx.ok, false);
  assert.equal(idx.code, 'INDEX_CORRUPT');
  assert.equal(idx.rebuildable, false);
  assert.match(idx.reason, /MAGIC/, '理由里要带引擎的原始判定');
  assert.equal(checkById(r, 'db-read').ok, true, 'db 侧不受索引影响');
  assert.equal(r.needsDbRebuild, false, '索引坏了不该提示"重建元数据"');
  assert.equal(r.needsIndexRebuild, true);
});

test('H5 ⭐ 自检：.gs.db 损坏 ⇒ DB_OPEN_FAILED，可重建', () => {
  const s = setupLibrary('H5', [U1, U2, U3]);
  corruptDb(s.dbPath);
  const r = checkLibraryHealth({ libId: 'L1', root: s.dir, itemsJsonPath: s.itemsJsonPath });
  assert.equal(checkById(r, 'db-file').ok, true, '文件在（只是内容坏了）');
  assert.deepEqual(
    {
      ok: checkById(r, 'db-open').ok,
      code: checkById(r, 'db-open').code,
      rebuildable: checkById(r, 'db-open').rebuildable,
    },
    { ok: false, code: 'DB_OPEN_FAILED', rebuildable: true },
  );
  assert.equal(checkById(r, 'db-schema'), undefined, '打不开就不可能查 schema —— 跳过，不假装通过');
  assert.equal(r.needsDbRebuild, true);
});

test('H6 自检：schema_version 落后 ⇒ SCHEMA_OUTDATED，其它 db 项仍然 ok', () => {
  const s = setupLibrary('H6', [U1, U2, U3]);
  const opened = openGsDb({ dbPath: s.dbPath, now });
  // 绿地库级只有一条迁移（TARGET_SCHEMA_VERSION=1）⇒ "落后"只能是 0
  opened.db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(0);
  opened.db.close();
  const r = checkLibraryHealth({ libId: 'L1', root: s.dir, itemsJsonPath: s.itemsJsonPath });
  assert.deepEqual(
    {
      ok: checkById(r, 'db-schema').ok,
      code: checkById(r, 'db-schema').code,
      rebuildable: checkById(r, 'db-schema').rebuildable,
    },
    { ok: false, code: 'SCHEMA_OUTDATED', rebuildable: true },
  );
  assert.equal(checkById(r, 'db-tables').ok, true);
  assert.equal(checkById(r, 'db-read').ok, true);
  assert.equal(r.needsDbRebuild, true);
});

test('H7 自检：缺表 ⇒ DB_TABLE_MISSING 且点名列出来', () => {
  const s = setupLibrary('H7', [U1, U2, U3]);
  const opened = openGsDb({ dbPath: s.dbPath, now });
  // 绿地口径没有 doc_chunks（旧表）⇒ 拿事实层必需的 asset_file 做"缺一张表"的样本
  opened.db.exec('DROP TABLE asset_file');
  opened.db.close();
  const r = checkLibraryHealth({ libId: 'L1', root: s.dir, itemsJsonPath: s.itemsJsonPath });
  const tables = checkById(r, 'db-tables');
  assert.equal(tables.ok, false);
  assert.equal(tables.code, 'DB_TABLE_MISSING');
  assert.match(tables.reason, /asset_file/);
  assert.equal(tables.rebuildable, true);
  assert.equal(r.needsDbRebuild, true);
});

// ============================================================ H8 重建（坏 db → 重建）

test('H8 ⭐ 重建：.gs.db 损坏 ⇒ 删库重建 + 复检，素材摘要一字不变', () => {
  const s = setupLibrary('H8', [U1, U2, U3]);
  corruptDb(s.dbPath);
  const digestBefore = materialDigest(s.dir, { withContent: true });

  const rep = rebuildLibraryDb({
    libId: 'L1',
    root: s.dir,
    itemsJsonPath: s.itemsJsonPath,
    expectedCount: 3,
    now,
  });
  assert.ok(rep.before, '默认要做重建前自检');
  assert.equal(rep.before.needsDbRebuild, true, '重建前自检必须指出"该重建"');
  assert.ok(
    rep.removedDbFiles.some((p) => p.endsWith('.gs.db')),
    '真的删了 .gs.db',
  );
  assert.equal(rep.created, true);
  assert.deepEqual(rep.schema, { fromVersion: 0, toVersion: TARGET_SCHEMA_VERSION, applied: [1] });
  assert.equal(rep.import.dbCount, 3);
  assert.equal(rep.dbOk, true, 'db 侧复检必须全绿');
  assert.equal(rep.indexOk, false, '这个夹具里没有索引');
  assert.equal(rep.ok, false, '索引缺失 ⇒ 整个库还不健康（不许因为"db 建好了"就报成功）');
  assert.match(rep.reason, /重建完成/);
  assert.deepEqual(
    materialDigest(s.dir, { withContent: true }),
    digestBefore,
    '素材必须一个字节都没变',
  );
});

// ============================================================ H9 幂等

test('H9 ⭐ 幂等：重建两次的逻辑内容完全一致（不比 .gs.db 文件字节）', (t) => {
  const s = setupLibrary('H9', [U1, U2, U3]);
  const first = rebuildLibraryDb({
    libId: 'L1',
    root: s.dir,
    itemsJsonPath: s.itemsJsonPath,
    expectedCount: 3,
    now,
  });
  const snap1 = logicalSnapshot(s.dbPath, 'L1', s.dir);
  const second = rebuildLibraryDb({
    libId: 'L1',
    root: s.dir,
    itemsJsonPath: s.itemsJsonPath,
    expectedCount: 3,
    now,
  });
  const snap2 = logicalSnapshot(s.dbPath, 'L1', s.dir);

  assert.equal(first.import.dbCount, 3);
  assert.equal(second.import.dbCount, 3);
  assert.deepEqual(
    snap2,
    snap1,
    '行集（逐字段，含 uid→vectorRow 与合成的 absPath）+ 版本必须逐项一致',
  );
  assert.equal(snap1.count, 3);
  assert.equal(snap1.version, TARGET_SCHEMA_VERSION);
  assert.deepEqual(
    snap1.registryTablesInLibraryDb,
    [],
    '库级 .gs.db 不得出现库注册表（它在 app.db）',
  );
  t.diagnostic(
    'H9 两次重建的逻辑快照一致（count=' +
      String(snap1.count) +
      ' · version=' +
      String(snap1.version) +
      '）；⚠️ **不比 .gs.db 文件字节**：SQLite 页布局 / freelist / WAL checkpoint / 文件内时间戳不保证逐字节可复现',
  );
});

// ============================================================ H10 索引三态

test('H10 ⭐ 索引三态：written / kept / still-broken', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;

  const a = setupLibrary('H10a', [U1, U2]);
  const written = rebuildLibraryDb({
    libId: 'L1',
    root: a.dir,
    itemsJsonPath: a.itemsJsonPath,
    expectedCount: 2,
    indexBytes: bytes,
    now,
  });
  assert.equal(written.index.action, 'written');
  assert.equal(written.index.count, 3594);
  assert.equal(written.indexOk, true);
  assert.equal(written.ok, true, '索引写成功 + db 全绿 ⇒ 整体成功');

  const kept = rebuildLibraryDb({
    libId: 'L1',
    root: a.dir,
    itemsJsonPath: a.itemsJsonPath,
    expectedCount: 2,
    now,
  });
  assert.equal(kept.index.action, 'kept', '没给新字节 ⇒ 绝不动索引');
  assert.equal(kept.index.count, 3594);
  assert.equal(kept.ok, true);

  const b = setupLibrary('H10b', [U1, U2]);
  fs.writeFileSync(path.join(b.dir, '.gs-index.bin'), Buffer.from('junk'), 'utf8');
  const broken = rebuildLibraryDb({
    libId: 'L1',
    root: b.dir,
    itemsJsonPath: b.itemsJsonPath,
    expectedCount: 2,
    now,
  });
  assert.equal(broken.index.action, 'still-broken');
  assert.equal(broken.dbOk, true, 'db 那部分依然是成功的');
  assert.equal(broken.ok, false, '索引没修好 ⇒ **不许报成功**');
  assert.equal(broken.indexOk, false);
  assert.match(broken.reason, /still-broken/);
  assert.equal(broken.import.dbCount, 2);
});

// ============================================================ H11 素材零改动

test('H11 ⭐ 重建只碰 .gs-*：素材摘要（含内容）与文件集合一字不变', () => {
  const dir = freshDir('H11');
  fs.mkdirSync(path.join(dir, 'CR'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'VR'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CR', 'a.jpg'), 'AAA');
  fs.writeFileSync(path.join(dir, 'CR', 'a.rar'), 'BBB');
  fs.writeFileSync(path.join(dir, 'VR', 'b.jpg'), 'CCC');
  const itemsJsonPath = writeItems(path.join(dir, 'items.json'), [U1, U2]);

  const before = materialDigest(dir, { withContent: true });
  const namesBefore = new Set(allFiles(dir));

  const rep = rebuildLibraryDb({ libId: 'L1', root: dir, itemsJsonPath, expectedCount: 2, now });
  assert.equal(rep.import.dbCount, 2);

  assert.deepEqual(
    materialDigest(dir, { withContent: true }),
    before,
    '素材的路径/大小/mtime/内容都必须完全不变',
  );
  const added = allFiles(dir).filter((rel) => !namesBefore.has(rel));
  for (const rel of added) {
    // ⚠️ 用**布局权威**的判据，不是手写 startsWith('.gs-') —— .gs.db 不以 .gs- 开头（本轮实测踩到）
    assert.equal(
      isReservedLibraryName(path.basename(rel)),
      true,
      rel + ' 不在库根保留命名空间里 ⇒ 越界写入（SPEC §2.1）',
    );
  }
  // ⚠️ 不能断言"只新增 .gs.db"：SQLite 的 close 是 sqlite3_close_v2（延迟关闭），
  //    -wal / -shm 可能还在（下一打开时会重新接管）。可靠的说法是：
  //    新增的东西都属于 **.gs.db 家族**（本次没给索引字节 ⇒ 不该动 .gs-index.bin）。
  for (const rel of added) {
    const base = path.basename(rel);
    assert.ok(
      base === GS_DB_NAME || base.startsWith(GS_DB_NAME + '-'),
      rel + ' 不属于 .gs.db 家族 ⇒ 本次重建碰了不该碰的东西',
    );
  }
  assert.ok(added.includes('.gs.db'), '至少要建出 .gs.db');
});

// ============================================================ H13 库根不存在

test('H13 ⭐ 重建：库根不存在 ⇒ LIB_ROOT_MISSING 且**不创建目录**（U6 幽灵库）', () => {
  const missing = path.join(TMP, 'H13-parent', 'lib');
  let err = null;
  try {
    rebuildLibraryDb({
      libId: 'L1',
      root: missing,
      itemsJsonPath: path.join(missing, 'items.json'),
      now,
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err, '库根不存在必须抛错');
  assert.equal(err.code, 'LIB_ROOT_MISSING');
  assert.match(err.message, /拒绝重建/);
  assert.equal(fs.existsSync(missing), false, '不许创建库根');
  assert.equal(fs.existsSync(path.join(TMP, 'H13-parent')), false, '连父目录也不许创建');

  // 没有落点时也要明确拒绝，而不是猜一个
  const dir = freshDir('H13b');
  assert.throws(
    () =>
      rebuildLibraryDb({
        libId: 'L1',
        root: dir,
        itemsJsonPath: writeItems(path.join(dir, 'items.json'), [U1]),
        dbPath: null,
        now,
      }),
    (e) => e && e.code === 'DB_PATH_REQUIRED',
  );
});

// ============================================================ H12 真实库副本（验收场景）

test('H12 ⭐ 真实库副本：先弄坏 .gs.db → 自检报错 → 重建 → 3594 条 + 素材摘要不变', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const srcItems = path.join(REAL_LIB, 'items.json');
  const srcMeta = path.join(REAL_LIB, 'meta.json');
  if (!fs.existsSync(srcItems) || !fs.existsSync(srcMeta)) {
    t.skip(
      '本机没有 ' + REAL_LIB + ' 的 items.json/meta.json（真实库未就位）—— 该验收场景无法执行',
    );
    return;
  }
  const meta = JSON.parse(fs.readFileSync(srcMeta, 'utf8'));
  const work = freshDir('H12');
  for (const name of ['items.json', 'meta.json', 'index.bin']) {
    fs.copyFileSync(path.join(REAL_LIB, name), path.join(work, name));
  }
  const itemsJsonPath = path.join(work, 'items.json');
  const library = {
    compat: meta.compat,
    dim: meta.dim,
    seq: meta.seq_length,
    metaJson: JSON.stringify(meta),
  };

  // 第 1 步：正常重建一次（把索引也写进去）—— 前提到位
  const first = rebuildLibraryDb({
    libId: meta.lib_id,
    root: work,
    itemsJsonPath,
    expectedCount: meta.count,
    indexBytes: bytes,
    library,
    now,
  });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.import.dbCount, 3594);
  assert.equal(first.index.action, 'written');
  const digestBefore = materialDigest(work, { withContent: true });

  // 第 2 步：弄坏 .gs.db（真实损坏：文件头被清零）
  corruptDb(path.join(work, '.gs.db'));
  const broken = checkLibraryHealth({ libId: meta.lib_id, root: work, itemsJsonPath });
  assert.equal(broken.needsDbRebuild, true);
  assert.equal(checkById(broken, 'db-open').code, 'DB_OPEN_FAILED');
  assert.equal(checkById(broken, 'index').ok, true, '索引没被弄坏');

  // 第 3 步：重建
  const rep = rebuildLibraryDb({
    libId: meta.lib_id,
    root: work,
    itemsJsonPath,
    expectedCount: meta.count,
    library,
    now,
  });
  assert.equal(rep.before.needsDbRebuild, true);
  assert.equal(rep.created, true);
  assert.deepEqual(rep.schema, { fromVersion: 0, toVersion: TARGET_SCHEMA_VERSION, applied: [1] });
  assert.equal(rep.import.dbCount, 3594, '重建后必须恰好 3594 条');
  assert.equal(rep.index.action, 'kept');
  assert.equal(rep.index.count, 3594);
  assert.equal(rep.ok, true, rep.reason);
  assert.equal(rep.dbOk, true);
  assert.equal(rep.indexOk, true);
  t.diagnostic(
    'H12 重建：删除 ' +
      String(rep.removedDbFiles.length) +
      ' 个 .gs.db 文件 · schema v' +
      String(rep.schema.fromVersion) +
      '→v' +
      String(rep.schema.toVersion) +
      ' · 导入 ' +
      String(rep.import.dbCount) +
      ' 条（新增 ' +
      String(rep.import.inserted) +
      '）· 索引 ' +
      rep.index.action +
      '（count=' +
      String(rep.index.count) +
      '）· 素材摘要 ' +
      digestBefore.digest,
  );

  // 第 4 步：素材（items.json / meta.json / index.bin —— 都不是 .gs-*）一个字节都没变
  assert.deepEqual(
    materialDigest(work, { withContent: true }),
    digestBefore,
    '素材必须一个字节都没变',
  );
  const snap = logicalSnapshot(path.join(work, '.gs.db'), meta.lib_id, work);
  assert.equal(snap.count, 3594);
  assert.equal(snap.version, TARGET_SCHEMA_VERSION);
  assert.deepEqual(
    snap.registryTablesInLibraryDb,
    [],
    '库级 .gs.db 不得出现库注册表（它在 app.db）',
  );
});
// ============================================================ H14 孤包（只有包、没有图）

test('H14 ⭐ 孤包是独立异常类别：单独计数 · 素材数不变 · 不翻 ok · 缺包 ≠ 孤包', () => {
  const dir = freshDir('H14');
  const cr = path.join(dir, 'CR');
  fs.mkdirSync(cr, { recursive: true });
  // 3 条素材：U1/U2 有图有包；U3 有图无包（SPEC §1 允许的缺包）
  const records = [
    makeItem(U1),
    makeItem(U2),
    makeItem(U3, {
      archiveName: null,
      archiveRelPath: null,
      archiveAbsPath: null,
      archiveExt: null,
      archiveSize: null,
      archiveMtime: null,
    }),
  ];
  const itemsJsonPath = path.join(dir, 'items.json');
  fs.writeFileSync(itemsJsonPath, JSON.stringify(records), 'utf8');
  for (const uid of [U1, U2, U3]) fs.writeFileSync(path.join(cr, 'ID-' + uid + '.jpg'), 'IMG');
  for (const uid of [U1, U2]) fs.writeFileSync(path.join(cr, 'ID-' + uid + '.rar'), 'ARC');
  // 保留命名空间里的包不算孤包（扫描器必须跳过 —— U11 的判据）
  fs.mkdirSync(path.join(cr, '.gs-staging', 't1'), { recursive: true });
  fs.writeFileSync(path.join(cr, '.gs-staging', 't1', 'x.rar'), 'STAGED');

  const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), now });
  try {
    importItemsFromJson({
      db: opened.db,
      library: { libId: 'L1', root: dir },
      itemsJsonPath,
      expectedCount: 3,
      now,
    });
  } finally {
    opened.db.close();
  }

  const args = { libId: 'L1', root: dir, itemsJsonPath };
  const before = checkLibraryHealth(args);
  assert.equal(before.orphanArchive.scanned, true, '库根在 ⇒ 必须真扫过（不是「没扫」冒充 0）');
  assert.equal(before.orphanArchive.count, 0, '还没有孤包');
  assert.equal(before.materialCount, 3, '素材 = 预览图条目 = 3');

  // 现在放一个只有包、没有图的文件
  fs.writeFileSync(path.join(cr, 'LONELY.rar'), 'ORPHAN');

  const after = checkLibraryHealth(args);
  assert.equal(
    after.orphanArchive.count,
    1,
    '孤包 ⇒ 该类 +1（保留命名空间里的包不算，所以不是 2）',
  );
  assert.equal(after.orphanArchive.samples.length, 1);
  assert.match(after.orphanArchive.samples[0].relPath, /LONELY\.rar$/);
  assert.equal(after.orphanArchive.truncated, false);
  assert.equal(after.materialCount, 3, '★ 加孤包后素材计数不变（孤包不算素材）');
  assert.equal(after.ok, before.ok, '★ 孤包不翻 report.ok —— 它不是损坏，是不完整');
  assert.equal(
    after.needsDbRebuild,
    before.needsDbRebuild,
    '孤包修不好 ⇒ 不许因此提示「删库重建」',
  );
  assert.match(after.reason, /孤包/, '总结里必须能看见（不许静默）');
  assert.match(after.reason, /不算素材/);
  assert.match(after.reason, /不是损坏/);
  assert.match(after.reason, /重建元数据修不好/);

  // 缺包 ≠ 孤包：引擎那两份清单必须各自独立（这就是「不写第二份判据」的交叉核对）
  const scan = scanLibrary(dir, { libId: 'L1' });
  assert.equal(scan.counts.images, 3);
  assert.equal(scan.counts.missingArchive, 1, '缺包 = 有图无包（允许的状态，单独计数）');
  assert.equal(scan.counts.missingImage, 1, '孤包 = 有包无图（不完整）');
  // 扫描器算出的 uid 与 items.json 里手写的常量**不是一回事**（uid 由库/路径派生）
  // ⇒ 这里按**路径**核对（拿 uid 公式再算一遍 = 在测试里实现第二份公式，P1）
  assert.match(scan.missingArchive[0].relPath, new RegExp('ID-' + U3 + '\\.jpg$'));
  assert.equal(scan.missingArchive[0].stem, 'ID-' + U3);
  assert.equal(scan.missingImage[0].relPath.endsWith('LONELY.rar'), true);
  assert.equal(scan.missingImage[0].ext, '.rar');
});

// ============================================================ H15 明细上限 + truncated

test('H15 ⭐ 孤包明细有上限且如实标记 truncated（计数不受截断影响）', () => {
  const dir = freshDir('H15');
  const cr = path.join(dir, 'CR');
  fs.mkdirSync(cr, { recursive: true });
  const total = MAX_ORPHAN_LISTED + 10;
  for (let i = 1; i <= total; i++) {
    fs.writeFileSync(path.join(cr, 'lone-' + String(i).padStart(3, '0') + '.rar'), 'X');
  }
  const r = checkLibraryHealth({ libId: 'L1', root: dir });
  assert.equal(r.orphanArchive.scanned, true);
  assert.equal(r.orphanArchive.count, total, '计数必须真实（截断只影响明细）');
  assert.equal(
    r.orphanArchive.samples.length,
    MAX_ORPHAN_LISTED,
    '明细上限 = ' + String(MAX_ORPHAN_LISTED),
  );
  assert.equal(r.orphanArchive.truncated, true, 'count > samples ⇒ 必须标记 truncated');
  assert.equal(r.materialCount, 0, '没有预览图 ⇒ 素材 0（孤包不计入）');
});

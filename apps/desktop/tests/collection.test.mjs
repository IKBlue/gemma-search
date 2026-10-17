// apps/desktop/tests/collection.test.mjs —— B2-7b：`collection` + `collection_item`（意图层 · **有序分组**）
//
// 要证的八件事：
//   ① **列集 = 设计基线**（从 `SPEC-COMPACT.md` §222 解析后与真 DDL 双向对照；§240/§241 的 PK 与索引也照抄）；
//   ② `collection` 的约束：nanoid 主键 · `name` NOT NULL 且**不 UNIQUE**（同名集合合理）· 两个时刻 NOT NULL；
//   ③ ⭐⭐ **与 `tag`/`asset_tag` 的边界是机械证明的**（不是文字）：
//      **基数其实一样**（同一条素材既能挂多标签、也能进多集合）——真正的差别是**顺序语义**：
//      集合里**每个成员有位置**，位置由 `added_at_ms` + `uid` 平局裁决决定 ⇒ 查询**稳定**；
//      而且位置是**每个集合各自**的（同一条素材在集合 A 第 2 位、在集合 B 第 1 位，互不影响）。
//   ④ ⭐⭐ **删除语义**：删集合 ⇒ 其 item CASCADE；删素材 ⇒ 它在**所有**集合里的 item CASCADE；都**不是** SET NULL；
//   ⑤ 复合主键 `(collection_id, uid)` = 「集合里有哪些」+ 防重复加入；
//   ⑥ 落点：**库级 .gs.db + 意图层** · 走**库级链 v9**；
//   ⑦ 升级路径：v8-only 的库 ⇒ 只跑 v9、老数据在、外键仍生效、幂等；
//   ⑧ 基线 §241 **点名**的 `idx_collection_item_uid` 真的建出来了（「这条被哪些集合收了」）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_TABLES,
  LIBRARY_MIGRATIONS,
  LIBRARY_TABLES,
  TARGET_SCHEMA_VERSION,
  openGsDb,
  readSchemaVersion,
} from '../src/main/db/index.ts';
import { appLayerTables, libraryLayerTables, tablesInLayer } from '../src/main/db/schema-layers.ts';
import { openAppDb } from '../src/main/app-db.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b27b', 'collection-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function freshDb(label, migrations) {
  const dir = freshDir(label);
  const dbPath = path.join(dir, '.gs.db');
  const opened = migrations
    ? openGsDb({ dbPath, migrations, now: () => T0 })
    : openGsDb({ dbPath, now: () => T0 });
  return { dbPath, db: opened.db, opened };
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

/**
 * 解析 §222 那张表的**行**（不是字段集合）——因为一张表里并排写了两张表的字段，
 * 必须按「约束列里出现 FK」切出第二张表的边界（这是机械规则，不是靠行号猜）。
 */
function baselineRows() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+collection \/ collection_item\b/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 §222 那一节');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const m = line.match(/^\|\s*`?(.+?)`?\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/);
    if (!m) continue;
    const fields = m[1]
      .split('/')
      .map((s) => s.replace(/`/g, '').trim())
      .filter((s) => /^[a-z_][a-z0-9_]*$/.test(s));
    if (fields.length === 0) continue;
    rows.push({ fields, constraint: m[3] });
  }
  return rows;
}

const seedAsset = (db, uid) =>
  db
    .prepare(
      'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/' + uid + '.jpg', T0);
const seedCollection = (db, id, name) =>
  db
    .prepare(
      'INSERT INTO collection (collection_id, name, note, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?)',
    )
    .run(id, name, null, T0, T0);
const put = (db, collId, uid, atMs) =>
  db
    .prepare('INSERT INTO collection_item (collection_id, uid, added_at_ms) VALUES (?,?,?)')
    .run(collId, uid, atMs);
const orderOf = (db, collId) =>
  db
    .prepare(
      'SELECT uid FROM collection_item WHERE collection_id = ? ORDER BY added_at_ms ASC, uid ASC',
    )
    .all(collId)
    .map((r) => r.uid);
const count = (db, table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;

// ============================================================ C1/C2 形状与约束

test('C1 ⭐⭐ 列集 = 设计基线（collection 5 字段 · collection_item 3 字段）双向 + §240 PK / §241 索引', () => {
  const rows = baselineRows();
  // 机械切分：第二张表的字段行从**约束列里出现 FK** 的那一行开始
  const cut = rows.findIndex((r) => /FK/.test(r.constraint));
  assert.ok(cut > 0, '设计基线里应能找到 collection_item 的第一行（约束含 FK）');
  const collection = new Set(rows.slice(0, cut).flatMap((r) => r.fields));
  const item = new Set(rows.slice(cut).flatMap((r) => r.fields));
  assert.equal(
    collection.size,
    5,
    'collection 是 5 个字段行（created_at_ms / updated_at_ms 写在同一行里算 2 个），实得 ' +
      String(collection.size),
  );
  assert.equal(item.size, 3, 'collection_item 是 3 个字段行，实得 ' + String(item.size));
  const { db } = freshDb('C1');
  try {
    for (const [table, want] of [
      ['collection', collection],
      ['collection_item', item],
    ]) {
      const cols = db
        .prepare("PRAGMA table_info('" + table + "')")
        .all()
        .map((c) => c.name);
      assert.deepEqual(
        [...cols].sort(),
        [...want].sort(),
        table + ' 的列与设计基线逐字对上（多/少都红）',
      );
      assert.deepEqual(
        cols.filter((c) => !want.has(c)),
        [],
        table + ' 里出现设计基线没写的列（自造字段？）',
      );
    }
    // §240「PRIMARY KEY (collection_id, uid)」与 §241「idx_collection_item_uid (uid)」是基线**点名**的
    const doc = fs.readFileSync(DOC, 'utf8');
    assert.ok(
      /PRIMARY KEY \(collection_id, uid\)/.test(doc),
      '基线点名了复合主键 (collection_id, uid)',
    );
    assert.ok(/idx_collection_item_uid/.test(doc), '基线点名了 idx_collection_item_uid');
    const pk = db
      .prepare("PRAGMA table_info('collection_item')")
      .all()
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    assert.deepEqual(
      pk,
      ['collection_id', 'uid'],
      '复合主键顺序 = (collection_id, uid)（与基线一致）',
    );
  } finally {
    db.close();
  }
});

test('C2 collection 的约束：collection_id 主键 · name NOT NULL **不 UNIQUE**（同名集合合理）· 两个时刻 NOT NULL', () => {
  const { db } = freshDb('C2');
  try {
    seedCollection(db, 'c1', '提案');
    assert.throws(
      () => seedCollection(db, 'c1', '另一个名字'),
      /UNIQUE|PRIMARY KEY/i,
      'collection_id 是主键',
    );
    // ⭐ 反向证明"name 不 UNIQUE"：两个**同名**集合必须都能建出来（谁给 name 加 UNIQUE，这里就红）
    seedCollection(db, 'c2', '提案');
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM collection WHERE name = ?').get('提案').n,
      2,
      '同名集合合理（基线原话：去年与今年的提案可以同名）⇒ name 不许 UNIQUE',
    );
    assert.throws(
      () =>
        db
          .prepare(
            'INSERT INTO collection (collection_id, created_at_ms, updated_at_ms) VALUES (?,?,?)',
          )
          .run('c3', T0, T0),
      /NOT NULL/i,
      'name NOT NULL',
    );
    assert.throws(
      () => db.prepare('INSERT INTO collection (collection_id, name) VALUES (?,?)').run('c4', 'x'),
      /NOT NULL/i,
      'created_at_ms / updated_at_ms 都 NOT NULL',
    );
    // note 可空
    assert.equal(
      db.prepare('SELECT note FROM collection WHERE collection_id = ?').get('c1').note,
      null,
      'note 可空',
    );
  } finally {
    db.close();
  }
});

// ============================================================ C3 ⭐⭐ 与标签的边界（有序）

test('C3 ⭐⭐ 与 tag 的边界：**基数是 N:M（和标签一样），差别在"每个集合各自有位置"** —— 顺序稳定', () => {
  const { db } = freshDb('C3');
  try {
    seedAsset(db, 'aa0000000001');
    seedAsset(db, 'aa0000000002');
    seedAsset(db, 'aa0000000003');
    seedCollection(db, 'c1', '年度提案');
    seedCollection(db, 'c2', '备选');
    // ① 同一条素材可以进**多个集合**（基数是 N:M —— 与标签相同；别用"1:N"糊过去）
    put(db, 'c1', 'aa0000000001', T0 + 300);
    put(db, 'c2', 'aa0000000001', T0 + 100);
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM collection_item WHERE uid = ?').get('aa0000000001').n,
      2,
      '同一条素材可进多个集合（N:M —— 与 asset_tag 的基数相同）',
    );
    // ② 同一集合内**位置由 added_at_ms 决定**（基线：added_at_ms "也是默认排序键"）
    put(db, 'c1', 'aa0000000003', T0 + 100); // 最早
    put(db, 'c1', 'aa0000000002', T0 + 200);
    const first = orderOf(db, 'c1');
    assert.deepEqual(
      first,
      ['aa0000000003', 'aa0000000002', 'aa0000000001'],
      '顺序 = added_at_ms 升序',
    );
    // ③ **顺序稳定**：再查一次，结果必须一模一样（不是"这次碰巧这样"）
    assert.deepEqual(orderOf(db, 'c1'), first, '同一集合的顺序在重复查询之间必须稳定');
    // ④ **平局裁决**：两条同一毫秒加入 ⇒ 由 uid 定序，且两次一致（否则用户会看到顺序自己变）
    //    ⚠️ 顺序要紧：先建素材再插成员（外键是**真的**会拒的 —— 这里踩过一次）
    seedAsset(db, 'aa0000000008');
    seedAsset(db, 'aa0000000009');
    put(db, 'c1', 'aa0000000009', T0 + 500);
    put(db, 'c1', 'aa0000000008', T0 + 500);
    const tie1 = orderOf(db, 'c1');
    assert.deepEqual(tie1, orderOf(db, 'c1'), '同一毫秒的条目顺序也必须确定（uid 平局裁决）');
    assert.deepEqual(
      tie1.filter((u) => u >= 'aa0000000008'),
      ['aa0000000008', 'aa0000000009'],
      '平局时按 uid 升序 ⇒ 顺序不是随机的',
    );
    // ⑤ ⭐ 位置是**每个集合各自**的：同一条素材在 c1 是第 3 位、在 c2 是第 1 位（互不影响）
    const c1Pos = orderOf(db, 'c1').indexOf('aa0000000001');
    const c2Pos = orderOf(db, 'c2').indexOf('aa0000000001');
    assert.deepEqual(
      [c1Pos, c2Pos],
      [2, 0],
      '同一条素材在不同集合里各有自己的位置（标签没有"位置"这个概念）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ C4 ⭐⭐ 删除语义

test('C4 ⭐⭐ 删除语义：删集合 ⇒ 其 item CASCADE；删素材 ⇒ 它在**所有**集合的 item CASCADE；不是 SET NULL', () => {
  const { db } = freshDb('C4');
  try {
    assert.equal(
      db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      1,
      'FK 约束默认开（适配层保证）',
    );
    for (const uid of ['aa0000000001', 'aa0000000002']) seedAsset(db, uid);
    seedCollection(db, 'c1', 'A');
    seedCollection(db, 'c2', 'B');
    put(db, 'c1', 'aa0000000001', T0);
    put(db, 'c1', 'aa0000000002', T0 + 1);
    put(db, 'c2', 'aa0000000001', T0 + 2);
    assert.equal(count(db, 'collection_item'), 3);
    // ① 删**集合** ⇒ 只有它的成员走（另一个集合不受影响）
    db.prepare('DELETE FROM collection WHERE collection_id = ?').run('c1');
    assert.deepEqual(
      db
        .prepare('SELECT collection_id, uid FROM collection_item')
        .all()
        .map((r) => [r.collection_id, r.uid]),
      [['c2', 'aa0000000001']],
      '删集合 ⇒ 它的成员 CASCADE；别的集合不受影响',
    );
    // 不是 SET NULL：没有悬空成员
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) n FROM collection_item WHERE collection_id IS NULL OR uid IS NULL',
        )
        .get().n,
      0,
      'CASCADE 而不是 SET NULL（没有 NULL 残留）',
    );
    // ② 删**素材** ⇒ 它在**所有**集合里的成员身份一起走
    put(db, 'c2', 'aa0000000002', T0 + 3);
    db.prepare('DELETE FROM asset WHERE uid = ?').run('aa0000000001');
    assert.equal(count(db, 'collection_item'), 1, '删素材 ⇒ 它在所有集合里的 item 都走了');
    assert.equal(db.prepare('SELECT uid FROM collection_item').get().uid, 'aa0000000002');
    // ③ 反证：外键真的会拒非法引用
    assert.throws(
      () => put(db, 'c2', 'aa-dead', T0),
      /FOREIGN KEY|constraint/i,
      'uid 必须指向存在的素材',
    );
    assert.throws(
      () => put(db, 'c-dead', 'aa0000000002', T0),
      /FOREIGN KEY|constraint/i,
      'collection_id 必须指向存在的集合',
    );
  } finally {
    db.close();
  }
});

test('C5 复合主键 (collection_id, uid)：防重复加入 · 两列 NOT NULL（堵住 (NULL, uid) 的缝）', () => {
  const { db } = freshDb('C5');
  try {
    seedAsset(db, 'aa0000000001');
    seedCollection(db, 'c1', 'A');
    put(db, 'c1', 'aa0000000001', T0);
    assert.throws(
      () => put(db, 'c1', 'aa0000000001', T0 + 1),
      /UNIQUE|PRIMARY KEY/i,
      '同一条不许在同一个集合里占两行（复合主键的"防重复加入"）',
    );
    const info = Object.fromEntries(
      db
        .prepare("PRAGMA table_info('collection_item')")
        .all()
        .map((c) => [c.name, c.notnull]),
    );
    assert.deepEqual([info.collection_id, info.uid], [1, 1], '复合主键两列都 NOT NULL');
  } finally {
    db.close();
  }
});

// ============================================================ C6/C7/C8 落点 / 升级 / 索引

test('C6 ⭐⭐ 落点：库级 .gs.db + **意图层** · 走库级链 v9（B2 系列最后一张表）· app 库里没有', () => {
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标 = 清单上限（派生）');
  assert.equal(LIBRARY_MIGRATIONS[8].name, 'batch2-collections', '集合是库级 v9（钉自己那一格）');
  for (const t of ['collection', 'collection_item']) {
    assert.ok(LIBRARY_TABLES.includes(t), 'LIBRARY_TABLES 必须含 ' + t);
    assert.ok(EXPECTED_TABLES.includes(t), '应有清单必须含 ' + t);
    assert.ok(libraryLayerTables().includes(t), t + ' 落在库级 .gs.db');
    assert.equal(appLayerTables().includes(t), false, t + ' 不许落在 app.db');
    assert.ok(tablesInLayer('intent').includes(t), t + ' 属**意图层**（用户自己做的组织，必须留）');
  }
  const lib = freshDb('C6-lib');
  const app = openAppDb({ userDataDir: freshDir('C6-app'), now: () => T0 });
  try {
    const libNames = lib.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    const appNames = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    for (const t of ['collection', 'collection_item']) {
      assert.equal(libNames.includes(t), true, '库级库里必须有 ' + t);
      assert.equal(appNames.includes(t), false, '应用级库里不该有 ' + t);
    }
  } finally {
    lib.db.close();
    app.db.close();
  }
});

test('C7 ⭐ 升级路径：v8-only 的库升到 v9 ⇒ 只跑缺的那条 · 老数据（含标签）在 · FK 升级后仍生效 · 幂等', () => {
  const old = freshDb('C7-v8', LIBRARY_MIGRATIONS.slice(0, 8));
  try {
    assert.equal(readSchemaVersion(old.db), 8);
    seedAsset(old.db, 'aa0000000001');
    old.db
      .prepare('INSERT INTO tag (tag_id, name, created_at_ms) VALUES (?,?,?)')
      .run('t1', '风景', T0);
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('collection'), false, '没升级就没有 collection（不静默提前建）');
  } finally {
    old.db.close();
  }
  const up = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(up.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      up.migration.applied.map((m) => m.version),
      LIBRARY_MIGRATIONS.map((m) => m.version).filter((v) => v > 8),
      '只跑缺的那条 v9',
    );
    assert.equal(count(up.db, 'tag'), 1, '升级不动老数据（v8 的标签还在）');
    seedCollection(up.db, 'c1', '提案');
    put(up.db, 'c1', 'aa0000000001', T0);
    assert.throws(
      () => put(up.db, 'c1', 'aa-dead', T0),
      /FOREIGN KEY|constraint/i,
      '升级后外键仍然生效',
    );
    up.db.close();
    const again = openGsDb({ dbPath: old.dbPath, now: () => T0 });
    try {
      assert.equal(again.migration.applied.length, 0, '再开不再跑迁移（幂等）');
      assert.equal(count(again.db, 'collection_item'), 1, '幂等重开数据在');
    } finally {
      again.db.close();
    }
  } finally {
    /* 已在上面关过 */
  }
});

test('C8 ⭐ 基线 §241 点名的 idx_collection_item_uid 真的建出来了（「这条被哪些集合收了」）', () => {
  const { db } = freshDb('C8');
  try {
    const idx = db
      .prepare("PRAGMA index_xinfo('idx_collection_item_uid')")
      .all()
      .filter((r) => r.key === 1);
    assert.deepEqual(
      idx.map((r) => [r.name, r.desc]),
      [['uid', 0]],
      '按 uid 建索引（详情页要显示它被哪些集合收了）',
    );
  } finally {
    db.close();
  }
});

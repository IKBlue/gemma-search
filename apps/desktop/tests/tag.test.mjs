// apps/desktop/tests/tag.test.mjs —— B2-7a：`tag` + `asset_tag`（意图层 · 多对多）
//
// 要证的七件事：
//   ① **列集 = 设计基线**（从 `SPEC-COMPACT.md` 解析 §206/§214 后与真 DDL 双向对照）；
//   ② `tag` 的约束：nanoid 主键 · `name` NOT NULL UNIQUE · `created_at_ms` NOT NULL；
//   ③ ⭐⭐ **多对多是机械证明的**：`asset_tag` 的 (`uid`, `tag_id`) 是**复合主键** ⇒
//      同一条素材**可挂 N 个标签**、同一个标签**可挂 N 条素材**，而同一对**不许重复**；
//   ④ ⭐⭐ **删除语义**：删标签/删素材 ⇒ 关联行**真的消失**（CASCADE），**不是** SET NULL
//      （复合主键两列都 NOT NULL，SET NULL 会把行写成非法值 —— 这里连"残留"都证明没有）；
//   ⑤ ⭐ **与 `asset_user_meta` 的 1:1 不同**（卡面要求对照）：那边一个 `uid` **最多一行**，这边**可以 N 行**；
//   ⑥ ⭐ **为什么不把 `is_favorite` 与标签合并**（P1）：`is_favorite` 只出现在 1:1 那张表的列里；
//   ⑦ 落点：**库级 .gs.db + 意图层**（`SPEC.md:172` 与设计基线 `README.md:33` 两处一致）· 走**库级链 v8** · 升级路径。
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
const TMP = path.join(ROOT, 'data', '_b27a', 'tag-' + process.pid);
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

/** 从设计基线解析某一节声明的字段 */
function baselineFields(header) {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => header.test(l));
  assert.ok(start >= 0, '设计基线里找不到 ' + String(header));
  const names = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const row = line.match(/^\|\s*`?(.+?)`?\s*\|/);
    if (!row) continue;
    for (const part of row[1].split('/')) {
      const name = part.replace(/`/g, '').trim();
      if (/^[a-z_][a-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

const seedAsset = (db, uid) =>
  db
    .prepare(
      'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/' + uid + '.jpg', T0);
const seedTag = (db, tagId, name) =>
  db.prepare('INSERT INTO tag (tag_id, name, created_at_ms) VALUES (?,?,?)').run(tagId, name, T0);
const link = (db, uid, tagId) =>
  db.prepare('INSERT INTO asset_tag (uid, tag_id, added_at_ms) VALUES (?,?,?)').run(uid, tagId, T0);
const count = (db, table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n;

// ============================================================ T1/T2 形状与约束

test('T1 ⭐⭐ 列集 = 设计基线（tag 3 字段 · asset_tag 3 字段）双向', () => {
  const tag = baselineFields(/^##\s+tag\b/);
  const assetTag = baselineFields(/^##\s+asset_tag\b/);
  assert.equal(tag.size, 3, '设计基线 §206 说 tag 是 3 个字段行，实得 ' + String(tag.size));
  assert.equal(
    assetTag.size,
    3,
    '设计基线 §214 说 asset_tag 是 3 个字段行，实得 ' + String(assetTag.size),
  );
  const { db } = freshDb('T1');
  try {
    for (const [table, want] of [
      ['tag', tag],
      ['asset_tag', assetTag],
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
  } finally {
    db.close();
  }
});

test('T2 tag 的约束：tag_id 主键 · name NOT NULL UNIQUE · created_at_ms NOT NULL', () => {
  const { db } = freshDb('T2');
  try {
    seedTag(db, 't1', '风景');
    assert.throws(() => seedTag(db, 't1', '另一个名字'), /UNIQUE|PRIMARY KEY/i, 'tag_id 是主键');
    assert.throws(
      () => seedTag(db, 't2', '风景'),
      /UNIQUE/i,
      'name 唯一（单用户 ⇒ 唯一约束只到 name）',
    );
    assert.throws(
      () => db.prepare('INSERT INTO tag (tag_id, name) VALUES (?,?)').run('t3', 'x'),
      /NOT NULL/i,
      'created_at_ms NOT NULL（"最近用的标签"排序要用它）',
    );
    assert.throws(
      () => db.prepare('INSERT INTO tag (tag_id, created_at_ms) VALUES (?,?)').run('t4', T0),
      /NOT NULL/i,
      'name NOT NULL',
    );
  } finally {
    db.close();
  }
});

// ============================================================ T3 ⭐⭐ 多对多（复合主键）

test('T3 ⭐⭐ 多对多：asset_tag 的 (uid, tag_id) 复合主键 —— 同条可 N 标签 / 同标签可 N 条 / 同一对不许重复', () => {
  const { db } = freshDb('T3');
  try {
    seedAsset(db, 'aa0000000001');
    seedAsset(db, 'aa0000000002');
    seedTag(db, 't1', '风景');
    seedTag(db, 't2', '人像');
    // 同一条素材挂两个标签
    link(db, 'aa0000000001', 't1');
    link(db, 'aa0000000001', 't2');
    // 同一个标签挂两条素材
    link(db, 'aa0000000002', 't1');
    assert.equal(count(db, 'asset_tag'), 3, '3 条关联都在');
    // 同一对**不许**重复（复合主键挡住 —— 这就是"天然防止同一标签重复贴在同一条上"）
    assert.throws(
      () => link(db, 'aa0000000001', 't1'),
      /UNIQUE|PRIMARY KEY/i,
      '(uid, tag_id) 是复合主键 ⇒ 同一对不能重复',
    );
    // 主键的两列顺序必须是 (uid, tag_id)（基线 §214 明写 1/2 与 2/2）
    const pks = db
      .prepare("PRAGMA table_info('asset_tag')")
      .all()
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    assert.deepEqual(pks, ['uid', 'tag_id'], '复合主键顺序 = (uid, tag_id)');
    // 两列都 NOT NULL：否则 (NULL, tag) 能插进来，而且能重复插（NULL 互不相等）
    const notNull = Object.fromEntries(
      db
        .prepare("PRAGMA table_info('asset_tag')")
        .all()
        .map((c) => [c.name, c.notnull]),
    );
    assert.deepEqual([notNull.uid, notNull.tag_id], [1, 1], '复合主键两列都 NOT NULL');
  } finally {
    db.close();
  }
});

// ============================================================ T4 ⭐⭐ 删除语义（CASCADE）

test('T4 ⭐⭐ 删除语义：删标签 / 删素材 ⇒ 关联行**真的消失**（CASCADE，不是 SET NULL）', () => {
  const { db } = freshDb('T4');
  try {
    // 前提：外键约束真的开着（否则 CASCADE 只是纸面声明）
    assert.equal(
      db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      1,
      'FK 约束默认开（适配层保证）',
    );
    seedAsset(db, 'aa0000000001');
    seedAsset(db, 'aa0000000002');
    seedTag(db, 't1', '风景');
    seedTag(db, 't2', '人像');
    link(db, 'aa0000000001', 't1');
    link(db, 'aa0000000001', 't2');
    link(db, 'aa0000000002', 't1');
    // ① 删**标签** ⇒ 它的关联跟着走
    db.prepare('DELETE FROM tag WHERE tag_id = ?').run('t1');
    assert.equal(count(db, 'asset_tag'), 1, '删 t1 ⇒ 只剩 t2 那条关联（2 条被带走）');
    // ⚠️ 不是 SET NULL：不能留下 (uid, NULL) 或 (NULL, tag) 这种"悬空关联"
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_tag WHERE uid IS NULL OR tag_id IS NULL').get().n,
      0,
      'CASCADE 而不是 SET NULL（没有 NULL 残留）',
    );
    // ② 删**素材** ⇒ 同样
    db.prepare('DELETE FROM asset WHERE uid = ?').run('aa0000000001');
    assert.equal(count(db, 'asset_tag'), 0, '删素材 ⇒ 剩余关联也走了');
    // ③ 反证：外键真的会拒非法引用（不是"随便写都行"）
    assert.throws(
      () => link(db, 'aa0000000002', 't-dead'),
      /FOREIGN KEY|constraint/i,
      'tag_id 必须指向存在的标签',
    );
    assert.throws(
      () => link(db, 'aa-dead', 't2'),
      /FOREIGN KEY|constraint/i,
      'uid 必须指向存在的素材',
    );
  } finally {
    db.close();
  }
});

// ============================================================ T5/T7 与 1:1 的边界

test('T5 ⭐ 与 asset_user_meta 的 **1:1** 对照：那边一个 uid 最多一行，这边可以 N 行', () => {
  const { db } = freshDb('T5');
  try {
    seedAsset(db, 'aa0000000001');
    seedTag(db, 't1', '风景');
    seedTag(db, 't2', '人像');
    // 1:1 那张：uid 就是主键 ⇒ 第二条被拒
    const meta = (rating) =>
      db
        .prepare('INSERT INTO asset_user_meta (uid, rating, updated_at_ms) VALUES (?,?,?)')
        .run('aa0000000001', rating, T0);
    meta(3);
    assert.throws(() => meta(5), /UNIQUE|PRIMARY KEY/i, 'asset_user_meta 是 1:1（uid 主键）');
    // N:M 这张：同一个 uid 可以 N 行
    link(db, 'aa0000000001', 't1');
    link(db, 'aa0000000001', 't2');
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_tag WHERE uid = ?').get('aa0000000001').n,
      2,
      'asset_tag 同一个 uid 可以 N 行（多对多）',
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM asset_user_meta').get().n, 1, '1:1 那边恒为 1');
  } finally {
    db.close();
  }
});

test('T7 ⭐ 为什么**不**把 is_favorite 与标签合并（P1）：它只是 1:1 那张表的一个列，不在 tag 里', () => {
  const { db } = freshDb('T7');
  try {
    const metaCols = db
      .prepare("PRAGMA table_info('asset_user_meta')")
      .all()
      .map((c) => c.name);
    const tagCols = db
      .prepare("PRAGMA table_info('tag')")
      .all()
      .map((c) => c.name);
    assert.ok(
      metaCols.includes('is_favorite'),
      'is_favorite 是 asset_user_meta 的列（收藏 = 单条上的一个布尔）',
    );
    assert.equal(
      tagCols.includes('is_favorite'),
      false,
      '标签表里**没有**收藏概念（合并 = 一个概念两份真相 · P1）',
    );
    // 且 tag 的列集只有基线那三个（上面 T1 已双向证明）；这里再钉"没有第二套标记列"
    assert.deepEqual(
      tagCols.filter((c) => /favorite|star|like|mark/i.test(c)),
      [],
      '标签表里不许有"标记/收藏"类列',
    );
  } finally {
    db.close();
  }
});

// ============================================================ T6/T8 落点与迁移

test('T6 ⭐⭐ 落点：库级 .gs.db + **意图层** · 走库级链 v8 · app 库里没有', () => {
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标 = 清单上限（派生）');
  assert.equal(LIBRARY_MIGRATIONS[7].name, 'batch2-tags', '标签是库级 v8（钉自己那一格）');
  for (const t of ['tag', 'asset_tag']) {
    assert.ok(LIBRARY_TABLES.includes(t), 'LIBRARY_TABLES 必须含 ' + t);
    assert.ok(EXPECTED_TABLES.includes(t), '应有清单必须含 ' + t);
    assert.ok(libraryLayerTables().includes(t), t + ' 落在库级 .gs.db');
    assert.equal(appLayerTables().includes(t), false, t + ' 不许落在 app.db');
    assert.ok(tablesInLayer('intent').includes(t), t + ' 属**意图层**（用户自己做的组织，必须留）');
  }
  const lib = freshDb('T6-lib');
  const app = openAppDb({ userDataDir: freshDir('T6-app'), now: () => T0 });
  try {
    const libNames = lib.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    const appNames = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    for (const t of ['tag', 'asset_tag']) {
      assert.equal(libNames.includes(t), true, '库级库里必须有 ' + t);
      assert.equal(appNames.includes(t), false, '应用级库里不该有 ' + t);
    }
  } finally {
    lib.db.close();
    app.db.close();
  }
});

test('T8 ⭐ 升级路径：v7-only 的库升到 v8 ⇒ 只跑缺的那条 · 老数据在 · FK 升级后仍生效 · 幂等', () => {
  const old = freshDb('T8-v7', LIBRARY_MIGRATIONS.slice(0, 7));
  try {
    assert.equal(readSchemaVersion(old.db), 7);
    seedAsset(old.db, 'aa0000000001');
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('tag'), false, '没升级就没有 tag（不静默提前建）');
  } finally {
    old.db.close();
  }
  const up = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(up.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      up.migration.applied.map((m) => m.version),
      LIBRARY_MIGRATIONS.map((m) => m.version).filter((v) => v > 7),
      '只跑缺的那条 v8',
    );
    assert.equal(count(up.db, 'asset'), 1, '升级不动老数据');
    seedTag(up.db, 't1', '风景');
    link(up.db, 'aa0000000001', 't1');
    assert.throws(
      () => link(up.db, 'aa-dead', 't1'),
      /FOREIGN KEY|constraint/i,
      '升级之后外键仍然生效（CASCADE 也是）',
    );
    up.db.close();
    const again = openGsDb({ dbPath: old.dbPath, now: () => T0 });
    try {
      assert.equal(again.migration.applied.length, 0, '再开不再跑迁移（幂等）');
      assert.equal(count(again.db, 'tag'), 1, '幂等重开数据在');
    } finally {
      again.db.close();
    }
  } finally {
    /* 已在上面关过 */
  }
});

// apps/desktop/tests/asset-user-meta.test.mjs —— B2-3：`asset_user_meta` 条目标注（评分 / 备注 / 收藏）
//
// 要证的五件事：
//   ① **字段照抄设计基线**（机械证明）：从 `SPEC-COMPACT.md` 对应小节**解析**字段集与真 DDL **双向对照**；
//   ② **1:1 + CASCADE**：一条素材最多一行（uid 就是主键）；素材被删 ⇒ 标注跟着走；
//   ③ `rating` 用 **NULL 表示未评分**（0 不许出现——"评了零分"语义上不存在）；
//   ④ 收藏是**一列布尔**（NOT NULL DEFAULT 0 + CHECK 0/1）+ **偏索引** `WHERE is_favorite = 1`；
//   ⑤ **层级 = 意图层**（改了就要用户丢标注）· v5 新迁移 · 旧库升级不回归。
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
import {
  appLayerTables,
  libraryLayerTables,
  schemaTables,
  tablesInLayer,
} from '../src/main/db/schema-layers.ts';
import { createJob } from '../src/main/db/jobs.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b23', 'asset-user-meta-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDb(label, migrations) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
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

const columnsOf = (db, table) =>
  db
    .prepare("PRAGMA table_info('" + table + "')")
    .all()
    .map((c) => c.name);

/** 从设计基线解析 asset_user_meta 那一节声明的字段（测试不另写一份清单） */
function baselineFields() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+asset_user_meta\b/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 asset_user_meta 那一节：' + DOC);
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

function seedAsset(db, uid) {
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
  ).run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/' + uid + '.jpg', T0);
}
const insMeta = (db, row) =>
  db
    .prepare(
      'INSERT INTO asset_user_meta (uid, rating, note, updated_at_ms, is_favorite) VALUES (?,?,?,?,?)',
    )
    .run(
      row.uid,
      row.rating ?? null,
      row.note ?? null,
      row.updated_at_ms ?? T0,
      row.is_favorite ?? 0,
    );

// ============================================================ M1 字段 = 设计基线

test('M1 ⭐⭐ 列集 = 设计基线（5 个字段行）+ 收藏的**偏索引**', () => {
  const fields = baselineFields();
  assert.ok(fields.size >= 5, '解析出的字段太少（解析规则坏了？）：' + String(fields.size));
  const { db } = freshDb('M1');
  try {
    const cols = columnsOf(db, 'asset_user_meta');
    assert.deepEqual(
      [...cols].sort(),
      [...fields].sort(),
      'DDL 列与设计基线字段逐字对上（多一个/少一个都红）',
    );
    assert.deepEqual(
      cols.filter((c) => !fields.has(c)),
      [],
      '有设计基线没写的列（自造字段？）',
    );
    // 基线的约束列里点名要"偏索引 WHERE is_favorite = 1"（名字由本仓定）⇒ 断言它真的是**偏**索引
    const idx = db
      .prepare("PRAGMA index_list('asset_user_meta')")
      .all()
      .filter((r) => String(r.name).startsWith('idx_'));
    assert.deepEqual(
      idx.map((r) => [r.name, r.partial]),
      [['idx_meta_favorite', 1]],
      '收藏要有一条**偏索引**（只索引 is_favorite = 1 的那一小撮）',
    );
    assert.deepEqual(
      db
        .prepare("PRAGMA index_info('idx_meta_favorite')")
        .all()
        .map((r) => r.name),
      ['is_favorite'],
    );
  } finally {
    db.close();
  }
});

// ============================================================ M2 ⭐⭐ 1:1 + CASCADE

test('M2 ⭐⭐ 1:1（uid 就是主键，插不进第二行）且素材被删时标注跟着走（CASCADE）', () => {
  const { db } = freshDb('M2');
  try {
    const fks = db.prepare('PRAGMA foreign_key_list(asset_user_meta)').all();
    assert.deepEqual(
      fks.map((f) => [f.table, f.from, f.on_delete]),
      [['asset', 'uid', 'CASCADE']],
      'uid 必须是 FK asset(uid) ON DELETE CASCADE',
    );
    seedAsset(db, 'aa0000000001');
    insMeta(db, { uid: 'aa0000000001', rating: 4 });
    assert.throws(
      () => insMeta(db, { uid: 'aa0000000001', rating: 5 }),
      /UNIQUE|PRIMARY KEY/i,
      '1:1 —— 同一素材只能有一行标注',
    );
    // 没有行 = 还没被标注过（合法状态）：插入前 count = 0 这件事本身就说明它不是"缺失"
    db.prepare('DELETE FROM asset WHERE uid = ?').run('aa0000000001');
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_user_meta').get().n,
      0,
      '素材没了 ⇒ 标注跟着删（没有素材的标注没有意义）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ M3 ⭐ rating 用 NULL 表示未评分

test('M3 ⭐ rating：NULL = 未评分（合法）；1..5 可以；0 与 6 被 CHECK 拒绝', () => {
  const { db } = freshDb('M3');
  try {
    for (let i = 0; i < 6; i++) seedAsset(db, 'aa000000000' + String(i));
    insMeta(db, { uid: 'aa0000000001' }); // rating 省略 ⇒ NULL
    assert.equal(
      db.prepare('SELECT rating FROM asset_user_meta WHERE uid = ?').get('aa0000000001').rating,
      null,
    );
    insMeta(db, { uid: 'aa0000000002', rating: 1 });
    insMeta(db, { uid: 'aa0000000003', rating: 5 });
    assert.throws(
      () => insMeta(db, { uid: 'aa0000000004', rating: 0 }),
      /CHECK/i,
      '0 不许出现 —— "评了零分"语义上不存在（NULL 才是"未评分"）',
    );
    assert.throws(
      () => insMeta(db, { uid: 'aa0000000005', rating: 6 }),
      /CHECK/i,
      '范围 1..5 写在 CHECK 里',
    );
    // CHECK 不会因为 NULL 而拒绝（SQL 语义：NULL 的比较结果是 UNKNOWN ⇒ 通过）
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_user_meta WHERE rating IS NULL').get().n,
      1,
    );
  } finally {
    db.close();
  }
});

// ============================================================ M4 is_favorite

test('M4 is_favorite 是**一列布尔**：NOT NULL DEFAULT 0 · 只认 0/1', () => {
  const { db } = freshDb('M4');
  try {
    seedAsset(db, 'aa0000000001');
    seedAsset(db, 'aa0000000002');
    seedAsset(db, 'aa0000000003');
    insMeta(db, { uid: 'aa0000000001' }); // 省略 ⇒ DEFAULT 0
    assert.equal(
      db.prepare('SELECT is_favorite FROM asset_user_meta WHERE uid = ?').get('aa0000000001')
        .is_favorite,
      0,
    );
    insMeta(db, { uid: 'aa0000000002', is_favorite: 1 });
    assert.throws(() => insMeta(db, { uid: 'aa0000000003', is_favorite: 2 }), /CHECK/i, '只认 0/1');
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO asset_user_meta (uid, updated_at_ms, is_favorite) VALUES (?,?,?)')
          .run('aa0000000004', T0, null),
      /NOT NULL/i,
      'is_favorite 是 NOT NULL（没标注过的素材**没有行**，而不是 is_favorite 为 NULL）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ M5 备注与时刻

test('M5 note 可空且**不设长度上限**；updated_at_ms 必填', () => {
  const { db } = freshDb('M5');
  try {
    seedAsset(db, 'aa0000000001');
    insMeta(db, { uid: 'aa0000000001' });
    assert.equal(
      db.prepare('SELECT note FROM asset_user_meta WHERE uid = ?').get('aa0000000001').note,
      null,
    );
    const long = '备'.repeat(100000); // 10 万字符：不设上限 = 存储层不截断
    db.prepare('UPDATE asset_user_meta SET note = ? WHERE uid = ?').run(long, 'aa0000000001');
    assert.equal(
      db.prepare('SELECT LENGTH(note) n FROM asset_user_meta WHERE uid = ?').get('aa0000000001').n,
      100000,
    );
    seedAsset(db, 'aa0000000002');
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO asset_user_meta (uid, is_favorite) VALUES (?,?)')
          .run('aa0000000002', 0),
      /NOT NULL/i,
      'updated_at_ms 必须写（NOT NULL）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ M6 边界

test('M6 ⭐ 边界：`asset_user_meta` 是**标注**（1 行），`asset_export` 是**历史**（N 行）；不复制 job 字段', () => {
  const { db } = freshDb('M6');
  try {
    seedAsset(db, 'aa0000000001');
    insMeta(db, { uid: 'aa0000000001', rating: 3, is_favorite: 1 });
    // 同一条素材可以有很多条导出历史（两条不同的批量）
    db.prepare(
      'INSERT INTO asset_export (export_id, kind, uid, asset_name, batch_id, target_dir, result, at_ms) VALUES (?,?,?,?,?,?,?,?)',
    ).run('x1', 'collect', 'aa0000000001', 'A.jpg', 'b1', 'D:/out', 'copied', T0);
    db.prepare(
      'INSERT INTO asset_export (export_id, kind, uid, asset_name, batch_id, target_dir, result, at_ms) VALUES (?,?,?,?,?,?,?,?)',
    ).run('x2', 'collect', 'aa0000000001', 'A.jpg', 'b2', 'D:/out', 'skipped', T0);
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_user_meta WHERE uid = ?').get('aa0000000001').n,
      1,
      '标注 1:1',
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM asset_export WHERE uid = ?').get('aa0000000001').n,
      2,
      '导出历史 N 行',
    );
    const JOB_ONLY = ['progress_done', 'progress_total', 'phase', 'cursor_json', 'heartbeat_at_ms'];
    const jobCols = columnsOf(db, 'job');
    for (const c of JOB_ONLY) assert.ok(jobCols.includes(c), 'job 里应有 ' + c);
    assert.deepEqual(
      columnsOf(db, 'asset_user_meta').filter((c) => JOB_ONLY.includes(c)),
      [],
      '本表不复制 job 的进度字段',
    );
    createJob(db, { kind: 'ingest', now: () => T0, jobId: 'j1' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job').get().n, 1);
  } finally {
    db.close();
  }
});

// ============================================================ M7 迁移 / 分层（派生）

test('M7 ⭐⭐ 迁移与分层：v5 新迁移 · 版本派生 · **意图层**（必须留）· 旧库升级不回归', () => {
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标版本 = 清单上限（派生）');
  // 钉**自己那一格**（不写"最后一条是我"：下一批加表就会被自动打红）
  assert.equal(
    LIBRARY_MIGRATIONS[4].name,
    'batch2-asset-user-meta',
    '条目标注是 v5（不许被改名/挪位）',
  );
  assert.ok(LIBRARY_TABLES.includes('asset_user_meta'));
  assert.deepEqual(
    [...EXPECTED_TABLES],
    [...LIBRARY_TABLES, 'schema_version'].sort(),
    '应有表 = 业务表 + 账本',
  );
  // 层归属：**意图层**（基线四层分类表 README.md:33；丢了没法重算 ⇒ 必须留）。完整成员由 db-schema G1 钉。
  assert.ok(tablesInLayer('intent').includes('asset_user_meta'), 'asset_user_meta 属意图层');
  assert.ok(schemaTables().includes('asset_user_meta'), '四组点名必须含它');
  assert.ok(libraryLayerTables().includes('asset_user_meta'), '落在库级 .gs.db');
  assert.equal(appLayerTables().includes('asset_user_meta'), false, '不许落在 app.db');
  // 旧库升级：只跑到 v4 的库 ⇒ 没有这张表；再打开 ⇒ 只跑缺的那些，且老数据还在
  const old = freshDb('M7-v4', LIBRARY_MIGRATIONS.slice(0, 4));
  try {
    assert.equal(readSchemaVersion(old.db), 4);
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('asset_user_meta'), false, '没升级就没有这张表（不静默提前建）');
    createJob(old.db, { kind: 'ingest', now: () => T0, jobId: 'j-old' });
  } finally {
    old.db.close();
  }
  const upgraded = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(upgraded.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      upgraded.migration.applied.map((m) => m.version),
      versions.filter((v) => v > 4),
      '只跑缺的那些迁移',
    );
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM job').get().n, 1, '升级不动老数据');
    assert.equal(
      upgraded.db.prepare('SELECT COUNT(*) n FROM asset_user_meta').get().n,
      0,
      '新表是空的',
    );
    upgraded.db.close();
    const again = openGsDb({ dbPath: old.dbPath, now: () => T0 });
    assert.equal(again.migration.applied.length, 0, '幂等：再开不再跑迁移');
    again.db.close();
  } finally {
    /* 已在上面关过 */
  }
});

// apps/desktop/tests/asset-export.test.mjs —— B2-2：`asset_export` 交付/取件**留痕**
//
// 要证的四件事：
//   ① **字段照抄设计基线**（不是自己发明的）：从 `SPEC-COMPACT.md` 的对应小节**解析**出字段集，
//      与真 DDL 的列集**双向对照**（少一个 / 多一个都红）；
//   ② **语义关键的那条外键**：`uid` 是 **ON DELETE SET NULL**（不是 CASCADE）—— 条目被删之后
//      「我导出过它」**仍然成立**，而且 `asset_name` 快照还在（历史表的意义）；
//   ③ **`batch_id` 不许建外键**（`activity` 在应用级 app.db，跨库没有外键）—— 而且它确实能写任意值；
//   ④ **边界**：一次批量 = `asset_export` **N 行**（每条素材一行），**不复制** `job` 的任何进度字段。
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
const TMP = path.join(ROOT, 'data', '_b22x', 'asset-export-' + process.pid);
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

/** 从设计基线解析"asset_export 这一节声明了哪些字段 / 指定了哪些索引"（测试不另写一份清单） */
function baseline() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+asset_export\b/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 asset_export 那一节：' + DOC);
  const fields = new Set();
  const indexes = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const row = line.match(/^\|\s*`?(.+?)`?\s*\|/);
    if (row) {
      for (const part of row[1].split('/')) {
        const name = part.replace(/`/g, '').trim();
        if (/^[a-z_][a-z0-9_]*$/.test(name)) fields.add(name);
      }
      continue;
    }
    const bullet = line.match(/^-\s+(idx_[a-z0-9_]+)/);
    if (bullet) indexes.add(bullet[1]);
  }
  return { fields, indexes };
}

function seedAsset(db, uid, relPath = 'CR/A.jpg') {
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
  ).run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', relPath, T0);
}

function insExport(db, row) {
  db.prepare(
    'INSERT INTO asset_export (export_id, kind, uid, asset_name, batch_id, target_dir, result, reason, at_ms) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    row.export_id,
    row.kind,
    row.uid ?? null,
    row.asset_name,
    row.batch_id ?? null,
    row.target_dir,
    row.result ?? null,
    row.reason ?? null,
    row.at_ms ?? T0,
  );
}

// ============================================================ E1 字段 = 设计基线（双向）

test('E1 ⭐⭐ 列集 = 设计基线：`asset_export` 的列必须与文档小节里的字段逐字相等', () => {
  const { fields, indexes } = baseline();
  assert.ok(fields.size >= 9, '解析出的字段太少（解析规则坏了？）：' + String(fields.size));
  const { db } = freshDb('E1');
  try {
    const cols = columnsOf(db, 'asset_export');
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
    // 基线「附加」段指定的索引必须真的建出来（名字 + 列序）
    assert.ok(indexes.has('idx_export_uid'), '基线附加段应指定 idx_export_uid');
    const have = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'asset_export' AND name LIKE 'idx_%'",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(have, ['idx_export_uid']);
    assert.deepEqual(
      db
        .prepare("PRAGMA index_info('idx_export_uid')")
        .all()
        .map((r) => r.name),
      ['uid', 'at_ms'],
      '索引列序 (uid, at_ms) —— 详情页"这条被导出过几次、最近一次何时"就是按它查',
    );
  } finally {
    db.close();
  }
});

// ============================================================ E2 ⭐⭐ SET NULL 的语义

test('E2 ⭐⭐ 删掉素材之后：导出历史**仍然成立**（uid 置空、名字快照还在）', () => {
  const { db } = freshDb('E2');
  try {
    const fks = db.prepare('PRAGMA foreign_key_list(asset_export)').all();
    assert.deepEqual(
      fks.map((f) => [f.table, f.from, f.on_delete]),
      [['asset', 'uid', 'SET NULL']],
      'uid 必须是 FK asset(uid) **ON DELETE SET NULL**（不是 CASCADE）',
    );
    seedAsset(db, 'aa0000000001', 'CR/A.jpg');
    insExport(db, {
      export_id: 'x1',
      kind: 'collect',
      uid: 'aa0000000001',
      asset_name: 'A.jpg',
      target_dir: 'D:/out',
    });
    db.prepare('DELETE FROM asset WHERE uid = ?').run('aa0000000001');
    const row = db
      .prepare('SELECT uid, asset_name FROM asset_export WHERE export_id = ?')
      .get('x1');
    assert.notEqual(row, undefined, '"我导出过它"这件事必须仍然成立（行不许被级联删掉）');
    assert.equal(row.uid, null, '条目没了 ⇒ uid 置空');
    assert.equal(row.asset_name, 'A.jpg', '名字快照必须留着（否则历史里只剩一个空 uid）');
  } finally {
    db.close();
  }
});

test('E3 ⭐ batch_id **不建外键**（activity 在应用级 app.db，跨库没有外键），且能写任意值', () => {
  const { db } = freshDb('E3');
  try {
    const tables = db
      .prepare('PRAGMA foreign_key_list(asset_export)')
      .all()
      .map((f) => f.table);
    assert.deepEqual(
      tables,
      ['asset'],
      '只能有一条外键（指向 asset）；指向 activity 的外键在跨库下不可实现',
    );
    // 任意 batch_id 都能写进去（不会被外键拒绝）——"把 N 行归成一条历史"因此成立
    insExport(db, {
      export_id: 'b1',
      kind: 'deliver',
      asset_name: 'A.jpg',
      batch_id: 'batch-任意',
      target_dir: 'D:/out',
    });
    assert.equal(
      db.prepare('SELECT batch_id FROM asset_export WHERE export_id = ?').get('b1').batch_id,
      'batch-任意',
    );
  } finally {
    db.close();
  }
});

// ============================================================ E4/E5 约束

test('E4 CHECK 枚举：kind 只认 collect/deliver；result 只认 copied/skipped/failed', () => {
  const { db } = freshDb('E4');
  try {
    insExport(db, {
      export_id: 'k1',
      kind: 'collect',
      asset_name: 'A.jpg',
      target_dir: 'D:/out',
      result: 'copied',
    });
    insExport(db, {
      export_id: 'k2',
      kind: 'deliver',
      asset_name: 'A.jpg',
      target_dir: 'D:/out',
      result: 'skipped',
    });
    assert.throws(
      () =>
        insExport(db, { export_id: 'k3', kind: '导出', asset_name: 'A.jpg', target_dir: 'D:/out' }),
      /CHECK/i,
      'kind 只认 collect/deliver（取件与交付共用一张表，所以只有这两个值）',
    );
    assert.throws(
      () =>
        insExport(db, {
          export_id: 'k4',
          kind: 'collect',
          asset_name: 'A.jpg',
          target_dir: 'D:/out',
          result: 'ok',
        }),
      /CHECK/i,
      'result 只认 F6 承诺的三分类 copied/skipped/failed',
    );
    // result 可空（基线没给 NOT NULL）：一条"还没走完"的导出记录允许存在
    insExport(db, { export_id: 'k5', kind: 'collect', asset_name: 'A.jpg', target_dir: 'D:/out' });
    assert.equal(
      db.prepare('SELECT result FROM asset_export WHERE export_id = ?').get('k5').result,
      null,
    );
  } finally {
    db.close();
  }
});

test('E5 NOT NULL 与可空：快照名/目标目录/时刻必填；uid/batch_id/reason 可空', () => {
  const { db } = freshDb('E5');
  try {
    const NOT_NULL = ['asset_name', 'target_dir', 'at_ms'];
    for (const col of NOT_NULL) {
      const cols = ['export_id', 'kind', 'asset_name', 'target_dir', 'at_ms'];
      const vals = ['n-' + col, 'collect', 'A.jpg', 'D:/out', T0];
      vals[cols.indexOf(col)] = null;
      assert.throws(
        () =>
          db
            .prepare(
              'INSERT INTO asset_export (' +
                cols.join(',') +
                ') VALUES (' +
                cols.map(() => '?').join(',') +
                ')',
            )
            .run(...vals),
        /NOT NULL/i,
        col + ' 必须 NOT NULL',
      );
    }
    insExport(db, { export_id: 'ok', kind: 'collect', asset_name: 'A.jpg', target_dir: 'D:/out' });
    const row = db
      .prepare('SELECT uid, batch_id, reason FROM asset_export WHERE export_id = ?')
      .get('ok');
    assert.deepEqual(
      [row.uid, row.batch_id, row.reason],
      [null, null, null],
      '这三个可空（不知道就是 null）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ E6 边界：一次批量 = N 行

test('E6 ⭐ 边界：**一次批量 = export N 行**，且不复制 job 的任何字段（P1）', () => {
  const { db } = freshDb('E6');
  try {
    // 一次批量交付 3 条 ⇒ asset_export 写 3 行、同一个 batch_id
    for (let i = 1; i <= 3; i++) {
      seedAsset(db, 'aa000000000' + String(i), 'CR/' + String(i) + '.jpg');
      insExport(db, {
        export_id: 'e' + String(i),
        kind: 'deliver',
        uid: 'aa000000000' + String(i),
        asset_name: String(i) + '.jpg',
        batch_id: 'batch-A',
        target_dir: 'D:/out',
        result: i === 3 ? 'failed' : 'copied',
        reason: i === 3 ? '目标目录不可写' : null,
      });
    }
    insExport(db, {
      export_id: 'e4',
      kind: 'collect',
      asset_name: 'Z.jpg',
      batch_id: 'batch-B',
      target_dir: 'D:/out2',
      result: 'copied',
    });
    const grouped = db
      .prepare('SELECT batch_id, COUNT(*) n FROM asset_export GROUP BY batch_id ORDER BY batch_id')
      .all();
    assert.deepEqual(
      grouped.map((r) => [r.batch_id, r.n]),
      [
        ['batch-A', 3],
        ['batch-B', 1],
      ],
      '一次批量 = 该批量里**每条素材一行**（不是任务一行）',
    );
    // 三分类都出现过（F6 的承诺在表上成立）
    const results = db
      .prepare('SELECT DISTINCT result FROM asset_export ORDER BY result')
      .all()
      .map((r) => r.result);
    assert.deepEqual(results, ['copied', 'failed']);
    // 与 job 的边界：本表**没有** job 的进度/心跳字段
    const jobCols = columnsOf(db, 'job');
    const JOB_ONLY = ['progress_done', 'progress_total', 'phase', 'cursor_json', 'heartbeat_at_ms'];
    for (const c of JOB_ONLY) assert.ok(jobCols.includes(c), 'job 里应有 ' + c);
    assert.deepEqual(
      columnsOf(db, 'asset_export').filter((c) => JOB_ONLY.includes(c)),
      [],
      'asset_export 不许复制 job 的进度字段',
    );
    // 反向：job 只管任务，不会为每条素材写行（一次批量 = job 一行）
    createJob(db, { kind: 'ingest', now: () => T0, jobId: 'j1' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM job').get().n, 1, '一次批量在 job 里只有一行');
  } finally {
    db.close();
  }
});

// ============================================================ E7 迁移 / 分层（派生）

test('E7 ⭐⭐ 迁移与分层：v4 新迁移 · 版本派生 · **意图层**（必须留）· 旧库升级不回归', () => {
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标版本 = 清单上限（派生）');
  assert.equal(
    // ⚠️ B2-3（asset_user_meta）之后不能再断言"最后一条是我" ⇒ 改钉**自己那一格**：v4 永远是导出留痕。
    //    （这条比原来那条更强：原来只证明"它是最后一条"，现在"被改名/挪位"也会红。）
    LIBRARY_MIGRATIONS[3].name,
    'batch2-asset-export',
    '导出留痕仍是 v4',
  );
  assert.ok(LIBRARY_TABLES.includes('asset_export'));
  assert.deepEqual(
    [...EXPECTED_TABLES],
    [...LIBRARY_TABLES, 'schema_version'].sort(),
    '应有表 = 业务表 + 账本',
  );
  // 层归属：**意图层**（设计基线 README 的四层分类表把 asset_export 列在"意图层（必须留）"）
  // 意图层的**完整成员**由 db-schema 的 G1 逐张钉；这里只钉"我在意图层"（否则每加一张意图表都要改这里）
  assert.ok(tablesInLayer('intent').includes('asset_export'), 'asset_export 属意图层');
  assert.ok(schemaTables().includes('asset_export'), '四组点名必须含它');
  assert.ok(libraryLayerTables().includes('asset_export'), '落在库级 .gs.db');
  assert.equal(appLayerTables().includes('asset_export'), false, '不许落在 app.db');
  // 旧库升级：只跑到 v3 的库 ⇒ 没有这张表；再打开 ⇒ 只跑 v4，且老数据还在
  const old = freshDb('E7-v3', LIBRARY_MIGRATIONS.slice(0, 3));
  try {
    assert.equal(readSchemaVersion(old.db), 3);
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('asset_export'), false, '没升级就没有这张表（不静默提前建）');
    createJob(old.db, { kind: 'ingest', now: () => T0, jobId: 'j-old' });
  } finally {
    old.db.close();
  }
  const upgraded = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(upgraded.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      upgraded.migration.applied.map((m) => m.version),
      versions.filter((v) => v > 3),
      '只跑缺的那些迁移',
    );
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM job').get().n, 1, '升级不动老数据');
    assert.equal(
      upgraded.db.prepare('SELECT COUNT(*) n FROM asset_export').get().n,
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

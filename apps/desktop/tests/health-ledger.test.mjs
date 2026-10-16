// apps/desktop/tests/health-ledger.test.mjs —— B2-2：`health_run` / `health_finding` 体检台账
//
// 三条要证的事：
//   ① **字段照抄设计基线**（不是自己发明的）：从 `SPEC-COMPACT.md` 的对应小节**解析**出字段集，
//      与真 DDL 的列集**双向对照**（少一个 / 多一个都红）；
//   ② **不是 `job` 的第二份实现**（P1）：`health_run` 通过 `job_id` **外键**关联，列集里
//      **不许**出现进度/断点/心跳那些字段（它们永远只有 `job` 一处）；且那条外键**真的在拦**（插假 job_id 被拒）；
//   ③ **迁移/分层**：v3 新迁移（不改 v1/v2）· 版本从清单派生 · 两张表进**过程层** · 旧库升级路径不回归。
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
import { createJob } from '../src/main/db/jobs.ts';
import { libraryLayerTables, schemaTables, tablesInLayer } from '../src/main/db/schema-layers.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b22', 'health-ledger-' + process.pid);
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

/** 从设计基线里解析"这一节声明了哪些字段"（**字段名以文档为准**，测试不另写一份清单） */
function baselineFields() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+health_run\s*\/\s*health_finding/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 health_run / health_finding 那一节：' + DOC);
  const names = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // 下一节
    const row = line.match(/^\|\s*(.+?)\s*\|/);
    if (row) {
      for (const part of row[1].split('/')) {
        const name = part.replace(/`/g, '').trim();
        if (/^[a-z_][a-z0-9_]*$/.test(name)) names.add(name);
      }
      continue;
    }
    const bullet = line.match(/^-\s+([a-z_][a-z0-9_]*)\s*——/);
    if (bullet) names.add(bullet[1]);
  }
  return names;
}

// ============================================================ H1 字段 = 设计基线（双向）

test('H1 ⭐⭐ 列集 = 设计基线：两张表的列**并集**必须与文档小节里的字段集逐字相等', () => {
  const doc = baselineFields();
  assert.ok(doc.size >= 14, '解析出的字段太少（解析规则坏了？）：' + String(doc.size));
  const { db } = freshDb('H1');
  try {
    const run = new Set(columnsOf(db, 'health_run'));
    const finding = new Set(columnsOf(db, 'health_finding'));
    const ddl = new Set([...run, ...finding]);
    assert.deepEqual(
      [...ddl].sort(),
      [...doc].sort(),
      'DDL 的列与设计基线的字段必须逐字对上（多一个/少一个都红）',
    );
    // 逐表：不许出现文档里没有的列（自造字段）
    for (const [table, cols] of [
      ['health_run', run],
      ['health_finding', finding],
    ]) {
      assert.deepEqual(
        [...cols].filter((c) => !doc.has(c)),
        [],
        table + ' 里有设计基线没写的列（自造字段？）',
      );
    }
    assert.ok(run.size >= 5 && finding.size >= 8, '两张表各自的列数看起来不对');
  } finally {
    db.close();
  }
});

// ============================================================ H2 ⭐ 不是 job 的第二份实现

test('H2 ⭐⭐ health_run **不复制** job 的进度字段：通过 job_id 外键关联（P1）', () => {
  const JOB_ONLY = [
    'progress_done',
    'progress_total',
    'phase',
    'cursor_json',
    'heartbeat_at_ms',
    'kind',
    'queued_at_ms',
  ];
  const { db } = freshDb('H2');
  try {
    const run = columnsOf(db, 'health_run');
    const job = columnsOf(db, 'job');
    // 先证明"有牙"：这些字段确实存在于 job 里（否则下一条断言等于断言"没这个词"）
    for (const c of JOB_ONLY) assert.ok(job.includes(c), 'job 列里应有 ' + c);
    assert.deepEqual(
      run.filter((c) => JOB_ONLY.includes(c)),
      [],
      'health_run 不许复制 job 的进度/断点/心跳字段',
    );
    assert.ok(run.includes('job_id'), 'health_run 必须有 job_id（进度与取消复用同一套任务机制）');
    // 设计基线给 health_run 的字段就这几个（状态 + 起止 + 汇总 + 关联）
    assert.deepEqual(run.sort(), [
      'finished_at_ms',
      'job_id',
      'run_id',
      'started_at_ms',
      'state',
      'summary_json',
    ]);
  } finally {
    db.close();
  }
});

test('H3 ⭐⭐ job_id 外键**真的在拦**：插一个不存在的 job_id 被拒，插真实的通过', () => {
  const { db } = freshDb('H3');
  try {
    const fks = db.prepare('PRAGMA foreign_key_list(health_run)').all();
    assert.deepEqual(
      fks.map((f) => [f.table, f.from, f.to]),
      [['job', 'job_id', 'job_id']],
      'health_run.job_id 必须声明为指向 job(job_id) 的外键',
    );
    // 外键**启用**在本仓是默认的（sqlite-adapter：enableForeignKeyConstraints 默认 true）
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO health_run (run_id, job_id, state) VALUES (?, ?, ?)')
          .run('r-bad', 'j-不存在', 'running'),
      /FOREIGN KEY/i,
      '插一个不存在的 job_id 必须被拒（"关联"不是只在文档里）',
    );
    // 真实的 job 就能关联上（否则这条断言只是"什么都插不进去"）
    const job = createJob(db, { kind: 'health', now: () => T0, jobId: 'j-real' });
    db.prepare('INSERT INTO health_run (run_id, job_id, state) VALUES (?, ?, ?)').run(
      'r-ok',
      job.jobId,
      'running',
    );
    const row = db.prepare('SELECT job_id, state FROM health_run WHERE run_id = ?').get('r-ok');
    assert.deepEqual([row.job_id, row.state], ['j-real', 'running']);
  } finally {
    db.close();
  }
});

// ============================================================ H4/H5 表约束

test('H4 删掉一次体检 ⇒ 它的发现项**跟着走**（CASCADE）', () => {
  const { db } = freshDb('H4');
  try {
    db.prepare('INSERT INTO health_run (run_id, state) VALUES (?, ?)').run('r1', 'done');
    const ins = db.prepare(
      'INSERT INTO health_finding (run_id, check_id, severity, detail, created_at_ms) VALUES (?,?,?,?,?)',
    );
    ins.run('r1', 'missing-archive', 'warn', 'VR-1 缺同名包', T0);
    ins.run('r1', 'state-cache-drift', 'error', '索引状态与重算不一致', T0);
    const fks = db.prepare('PRAGMA foreign_key_list(health_finding)').all();
    assert.deepEqual(
      fks.map((f) => [f.table, f.on_delete]),
      [['health_run', 'CASCADE']],
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM health_finding').get().n, 2);
    db.prepare('DELETE FROM health_run WHERE run_id = ?').run('r1');
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM health_finding').get().n,
      0,
      '发现项必须跟着删（否则孤儿行）',
    );
  } finally {
    db.close();
  }
});

test('H5 CHECK 枚举与 NOT NULL：写错值直接在数据库层炸（不静默存进去）', () => {
  const { db } = freshDb('H5');
  try {
    const runIns = db.prepare('INSERT INTO health_run (run_id, state) VALUES (?, ?)');
    runIns.run('r-ok', 'done');
    assert.throws(
      () => runIns.run('r-bad', '体检中'),
      /CHECK/i,
      'state 只认 running/done/failed/cancelled',
    );
    const fIns = db.prepare(
      'INSERT INTO health_finding (run_id, check_id, severity, detail, created_at_ms) VALUES (?,?,?,?,?)',
    );
    fIns.run('r-ok', 'zero-byte', 'info', '0 字节', T0);
    assert.throws(
      () => fIns.run('r-ok', 'x', 'fatal', 'd', T0),
      /CHECK/i,
      'severity 只认 info/warn/error',
    );
    assert.throws(
      () => fIns.run('r-ok', 'x', 'info', null, T0),
      /NOT NULL/i,
      'detail 是 NOT NULL（人话说明必须有）',
    );
    assert.throws(
      () =>
        db
          .prepare(
            'INSERT INTO health_finding (check_id, severity, detail, created_at_ms) VALUES (?,?,?,?)',
          )
          .run('x', 'info', 'd', T0),
      /NOT NULL/i,
      'run_id 是 NOT NULL（发现项必须挂在某一次体检上）',
    );
  } finally {
    db.close();
  }
});

test('H6 finding_id 自增（INTEGER PK）且库里**不出现** sqlite_sequence（与既有自检一致）', () => {
  const { db } = freshDb('H6');
  try {
    db.prepare('INSERT INTO health_run (run_id, state) VALUES (?, ?)').run('r1', 'done');
    const ins = db.prepare(
      'INSERT INTO health_finding (run_id, check_id, severity, detail, created_at_ms) VALUES (?,?,?,?,?)',
    );
    ins.run('r1', 'a', 'info', 'd1', T0);
    ins.run('r1', 'b', 'info', 'd2', T0);
    assert.deepEqual(
      db
        .prepare('SELECT finding_id FROM health_finding ORDER BY finding_id')
        .all()
        .map((r) => r.finding_id),
      [1, 2],
      '整数流水号自增（基线写 AUTOINCREMENT，本仓用 INTEGER PRIMARY KEY —— 理由见 migrations.ts 的偏离说明）',
    );
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(
      tables.includes('sqlite_sequence'),
      false,
      '库里不该出现 sqlite_sequence（既有自检 G2 的口径）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ H7 迁移 / 分层（全部派生）

test('H7 ⭐⭐ 迁移与分层：v3 新迁移 · 版本派生 · 两张表进过程层 · 旧库升级不回归', () => {
  // ① 版本与清单的关系（派生，不写死 3 这个数字本身）
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标版本 = 清单上限');
  // ⚠️ B2-2（asset_export）之后：**不能**再断言"最后一条是我"（那会被后来者自动打红）。
  //    改钉**自己那一格**：体检台账永远是 v3（idx 2）——这是"它没被改名/挪位"这件事的正确判据。
  assert.equal(
    LIBRARY_MIGRATIONS[2].name,
    'batch2-health-ledger',
    '体检台账仍是 v3（不许被改名/挪位）',
  );
  // ② 表清单（派生）
  assert.ok(LIBRARY_TABLES.includes('health_run') && LIBRARY_TABLES.includes('health_finding'));
  assert.deepEqual(
    [...EXPECTED_TABLES],
    [...LIBRARY_TABLES, 'schema_version'].sort(),
    '应有表 = 业务表 + 账本',
  );
  // ③ 分层：两张表都在**过程层**，且都落在库级
  assert.deepEqual(tablesInLayer('process'), [
    'asset_index_state',
    'job',
    'health_run',
    'health_finding',
  ]);
  for (const t of ['health_run', 'health_finding']) {
    assert.ok(schemaTables().includes(t), '四组点名必须含 ' + t);
    assert.ok(libraryLayerTables().includes(t), t + ' 落在库级 .gs.db');
  }
  // ④ 旧库升级路径：只跑到 v2 的库 ⇒ 没有这两张表；再打开 ⇒ 只跑 v3，且**老数据（job 行）还在**
  const old = freshDb('H7-v2', LIBRARY_MIGRATIONS.slice(0, 2));
  try {
    assert.equal(readSchemaVersion(old.db), 2);
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.deepEqual(
      [names.includes('health_run'), names.includes('health_finding')],
      [false, false],
    );
    createJob(old.db, { kind: 'health', now: () => T0, jobId: 'j-old' });
  } finally {
    old.db.close();
  }
  const upgraded = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(upgraded.db), TARGET_SCHEMA_VERSION);
    // ⚠️ 不写死 [3]：只跑"比 from 大"的那些迁移（B2-2 的 v4 之后还会有 v5…），从清单派生
    assert.deepEqual(
      upgraded.migration.applied.map((m) => m.version),
      versions.filter((v) => v > 2),
      '只跑缺的那些迁移（v2 之后的全部）',
    );
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM job').get().n, 1, '升级不动老数据');
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM health_run').get().n, 0, '新表是空的');
    upgraded.db.close();
    const again = openGsDb({ dbPath: old.dbPath, now: () => T0 });
    assert.equal(again.migration.applied.length, 0, '幂等：再开不再跑迁移');
    again.db.close();
  } finally {
    /* 已在上面关过 */
  }
});

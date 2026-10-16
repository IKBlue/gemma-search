// apps/desktop/tests/job-ledger.test.mjs —— B2-1：`job` 任务台账（持久化 · 续跑 · 取消 · 崩溃恢复）
//
// 这张卡要证的不是"表建出来了"，而是**四条承诺**：
//   ① 进度**单调**（回退 = 数据库级错误，不是"注意一下"）；
//   ② 总数**可空**（不知道就别编）；
//   ③ `phase` **会变**（"不静默" = 界面能看到子阶段，而不是一个转圈）；
//   ④ 心跳过期 ⇒ **启动时判 failed**（否则界面永远显示一个不存在的进度）。
// 加一条地基断言：**迁移/分层**（6 → 7 张表、每张被点名、旧库升级路径不回归）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  JOB_KINDS,
  JOB_STATES,
  JOB_TERMINAL_STATES,
  DEFAULT_JOB_STALE_MS,
  JobError,
  createJob,
  finishJob,
  getJob,
  heartbeat,
  listJobs,
  listUnfinishedJobs,
  newJobId,
  readCursor,
  setProgress,
  settleUnfinishedJobsOnStartup,
  startJob,
  sweepStaleJobs,
} from '../src/main/db/jobs.ts';
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

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_b21', 'job-ledger-' + process.pid);
const T0 = 1700000000000;

/** 可控时钟：崩溃/心跳这类语义必须能"快进"，不许 sleep 真等 */
function clock(start) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
      return t;
    },
  };
}

let seq = 0;
function freshDb(label, migrations) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, '.gs.db');
  const opened = migrations ? openGsDb({ dbPath, migrations }) : openGsDb({ dbPath });
  return { dir, dbPath, db: opened.db, opened };
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

// ============================================================ J1 完整往返 + 字段齐备

test('J1 ⭐ 完整生命周期：queued → running → 进度/阶段/断点 → done，字段一个不少', () => {
  const { db } = freshDb('J1');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'index', now: c.now });
    assert.equal(job.state, 'queued');
    assert.equal(job.progressDone, 0, '入队时进度是 0（不是 null）');
    assert.equal(job.progressTotal, null, '**不知道总数就不许编** —— 初始必须是 null');
    assert.equal(job.phase, null);
    assert.equal(job.cursorJson, null);
    assert.equal(job.heartbeatAtMs, T0, '入队就记心跳（否则刚入队就被判崩溃）');
    assert.equal(job.startedAtMs, null);
    assert.equal(job.finishedAtMs, null);
    assert.equal(job.error, null);
    assert.match(job.jobId, /^[0-9a-f-]{36}$/, 'job_id 由 crypto.randomUUID 生成（nanoid 未安装）');

    c.advance(100);
    const running = startJob(db, job.jobId, c.now);
    assert.equal(running.state, 'running');
    assert.equal(running.startedAtMs, T0 + 100);

    c.advance(50);
    const p = setProgress(db, job.jobId, {
      done: 10,
      total: 100,
      phase: '统计文件',
      cursorJson: '{"relPath":"CR/A.jpg"}',
      now: c.now,
    });
    assert.equal(p.progressDone, 10);
    assert.equal(p.progressTotal, 100);
    assert.equal(p.phase, '统计文件');
    assert.equal(p.heartbeatAtMs, T0 + 150, '有进度 = 顺手刷心跳（"我还在"）');

    c.advance(50);
    const fin = finishJob(db, job.jobId, {
      state: 'done',
      summaryJson: '{"added":10}',
      now: c.now,
    });
    assert.equal(fin.state, 'done');
    assert.equal(fin.finishedAtMs, T0 + 200);
    assert.equal(fin.summaryJson, '{"added":10}');
    assert.equal(fin.finishedAtMs - fin.startedAtMs, 100, 'finished - started = 实际耗时');

    assert.equal(listJobs(db).length, 1);
    assert.deepEqual(listUnfinishedJobs(db), [], '完成后不再是"未完成"');
    assert.ok(newJobId() !== newJobId());
  } finally {
    db.close();
  }
});

// ============================================================ J2 ⭐⭐ 崩溃判定（能红锚点）

test('J2 ⭐⭐ 心跳过期 ⇒ 启动结算把它判 failed（而心跳新鲜的照常留着续跑）', () => {
  const { db } = freshDb('J2');
  const c = clock(T0);
  try {
    const stale = createJob(db, { kind: 'index', now: c.now, jobId: 'j-stale' });
    startJob(db, stale.jobId, c.now);
    setProgress(db, stale.jobId, {
      done: 7,
      phase: '编码第 3 批',
      cursorJson: '{"relPath":"CR/B.jpg"}',
      now: c.now,
    });

    // 另一个任务：同样 running，但心跳是**刚刚**的 ⇒ 不许被判失败
    c.advance(1000);
    const alive = createJob(db, { kind: 'scan', now: c.now, jobId: 'j-alive' });
    startJob(db, alive.jobId, c.now);

    // "进程被杀"：心跳停在 T0，而现实已经过了 10 分钟。
    // ⚠️ 活着的那个任务要**继续刷心跳**（真实进程就是这么做的）—— 否则它当然也该被判过期，
    //    那样这条断言就分不清"判过期"和"把在跑的也杀了"。
    c.advance(10 * 60 * 1000);
    heartbeat(db, 'j-alive', c.now);
    const settled = settleUnfinishedJobsOnStartup(db, { now: c.now, ttlMs: 5 * 60 * 1000 });

    assert.deepEqual(
      settled.failed.map((j) => j.jobId),
      ['j-stale'],
      '只有心跳过期的那个被判失败',
    );
    const failed = getJob(db, 'j-stale');
    assert.equal(failed.state, 'failed', '**过期必须判 failed**：否则界面永远显示一个不存在的进度');
    assert.match(failed.error, /心跳过期/, '失败理由要写人话（界面直接显示）');
    assert.equal(failed.finishedAtMs, c.now(), '判失败也要记结束时刻');
    assert.equal(failed.progressDone, 7, '判失败**不动进度**（历史事实不改写）');

    assert.equal(
      getJob(db, 'j-alive').state,
      'running',
      '心跳新鲜的必须留着（否则会把在跑的任务误杀）',
    );
    assert.deepEqual(
      settled.resumable.map((r) => r.job.jobId),
      ['j-alive'],
    );

    // 幂等：再结算一次不会重复判
    assert.deepEqual(sweepStaleJobs(db, { now: c.now, ttlMs: 5 * 60 * 1000 }), []);
  } finally {
    db.close();
  }
});

// ============================================================ J3 ⭐ 进度只增不减（两层）

test('J3 ⭐⭐ progress_done 回退 ⇒ 模块层抛 JobError，**绕过模块**也过不了数据库 trigger', () => {
  const { db } = freshDb('J3');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'index', now: c.now });
    startJob(db, job.jobId, c.now);
    setProgress(db, job.jobId, { done: 50, now: c.now });

    assert.throws(
      () => setProgress(db, job.jobId, { done: 49, now: c.now }),
      (e) => e instanceof JobError && e.code === 'JOB_PROGRESS_REGRESSION',
      '回退必须在模块层被拒',
    );
    // 第二条防线：绕过模块直接 UPDATE ⇒ trigger ABORT
    assert.throws(
      () => db.prepare('UPDATE job SET progress_done = 1 WHERE job_id = ?').run(job.jobId),
      /只增不减|ABORT/i,
      '数据库级 trigger 也必须挡住（别的写入方绕不过去）',
    );
    assert.equal(getJob(db, job.jobId).progressDone, 50, '被拒之后进度**没被改动**');

    // 相等是允许的（幂等重放同一批不该炸）
    assert.equal(setProgress(db, job.jobId, { done: 50, now: c.now }).progressDone, 50);
    assert.equal(setProgress(db, job.jobId, { done: 51, now: c.now }).progressDone, 51);
  } finally {
    db.close();
  }
});

test('J3b 总数不许小于已完成（否则界面显示超过 100% 的假进度）', () => {
  const { db } = freshDb('J3b');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'scan', now: c.now });
    startJob(db, job.jobId, c.now);
    setProgress(db, job.jobId, { done: 10, total: 100, now: c.now });
    assert.throws(
      () => setProgress(db, job.jobId, { done: 10, total: 5, now: c.now }),
      (e) => e instanceof JobError && e.code === 'JOB_TOTAL_BELOW_DONE',
    );
    assert.equal(getJob(db, job.jobId).progressTotal, 100);
  } finally {
    db.close();
  }
});

// ============================================================ J4 ⭐ phase 会变

test('J4 ⭐ phase 变化**可见**（不是只有一个转圈）：两次更新之间读得到不同的子阶段', () => {
  const { db } = freshDb('J4');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'rebuild', now: c.now });
    startJob(db, job.jobId, c.now);
    const a = setProgress(db, job.jobId, { done: 1, phase: '扫描库根', now: c.now });
    c.advance(10);
    const b = setProgress(db, job.jobId, { done: 2, phase: '编码第 3 批', now: c.now });
    assert.notEqual(a.phase, b.phase, 'phase 必须真的变（这就是"不静默"）');
    assert.equal(getJob(db, job.jobId).phase, '编码第 3 批');
    // phase 不传 = 不改（别把阶段静默清空）
    assert.equal(setProgress(db, job.jobId, { done: 3, now: c.now }).phase, '编码第 3 批');
  } finally {
    db.close();
  }
});

// ============================================================ J5 ⭐ 崩溃恢复

test('J5 ⭐ 重启（重开库）后能读到未完成任务**及其游标**', () => {
  const { db, dbPath } = freshDb('J5');
  const c = clock(T0);
  const job = createJob(db, { kind: 'index', now: c.now, jobId: 'j-resume' });
  startJob(db, job.jobId, c.now);
  setProgress(db, job.jobId, {
    done: 120,
    total: 3594,
    phase: '编码',
    cursorJson: '{"relPath":"VR/VR-500.jpg"}',
    now: c.now,
  });
  db.close(); // = 进程结束

  // = 进程重启：重新打开同一个库（迁移幂等，不许重建表）
  // ⚠️ B2-1b：`openGsDb` 现在**会在开库时结算**（把心跳过期的 running 判 failed）。
  //    这里要测的是"刚崩、马上重启" ⇒ 注入**同一个模拟时钟**（心跳对它是新鲜的），任务才该还活着；
  //    "心跳真的过期 ⇒ 判 failed"那条由 J2 / W2 负责（它们期望的就是被判失败）。
  const reopened = openGsDb({ dbPath, now: c.now });
  try {
    assert.equal(reopened.migration.applied.length, 0, '重开不该再跑迁移（幂等）');
    const unfinished = listUnfinishedJobs(reopened.db);
    assert.deepEqual(
      unfinished.map((j) => j.jobId),
      ['j-resume'],
      '未完成的任务必须还在',
    );
    assert.equal(unfinished[0].progressDone, 120);
    assert.deepEqual(readCursor(unfinished[0]), { relPath: 'VR/VR-500.jpg' }, '断点要能读回来');
    // 心跳还是旧的（进程真的被杀过）⇒ 启动结算会判失败，而不是永远 running
    // ⚠️ now 是**函数**（这里是"现实已经过了 10 分钟"，而库里的心跳还停在 T0）
    const settled = settleUnfinishedJobsOnStartup(reopened.db, {
      now: () => c.now() + 10 * 60 * 1000,
      ttlMs: 5 * 60 * 1000,
    });
    assert.deepEqual(
      settled.failed.map((j) => j.jobId),
      ['j-resume'],
    );
  } finally {
    reopened.db.close();
  }
});

test('J5b 坏 cursor_json **抛错**（不静默当"没有断点"）', () => {
  const { db } = freshDb('J5b');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'index', now: c.now });
    startJob(db, job.jobId, c.now);
    db.prepare('UPDATE job SET cursor_json = ? WHERE job_id = ?').run('{ 半截', job.jobId);
    assert.throws(
      () => readCursor(getJob(db, job.jobId)),
      (e) => e instanceof JobError && e.code === 'JOB_CURSOR_INVALID',
    );
  } finally {
    db.close();
  }
});

// ============================================================ J6 ⭐ 游标续跑不重复

test('J6 ⭐⭐ 游标续跑**不重复处理**已处理项（可数夹具 + 中途重启）', () => {
  const { db, dbPath } = freshDb('J6');
  const c = clock(T0);
  /** 可数夹具：按 relPath 升序处理，每次 2 条，断点写回 cursor_json（"最后成功的 rel_path"） */
  const ITEMS = ['A', 'B', 'C', 'D'];
  const processed = [];
  const advance = (database, batch) => {
    const job = listUnfinishedJobs(database)[0];
    const cursor = readCursor(job) ?? { relPath: null };
    const startAt = cursor.relPath === null ? 0 : ITEMS.indexOf(cursor.relPath) + 1;
    const slice = ITEMS.slice(startAt, startAt + batch);
    for (const it of slice) processed.push(it);
    const last = slice.length ? slice[slice.length - 1] : cursor.relPath;
    setProgress(database, job.jobId, {
      done: job.progressDone + slice.length,
      total: ITEMS.length,
      cursorJson: JSON.stringify({ relPath: last }),
      now: c.now,
    });
    return slice.length;
  };

  const job = createJob(db, { kind: 'index', now: c.now, jobId: 'j-cursor' });
  startJob(db, job.jobId, c.now);
  assert.equal(advance(db, 2), 2, '第一段处理 A/B');
  assert.deepEqual(processed, ['A', 'B']);

  db.close(); // = 崩了（马上重启 ⇒ 注入同一个模拟时钟，理由见 J5 的说明）
  const reopened = openGsDb({ dbPath, now: c.now });
  try {
    assert.equal(advance(reopened.db, 2), 2, '续跑处理 C/D（从断点之后开始）');
    assert.deepEqual(processed, ['A', 'B', 'C', 'D'], '**四项各处理一次，没有重复**');
    assert.equal(new Set(processed).size, 4);
    assert.equal(advance(reopened.db, 2), 0, '已经没有可处理的了（断点在末尾）');
    assert.equal(getJob(reopened.db, 'j-cursor').progressDone, 4);
  } finally {
    reopened.db.close();
  }
});

// ============================================================ J7 状态机

test('J7 状态机：只有 queued 能开始、只有 running 能刷心跳、终态不能再结束/不许回 running', () => {
  const { db } = freshDb('J7');
  const c = clock(T0);
  try {
    const job = createJob(db, { kind: 'health', now: c.now });
    assert.throws(
      () => heartbeat(db, job.jobId, c.now),
      (e) => e instanceof JobError && e.code === 'JOB_STATE_INVALID',
    );
    startJob(db, job.jobId, c.now);
    assert.throws(
      () => startJob(db, job.jobId, c.now),
      (e) => e instanceof JobError && e.code === 'JOB_STATE_INVALID',
    );
    finishJob(db, job.jobId, { state: 'cancelled', now: c.now });
    assert.throws(
      () => finishJob(db, job.jobId, { state: 'done', now: c.now }),
      (e) => e instanceof JobError && e.code === 'JOB_STATE_INVALID',
      '终态只写一次（不许静默改写历史）',
    );
    assert.throws(
      () => db.prepare("UPDATE job SET state = 'running' WHERE job_id = ?").run(job.jobId),
      /终态|ABORT/i,
      '数据库 trigger 也不许终态回到 running',
    );
    assert.equal(getJob(db, job.jobId).state, 'cancelled');
    assert.equal(getJob(db, 'j-不存在'), null, '不存在的任务返回 null（不编一行假的）');
    assert.throws(
      () => startJob(db, 'j-不存在', c.now),
      (e) => e instanceof JobError && e.code === 'JOB_NOT_FOUND',
    );
  } finally {
    db.close();
  }
});

// ============================================================ J8 表形状 = 设计基线

test('J8 ⭐ job 表 = 设计基线的 11 个字段行（13 物理列）+ 可空性 + 索引', () => {
  const { db } = freshDb('J8');
  try {
    const cols = db.prepare("PRAGMA table_info('job')").all();
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    assert.deepEqual(
      cols.map((c) => c.name),
      [
        'job_id',
        'kind',
        'state',
        'progress_done',
        'progress_total',
        'phase',
        'cursor_json',
        'heartbeat_at_ms',
        'summary_json',
        'error',
        'queued_at_ms',
        'started_at_ms',
        'finished_at_ms',
      ],
      '列集与顺序照抄设计基线（别自己发明字段）',
    );
    assert.equal(byName.job_id.pk, 1, 'job_id 是主键');
    assert.equal(byName.kind.notnull, 1);
    assert.equal(byName.state.notnull, 1);
    assert.equal(byName.progress_done.notnull, 1, 'progress_done NOT NULL DEFAULT 0');
    assert.equal(byName.progress_done.dflt_value, '0');
    for (const name of [
      'progress_total',
      'phase',
      'cursor_json',
      'heartbeat_at_ms',
      'summary_json',
      'error',
      'queued_at_ms',
      'started_at_ms',
      'finished_at_ms',
    ]) {
      assert.equal(byName[name].notnull, 0, name + ' 必须**可空**（不知道就是 null，不许伪造 0）');
    }
    // ⚠️ TEXT 主键会让 SQLite 自己建一个 sqlite_autoindex_job_1 —— 那是**内部索引**，不是我们声明的；
    //    声明式索引的判据是名字以 idx_ 开头（与 DDL 的 CREATE INDEX 一一对应）。
    const allIdx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'job' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(
      allIdx.filter((n) => n.startsWith('idx_')),
      ['idx_job_heartbeat', 'idx_job_state'],
    );
    assert.ok(
      allIdx.some((n) => n.startsWith('sqlite_autoindex_job_')),
      'TEXT 主键的内部索引确实存在（写下来是为了让人看到：我们没把它算进声明式索引）',
    );

    // CHECK 枚举：写错值直接在数据库层炸（不是静默存进去）
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO job (job_id, kind, state) VALUES (?, ?, ?)')
          .run('x', 'nope', 'queued'),
      /CHECK/i,
    );
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO job (job_id, kind, state) VALUES (?, ?, ?)')
          .run('y', 'scan', 'nope'),
      /CHECK/i,
    );
    assert.deepEqual([...JOB_KINDS], ['scan', 'index', 'health', 'rebuild', 'ingest']);
    assert.deepEqual([...JOB_STATES], ['queued', 'running', 'done', 'failed', 'cancelled']);
    assert.deepEqual([...JOB_TERMINAL_STATES], ['done', 'failed', 'cancelled']);
    assert.equal(DEFAULT_JOB_STALE_MS, 5 * 60 * 1000);
  } finally {
    db.close();
  }
});

// ============================================================ J9 迁移 / 分层（四件套）

test('J9 ⭐⭐ 迁移与分层：库级 6 → 7 张、每张被点名、job 属过程层、旧库升级路径不回归', () => {
  assert.equal(TARGET_SCHEMA_VERSION, 2, 'B2-1 把库级目标版本推到 v2');
  assert.deepEqual(
    LIBRARY_MIGRATIONS.map((m) => m.version),
    [1, 2],
    '加表 = 加一条新迁移（不许改 v1）',
  );
  assert.deepEqual(
    LIBRARY_MIGRATIONS.map((m) => m.name),
    ['greenfield-library-3', 'batch2-job-ledger'],
  );
  assert.ok(LIBRARY_TABLES.includes('job'), 'LIBRARY_TABLES 必须含 job');
  assert.equal(LIBRARY_TABLES.length, 4);
  assert.ok(EXPECTED_TABLES.includes('job'));
  assert.equal(EXPECTED_TABLES.length, 5, '4 业务表 + schema_version 账本');
  assert.ok(schemaTables().includes('job'), '四组点名必须含 job');
  assert.deepEqual(tablesInLayer('process'), ['asset_index_state', 'job'], 'job 属**过程层**');
  assert.ok(libraryLayerTables().includes('job'), '落在库级 .gs.db');
  assert.equal(appLayerTables().includes('job'), false, '不许落在 app.db');

  // U16：**旧库（只有 v1）不升级就还是 v1，也没有 job 表**；升级则只加表、不动老数据
  const old = freshDb('J9-v1', [LIBRARY_MIGRATIONS[0]]);
  try {
    assert.equal(readSchemaVersion(old.db), 1, '只跑到 v1 的库版本就是 1');
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('job'), false, '没升级就没有 job 表（不静默提前建）');
    old.db
      .prepare(
        'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('000000000001', 'L1', 'CR', 'A', 'A', 'CR', 'CR/A.jpg', T0);
  } finally {
    old.db.close();
  }
  // 用完整清单再打开同一个库 ⇒ 升到 v2，且**老行还在**
  const upgraded = openGsDb({ dbPath: old.dbPath });
  try {
    assert.equal(readSchemaVersion(upgraded.db), 2);
    assert.deepEqual(
      upgraded.migration.applied.map((m) => m.version),
      [2],
      '只跑缺的那条 v2',
    );
    assert.equal(
      upgraded.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
      1,
      '升级不动老数据',
    );
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) AS n FROM job').get().n, 0, '新表是空的');
    // 幂等：再开一次不再跑迁移
    upgraded.db.close();
    const again = openGsDb({ dbPath: old.dbPath });
    assert.equal(again.migration.applied.length, 0);
    again.db.close();
  } finally {
    /* 已在 finally 里关过 */
  }
});

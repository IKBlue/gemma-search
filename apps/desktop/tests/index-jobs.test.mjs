// apps/desktop/tests/index-jobs.test.mjs —— IDX-2b2：**索引事件 → job 行状态机**
//
// 要证的事：
//   ① 首条 `index.progress` 建行（kind=index · running · total/done）；
//   ② 进度**单调**：回退被 `setProgress` 拒（行保持旧值）+ **记日志**（不静默）；
//   ③ 终态映射：`done{ok:true}` ⇒ done；`done{cancelled}` ⇒ cancelled；`done{ok:false}` ⇒ failed（带上游 error 码）；
//   ④ 终态之后的事件**不再写行**（只记日志）；
//   ⑤ 形状不对的事件：记日志、不建行、**不抛**；
//   ⑥ 打开库会触发 **B2-1b 启动结算**（上次 running 的任务标中断）⇒ 之后能续跑（新 job 行照常建）；
//   ⑦ **写 job 行的入口只有一处**（源码扫描：`INSERT INTO job`/`UPDATE job` 只在 db/jobs.ts）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openGsDb } from '../src/main/db/open.ts';
import { createJob, getJob, startJob } from '../src/main/db/jobs.ts';
import { createIndexJobRecorder } from '../src/main/index-jobs.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_idx2b2', 'jobs-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDb(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, '.gs.db');
  const opened = openGsDb({ dbPath, now: () => T0 });
  opened.db.close();
  return dbPath;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

function recorderFor(dbPath, label) {
  const logs = [];
  const rec = createIndexJobRecorder({
    libDbPathOf: (libId) => (libId === 'L1' ? dbPath : null),
    now: () => T0,
    log: (...a) => logs.push(a.map(String).join(' ')),
  });
  return { rec, logs, label };
}
const readJob = (dbPath, jobId) => {
  const opened = openGsDb({ dbPath, now: () => T0 });
  try {
    return getJob(opened.db, jobId);
  } finally {
    opened.db.close();
  }
};
const progress = (jobId, done, total = 6, phase = 'encode') => ({
  type: 'index.progress',
  jobId,
  libId: 'L1',
  done,
  total,
  phase,
});
const doneEvt = (jobId, extra = {}) => ({
  type: 'index.done',
  jobId,
  libId: 'L1',
  ok: true,
  cancelled: false,
  ...extra,
});

test('J1 ⭐ 首条 index.progress 建行：kind=index · state=running · done/total/phase 落库', () => {
  const dbPath = freshDb('J1');
  const { rec } = recorderFor(dbPath);
  try {
    rec.ingest(progress('j-1', 2));
    const row = readJob(dbPath, 'j-1');
    assert.ok(row, 'job 行必须建出来');
    assert.equal(row.kind, 'index');
    assert.equal(row.state, 'running');
    assert.equal(row.progressDone, 2);
    assert.equal(row.progressTotal, 6);
    assert.equal(row.phase, 'encode');
  } finally {
    rec.close();
  }
});

test('J2 ⭐⭐ 进度单调：回退事件被拒（行保持旧值）且**记日志**（不静默）', () => {
  const dbPath = freshDb('J2');
  const { rec, logs } = recorderFor(dbPath);
  try {
    rec.ingest(progress('j-2', 5));
    rec.ingest(progress('j-2', 3, 6, 'persist')); // 回退
    const row = readJob(dbPath, 'j-2');
    assert.equal(row.progressDone, 5, '回退不许写进去');
    assert.equal(row.phase, 'encode', '被拒的更新不改任何字段');
    assert.ok(
      logs.some((l) => l.includes('JOB_PROGRESS_REGRESSION') || l.includes('进度写回被拒')),
      '回退必须留下日志（不静默）',
    );
  } finally {
    rec.close();
  }
});

test('J3 ⭐⭐ 终态映射：ok ⇒ done · cancelled ⇒ cancelled · ok=false ⇒ failed（error 带上游码）', () => {
  const cases = [
    { jobId: 'j-ok', evt: doneEvt('j-ok'), want: 'done', error: null },
    {
      jobId: 'j-c',
      evt: doneEvt('j-c', { ok: false, cancelled: true }),
      want: 'cancelled',
      error: null,
    },
  ];
  for (const c of cases) {
    const dbPath = freshDb('J3-' + c.want);
    const { rec } = recorderFor(dbPath);
    try {
      rec.ingest(progress(c.jobId, 1));
      rec.ingest(c.evt);
      const row = readJob(dbPath, c.jobId);
      assert.equal(row.state, c.want, c.jobId + ' 终态');
      assert.equal(row.finishedAtMs !== null, true, '终态必须写 finished_at_ms');
    } finally {
      rec.close();
    }
  }
  // 硬失败：先 index.failed（带码）再 index.done{ok:false} ⇒ 码进 error 前缀
  const dbPath = freshDb('J3-failed');
  const { rec } = recorderFor(dbPath);
  try {
    rec.ingest(progress('j-f', 1));
    rec.ingest({
      type: 'index.failed',
      jobId: 'j-f',
      libId: 'L1',
      error: { code: 'MODEL_MISSING', message: '没有模型' },
    });
    rec.ingest(doneEvt('j-f', { ok: false }));
    const row = readJob(dbPath, 'j-f');
    assert.equal(row.state, 'failed');
    assert.match(
      String(row.error),
      /^MODEL_MISSING/,
      '错误码写进 error 前缀（表里没有 error_code 列）',
    );
  } finally {
    rec.close();
  }
});

test('J4 ⭐ 终态之后的事件不再写行（只记日志；不抛）', () => {
  const dbPath = freshDb('J4');
  const { rec, logs } = recorderFor(dbPath);
  try {
    rec.ingest(progress('j-4', 6));
    rec.ingest(doneEvt('j-4'));
    const before = readJob(dbPath, 'j-4');
    rec.ingest(progress('j-4', 6)); // 终态后的迟到事件
    rec.ingest(doneEvt('j-4'));
    const afterRow = readJob(dbPath, 'j-4');
    assert.deepEqual(
      [afterRow.state, afterRow.progressDone, afterRow.finishedAtMs],
      [before.state, before.progressDone, before.finishedAtMs],
      '终态行不许被改写',
    );
    assert.ok(
      logs.some((l) => l.includes('已终态')),
      '忽略终态后事件也要留日志',
    );
  } finally {
    rec.close();
  }
});

test('J5 ⭐ 形状不对的事件：记日志、不建行、**不抛**（事件回调里抛异常会打穿主进程）', () => {
  const dbPath = freshDb('J5');
  const { rec, logs } = recorderFor(dbPath);
  try {
    assert.doesNotThrow(() => {
      rec.ingest(null);
      rec.ingest({ type: 'index.progress' }); // 缺 jobId/libId
      rec.ingest({ type: 'other', jobId: 'x', libId: 'L1' });
    });
    const opened = openGsDb({ dbPath, now: () => T0 });
    try {
      assert.equal(opened.db.prepare('SELECT COUNT(*) n FROM job').get().n, 0, '坏事件不许建行');
    } finally {
      opened.db.close();
    }
    assert.ok(logs.filter((l) => l.includes('事件形状不认识')).length >= 3, '每条坏事件都要留日志');
  } finally {
    rec.close();
  }
});

test('J6 ⭐⭐ 打开库触发 B2-1b 启动结算：上次 running 的索引任务被标中断 ⇒ 之后能续跑（新 job 照常建）', () => {
  const dbPath = freshDb('J6');
  // 造一个"上次崩溃留下的 running 任务"：**心跳必须是过期的**（B2-1b 按 DEFAULT_JOB_STALE_MS 判旧，
  //   5 分钟；只造一个"running"但心跳=现在 是**不会**被结算的 —— 那正是防"误杀正在跑的任务"）。
  const OLD = T0 - 10 * 60 * 1000;
  const opened = openGsDb({ dbPath, now: () => OLD });
  try {
    createJob(opened.db, { kind: 'index', jobId: 'j-stale', now: () => OLD });
    startJob(opened.db, 'j-stale', () => OLD);
    assert.equal(getJob(opened.db, 'j-stale').state, 'running');
  } finally {
    opened.db.close();
  }
  const { rec } = recorderFor(dbPath);
  try {
    // 任意事件让记录器第一次打开这个库 ⇒ openGsDb 里的 startup settlement 会结算
    rec.ingest(progress('j-new', 1));
    const stale = readJob(dbPath, 'j-stale');
    assert.notEqual(stale.state, 'running', '上次的 running 必须被结算成中断（不能再冒充在跑）');
    assert.ok(['failed', 'cancelled', 'done'].includes(stale.state));
    assert.equal(readJob(dbPath, 'j-new').state, 'running', '续跑（新 job）照常建行');
  } finally {
    rec.close();
  }
});

test('J7 ⭐⭐ 写 job 行的入口只有一处（源码扫描）：INSERT INTO job / UPDATE job 只在 db/jobs.ts', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(MAIN);
  const writers = files
    .filter((f) =>
      /(INSERT\s+(OR\s+\w+\s+)?INTO\s+job\b)|(UPDATE\s+job\b)/i.test(fs.readFileSync(f, 'utf8')),
    )
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(writers, ['jobs.ts'], 'job 表的唯一写入口必须是 db/jobs.ts（§2.3）');
  // 记录器只能通过 jobs.ts 的 API 写（不自己拼 SQL）
  const recSrc = fs.readFileSync(path.join(MAIN, 'index-jobs.ts'), 'utf8');
  assert.equal(
    /INSERT\s+INTO\s+job|UPDATE\s+job/i.test(recSrc),
    false,
    'index-jobs.ts 不许出现写 job 的 SQL',
  );
  assert.ok(/from '\.\/db\/jobs\.ts'/.test(recSrc), '必须走 db/jobs.ts 的 API');
});

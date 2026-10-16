// apps/desktop/tests/job-wiring.test.mjs —— B2-1b：把「启动结算」**真正挂上**唯一开库入口
//
// 这张卡最容易被糊弄的地方是"接线"：写一句注释、调一次函数就算接好了（P8 明令禁止）。
// 所以这里两类证据都要：
//   ① **源码扫描**（照 SEC-1 的 D7）：产品面里调用点**恰好一处**、且在唯一入口 `openGsDb` 内、
//      并且**结果被使用**（赋值 + 进返回值）—— 注释不算接线；
//   ② **端到端**：经**真实开库路径**（`openGsDb`）让一条过期 `running` 变成 `failed`，
//      测试里**不直接调** `settleUnfinishedJobsOnStartup`（那样就绕过了"接线"这件事本身）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openGsDb } from '../src/main/db/open.ts';
import { createJob, getJob, setProgress, startJob } from '../src/main/db/jobs.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_b21b', 'job-wiring-' + process.pid);
const T0 = 1700000000000;
const TEN_MIN = 10 * 60 * 1000;

let seq = 0;
function freshDbPath(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, '.gs.db');
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

/** 造一条"运行中、心跳停在 T0、带断点"的任务（= 上一个进程被杀掉的现场） */
function seedStaleRunning(dbPath, jobId, { cursorJson = '{"relPath":"A.jpg"}' } = {}) {
  const opened = openGsDb({ dbPath, now: () => T0 });
  const job = createJob(opened.db, { kind: 'index', now: () => T0, jobId });
  startJob(opened.db, job.jobId, () => T0);
  setProgress(opened.db, job.jobId, {
    done: 5,
    total: 100,
    phase: '编码第 3 批',
    cursorJson,
    now: () => T0,
  });
  opened.db.close();
  return jobId;
}

// ============================================================ W1 源码扫描（防 P8）

test('W1 ⭐⭐ 接线是真接线：产品面调用点**恰好一处**、在唯一入口内、且**结果被使用**', () => {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(MAIN);
  // 扫描面自检：别在"扫了个空目录"的情况下得出"恰好一处"的假结论
  assert.ok(files.length >= 20, '扫描面太小（路径写错了？）：' + String(files.length));
  assert.ok(files.includes(path.join(MAIN, 'db', 'open.ts')), '扫描面必须包含开库入口 db/open.ts');

  const callers = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      // 调用（有 `= ` 或作为表达式），排除定义行
      if (line.includes('settleUnfinishedJobsOnStartup(') && !line.includes('export function')) {
        callers.push({
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          line: line.trim(),
        });
      }
    }
  }
  assert.equal(
    callers.length,
    1,
    '产品面必须**恰好一处**调用（散落多处 ⇒ 迟早漏掉一处）：' + JSON.stringify(callers),
  );
  assert.equal(
    callers[0].file,
    'apps/desktop/src/main/db/open.ts',
    '唯一调用点必须在开库的唯一入口里',
  );
  assert.match(
    callers[0].line,
    /^startupSettlement = settleUnfinishedJobsOnStartup\(/,
    '结果必须被接住（赋值），不能只是调一下',
  );

  const openSrc = fs.readFileSync(path.join(MAIN, 'db', 'open.ts'), 'utf8');
  // 「结果被使用」的机械判据：赋值 + 进返回值（照 SEC-1 D7 的做法）
  assert.match(
    openSrc,
    /return \{[^}]*startupSettlement[^}]*\};/s,
    '接住的结果必须进返回值（否则等于没接线）',
  );
  assert.ok(openSrc.includes('startupSettlementError'), '失败要如实留痕（不静默）');
  assert.ok(/if \(!readOnly\)/.test(openSrc), '只读打开必须跳过结算（只读不该有副作用）');
});

// ============================================================ W2 端到端（真开库路径）

test('W2 ⭐⭐ 端到端：经**真实开库**让过期的 running 变成 failed（测试不直接调 settle）', () => {
  const dbPath = freshDbPath('W2');
  seedStaleRunning(dbPath, 'j-wire');

  // 现实已经过了 10 分钟（心跳停在 T0）—— 只走真实入口，不碰 settle*
  const reopened = openGsDb({ dbPath, now: () => T0 + TEN_MIN });
  try {
    assert.notEqual(reopened.startupSettlement, null, '开库必须带回结算结果');
    assert.deepEqual(
      reopened.startupSettlement.failed.map((j) => j.jobId),
      ['j-wire'],
      '过期任务必须在开库时被判失败',
    );
    assert.equal(reopened.startupSettlementError, '', '正常路径不该有结算错误');
    const row = getJob(reopened.db, 'j-wire');
    assert.equal(
      row.state,
      'failed',
      '**开库之后库里就该是 failed**（界面不会再显示一个不存在的进度）',
    );
    assert.match(row.error, /心跳过期/, '判失败的理由要写人话');
    assert.equal(row.progressDone, 5, '判失败不改写进度（历史事实）');
    assert.deepEqual(reopened.startupSettlement.resumable, [], '它已经不是"可续跑"的了');
    assert.deepEqual(reopened.startupSettlement.cursorErrors, []);
  } finally {
    reopened.db.close();
  }

  // 再开一次：已经 failed ⇒ 不重复判（幂等）
  const third = openGsDb({ dbPath, now: () => T0 + 2 * TEN_MIN });
  try {
    assert.deepEqual(third.startupSettlement.failed, [], '已经是终态，不该被再判一次');
  } finally {
    third.db.close();
  }
});

test('W2b ⭐ 心跳新鲜的 running **不许**在开库时被误杀，且断点被交出来', () => {
  const dbPath = freshDbPath('W2b');
  const opened = openGsDb({ dbPath, now: () => T0 });
  const job = createJob(opened.db, { kind: 'index', now: () => T0, jobId: 'j-alive' });
  startJob(opened.db, job.jobId, () => T0);
  setProgress(opened.db, job.jobId, { done: 5, cursorJson: '{"relPath":"B.jpg"}', now: () => T0 });
  opened.db.close();

  // 只过了 1 分钟（< 默认 5 分钟阈值）⇒ 活着
  const again = openGsDb({ dbPath, now: () => T0 + 60 * 1000 });
  try {
    assert.deepEqual(again.startupSettlement.failed, [], '心跳新鲜的任务不许被判失败');
    assert.equal(getJob(again.db, 'j-alive').state, 'running');
    assert.deepEqual(
      again.startupSettlement.resumable.map((r) => [r.job.jobId, r.cursor]),
      [['j-alive', { relPath: 'B.jpg' }]],
      '可续跑任务必须**带着断点**交出来（崩溃恢复的入口）',
    );
  } finally {
    again.db.close();
  }
});

// ============================================================ W3 只读不写

test('W3 ⭐ 只读打开**不结算**（不许有副作用）：过期任务仍然是 running', () => {
  const dbPath = freshDbPath('W3');
  seedStaleRunning(dbPath, 'j-ro');

  const ro = openGsDb({ dbPath, readOnly: true, now: () => T0 + TEN_MIN });
  try {
    assert.equal(ro.startupSettlement, null, '只读打开不结算（没有副作用，也没有结果）');
    assert.equal(ro.startupSettlementError, '');
    // ⚠️ 只读连接**读**到的是库里的原状
    const row = ro.db.prepare('SELECT state FROM job WHERE job_id = ?').get('j-ro');
    assert.equal(
      row.state,
      'running',
      '只读打开绝不能把 running 改成 failed（那是对别人的库写入）',
    );
  } finally {
    ro.db.close();
  }
  // 反证：同一个库用**读写**打开，才会被判失败
  const rw = openGsDb({ dbPath, now: () => T0 + TEN_MIN });
  try {
    assert.deepEqual(
      rw.startupSettlement.failed.map((j) => j.jobId),
      ['j-ro'],
    );
  } finally {
    rw.db.close();
  }
});

// ============================================================ W4 坏游标不阻断开库

test('W4 ⭐ 坏 cursor_json **不阻断开库**：如实列进 cursorErrors，库照常可用', () => {
  const dbPath = freshDbPath('W4');
  seedStaleRunning(dbPath, 'j-bad', { cursorJson: '{ 半截 JSON' });

  // 心跳新鲜（只过 1 分钟）⇒ 不会被判失败，于是它会进入 resumable/cursorErrors 那条路
  const opened = openGsDb({ dbPath, now: () => T0 + 60 * 1000 });
  try {
    assert.equal(
      opened.startupSettlement.cursorErrors.length,
      1,
      '坏游标必须被如实列出来（不静默）',
    );
    assert.equal(opened.startupSettlement.cursorErrors[0].jobId, 'j-bad');
    assert.match(opened.startupSettlement.cursorErrors[0].reason, /cursor_json|JSON/);
    assert.deepEqual(
      opened.startupSettlement.resumable.map((r) => [r.job.jobId, r.cursor]),
      [['j-bad', null]],
    );
    assert.equal(
      getJob(opened.db, 'j-bad').state,
      'running',
      '坏游标不等于任务失败（别把两件事混了）',
    );
    assert.equal(opened.startupSettlementError, '', '一条坏数据**不许**让开库失败');
  } finally {
    opened.db.close();
  }
});

// ============================================================ W5 干净库

test('W5 干净库：开库结算三栏都空（不是"总是报点什么"）', () => {
  const dbPath = freshDbPath('W5');
  const opened = openGsDb({ dbPath, now: () => T0 });
  try {
    assert.deepEqual(opened.startupSettlement, { failed: [], resumable: [], cursorErrors: [] });
    assert.equal(opened.startupSettlementError, '');
  } finally {
    opened.db.close();
  }
});

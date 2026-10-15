// apps/desktop/tests/task-store.test.mjs —— P3d 的事件归约（纯函数，无需 DOM/Electron）
//
// 这组是 P3d 里**唯一能脱离 ONNX 模型验证的部分**，而且它覆盖的正是契约 §3 里
// 最容易写错、错了又不报错的几条：
//   · `done/total` **单调不减**（乱序/迟到的进度不许把进度条往回拨）
//   · **GPU 回退不静默**（`deviceFallback` 必须留住并显示，不能被后续事件冲掉）
//   · 失败清单**不静默**（非空 ⇒ `ok:false`，且每项可解释）
//   · 认不出的阶段/事件类型**不崩、不假装处理过**
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASES,
  initialTasks,
  reduceEvent,
  phaseLabel,
  progressPercent,
  etaText,
  outcomeSummary,
  startLocal,
} from '../src/renderer/src/store/tasks.ts';

const progress = (over = {}) => ({
  type: 'index.progress',
  jobId: 'j-1',
  libId: 'L1',
  done: 10,
  total: 100,
  skipped: 0,
  failed: 0,
  ratePerSec: 2,
  etaSec: 45,
  phase: 'encode',
  ...over,
});
/** 依次喂多条事件 */
const feed = (events, from = initialTasks) =>
  events.reduce((s, e, i) => reduceEvent(s, e, i + 1), from);

test('T1 进度事件把 done/total/条每秒/ETA/阶段都写进状态', () => {
  const s = feed([progress()]);
  assert.equal(s.running, true);
  assert.equal(s.done, 10);
  assert.equal(s.total, 100);
  assert.equal(s.ratePerSec, 2);
  assert.equal(s.etaSec, 45);
  assert.equal(s.phase, 'encode');
  assert.equal(progressPercent(s), 10);
  assert.equal(etaText(s), '45 秒');
});

test('T2 ⭐ `done` **单调不减** —— 迟到/乱序的进度不许把进度条往回拨（契约 §3）', () => {
  // ⚠️⚠️ **这条断言被我写坏过一次，记下来**：
  //    第一版是 `feed([40, 25, 41])` 然后断言 `done === 41` —— 那**根本没在测单调性**，
  //    因为"最后一条事件胜出"本来就会给出 41。双向验证当场戳穿：
  //    把 `Math.max` 去掉后它**照样通过**。⇒ 断言必须落在**中间态**上。
  const a = reduceEvent(initialTasks, progress({ done: 40 }), 1);
  assert.equal(a.done, 40);
  const b = reduceEvent(a, progress({ done: 25 }), 2);
  assert.equal(b.done, 40, '迟到的较低 done 必须被忽略 —— 否则进度条会被往回拨');
  const c = reduceEvent(b, progress({ done: 41 }), 3);
  assert.equal(c.done, 41, '更高的 done 要能继续推进（单调**不减**，不是"不许变"）');
  // 认不出/缺 done 的事件也不该把进度清零
  const d = reduceEvent(c, progress({ done: undefined }), 4);
  assert.equal(d.done, 41, '进度事件缺 done 时不该把进度打回 0');

  // 取消时 done 就停在某值不动（契约 §3）
  const stopped = feed([
    progress({ done: 40 }),
    {
      type: 'index.done',
      ok: false,
      cancelled: true,
      indexed: 40,
      total: 100,
      failed: [],
      reused: 0,
      encoded: 40,
    },
  ]);
  assert.equal(stopped.done, 40);
  assert.equal(stopped.running, false);
});

test('T3 ⭐ GPU 回退**必须留住并显示**（契约 §3「不静默」）', () => {
  const s = feed([
    progress({ done: 10 }),
    // 回退公告只在某一帧出现 —— 后续进度不带它，状态里也必须还在
    progress({ done: 20, deviceFallback: { from: 'webgpu', to: 'cpu', reason: '适配器丢失' } }),
    progress({ done: 30 }),
  ]);
  assert.ok(s.deviceFallback, 'GPU 回退公告被后续事件冲掉了 —— 那正是"静默"');
  assert.equal(s.deviceFallback.from, 'webgpu');
  assert.equal(s.deviceFallback.to, 'cpu');
  assert.equal(s.deviceFallback.reason, '适配器丢失');
});

test('T3b 续跑说明同样要留住（引擎只在第一条事件里说明复用多少）', () => {
  const s = feed([
    progress({ done: 0, note: '复用 12 条（compat 相符）' }),
    progress({ done: 20 }),
  ]);
  assert.match(s.resumeNote, /复用 12 条/);
});

test('T4 ⭐ 失败清单**不静默**：非空 ⇒ `ok:false`，每项可解释（契约 §3）', () => {
  const failed = [
    { relPath: 'VR\\a.jpg', stage: 'encode', error: { code: 'INTERNAL', message: '解码失败' } },
    { relPath: 'VR\\b.jpg', stage: 'pair', error: { code: 'INTERNAL', message: '同名包有 2 个' } },
  ];
  const s = feed([
    progress({ done: 100 }),
    { type: 'index.done', ok: false, indexed: 100, total: 100, reused: 3, encoded: 95, failed },
  ]);
  assert.equal(s.running, false);
  assert.equal(s.outcome.ok, false, '有失败项时 ok 必须是 false');
  assert.equal(s.failed.length, 2);
  for (const f of s.failed) {
    assert.ok(
      f.relPath && f.stage && f.error && f.error.message,
      `失败项要能解释：${JSON.stringify(f)}`,
    );
  }
  const sum = outcomeSummary(s);
  assert.deepEqual(
    sum,
    { reused: 3, encoded: 95, failed: 2 },
    '完成后要能显示「复用 N · 新编码 M · 失败 K」',
  );
});

test('T4b 取消收尾：`cancelled` 要留痕，且 done 停在取消时的值', () => {
  const s = feed([
    progress({ done: 30 }),
    {
      type: 'index.done',
      ok: false,
      cancelled: true,
      indexed: 30,
      total: 100,
      reused: 0,
      encoded: 29,
      failed: [{ relPath: 'x', stage: 'encode', error: { code: 'INTERNAL', message: '已取消' } }],
    },
  ]);
  assert.equal(s.outcome.cancelled, true);
  assert.equal(s.done, 30);
  assert.equal(s.running, false);
});

test('T4c `index.failed` 收尾：留下错误信封，且 userMessage 非空（界面要显示它）', () => {
  const s = feed([
    progress({ done: 5 }),
    {
      type: 'index.failed',
      error: { code: 'INTERNAL', message: 'x', userMessage: '任务失败了。', details: {} },
    },
  ]);
  assert.equal(s.running, false);
  assert.equal(s.outcome.ok, false);
  assert.ok(s.outcome.error.userMessage);
  assert.equal(outcomeSummary(s), null, '失败收尾没有「复用/新编码/失败」摘要');
});

test('T5 ⭐ 认不出的**阶段**原样显示、不崩（契约只举了 3 个阶段，规格要 5 个）', () => {
  // 契约 §3 只列了 encode/scan/finalize，而规格要 5 步 ⇒ 一定有对不上的可能
  assert.equal(phaseLabel('encode'), '编码');
  assert.equal(phaseLabel('pair'), '配对');
  assert.equal(phaseLabel('brand-new-phase'), 'brand-new-phase', '认不出就原样显示，不猜也不吞');
  assert.equal(phaseLabel(null), '');
  const s = feed([progress({ phase: 'brand-new-phase' })]);
  assert.equal(s.phase, 'brand-new-phase', '未知阶段要进状态（界面才能显示它）');
  assert.equal(PHASES.length, 5, '阶段条规格是 5 步（UI-REVIEW:241）');
});

test('T5b 认不出的**事件类型**不崩、也不假装处理过（只记进日志）', () => {
  const before = feed([progress({ done: 7 })]);
  const after = reduceEvent(before, { type: 'something.new', foo: 1 }, 9);
  assert.equal(after.done, before.done, '不该改状态');
  assert.equal(after.running, before.running);
  assert.equal(after.log.length, before.log.length + 1, '但要记进日志（便于排障）');
  // 空/畸形事件直接原样返回
  assert.equal(reduceEvent(before, null), before);
  assert.equal(reduceEvent(before, {}), before);
  assert.equal(reduceEvent(before, 'nope'), before);
});

test('T5c `total` 未知时百分比返回 **null**（显示不确定进度），不编一个数', () => {
  const s = feed([progress({ done: 3, total: 0 })]);
  assert.equal(s.total, 0);
  assert.equal(progressPercent(s), null);
  assert.equal(progressPercent({ ...initialTasks, done: 5, total: 10 }), 50);
  // 越界要夹住
  assert.equal(progressPercent({ ...initialTasks, done: 99, total: 10 }), 100);
});

test('T5d `etaSec` 缺失写 "—"，**不本地估算**（ETA 是引擎算的，契约 §3）', () => {
  assert.equal(etaText({ etaSec: null }), '—');
  assert.equal(etaText({ etaSec: undefined }), '—');
  assert.equal(etaText({ etaSec: 0 }), '0 秒');
  assert.equal(etaText({ etaSec: 59 }), '59 秒');
  assert.equal(etaText({ etaSec: 60 }), '1 分 00 秒');
  assert.equal(etaText({ etaSec: 3661 }), '61 分 01 秒');
  // 状态里没给 etaSec 时，进度事件不该把它变成 0
  const s = feed([progress({ etaSec: undefined })]);
  assert.equal(s.etaSec, null, '引擎没给 ETA ⇒ 保持 null，不写 0（0 会被显示成"0 秒"）');
});

test('T6 `begin` 把状态清干净并标记已发起（避免上一次的失败项残留）', () => {
  const dirty = feed([
    progress({ done: 50 }),
    {
      type: 'index.done',
      ok: false,
      indexed: 50,
      total: 100,
      failed: [{ relPath: 'a', stage: 'encode', error: { code: 'INTERNAL', message: 'x' } }],
    },
  ]);
  assert.equal(dirty.failed.length, 1);
  const fresh = startLocal(dirty, { libId: 'L2' });
  assert.equal(fresh.running, true);
  assert.equal(fresh.libId, 'L2');
  assert.deepEqual(fresh.failed, [], '新任务不该带着上一次的失败项');
  assert.equal(fresh.outcome, null);
  assert.equal(fresh.done, 0);
  assert.equal(fresh.deviceFallback, null, 'GPU 回退公告也不该跨任务残留');
});

test('T7 日志有上限（长任务跑几千条进度也不能无限涨内存）', () => {
  let s = initialTasks;
  for (let i = 1; i <= 500; i++) s = reduceEvent(s, progress({ done: i }), i);
  assert.equal(s.done, 500, '状态照常推进');
  assert.ok(s.log.length <= 200, `日志必须截断，实得 ${s.log.length}`);
  assert.equal(s.log.at(-1).done, 500, '截断的是**最旧**的，最后一条要留着');
});

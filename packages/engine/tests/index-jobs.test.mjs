// packages/engine/tests/index-jobs.test.mjs —— IDX-2b：真实索引的任务管理（假构建器，**不需要 ONNX**）
//
// 判据（卡面约束 1–6）：
//   ① 注入：引擎不认识 indexer / 不碰路径；构建器与写者都从 indexing 端口进来；
//   ② 假构建器即可验真语义（进度 / 取消 / 续跑），不依赖模型；
//   ③ 写索引只有一处：引擎**从不**写字节（本文件用「写者被调用次数」与源码扫描双重钉住）；
//   ④ 取消在阶段边界：取消后**一个字节都不写**（原子写只在成功跑完时发生）；
//   ⑤ 复用计数进返回**与**事件；⑥ 进度单调不减、终态必发（不许静默停住）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngine } from '../src/engine.ts';
import { ERR } from '../src/errors.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

/** 等终态事件（index.done）出现；超时即失败（不许「安静停住」） */
async function settle(events, limit = 200) {
  for (let i = 0; i < limit; i++) {
    if (events.some((e) => e.type === 'index.done')) return;
    await tick();
  }
  throw new Error('等不到 index.done（终态事件必须发）');
}

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-idx2b-'));
  return d;
}

/**
 * 假构建器：可配进度序列、失败码、取消检查点。**不碰模型、不碰 ONNX**。
 * 行为与 IDX-1 的 buildIndex 对齐：onProgress / signal 检查 / 末尾调一次 writeIndex。
 */
function fakeBuilder(opts = {}) {
  const { progress = [1, 2, 3], total = 3, failWith = null, summary = null } = opts;
  return async (req) => {
    req.onProgress({ phase: 'scan', done: 0, total });
    for (const d of progress) {
      await tick();
      if (req.signal.aborted) {
        const e = new Error('构建已取消（阶段 encode）');
        e.name = 'BuildCancelledError';
        throw e;
      }
      req.onProgress({ phase: 'encode', done: d, total });
    }
    if (failWith) {
      const e = new Error(failWith.message || '构建失败');
      e.code = failWith.code;
      throw e;
    }
    req.writeIndex({ bytes: new Uint8Array([9, 8, 7]) });
    return summary || { total, encoded: total, failed: 0, reused: 0, dim: 768, compat: 'test' };
  };
}

/** 造一个真实模式的引擎（库根是真目录；构建器/写者都注入） */
function makeEngine({ builder = null, writeIndex = null, indexing = 'auto' } = {}) {
  const root = tmpRoot();
  const dataDir = tmpRoot();
  const events = [];
  const writes = [];
  const ports =
    indexing === null
      ? null
      : {
          buildIndex: builder || fakeBuilder(),
          writeIndex: writeIndex || ((inp) => writes.push(inp)),
        };
  const engine = createEngine({
    config: { libraries: [{ libId: 'L1', root, label: '测试库' }], data_dir: dataDir },
    encoder: null,
    onEvent: (ev) => events.push(ev),
    indexing: ports,
  });
  return { engine, events, writes, root, ports };
}

test('J1 ⭐ 成功路径：真进度 → index.done{ok}，**写者恰好被调用一次**（唯一原子写），字节带 libRoot', async () => {
  const { engine, events, writes, root } = makeEngine();
  const r = await engine.indexStart({ libId: 'L1', device: 'cpu' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(r.data.jobId, /^[0-9a-f-]{36}$/, 'jobId 由引擎生成（crypto.randomUUID）');
  assert.equal(typeof r.data.phase, 'string');
  await settle(events);
  const done = events.filter((e) => e.type === 'index.done');
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, true);
  assert.equal(done[0].cancelled, false);
  assert.equal(done[0].total, 3);
  assert.equal(done[0].encoded, 3);
  assert.equal(done[0].jobId, r.data.jobId, '事件里的 jobId 必须与返回一致');
  assert.equal(writes.length, 1, '写者只能被调用一次（引擎不自己写、也不重复写）');
  assert.equal(writes[0].libRoot, root, '引擎补上 libRoot 后交给主进程的原子写');
  assert.deepEqual([...writes[0].bytes], [9, 8, 7]);
});

test('J2 ⭐⭐ 取消在阶段边界：取消后**一个字节都不写**（旧索引完好），终态是 cancelled 而不是 failed', async () => {
  const { engine, events, writes } = makeEngine({
    builder: fakeBuilder({ progress: Array.from({ length: 50 }, (_, i) => i + 1), total: 50 }),
  });
  const r = await engine.indexStart({ libId: 'L1' });
  await tick(); // 让构建器跑几步
  const c = await engine.indexCancel({ jobId: r.data.jobId });
  assert.equal(c.ok, true);
  assert.equal(c.data.cancelled, true);
  await settle(events);
  assert.equal(writes.length, 0, '取消后不许写任何字节（所以不会留半个索引文件）');
  const done = events.filter((e) => e.type === 'index.done');
  assert.equal(done[0].cancelled, true);
  assert.equal(done[0].ok, false);
  assert.equal(
    events.some((e) => e.type === 'index.failed'),
    false,
    '取消不是失败：不许发 index.failed',
  );
  const c2 = await engine.indexCancel({ jobId: 'no-such' });
  assert.equal(c2.data.cancelled, false);
  assert.equal(c2.data.reason, 'no-such-job');
});

test('J3 ⭐⭐ 进度**单调不减**（构建器回退的 done 必须被丢弃，不是原样转发）', async () => {
  // 构建器刻意给回退序列 2 → 1 → 3：若引擎原样转发，dones 会出现 2,1,3 ⇒ 本断言红
  const { engine, events } = makeEngine({
    builder: fakeBuilder({ progress: [2, 1, 3], total: 3 }),
  });
  await engine.indexStart({ libId: 'L1' });
  await settle(events);
  const dones = events.filter((e) => e.type === 'index.progress').map((e) => e.done);
  for (let i = 1; i < dones.length; i++) {
    assert.ok(dones[i] >= dones[i - 1], 'done 回退被原样转发了：' + JSON.stringify(dones));
  }
  // 期望：起手 0 → scan 阶段又报 0 → encode 2 → 回退的 1 被钳成 2 → 3
  assert.deepEqual(dones, [0, 0, 2, 2, 3], '实得 ' + JSON.stringify(dones));
});

test('J4 ⭐⭐ 续跑：reused 进**返回**与**事件**；构建器收到 rebuild=false（复用由它决定）', async () => {
  let sawRebuild = null;
  const builder = async (req) => {
    sawRebuild = req.rebuild;
    req.onProgress({ phase: 'encode', done: 1, total: 3 });
    req.writeIndex({ bytes: new Uint8Array([1]) });
    return { total: 3, encoded: 1, failed: 0, reused: 2, dim: 768, compat: 'test' };
  };
  const { engine, events } = makeEngine({ builder });
  const r1 = await engine.indexStart({ libId: 'L1', rebuild: true });
  await settle(events);
  events.length = 0;
  const r2 = await engine.indexResume({ jobId: r1.data.jobId });
  assert.equal(r2.ok, true, JSON.stringify(r2.error));
  assert.equal(typeof r2.data.reused, 'number', '返回里要有 reused（卡片约束 5）');
  await settle(events);
  assert.equal(sawRebuild, false, '续跑必须让构建器复用（rebuild=false）');
  const done = events.filter((e) => e.type === 'index.done')[0];
  assert.equal(done.reused, 2, '事件里的 reused 来自构建器（权威）');
  assert.equal(done.indexed, 3, 'indexed = encoded + reused');
  const notes = events.filter((e) => e.type === 'index.progress' && e.note).map((e) => e.note);
  assert.ok(
    notes.some((n) => n.includes('复用')),
    '复用必须**不静默**：progress 里要有说明，实得 ' + JSON.stringify(notes),
  );
});

test('J5 ⭐⭐ 「接线了但环境不满足」必须给**真实错误码**，不许伪装成「未接线」的 INTERNAL', async () => {
  const { engine, events } = makeEngine({
    builder: fakeBuilder({ failWith: { code: 'MODEL_MISSING', message: '模型目录不存在' } }),
  });
  await engine.indexStart({ libId: 'L1' });
  await settle(events);
  const failed = events.filter((e) => e.type === 'index.failed');
  assert.equal(failed.length, 1, '硬失败必须发 index.failed（不许安静停住）');
  assert.equal(failed[0].error.code, 'MODEL_MISSING', '真实错误码原样透出');
  assert.notEqual(failed[0].error.code, ERR.INTERNAL, '不许说成 INTERNAL（那是「未接线」的码）');
  assert.doesNotMatch(failed[0].error.message, /IDX-2b/, '环境不满足 ≠ 没接线：文案不许提 IDX-2b');
  const done = events.filter((e) => e.type === 'index.done')[0];
  assert.equal(done.ok, false);
  assert.equal(done.cancelled, false);
});

test('J6 未接线（不传 indexing）：indexStart 同步 INTERNAL 且说明 IDX-2b（与 IDX-2a 一致）', async () => {
  const { engine } = makeEngine({ indexing: null });
  const r = await engine.indexStart({ libId: 'L1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.INTERNAL);
  assert.match(r.error.message, /IDX-2b/);
});

test('J7 续跑缺 libId（跨进程且无履历）⇒ BAD_REQUEST 并说清为什么要 libId', async () => {
  const { engine } = makeEngine();
  const r = await engine.indexResume({ jobId: 'j-unknown' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.BAD_REQUEST);
  assert.match(r.error.message, /libId/);
});

test('J8 写索引只有一处：引擎侧**不 import fs 写索引**，index-jobs/index-ports 里没有任何落盘调用', () => {
  // ⚠️ 先**遮蔽注释**再扫描：否则「注释里提到 writeIndexAtomically」会被当成实现（假红）
  const mask = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const jobsSrc = mask(fs.readFileSync(path.join(SRC, 'index-jobs.ts'), 'utf8'));
  const portsSrc = mask(fs.readFileSync(path.join(SRC, 'index-ports.ts'), 'utf8'));
  assert.equal(/from 'node:fs'/.test(jobsSrc), false, 'index-jobs 不许直接碰 fs');
  assert.equal(
    /writeFileSync|renameSync|writeIndexAtomically/.test(jobsSrc),
    false,
    '引擎不许出现第二份写入实现',
  );
  assert.equal(/writeFileSync|renameSync|writeIndexAtomically/.test(portsSrc), false);
  // 反向对照：引擎里**注入的**写者是我们唯一调用的落盘入口
  assert.match(
    jobsSrc,
    /p\.writeIndex\(\{ libRoot: job\.libRoot, bytes: input\.bytes \}\)/,
    '必须只经由注入端口写字节',
  );
});

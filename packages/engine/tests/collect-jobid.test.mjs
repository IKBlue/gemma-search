// packages/engine/tests/collect-jobid.test.mjs —— DF-3A：取件的 jobId 必须**加密随机**
//
// 缺陷（审查 §01）：engine.ts 曾用 `j-` + `Math.random().toString(16).slice(2,6)` —— 只有 4 位 hex
// （65536 种）且**非加密随机**；engine.ts 的 `jobs` 是 Map ⇒ 撞了就把两次取件记成同一个 job。
// AGENTS 明写：ID 新增处一律用现成实现，不自己拼随机。⇒ 改成 `j-` + `crypto.randomUUID()`。
//
// 两条断言各管一半：
//   · **形状**：每个 jobId 必须匹配 `j-` + v4 UUID —— 这条对旧写法**必然**红（确定性）；
//   · **互不相同**：连续 N 次取件的 jobId 两两不同 —— 旧写法在 N=256 时有 ~39% 概率撞，形状那条兜底。
// 红锚：本文件第二条用**固定种子**复现旧写法的取值方式，证明"4 位 hex 必然撞"（不是空话）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, indexPathFor } from '../src/engine.ts';
import { uidOf } from '../src/uid.ts';
import { makeLibrary, writeIndexFixture, fakeEncoder } from './helpers/lib-fixture.mjs';

/** `j-` 前缀 + RFC 4122 v4 UUID（保留 `j-` 是与 fake 引擎 `j-fake-*` 同族的既有口径） */
const JOB_ID = /^j-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const N = 256;

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-jobid-'));
  const libRoot = path.join(tmp, 'lib');
  const made = makeLibrary();
  fs.cpSync(made.root, libRoot, { recursive: true });
  const config = { libraries: [{ libId: 'L1', root: libRoot, label: '库1' }], data_dir: path.join(tmp, 'data') };
  writeIndexFixture(indexPathFor(path.join(tmp, 'data'), 'L1'), 'L1', made.rows, { libRoot });
  config.collect = { dirs: { '素材待用': path.join(tmp, 'dest') }, default: '素材待用' };
  return { tmp, config };
}

test('DF-3A ⭐⭐ 取件 jobId：连续 256 次互不相同，且是 j- + v4 UUID（加密随机）', async () => {
  const s = setup();
  try {
    const e = createEngine({ config: s.config, encoder: fakeEncoder() });
    const uid = uidOf('L1', 'VR', 'ID-1');
    const ids = [];
    for (let i = 0; i < N; i++) {
      const r = await e.collect({ libId: 'L1', uids: [uid], targetDirName: '素材待用' });
      assert.equal(r.ok, true, JSON.stringify(r.error));
      ids.push(r.data.jobId);
    }
    assert.equal(new Set(ids).size, N, 'N 次取件的 jobId 必须互不相同（旧写法 4 位 hex 只有 65536 种）');
    const bad = ids.filter((id) => !JOB_ID.test(id));
    assert.deepEqual(bad, [], 'jobId 必须是 j- + v4 UUID；不合形状的样例：' + JSON.stringify(bad.slice(0, 3)));
  } finally { fs.rmSync(s.tmp, { recursive: true, force: true }); }
});

test('DF-3A 红锚：旧写法（j- + Math.random 4 位 hex）在固定种子下必然碰撞、且不满足 UUID 形状', () => {
  // 固定种子的 mulberry32 复现"旧实现"的取值方式（取值空间 16^4 = 65536）
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const seen = new Set();
  let firstDup = -1;
  for (let i = 0; i < 5000 && firstDup < 0; i++) {
    const id = 'j-' + rnd().toString(16).slice(2, 6);
    if (seen.has(id)) firstDup = i; else seen.add(id);
  }
  assert.ok(firstDup > 0, '旧写法在固定种子下必然撞（实得第 ' + firstDup + ' 次）—— 这正是本卡要修的东西');
  assert.doesNotMatch('j-1a2b', JOB_ID, '旧写法连 UUID 形状都不满足（形状断言对旧实现必然红）');
});

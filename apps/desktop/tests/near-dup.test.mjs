// apps/desktop/tests/near-dup.test.mjs —— PHASH-1b 结果呈现（U39 口径 B）：近重复标注
//
// 三条口径逐条钉住：
//   ① 阈值边界：k=10 ⇒ 距离 10 算近重复、11 不算（0 也算）；
//   ② **未知 ≠ 不同**：查询图或结果图没有 phash ⇒ phashDistance=null、nearDuplicate=false；
//   ③ 只标注：不修改入参、不改分数/排序；读 phash 由调用方注入（本测试用假 reader）。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { annotateNearDuplicates } from '../src/main/near-dup.ts';
import { PHASH_NEAR_DUP_K } from '../src/main/phash.ts';

const ZERO = '0'.repeat(16);
/** 置位 n 个 bit 的 hex（从最低位开始；n ≤ 64） */
function bitsOn(n) {
  let v = 0n;
  for (let i = 0; i < n; i++) v |= 1n << BigInt(i);
  return v.toString(16).padStart(16, '0');
}

test('N1 ⭐⭐ 阈值边界：k=默认 10 ⇒ 距离 0/10 是近重复，11 不是', () => {
  assert.equal(PHASH_NEAR_DUP_K, 10, '阈值来自生产解码复核（reports/2026-10-19-phash-k）');
  const rows = [
    { uid: 'a', libId: 'L1' },
    { uid: 'b', libId: 'L1' },
    { uid: 'c', libId: 'L1' },
  ];
  const stored = new Map([
    ['a', ZERO], // 距离 0
    ['b', bitsOn(10)], // 距离 10
    ['c', bitsOn(11)], // 距离 11
  ]);
  const out = annotateNearDuplicates(rows, ZERO, (_lib, uid) => stored.get(uid) ?? null);
  assert.deepEqual(
    out.map((r) => r.phashDistance),
    [0, 10, 11],
  );
  assert.deepEqual(
    out.map((r) => r.nearDuplicate),
    [true, true, false],
  );
});

test('N2 ⭐⭐ 未知 ≠ 不同：结果没有 phash（或查询图没有）⇒ null + false，且不调用 reader', () => {
  const calls = [];
  const reader = (lib, uid) => {
    calls.push(lib + '/' + uid);
    return null;
  };
  const out = annotateNearDuplicates([{ uid: 'x', libId: 'L1' }], ZERO, reader);
  assert.equal(out[0].phashDistance, null, '没算出来必须是 null（不是 0、不是 64）');
  assert.equal(out[0].nearDuplicate, false, '未知不许说成"不重复"的结论，但也不许说成近重复');

  calls.length = 0;
  for (const badQuery of [null, '', 'zz', '0'.repeat(15)]) {
    const rows = annotateNearDuplicates([{ uid: 'x', libId: 'L1' }], badQuery, reader);
    assert.equal(rows[0].phashDistance, null);
    assert.equal(rows[0].nearDuplicate, false);
  }
  assert.equal(calls.length, 0, '查询图没有合法哈希时，不该去查结果的 phash（省一次 DB 读）');
});

test('N3 ⭐ 只标注：不修改入参、不改变顺序，字段是"追加"', () => {
  const rows = [
    { uid: 'b', libId: 'L1', score: 0.5 },
    { uid: 'a', libId: 'L1', score: 0.9 },
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const out = annotateNearDuplicates(rows, ZERO, (_lib, uid) => (uid === 'a' ? ZERO : null));
  assert.deepEqual(rows, snapshot, '入参必须原样（Order/Score/字段都不许被改）');
  assert.deepEqual(
    out.map((r) => r.uid),
    ['b', 'a'],
    '顺序是引擎给的，标注不许重排',
  );
  assert.equal(out[1].nearDuplicate, true);
  assert.equal(out[1].score, 0.9, '原字段原样带回');
});

test('N4 多库：reader 收到的是**该行自己的** libId/uid（不串库）', () => {
  const seen = [];
  const reader = (lib, uid) => {
    seen.push([lib, uid]);
    return uid === 'u1' ? ZERO : null;
  };
  const out = annotateNearDuplicates(
    [
      { uid: 'u1', libId: 'L1' },
      { uid: 'u2', libId: 'L2' },
    ],
    ZERO,
    reader,
  );
  assert.deepEqual(seen, [
    ['L1', 'u1'],
    ['L2', 'u2'],
  ]);
  assert.deepEqual(
    out.map((r) => r.nearDuplicate),
    [true, false],
  );
});

test('N5 可注入阈值（测试/将来调参）：k=0 时只有完全相同才算近重复', () => {
  const out = annotateNearDuplicates(
    [
      { uid: 'same', libId: 'L1' },
      { uid: 'one', libId: 'L1' },
    ],
    ZERO,
    (_lib, uid) => (uid === 'same' ? ZERO : bitsOn(1)),
    0,
  );
  assert.deepEqual(
    out.map((r) => r.nearDuplicate),
    [true, false],
  );
});

test('N6 空结果 / 缺 uid 的行：安全返回，不抛', () => {
  assert.deepEqual(
    annotateNearDuplicates([], ZERO, () => null),
    [],
  );
  const out = annotateNearDuplicates([{}], ZERO, () => ZERO);
  assert.equal(out[0].phashDistance, null, '缺 uid/libId ⇒ 无法查库 ⇒ 未知');
  assert.equal(out[0].nearDuplicate, false);
});

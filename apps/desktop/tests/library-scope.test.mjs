// apps/desktop/tests/library-scope.test.mjs —— U32：**范围**与**写落点**必须是两个变量
//
// 依据：TASKS.md U32「认同」。理由：混成一个变量会出现
//   「在『全部库』范围下点收/重建，东西收到哪去了？」这种含糊 —— 这是**写操作的可解释性**问题。
//
// 本文件测的是**纯函数**（utils/library-scope.ts），所以判据能红、能复跑，不靠人点。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideWriteGate,
  deriveReadScope,
  deriveWriteTarget,
  describeScope,
  describeWriteTarget,
} from '../src/renderer/src/utils/library-scope.ts';

/** 造 libraryConfig 载荷（只写本模块用到的字段） */
const cfg = (libraries, chosen = null) => ({ libraries, chosen });
const L1 = { libId: 'L1', root: 'C:\\libs\\L1', available: true };
const L2 = { libId: 'L2', root: 'C:\\libs\\L2', available: true };
const L_BAD = {
  libId: 'LB',
  root: 'C:\\libs\\LB',
  available: false,
  unavailableReason: '库根不见了',
};

// ============================================================ U32-a 两个变量是两件事
test('U32-a 多库且未指定 ⇒ **范围**有默认视野，但**写落点**未定（两个状态不一致）', () => {
  const data = cfg([L1, L2]);
  const scope = deriveReadScope(data);
  const target = deriveWriteTarget(data);

  // 范围可以"有个默认视野"（读错了再读一次就行）
  assert.equal(scope.kind, 'lib');
  assert.equal(scope.libId, 'L1');
  // 写落点**不许猜**（多库又没指定 ⇒ 未定）
  assert.equal(target, null);

  // ⭐ 这就是 U32 的核心：两者**不是同一个值**。合并成一个变量时这条断言必红。
  assert.notEqual(scope.kind === 'lib' ? scope.libId : null, target && target.libId);
});

// ============================================================ U32-b 组合约束（能红的关键判据）
test('U32-b 组合约束：scope=全部库 且 writeTarget 未定 ⇒ 写操作**不可执行**且提示选目标库', () => {
  const gate = decideWriteGate({ kind: 'all' }, null);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /目标库/);
  assert.match(gate.reason, /全部库/);
});

test('U32-b2 边界：scope 是具体库、但 writeTarget 仍未定 ⇒ 一样不可执行（判据只看 target）', () => {
  const gate = decideWriteGate(
    { kind: 'lib', libId: 'L1', root: '', available: true, unavailableReason: null },
    null,
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /目标库|素材库/);
});

test('U32-b3 scope=全部库 + 落点明确 ⇒ **允许**（scope 不会把落点变成"全部"）', () => {
  const gate = decideWriteGate(
    { kind: 'all' },
    { libId: 'L2', root: '', available: true, unavailableReason: null },
  );
  assert.equal(gate.allowed, true);
});

// ============================================================ U32-c 能红：合并回一个变量
//
// 「能红」的做法**不是**写一条注定失败的断言（那只会让套件变红），而是：
//   用**同一条判据**去考一个"合并版"实现，证明它给出**相反的答案**。
//   ⇒ 谁要是把两个变量合并回去，U32-b 的断言（allowed === false）就会实测成 true ⇒ **必红**。
test('U32-c 能红：把范围与落点**合并回一个变量** ⇒ 同一条判据给出相反答案（必红）', () => {
  const data = cfg([L1, L2]); // 多库、用户没指定

  // ⚠️ 「合并版」参照实现 —— 正是 U32 之前那种写法：
  //    一个 lib 同时当范围与落点（多库时取第一个可用的 ⇒ **替用户挑了落点**）。
  const merged = () => {
    const s = deriveReadScope(data);
    const libId = s.kind === 'lib' ? s.libId : null;
    return {
      scope: s,
      target: libId ? { libId, root: '', available: true, unavailableReason: null } : null,
    };
  };

  const m = merged();
  // 合并版把落点**自动填成了 L1** —— 用户从没指定过它
  assert.equal(m.target && m.target.libId, 'L1');

  // 真实实现（两个变量）在同一份数据上：落点**未定**
  const realScope = deriveReadScope(data);
  const realTarget = deriveWriteTarget(data);
  assert.equal(realTarget, null);

  // ⭐ 同一条判据，两种实现给出**相反**的答案：
  const mergedGate = decideWriteGate(m.scope, m.target);
  const realGate = decideWriteGate(realScope, realTarget);
  assert.equal(mergedGate.allowed, true, '合并版把"没指定"悄悄变成了 L1 ⇒ 写操作被放行');
  assert.equal(realGate.allowed, false, '两变量版：多库未指定 ⇒ 写操作被拒（U32-b 的判据）');

  // ⇒ 这就是"能红"：把两者合并回去，U32-b 的 allowed===false 会实测成 true。
  assert.notEqual(
    mergedGate.allowed,
    realGate.allowed,
    '同一条判据必须能区分"两个变量"与"一个变量"',
  );
});

// ============================================================ U32-d 单库：无回归
test('U32-d 单库 ⇒ 范围与落点都是它，写操作放行（不制造无谓阻塞）', () => {
  const data = cfg([L1]);
  const scope = deriveReadScope(data);
  const target = deriveWriteTarget(data);
  assert.equal(scope.kind, 'lib');
  assert.equal(scope.libId, 'L1');
  assert.equal(target && target.libId, 'L1');
  assert.equal(decideWriteGate(scope, target).allowed, true);
});

// ============================================================ U32-e chosen 优先 / 不可用不写
test('U32-e chosen 指定的可用库 ⇒ 落点就是它（用户指定过，不算猜）', () => {
  const data = cfg([L1, L2], 'L2');
  assert.equal(deriveWriteTarget(data)?.libId, 'L2');
});

test('U32-e2 chosen 指向**不可用**的库 + 还有别的可用库 ⇒ 落点仍是 **null**（不许写进不可用库）', () => {
  const data = cfg([L_BAD, L2], 'LB');
  assert.equal(deriveWriteTarget(data), null);
  // 而范围可以退到可用的那个（读是安全的）
  const scope = deriveReadScope(data);
  assert.equal(scope.kind === 'lib' ? scope.libId : null, 'L2');
  assert.equal(decideWriteGate(scope, deriveWriteTarget(data)).allowed, false);
});

test('U32-e3 chosen 的库不可用、且全库只有它 ⇒ 落点为 null，闸门给出"不可用"原因', () => {
  const data = cfg([L_BAD], 'LB');
  assert.equal(deriveWriteTarget(data), null);
  const gate = decideWriteGate(
    { kind: 'lib', libId: 'LB', root: '', available: false, unavailableReason: '库根不见了' },
    null,
  );
  assert.equal(gate.allowed, false);
});

// ============================================================ U32-f 两处各自可见（不兼职）
test('U32-f 界面两处文案**各自独立**：范围说 L1，落点说"未定"', () => {
  const data = cfg([L1, L2]);
  const scope = deriveReadScope(data);
  const target = deriveWriteTarget(data);
  assert.equal(describeScope(scope), 'L1');
  assert.match(describeWriteTarget(target), /未定/);
  // 不许一个变量兼职 ⇒ 两个文案不相等
  assert.notEqual(describeScope(scope), describeWriteTarget(target));
});

test('U32-f2 无库 ⇒ 范围是「全部库」、落点是「未定」、写被拒', () => {
  const data = cfg([]);
  const scope = deriveReadScope(data);
  assert.equal(scope.kind, 'all');
  assert.equal(describeScope(scope), '全部库');
  assert.equal(deriveWriteTarget(data), null);
  assert.equal(decideWriteGate(scope, null).allowed, false);
});

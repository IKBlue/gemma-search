// apps/desktop/tests/single-flight.test.mjs —— T-41：并发只允许一次（修的是真 bug，不是观感）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlight } from '../src/main/single-flight.ts';

/** 可控的 factory：计数 + 手动 resolve/reject */
function makeFactory() {
  let settle = null;
  const state = { calls: 0, reject: null };
  const factory = () => {
    state.calls++;
    return new Promise((res, rej) => {
      settle = { res, rej };
    });
  };
  return {
    factory,
    state,
    settleNow: () => settle,
    get calls() {
      return state.calls;
    },
  };
}

test('S1 ⭐ 并发 3 次 ⇒ factory 只被调用 1 次，且三个调用方拿到同一个值', async () => {
  const f = makeFactory();
  const flight = createSingleFlight();
  const a = flight.run(f.factory);
  const b = flight.run(f.factory);
  const c = flight.run(f.factory);
  assert.equal(f.state.calls, 1, '并发期间只能有一次载入');
  assert.equal(f.state.calls, 1);
  f.settleNow().res('loaded');
  assert.deepEqual(await Promise.all([a, b, c]), ['loaded', 'loaded', 'loaded']);
});

test('S2 进行中时 inFlight() = true，settle 后 = false', async () => {
  const f = makeFactory();
  const flight = createSingleFlight();
  assert.equal(flight.inFlight(), false);
  const p = flight.run(f.factory);
  assert.equal(flight.inFlight(), true);
  f.settleNow().res(1);
  await p;
  assert.equal(flight.inFlight(), false);
});

test('S3 settle 之后清空 ⇒ 下一次调用会**重新**执行 factory（不是永久缓存）', async () => {
  let n = 0;
  const flight = createSingleFlight();
  const factory = async () => {
    n++;
    return n;
  };
  assert.equal(await flight.run(factory), 1);
  assert.equal(await flight.run(factory), 2, '上一次结束后，新调用应当重新跑');
  assert.equal(n, 2);
});

test('S4 ⭐ 并发失败：factory 只跑 1 次，所有调用方拿到同一个错误（且无 unhandledRejection）', async () => {
  const f = makeFactory();
  const flight = createSingleFlight();
  const a = flight.run(f.factory);
  const b = flight.run(f.factory);
  const boom = new Error('载入失败');
  f.settleNow().rej(boom);
  const got = await Promise.allSettled([a, b]);
  assert.equal(f.state.calls, 1);
  assert.deepEqual(
    got.map((g) => g.status),
    ['rejected', 'rejected'],
  );
  assert.equal(got[0].reason, boom);
  assert.equal(got[1].reason, boom, '同一个错误对象，不是各抛一份');
});

test('S5 失败后已清空 ⇒ 下一次会重试（失败缓存留给调用方决定）', async () => {
  let n = 0;
  const flight = createSingleFlight();
  const factory = async () => {
    n++;
    if (n === 1) throw new Error('第一次失败');
    return 'ok';
  };
  await assert.rejects(() => flight.run(factory));
  assert.equal(await flight.run(factory), 'ok');
  assert.equal(n, 2);
});

test('S6 串行调用不会复用（每次都真的跑）', async () => {
  let n = 0;
  const flight = createSingleFlight();
  const factory = async () => ++n;
  for (let i = 1; i <= 3; i++) assert.equal(await flight.run(factory), i);
  assert.equal(n, 3);
});

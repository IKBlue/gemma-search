// apps/desktop/tests/app-health-store.test.mjs —— U27：界面对 appHealth 的**用法**（Operation 层）
//
// 为什么单独一份：`store/app-health.ts` 里那三个纯函数是**文案判据**（入口写什么、面板写什么、时间怎么显示），
// 它们不该靠 e2e 才能验证（e2e 只能证明某一刻的某个字符串）。
// 这里钉两条最容易做错的口径：
//   AS1 **健康时也有话说**（不是空白；空白会被读成「没做这件事」）；
//   AS2 **不夸大**：查询失败时**不许**把「读不到」显示成「正常」（那正是本项目禁止的「红色扮绿」）。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  useAppHealthStore,
  entryText,
  healthLine,
  firstAtText,
  shouldKeepPolling,
} from '../src/renderer/src/store/app-health.ts';

const S = () => useAppHealthStore.getState();
let savedWindow;
beforeEach(() => {
  savedWindow = globalThis.window;
  S().__reset();
  globalThis.window = undefined;
});
afterEach(() => {
  globalThis.window = savedWindow;
});

const healthy = { unhealthy: false, count: 0, reason: null, firstAt: null };
const bad = {
  unhealthy: true,
  count: 2,
  reason: 'Error: injected-boom',
  firstAt: '2026-10-16T02:30:00.000Z',
};

test('AS1 ⭐ 顶栏入口：健康时「诊断」，不健康时「诊断 · N」（数字让「有点怪」变成可核对的事实）', () => {
  assert.equal(entryText(healthy), '诊断');
  assert.equal(entryText(null), '诊断', '还没读到 ⇒ 也显示普通入口（不显示成出过事）');
  assert.equal(entryText(bad), '诊断 · 2');
  assert.equal(
    entryText({ ...bad, count: 0 }),
    '诊断 · 1',
    '状态说不健康却没有计数 ⇒ 至少显示 1，不显示 0',
  );
});

test('AS2 ⭐⭐ 面板那行：健康时**也有话说**；不健康时给次数', () => {
  assert.match(
    healthLine(healthy),
    /没有出现过未处理异常/,
    '健康时不能是空白（空白 = 没做这件事）',
  );
  assert.match(healthLine(null), /没有出现过未处理异常/);
  assert.equal(healthLine(bad), '本次运行出现过未处理异常，共 2 次。');
});

test('AS3：首条时间 —— ISO 转本地；认不出来就原样显示（不猜一个时间），空值给破折号', () => {
  assert.equal(firstAtText(null), '—');
  assert.equal(firstAtText(''), '—');
  assert.equal(firstAtText('不是时间'), '不是时间', '解析不了 ⇒ 原样，而不是编一个「刚刚」');
  const iso = '2026-10-16T02:30:00.000Z';
  assert.equal(firstAtText(iso), new Date(Date.parse(iso)).toLocaleString());
});

test('AS6 ⭐⭐ 重查判据：**命中即停**（已经拿到不健康 + 原因就不再查），其余情况继续查', () => {
  assert.equal(shouldKeepPolling(null), true, '还没读到 ⇒ 继续查（否则永远看不见出事）');
  assert.equal(shouldKeepPolling(healthy), true, '读到但健康 ⇒ 继续查');
  assert.equal(shouldKeepPolling(bad), false, '已经拿到不健康 + 原因 ⇒ 停（结论稳定，不必再采样）');
  assert.equal(
    shouldKeepPolling({ ...bad, reason: null }),
    true,
    '不健康但还没有原因（状态半截）⇒ 继续查，别停在一个说不清的状态上',
  );
});

test('AS4 ⭐ 查询：成功时把四样事实收进状态（不在这里二次加工）', async () => {
  globalThis.window = {
    api: {
      invoke: async () => ({ ok: true, data: bad, warnings: [] }),
      onEvent: () => () => {},
      platform: 'win32',
    },
  };
  await S().load();
  assert.equal(S().error, null);
  assert.deepEqual(S().data, bad);
});

test('AS5 ⭐⭐ 查询失败 ⇒ 如实报错，且**不许**把「读不到」当成「正常」', async () => {
  // 没有 window.api ⇒ Adapter 给 NO_BRIDGE（userMessage 非空）
  await S().load();
  assert.equal(S().error.code, 'NO_BRIDGE');
  assert.equal(S().data, null, '读不到就必须是 null —— 界面据此才不敢说「正常」');
  // 反证：把 null 当成健康去渲染，会得到一句**没有依据的**「没出过事」
  assert.match(
    healthLine(S().data),
    /没有出现过未处理异常/,
    '（说明为什么不能在 error 时渲染这一行）',
  );
});

// apps/desktop/tests/search-store.test.mjs —— Zustand 检索 store 的单测（T2）
//
// 为什么能这么测：`store/search.js` **不 import React**（Zustand 的 vanilla store 在纯 Node 里就能跑），
// 而 `invoke` 来自 Adapter —— Adapter 在调用时才读 `globalThis.window.api`，
// 所以给个假 bridge 就能把 `run()` 完整跑一遍，包括失败路径。
//
// 本文件要钉住的是**行为**，不是"store 存在"：
//   · 状态切换**真的生效**（不是只注册了一个 store）
//   · `run()` 的参数拼装正确（'全部' → 四个目录）
//   · 校验失败**不发 IPC**（否则会白跑一次引擎）
//   · 失败/成功两条路的 state 与**给用户的文案**
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useSearchStore, sortResults, FOLDERS, CHIPS } from '../src/renderer/src/store/search.ts';

const S = () => useSearchStore.getState();

/** 假 bridge：记录调用，按脚本作答 */
function fakeBridge(reply) {
  const calls = [];
  globalThis.window = {
    api: {
      invoke: async (method, params) => {
        calls.push({ method, params });
        return reply(method, params);
      },
      onEvent: () => () => {},
      platform: 'win32',
    },
  };
  return calls;
}
const OK = (data) => ({ ok: true, data });
const FAIL = (error) => ({ ok: false, error });

let savedWindow;
beforeEach(() => {
  savedWindow = globalThis.window;
  S().__reset();
  globalThis.window = undefined;
});
afterEach(() => {
  globalThis.window = savedWindow;
});

// ============================================================ 状态切换真的生效

test('Z1：⭐ 状态切换真的生效（不是只注册了 store）', () => {
  assert.equal(S().folder, '全部');
  S().setFolder('VR');
  assert.equal(S().folder, 'VR');
  S().setQuery('玻璃球吊灯');
  assert.equal(S().query, '玻璃球吊灯');
  S().setSort('name');
  assert.equal(S().sort, 'name');
  S().setMode('image');
  assert.equal(S().mode, 'image');
  S().setQueryImagePath('X:\\tmp\\a.jpg');
  assert.equal(S().queryImagePath, 'X:\\tmp\\a.jpg');
  // 传空 ⇒ 归 null（不要留下 '' 这种"看着有值其实没有"的状态）
  S().setQueryImagePath('');
  assert.equal(S().queryImagePath, null);
});

test('Z2：clear 只清本次检索，不动 mode/imagePath（用户的选择不该被清掉）', () => {
  S().setMode('image');
  S().setQueryImagePath('X:\\a.jpg');
  S().setFolder('CR');
  S().setQuery('x');
  useSearchStore.setState({ rawResults: [{ uid: 'a' }], error: { code: 'E' }, meta: '3 条' });
  S().clear();
  assert.equal(S().rawResults, null);
  assert.equal(S().error, null);
  assert.equal(S().meta, '');
  assert.equal(S().query, '');
  assert.equal(S().mode, 'image', 'mode 是用户的选择，不该被 clear 清掉');
  assert.equal(S().queryImagePath, 'X:\\a.jpg', '参考图也不该被清掉');
  assert.equal(S().folder, 'CR', '筛选同理');
});

// ============================================================ 排序（纯函数）

test('Z3：sortResults —— score 降序 / name 升序 / recent 原序 / null 原样返回', () => {
  const list = [
    { stem: 'b', score: 0.5 },
    { stem: 'a', score: 0.9 },
    { stem: 'c', score: 0.7 },
  ];
  assert.deepEqual(
    sortResults(list, 'score').map((x) => x.stem),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(
    sortResults(list, 'name').map((x) => x.stem),
    ['a', 'b', 'c'],
  );
  // recent 目前不重排（要索引提供 mtime，P3b 才补）—— 但**不能抛**，也不能乱序
  assert.deepEqual(
    sortResults(list, 'recent').map((x) => x.stem),
    ['b', 'a', 'c'],
  );
  assert.equal(sortResults(null, 'score'), null, 'null 要原样返回（界面靠它区分"没搜过"）');
  // 不改原数组
  const before = list.map((x) => x.stem);
  sortResults(list, 'name');
  assert.deepEqual(
    list.map((x) => x.stem),
    before,
    'sortResults 不许就地改传入的数组',
  );
});

test('Z4：FOLDERS / CHIPS 是同一份定义（P1：别处不许再抄一遍）', () => {
  assert.deepEqual(FOLDERS, ['VR', 'CR', 'CR+VR', '其他']);
  assert.deepEqual(CHIPS, ['全部', ...FOLDERS, '未分类']);
});

// ============================================================ run()：参数拼装

test('Z5：⭐ run() 的筛选参数：「全部」发四个目录，单选发一个', async () => {
  // ⚠️ 必须先给 query：空查询会被校验挡下、**根本不发 IPC**（见 Z8）——
  // 一开始漏了这句，本条直接失败，正说明那条校验是真的。
  let calls = fakeBridge(() => OK({ results: [], tookMs: 1 }));
  S().setQuery('灯');
  await S().run();
  assert.deepEqual(calls[0].params.filters, { folders: FOLDERS });

  calls = fakeBridge(() => OK({ results: [], tookMs: 1 }));
  S().setFolder('VR');
  await S().run();
  assert.deepEqual(calls[0].params.filters, { folders: ['VR'] });
});

test('Z6：run() 成功 ⇒ 存结果与耗时、busy 归 false', async () => {
  fakeBridge(() => OK({ results: [{ uid: 'a' }, { uid: 'b' }], tookMs: 42 }));
  S().setQuery('灯');
  await S().run();
  assert.equal(S().busy, false);
  assert.equal(S().rawResults.length, 2);
  assert.match(S().meta, /2 条 · 42 ms/);
  assert.equal(S().error, null);
});

test('Z7：⭐ run() 失败 ⇒ error 是**已归一化的信封**、rawResults 变 []（而不是留着旧结果）', async () => {
  useSearchStore.setState({ rawResults: [{ uid: 'stale' }] });
  fakeBridge(() => FAIL({ code: 'LIB_NOT_FOUND', message: 'm', userMessage: '找不到这个库。' }));
  S().setQuery('灯');
  await S().run();
  assert.equal(S().busy, false);
  assert.equal(S().error.code, 'LIB_NOT_FOUND');
  assert.equal(S().error.userMessage, '找不到这个库。');
  assert.deepEqual(S().rawResults, [], '失败时不能留着上一次的结果（会让人以为搜到了）');
  assert.equal(S().meta, '');
});

// ============================================================ run()：校验

test('Z8：⭐ 空查询 / 缺参考图 **不发 IPC**（白跑一次引擎是有代价的）', async () => {
  const calls = fakeBridge(() => OK({ results: [] }));
  const toasts = [];

  S().setQuery('   '); // 只有空白
  await S().run((m) => toasts.push(m));
  assert.equal(calls.length, 0, '空查询不该发 IPC');
  assert.deepEqual(toasts, ['请输入要查找的内容']);

  S().setMode('image'); // 图像模式但没选图
  await S().run((m) => toasts.push(m));
  assert.equal(calls.length, 0, '没选参考图不该发 IPC');
  assert.deepEqual(toasts, ['请输入要查找的内容', '请先选择一张参考图']);
});

test('Z9：busy 时重复调用被挡住（不会并发发两次检索）', async () => {
  let resolveIt;
  globalThis.window = {
    api: {
      invoke: () =>
        new Promise((res) => {
          resolveIt = () => res(OK({ results: [], tookMs: 1 }));
        }),
      onEvent: () => () => {},
      platform: 'win32',
    },
  };
  S().setQuery('灯');
  const first = S().run();
  await S().run(); // busy=true ⇒ 立即返回，不会覆盖
  resolveIt();
  await first;
  assert.equal(S().busy, false);
});

// ============================================================ 文案（含 F-01 的措辞）

test('Z10：⭐ reveal 成功文案**不许**写成「已定位」（F-01 复核的 R-1）', async () => {
  fakeBridge(() => OK({ revealed: true }));
  const toasts = [];
  await S().reveal({ libId: 'L1', uid: 'a' }, (m, t) => toasts.push([m, t]));
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /已请求在资源管理器中定位/);
  assert.match(toasts[0][0], /系统未回报结果/, '必须说明系统没回报结果');
  assert.ok(
    !/已在资源管理器中定位|已定位/.test(toasts[0][0]),
    `不许出现「已定位」：${toasts[0][0]}`,
  );
  assert.equal(toasts[0][1], 'info');
});

test('Z11：reveal 失败 / collect 成败 的文案都来自 userMessage', async () => {
  fakeBridge(() =>
    FAIL({ code: 'ITEM_MISSING_ON_DISK', message: 'm', userMessage: '文件不在盘上了。' }),
  );
  const t1 = [];
  await S().reveal({ libId: 'L1', uid: 'a' }, (m, t) => t1.push([m, t]));
  assert.deepEqual(t1, [['文件不在盘上了。', 'err']]);

  fakeBridge(() => OK({ succeeded: ['a'], skipped: [], failed: [], targetDir: 'E:\\素材待用' }));
  const t2 = [];
  await S().collect({ libId: 'L1', uid: 'a' }, (m, t) => t2.push([m, t]));
  assert.match(t2[0][0], /成功 1 · 跳过 0 · 失败 0/);
  assert.equal(t2[0][1], 'info');

  // 有失败项 ⇒ tone 变 err（不能把部分失败说成成功）
  fakeBridge(() => OK({ succeeded: ['a'], skipped: [], failed: ['b'], targetDir: 'E:\\素材待用' }));
  const t3 = [];
  await S().collect({ libId: 'L1', uid: 'a' }, (m, t) => t3.push([m, t]));
  assert.equal(t3[0][1], 'err');
});

test('Z12：没给 onToast 也不该抛（状态层不依赖界面）', async () => {
  fakeBridge(() => OK({ results: [], tookMs: 1 }));
  S().setQuery('灯');
  await assert.doesNotReject(() => S().run());
  await assert.doesNotReject(() => S().reveal({ libId: 'L1', uid: 'a' }));
  await assert.doesNotReject(() => S().collect({ libId: 'L1', uid: 'a' }));
});

// ============================================================ 破坏性操作的确认（T4）
//
// `collect` 会**写文件**（复制/移动进取件目录）。T4 之前点一下就直接执行、**没有任何确认**。
// 现在走"请求 → 确认"两步，状态在 store 里 ⇒ **"取消 ⇒ 一个 IPC 都没发"是可断言的**，
// 不必靠人点着看。这一条是验收 #1 里能自动化的那一半。

test('Z13：⭐ requestCollect **只记下来、不发任何 IPC**（确认框弹出前不许动文件）', () => {
  const calls = fakeBridge(() => OK({}));
  const item = { libId: 'L1', uid: 'a', stem: 'ID-1' };
  S().requestCollect(item);
  assert.equal(S().pendingCollect, item);
  assert.equal(calls.length, 0, '请求阶段绝不能发 IPC —— 那是破坏性操作');
});

test('Z14：⭐ cancelCollect ⇒ 动作**未执行**（一个 IPC 都没发，待确认项被丢弃）', () => {
  const calls = fakeBridge(() =>
    OK({ succeeded: [], skipped: [], failed: [], targetDir: 'E:\\x' }),
  );
  S().requestCollect({ libId: 'L1', uid: 'a' });
  S().cancelCollect();
  assert.equal(S().pendingCollect, null);
  assert.equal(calls.length, 0, '取消之后不许有任何 IPC');
});

test('Z15：⭐ confirmCollect 真的执行；且**先清状态再执行** ⇒ 连点两次只发一次 IPC', async () => {
  const calls = fakeBridge(() =>
    OK({ succeeded: ['a'], skipped: [], failed: [], targetDir: 'E:\\素材待用' }),
  );
  S().requestCollect({ libId: 'L1', uid: 'a' });

  const first = S().confirmCollect();
  // 确认后状态立刻被清（防连点）—— 这是"重复搬同一套素材"的防线
  assert.equal(S().pendingCollect, null, '确认后必须立刻清掉待确认项');
  await S().confirmCollect(); // 第二次调用：没有待确认项 ⇒ 什么都不做
  await first;

  assert.equal(calls.length, 1, '两次 confirmCollect 只该发一次 IPC');
  assert.equal(calls[0].method, 'collect');
  assert.deepEqual(calls[0].params, { libId: 'L1', uids: ['a'] });
});

test('Z16：没有待确认项时 confirmCollect 是**空操作**（防误调）', async () => {
  const calls = fakeBridge(() => OK({}));
  await S().confirmCollect();
  assert.equal(calls.length, 0);
});

test('Z17：确认框的内容来自真实结果项（标题不是编的）', () => {
  // SearchPage 用 pendingCollect.stem 拼标题；这里钉住"状态里存的是那一项本身"
  const item = { libId: 'L2', uid: 'zzz', stem: 'VR-42' };
  S().requestCollect(item);
  assert.equal(S().pendingCollect.stem, 'VR-42');
  assert.equal(S().pendingCollect.libId, 'L2');
});

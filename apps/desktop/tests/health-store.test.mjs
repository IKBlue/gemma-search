// apps/desktop/tests/health-store.test.mjs —— T-15b：体检 / 重建 状态机的单测（node:test，无 DOM）
//
// 为什么能这么测：`store/health.ts` **不 import React**（Zustand 的 vanilla store 在纯 Node 里就能跑），
// 而 `invoke` 来自 Adapter —— 它在调用时才读 `globalThis.window.api`，所以给个假 bridge 就能把
// 成功 / 失败 / 取消三条路完整跑一遍（与 `search-store.test.mjs` 同一套办法）。
//
// 这一组要钉的是**行为**，尤其是**破坏性操作的两段式**（AGENTS §5.3）：
//   HZ3 取消 ⇒ 一个 IPC 都不发      —— 界面上点「取消」，主进程不该看到任何 libraryRebuild
//   HZ4 连点两次确认 ⇒ 只发一次     —— 先清 pending 再执行
//   HZ5 执行期间 phase=running      —— 页面据此显示「正在重建元数据…」（SPEC §2.3，不许装作没事）
//   HZ6 完成后**自动复检一次**      —— 用同一条只读方法，不自己把 report 的 after 当结论硬塞
//   HZ2 失败文案 = Adapter 的 userMessage —— 界面不许自造第二份兜底（L6 的机械判据是源码级，这里是行为级）
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  useHealthStore,
  decideRebuildGate,
  checkLabel,
  rebuildSummary,
} from '../src/renderer/src/store/health.ts';
import { resolveLibrary } from '../src/renderer/src/utils/library-root.ts';

const S = () => useHealthStore.getState();

/** 假 bridge：记录调用，按脚本作答（与 search-store.test.mjs 同口径） */
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
const callsOf = (calls, method) => calls.filter((c) => c.method === method);

let savedWindow;
beforeEach(() => {
  savedWindow = globalThis.window;
  S().__reset();
  globalThis.window = undefined;
});
afterEach(() => {
  globalThis.window = savedWindow;
});

/** 一份健康结论（形状照主进程 `LibraryHealthReport` 抄；**测试里只造数据，不造第二份判定**） */
function healthReport(over = {}) {
  return Object.assign(
    {
      libId: 'L1',
      root: 'X:\\lib',
      dbPath: 'X:\\lib\\.gs.db',
      indexPath: 'X:\\lib\\.gs-index.bin',
      checks: [
        {
          id: 'library-root',
          ok: true,
          code: '',
          reason: '库根是目录：X:\\lib',
          rebuildable: false,
        },
        { id: 'items-file', ok: true, code: '', reason: '条目表存在', rebuildable: false },
        { id: 'index', ok: true, code: '', reason: '索引通过引擎五道校验', rebuildable: false },
        { id: 'db-file', ok: true, code: '', reason: '.gs.db 存在', rebuildable: false },
      ],
      ok: true,
      needsDbRebuild: false,
      needsIndexRebuild: false,
      reason: '自检通过（4 项）',
    },
    over,
  );
}

/** 一份**坏**结论：db-file 缺（可重建），索引是好的 */
function brokenDbReport() {
  return healthReport({
    checks: [
      { id: 'library-root', ok: true, code: '', reason: '库根是目录', rebuildable: false },
      { id: 'index', ok: true, code: '', reason: '索引通过引擎五道校验', rebuildable: false },
      {
        id: 'db-file',
        ok: false,
        code: 'DB_MISSING',
        reason: '.gs.db 不存在：X:\\lib\\.gs.db —— 删库重建会把它建出来',
        rebuildable: true,
      },
    ],
    ok: false,
    needsDbRebuild: true,
    needsIndexRebuild: false,
    reason: '自检发现 1 项问题：db-file(DB_MISSING) ⇒ 可以删库重建',
  });
}

function rebuildReport(over = {}) {
  return Object.assign(
    {
      libId: 'L1',
      root: 'X:\\lib',
      dbPath: 'X:\\lib\\.gs.db',
      indexPath: 'X:\\lib\\.gs-index.bin',
      before: brokenDbReport(),
      removedDbFiles: ['X:\\lib\\.gs.db', 'X:\\lib\\.gs.db-wal'],
      created: true,
      schema: { fromVersion: 0, toVersion: 2, applied: [1, 2] },
      import: { dbCount: 3594, inserted: 3594, updated: 0, deleted: 0 },
      index: { action: 'kept', detail: '索引未改动', count: 3594, dim: 768 },
      after: healthReport(),
      dbOk: true,
      indexOk: true,
      ok: true,
      reason:
        '重建完成：删除 2 个 .gs.db 文件 → schema v0→v2 → 导入 3594 条 → 索引 kept；复检 通过（4 项）',
    },
    over,
  );
}

// ============================================================ 体检（只读）

test('HZ1：体检把主进程的**结构化结论**原样收下（每一步状态都要真的动）', async () => {
  const calls = fakeBridge(() => OK(healthReport()));
  assert.equal(S().phase, 'idle');
  const p = S().run('L1');
  assert.equal(S().phase, 'checking', '发起后必须立刻进 checking（界面据此显示「正在体检…」）');
  await p;
  assert.equal(S().phase, 'ready');
  assert.equal(S().report.ok, true);
  assert.equal(S().report.checks.length, 4);
  assert.equal(S().error, null);
  assert.deepEqual(
    calls.map((c) => c.method),
    ['libraryHealth'],
    '体检只准发这一条 IPC',
  );
  assert.deepEqual(calls[0].params, { libId: 'L1' }, '参数只能是 { libId }（契约 .strict()）');
});

test('HZ2：体检失败 ⇒ phase=error，且**弹的就是 Adapter 的 userMessage**（不自造第二份文案）', async () => {
  fakeBridge(() => FAIL({ code: 'LIB_NOT_FOUND', message: 'raw', userMessage: '未登记的库：L9' }));
  const toasts = [];
  await S().run('L9', (msg, tone) => toasts.push({ msg, tone }));
  assert.equal(S().phase, 'error');
  assert.equal(S().report, null);
  assert.equal(S().error.code, 'LIB_NOT_FOUND');
  assert.equal(S().error.userMessage, '未登记的库：L9');
  assert.deepEqual(
    toasts,
    [{ msg: '未登记的库：L9', tone: 'err' }],
    '提示文案必须是 Adapter 那一份，不许改写成别的句子',
  );
});

test('HZ2b：没有库时 `run` 直接提示、**一个 IPC 都不发**（不拿空 libId 去撞 zod）', async () => {
  const calls = fakeBridge(() => OK(healthReport()));
  const toasts = [];
  await S().run('', (msg, tone) => toasts.push({ msg, tone }));
  assert.deepEqual(calls, [], '空 libId 不该发 IPC');
  assert.equal(S().phase, 'idle');
  assert.equal(toasts.length, 1);
});

// ============================================================ 重建：两段式（AGENTS §5.3）

test('HZ3 ⭐ 取消 ⇒ **一个 IPC 都不发**（破坏性操作的第二段没点，就等于没发生）', async () => {
  const calls = fakeBridge((m) =>
    m === 'libraryHealth' ? OK(brokenDbReport()) : OK(rebuildReport()),
  );
  await S().run('L1');
  assert.equal(
    decideRebuildGate({ report: S().report, rebuildPhase: S().rebuildPhase }).allowed,
    true,
  );

  S().requestRebuild('L1');
  assert.deepEqual(S().pendingRebuild, { libId: 'L1' }, '请求阶段只记状态');
  assert.deepEqual(callsOf(calls, 'libraryRebuild'), [], '请求阶段**不许**发明细');

  S().cancelRebuild();
  assert.equal(S().pendingRebuild, null);
  assert.deepEqual(callsOf(calls, 'libraryRebuild'), [], '取消之后仍然一个 libraryRebuild 都没有');
  assert.equal(S().rebuildPhase, 'idle', '取消不该把状态推进到 running/done');
});

test('HZ4 ⭐ 连点两次确认 ⇒ 只发**一次** libraryRebuild（先清状态再执行）', async () => {
  const calls = fakeBridge((m) =>
    m === 'libraryHealth' ? OK(brokenDbReport()) : OK(rebuildReport()),
  );
  await S().run('L1');
  S().requestRebuild('L1');
  await Promise.all([S().confirmRebuild(), S().confirmRebuild()]);
  assert.equal(
    callsOf(calls, 'libraryRebuild').length,
    1,
    '第二次 confirm 因为 pending 已清而不该再发',
  );
});

test('HZ5 ⭐ 执行期间 rebuildPhase=running（页面据此显示「正在重建元数据」，SPEC §2.3）', async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const calls = fakeBridge(async (m) => {
    if (m === 'libraryHealth') return OK(brokenDbReport());
    await gate;
    return OK(rebuildReport());
  });
  await S().run('L1');
  S().requestRebuild('L1');
  const p = S().confirmRebuild();
  assert.equal(S().rebuildPhase, 'running', 'IPC 在途时必须处于 running');
  assert.equal(S().pendingRebuild, null, 'running 期间不该还留着 pending（否则确认框会重开）');
  release();
  await p;
  assert.equal(S().rebuildPhase, 'done');
  assert.equal(callsOf(calls, 'libraryRebuild').length, 1);
});

test('HZ6：重建成功后**自动复检一次**（并显示重建报告：删了什么 / 导入多少 / 索引处置）', async () => {
  const calls = fakeBridge((m) =>
    m === 'libraryHealth'
      ? OK(S().report && !S().report.ok ? healthReport() : brokenDbReport())
      : OK(rebuildReport()),
  );
  await S().run('L1'); // ① 第一次体检 ⇒ 坏
  assert.equal(S().report.needsDbRebuild, true);
  S().requestRebuild('L1');
  await S().confirmRebuild();
  assert.equal(S().rebuildPhase, 'done');
  assert.equal(S().reportAfterRebuild.ok, true);
  // 自动复检：第二次 libraryHealth 进来了，且 report 已经变成健康的那份
  const healthCalls = callsOf(calls, 'libraryHealth');
  assert.equal(healthCalls.length, 2, '体检 + 重建后复检各一次');
  assert.equal(S().report.ok, true, '复检结论来自同一条只读方法，不是把 report.after 硬塞进去');
  assert.match(
    rebuildSummary(S().reportAfterRebuild),
    /删除 2 个 \.gs\.db 文件/,
    '摘要要说清删了什么',
  );
  assert.match(rebuildSummary(S().reportAfterRebuild), /导入 3594 条/, '摘要要说清导入多少条');
  assert.match(rebuildSummary(S().reportAfterRebuild), /索引 kept/, '摘要要说清索引是保留还是重写');
});

test('HZ7：重建失败 ⇒ phase=error + rebuildError.userMessage（**不假装成功**，也不编文案）', async () => {
  fakeBridge((m) =>
    m === 'libraryHealth'
      ? OK(brokenDbReport())
      : FAIL({ code: 'LIB_ROOT_MISSING', message: 'raw', userMessage: '库根不存在或不是目录' }),
  );
  await S().run('L1');
  S().requestRebuild('L1');
  const toasts = [];
  await S().confirmRebuild((msg, tone) => toasts.push({ msg, tone }));
  assert.equal(S().rebuildPhase, 'error');
  assert.equal(S().rebuildError.userMessage, '库根不存在或不是目录');
  assert.equal(S().reportAfterRebuild, null, '失败不该留下「重建报告」');
  assert.deepEqual(toasts, [{ msg: '库根不存在或不是目录', tone: 'err' }]);
});

// ============================================================ 纯函数（门禁 / 文案映射）

test('HZ8：decideRebuildGate —— 四条口径都不猜（没结论 / 索引坏 / 无可重建项 / 好的）', () => {
  assert.equal(decideRebuildGate({ report: null, rebuildPhase: 'idle' }).allowed, false);
  assert.match(decideRebuildGate({ report: null, rebuildPhase: 'idle' }).reason, /先跑一次体检/);
  assert.equal(decideRebuildGate({ report: brokenDbReport(), rebuildPhase: 'idle' }).allowed, true);
  assert.equal(
    decideRebuildGate({ report: brokenDbReport(), rebuildPhase: 'running' }).allowed,
    false,
    '正在跑的时候不许再点（并发两次重建不是一个安全的操作）',
  );
  assert.equal(
    decideRebuildGate({ report: healthReport(), rebuildPhase: 'idle' }).allowed,
    false,
    '健康的库没有可重建的东西',
  );
  // ⚠️ 2026-10-15 真库实测后收紧口径：索引坏了**不再挡住**元数据重建
  //    —— 那是两件事，而用户的元数据可能真的坏着（禁用等于堵住一条能修好的路）。
  const badIndex = healthReport({
    checks: [
      { id: 'index', ok: false, code: 'INDEX_CORRUPT', reason: '索引损坏', rebuildable: false },
    ],
    ok: false,
    needsDbRebuild: false,
    needsIndexRebuild: true,
  });
  assert.equal(
    decideRebuildGate({ report: badIndex, rebuildPhase: 'idle' }).allowed,
    false,
    '只有索引坏、元数据没坏 ⇒ 没有可重建的元数据（禁用的理由是 needsDbRebuild=false，不是索引）',
  );
  const bothBad = healthReport({
    checks: [
      {
        id: 'index',
        ok: false,
        code: 'INDEX_MISSING',
        reason: '库根里没有 .gs-index.bin',
        rebuildable: false,
      },
      { id: 'db-file', ok: false, code: 'DB_MISSING', reason: '.gs.db 不存在', rebuildable: true },
    ],
    ok: false,
    needsDbRebuild: true,
    needsIndexRebuild: true,
  });
  assert.equal(
    decideRebuildGate({ report: bothBad, rebuildPhase: 'idle' }).allowed,
    true,
    '元数据坏了就允许重建 —— 索引坏是另一条路，不该堵住这一个按钮',
  );
});

test('HZ9：checkLabel 认不出来就**原样返回 id**（不猜、不吞）', () => {
  assert.equal(checkLabel('db-file'), '元数据 .gs.db');
  assert.equal(checkLabel('future-check-2030'), 'future-check-2030');
});

test('HZ10：resolveLibrary —— chosen 优先、缺 libId 归 null（界面据此禁用按钮，不编一个假 libId）', () => {
  assert.deepEqual(
    resolveLibrary({
      libraries: [
        { libId: 'L1', root: 'X:\\a' },
        { libId: 'L2', root: 'X:\\b' },
      ],
      chosen: 'L2',
    }),
    { libId: 'L2', root: 'X:\\b' },
  );
  assert.deepEqual(
    resolveLibrary({ libraries: [{ libId: 'L1', root: 'X:\\a' }] }),
    { libId: 'L1', root: 'X:\\a' },
    '没给 chosen 时取第一个',
  );
  assert.equal(resolveLibrary({ libraries: [] }), null);
  assert.equal(
    resolveLibrary({ libraries: [{ root: 'X:\\a' }] }),
    null,
    '没有 libId 就等于没有可体检的库',
  );
  assert.equal(resolveLibrary(null), null);
});

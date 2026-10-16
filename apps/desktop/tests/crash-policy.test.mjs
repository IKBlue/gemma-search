// apps/desktop/tests/crash-policy.test.mjs —— DF-6：未捕获异常策略 + 生产态 DevTools 口径
//
// 每条用例对应的失败模式：
//   C1 未捕获异常只 log 不退出       ⇒ 半初始化/半写状态继续跑，异常被当成正常（静默哲学的直接反面）
//   C2 未处理 rejection 直接退出     ⇒ 一次良性 rejection 杀掉应用（用户丢掉整个会话）
//   C3 不健康标记不可观测/第一条原因被覆盖 ⇒ 诊断面板说不清"为什么这次运行不正常"
//   C4 处理器注册/摘除不幂等          ⇒ 反复安装会积攒监听器（Node 默认 10 个就告警）
//   C5 打包态自动打开 DevTools        ⇒ 开发者界面推给最终用户（DF-6 收口点）
//
// ⚠️ 本文件**不会**真的退出进程：exit 钩子是注入的记录器；process 也是注入的假对象。
// 跑法：node --test apps/desktop/tests/crash-policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import {
  CRASH_EXIT_CODE,
  crashUnhealthyState,
  createCrashPolicy,
  installCrashPolicy,
  reasonText,
  shouldAutoOpenDevTools,
} from '../src/main/crash-policy.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INDEX_TS = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'index.ts');

/** 假 process：只实现本模块用到的 on/removeListener，并记录注册情况 */
function fakeTarget() {
  const handlers = new Map();
  return {
    handlers,
    on(event, listener) {
      const list = handlers.get(event) ?? [];
      list.push(listener);
      handlers.set(event, list);
      return this;
    },
    removeListener(event, listener) {
      const list = (handlers.get(event) ?? []).filter((l) => l !== listener);
      handlers.set(event, list);
      return this;
    },
  };
}

/** 记录式依赖：logs + trace（证明"先落盘 → flush → 退出"的次序）+ exit 码 */
function recorder({ isPackaged = true } = {}) {
  const state = { logs: [], trace: [], exitCodes: [], target: fakeTarget() };
  const deps = {
    log: (...a) => {
      state.logs.push(a.map((x) => String(x)).join(' '));
      state.trace.push('log');
    },
    flush: () => state.trace.push('flush'),
    exit: (code) => {
      state.exitCodes.push(code);
      state.trace.push('exit');
    },
    isPackaged,
    target: state.target,
  };
  return { state, deps };
}

// ============================================================ C0 未安装时不许编假健康

test('C0：没安装过策略时 crashUnhealthyState() 不编一个"健康"的假象（全 false/0）', () => {
  // 顺序前提：本用例必须在任何 installCrashPolicy() 之前跑（node:test 同文件按序执行）
  const s = crashUnhealthyState();
  assert.deepEqual(s, { unhealthy: false, reason: null, count: 0, firstAt: null });
});

// ============================================================ C1 uncaughtException

test('C1 ⭐ uncaughtException ⇒ 先落盘(flush) 再 exit(1)，并记录可读原因', () => {
  const { state, deps } = recorder({ isPackaged: true });
  const policy = createCrashPolicy(deps);

  policy.onUncaughtException(new Error('boom-uncaught'));

  assert.deepEqual(
    state.exitCodes,
    [CRASH_EXIT_CODE],
    '未捕获异常必须请求退出（code=' + String(CRASH_EXIT_CODE) + '）',
  );
  assert.equal(CRASH_EXIT_CODE, 1, '退出码必须非 0（异常退出要能被外部脚本区分）');

  // 顺序是契约：先写日志 → flush → 再退出
  const firstLog = state.trace.indexOf('log');
  const flushAt = state.trace.indexOf('flush');
  const exitAt = state.trace.indexOf('exit');
  assert.ok(firstLog >= 0, '必须至少落一行日志（否则用户机器上什么都看不到）');
  assert.ok(flushAt > firstLog, 'flush 必须在落盘之后（先落盘，再退出）');
  assert.ok(exitAt > flushAt, 'exit 必须在 flush 之后');
  assert.equal(exitAt, state.trace.length - 1, 'exit 必须是最后一步（退出之后不该再有动作）');

  assert.ok(
    state.logs.some((l) => l.includes('boom-uncaught')),
    '日志里必须有可读原因：' + JSON.stringify(state.logs),
  );
  assert.ok(
    state.logs.some((l) => /半初始化|半写/.test(l)),
    '要说清"为什么不能继续跑"',
  );

  assert.equal(policy.isUnhealthy(), true);
  assert.equal(policy.unhealthyCount(), 1);
  assert.match(String(policy.unhealthyReason()), /^uncaughtException: /);
});

// ============================================================ C2 unhandledRejection

test('C2 ⭐ unhandledRejection ⇒ 记日志 + 标记不健康，**不退出**', () => {
  const { state, deps } = recorder();
  const policy = createCrashPolicy(deps);

  policy.onUnhandledRejection('some-benign-rejection');

  assert.deepEqual(
    state.exitCodes,
    [],
    '未处理的 rejection **不许**退出（良性 rejection 不该杀应用）',
  );
  assert.equal(state.trace.includes('exit'), false);
  assert.equal(policy.isUnhealthy(), true, '必须被标记为不健康');
  assert.equal(policy.unhealthyCount(), 1);
  assert.match(String(policy.unhealthyReason()), /unhandledRejection: some-benign-rejection/);
  assert.ok(
    state.logs.some((l) => l.includes('some-benign-rejection')),
    '日志里要有原因',
  );
  assert.ok(
    state.logs.some((l) => /不退出/.test(l)),
    '日志要写明"不退出"（否则读日志的人以为是崩溃）',
  );
});

// ============================================================ C3 状态语义

test('C3 ⭐ 状态可观测：第一条原因优先（根因不被余波覆盖）+ 次数累加', () => {
  const { deps } = recorder();
  const policy = createCrashPolicy(deps);

  policy.onUnhandledRejection(new Error('root-cause'));
  policy.onUnhandledRejection(new Error('later-noise'));

  assert.equal(policy.unhealthyCount(), 2, '每次都要计数（"出过几次"是可诊断信息）');
  assert.match(
    String(policy.unhealthyReason()),
    /root-cause/,
    '第一条原因是根因，不许被后面的余波覆盖',
  );
  assert.equal(String(policy.unhealthyReason()).includes('later-noise'), false);

  // reasonText 的边界：Error 给 stack、字符串原样、循环对象不许抛
  assert.ok(reasonText(new Error('x')).includes('x'));
  assert.equal(reasonText('plain'), 'plain');
  const cyc = {};
  cyc.self = cyc;
  assert.equal(typeof reasonText(cyc), 'string', '循环引用也要给一个字符串（不许抛）');
});

// ============================================================ C4 安装/摘除

test('C4：install 注册两个事件且幂等；dispose 摘干净', () => {
  const { deps, state } = recorder();
  const policy = createCrashPolicy(deps);

  policy.install();
  policy.install(); // 幂等
  assert.equal(state.target.handlers.get('uncaughtException').length, 1);
  assert.equal(state.target.handlers.get('unhandledRejection').length, 1);

  // 安装后，事件真的会走到策略（假 target 手动派发）
  state.target.handlers.get('unhandledRejection')[0](new Error('via-target'));
  assert.equal(policy.isUnhealthy(), true);

  policy.dispose();
  policy.dispose(); // 幂等
  assert.deepEqual(state.target.handlers.get('uncaughtException'), []);
  assert.deepEqual(state.target.handlers.get('unhandledRejection'), []);
});

// ============================================================ C5 生产态 DevTools

test('C5 ⭐ 生产态不自动打开 DevTools；手动 F12 路径仍在', () => {
  assert.equal(shouldAutoOpenDevTools(), false, '口径函数必须恒 false（唯一落点）');

  const code = maskComments(fs.readFileSync(INDEX_TS, 'utf8'));
  assert.equal(/openDevTools\s*\(/.test(code), false, 'index.ts 不许出现自动打开 DevTools 的调用');
  assert.ok(/toggleDevTools\s*\(/.test(code), 'F12 的手动开关必须还在（SPEC-security §9 决定 3）');
  assert.ok(/devTools:\s*true/.test(code), '能力保留：devTools:true 不被关掉（只是不许自动开）');

  // 策略接线必须是"一份"：index.ts 不许再自己挂 process.on 的这两个事件
  assert.ok(/installCrashPolicy\s*\(/.test(code), 'index.ts 必须走 crash-policy 的安装入口');
  assert.equal(
    /process\.on\(\s*['"]uncaughtException['"]/.test(code),
    false,
    '不许在 index.ts 再散一份 uncaughtException 处理器',
  );
  assert.equal(
    /process\.on\(\s*['"]unhandledRejection['"]/.test(code),
    false,
    '不许在 index.ts 再散一份 unhandledRejection 处理器',
  );
});

// ============================================================ C6 安装入口（模块槽）

test('C6：installCrashPolicy 后 crashUnhealthyState() 读得到已安装策略的状态', () => {
  const first = recorder();
  installCrashPolicy(first.deps);
  assert.deepEqual(
    crashUnhealthyState(),
    { unhealthy: false, reason: null, count: 0, firstAt: null },
    '刚装上、还没出事 ⇒ 健康',
  );

  first.state.target.handlers.get('unhandledRejection')[0](new Error('observable'));
  assert.deepEqual(crashUnhealthyState().unhealthy, true);
  assert.match(String(crashUnhealthyState().reason), /observable/);

  // 再安装一个 ⇒ 旧的监听器必须先被摘掉（不积攒）
  const second = recorder();
  installCrashPolicy(second.deps);
  assert.deepEqual(
    first.state.target.handlers.get('unhandledRejection'),
    [],
    '替换安装时要摘掉旧监听器',
  );
  assert.equal(second.state.target.handlers.get('uncaughtException').length, 1);
  second.state.target.handlers.get('uncaughtException')[0](new Error('fresh-instance'));
  assert.deepEqual(second.state.exitCodes, [CRASH_EXIT_CODE]);
  assert.match(String(crashUnhealthyState().reason), /fresh-instance/, '模块槽要指向**新**实例');
});

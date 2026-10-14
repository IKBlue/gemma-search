// apps/desktop/tests/window-state.test.mjs —— 窗口尺寸/位置记忆的验收测试（T-10b / U8）
//
// 为什么要有它：window-state.ts 是**纯函数 + 零 electron** 写的，就是为了能在 node:test 里直接跑。
// 没有它，这段"窗口落在屏幕外"的判定只在 e2e 里被间接覆盖 —— 而 e2e 恰恰**造不出**
// "显示器拔了 / 分辨率调小了"这些场景（真机上没法干净地拔显示器）。
//
// 每条用例都对应一个会静默出错的方向：
//   · 不可信 JSON 被硬解 ⇒ 启动即崩（配置文件是外部输入，形状永远不可信）；
//   · 越界坐标照搬 ⇒ 应用启动了但窗口在屏幕外，用户找不到（本项目最怕的静默失败）；
//   · 尺寸超屏不夹 ⇒ 分辨率调小后窗口大片在屏幕外。
// 跑法：npm test（仓库根脚本已含本目录）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  decideWindowBounds, parseSavedBounds, readSavedBounds, persistBounds,
  WINDOW_STATE_FILE, WINDOW_STATE_VERSION,
} from '../src/main/window-state.ts';

/** 本机那块屏（2560x1400 工作区）——只是测试里的一个"屏幕"，跟真实机器无关 */
const WA = { x: 0, y: 0, width: 2560, height: 1400 };
const MIN = { minWidth: 1040, minHeight: 680, minVisible: 64 };
const decide = (saved, workAreas) => decideWindowBounds({ saved, workAreas: workAreas || [WA], ...MIN });
const state = (b) => ({ version: WINDOW_STATE_VERSION, ...b });
const tmpUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-wstate-'));

// ============================================================ ① 不可信 JSON 先收敛

test('J1 坏 JSON 一律收敛成 null 且**不抛**（null/数字/字符串/数组/空对象/缺字段/类型错/NaN/Infinity）', () => {
  const junk = [
    null, undefined, 42, 'x', [], {}, true,
    { version: 2, x: 1, y: 1, width: 1200, height: 800 },     // 版本不同
    { version: 1, x: 1, y: 1 },                               // 缺字段
    { version: 1, x: '1', y: 1, width: 1200, height: 800 },   // 类型错
    { version: 1, x: NaN, y: 1, width: 1200, height: 800 },   // NaN
    { version: 1, x: 0, y: 0, width: Infinity, height: 800 }, // Infinity
    { version: 1, x: 0, y: 0, width: null, height: 800 },
  ];
  for (const raw of junk) {
    const p = parseSavedBounds(raw);
    assert.equal(p.bounds, null, '不该把 ' + JSON.stringify(raw) + ' 当成可用位置');
    assert.ok(p.why.length > 0, '必须给出"为什么不用"的理由');
    const d = decide(raw);
    assert.equal(d.bounds, null, '回落');
    assert.equal(d.source, 'default');
    assert.ok(d.reason.length > 0);
  }
});

test('J2 理由指向真正的原因（版本 / 字段），不是一句笼统的"坏了"', () => {
  assert.match(parseSavedBounds({ version: 2, x: 0, y: 0, width: 1200, height: 800 }).why, /版本/);
  assert.match(parseSavedBounds({}).why, /版本/);
  assert.match(parseSavedBounds({ version: 1, x: 1, y: 1 }).why, /x\/y\/width\/height/);
  assert.match(parseSavedBounds(null).why, /没有存过/);
});

test('J3 小数按整数语义处理（落盘/恢复都是像素整数，不留 1.5px 噪声）', () => {
  const p = parseSavedBounds(state({ x: 10.6, y: 20.4, width: 1200.5, height: 800.5 }));
  assert.deepEqual(p.bounds, { x: 11, y: 20, width: 1201, height: 801 });
});

// ============================================================ ② 越界坐标 ⇒ 回落

test('W1 坐标远在屏幕外（99999,99999）⇒ 回落默认，并说明露不出来', () => {
  const d = decide(state({ x: 99999, y: 99999, width: 1180, height: 760 }));
  assert.equal(d.bounds, null);
  assert.equal(d.source, 'default');
  assert.match(d.reason, /露不出|屏幕外/);
});

test('W2 窗口整个在屏幕上方（y 为负且超出屏幕）⇒ 回落默认', () => {
  assert.equal(decide(state({ x: 100, y: -1400, width: 1180, height: 760 })).bounds, null);
});

test('W3 只露出 40px（<64px）⇒ 回落默认 —— 抓不着标题栏就不算"看得见"', () => {
  const d = decide(state({ x: WA.width - 40, y: 100, width: 1180, height: 760 }));
  assert.equal(d.bounds, null);
  assert.match(d.reason, /40px|露不出/);
});

test('W4 只露出 63px（差 1px）⇒ 回落默认', () => {
  assert.equal(decide(state({ x: WA.width - 63, y: 100, width: 1180, height: 760 })).bounds, null);
});

test('W5 ⭐ 边界：正好露出 64px ⇒ **保留**（阈值是 >= minVisible，不是 > ）', () => {
  const d = decide(state({ x: WA.width - 64, y: 100, width: 1180, height: 760 }));
  assert.deepEqual(d.bounds, { x: WA.width - 64, y: 100, width: 1180, height: 760 });
  assert.equal(d.source, 'saved');
});

test('W6 只露出下边缘 40px ⇒ 回落默认', () => {
  assert.equal(decide(state({ x: 100, y: WA.height - 40, width: 1180, height: 760 })).bounds, null);
});

test('W7 拿不到屏幕工作区（screen 返回空）⇒ 回落默认，不硬用旧坐标', () => {
  const d = decide(state({ x: 0, y: 0, width: 1200, height: 800 }), []);
  assert.equal(d.bounds, null);
  assert.match(d.reason, /屏幕/);
});

test('W8 双屏：位置落在第二块屏幕里 ⇒ 保留（不是只看主屏）', () => {
  const two = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 2560, height: 1400 }];
  const d = decide(state({ x: 2500, y: 200, width: 1180, height: 760 }), two);
  assert.deepEqual(d.bounds, { x: 2500, y: 200, width: 1180, height: 760 });
  assert.equal(d.source, 'saved');
});

// ============================================================ ③ 尺寸超屏 ⇒ 夹到工作区

test('C1 存下来的 9000x9000 比屏幕还大 ⇒ 夹到工作区大小（而不是整个丢掉）', () => {
  const d = decide(state({ x: 0, y: 0, width: 9000, height: 9000 }));
  assert.deepEqual(d.bounds, { x: 0, y: 0, width: WA.width, height: WA.height });
  assert.equal(d.source, 'saved');
  assert.match(d.reason, /夹到/);
});

test('C2 只宽超屏 ⇒ 只夹宽，高度原样保留', () => {
  assert.deepEqual(decide(state({ x: 0, y: 0, width: 9000, height: 800 })).bounds,
    { x: 0, y: 0, width: WA.width, height: 800 });
});

test('C3 尺寸小于最小尺寸 ⇒ **回落默认**（不是往上夹成最小尺寸 —— 那是编一个用户没设过的值）', () => {
  const d = decide(state({ x: 0, y: 0, width: 500, height: 400 }));
  assert.equal(d.bounds, null);
  assert.match(d.reason, /最小尺寸/);
});

test('C4 正常值原样保留（不夹、不改），理由里不出现"夹到"', () => {
  const d = decide(state({ x: 180, y: 140, width: 1180, height: 760 }));
  assert.deepEqual(d.bounds, { x: 180, y: 140, width: 1180, height: 760 });
  assert.equal(d.reason.includes('夹到'), false);
});

// ============================================================ ④ 读写往返

test('R1 写进 userData 再读回来 ⇒ 逐字段一致（文件名固定）', () => {
  const dir = tmpUserData();
  try {
    const w = persistBounds(dir, { x: 180, y: 140, width: 1180, height: 760 });
    assert.equal(w.ok, true);
    assert.equal(w.path, path.join(dir, WINDOW_STATE_FILE));
    assert.ok(fs.existsSync(w.path));
    const r = readSavedBounds(dir);
    assert.equal(r.error, null);
    assert.deepEqual(parseSavedBounds(r.raw).bounds, { x: 180, y: 140, width: 1180, height: 760 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 往返经过整数化 ⇒ 磁盘上的值就是恢复出来的值（不留小数）', () => {
  const dir = tmpUserData();
  try {
    persistBounds(dir, { x: 10.6, y: 20.4, width: 1180.5, height: 760.5 });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, WINDOW_STATE_FILE), 'utf8'));
    assert.deepEqual(raw, { version: WINDOW_STATE_VERSION, x: 11, y: 20, width: 1181, height: 761 });
    assert.deepEqual(parseSavedBounds(raw).bounds, { x: 11, y: 20, width: 1181, height: 761 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R3 读取是**纯读**：空目录既不抛也不产生文件', () => {
  const dir = tmpUserData();
  try {
    const before = fs.readdirSync(dir);
    const r = readSavedBounds(dir);
    assert.equal(r.raw, null);
    assert.equal(r.error, null, '文件不存在不是错误，是"第一次启动"');
    assert.deepEqual(fs.readdirSync(dir), before, '读取不该写任何东西');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================ ⑤ 读不到 / 坏文件

test('R4 坏文件（截断 JSON）⇒ raw=null + error 非空 + **不抛**，判定回落默认', () => {
  const dir = tmpUserData();
  try {
    fs.writeFileSync(path.join(dir, WINDOW_STATE_FILE), '{ "version":1, "x":', 'utf8');
    const r = readSavedBounds(dir);
    assert.equal(r.raw, null);
    assert.ok(r.error && r.error.length > 0);
    const d = decide(r.raw);
    assert.equal(d.bounds, null);
    assert.equal(d.source, 'default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R5 userData 不可用（空串）⇒ ok:false + error 非空，**不抛**', () => {
  const w = persistBounds('', { x: 0, y: 0, width: 1200, height: 800 });
  assert.equal(w.ok, false);
  assert.ok(w.error && w.error.length > 0);
  const r = readSavedBounds('');
  assert.equal(r.raw, null);
  assert.ok(r.error && r.error.length > 0);
});

test('R6 目标位置建不出来（用文件当目录）⇒ ok:false 且不抛（记不住窗口位置不该让应用出问题）', () => {
  const dir = tmpUserData();
  try {
    const asFile = path.join(dir, 'not-a-dir');
    fs.writeFileSync(asFile, 'x', 'utf8');
    const w = persistBounds(asFile, { x: 0, y: 0, width: 1200, height: 800 });
    assert.equal(w.ok, false);
    assert.ok(w.error && w.error.length > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

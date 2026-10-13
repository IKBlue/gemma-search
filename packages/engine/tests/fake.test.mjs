// packages/engine/tests/fake.test.mjs —— 契约 §8「模拟模式」的验收
//
// ── 这组测试要证的四件事 ────────────────────────────────────────────────
//   ① **绝不触碰真实文件系统**（契约 §8 原文）—— 用的是**行为判据**，不是"读代码看着没有"：
//      fake 库的根是 `Z:\__fake_library__`。**本机没有 Z: 盘** ⇒ 只要有任何一条代码路径
//      真的去解析库根/读盘，`requireExistingRoot` 或 `readFileSync` 就会当场抛。
//      ⇒ **"在库根不存在的前提下全部方法都成功" 就是"没碰真实文件系统"的证据。**
//      （断言的**前置条件**也要验：`Z:` 确实不存在。不然这条会在真有 Z: 盘的机器上退化。）
//   ② **可复现**：`search` 固定排序，两次调用逐字段一致（契约 §8「返回固定排序」）。
//   ③ **长任务的形状可用**：进度单调 · 取消在边界生效 · 失败项可解释 —— P3d 的验收全靠它。
//   ④ **真实模式不许假装成功**：`fake:false` 时 `indexStart` 如实返回 `INTERNAL`。
//
// ⚠️ 定时器全部注入（假时钟）⇒ 测试**不真的等 10 秒**，也不留悬挂的 timer。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createEngine, BANDS, UNIMPLEMENTED_METHODS } from '../src/engine.mjs';
import { ERR } from '../src/errors.mjs';
import { COMPAT_FIELDS } from '../src/compat.mjs';
import { loadSampleIndex, DEFAULT_FIXTURE_PATH, createFakeKit } from '../src/fake.mjs';

/** 同步假时钟：把 `setTimer` 排进队列，由 `runAll` 按序执行 */
function makeClock() {
  let q = [];
  return {
    setTimer: (fn) => { q.push(fn); return q.length; },
    clearTimer: () => {},
    /** 跑完当前所有已排队的推进（每步都可能再排一个） */
    async runAll(limit = 500) {
      for (let i = 0; i < limit && q.length; i++) { const fn = q.shift(); await fn(); }
      return i => i;
    },
    get pending() { return q.length; },
  };
}

/** 用假时钟建一个模拟引擎，并收集事件 */
function fakeEngine({ fixture = null, intervalMs = 1 } = {}) {
  const clock = makeClock();
  const events = [];
  const engine = createEngine({
    fake: { fixture, intervalMs, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
    onEvent: (e) => events.push(e),
  });
  return { engine, clock, events };
}

// ============================================================ ① 零真实文件系统

test('F1 契约 §8：模拟模式**绝不触碰真实文件系统** —— 判据是"库根根本不存在"', async () => {
  // ⚠️ 判据必须落在**完整库根**上，而不是盘符：本机**真有 Z: 盘**
  //    （第一次我把前置条件写成 `fs.existsSync('Z:\\')` ⇒ 当场红，判据自己抓到了自己）。
  const { engine, clock, events } = fakeEngine();
  try {
    // 前置条件本身要验：库根真的不存在。否则后面那条推论不成立。
    assert.equal(fs.existsSync(engine._fake.root), false,
      `库根竟然存在（${engine._fake.root}）⇒ 判据失效，请换一个合成库根（fixtures/sample-index.json 的 root）`);
    // 只要有一条路径真的去 requireExistingRoot / 读盘，这些调用就会抛
    const st = await engine.indexStatus({});
    assert.equal(st.ok, true, `故障：${JSON.stringify(st.error)}`);
    assert.ok(st.data.libs.length >= 3, '样例索引应含 ≥3 个库（正常 / compat 不符 / 索引损坏）');

    const s = await engine.search({ mode: 'text', text: '任意词', topK: 5 });
    assert.equal(s.ok, true, `search 失败：${JSON.stringify(s.error)}`);
    assert.ok(s.data.results.length > 0, 'search 应有结果');

    const it = await engine.item({ libId: 'L1', uid: s.data.results[0].uid });
    assert.equal(it.ok, true, `item 失败：${JSON.stringify(it.error)}`);

    const ip = await engine.itemPaths({ libId: 'L1', uid: s.data.results[0].uid });
    assert.equal(ip.ok, true, `itemPaths 失败：${JSON.stringify(ip.error)}`);
    assert.match(ip.data.imagePath, /^Z:\\__fake_library__\\/, '绝对路径应拼自样例库根');

    const job = await engine.indexStart({ libId: 'L1', device: 'cpu' });
    assert.equal(job.ok, true);
    await clock.runAll();
    assert.ok(events.some((e) => e.type === 'index.done'), '长任务应发出 index.done');

    // 库根不存在却全程成功 ⇒ 没碰真实文件系统
    assert.equal(fs.existsSync('Z:\\__fake_library__'), false, '模拟模式不该在盘上造出这个目录');
  } finally {
    engine._fake.__dispose();
  }
});

// ============================================================ ② 固定排序 / 可复现

test('F2 `search` 固定排序且可复现（同参数两次调用逐字段一致）', async () => {
  const { engine } = fakeEngine();
  try {
    const a = await engine.search({ mode: 'text', text: '吊灯', topK: 8 });
    const b = await engine.search({ mode: 'text', text: '吊灯', topK: 8 });
    assert.deepEqual(a.data.results, b.data.results, '同参数两次结果必须完全一致');
    assert.deepEqual(a.data.results.map((r) => r.uid), b.data.results.map((r) => r.uid));
    // 分数递减（样例是固定顺序）
    const scores = a.data.results.map((r) => r.score);
    assert.deepEqual(scores, [...scores].sort((x, y) => y - x), '样例结果应按分数递减');
    // band 必须由**注入的** bandOf 算（不能自己造阈值）。
    // ⚠️ `BANDS` 是 `mode -> { 档位名: 阈值 }`：**档位名是键**，不是值。
    //    第一版我写成遍历 `Object.values(BANDS)`（那是阈值数字）⇒ 断言恒假。
    const bandNames = Object.keys(BANDS.text);
    for (const r of a.data.results) {
      assert.ok(r.band === 'unknown' || bandNames.includes(r.band),
        `band 取值异常：${r.band}（合法：${bandNames.join('/')}/unknown）`);
    }
  } finally { engine._fake.__dispose(); }
});

test('F2b `__empty__` 触发「无结果」分支；compat 不符与索引损坏的库进 `libsSkipped`', async () => {
  const { engine } = fakeEngine();
  try {
    const empty = await engine.search({ mode: 'text', text: '__empty__', topK: 8 });
    assert.deepEqual(empty.data.results, [], '应返回空结果（界面要能演示这个状态）');

    const all = await engine.search({ mode: 'text', text: 'x', topK: 50 });
    const skipped = all.data.libsSkipped.map((s) => s.libId).sort();
    assert.deepEqual(skipped, ['L2', 'L3'],
      'L2（compat 不符）与 L3（索引损坏）都应被跳过并给出结构化原因（契约 §6）');
    for (const s of all.data.libsSkipped) assert.ok(s.reason && s.reason.kind, '跳过必须带结构化原因');
  } finally { engine._fake.__dispose(); }
});

// ============================================================ ③ item vs itemPaths

test('F3 `item` **不**返回绝对路径；`itemPaths` 才是要路径的地方（所有者决定）', async () => {
  const { engine } = fakeEngine();
  try {
    const uid = 'a00000000001';
    const it = await engine.item({ libId: 'L1', uid });
    assert.equal(it.ok, true);
    // `item` 是索引元数据 —— 不许把绝对路径混进来（否则每次取元数据都顺带泄出路径）
    const json = JSON.stringify(it.data);
    assert.equal(json.includes('Z:\\\\__fake_library__'), false, `item 不该含绝对路径：${json.slice(0, 200)}`);
    assert.equal(it.data.relPath, 'VR\\VR-101.jpg');
    // ⚠️ `item` **没有** `indexState` 字段 —— "索引状态"是派生量，归 Operation 层
    //    （`renderer/src/utils/index-state.js`）。字段集合由 F12 钉住。

    const ip = await engine.itemPaths({ libId: 'L1', uid });
    assert.equal(ip.data.imagePath, 'Z:\\__fake_library__\\VR\\VR-101.jpg');
    assert.equal(ip.data.archivePath, 'Z:\\__fake_library__\\VR\\VR-101.rar');
    // 有图无包的那条：archivePath 必须是 null，不是空串
    const ip2 = await engine.itemPaths({ libId: 'L1', uid: 'a00000000003' });
    assert.equal(ip2.data.archivePath, null, '有图无包 ⇒ archivePath 为 null');
  } finally { engine._fake.__dispose(); }
});

test('F3b 样例索引覆盖「待重编码 / 已从索引移除」两档（界面必须能演示）', async () => {
  const { engine } = fakeEngine();
  try {
    // ⚠️ 「索引状态」是**派生**的，不是引擎字段（见 F12）。
    //    派生规则在 `renderer/src/utils/index-state.js`，这里只验**输入数据够不够**：
    //    ① 判 `removed` 靠 `item.exists.image === false`
    //    ② 判 `stale` 靠一次 `scan` 的 `changed`
    const gone = await engine.item({ libId: 'L1', uid: 'a0000000001e' });
    assert.equal(gone.data.exists.image, false, '「已从索引移除」需要 exists.image=false');

    const scan = await engine.scan({ libId: 'L1' });
    assert.ok(scan.data.changed.includes('a00000000004'), '「待重编码」需要 scan.changed 含它');
    assert.ok(scan.data.missing.includes('a0000000001e'), 'scan.missing 与 exists 必须一致');
    assert.ok(scan.data.added.length > 0, '「待编码」需要 scan.added 非空');
  } finally { engine._fake.__dispose(); }
});

test('F12 ⭐⭐ fake 的 `item` 与**真实引擎**的 `item` **逐字同形**（防"模拟能跑、真库崩"）', async () => {
  // 这条是本文件里最重要的"防假绿"断言：
  // 我在 fake 里多写一个字段（`indexState`）时，页面会在模拟模式下正常工作、
  // 而在真库上拿到 `undefined` —— 那种 bug 只有到真机上才会暴露。
  const { engine } = fakeEngine();
  const real = createEngine({ config: {}, encoder: null });
  try {
    const fakeItem = (await engine.item({ libId: 'L1', uid: 'a00000000001' })).data;
    // 真实引擎在夹具库上没有索引 ⇒ 拿不到 data；改为**比形状**：用契约 §2.2 的字段清单
    const CONTRACT_FIELDS = ['libId', 'uid', 'relPath', 'folder', 'stem', 'imageExt', 'imageSize',
      'imageMtime', 'vectorSource', 'archive', 'exists'];
    assert.deepEqual(Object.keys(fakeItem).sort(), [...CONTRACT_FIELDS].sort(),
      'fake 的 item 字段集合必须与契约 §2.2 一致 —— 多一个字段就是"模拟能跑、真库崩"');

    // 同样钉 itemPaths（契约 §2.2a）
    const ip = (await engine.itemPaths({ libId: 'L1', uid: 'a00000000001' })).data;
    assert.deepEqual(Object.keys(ip).sort(), ['archivePath', 'exists', 'imagePath', 'libId', 'uid'].sort());

    // 以及 archive 子对象的形状（有包的那条）
    assert.deepEqual(Object.keys(fakeItem.archive).sort(), ['ext', 'mtime', 'relPath', 'size'].sort());
    // 有图无包的那条：archive 必须是 null（不是 {} 也不是 undefined）
    const noArc = (await engine.item({ libId: 'L1', uid: 'a00000000003' })).data;
    assert.equal(noArc.archive, null);
    assert.equal(real._fake, null);
  } finally { engine._fake.__dispose(); }
});

// ============================================================ ④ 长任务（P3d 的验收靠它）

test('F4 `indexStart` 发进度事件：`done` 单调不减，收尾发 `index.done`', async () => {
  const { engine, clock, events } = fakeEngine();
  try {
    const r = await engine.indexStart({ libId: 'L1', device: 'cpu', seq: 140 });
    assert.equal(r.ok, true);
    assert.match(r.data.jobId, /^j-/, '应返回 jobId（契约 §2.10）');

    await clock.runAll();
    const prog = events.filter((e) => e.type === 'index.progress');
    assert.ok(prog.length >= 3, `应发多条进度，实得 ${prog.length}`);
    const dones = prog.map((e) => e.done);
    assert.deepEqual(dones, [...dones].sort((a, b) => a - b), 'done 必须单调不减（契约 §3）');
    for (const e of prog) {
      assert.equal(typeof e.total, 'number');
      assert.ok(e.phase, '每条进度都要带阶段（阶段条要用）');
      assert.ok(e.etaSec === null || typeof e.etaSec === 'number', 'etaSec 要么是数字要么是 null');
    }
    const done = events.filter((e) => e.type === 'index.done');
    assert.equal(done.length, 1, '收尾只发一次 index.done');
    assert.equal(done[0].total, 30);
  } finally { engine._fake.__dispose(); }
});

test('F5 失败项非空 ⇒ `index.done.ok === false`，且每项可解释（哪条/哪个阶段/为什么）', async () => {
  const { engine, clock, events } = fakeEngine();
  try {
    await engine.indexStart({ libId: 'L1', device: 'cpu' });
    await clock.runAll();
    const d = events.find((e) => e.type === 'index.done');
    assert.equal(d.ok, false, '有失败项时 ok 必须是 false（不许静默）');
    assert.ok(Array.isArray(d.failed) && d.failed.length >= 2, '失败清单应非空');
    for (const f of d.failed) {
      assert.ok(f.relPath, '失败项要能说明是**哪条**');
      assert.ok(f.stage, '失败项要说清**哪个阶段**');
      assert.ok(f.error && f.error.code && f.error.message, '失败项要能说明**为什么**');
    }
    // 「完成后显示 复用 N · 新编码 M · 失败 K」（UI-REVIEW §6 流程 3）
    assert.equal(typeof d.reused, 'number');
    assert.equal(typeof d.encoded, 'number');
  } finally { engine._fake.__dispose(); }
});

test('F6 ⭐ 取消**在边界生效**：cancel 后立刻收尾，且已处理数停在中间值', async () => {
  const { engine, clock, events } = fakeEngine();
  try {
    const r = await engine.indexStart({ libId: 'L1', device: 'cpu' });
    await clock.runAll(2);                       // 只推进两步 ⇒ 任务进行中
    const mid = events.filter((e) => e.type === 'index.progress').at(-1).done;
    assert.ok(mid > 0 && mid < 30, `应停在中途，实得 done=${mid}`);

    const c = await engine.indexCancel({ jobId: r.data.jobId });
    assert.equal(c.ok, true);
    assert.equal(c.data.cancelled, true);

    // 契约 §3：取消后**最多 2 s** 内发出 done/failed —— 这里是同步发出，无需等待
    const fin = events.find((e) => e.type === 'index.done');
    assert.ok(fin, '取消后必须收尾（不能静默消失）');
    assert.equal(fin.ok, false, '取消 ⇒ 未成功');
    assert.equal(fin.cancelled, true);
    assert.ok(fin.failed.length >= 1, '被取消的那条要出现在失败清单里（可解释）');

    clock.length = 0;                            // 清理推进队列，防止悬挂
  } finally { engine._fake.__dispose(); }
});

test('F6b `indexResume` 复用已编码行，并在事件里说明复用多少（契约 §3）', async () => {
  const { engine, clock, events } = fakeEngine();
  try {
    const r = await engine.indexStart({ libId: 'L1', device: 'cpu' });
    await clock.runAll(2);
    await engine.indexCancel({ jobId: r.data.jobId });
    const before = events.filter((e) => e.type === 'index.progress').at(-1).done;

    events.length = 0;
    const res = await engine.indexResume({ jobId: r.data.jobId });
    assert.equal(res.ok, true);
    const note = events.find((e) => e.type === 'index.progress' && e.note);
    assert.ok(note, '续跑必须说明复用了多少、为什么（不许静默）');
    assert.match(note.note, /复用\s*\d+/);
    assert.equal(note.done, before, `复用应从上一次的 done=${before} 接着走`);

    await clock.runAll();
  } finally { engine._fake.__dispose(); }
});

test('F7 `RECOVERY_NEEDED` 那条路可演示：有未收尾事务时写操作被拒且带可恢复信息', async () => {
  const { engine } = fakeEngine();
  try {
    engine._fake.__injectPendingTx({ txId: 'tx-2f9c', state: 'staged', startedAt: 1760000000000, canUndo: true, canRollback: true });

    const m = await engine.mutate({ libId: 'L1', op: 'rename', params: {} });
    assert.equal(m.ok, false);
    assert.equal(m.error.code, ERR.RECOVERY_NEEDED);
    assert.equal(m.error.details.txId, 'tx-2f9c');
    assert.equal(m.error.details.canUndo, true);
    assert.equal(m.error.details.canRollback, true);
    assert.ok(m.error.userMessage, 'userMessage 必须非空（界面要显示它）');

    // 未收尾事务也会挡住新的索引任务（不然会出现两个写者）
    const j = await engine.indexStart({ libId: 'L1' });
    assert.equal(j.ok, false);
    assert.equal(j.error.code, ERR.RECOVERY_NEEDED);

    // 恢复：undo 之后恢复正常
    const u = await engine.mutate({ libId: 'L1', op: 'undo', params: { txId: 'tx-2f9c' } });
    assert.equal(u.ok, true);
    const m2 = await engine.mutate({ libId: 'L1', op: 'rename', params: {} });
    assert.equal(m2.ok, true, '恢复之后写操作应可用');
  } finally { engine._fake.__dispose(); }
});

// ============================================================ ⑤ 真实模式不许假装成功

test('F8 ⭐ `fake:false`（真实模式）下 `indexStart`/`mutate` 如实返回 `INTERNAL`，**不假装成功**', async () => {
  const engine = createEngine({ config: {}, encoder: null });
  for (const [m, req] of [['indexStart', { libId: 'L1' }], ['indexCancel', { jobId: 'x' }],
                          ['indexResume', { jobId: 'x' }], ['mutate', { libId: 'L1', op: 'rename' }],
                          ['ingest', { libId: 'L1', sourcePaths: [] }]]) {
    const r = await engine[m](req);
    assert.equal(r.ok, false, `${m} 在真实模式下不该返回 ok`);
    assert.equal(r.error.code, ERR.INTERNAL, `${m} 应如实报 INTERNAL，实得 ${r.error.code}`);
    assert.ok(r.error.userMessage, `${m} 的 userMessage 必须非空`);
  }
  assert.equal(engine._fake, null, '真实模式下不该有 fake kit');
});

// ============================================================ ⑥ 元断言：不许凭空造错误码

test('F9 ⭐ fake 用到的**每个错误码**都在冻结的错误码表里（我曾造过一个 ENCODE_FAILED）', async () => {
  const known = new Set(Object.values(ERR));
  const { engine, clock, events } = fakeEngine();
  const bad = [];
  try {
    // 把能产出错误码的路径都走一遍
    const calls = [
      engine.search({ mode: 'text', text: 'x', topK: 50 }),
      engine.item({ libId: 'L1', uid: '不存在的uid' }),
      engine.item({ libId: 'NOPE', uid: 'a00000000001' }),
      engine.itemPaths({ libId: 'L1', uid: '不存在的uid' }),
      engine.scan({ libId: 'NOPE' }),
      engine.indexStart({ libId: 'L1', device: 'cpu' }),
    ];
    for (const r of await Promise.all(calls)) {
      if (!r.ok) {
        if (!known.has(r.error.code)) bad.push(r.error.code);
      }
    }
    await clock.runAll();
    for (const e of events) {
      if (e.type === 'index.done') for (const f of e.failed) if (!known.has(f.error.code)) bad.push(f.error.code);
      if (e.type === 'index.failed' && !known.has(e.error.code)) bad.push(e.error.code);
    }
    // 未收尾事务那条
    engine._fake.__injectPendingTx({ txId: 'tx-x', state: 'staged', startedAt: 1, canUndo: true, canRollback: true });
    const rec = await engine.mutate({ libId: 'L1', op: 'rename' });
    if (!rec.ok && !known.has(rec.error.code)) bad.push(rec.error.code);
  } finally { engine._fake.__dispose(); }

  assert.deepEqual(bad, [],
    `这些错误码不在 errors.mjs 的表里 —— 契约 §9.2 把"改错误码字符串"定为**破坏性变更**（要升 v2）。\n` +
    `已登记的表：${[...known].join(', ')}`);
});

// ============================================================ ⑦ fixture 本身

test('F10 `fixtures/sample-index.json` 存在、条数达标、且覆盖契约 §8 要求的展示分支', () => {
  assert.equal(fs.existsSync(DEFAULT_FIXTURE_PATH), true, `缺样例索引：${DEFAULT_FIXTURE_PATH}`);
  const fx = loadSampleIndex();
  assert.ok(fx.items.length >= 30, `契约 §8 说"约 30 条"，实得 ${fx.items.length}`);

  const folders = new Set(fx.items.map((i) => i.folder));
  assert.ok(folders.size >= 4, `应覆盖多个分类，实得 ${[...folders].join('/')}`);
  assert.ok(fx.items.some((i) => !i.archiveRelPath), '要有「有图无包」的样本');
  assert.ok(fx.items.some((i) => i.vectorSource === 'bmp-fallback'), '要有「BMP 回退档」的样本');
  assert.ok(fx.scan?.L1?.changed?.length > 0, '要有「待重编码」的样本');
  assert.ok(fx.scan?.L1?.missing?.length > 0, '要有「已从索引移除」的样本');
  assert.ok(fx.libs.some((l) => l.state === 'compat-mismatch'), '要有「compat 不符」的样本');
  assert.ok(fx.libs.some((l) => l.state === 'corrupt'), '要有「索引损坏」的样本');

  // uid 必须是 12 位 hex（契约 §1.2，已冻结）
  for (const it of fx.items) assert.match(it.uid, /^[0-9a-f]{12}$/, `uid 形状不对：${it.uid}`);
  // 库根必须是合成值，不能是本机真路径（AGENTS §7）
  assert.match(fx.root, /^Z:/, '样例库根应是合成盘符（本机不存在的 Z:），别写本机真路径');
});

test('F13 ⭐⭐ fake 的 `indexStatus.compat` 与真实引擎**同形**：8 段、顺序一致', async () => {
  // 同 F12 的道理：`compat` 是 8 段竖线串（`compat.mjs` 的 `COMPAT_FIELDS`）。
  // 我第一版返回了 `'fake'` 一个词 —— 界面会"模拟模式显示正常、真库上格式全变"。
  const { engine } = fakeEngine();
  try {
    const st = await engine.indexStatus({});
    assert.ok(COMPAT_FIELDS.length === 8, `COMPAT_FIELDS 变了吗？实得 ${COMPAT_FIELDS.length} 段`);
    for (const l of st.data.libs) {
      // 索引读不出来的库 ⇒ 真实引擎给 `compat: null`（`compatComplete` 为假），不是"带空段的串"
      if (l.problems.length > 0) {
        assert.equal(l.compat, null, `索引有问题的 ${l.libId} 应给 compat:null，实得 ${l.compat}`);
        continue;
      }
      const segs = String(l.compat).split('|');
      assert.equal(segs.length, COMPAT_FIELDS.length,
        `${l.libId} 的 compat 应是 ${COMPAT_FIELDS.length} 段（${COMPAT_FIELDS.join('|')}），实得 ${segs.length} 段：${l.compat}`);
      for (const s of segs) assert.ok(s.length > 0, `${l.libId} 的 compat 有空段：${l.compat}`);
    }
    // L1 与 L2 的 compat 必须不同（否则演示不了 COMPAT_MISMATCH）
    const byId = Object.fromEntries(st.data.libs.map((l) => [l.libId, l.compat]));
    assert.notEqual(byId.L1, byId.L2, 'L2 是"compat 不符"那个库，compat 串不能与 L1 相同');
  } finally { engine._fake.__dispose(); }
});

test('F14 ⭐ `transactions`（契约 §2.11）：列出事务、可按 txId 查、并报告 `blocked`', async () => {
  const { engine } = fakeEngine();
  try {
    const all = await engine.transactions({});
    assert.equal(all.ok, true, `transactions 失败：${JSON.stringify(all.error)}`);
    const list = all.data.transactions;
    assert.ok(list.length >= 3, `样例应含 ≥3 条事务，实得 ${list.length}`);
    // 新→旧
    for (let i = 1; i < list.length; i++) {
      assert.ok((list[i - 1].startedAt || 0) >= (list[i].startedAt || 0), '事务表应按时间新→旧');
    }
    // 每条都要有界面要用的字段
    for (const t of list) {
      assert.ok(t.txId && t.libId && t.op && t.state, `事务缺字段：${JSON.stringify(t)}`);
      assert.equal(typeof t.canUndo, 'boolean', 'canUndo 必须显式给（界面据此决定按钮）');
      assert.equal(typeof t.canRollback, 'boolean');
    }
    assert.equal(all.data.blocked, false, '默认没有未收尾事务 ⇒ blocked=false（否则索引任务一上来就被拒）');

    // 有一条"待处理"（recovery_needed），界面要能演示三条路
    const pending = list.find((t) => t.state === 'recovery_needed');
    assert.ok(pending, '样例里应有一条 recovery_needed，否则「待处理」演示不了');
    assert.equal(pending.canUndo, true);
    assert.equal(pending.canRollback, true);

    // 按 id 查（SPEC-transactions §9 的"据 id 查询状态"）
    const one = await engine.transactions({ txId: 'tx-2f9c' });
    assert.equal(one.data.transactions.length, 1);
    assert.equal(one.data.transactions[0].txId, 'tx-2f9c');
    assert.equal((await engine.transactions({ txId: '不存在' })).data.transactions.length, 0);
  } finally { engine._fake.__dispose(); }
});

test('F15 ⭐ 撤销一条待处理事务：状态、canUndo 与 blocked 都要跟着变', async () => {
  const { engine } = fakeEngine();
  try {
    const before = (await engine.transactions({ txId: 'tx-2f9c' })).data.transactions[0];
    assert.equal(before.state, 'recovery_needed');
    assert.equal(before.canUndo, true);

    const r = await engine.mutate({ libId: 'L1', op: 'undo', params: { txId: 'tx-2f9c' } });
    assert.equal(r.ok, true, `撤销失败：${JSON.stringify(r.error)}`);

    const after = (await engine.transactions({ txId: 'tx-2f9c' })).data.transactions[0];
    assert.equal(after.state, 'undone', '撤销后状态要变 —— 否则界面会让人反复点同一个按钮');
    assert.equal(after.canUndo, false, '撤销过的不该还能再撤');
    assert.equal(after.canRollback, false);
    assert.equal((await engine.transactions({})).data.blocked, false);
  } finally { engine._fake.__dispose(); }
});

test('F15b ⭐ 不可撤销的事务**如实拒绝**（`UNDO_EXPIRED`），不假装成功', async () => {
  const { engine } = fakeEngine();
  try {
    // tx-2f9b 是 committed 且 canUndo:false（已过撤销期）
    const r = await engine.mutate({ libId: 'L1', op: 'undo', params: { txId: 'tx-2f9b' } });
    assert.equal(r.ok, false, '撤销一个不可撤销的事务不该返回 ok');
    assert.equal(r.error.code, ERR.UNDO_EXPIRED);
    assert.ok(r.error.userMessage);
    // 状态没被改坏
    const t = (await engine.transactions({ txId: 'tx-2f9b' })).data.transactions[0];
    assert.equal(t.state, 'committed');
  } finally { engine._fake.__dispose(); }
});

test('F15c 写操作会**记进台账**（界面据此显示"最近发生了什么"）', async () => {
  const { engine } = fakeEngine();
  try {
    const n0 = (await engine.transactions({})).data.transactions.length;
    const r = await engine.mutate({ libId: 'L1', uid: 'a00000000001', op: 'rename', params: {} });
    assert.equal(r.ok, true);
    const list = (await engine.transactions({})).data.transactions;
    assert.equal(list.length, n0 + 1, '新事务要出现在台账里');
    assert.equal(list[0].txId, r.data.txId, '而且是最新那条');
    assert.equal(list[0].op, 'rename');
    assert.equal(list[0].state, 'committed');
    assert.equal(list[0].needsReencode, false, '改 ID 不动像素 ⇒ 复用向量（P3c 的 IA2b 同口径）');
  } finally { engine._fake.__dispose(); }
});

test('F16 ⭐ 真实模式 `transactions` 如实返回 `INTERNAL`（不返回空数组假装"没有事务"）', async () => {
  const engine = createEngine({ config: {}, encoder: null });
  const r = await engine.transactions({});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.INTERNAL);
  assert.ok(r.error.userMessage);
});

test('F17 ⭐⭐ `UNIMPLEMENTED_METHODS` 与假套件**逐一对得上**，且真实模式全部 INTERNAL', async () => {
  // 防"两边漂移"：假套件里少接一个 ⇒ 契约 §8 的演示能力缺一块，而且缺得**静默**
  //（界面会拿到 INTERNAL，看起来像"没实现"，其实是"套件里名字写错了"）。
  const { engine: fake0 } = fakeEngine();
  try {
    for (const m of UNIMPLEMENTED_METHODS) {
      assert.equal(typeof fake0._fake[m], 'function',
        `假套件缺 ${m} —— 引擎侧就是 fakeKit[name]，键名必须与方法名一致`);
    }
  } finally { fake0._fake.__dispose(); }

  // 真实模式下这**每一个**都必须是 INTERNAL（不许假装成功，也不许 undefined）
  const engine = createEngine({ config: {}, encoder: null });
  for (const m of UNIMPLEMENTED_METHODS) {
    const r = await engine[m]({});
    assert.equal(r.ok, false, `真实模式 ${m} 不该返回 ok`);
    assert.equal(r.error.code, ERR.INTERNAL, `真实模式 ${m} 的错误码应是 INTERNAL`);
    assert.ok(r.error.userMessage, `${m} 的错误信封要有 userMessage`);
  }

  // 模拟模式下这**每一个**都要真的能调通（不是 undefined）
  const { engine: fake } = fakeEngine();
  try {
    for (const m of UNIMPLEMENTED_METHODS) {
      const r = await fake[m]({ libId: 'L1' });
      assert.notEqual(r, undefined, `模拟模式 ${m} 返回了 undefined —— 假套件没接上`);
      assert.equal(r.ok, true, `模拟模式 ${m} 应能演示：${JSON.stringify(r.error)}`);
    }
  } finally { fake._fake.__dispose(); }
});

test('F11 `createFakeKit` 必须注入 `bandOf` —— 不许在本模块里重算档位阈值', () => {
  assert.throws(() => createFakeKit({ fixture: loadSampleIndex() }), /bandOf/,
    '不注入 bandOf 应当当场抛：那会造出第二份阈值（P2 / F-02 的教训）');
});

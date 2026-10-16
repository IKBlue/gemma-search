// packages/engine/tests/engine.test.mjs —— 引擎读写路径（注入假编码器 + 临时素材库，不碰真实库）
//
// 目的：**引擎的全部逻辑都能在无模型、无 GPU、无真实库的条件下测**
// —— 这正是"依赖注入 + packages/engine 零依赖"换来的东西。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, bandOf, BANDS, indexPathFor } from '../src/engine.ts';
import { uidOf } from '../src/uid.ts';
import { ERR, USER_MESSAGE } from '../src/errors.ts';

import { makeLibrary, writeIndexFixture, fakeEncoder } from './helpers/lib-fixture.mjs';

// uid 公式的实现**只有一份**：packages/engine/src/uid.ts（原来这里内联了一份副本，属 P1 违规，已接回）

function setup({ libs = 1, suffix = '' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-eng-'));
  const libRoot = path.join(tmp, 'lib');
  const idxRoot = path.join(tmp, 'idx');
  const made = makeLibrary();
  fs.cpSync(made.root, libRoot, { recursive: true });
  const config = { libraries: [], data_dir: path.join(tmp, 'data') };
  for (let i = 1; i <= libs; i++) {
    const libId = 'L' + i;
    config.libraries.push({ libId, root: libRoot, label: '库' + i });
    writeIndexFixture(indexPathFor(path.join(tmp, 'data'), libId), libId, made.rows, {
      libRoot,
      suffix: i === 1 ? '' : suffix,
    });
  }
  return { tmp, libRoot, idxRoot, config, dataDir: path.join(tmp, 'data'), rows: made.rows };
}

// ---------------- indexStatus ----------------

test('indexStatus：返回每个库的 indexed/encoded/compat/healthy', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.indexStatus();
  assert.equal(r.ok, true);
  assert.equal(r.data.libs.length, 1);
  const l = r.data.libs[0];
  assert.equal(l.libId, 'L1');
  assert.equal(l.indexed, 4);
  assert.equal(l.encoded, 4);
  assert.equal(l.dim, 8);
  assert.equal(l.rootExists, true);
  assert.equal(l.healthy, true, JSON.stringify(l.problems));
  assert.ok(l.compat.includes('|140|8|'));
});

test('indexStatus：库根不存在时 rootExists=false 且不抛异常', async () => {
  const s = setup();
  fs.rmSync(s.libRoot, { recursive: true, force: true });
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.indexStatus();
  assert.equal(r.ok, true);
  assert.equal(r.data.libs[0].rootExists, false);
  assert.equal(r.data.libs[0].healthy, false);
});

test('indexStatus：索引损坏 → problems 里带 INDEX_CORRUPT，且**不**抛给调用方', async () => {
  const s = setup();
  const p = path.join(indexPathFor(s.dataDir, 'L1'), 'index.bin');
  const buf = fs.readFileSync(p);
  buf[0] = 0;
  fs.writeFileSync(p, buf);
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.indexStatus();
  assert.equal(r.ok, true);
  assert.equal(r.data.libs[0].healthy, false);
  assert.equal(r.data.libs[0].problems[0].code, ERR.INDEX_CORRUPT);
});

// ---------------- search ----------------

test('search(text)：命中同向条目，band 由引擎给（界面不自己算）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder('first') });
  const r = await e.search({ mode: 'text', text: '北欧吊灯', topK: 3 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.results.length, 3);
  assert.equal(r.data.results[0].uid, uidOf('L1', 'VR', 'ID-1'));
  assert.ok(Math.abs(r.data.results[0].score - 1) < 1e-6, '与 fixture 第 1 条同向，余弦应为 1');
  assert.equal(r.data.results[0].band, 'high');
  assert.equal(r.data.results[0].archive.relPath, 'VR\\a.rar');
  assert.equal(r.data.results[0].archive.ext, '.rar');
  assert.ok(r.data.results[0].archive.size > 0, 'archive.size 取自真实文件');
  assert.ok(r.data.tookMs >= 0);
});

test('search：结果带 libsSkipped 口径（无跳过时为 []）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'text', text: 'x', libIds: ['L1'] });
  assert.deepEqual(r.data.libsUsed, ['L1']);
  assert.deepEqual(r.data.libsSkipped, []);
});

test('search：filters 生效（按 folder / ext 过滤）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const a = await e.search({ mode: 'text', text: 'x', filters: { folders: ['CR'] } });
  assert.ok(a.data.results.every((x) => x.folder === 'CR'));
  const b = await e.search({ mode: 'text', text: 'x', filters: { exts: ['.jpg'] } });
  assert.ok(b.data.results.every((x) => x.imageExt === '.jpg'));
});

test('search：空文本 → BAD_REQUEST（信封，不抛）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'text', text: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.BAD_REQUEST);
});

test('search：未知 mode → BAD_REQUEST', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'nope' });
  assert.equal(r.error.code, ERR.BAD_REQUEST);
});

test('search：未注入编码器 → MODEL_MISSING', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: null });
  const r = await e.search({ mode: 'text', text: 'x' });
  assert.equal(r.error.code, ERR.MODEL_MISSING);
});

test('search(image)：queryImagePath 是唯一允许的库外输入，且扩展名受限', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const q = path.join(s.tmp, 'q.jpg');
  fs.writeFileSync(q, 'x');
  const good = await e.search({ mode: 'image', queryImagePath: q });
  assert.equal(good.ok, true);
  const bad = await e.search({ mode: 'image', queryImagePath: path.join(s.tmp, 'q.exe') });
  assert.equal(bad.error.code, ERR.BAD_REQUEST);
});

test('search(image)：库内 imageRef 走 uid → 路径解析（不接受客户端路径）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const uid = uidOf('L1', 'CR', 'ID-3');
  const r = await e.search({ mode: 'image', imageRef: { libId: 'L1', uid } });
  assert.equal(r.ok, true);
  const bad = await e.search({ mode: 'image', imageRef: { libId: 'L1', uid: '不存在000000' } });
  assert.equal(bad.error.code, ERR.UID_NOT_FOUND);
});

// ---------------- 多库与 compat ----------------

test('多库：compat 相等 → 一起检索，结果带 libId', async () => {
  const s = setup({ libs: 2 });
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'text', text: 'x', topK: 20 });
  assert.deepEqual(r.data.libsUsed.sort(), ['L1', 'L2']);
  assert.ok(r.data.results.some((x) => x.libId === 'L2'));
});

test('多库：compat 不等 → 该库进 libsSkipped 并给**结构化原因**（契约 §6）', async () => {
  const s = setup({ libs: 2, suffix: '-DIFFERENT' });
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'text', text: 'x', topK: 20 });
  assert.deepEqual(r.data.libsUsed, ['L1']);
  assert.equal(r.data.libsSkipped.length, 1);
  const sk = r.data.libsSkipped[0];
  assert.equal(sk.libId, 'L2');
  assert.equal(sk.reason.kind, 'compat-mismatch');
  assert.equal(sk.reason.mismatches[0].field, 'model_repo');
  assert.ok(sk.reason.mismatches[0].expected && sk.reason.mismatches[0].actual);
  assert.ok(sk.reason.userMessage.includes('model_repo'), 'must name the offending field');
});

test('多库：device 不同**不**导致跳过（否则 CPU 回退会拒绝自己的索引）', async () => {
  const s = setup({ libs: 2 });
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.search({ mode: 'text', text: 'x', topK: 20 });
  assert.deepEqual(r.data.libsUsed.sort(), ['L1', 'L2']);
});

// ---------------- scan ----------------

test('scan：新增 / 消失 / 变化 都能报出（只读）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  // 新增一个
  fs.writeFileSync(path.join(s.libRoot, 'VR', 'ID-9.jpg'), 'new');
  // 删掉一个（连带它的包，避免包仍存在造成干扰）
  fs.rmSync(path.join(s.libRoot, 'CR', 'ID-4.jpg'));
  fs.rmSync(path.join(s.libRoot, 'CR', 'd.7z'));
  // 改一个（尺寸变）
  fs.writeFileSync(path.join(s.libRoot, 'VR', 'ID-2.png'), 'bigger-content-than-before');

  const r = await e.scan({ libId: 'L1' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(r.data.new.some((x) => x.relPath === 'VR\\ID-9.jpg'));
  assert.ok(r.data.missing.some((x) => x.relPath === 'CR\\ID-4.jpg'));
  assert.ok(r.data.changed.some((x) => x.relPath === 'VR\\ID-2.png' && x.what.includes('size')));
  assert.match(r.data.fingerprintV1, /^[0-9a-f]{40}$/);
  assert.ok(r.data.filesTotal > 0);
});

// ---------------- item / reveal ----------------

test('item：返回索引条目 + 磁盘实况；文件没了要如实说', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const uid = uidOf('L1', 'VR', 'ID-1');
  const r = await e.item({ libId: 'L1', uid });
  assert.equal(r.ok, true);
  assert.equal(r.data.exists.image, true);
  assert.equal(r.data.exists.archive, true);
  fs.rmSync(path.join(s.libRoot, 'VR', 'a.rar'));
  const r2 = await e.item({ libId: 'L1', uid });
  assert.equal(r2.data.exists.archive, false);
});

test('reveal：走注入的 shell 端口；不经传输层也能测', async () => {
  const s = setup();
  const seen = [];
  const e = createEngine({
    config: s.config,
    encoder: fakeEncoder(),
    shell: { reveal: (p) => seen.push(p) },
  });
  const uid = uidOf('L1', 'VR', 'ID-1');
  const r = await e.reveal({ libId: 'L1', uid, target: 'archive' });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith('a.rar'));
});

test('reveal：文件不在磁盘上 → ITEM_MISSING_ON_DISK', async () => {
  const s = setup();
  fs.rmSync(path.join(s.libRoot, 'VR', 'a.rar'));
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.reveal({ libId: 'L1', uid: uidOf('L1', 'VR', 'ID-1') });
  assert.equal(r.error.code, ERR.ITEM_MISSING_ON_DISK);
});

// ---------------- F-01：未注入 shell 端口必须显式失败，不许静默假成功 ----------------
//
// 这几条是 F-01 的**回归锁定**。原先的实现在端口缺失时照样 `return ok({revealed:true})`，
// 而上面那条"文件不在磁盘上"的用例**覆盖不到它**（它在更早的 existsSync 就抛了），
// 所以"端口缺失"这条路径在修好之前**一条测试都没有** —— 这正是它能长期存活的原因。

test('reveal：未注入 shell 端口 → PORT_MISSING，且 ok 不为 true（不许假成功）', async () => {
  const s = setup();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() }); // 刻意不传 shell
  const r = await e.reveal({ libId: 'L1', uid: uidOf('L1', 'VR', 'ID-1'), target: 'archive' });
  // 最关键的一条：**绝不能**是 ok
  assert.notEqual(r.ok, true, '未注入端口时返回了成功 —— 这就是 F-01 的静默假成功');
  assert.equal(r.error.code, ERR.PORT_MISSING);
  assert.equal(r.error.details.port, 'shell');
  assert.equal(r.error.details.got, 'none');
});

test('reveal：shell 形状不对（缺 reveal / reveal 不是函数）→ 同样 PORT_MISSING', async () => {
  const s = setup();
  const uid = uidOf('L1', 'VR', 'ID-1');
  for (const bad of [{}, { reveal: 'not-a-function' }, { reveal: null }]) {
    const e = createEngine({ config: s.config, encoder: fakeEncoder(), shell: bad });
    const r = await e.reveal({ libId: 'L1', uid, target: 'archive' });
    assert.notEqual(r.ok, true, `shell=${JSON.stringify(bad)} 竟然成功了`);
    assert.equal(r.error.code, ERR.PORT_MISSING, `shell=${JSON.stringify(bad)} 的错误码不对`);
  }
});

test('reveal：端口存在但目标文件不存在 → ITEM_MISSING_ON_DISK，且端口**一次都没被调用**', async () => {
  const s = setup();
  fs.rmSync(path.join(s.libRoot, 'VR', 'a.rar'));
  const seen = [];
  const e = createEngine({
    config: s.config,
    encoder: fakeEncoder(),
    shell: { reveal: (p) => seen.push(p) },
  });
  const r = await e.reveal({ libId: 'L1', uid: uidOf('L1', 'VR', 'ID-1') });
  assert.equal(r.error.code, ERR.ITEM_MISSING_ON_DISK);
  // 顺序很重要：先确认文件在盘上，**再**去调资源管理器。
  // 否则会在"文件早就没了"的情况下给用户弹一个空目录 —— 那也是谎报。
  assert.equal(seen.length, 0, '文件不存在时不该调用 shell.reveal');
});

test('reveal：端口抛错 → 归为 INTERNAL 信封，不把异常漏给调用方', async () => {
  const s = setup();
  const e = createEngine({
    config: s.config,
    encoder: fakeEncoder(),
    shell: {
      reveal: () => {
        throw new Error('explorer 炸了');
      },
    },
  });
  const r = await e.reveal({ libId: 'L1', uid: uidOf('L1', 'VR', 'ID-1'), target: 'archive' });
  // envelope() 的契约：引擎内部异常一律转成信封，**绝不抛给调用方**
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.INTERNAL);
});

test('PORT_MISSING 的用户文案存在，且不含任何绝对路径', () => {
  const msg = USER_MESSAGE[ERR.PORT_MISSING];
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0, '有用户文案');
  // 文案会被界面显示、可能被截图外发 ⇒ 不得含本机路径（AGENTS.md §6）
  assert.ok(!/[A-Za-z]:[\\/]/.test(msg), `文案里不该有盘符路径：${msg}`);
  assert.ok(!msg.includes('\\\\'), `文案里不该有 UNC 路径：${msg}`);
});

test('search：编码器忘了归一化时，引擎自行归一 → 排序与 band 仍正确', async () => {
  const s = setup();
  // normalize:false 的假编码器返回未归一化向量，模长 != 1
  const e = createEngine({ config: s.config, encoder: fakeEncoder('first', { normalize: false }) });
  const r = await e.search({ mode: 'text', text: 'x', topK: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  // 若不归一化，点积 = |v|^2 > 1，band 与阈值都会失真
  assert.ok(r.data.results[0].score <= 1 + 1e-6, 'score 不应超过 1：' + r.data.results[0].score);
  assert.ok(Math.abs(r.data.results[0].score - 1) < 1e-6, '同向向量归一后余弦应为 1');
  assert.equal(r.data.results[0].band, 'high');
});

// ---------------- band 常量 ----------------

test('band：阈值随模态不同（分数不可跨模态比较）', () => {
  assert.equal(bandOf(0.99, 'image'), 'high');
  assert.equal(bandOf(0.99, 'text'), 'high');
  assert.equal(bandOf(0.7, 'image'), 'low'); // 图像模态里 0.70 是低
  assert.equal(bandOf(0.7, 'text'), 'mid'); // 文本模态里 0.70 是中
  assert.notDeepEqual(BANDS.text, BANDS.image);
});

test('band：不认识的模态 → unknown，**不拿文本阈值猜**（R-3）', () => {
  // 原先 `BANDS[mode] || BANDS.text` 会让 `bandOf(0.85,'vector')` 返回 'high' ——
  // 而 'vector' 根本不在 BANDS 里，拿文本阈值给它定档就是"不懂模态却替分数下结论"，
  // 与 F-02（界面自算阈值）是同一根因。
  //
  // ⚠️ **用例必须带原型键**（独立复核 I-5 的教训）：只列 'vector'/'hybrid' 这类普通字符串，
  // 会恰好绕开 `Object.prototype` 上的键 —— 而旧写法 `if (!b)` 对 `BANDS['toString']`
  // 取到真值函数、进而返回 'low'，等于**又编了一个档位**。
  const modes = [
    'vector',
    'hybrid',
    '',
    null,
    undefined,
    'toString',
    'constructor',
    'valueOf',
    '__proto__',
    'hasOwnProperty',
  ];
  for (const mode of modes) {
    assert.equal(bandOf(0.85, mode), 'unknown', `mode=${JSON.stringify(mode)} 不该给出档位`);
    assert.equal(bandOf(0.99, mode), 'unknown', `mode=${JSON.stringify(mode)} 满分也不该定档`);
  }
  // 反例锚：认识的模态必须照常
  assert.equal(bandOf(0.85, 'text'), 'high');
  assert.equal(bandOf(0.85, 'image'), 'mid');
});

// ---------------- collect（取件） ----------------

function setupCollect() {
  const s = setup();
  const dest = path.join(s.tmp, 'dest');
  s.config.collect = { dirs: { 素材待用: dest }, default: '素材待用' };
  return { ...s, dest };
}

test('collect：复制到已配置目录，库侧零变化', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const before = fs.readdirSync(path.join(s.libRoot, 'VR')).sort();
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-1')],
    targetDirName: '素材待用',
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.succeeded.length, 1);
  assert.equal(r.data.succeeded[0].kind, 'archive', '有包时默认取包');
  assert.ok(fs.existsSync(path.join(s.dest, 'a.rar')));
  assert.deepEqual(fs.readdirSync(path.join(s.libRoot, 'VR')).sort(), before, '库目录不应被改动');
});

test('collect：无同名包时自动取图（auto 语义）', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-2')],
    targetDirName: '素材待用',
  });
  assert.equal(r.data.succeeded[0].kind, 'image');
  assert.ok(fs.existsSync(path.join(s.dest, 'ID-2.png')));
});

test('collect：目标已存在 → skipped（**不覆盖**）', async () => {
  const s = setupCollect();
  fs.mkdirSync(s.dest, { recursive: true });
  fs.writeFileSync(path.join(s.dest, 'a.rar'), '已存在的内容');
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-1')],
    targetDirName: '素材待用',
  });
  assert.equal(r.data.succeeded.length, 0);
  assert.equal(r.data.skipped[0].reason, 'already-exists');
  assert.equal(
    fs.readFileSync(path.join(s.dest, 'a.rar'), 'utf8'),
    '已存在的内容',
    '原文件不能被改',
  );
});

test('collect：白名单外/未配置的目标名 → COLLECT_DIR_NOT_ALLOWED', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-1')],
    targetDirName: 'C:\\Windows',
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.COLLECT_DIR_NOT_ALLOWED);
});

test('collect：部分成功必须如实呈现（成功/失败/跳过三分）', async () => {
  const s = setupCollect();
  fs.rmSync(path.join(s.libRoot, 'VR', 'a.rar')); // 源文件缺失 → failed
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-1'), uidOf('L1', 'VR', 'ID-2'), '不存在000000'],
    targetDirName: '素材待用',
  });
  assert.equal(r.data.failed.length, 2, JSON.stringify(r.data.failed));
  assert.equal(r.data.succeeded.length, 1);
  assert.ok(r.data.failed.some((f) => f.error.code === ERR.ITEM_MISSING_ON_DISK));
  assert.ok(r.data.failed.some((f) => f.error.code === ERR.UID_NOT_FOUND));
});

test('collect：target=archive 但该素材无包 → failed 且说明原因', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({
    libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-2')],
    targetDirName: '素材待用',
    target: 'archive',
  });
  assert.equal(r.data.failed.length, 1);
  assert.match(r.data.failed[0].error.message, /没有同名包/);
});

test('collect：uids 为空或超量 → BAD_REQUEST', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  assert.equal(
    (await e.collect({ libId: 'L1', uids: [], targetDirName: '素材待用' })).error.code,
    ERR.BAD_REQUEST,
  );
  assert.equal(
    (await e.collect({ libId: 'L1', uids: Array(201).fill('x'), targetDirName: '素材待用' })).error
      .code,
    ERR.BAD_REQUEST,
  );
});

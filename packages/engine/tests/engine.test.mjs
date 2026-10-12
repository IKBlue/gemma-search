// packages/engine/tests/engine.test.mjs —— 引擎读写路径（注入假编码器 + 临时素材库，不碰真实库）
//
// 目的：**引擎的全部逻辑都能在无模型、无 GPU、无真实库的条件下测**
// —— 这正是"依赖注入 + packages/engine 零依赖"换来的东西。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, bandOf, BANDS, indexPathFor } from '../src/engine.mjs';
import { ERR } from '../src/errors.mjs';

const MAGIC = Buffer.from('4753494458000001', 'hex');

/** 造一个临时素材库：VR/CR 两个文件夹，各 2 图 + 1 包。 */
function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-lib-'));
  const rows = [
    ['VR', 'ID-1', '.jpg', 'a.rar'],
    ['VR', 'ID-2', '.png', null],
    ['CR', 'ID-3', '.jpeg', 'c.zip'],
    ['CR', 'ID-4', '.jpg', 'd.7z'],
  ];
  const items = [];
  for (const [folder, stem, ext, arc] of rows) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, stem + ext), 'img-' + stem);
    if (arc) fs.writeFileSync(path.join(root, folder, arc), 'arc-' + stem);
    items.push({ folder, stem, ext, arc });
  }
  return { root, rows: items };
}

/** 按 SPEC-identity §2 冻结公式算 uid（与构建器一致）。 */
function uidOf(libId, relDir, stem) {
  const dir = relDir === '.' ? '' : relDir;
  return crypto.createHash('sha1').update(`${libId}|${dir}|${stem}`, 'utf8').digest('hex').slice(0, 12);
}

/** 写一份最小合法索引（含 header/footer，向量用可预测值）。
 *  imageSize/imageMtime **取自真实文件** —— 否则 scan 的"变化"检测没有意义。 */
function writeIndexFixture(dir, libId, items, { libRoot, seq = 140, dim = 8, suffix = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const vecs = [];
  const outItems = [];
  items.forEach((it, i) => {
    // 向量必须是 **L2 归一化** 的 —— 真实索引就是这样（SPEC-identity §6.2 normalization:"l2"），
    // 引擎用点积当余弦。用未归一化的 fixture 会让"余弦=1"这类断言失真，
    // 也会掩盖归一化相关的真 bug。
    const raw = new Float32Array(dim);
    for (let d = 0; d < dim; d++) raw[d] = ((i + 1) * (d + 1)) % 7 / 7;
    let n = 0; for (let d = 0; d < dim; d++) n += raw[d] * raw[d];
    n = Math.sqrt(n) || 1;
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = raw[d] / n;
    vecs.push(...v);
    const imgAbs = path.join(libRoot, it.folder, it.stem + it.ext);
    const st = fs.statSync(imgAbs, { bigint: true });
    const arcAbs = it.arc ? path.join(libRoot, it.folder, it.arc) : null;
    outItems.push({
      uid: uidOf(libId, it.folder, it.stem),
      libId, folder: it.folder, stem: it.stem,
      relPath: `${it.folder}\\${it.stem}${it.ext}`,
      imageExt: it.ext,
      imageSize: Number(st.size),
      imageMtime: Number(st.mtimeNs / 1_000_000n),
      archiveRelPath: it.arc ? `${it.folder}\\${it.arc}` : null,
      archiveExt: it.arc ? path.extname(it.arc) : null,
      archiveSize: arcAbs ? Number(fs.statSync(arcAbs, { bigint: true }).size) : null,
      vectorRow: i, vectorSource: 'native',
    });
  });

  const header = {
    format_version: 1, compat_key_version: 1,
    model_repo: 'test/repo' + suffix, model_revision: 'a'.repeat(40),
    model_weights_dtype: 'fp32', preprocessing_version: 1,
    seq_length: seq, dim, normalization: 'l2', pooling: 'mean_soft_tokens',
    count: outItems.length, lib_id: libId,
  };
  header.compat = [header.model_repo, header.model_revision, header.model_weights_dtype,
                   header.preprocessing_version, header.seq_length, header.dim,
                   header.normalization, header.pooling].join('|');
  const body = Buffer.alloc(outItems.length * dim * 4);
  vecs.forEach((x, i) => body.writeFloatLE(x, i * 4));
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(headerJson.length, 0);
  const foot = Buffer.from(JSON.stringify({ count: outItems.length, dim,
    sha1_of_vector_block: crypto.createHash('sha1').update(body).digest('hex'), complete: true }), 'utf8');
  const footLen = Buffer.alloc(4); footLen.writeUInt32LE(foot.length, 0);
  fs.writeFileSync(path.join(dir, 'index.bin'),
    Buffer.concat([MAGIC, lenBuf, headerJson, body, footLen, foot]));
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(outItems));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...header, failed: [] }));
  return { header, items: outItems };
}

/** 假编码器：把文本/图像映射到与 fixture 同构的向量（不加载模型）。 */
function fakeEncoder(mode = 'first', { normalize = true } = {}) {
  // 与 fixture 的生成规则一致（同一个 raw 序列），保证"同向"是可断言的
  const raw = new Float32Array(8);
  const k = mode === 'first' ? 1 : 2;
  for (let d = 0; d < 8; d++) raw[d] = (k * (d + 1)) % 7 / 7;
  if (!normalize) return { async encodeText() { return raw; }, async encodeImage() { return raw; } };
  let n = 0; for (let d = 0; d < 8; d++) n += raw[d] * raw[d];
  n = Math.sqrt(n) || 1;
  const v = new Float32Array(8);
  for (let d = 0; d < 8; d++) v[d] = raw[d] / n;
  return { async encodeText() { return v; }, async encodeImage() { return v; } };
}

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
    writeIndexFixture(indexPathFor(path.join(tmp, 'data'), libId), libId, made.rows,
                      { libRoot, suffix: i === 1 ? '' : suffix });
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
  const buf = fs.readFileSync(p); buf[0] = 0; fs.writeFileSync(p, buf);
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
  const e = createEngine({ config: s.config, encoder: fakeEncoder(), shell: { reveal: (p) => seen.push(p) } });
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
  assert.equal(bandOf(0.70, 'image'), 'low');   // 图像模态里 0.70 是低
  assert.equal(bandOf(0.70, 'text'), 'mid');    // 文本模态里 0.70 是中
  assert.notDeepEqual(BANDS.text, BANDS.image);
});

// ---------------- collect（取件） ----------------

function setupCollect() {
  const s = setup();
  const dest = path.join(s.tmp, 'dest');
  s.config.collect = { dirs: { '素材待用': dest }, default: '素材待用' };
  return { ...s, dest };
}

test('collect：复制到已配置目录，库侧零变化', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const before = fs.readdirSync(path.join(s.libRoot, 'VR')).sort();
  const r = await e.collect({ libId: 'L1', uids: [uidOf('L1', 'VR', 'ID-1')], targetDirName: '素材待用' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.succeeded.length, 1);
  assert.equal(r.data.succeeded[0].kind, 'archive', '有包时默认取包');
  assert.ok(fs.existsSync(path.join(s.dest, 'a.rar')));
  assert.deepEqual(fs.readdirSync(path.join(s.libRoot, 'VR')).sort(), before, '库目录不应被改动');
});

test('collect：无同名包时自动取图（auto 语义）', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({ libId: 'L1', uids: [uidOf('L1', 'VR', 'ID-2')], targetDirName: '素材待用' });
  assert.equal(r.data.succeeded[0].kind, 'image');
  assert.ok(fs.existsSync(path.join(s.dest, 'ID-2.png')));
});

test('collect：目标已存在 → skipped（**不覆盖**）', async () => {
  const s = setupCollect();
  fs.mkdirSync(s.dest, { recursive: true });
  fs.writeFileSync(path.join(s.dest, 'a.rar'), '已存在的内容');
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({ libId: 'L1', uids: [uidOf('L1', 'VR', 'ID-1')], targetDirName: '素材待用' });
  assert.equal(r.data.succeeded.length, 0);
  assert.equal(r.data.skipped[0].reason, 'already-exists');
  assert.equal(fs.readFileSync(path.join(s.dest, 'a.rar'), 'utf8'), '已存在的内容', '原文件不能被改');
});

test('collect：白名单外/未配置的目标名 → COLLECT_DIR_NOT_ALLOWED', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({ libId: 'L1', uids: [uidOf('L1', 'VR', 'ID-1')], targetDirName: 'C:\\Windows' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERR.COLLECT_DIR_NOT_ALLOWED);
});

test('collect：部分成功必须如实呈现（成功/失败/跳过三分）', async () => {
  const s = setupCollect();
  fs.rmSync(path.join(s.libRoot, 'VR', 'a.rar'));           // 源文件缺失 → failed
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({ libId: 'L1',
    uids: [uidOf('L1', 'VR', 'ID-1'), uidOf('L1', 'VR', 'ID-2'), '不存在000000'],
    targetDirName: '素材待用' });
  assert.equal(r.data.failed.length, 2, JSON.stringify(r.data.failed));
  assert.equal(r.data.succeeded.length, 1);
  assert.ok(r.data.failed.some((f) => f.error.code === ERR.ITEM_MISSING_ON_DISK));
  assert.ok(r.data.failed.some((f) => f.error.code === ERR.UID_NOT_FOUND));
});

test('collect：target=archive 但该素材无包 → failed 且说明原因', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  const r = await e.collect({ libId: 'L1', uids: [uidOf('L1', 'VR', 'ID-2')],
                              targetDirName: '素材待用', target: 'archive' });
  assert.equal(r.data.failed.length, 1);
  assert.match(r.data.failed[0].error.message, /没有同名包/);
});

test('collect：uids 为空或超量 → BAD_REQUEST', async () => {
  const s = setupCollect();
  const e = createEngine({ config: s.config, encoder: fakeEncoder() });
  assert.equal((await e.collect({ libId: 'L1', uids: [], targetDirName: '素材待用' })).error.code, ERR.BAD_REQUEST);
  assert.equal((await e.collect({ libId: 'L1', uids: Array(201).fill('x'), targetDirName: '素材待用' })).error.code, ERR.BAD_REQUEST);
});
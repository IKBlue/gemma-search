// tests/index.test.mjs —— index.mjs 与 compat.mjs 的单元测试（零依赖，node:test）
//
// 这些测试的重点是**损坏检测**：索引静默损坏是本项目最危险的失败模式。
// 每条都构造一个"坏"的 index.bin，断言它被**拒绝**而不是被当成有效数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readIndexBin, readItems, readMeta, relOf, MAGIC, HEAD_OFF, LEN_OFF } from '../core/index.mjs';
import { compatKey, compatComplete, compatMismatches, compatEqual, compatReason,
         COMPAT_FIELDS } from '../core/compat.mjs';
import { EngineError, ERR, envelope, err, ok } from '../core/errors.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.dirname(HERE);

/** 按 SPEC-identity §7 写一个最小合法索引，用于构造各种损坏样本。 */
function writeIndex(file, { count, dim, header = {}, breakFooter = null, truncate = 0 } = {}) {
  const body = Buffer.alloc(count * dim * 4);
  for (let i = 0; i < count * dim; i++) body.writeFloatLE((i % 7) / 7, i * 4);
  const h = { format_version: 1, count, dim, ...header };
  const headerJson = Buffer.from(JSON.stringify(h), 'utf8');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(headerJson.length, 0);
  let foot = { count, dim, sha1_of_vector_block: crypto.createHash('sha1').update(body).digest('hex'),
               complete: true };
  if (breakFooter) foot = { ...foot, ...breakFooter };
  const footJson = Buffer.from(JSON.stringify(foot), 'utf8');
  const footLen = Buffer.alloc(4); footLen.writeUInt32LE(footJson.length, 0);
  let out = Buffer.concat([MAGIC, lenBuf, headerJson, body, footLen, footJson]);
  if (truncate) out = out.subarray(0, out.length - truncate);
  fs.writeFileSync(file, out);
  return file;
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gs-idx-'));
}

test('index: 合法索引可读回，且向量与写入一致', () => {
  const d = tmpdir();
  const f = writeIndex(path.join(d, 'index.bin'), { count: 3, dim: 4, header: { seq_length: 140 } });
  const r = readIndexBin(f);
  assert.equal(r.count, 3);
  assert.equal(r.dim, 4);
  assert.equal(r.header.seq_length, 140);
  assert.ok(r.vectors instanceof Float32Array);
  assert.equal(r.vectors.length, 12);
  assert.ok(Math.abs(r.vectors[1] - 1 / 7) < 1e-6);
});

test('index: MAGIC 不对 → INDEX_CORRUPT（不是"读到了半个文件"）', () => {
  const d = tmpdir();
  const f = writeIndex(path.join(d, 'index.bin'), { count: 2, dim: 2 });
  const buf = fs.readFileSync(f);
  buf[0] = 0x00;                                  // 破坏 MAGIC 首字节
  fs.writeFileSync(f, buf);
  assert.throws(() => readIndexBin(f), (e) => e instanceof EngineError && e.code === ERR.INDEX_CORRUPT);
});

test('index: 截断文件 → 拒绝（footer 校验起作用）', () => {
  const d = tmpdir();
  const f = writeIndex(path.join(d, 'index.bin'), { count: 2, dim: 2, truncate: 10 });
  assert.throws(() => readIndexBin(f), (e) => e.code === ERR.INDEX_CORRUPT);
});

test('index: footer.complete 不是 true → 拒绝（写入未完成的判定）', () => {
  const d = tmpdir();
  const f = writeIndex(path.join(d, 'index.bin'), { count: 2, dim: 2, breakFooter: { complete: false } });
  assert.throws(() => readIndexBin(f), (e) => e.code === ERR.INDEX_CORRUPT);
});

test('index: 向量块被改一个字节 → sha1 不符 → 拒绝', () => {
  const d = tmpdir();
  const f = writeIndex(path.join(d, 'index.bin'), { count: 2, dim: 2 });
  const buf = fs.readFileSync(f);
  const headerLen = buf.readUInt32LE(LEN_OFF);
  buf[HEAD_OFF + headerLen + 1] ^= 0xff;           // 翻转向量块里的一个字节
  fs.writeFileSync(f, buf);
  assert.throws(() => readIndexBin(f), (e) => e.code === ERR.INDEX_CORRUPT);
});

test('index: 文件不存在 → INDEX_MISSING（与"损坏"区分开）', () => {
  const d = tmpdir();
  assert.throws(() => readIndexBin(path.join(d, 'nope.bin')),
                (e) => e.code === ERR.INDEX_MISSING);
});

test('index: readItems / readMeta 对坏 JSON 抛 INDEX_CORRUPT', () => {
  const d = tmpdir();
  const bad = path.join(d, 'items.json');
  fs.writeFileSync(bad, '{ not json');
  assert.throws(() => readItems(bad), (e) => e.code === ERR.INDEX_CORRUPT);
  fs.writeFileSync(bad, '[]');
  assert.throws(() => readItems(bad), (e) => e.code === ERR.INDEX_CORRUPT);
  const m = path.join(d, 'meta.json');
  fs.writeFileSync(m, 'x');
  assert.throws(() => readMeta(m), (e) => e.code === ERR.INDEX_CORRUPT);
});

test('index: relOf 同时认新格式 relPath 与旧档 rel_path', () => {
  assert.equal(relOf({ relPath: 'VR\\a.jpg' }), 'VR\\a.jpg');
  assert.equal(relOf({ rel_path: 'VR\\a.jpg' }), 'VR\\a.jpg');
  assert.equal(relOf({}), null);
  assert.equal(relOf(null), null);
});

// ---------------- compat ----------------

const H = (over = {}) => ({
  model_repo: 'onnx-community/embeddinggemma-2-ONNX',
  model_revision: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  model_weights_dtype: 'fp32', preprocessing_version: 1,
  seq_length: 140, dim: 768, normalization: 'l2', pooling: 'mean_soft_tokens',
  ...over,
});

test('compat: 8 个成员，顺序固定', () => {
  assert.equal(COMPAT_FIELDS.length, 8);
  assert.deepEqual([...COMPAT_FIELDS], ['model_repo', 'model_revision', 'model_weights_dtype',
    'preprocessing_version', 'seq_length', 'dim', 'normalization', 'pooling']);
});

test('compat: device / gpu 型号**不参与**（否则 CPU 回退会拒绝自己的索引）', () => {
  const a = H({ runtime: { device: 'webgpu', gpu_model: 'RTX 2060', gpu_driver: '591.44' } });
  const b = H({ runtime: { device: 'cpu', gpu_model: null, gpu_driver: null } });
  assert.equal(compatKey(a), compatKey(b));
  assert.ok(compatEqual(a, b));
});

test('compat: seq 不同 → 不等，并给出逐字段差异', () => {
  const m = compatMismatches(H(), H({ seq_length: 280 }));
  assert.deepEqual(m, [{ field: 'seq_length', expected: 140, actual: 280 }]);
  assert.ok(!compatEqual(H(), H({ seq_length: 280 })));
});

test('compat: 权重精度不同 → 不等（fp32 vs q4f16）', () => {
  const m = compatMismatches(H(), H({ model_weights_dtype: 'q4f16' }));
  assert.deepEqual(m, [{ field: 'model_weights_dtype', expected: 'fp32', actual: 'q4f16' }]);
});

test('compat: 字段不齐 → 视为不完整，不参与相等判定', () => {
  assert.ok(!compatComplete({ seq_length: 140 }));
  assert.ok(!compatEqual(H(), { seq_length: 140 }));
});

test('compat: compatReason 结构化原因含"哪一项不符 + 期望 + 实际"（契约 §6）', () => {
  const r = compatReason(H(), H({ seq_length: 280, model_weights_dtype: 'q4f16' }), 'L2');
  assert.equal(r.kind, 'compat-mismatch');
  assert.equal(r.mismatches.length, 2);
  // 顺序按 COMPAT_FIELDS 的规范顺序（确定性优先），所以这里不假设哪个排前面
  assert.deepEqual(r.mismatches.map((m) => m.field).sort(),
                   ['model_weights_dtype', 'seq_length']);
  const byField = Object.fromEntries(r.mismatches.map((m) => [m.field, m]));
  assert.equal(byField.seq_length.expected, 140);
  assert.equal(byField.seq_length.actual, 280);
  assert.equal(byField.model_weights_dtype.expected, 'fp32');
  assert.equal(byField.model_weights_dtype.actual, 'q4f16');
  assert.ok(r.expectedCompat.includes('|140|'));
  assert.ok(r.actualCompat.includes('|280|'));
  assert.match(r.userMessage, /seq_length/);
  assert.match(r.userMessage, /期望 140，实际 280/);
});

test('compat: 真实索引用例（data/idx-full 存在时读其 header 并自比）', (t) => {
  const meta = path.join(ROOT, 'data', 'idx-full', 'meta.json');
  if (!fs.existsSync(meta)) return t.skip('尚无 data/idx-full/meta.json');
  const h = JSON.parse(fs.readFileSync(meta, 'utf8'));
  assert.ok(compatComplete(h), '真实索引的 compat 字段应齐全：' + JSON.stringify(
    COMPAT_FIELDS.filter((f) => h[f] === undefined)));
  assert.equal(compatKey(h), h.compat, 'meta.compat 应与按字段算出的串一致');
  assert.ok(compatEqual(h, h));
});

// ---------------- 信封 ----------------

test('errors: 信封形状（成功/失败）', () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, data: { a: 1 }, warnings: [] });
  const e = err(ERR.INDEX_CORRUPT, '坏', { file: 'x' });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, 'INDEX_CORRUPT');
  assert.equal(e.error.userMessage, '索引文件已损坏，需要重建。');
  assert.equal(e.error.details.file, 'x');
});

test('errors: 每个错误码都有用户可见文案（且不含绝对路径）', () => {
  for (const code of Object.values(ERR)) {
    const e = err(code);
    assert.ok(e.error.userMessage && e.error.userMessage.length > 0, `${code} 缺 userMessage`);
    assert.ok(!/[A-Za-z]:\\/.test(e.error.userMessage), `${code} 的 userMessage 含绝对路径`);
  }
});

test('errors: envelope 永不抛异常给调用方', async () => {
  const r1 = await envelope(async () => { throw new EngineError(ERR.UID_NOT_FOUND, 'x'); });
  assert.equal(r1.error.code, 'UID_NOT_FOUND');
  const r2 = await envelope(async () => { throw new Error('boom'); });
  assert.equal(r2.error.code, 'INTERNAL');
  const r3 = await envelope(async () => ok({ v: 1 }));
  assert.equal(r3.ok, true);
});

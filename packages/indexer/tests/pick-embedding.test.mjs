// packages/indexer/tests/pick-embedding.test.mjs —— ENC-1/D3：句向量取用必须**唯一实现**且拒绝全零
//
// 为什么单列一组：这段逻辑以前在 5 处各有一份副本（main/encoder · build_index_onnx · encode_queries ·
// spike_onnx · diagnose_resize_kernel），而它们用 `Math.sqrt(n) || 1` 挡住除零 ⇒ 不会 NaN，
// 但在 T === 0 / 整块全零时**静默产出全零向量**：检索永不命中、不报错、不崩溃。
// 本组钉住：正常路径（透出 / mean-pool + L2 归一）不变，坏输入**一律拒绝**。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickEmbedding } from '../src/embedding.ts';

const f32 = (arr) => Float32Array.from(arr);

test('ENC-1 ⭐ sentence_embedding / text_embeds 直接透出（非零）', () => {
  const se = pickEmbedding({ sentence_embedding: { data: f32([0.1, 0.2]), dims: [1, 2] } });
  assert.equal(se.how, 'sentence_embedding');
  assert.deepEqual(se.dims, [1, 2]);
  assert.ok(Math.abs(se.data[0] - 0.1) < 1e-6, 'float32 的 0.1 只到 ~1e-8 精度');
  const te = pickEmbedding({ text_embeds: { data: f32([0.3, 0.4]), dims: [1, 2] } });
  assert.equal(te.how, 'text_embeds');
});

test('ENC-1 ⭐⭐ last_hidden_state：mean-pool + L2 归一（正常路径的数值不变）', () => {
  // B=1, T=2, D=2：行 [1,0] 与 [0,1] ⇒ 均值 [0.5,0.5] ⇒ 归一 [√2/2, √2/2]
  const r = pickEmbedding({ last_hidden_state: { data: f32([1, 0, 0, 1]), dims: [1, 2, 2] } });
  assert.equal(r.how, 'mean_pool(last_hidden_state)');
  assert.deepEqual(r.dims, [1, 2]);
  const norm = Math.hypot(r.data[0], r.data[1]);
  assert.ok(Math.abs(norm - 1) < 1e-6, '必须仍是 L2 归一（‖v‖=1），实得 ' + norm);
  assert.ok(Math.abs(r.data[0] - Math.SQRT1_2) < 1e-6, 'float32 下 √2/2 有 ~1e-8 误差');
});

test('ENC-1 ⭐⭐ 全零输入必须**拒绝并报错**（不许静默返回全零向量 —— 检索永不命中）', () => {
  // 旧行为：`Math.sqrt(n) || 1` ⇒ 归一化成 0/1 = 0 ⇒ 悄悄回一个全零向量（静默失效）
  assert.throws(() => pickEmbedding({ last_hidden_state: { data: f32([0, 0, 0, 0]), dims: [1, 2, 2] } }), /全零/);
  assert.throws(() => pickEmbedding({ sentence_embedding: { data: f32([0, 0]), dims: [1, 2] } }), /全零/);
  assert.throws(() => pickEmbedding({ text_embeds: { data: f32([0]), dims: [1, 1] } }), /全零/);
});

test('ENC-1 ⭐⭐ T === 0 与「三者都缺」也必须报错（三种坏输入都不许静默）', () => {
  assert.throws(() => pickEmbedding({ last_hidden_state: { data: f32([]), dims: [1, 0, 4] } }), /T === 0/);
  assert.throws(() => pickEmbedding({}), /既无 sentence_embedding 也无 last_hidden_state/);
});

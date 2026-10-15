// packages/indexer/src/embedding.ts —— 模型输出 → 句向量：**唯一实现**（ENC-1 / AGENTS P1）
//
// 为什么必须收敛：这段逻辑以前在 **5 处**各有一份副本 ——
//   main/encoder.ts · build_index_onnx.ts · encode_queries.ts · spike_onnx.ts · diagnose_resize_kernel.ts。
// 副本的失败模式是**静默**的：`n = Math.sqrt(n) || 1` 在 T === 0（或整块全零）时不会 NaN，
// 而是产出**全零向量** —— 检索永不命中、不报错、不崩溃（本项目最怕的那类失败）。
// ⇒ ENC-1：一份实现 + **拒绝**全零（不静默归一化成 0）。
import type { ModelOutputView, TensorView } from './third_party_types.ts';

/** 取出的句向量 + 取法（`how` 会写进 index.bin 的 meta / 诊断，务必保持取值稳定） */
export interface PickedEmbedding {
  data: ArrayLike<number>;
  dims: number[];
  how: string;
}

/** 全零 = 无效输入：直接拒绝（不许静默返回一个"检索永不命中"的向量） */
function assertNotAllZero(data: ArrayLike<number>, how: string): void {
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) return;
  throw new Error('pickEmbedding：' + how + ' 是**全零向量**（无效输入，检索永不命中）⇒ 拒绝，不静默返回');
}

function fromTensor(t: TensorView, how: string): PickedEmbedding {
  assertNotAllZero(t.data, how);
  return { data: t.data, dims: t.dims, how };
}

/**
 * 从模型输出里取句向量：优先 `sentence_embedding`，其次 `text_embeds`，
 * 最后对 `last_hidden_state` 做 mean-pool + L2 归一。
 *
 * @throws 三者都没有 / T === 0 / 结果是全零向量（**这三种都不许静默**）
 */
export function pickEmbedding(out: ModelOutputView): PickedEmbedding {
  const se = out.sentence_embedding;
  if (se) return fromTensor(se, 'sentence_embedding');
  const te = out.text_embeds;
  if (te) return fromTensor(te, 'text_embeds');
  const lh = out.last_hidden_state;
  if (!lh) throw new Error('输出里既无 sentence_embedding 也无 last_hidden_state，实际键: ' + Object.keys(out).join(','));
  const [B, T, D] = lh.dims;
  if (!(T > 0)) throw new Error('pickEmbedding：last_hidden_state 的 T === 0（没有可池化的 token）⇒ 拒绝，不产出全零向量');
  const data = new Float32Array(B * D);
  for (let b = 0; b < B; b++) {
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < D; d++) data[b * D + d] += lh.data[(b * T + t) * D + d];
    }
    let n = 0;
    for (let d = 0; d < D; d++) n += data[b * D + d] * data[b * D + d];
    n = Math.sqrt(n);
    if (!(n > 0)) throw new Error('pickEmbedding：均值池化结果是**全零向量**（第 ' + b + ' 行）⇒ 拒绝，不静默归一化成 0');
    for (let d = 0; d < D; d++) data[b * D + d] /= n;
  }
  return { data, dims: [B, D], how: 'mean_pool(last_hidden_state)' };
}

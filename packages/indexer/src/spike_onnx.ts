// spike_onnx.mjs —— 用 transformers.js + onnxruntime-node 编码同一批样本（与 spike_torch.py 同构输出）。
//
// 用法:
//   node spike_onnx.mjs <本地模型目录> <seq> <输出.json> [选择.json]
//
// 关键点（都与 Python 侧对齐，否则测出来的差异是预处理的、不是运行时的）：
//   1. config.audio_config = null  → 不加载音频塔（也不需要它的权重）
//   2. processor.image_seq_length / image_processor.max_soft_tokens = seq
//      Python 侧 apply_seq() 就是改这几处
//   3. 文本查询加前缀 "task: search result | query: "（取自 config_sentence_transformers.json）
//      图像**不加**任何前缀（模型卡要求）

import fs from 'node:fs';
import path from 'node:path';
import type { ModelDevice, ModelOutputView } from './third_party_types.ts';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';

const [modelDir, seqArg, outPath, selectionPath, deviceArg] = process.argv.slice(2);
if (!modelDir || !seqArg || !outPath) {
  console.error('用法: node spike_onnx.mjs <模型目录> <seq> <输出.json> [选择.json] [device]');
  process.exit(2);
}
const SEQ = parseInt(seqArg, 10);
const DEVICE = deviceArg || 'cpu';
const SELECTION = selectionPath || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'spike_selection.json');

const QUERY_PREFIX = 'task: search result | query: ';
const TEXTS = [
  '现代简约布艺沙发',
  '北欧吊灯',
  '中古风木质吸顶灯',
  '玻璃球多头吊灯',
  '花卉图案装饰画',
];

function log(...a: unknown[]) { console.error(`[onnx]`, ...a); }

// 只用本地文件：不联网、不去 HF 找
env.allowLocalModels = true;
env.allowRemoteModels = false;

const sel = JSON.parse(fs.readFileSync(SELECTION, 'utf8'));
log(`选择文件 ${SELECTION}: ${sel.length} 张`);

log(`载入 config/processor/model（dtype=fp32, seq=${SEQ}）…`);
let t0 = Date.now();

const config = await AutoConfig.from_pretrained(modelDir);
config.audio_config = null;                       // ★ 不加载音频塔
log(`  vision_config=${config.vision_config ? '有' : '无'}  audio_config=${config.audio_config ? '有' : 'null'}`);

const processor = await AutoProcessor.from_pretrained(modelDir, { config });
processor.image_seq_length = SEQ;
if (processor.image_processor) {
  processor.image_processor.max_soft_tokens = SEQ;
  processor.image_processor.image_seq_length = SEQ;
}
log(`  processor.image_seq_length=${processor.image_seq_length}  image_processor.max_soft_tokens=${processor.image_processor?.max_soft_tokens}`);

const model = await AutoModel.from_pretrained(modelDir, { config, dtype: 'fp32', device: DEVICE as ModelDevice });
const loadMs = Date.now() - t0;
log(`  载入完成，用时 ${(loadMs / 1000).toFixed(1)}s`);

/** 从模型输出里取句向量：优先 sentence_embedding，否则均值池化 + L2 归一化。 */
function pickEmbedding(out: ModelOutputView): { data: ArrayLike<number>; dims: number[]; how: string } {
  if (out.sentence_embedding) {
    return { data: out.sentence_embedding.data, dims: out.sentence_embedding.dims, how: 'sentence_embedding' };
  }
  if (out.text_embeds) {
    return { data: out.text_embeds.data, dims: out.text_embeds.dims, how: 'text_embeds' };
  }
  const lh = out.last_hidden_state;
  if (!lh) throw new Error('输出里既无 sentence_embedding 也无 last_hidden_state，实际键: ' + Object.keys(out).join(','));
  const [B, T, D] = lh.dims;
  const data = new Float32Array(B * D);
  for (let b = 0; b < B; b++) {
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < D; d++) data[b * D + d] += lh.data[(b * T + t) * D + d];
    }
    let n = 0;
    for (let d = 0; d < D; d++) n += data[b * D + d] * data[b * D + d];
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < D; d++) data[b * D + d] /= n;
  }
  return { data, dims: [B, D], how: 'mean_pool(last_hidden_state)' };
}

const norm = (arr: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s);
};

// ---------- 图像 ----------
const images = [];
t0 = Date.now();
const perImage = [];
for (const s of sel) {
  const t1 = Date.now();
  const img = await RawImage.read(s.abs_path);
  const inputs = await processor(null, [img]);
  const out = await model.forward(inputs);
  const emb = pickEmbedding(out);
  const dt = Date.now() - t1;
  perImage.push(dt / 1000);
  images.push({ rel_path: s.rel_path, vector: Array.from(emb.data) });
  if (images.length === 1) log(`  首个样本编码方式: ${emb.how}, dim=${emb.dims[emb.dims.length - 1]}`);
}
const imageMs = Date.now() - t0;
log(`  图像 ${images.length} 张，用时 ${(imageMs / 1000).toFixed(1)}s（${(imageMs / 1000 / images.length).toFixed(2)} s/张）`);

// ---------- 文本 ----------
const texts = [];
t0 = Date.now();
for (const t of TEXTS) {
  const inputs = await processor(QUERY_PREFIX + t);
  const out = await model.forward(inputs);
  const emb = pickEmbedding(out);
  texts.push({ text: t, vector: Array.from(emb.data) });
}
const textMs = Date.now() - t0;
log(`  文本 ${texts.length} 条，用时 ${textMs}ms`);

const dim = images[0].vector.length;
const result = {
  runtime: 'transformers.js+onnxruntime-node',
  device: DEVICE,
  package_version: JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'node_modules/@huggingface/transformers/package.json'), 'utf8')).version,
  model_dir: modelDir,
  seq: SEQ,
  dim,
  count: images.length,
  load_seconds: +(loadMs / 1000).toFixed(2),
  image_seconds: +(imageMs / 1000).toFixed(2),
  image_seconds_per_item: +(imageMs / 1000 / images.length).toFixed(3),
  image_seconds_list: perImage.map((x) => +x.toFixed(3)),
  text_seconds: +(textMs / 1000).toFixed(3),
  image_norms: images.slice(0, 5).map((x) => +norm(x.vector).toFixed(6)),
  text_norms: texts.slice(0, 5).map((x) => +norm(x.vector).toFixed(6)),
  query_prefix: QUERY_PREFIX,
  images,
  texts,
};
fs.writeFileSync(outPath, JSON.stringify(result), 'utf8');
log(`已写 ${outPath}`);

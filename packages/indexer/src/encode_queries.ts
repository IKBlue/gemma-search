// encode_queries.mjs —— 用 ONNX runtime 编码查询（文本 / 图像）→ 向量 JSON
//
// 用途：G-B 的 ②Top-10 重合率 需要"新索引侧"的查询向量。
// **只编码，不搜索** —— 搜索留在 Python 侧（index.bin 可被 numpy 直接读），
// 这样两侧的检索逻辑可以放在同一段代码里对齐，避免"两边各写一份排序"。
//
// 编码路径与 build_index_onnx.mjs **必须一致**（这是与 torch 侧 bit-exact 结论的前提）：
//   文本：processor(QUERY_PREFIX + text) → forward → pickEmbedding
//   图像：readImageWithFallback(path) → processor(null,[img]) → forward → pickEmbedding
// 两处 pickEmbedding 是各自实现的副本，靠**可执行的交叉核对**保证不漂（见 quality_top10.py）：
// 它会用本脚本编码一张库内图，与索引里同一张的向量比对，不一致就报错。
//
// 用法:
//   node encode_queries.mjs --model <目录> --in queries.json --out vectors.json
//        [--seq 140] [--device webgpu]
// 输入 json: [{"id":"q01","kind":"text","value":"北欧吊灯"},
//             {"id":"r-self-..","kind":"image","value":"G:\\model\\VR\\ID-x.jpg"}]
import fs from 'node:fs';
import path from 'node:path';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { readImageWithFallback, selfTestBmpLayout } from './bmp_decode.ts';
import type { ImageProcessorConfigView, ModelDevice, ModelDtype } from './third_party_types.ts';
import { installResizeCompat, selfTestResizeCompat, assertResizeCompatInstalled } from './resize_compat.ts';
// pickEmbedding 的**唯一实现**（ENC-1 / P1）：以前这里是与 build_index_onnx 各一份的副本
import { pickEmbedding } from './embedding.ts';
import type { PickedEmbedding } from './embedding.ts';

interface QueryItem { id: string; kind: string; value: string }
interface StoredVector { id: string; kind: string; value: string; dim: number; norm: number; vector: number[] }

const argv = process.argv.slice(2);
const arg = (n: string, d?: string): string => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : (d as string); };

const MODEL_DIR = arg('model') || process.env.GEMMA_ONNX_MODEL;
const IN_JSON = arg('in');
const OUT_JSON = arg('out');
const SEQ = parseInt(arg('seq', '140'), 10);
const DEVICE = arg('device', 'webgpu');
const QUERY_PREFIX = 'task: search result | query: ';

if (!MODEL_DIR || !IN_JSON || !OUT_JSON) {
  console.error('用法: node encode_queries.mjs --model <目录> --in <查询.json> --out <向量.json> [--seq 140] [--device webgpu]');
  process.exit(2);
}

const log = (...a: unknown[]) => console.log('[enc]', ...a);

env.allowLocalModels = true;
env.allowRemoteModels = false;

// （本文件不再自带 pickEmbedding：见上面的 import 与 packages/indexer/src/embedding.ts。
//   ENC-1 之前这里是与 build_index_onnx 各一份的副本，靠"人工保持同步 + 交叉核对"维持；
//   副本里的 `Math.sqrt(n) || 1` 在 T===0 时会**静默产出全零向量**。）

const norm = (a: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s); };

const queries: QueryItem[] = JSON.parse(fs.readFileSync(IN_JSON, 'utf8'));
log(`查询 ${queries.length} 条（文本 ${queries.filter((q) => q.kind === 'text').length}`
  + ` · 图像 ${queries.filter((q) => q.kind === 'image').length}）`);

const config = await AutoConfig.from_pretrained(MODEL_DIR);
config.audio_config = null;
const processor = await AutoProcessor.from_pretrained(MODEL_DIR, { config });
// 三处 + config 副本都要设（实测默认均为 280）
processor.image_seq_length = SEQ;
if (processor.image_processor) {
  processor.image_processor.max_soft_tokens = SEQ;
  processor.image_processor.image_seq_length = SEQ;
  if (processor.image_processor.config) (processor.image_processor.config as ImageProcessorConfigView).image_seq_length = SEQ;
}
if (processor.image_seq_length !== SEQ) {
  throw new Error(`预处理 seq 未生效：请求 ${SEQ}，实际 ${processor.image_seq_length}`);
}
const model = await AutoModel.from_pretrained(MODEL_DIR, { config, dtype: 'float32' as ModelDtype, device: DEVICE as ModelDevice });
log(`模型载入完成（seq=${SEQ} · device=${DEVICE}）`);

const st = await selfTestBmpLayout();
log(`BMP 布局自检通过（${st.checked} 像素）`);

// 重采样兼容层：**查询路径必须与索引路径用同一套**（否则结果静默变差）
installResizeCompat({ kernel: 'pil-like', RawImage, logger: log });
assertResizeCompatInstalled(RawImage);
const rst = await selfTestResizeCompat();
log(`重采样兼容层自检通过（kernel=${rst.kernel}）`);

const out: StoredVector[] = [];
let how: string | null = null;
for (const q of queries) {
  let emb: PickedEmbedding;
  if (q.kind === 'text') {
    const inputs = await processor(QUERY_PREFIX + q.value);
    emb = pickEmbedding(await model.forward(inputs));
  } else if (q.kind === 'image') {
    const { image } = await readImageWithFallback(q.value);
    const inputs = await processor(null, [image]);
    emb = pickEmbedding(await model.forward(inputs));
  } else {
    throw new Error(`未知 kind: ${q.kind}（${q.id}）`);
  }
  how = how || emb.how;
  const vec = Array.from(emb.data);
  out.push({ id: q.id, kind: q.kind, value: q.value, dim: vec.length, norm: +norm(vec).toFixed(6), vector: vec });
}

const revision = (MODEL_DIR.replace(/\\/g, '/').split('/').find((s: string) => /^[0-9a-f]{40}$/.test(s))) || null;
fs.writeFileSync(OUT_JSON, JSON.stringify({
  generated_at: new Date().toISOString(),
  runtime: { 'transformers.js': 'as-installed', device: DEVICE },
  model_dir: MODEL_DIR,
  model_revision: revision,
  seq_length: SEQ,
  dim: out.length ? out[0].dim : 0,
  query_prefix: QUERY_PREFIX,
  embedding_how: how,
  count: out.length,
  queries: out,
}), 'utf8');
log(`已写 ${OUT_JSON}（dim=${out.length ? out[0].dim : 0} · embedding=${how}）`);

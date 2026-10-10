// diagnose_resize_kernel.mjs —— G-B 诊断 A3b：**换重采样核对等价性的影响**
//
// 背景（A3 已实测）：
//   · 解码不是原因 —— 把 PIL 解码出的**同一份像素**交给 JS 处理器，差异一模一样
//   · 差异全部来自 `RawImage.resize`：transformers.js 对 resample=3 走
//     `sharp(img).affine([sx,0,0,sy], { interpolator: 'bicubic' })`（libvips 仿射插值，**无抗锯齿**），
//     而 Python 侧是 `PIL.Image.resize(..., BICUBIC)`（同样不抗锯齿，但插值核与坐标映射不同）
//   · 两者都会混叠，混叠图案不同 → 差异集中在高细节 patch、随缩放倍率上升（A2：尾部全是 1600×1200 级大图）
//
// 本脚本回答：**换一个核能不能显著更接近 torch（旧索引）**？
// 做法：monkey-patch `RawImage.prototype.resize`，把核换成 sharp.resize 的几种 kernel，
//       其余（解码/归一化/patchify/模型）完全不动；再与**旧索引的向量**逐条比余弦。
//
// 说明：输入是**已解码的裸像素**（toSharp 从 raw 来），所以 sharp 不会走 JPEG shrink-on-load，
//       测的纯粹是"重采样核"这一点，不是解码路径。
//
// 用法:
//   node diagnose_resize_kernel.mjs --model <目录> --in <列表.json> --out <结果.json>
//        [--seq 140] [--device webgpu] [--kernels baseline,cubic,mitchell,lanczos3]
// 输入 json: [{"rel_path":"VR\\x.jpg","abs_path":"G:\\model\\VR\\x.jpg"}, ...]

import fs from 'node:fs';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { readImageWithFallback } from './bmp_decode.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const MODEL_DIR = arg('model') || process.env.GEMMA_ONNX_MODEL;
const IN_JSON = arg('in');
const OUT_JSON = arg('out');
const SEQ = parseInt(arg('seq', '140'), 10);
const DEVICE = arg('device', 'webgpu');
const KERNELS = (arg('kernels', 'baseline,cubic,mitchell,lanczos3')).split(',').map((s) => s.trim()).filter(Boolean);

if (!MODEL_DIR || !IN_JSON || !OUT_JSON) {
  console.error('用法: node diagnose_resize_kernel.mjs --model <目录> --in <列表.json> --out <结果.json>');
  process.exit(2);
}

env.allowLocalModels = true;
env.allowRemoteModels = false;

let KERNEL = 'baseline';
const origResize = RawImage.prototype.resize;
const sharpMod = (await import('sharp')).default;
const calls = [];

/**
 * 变体：把 resize 换成 sharp.resize(kernel) 的 fit:'fill'。
 * baseline = 原样调用（即 transformers.js 的 affine-bicubic 路径）。
 * 尺寸按上游算法先补齐（只处理"其中一维为 null"的情形，其余原样透传）。
 */
RawImage.prototype.resize = async function resize(width, height, opts = {}) {
  if (this.width === width && this.height === height) return this;
  if (width === null || width === undefined) {
    width = Math.round(height / this.height * this.width);
  } else if (height === null || height === undefined) {
    height = Math.round(width / this.width * this.height);
  }
  calls.push({ kernel: KERNEL, from: [this.width, this.height], to: [width, height] });
  if (KERNEL === 'baseline') return origResize.call(this, width, height, opts);
  const buf = await this.toSharp()
    .resize({ width: Math.round(width), height: Math.round(height), fit: 'fill', kernel: KERNEL })
    .png().toBuffer();
  return await RawImage.fromBlob(new Blob([buf]));
};

const log = (...a) => console.log('[kernel]', ...a);

const list = JSON.parse(fs.readFileSync(IN_JSON, 'utf8'));
log(`${list.length} 张 · 核 ${KERNELS.join(' / ')} · device=${DEVICE} seq=${SEQ}`);

const config = await AutoConfig.from_pretrained(MODEL_DIR);
config.audio_config = null;
const processor = await AutoProcessor.from_pretrained(MODEL_DIR, { config });
processor.image_seq_length = SEQ;
if (processor.image_processor) {
  processor.image_processor.max_soft_tokens = SEQ;
  processor.image_processor.image_seq_length = SEQ;
  if (processor.image_processor.config) processor.image_processor.config.image_seq_length = SEQ;
}
const model = await AutoModel.from_pretrained(MODEL_DIR, { config, dtype: 'float32', device: DEVICE });
log('模型载入完成');

const pick = (out) => out.sentence_embedding ?? out.text_embeds;

const result = { model_dir: MODEL_DIR, seq: SEQ, device: DEVICE, kernels: KERNELS, vectors: {} };
for (const k of KERNELS) {
  KERNEL = k;
  const t0 = Date.now();
  const vectors = {};
  const failed = [];
  for (const it of list) {
    try {
      const { image } = await readImageWithFallback(it.abs_path);
      if (!image) throw new Error('解码失败');
      const inputs = await processor(null, [image]);
      const out = await model.forward(inputs);
      const emb = pick(out);
      if (!emb) throw new Error('输出无 sentence_embedding');
      vectors[it.rel_path] = Array.from(emb.data);
    } catch (e) {
      failed.push({ rel_path: it.rel_path, error: e.message });
    }
  }
  result.vectors[k] = vectors;
  const secs = (Date.now() - t0) / 1000;
  log(`  ${k}: ${Object.keys(vectors).length} 条 · 失败 ${failed.length} · ${secs.toFixed(1)}s`
    + `（${(secs / Math.max(1, list.length)).toFixed(2)} s/张）`);
  if (failed.length) log(`    失败示例: ${JSON.stringify(failed.slice(0, 2))}`);
  result.failed = result.failed || {};
  result.failed[k] = failed;
}
result.resize_calls_sample = calls.slice(0, 6);
fs.writeFileSync(OUT_JSON, JSON.stringify(result), 'utf8');
log(`已写 ${OUT_JSON}`);

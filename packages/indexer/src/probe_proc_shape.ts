// probe_proc_shape.mjs —— JS 处理器对同一张图的输出形状（与 Python 侧对照）
import fs from 'node:fs';
import path from 'node:path';
import type { ImageProcessorConfigView, TensorView } from './third_party_types.ts';
import { AutoConfig, AutoProcessor, RawImage, env } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;

const argv = process.argv.slice(2);
const arg = (n: string, d?: string): string => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : (d as string);
};
const MODEL_DIR = arg('model') || process.env.GEMMA_ONNX_MODEL;
const IMG = arg('img');
const SEQ = parseInt(arg('seq', '140'), 10);

const cfg = await AutoConfig.from_pretrained(MODEL_DIR!);
cfg.audio_config = null;
const proc = await AutoProcessor.from_pretrained(MODEL_DIR!, { config: cfg });
proc.image_seq_length = SEQ;
if (proc.image_processor) {
  proc.image_processor.max_soft_tokens = SEQ;
  proc.image_processor.image_seq_length = SEQ;
  if (proc.image_processor.config)
    (proc.image_processor.config as ImageProcessorConfigView).image_seq_length = SEQ;
}
const ip = proc.image_processor;
console.log('=== JS processor 配置 ===');
for (const k of [
  'patch_size',
  'max_soft_tokens',
  'image_seq_length',
  'pooling_kernel_size',
  'resample',
  'rescale_factor',
  'do_normalize',
  'do_resize',
  'size',
]) {
  const v =
    ip && k in ip
      ? ip[k]
      : ip && ip.config && k in ip.config
        ? (ip.config as ImageProcessorConfigView)[k]
        : undefined;
  if (v !== undefined) console.log(`  ip.${k} = ${JSON.stringify(v)}`);
}

const img = await RawImage.read(IMG);
console.log();
console.log('=== RawImage.read ===');
console.log(`  width=${img.width} height=${img.height} channels=${img.channels}`);

const inputs: Record<string, TensorView | undefined> = await proc(null, [img]);
console.log();
console.log('=== JS 处理器输出 ===');
for (const [k, v] of Object.entries(inputs)) {
  const dims =
    v && v.dims ? JSON.stringify(v.dims) : v && v.length !== undefined ? `len=${v.length}` : '?';
  console.log(
    `  ${k.padEnd(22)} ${dims}  type=${v && v.type ? v.type : v && v.constructor ? v.constructor.name : '?'}`,
  );
}

// 像素均值（与 Python 侧对照：那里是 37.30）
const pv = inputs.pixel_values;
if (pv && pv.data) {
  let s = 0;
  const n = pv.data.length;
  for (let i = 0; i < n; i++) s += pv.data[i];
  console.log();
  console.log(`  pixel_values 元素数 ${n} · 均值 ${(s / n).toFixed(4)}（Python 侧均值见对照）`);
}

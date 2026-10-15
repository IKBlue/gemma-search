// spike_device.mjs —— 比较 ONNX 在不同 device 上的编码速度（cpu vs dml/DirectML）
//
// 用法: node spike_device.mjs <模型目录> <device> <seq> [张数]
//   device: cpu | dml | cuda | auto
//
// 关键：DML 首次运行有 shader 编译开销，所以分开报"首张"与"稳态"耗时。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelDevice } from './third_party_types.ts';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';

interface DeviceSpikeResult {
  device: string;
  seq: number;
  n: number;
  load_ms?: number;
  text_first_ms?: number;
  text_dim?: number | null;
  dim?: number | null;
  per_image_ms?: number[];
  first_image_ms?: number;
  steady_avg_ms?: number | null;
  avg_ms?: number;
  ok?: boolean;
  error?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const [modelDir, device = 'cpu', seqArg = '140', nArg = '8'] = process.argv.slice(2);
if (!modelDir) {
  console.error('用法: node spike_device.mjs <模型目录> <device> <seq> [张数]');
  process.exit(2);
}
const SEQ = parseInt(seqArg, 10);
const N = parseInt(nArg, 10);

env.allowLocalModels = true;
env.allowRemoteModels = false;

const selPath = path.join(here, '..', 'spike_selection.json');
const sel = JSON.parse(fs.readFileSync(selPath, 'utf8')).slice(0, N);

const log = (...a: unknown[]) => console.error('[device]', ...a);
const t = () => Number(process.hrtime.bigint()) / 1e6; // ms

const result: DeviceSpikeResult = { device, seq: SEQ, n: sel.length };

try {
  let t0 = t();
  const config = await AutoConfig.from_pretrained(modelDir);
  config.audio_config = null;
  const processor = await AutoProcessor.from_pretrained(modelDir, { config });
  processor.image_seq_length = SEQ;
  if (processor.image_processor) {
    processor.image_processor.max_soft_tokens = SEQ;
    processor.image_processor.image_seq_length = SEQ;
  }
  const model = await AutoModel.from_pretrained(modelDir, {
    config,
    dtype: 'fp32',
    device: device as ModelDevice,
  });
  result.load_ms = Math.round(t() - t0);
  log(`device=${device} 载入 ${result.load_ms} ms`);

  // 文本（快，先热身）
  t0 = t();
  const tInputs = await processor('task: search result | query: 玻璃球多头吊灯');
  const tOut = await model.forward(tInputs);
  result.text_first_ms = Math.round(t() - t0);
  result.text_dim = tOut.sentence_embedding?.dims?.at(-1) ?? null;

  // 图像：逐张，分开记首张与稳态
  const per: number[] = [];
  for (const s of sel) {
    const t1 = t();
    const img = await RawImage.read(s.abs_path);
    const inputs = await processor(null, [img]);
    const out = await model.forward(inputs);
    const emb = out.sentence_embedding ?? out.text_embeds;
    const ms = t() - t1;
    per.push(Math.round(ms));
    if (!result.dim) result.dim = emb?.dims?.at(-1) ?? null;
  }
  result.per_image_ms = per;
  result.first_image_ms = per[0];
  const rest = per.slice(1);
  result.steady_avg_ms = rest.length
    ? Math.round(rest.reduce((a, b) => a + b, 0) / rest.length)
    : null;
  result.avg_ms = Math.round(per.reduce((a, b) => a + b, 0) / per.length);

  log(
    `首张 ${result.first_image_ms} ms | 稳态均值 ${result.steady_avg_ms} ms | 总均值 ${result.avg_ms} ms`,
  );
  log(`逐张: ${per.join(', ')}`);
  result.ok = true;
} catch (e) {
  result.ok = false;
  result.error = (e instanceof Error ? e.message : String(e)) || 'unknown';
  log(`失败: ${result.error}`);
}

console.log(JSON.stringify(result));

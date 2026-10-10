// src/main/encoder.mjs —— 编码器端口：把 ONNX 推理包成引擎要的 { encodeText, encodeImage }
//
// （2026-10-10 自 `app/main/encoder.mjs` 原样迁移；相对路径深度未变，故内容逐字一致。）
//
// 为什么要单独一层：`core/` 必须传输无关且零依赖（CONTRACT §0），
// 所以它只声明"我要一个能编码的端口"，由主进程注入实现。
// 于是：引擎可无模型测试；而"编码放主进程 / worker / utilityProcess"
// 只是换一个注入实现，不用改引擎。
import fs from 'node:fs';
import path from 'node:path';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { installResizeCompat, selfTestResizeCompat, assertResizeCompatInstalled } from '../../onnx-spike/resize_compat.mjs';

export const QUERY_PREFIX = 'task: search result | query: ';
export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

/** 与 onnx-spike/build_index_onnx.mjs 的 pickEmbedding 必须一致（有交叉核对测试守着） */
function pickEmbedding(out) {
  if (out.sentence_embedding) return out.sentence_embedding;
  if (out.text_embeds) return out.text_embeds;
  const lh = out.last_hidden_state;
  if (!lh) throw new Error('输出里既无 sentence_embedding 也无 last_hidden_state：' + Object.keys(out).join(','));
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
  return { data, dims: [B, D] };
}

/**
 * BMP 解码：`@huggingface/transformers` 的 RawImage 读不了 BMP，
 * 而库里实测有 20 张 `.jpg` 其实是 BMP（见 data/quality/mismatch-test-result.json）。
 * 这里复用 spike 里已验证过的纯 JS 实现与像素布局。
 */
async function readImageAny(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const buf = fs.readFileSync(absPath);
  const isBmp = buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d;   // "BM"
  if (ext === '.bmp' || isBmp) {
    const { readBmpAsRawImage } = await import('../../onnx-spike/bmp_decode.mjs');
    return { image: await readBmpAsRawImage(buf), source: 'bmp-fallback' };
  }
  return { image: await RawImage.read(absPath), source: 'native' };
}

/**
 * @param {{modelDir:string, seq?:number, device?:'webgpu'|'cpu', log?:Function}} opts
 */
export async function createEncoder({ modelDir, seq = 140, device = 'webgpu', log = () => {} } = {}) {
  if (!modelDir || !fs.existsSync(modelDir)) {
    const e = new Error(`模型目录不存在：${modelDir || '(未配置)'}`);
    e.code = 'MODEL_MISSING';
    throw e;
  }
  env.allowLocalModels = true;
  env.allowRemoteModels = false;

  // 重采样兼容层：**必须与索引构建器同一套实现**（`preprocessing_version = 2`）。
  // 不装的话图像查询与索引就不在同一预处理下 —— 这是本项目最危险的失败模式：
  // 不报错、不崩溃，只是结果变差（实测像素差 1.93%，全量 min 余弦 0.9153）。
  installResizeCompat({ kernel: 'pil-like', RawImage, logger: log });
  assertResizeCompatInstalled(RawImage);        // ← 两份 transformers.js 的护栏（见 resize_compat.mjs）
  const rst = await selfTestResizeCompat();
  log(`重采样兼容层已安装并自检通过（kernel=${rst.kernel}）`);

  log(`载入模型 dtype=fp32 seq=${seq} device=${device}`);
  const t0 = Date.now();
  const config = await AutoConfig.from_pretrained(modelDir);
  config.audio_config = null;                                  // 音频塔用不到
  const processor = await AutoProcessor.from_pretrained(modelDir, { config });

  // 三处 + config 副本都要设 —— 实测默认都是 280，而索引是 140。
  // 只设其中一两处，将来上游改读另一处就会让 effective seq 悄悄变成 280。
  processor.image_seq_length = seq;
  if (processor.image_processor) {
    processor.image_processor.max_soft_tokens = seq;
    processor.image_processor.image_seq_length = seq;
    if (processor.image_processor.config) processor.image_processor.config.image_seq_length = seq;
  }
  if (processor.image_seq_length !== seq) {
    throw new Error(`预处理 seq 未生效：请求 ${seq}，实际 ${processor.image_seq_length}`);
  }

  let model;
  try {
    model = await AutoModel.from_pretrained(modelDir, { config, dtype: 'float32', device });
  } catch (err) {
    if (device === 'webgpu') {
      log(`webgpu 不可用（${err.message}），回退 cpu`);
      device = 'cpu';
      model = await AutoModel.from_pretrained(modelDir, { config, dtype: 'float32', device });
    } else {
      throw err;
    }
  }
  const loadMs = Date.now() - t0;
  log(`载入完成 ${(loadMs / 1000).toFixed(1)}s · device=${device}`);

  return {
    modelDir, seq, device, loadMs,
    async encodeText(text) {
      const inputs = await processor(QUERY_PREFIX + text);
      const emb = pickEmbedding(await model.forward(inputs));
      return Float32Array.from(emb.data);
    },
    async encodeImage(absPath) {
      const { image, source } = await readImageAny(absPath);
      const inputs = await processor(null, [image]);
      const emb = pickEmbedding(await model.forward(inputs));
      const v = Float32Array.from(emb.data);
      v.__source = source;
      return v;
    },
  };
}

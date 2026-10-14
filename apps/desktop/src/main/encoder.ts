// apps/desktop/src/main/encoder.ts —— 编码器端口：把 ONNX 推理包成引擎要的 { encodeText, encodeImage }
//
// （2026-10-10 自 `app/main/encoder.mjs` 原样迁移；相对路径深度未变，故内容逐字一致。）
//
// 为什么要单独一层：`packages/engine` 必须传输无关且零依赖（CONTRACT §0），
// 所以它只声明"我要一个能编码的端口"，由主进程注入实现。
// 于是：引擎可无模型测试；而"编码放主进程 / worker / utilityProcess"
// 只是换一个注入实现，不用改引擎。
//
// 2026-10-14：本文件由 `encoder.mjs` 转为 `.ts`（全量 TypeScript）。
// **编码路径逐字未改**（重采样兼容层的安装与自检、seq 三处 + config 副本的设置、
// webgpu→cpu 回退、BMP 魔数回退都原样保留），只补类型。改这里必须重跑 T-00 基线。
import fs from 'node:fs';
import path from 'node:path';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import type { PretrainedModelOptions } from '@huggingface/transformers';
import { installResizeCompat, selfTestResizeCompat, assertResizeCompatInstalled } from '../../../../packages/indexer/src/resize_compat.ts';
import { decideDevice, UNPROBED } from './encoder-device.ts';
import type { DeviceFallbackFact, GpuProbe, RequestedDevice } from './encoder-device.ts';

export const QUERY_PREFIX = 'task: search result | query: ';
export const IMG_EXT: ReadonlySet<string> = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

/** 张量状输出（transformers 的 Tensor 是 JS 类，这里只声明本文件用到的两个字段） */
interface TensorLike {
  data: ArrayLike<number>;
  dims: number[];
}

/** 图像向量：与索引器一样，额外挂一个 `__source`（bmp-fallback / native）供诊断 */
export interface ImageVector extends Float32Array {
  __source?: string;
}

/** `createEncoder` 的入参 */
export interface CreateEncoderOptions {
  modelDir: string;
  seq?: number;
  /** **请求值**（不保证等于实际使用的 EP —— 见 encoder-device.ts） */
  device?: RequestedDevice;
  /**
   * GPU 可用性探测结果（T-31 / S2b）。**调用方注入**：本文件不许 import electron，
   * 而权威探测在渲染进程（那里有真 navigator.gpu），所以由 index.ts 探好传进来。
   * 不传 = UNPROBED（拿不到结论）⇒ 决策不产生任何行为变化（T-00 护栏就是这条路径）。
   */
  gpuProbe?: GpuProbe;
  log?: (...a: unknown[]) => void;
}

/** 回退事实（唯一定义在 encoder-device.ts，这里只做转出，避免第二份定义 · P1） */
export type { DeviceFallbackFact as DeviceFallback } from './encoder-device.ts';

/** 引擎要的编码器端口（与 `packages/engine/src/engine.ts` 的 `EncoderPort` 结构性一致） */
export interface Encoder {
  modelDir: string;
  seq: number;
  /** **实际拿去初始化**的设备（探测说 GPU 不可用 ⇒ 这里就是 cpu） */
  device: RequestedDevice;
  /** 调用方**请求**的设备（与 device 不同就说明发生过回退） */
  deviceRequested: RequestedDevice;
  /** 回退事实；没回退就是 null */
  deviceFallback: DeviceFallbackFact | null;
  /**
   * **已验证**的执行提供者名；拿不到就是 null。
   * ⚠️ 它不是 device 的复述：device=webgpu + 探测没结论时，这里必须是 null（不许猜）。
   */
  effectiveProvider: string | null;
  /** 这次用的探测结果（界面/日志据此说明"凭什么"） */
  gpuProbe: GpuProbe;
  loadMs: number;
  encodeText(text: string): Promise<Float32Array>;
  encodeImage(absPath: string): Promise<Float32Array>;
}

/** catch 到的 unknown → message（与旧 `e.message` 同口径） */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 与 packages/indexer/src/build_index_onnx.ts 的 pickEmbedding 必须一致（有交叉核对测试守着） */
function pickEmbedding(out: unknown): TensorLike {
  const o: Record<string, unknown> = isRecord(out) ? out : {};
  const se = o.sentence_embedding as TensorLike | undefined;
  if (se) return se;
  const te = o.text_embeds as TensorLike | undefined;
  if (te) return te;
  const lh = o.last_hidden_state as TensorLike | undefined;
  if (!lh) throw new Error('输出里既无 sentence_embedding 也无 last_hidden_state：' + Object.keys(o).join(','));
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

/** `readImageAny` 的返回：图（RawImage 形状）与它的来源标签 */
interface ReadImageResult {
  image: unknown;
  source: string;
}

/**
 * BMP 解码：`@huggingface/transformers` 的 RawImage 读不了 BMP，
 * 而库里实测有 20 张 `.jpg` 其实是 BMP（见 data/quality/mismatch-test-result.json）。
 * 这里复用 packages/indexer/src/bmp_decode.ts 里已验证过的纯 JS 实现与像素布局。
 */
async function readImageAny(absPath: string): Promise<ReadImageResult> {
  const ext = path.extname(absPath).toLowerCase();
  // 这一次读盘**只为嗅探魔数**（判断"名为 .jpg、实为 BMP"）；下面走 BMP 回退时会再读一次。
  // 两次读盘是**有意的取舍**：BMP 回退是罕见路径（全库 20/3594），换来嗅探与解码互不耦合 ——
  // 不是漏改。
  const buf = fs.readFileSync(absPath);
  const isBmp = buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d;   // "BM"
  if (ext === '.bmp' || isBmp) {
    const { readBmpAsRawImage } = await import('../../../../packages/indexer/src/bmp_decode.ts');
    // ⚠️ 这个 API 要的是**路径**，不是 Buffer：`readBmpAsRawImage(filePath)` 内部自己做
    // `fs.readFileSync(filePath)`（packages/indexer/src/bmp_decode.ts:137 → :56）。
    // 曾经这里传的是上面那个 `buf` → `fs.readFileSync(Buffer)` → `ERR_INVALID_ARG_VALUE`，
    // 于是 20 张"名为 .jpg 实为 BMP"的图在**以图搜图**路径上全部抛错（实测；回归断言见
    // tools/verify_encoder_path.mjs 的「2b) BMP 回退断言」）。别再改回 Buffer。
    // 注：indexer 的 `readImageWithFallback` 一直传的是路径，所以索引构建侧没受影响 ——
    //     只有应用查询侧这条独立路径有这个 bug。
    return { image: await readBmpAsRawImage(absPath), source: 'bmp-fallback' };
  }
  return { image: await RawImage.read(absPath), source: 'native' };
}

export async function createEncoder({
  modelDir, seq = 140, device = 'webgpu', gpuProbe = UNPROBED, log = () => {},
}: CreateEncoderOptions): Promise<Encoder> {
  if (!modelDir || !fs.existsSync(modelDir)) {
    const e: Error & { code?: string } = new Error(`模型目录不存在：${modelDir || '(未配置)'}`);
    e.code = 'MODEL_MISSING';
    throw e;
  }
  env.allowLocalModels = true;
  env.allowRemoteModels = false;

  // 重采样兼容层：**必须与索引构建器同一套实现**（`preprocessing_version = 2`）。
  // 不装的话图像查询与索引就不在同一预处理下 —— 这是本项目最危险的失败模式：
  // 不报错、不崩溃，只是结果变差（实测像素差 1.93%，全量 min 余弦 0.9153）。
  // ⚠️ `logger` 的断言：indexer 侧的 `installResizeCompat` 目前只从默认值 `null` 推出 `logger?: null`，
  //    而运行时它就是"日志函数或 null"（本文件一直传 log）。这里按**运行时契约**断言，等 W1-B2 补完类型后即可删。
  installResizeCompat({ kernel: 'pil-like', RawImage, logger: log });   // W1-B2 补完类型后，原先那句 as unknown as 已可删
  assertResizeCompatInstalled(RawImage);        // ← 两份 transformers.js 的护栏（见 resize_compat.ts）
  const rst = await selfTestResizeCompat();
  log(`重采样兼容层已安装并自检通过（kernel=${rst.kernel}）`);

  // T-31：设备语义**只由 encoder-device.ts 的纯函数决定**（见该文件头的依据）。
  // 探测明确说 GPU 不可用 ⇒ 决策直接给 cpu：不去"先试 webgpu 再失败"，也就不会把 cpu 说成 webgpu。
  const decision = decideDevice(device, gpuProbe);
  const requestedDevice: RequestedDevice = decision.requested;
  device = decision.device;
  let effectiveProvider: string | null = decision.effectiveProvider;
  let deviceFallback: DeviceFallbackFact | null = decision.fallback;
  // ⚠️ 日志不再写 "device=webgpu" 这种**两义**写法（它会被读成"实际"）：请求与已验证分开写。
  log('设备决策：请求=' + requestedDevice + ' · 实际=' + device
      + ' · 已验证 EP=' + (effectiveProvider ?? '未验证') + ' · ' + decision.note);
  const t0 = Date.now();
  const config = await AutoConfig.from_pretrained(modelDir);
  // transformers 的 .d.ts 没声明 `audio_config`，但运行时它就在 config 上（本应用用不到音频塔）。
  (config as { audio_config?: unknown }).audio_config = null;   // 音频塔用不到
  const processor = await AutoProcessor.from_pretrained(modelDir, { config });

  // 三处 + config 副本都要设 —— 实测默认都是 280，而索引是 140。
  // 只设其中一两处，将来上游改读另一处就会让 effective seq 悄悄变成 280。
  // （这两个字段同样没进 .d.ts：JSDoc 只把 `image_processor` 标成 getter。）
  const seqProc = processor as unknown as {
    image_seq_length?: number;
    image_processor?: {
      max_soft_tokens?: number;
      image_seq_length?: number;
      config?: { image_seq_length?: number };
    };
  };
  seqProc.image_seq_length = seq;
  if (seqProc.image_processor) {
    seqProc.image_processor.max_soft_tokens = seq;
    seqProc.image_processor.image_seq_length = seq;
    if (seqProc.image_processor.config) seqProc.image_processor.config.image_seq_length = seq;
  }
  if (seqProc.image_seq_length !== seq) {
    throw new Error(`预处理 seq 未生效：请求 ${seq}，实际 ${seqProc.image_seq_length}`);
  }

  // ⚠️ `dtype: 'float32'` 是**原样保留**的既有取值（T-00 基线即在该取值下产出）：
  //    transformers 的 .d.ts 只列 'fp32'，两者在运行时是同一档。**不许**顺手改成 'fp32' —— 那是改行为。
  // ⚠️ 每次调用都**重新取值** `device`（回退后第二次要用 'cpu'），所以写成函数而不是复用对象。
  const modelOptions = (): PretrainedModelOptions =>
    ({ config, dtype: 'float32', device }) as unknown as PretrainedModelOptions;
  const deviceRequested: RequestedDevice = requestedDevice;
  let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
  try {
    model = await AutoModel.from_pretrained(modelDir, modelOptions());
  } catch (err) {
    if (device === 'webgpu') {
      log(`webgpu 不可用（${errMessage(err)}），回退 cpu`);
      // T-17：把这次回退**记成事实**交出去（界面据此显示"已回退"，而不是让用户自己猜为什么是 cpu）
      deviceFallback = { from: 'webgpu', to: 'cpu', reason: errMessage(err) };
      device = 'cpu';
      // 改成请求 cpu 了 ⇒ 已验证 EP 更新为 cpu（依据同 encoder-device.ts 的 cpu 分支）
      effectiveProvider = 'cpu';
      model = await AutoModel.from_pretrained(modelDir, modelOptions());
    } else {
      throw err;
    }
  }
  const loadMs = Date.now() - t0;
  log(`载入完成 ${(loadMs / 1000).toFixed(1)}s · 请求=${deviceRequested} · 实际=${device} · 已验证 EP=${effectiveProvider ?? '未验证'}`);

  return {
    modelDir, seq, device, deviceRequested, deviceFallback, effectiveProvider, gpuProbe, loadMs,
    async encodeText(text: string): Promise<Float32Array> {
      const inputs = await processor(QUERY_PREFIX + text);
      const emb = pickEmbedding(await model.forward(inputs));
      return Float32Array.from(emb.data);
    },
    async encodeImage(absPath: string): Promise<Float32Array> {
      const { image, source } = await readImageAny(absPath);
      const inputs = await processor(null, [image]);
      const emb = pickEmbedding(await model.forward(inputs));
      const v = Float32Array.from(emb.data) as ImageVector;
      v.__source = source;
      return v;
    },
  };
}

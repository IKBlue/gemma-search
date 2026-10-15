// resize_compat.mjs —— 把 Node 侧的重采样钉成与 Python/PIL 参考实现一致的那一套
//
// ── 为什么需要（A1–A3b 实测，2026-10-10）────────────────────────────────────
// `resample: 3`（bicubic）在两侧**不是同一个算法**：
//   Python（旧索引/torch）      : PIL.Image.resize(..., BICUBIC)
//   transformers.js 4.3.1 (Node): sharp(img).affine([sx,0,0,sy], { interpolator: 'bicubic' })
//
// 输入像素完全相同、目标尺寸相同的前提下：
//   affine(bicubic) vs PIL : 平均绝对差 4.93/255（1.93%）、最大 183、余弦 0.960757
//   resize(cubic)   vs PIL : 平均绝对差 0.14/255（0.05%）、最大   9、余弦 **0.999997**
//
// 后果：全量 3594 条里 135 条余弦 < 0.970（硬底线），最小 0.9153 → G-B v1 判 FAIL。
// 尾部全是大尺寸图（2.02MP 中位 vs 对照 0.30MP）：两套实现都**不抗锯齿**，
// 降采样倍率越大混叠图案差得越远；小图几乎不缩放所以逐位一致。
//
// 修法：把 `RawImage.prototype.resize` 换成 `sharp.resize({ kernel:'cubic', fit:'fill' })`。
// 它保留上游的**尺寸算法**（含 nullish 维度的处理与"同尺寸直接返回"），只换插值实现 ——
// 这是必须的：尺寸算法决定了 patch 网格，改它就不是"换核"而是"改预处理"了。
//
// 进 `preprocessing.resample_impl`，并体现为 `preprocessing_version = 2`（compat 随之变化）。
//
// ⚠️ **索引路径与查询路径必须都装这份 shim**：两侧预处理不一致是本项目最危险的失败模式
//    （不报错，只是结果变差）。装点：build_index_onnx.mjs / encode_queries.mjs / src/main/encoder.mjs。
//
// ⚠️ 依赖上游内部 API（`RawImage.prototype.resize` / `toSharp` / 构造函数）。
//    所以有 `selfTestResizeCompat()` 做**可执行断言**（含"同尺寸必须no-op"与"输出通道数不变"），
//    另有跨语言金标测试 `verify_resize.py`（含**否定对照**：上游 affine 必须被判为更差）。

import { RawImage } from '@huggingface/transformers';
import type { ResizeOptions } from 'sharp';

const MARK = Symbol.for('gemma-search.resizeCompat');

type RawImageResize = typeof RawImage.prototype.resize;

/** shim 之后的 resize：维度允许 null/undefined（上游 .d.ts 写的是 number，但实现刻意支持） */
type NullableDimResize = (
  width: number | null | undefined,
  height: number | null | undefined,
  opts?: { resample?: string | 0 | 1 | 2 | 3 | 4 | 5 },
) => Promise<RawImage>;

interface ResizeCall {
  impl: string;
  from: [number, number];
  to: [number, number];
  channels?: [number, number];
}

/** 安装后的模块级状态；未安装时 STATE 为 null（resizeCompatState() 如实返回）。 */
interface ResizeCompatState {
  [key: symbol]: unknown; // MARK 标记位（Symbol.for 键）
  kernel: string;
  RawImage: typeof RawImage;
  calls: ResizeCall[];
  orig: RawImageResize;
  patched: RawImageResize;
  installed: boolean;
  installed_di_name: string;
  installed_at: string;
}

let STATE: ResizeCompatState | null = null;

async function loadSharp() {
  const m = await import('sharp');
  return m.default ?? m;
}

/**
 * 安装重采样兼容层（幂等）。
 * @param {{kernel?: string, RawImage?: any, logger?: Function}} [opts]
 *        kernel: 'cubic'（总是 sharp.resize cubic）· 'pil-like'（按 PIL 规则分方向，**推荐**）
 *                · 'upstream-affine'（诊断/否定对照，不是正常档位）
 *        **RawImage：必须由调用方传入自己那份 @huggingface/transformers 的 RawImage**
 *                —— 本模块**刻意不自己去 import**它。理由是这里踩过一次真实的坑：
 *                当时仓库里存在**两份** transformers.js（根 `node_modules` 与
 *                现在已经删掉的 `onnx-spike/node_modules`），同版本但**不同的类对象**
 *                （实测 `根.RawImage === 那份.RawImage` → **false**）。
 *                本模块若自己去 import，就会补 A 的 prototype，而调用方用的是 B 的类 ——
 *                后果不是报错，是 **shim 静默不生效**（向量又差 1.9%，查了很久）。
 *                **那份重复依赖树已在 monorepo 重构中删除，但"由调用方注入"这个约定保留** ——
 *                它让类身份永远只有一个来源，不依赖"仓库里恰好只有一份"这种易碎前提。
 * @returns {object} state（含 calls 计数，便于诊断）
 */
export function installResizeCompat({
  kernel = 'pil-like',
  RawImage: RawImageClass = RawImage,
  logger = null,
}: {
  kernel?: string;
  RawImage?: typeof RawImage;
  logger?: ((message: string) => void) | null;
} = {}): ResizeCompatState {
  if (STATE) return STATE;

  const sharpPromise = loadSharp();
  const orig = RawImageClass.prototype.resize;

  const patched = async function resize(
    this: RawImage,
    width: number | null | undefined,
    height: number | null | undefined,
    opts: { resample?: string | 0 | 1 | 2 | 3 | 4 | 5 } = {},
  ) {
    // 核从 STATE 读（而不是闭包捕获）：诊断脚本要能切实现做**否定对照**。
    // 踩过的坑：写成闭包捕获时，切 STATE.kernel 无效，"shim vs upstream" 两行会一模一样 ——
    // 那等于否定对照失效，测试就失去了鉴别力（金标脚本会直接报错退出）。
    const kernel = STATE!.kernel;
    // ① 同尺寸直接返回（与上游一致，别在这里丢一致性）
    if (this.width === width && this.height === height) return this;

    // ② nullish 维度的算术照抄上游：不抄就会出现 NaN 尺寸（静默产出坏图）
    if (width === null || width === undefined) {
      width = Math.round((height! / this.height) * this.width);
    } else if (height === null || height === undefined) {
      height = Math.round((width / this.width) * this.height);
    }

    const w = Math.round(width);
    const h = Math.round(height!);
    if (!(w > 0) || !(h > 0)) {
      throw new Error(
        `resize_compat: 目标尺寸非法 ${width}x${height}（源 ${this.width}x${this.height}）`,
      );
    }

    // ④ `pil-like`：**按 PIL 的规则分方向选实现**（实测依据见 verify_resize.py 的金标结果）
    //    PIL 的 resize 在**降采样**时把核的支撑按 1/scale 展宽（= 抗锯齿），
    //    在**放大**时不展宽（= 纯插值）。所以：
    //      降采样 → sharp.resize(kernel=cubic)      与 PIL 差 0.18/255（余弦 0.99976）
    //      放大   → 上游 affine(bicubic)              与 PIL 差 0.89/255（余弦 0.99806）
    //    反过来配对会明显变差（放大走 resize-cubic 时 2.67/255、余弦 0.980）——
    //    这是金标测试的否定对照发现的，不是猜的。
    let impl = kernel;
    if (kernel === 'pil-like') {
      const down = w * h < this.width * this.height;
      impl = down ? 'cubic' : 'upstream-affine';
    }
    if (impl === 'upstream-affine') {
      STATE!.calls.push({ impl, from: [this.width, this.height], to: [w, h] });
      return orig.call(this, width, height!, opts);
    }

    const sharp = await sharpPromise;
    const { data, info } = await this.toSharp()
      .resize({ width: w, height: h, fit: 'fill', kernel: impl as ResizeOptions['kernel'] })
      .raw()
      .toBuffer({ resolveWithObject: true });
    STATE!.calls.push({
      impl: `sharp.resize(kernel=${impl},fit=fill)`,
      from: [this.width, this.height],
      to: [w, h],
      channels: [this.channels, info.channels],
    });
    // 保留源通道数（上游 loadImageFunction 也是这么做的），否则后续 convert/patchify 会错位
    return new RawImageClass(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      info.channels as 1 | 2 | 3 | 4,
    );
  };

  RawImageClass.prototype.resize = patched;
  STATE = {
    [MARK]: true,
    kernel,
    RawImage: RawImageClass,
    calls: [],
    orig,
    patched,
    installed: RawImageClass.prototype.resize === patched,
    installed_di_name: RawImageClass.name || '(anonymous)',
    installed_at: new Date().toISOString(),
  };
  if (logger) logger(`resize_compat 已安装（kernel=${kernel}，替代 upstream affine-bicubic）`);
  return STATE;
}

/** 读取当前状态（未安装时为 null）。 */
export function resizeCompatState(): ResizeCompatState | null {
  return STATE;
}

/** 切换核（仅诊断用；正常路径应在 install 时定下）。 */
export function setResizeKernel(kernel: string): ResizeCompatState {
  if (!STATE) throw new Error('resize_compat 未安装');
  STATE.kernel = kernel;
  return STATE;
}

/** 取回**上游原始**方法（供否定对照：必须证明测试能分辨好坏）。 */
export function upstreamResize(): RawImageResize {
  if (!STATE) throw new Error('resize_compat 未安装');
  return STATE.orig;
}

/**
 * 可执行护栏：确认 shim **确实作用到了调用方自己的 RawImage 上**。
 *
 * 存在的理由（实测踩到）：当时仓里有**两份** @huggingface/transformers
 * （根 `node_modules` 与现已删除的 `onnx-spike/node_modules`，同版本、**不同的类对象**；
 * `根.RawImage === 那份.RawImage` → false）。
 * 如果本模块自己去 import，就会补 A 的 prototype 而调用方用 B 的类 ——
 * **shim 静默不生效**（不报错，只是向量又差了 1.9%）。所以：① RawImage 由调用方注入；
 * ② 装完立即用本函数断言一次；不通过就中止，不用错的预处理算向量。
 *
 * 那份重复依赖树已在 monorepo 重构中删除，但**这条护栏与注入约定都保留** ——
 * 它防的是"类身份有多个来源"这一类错误，而不是那一次的具体事故。
 */
export function assertResizeCompatInstalled(RawImageClass: typeof RawImage): boolean {
  if (!STATE) throw new Error('resize_compat 未安装');
  if (RawImageClass.prototype.resize !== STATE.patched) {
    throw new Error(
      'resize_compat 未作用到调用方的 RawImage —— 传入的类与安装时的类不是同一个' +
        '（常见原因：存在不止一份 @huggingface/transformers，各自导出不同的类对象）。' +
        '请把调用方自己用的那份 RawImage 传进 installResizeCompat()。',
    );
  }
  return true;
}

/**
 * 可执行自检：**不靠"应该没问题"**。
 * 断言：① 确实替换了原型方法 ② 同尺寸 no-op（返回原对象）③ 输出尺寸/通道数正确
 *      ④ nullish 维度与上游同算法（对比 width=null 的结果）
 * 失败即抛错，让调用方中止（宁可不跑，也不能用错预处理算向量）。
 */
export async function selfTestResizeCompat() {
  if (!STATE) throw new Error('resize_compat 未安装，不能自检');
  if (!STATE.installed) throw new Error('resize_compat: 原型方法未被替换');

  // 造一张 8x6 的合成图（值不重要，考的是几何与通道）
  const w0 = 8,
    h0 = 6,
    ch = 3;
  const data = new Uint8ClampedArray(w0 * h0 * ch);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const img = new STATE.RawImage(data, w0, h0, ch);

  const same = await img.resize(w0, h0);
  if (same !== img) throw new Error('同尺寸 resize 未返回原对象（上游语义被破坏）');

  const r = await img.resize(5, 4);
  if (r.width !== 5 || r.height !== 4)
    throw new Error(`输出尺寸错：${r.width}x${r.height}，期望 5x4`);
  if (r.channels !== ch) throw new Error(`输出通道数变了：${r.channels}，期望 ${ch}`);
  if (r.data.length !== 5 * 4 * ch)
    throw new Error(`输出字节数错：${r.data.length}，期望 ${5 * 4 * ch}`);

  // nullish：只给宽时，高按比例（上游算法）→ 8x6 给 width=4 应为 4x3
  const r2 = await (img.resize as NullableDimResize)(4, null);
  if (r2.height !== 3) throw new Error(`nullish 维度算术错：4x${r2.height}，期望 4x3`);

  const up = await img.resize(16, 12);
  if (up.width !== 16 || up.height !== 12) throw new Error('放大路径尺寸错');

  return {
    ok: true,
    kernel: STATE.kernel,
    calls: STATE.calls.length,
    raw_image: STATE.installed_di_name,
  };
}

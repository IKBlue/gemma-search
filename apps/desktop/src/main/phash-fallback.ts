// apps/desktop/src/main/phash-fallback.ts —— PHASH 解码的**回退路径**：nativeImage 解不了的格式
//
// 为什么需要它（2026-10-19 实测，证据见 `reports/2026-10-19-phash-k/`）：
//   · 真实库里有 20 张 `.jpg` 实为 **24 位 BI_RGB BMP**（`meta.json` 的 `bmpFallbackUsed: 20`）；
//   · Electron 的 `nativeImage` **不支持 BMP 解码**（by path / 改成 .bmp / createFromBuffer 三种方式都 isEmpty），
//     但 Chromium 之外我们**已经有**一份经过验证的纯 JS BMP 解码器（`packages/indexer/src/bmp_decode.ts`，
//     由 `main/encoder.ts` 的 `readImageAny` 唯一地对外提供）。
//   ⇒ PHASH 的 dHash 不能在 BMP 上留 NULL（那会让近重复通道对这 20 条**静默失效**），
//     必须回退到同一份解码器 —— **不写第二份解码器**（P1），只做"取灰度"这一步。
//
// ⚠️ 口径差异（如实）：主路径用 `nativeImage.resize({quality:'good'})` 强制 9×8；
//   本回退路径用 sharp 的 `resize({fit:'fill'})` 强制 9×8 —— 两者都是"写死参数 + 强制 9×8"，
//   但滤波实现不同。它的影响面只有"nativeImage 解不了的格式"（实测= BMP），
//   且 PHASH-1b 的阈值复核结论已单列在证据里（不把两条路径的微小差异当成同一个数字）。
import { PHASH_GRAY_BYTES } from './phash.ts';

export interface Gray9x8Fallback {
  gray: Uint8Array;
  /** 来源（`bmp-fallback` / `native`）—— 供日志/诊断区分，不参与哈希计算 */
  source: string;
}

/**
 * 用应用的**唯一回退解码器**把图片转成 9×8 灰度。
 * @returns 72 字节灰度；解不了（坏图/缺图/形状不对）⇒ **null**（调用方据此写 NULL，绝不伪造）
 */
export async function gray9x8FromFallbackDecoder(absPath: string): Promise<Gray9x8Fallback | null> {
  try {
    // ⚠️ **动态 import** 是刻意的：`encoder.ts` 会带进 `@huggingface/transformers`（很重），
    // 而这条回退只在 `nativeImage` 解不了时才走（实测=BMP，全库 20/3594）⇒ 不该让普通回填
    // 在启动路径上静态拉起它。同理，主入口对 encoder 本来就是动态 import；
    // 若这里改成静态，构建器会如实警告"dynamic import will not move module into another chunk"
    // （BUILD-2 的零警告纪律）。
    const { readImageAny } = await import('./encoder.ts');
    const { image, source } = await readImageAny(absPath);
    const buf = await image.toSharp().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    if (!buf || buf.length !== PHASH_GRAY_BYTES) return null;
    return { gray: new Uint8Array(buf), source };
  } catch {
    // 坏图/缺图/解码器抛错 ⇒ null（NULL 在库里表示"坏图/缺图/未算"三态）
    return null;
  }
}

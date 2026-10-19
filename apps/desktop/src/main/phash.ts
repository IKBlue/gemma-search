// apps/desktop/src/main/phash.ts —— **感知哈希 dHash**：纯算法（PHASH-1a）
//
// 为什么只有算法、没有解码：解码是**注入**的（Lead 2026-10-17 裁定 A）——
//   · 生产解码 = Electron `nativeImage`（既有那条路，本文件不碰、也不写第二份解码器，P1）；
//   · 单测注入假解码器 ⇒ **算法可 node:test 验**（缩放版本可离线构造），不引第三方 JPEG 依赖。
// ⚠️ 真 `nativeImage` 这条由**真窗口 e2e** 覆盖（单测验不到它）—— "算法绿、真解码全错"是真实可能。
//
// ── 算法口径（写死，别依赖库默认值漂移）────────────────────────────────────────
//   dHash = 9 列 × 8 行灰度 → 每行比较相邻两像素（左 > 右 ? 1 : 0）⇒ 64 bit ⇒ 16 位小写 hex。
//   · **灰度系数（Rec.709 luma）**：`0.2126 R + 0.7152 G + 0.0722 B`（取整到 0..255，四舍五入）。
//   · **缩放**：由解码器负责缩到 **9×8**；生产实现必须用**写死**的滤波参数（nativeImage.resize
//     的 `quality:'good'`），不许依赖运行时默认值 —— 否则不同 Electron 版本可能算出不同哈希。
//   · dHash 对重采样**稳健**（比较的是相邻像素的相对大小），所以 ±1 的量化差通常不改变 bit。
export interface PhashDecoder {
  /** 把图片解码成 **9 列 × 8 行**灰度（72 字节，行优先）；**坏图/缺图返回 null**（不许伪造） */
  decodeGray9x8(absPath: string): Promise<Uint8Array | null>;
}

export const PHASH_BITS = 64;
export const PHASH_HEX_LEN = 16;
export const PHASH_W = 9;
export const PHASH_H = 8;
export const PHASH_GRAY_BYTES = PHASH_W * PHASH_H;

/**
 * 近重复阈值 k（汉明距离 ≤ k 视为"同一画面的近重复"）。
 *
 * 依据（`reports/2026-10-19-phash-k/phash-k-verify.txt`，**生产 nativeImage 解码**实测）：
 *   · 同一张图缩放后再算哈希：汉明 min 0 / median 0 / p95 3 / **max 7**；
 *   · 不同图之间：**min 12** / median 32 / max 46。
 * ⇒ 取两侧空档中点 **10**（7 ≤ 10 < 12）。
 * ⚠️ 早先 `sharp` 近似基线给的 13 **已作废**：13 会越过"异图最小距离 12"，
 *    把两件不同素材判成近重复（宁可漏判，也不要把不同素材说成同一件）。
 * ⚠️ 这个口径只适用于**完整画面**的比较：中心裁剪查询（框选）不是近重复（裁剪 vs 原图 17–43）。
 */
export const PHASH_NEAR_DUP_K = 10;

/** dHash → 16 位小写 hex（输入必须是 72 字节；坏输入直接抛，不静默产出垃圾哈希） */
export function dHashHex(gray: Uint8Array): string {
  if (!(gray instanceof Uint8Array) || gray.length !== PHASH_GRAY_BYTES) {
    throw new Error(
      'dHashHex 需要 ' +
        String(PHASH_GRAY_BYTES) +
        ' 字节的 9×8 灰度，实得 ' +
        String(gray?.length),
    );
  }
  let hex = '';
  for (let row = 0; row < PHASH_H; row++) {
    let byte = 0;
    for (let col = 0; col < PHASH_W - 1; col++) {
      const left = gray[row * PHASH_W + col];
      const right = gray[row * PHASH_W + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** 汉明距离；任一为 null（坏图/缺图/未算）⇒ 返回 null（**未知**，不是 0，也不是 64） */
export function hammingHex(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  if (a.length !== PHASH_HEX_LEN || b.length !== PHASH_HEX_LEN) return null;
  let dist = 0;
  for (let i = 0; i < PHASH_HEX_LEN; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/**
 * 把 **9×8 的 32 位位图**（BGRA，行优先，无行填充）转成 72 字节灰度（Rec.709 luma）。
 *
 * 为什么单独一个纯函数：`nativeImage.toBitmap()` 的字节序与"取哪三个通道"这一步**最容易错**，
 * 而它又不该只能在真窗口里验证 ⇒ 抽成纯函数，单测用**合成 BGRA** 钉住：
 *   · 纯红 (R=255) ⇒ round(0.2126×255)=54；纯蓝 (B=255) ⇒ round(0.0722×255)=18（两值不同 ⇒ 通道序可断言）；
 *   · 长度不对 ⇒ **抛**（调用方据此返回 null，绝不产出一个假哈希）。
 *
 * ⚠️ 字节序：Electron 的 `toBitmap()` 在 Windows 上返回 **BGRA**（Skia N32）。本函数按 BGRA 读；
 *   换平台/换 Electron 版本若字节序变化，**单测不会红**（它只钉住"给定 BGRA 会得到什么"），
 *   要靠真窗口 e2e 的「同图两尺寸汉明 ≤2」兜住"整条解码链还算不算同一个哈希"。
 */
export function bgraToGray(bgra: Uint8Array): Uint8Array {
  const need = PHASH_GRAY_BYTES * 4;
  if (!(bgra instanceof Uint8Array) || bgra.length !== need) {
    throw new Error(
      'bgraToGray 需要 ' + String(need) + ' 字节的 9×8 BGRA 位图，实得 ' + String(bgra?.length),
    );
  }
  const out = new Uint8Array(PHASH_GRAY_BYTES);
  for (let i = 0; i < PHASH_GRAY_BYTES; i++) {
    const o = i * 4;
    const b = bgra[o];
    const g = bgra[o + 1];
    const r = bgra[o + 2];
    out[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  return out;
}

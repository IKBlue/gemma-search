// bmp_decode.mjs —— 给 Node 管线补上 BMP 解码能力（决策 1：纯 JS，保持索引↔库一一对应）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────
// 本库有 20 张 .jpg 实际是标准 24 位 BI_RGB BMP。实测：
//   · transformers.js 的 RawImage **不支持 BMP**
//   · 本机 sharp/libvips **没有 BMP 加载器**（.metadata()/.png()/.raw() 全失败）
//   · 旧 Python 管线（PIL）能过 → 新管线不补就少 20 张，A 项拿不到 3594
//
// ── 关键坑（已实测，务必不要"想当然"）────────────────────────────────────
// bmp-js 的 decode() 输出**不是**文档假设的 RGBA，也**不是** BGRA。
// 暴力枚举 12 种解释后，唯一与 PIL 逐像素一致的是：
//      每像素 4 字节，取 [1],[2],[3] 三个字节解释为 B,G,R；行序自上而下
// 若按 RGBA/BGRA 直接用，20 张图的向量会**全部是错的且不报错**。
//
// 因此这里不"相信"布局，而是**用合成 BMP 自检把布局钉死**：
// 自己造一张像素值已知的 24 位 BMP，解码后断言取出的 RGB 与写入的一致。
// bmp-js 若在升级后改变行为，自检会**大声失败**，而不是静默算错向量。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RawImage } from '@huggingface/transformers';

const BMP_MAGIC = Buffer.from('BM');

/**
 * 嗅探魔数只需要**文件头** —— 有界读取的上限。
 * 为什么要有它（ENC-1）：调用方曾为了看 2 个字节而 `fs.readFileSync` **整读**文件
 * （33 MB 的图也全进内存）；解码器（RawImage / bmp-js）会自己读它需要的部分。
 */
export const HEAD_SNIFF_BYTES = 64 * 1024;

/** 只读文件**头**（有界，最多 maxBytes 字节；EOF 时返回实际读到的字节数） */
export function readFileHead(absPath: string, maxBytes: number = HEAD_SNIFF_BYTES): Buffer {
  const fd = fs.openSync(absPath, 'r');
  try {
    const want = Math.max(0, Math.min(maxBytes, fs.fstatSync(fd).size));
    const buf = Buffer.allocUnsafe(want);
    const got = fs.readSync(fd, buf, 0, want, 0);
    return buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

/** BMP 魔数（"BM"）—— **唯一判据**（不要在各处再写一遍那两个字面量） */
export function isBmpHead(head: Buffer): boolean {
  return head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d;
}

/** 按魔数判断是否 BMP（不信任扩展名）—— 只读 2 字节的头，绝不整读 */
export function isBmp(filePath: string): boolean {
  return isBmpHead(readFileHead(filePath, 2));
}

/** 头部自查：只接受我们验证过的变体，其它明确报错（不猜） */
function checkHeader(buf: Buffer): { bpp: number; comp: number } {
  if (!buf.subarray(0, 2).equals(BMP_MAGIC)) throw new Error('不是 BMP（魔数不符）');
  const hdrSize = buf.readUInt32LE(14);
  const bpp = buf.readUInt16LE(28);
  const comp = buf.readUInt32LE(30);
  if (hdrSize !== 40) throw new Error(`不支持的 BMP 头大小 ${hdrSize}（只支持 BITMAPINFOHEADER=40）`);
  if (comp !== 0) throw new Error(`不支持的 BMP 压缩方式 ${comp}（只支持 BI_RGB=0）`);
  if (bpp !== 24) throw new Error(`不支持的 BMP 位深 ${bpp}（**只验证过 24 位**；32 位未验证，不予猜测）`);
  return { bpp, comp };
}

/**
 * 解码 BMP → 顶层 RGB（Buffer，w*h*3）。
 * 布局按**已实测验证**的规则：每像素 4 字节，取 [1][2][3] 作 B,G,R。
 */
export async function decodeBmpRgb(filePath: string): Promise<{ rgb: Buffer; width: number; height: number }> {
  const bmpjs = (await import('bmp-js')).default;
  const buf = fs.readFileSync(filePath);
  checkHeader(buf);

  const raw = bmpjs.decode(buf);
  if (!raw || !raw.data || !raw.width || !raw.height) throw new Error('bmp-js 解码返回空');

  const { data, width: w, height: h } = raw;
  if (data.length !== w * h * 4) {
    throw new Error(`bmp-js 输出长度异常 ${data.length}，期望 ${w * h * 4}（布局假设失效）`);
  }

  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[i * 3] = data[o + 3];      // R
    out[i * 3 + 1] = data[o + 2];  // G
    out[i * 3 + 2] = data[o + 1];  // B
  }
  return { rgb: out, width: w, height: h };
}

/**
 * 合成一张 24 位 BI_RGB BMP，像素值完全已知。
 * 用来把"取哪几个字节"这件事钉死，不依赖任何外部基准。
 */
export function makeSyntheticBmp() {
  const w = 3, h = 2;
  const rowStride = Math.ceil((w * 3) / 4) * 4;          // 24 位行按 4 字节对齐
  const pixBytes = rowStride * h;
  const buf = Buffer.alloc(54 + pixBytes, 0);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(54 + pixBytes, 2);
  buf.writeUInt32LE(54, 10);                              // 像素数据偏移
  buf.writeUInt32LE(40, 14);                              // BITMAPINFOHEADER
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);                                // 正高度 = 自下而上
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);                               // BI_RGB

  // 顶层行 (0,0)=(255,0,0) (1,0)=(0,255,0) (2,0)=(0,0,255)
  // 底层行 (0,1)=(10,20,30) (1,1)=(40,50,60) (2,1)=(70,80,90)
  const top = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const bottom = [[10, 20, 30], [40, 50, 60], [70, 80, 90]];
  const rows = [bottom, top];                             // 文件里先存底层
  for (let r = 0; r < h; r++) {
    for (let x = 0; x < w; x++) {
      const [R, G, B] = rows[r][x];
      const o = 54 + r * rowStride + x * 3;
      buf[o] = B; buf[o + 1] = G; buf[o + 2] = R;         // 文件里是 BGR
    }
  }
  return { buf, width: w, height: h, expect: [top[0], top[1], top[2], bottom[0], bottom[1], bottom[2]] };
}

/**
 * 自检：解码合成 BMP，断言像素与写入值一致。
 * **构建器启动时必须调用一次** —— 失败就中止，绝不用错的布局算向量。
 */
export async function selfTestBmpLayout() {
  const { buf, width: w, height: h, expect } = makeSyntheticBmp();
  const tmp = path.join(os.tmpdir(), `gs-bmpselftest-${process.pid}.bmp`);
  fs.writeFileSync(tmp, buf);
  try {
    const { rgb } = await decodeBmpRgb(tmp);
    const got = [];
    for (let i = 0; i < w * h; i++) got.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    const bad = [];
    for (let i = 0; i < expect.length; i++) {
      if (got[i].join(',') !== expect[i].join(',')) bad.push(`#${i} 期望 ${expect[i]} 实际 ${got[i]}`);
    }
    if (bad.length) {
      throw new Error('BMP 布局自检失败（bmp-js 行为可能已变）：' + bad.join('; '));
    }
    return { ok: true, checked: expect.length, size: `${w}×${h}` };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  }
}

/** 变成 RawImage：裸像素 → sharp 编 PNG（sharp 输出 PNG 是好的）→ Blob → RawImage.read */
export async function readBmpAsRawImage(filePath: string): Promise<RawImage> {
  const { rgb, width, height } = await decodeBmpRgb(filePath);
  const sharp = (await import('sharp')).default;
  const png = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return await RawImage.read(new Blob([png]));
}

/**
 * 统一入口：原生优先，失败且是 BMP 才回退。
 * 返回 { image, vectorSourceKind, error }
 *   vectorSourceKind: 'native' | 'bmp-fallback' → 写进索引的 vectorSource 字段
 */
interface ImageFallbackResult {
  image: RawImage | null;
  vectorSourceKind: 'native' | 'bmp-fallback' | null;
  error: string | null;
}

export async function readImageWithFallback(filePath: string): Promise<ImageFallbackResult> {
  try {
    const image = await RawImage.read(filePath);
    return { image, vectorSourceKind: 'native', error: null };
  } catch (e) {
    const nativeError = e instanceof Error ? e.message : String(e);
    if (!isBmp(filePath)) return { image: null, vectorSourceKind: null, error: nativeError };
    try {
      const image = await readBmpAsRawImage(filePath);
      return { image, vectorSourceKind: 'bmp-fallback', error: null };
    } catch (e2) {
      return { image: null, vectorSourceKind: null, error: `native: ${nativeError} | bmp: ${e2 instanceof Error ? e2.message : String(e2)}` };
    }
  }
}

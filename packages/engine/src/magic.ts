// packages/engine/src/magic.ts —— 按**文件头**判断真实图片格式（读魔数，不信扩展名）
//
// 为什么必须有它（不是锦上添花）：实测库（G:\model，3594 张）按魔数细查：
//   · 20 张文件名叫 .jpg、内容其实是 24 位 BMP（SPEC §7 记成"已知且合法"—— 而 transformers
//     不支持 BMP，索引线因此专门有 bmp_decode 回退；不认识这条就会被静默漏掉）
//   · 还有 68 张 .png 实为 JPEG、17 张 .jpg 实为 PNG
//   ⇒ 只按扩展名判断，等于对用户**撒谎**；SPEC §7 体检 ⑥ 要的正是"读魔数"。
//
// ⚠️ **只读**：只 `open(…,'r')` + `read` 前 16 字节 + `close`，不写任何东西。
import fs from 'node:fs';

/** 真实格式。'unknown' 是**如实**的答案：头部对不上任何已知魔数时不许瞎猜。 */
export type ImageFormat = 'jpeg' | 'png' | 'bmp' | 'webp' | 'gif' | 'unknown';

/** 判定所需的最大头部长度（WebP 的 'WEBP' 落在第 8..12 字节） */
export const MAGIC_HEAD_BYTES = 16;

/** 扩展名 → 该扩展名**应该**对应的真实格式（.jpg 与 .jpeg 同为 jpeg） */
export const FORMAT_OF_EXT: Readonly<Record<string, ImageFormat>> = Object.freeze({
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.bmp': 'bmp',
  '.gif': 'gif',
});

const RIFF = 'RIFF';
const WEBP = 'WEBP';

/** 从文件头字节判定真实格式（纯函数，可单测；不碰盘） */
export function detectImageFormat(head: Buffer): ImageFormat {
  // JPEG: FF D8 FF
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A（8 字节全查：只看前 4 字节会把某些截断文件也判成 PNG）
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  )
    return 'png';
  // BMP: 'BM'
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return 'bmp';
  // WebP: 'RIFF' ???? 'WEBP'
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === RIFF &&
    head.toString('latin1', 8, 12) === WEBP
  )
    return 'webp';
  // GIF: 'GIF8'
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return 'unknown';
}

/** 读文件头（只读打开；短文件返回实际读到的字节数，不补零、不伪造） */
export function readImageHead(absPath: string, bytes: number = MAGIC_HEAD_BYTES): Buffer {
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const got = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

/** 直接对一个文件判格式（读盘封装） */
export function formatOfFile(absPath: string): ImageFormat {
  return detectImageFormat(readImageHead(absPath));
}

/**
 * 扩展名与真实格式是否一致。
 * ⚠️ 传进来的格式是 'unknown'（或扩展名不在表里）时**一律算不一致** —— 不许"看不出来就按扩展名算对"。
 */
export function extMatchesFormat(ext: string, format: ImageFormat): boolean {
  return FORMAT_OF_EXT[ext.toLowerCase()] === format;
}

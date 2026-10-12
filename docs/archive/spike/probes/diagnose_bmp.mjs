// diagnose_bmp.mjs —— bmp-js 的解码结果与 PIL 不一致，定位到底差在哪
//
// 已知：data.length == w*h*4（无行填充混入），所以只可能是
//   · 通道序（RGBA / BGRA）
//   · 行序（自下而上 / 自上而下）
// 组合 4 种可能，逐一与 PIL 的 sha1 比对，找出唯一匹配的那种。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeBmpRaw } from './bmp_decode.mjs';

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const LIST = path.join('..', 'data', 'quality', 'extension-mismatch.json');
const item = JSON.parse(fs.readFileSync(LIST, 'utf8')).items.find((i) => i.actual === 'bmp');

const raw = await decodeBmpRaw(item.abs_path);
const { width: w, height: h, data } = raw;
console.log('[diag] ' + item.rel_path + '  ' + w + '×' + h + '  bytes=' + data.length + '  期望=' + (w * h * 4));

function build(order, flip) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const srcY = flip ? (h - 1 - y) : y;
    for (let x = 0; x < w; x++) {
      const o = (srcY * w + x) * 4;
      const t = (y * w + x) * 3;
      if (order === 'rgba') { out[t] = data[o]; out[t + 1] = data[o + 1]; out[t + 2] = data[o + 2]; }
      else { out[t] = data[o + 2]; out[t + 1] = data[o + 1]; out[t + 2] = data[o]; }
    }
  }
  return out;
}

const variants = {};
for (const order of ['rgba', 'bgra']) {
  for (const flip of [false, true]) {
    variants[`${order}${flip ? '+flip' : ''}`] = sha(build(order, flip));
  }
}
// 另外：整块字节的 sha1（不做任何解释），用于判断是否只是行序整体反转
variants['raw-bytes'] = sha(data);

for (const [k, v] of Object.entries(variants)) {
  console.log('[diag]   ' + k.padEnd(12) + ' ' + v.slice(0, 16));
}

// 顺便打印前两个像素，便于人眼判断（PIL 侧也会打印）
console.log('[diag] 前 2 个像素(RGBA 解释): ' +
  [...data.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
console.log('[diag] 末 2 个像素(RGBA 解释): ' +
  [...data.subarray(data.length - 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '));

fs.writeFileSync(path.join('..', 'data', 'quality', 'bmp-diag.json'),
  JSON.stringify({ rel_path: item.rel_path, width: w, height: h, variants,
    first8: [...data.subarray(0, 8)], last8: [...data.subarray(data.length - 8)] }, null, 1), 'utf8');
console.log('[diag] → ../data/quality/bmp-diag.json');

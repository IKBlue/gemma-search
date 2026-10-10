// verify_bmp.mjs —— 验证 bmp-js 解码是否与 PIL 逐像素一致
//
// 做法：对 20 张 BMP 各解出顶层 RGB 字节，算 sha1；同时尝试 RGBA / BGRA 两种通道序，
// 结果写 JSON 供 Python 侧（PIL）比对。**一致才算解码正确**，不是"能跑就算对"。
//
// 用法: node verify_bmp.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeBmpRaw, isBmp } from './bmp_decode.mjs';

const LIST = path.join('..', 'data', 'quality', 'extension-mismatch.json');
const data = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const bmps = data.items.filter((i) => i.actual === 'bmp');

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function toRGB(data, n, order) {
  // order: 'rgba' → 取 [0,1,2]；'bgra' → 取 [2,1,0]
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (order === 'rgba') { out[i * 3] = data[o]; out[i * 3 + 1] = data[o + 1]; out[i * 3 + 2] = data[o + 2]; }
    else { out[i * 3] = data[o + 2]; out[i * 3 + 1] = data[o + 1]; out[i * 3 + 2] = data[o]; }
  }
  return out;
}

const out = { files: [], note: 'sha1 为顶层 RGB 字节（不含 alpha）' };
for (const it of bmps) {
  const rec = { rel_path: it.rel_path, ok: false };
  try {
    const raw = await decodeBmpRaw(it.abs_path);
    const n = raw.width * raw.height;
    rec.width = raw.width;
    rec.height = raw.height;
    rec.channels = raw.data.length / n;
    rec.sha1_rgba = sha(toRGB(raw.data, n, 'rgba'));
    rec.sha1_bgra = sha(toRGB(raw.data, n, 'bgra'));
    rec.ok = true;
  } catch (e) {
    rec.error = e.message;
  }
  out.files.push(rec);
}

out.decodable = out.files.filter((f) => f.ok).length;
out.total = bmps.length;
fs.writeFileSync(path.join('..', 'data', 'quality', 'bmp-decode-node.json'),
  JSON.stringify(out, null, 1), 'utf8');

console.log('[verify] bmp-js 解码 ' + out.decodable + '/' + out.total);
for (const f of out.files.slice(0, 3)) {
  console.log('[verify]   ' + f.rel_path + '  ' + f.width + '×' + f.height + ' ch=' + f.channels +
    '  rgba=' + (f.sha1_rgba || '').slice(0, 12) + '  bgra=' + (f.sha1_bgra || '').slice(0, 12));
}
console.log('[verify] RESULT ' + JSON.stringify({ decodable: out.decodable, total: out.total }));
console.log('[verify] → ../data/quality/bmp-decode-node.json');

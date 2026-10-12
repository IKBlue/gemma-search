// bruteforce_bmp.mjs —— bmp-js 的输出布局与假设不符，暴力枚举所有解释
//
// 已知：data.length == w*h*4（无行填充混入），像素数一致，但字节内容对不上。
// 枚举：起始偏移 0..3 × 每像素取哪 3 个字节（含逆序）× 行序（正/反），
// 逐一与 PIL 的 sha1 比对。**只有完全一致的那种才算解码正确。**
//
// PIL 基准由同目录的 python 脚本给出（写入 bmp-pil-sha1.json）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeBmpRaw } from './bmp_decode.mjs';

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const LIST = path.join('..', 'data', 'quality', 'extension-mismatch.json');
const item = JSON.parse(fs.readFileSync(LIST, 'utf8')).items.find((i) => i.actual === 'bmp');
const { width: w, height: h, data } = await decodeBmpRaw(item.abs_path);

// PIL 侧基准（由 python 生成）
const pilPath = path.join('..', 'data', 'quality', 'bmp-pil-sha1.json');
if (!fs.existsSync(pilPath)) { console.error('先跑 python 侧生成 ' + pilPath); process.exit(2); }
const pil = JSON.parse(fs.readFileSync(pilPath, 'utf8'));
const target = pil[item.rel_path];
console.log('[bf] 目标文件 ' + item.rel_path + '  w=' + w + ' h=' + h);
console.log('[bf] PIL sha1 = ' + target.slice(0, 20));

const stride = data.length / (w * h);      // 每像素字节数（=4）
console.log('[bf] 每像素字节数 = ' + stride);

const hits = [];
// 偏移 offset：像素数据的起始位置
for (let offset = 0; offset <= 3; offset++) {
  for (const order of ['rgb', 'bgr']) {
    for (const flip of [false, true]) {
      const need = offset + w * h * 3;
      if (need > data.length) continue;
      const out = Buffer.alloc(w * h * 3);
      let ok = true;
      for (let y = 0; y < h && ok; y++) {
        const srcY = flip ? (h - 1 - y) : y;
        for (let x = 0; x < w; x++) {
          // 两种可能的"每像素步长"解释：stride 固定，或紧密 3 字节
          const o = offset + (srcY * w + x) * stride;
          if (o + 2 >= data.length) { ok = false; break; }
          const t = (y * w + x) * 3;
          if (order === 'rgb') { out[t] = data[o]; out[t + 1] = data[o + 1]; out[t + 2] = data[o + 2]; }
          else { out[t] = data[o + 2]; out[t + 1] = data[o + 1]; out[t + 2] = data[o]; }
        }
      }
      if (!ok) continue;
      const s = sha(out);
      const mark = s === target ? '  ★ 完全一致' : '';
      if (s === target) hits.push({ offset, order, flip, stride });
      console.log(`[bf]   offset=${offset} ${order}${flip ? '+flip' : ''} stride=${stride}  ${s.slice(0, 20)}${mark}`);
    }
  }
}

// 再试"紧密 3 字节无步长"（即数据其实是 BGR 连续排列）
for (const order of ['rgb', 'bgr']) {
  for (const flip of [false, true]) {
    const out = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const srcY = flip ? (h - 1 - y) : y;
      for (let x = 0; x < w; x++) {
        const o = (srcY * w + x) * 3;
        const t = (y * w + x) * 3;
        if (order === 'rgb') { out[t] = data[o]; out[t + 1] = data[o + 1]; out[t + 2] = data[o + 2]; }
        else { out[t] = data[o + 2]; out[t + 1] = data[o + 1]; out[t + 2] = data[o]; }
      }
    }
    const s = sha(out);
    const mark = s === target ? '  ★ 完全一致' : '';
    if (s === target) hits.push({ tight: true, order, flip });
    console.log(`[bf]   tight3 ${order}${flip ? '+flip' : ''}  ${s.slice(0, 20)}${mark}`);
  }
}

console.log('');
if (hits.length) {
  console.log('[bf] 命中解释: ' + JSON.stringify(hits));
  fs.writeFileSync(path.join('..', 'data', 'quality', 'bmp-layout.json'),
    JSON.stringify({ rel_path: item.rel_path, hits, stride }, null, 1), 'utf8');
} else {
  console.log('[bf] ✗ 没有任何解释与 PIL 一致 → bmp-js 对这些文件不可用，需要换解码器或自己写');
}

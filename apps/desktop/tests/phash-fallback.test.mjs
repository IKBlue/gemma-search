// apps/desktop/tests/phash-fallback.test.mjs —— PHASH 解码回退（BMP）：nativeImage 解不了的格式
//
// 为什么需要这条：2026-10-19 实测 —— Electron 的 `nativeImage` **不支持 BMP**（byPath / 改 .bmp /
// createFromBuffer 三种方式都 isEmpty），而真实库里有 20 张「.jpg 实为 24 位 BI_RGB BMP」。
// 若 PHASH 只走 nativeImage，这 20 条会静默留 NULL ⇒ 近重复通道对它们失效。
// 本文件钉住回退路径：合成 BMP（像素值已知）⇒ 9×8 灰度 + dHash 非空；坏图/缺图 ⇒ null（不伪造）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeSyntheticBmp } from '../../../packages/indexer/src/bmp_decode.ts';
import { dHashHex, PHASH_GRAY_BYTES } from '../src/main/phash.ts';
import { gray9x8FromFallbackDecoder } from '../src/main/phash-fallback.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_phash-fb', 'p-' + process.pid);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时 */
  }
});

test('F1 ⭐⭐ 合成 BMP ⇒ 回退解码器给出 72 字节灰度 + 合法 dHash（不写第二份解码器）', async () => {
  const { buf } = makeSyntheticBmp();
  const p = path.join(TMP, 'synth.bmp');
  fs.writeFileSync(p, buf);
  const r = await gray9x8FromFallbackDecoder(p);
  assert.ok(r, '合成 BMP 必须能解（这是 bmp_decode 自己的自检图）');
  assert.equal(r.gray.length, PHASH_GRAY_BYTES);
  assert.equal(r.source, 'bmp-fallback', '来源标签要如实（诊断用）');
  const h = dHashHex(r.gray);
  assert.match(h, /^[0-9a-f]{16}$/);
});

test('F2 坏图（字节不是图片，扩展名随便）⇒ null，不抛', async () => {
  const p = path.join(TMP, 'broken.jpg');
  fs.writeFileSync(p, Buffer.from('这不是图片', 'utf8'));
  const r = await gray9x8FromFallbackDecoder(p);
  assert.equal(r, null, '解不出来必须返回 null（NULL = 坏图/缺图/未算），绝不伪造哈希输入');
});

test('F3 缺图 ⇒ null，不抛（回填的 failed 分支不再需要靠异常兜）', async () => {
  const r = await gray9x8FromFallbackDecoder(path.join(TMP, 'nope.png'));
  assert.equal(r, null);
});

test('F4 ⭐ PNG 也走同一条回退解码链（readImageAny 的来源标签是 native）', async () => {
  // 1×1 PNG（真图片字节，不依赖 sharp 写文件的能力）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const p = path.join(TMP, 'tiny.png');
  fs.writeFileSync(p, png);
  const r = await gray9x8FromFallbackDecoder(p);
  assert.ok(r, '回退链对 PNG 也必须可用（它只是"第二条解码入口"，不是 BMP 专用）');
  assert.equal(r.source, 'native');
  assert.equal(r.gray.length, PHASH_GRAY_BYTES);
});

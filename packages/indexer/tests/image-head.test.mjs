// packages/indexer/tests/image-head.test.mjs —— ENC-1/A：嗅探魔数只读**文件头**（有界）
//
// 缺陷：main/encoder.ts 的 readImageAny 为了看 2 个字节而 `fs.readFileSync(absPath)` **整读**文件
// （33 MB 的图也全进内存）。现在改成有界头读（bmp_decode.readFileHead，默认 64 KiB），
// 本组用「注入读取计数 + 大文件」把这条钉死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readFileHead, isBmpHead, isBmp, HEAD_SNIFF_BYTES, makeSyntheticBmp } from '../src/bmp_decode.ts';
import { readImageAny } from '../../../apps/desktop/src/main/encoder.ts';

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-head-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

test('ENC-1 ⭐⭐ readFileHead 有界：8 MiB 文件也最多读 64 KiB（小文件读到 EOF 就停）', () => {
  const big = tmpFile('big.jpg', Buffer.alloc(8 * 1024 * 1024, 0x41));
  const head = readFileHead(big);
  assert.ok(head.length <= HEAD_SNIFF_BYTES, '读取字节必须 ≤ 上限，实得 ' + head.length);
  assert.equal(head.length, HEAD_SNIFF_BYTES, '大文件应读满上限（而不是整读）');
  assert.deepEqual(head.subarray(0, 4), Buffer.from('AAAA'), '读到的必须是文件**开头**');
  const small = tmpFile('small.jpg', Buffer.from('BM'));
  assert.deepEqual(readFileHead(small), Buffer.from('BM'), '小文件读多少算多少（不补零）');
});

test('ENC-1 ⭐ 魔数判据唯一：isBmpHead / isBmp 对 BMP 与非 BMP 的判断一致', () => {
  assert.equal(isBmpHead(Buffer.from('BMxxxx')), true);
  assert.equal(isBmpHead(Buffer.from('XX')), false);
  assert.equal(isBmpHead(Buffer.from('B')), false);
  assert.equal(isBmpHead(Buffer.alloc(0)), false);
  const bmp = makeSyntheticBmp();
  const disguised = tmpFile('disguised.jpg', bmp.buf);
  assert.equal(isBmp(disguised), true, '名为 .jpg 实为 BMP 必须靠魔数认出来');
  assert.equal(isBmp(tmpFile('plain.jpg', Buffer.from('not-an-image'))), false);
});

test('ENC-1 ⭐⭐ 编码路径不再整读：注入头读计数 ⇒ 读取字节 ≤ 上限（且注入的 reader 必须被调用）', async () => {
  const big = tmpFile('big.jpg', Buffer.alloc(8 * 1024 * 1024, 0x41));
  let calls = 0; let bytes = 0;
  const reader = (p, max) => { calls += 1; const b = readFileHead(p, max); bytes += b.length; return b; };
  // 这个文件不是合法图片 ⇒ 解码必然抛；这里只关心**读了多少字节**
  await readImageAny(big, reader).catch(() => { /* 预期：解码失败 */ });
  assert.equal(calls, 1, '必须经注入的头读（若还在 fs.readFileSync 整读，这里会是 0）');
  assert.ok(bytes > 0 && bytes <= HEAD_SNIFF_BYTES, '读取字节必须 ≤ 上限，实得 ' + bytes);
});

test('ENC-1 ⭐ BMP 回退仍走同一条路（有界头读认得 "BM"，回退照旧生效）', async () => {
  const bmp = makeSyntheticBmp();
  const disguised = tmpFile('disguised2.jpg', bmp.buf);
  const r = await readImageAny(disguised);
  assert.equal(r.source, 'bmp-fallback');
  assert.equal(r.image.width, bmp.width);
  assert.equal(r.image.height, bmp.height);
});

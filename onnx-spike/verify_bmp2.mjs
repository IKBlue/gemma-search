// verify_bmp2.mjs —— 双验证修正后的 BMP 解码
//   A) 合成图自检：像素值我们自己写的，钉死"取哪几个字节"
//   B) 20 张真实文件：与 PIL 基准 sha1 逐像素比对（PIL 是旧管线用过的解码器）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeBmpRgb, selfTestBmpLayout } from './bmp_decode.mjs';

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const log = (...a) => console.log('[v2]', ...a);

log('=== A) 合成 BMP 布局自检 ===');
try {
  const r = await selfTestBmpLayout();
  log('  通过 ✓  校验 ' + r.checked + ' 个像素  ' + r.size);
} catch (e) {
  log('  失败 ✗  ' + e.message);
  process.exit(1);
}

log('');
log('=== B) 20 张真实 BMP vs PIL ===');
const pil = JSON.parse(fs.readFileSync(path.join('..', 'data', 'quality', 'bmp-pil-sha1.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join('..', 'data', 'quality', 'extension-mismatch.json'), 'utf8'))
  .items.filter((i) => i.actual === 'bmp');
let ok = 0, bad = [];
for (const it of items) {
  try {
    const { rgb, width, height } = await decodeBmpRgb(it.abs_path);
    const s = sha(rgb);
    if (s === pil[it.rel_path]) ok++;
    else bad.push(`${it.rel_path} 期望 ${pil[it.rel_path].slice(0, 12)} 实际 ${s.slice(0, 12)}`);
  } catch (e) {
    bad.push(`${it.rel_path} 解码异常: ${e.message}`);
  }
}
log('  与 PIL 逐像素一致: ' + ok + ' / ' + items.length);
if (bad.length) { log('  不一致明细:'); bad.slice(0, 6).forEach((b) => log('    ' + b)); }

log('');
log('=== C) 端到端：能否变成 RawImage ===');
const { readBmpAsRawImage } = await import('./bmp_decode.mjs');
const one = items[0];
try {
  const img = await readBmpAsRawImage(one.abs_path);
  log(`  ${one.rel_path} → RawImage ${img.width}×${img.height} channels=${img.channels} ✓`);
} catch (e) {
  log('  失败 ✗  ' + e.message);
}

const pass = ok === items.length && bad.length === 0;
log('');
log('RESULT ' + JSON.stringify({ selftest: true, pil_match: ok, total: items.length, pass }));
process.exit(pass ? 0 : 1);

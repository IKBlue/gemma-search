// probe_resize_pixels.mjs —— 像素级核对：sharp 的两条重采样路径 vs PIL
//
// 背景：A3b 已实测——把 transformers.js 的 `affine(bicubic)` 换成 `resize(kernel:'cubic')`
// 后，最差 48 张的等价性 min 从 0.9153 升到 0.9960。本探针进一步回答**为什么**：
// 是"碰巧更接近"，还是**真的和 PIL 同一个算法**（像素级就能对上）？
//
// 三个产物（同一张图、同一目标尺寸、都是裸 RGB8）：
//   A. affine-bicubic —— transformers.js 现用（libvips 仿射插值）
//   B. resize-cubic   —— 候选修复（libvips 标准 resize）
//   C. PIL BICUBIC    —— Python 侧参考（由 probe_resize_pixels.py 生成）
//
// 用法:
//   node probe_resize_pixels.mjs <图片路径|---> <目标宽> <目标高> <输出前缀>
//   图片路径传 '-' 表示"读 data/_resize-src.raw"（由 Python 侧先把 PIL 解码的裸像素写在那里），
//   这样三方输入的**解码像素完全一致**，差异只可能来自重采样。
import fs from 'node:fs';
import path from 'node:path';

const [imgArg, wArg, hArg] = process.argv.slice(2);
const W = parseInt(wArg, 10);
const H = parseInt(hArg, 10);
const sharp = (await import('sharp')).default;

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const srcW = parseInt(process.env.SRC_W || '0', 10);
const srcH = parseInt(process.env.SRC_H || '0', 10);

let base;
if (imgArg === '-') {
  const raw = fs.readFileSync(path.join(here, '..', 'data', '_resize-src.raw'));
  if (!srcW || !srcH) throw new Error('传 "-" 时必须给 SRC_W/SRC_H 环境变量');
  base = sharp(raw, { raw: { width: srcW, height: srcH, channels: 3 } });
} else {
  base = sharp(imgArg);
}
const meta = await base.metadata();
console.log(`[rs] 源 ${meta.width}x${meta.height} ch=${meta.channels} → 目标 ${W}x${H}`);

// A. affine + bicubic（transformers.js 的路径）
const a = await base
  .clone()
  .affine([W / meta.width, 0, 0, H / meta.height], { interpolator: 'bicubic' })
  .raw()
  .toBuffer({ resolveWithObject: true });
// B. 标准 resize + cubic（候选）
const b = await base
  .clone()
  .resize({ width: W, height: H, fit: 'fill', kernel: 'cubic' })
  .raw()
  .toBuffer({ resolveWithObject: true });

const outDir = path.join(here, '..', 'data');
fs.writeFileSync(path.join(outDir, '_resize-affine.raw'), a.data);
fs.writeFileSync(path.join(outDir, '_resize-cubic.raw'), b.data);
fs.writeFileSync(
  path.join(outDir, '_resize-meta.json'),
  JSON.stringify({
    src: imgArg === '-' ? '(raw)' : imgArg,
    srcW: meta.width,
    srcH: meta.height,
    targetW: W,
    targetH: H,
    affine: { w: a.info.width, h: a.info.height, ch: a.info.channels },
    cubic: { w: b.info.width, h: b.info.height, ch: b.info.channels },
  }),
);
console.log(
  `[rs] 已写 _resize-affine.raw / _resize-cubic.raw（affine ${a.info.width}x${a.info.height} · cubic ${b.info.width}x${b.info.height}）`,
);

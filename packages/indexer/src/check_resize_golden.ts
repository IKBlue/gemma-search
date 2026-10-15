// check_resize_golden.mjs —— 跨语言金标核对：Node 侧 resize vs PIL 的**同一张图同一尺寸**
//
// 有**否定对照**（这是本脚本存在的理由）：
//   对每个用例，同时算
//     · shim  ：installResizeCompat 后的 RawImage.resize（候选修复）
//     · upstream：kernel='upstream-affine'（transformers.js 原样路径）
//   若两者都被判为"合格"，说明这个测试**测不出东西**，脚本会报错退出。
//
// 输入：manifest.json（由 verify_resize.py 生成）
//   { "cases": [ { "id", "src_raw", "src_w", "src_h", "channels",
//                  "target_w", "target_h", "pil_raw" } ] }
// 输出：结果 JSON（每条用例两种实现的 平均绝对差 / 最大绝对差 / 余弦）

import fs from 'node:fs';
import path from 'node:path';
import { RawImage } from '@huggingface/transformers';
import {
  installResizeCompat,
  selfTestResizeCompat,
  resizeCompatState,
  upstreamResize,
} from './resize_compat.ts';

interface GoldenCase {
  id: string;
  src_raw: string;
  src_w: number;
  src_h: number;
  channels: 1 | 2 | 3 | 4;
  target_w: number;
  target_h: number;
  pil_raw: string;
}
interface ResizeStat {
  mean: number;
  max: number;
  cosine: number;
}
/** 一条实现的结果：成功时三个统计量，失败时只有 error */
interface ImplResult {
  mean?: number;
  max?: number;
  cosine?: number;
  error?: string;
}
interface GoldenResult {
  id: string;
  src: string;
  target: string;
  direction: 'down' | 'up';
  shim?: ImplResult;
  upstream?: ImplResult;
}
/** filter 的收窄类型：两条实现都成功时才参与汇总 */
type CompleteGoldenResult = GoldenResult & { shim: ResizeStat; upstream: ResizeStat };
interface GoldenBucket {
  n: number;
  shim_mean_avg: number | null;
  shim_mean_max?: number | null;
  shim_cos_min: number | null;
  upstream_mean_avg: number | null;
  upstream_cos_min: number | null;
}
interface GoldenSummary {
  kernel: string;
  cases: number;
  down: GoldenBucket;
  up: GoldenBucket;
  sensitivity?: number | null;
}

const argv = process.argv.slice(2);
const arg = (n: string, d?: string): string => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : (d as string);
};
const MANIFEST = arg('manifest');
const OUT = arg('out');
const KERNEL = arg('kernel', 'cubic');
if (!MANIFEST || !OUT) {
  console.error(
    '用法: node check_resize_golden.mjs --manifest <manifest.json> --out <结果.json> [--kernel cubic]',
  );
  process.exit(2);
}

installResizeCompat({ kernel: KERNEL, RawImage });
const st = await selfTestResizeCompat();
console.log(`[golden] shim 自检通过（kernel=${st.kernel} · 断言 ${st.calls} 次 resize）`);

const sharpMod = (await import('sharp')).default;

function diffStats(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): { mean: number; max: number; cosine: number; n: number } {
  const n = Math.min(a.length, b.length);
  let sum = 0,
    max = 0,
    dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return { mean: sum / n, max, cosine: dot / (Math.sqrt(na) * Math.sqrt(nb) || 1), n };
}

/** 用指定实现把裸像素缩到目标尺寸，返回 Uint8ClampedArray
 *  impl='shim'     → 走安装后的 RawImage.resize（候选修复）
 *  impl='upstream' → 直接调**原始方法**（transformers.js 的 affine-bicubic）——否定对照
 */
async function resizeWith(
  impl: string,
  srcRaw: ArrayLike<number>,
  w0: number,
  h0: number,
  ch: 1 | 2 | 3 | 4,
  tw: number,
  th: number,
) {
  const img = new RawImage(new Uint8ClampedArray(srcRaw), w0, h0, ch);
  // ⚠️ 必须把 `{resample: 3}` 一并传进去：
  //    处理器实际调用形式是 `resize(target_w, target_h, { resample: this.resample })`（=3 → bicubic）。
  //    不传 opts 时上游默认 resample=2（**bilinear**）—— 那测的就不是同一个东西了。
  //    （这个坑真踩到过：否定对照一度“看起来”变成 bilinear 的结果，数值对不上。）
  const opts = { resample: 3 } as const;
  const out =
    impl === 'upstream'
      ? await upstreamResize().call(img, tw, th, opts)
      : await img.resize(tw, th, opts);
  return { data: out.data, width: out.width, height: out.height, channels: out.channels };
}

/** 该用例是降采样还是放大（判据分方向：放大时两套核差异天然更大） */
function direction(c: GoldenCase): 'down' | 'up' {
  return c.target_w * c.target_h < c.src_w * c.src_h ? 'down' : 'up';
}

const manifest: { cases: GoldenCase[] } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const results: GoldenResult[] = [];
for (const c of manifest.cases) {
  const srcBuf = fs.readFileSync(c.src_raw);
  const pilBuf = fs.readFileSync(c.pil_raw);
  const rec: GoldenResult = {
    id: c.id,
    src: `${c.src_w}x${c.src_h}`,
    target: `${c.target_w}x${c.target_h}`,
    direction: direction(c),
  };

  for (const impl of ['shim', 'upstream'] as const) {
    let out;
    try {
      out = await resizeWith(impl, srcBuf, c.src_w, c.src_h, c.channels, c.target_w, c.target_h);
    } catch (e) {
      rec[impl] = { error: e instanceof Error ? e.message : String(e) };
      continue;
    }
    if (out.width !== c.target_w || out.height !== c.target_h) {
      rec[impl] = { error: `尺寸错 ${out.width}x${out.height}` };
      continue;
    }
    if (out.channels !== c.channels) {
      rec[impl] = { error: `通道数错 ${out.channels} != ${c.channels}` };
      continue;
    }
    const s = diffStats(out.data, pilBuf);
    rec[impl] = { mean: +s.mean.toFixed(4), max: s.max, cosine: +s.cosine.toFixed(6) };
  }
  results.push(rec);
  console.log(
    `  ${rec.id} [${rec.direction}] ${rec.src}→${rec.target}` +
      `  shim 平均差=${rec.shim?.mean} 余弦=${rec.shim?.cosine}` +
      `  |  upstream 平均差=${rec.upstream?.mean} 余弦=${rec.upstream?.cosine}`,
  );
}

const byDir = (dir: string): CompleteGoldenResult[] =>
  results.filter((r): r is CompleteGoldenResult => r.direction === dir && !!r.shim && !!r.upstream);
const down = byDir('down');
const up = byDir('up');
const mean = (xs: number[]): number | null =>
  xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null;
const maxOf = (xs: number[]): number | null => (xs.length ? +Math.max(...xs).toFixed(4) : null);
const summary: GoldenSummary = {
  kernel: KERNEL,
  cases: results.length,
  // 降采样方向（真实管线里绝大多数图走这条：库图普遍大于 ~624x480 的目标网格）
  down: {
    n: down.length,
    shim_mean_avg: mean(down.map((r) => r.shim.mean)),
    shim_mean_max: maxOf(down.map((r) => r.shim.mean)),
    shim_cos_min: down.length ? Math.min(...down.map((r) => r.shim.cosine)) : null,
    upstream_mean_avg: mean(down.map((r) => r.upstream.mean)),
    upstream_cos_min: down.length ? Math.min(...down.map((r) => r.upstream.cosine)) : null,
  },
  // 放大方向（小图才走；两套核在放大时天然差得更多，单列不混入主判据）
  up: {
    n: up.length,
    shim_mean_avg: mean(up.map((r) => r.shim.mean)),
    shim_cos_min: up.length ? Math.min(...up.map((r) => r.shim.cosine)) : null,
    upstream_mean_avg: mean(up.map((r) => r.upstream.mean)),
    upstream_cos_min: up.length ? Math.min(...up.map((r) => r.upstream.cosine)) : null,
  },
};
summary.sensitivity =
  summary.down.upstream_mean_avg != null && summary.down.shim_mean_avg
    ? +(summary.down.upstream_mean_avg / Math.max(1e-9, summary.down.shim_mean_avg)).toFixed(1)
    : null;

fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1), 'utf8');
console.log(`[golden] ${JSON.stringify(summary)}`);
console.log(`[golden] 已写 ${OUT}`);
if (summary.sensitivity != null && summary.sensitivity < 5) {
  console.error('[golden] ✗ 否定对照失效：两种实现的偏差倍数 < 5×，这个测试证明不了什么');
  process.exit(3);
}

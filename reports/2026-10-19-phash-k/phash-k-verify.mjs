// reports/2026-10-19-phash-k/phash-k-verify.mjs —— PHASH-1b 前置：用**生产 nativeImage 解码**复核 dHash 阈值 k
//
// 为什么需要这一步：EVAL-1 基线给的候选 k=13 是用 `sharp` 近似算的（见 fixtures/eval-baseline.json 的
// phashCalibration.note）。PHASH-1b 的阈值必须先用**真正生产用的解码路径**（Electron `nativeImage`）复核，
// 否则"阈值看起来能用、实际解码链不同"就是另一种静默降质。
//
// 做法（**不复制算法**）：
//   1. 用 e2e 的启动器起真 Electron（主进程里才有 nativeImage）；
//   2. `app.evaluate` 里只做"解码 + 两次 9×8 缩放 → 原始 BGRA 字节"，把字节带回 Node；
//   3. Node 侧用**生产纯函数**（main/phash.ts 的 bgraToGray / dHashHex / hammingHex）算哈希与汉明距离。
//   ⇒ 算法与字节序口径都走产品代码；本脚本只搬运字节，不复写 dHash。
//
// 两条分布：
//   · 近重复：同一张原图解码 → 缩小到 max 边 256 → 再算哈希，对比原图哈希（这才是 PHASH-1b 的近重复口径）；
//   · 异图：随机取不同的原图两两比较（固定种子，可复现）。
//   参考（**不是近重复**）：中心裁剪查询 vs 原图 —— 构图已变，别拿它定阈值。
//
// 用法：node reports/2026-10-19-phash-k/phash-k-verify.mjs
//   缺省库根取 data/libraries/L1/meta.json 的 lib_root（可用 EVAL_LIB_ROOT 覆盖，P5：不把本机路径写进仓库）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchApp } from '../../apps/desktop/e2e/helpers/launch.mjs';
import { bgraToGray, dHashHex, hammingHex } from '../../apps/desktop/src/main/phash.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const LIB_ID = 'L1';
const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'libraries', LIB_ID, 'meta.json'), 'utf8'));
const libRoot = process.env.EVAL_LIB_ROOT || meta.lib_root;
if (!libRoot || !fs.existsSync(libRoot)) {
  console.error('✖ 真实库根不可用：' + String(libRoot));
  process.exit(1);
}
const evalDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'eval-queries.json'), 'utf8'));
const truth = evalDoc.entries.filter((e) => !(e.expect && e.expect.none));
const items = JSON.parse(fs.readFileSync(path.join(DATA, 'libraries', LIB_ID, 'items.json'), 'utf8'));

const absOf = (rel) => path.join(libRoot, ...String(rel).split('\\'));

/** 采样：50 条评测源图（存在才收） */
const samplePaths = [];
for (const e of truth) {
  const p = absOf(e.sourceRelPath);
  if (fs.existsSync(p)) samplePaths.push({ id: e.id, p });
}
/** 额外：库里「.jpg 实为 BMP」的条目（eval 集刻意排除它们，但 PHASH-1b 的解码链要能覆盖） */
function isBmpFile(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b[0] === 0x42 && b[1] === 0x4d; // "BM"
  } catch {
    return false;
  }
}
const bmpPaths = [];
for (const it of items) {
  if (!it.relPath || bmpPaths.length >= 5) continue;
  const p = absOf(it.relPath);
  if (fs.existsSync(p) && isBmpFile(p)) bmpPaths.push({ id: 'bmp-' + it.uid, p });
}
if (bmpPaths.length === 0) console.log('[k] 未发现 BMP 样本（不影响主结论，记为 0）');
console.log(
  '[k] 样本：评测源图 ' +
    String(samplePaths.length) +
    ' 条 · BMP ' +
    String(bmpPaths.length) +
    ' 条 · 库根 ' +
    libRoot,
);

// 干净 userData/config（不碰真实库与真实用户配置）
const tmp = fs.mkdtempSync(path.join(DATA, '_phash-k-'));
const cfgPath = path.join(tmp, 'config.json');
fs.writeFileSync(cfgPath, JSON.stringify({ data_dir: path.join(tmp, 'data') }), 'utf8');
const paths = [...samplePaths, ...bmpPaths].map((s) => s.p);
const ids = Object.fromEntries([...samplePaths, ...bmpPaths].map((s) => [s.p, s.id]));

const app = await launchApp({
  env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: '', GEMMA_FAKE: '', GEMMA_COLLECT_DIRS: '' },
  extraArgs: ['--user-data-dir=' + path.join(tmp, 'ud')],
});

let decoded;
try {
  decoded = await app.evaluate(async ({ nativeImage }, paths) => {
    const out = [];
    for (const p of paths) {
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) {
        out.push({ p, ok: false });
        continue;
      }
      const { width, height } = img.getSize();
      const grayOf = (im) => Array.from(im.resize({ width: 9, height: 8, quality: 'good' }).toBitmap());
      const scale = 256 / Math.max(width, height);
      const rw = Math.max(1, Math.round(width * scale));
      const rh = Math.max(1, Math.round(height * scale));
      const resized = img.resize({ width: rw, height: rh, quality: 'good' });
      out.push({
        p,
        ok: true,
        w: width,
        h: height,
        gray: grayOf(img),
        grayResized: grayOf(resized),
      });
    }
    return out;
  }, paths);
} finally {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Node 侧：只用生产纯函数算哈希 ───────────────────────────────────────
const rows = [];
for (const d of decoded) {
  if (!d.ok) {
    rows.push({ id: ids[d.p], ok: false, p: d.p });
    continue;
  }
  const h = dHashHex(bgraToGray(Uint8Array.from(d.gray)));
  const hResized = dHashHex(bgraToGray(Uint8Array.from(d.grayResized)));
  rows.push({ id: ids[d.p], ok: true, w: d.w, h: d.h, u: h, uResized: hResized, d: hammingHex(h, hResized) });
}

const evalRows = rows.filter((r) => r.ok && String(r.id).startsWith('q'));
const bmpRows = rows.filter((r) => r.ok && String(r.id).startsWith('bmp-'));
const same = evalRows.map((r) => r.d).filter((x) => typeof x === 'number').sort((a, b) => a - b);
const bmpSame = bmpRows.map((r) => r.d).filter((x) => typeof x === 'number').sort((a, b) => a - b);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}
const stat = (sorted) => ({
  n: sorted.length,
  min: sorted[0] ?? null,
  median: quantile(sorted, 0.5),
  p95: quantile(sorted, 0.95),
  max: sorted[sorted.length - 1] ?? null,
});

// 异图对照：随机不同原图两两比较（固定种子）
const hashes = evalRows.map((r) => r.u);
const diff = [];
let seed = 20261019;
for (let i = 0; i < 200 && hashes.length > 1; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  const a = seed % hashes.length;
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  const b = seed % hashes.length;
  if (a === b) continue;
  diff.push(hammingHex(hashes[a], hashes[b]));
}
const diffSorted = diff.filter((x) => typeof x === 'number').sort((a, b) => a - b);
const sameStat = stat(same);
const diffStat = stat(diffSorted);
const suggestedK =
  same.length && diffSorted.length && diffSorted[0] > same[same.length - 1]
    ? Math.round((diffSorted[0] + same[same.length - 1]) / 2)
    : null;

// 与 sharp 近似基线对照（引用既有证据，不是本轮实测）
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'eval-baseline.json'), 'utf8'));
const sharpApprox = baseline.phashCalibration;
const failed = rows.filter((r) => !r.ok);

const out = {
  at: new Date().toISOString(),
  decoder: 'Electron nativeImage (production path)',
  samples: { eval: evalRows.length, bmp: bmpRows.length, failed: failed.length },
  nearDuplicateResize: sameStat,
  bmpResize: stat(bmpSame),
  differentImages: diffStat,
  suggestedK,
  sharpApproxForComparison: {
    nearDuplicateResize: sharpApprox.nearDuplicateResize,
    differentImages: sharpApprox.differentImages,
    suggestedK: sharpApprox.suggestedK,
  },
  perImage: evalRows.map((r) => ({ id: r.id, d: r.d })),
};
const outPath = path.join(HERE, 'phash-k-verify.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log('\n===== PHASH-1b 阈值复核（生产 nativeImage 解码） =====');
console.log('解码失败：' + String(failed.length) + (failed.length ? ' → ' + failed.map((f) => f.id).join(',') : ''));
console.log('近重复（同图缩放到 256）：' + JSON.stringify(sameStat));
console.log('参考（BMP 回退样本）：' + JSON.stringify(out.bmpResize));
console.log('异图：' + JSON.stringify(diffStat));
console.log('sharp 近似基线（引用既有证据）：' + JSON.stringify(out.sharpApproxForComparison));
console.log('⇒ 生产解码下的候选 k = ' + String(suggestedK));
console.log('已写：' + path.relative(ROOT, outPath));

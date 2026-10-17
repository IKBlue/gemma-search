// reports/2026-10-15-wave3/eval-baseline.mjs —— EVAL-1：**真实召回基线**（可复跑）
//
// 为什么需要它：`fixtures/eval-queries.json`（55 条）与评分器已落地，但**基线数字**一直没产出 ——
// 于是 PHASH-1b / NOMATCH-1 的阈值没有依据（卡面明确：**不许抄一个数字**）。
// 本脚本用**真实库 + 真模型 + 真索引**跑一遍评测集，产出 `fixtures/eval-baseline.json`。
//
// 口径（与评测集/评分器一致，别在别处另立一套）：
//   · 查询图 = 源图的**中心 60% 裁剪**（归一化矩形，与 eval-dataset.mjs 的 DEFAULT_CROP 同源）；
//   · 期望 = 该查询自己的 uid（同图判定）；合成图期望「无匹配」；
//   · 排名 = 引擎 `search(mode:'image', topK:10)` 的原样结果（**不重排、不自算 band**）；
//   · 评分 = `apps/desktop/tests/helpers/eval-dataset.mjs` 的 `scoreEval`（唯一实现）。
//
// 解码口径：用应用的**唯一解码入口** `main/encoder.ts` 的 `readImageAny`
//   ⇒ 真实库里那 20 张「.jpg 实为 BMP」的条目不再是一个阻碍（BMP 走已验证的纯 JS 回退）。
//
// 用法（不把本机路径写进仓库 —— P5）：
//   $env:EVAL_LIB_ROOT='G:\model'   # 缺省读 data/libraries/L1/meta.json 的 lib_root
//   node reports/2026-10-15-wave3/eval-baseline.mjs
//
// ⚠️ 本脚本**只测量**：不改素材、不建索引、不写库；临时裁剪图落 `data/_eval-1/<pid>/`。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { createEngine } from '../../packages/engine/src/engine.ts';
import { createEncoder, readImageAny } from '../../apps/desktop/src/main/encoder.ts';
import { dHashHex, hammingHex } from '../../apps/desktop/src/main/phash.ts';
import { scoreEval } from '../../apps/desktop/tests/helpers/eval-dataset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const LIB_ID = 'L1';
const EVAL_JSON = path.join(ROOT, 'fixtures', 'eval-queries.json');
const OUT_JSON = path.join(ROOT, 'fixtures', 'eval-baseline.json');
const LIB_META = path.join(DATA, 'libraries', LIB_ID, 'meta.json');

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(LIB_META, 'utf8'));
const libRoot = process.env.EVAL_LIB_ROOT || meta.lib_root;
if (!libRoot || !fs.existsSync(libRoot)) {
  die('真实库根不可用：' + String(libRoot) + '（用 EVAL_LIB_ROOT 指定）');
}
const modelDir = path.join(
  ROOT,
  'model-cache',
  'onnx',
  'embeddinggemma-2',
  meta.model_revision,
  meta.model_weights_dtype || 'fp32',
);
if (!fs.existsSync(path.join(modelDir, 'onnx', 'model.onnx'))) {
  die('模型不可用：' + modelDir);
}

const evalDoc = JSON.parse(fs.readFileSync(EVAL_JSON, 'utf8'));
const entries = evalDoc.entries;
const truth = entries.filter((e) => !(e.expect && e.expect.none));
const noneEntries = entries.filter((e) => e.expect && e.expect.none);
console.log(
  '[eval] 评测集 ' +
    String(entries.length) +
    ' 条（真查询 ' +
    String(truth.length) +
    ' · 应无匹配 ' +
    String(noneEntries.length) +
    '）· 库根 ' +
    libRoot +
    ' · 模型 ' +
    meta.model_revision.slice(0, 8),
);

const TMP = path.join(DATA, '_eval-1', String(process.pid));
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function cropRect(w, h, c) {
  const width = Math.max(1, Math.round(w * c.w));
  const height = Math.max(1, Math.round(h * c.h));
  const left = Math.max(0, Math.min(w - width, Math.round(w * c.x)));
  const top = Math.max(0, Math.min(h - height, Math.round(h * c.y)));
  return { left, top, width, height };
}

/** 读原始像素（经应用唯一解码入口：BMP 会走纯 JS 回退） */
async function readRaw(absPath) {
  const { image, source } = await readImageAny(absPath);
  return { image, source };
}

/** 从任意已解码图取 9×8 灰度（用于 dHash 校准；与生产 nativeImage 的近似口径，见证据边界） */
async function gray9x8OfRaw(image) {
  const buf = await image.toSharp().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  return new Uint8Array(buf);
}

async function gray9x8OfFile(absPath) {
  const buf = await sharp(absPath).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  return new Uint8Array(buf);
}

// ────────────────────────────────────────────────────────── 1. 生成查询图（裁剪 / 合成）
const queryFiles = new Map(); // id -> abs path
const phashPairs = []; // {id, orig, crop}
for (const e of truth) {
  const srcAbs = path.join(libRoot, ...String(e.sourceRelPath).split('\\'));
  if (!fs.existsSync(srcAbs)) {
    console.log('[eval] 跳过：源图不存在 ' + e.id + ' ' + srcAbs);
    continue;
  }
  const { image } = await readRaw(srcAbs);
  const { width, height } = image;
  const rect = cropRect(width, height, e.crop);
  const out = path.join(TMP, e.id + '.png');
  await image.toSharp().extract(rect).png().toFile(out);
  queryFiles.set(e.id, out);
  const origHash = dHashHex(await gray9x8OfRaw(image));
  const cropHash = dHashHex(await gray9x8OfFile(out));
  phashPairs.push({ id: e.id, orig: origHash, crop: cropHash, hamming: hammingHex(origHash, cropHash) });
}

/** 合成「应无匹配」图（与 eval-dataset.mjs 的 NO_MATCH_KINDS 同名同参，可复现） */
function syntheticRaw(kind, size = 224) {
  const buf = Buffer.alloc(size * size * 3);
  const px = (x, y, r, g, b) => {
    const i = (y * size + x) * 3;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  };
  // 确定性伪随机（噪声图不能每次不同，否则基线不可复现）
  let seed = 123456789;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (kind === 'solid-gray') px(x, y, 128, 128, 128);
      else if (kind === 'solid-red') px(x, y, 255, 0, 0);
      else if (kind === 'checker') {
        const v = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 240 : 16;
        px(x, y, v, v, v);
      } else if (kind === 'gradient') {
        const v = Math.round((x / (size - 1)) * 255);
        px(x, y, v, 255 - v, Math.round((y / (size - 1)) * 255));
      } else if (kind === 'noise') {
        const v = Math.round(rnd() * 255);
        px(x, y, v, v, v);
      } else throw new Error('未知合成图：' + kind);
    }
  }
  return { buf, size };
}

for (const e of noneEntries) {
  const { buf, size } = syntheticRaw(e.synthetic);
  const out = path.join(TMP, e.id + '.png');
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toFile(out);
  queryFiles.set(e.id, out);
}

// ────────────────────────────────────────────────────────── 2. 真编码器 + 真引擎
const log = (...a) => console.log('[enc]', ...a);
const tLoad = Date.now();
const encoder = await createEncoder({ modelDir, device: 'cpu', seq: meta.seq_length || 140, log });
console.log('[eval] 编码器就绪（cpu）· ' + String(Date.now() - tLoad) + ' ms');

const engine = createEngine({
  // ⚠️ `libraries[].root` 必须给：LibraryRegistry 只收「有 root」的登记（没有 root 的条目会被直接跳过，
  //    然后 search 会如实报 INDEX_MISSING「没有可检索的库」）。这里给的是**旧布局索引目录**
  //    （index.bin / items.json / meta.json 所在处），不是素材根 —— 查询图走 queryImagePath，不需要素材根。
  config: {
    libraries: [{ libId: LIB_ID, root: path.join(DATA, 'libraries', LIB_ID) }],
    data_dir: DATA,
  },
  encoder: {
    encodeText: (t) => encoder.encodeText(t),
    encodeImage: (p) => encoder.encodeImage(p),
  },
  onEvent: () => {},
});

// ────────────────────────────────────────────────────────── 3. 逐条检索 → 排名
const rankings = [];
const perQuery = [];
const tAll = Date.now();
let done = 0;
for (const e of entries) {
  const q = queryFiles.get(e.id);
  if (!q) {
    // 源图缺失：用全零排名占位（评分会把它算 miss；并在 perQuery 里如实标注）
    rankings.push([]);
    perQuery.push({ id: e.id, skipped: 'source-missing' });
    continue;
  }
  const t0 = Date.now();
  const r = await engine.search({ mode: 'image', queryImagePath: q, topK: 10, libIds: [LIB_ID] });
  if (!r.ok) die('检索失败 ' + e.id + '：' + String(r.error && r.error.code) + ' ' + String(r.error && r.error.message));
  const rank = (r.data.results || []).map((x) => ({ uid: String(x.uid), score: Number(x.score) }));
  rankings.push(rank);
  perQuery.push({
    id: e.id,
    kind: e.kind,
    expect: e.expect,
    tookMs: Date.now() - t0,
    top10: rank,
  });
  done += 1;
  if (done % 10 === 0) console.log('[eval] ' + String(done) + '/' + String(entries.length) + ' 已完成');
}

const summary = scoreEval(rankings, entries);
const totalMs = Date.now() - tAll;

// ────────────────────────────────────────────────────────── 4. dHash 校准（供 PHASH-1b 定 k 的证据）
// ⚠️ 这里要**分开两种"同一画面"**，别混：
//   · 同图**缩放/重编码**（真正的近重复）⇒ dHash 应当几乎不变（e2e 已实测 64px vs 400px 汉明 ≤2）；
//   · 「中心裁剪 vs 原图」⇒ 构图已经变了，dHash 会大改 —— 它是**框选查询**，不是近重复。
//   PHASH-1b 的近重复通道要的是前者；本文件把两者都量出来，免得拿后者去定阈值。
const resizePairs = []; // 同一张原图 → 缩到 256px 后的哈希差（近重复口径）
for (const e of truth) {
  const srcAbs = path.join(libRoot, ...String(e.sourceRelPath).split('\\'));
  if (!fs.existsSync(srcAbs)) continue;
  const { image } = await readRaw(srcAbs);
  const origHash = dHashHex(await gray9x8OfRaw(image));
  const small = path.join(TMP, 'resize-' + e.id + '.png');
  await image
    .toSharp()
    .resize(256, 256, { fit: 'inside' })
    .png()
    .toFile(small);
  const smallHash = dHashHex(await gray9x8OfFile(small));
  resizePairs.push({ id: e.id, orig: origHash, resized: smallHash, hamming: hammingHex(origHash, smallHash) });
}

const hammings = phashPairs
  .map((p) => p.hamming)
  .filter((x) => typeof x === 'number')
  .sort((a, b) => a - b);
const resizeHammings = resizePairs
  .map((p) => p.hamming)
  .filter((x) => typeof x === 'number')
  .sort((a, b) => a - b);
function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}
// 「不同图」的对照：随机取 200 对不同的源图（固定种子 ⇒ 可复现）
const origHashes = phashPairs.map((p) => p.orig);
const differentPairs = [];
let s = 42;
for (let i = 0; i < 200 && origHashes.length > 1; i++) {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  const a = s % origHashes.length;
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  const b = s % origHashes.length;
  if (a === b) continue;
  differentPairs.push(hammingHex(origHashes[a], origHashes[b]));
}
const differentSorted = differentPairs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
const stat = (sorted) => ({
  n: sorted.length,
  min: sorted[0] ?? null,
  median: quantile(sorted, 0.5),
  p95: quantile(sorted, 0.95),
  max: sorted[sorted.length - 1] ?? null,
});
const sameResize = stat(resizeHammings);
const different = stat(differentSorted);
const phashCalibration = {
  note: 'dHash 口径 = 灰度 9×8 + 相邻比较（与 main/phash.ts 相同）；灰度由 sharp fill 近似（生产是 nativeImage quality:good）⇒ 阈值给量级，PHASH-1b 采信前须用生产解码复核',
  // 近重复口径：同一张图缩放到 256px 再算哈希
  nearDuplicateResize: sameResize,
  // 参考（**不是近重复**）：中心 60% 裁剪 vs 原图 —— 构图变了，汉明会大；别拿它定近重复阈值
  cropVsOriginal: stat(hammings),
  differentImages: different,
  // 建议阈值 k = 「近重复最差」与「异图最好」之间的空档中点；没有空档就如实给 null（不硬凑）
  suggestedK:
    resizeHammings.length && differentSorted.length && differentSorted[0] > resizeHammings[resizeHammings.length - 1]
      ? Math.round((differentSorted[0] + resizeHammings[resizeHammings.length - 1]) / 2)
      : null,
};

// ────────────────────────────────────────────────────────── 4b. 分数分布（供 NOMATCH-1 定阈值）
// 三条分布各自独立，不许混：
//   · correctTop1：正确件在结果里时它的分数（"有匹配"的分数带）；
//   · bestWrongTop1：每条查询里**非正确件**的最高分（"最近的错件"有多近 —— 决定阈值是否能分开）；
//   · syntheticTop1：合成图（应无匹配）的最高分（真实用户不会这样查，只作量级参考）。
const correctScores = [];
const bestWrongScores = [];
for (const q of perQuery) {
  if (!q.top10 || !q.expect || !Array.isArray(q.expect.uids)) continue;
  const want = new Set(q.expect.uids.map(String));
  const correct = q.top10.find((r) => want.has(r.uid));
  if (correct) correctScores.push(correct.score);
  const wrong = q.top10.filter((r) => !want.has(r.uid));
  if (wrong.length) bestWrongScores.push(Math.max(...wrong.map((r) => r.score)));
}
const syntheticTop1 = perQuery
  .filter((q) => q.expect && q.expect.none)
  .map((q) => (q.top10 && q.top10.length ? q.top10[0].score : 0));
const scoreDistributions = {
  correctTop1: stat(correctScores.slice().sort((a, b) => a - b)),
  bestWrongTop1: stat(bestWrongScores.slice().sort((a, b) => a - b)),
  syntheticTop1: stat(syntheticTop1.slice().sort((a, b) => a - b)),
  // 绝对分数阈值能否把「有匹配 / 无匹配」分开：空档 = 正确件最低分 − 错件最高分
  absoluteThresholdGap:
    correctScores.length && bestWrongScores.length
      ? Number((Math.min(...correctScores) - Math.max(...bestWrongScores)).toFixed(6))
      : null,
};

// ────────────────────────────────────────────────────────── 5. 落盘 + 打印摘要
const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  what: 'EVAL-1 真实召回基线（中心 60% 裁剪查询同图检索，topK=10；评分器 = tests/helpers/eval-dataset.mjs）',
  environment: {
    node: process.version,
    device: 'cpu',
    model: { repo: meta.model_repo, revision: meta.model_revision, dtype: meta.model_weights_dtype, seq: meta.seq_length },
    library: { libId: LIB_ID, root: libRoot, count: meta.count, index: path.join(DATA, 'libraries', LIB_ID, 'index.bin') },
  },
  dataset: {
    file: 'fixtures/eval-queries.json',
    entries: entries.length,
    truthQueries: truth.length,
    noMatchQueries: noneEntries.length,
  },
  summary,
  scoreDistributions,
  phashCalibration,
  timing: { totalMs, avgQueryMs: perQuery.filter((q) => typeof q.tookMs === 'number').reduce((a, q) => a + q.tookMs, 0) / Math.max(1, perQuery.filter((q) => typeof q.tookMs === 'number').length) },
  perQuery,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log('\n===== EVAL-1 基线摘要 =====');
console.log(
  'n=' + String(summary.n) +
    ' · top1=' + String(summary.top1) +
    ' · top5=' + String(summary.top5) +
    ' · top10=' + String(summary.top10),
);
console.log(
  '分离度：mean=' + String(summary.separation.mean) +
    ' · median=' + String(summary.separation.median) +
    ' · min=' + String(summary.separation.min) +
    ' · 负数=' + String(summary.separation.negatives),
);
console.log('无匹配：n=' + String(summary.noMatch.n) + ' · maxScoreMean=' + String(summary.noMatch.maxScoreMean));
console.log(
  '分数分布（有匹配 correct / 错件最高 bestWrong / 合成无匹配）：' +
    JSON.stringify(scoreDistributions) +
    ' · 绝对阈值空档=' +
    String(scoreDistributions.absoluteThresholdGap),
);
console.log(
  'dHash 校准：近重复缩放 ' +
    JSON.stringify(phashCalibration.nearDuplicateResize) +
    ' · 异图 ' +
    JSON.stringify(phashCalibration.differentImages) +
    ' · （参考）裁剪vs原图 ' +
    JSON.stringify(phashCalibration.cropVsOriginal) +
    ' · suggestedK=' +
    String(phashCalibration.suggestedK),
);
console.log('耗时：' + String(totalMs) + ' ms（平均每查询 ' + String(Math.round(out.timing.avgQueryMs)) + ' ms）');
console.log('已写：' + path.relative(ROOT, OUT_JSON));

fs.rmSync(TMP, { recursive: true, force: true });

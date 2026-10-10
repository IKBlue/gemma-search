// verify_encoder_path.mjs —— 产品编码路径的一致性验收（**不需要 Electron**）
//
// 为什么需要：
//   P1.5 的"Electron 内能不能起 WebGPU"我在受限沙箱里无法验证（多进程管道被禁），
//   但**更能致命**的那类问题可以在这里查出来：
//     · `src/main/encoder.mjs` 的模块图里，重采样兼容层是否真的生效？
//       （仓里有两份 @huggingface/transformers，同版本不同类对象 —— 补错 prototype 是**静默**失效）
//     · 用应用编码器编一张库内图，是否与索引里**同一张**的行向量一致？
//       （索引↔查询必须同一套预处理，否则结果变差且不报错）
//     · 文本塔是否可用、BMP 回退是否仍工作？
//
// 这些断言全过 ≠ 应用能跑，但把"打包后才发现向量对不上"这类最贵的返工前置掉了。
//
// 用法:
//   node verify_encoder_path.mjs --model <ONNX 模型目录> [--index data/idx-full-v2]
//        [--device webgpu] [--text "北欧吊灯"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 项目根：向上找到含 core/engine.mjs 的那一级（搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'core', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 core/engine.mjs）');
    p = up;
  }
})();

const MODEL = arg('model', process.env.GEMMA_ONNX_MODEL || '');
const INDEX_DIR = path.resolve(ROOT, arg('index', 'data/idx-full-v2'));
const DEVICE = arg('device', 'webgpu');
const TEXT = arg('text', '北欧吊灯');
const LIB = arg('lib', 'G:\\model');

if (!MODEL || !fs.existsSync(MODEL)) {
  console.error('用法: node verify_encoder_path.mjs --model <ONNX 模型目录> [--index data/idx-full-v2]');
  process.exit(2);
}

const problems = [];
const ok = (cond, label, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) problems.push(`${label} ${detail}`);
};

console.log('='.repeat(96));
console.log('产品编码路径一致性验收（不经 Electron）');
console.log('  模型  :', MODEL);
console.log('  索引  :', INDEX_DIR);
console.log('  设备  :', DEVICE);

// ---------- 1) 导入产品模块（这会把整条模块图拉起来，含 resize_compat） ----------
const enc = await import(path.join(ROOT, 'src', 'main', 'encoder.mjs'));
const { createEncoder, QUERY_PREFIX } = enc;
console.log();
console.log('--- 1) 编码器初始化 ---');

// 模块图里 RawImage 必须是**同一个类**且已被 shim 替换 —— encoder.mjs 内部会断言，
// 这里再独立核一次，确认断言真的跑了（不是被 try/catch 吞掉）。
const { resizeCompatState } = await import(path.join(ROOT, 'onnx-spike', 'resize_compat.mjs'));

let encoder = null;
try {
  encoder = await createEncoder({ modelDir: MODEL, seq: 140, device: DEVICE, log: (m) => console.log('    [enc] ' + m) });
} catch (e) {
  ok(false, 'createEncoder', e.message);
  console.log('\n结论：FAIL（编码器起不来，后面的检查无法进行）');
  process.exit(1);
}
ok(!!encoder, 'createEncoder 成功', `device=${encoder.device} loadMs=${encoder.loadMs}`);

const st = resizeCompatState();
ok(!!st && st.installed, 'resize_compat 已安装', st ? `kernel=${st.kernel} rawImage=${st.installed_di_name}` : '(none)');

// ---------- 2) 索引里挑一张图（优先挑大的：大图才会走降采样，也就是这次修的那条路径） ----------
console.log();
console.log('--- 2) 索引↔查询一致性 ---');
const indexBin = path.join(INDEX_DIR, 'index.bin');
const itemsJson = path.join(INDEX_DIR, 'items.json');
if (!fs.existsSync(indexBin)) {
  ok(false, '索引存在', indexBin);
  console.log('\n结论：FAIL');
  process.exit(1);
}
const { readIndexBin, readItems } = await import(path.join(ROOT, 'core', 'index.mjs'));
// 注意：core/index.mjs 的读取函数**抛的是错误信封**（fail/corrupt），不是普通 Error ——
// 所以这里必须接住并自己报清楚，否则会以未捕获异常的方式炸掉。
let header, vectors, items;
try {
  ({ header, vectors } = readIndexBin(indexBin));
  items = readItems(itemsJson);
} catch (e) {
  ok(false, '索引可读（MAGIC/footer/sha1 全过）', e && e.error ? e.error.message : String(e));
  console.log('\n结论：FAIL（索引读不了，后面的检查无法进行）');
  process.exit(1);
}
console.log(`  索引 ${header.count} 条 · dim ${header.dim} · compat ${header.compat}`);

const byRel = new Map(items.map((i) => [i.relPath || i.rel_path, i]));
const dim = header.dim;
const rowOf = (u) => vectors.subarray(u * dim, u * dim + dim);
const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

// 找最大的那张（按 imageSize 排序取最大）+ 一张 BMP 回退的
const sorted = [...items].sort((a, b) => (b.imageSize || 0) - (a.imageSize || 0));
const big = sorted[0];
const bmp = items.find((i) => (i.vectorSource || 'native') !== 'native');

const targets = [
  { label: '最大的一张（走降采样）', it: big },
  ...(bmp ? [{ label: 'BMP 回退的一张（走回退解码）', it: bmp }] : []),
];

for (const t of targets) {
  const abs = path.join(LIB, t.it.relPath);
  if (!fs.existsSync(abs)) { console.log(`  (跳过 ${t.it.relPath}：磁盘上不存在)`); continue; }
  const v = await encoder.encodeImage(abs);
  const c = cos(v, rowOf(t.it.vectorRow));
  ok(c >= 0.999, `encodeImage ↔ 索引行  ${t.it.relPath}`,
     `cos=${c.toFixed(6)}  size=${t.it.imageSize}B src=${t.it.vectorSource || 'native'}`);
}

// ---------- 3) 文本塔 + 检索 ----------
console.log();
console.log('--- 3) 文本编码 ---');
const tv = await encoder.encodeText(TEXT);
let norm = 0; for (let i = 0; i < tv.length; i++) norm += tv[i] * tv[i];
ok(Math.abs(Math.sqrt(norm) - 1) < 1e-3, '文本向量已 L2 归一', `‖v‖=${Math.sqrt(norm).toFixed(6)}`);
ok(tv.length === dim, '文本向量维度 == 索引维度', `${tv.length} vs ${dim}`);

// 用它跑一次最简单的检索（JS 侧，与引擎同算法：点积排序）
const scores = [];
for (const it of items) scores.push([cos(tv, rowOf(it.vectorRow)), it.relPath]);
scores.sort((a, b) => b[0] - a[0]);
console.log(`  查询「${TEXT}」Top-5：`);
for (const [s, r] of scores.slice(0, 5)) console.log(`    ${s.toFixed(4)}  ${r}`);
ok(scores[0][0] > scores[10][0], '分数确实有区分度（Top-1 > 第 11 名）',
   `${scores[0][0].toFixed(4)} vs ${scores[10][0].toFixed(4)}`);

// ---------- 4) 结论 ----------
console.log();
console.log('结论：' + (problems.length ? 'FAIL' : 'PASS（产品编码路径在这台机器上自洽）'));
for (const p of problems) console.log('  ✗ ' + p);
if (!problems.length) {
  console.log('  注：这**不**证明 Electron 内可跑（渲染进程 / asar / GPU 设备仍待 P1.5 实机验证）。');
}
process.exit(problems.length ? 1 : 0);

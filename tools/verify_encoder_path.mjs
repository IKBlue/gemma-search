// verify_encoder_path.mjs —— 产品编码路径的一致性验收（**不需要 Electron**）
//
// 为什么需要：
//   P1.5 的"Electron 内能不能起 WebGPU"我在受限沙箱里无法验证（多进程管道被禁），
//   但**更能致命**的那类问题可以在这里查出来：
//     · `apps/desktop/src/main/encoder.mjs` 的模块图里，重采样兼容层是否真的生效？
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
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 项目根：向上找到含 packages/engine/src/engine.ts 的那一级（搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 packages/engine/src/engine.ts）');
    p = up;
  }
})();

const MODEL = arg('model', process.env.GEMMA_ONNX_MODEL || '');
const INDEX_DIR = path.resolve(ROOT, arg('index', 'data/idx-full-v2'));
const DEVICE = arg('device', 'webgpu');
const TEXT = arg('text', '北欧吊灯');
const LIB = arg('lib', process.env.GEMMA_LIB_ROOT || '');

if (!MODEL || !fs.existsSync(MODEL)) {
  console.error('用法: node tools/verify_encoder_path.mjs --model <ONNX 模型目录> --lib <素材库根> [--index data/idx-full-v2]');
  console.error('  或: 设 GEMMA_ONNX_MODEL / GEMMA_LIB_ROOT 后再跑');
  console.error(MODEL ? `模型目录不存在：${MODEL}`
                      : '必须显式给出 ONNX 模型目录（不给默认值 —— 猜一个会静默核对到别的目录）。');
  process.exit(2);
}
// 素材库根：与上面的 --model **同构** —— 命令行 > 环境变量 > 明确报错，**不给默认值**。
// 原先这里写死了一个本机绝对路径：用户忘了给 --lib 时它会**静默**拿那个路径去拼索引里的
// relPath 核对文件 —— 核对的是别的目录，却报"通过"。见 TODO.md C-12
//「不把本机绝对路径写进代码」。同类做法见 tools/check_search.mjs 的 --lib。
if (!LIB || !fs.existsSync(LIB)) {
  console.error('用法: node tools/verify_encoder_path.mjs --model <ONNX 模型目录> --lib <素材库根> [--index data/idx-full-v2]');
  console.error('  或: $env:GEMMA_LIB_ROOT="<素材库根>"; node tools/verify_encoder_path.mjs --model <模型目录>');
  console.error(LIB ? `素材库根不存在：${LIB}`
                    : '必须显式给出素材库根 —— 本检查会用它核对索引里的相对路径是否真的落在磁盘上，猜一个会静默核对到别的目录。');
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
console.log('  素材库:', LIB);
console.log('  设备  :', DEVICE);

// ---------- 1) 导入产品模块（这会把整条模块图拉起来，含 resize_compat） ----------
// ⚠️ 动态 import 必须用 `pathToFileURL(...).href`，**不能**直接喂绝对路径：
//    Windows 上 `import('D:\\...\\x.mjs')` 会被当成 URL 解析并以
//    `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'` 崩掉（实测）。
//    本文件下面三处（encoder / resize_compat / index）都遵守这一条 —— 别"简化"回去。
const enc = await import(pathToFileURL(path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'encoder.ts')).href);
const { createEncoder, QUERY_PREFIX } = enc;
console.log();
console.log('--- 1) 编码器初始化 ---');

// 模块图里 RawImage 必须是**同一个类**且已被 shim 替换 —— encoder.ts 内部会断言，
// 这里再独立核一次，确认断言真的跑了（不是被 try/catch 吞掉）。
const { resizeCompatState } = await import(pathToFileURL(path.join(ROOT, 'packages', 'indexer', 'src', 'resize_compat.ts')).href);

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
const { readIndexBin, readItems } = await import(pathToFileURL(path.join(ROOT, 'packages', 'engine', 'src', 'index.ts')).href);
// 注意：packages/engine/src/index.ts 的读取函数**抛的是错误信封**（fail/corrupt），不是普通 Error ——
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
  // `big` 在空索引下是 undefined —— 必须过滤掉，否则下面 `t.it.relPath` 会抛（那等于没有判定）
  ...(big ? [{ label: '最大的一张（走降采样）', it: big }] : []),
  ...(bmp ? [{ label: 'BMP 回退的一张（走回退解码）', it: bmp }] : []),
];

// 参与比对的目标数：**全部被跳过 = 一个字都没验**，那时不得 PASS（见第 4 节结论）。
let attempted = 0;
const skippedTargets = [];

for (const t of targets) {
  const abs = path.join(LIB, t.it.relPath);
  if (!fs.existsSync(abs)) {
    skippedTargets.push({ relPath: t.it.relPath, abs });
    console.log(`  (跳过 ${t.it.relPath}：磁盘上不存在)`);
    continue;
  }
  attempted++;
  let v;
  try {
    v = await encoder.encodeImage(abs);
  } catch (e) {
    // 单个目标编不出来，不该让整个守卫崩在 Node 栈里 —— 崩掉等于**没有判定**，
    // 而守卫的职责就是给判定（AGENTS §5.2）。记入 problems，走正常的 FAIL/exit 1。
    ok(false, `encodeImage 抛错  ${t.it.relPath}`, e && e.message ? e.message : String(e));
    continue;
  }
  const c = cos(v, rowOf(t.it.vectorRow));
  ok(c >= 0.999, `encodeImage ↔ 索引行  ${t.it.relPath}`,
     `cos=${c.toFixed(6)}  size=${t.it.imageSize}B src=${t.it.vectorSource || 'native'}`);
}

// ---------- 2b) BMP 回退回归断言 ----------
//
// 为什么单列一条：库里实测有 20 张「文件名 `.jpg`、内容其实是 BMP」（AGENTS §7）。
// 应用侧 `apps/desktop/src/main/encoder.ts` 的 BMP 回退曾把 **Buffer** 传给
// `readBmpAsRawImage(filePath)`（该 API 内部自己 `fs.readFileSync(path)`），于是这条路径
// **每次都抛** `ERR_INVALID_ARG_VALUE` —— 而单测与其它守卫都不覆盖它，所以一直没人发现。
// 这里拿 data/quality 的**实测清单**真正走一次回退，并断言两件事：
//   ① `source === 'bmp-fallback'` —— 真的走了回退（不是原生读恰好成功了）
//   ② 向量维度 === 索引维度 —— 不是"不抛错就算过"
// 清单文件或对应素材不在本机时：**明确打印「跳过 BMP 回退断言：缺 X」**，
// 既不静默跳过也不判失败（与 check_search 的判定原则一致）。
console.log();
console.log('--- 2b) BMP 回退断言（名为 .jpg 实为 BMP）---');
const BMP_MANIFEST = path.join(ROOT, 'data', 'quality', 'mismatch-test-result.json');
if (!fs.existsSync(BMP_MANIFEST)) {
  console.log(`  跳过 BMP 回退断言：缺清单文件 ${BMP_MANIFEST}`);
} else {
  let bmpCandidates = [];
  try {
    const man = JSON.parse(fs.readFileSync(BMP_MANIFEST, 'utf8'));
    bmpCandidates = ((man.details && man.details.fallback) || [])
      .map((d) => d.rel_path || d.relPath)
      .filter(Boolean);
  } catch (e) {
    console.log(`  跳过 BMP 回退断言：清单读不了（${e && e.message ? e.message : e}）`);
  }
  if (bmpCandidates.length === 0) {
    console.log('  跳过 BMP 回退断言：清单里没有 fallback 条目');
  } else {
    const bmpRel = bmpCandidates.find((r) => fs.existsSync(path.join(LIB, r)));
    if (!bmpRel) {
      console.log(`  跳过 BMP 回退断言：清单里 ${bmpCandidates.length} 个候选在库根 ${LIB} 下都不存在`);
    } else {
      const bmpAbs = path.join(LIB, bmpRel);
      let bv = null;
      try {
        bv = await encoder.encodeImage(bmpAbs);
      } catch (e) {
        ok(false, `BMP 回退编码不抛错  ${bmpRel}`, e && e.message ? e.message : String(e));
      }
      if (bv) {
        ok(bv.__source === 'bmp-fallback', `真的走了 BMP 回退（source=bmp-fallback）  ${bmpRel}`,
           `source=${bv.__source}`);
        ok(bv.length === dim, `BMP 回退向量维度 == 索引维度  ${bmpRel}`, `${bv.length} vs ${dim}`);
      }
    }
  }
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
// 需要至少 11 条才能比"第 11 名"；条目不足时**跳过该断言并打印原因**（不静默、也不判失败）
if (scores.length > 10) {
  ok(scores[0][0] > scores[10][0], '分数确实有区分度（Top-1 > 第 11 名）',
     `${scores[0][0].toFixed(4)} vs ${scores[10][0].toFixed(4)}`);
} else {
  console.log(`  跳过分数区分度断言：索引只有 ${scores.length} 条（需 > 10 条才能比第 11 名）`);
}

// ---------- 4) 结论 ----------
console.log();

// 「目标全被跳过」⇒ 本检查**没有任何一个目标落到真实文件上**，一个字都没验 → 不得 PASS。
// 这与 check_search 那条规则方向相反、道理相同：那边是"没条件验"→ 不判失败（跳过，exit 0）；
// 这边是"本该验却一个都没验到"→ 不判通过（exit 1）。见 AGENTS §6「不得声称未验证的能力」。
// ⚠️ 只有**全部**跳过才算"什么都没验"；跳过一部分是正常的（库里可能有跨盘/链接等），
//    那种情况仍按原语义走下面的 problems 判定。
if (attempted === 0) {
  console.log('结论：FAIL —— 本次**没有验证任何目标的磁盘存在性**。');
  console.log(`  库根 : ${LIB}`);
  if (targets.length === 0) {
    console.log('  索引里没有可比对的目标（候选 0 个 —— items 为空）。');
  } else {
    console.log(`  候选 ${targets.length} 个，全部被跳过：`);
    for (const s of skippedTargets) {
      console.log(`    · ${s.relPath}  →  磁盘上不存在（期望位置 ${s.abs}）`);
    }
  }
  console.log('  含义：--lib 指错了库，或索引已失效（素材库被移动过 —— 索引里存的是绝对路径）。');
  console.log('  说明：跳过一部分属正常；**全部**跳过说明这条检查没有落到任何真实文件上，故不判 PASS。');
  process.exit(1);
}

console.log('结论：' + (problems.length ? 'FAIL' : 'PASS（产品编码路径在这台机器上自洽）'));
for (const p of problems) console.log('  ✗ ' + p);
if (!problems.length) {
  console.log('  注：这**不**证明 Electron 内可跑（渲染进程 / asar / GPU 设备仍待 P1.5 实机验证）。');
}
process.exit(problems.length ? 1 : 0);

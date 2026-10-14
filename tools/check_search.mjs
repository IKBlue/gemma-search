// tools/check_search.mjs —— 端到端检索自查：注册好的索引 + 真实查询向量 → 引擎 search 是否出结果
//
// 用「向量模式」搜（向量由 packages/indexer/src/encode_queries.mjs 真跑模型算出），
// 这样不需要在 Node 里再起一次 WebGPU 编码器，但仍然走的是**引擎的真实检索路径**。
//
// 用法：
//   node tools/check_search.mjs --lib <素材库根> [向量文件]
//   或先设 GEMMA_LIB_ROOT=<素材库根>，再 node tools/check_search.mjs
//
// 退出码：0 = 检索路径打通；1 = 检索失败或无结果；2 = 参数缺失 / 路径不存在
//
// 为什么库根**必须显式给**、且没有默认值：本检查会把索引里的 relPath 拼到库根上，
// 核对"第一条的图在磁盘上真的存在"。写死一个库根（例如某台机器的路径）会**静默**
// 核对到别的目录 —— 检查"通过"了，它核对的却不是你的库。见 TODO.md C-12
//「不把本机绝对路径写进代码」。同类做法见 tools/verify_encoder_path.mjs 的 --model。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../packages/engine/src/engine.ts';

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

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/** 位置参数（跳过 `--lib <值>` 这一对，否则它的值会被误当成向量文件） */
const positionals = (() => {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lib') { i++; continue; }
    if (argv[i].startsWith('--')) continue;
    out.push(argv[i]);
  }
  return out;
})();

// 数据目录：相对**仓库根**，与 CWD 无关（否则从别处调用会静默读错 data/）
const DATA_DIR = path.join(ROOT, 'data');

// 库根：命令行 > 环境变量 > 明确报错。**不给默认值**（理由见文件头）
const LIB_ROOT = arg('lib', process.env.GEMMA_LIB_ROOT || '');
if (!LIB_ROOT) {
  console.error('用法: node tools/check_search.mjs --lib <素材库根> [向量文件]');
  console.error('  或: $env:GEMMA_LIB_ROOT="<素材库根>"; node tools/check_search.mjs');
  console.error('必须显式给出素材库根 —— 本检查会用它核对索引里的相对路径是否真的落在磁盘上，');
  console.error('猜一个库根会静默核对到别的目录。');
  process.exit(2);
}
// 给了但**不存在**的库根：不按参数错退出。库根在不在由引擎的 `rootExists` 如实报告，
// 文末的「磁盘存在性断言」会因此跳过并保持 exit 0 —— 见 AGENTS §5.2：守卫只对自己
// 真正验证过的事情给判定，不把自己的前置条件不满足判成失败。这里只提醒一句。
if (!fs.existsSync(LIB_ROOT)) {
  console.warn(`[warn] 素材库根不存在：${LIB_ROOT}（文末的磁盘存在性断言将被跳过）`);
}

// 向量文件：位置参数 > data/diag/_q1vec.json；相对路径按**仓库根**解，不按 CWD
const vecFile = positionals[0]
  ? path.resolve(ROOT, positionals[0])
  : path.join(DATA_DIR, 'diag', '_q1vec.json');
if (!fs.existsSync(vecFile)) {
  console.error(`查询向量文件不存在：${vecFile}`);
  console.error('用法: node tools/check_search.mjs --lib <素材库根> [向量文件]');
  console.error('（向量文件由 packages/indexer/src/encode_queries.mjs 生成，默认 data/diag/_q1vec.json）');
  process.exit(2);
}
const query = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
const q = query.queries[0];
if (!q) {
  console.error(`向量文件里没有 queries[0]：${vecFile}`);
  process.exit(2);
}
// 以**实际向量长度**为准：文件里声明的 dim 可能与数组长度不符，而发给引擎的是数组本身
const qDim = Array.isArray(q.vector) ? q.vector.length : 0;

const engine = createEngine({
  config: {
    libraries: [{ libId: 'L1', root: LIB_ROOT, label: '主库' }],
    data_dir: DATA_DIR,
    collect: { dirs: {} },
  },
  encoder: {
    async encodeText() { throw new Error('本检查用向量模式，不需要文本编码器'); },
    async encodeImage() { throw new Error('本检查用向量模式，不需要图像编码器'); },
  },
  onEvent: () => {},
});

console.log('='.repeat(90));
console.log(`  项目根   : ${ROOT}`);
console.log(`  数据目录 : ${DATA_DIR}`);
console.log(`  素材库根 : ${LIB_ROOT}`);
console.log(`  向量文件 : ${vecFile}`);
console.log(`端到端检索检查 · 查询「${q.value}」· dim=${qDim}`);

const st = await engine.indexStatus({});
console.log('indexStatus →', st.ok ? JSON.stringify(st.data.libs[0]) : JSON.stringify(st.error));

// 前置条件（**必须放在检索之前**）：库根不存在时引擎会直接以 INDEX_MISSING 拒绝检索 ——
// 那不是"检索坏了"，而是本检查没条件跑，必须**跳过**而不是判失败（见文末判定的说明）。
const lib = (st.ok && st.data && st.data.libs && st.data.libs[0]) || null;
const libRootExists = !!(lib && lib.rootExists);
const indexed = (lib && Number(lib.indexed)) || 0;
const dimMatches = !!(lib && qDim > 0 && Number(lib.dim) === qDim);

if (!libRootExists || indexed <= 0) {
  console.log('');
  console.log('跳过：前置条件不满足 ——');
  if (!libRootExists) console.log(`  · 库根不存在（indexStatus rootExists=false）：${LIB_ROOT}`);
  if (indexed <= 0) console.log('  · 该库索引为空（indexed=0），没有条目可检索');
  console.log('（没条件验证的事情不判失败；本次**不声称**"检索路径打通"。）');
  process.exit(0);
}

const r = await engine.search({ mode: 'vector', vector: q.vector, topK: 5 });
if (!r.ok) {
  console.log('search 失败 →', JSON.stringify(r.error));
  process.exit(1);
}
console.log(`\nsearch → ${r.data.results.length} 条 · ${r.data.tookMs} ms`);
for (const [i, it] of r.data.results.entries()) {
  console.log(`  ${i + 1}. ${Number(it.score).toFixed(4)}  ${(it.folder ?? '—').padEnd(6)} ${it.relPath ?? it.stem}` +
    `  ${it.archive ? '包=' + it.archive.ext : '无包'}`);
}
const first = r.data.results[0];
if (!first) { console.log('!! 没有任何结果'); process.exit(1); }

// ---------------------------------------------------------------- 判定
//
// 「第一条命中的图真的落在库根下」是本检查唯一能证明端到端（引擎 → 索引 → 素材）的一步。
// 前置条件「库根在 · 索引非空」已在检索**之前**验过（否则引擎会以 INDEX_MISSING 直接拒绝
// 检索 —— 那是没条件跑，不是检索坏了）。这里只剩最后一条：查询向量必须与索引**同维**，
// 否则分数是 NaN、排序无意义，"第一条"根本不是第一条 —— 那时跳过并保持 exit 0。
// 条件都成立却"图不在磁盘上"才是**真失败**：--lib 指错了库，或索引已失效（库被移动过）。
// 那时必须 exit 1，并指明是哪条 relPath、期望落在哪个库根下。
const firstRel = first.relPath || first.rel_path || '';
const firstAbs = firstRel ? path.join(LIB_ROOT, firstRel) : '';
const firstOnDisk = !!firstAbs && fs.existsSync(firstAbs);

console.log('');
if (!dimMatches) {
  console.log('跳过磁盘存在性断言：前置条件不满足 ——');
  console.log(`  · 查询向量长度 ${qDim} 与索引维度 ${lib.dim} 不一致 —— 分数无意义，第一名不可信`);
  console.log('（没条件验证的事情不判失败；本次**不声称**"第一条的图在磁盘上存在"。）');
  process.exit(0);
}
if (firstOnDisk) {
  console.log(`可核对：第一条的图在磁盘上存在 = true  ${firstRel}`);
  console.log('检索路径打通（引擎 → 索引 → 素材）。');
  process.exit(0);
}
console.log('!! 磁盘存在性断言失败');
console.log(`   前置条件都成立（库根存在 · indexed=${indexed} · dim=${qDim}），但第一条命中的图不在库根下：`);
console.log(`     relPath  : ${firstRel}`);
console.log(`     期望位置 : ${firstAbs}`);
console.log(`     库根     : ${LIB_ROOT}`);
console.log('   含义：--lib 指错了库，或索引已失效（素材库被移动过 —— 索引里存的是绝对路径，见 AGENTS §7）。');
process.exit(1);

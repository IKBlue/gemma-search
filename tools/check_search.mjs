// _search_check.mjs —— 一次性端到端检查：注册好的索引 + 真实查询向量 → 引擎 search 是否出结果
//
// 用「向量模式」搜（向量由 onnx-spike/encode_queries.mjs 真跑模型算出），
// 这样不需要在 Node 里再起一次 WebGPU 编码器，但仍然走的是**引擎的真实检索路径**。
import fs from 'node:fs';
import path from 'node:path';
import { createEngine } from './core/engine.mjs';

const DATA_DIR = path.resolve('data');
const LIB_ROOT = 'G:\\model';
const vecFile = process.argv[2] || 'data/diag/_q1vec.json';
const query = JSON.parse(fs.readFileSync(vecFile, 'utf8'));
const q = query.queries[0];

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
console.log(`端到端检索检查 · 查询「${q.value}」· dim=${q.dim}`);

const st = await engine.indexStatus({});
console.log('indexStatus →', st.ok ? JSON.stringify(st.data.libs[0]) : JSON.stringify(st.error));

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
console.log(`\n可核对：第一条的图在磁盘上存在 = ${fs.existsSync(path.join(LIB_ROOT, first.relPath))}`);
console.log('检索路径打通（引擎 → 索引 → 素材）。');

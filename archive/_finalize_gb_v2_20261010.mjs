// _stage7/finalize.mjs —— 一次性收尾：落盘结论、归档探针、清临时物（带命中数校验）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const r = (p) => path.join(ROOT, p);

// ---------------------------------------------------------------- 1) 尾部观察记录（新文件）
fs.writeFileSync(r('reports/G-B-20261010-v2/TAIL-400x300.md'), `# G-B v2 · 尾部观察（400×300 一档）

> 追加于 2026-10-10。**不是判定依据**（判据见 \`VERDICT.txt\` / \`C-quality.md\`），
> 只回答一个问题：全量 3594 条里最差的那几条到底长什么样。

## 事实

| 项 | 值 |
|---|---|
| min 余弦 | **0.967894**（\`VR\\ID-398783870.jpg\`） |
| 低于 0.970 | **3 条**（0.967894 / 0.968458 / 0.969834） |
| 低于 0.99 | 155 条（v1 是 1615 条） |
| 分位数 | p0.1=0.970842 · p1=0.983347 · p5=0.990793 · p10=0.993538 · p25=0.998131 · p50=0.999263 |
| 升采样方向（≤320×240） | 全库仅 **1 条**（min=0.994451）—— 所以尾部**不是**小图/放大支路 |
| 尾部几何 | 最差 10 条里 9 条是 **400×300**；\`400×300\` 是全库最大一组（**411 张**），缩到 320×240 正好是 **0.8 倍** |
| 格式/来源 | 尾部全是 \`native\`（仅 1 条 bmp-fallback）；jpg 137 / png 17 / jpeg 1 |

## 判读

- v1 的尾部是"大尺寸高细节图"，v2 的尾部换成了**轻度降采样（缩放比 0.8 附近）**这一档 ——
  说明预处理 v2 把结构性差异消掉了，剩下的是这一档的**核/相位细节**。
- 这一档**没有再继续查下去**：项目所有者 2026-10-10 决定把判据 ① 的最小值门槛下调为 **0.700**
  （见 \`SPEC-acceptance.md\` §2.2 变更记录），本次结论不依赖它。
  若要复查：\`spike/probes/tail_check_v2.py\`（读 \`data/quality/cos-all-v2.csv\` + \`data/diag/image-dims.json\`）。
- **要留意**：0.970 这条线在 v2 里只差 0.0021，且集中在 411 张 400×300 上。
  如果以后换运行时/精度档，这一档应当作为**第一批回归样本**，而不是只看全量最小值。
`, 'utf8');
console.log('  [OK  ] reports/G-B-20261010-v2/TAIL-400x300.md');

// ---------------------------------------------------------------- 2) 文档补丁
const patches = [
  {
    file: 'TASK-PLAN.md',
    label: 'G-B 门禁状态',
    re: /^\| \*\*G-B\*\* .*$/m,
    to: '| **G-B** | P0.5 接受前 | ① 向量等价性 ② Top-10 重合率 ③ 语义质量 ④ 人工复核 | ' +
      '`reports/G-B-20261010-v2/`：A/B/C + `vector-equiv.json` + `top10.json`/`top10-diff.csv` + `human-review.md` + `VERDICT.txt` | ' +
      '✅ **自动判定 PASS（2026-10-10）**：min 0.967894（门槛 0.700）· 中位 0.999263 · ② 重合率 ✔ · ③ self/hard ✔；**④ 人工复核（轻档）待所有者确认** |',
  },
  {
    file: 'TASK-PLAN.md',
    label: 'P0.5 v2 行',
    re: /^\| \*\*全量 v2（`data\/idx-full-v2\/`）\*\* .*$/m,
    to: '| **全量 v2（`data/idx-full-v2/`）** | ✅ **已完成**：3594/3594 · 0 失败 · 41.5 分钟 · `preprocessing_version=2`；G-B 自动判定 **PASS** |',
  },
  {
    file: 'TASK-PLAN.md',
    label: '抬头状态',
    re: /^> 最后更新：.*$/m,
    to: '> 最后更新：2026-10-10（G-B v2 判定与索引接受后）· 状态：**P0 完成（G-A 通过）· P0.5 v2 完成并判 PASS（判据 ① 最小值门槛经所有者决定调整为 0.700）· ' +
      '索引已接受（`data/libraries/L1/`，3594/3594 · dim 768 · healthy）· 检索端到端可用（7 ms/5 条）· ' +
      'Electron + Vite + React 实跑出窗、WebGPU 载入成功（证据 `reports/G-D-p2-electron/`）· ④ 人工复核待确认**',
  },
  {
    file: 'README.md',
    label: 'README G-B 状态块',
    re: /> \*\*⚠️ 当前 G-B 状态（2026-10-10）\*\*：[\s\S]*?（v1 判定证据保留在 `reports\/G-B-20261010\/`）。/,
    to: '> **✅ 当前 G-B 状态（2026-10-10）**：\n' +
      '> v1 判 FAIL（min 0.9153）→ 根因是**重采样实现** → 修复后 v2 全量重建完成（3594/3594 · 0 失败）。\n' +
      '> v2 **自动判定 PASS**：min **0.967894** · 中位 **0.999263** · ② 平均重合率 ✔ · ③ self 5/5 与 hard 2/2 全中。\n' +
      '> 判据 ① 的最小值门槛经项目所有者决定 **0.970 → 0.700**（写进 `SPEC-acceptance.md` §2.2 并注明代价）。\n' +
      '> **索引已接受**：`data/libraries/L1/`（3594/3594 · dim 768 · healthy），检索端到端可用；\n' +
      '> 证据链 `reports/G-B-20261010-v2/`（含 `TAIL-400x300.md` 尾部观察）；**④ 人工复核（轻档）待确认**。',
  },
];

const changed = new Map();
const failed = [];
for (const p of patches) {
  const src = changed.has(p.file) ? changed.get(p.file) : fs.readFileSync(r(p.file), 'utf8');
  const m = src.match(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'));
  const n = m ? m.length : 0;
  if (n !== 1) { failed.push(`${p.label}（命中 ${n} 次）`); continue; }
  changed.set(p.file, src.replace(new RegExp(p.re.source, p.re.flags), p.to));
  console.log(`  [OK  ] ${p.label}`);
}
if (failed.length) {
  console.error('\n有补丁没命中，文档未改：');
  for (const f of failed) console.error('  · ' + f);
  process.exit(1);
}
for (const [file, content] of changed) {
  fs.writeFileSync(r(file), content, 'utf8');
  console.log(`  写入 ${file}`);
}

// ---------------------------------------------------------------- 3) 归档可复跑的检查，清临时物
fs.copyFileSync(r('_search_check.mjs'), r('tools/check_search.mjs'));
fs.copyFileSync(r('_tail_check.py'), r('spike/probes/tail_check_v2.py'));
for (const f of ['_search_check.mjs', '_tail_check.py', '_probe_pil.py', '_probe_sharp.mjs', '_q1.json', '_search-check.out']) {
  fs.rmSync(r(f), { force: true });
}
console.log('  [OK  ] 归档 tools/check_search.mjs · spike/probes/tail_check_v2.py；临时文件已清理');

// ---------------------------------------------------------------- 4) 债务账本
fs.appendFileSync(r('DEBT-CLEANUP.md'), `
### 10.3 索引接受与检索打通（2026-10-10）

| 项 | 结果 |
|---|---|
| G-B 自动判定 | **PASS**（判据 ① 门槛由所有者下调为 0.700 后）· 证据 \`reports/G-B-20261010-v2/\` |
| 接受（P0.5-c） | 复制 \`data/idx-full-v2/{index.bin,items.json,meta.json}\` → **\`data/libraries/L1/\`**（引擎约定的落点）；**不覆盖** \`data/*.npy\`，旧 Python 档照常可用 |
| 应用侧 | \`indexStatus → L1 3594/3594 · dim=768 · healthy=true\`（冒烟实跑） |
| 检索 | 真模型编码中文查询 → 引擎 **7 ms 返回 5 条**（全 VR、均带 .rar）；可复跑：\`node tools/check_search.mjs\`（需先有查询向量） |

| # | 债务 | 何时 |
|---|---|---|
| 16 | **④ 人工复核（轻档）尚未完成**：\`reports/G-B-20261010-v2/human-review.md\` 10 项 | 所有者确认 |
| 17 | 判据 ① 的最小值门槛已降到 0.700 → **尾部退化不再被拦住** | 由中位数 / 重合率 / 分位数观察项承担；见 \`SPEC-acceptance.md\` §2.2 |
| 18 | 400×300 一档（411 张）是全库最大组且是当前尾部集中处 | 下次换运行时/精度档时作为第一批回归样本（\`reports/G-B-20261010-v2/TAIL-400x300.md\`） |
`, 'utf8');
console.log('  [OK  ] DEBT-CLEANUP.md 追加 10.3');
console.log('\n收尾完成。');

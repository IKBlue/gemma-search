// _stage6/patch-threshold.mjs —— 约束变更：判据 ① 的最小值门槛 0.970 → 0.700（逐条校验命中数）
//
// 依据：项目所有者 2026-10-10 决定（触发事实：预处理 v2 全量重建 min=0.967894、中位=0.999263）。
// 按 TASK-PLAN §9 变更控制：**改约束 → 改 SPEC，再回来同步计划与证据协议**；并把"代价"写进规格。
//
// 注：文档串那条上一版没命中（我把缩进数错了）——现在改用不含前导空白的短串匹配。
import fs from 'node:fs';

const patches = [
  {
    file: 'docs/spec/SPEC-acceptance.md',
    label: 'SPEC §2.2 最小值门槛行',
    find: '| 逐条余弦**最小值** | **≥ 0.970** | 实测最小 **0.9798**（seq140，ONNX vs torch） |',
    repl: '| 逐条余弦**最小值** | **≥ 0.700** | **2026-10-10 由项目所有者下调（原 0.970）**；原值来自 20 张样本的最小值（0.9798），推导本身不严谨（`docs/DEBT-CLEANUP.md` 债务 10） |',
  },
  {
    file: 'docs/spec/SPEC-acceptance.md',
    label: 'SPEC §2.2 硬底线行',
    find: '| 余弦 < 0.97 的条目 | **不允许存在**；存在即判不通过（先查明原因） | 硬底线 |',
    repl: '| 余弦 < 0.97 的条目 | **不参与判定**，但必须在报告里给出**数量与分位数**（`p0.1` / `p1` / `p5`） | 下调 min 后的**观察项**（原为硬底线，见下方变更记录） |',
  },
  {
    file: 'docs/spec/SPEC-acceptance.md',
    label: 'SPEC §2.2 追加变更记录',
    find: '> 这条就是 `TASK-PLAN.md` §7 债务里那个"0.4%"的**量化定义** —— 之前只在 spike 里有个中位数，没有变成索引验收的判据。',
    repl: '> 这条就是 `TASK-PLAN.md` §7 债务里那个"0.4%"的**量化定义** —— 之前只在 spike 里有个中位数，没有变成索引验收的判据。\n' +
      '>\n' +
      '> ⚠️ **2026-10-10 约束变更（项目所有者决定，记录在案）**\n' +
      '>\n' +
      '> ① 的**最小值门槛由 0.970 下调为 0.700**。触发事实：预处理 v2 全量重建后\n' +
      '> `min=0.967894` · 中位 `0.999263`（证据 `reports/G-B-20261010-v2/`），差 0.0021 未达旧门槛；\n' +
      '> 而旧门槛的来源（20 张样本的最小值 0.9798）在 `docs/DEBT-CLEANUP.md` 债务 10 里已被自己认定为**推导不严谨**。\n' +
      '>\n' +
      '> **代价必须写明（不得只改数字）**：这条门槛从此几乎不再拦得住"尾部明显变差"的情况。\n' +
      '> 质量信号改由 **中位数（≥0.990）**、**Top-10 重合率（≥80%）** 与报告里的**分位数观察项**承担；\n' +
      '> 0.970 作为**观察线**保留在报告里（v2 实测 `p0.1=0.970842`），**只作观察、不作判定**。',
  },
  {
    file: 'reports/README.md',
    label: 'reports/README 判据表 ①',
    find: '| ① 逐条余弦最小值 | ≥ **0.970** |',
    repl: '| ① 逐条余弦最小值 | ≥ **0.700**（2026-10-10 起；原 0.970，见 `docs/spec/SPEC-acceptance.md` §2.2 变更记录） |',
  },
  {
    file: 'reports/README.md',
    label: 'reports/README 禁止措辞里的容差',
    find: '不得用「bit-exact」当验收标准（用容差：min ≥0.970 / median ≥0.990）。',
    repl: '不得用「bit-exact」当验收标准（用容差：min ≥0.700 / median ≥0.990）。',
  },
  {
    file: 'docs/spec/SPEC-identity.md',
    label: 'SPEC-identity 的阈值引用',
    find: '> 本机实测中位余弦 **0.9929**、最小 **0.9798** → 验收用 **≥0.970**（`docs/spec/SPEC-acceptance.md` §2.2）。',
    repl: '> 本机实测中位余弦 **0.9929**、最小 **0.9798**；验收门槛见 `docs/spec/SPEC-acceptance.md` §2.2\n' +
      '> （**2026-10-10 起：最小值 ≥0.700 · 中位数 ≥0.990**，含下调的代价说明）。',
  },
  {
    file: 'tools/quality/quality_vector_equiv.py',
    label: 'quality_vector_equiv 文档串',
    find: '最小值 ≥ 0.970 · 中位数 ≥ 0.990',
    repl: '最小值 ≥ 0.700 · 中位数 ≥ 0.990（0.970 自 2026-10-10 起降级为报告里的观察线）',
  },
  {
    file: 'tools/quality/quality_vector_equiv.py',
    label: 'quality_vector_equiv MIN_COS',
    find: 'MIN_COS = 0.970',
    repl: 'MIN_COS = 0.700          # 2026-10-10 由 0.970 下调（SPEC-acceptance §2.2 变更记录）',
  },
  {
    file: 'tools/quality/quality_fixture_eval.py',
    label: 'quality_fixture_eval MIN_COS',
    find: 'MIN_COS = 0.970',
    repl: 'MIN_COS = 0.700          # 与 SPEC-acceptance §2.2 保持一致（2026-10-10 由 0.970 下调）',
  },
];

const dry = process.argv.includes('--dry-run');
const changed = new Map();
const failed = [];

for (const p of patches) {
  const src = changed.has(p.file) ? changed.get(p.file) : fs.readFileSync(p.file, 'utf8');
  const n = src.split(p.find).length - 1;
  if (n !== 1) { failed.push(`${p.label}（命中 ${n} 次）`); continue; }
  changed.set(p.file, src.replace(p.find, p.repl));
  console.log(`  [OK  ] ${p.label}`);
}
if (failed.length) {
  console.error('\n有补丁没命中，**一个文件都没写**：');
  for (const f of failed) console.error('  · ' + f);
  process.exit(1);
}
if (dry) { console.log(`\n${patches.length} 条补丁全部可命中（dry-run，未写盘）`); process.exit(0); }

for (const [file, content] of changed) {
  fs.writeFileSync(file, content, 'utf8');
  console.log(`  写入 ${file}`);
}
fs.appendFileSync('docs/DEBT-CLEANUP.md',
  '\n| 15 | 判据 ① 的最小值门槛 **0.970 → 0.700**（项目所有者 2026-10-10 决定） | 旧值来自 n=20 样本（债务 10 已指出推导不严谨）；' +
  'v2 实测 min=0.967894 差 0.0021 未达。**代价**：该门槛不再能拦"尾部退化"，质量信号移到中位数 / Top-10 重合率 / 分位数观察项；' +
  '0.970 保留为报告里的观察线 | ✅ 已记入 `docs/spec/SPEC-acceptance.md` §2.2 |\n', 'utf8');
console.log('  [OK  ] docs/DEBT-CLEANUP.md 追加约束变更记录');
console.log(`\n${patches.length} 条补丁已应用，涉及 ${changed.size} 个文件。`);

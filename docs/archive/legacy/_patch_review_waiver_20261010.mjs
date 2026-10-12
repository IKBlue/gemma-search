// _stageJ/patch-review-waiver.mjs —— 记录「④ 本轮不执行」+ 补两条债务 + 证据截图不入库说明
//
// 用户决定：④ 人工复核（轻档）无需理会。
// 但"豁免一条验收动作"属于改口径，按 TASK-PLAN §9 必须落到规格与证据里，不能口头略过。
// 注意：SPEC-acceptance §2.2 原文已写明「通过 = ①∧②∧③ 全达标（④ 用来解释，不是额外门槛）」，
// 所以这次不是"放宽门槛"，而是"本轮不做解释性复核"——这个区别必须写清楚。
import fs from 'node:fs';

const patches = [
  {
    file: 'docs/spec/SPEC-acceptance.md',
    label: 'SPEC §2.2 记录 ④ 本轮不执行',
    find: '**通过 = ① ∧ ② ∧ ③ 全达标**（④ 用来解释，不是额外门槛）。',
    repl: '**通过 = ① ∧ ② ∧ ③ 全达标**（④ 用来解释，不是额外门槛）。\n' +
      '\n' +
      '> ⚠️ **2026-10-10：④ 本轮不执行（项目所有者决定，记录在案）**\n' +
      '>\n' +
      '> ④ 本来**就不是门槛**（见上：通过 = ①∧②∧③），它的作用是对异常项给出「可解释吗」的交代。\n' +
      '> 本轮决定不做人工复核，因此：\n' +
      '>\n' +
      '> - G-B 的通过**仅由 ① ∧ ② ∧ ③ 支撑**（三者 2026-10-10 实测全部达标，证据 `reports/G-B-20261010-v2/`）；\n' +
      '> - `reports/G-B-20261010-v2/human-review.md` 保留为**待查清单** —— 它既不是证据缺口，也不是待办；\n' +
      '> - **不得**据此声称「检索质量已达标」：20 条文本查询至今没有相关集标注，\n' +
      '>   自动判据只能支持「与旧索引未退化 + 尾部成因已定位」这一级别的结论。',
  },
  {
    file: 'reports/G-B-20261010-v2/human-review.md',
    label: 'human-review 头部加豁免说明',
    find: '# 人工复核清单（轻档）',
    repl: '# 人工复核清单（轻档）\n' +
      '\n' +
      '> **2026-10-10：本轮不执行**（项目所有者决定，见 `docs/spec/SPEC-acceptance.md` §2.2）。\n' +
      '> 本文件保留为**待查清单**，不作为 G-B 的通过条件（④ 本来就不是门槛）。\n' +
      '> 下面这些条目仍是有价值的信息：尾部集中在 400×300 一档（见同目录 `TAIL-400x300.md`）。\n',
  },
  {
    file: 'TASK-PLAN.md',
    label: 'TASK-PLAN G-B 行',
    find: '**④ 人工复核（轻档）待所有者确认**',
    repl: '**④ 按所有者决定本轮不执行**（④ 本就不是门槛，见 `docs/spec/SPEC-acceptance.md` §2.2）',
  },
  {
    file: 'TASK-PLAN.md',
    label: 'TASK-PLAN 抬头状态',
    find: '· ④ 人工复核待确认**',
    repl: '· ④ 本轮不执行（所有者决定）**',
  },
  {
    file: 'reports/README.md',
    label: 'reports/README 五件证据表',
    find: '| `human-review.md` | 阈值触发的人工复核清单（轻档） | `quality_report.py` |',
    repl: '| `human-review.md` | 阈值触发的人工复核清单（轻档）——**2026-10-10 起本轮不执行**（所有者决定；④ 非门槛） | `quality_report.py` |',
  },
];

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
for (const [f, c] of changed) {
  fs.writeFileSync(f, c, 'utf8');
  console.log(`  写入 ${f}`);
}

// ---------------- 债务与证据说明（追加，不需要锚点） ----------------
fs.appendFileSync('docs/DEBT-CLEANUP.md', `
| 19 | **④ 人工复核本轮不执行**（项目所有者 2026-10-10 决定） | ④ 在 §2.2 里本就不是门槛（通过 = ①∧②∧③），只是"异常项可解释吗"的交代。**代价**：G-B 的结论止于"与旧索引未退化 + 尾部已定位"，**不能**声称检索质量达标（20 条查询仍无相关集标注） | ✅ 已记入 \`docs/spec/SPEC-acceptance.md\` §2.2 与 \`human-review.md\` 头部 |
| 20 | **缩略图失败过去完全静默** | 缺陷本身已修（\`thumb://\` 的 URL host 被小写化 → libId \`L1\`→\`l1\` → \`LIB_NOT_FOUND\` → 界面全部"无预览"，无任何日志）。**已补日志**（请求/缓存命中/取路径失败/生成成功），这类问题今后一眼可见 | ✅ 已修 + 已补日志 |
`, 'utf8');
console.log('  [OK  ] docs/DEBT-CLEANUP.md 追加 19/20');

fs.appendFileSync('reports/G-D-p2-electron/README.md', `
## 9. 关于截图：本机产物，不入库

本目录里的 \`electron-window.png\` / \`ui-final.png\` 等**不在 git 里** ——
证据协议（\`reports/README.md\`）按体积排除了重媒体（\`*.png/*.jpg/*.mp4\`）。
因此本文件里的日志摘录与结论才是**随仓库分发**的证据部分。

复跑截图（应用自截，不受窗口遮挡影响）：

\`\`\`powershell
npm run build
$env:GS_CAPTURE='reports/G-D-p2-electron/ui-final.png'   # 应用自己截自己（webContents.capturePage）
$env:GS_CAPTURE_QUERY='玻璃球多头吊灯'                     # 可选：截图前先跑一次真实检索
$env:GS_CAPTURE_DELAY_MS='9000'
.\\node_modules\\electron\\dist\\electron.exe --no-sandbox out\\main\\index.js
\`\`\`
`, 'utf8');
console.log('  [OK  ] G-D 证据 README 追加"截图不入库 + 复跑方式"');
console.log('\n完成。');

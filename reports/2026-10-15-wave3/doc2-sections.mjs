import fs from 'node:fs';
// 二级尺子：文件级 + **小节级**。小节 = 标题里的编号 token（5 · 5.1 · P4 · F3 …）。
function sectionsOf(file) {
  const set = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^#{2,4}\s+(?:(\d+(?:\.\d+)*)\.?|([PF]\d+))\s/.exec(line);
    if (m) set.set(m[1] ?? m[2], line.trim().slice(0, 70));
  }
  return set;
}
// DOC-2 计划里的 A 类目标（文档 → 需要的小节）
const PLAN = {
  'SPEC.md': ['5', '5.1', '5.2', '6', '2', '2.1', '2.2', '4', '1.4', '3'],
  'AGENTS.md': ['3', '1', '5', '8', '2'],
  'PLAN.md': ['9', '4'],
  'TASKS.md': ['1', '3'],
};
let bad = 0, all = 0;
for (const [doc, need] of Object.entries(PLAN)) {
  const have = sectionsOf(doc);
  console.log('=== ' + doc + '（实际小节 ' + have.size + ' 个）===');
  for (const n of need) {
    all++;
    const ok = have.has(n);
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'MISS') + ' §' + n + (ok ? '  → ' + have.get(n) : '  ← 计划里要用，但目标文档**没有这一节** ⇒ 必须退回「自述」'));
  }
}
console.log('');
console.log('小节级预验：需要 ' + all + ' 个 · **命中 ' + (all - bad) + ' · 缺失 ' + bad + '**');

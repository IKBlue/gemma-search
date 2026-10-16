import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','data','docs','reports','.git','fixtures','prototypes','.npm-cache','model-cache']);
const EXT = /\.(mjs|js|cjs|ts|tsx|json|css|html|md)$/;
// 第三维：**裸旧文档名的「引用」**（不是"提及"）。
// ⚠️ 语义必须精确：只算**带锚点**的引用（`§x` 或 `:行号`）——
//    否则「MIGRATION-PLAN.md 已改自述」这种**自述句**会被误计（我的第一版正是这么错的，被 --calibrate 拦下）。
const LEGACY = ['SPEC-security','SPEC-app','SPEC-identity','SPEC-transactions','CONTRACT-engine-v1','MIGRATION-PLAN','UI-REVIEW-and-migration','DESIGN-app-details','DESIGN-tokens','DEBT-CLEANUP','STACK-AUDIT','AUDIT-FINAL','stack-evidence','ROADMAP'];
const RE = new RegExp('(?<![\\w./-])(' + LEGACY.join('|') + ')(?:\\.md)?\\s*(?:§\\s*[\\dPF]|:\\s*\\d+)', 'g');
function detect(line) { const hits = []; let m; RE.lastIndex = 0; while ((m = RE.exec(line)) !== null) hits.push(m[1]); return hits; }
function calibrate() {
  const cases = [
    ['// 已知引用：SPEC-security §8', 1],
    ['// 已知引用：DESIGN-app-details:414 的态度', 1],
    ['// 已知引用：UI-REVIEW-and-migration.md §1/§9', 1],
    ['// 已知提及（非引用，应计 0）：MIGRATION-PLAN.md 已改自述', 0],
    ['// 已知正常：SPEC.md §5（新指针）', 0],
    ['// 已知正常：docs/archive/prototype/（现存）', 0],
  ];
  let bad = 0;
  console.log('【第三维尺子校准 --calibrate（语义：带锚点的**引用**，不是提及）】');
  for (const [line, want] of cases) {
    const got = detect(line).length;
    const ok = got === want;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' 期望' + want + ' 实得' + got + '  ' + line);
  }
  console.log('  ⇒ 校准' + (bad === 0 ? '**通过**' : '**失败**'));
  return bad === 0;
}
if (process.argv.slice(2).includes('--calibrate')) process.exit(calibrate() ? 0 : 1);
const files = fs.readdirSync(ROOT).filter((f) => EXT.test(f) && fs.statSync(f).isFile());
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(EXT.test(e.name))files.push(path.relative(ROOT,p));}}
for (const d of ['apps','packages']) walk(d);
let n = 0; const rows = [];
for (const rel of files) {
  let txt; try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => { const h = detect(line); if (h.length) { n += h.length; rows.push(rel.replace(/\\/g,'/') + ':' + (i+1) + '  [' + h.join(',') + ']'); } });
}
console.log('【第三维：裸旧文档名的**引用**（带锚点）】');
console.log('  ③ **裸旧文档引用** = ' + n + '（' + rows.length + ' 行）');
const byName = new Map();
for (const r of rows) { const m = /\[([^\]]+)\]/.exec(r); for (const k of m[1].split(',')) byName.set(k, (byName.get(k) ?? 0) + 1); }
console.log('  按文档：' + [...byName.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+'='+v).join(' · '));
fs.writeFileSync(path.join(ROOT, 'data', '_doc2-legacy.txt'), rows.join('\n'), 'utf8');

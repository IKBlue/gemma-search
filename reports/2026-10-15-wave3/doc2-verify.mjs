import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','data','docs','reports','.git','fixtures','prototypes','.npm-cache','model-cache']);
const files = fs.readdirSync(ROOT).filter((f) => /\.(mjs|js|cjs|ts|tsx|json|css|html|md)$/.test(f) && !['AGENTS.md','SPEC.md','PLAN.md','TASKS.md'].includes(f) && fs.statSync(f).isFile());
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(mjs|js|cjs|ts|tsx|json|css|html|md)$/.test(e.name))files.push(path.relative(ROOT,p));}}
for (const d of ['apps','packages']) walk(d);
const secCache = new Map();
function sectionsOf(doc){
  if (secCache.has(doc)) return secCache.get(doc);
  const set = new Set();
  if (fs.existsSync(path.join(ROOT, doc))) for (const line of fs.readFileSync(path.join(ROOT, doc), 'utf8').split(/\r?\n/)) {
    const m = /^#{2,4}\s+(?:(\d+(?:\.\d+)*)\.?|([PF]\d+))\s/.exec(line);
    if (m) set.add(m[1] ?? m[2]);
  }
  secCache.set(doc, set); return set;
}
let fileDangling = 0, secDangling = 0, secOk = 0;
const secMiss = [], docMiss = new Map(), secSeen = [];
for (const rel of files) {
  let txt; try { txt = fs.readFileSync(rel, 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    const re = /docs\/[A-Za-z0-9_./\-]+/g; let m;
    while ((m = re.exec(line)) !== null) {
      const token = m[0].replace(/[.,;:)\u0060]+$/, '');
      if (!fs.existsSync(path.join(ROOT, token))) { fileDangling++; if(!docMiss.has(token))docMiss.set(token,[]); docMiss.get(token).push(rel.replace(/\\/g,'/')+':'+(i+1)); }
    }
    // ⚠️ 边界修正：(?<![-\w]) 防止 MIGRATION-PLAN.md 被当成 PLAN.md（我上一版正是这么误报的）
    const re2 = /(?<![-\w])(AGENTS|SPEC|PLAN|TASKS)\.md\s*§\s*(\d+(?:\.\d+)*|[PF]\d+)/g;
    while ((m = re2.exec(line)) !== null) {
      const doc = m[1] + '.md', sec = m[2];
      if (sectionsOf(doc).has(sec)) { secOk++; secSeen.push(doc + ' §' + sec); }
      else { secDangling++; secMiss.push(rel.replace(/\\/g,'/') + ':' + (i+1) + '  →  ' + doc + ' §' + sec); }
    }
  });
}
console.log('【DOC-2 二级验收尺子（rg 版：先跑、贴输出、后结论）】');
console.log('  ① **文件悬挂** = ' + fileDangling + '（基线 36 ⇒ 目标 0）· 悬挂文档去重 ' + docMiss.size + ' 份');
console.log('  ② **小节悬挂** = ' + secDangling + '（命中 ' + secOk + ' ⇒ 目标 0）');
console.log('  命中过的小节（' + new Set(secSeen).size + ' 个不同）: ' + [...new Set(secSeen)].sort().join(' · '));
if (secMiss.length) { console.log('  小节悬挂明细（这些**文件级扫描永远看不见**）：'); for (const s of secMiss) console.log('    ' + s); }

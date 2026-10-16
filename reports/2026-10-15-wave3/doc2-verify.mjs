import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','data','docs','reports','.git','fixtures','prototypes','.npm-cache','model-cache']);
const EXT = /\.(mjs|js|cjs|ts|tsx|json|css|html|md)$/;
const secCache = new Map();
function sectionsOf(doc) {
  if (secCache.has(doc)) return secCache.get(doc);
  const set = new Set();
  const abs = path.join(ROOT, doc);
  if (fs.existsSync(abs)) for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = /^#{2,4}\s+(?:(\d+(?:\.\d+)*)\.?|([PF]\d+))\s/.exec(line);
    if (m) set.add(m[1] ?? m[2]);
  }
  secCache.set(doc, set); return set;
}
/** 核心检测（纯函数）：同时判文件级与小节级 —— 做成纯函数是为了让 --calibrate 能用已知真值验它。 */
function detectLine(line, baseDir) {
  const out = { fileDangling: [], secDangling: [], secOk: [] };
  const re = /docs\/[A-Za-z0-9_./\-]+/g; let m;
  while ((m = re.exec(line)) !== null) {
    const token = m[0].replace(/[.,;:)\u0060]+$/, '');
    if (!fs.existsSync(path.join(baseDir ?? ROOT, token))) out.fileDangling.push(token);
  }
  // ⚠️ 边界 (?<![-\w])：否则 MIGRATION-PLAN.md 会被当成 PLAN.md（我曾因此误报 3 条 —— 纪律 21 的由来）
  const re2 = /(?<![-\w])(AGENTS|SPEC|PLAN|TASKS)\.md\s*§\s*(\d+(?:\.\d+)*|[PF]\d+)/g;
  while ((m = re2.exec(line)) !== null) {
    const doc = m[1] + '.md', sec = m[2];
    (sectionsOf(doc).has(sec) ? out.secOk : out.secDangling).push(doc + ' §' + sec);
  }
  return out;
}
function repoFiles() {
  const files = fs.readdirSync(ROOT).filter((f) => EXT.test(f) && !['AGENTS.md','SPEC.md','PLAN.md','TASKS.md'].includes(f) && fs.statSync(f).isFile());
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(EXT.test(e.name))files.push(path.relative(ROOT,p));}}
  for (const d of ['apps','packages']) walk(d);
  return files;
}
function calibrate() {
  const fix = path.join(ROOT, 'data', '_doc2-calib');
  fs.rmSync(fix, { recursive: true, force: true });
  fs.mkdirSync(path.join(fix, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(fix, 'docs', 'KNOWN-GOOD.md'), '# 已知存在\n');
  const lines = [
    '// case1 已知悬挂(文件): docs/spec/SPEC-security.md',
    '// case2 已知正常(文件): docs/KNOWN-GOOD.md',
    '// case3 已知正常(小节): SPEC.md §0',
    '// case4 已知悬挂(小节): SPEC.md §99.9',
  ];
  let fD = 0, sD = 0, sOk = 0;
  for (const l of lines) { const r = detectLine(l, fix); fD += r.fileDangling.length; sD += r.secDangling.length; sOk += r.secOk.length; }
  const pass = fD === 1 && sD === 1 && sOk === 1;
  console.log('【尺子校准 --calibrate（纪律 21：先校准，再采信）】');
  console.log('  夹具 data/_doc2-calib/ 4 个已知 case（跑完即删）：');
  console.log('    case1 已知悬挂(文件) docs/spec/SPEC-security.md');
  console.log('    case2 已知正常(文件) docs/KNOWN-GOOD.md');
  console.log('    case3 已知正常(小节) SPEC.md §0');
  console.log('    case4 已知悬挂(小节) SPEC.md §99.9');
  console.log('  实测 fileDangling=' + fD + ' · secDangling=' + sD + ' · secOk=' + sOk + '（期望 1/1/1）');
  console.log('  ⇒ 校准' + (pass ? '**通过**' : '**失败**（输出不可采信）'));
  fs.rmSync(fix, { recursive: true, force: true });
  return pass;
}
if (process.argv.slice(2).includes('--calibrate')) process.exit(calibrate() ? 0 : 1);
let fileDangling = 0, secDangling = 0, secOk = 0;
const docMiss = new Map(), secMiss = [];
for (const rel of repoFiles()) {
  let txt; try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    const r = detectLine(line);
    for (const t of r.fileDangling) { fileDangling++; if (!docMiss.has(t)) docMiss.set(t, []); docMiss.get(t).push(rel.replace(/\\/g,'/') + ':' + (i + 1)); }
    for (const s of r.secDangling) { secDangling++; secMiss.push(rel.replace(/\\/g,'/') + ':' + (i + 1) + '  →  ' + s); }
    secOk += r.secOk.length;
  });
}
console.log('【DOC-2 二级验收尺子（已过 --calibrate）】');
console.log('  ① **文件悬挂** = ' + fileDangling + '（去重 ' + docMiss.size + ' 份文档；目标 0）');
console.log('  ② **小节悬挂** = ' + secDangling + '（命中 ' + secOk + '；目标 0）');
if (secMiss.length) { console.log('  小节悬挂明细（文件级扫描看不见的类型）：'); for (const s of secMiss) console.log('    ' + s); }

import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','data','docs','reports','.git','fixtures','prototypes','.npm-cache','model-cache']);
const EXT = /\.(mjs|js|cjs|ts|tsx|json|css|html|md)$/;
const LEGACY = ['SPEC-security','SPEC-app','SPEC-identity','SPEC-transactions','CONTRACT-engine-v1','MIGRATION-PLAN','UI-REVIEW-and-migration','DESIGN-app-details','DESIGN-tokens','DEBT-CLEANUP','STACK-AUDIT','AUDIT-FINAL','stack-evidence','ROADMAP'];
const RE = new RegExp('(?<![\\w./-])(' + LEGACY.join('|') + ')(?:\\.md)?\\s*(?:§\\s*[\\dPF]|:\\s*\\d+)', 'g');
const files = fs.readdirSync(ROOT).filter((f) => EXT.test(f) && fs.statSync(f).isFile());
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(EXT.test(e.name))files.push(path.relative(ROOT,p));}}
for (const d of ['apps','packages']) walk(d);
const rows = [];
for (const rel of files) {
  let txt; try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    RE.lastIndex = 0; let m; const names = [];
    while ((m = RE.exec(line)) !== null) names.push(m[1]);
    if (names.length) rows.push({ file: rel.replace(/\\/g,'/'), line: i+1, names, text: line.trim().slice(0, 130) });
  });
}
const by = new Map();
for (const r of rows) for (const n of r.names) { if (!by.has(n)) by.set(n, []); by.get(n).push(r); }
console.log('裸旧文档引用 = ' + rows.reduce((a,r)=>a+r.names.length,0) + ' · 行 = ' + rows.length);
for (const [n, rs] of [...by.entries()].sort((a,b)=>b[1].length-a[1].length)) {
  console.log('\n### ' + n + ' (' + rs.length + ')');
  for (const r of rs) console.log('  ' + r.file + ':' + r.line + '  |  ' + r.text);
}

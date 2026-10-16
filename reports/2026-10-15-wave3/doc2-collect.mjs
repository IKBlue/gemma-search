import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','data','docs','reports','.git','fixtures','prototypes','.npm-cache','model-cache']);
const files = fs.readdirSync(ROOT).filter((f) => /\.(mjs|js|cjs|ts|tsx|json|css|html)$/.test(f) && fs.statSync(f).isFile());
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(mjs|js|cjs|ts|tsx|json|css|html)$/.test(e.name))files.push(path.relative(ROOT,p));}}
for (const d of ['apps','packages']) walk(d);
const rows=[];
for(const rel of files){let txt;try{txt=fs.readFileSync(rel,'utf8');}catch{continue;}
 txt.split(/\r?\n/).forEach((line,i)=>{const re=/docs\/[A-Za-z0-9_./\-]+/g;let m;while((m=re.exec(line))!==null){const token=m[0].replace(/[.,;:)\u0060]+$/,'');const exists=fs.existsSync(path.join(ROOT,token));if(!exists)rows.push({file:rel.replace(/\\/g,'/'),line:i+1,token,text:line.trim().slice(0,150)});}});}
console.log('悬挂引用 =', rows.length, '（去重 ' + new Set(rows.map(r=>r.token)).size + ' 份文档）');
const byToken=new Map();
for(const r of rows){if(!byToken.has(r.token))byToken.set(r.token,[]);byToken.get(r.token).push(r);}
for(const [t,rs] of [...byToken.entries()].sort((a,b)=>b[1].length-a[1].length)){
  console.log('\n### ' + t + '  (' + rs.length + ' 处)');
  for(const r of rs) console.log('  ' + r.file + ':' + r.line + '  |  ' + r.text);
}

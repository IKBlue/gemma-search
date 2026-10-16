import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const DIRS = ['apps', 'packages'];
const ROOT_FILES = fs.readdirSync(ROOT).filter((f) => /\.(mjs|js|cjs|ts|tsx|json|css|html)$/.test(f) && fs.statSync(f).isFile());
const SKIP = new Set(['node_modules', 'out', 'dist', 'release', 'data', 'docs', 'reports', '.git', 'fixtures', 'prototypes', '.npm-cache', 'model-cache']);
const files = [...ROOT_FILES];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|cjs|ts|tsx|json|css|html)$/.test(e.name)) files.push(path.relative(ROOT, p));
  }
}
for (const d of DIRS) walk(d);
const rows = [];
for (const rel of files) {
  let txt;
  try { txt = fs.readFileSync(rel, 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    const re = /docs\/[A-Za-z0-9_./\-]+/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      let token = m[0].replace(/[.,;:)\u0060]+$/, '');
      const exists = fs.existsSync(path.join(ROOT, token));
      rows.push({ file: rel.replace(/\\/g, '/'), line: i + 1, token, exists });
    }
  });
}
const missing = rows.filter((r) => !r.exists);
const present = rows.filter((r) => r.exists);
console.log('总引用 =', rows.length, '· 存在 =', present.length, '· **悬挂 =', missing.length, '**');
const byToken = new Map();
for (const r of missing) { if (!byToken.has(r.token)) byToken.set(r.token, []); byToken.get(r.token).push(r.file + ':' + r.line); }
console.log('--- 悬挂的文档（去重 ' + byToken.size + ' 个）---');
for (const [t, locs] of [...byToken.entries()].sort()) console.log('  ' + t + '  ← ' + locs.length + ' 处: ' + locs.slice(0, 4).join(', ') + (locs.length > 4 ? ' …' : ''));
console.log('--- 存在但仍被引用的（保留）---');
const okTok = new Set(present.map((r) => r.token));
for (const t of okTok) console.log('  ' + t + '  ×' + present.filter((r) => r.token === t).length);

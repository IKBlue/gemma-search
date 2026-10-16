import fs from 'node:fs';
const lines = fs.readFileSync('SPEC.md', 'utf8').split(/\r?\n/);
let head = '';
const hits = [];
const KEYS = ['sha1','uid','compat','GSIDX','items.json','sandbox','CSP','thumb://','devTools','重编码','normalization','L2','写入不变式','事务','envelope','band'];
const wanted = new Set(KEYS);
for (let i = 0; i < lines.length; i++) {
  const m = /^#{2,4}\s+(.+)$/.exec(lines[i]);
  if (m) { head = m[1].trim().slice(0, 60); continue; }
  for (const k of KEYS) if (lines[i].includes(k)) hits.push({ k, head, text: lines[i].trim().slice(0, 110) });
}
const byKey = new Map();
for (const h of hits) { if (!byKey.has(h.k)) byKey.set(h.k, []); byKey.get(h.k).push(h); }
for (const k of KEYS) {
  const rs = byKey.get(k) ?? [];
  const heads = [...new Set(rs.map((r) => r.head))].slice(0, 4);
  console.log('  ' + k.padEnd(14) + ' 命中 ' + String(rs.length).padStart(3) + ' ⇒ 落在: ' + (heads.join(' | ') || '(无)'));
}
console.log('');
console.log('=== SPEC.md 全部小节（供指派目标）===');
for (const l of lines) { const m = /^#{2,3}\s+(.+)$/.exec(l); if (m) console.log('  ' + m[1].trim().slice(0, 70)); }

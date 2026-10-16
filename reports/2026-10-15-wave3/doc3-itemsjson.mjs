import fs from 'node:fs';
const lines = fs.readFileSync('SPEC.md', 'utf8').split(/\r?\n/);
let head = '';
const want = /items\.json|条目（?|一个条目|entry|uid 是主键|素材/;
for (let i = 0; i < lines.length; i++) {
  const m = /^#{2,4}\s+(.+)$/.exec(lines[i]);
  if (m) { head = m[1].trim().slice(0, 55); continue; }
  if (/items\.json/.test(lines[i]) || /一个条目 =/.test(lines[i]) || /条目（/.test(lines[i])) {
    console.log('  [' + head + '] ' + lines[i].trim().slice(0, 120));
  }
}

import fs from 'node:fs';
const file = process.argv[2] || 'data/_e2e-run.json';
// ⚠️ PowerShell 的 `1>` 重定向默认写 UTF-16LE（带 BOM）⇒ 必须先按 BOM 解码，否则 JSON.parse 报 Unexpected token '\uFFFD'。
const raw = fs.readFileSync(file);
const txt = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8').replace(/^\uFEFF/, '');
const clean = txt.replace(/^\uFEFF/, '').trim();
const j = JSON.parse(clean);
const byFile = new Map();
let pass = 0, skip = 0, other = 0;
const others = [];
const statuses = new Map();
function walk(su) {
  for (const sp of su.specs || []) {
    const f = (sp.file || '').split(/[\\/]/).pop();
    if (!byFile.has(f)) byFile.set(f, { p: 0, s: 0, o: 0 });
    const b = byFile.get(f);
    for (const t of sp.tests || []) {
      const st = t.status;
      statuses.set(st, (statuses.get(st) || 0) + 1);
      if (st === 'expected') { pass++; b.p++; }
      else if (st === 'skipped') { skip++; b.s++; }
      else { other++; b.o++; others.push(f + ' :: ' + t.title + ' => ' + st); }
    }
  }
  for (const c of su.suites || []) walk(c);
}
for (const su of j.suites || []) walk(su);
console.log('【JSON 汇总】passed=' + pass + ' skipped=' + skip + ' other=' + other + ' 合计=' + (pass + skip + other));
console.log('【状态分布】' + [...statuses.entries()].map(([k, v]) => k + '=' + v).join(' · '));
console.log('【逐文件】');
for (const k of [...byFile.keys()].sort()) {
  const b = byFile.get(k);
  console.log('  ' + k.padEnd(36) + ' pass=' + String(b.p).padEnd(3) + (b.s ? ' skip=' + b.s + ' ' : '') + (b.o ? ' OTHER=' + b.o : ''));
}
if (others.length) { console.log('【OTHER 明细】'); for (const o of others) console.log('  ' + o); }
const s = j.stats || {};
console.log('【stats】' + JSON.stringify({ expected: s.expected, skipped: s.skipped, unexpected: s.unexpected, flaky: s.flaky, duration: s.duration }));
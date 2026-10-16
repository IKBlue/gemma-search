import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
// 判据 ②（与判据 ①「存在不存在」**分开报数**）：**产品源码**（apps/desktop/src/** 与 packages/**，不含 tests/e2e）
// 里指向 **reports/** 下 .txt/.json 这类**逐轮产物**的引用 —— **即使文件存在**也违反
// （逐轮归档会改名/清理；对新克隆未必存在 ⇒ 引用天然脆）。稳定文档（.md：四份根文档 / SPEC 小节 / 设计基线 md）允许。
const SCAN_ROOTS = ['apps/desktop/src', 'packages'];
const EXT = /\.(ts|tsx|mjs|js|cjs|css|html)$/;
const ROUND_REF = /reports\/[^\s'\u0060")\]]+\.(txt|json)/g;
function detect(line) { const out = []; let m; ROUND_REF.lastIndex = 0; while ((m = ROUND_REF.exec(line)) !== null) out.push(m[0]); return out; }
function calibrate() {
  const cases = [
    ['// 见 reports/2026-10-15-wave3/build2.txt', 1],
    ['// 见 reports/2026-10-15-wave3/u2.txt 与 reports/2026-10-15-wave3/u12.txt', 2],
    ['// 依据 reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md §1.1', 0],
    ['// 依据 SPEC.md §7 验收判据', 0],
    ['// 原始输出 data/_x.txt（本机临时区）', 0],
  ];
  let bad = 0;
  console.log('【判据 ② 尺子校准 --calibrate（产品源码不得引用逐轮产物；.md 稳定文档允许）】');
  for (const [line, want] of cases) {
    const got = detect(line).length;
    const ok = got === want; if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' 期望' + want + ' 实得' + got + '  ' + line.slice(0, 78));
  }
  console.log('  ⇒ 校准' + (bad === 0 ? '**通过**' : '**失败（不予采信）**'));
  return bad === 0;
}
if (process.argv.slice(2).includes('--calibrate')) process.exit(calibrate() ? 0 : 1);
const files = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (EXT.test(e.name)) files.push(path.relative(ROOT, p)); } }
for (const r of SCAN_ROOTS) if (fs.existsSync(r)) walk(r);
let n = 0; const rows = [];
for (const rel of files) {
  let txt; try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    const hits = detect(line);
    if (hits.length) { n += hits.length; rows.push(rel.replace(/\\/g, '/') + ':' + (i + 1) + '  ->  ' + hits.join(' + ')); }
  });
}
console.log('【判据 ②：产品源码（apps/desktop/src + packages，不含 tests/e2e）引用 reports/**/*.txt|*.json】');
console.log('  命中 = **' + n + '**（' + rows.length + ' 行）');
for (const r of rows) console.log('  · ' + r);
fs.writeFileSync(path.join(ROOT, 'data', '_doc5-roundrefs.txt'), rows.join('\n'), 'utf8');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let bad = false;
// ---------- 1) 能力清单：从 PRE-RELEASE.md §1 的表格行机械解析 ----------
const pre = fs.readFileSync(path.join(ROOT, 'reports/2026-10-16-prerelease/PRE-RELEASE.md'), 'utf8');
const sec1 = pre.split(/^## 1\./m)[1]?.split(/^## 2\./m)[0] || '';
const caps = [];
let group = '(未分组)';
for (const line of sec1.split(/\r?\n/)) {
  const h = line.match(/^### (1\.\d+ .+)$/);
  if (h) { group = h[1].trim(); continue; }
  // | ⭐ **能力名** | 说明 |   或   | **能力名** | 说明 |
  const m = line.match(/^\| (?:⭐ )?\*\*(.+?)\*\* \|/);
  if (m) caps.push({ group, name: m[1].trim() });
}
console.log('【解析】能力行 = ' + caps.length + '（分组 ' + new Set(caps.map(c => c.group)).size + '）');
if (caps.length === 0) { console.log('⛔ 能力清单解析出 0 条 ⇒ 表格格式变了？**不许空跑当绿**'); bad = true; }
// ---------- 2) e2e 用例清单：从 --list 输出机械解析 ----------
const listPath = path.join(ROOT, 'data/_e2e-list.txt');
if (!fs.existsSync(listPath)) { console.log('⛔ 缺 data/_e2e-list.txt ⇒ 先跑 playwright --list'); process.exit(1); }
const tests = [];
for (const line of fs.readFileSync(listPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s+([A-Za-z0-9_.-]+\.spec\.mjs):(\d+):1 › (.+)$/);
  if (m) tests.push({ file: m[1], line: Number(m[2]), title: m[3].trim() });
}
const byFile = new Map();
for (const t of tests) byFile.set(t.file, (byFile.get(t.file) || 0) + 1);
console.log('【解析】e2e 用例 = ' + tests.length + '（文件 ' + byFile.size + '）');
if (tests.length === 0) { console.log('⛔ e2e 用例解析出 0 条 ⇒ **不许空跑当绿**'); bad = true; }
// ---------- 3) IPC 方法清单 + 机械覆盖率（e2e / 单测 各引用多少次）----------
const ipcSrc = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/shared/ipc.ts'), 'utf8');
const methods = [...ipcSrc.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*z\./gm)].map((m) => m[1]);
console.log('【解析】IPC 方法 = ' + methods.length);
if (methods.length === 0) { console.log('⛔ IPC 方法解析出 0 条 ⇒ **不许空跑当绿**'); bad = true; }
function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(mjs|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const e2eFiles = walkFiles(path.join(ROOT, 'apps/desktop/e2e'));
const unitFiles = walkFiles(path.join(ROOT, 'apps/desktop/tests'));
const read = (f) => fs.readFileSync(f, 'utf8');
const e2eText = e2eFiles.map(read).join('\n');
const unitText = unitFiles.map(read).join('\n');
const cov = methods.map((name) => {
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  return { name, e2e: (e2eText.match(re) || []).length, unit: (unitText.match(re) || []).length };
});
const covered = cov.filter((c) => c.e2e > 0 || c.unit > 0);
console.log('【IPC 覆盖】有自动化引用 = ' + covered.length + '/' + cov.length);
if (cov.length && covered.length === 0) { console.log('⛔ 一个 IPC 方法都没被测试引用 ⇒ 扫描路径错了？**不许当绿**'); bad = true; }
// ---------- 4) 输出 ----------
console.log('\n【能力清单（供人工映射行号用）】');
for (const c of caps) console.log('  · [' + c.group + '] ' + c.name);
console.log('\n【e2e 文件 × 用例数】');
for (const f of [...byFile.keys()].sort()) console.log('  ' + f.padEnd(34) + ' ' + byFile.get(f));
console.log('\n【IPC 方法 × 引用（e2e/单测）】');
for (const c of cov.sort((a, b) => a.e2e + a.unit - (b.e2e + b.unit))) console.log('  ' + c.name.padEnd(26) + ' e2e=' + String(c.e2e).padEnd(3) + ' unit=' + c.unit);
console.log('\n【结论】' + (bad ? '⛔ 有防空跑检查失败 ⇒ 本报告不予采信' : '解析全部非空，报告可采信'));
if (bad) process.exit(1);

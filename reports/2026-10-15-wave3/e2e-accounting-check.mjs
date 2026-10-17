import fs from 'node:fs';
// E2E 用例账目守卫（**只读**；放 reports/ 不新增 tools/，见 AGENTS §4）
// 由 TEST-COUNT-1（task-123）产出，Lead 2026-10-17 批准接入门禁。用法：
//   node reports/2026-10-15-wave3/e2e-accounting-check.mjs <run.json> <list.txt> [--max-age-min N]
// 判据（全部来自两份真实产物，**不写死任何数**）：
//   ① listTotal == passed + skipped + other（总账）
//   ② 逐文件 listed[i] == passed[i] + skipped[i] + other[i]
//   ③ **did_not_run == 0 单独红**（它是「被中断 / 被过滤」的唯一痕迹；不许被总账掩盖）
//   ④ **防空跑假绿**：任一侧解析出 0 条 ⇒ 直接红（清单格式变了也不许 0==0 账平）
//   ⑤ **只算这一次运行**：两份输入 mtime 都要在 --max-age-min 内（默认 60），否则红
//      —— 防「把上一次的 json/清单喂进来」造成的假账平。
// 退出码：0 = 账平；1 = 账不平/有 did_not_run/解析失败/输入过期；2 = 用法错误。
function decode(p) {
  const raw = fs.readFileSync(p);
  // ⚠️ PowerShell 的 1> 重定向默认写 UTF-16LE 带 BOM（也有 UTF-8 BOM 的情况）⇒ 两种都处理。
  const txt = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
  return txt.replace(/^\uFEFF/, '');
}
const args = process.argv.slice(2);
const maxAgeIdx = args.indexOf('--max-age-min');
let maxAgeMin = 60;
if (maxAgeIdx >= 0) {
  maxAgeMin = Number(args[maxAgeIdx + 1]);
  args.splice(maxAgeIdx, 2);
}
const [jsonPath, listPath] = args;
if (!jsonPath || !listPath) {
  console.error('用法: node e2e-accounting-check.mjs <run.json> <list.txt> [--max-age-min N]');
  process.exit(2);
}
const now = Date.now();
const ageMin = (p) => Math.round((now - fs.statSync(p).mtimeMs) / 60000);
const jAge = ageMin(jsonPath);
const lAge = ageMin(listPath);
console.log('【输入】' + jsonPath + '（' + jAge + ' 分钟前 · ' + fs.statSync(jsonPath).size + 'B）');
console.log('【输入】' + listPath + '（' + lAge + ' 分钟前 · ' + fs.statSync(listPath).size + 'B）');
let bad = false;
if (maxAgeMin > 0 && (jAge > maxAgeMin || lAge > maxAgeMin)) {
  console.log('⛔ 输入过期（> ' + maxAgeMin + ' 分钟）⇒ 不是本次运行的产物，先重跑 list 与 e2e');
  bad = true;
}
const listed = new Map();
let listTotal = 0;
for (const line of decode(listPath).split(/\r?\n/)) {
  const m = line.match(/^\s+([A-Za-z0-9_.-]+\.spec\.mjs):(\d+):/);
  if (m) { listed.set(m[1], (listed.get(m[1]) || 0) + 1); listTotal++; }
}
const run = new Map();
let passed = 0, skipped = 0, other = 0;
const others = [];
function walk(su) {
  for (const sp of su.specs || []) {
    const f = (sp.file || '').split(/[\\/]/).pop();
    const b = run.get(f) || { passed: 0, skipped: 0, other: 0 };
    for (const t of sp.tests || []) {
      if (t.status === 'expected') { passed++; b.passed++; }
      else if (t.status === 'skipped') { skipped++; b.skipped++; }
      else { other++; b.other++; others.push(f + ' :: ' + t.title + ' => ' + t.status); }
    }
    run.set(f, b);
  }
  for (const c of su.suites || []) walk(c);
}
let j = {};
try { j = JSON.parse(decode(jsonPath)); } catch (e) {
  console.log('⛔ run.json 解析失败：' + String(e).slice(0, 120)); process.exit(1);
}
for (const su of j.suites || []) walk(su);
const runTotal = passed + skipped + other;
const didNotRun = Math.max(0, listTotal - runTotal);
console.log('【总账】list=' + listTotal + ' 运行=' + runTotal + '（passed=' + passed + ' · skipped=' + skipped + ' · other=' + other + '）· did_not_run=' + didNotRun);
if (listTotal === 0) { console.log('⛔ list 解析出 0 条 ⇒ 清单格式变了？**不许 0==0 账平**'); bad = true; }
if (runTotal === 0) { console.log('⛔ run.json 解析出 0 条 ⇒ reporter 参数/格式不对？**不许 0==0 账平**'); bad = true; }
if (didNotRun !== 0) {
  console.log('⛔ **did_not_run=' + didNotRun + '** —— 有 ' + didNotRun + ' 条用例被收集但没执行（运行被中断/被过滤的唯一痕迹）');
  bad = true;
}
if (runTotal !== listTotal) { console.log('⛔ 总账不平：list != 运行（差 ' + (listTotal - runTotal) + '）'); bad = true; }
const files = [...new Set([...listed.keys(), ...run.keys()])].sort();
const diffs = [];
for (const f of files) {
  const l = listed.get(f) || 0;
  const r = run.get(f) || { passed: 0, skipped: 0, other: 0 };
  const rt = r.passed + r.skipped + r.other;
  if (l !== rt) { diffs.push(f + '  list=' + l + ' 运行=' + rt + '（pass=' + r.passed + ' skip=' + r.skipped + ' other=' + r.other + '）'); bad = true; }
}
if (diffs.length) { console.log('【账不平的文件】'); for (const d of diffs) console.log('  · ' + d); }
else if (files.length && !bad) console.log('【逐文件】全部平账（' + files.length + ' 个文件）');
if (others.length) { console.log('【非 expected/skipped 的明细】'); for (const o of others) console.log('  · ' + o); }
if (bad) process.exit(1);
console.log('⇒ 账平（本次运行）。');

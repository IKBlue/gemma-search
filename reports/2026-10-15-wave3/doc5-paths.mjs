import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','out','dist','release','.git','prototypes','reports','.npm-cache','model-cache','docs']);
const EXT = /\.(mjs|js|cjs|ts|tsx|json|css|html|md|yml|yaml|toml|cfg|ini|log|bin|txt)$/;
const NAMED = new Set(['LICENSE','NOTICE','README','Dockerfile']);
const isScanned = (n) => EXT.test(n) || NAMED.has(n);
// 路径候选：形如 <已知顶层目录>/... .<ext>
const PATH_RE = /(?:^|[\s([\u0060"'])((?:apps|packages|tools|scripts|reports|fixtures|data|docs|src|out)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
// **提及标记**：这些词让一行从「指向」降级为「提及/历史说明」
const MENTION_RE = /已不存在|已删除|已移除|删除|移除|已废弃|已退役|历史|归档|曾经|原先|原来|旧路径|不再是|旧文档|deprecated|removed|deleted|no longer/i;
function detect(line) {
  const mention = MENTION_RE.test(line);
  const pointers = [], mentions = [];
  let m; PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(line)) !== null) {
    const p = m[1].replace(/[.,;:)\]]+$/, '');
    (mention ? mentions : pointers).push(p);
  }
  return { pointers, mentions };
}
function calibrate() {
  const cases = [
    ['// 钩子见 tools/verify_renderer_dom.mjs', 1, 0],
    ['// tools/verify_renderer_dom.mjs 已不存在（BUILD-2 实测）', 0, 1],
    ['// 旧路径 tools/legacy_thing.mjs 已移除', 0, 1],
    ['// 见 tools/check_search.mjs（现存）', 1, 0],
    ['// docs/ 已废弃，不再新建散装 md', 0, 0],
    ['// 证据在 reports/2026-10-15-wave3/doc4.txt', 1, 0],
    ['// 原文写的 tools/verify_renderer_styles.mjs 按所有者指令删除（放宽后的新形态）', 0, 1],
    ['// 已知边界（标记与路径同段才可靠）：见 tools/x.mjs；删除它的理由见 §3', 0, 1],
    ['// 包内相对：doc5-paths.mjs 里写 fixtures/x.json 而该文件在包内（校准解析）', 1, 0],
  ];
  let bad = 0;
  console.log('【第五维尺子校准 --calibrate（判据：指向 vs 提及）】');
  for (const [line, wp, wm] of cases) {
    const r = detect(line);
    const ok = r.pointers.length === wp && r.mentions.length === wm;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' 期望 指向' + wp + '/提及' + wm + ' 实得 指向' + r.pointers.length + '/提及' + r.mentions.length + '  ' + line.slice(0, 70));
  }
  console.log('  ⇒ 校准' + (bad === 0 ? '**通过**' : '**失败（输出不予采信）**'));
  return bad === 0;
}
if (process.argv.slice(2).includes('--calibrate')) process.exit(calibrate() ? 0 : 1);
// 具名例外（**已裁定为合法提及**，逐条注明裁定人/理由）—— 不用它去「消数字」，而是让验收口径诚实可见。
const ADJUDICATED = [
  // 2026-10-16 Lead 裁定：TASKS.md 里的是 **U33 卡文正文**（在描述「该钩子的守卫已不在」），属合法提及，保留；
  //   只豁免**这一处**：同一路径在 AGENTS.md:116 的引用仍是真悬挂（等 U34 由所有者改）。
  { path: 'apps/desktop/src/preload/index.js', inFile: 'TASKS.md' },
  // 2026-10-16 Lead 裁定（**U34**）：AGENTS.md 只有所有者能改 ⇒ 这处悬挂**不在我的写入面**，等所有者改；
  //   规则本意未变（sandbox: true 不加载 ESM ⇒ 产物必须 .cjs），那条由门禁守着。
  { path: 'apps/desktop/src/preload/index.js', inFile: 'AGENTS.md' },
  // 2026-10-16 Lead 裁定（同类先例）：TASKS.md 里那条是**纪律 21 的教学引文**（必须原样引用当初被误判的串）⇒ 合法提及。
  { path: 'docs/MIGRATION-PLAN.md', inFile: 'TASKS.md' },
];
const isAdjudicated = (p, rel) => ADJUDICATED.some((a) => a.path === p && rel.includes(a.inFile));
// 多基准解析：路径可能相对**仓库根**、相对**该文件目录**、或相对**最近的包根**（package.json 所在目录）。
// ⚠️ 不做这一步会把 `src/uid.ts` 这类**包内相对路径**误判成悬挂（校准里加了这一条）。
function resolvesFrom(relFile, p) {
  const cands = [path.join(ROOT, p), path.join(ROOT, path.dirname(relFile), p)];
  let d = path.dirname(path.join(ROOT, relFile));
  while (d.startsWith(ROOT)) { cands.push(path.join(d, p)); if (fs.existsSync(path.join(d, 'package.json'))) break; const up = path.dirname(d); if (up === d) break; d = up; }
  return cands.some((c) => fs.existsSync(c));
}
const files = fs.readdirSync(ROOT).filter((f) => isScanned(f) && fs.statSync(f).isFile());
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name) || e.name.startsWith('_')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (isScanned(e.name)) files.push(path.relative(ROOT, p)); } }
for (const d of fs.readdirSync(ROOT)) { if (!fs.statSync(d).isDirectory() || SKIP.has(d)) continue; walk(d); }
let dangling = 0, okExist = 0, mentions = 0, adjudicated = 0;
const byPath = new Map(), rows = [];
for (const rel of files) {
  let txt; try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    const r = detect(line);
    mentions += r.mentions.length;
    for (const p of r.pointers) {
      if (resolvesFrom(rel, p)) { okExist++; continue; }
      if (isAdjudicated(p, rel)) { adjudicated++; continue; }
      dangling++;
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(rel.replace(/\\/g, '/') + ':' + (i + 1));
      rows.push(rel.replace(/\\/g, '/') + ':' + (i + 1) + '  ->  ' + p);
    }
  });
}
console.log('【第五维：仓库路径**指向**（提及已按判据排除）】');
console.log('  存在的指向 = ' + okExist + ' · **悬挂指向 = ' + dangling + '**（去重路径 ' + byPath.size + ' 个）· 判为提及 = ' + mentions + ' · 已裁定例外 = ' + adjudicated);
for (const [p, locs] of [...byPath.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('  · ' + p + '  ← ' + locs.length + ' 处: ' + locs.slice(0, 4).join(', ') + (locs.length > 4 ? ' …' : ''));
}
fs.writeFileSync(path.join(ROOT, 'data', '_doc5-paths.txt'), rows.join('\n'), 'utf8');
console.log('  明细已写 data/_doc5-paths.txt（' + rows.length + ' 行）');
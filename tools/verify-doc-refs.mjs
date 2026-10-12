#!/usr/bin/env node
// tools/verify-doc-refs.mjs —— 全仓文档引用解算（只读守卫）
//
// 为什么需要它：`tools/verify_docs.py` 随 Python 档退役被删（见 docs/DEBT-CLEANUP.md §十二），
// 于是"文档里引用的文件是否真的存在"就没人查了。2026-10-10 文档从仓库根整体搬进 docs/，
// 一次改写了 220 处引用 —— 没有这条守卫，改错一处没人会发现，直到有人点进死链接。
//
// 它做什么：
//   1. 扫全仓文本文件里的 `.md` 引用（跳过 node_modules/.git/out/data 与 archive/）
//   2. 把每处引用都**解算一遍**，解算顺序模拟人的直觉：
//        a) 相对**所在文件目录**（`reports/README.md` 里的 `C-quality.md` 指同目录兄弟）
//        b) 再逐级向上到仓库根（`docs/spec/x.md` 里的 `docs/README.md` 能解到）
//   3. 顺带检查根目录是否只剩"入口 + 治理"文件（防止文档又悄悄堆回根目录）
//
// 两类**刻意不报**的东西（误报会让人不再信任守卫）：
//   · 围栏代码块（```）里的内容：那是示例命令，不是引用
//   · 行内代码（`radius.md`）：设计令牌名恰好形如 xxx.md，不是文件
//
// 退出码：有死引用或根目录越界 → 1；否则 0。纯只读，不写任何文件。
//
// 用法：node tools/verify-doc-refs.mjs [--verbose]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 packages/engine/src/engine.mjs）');
    p = up;
  }
})();

const VERBOSE = process.argv.includes('--verbose');

const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.json', '.html', '.yml', '.yaml', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.npm-cache', 'out', 'data', 'dist', 'release', 'archive']);

// 允许"故意指向不存在"的引用（历史名、外部资料）
const ALLOW = [/^plan\.md$/, /^C-quality\.md$/]; // C-quality 在 reports/ 内的兄弟引用由解算处理

const REF = /(?<![\w/.-])((?:[A-Za-z0-9_.\u4e00-\u9fff-]+\/)*[A-Za-z0-9_.\u4e00-\u9fff-]+\.md)/g;

function* walkText(dir = ROOT) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walkText(path.join(dir, e.name));
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      yield path.join(dir, e.name);
    }
  }
}

const norm = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** 去掉围栏代码块与行内代码，避免把示例/令牌名当成引用 */
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' ')) // 保行号
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/** 按"所在目录 → 逐级向上到仓库根"解算 */
function resolveRef(fromFile, ref) {
  let dir = path.dirname(fromFile);
  for (;;) {
    const cand = path.join(dir, ref.split('/').join(path.sep));
    if (fs.existsSync(cand)) return norm(cand);
    if (dir === ROOT) return null;
    const up = path.dirname(dir);
    if (up === dir || dir.length < ROOT.length) return null;
    dir = up;
  }
}

function main() {
  const dead = [];
  const loose = []; // 解到了，但不是"仓库根相对"的直解 —— 提醒改成规范写法
  let checked = 0;

  for (const file of walkText()) {
    const rel = norm(file);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = stripCode(text).split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(REF)) {
        const ref = m[1];
        if (ALLOW.some((re) => re.test(ref))) continue;
        checked++;
        // 1) 仓库根直解（规范写法）
        if (fs.existsSync(path.join(ROOT, ref.split('/').join(path.sep)))) continue;
        // 2) 相对所在文件解算（也合法，可能是同目录兄弟）
        const via = resolveRef(file, ref);
        if (via) {
          if (VERBOSE && ref.includes('/') === false && via.includes('/')) {
            loose.push({ from: rel, line: i + 1, ref, via });
          }
          continue;
        }
        dead.push({ from: rel, line: i + 1, ref });
      }
    });
  }

  console.log('=== 1) 文档引用解算 ===');
  console.log(`  扫描引用 ${checked} 处`);
  if (dead.length) {
    console.log(`  **死引用 ${dead.length} 处**：`);
    for (const d of dead) console.log(`    ${d.from}:${d.line}  →  ${d.ref}`);
  } else {
    console.log('  ✓ 无死引用');
  }
  if (VERBOSE && loose.length) {
    console.log(`\n  （相对解算 ${loose.length} 处 —— 可解，建议改写成仓库根相对）`);
    for (const l of loose.slice(0, 15)) console.log(`    ${l.from}:${l.line}  ${l.ref} → ${l.via}`);
  }

  console.log('\n=== 2) 根目录是否只剩"入口 + 治理" ===');
  const rootDocs = fs.readdirSync(ROOT).filter((n) => n.endsWith('.md')).sort();
  const ALLOWED_ROOT = new Set(['AGENTS.md', 'README.md']);
  console.log(`  根目录 .md：${rootDocs.join(' · ')}`);
  const strays = rootDocs.filter((n) => !ALLOWED_ROOT.has(n));
  if (strays.length) {
    console.log(`  !! ${strays.length} 份不该留在根目录：${strays.join(', ')}（正文应放 docs/）`);
  } else {
    console.log('  ✓ 只有入口与行动依据');
  }

  console.log('\n=== 3) docs/ 结构 ===');
  const docsDir = path.join(ROOT, 'docs');
  for (const sub of ['', 'plan', 'spec', 'design']) {
    const d = path.join(docsDir, sub);
    if (!fs.existsSync(d)) continue;
    const files = fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort();
    if (files.length) console.log(`  docs/${sub ? sub + '/' : ''}  ${files.join(' · ')}`);
  }

  const fail = dead.length > 0 || strays.length > 0;
  console.log(`\n${fail ? '**未通过**' : '全部通过'}：死引用 ${dead.length} · 根目录越界 ${strays.length}`);
  return fail ? 1 : 0;
}

process.exit(main());

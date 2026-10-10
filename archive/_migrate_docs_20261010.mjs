#!/usr/bin/env node
// tools/migrate-docs.mjs —— 把正文文档从仓库根收进 docs/，并同步改写全仓引用
//
// 用法：
//   node tools/migrate-docs.mjs            # dry-run（默认，不改任何东西）
//   node tools/migrate-docs.mjs --apply    # 真的移动 + 改写
//
// 两条纪律（沿用本仓库既有的"归类脚本"风格）：
//   1. 每个目标文件都必须存在于预期位置，否则**大声失败**，不静默放过。
//   2. **引用要一起改** —— 文档不能靠"读者自己找"。全仓 200+ 处引用必须同步，
//      否则死引用立刻超标（这正是被删掉的 verify_docs.py 第 1 节在查的东西）。
//
// 分法（对齐同类项目惯例：根目录只留入口，正文进 docs/）：
//   留根：  README.md（入口）· PROJECT-GUIDE.md（零基础导航）
//          TASK-PLAN.md（⭐ 唯一行动依据，刻意留根 —— 它被引用最多，移动它收益最低风险最高）
//   docs/plan/    PRE-KICKOFF-CHECK.md
//   docs/spec/    SPEC-* · CONTRACT-engine-v1
//   docs/design/  DESIGN-* · UI-REVIEW-and-migration
//   docs/          DEBT-CLEANUP.md
//
// 相对路径一律写成**仓库根相对**（docs/spec/SPEC-app.md），不用 `../`：
// 这些引用散落在根、src/、tools/、reports/ 等不同深度下，`../` 会随深度变化，
// 而仓库根相对写法全局一致，且不会因为文件再搬一次就失效。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 项目根：向上找到含 core/engine.mjs 的那一级（搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'core', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 core/engine.mjs）');
    p = up;
  }
})();

/** 旧名（仓库根）→ 新位置（仓库根相对，POSIX） */
const MOVES = {
  'PRE-KICKOFF-CHECK.md': 'docs/plan/PRE-KICKOFF-CHECK.md',
  'SPEC-app.md': 'docs/spec/SPEC-app.md',
  'SPEC-identity.md': 'docs/spec/SPEC-identity.md',
  'SPEC-security.md': 'docs/spec/SPEC-security.md',
  'SPEC-transactions.md': 'docs/spec/SPEC-transactions.md',
  'SPEC-acceptance.md': 'docs/spec/SPEC-acceptance.md',
  'CONTRACT-engine-v1.md': 'docs/spec/CONTRACT-engine-v1.md',
  'DESIGN-tokens.md': 'docs/design/DESIGN-tokens.md',
  'DESIGN-app-details.md': 'docs/design/DESIGN-app-details.md',
  'UI-REVIEW-and-migration.md': 'docs/design/UI-REVIEW-and-migration.md',
  'DEBT-CLEANUP.md': 'docs/DEBT-CLEANUP.md',
};

/** 改了名要顺带修的字面量 */
const EXTRA_FIXES = [
  [
    '| `README.md` | 入口：当前状态 + 文档索引 + 现有检索档说明 |',
    '| `README.md` | 入口：当前状态（技术版） |\n' +
      '| `PROJECT-GUIDE.md` | 零基础结构总览：框架图 / 目录职责 / 新文件该放哪儿 |\n' +
      '| `docs/README.md` | **文档索引与权威关系** |',
  ],
];

const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.json', '.html', '.yml', '.yaml', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.npm-cache', 'out', 'data', 'dist', 'release']);

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

function main() {
  const apply = process.argv.includes('--apply');

  // 长名优先：避免 SPEC-app.md 命中 SPEC-app-details.md 的前缀
  const order = Object.entries(MOVES).sort((a, b) => b[0].length - a[0].length);
  // 只改**裸文件名**引用：前面不能已经是路径分隔符或词字符（否则 docs/ 前缀会被重复加）
  const matchers = order.map(([old, nw]) => [
    new RegExp('(?<![\\w/\\\\.-])' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    nw,
  ]);

  console.log(`=== 1) 迁移计划（${Object.keys(MOVES).length} 份）===`);
  let problems = 0;
  for (const [old, nw] of Object.entries(MOVES)) {
    const src = path.join(ROOT, old);
    const dst = path.join(ROOT, nw.split('/').join(path.sep));
    if (!fs.existsSync(src) && !fs.existsSync(dst)) {
      console.log(`  !! 两处都不存在：${old}`);
      problems++;
      continue;
    }
    const where = fs.existsSync(dst) && !fs.existsSync(src) ? '已在目标位' : '待移动';
    console.log(`  ${old.padEnd(28)} → ${nw.padEnd(34)} ${where}`);
  }
  if (problems) {
    console.log('\n有问题，未改动任何文件。');
    return 1;
  }

  console.log('\n=== 2) 引用改写 ===');
  const plan = [];
  let total = 0;
  for (const file of walkText()) {
    const rel = norm(file);
    if (rel === 'tools/migrate-docs.mjs') continue; // 本脚本自己
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const orig = text;
    let hits = 0;
    for (const [re, nw] of matchers) {
      const m = text.match(re);
      if (m) {
        hits += m.length;
        text = text.replace(re, nw);
      }
    }
    for (const [o, n] of EXTRA_FIXES) {
      if (text.includes(o)) {
        text = text.replace(o, n);
        hits++;
      }
    }
    if (text !== orig) {
      plan.push({ file, rel, text, hits });
      total += hits;
    }
  }
  plan.sort((a, b) => b.hits - a.hits);
  for (const p of plan) console.log(`  ${p.rel.padEnd(52)} ${String(p.hits).padStart(3)} 处`);
  console.log(`  合计 ${total} 处引用，涉及 ${plan.length} 个文件`);

  if (!apply) {
    console.log('\n（dry-run：未改动。加 --apply 执行）');
    return 0;
  }

  console.log('\n=== 3) 执行 ===');
  // 先改写引用（此时旧文件还在，写回不会丢内容），再移动
  for (const p of plan) {
    fs.writeFileSync(p.file, p.text, 'utf8');
  }
  console.log(`  引用改写 ${plan.length} 个文件`);
  for (const [old, nw] of Object.entries(MOVES)) {
    const src = path.join(ROOT, old);
    const dst = path.join(ROOT, nw.split('/').join(path.sep));
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      fs.rmSync(src);
      console.log(`  移动 ${old} → ${nw}`);
    }
  }

  console.log('\n完成。**接着必须**跑一次全仓引用解算（见 tools/verify-doc-refs.mjs）。');
  return 0;
}

process.exit(main());

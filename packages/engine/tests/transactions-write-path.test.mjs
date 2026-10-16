// packages/engine/tests/transactions-write-path.test.mjs —— 规格 §9 的机械断言
//
// 规格原文（`SPEC.md` §2.1 写入不变式）：
//   「引擎**唯一**允许写文件的路径是事务执行器；**任何其它代码不得直接 `fs.rename`/`fs.unlink` 素材文件**。
//    （用一条单测/静态检查守住这条：搜 `unlink`/`rename` 只允许出现在
//      `packages/engine/src/transactions/` 目录内 —— 该目录尚未创建。）」
//
// ── 判据为什么必须写成 `fs.<api>(` 而不是裸搜 `rename` ─────────────────────
//   实测：`fake.ts:480` 有 `const op = req.op || 'rename'`、`:486` 有 `{ rename: '改 ID' }`
//   —— 那是**操作名**，不是文件系统调用。裸搜 `rename` 会立刻假阳性。
//  ── 为什么要剥注释 ────────────────────────────────────────────────────────
//   这几个文件注释很密，"禁止 fs.rename" 这类说明本身就会命中裸搜。
//   假阳性的代价是真实的：它会逼人不敢写注释，最后这条检查被人关掉。
//   ⇒ **复用** `apps/desktop/tests/helpers/source-scan.mjs`（全仓唯一一份剥注释扫描器），
//     而不是在这里再写第二份（P1）。它是纯 Node，不违反"引擎零第三方依赖"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findInCode } from '../../../apps/desktop/tests/helpers/source-scan.mjs';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const TXN_DIR = 'transactions';

/** **破坏性**的文件系统调用：会改变/移除已存在的文件。这些才是能弄丢素材的操作。 */
const DESTRUCTIVE =
  /fs\s*\.\s*(rename|renameSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\s*\(/g;

/** 递归收集 `src/` 下的 .ts（用 fs.readdirSync，避免引入 glob 依赖） */
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 扫出命中 `re` 的文件（相对 src/ 的路径 + 行号） */
function scan(re) {
  const hits = [];
  for (const abs of walk(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    for (const h of findInCode(fs.readFileSync(abs, 'utf8'), re)) {
      hits.push({ file: rel, line: h.line });
    }
  }
  return hits;
}

test('TX-W1 ⭐⭐ 破坏性写操作（rename/unlink/rm）只允许出现在 `src/transactions/`（规格 §9）', () => {
  const hits = scan(DESTRUCTIVE);
  const outside = hits.filter((h) => !h.file.startsWith(TXN_DIR + '/'));
  assert.deepEqual(
    outside,
    [],
    `引擎里只有 ${TXN_DIR}/ 可以出现破坏性写调用（§9）。越界的：\n    ` +
      outside.map((h) => `${h.file}:${h.line}`).join('\n    '),
  );
});

test('TX-W2 断言**不是空的**：transactions/ 里确实用到了这些 API（否则上面那条恒真）', () => {
  const inside = scan(DESTRUCTIVE).filter((h) => h.file.startsWith(TXN_DIR + '/'));
  assert.ok(
    inside.length > 0,
    'transactions/ 里一个破坏性写调用都没有 ⇒ 要么实现被删了，要么正则失效了 —— 两种都得查',
  );
  // 具体到我们确实依赖的两个：rename staging→最终名、unlink 源文件
  const files = new Set(inside.map((h) => h.file));
  assert.ok(files.has(`${TXN_DIR}/steps.ts`), 'steps.ts 应包含 rename/unlink（共享原语）');
  assert.ok(files.has(`${TXN_DIR}/journal.ts`), 'journal.ts 应包含 rename（原子落盘）');
});

test('TX-W3 ⭐ 判据**能红**：往 `engine.ts` 注入一行 fs.renameSync ⇒ 必须被扫出来', () => {
  // 内存注入，不动磁盘（真·双向验证见 reports/ 里记录的"注入 → npm test 变红"）
  const injected =
    "import fs from 'node:fs'\nexport function x(p, q) {\n  fs.renameSync(p, q)\n}\n";
  const hits = findInCode(injected, DESTRUCTIVE);
  assert.equal(hits.length, 1, '注入的越界写调用必须被扫到，否则 TX-W1 是空断言');
  assert.equal(hits[0].line, 3);

  // 反向：**注释里**的同样一行不该命中（否则检查会满屏假阳性，最后被人关掉）
  assert.equal(findInCode('// 这里绝不能写 fs.renameSync\n', DESTRUCTIVE).length, 0);
  // 反向：op 名字符串不该命中（`fake.ts:480` 的实测形态）
  assert.equal(
    findInCode("const op = req.op || 'rename'\n", DESTRUCTIVE).length,
    0,
    '操作名 `rename` 不是文件系统调用 —— 裸搜会在这里假阳性',
  );
  assert.equal(findInCode("const LABEL = { rename: '改 ID' }\n", DESTRUCTIVE).length, 0);
});

test('TX-W4 如实钉住边界：`collect` 会在**库外**（取件目录）新增文件，不属 §9 的"写素材文件"', () => {
  // ⚠️ 这是一处**如实记录的边界**，不是"已经解决"：
  //    §9 讲的是"不得直接 rename/unlink **素材文件**"，而 `collect`（取件）做的是
  //    `mkdirSync(取件目录)` + `copyFileSync(..., COPYFILE_EXCL)` —— **复制到库外**、且绝不覆盖。
  //    它确实写文件，所以不能被说成"引擎从不写文件"；但它不是破坏性操作、也不碰素材库。
  //    下面把当前事实**钉住**：除 transactions/ 外，写文件的只有 engine.ts 这一个（collect）。
  //    将来若在别处新增写文件点，这条会红 —— 那时必须显式判断它属于哪一类。
  const COPYISH =
    /fs\s*\.\s*(copyFile|copyFileSync|mkdir|mkdirSync|writeFile|writeFileSync|appendFile|appendFileSync)\s*\(/g;
  const outside = scan(COPYISH).filter((h) => !h.file.startsWith(TXN_DIR + '/'));
  const files = [...new Set(outside.map((h) => h.file))].sort();
  assert.deepEqual(
    files,
    ['engine.ts'],
    '除 transactions/ 外，引擎里写文件的地方只应有 engine.ts（collect 的取件目录）。' +
      `实际：${files.join(', ')} —— 若新增了写文件点，请先判断它是否属于 §9 的"写素材文件"`,
  );
});

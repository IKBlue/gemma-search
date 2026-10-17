// apps/desktop/tests/search-history-write.test.mjs —— FR-012：搜索历史的**写入口**
//
// 为什么单独一文件：`recent_query` 此前**只有读路径**（HIST-1）、**没有任何写路径** ——
// 也就是说"搜索历史"这个功能一直只有半个（表 + IPC + 单测都在，但没人写它）。
// 本文件钉住写入口的四条口径（见 `main/search-history.ts` 文件头）：
//   W1 只记成功的 text/image 检索（vector 通道没有可重放输入 ⇒ 不记；空文本不记出空历史）；
//   W2 字段如实：image 记 uid（不是路径）· 单库才记 scope_lib_id（多库/未指定 = NULL）· 命中数取不到就 NULL；
//   W3 记历史失败**绝不改判检索** —— 本模块**永不抛**，失败返回非空 warning；
//   W4 「只有一处写 `recent_query`」（静态 + 与 D4 同一条纪律）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openAppDb } from '../src/main/app-db.ts';
import { recordSearchQuery } from '../src/main/search-history.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_fr012', 'h-' + process.pid);

let seq = 0;
function freshDir(label) {
  const d = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** 读原始行（读路径不返回 image_ref，所以这一条直接开库读 —— 只读，不写） */
function rawRows(userDataDir) {
  const app = openAppDb({ userDataDir });
  try {
    return app.db.prepare('SELECT * FROM recent_query ORDER BY at_ms DESC').all();
  } finally {
    app.db.close();
  }
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时 */
  }
});

test('W1 ⭐⭐ 只记成功的 text/image 检索：text 的文本会 trim；vector 通道与空文本**不记**', () => {
  const userDataDir = freshDir('W1');
  // text：前后空白要 trim（存"当时用户看到的那句话"）
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [{ uid: 'a' }, { uid: 'b' }] },
      params: { mode: 'text', text: '  玻璃球吊灯  ' },
    }),
    null,
  );
  // vector：低层通道，没有可重放的输入 ⇒ 不记（记了也没法重跑）
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [] },
      params: { mode: 'vector', vector: [1, 2, 3] },
    }),
    null,
  );
  // 空文本：防御性不记（不造一条点了没反应的"空历史"）
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [] },
      params: { mode: 'text', text: '   ' },
    }),
    null,
  );

  const rows = rawRows(userDataDir);
  assert.equal(rows.length, 1, '只有那一条 text 检索被记下');
  assert.equal(rows[0].kind, 'text');
  assert.equal(rows[0].text, '玻璃球吊灯', '要 trim，存用户实际看到的那句');
  assert.equal(rows[0].result_count, 2, '命中数 = results.length');
  assert.equal(rows[0].image_ref, null);
});

test('W2 ⭐⭐ 字段如实：image 记 **uid**（不是路径）· 单库才记 scope · 命中数取不到就 NULL', () => {
  const userDataDir = freshDir('W2');
  // 以图搜图（库内参考图）：image_ref = uid
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [{}] },
      params: { mode: 'image', imageRef: { libId: 'L1', uid: 'abcdef012345' }, libIds: ['L1'] },
    }),
    null,
  );
  // 以图搜图（库外文件）：没有 uid ⇒ NULL 是如实（不编一个假 uid）
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [] },
      params: { mode: 'image', queryImagePath: 'X:\\tmp\\a.png' },
    }),
    null,
  );
  // 文本 + 多库范围 ⇒ scope_lib_id = NULL（"全部库"）
  assert.equal(
    recordSearchQuery({
      userDataDir,
      data: { results: [] },
      params: { mode: 'text', text: '吊灯', libIds: ['L1', 'L2'] },
    }),
    null,
  );
  // 文本 + 命中数拿不到（data 形状不认识）⇒ NULL，不编 0
  assert.equal(
    recordSearchQuery({ userDataDir, data: null, params: { mode: 'text', text: '吊灯' } }),
    null,
  );

  const rows = rawRows(userDataDir);
  assert.equal(rows.length, 4);
  const imageInLib = rows.find((r) => r.kind === 'image' && r.image_ref !== null);
  assert.ok(imageInLib, '库内以图搜图必须记下 image_ref');
  assert.equal(imageInLib.image_ref, 'abcdef012345', '存 uid，不存绝对路径');
  assert.equal(imageInLib.scope_lib_id, 'L1', '单库范围要记下来（重跑时才能还原范围）');
  const imageOutLib = rows.find((r) => r.kind === 'image' && r.image_ref === null);
  assert.ok(imageOutLib, '库外参考图：image_ref 保持 NULL（如实）');
  const multi = rows.find((r) => r.kind === 'text' && r.scope_lib_id === null);
  assert.ok(multi, '多库范围 ⇒ scope_lib_id = NULL（不是随便取第一个）');
  const noCount = rows.find((r) => r.kind === 'text' && r.result_count === null);
  assert.ok(noCount, '命中数取不到 ⇒ NULL（不编 0）');
});

test('W3 ⭐⭐ 记历史失败**绝不改判检索**：本模块永不抛，失败返回非空 warning', () => {
  // ① userData 未就绪（应用还没准备好）
  const w1 = recordSearchQuery({
    userDataDir: null,
    data: { results: [] },
    params: { mode: 'text', text: 'x' },
  });
  assert.equal(typeof w1, 'string');
  assert.ok(w1.length > 0, '必须给出可展示的说明');
  // ② app.db 打不开（拿文件当目录 —— Windows/Linux 上 mkdir 都会失败）
  const userDataDir = freshDir('W3');
  fs.writeFileSync(path.join(userDataDir, 'blocker'), 'x');
  const broken = path.join(userDataDir, 'blocker');
  let threw = null;
  let w2 = null;
  try {
    w2 = recordSearchQuery({
      userDataDir: broken,
      data: { results: [] },
      params: { mode: 'text', text: 'x' },
    });
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, '**不许把异常漏给调用方**（检索已经成功了）');
  assert.equal(typeof w2, 'string');
  assert.ok(w2.length > 0);
});

test('W4 ⭐⭐ 唯一写入口（静态）：全仓只有 `app-db.ts` 写 `recent_query`', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(MAIN);
  const writers = files
    .filter((f) =>
      /(INSERT\s+(OR\s+\w+\s+)?INTO\s+recent_query\b)|(UPDATE\s+recent_query\b)|(DELETE\s+FROM\s+recent_query\b)/i.test(
        fs.readFileSync(f, 'utf8'),
      ),
    )
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(writers, ['app-db.ts'], 'recent_query 的写入口只能有 app-db.ts（§2.3）');
});

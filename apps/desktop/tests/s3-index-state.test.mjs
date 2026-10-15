// apps/desktop/tests/s3-index-state.test.mjs —— S3b：把「索引 ↔ asset_index_state 对账」钉进常规门禁
//
// 为什么要有它：S3 的结论（对账漂移 = 0）原来只在 gitignore 的 data/_schema100 里可复跑；
// 这条单测把同一份判定搬进 npm test —— 判定**共用** reports/2026-10-15-wave3/s3-reconcile.mjs，
// 不是在这里再写一份 SQL（AGENTS P1：同一概念不许两份定义）。
//
// 夹具缺失时**显式 skip 并打印原因**（不是静默通过）：data/_schema100 是本机夹具，别的机器上没有；
// 参照 perf 那套 GEMMA_PERF 先例 —— 跳过可以，但必须说清楚"跳过了什么、为什么、怎么补"。
// 覆盖夹具落点：GEMMA_S3_LIB（库根）· GEMMA_S3_META（索引 header）。
//
// 跑法：node --test apps/desktop/tests/s3-index-state.test.mjs （也在 npm test 的 glob 里）
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openGsDb } from '../src/main/db/index.ts';
import { readIndexFile } from '../src/main/index-file.ts';
import { reconcile, summarize } from '../../../reports/2026-10-15-wave3/s3-reconcile.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIB = process.env.GEMMA_S3_LIB
  ? path.resolve(process.env.GEMMA_S3_LIB)
  : path.join(ROOT, 'data', '_schema100', 'lib');
const META_PATH = process.env.GEMMA_S3_META
  ? path.resolve(process.env.GEMMA_S3_META)
  : path.join(ROOT, 'data', '_schema100', 'out', 'meta.json');
const DB_PATH = path.join(LIB, '.gs.db');
const INDEX = path.join(LIB, '.gs-index.bin');
const TMP = path.join(ROOT, 'data', '_t63', 's3-state-' + process.pid);
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const missing = [DB_PATH, INDEX, META_PATH].filter((p) => !fs.existsSync(p));
const hasFixture = missing.length === 0;
const SKIP_REASON =
  'S3 夹具不存在：缺 ' +
  JSON.stringify(missing) +
  ' —— data/_schema100 是本机夹具（gitignore 的 data/_*），' +
  '先跑 node reports/2026-10-15-wave3/s3-verify.mjs state 生成索引与编码态再来。本用例**显式跳过**，不代表通过。';

/** 夹具里的索引 header（build_index_onnx 的 meta.json） */
const readMeta = () => JSON.parse(fs.readFileSync(META_PATH, 'utf8'));

test('S3b ⭐ 索引 ↔ asset_index_state 对账漂移 = 0（夹具缺失则显式 skip）', (t) => {
  if (!hasFixture) {
    console.log('SKIP: ' + SKIP_REASON);
    t.skip(SKIP_REASON);
    return;
  }
  const meta = readMeta();
  const rep = readIndexFile(LIB); // 产品路径：引擎五道校验（唯一那份解析）
  assert.equal(rep.count, 100, '索引应为 100 行，实得 ' + rep.count);
  assert.equal(rep.dim, 768, '索引应为 768 维，实得 ' + rep.dim);
  const db = openGsDb({ dbPath: DB_PATH, readOnly: true }).db;
  try {
    const rec = reconcile(db, meta, LIB);
    for (const l of summarize(rec, meta)) t.diagnostic(l);
    assert.deepEqual(rec.problems, [], '对账漂移必须为 0：' + JSON.stringify(rec.problems));
    assert.equal(rec.nonNull, rec.indexRows, 'vector_row 非空行数必须 == 索引行数');
    assert.equal(rec.pending, 0, 'needs_reencode(派生) 必须为 0');
    assert.equal(rec.statDrift, 0, '与磁盘 stat 漂移必须为 0');
  } finally {
    db.close();
  }
});

test('S3b ⭐⭐ 能红：在**副本**里注入 vector_row 越界 ⇒ 对账必须报错（产品夹具只读）', (t) => {
  if (!hasFixture) {
    console.log('SKIP: ' + SKIP_REASON);
    t.skip(SKIP_REASON);
    return;
  }
  const dir = path.join(TMP, 'corrupt-copy');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // 连 -wal / -shm 一起拷：WAL 里可能还有未 checkpoint 的内容（本机实测 -wal=0，也照样这么做）
  for (const suffix of ['', '-wal', '-shm']) {
    const src = DB_PATH + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, '.gs.db' + suffix));
  }
  const db = openGsDb({ dbPath: path.join(dir, '.gs.db') }).db;
  try {
    const victim = db.prepare('SELECT uid FROM asset_index_state WHERE vector_row = 0').get();
    assert.ok(victim, '夹具前提：应存在 vector_row = 0 的行');
    db.prepare('UPDATE asset_index_state SET vector_row = 999 WHERE uid = ?').run(victim.uid);
    const rec = reconcile(db, readMeta(), LIB);
    t.diagnostic(
      '注入 uid=' +
        victim.uid +
        ' 的 vector_row 0 -> 999 后 problems = ' +
        JSON.stringify(rec.problems),
    );
    assert.ok(rec.problems.length > 0, 'vector_row 越界必须被对账抓到（否则这条单测没有鉴别力）');
    assert.match(rec.problems.join('；'), /vector_row/, '报的必须是 vector_row 口径的问题');
  } finally {
    db.close();
  }
});

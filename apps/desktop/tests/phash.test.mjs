// apps/desktop/tests/phash.test.mjs —— PHASH-1a：dHash 算法 + 存储/回填/读
//
// 钉住三条：
//   P1 纯算法：同一张图（含 ±1 量化差 = 重采样后的近似）⇒ 汉明 **0/≤2**；不同图 ⇒ **远大于**阈值；
//   P2 **坏图/缺图 ⇒ NULL**（**绝不写 0 哈希** —— 写成 0 会让坏图和所有图都像）；
//   P3 回填**幂等 + 不静默**（每条回调 onProgress）、中断重跑不重算已完成的。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openGsDb } from '../src/main/db/open.ts';
import { backfillPhash, listPhashPending, readPhash, writePhash } from '../src/main/db/phash.ts';
import { dHashHex, hammingHex, PHASH_GRAY_BYTES } from '../src/main/phash.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_phash1', 'p-' + process.pid);
const T0 = 1700000000000;
let seq = 0;
function freshLib(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, '.gs.db');
  const opened = openGsDb({ dbPath, now: () => T0 });
  const add = (uid, rel) => {
    opened.db
      .prepare(
        'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', rel, T0);
    opened.db
      .prepare(
        "INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?, 'preview', ?, '.jpg', 1, ?)",
      )
      .run(uid, rel, T0);
  };
  return { dir, opened, add };
}
/** 递增斜坡灰度：每行严格递增 ⇒ dHash 全 1（对 ±1 量化差稳健） */
function ramp(delta = 0) {
  const g = new Uint8Array(PHASH_GRAY_BYTES);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 9; c++) g[r * 9 + c] = Math.min(255, 20 + c * 10 + delta);
  return g;
}
/** 棋盘格：比较相邻像素交替 ⇒ 与斜坡完全不同 */
function checker() {
  const g = new Uint8Array(PHASH_GRAY_BYTES);
  for (let i = 0; i < g.length; i++) g[i] = i % 2 === 0 ? 255 : 0;
  return g;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时 */
  }
});

test('P1 ⭐⭐ dHash：同图（含 ±1 重采样量化差）汉明 0/≤2；不同图远大于阈值', () => {
  const a = dHashHex(ramp(0));
  const b = dHashHex(ramp(1)); // 模拟重采样后的 ±1 量化差
  assert.equal(a.length, 16);
  const d = hammingHex(a, b);
  assert.notEqual(d, null);
  assert.ok(d <= 2, '同图缩放的近似版本必须 ≤2，实得 ' + String(d));
  const far = hammingHex(a, dHashHex(checker()));
  assert.ok(far > 20, '不同图必须远大于阈值（实得 ' + String(far) + '）');
  assert.equal(hammingHex(null, a), null, 'NULL（未知）返回 null，不是 0');
  assert.throws(() => dHashHex(new Uint8Array(10)), /9×8/);
});

test('P2 ⭐⭐ 坏图/缺图 ⇒ 存 **NULL**（绝不写 0 哈希；否则坏图会和所有图都像）', async () => {
  const lib = freshLib('P2');
  try {
    lib.add('aa0000000001', 'CR/good.jpg');
    lib.add('aa0000000002', 'CR/bad.jpg');
    lib.add('aa0000000003', 'CR/missing.jpg');
    const decode = async (abs) => {
      if (abs.endsWith('good.jpg')) return ramp(0);
      if (abs.endsWith('bad.jpg')) return null; // 解码失败
      throw new Error('ENOENT'); // 缺图/读文件抛错
    };
    const res = await backfillPhash(lib.opened.db, { libRoot: lib.dir, decode });
    assert.deepEqual(res, { done: 1, nulled: 1, failed: 1 });
    assert.equal(readPhash(lib.opened.db, 'aa0000000001').length, 16);
    assert.equal(readPhash(lib.opened.db, 'aa0000000002'), null, '坏图 ⇒ NULL');
    assert.equal(readPhash(lib.opened.db, 'aa0000000003'), null, '缺图 ⇒ NULL');
    for (const uid of ['aa0000000002', 'aa0000000003']) {
      assert.notEqual(readPhash(lib.opened.db, uid), '0'.repeat(16), '绝不写 0 哈希');
    }
  } finally {
    lib.opened.db.close();
  }
});

test('P3 ⭐⭐ 回填幂等 + 可断点 + **不静默**（每条回调进度；重跑不重算已完成的）', async () => {
  const lib = freshLib('P3');
  try {
    lib.add('aa0000000001', 'CR/a.jpg');
    lib.add('aa0000000002', 'CR/b.jpg');
    const ticks = [];
    const decode = async () => ramp(0);
    const first = await backfillPhash(lib.opened.db, {
      libRoot: lib.dir,
      decode,
      onProgress: (p) => ticks.push(p.processed),
    });
    assert.equal(first.done, 2);
    assert.deepEqual(ticks, [1, 2], '每条都要回调（不静默）');
    assert.deepEqual(listPhashPending(lib.opened.db, 10), [], '全部算完后没有待办');
    const second = await backfillPhash(lib.opened.db, { libRoot: lib.dir, decode });
    assert.deepEqual(second, { done: 0, nulled: 0, failed: 0 }, '重跑不重算（幂等/可断点）');
    // 显式清空一条（模拟"外部把哈希清了"）⇒ 只补那一条
    assert.equal(writePhash(lib.opened.db, 'aa0000000001', null), true);
    const third = await backfillPhash(lib.opened.db, { libRoot: lib.dir, decode });
    assert.equal(third.done, 1, '只补缺的那一条');
  } finally {
    lib.opened.db.close();
  }
});

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
import {
  backfillPhash,
  listPhashPending,
  readPhash,
  readPhashMap,
  writePhash,
} from '../src/main/db/phash.ts';
import { dHashHex, hammingHex, bgraToGray, PHASH_GRAY_BYTES } from '../src/main/phash.ts';

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

// ============================================================ 生产解码链的纯函数部分（PHASH-1a 落地）

test('P4 ⭐⭐ BGRA→灰度：Rec.709 系数 + **通道序**都可断言（纯红 54 / 纯蓝 18 / 纯绿 182）', () => {
  const bgra = new Uint8Array(PHASH_GRAY_BYTES * 4);
  const put = (i, r, g, b) => {
    bgra[i * 4] = b; // B
    bgra[i * 4 + 1] = g; // G
    bgra[i * 4 + 2] = r; // R
    bgra[i * 4 + 3] = 255; // A（不参与 luma）
  };
  put(0, 255, 0, 0); // 纯红 ⇒ round(0.2126×255) = 54
  put(1, 0, 0, 255); // 纯蓝 ⇒ round(0.0722×255) = 18
  put(2, 0, 255, 0); // 纯绿 ⇒ round(0.7152×255) = 182
  put(3, 255, 255, 255); // 白 ⇒ 255
  put(4, 0, 0, 0); // 黑 ⇒ 0
  const gray = bgraToGray(bgra);
  assert.equal(gray[0], 54, '纯红：0.2126×255');
  assert.equal(gray[1], 18, '纯蓝：0.0722×255（与红不同 ⇒ 通道序被这条钉住）');
  assert.equal(gray[2], 182, '纯绿：0.7152×255');
  assert.equal(gray[3], 255);
  assert.equal(gray[4], 0);
  // 形状不对 ⇒ 抛（调用方据此返回 null，绝不伪造哈希）
  assert.throws(() => bgraToGray(new Uint8Array(10)), /9×8/);
});

test('P5 ⭐ 整链等价：把同一张图的灰度写成 BGRA ⇒ bgraToGray 必须逐字节还原 ⇒ dHash 相同', () => {
  const rampGray = ramp(0);
  const bgra = new Uint8Array(PHASH_GRAY_BYTES * 4);
  for (let i = 0; i < PHASH_GRAY_BYTES; i++) {
    const v = rampGray[i];
    bgra[i * 4] = v;
    bgra[i * 4 + 1] = v;
    bgra[i * 4 + 2] = v;
    bgra[i * 4 + 3] = 255;
  }
  const back = bgraToGray(bgra);
  assert.deepEqual(Array.from(back), Array.from(rampGray), '灰度写入再读出必须逐字节相同');
  assert.equal(dHashHex(back), dHashHex(rampGray), '同一画面 ⇒ 同一个哈希');
});

test('P6 ⭐ 批量读 readPhashMap：一条 SQL 取回；NULL 保留为 null；查不到的 uid 不凭空出现', () => {
  const lib = freshLib('P6');
  try {
    lib.add('aa0000000001', 'CR/a.jpg');
    lib.add('aa0000000002', 'CR/b.jpg');
    lib.add('aa0000000003', 'CR/c.jpg');
    const h = dHashHex(ramp(0));
    writePhash(lib.opened.db, 'aa0000000001', h);
    writePhash(lib.opened.db, 'aa0000000002', null); // 显式"算不出来"
    const m = readPhashMap(lib.opened.db, [
      'aa0000000001',
      'aa0000000002',
      'ffffffffffff',
      'aa0000000001',
    ]);
    assert.equal(m.get('aa0000000001'), h);
    assert.equal(m.get('aa0000000002'), null, 'NULL 要如实保留（不是缺键、更不是 0）');
    assert.equal(m.has('ffffffffffff'), false, '库里没有的 uid 不许凭空出现');
    assert.equal(m.size, 2, '重复 uid 去重后只填实际存在的行');
    assert.equal(readPhashMap(lib.opened.db, []).size, 0, '空列表 ⇒ 空 Map（不发 SQL）');
  } finally {
    lib.opened.db.close();
  }
});

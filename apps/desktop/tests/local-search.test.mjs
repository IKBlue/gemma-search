// apps/desktop/tests/local-search.test.mjs —— PRD-1 · LOCAL-1：本地检索 L0（零模型、只读 SQL）
//
// 口径（所有者 2026-10-19）：
//   · ID = uid（12 位精确 / 4–11 位前缀）+ 文件名；
//   · 其余 = display_name/stem/rel_path 的**关键词**（大小写不敏感，%/_ 按字面）；
//   · 只读、多库、分页；缺库**如实报**（DB_MISSING），不返回空表假装"库里没有"。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runFakeLocalSearch, runLocalSearch } from '../src/main/local-search.ts';
import { openGsDb } from '../src/main/db/open.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_local-search', 'p-' + process.pid);
const T0 = 1700000000000;
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时 */
  }
});

let seq = 0;
function makeLib(libId) {
  const root = path.join(TMP, 'lib-' + libId + '-' + String(++seq));
  const legacy = path.join(TMP, 'legacy-' + String(seq));
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(legacy, { recursive: true });
  const dbPath = path.join(root, '.gs.db');
  const opened = openGsDb({ dbPath });
  return {
    libId,
    root,
    legacy,
    dbPath,
    opened,
    close() {
      try {
        opened.db.close();
      } catch {
        /* 已关 */
      }
    },
    /** 插一条 asset + 一条 preview asset_file（够 L0 用） */
    add(uid, relPath, opts = {}) {
      const folder = opts.folder ?? 'CR';
      const ext = opts.ext ?? '.jpg';
      const displayName = opts.displayName ?? path.basename(relPath);
      const stem = opts.stem ?? path.basename(relPath, path.extname(relPath));
      opened.db
        .prepare(
          'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(uid, libId, folder, stem, displayName, '', relPath, T0);
      opened.db
        .prepare(
          "INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?, 'preview', ?, ?, ?, ?)",
        )
        .run(uid, relPath, ext, opts.size ?? 100, opts.mtime ?? T0);
      return { uid, relPath };
    },
  };
}

function search(libs, params) {
  return runLocalSearch(
    {
      libraries: libs.map((l) => ({ libId: l.libId, root: l.root })),
      userDataDir: path.join(TMP, 'userdata'),
      legacyLibrariesDir: path.join(TMP, 'legacy'),
    },
    params,
  );
}

function dataOf(res) {
  assert.equal(res.ok, true, '预期成功，实得：' + JSON.stringify(res));
  return res.data;
}

test('L1 ⭐ ID 精确：12 位 uid 原样命中，hit=uid', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.jpg');
  lib.add('aa0000000002', 'CR/b.jpg');
  try {
    const d = dataOf(search([lib], { query: 'aa0000000001' }));
    assert.equal(d.total, 1);
    assert.equal(d.results.length, 1);
    assert.equal(d.results[0].uid, 'aa0000000001');
    assert.equal(d.results[0].hit, 'uid');
  } finally {
    lib.close();
  }
});

test('L2 ⭐ uid 前缀（4–11 位）+ 允许 # 与大小写：#AA00 ⇒ 前缀命中', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.jpg');
  lib.add('aa0000000002', 'CR/b.jpg');
  lib.add('bb0000000001', 'CR/c.jpg');
  try {
    const d = dataOf(search([lib], { query: '#AA00' }));
    assert.equal(d.total, 2);
    assert.deepEqual(d.results.map((r) => r.uid).sort(), ['aa0000000001', 'aa0000000002']);
    assert.ok(
      d.results.every((r) => r.hit === 'uid'),
      '前缀匹配也算 ID 检索',
    );
  } finally {
    lib.close();
  }
});

test('L3 ⭐⭐ 关键词：名称命中 hit=name、仅路径命中 hit=path，且名称命中排在前面', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/Cat-Poster.jpg', { displayName: 'Cat Poster', stem: 'Cat-Poster' });
  lib.add('aa0000000002', 'CR/Poster-Cat.jpg', { displayName: 'Poster', stem: 'Poster-Cat' });
  lib.add('aa0000000003', 'CR/cat/Poster.jpg', { displayName: 'Poster', stem: 'Poster' });
  try {
    const d = dataOf(search([lib], { query: 'cat' }));
    assert.equal(d.total, 3);
    assert.equal(d.results[0].hit, 'name');
    assert.equal(d.results[1].hit, 'name');
    assert.equal(d.results[2].hit, 'path', '只有路径含 cat ⇒ path');
    assert.equal(d.results[2].uid, 'aa0000000003');
  } finally {
    lib.close();
  }
});

test('L4 ⭐ 关键词大小写不敏感；`%`/`_` 按字面（不是通配符）', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/100%_off.jpg', { displayName: '100%_off' });
  lib.add('aa0000000002', 'CR/plain.jpg', { displayName: 'plain' });
  try {
    const hit = dataOf(search([lib], { query: '%' }));
    assert.equal(hit.total, 1, '% 必须按字面匹配（否则会匹配全部）');
    assert.equal(hit.results[0].uid, 'aa0000000001');
    const upper = dataOf(search([lib], { query: 'PLAIN' }));
    assert.equal(upper.total, 1, '关键词大小写不敏感');
  } finally {
    lib.close();
  }
});

test('L5 ⭐ ext: 前缀 ⇒ 扩展名检索（大小写不敏感），hit=ext', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.png', { ext: '.png' });
  lib.add('aa0000000002', 'CR/b.jpg', { ext: '.jpg' });
  try {
    const d = dataOf(search([lib], { query: 'ext:PNG' }));
    assert.equal(d.total, 1);
    assert.equal(d.results[0].ext, '.png');
    assert.equal(d.results[0].hit, 'ext');
    // 也可以用独立筛选（与关键词组合）
    const f = dataOf(search([lib], { query: 'a', ext: '.png' }));
    assert.equal(f.total, 1);
  } finally {
    lib.close();
  }
});

test('L6 folder 筛选与关键词组合', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.jpg', { folder: 'CR', displayName: 'poster a' });
  lib.add('aa0000000002', 'VR/b.jpg', { folder: 'VR', displayName: 'poster b' });
  try {
    const d = dataOf(search([lib], { query: 'poster', folder: 'VR' }));
    assert.equal(d.total, 1);
    assert.equal(d.results[0].uid, 'aa0000000002');
  } finally {
    lib.close();
  }
});

test('L7 ⭐ 分页：total 是筛选后总数（越界也如实），results 受 limit/offset 控制', () => {
  const lib = makeLib('L1');
  for (let i = 1; i <= 5; i++)
    lib.add('aa000000000' + String(i), 'CR/poster-' + String(i) + '.jpg');
  try {
    const d = dataOf(search([lib], { query: 'poster', limit: 2, offset: 2 }));
    assert.equal(d.total, 5);
    assert.equal(d.results.length, 2);
    const beyond = dataOf(search([lib], { query: 'poster', limit: 2, offset: 99 }));
    assert.equal(beyond.total, 5, '越界也如实给 total');
    assert.equal(beyond.results.length, 0);
  } finally {
    lib.close();
  }
});

test('L8 ⭐⭐ 多库合并：默认全查、total 求和；libIds 可限定', () => {
  const a = makeLib('L1');
  const b = makeLib('L2');
  a.add('aa0000000001', 'CR/poster-a.jpg');
  b.add('bb0000000001', 'CR/poster-b.jpg');
  try {
    const all = dataOf(search([a, b], { query: 'poster' }));
    assert.equal(all.total, 2, '默认跨库合并');
    assert.deepEqual(all.results.map((r) => r.libId).sort(), ['L1', 'L2']);
    const only = dataOf(search([a, b], { query: 'poster', libIds: ['L2'] }));
    assert.equal(only.total, 1);
    assert.equal(only.results[0].libId, 'L2');
  } finally {
    a.close();
    b.close();
  }
});

test('L9 无命中：ok=true、total=0、results=[]（"没有"不是错误）', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.jpg');
  try {
    const d = dataOf(search([lib], { query: 'zzz-no-such-thing' }));
    assert.equal(d.total, 0);
    assert.deepEqual(d.results, []);
  } finally {
    lib.close();
  }
});

test('L10 ⭐ 缺库如实报：库根没有 .gs.db ⇒ DB_MISSING（不返回空表假装"库里没有"）', () => {
  const lib = makeLib('L1');
  lib.close();
  fs.rmSync(lib.dbPath, { force: true });
  try {
    const r = search([lib], { query: 'anything' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'DB_MISSING');
    assert.ok(r.error.userMessage.length > 0, 'userMessage 不能为空');
  } finally {
    /* 已删 */
  }
});

test('L11 参数兜底：空 query ⇒ BAD_REQUEST；libIds 指向不存在的库 ⇒ LIB_NOT_FOUND；都不抛', () => {
  const lib = makeLib('L1');
  lib.add('aa0000000001', 'CR/a.jpg');
  try {
    const empty = runLocalSearch(
      {
        libraries: [{ libId: 'L1', root: lib.root }],
        legacyLibrariesDir: path.join(TMP, 'legacy'),
      },
      { query: '   ' },
    );
    assert.equal(empty.ok, false);
    assert.equal(empty.error.code, 'BAD_REQUEST');

    const unknown = search([lib], { query: 'x', libIds: ['NOPE'] });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'LIB_NOT_FOUND');
  } finally {
    lib.close();
  }
});

// ============================================================ 模拟模式（无 .gs.db）演示实现

const FIXTURE = [
  {
    uid: 'a00000000001',
    libId: 'L1',
    relPath: 'VR\\VR-101.jpg',
    folder: 'VR',
    stem: 'VR-101',
    imageExt: '.jpg',
  },
  {
    uid: 'a00000000002',
    libId: 'L1',
    relPath: 'CR\\CR-201.png',
    folder: 'CR',
    stem: 'CR-201',
    imageExt: '.png',
  },
  {
    uid: 'a00000000003',
    libId: 'L1',
    relPath: '其他\\MISC-401.jpeg',
    folder: '其他',
    stem: 'MISC-401',
    imageExt: '.jpeg',
  },
];

test('L12 ⭐⭐ fake 演示实现：与真 SQL 同一套口径（ID 前缀/文件名/扩展名/路径/排序）', () => {
  const uid = runFakeLocalSearch(FIXTURE, { query: '#a00000' });
  assert.equal(uid.ok, true);
  assert.equal(uid.data.total, 3);
  assert.ok(
    uid.data.results.every((r) => r.hit === 'uid'),
    '前缀命中也算 ID',
  );

  const name = runFakeLocalSearch(FIXTURE, { query: 'VR-101' });
  assert.equal(name.data.total, 1);
  assert.equal(name.data.results[0].hit, 'name');

  const ext = runFakeLocalSearch(FIXTURE, { query: 'ext:png' });
  assert.equal(ext.data.total, 1);
  assert.equal(ext.data.results[0].uid, 'a00000000002');

  const path = runFakeLocalSearch(FIXTURE, { query: '其他' });
  assert.equal(path.data.total, 1);
  assert.equal(path.data.results[0].hit, 'path');

  const none = runFakeLocalSearch(FIXTURE, { query: 'zzz' });
  assert.equal(none.data.total, 0);
  assert.deepEqual(none.data.results, []);
});

test('L13 fake 演示实现：空 query ⇒ BAD_REQUEST（与真实现同一错误口径，不静默返回全部）', () => {
  const r = runFakeLocalSearch(FIXTURE, { query: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_REQUEST');
});

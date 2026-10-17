// apps/desktop/tests/user-meta.test.mjs —— WIRE-C 第 1 段：**标注读写**（评分/备注/收藏）
//
// 钉住卡面的三条语义 + 两条打开纪律 + P1：
//   M2 rating **NULL = 未评分**（不是 0；0 不许写进来）
//   M3 note **空串 ≠ NULL**（"" = 清空过；null = 从未填写）
//   M4 metaSet **部分更新**（不传不动 · applied 只列实际写了的）
//   M5 **metaGet 只读且缺库不代建**；metaSet 缺库明确 DB_MISSING（也不代建）
//   M6 **唯一写入口**：INSERT/UPDATE asset_user_meta 只许出现在 db/user-meta.ts（P1 机械判据）
//   M7 收藏走**偏索引** idx_meta_favorite（不是全表扫）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openGsDb } from '../src/main/db/open.ts';
import { runMetaGet, runMetaSet } from '../src/main/meta-ipc.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_wirec', 'meta-' + process.pid);
const T0 = 1700000000000;
const UID = 'aa0000000001';

let seq = 0;
function freshLib(label, { withDb = true } = {}) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (withDb) {
    const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), now: () => T0 });
    try {
      opened.db
        .prepare(
          'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(UID, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/A.jpg', T0);
    } finally {
      opened.db.close();
    }
  }
  return dir;
}
const input = (dir, extra = {}) => ({
  libId: 'L1',
  uid: UID,
  libraries: [{ libId: 'L1', root: dir }],
  userDataDir: null,
  now: () => T0,
  ...extra,
});
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

test('M1 roundtrip：写进去的评分/备注/收藏，读回来一致', () => {
  const dir = freshLib('M1');
  const w = runMetaSet(input(dir, { rating: 4, note: '好图', isFavorite: true }));
  assert.equal(w.ok, true);
  assert.deepEqual(w.data.applied, ['rating', 'note', 'is_favorite']);
  const r = runMetaGet(input(dir));
  assert.equal(r.ok, true);
  assert.deepEqual([r.data.rating, r.data.note, r.data.isFavorite], [4, '好图', true]);
  assert.equal(typeof r.data.updatedAt, 'number');
  assert.ok(r.data.updatedAt > 0, 'updatedAt 是写入时刻');
});

test('M2 ⭐⭐ rating **NULL = 未评分**，不是 0；0 分不许写进来', () => {
  const dir = freshLib('M2');
  // 从没评过 ⇒ null（**不是 0**）
  assert.equal(runMetaGet(input(dir)).data.rating, null, '未评分必须是 null');
  // 评了 5 再清空 ⇒ 回到 null（不是 0）
  runMetaSet(input(dir, { rating: 5 }));
  runMetaSet(input(dir, { rating: null }));
  assert.equal(runMetaGet(input(dir)).data.rating, null, '清空后必须是 null');
  // 0 不是合法评分（契约 1..5 / DDL CHECK）
  // runMetaX **永不抛**（信封语义）⇒ 断言信封是失败，而不是 assert.throws
  const bad = runMetaSet(input(dir, { rating: 0 }));
  assert.equal(bad.ok, false, 'rating=0 必须被拒');
  assert.equal(bad.error.code, 'UNEXPECTED_SQL_VALUE');
  const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), now: () => T0 });
  try {
    assert.throws(
      () => opened.db.prepare('UPDATE asset_user_meta SET rating = 0 WHERE uid = ?').run(UID),
      /CHECK/i,
      'DDL 的 CHECK(1..5) 也要挡住 0（两层都拦）',
    );
  } finally {
    opened.db.close();
  }
});

test('M3 ⭐⭐ note **空串 ≠ NULL**："" = 用户清空过，null = 从未填写', () => {
  const dir = freshLib('M3');
  runMetaSet(input(dir, { note: '写了点东西' }));
  runMetaSet(input(dir, { note: '' })); // 用户清空
  assert.equal(runMetaGet(input(dir)).data.note, '', '清空后是空串，不是 null');
  runMetaSet(input(dir, { note: null })); // 显式清成"从未填写"
  assert.equal(runMetaGet(input(dir)).data.note, null, '传 null 才是 null');
});

test('M4 ⭐ metaSet **部分更新**：不传的字段不动，applied 只列实际写了的', () => {
  const dir = freshLib('M4');
  runMetaSet(input(dir, { rating: 3, note: '备注', isFavorite: true }));
  const w = runMetaSet(input(dir, { rating: 5 })); // 只改评分
  assert.deepEqual(w.data.applied, ['rating'], 'applied 只该有 rating');
  const r = runMetaGet(input(dir)).data;
  assert.deepEqual([r.rating, r.note, r.isFavorite], [5, '备注', true], '没传的字段必须原样保留');
  const w2 = runMetaSet(input(dir, {}));
  assert.deepEqual(w2.data.applied, [], '空 patch = 不写任何字段');
});

test('M5 ⭐⭐ metaGet 只读且**缺库不代建**；metaSet 缺库明确 DB_MISSING（也不代建）', () => {
  const dir = freshLib('M5', { withDb: false }); // 没有 .gs.db
  const dbPath = path.join(dir, '.gs.db');
  assert.equal(fs.existsSync(dbPath), false);
  // ⭐ 缺库 = **未知**，不许伪装成"未评分/未收藏"（Lead 2026-10-17 裁定选 (a)：返回 DB_MISSING）
  const r = runMetaGet(input(dir));
  assert.equal(r.ok, false, '缺库时 metaGet 必须明确失败（不能把"未知"说成"没有"）');
  assert.equal(r.error.code, 'DB_MISSING');
  assert.equal(fs.existsSync(dbPath), false, 'metaGet **不许**把 .gs.db 建出来（读动作零写入）');
  const w = runMetaSet(input(dir, { rating: 4 }));
  assert.equal(w.ok, false, '缺库时 metaSet 必须明确失败');
  assert.equal(w.error.code, 'DB_MISSING');
  assert.equal(fs.existsSync(dbPath), false, 'metaSet 也**不许**代建（先重建元数据再标注）');

  // ⭐⭐ 区分性：**缺库（未知 ⇒ DB_MISSING）** 必须能与 **有库但未评分（ok + rating:null）** 分开 ——
  //   这正是"没有 vs 不知道"的机械判据：两者 **ok 不同**，界面就不可能把"未知"渲染成"未评分"。
  const dirOk = freshLib('M5-ok');
  const fresh = runMetaGet(input(dirOk));
  assert.equal(fresh.ok, true, '有库但未评分 = 成功（rating null）');
  assert.equal(fresh.data.rating, null);
  assert.notEqual(fresh.ok, r.ok, '两者必须能区分（ok 不同）');
});

test('M6 ⭐⭐ 唯一写入口（源码扫描）：INSERT/UPDATE asset_user_meta 只许出现在 db/user-meta.ts', () => {
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
      /(INSERT\s+(OR\s+\w+\s+)?INTO\s+asset_user_meta\b)|(UPDATE\s+asset_user_meta\b)/i.test(
        fs.readFileSync(f, 'utf8'),
      ),
    )
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(
    writers,
    ['user-meta.ts'],
    'asset_user_meta 的写入口只能是 db/user-meta.ts（§2.3 · P1）',
  );
  const ipcSrc = fs.readFileSync(path.join(MAIN, 'meta-ipc.ts'), 'utf8');
  assert.equal(
    /INSERT\s+INTO\s+asset_user_meta|UPDATE\s+asset_user_meta/i.test(ipcSrc),
    false,
    'meta-ipc 不许出现写 SQL',
  );
});

test('M7 ⭐ 收藏查询走**偏索引** idx_meta_favorite（不是全表扫）', () => {
  const dir = freshLib('M7');
  runMetaSet(input(dir, { isFavorite: true }));
  const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), now: () => T0 });
  try {
    const plan = opened.db
      .prepare('EXPLAIN QUERY PLAN SELECT uid FROM asset_user_meta WHERE is_favorite = 1')
      .all()
      .map((r) => String(r.detail))
      .join(' | ');
    assert.match(
      plan,
      /idx_meta_favorite/,
      '收藏筛选必须用偏索引（DDL 建的 WHERE is_favorite = 1）',
    );
  } finally {
    opened.db.close();
  }
});

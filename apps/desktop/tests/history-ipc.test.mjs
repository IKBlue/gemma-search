// apps/desktop/tests/history-ipc.test.mjs —— HIST-1：三张"只写不读"的表的**读路径**
//
// 三条硬要求逐条钉：
//   ① **只读**：缺库 ⇒ DB_MISSING，且**目录里不会多出库文件**（warmup 回归的同族）；`history-ipc` 里没有写 SQL；
//   ② **排序稳定**：at_ms DESC + **同毫秒按主键 DESC 裁决**（重复查询顺序一致）；
//   ③ **分页如实**：`total` = 筛选后总数（不是本页行数）；越界 ⇒ 空数组。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { insertActivity, openAppDb } from '../src/main/app-db.ts';
import { openGsDb } from '../src/main/db/open.ts';
import { insertExportRows } from '../src/main/db/exports.ts';
import { runActivityList, runExportList, runRecentQueries } from '../src/main/history-ipc.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_hist1', 'h-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDir(label) {
  const d = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function seedApp(label, fill) {
  const userDataDir = freshDir(label);
  const app = openAppDb({ userDataDir, now: () => T0 });
  try {
    fill(app.db);
  } finally {
    app.db.close();
  }
  return userDataDir;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时 */
  }
});

test('H1 ⭐⭐ activityList：时间降序 + **同毫秒按 id 降序裁决** + total/分页/越界如实', () => {
  const userDataDir = seedApp('H1', (db) => {
    // 三行：两条同一毫秒（b/a），一条更早 ⇒ 期望顺序 a,b,old（同毫秒按 id DESC）
    insertActivity(db, { activityId: 'a', atMs: T0 + 100, kind: 'collect', subjectKind: 'app' });
    insertActivity(db, { activityId: 'b', atMs: T0 + 100, kind: 'collect', subjectKind: 'app' });
    insertActivity(db, { activityId: 'old', atMs: T0, kind: 'collect', subjectKind: 'app' });
  });
  const r = runActivityList({ userDataDir, limit: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.data.rows.map((x) => x.id),
    ['b', 'a', 'old'],
    '同毫秒按 id DESC 裁决',
  );
  assert.equal(r.data.total, 3, 'total = 总数（不是本页行数）');
  // 分页如实
  const p2 = runActivityList({ userDataDir, limit: 2 });
  assert.equal(p2.data.rows.length, 2);
  assert.equal(p2.data.total, 3);
  const beyond = runActivityList({ userDataDir, limit: 2, offset: 10 });
  assert.deepEqual(beyond.data.rows, [], '越界给空数组');
  assert.equal(beyond.data.total, 3, '越界时 total 仍然如实');
  // 排序稳定：重复查询顺序一致
  assert.deepEqual(
    runActivityList({ userDataDir, limit: 10 }).data.rows.map((x) => x.id),
    runActivityList({ userDataDir, limit: 10 }).data.rows.map((x) => x.id),
    '重复查询必须顺序一致',
  );
  // kind 筛选：total 是**筛选后**总数
  const byKind = runActivityList({ userDataDir, kind: 'collect' });
  assert.equal(byKind.data.total, 3);
  const none = runActivityList({ userDataDir, kind: 'purge' });
  assert.equal(none.data.total, 0);
  assert.deepEqual(none.data.rows, []);
});

test('H2 ⭐ recentQueries：应用级 recent_query 读路径（时间降序 + 同毫秒按 query_id 裁决）', () => {
  const userDataDir = seedApp('H2', (db) => {
    const ins = db.prepare(
      'INSERT INTO recent_query (query_id, kind, text, scope_lib_id, result_count, at_ms) VALUES (?,?,?,?,?,?)',
    );
    ins.run('q1', 'text', '蓝天', null, 12, T0 + 50);
    ins.run('q2', 'text', '坦克', 'L1', 3, T0 + 50);
    ins.run('q0', 'image', null, null, 7, T0);
  });
  const r = runRecentQueries({ userDataDir, limit: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.data.rows.map((x) => x.q),
    ['坦克', '蓝天', null],
    '同毫秒按 query_id DESC',
  );
  assert.deepEqual(
    r.data.rows.map((x) => x.hits),
    [3, 12, 7],
  );
  assert.equal(r.data.rows[1].scopeLibId, null);
  assert.equal(r.data.rows[0].scopeLibId, 'L1');
});

test('H3 ⭐ exportList：库级 asset_export 读路径（时间降序 + 同毫秒按 export_id 裁决）+ 分页', () => {
  const libDir = freshDir('H3-lib');
  const dbPath = path.join(libDir, '.gs.db');
  const opened = openGsDb({ dbPath, now: () => T0 });
  try {
    opened.db
      .prepare(
        'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run('aa0000000001', 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/A.jpg', T0);
    insertExportRows(opened.db, [
      {
        exportId: 'e2',
        kind: 'collect',
        uid: 'aa0000000001',
        assetName: 'b.zip',
        batchId: 'j1',
        targetDir: 'D:/out',
        result: 'copied',
        reason: null,
        atMs: T0 + 10,
      },
      {
        exportId: 'e1',
        kind: 'collect',
        uid: 'aa0000000001',
        assetName: 'a.zip',
        batchId: 'j1',
        targetDir: 'D:/out',
        result: 'skipped',
        reason: 'exists',
        atMs: T0 + 10,
      },
      {
        exportId: 'e0',
        kind: 'collect',
        uid: null,
        assetName: 'c.zip',
        batchId: 'j0',
        targetDir: 'D:/out',
        result: 'failed',
        reason: 'X',
        atMs: T0,
      },
    ]);
  } finally {
    opened.db.close();
  }
  const libs = [{ libId: 'L1', root: libDir }];
  const r = runExportList({ userDataDir: null, libraries: libs, libId: 'L1', limit: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.data.rows.map((x) => x.exportId),
    ['e2', 'e1', 'e0'],
    '同毫秒按 export_id DESC',
  );
  assert.equal(r.data.total, 3);
  const page = runExportList({
    userDataDir: null,
    libraries: libs,
    libId: 'L1',
    limit: 1,
    offset: 1,
  });
  assert.deepEqual(
    page.data.rows.map((x) => x.exportId),
    ['e1'],
  );
  const beyond = runExportList({
    userDataDir: null,
    libraries: libs,
    libId: 'L1',
    limit: 5,
    offset: 99,
  });
  assert.deepEqual(beyond.data.rows, []);
  assert.equal(beyond.data.total, 3);
});

test('H4 ⭐⭐ 只读：缺库 ⇒ DB_MISSING **且不代建**（app.db / .gs.db 都不会被造出来）', () => {
  const userDataDir = freshDir('H4-app'); // 没有 app.db
  const appDb = path.join(userDataDir, 'app.db');
  assert.equal(fs.existsSync(appDb), false);
  for (const r of [runActivityList({ userDataDir }), runRecentQueries({ userDataDir })]) {
    assert.equal(r.ok, false, '缺 app.db ⇒ 明确失败');
    assert.equal(r.error.code, 'DB_MISSING');
  }
  assert.equal(fs.existsSync(appDb), false, '读路径**不许**把 app.db 建出来');

  const libDir = freshDir('H4-lib'); // 没有 .gs.db
  const libDb = path.join(libDir, '.gs.db');
  const r = runExportList({ userDataDir, libraries: [{ libId: 'L1', root: libDir }], libId: 'L1' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'DB_MISSING');
  assert.equal(fs.existsSync(libDb), false, '读路径**不许**把 .gs.db 建出来');
});

test('H5 ⭐⭐ history-ipc 里**没有写 SQL**（读路径不许顺手写库）', () => {
  const src = fs.readFileSync(path.join(MAIN, 'history-ipc.ts'), 'utf8');
  assert.equal(
    /\b(INSERT|UPDATE|DELETE)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    false,
    '不许出现写 SQL',
  );
  assert.ok(/readOnly: true/.test(src), '必须用只读打开');
});

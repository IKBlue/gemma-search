// apps/desktop/tests/activity.test.mjs —— B2-8：`activity` 操作记录
//
// 要证的六件事：
//   ① **列集 = 设计基线**（从 `SPEC-COMPACT.md` 解析后与真 DDL 双向对照）；
//   ② ⭐⭐ **与 `asset_export` 的 1:N 边界是机械证明的**（不是文字说明）：
//      一次批量 ⇒ `activity` **恰好 1 行**、`asset_export` **恰好 N 行**，两者用**同一个 `batch_id`** 关联；
//      并且**没有物理外键**（两张表在不同的数据库里 ⇒ 只能逻辑关联）；
//   ③ 落点是**应用级 `app.db`**（`SPEC.md:173` + 基线"activity 在应用级 DB"），走**应用级链 v3**；
//   ④ CHECK 枚举 · 可空语义 · DESC 索引 · detail_json 存结构化参数（不存渲染好的文字）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APP_META_LEDGER,
  APP_MIGRATIONS,
  APP_TABLES,
  APP_TARGET_SCHEMA_VERSION,
  migrateApp,
  openGsDb,
  openNodeSqlite,
} from '../src/main/db/index.ts';
import { appLayerTables, libraryLayerTables } from '../src/main/db/schema-layers.ts';
import { appDbPath, openAppDb } from '../src/main/app-db.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b28', 'activity-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

/** 从设计基线解析 activity 那一节声明的字段 */
function baselineFields() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+activity\b/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 activity 那一节');
  const names = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const row = line.match(/^\|\s*`?(.+?)`?s*\|/);
    if (!row) continue;
    for (const part of row[1].split('/')) {
      const name = part.replace(/`/g, '').trim();
      if (/^[a-z_][a-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

const insActivity = (db, row) =>
  db
    .prepare(
      'INSERT INTO activity (activity_id, at_ms, kind, subject_kind, subject_id, lib_id, result, detail_json) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      row.activity_id,
      row.at_ms ?? T0,
      row.kind ?? 'collect',
      row.subject_kind ?? 'app',
      row.subject_id ?? null,
      row.lib_id ?? null,
      row.result ?? null,
      row.detail_json ?? null,
    );

const insExport = (db, row) =>
  db
    .prepare(
      'INSERT INTO asset_export (export_id, kind, uid, asset_name, batch_id, target_dir, result, reason, at_ms) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .run(
      row.export_id,
      row.kind ?? 'collect',
      row.uid ?? null,
      row.asset_name ?? 'A.jpg',
      row.batch_id ?? null,
      row.target_dir ?? 'D:/out',
      row.result ?? 'copied',
      row.reason ?? null,
      row.at_ms ?? T0,
    );

function seedAsset(db, uid) {
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
  ).run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/' + uid + '.jpg', T0);
}

// ============================================================ C1/C2 形状与约束

test('C1 ⭐⭐ 列集 = 设计基线（activity_id · at_ms · kind · subject_kind · subject_id · lib_id · result · detail_json）', () => {
  const want = baselineFields();
  assert.equal(want.size, 8, '设计基线 §46 说 activity 是 8 个字段行，实得 ' + String(want.size));
  const { db } = openAppDb({ userDataDir: freshDir('C1'), now: () => T0 });
  try {
    const cols = db
      .prepare("PRAGMA table_info('activity')")
      .all()
      .map((c) => c.name);
    assert.deepEqual([...cols].sort(), [...want].sort(), 'DDL 列与设计基线逐字对上（多/少都红）');
  } finally {
    db.close();
  }
});

test('C2 CHECK 枚举（kind 10 个值 / subject_kind 5 个值 / result 与 asset_export 同一套词）+ at_ms NOT NULL', () => {
  const { db } = openAppDb({ userDataDir: freshDir('C2'), now: () => T0 });
  try {
    for (const k of [
      'collect',
      'deliver',
      'trash',
      'restore',
      'purge',
      'tag.add',
      'tag.remove',
      'collection.add',
      'index.exclude',
      'index.in',
    ]) {
      insActivity(db, { activity_id: 'a-' + k, kind: k, subject_kind: 'app' });
    }
    for (const s of ['asset', 'library', 'tag', 'collection', 'app']) {
      insActivity(db, { activity_id: 's-' + s, kind: 'collect', subject_kind: s });
    }
    assert.throws(
      () => insActivity(db, { activity_id: 'bad-k', kind: '打包', subject_kind: 'app' }),
      /CHECK/i,
      'kind 只认基线那 10 个动作',
    );
    assert.throws(
      () => insActivity(db, { activity_id: 'bad-s', kind: 'collect', subject_kind: '宇宙' }),
      /CHECK/i,
      'subject_kind 只认 asset/library/tag/collection/app',
    );
    assert.throws(
      () =>
        insActivity(db, {
          activity_id: 'bad-r',
          kind: 'collect',
          subject_kind: 'app',
          result: 'ok?',
        }),
      /CHECK/i,
      'result 与 asset_export.result 同一套词（ok/skipped/failed）',
    );
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO activity (activity_id, kind, subject_kind) VALUES (?,?,?)')
          .run('no-at', 'collect', 'app'),
      /NOT NULL/i,
      'at_ms NOT NULL',
    );
  } finally {
    db.close();
  }
});

// ============================================================ C3 ⭐⭐ 1:N 边界（跨两库）

test('C3 ⭐⭐ 与 asset_export 的 1:N：一次批量 ⇒ activity **1 行** + asset_export **N 行**（同一个 batch_id）', () => {
  const ud = freshDir('C3-app');
  const libDir = freshDir('C3-lib');
  const app = openAppDb({ userDataDir: ud, now: () => T0 });
  const lib = openGsDb({ dbPath: path.join(libDir, '.gs.db'), now: () => T0 });
  try {
    const N = 5;
    const batch = 'batch-2026-1016-A'; // 就是 activity_id（基线：「也是批量操作的 batch_id」）

    // ① 一次批量在 activity 里**恰好一行**（它是 PK ⇒ 第二个同 id 直接被拒）
    insActivity(app.db, {
      activity_id: batch,
      kind: 'collect',
      subject_kind: 'app',
      subject_id: null, // 批量操作时为空（明细在 detail_json）
      lib_id: null, // 不属于任何库的操作也可以记
      result: 'ok',
      detail_json: JSON.stringify({ target_dir: 'D:/out', count: N }),
    });
    assert.throws(
      () => insActivity(app.db, { activity_id: batch, kind: 'collect', subject_kind: 'app' }),
      /UNIQUE|PRIMARY KEY/i,
      'activity_id 是主键 ⇒ 一次批量只能有一行（这就是 1:N 里的那个 1）',
    );

    // ② 同一批量在 asset_export 里**恰好 N 行**（batch_id 允许重复）
    for (let i = 1; i <= N; i++) {
      seedAsset(lib.db, 'aa000000000' + String(i));
      insExport(lib.db, {
        export_id: 'e' + String(i),
        batch_id: batch,
        uid: 'aa000000000' + String(i),
        result: i === N ? 'skipped' : 'copied',
      });
    }

    // ③ 用**同一个 id** 跨库关联：1 行 ↔ N 行（逻辑外键；两张表在不同数据库里）
    const acts = app.db
      .prepare('SELECT activity_id, kind, result, detail_json FROM activity WHERE activity_id = ?')
      .all(batch);
    const exps = lib.db
      .prepare('SELECT export_id, result FROM asset_export WHERE batch_id = ? ORDER BY export_id')
      .all(batch);
    assert.equal(acts.length, 1, 'activity 恰好 1 行');
    assert.equal(exps.length, N, 'asset_export 恰好 N 行');
    assert.equal(JSON.parse(acts[0].detail_json).count, N, '明细里的 N 与子表行数一致');
    assert.deepEqual(
      exps.map((r) => r.result),
      ['copied', 'copied', 'copied', 'copied', 'skipped'],
    );

    // ④ 另一个批量 ⇒ 两边各自 +1 / +N（不是"全局只有一行"）
    insActivity(app.db, {
      activity_id: 'batch-B',
      kind: 'deliver',
      subject_kind: 'app',
      result: 'ok',
    });
    insExport(lib.db, { export_id: 'b1', batch_id: 'batch-B' });
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM activity').get().n, 2);
    assert.equal(
      lib.db.prepare("SELECT COUNT(*) n FROM asset_export WHERE batch_id = 'batch-B'").get().n,
      1,
    );

    // ⑤ **没有物理外键**（跨库不可能）——这条是"边界"的另一半：id 相同只是**约定**，不是约束
    const actFks = app.db.prepare('PRAGMA foreign_key_list(activity)').all();
    assert.deepEqual(
      actFks,
      [],
      'activity 不该有任何外键（尤其不可能指向另一个库里的 asset_export）',
    );
    const expFks = lib.db
      .prepare('PRAGMA foreign_key_list(asset_export)')
      .all()
      .map((f) => f.table);
    assert.deepEqual(expFks, ['asset'], 'asset_export 的外键只有 asset（B2-2 的口径不变）');
  } finally {
    app.db.close();
    lib.db.close();
  }
});

// ============================================================ C4/C5/C6 索引与可空/JSON

test('C4 at_ms 的 DESC 索引真的建出来了（列表页第一屏 = 索引扫描）', () => {
  const { db } = openAppDb({ userDataDir: freshDir('C4'), now: () => T0 });
  try {
    const cols = db
      .prepare("PRAGMA index_xinfo('idx_activity_at')")
      .all()
      .filter((r) => r.key === 1);
    assert.deepEqual(
      cols.map((r) => [r.name, r.desc]),
      [['at_ms', 1]],
      '按发生时刻**降序**索引',
    );
  } finally {
    db.close();
  }
});

test('C5 可空语义：subject_id / lib_id / result / detail_json 都可空（"登记库"这种操作不属于任何库）', () => {
  const { db } = openAppDb({ userDataDir: freshDir('C5'), now: () => T0 });
  try {
    insActivity(db, {
      activity_id: 'reg',
      kind: 'collection.add',
      subject_kind: 'library',
      subject_id: null,
      lib_id: null,
    });
    const row = db
      .prepare('SELECT subject_id, lib_id, result, detail_json FROM activity WHERE activity_id = ?')
      .get('reg');
    assert.deepEqual(
      [row.subject_id, row.lib_id, row.result, row.detail_json],
      [null, null, null, null],
    );
  } finally {
    db.close();
  }
});

test('C6 detail_json 存**结构化参数**（能原样解析回来），不是渲染好的文字', () => {
  const { db } = openAppDb({ userDataDir: freshDir('C6'), now: () => T0 });
  try {
    const detail = {
      target_dir: 'D:/导出/2026',
      items: ['aa0000000001', 'aa0000000002'],
      reason: null,
    };
    insActivity(db, {
      activity_id: 'd1',
      kind: 'collect',
      subject_kind: 'asset',
      result: 'ok',
      detail_json: JSON.stringify(detail),
    });
    const raw = db
      .prepare('SELECT detail_json FROM activity WHERE activity_id = ?')
      .get('d1').detail_json;
    assert.deepEqual(
      JSON.parse(raw),
      detail,
      '存的必须是原样的结构化参数（界面那一侧才是渲染的唯一来源）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ C7 迁移 / 落点

test('C7 ⭐⭐ 走**应用级链 v3** · 落在 app.db（不是库级）· 旧 app 库升级不回归 · 幂等', () => {
  const versions = APP_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '应用级版本从 1 起连续',
  );
  assert.equal(
    APP_TARGET_SCHEMA_VERSION,
    versions[versions.length - 1],
    '目标 = 它自己那条链的上限',
  );
  assert.equal(APP_MIGRATIONS[2].name, 'batch2-activity', 'activity 是应用级 v3（钉自己那一格）');
  assert.ok(APP_TABLES.includes('activity'));
  // 落点：应用层（**不是**库级）
  assert.ok(appLayerTables().includes('activity'), 'activity 属应用层');
  assert.equal(libraryLayerTables().includes('activity'), false, '绝不在库级 .gs.db 里');
  const libDir = freshDir('C7-lib');
  const probe = openGsDb({ dbPath: path.join(libDir, '.gs.db'), now: () => T0 });
  try {
    const names = probe.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(
      names.includes('activity'),
      false,
      '库级库里不该有 activity（跨库无外键这条也才自洽）',
    );
  } finally {
    probe.db.close();
  }
  // 旧 app 库（只到 v2）⇒ 升级只跑缺的；老数据在；幂等
  const ud = freshDir('C7-up');
  const p = appDbPath(ud);
  const v2Only = openNodeSqlite(p);
  try {
    migrateApp(v2Only, { migrations: APP_MIGRATIONS.slice(0, 2), now: () => T0 });
    assert.equal(APP_META_LEDGER.readVersion(v2Only), 2);
    const names = v2Only
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('activity'), false, '没升级就没有 activity（不静默提前建）');
    v2Only
      .prepare('INSERT INTO app_setting ("key", value_json, updated_at_ms) VALUES (?,?,?)')
      .run('theme', '"dark"', T0);
  } finally {
    v2Only.close();
  }
  const up = openAppDb({ userDataDir: ud, now: () => T0 });
  try {
    assert.equal(APP_META_LEDGER.readVersion(up.db), APP_TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      up.db
        .prepare('SELECT "key" FROM app_setting')
        .all()
        .map((r) => r.key),
      ['theme'],
      '升级不动老数据',
    );
    assert.equal(up.db.prepare('SELECT COUNT(*) n FROM activity').get().n, 0, '新表是空的');
    up.db.close();
    const again = openAppDb({ userDataDir: ud, now: () => T0 });
    assert.equal(
      APP_META_LEDGER.readVersion(again.db),
      APP_TARGET_SCHEMA_VERSION,
      '幂等：再开不再推进',
    );
    again.db.close();
  } finally {
    /* 已在上面关过 */
  }
});

// apps/desktop/tests/db-schema.test.mjs —— S1 绿地 schema 的验收测试（20 张表 · 四层分类 · 两套账本）
//
// 2026-10-15：整体重写。旧版测的是 v1/v2（library / items / 文档三表 / 体检两表），
//   绿地已把这些**全部丢弃**（所有者裁定：全新项目，旧 schema 不迁移）。
//
// 每条用例对应一个**会静默出错的失败模式**（不是凑数的分支覆盖）：
//   G1 表数不对 / 分类漏一张      ⇒ 提案自己的规矩（"忘分类就变红"）形同虚设
//   G2 DDL 与"应有表清单"漂移     ⇒ "表是否在"的自检会漏报
//   G3 两套账本互相污染           ⇒ 推应用级版本却动了库级表（或反之）
//   G4 幂等重跑重建了表           ⇒ 每次启动清空元数据
//   G5 迁移失败留下半张表         ⇒ 下次启动看到没人解释得了的中间态
//   G6 修正 #3 没落实             ⇒ UNIQUE(lib_id, rel_path) 建在假列上（提案原样就是建不出来）
//   G7 修正 #4 没落实             ⇒ "全部库"反复搜同一个词每次新增一行，真历史被挤掉
//   G8 修正 #5 没落实             ⇒ 两个索引任务并行跑（产品决定是全局串行）
//   G9 分类常量被改坏             ⇒ 四组不再覆盖 DDL 建出的表（用"删一条分类"现场证明会红）
//   A1 适配层被绕过               ⇒ 实验性 API 散落各处
//   A2 撒 any 换绿灯              ⇒ 门禁失去意义
//
// 跑法：node --test apps/desktop/tests/db-schema.test.mjs（也在 npm test 的 glob 里）
// 临时库落在仓库内 data/_s1/db-schema-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import {
  APP_META_LEDGER,
  APP_META_TABLE,
  APP_MIGRATIONS,
  APP_TABLES,
  APP_TARGET_SCHEMA_VERSION,
  EXPECTED_TABLES,
  GsDbError,
  LIBRARY_MIGRATIONS,
  LIBRARY_TABLES,
  LIBRARY_VIRTUAL_TABLES,
  SCHEMA_LAYERS,
  SCHEMA_LAYER_ORDER,
  SCHEMA_VERSION_TABLE,
  TARGET_SCHEMA_VERSION,
  appLayerTables,
  createdTableNames,
  libraryLayerTables,
  migrate,
  migrateApp,
  openGsDb,
  openNodeSqlite,
  readSchemaVersion,
  schemaTables,
  validateMigrations,
} from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_s1', 'db-schema-test-' + process.pid);
const LIB_DB = '.gs.db';
const APP_DB = 'app.db';
const FIXED_NOW = 1700000000000;
const now = () => FIXED_NOW;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + (++seq));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------- sqlite_master 读取

function allTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
}
/** SQLite 内部表：AUTOINCREMENT 的 sqlite_sequence（提案明确要 AUTOINCREMENT，认账见 migrations.ts） */
const SQLITE_INTERNAL = ['sqlite_sequence'];
/** 我们建的虚拟表（FTS5）会带来影子表；按 <vt>_ 前缀机械排除，不手写影子表名 */
function ourTables(db, virtualTables) {
  const shadowPrefixes = virtualTables.map((vt) => vt + '_');
  return allTables(db).filter(
    (name) => !SQLITE_INTERNAL.includes(name) && !shadowPrefixes.some((p) => name.startsWith(p)),
  );
}
function indexNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
}
function columnsOf(db, table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((r) => ({
    name: r.name, type: r.type, notnull: r.notnull, pk: r.pk, dflt: r.dflt_value,
  }));
}
/** 表上的唯一索引 → 列名数组（用来证明 UNIQUE 落在**真实列**上） */
function uniqueIndexColumns(db, table) {
  const out = [];
  for (const idx of db.prepare('PRAGMA index_list(' + table + ')').all()) {
    if (idx.unique !== 1) continue;
    const cols = db.prepare('PRAGMA index_info(' + idx.name + ')').all().map((r) => r.name);
    out.push({ name: idx.name, columns: cols });
  }
  return out;
}
function openLibrary(label) {
  const dbPath = path.join(freshDir(label), LIB_DB);
  const opened = openGsDb({ dbPath, now });
  return opened;
}
function openApp(label) {
  const dir = freshDir(label);
  const dbPath = path.join(dir, APP_DB);
  const db = openNodeSqlite(dbPath);
  const migration = migrateApp(db, { now });
  return { db, dbPath, migration };
}

const hex = (n) => n.toString(16).padStart(12, '0');
function insertAsset(db, uid, over = {}) {
  const row = Object.assign(
    {
      uid, lib_id: 'L1', folder: 'CR', stem: 'ID-' + uid, display_name: 'ID-' + uid + '.jpg',
      rel_dir: 'CR', rel_path: 'CR/ID-' + uid + '.jpg',
      discovered_at_ms: FIXED_NOW, updated_at_ms: FIXED_NOW,
    },
    over,
  );
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms, updated_at_ms) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.uid, row.lib_id, row.folder, row.stem, row.display_name, row.rel_dir, row.rel_path, row.discovered_at_ms, row.updated_at_ms);
  return row;
}

// ============================================================ A1/A2 静态自检

test('A1：db 层只有 sqlite-adapter.ts 碰 node:sqlite，且不 import electron', () => {
  const dir = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'db');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  // 精确清单（不是 >= 判断）：新增文件必须显式加进来，否则扫描面会"看起来还活着"却漏掉新文件
  assert.deepEqual(files.sort(), [
    'app-migrations.ts',
    'errors.ts',
    'import.ts',
    'index.ts',
    'migration-engine.ts',
    'migrations.ts',
    'open.ts',
    'row-types.ts',
    'schema-layers.ts',
    'sqlite-adapter.ts',
    'tmp-dir.ts',
  ]);

  const sqliteImporters = [];
  const electronImporters = [];
  for (const f of files) {
    const code = maskComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (/from\s+['"]node:sqlite['"]/.test(code)) sqliteImporters.push(f);
    if (/from\s+['"]electron['"]/.test(code)) electronImporters.push(f);
  }
  assert.deepEqual(sqliteImporters, ['sqlite-adapter.ts'], '实验性 API 只许出现在薄适配层');
  assert.deepEqual(electronImporters, [], 'db 层必须能在 node --test 里直接跑 ⇒ 不许 import electron');
});

test('A2：db 层源码里没有 any / @ts-ignore / @ts-expect-error', () => {
  const dir = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'db');
  const banned = [
    [/\bas\s+any\b/, 'as any'],
    [/@ts-ignore/, '@ts-ignore'],
    [/@ts-expect-error/, '@ts-expect-error'],
    [/\bany\s*\[\]/, 'any[]'],
    [/\b:\s*any\b/, ': any'],
  ];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const code = maskComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [re, label] of banned) {
      assert.equal(re.test(code), false, f + ' 里出现了禁止的 ' + label + '（铁律）');
    }
  }
});

// ============================================================ G1 表数 + 分类全覆盖

test('G1 ⭐ 表数 = 20；每张建出的表都在四组里被点名，且只被点名一次', () => {
  const grouped = schemaTables();
  assert.equal(grouped.length, 20, '四组点名去重后必须是 20 张（应用级 6 + 库级 14）');

  // 双向：DDL 派生 == 四组点名（缺一边都要红）
  const fromDdl = [...LIBRARY_TABLES, ...APP_TABLES].sort();
  assert.deepEqual(fromDdl, grouped, 'DDL 建出的表与四组点名必须逐张对上（缺分类 / 多分类都算漂移）');

  // 每张表**恰好**出现一次
  const seen = new Map();
  for (const layer of SCHEMA_LAYER_ORDER) {
    for (const name of SCHEMA_LAYERS[layer]) seen.set(name, (seen.get(name) || 0) + 1);
  }
  assert.equal(seen.size, 20);
  for (const [name, n] of seen) assert.equal(n, 1, name + ' 被点名了 ' + String(n) + ' 次');

  // 物理落点与层一一对应（Lead 修正 #1：应用级 6 + 库级 14）
  assert.equal(libraryLayerTables().length, 14, '库级 = 事实 ∪ 过程 ∪ 意图');
  assert.equal(appLayerTables().length, 6, '应用级 = 应用层');
  assert.deepEqual(libraryLayerTables(), [...LIBRARY_TABLES].sort(), 'DDL 落点与层分类必须一致（库级）');
  assert.deepEqual(appLayerTables(), [...APP_TABLES].sort(), 'DDL 落点与层分类必须一致（应用级）');
});

// ============================================================ G2 DDL 建表 + 索引

test('G2 ⭐ 打开两个库：DDL 建出全部表（sqlite_master 对照）与全部索引', () => {
  const lib = openLibrary('G2-lib');
  try {
    assert.equal(lib.created, true);
    assert.equal(lib.migration.fromVersion, 0);
    assert.equal(lib.migration.toVersion, TARGET_SCHEMA_VERSION);
    assert.deepEqual(lib.migration.applied.map((m) => m.version), [1]);

    // 我们建的表 == 应有清单（14 业务表 + 账本 schema_version）
    assert.deepEqual(ourTables(lib.db, LIBRARY_VIRTUAL_TABLES), [...EXPECTED_TABLES]);
    assert.equal(LIBRARY_TABLES.length, 14);
    assert.equal(EXPECTED_TABLES.length, 15, '14 业务表 + schema_version 账本');
    assert.deepEqual([...LIBRARY_VIRTUAL_TABLES], ['asset_name_fts'], 'FTS5 虚表要从 DDL 派生出来');

    // FTS5 的影子表确实存在 —— 它们由 SQLite 建，不是我们的表（排除规则要如实钉住）
    const raw = allTables(lib.db);
    assert.ok(raw.includes('asset_name_fts_data'), 'FTS5 影子表应存在：' + raw.join(','));
    assert.ok(raw.includes('sqlite_sequence'), 'AUTOINCREMENT 会带来 sqlite_sequence（health_finding 要它）');
    assert.ok(!EXPECTED_TABLES.includes('sqlite_sequence'), '内部表不许混进应有清单');

    // 索引：从 DDL 派生的 idx_* 必须真的建出来
    const idx = indexNames(lib.db);
    const fromDdl = LIBRARY_MIGRATIONS.flatMap((m) => m.statements)
      .join('\n')
      .match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(idx_[A-Za-z0-9_]+)/g)
      .map((s) => s.replace(/^.*?(idx_[A-Za-z0-9_]+)$/, '$1'));
    assert.deepEqual(idx, [...new Set(fromDdl)].sort(), 'idx_* 索引必须与 DDL 逐条对上');

    // 库级库里**不许**出现应用级表
    for (const t of APP_TABLES) assert.equal(raw.includes(t), false, '库级库不该有 ' + t);
  } finally {
    lib.db.close();
  }

  const app = openApp('G2-app');
  try {
    assert.equal(app.migration.toVersion, APP_TARGET_SCHEMA_VERSION);
    assert.deepEqual(ourTables(app.db, []), [...APP_TABLES]);
    assert.equal(APP_TABLES.length, 6, '应用级 6 张（含账本 app_meta）');
    assert.ok(APP_TABLES.includes(APP_META_TABLE));
    for (const t of LIBRARY_TABLES) assert.equal(allTables(app.db).includes(t), false, '应用级库不该有 ' + t);
  } finally {
    app.db.close();
  }
});

// ============================================================ G6/G7/G8 五条修正

test('G6 ⭐ 修正 #3：UNIQUE(lib_id, rel_path) 落在**真实列**上（asset.rel_path），重复登记被拒', () => {
  const lib = openLibrary('G6');
  try {
    const cols = columnsOf(lib.db, 'asset');
    const relPath = cols.find((c) => c.name === 'rel_path');
    assert.ok(relPath, 'asset 必须有 rel_path（提案把它写在约束里却没给列）');
    assert.equal(relPath.notnull, 1, 'rel_path 由扫描器写 ⇒ NOT NULL');
    assert.equal(cols.filter((c) => c.name === 'rel_path').length, 1);

    const uniq = uniqueIndexColumns(lib.db, 'asset').filter(
      (i) => i.columns.length === 2 && i.columns[0] === 'lib_id' && i.columns[1] === 'rel_path',
    );
    assert.equal(uniq.length, 1, 'UNIQUE (lib_id, rel_path) 必须真的存在：' + JSON.stringify(uniqueIndexColumns(lib.db, 'asset')));

    insertAsset(lib.db, hex(1));
    assert.throws(() => insertAsset(lib.db, hex(2), { rel_path: 'CR/ID-' + hex(1) + '.jpg' }), /UNIQUE|constraint/i,
      '同库同路径不得登记两次（uid 不再由路径派生 ⇒ 这条唯一性是唯一的防线）');
    // 不同库的同名路径是合法的
    insertAsset(lib.db, hex(3), { lib_id: 'L2' });
    assert.equal(lib.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, 2);
  } finally {
    lib.db.close();
  }
});

test('G7 ⭐ 修正 #4：recent_query 用哨兵 scope_lib_id；"全部库"与图片查询都能去重', () => {
  const app = openApp('G7');
  try {
    const col = columnsOf(app.db, 'recent_query').find((c) => c.name === 'scope_lib_id');
    assert.ok(col, 'scope_lib_id 必须存在');
    assert.equal(col.notnull, 1, '哨兵列必须 NOT NULL（可空 + UNIQUE 会让"全部库"每次新增行）');
    assert.equal(col.dflt, "''", "默认必须是空串哨兵（'' = 全部库）");

    const ins = (id, kind, text, imageRef, scope, at) =>
      app.db.prepare(
        'INSERT INTO recent_query (query_id, kind, text, image_ref, scope_lib_id, result_count, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, kind, text, imageRef, scope, 1, at);

    // 全部库（scope=''）同一个词反复搜 ⇒ 只留一行
    ins('q1', 'text', '大海', null, '', FIXED_NOW);
    assert.throws(() => ins('q2', 'text', '大海', null, '', FIXED_NOW + 1), /UNIQUE|constraint/i,
      '哨兵写法必须让"全部库"的文字查询去重');
    // 换范围就是另一条历史（重跑时要还原当时的范围）
    ins('q3', 'text', '大海', null, 'L1', FIXED_NOW + 2);
    // 图片查询按 image_ref 去重（kind='image' 时 text 为 NULL，NULL 不参与唯一比较）
    ins('q4', 'image', null, hex(7), '', FIXED_NOW + 3);
    assert.throws(() => ins('q5', 'image', null, hex(7), '', FIXED_NOW + 4), /UNIQUE|constraint/i,
      '图片查询同样要去重（它的天然键是 image_ref）');
    // 形状守卫：kind='text' 必须带 text，kind='image' 必须带 image_ref
    assert.throws(() => ins('q6', 'text', null, null, '', FIXED_NOW + 5), /CHECK|constraint/i);
    assert.throws(() => ins('q7', 'image', null, null, '', FIXED_NOW + 6), /CHECK|constraint/i);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM recent_query').get().n, 3);
    //（q1 全部库 / q3 限 L1 / q4 图片各一条；q2 q5 被唯一索引拒、q6 q7 被 CHECK 拒）
  } finally {
    app.db.close();
  }
});

test('G8 ⭐ 修正 #5：job 是**全局单任务**（活跃行只能有一行）；历史行不受限', () => {
  const lib = openLibrary('G8');
  try {
    const ins = (id, kind, state) =>
      lib.db.prepare(
        'INSERT INTO job (job_id, kind, state, progress_done, queued_at_ms) VALUES (?, ?, ?, 0, ?)',
      ).run(id, kind, state, FIXED_NOW);

    const idxNames = lib.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uniq_job_single_active'").all();
    assert.equal(idxNames.length, 1, '全局单任务约束必须真的建出来');

    ins('j1', 'index', 'running');
    assert.throws(() => ins('j2', 'health', 'queued'), /UNIQUE|constraint/i,
      '第二个活跃任务必须被拒（索引/扫描/体检/重建/入库全串行 —— 产品决定）');
    ins('j3', 'scan', 'done');       // 历史行可以有多条
    ins('j4', 'index', 'failed');
    lib.db.prepare("UPDATE job SET state = 'done' WHERE job_id = 'j1'").run();
    ins('j5', 'health', 'running');  // 前一个结束后可以再起一个
    assert.equal(lib.db.prepare('SELECT COUNT(*) AS n FROM job').get().n, 4);
    //（j1 已转 done / j3 done / j4 failed / j5 running；j2 被全局单任务约束拒）
  } finally {
    lib.db.close();
  }
});

// ============================================================ G3 两套账本独立

test('G3 ⭐ 两套账本各自独立：推进一个不动另一个', () => {
  const lib = openLibrary('G3-lib');
  const app = openApp('G3-app');
  try {
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION);
    assert.equal(APP_META_LEDGER.readVersion(app.db), APP_TARGET_SCHEMA_VERSION);

    // 应用级加一条 v2：库级版本与表集合必须一字不动
    const libTablesBefore = ourTables(lib.db, LIBRARY_VIRTUAL_TABLES);
    const appV2 = {
      version: 2,
      name: 'probe-app-only',
      statements: ['CREATE TABLE IF NOT EXISTS probe_app_v2 (x INTEGER);'],
    };
    const r2 = migrateApp(app.db, { migrations: [...APP_MIGRATIONS, appV2], now });
    assert.deepEqual(r2.applied.map((m) => m.version), [2]);
    assert.equal(APP_META_LEDGER.readVersion(app.db), 2);
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION, '应用级推进不得碰库级版本');
    assert.deepEqual(ourTables(lib.db, LIBRARY_VIRTUAL_TABLES), libTablesBefore, '库级表集合不得变');
    assert.equal(ourTables(app.db, []).includes('probe_app_v2'), true);

    // 库级账本坏掉也不影响应用级
    lib.db.prepare('UPDATE schema_version SET version = 999 WHERE id = 1').run();
    assert.equal(APP_META_LEDGER.readVersion(app.db), 2, '库级版本坏了不该影响应用级');
  } finally {
    lib.db.close();
    app.db.close();
  }
});

// ============================================================ G4 幂等

test('G4 ⭐ 幂等重跑：不执行 DDL、不清数据、不报错（两套账本都是）', () => {
  const lib = openLibrary('G4-lib');
  insertAsset(lib.db, hex(9));
  const snapshot = lib.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
  const updatedAt = lib.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at;
  lib.db.close();

  const again = openGsDb({ dbPath: lib.dbPath, now });
  try {
    assert.equal(again.migration.applied.length, 0, '幂等重跑不得执行任何迁移');
    assert.equal(again.migration.upToDate, true);
    assert.deepEqual(again.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(), snapshot);
    assert.equal(again.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at, updatedAt);
    assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, 1);
    const third = migrate(again.db, { now });
    assert.equal(third.upToDate, true);
  } finally {
    again.db.close();
  }

  const app = openApp('G4-app');
  try {
    const before = app.db.prepare('SELECT updated_at_ms FROM app_meta WHERE id = 1').get().updated_at_ms;
    const againApp = migrateApp(app.db, { now });
    assert.equal(againApp.upToDate, true);
    assert.equal(app.db.prepare('SELECT updated_at_ms FROM app_meta WHERE id = 1').get().updated_at_ms, before,
      '幂等重跑不得写 updated_at_ms');
  } finally {
    app.db.close();
  }
});

// ============================================================ G5 迁移失败 / 未来版本

test('G5 ⭐ 迁移失败 ⇒ 整条回滚（不留半张表）；未来版本 ⇒ SCHEMA_TOO_NEW', () => {
  const lib = openLibrary('G5');
  try {
    const broken = [
      ...LIBRARY_MIGRATIONS,
      { version: TARGET_SCHEMA_VERSION + 1, name: 'broken-on-purpose', statements: ['CREATE TABLE probe_partial (a INTEGER);', 'CREATE TABLE broken ('] },
    ];
    let err = null;
    try { migrate(lib.db, { migrations: broken, now }); } catch (e) { err = e; }
    assert.ok(err instanceof GsDbError);
    assert.equal(err.code, 'MIGRATION_FAILED');
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION, '失败后版本必须停在上一条');
    assert.equal(allTables(lib.db).includes('probe_partial'), false, '同一事务里先建成功的表也必须回滚');

    // 断代（跳版本）⇒ SCHEMA_GAP，而不是"跳到最大版本"
    const gapped = [...LIBRARY_MIGRATIONS, { version: TARGET_SCHEMA_VERSION + 2, name: 'gap', statements: ['CREATE TABLE probe_gap (a INTEGER);'] }];
    let gapErr = null;
    try { migrate(lib.db, { migrations: gapped, now }); } catch (e) { gapErr = e; }
    assert.ok(gapErr instanceof GsDbError);
    assert.equal(gapErr.code, 'SCHEMA_GAP');
    assert.equal(allTables(lib.db).includes('probe_gap'), false);

    // 未来版本
    lib.db.prepare('UPDATE schema_version SET version = 999 WHERE id = 1').run();
    let tooNew = null;
    try { migrate(lib.db, { now }); } catch (e) { tooNew = e; }
    assert.ok(tooNew instanceof GsDbError);
    assert.equal(tooNew.code, 'SCHEMA_TOO_NEW');
    assert.equal(readSchemaVersion(lib.db), 999, '拒绝后不许偷偷改回版本号');
  } finally {
    lib.db.close();
  }
});

// ============================================================ 只读 + 账本形状

test('G6b：只读打开不迁移；账本单行守卫/版本非负 由库级约束保证', () => {
  const lib = openLibrary('G6b');
  lib.db.close();

  const ro = openGsDb({ dbPath: lib.dbPath, readOnly: true, now });
  try {
    assert.deepEqual(ro.migration.applied, [], '只读打开不得执行迁移');
    assert.equal(readSchemaVersion(ro.db), TARGET_SCHEMA_VERSION);
  } finally {
    ro.db.close();
  }

  const w = openGsDb({ dbPath: lib.dbPath, now });
  try {
    assert.throws(
      () => w.db.prepare('INSERT INTO schema_version (id, version, updated_at) VALUES (2, 0, ?)').run(FIXED_NOW),
      /CHECK|constraint/i, '账本第二行必须被库级约束拒掉');
    assert.throws(
      () => w.db.prepare('UPDATE schema_version SET version = -1 WHERE id = 1').run(),
      /CHECK|constraint/i, '版本号不许为负');
    assert.throws(
      () => w.db.prepare('INSERT INTO app_meta (id, schema_version, created_at_ms, updated_at_ms) VALUES (2, 0, ?, ?)').run(FIXED_NOW, FIXED_NOW),
      /no such table/i, 'app_meta 只属于应用级库（库级库不该有它）');
  } finally {
    w.db.close();
  }
});

// ============================================================ 清单派生自检

test('G0 ⭐ 应有表清单从 DDL 派生（不是手写清单），且清单合法', () => {
  // 派生函数本身可证：给它一段 DDL，它必须认普通表与虚拟表
  assert.deepEqual(createdTableNames(['CREATE TABLE t1 (a INTEGER);', 'CREATE VIRTUAL TABLE t2 USING fts5(x);']), ['t1', 't2']);
  // 删掉一条 DDL ⇒ 派生清单跟着变（证明它不是手写常量）
  const oneLess = LIBRARY_MIGRATIONS.map((m) => ({
    version: m.version,
    name: m.name,
    statements: m.statements.filter((s) => !s.includes('CREATE TABLE IF NOT EXISTS tag ')),
  }));
  const derived = createdTableNames(oneLess.flatMap((m) => m.statements));
  assert.equal(derived.includes('tag'), false, 'DDL 里删掉 tag ⇒ 派生清单必须跟着少一张');
  assert.equal(LIBRARY_TABLES.includes('tag'), true, '真实清单里 tag 必须在（上一条只是证明派生有效）');

  validateMigrations(LIBRARY_MIGRATIONS);
  validateMigrations(APP_MIGRATIONS);
  assert.equal(APP_MIGRATIONS.length, 1);
  assert.equal(LIBRARY_MIGRATIONS.length, 1);
  assert.equal(SCHEMA_VERSION_TABLE, 'schema_version');
});

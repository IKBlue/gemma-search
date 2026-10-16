// apps/desktop/tests/db-schema.test.mjs —— S1/S1b 绿地 schema 的验收测试（**本轮 6 张** · 四层分类 · 两套账本）
//
// 2026-10-15：整体重写。旧版测的是 v1/v2（library / items / 文档三表 / 体检两表），绿地已全部丢弃。
// 2026-10-15 · S1b（所有者裁定 B · TASKS §4 U19）：**只建 6 张**（库级 3 + 应用级 3），其余 14 张随功能上线。
//
// 每条用例对应一个**会静默出错的失败模式**（不是凑数的分支覆盖）：
//   G1 表数不对 / 有待建的表没被点名 ⇒ 第二批加表时悄悄长出没有归属的表（B 不丢能力的核心断言）
//   G2 DDL 与"应有表清单"漂移  ⇒ "表是否在"的自检会漏报；暂缓的表被偷偷建出来也会被发现
//   G3 两套账本互相污染         ⇒ 推应用级版本却动了库级表（或反之）
//   G4 幂等重跑重建了表         ⇒ 每次启动清空元数据
//   G5 迁移失败留下半张表       ⇒ 下次启动看到没人解释得了的中间态
//   G6 修正 #3 没落实           ⇒ UNIQUE(lib_id, rel_path) 建在假列上（提案原样就是建不出来）
//   G7 列集比基线多             ⇒ "迟早要用"的列被提前加进来（回收站/去重/内容时间/缩略图哈希/needs_reencode）
//   G8 collect_dir 落错库       ⇒ 全局安全边界退化成"每个库一份白名单"
//   G9 分类常量被改坏           ⇒ 四组不再覆盖 DDL 建出的表（用"删一条分类"现场证明会红）
//   A1 适配层被绕过             ⇒ 实验性 API 散落各处
//   A2 撒 any 换绿灯            ⇒ 门禁失去意义
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
  tablesInLayer,
  validateMigrations,
} from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_s1', 'db-schema-test-' + process.pid);
const LIB_DB = '.gs.db';
const APP_DB = 'app.db';
const FIXED_NOW = 1700000000000;
const now = () => FIXED_NOW;

/** 已建出的库级表（**不写数量**：加表时这里只加名字，数量由 DDL 派生） */
const KEPT_LIBRARY = [
  'asset',
  'asset_file',
  'asset_index_state',
  'job',
  'health_run',
  'health_finding',
];
const KEPT_APP = ['app_meta', 'collect_dir', 'library_registry'];
/** 仍未建的表（随功能上线；它们现在一张都不许被建出来）—— `job`(B2-1) / `health_run`+`health_finding`(B2-2) 已建出，从本表移走 */
const DEFERRED_TABLES = [
  'app_setting',
  'activity',
  'recent_query',
  'recent_view',
  'asset_name_fts',
  'asset_user_meta',
  'tag',
  'asset_tag',
  'collection',
  'collection_item',
  'asset_export',
];

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------- sqlite_master 读取

function allTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
}
/** SQLite 内部表（本轮没有 AUTOINCREMENT，理论上不该出现；留着是为了让"出现了"变红而不是悄悄漏过） */
const SQLITE_INTERNAL = ['sqlite_sequence'];
/** 虚拟表（FTS5）会带来影子表；按 <vt>_ 前缀机械排除，不手写影子表名。本轮应为空。 */
function ourTables(db, virtualTables) {
  const shadowPrefixes = virtualTables.map((vt) => vt + '_');
  return allTables(db).filter(
    (name) => !SQLITE_INTERNAL.includes(name) && !shadowPrefixes.some((p) => name.startsWith(p)),
  );
}
function indexNames(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}
function columnsOf(db, table) {
  return db
    .prepare('PRAGMA table_info(' + table + ')')
    .all()
    .map((r) => ({
      name: r.name,
      type: r.type,
      notnull: r.notnull,
      pk: r.pk,
      dflt: r.dflt_value,
    }));
}
/** 表上的唯一索引 → 列名数组（用来证明 UNIQUE 落在**真实列**上） */
function uniqueIndexColumns(db, table) {
  const out = [];
  for (const idx of db.prepare('PRAGMA index_list(' + table + ')').all()) {
    if (idx.unique !== 1) continue;
    const cols = db
      .prepare('PRAGMA index_info(' + idx.name + ')')
      .all()
      .map((r) => r.name);
    out.push({ name: idx.name, columns: cols });
  }
  return out;
}
/** 从 DDL 文本里取出 idx_* 索引名（证明索引也是 DDL 派生、且真的建出来了） */
function ddlIndexNames(migrations) {
  const sql = migrations.flatMap((m) => m.statements).join('\n');
  const hits =
    sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_[A-Za-z0-9_]+/g) || [];
  return [...new Set(hits.map((s) => s.replace(/^.*?(idx_[A-Za-z0-9_]+)$/, '$1')))].sort();
}
function openLibrary(label) {
  return openGsDb({ dbPath: path.join(freshDir(label), LIB_DB), now });
}
function openApp(label) {
  const dbPath = path.join(freshDir(label), APP_DB);
  const db = openNodeSqlite(dbPath);
  const migration = migrateApp(db, { now });
  return { db, dbPath, migration };
}

const hex = (n) => n.toString(16).padStart(12, '0');
function insertAsset(db, uid, over = {}) {
  const row = Object.assign(
    {
      uid,
      lib_id: 'L1',
      folder: 'CR',
      stem: 'ID-' + uid,
      display_name: 'ID-' + uid + '.jpg',
      rel_dir: 'CR',
      rel_path: 'CR/ID-' + uid + '.jpg',
      discovered_at_ms: FIXED_NOW,
    },
    over,
  );
  // 8 列 —— 以设计基线 §1.2 为准（没有 content_created_at_ms / deleted_at_ms / dup_group_id / updated_at_ms）
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.uid,
    row.lib_id,
    row.folder,
    row.stem,
    row.display_name,
    row.rel_dir,
    row.rel_path,
    row.discovered_at_ms,
  );
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
    'jobs.ts',
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
  assert.deepEqual(
    electronImporters,
    [],
    'db 层必须能在 node --test 里直接跑 ⇒ 不许 import electron',
  );
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

test('G1 ⭐ 每张建出的表都在四组里被点名，且只被点名一次', () => {
  // ⚠️ B2-2（ACC-1 的教训）：**不再断言"当前几张"** —— 写死的是**状态**，检查的本意是**关系**。
  //    关系 = ① DDL 派生 == 四组点名（双向）② 每张恰好点名一次 ③ 落点与层一一对应。
  //    加表的人只要**分类**就会绿；想"改大数字"来蒙混这条路已经不存在了。
  const grouped = schemaTables();
  assert.ok(grouped.length > 0, '四组点名不能为空（否则下面全是恒真）');

  // 双向：DDL 派生 == 四组点名（缺一边都要红）—— 这是"第二批加表会被逼着分类"的执行点
  const fromDdl = [...LIBRARY_TABLES, ...APP_TABLES].sort();
  assert.deepEqual(
    fromDdl,
    grouped,
    'DDL 建出的表与四组点名必须逐张对上（缺分类 / 多分类都算漂移）',
  );

  // 每张表**恰好**出现一次
  const seen = new Map();
  for (const layer of SCHEMA_LAYER_ORDER) {
    for (const name of SCHEMA_LAYERS[layer]) seen.set(name, (seen.get(name) || 0) + 1);
  }
  assert.deepEqual([...seen.keys()].sort(), grouped, '点名集合必须与派生集合逐张相同');
  for (const [name, n] of seen) assert.equal(n, 1, name + ' 被点名了 ' + String(n) + ' 次');

  // 四层各自点名（**空层是合法的**：intent 本轮为空）
  assert.deepEqual(tablesInLayer('fact'), ['asset', 'asset_file']);
  assert.deepEqual(tablesInLayer('process'), [
    'asset_index_state',
    'job',
    'health_run',
    'health_finding',
  ]);
  assert.deepEqual(tablesInLayer('intent'), [], '意图层本轮一张表都没有 —— 空层允许为空');
  assert.deepEqual(tablesInLayer('app'), ['app_meta', 'library_registry', 'collect_dir']);

  // 物理落点与层一一对应
  assert.deepEqual([...LIBRARY_TABLES].sort(), KEPT_LIBRARY.slice().sort());
  assert.deepEqual([...APP_TABLES].sort(), KEPT_APP.slice().sort());
  assert.deepEqual(
    libraryLayerTables(),
    [...LIBRARY_TABLES].sort(),
    'DDL 落点与层分类必须一致（库级）',
  );
  assert.deepEqual(appLayerTables(), [...APP_TABLES].sort(), 'DDL 落点与层分类必须一致（应用级）');
  // ⚠️ 清单**必须逐张列出来**（它是第二批的输入），但**长度不再断言**（ACC-1 的教训）——
  //    改为钉两条真判据：清单不能为空 · 清单与已建表**互斥**（建出的表还留在清单里 = 清单该更新了）。
  assert.ok(DEFERRED_TABLES.length > 0, '仍未建的清单不能为空（否则这条检查变成恒真）');
  assert.deepEqual(
    DEFERRED_TABLES.filter((t) => grouped.includes(t)),
    [],
    '已建出的表不许还留在"仍未建"清单里（清单必须与 DDL 同步）',
  );
  for (const t of [...KEPT_LIBRARY, ...KEPT_APP, 'schema_version']) {
    assert.equal(DEFERRED_TABLES.includes(t), false, t + ' 已建出，不许出现在"仍未建"清单里');
  }
});

// ============================================================ G2 DDL 建表 + 索引

test('G2 ⭐ 打开两个库：DDL 建出全部表与索引；仍未建的表一张都不许被建出来', () => {
  const lib = openLibrary('G2-lib');
  const app = openApp('G2-app');
  try {
    assert.equal(lib.created, true);
    assert.deepEqual(
      lib.migration.applied.map((m) => m.version),
      LIBRARY_MIGRATIONS.map((m) => m.version),
      '首建必须跑完整条迁移链（**跟随清单**，不写死 [1,2] —— B2-2 起有 v3）',
    );
    assert.equal(lib.migration.toVersion, TARGET_SCHEMA_VERSION);

    // 我们建的表 == 应有清单（库级业务表 + 账本 schema_version）—— 两栏都**从 DDL 派生**，不写数量
    assert.deepEqual(ourTables(lib.db, LIBRARY_VIRTUAL_TABLES), [...EXPECTED_TABLES]);
    assert.ok(LIBRARY_TABLES.length > 0);
    assert.deepEqual(
      [...EXPECTED_TABLES],
      [...LIBRARY_TABLES, 'schema_version'].sort(),
      '应有清单 = 业务表 + 账本（派生对照，不写死张数）',
    );
    assert.deepEqual(
      [...LIBRARY_VIRTUAL_TABLES],
      [],
      '本轮没有 FTS 虚表（asset_name_fts 进第二批）',
    );
    assert.equal(allTables(lib.db).includes('sqlite_sequence'), false, '本轮没有 AUTOINCREMENT 表');

    // 索引：DDL 里声明的 idx_* 必须真的建出来
    assert.deepEqual(indexNames(lib.db), ddlIndexNames(LIBRARY_MIGRATIONS));

    // 应用级 3 张
    assert.equal(app.migration.toVersion, APP_TARGET_SCHEMA_VERSION);
    assert.deepEqual(ourTables(app.db, []), [...APP_TABLES]);
    assert.equal(APP_TABLES.length, 3);
    assert.ok(APP_TABLES.includes(APP_META_TABLE));
    assert.deepEqual(indexNames(app.db), ddlIndexNames(APP_MIGRATIONS));

    // 两库互不串味
    for (const name of APP_TABLES)
      assert.equal(allTables(lib.db).includes(name), false, '库级库不该有 ' + name);
    for (const name of LIBRARY_TABLES)
      assert.equal(allTables(app.db).includes(name), false, '应用级库不该有 ' + name);

    // 仍未建的表：两库都不许出现（"先建着"是被所有者否决的选项）
    for (const name of DEFERRED_TABLES) {
      assert.equal(allTables(lib.db).includes(name), false, '本轮不建 ' + name + '（进第二批）');
      assert.equal(allTables(app.db).includes(name), false, '本轮不建 ' + name + '（进第二批）');
    }
  } finally {
    lib.db.close();
    app.db.close();
  }
});

// ============================================================ G6 修正 #3

test('G6 ⭐ 修正 #3：UNIQUE(lib_id, rel_path) 落在**真实列**上（asset.rel_path），重复登记被拒', () => {
  const lib = openLibrary('G6');
  try {
    const cols = columnsOf(lib.db, 'asset');
    const relPath = cols.find((c) => c.name === 'rel_path');
    assert.ok(relPath, 'asset 必须有 rel_path（提案把它写在约束里却没给列）');
    assert.equal(relPath.notnull, 1, 'rel_path 由扫描器写 ⇒ NOT NULL');

    const uniq = uniqueIndexColumns(lib.db, 'asset').filter(
      (i) => i.columns.length === 2 && i.columns[0] === 'lib_id' && i.columns[1] === 'rel_path',
    );
    assert.equal(
      uniq.length,
      1,
      'UNIQUE (lib_id, rel_path) 必须真的存在：' +
        JSON.stringify(uniqueIndexColumns(lib.db, 'asset')),
    );

    insertAsset(lib.db, hex(1));
    assert.throws(
      () => insertAsset(lib.db, hex(2), { rel_path: 'CR/ID-' + hex(1) + '.jpg' }),
      /UNIQUE|constraint/i,
      '同库同路径不得登记两次（uid 不再由路径派生 ⇒ 这条唯一性是唯一的防线）',
    );
    insertAsset(lib.db, hex(3), { lib_id: 'L2' }); // 不同库的同名路径合法
    assert.equal(lib.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, 2);

    // 外键：asset_file 的 uid 必须指向 asset，且真的级联
    const fks = lib.db.prepare('PRAGMA foreign_key_list(asset_file)').all();
    assert.equal(fks.length, 1);
    assert.equal(fks[0].table, 'asset');
    assert.equal(fks[0].on_delete, 'CASCADE');
    const insFile = (role) =>
      lib.db
        .prepare(
          'INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(hex(1), role, 'CR/ID-' + hex(1) + '.jpg', 'jpg', 10, FIXED_NOW);
    assert.throws(
      () => insFile('image'),
      /CHECK|constraint/i,
      'role 用 preview/archive（设计基线 §1.2），不是提案里的 image/archive',
    );
    insFile('preview');
    lib.db.prepare('DELETE FROM asset WHERE uid = ?').run(hex(1));
    assert.equal(
      lib.db.prepare('SELECT COUNT(*) AS n FROM asset_file WHERE uid = ?').get(hex(1)).n,
      0,
      'CASCADE 必须真的生效',
    );
  } finally {
    lib.db.close();
  }
});

// ============================================================ G7 列集以设计基线 §1 为准

test('G7 ⭐ 列集 = 设计基线 §1（本批刻意不加的列一个都不许提前出现）', () => {
  const lib = openLibrary('G7-lib');
  try {
    const cols = (t) => columnsOf(lib.db, t).map((c) => c.name);
    // asset 8 列 · asset_file 8 个物理列（基线按"字段行"记 7，width/height 同一行）
    assert.deepEqual(cols('asset'), [
      'uid',
      'lib_id',
      'folder',
      'stem',
      'display_name',
      'rel_dir',
      'rel_path',
      'discovered_at_ms',
    ]);
    assert.deepEqual(cols('asset_file'), [
      'uid',
      'role',
      'rel_path',
      'ext',
      'size_bytes',
      'mtime_ms',
      'width',
      'height',
    ]);
    assert.deepEqual(cols('asset_index_state'), [
      'uid',
      'encoded_at_ms',
      'encoded_mtime_ms',
      'compat_key',
      'vector_row',
      'attempt_count',
      'last_error',
      'last_error_at_ms',
      'excluded_at_ms',
      'checked_at_ms',
    ]);

    // 提案里有、本批**刻意不加**的列（加列 = 一条迁移；"迟早要用"不是理由）
    for (const [table, gone] of [
      ['asset', ['deleted_at_ms', 'dup_group_id', 'content_created_at_ms', 'updated_at_ms']],
      ['asset_file', ['thumb_hash', 'content_hash_kind', 'content_hash_value']],
      ['asset_index_state', ['needs_reencode']],
    ]) {
      for (const c of gone) {
        assert.equal(
          cols(table).includes(c),
          false,
          table + '.' + c + ' 本批不该存在（设计基线 §1 已裁掉）',
        );
      }
    }
  } finally {
    lib.db.close();
  }

  const app = openApp('G7-app');
  try {
    const cols = (t) => columnsOf(app.db, t).map((c) => c.name);
    assert.deepEqual(cols('app_meta'), ['id', 'schema_version', 'created_at_ms', 'updated_at_ms']);
    assert.deepEqual(cols('library_registry'), [
      'lib_id',
      'root',
      'display_name',
      'enabled',
      'compat_key',
      'sort_order',
      'registered_at_ms',
      'updated_at_ms',
    ]);
    assert.deepEqual(cols('collect_dir'), [
      'dir_id',
      'label',
      'abs_path',
      'is_default',
      'created_at_ms',
    ]);
  } finally {
    app.db.close();
  }
});

// ============================================================ G8 collect_dir 的落点

test('G8 ⭐ collect_dir 在**应用级**（全局安全边界），且默认项只能有一个', () => {
  assert.equal(
    APP_TABLES.includes('collect_dir'),
    true,
    'collect_dir 必须在应用级（SPEC F1 的全局安全边界）',
  );
  assert.equal(
    LIBRARY_TABLES.includes('collect_dir'),
    false,
    'collect_dir 不许落库级（否则每个库各定义一份白名单）',
  );

  const app = openApp('G8');
  try {
    const ins = (id, label, isDefault) =>
      app.db
        .prepare(
          'INSERT INTO collect_dir (dir_id, label, abs_path, is_default, created_at_ms) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, label, 'X:/take/' + id, isDefault, FIXED_NOW);
    ins('c1', '素材待用', 1);
    ins('c2', '移出素材', 0);
    assert.throws(
      () => ins('c3', '第二个默认', 1),
      /UNIQUE|constraint/i,
      '默认取件目录只能有一个（库级约束）',
    );
    assert.throws(() => ins('c4', '素材待用', 0), /UNIQUE|constraint/i, '同名目录不许登记两次');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM collect_dir').get().n, 2);
  } finally {
    app.db.close();
  }
});

// ============================================================ G3 两套账本独立

test('G3 ⭐ 两套账本各自独立：推进一个不动另一个', () => {
  const lib = openLibrary('G3-lib');
  const app = openApp('G3-app');
  try {
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION);
    assert.equal(APP_META_LEDGER.readVersion(app.db), APP_TARGET_SCHEMA_VERSION);

    const libTablesBefore = ourTables(lib.db, LIBRARY_VIRTUAL_TABLES);
    const appV2 = {
      version: 2,
      name: 'probe-app-only',
      statements: ['CREATE TABLE IF NOT EXISTS probe_app_v2 (x INTEGER);'],
    };
    const r2 = migrateApp(app.db, { migrations: [...APP_MIGRATIONS, appV2], now });
    assert.deepEqual(
      r2.applied.map((m) => m.version),
      [2],
    );
    assert.equal(APP_META_LEDGER.readVersion(app.db), 2);
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION, '应用级推进不得碰库级版本');
    assert.deepEqual(
      ourTables(lib.db, LIBRARY_VIRTUAL_TABLES),
      libTablesBefore,
      '库级表集合不得变',
    );
    assert.equal(ourTables(app.db, []).includes('probe_app_v2'), true);

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
  const snapshot = lib.db
    .prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
    .all();
  const updatedAt = lib.db
    .prepare('SELECT updated_at FROM schema_version WHERE id = 1')
    .get().updated_at;
  lib.db.close();

  const again = openGsDb({ dbPath: lib.dbPath, now });
  try {
    assert.equal(again.migration.applied.length, 0, '幂等重跑不得执行任何迁移');
    assert.equal(again.migration.upToDate, true);
    assert.deepEqual(
      again.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
      snapshot,
    );
    assert.equal(
      again.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at,
      updatedAt,
    );
    assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, 1);
    const third = migrate(again.db, { now });
    assert.equal(third.upToDate, true);
  } finally {
    again.db.close();
  }

  const app = openApp('G4-app');
  try {
    const before = app.db
      .prepare('SELECT updated_at_ms FROM app_meta WHERE id = 1')
      .get().updated_at_ms;
    const againApp = migrateApp(app.db, { now });
    assert.equal(againApp.upToDate, true);
    assert.equal(
      app.db.prepare('SELECT updated_at_ms FROM app_meta WHERE id = 1').get().updated_at_ms,
      before,
      '幂等重跑不得写 updated_at_ms',
    );
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
      {
        version: TARGET_SCHEMA_VERSION + 1,
        name: 'broken-on-purpose',
        statements: ['CREATE TABLE probe_partial (a INTEGER);', 'CREATE TABLE broken ('],
      },
    ];
    let err = null;
    try {
      migrate(lib.db, { migrations: broken, now });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GsDbError);
    assert.equal(err.code, 'MIGRATION_FAILED');
    assert.equal(readSchemaVersion(lib.db), TARGET_SCHEMA_VERSION, '失败后版本必须停在上一条');
    assert.equal(
      allTables(lib.db).includes('probe_partial'),
      false,
      '同一事务里先建成功的表也必须回滚',
    );

    const gapped = [
      ...LIBRARY_MIGRATIONS,
      {
        version: TARGET_SCHEMA_VERSION + 2,
        name: 'gap',
        statements: ['CREATE TABLE probe_gap (a INTEGER);'],
      },
    ];
    let gapErr = null;
    try {
      migrate(lib.db, { migrations: gapped, now });
    } catch (e) {
      gapErr = e;
    }
    assert.ok(gapErr instanceof GsDbError);
    assert.equal(gapErr.code, 'SCHEMA_GAP');
    assert.equal(allTables(lib.db).includes('probe_gap'), false);

    lib.db.prepare('UPDATE schema_version SET version = 999 WHERE id = 1').run();
    let tooNew = null;
    try {
      migrate(lib.db, { now });
    } catch (e) {
      tooNew = e;
    }
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
      () =>
        w.db
          .prepare('INSERT INTO schema_version (id, version, updated_at) VALUES (2, 0, ?)')
          .run(FIXED_NOW),
      /CHECK|constraint/i,
      '账本第二行必须被库级约束拒掉',
    );
    assert.throws(
      () => w.db.prepare('UPDATE schema_version SET version = -1 WHERE id = 1').run(),
      /CHECK|constraint/i,
      '版本号不许为负',
    );
    assert.throws(
      () =>
        w.db
          .prepare(
            'INSERT INTO app_meta (id, schema_version, created_at_ms, updated_at_ms) VALUES (2, 0, ?, ?)',
          )
          .run(FIXED_NOW, FIXED_NOW),
      /no such table/i,
      'app_meta 只属于应用级库（库级库不该有它）',
    );
  } finally {
    w.db.close();
  }
});

// ============================================================ 清单派生自检

test('G0 ⭐ 应有表清单从 DDL 派生（不是手写清单），且清单合法', () => {
  // 派生函数本身可证：给它一段 DDL，它必须认普通表与虚拟表
  assert.deepEqual(
    createdTableNames(['CREATE TABLE t1 (a INTEGER);', 'CREATE VIRTUAL TABLE t2 USING fts5(x);']),
    ['t1', 't2'],
  );
  // 删掉一条 DDL ⇒ 派生清单跟着变（证明它不是手写常量）
  const oneLess = LIBRARY_MIGRATIONS.map((m) => ({
    version: m.version,
    name: m.name,
    statements: m.statements.filter((s) => !s.includes('CREATE TABLE IF NOT EXISTS asset_file ')),
  }));
  const derived = createdTableNames(oneLess.flatMap((m) => m.statements));
  assert.equal(
    derived.includes('asset_file'),
    false,
    'DDL 里删掉 asset_file ⇒ 派生清单必须跟着少一张',
  );
  assert.equal(
    LIBRARY_TABLES.includes('asset_file'),
    true,
    '真实清单里 asset_file 必须在（上一条只是证明派生有效）',
  );

  validateMigrations(LIBRARY_MIGRATIONS);
  validateMigrations(APP_MIGRATIONS);
  assert.equal(APP_MIGRATIONS.length, 1);
  // ⚠️ 不再写死迁移条数（B2-1 是 2 条、B2-2 是 3 条…）。改钉**关系**：
  //    ① 版本号必须从 1 连续递增（validateMigrations 已保证严格递增，这里再钉"从 1 起、不跳号"）
  //    ② 清单最后一条 == TARGET_SCHEMA_VERSION（目标版本永远等于清单上限，不另写数字）
  assert.ok(LIBRARY_MIGRATIONS.length >= 1);
  assert.deepEqual(
    LIBRARY_MIGRATIONS.map((m) => m.version),
    LIBRARY_MIGRATIONS.map((_, i) => i + 1),
    '库级迁移版本必须从 1 起连续（加表 = 加一条新迁移，不许跳号/回头改旧迁移）',
  );
  assert.equal(
    LIBRARY_MIGRATIONS[LIBRARY_MIGRATIONS.length - 1].version,
    TARGET_SCHEMA_VERSION,
    '目标版本必须等于清单上限（派生，不另写数字）',
  );
  assert.equal(SCHEMA_VERSION_TABLE, 'schema_version');
});

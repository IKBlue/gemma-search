// apps/desktop/tests/db-schema.test.mjs —— T-11a .gs.db 建表与迁移机制的验收测试
//
// 每条用例都对应一个**会静默出错的失败模式**（不是凑数的分支覆盖）：
//   B1 建表不全 / 列序错位     ⇒ 导入时按位置绑定会把 libId 写进 folder，不报错
//   B2 幂等重跑重建了表         ⇒ 每次启动清空元数据，用户看到"库突然空了"
//   B3 版本不按序推进           ⇒ 只跑最高版本，中间态没人跑过
//   B4 删除重建结果不一致       ⇒ "损坏就删掉重建"这条 SPEC §2.1 的兜底本身不可信
//   B5 版本号乱写 / 未来版本    ⇒ 降级瞎改，把新列当成不存在
//   B6 迁移失败留下半张表       ⇒ 下次启动看到一个没人解释得了的中间态
//   B7 损坏文件报裸 SqliteError ⇒ 调用方无法按 code 分流，只能猜文案
//   A1 适配层被绕过             ⇒ 实验性 API 散落各处，换 Node 版本时逐个爆
//   B9 字段与 items.json 漂移   ⇒ 18 个字段少一个、或驼峰/下划线错配
//
// 跑法：node --test apps/desktop/tests/db-schema.test.mjs（也在 npm test 的 glob 里）
//
// 临时库落在仓库内 data/_t11/db-schema-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。
// ⚠️ 环境说明：本会话沙箱把 electron.exe 的写限制在仓库内，G:\model 与 AppData 一律 EPERM，
//    所以这里**故意用仓库内路径**跑；这不是产品路径，产品落点由 T-04 storage-roots.ts 给。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import {
  GsDbError,
  ITEM_COLUMNS,
  ITEM_FIELD_COLUMNS,
  ITEM_FIELDS,
  ITEM_INSERT_SQL,
  MIGRATIONS,
  SCHEMA_VERSION_TABLE,
  TARGET_SCHEMA_VERSION,
  itemRecordToSqlValues,
  migrate,
  openGsDb,
  readSchemaVersion,
  removeGsDbFiles,
  targetVersionOf,
} from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t11', 'db-schema-test-' + process.pid);
const DB = '.gs.db';
const FIXED_NOW = 1700000000000;
const now = () => FIXED_NOW;

// 元表之外的表（顺序 = 名称排序，SQLite 的 ORDER BY name 是二进制序）
const EXPECTED_TABLES = [
  'doc_chunks',
  'doc_dirs',
  'documents',
  'health_ledger',
  'health_runs',
  'items',
  'library',
  SCHEMA_VERSION_TABLE,
];
const EXPECTED_INDEXES = [
  'idx_doc_chunks_vector_row',
  'idx_doc_dirs_lib',
  'idx_documents_dir',
  'idx_documents_lib',
  'idx_documents_sha1',
  'idx_health_ledger_run',
  'idx_health_ledger_uid',
  'idx_health_runs_lib',
  'idx_items_archive_name',
  'idx_items_lib_folder',
  'idx_items_lib_vector_row',
  'idx_items_stem',
];

/** 每条用例一个独立子目录：用例之间不共享状态，失败时现场还在 */
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

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
}
function indexNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}
function columnsOf(db, table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((r) => ({
    name: r.name,
    type: r.type,
    notnull: r.notnull,
    pk: r.pk,
  }));
}
function count(db, table) {
  return db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
}
function schemaSnapshot(db) {
  return db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
}
function insertLibrary(db, libId) {
  db.prepare('INSERT INTO library (lib_id, root, registered_at, updated_at) VALUES (?, ?, ?, ?)').run(
    libId,
    'X:/lib',
    FIXED_NOW,
    FIXED_NOW,
  );
}
function insertItem(db, item) {
  const values = itemRecordToSqlValues(item);
  assert.equal(values.length, 18, '绑定参数必须正好 18 个');
  db.prepare(ITEM_INSERT_SQL).run(...values);
}

// 合成条目（B9 才用真的 items.json）：路径用正斜杠只是为了让本文件少一层转义
const ITEM = {
  uid: '0123456789ab',
  libId: 'L1',
  folder: 'CR',
  stem: 'ID-1',
  name: 'ID-1.jpg',
  relPath: 'CR/ID-1.jpg',
  absPath: 'X:/lib/CR/ID-1.jpg',
  imageExt: '.jpg',
  imageSize: 1234,
  imageMtime: 1700000000000,
  archiveName: 'ID-1.rar',
  archiveRelPath: 'CR/ID-1.rar',
  archiveAbsPath: 'X:/lib/CR/ID-1.rar',
  archiveExt: '.rar',
  archiveSize: 999,
  archiveMtime: 1699999999999,
  vectorRow: 0,
  vectorSource: 'native',
};
/** 缺包 + 未入索引的那一种（SPEC §1.1：archive* 全空是合法状态） */
const ITEM_MISSING_ARCHIVE = Object.assign({}, ITEM, {
  uid: 'fedcba987654',
  archiveName: null,
  archiveRelPath: null,
  archiveAbsPath: null,
  archiveExt: null,
  archiveSize: null,
  archiveMtime: null,
  vectorRow: null,
  vectorSource: null,
});

const isNullableColumn = (c) => c.startsWith('archive_') || c === 'vector_row' || c === 'vector_source';

// ============================================================ A1 适配层隔离（静态自检）

test('A1：db 层只有 sqlite-adapter.ts 碰 node:sqlite，且不 import electron', () => {
  const dir = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'db');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 5, '扫不到 db 层文件 ⇒ 路径写错了，本断言会空转');
  // ⚠️ 这是一份**精确清单**（不是 >= 判断）：新增文件必须显式加进来，否则下面的扫描面会
  //    "看起来还活着"却漏掉新文件 —— 那正是 A1/A2 变成空气断言的方式。
  //    T-11b 新增 import.ts 时同步加了这一行（同属 db 层，见 reports/2026-10-15-wave3/11b.txt）。
  //    T-42 新增 tmp-dir.ts（进程临时目录，SQLite 写不进去时那条真机失败路径的修复）——
  //    它只 import node:fs/node:path 与 log.ts，所以两条扫描（node:sqlite / electron）都不该命中它。
  assert.deepEqual(files.sort(), [
    'errors.ts',
    'import.ts',
    'index.ts',
    'migrations.ts',
    'open.ts',
    'row-types.ts',
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

test('A3：迁移清单本身合法，且版本是连续的 1..TARGET（顺序推进的前提）', () => {
  assert.ok(MIGRATIONS.length >= 2, '至少要有 v1/v2 两段，否则"按序推进"不可测');
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_m, i) => i + 1));
  assert.equal(TARGET_SCHEMA_VERSION, targetVersionOf(MIGRATIONS));
  assert.equal(TARGET_SCHEMA_VERSION, MIGRATIONS.length);
  // 每段迁移都必须有可执行语句，空段会让"版本推进"变成走过场
  for (const m of MIGRATIONS) assert.ok(m.statements.length > 0, 'v' + m.version + ' 没有语句');
});

// ============================================================ B1 建表

test('B1 ⭐ 全新库：建出全部表/索引，items 恰好 18 列且列序 = ITEM_COLUMNS', () => {
  const dbPath = path.join(freshDir('B1'), DB);
  const r = openGsDb({ dbPath, now });
  try {
    assert.equal(r.created, true, '打开前文件不存在 ⇒ created=true');
    assert.equal(r.migration.fromVersion, 0);
    assert.equal(r.migration.toVersion, TARGET_SCHEMA_VERSION);
    assert.deepEqual(r.migration.applied.map((m) => m.version), MIGRATIONS.map((m) => m.version));
    assert.equal(r.migration.upToDate, false);

    assert.deepEqual(tableNames(r.db), EXPECTED_TABLES);
    assert.deepEqual(indexNames(r.db), EXPECTED_INDEXES);

    const cols = columnsOf(r.db, 'items');
    assert.equal(cols.length, 18, 'items 必须正好 18 列（多一列少一列都算与 items.json 漂移）');
    // ⚠️ 这里断言的是**顺序**，不是集合：T-11b 用 ? 按位置绑定，顺序错了会静默串列
    assert.deepEqual(cols.map((c) => c.name), [...ITEM_COLUMNS]);
    assert.deepEqual([...ITEM_FIELDS].length, 18);
    assert.deepEqual([...ITEM_COLUMNS].length, 18);
    assert.equal(ITEM_INSERT_SQL.split('?').length - 1, 18, '占位符必须 18 个');

    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    for (const c of ITEM_COLUMNS) {
      assert.equal(byName[c].notnull, isNullableColumn(c) ? 0 : 1, c + ' 的可空性不对');
    }
    assert.equal(byName.uid.pk, 1, 'uid 是主键');

    // 元表：单行、版本 = 目标、updated_at 是我们注入的时钟（可复现）
    assert.equal(count(r.db, SCHEMA_VERSION_TABLE), 1);
    assert.equal(readSchemaVersion(r.db), TARGET_SCHEMA_VERSION);
    assert.equal(
      r.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at,
      FIXED_NOW,
      'updated_at 必须来自注入的时钟（否则测试不可复现）',
    );

    // journal_mode：要么真的是 wal，要么必须给出原因（不静默降级）
    assert.ok(
      ['wal', 'delete', 'truncate', 'persist', 'memory'].includes(r.journalMode),
      'journal_mode 读成了 ' + r.journalMode,
    );
    if (r.journalMode !== 'wal') assert.notEqual(r.walNote, '', '没拿到 WAL 就必须留下原因');
    assert.equal(r.db.isOpen, true);

    // 外键真的开着（items 的 lib_id 指向 library）—— 否则孤儿行会静默产生
    assert.equal(r.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    r.db.close();
  }
});

test('B1b：缺包的条目（archive* 全 null + 无向量行）能原样存进去', () => {
  const dbPath = path.join(freshDir('B1b'), DB);
  const r = openGsDb({ dbPath, now });
  try {
    insertLibrary(r.db, 'L1');
    insertItem(r.db, ITEM);
    insertItem(r.db, ITEM_MISSING_ARCHIVE);
    assert.equal(count(r.db, 'items'), 2);
    const row = r.db.prepare('SELECT * FROM items WHERE uid = ?').get(ITEM_MISSING_ARCHIVE.uid);
    assert.equal(row.archive_name, null, '缺包时 archive_name 必须是 NULL，不是空串');
    assert.equal(row.vector_row, null);
    // 外键：孤儿条目必须被拒（不是靠调用方自觉）
    assert.throws(
      () => insertItem(r.db, Object.assign({}, ITEM, { uid: 'aaaaaaaaaaaa', libId: 'NO_SUCH_LIB' })),
      /FOREIGN KEY/i,
    );
  } finally {
    r.db.close();
  }
});

// ============================================================ B2 幂等

test('B2 ⭐ 幂等重跑：不执行 DDL、不清数据、不报错', () => {
  const dbPath = path.join(freshDir('B2'), DB);
  const first = openGsDb({ dbPath, now });
  insertLibrary(first.db, 'L1');
  insertItem(first.db, ITEM);
  const snapshot = schemaSnapshot(first.db);
  const updatedAt = first.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at;
  first.db.close();

  const second = openGsDb({ dbPath, now });
  try {
    assert.equal(second.created, false, '第二次打开不可能是新建');
    assert.equal(second.migration.fromVersion, TARGET_SCHEMA_VERSION);
    assert.equal(second.migration.toVersion, TARGET_SCHEMA_VERSION);
    assert.deepEqual(second.migration.applied, [], '幂等重跑不得执行任何迁移');
    assert.equal(second.migration.upToDate, true);
    assert.equal(count(second.db, 'items'), 1, '幂等重跑不得清表');
    assert.deepEqual(schemaSnapshot(second.db), snapshot, 'schema 必须一字不动（表没被 DROP/CREATE）');
    assert.equal(
      second.db.prepare('SELECT updated_at FROM schema_version WHERE id = 1').get().updated_at,
      updatedAt,
      '幂等重跑不得写 updated_at',
    );

    // 同一条连接上再跑一次 migrate 也要幂等
    const third = migrate(second.db, { now });
    assert.deepEqual(third.applied, []);
    assert.equal(third.upToDate, true);
    assert.equal(count(second.db, 'items'), 1);
  } finally {
    second.db.close();
  }
});

// ============================================================ B3 版本推进

test('B3 ⭐ 版本按序推进：先 v1 再 v2，核心表与数据都不动', () => {
  const dbPath = path.join(freshDir('B3'), DB);
  const v1Only = MIGRATIONS.slice(0, 1);

  const a = openGsDb({ dbPath, migrations: v1Only, now });
  assert.equal(a.migration.fromVersion, 0);
  assert.equal(a.migration.toVersion, 1);
  assert.deepEqual(a.migration.applied, [{ version: 1, name: MIGRATIONS[0].name }]);
  assert.equal(tableNames(a.db).includes('doc_chunks'), false, '只跑 v1 时不该有文档表');
  insertLibrary(a.db, 'L1');
  insertItem(a.db, ITEM);
  a.db.close();

  const b = openGsDb({ dbPath, now }); // 全量清单
  try {
    assert.equal(b.migration.fromVersion, 1, '必须从库里真实的 v1 接着走');
    assert.equal(b.migration.toVersion, 2);
    assert.deepEqual(b.migration.applied, [{ version: 2, name: MIGRATIONS[1].name }]);
    assert.equal(b.migration.upToDate, false);
    assert.deepEqual(tableNames(b.db), EXPECTED_TABLES);
    assert.equal(count(b.db, 'items'), 1, 'v2 升级不得动 items（它是纯建表迁移）');
  } finally {
    b.db.close();
  }
});

// ============================================================ B4 删除后重建

test('B4 ⭐ 删除 .gs.db 后重建：表结构与版本与首次完全一致', () => {
  const dbPath = path.join(freshDir('B4'), DB);
  const a = openGsDb({ dbPath, now });
  insertLibrary(a.db, 'L1');
  insertItem(a.db, ITEM);
  const tables = tableNames(a.db);
  const itemColumns = columnsOf(a.db, 'items');
  const indexes = indexNames(a.db);
  a.db.close();

  const removed = removeGsDbFiles(dbPath);
  assert.ok(removed.includes(dbPath), '主库文件必须被删掉；实际删了 ' + JSON.stringify(removed));
  for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', dbPath + '-journal']) {
    assert.equal(fs.existsSync(f), false, f + ' 必须不存在（边车文件留一个就是"删了但没真删"）');
  }

  const b = openGsDb({ dbPath, now });
  try {
    assert.equal(b.created, true);
    assert.equal(b.migration.fromVersion, 0, '重建 = 从 v0 重新走一遍');
    assert.equal(b.migration.toVersion, TARGET_SCHEMA_VERSION);
    assert.deepEqual(tableNames(b.db), tables, '重建后的表清单必须与首次一致');
    assert.deepEqual(columnsOf(b.db, 'items'), itemColumns, '重建后的列结构必须与首次一致');
    assert.deepEqual(indexNames(b.db), indexes);
    assert.equal(count(b.db, 'items'), 0, '重建后条目为空（要重新导入）');
  } finally {
    b.db.close();
  }
});

// ============================================================ B5 元表不变式 / 未来版本

test('B5 ⭐ schema_version 只允许一行；未来版本 ⇒ SCHEMA_TOO_NEW（不降级瞎改）', () => {
  const dbPath = path.join(freshDir('B5'), DB);
  const r = openGsDb({ dbPath, now });
  try {
    assert.throws(
      () => r.db.prepare('INSERT INTO schema_version (id, version, updated_at) VALUES (?, ?, ?)').run(2, 99, FIXED_NOW),
      /CHECK|constraint/i,
      '元表第二行必须被库级约束拒掉',
    );
    assert.throws(
      () => r.db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(-1),
      /CHECK|constraint/i,
      '版本号不许是负数',
    );

    r.db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(999);
    let err = null;
    try {
      migrate(r.db, { now });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GsDbError, '必须是类型化错误，不是裸 Error');
    assert.equal(err.code, 'SCHEMA_TOO_NEW');
    assert.match(err.message, /删掉/);
    assert.equal(readSchemaVersion(r.db), 999, '拒绝后不许偷偷改回版本号');
  } finally {
    r.db.close();
  }
});

// ============================================================ B6 迁移失败 ⇒ 回滚

test('B6 ⭐ 迁移中途失败 ⇒ 整条回滚，版本停在上一条，不留半张表', () => {
  const dbPath = path.join(freshDir('B6'), DB);
  const r = openGsDb({ dbPath, now });
  try {
    const broken = MIGRATIONS.concat([
      {
        version: TARGET_SCHEMA_VERSION + 1,
        name: 'broken-on-purpose',
        statements: ['CREATE TABLE probe_partial (a INTEGER);', 'CREATE TABLE broken ('],
      },
    ]);
    let err = null;
    try {
      migrate(r.db, { migrations: broken, now });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GsDbError);
    assert.equal(err.code, 'MIGRATION_FAILED');
    assert.equal(readSchemaVersion(r.db), TARGET_SCHEMA_VERSION, '失败后版本必须停在上一条');
    assert.equal(
      tableNames(r.db).includes('probe_partial'),
      false,
      '同一事务里先建成功的表也必须被回滚（否则就是半张表）',
    );
  } finally {
    r.db.close();
  }
});

// ============================================================ B7 错误路径

test('B7：只读打开不迁移；坏输入按 code 报错（不是裸 SqliteError）', () => {
  const dir = freshDir('B7');
  const dbPath = path.join(dir, DB);
  const a = openGsDb({ dbPath, now });
  insertLibrary(a.db, 'L1');
  a.db.close();

  const ro = openGsDb({ dbPath, readOnly: true, now });
  try {
    assert.deepEqual(ro.migration.applied, [], '只读打开不得执行迁移');
    assert.equal(ro.migration.toVersion, TARGET_SCHEMA_VERSION);
    assert.equal(readSchemaVersion(ro.db), TARGET_SCHEMA_VERSION);
  } finally {
    ro.db.close();
  }

  const isCode = (code) => (e) => e instanceof GsDbError && e.code === code;

  const missing = path.join(dir, 'nope.db');
  assert.throws(() => openGsDb({ dbPath: missing, readOnly: true, now }), isCode('DB_OPEN_FAILED'));
  assert.equal(fs.existsSync(missing), false, '只读打开失败不得留下半个文件');

  assert.throws(() => openGsDb({ dbPath: '   ', now }), isCode('DB_PATH_REQUIRED'));

  const junk = path.join(dir, 'junk.db');
  fs.writeFileSync(junk, 'this is not a sqlite database', 'utf8');
  assert.throws(() => openGsDb({ dbPath: junk, now }), isCode('DB_OPEN_FAILED'));

  assert.throws(() => removeGsDbFiles(''), isCode('DB_PATH_REQUIRED'));
});

// ============================================================ B9 与真实 items.json 对齐

test('B9 ⭐ 与 data/libraries/L1/items.json 的 18 字段对齐，并把一条真记录存进去再读回来', (t) => {
  const itemsPath = path.join(ROOT, 'data', 'libraries', 'L1', 'items.json');
  if (!fs.existsSync(itemsPath)) {
    t.skip('本机没有 ' + itemsPath + '（真实库未就位）—— 这条对齐断言无法执行');
    return;
  }
  const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  assert.ok(Array.isArray(items) && items.length > 0, 'items.json 必须是非空数组');

  const expectedKeys = [...ITEM_FIELDS].sort();
  for (const raw of items) {
    assert.deepEqual(
      Object.keys(raw).sort(),
      expectedKeys,
      'uid=' + raw.uid + ' 的字段集与 ITEM_FIELDS 不一致（多了/少了字段）',
    );
    for (const f of ITEM_FIELDS) {
      const v = raw[f];
      const nullable = f.startsWith('archive') || f === 'vectorRow' || f === 'vectorSource';
      if (v === null) {
        assert.equal(nullable, true, f + ' 不该是 null（uid=' + raw.uid + '）');
        continue;
      }
      const isNumber = f === 'imageSize' || f === 'imageMtime' || f.endsWith('Size') || f.endsWith('Mtime') || f === 'vectorRow';
      assert.equal(typeof v, isNumber ? 'number' : 'string', f + ' 的类型不对（uid=' + raw.uid + '）');
    }
  }

  const dbPath = path.join(freshDir('B9'), DB);
  const r = openGsDb({ dbPath, now });
  try {
    const raw = items[0];
    insertLibrary(r.db, raw.libId);
    insertItem(r.db, raw);
    const back = r.db.prepare('SELECT * FROM items WHERE uid = ?').get(raw.uid);
    assert.ok(back, '真实记录必须能按 uid 读回来');
    for (const [field, column] of ITEM_FIELD_COLUMNS) {
      assert.deepEqual(back[column], raw[field], field + ' → ' + column + ' 往返必须一致');
    }
  } finally {
    r.db.close();
  }
});

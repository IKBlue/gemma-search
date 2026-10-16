// apps/desktop/tests/app-setting.test.mjs —— B2-6：`app_setting` 应用设置
//
// 要证的五件事：
//   ① **列集 = 设计基线**（从 `SPEC-COMPACT.md` 解析后与真 DDL 双向对照）；
//   ② **值统一存 JSON** ⇒ "加设置不需要迁移"（字符串/数字/布尔/数组/对象都能原样读回）；
//   ③ ⭐ **与 `config.json` 的关系只有一处实现**：库优先 + 旧文件**只读回退** + **不回写**
//      （回写会让"用户删掉的键被旧文件复活" = 两份真相的经典 bug）；
//   ④ 落点是**应用级 `app.db`**（不是库级）+ 迁移走**应用级自己的链**；
//   ⑤ 坏 JSON / 空键 / undefined 值都不静默。
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
  openNodeSqlite,
} from '../src/main/db/index.ts';
import { appLayerTables, libraryLayerTables } from '../src/main/db/schema-layers.ts';
import {
  appDbPath,
  getSetting,
  listSettings,
  openAppDb,
  readSettingValue,
  resolveSetting,
  writeSetting,
} from '../src/main/app-db.ts';
import { GsDbError } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b26', 'app-setting-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshUserData(label) {
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

/** 从设计基线解析 app_setting 那一节声明的字段（测试不另写一份清单） */
function baselineFields() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+app_setting\b/.test(l));
  assert.ok(start >= 0, '设计基线里找不到 app_setting 那一节');
  const names = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const row = line.match(/^\|\s*`?(.+?)`?\s*\|/);
    if (!row) continue;
    for (const part of row[1].split('/')) {
      const name = part.replace(/`/g, '').trim();
      if (/^[a-z_][a-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

// ============================================================ A1 列集 = 设计基线

test('A1 ⭐⭐ 列集 = 设计基线（key · value_json · updated_at_ms）', () => {
  const want = baselineFields();
  assert.equal(
    want.size,
    3,
    '设计基线 §38 说 app_setting 是 3 个字段行，实得 ' + String(want.size),
  );
  const { db } = openAppDb({ userDataDir: freshUserData('A1'), now: () => T0 });
  try {
    const cols = db
      .prepare("PRAGMA table_info('app_setting')")
      .all()
      .map((c) => c.name);
    assert.deepEqual([...cols].sort(), [...want].sort(), 'DDL 列与设计基线逐字对上（多/少都红）');
    assert.equal(
      cols.includes('key'),
      true,
      '键就叫 key（DDL 里加了引号只是因为它是关键字，列名不变）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ A2 ⭐ 值统一存 JSON

test('A2 ⭐ 值**统一存 JSON** ⇒ 加设置不需要迁移；value_json NOT NULL；undefined 不静默', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('A2'), now: () => T0 });
  try {
    const cases = [
      ['s', '深色'],
      ['n', 42],
      ['b', true],
      ['arr', [1, 'x', null]],
      ['obj', { a: 1, b: { c: [2, 3] } }],
      ['nul', null],
    ];
    for (const [k, v] of cases) writeSetting(db, k, v, () => T0);
    for (const [k, v] of cases) {
      assert.deepEqual(readSettingValue(getSetting(db, k)), v, 'JSON 往返必须原样：' + k);
    }
    // 原始文本就是 JSON（"字符串也是 JSON 字符串"——基线的原话）
    assert.equal(getSetting(db, 's').valueJson, '"深色"');
    assert.equal(getSetting(db, 'n').valueJson, '42');
    // NOT NULL：直接塞 SQL NULL 被拒
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO app_setting ("key", value_json, updated_at_ms) VALUES (?,?,?)')
          .run('bad', null, T0),
      /NOT NULL/i,
    );
    // undefined 不是 JSON 能表达的值 ⇒ 明确拒绝（不静默写成 "null"）
    assert.throws(
      () => writeSetting(db, 'undef', undefined, () => T0),
      (e) => e instanceof GsDbError && e.code === 'SETTING_KEY_REQUIRED',
    );
  } finally {
    db.close();
  }
});

// ============================================================ A3 ⭐⭐ config.json 的关系（P1）

test('A3 ⭐⭐ 与 config.json 的关系：**库优先** · 旧文件只读回退 · **不回写**（唯一一处实现）', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('A3'), now: () => T0 });
  try {
    const legacy = { theme: 'legacy-dark', 'model.dir': 'D:/old-models', untouched: 1 };
    // ① 库里没有 ⇒ 回退到旧文件（只读）
    assert.deepEqual(resolveSetting(db, 'theme', legacy), {
      key: 'theme',
      value: 'legacy-dark',
      source: 'legacy',
    });
    // ② 库里**有** ⇒ 库赢（**即使旧文件也有同键** —— 这就是"库优先"）
    writeSetting(db, 'theme', 'db-light', () => T0 + 1);
    assert.deepEqual(resolveSetting(db, 'theme', legacy), {
      key: 'theme',
      value: 'db-light',
      source: 'db',
    });
    // ③ 都没有 ⇒ missing（不编默认值）
    assert.deepEqual(resolveSetting(db, 'nope', legacy), {
      key: 'nope',
      value: undefined,
      source: 'missing',
    });
    // ④ **不回写**：解析过旧键之后，库里**仍然没有**那个键 ⇒ 用户删掉的键不会被旧文件"复活"
    assert.equal(
      getSetting(db, 'model.dir'),
      null,
      '读回退值不许顺手写进库（否则删除会被旧文件复活）',
    );
    assert.equal(listSettings(db).length, 1, '库里只有我们显式写过的那一条');
    // ⑤ legacy 允许多种形态：null（没有旧文件）/ 没有该键
    assert.equal(resolveSetting(db, 'theme', null).source, 'db');
    assert.equal(resolveSetting(db, 'other', {}).source, 'missing');
  } finally {
    db.close();
  }
  // ⑥ 源码扫描（防 P2/P8）：**决定优先级的实现只有一处** —— "回退"这件事在 main/ 里只许出现在 app-db.ts
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(MAIN);
  const precedent = files
    .filter((f) => /source:\s*'legacy'/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  assert.deepEqual(
    precedent,
    ['apps/desktop/src/main/app-db.ts'],
    '「库优先 + 旧文件回退」只许有一处实现',
  );
});

// ============================================================ A4/A5 upsert 与约束

test('A4 upsert：同一键写两次只有一行、值更新、时刻推进；key 是主键', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('A4'), now: () => T0 });
  try {
    writeSetting(db, 'theme', 'a', () => T0);
    writeSetting(db, 'theme', 'b', () => T0 + 500);
    const rows = listSettings(db);
    assert.equal(rows.length, 1, '同一键必须只有一行（upsert）');
    assert.equal(readSettingValue(rows[0]), 'b');
    assert.equal(rows[0].updatedAtMs, T0 + 500, 'updated_at_ms 必须推进');
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO app_setting ("key", value_json, updated_at_ms) VALUES (?,?,?)')
          .run('theme', '"c"', T0),
      /UNIQUE|PRIMARY KEY/i,
      'key 是主键 ⇒ 重复插入被拒（所以只能走 upsert）',
    );
  } finally {
    db.close();
  }
});

test('A5 updated_at_ms NOT NULL；空键被拒（SETTING_KEY_REQUIRED）', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('A5'), now: () => T0 });
  try {
    assert.throws(
      () => db.prepare('INSERT INTO app_setting ("key", value_json) VALUES (?,?)').run('x', '1'),
      /NOT NULL/i,
    );
    assert.throws(
      () => writeSetting(db, '   ', 1),
      (e) => e instanceof GsDbError && e.code === 'SETTING_KEY_REQUIRED',
    );
  } finally {
    db.close();
  }
});

test('A6 坏 JSON **抛错**（不静默当"没有设置"）', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('A6'), now: () => T0 });
  try {
    writeSetting(db, 'theme', 'ok', () => T0);
    db.prepare('UPDATE app_setting SET value_json = ? WHERE "key" = ?').run('{ 半截', 'theme');
    assert.throws(
      () => resolveSetting(db, 'theme', null),
      (e) => e instanceof GsDbError && e.code === 'SETTING_VALUE_UNREADABLE',
      '坏值要报出来（用户以为"设置丢了"，真相是那条记录坏了）',
    );
  } finally {
    db.close();
  }
});

// ============================================================ A7 迁移链 / 落点 / 幂等

test('A7 ⭐⭐ 走**应用级自己的链**（v2）· 落在 app.db · 旧 app 库升级不回归 · 两套账本互不影响', () => {
  // ① 应用级链的关系（派生，不写死条数/版本号）
  const versions = APP_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '应用级版本从 1 起连续',
  );
  assert.equal(
    APP_TARGET_SCHEMA_VERSION,
    versions[versions.length - 1],
    '应用级目标 = 它自己那条链的上限',
  );
  assert.equal(
    APP_MIGRATIONS[1].name,
    'batch2-app-setting',
    'app_setting 是应用级 v2（钉自己那一格）',
  );
  assert.ok(APP_TABLES.includes('app_setting'));
  // ② 落点：应用层（**不是**库级）
  assert.ok(appLayerTables().includes('app_setting'), 'app_setting 属应用层');
  assert.equal(libraryLayerTables().includes('app_setting'), false, '绝不在库级 .gs.db 里');
  const libDir = freshUserData('A7-lib');
  const libDb = openNodeSqlite(path.join(libDir, '.gs.db'));
  try {
    // 库级库里不该有 app_setting（两库互不串味）
    const libTables = libDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(libTables.includes('app_setting'), false, '库级库不该有应用级表');
    libDb.exec('CREATE TABLE IF NOT EXISTS app_setting (x INTEGER)');
  } finally {
    libDb.close();
  }
  // ③ 旧 app 库（只有 v1）⇒ 升级只跑缺的那些；老数据还在；幂等
  const ud = freshUserData('A7-up');
  const dbPath = appDbPath(ud);
  const v1Only = openNodeSqlite(dbPath);
  try {
    migrateApp(v1Only, { migrations: [APP_MIGRATIONS[0]], now: () => T0 });
    assert.equal(APP_META_LEDGER.readVersion(v1Only), 1, '只跑到 v1');
    const names = v1Only
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('app_setting'), false, '没升级就没有 app_setting（不静默提前建）');
    v1Only
      .prepare(
        'INSERT INTO library_registry (lib_id, root, display_name, enabled, sort_order, registered_at_ms, updated_at_ms) VALUES (?,?,?,?,?,?,?)',
      )
      .run('L1', 'D:/lib', '库一', 1, 0, T0, T0);
  } finally {
    v1Only.close();
  }
  const opened = openAppDb({ userDataDir: ud, now: () => T0 });
  try {
    assert.equal(APP_META_LEDGER.readVersion(opened.db), APP_TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      opened.db
        .prepare('SELECT lib_id FROM library_registry')
        .all()
        .map((r) => r.lib_id),
      ['L1'],
      '升级不动老数据',
    );
    assert.equal(listSettings(opened.db).length, 0, '新表是空的');
    opened.db.close();
    // 幂等：再开一次不再跑迁移
    const again = openAppDb({ userDataDir: ud, now: () => T0 });
    assert.equal(again.db.prepare('SELECT COUNT(*) n FROM app_setting').get().n, 0);
    again.db.close();
  } finally {
    /* 已在上面关过 */
  }
});

// apps/desktop/tests/search-history.test.mjs —— B2-5：`asset_name_fts`（FTS5）· `recent_query` · `recent_view`
//
// 要证的六件事：
//   ① 两张实体表的**列集 = 设计基线**（从 `SPEC-COMPACT.md` 解析后与真 DDL 双向对照）；
//   ② FTS5 **真的建出来了、真的能搜**，而且用的是 **trigram**（**真子串** —— 基线写的就是"子串搜"）；
//   ③ **同步只有一处**（P1）：同步逻辑是**三条触发器**，业务代码里没有第二处（源码扫描 + 行为三条路径都要到）;
//   ④ `recent_view` 1:1（uid 就是主键）· `recent_query` 的 kind 枚举与可空语义；
//   ⑤ 层级：`asset_name_fts` 属**事实层**、`recent_view` 属**过程层**、**`recent_query` 属应用层**
//      ⚠️ B2-5FIX：`recent_query` 原来被放进库级/过程层（依据 README.md:32 的四层表），
//      但 `SPEC.md:173` 把它列在**应用级**（它记的是跨库检索历史）⇒ 已修正（库级链 v7 删旧表 + 应用级 v4 重建）。
//   ⑥ v6 迁移 · 幂等（虚表 + 触发器都能重复建）· 旧库升级不回归。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APP_TABLES,
  EXPECTED_TABLES,
  LIBRARY_MIGRATIONS,
  LIBRARY_TABLES,
  LIBRARY_VIRTUAL_TABLES,
  TARGET_SCHEMA_VERSION,
  openGsDb,
  readSchemaVersion,
} from '../src/main/db/index.ts';
import { appDbPath, openAppDb } from '../src/main/app-db.ts';
import { createJob } from '../src/main/db/jobs.ts';
import {
  appLayerTables,
  libraryLayerTables,
  schemaTables,
  tablesInLayer,
} from '../src/main/db/schema-layers.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'SPEC-COMPACT.md');
const TMP = path.join(ROOT, 'data', '_b25', 'search-history-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDb(label, migrations) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, '.gs.db');
  const opened = migrations
    ? openGsDb({ dbPath, migrations, now: () => T0 })
    : openGsDb({ dbPath, now: () => T0 });
  return { dbPath, db: opened.db, opened };
}
/** 应用级 app.db（B2-5FIX：`recent_query` 落在这里） */
function freshApp(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const opened = openAppDb({ userDataDir: dir, now: () => T0 });
  return { dir, dbPath: appDbPath(dir), db: opened.db };
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

const columnsOf = (db, table) =>
  db
    .prepare("PRAGMA table_info('" + table + "')")
    .all()
    .map((c) => c.name);

/** 解析设计基线某一节声明的字段（测试不另写一份清单） */
function baselineFields(sectionRe) {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => sectionRe.test(l));
  assert.ok(start >= 0, '设计基线里找不到该节：' + String(sectionRe));
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

function seedAsset(db, uid, displayName) {
  db.prepare(
    'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    uid,
    'L1',
    'CR',
    displayName.replace(/\.[a-z]+$/i, ''),
    displayName,
    'CR',
    'CR/' + displayName,
    T0,
  );
}
/** 按名搜（外部内容 ⇒ 必须 JOIN 内容表按 rowid 回查；MATCH 左边必须是**表名**） */
const search = (db, q) =>
  db
    .prepare(
      'SELECT a.uid FROM asset_name_fts JOIN asset a ON a.rowid = asset_name_fts.rowid WHERE asset_name_fts MATCH ? ORDER BY a.uid',
    )
    .all(q)
    .map((r) => r.uid);
/** FTS5 的 MATCH 右边是**表达式** ⇒ 用户输入必须加引号（见 migrations.ts 的 T_SEARCH 注释） */
const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// ============================================================ S1 列集 = 设计基线

test('S1 ⭐⭐ recent_query（7 字段）/ recent_view（3 字段）的列集 = 设计基线', () => {
  const rq = baselineFields(/^##\s+recent_query\b/);
  const rv = baselineFields(/^##\s+recent_view\b/);
  assert.equal(rq.size, 7, '设计基线 §59 说 recent_query 是 7 个字段行，实得 ' + String(rq.size));
  assert.equal(rv.size, 3, '设计基线 §171 说 recent_view 是 3 个字段行，实得 ' + String(rv.size));
  // ⚠️ B2-5FIX：这两张表**不在同一个数据库里** —— `recent_query` 属**应用级**（`app.db`），
  //    `recent_view` 属**库级**（`.gs.db`）⇒ 列集要各自从**正确的那个库**里读，否则这条断言会"绿得没意义"。
  const check = (db, table, want) => {
    const cols = columnsOf(db, table);
    assert.deepEqual(
      [...cols].sort(),
      [...want].sort(),
      table + ' 的列与设计基线逐字对上（多/少都红）',
    );
    assert.deepEqual(
      cols.filter((c) => !want.has(c)),
      [],
      table + ' 里出现设计基线没写的列（自造字段？）',
    );
  };
  const lib = freshDb('S1-lib');
  const app = freshApp('S1-app');
  try {
    check(lib.db, 'recent_view', rv);
    check(app.db, 'recent_query', rq);
    // 反向：库级库里**不该**有 recent_query（修正前它在库级）、应用级库里不该有 recent_view
    const libNames = lib.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(
      libNames.includes('recent_query'),
      false,
      'B2-5FIX：recent_query 不该再出现在库级',
    );
    const appNames = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(appNames.includes('recent_view'), false, 'recent_view 是库级的，不该在应用级');
  } finally {
    lib.db.close();
    app.db.close();
  }
});

// ============================================================ S2 FTS5 真能搜（真子串）

test('S2 ⭐⭐ FTS5 真的建出来了、真的能搜；而且是 **trigram（真子串）** 而不是词元匹配', () => {
  const { db, dbPath } = freshDb('S2');
  try {
    seedAsset(db, 'aa0000000001', 'VR-101.jpg');
    seedAsset(db, 'aa0000000002', 'CR-9.png');
    // 真子串：`101` 与跨词元的 `R-101` 都要命中（trigram 才有这个能力）
    assert.deepEqual(search(db, quote('101')), ['aa0000000001']);
    assert.deepEqual(
      search(db, quote('R-101')),
      ['aa0000000001'],
      '跨词元的子串也必须命中（这就是用 trigram 的理由）',
    );
    assert.deepEqual(search(db, quote('CR-9')), ['aa0000000002']);
    assert.deepEqual(search(db, quote('不存在的名字')), []);
    // ⚠️ 对照组：**默认分词器**（unicode61）做不到「跨词元子串」——这就是为什么基线写"子串"就得用 trigram。
    //    （在**另一个**临时库里做对照，不污染产品 schema）
    const alt = freshDb('S2-alt');
    try {
      alt.db.exec("CREATE VIRTUAL TABLE probe_default USING fts5(name, tokenize='unicode61')");
      alt.db.prepare('INSERT INTO probe_default (name) VALUES (?)').run('VR-101.jpg');
      const hit = alt.db
        .prepare('SELECT COUNT(*) n FROM probe_default WHERE probe_default MATCH ?')
        .get(quote('R-101')).n;
      assert.equal(
        hit,
        0,
        '默认 unicode61 是**按词元**的 ⇒ 跨词元子串中不了（所以本卡用 trigram）',
      );
    } finally {
      alt.db.close();
    }
    // 外部内容：FTS 只暴露自己声明的列 ⇒ 必须 JOIN 回内容表（把这条写成断言，免得下一张卡写错）
    assert.throws(
      () => db.prepare('SELECT uid FROM asset_name_fts').all(),
      /no such column/i,
      '外部内容表只暴露自己声明的列 ⇒ 必须 JOIN asset 按 rowid 回查',
    );
    // 影子表在（虚表确实建出来了）
    const shadows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'asset_name_fts_%'",
      )
      .all()
      .map((r) => r.name);
    assert.ok(shadows.length > 0, 'FTS5 应有影子表（_data/_idx/_docsize/_config）');
    assert.ok(dbPath.length > 0);
  } finally {
    db.close();
  }
});

// ============================================================ S3 ⭐⭐ 同步只有一处

test('S3 ⭐⭐ 同步只有一处：三条触发器 + 业务代码里**没有**第二处同步（源码扫描 + 三条路径行为）', () => {
  // ① 触发器就是那三条（名字固定）
  const { db } = freshDb('S3');
  try {
    // ⚠️ 库里还有别的触发器（B2-1 的 job_* 两条）⇒ 只看**本卡这三条**（按前缀过滤，别把别人的算进来）
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => r.name)
      .filter((n) => n.startsWith('asset_name_fts_'));
    assert.deepEqual(triggers, ['asset_name_fts_ad', 'asset_name_fts_ai', 'asset_name_fts_au']);
    // ② 三条写入路径都要到（这就是"同步放在触发器里"的全部意义）
    seedAsset(db, 'aa0000000001', 'VR-101.jpg');
    assert.deepEqual(search(db, quote('101')), ['aa0000000001'], 'INSERT 后能搜到');
    db.prepare('UPDATE asset SET display_name = ? WHERE uid = ?').run('VR-999.jpg', 'aa0000000001');
    assert.deepEqual(search(db, quote('101')), [], '改名后**旧名字**不该还能搜到');
    assert.deepEqual(search(db, quote('999')), ['aa0000000001'], '改名后新名字能搜到');
    db.prepare('DELETE FROM asset WHERE uid = ?').run('aa0000000001');
    assert.deepEqual(search(db, quote('999')), [], '删除后搜不到（没有孤儿索引行）');
  } finally {
    db.close();
  }
  // ③ 源码扫描（防 P8：注释/口头不算）：main/** 里对 asset_name_fts 的**写入**只许出现在 migrations.ts 的触发器体里
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(MAIN);
  assert.ok(files.length >= 20, '扫描面太小（路径写错了？）：' + String(files.length));
  const writers = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (
        /INSERT\s+INTO\s+asset_name_fts|DELETE\s+FROM\s+asset_name_fts|UPDATE\s+asset_name_fts/i.test(
          line,
        )
      ) {
        writers.push(rel);
      }
    }
  }
  assert.deepEqual(
    [...new Set(writers)],
    ['apps/desktop/src/main/db/migrations.ts'],
    '索引的写入只许有**一处**（迁移里的触发器体）；业务代码里出现第二处 = 同步逻辑被散开（P1）',
  );
});

// ============================================================ S4/S5 两张实体表

test('S4 recent_view：1:1（uid 是主键）· CASCADE · view_count 默认 1 · 时刻 DESC 索引', () => {
  const { db } = freshDb('S4');
  try {
    assert.deepEqual(
      db
        .prepare('PRAGMA foreign_key_list(recent_view)')
        .all()
        .map((f) => [f.table, f.from, f.on_delete]),
      [['asset', 'uid', 'CASCADE']],
    );
    seedAsset(db, 'aa0000000001', 'A.jpg');
    db.prepare('INSERT INTO recent_view (uid, viewed_at_ms) VALUES (?, ?)').run('aa0000000001', T0);
    assert.equal(
      db.prepare('SELECT view_count FROM recent_view').get().view_count,
      1,
      'view_count 默认 1',
    );
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO recent_view (uid, viewed_at_ms) VALUES (?, ?)')
          .run('aa0000000001', T0 + 1),
      /UNIQUE|PRIMARY KEY/i,
      'uid 就是主键 ⇒ 1:1（"同一条看多次只保留最后一次"由调用方 UPSERT 实现，表这一层保证不会有两行）',
    );
    assert.throws(
      () => db.prepare('INSERT INTO recent_view (uid) VALUES (?)').run('aa0000000002'),
      /NOT NULL/i,
      'viewed_at_ms NOT NULL',
    );
    // 基线的 "INDEX DESC"：断言索引列序与方向
    const cols = db
      .prepare("PRAGMA index_xinfo('idx_recent_view_at')")
      .all()
      .filter((r) => r.key === 1);
    assert.deepEqual(
      cols.map((r) => [r.name, r.desc]),
      [['viewed_at_ms', 1]],
      '按查看时刻**降序**索引',
    );
  } finally {
    db.close();
  }
});

test('S5 recent_query（**应用级**）：kind 只认 text/image；text/image_ref/scope/result_count 可空；at_ms 必填 + DESC 索引', () => {
  // ⚠️ B2-5FIX：从**应用级**库里查它（它记的是跨库检索历史）
  const { db } = freshApp('S5');
  try {
    const ins = db.prepare(
      'INSERT INTO recent_query (query_id, kind, text, image_ref, scope_lib_id, result_count, at_ms) VALUES (?,?,?,?,?,?,?)',
    );
    ins.run('q1', 'text', '蓝天', null, null, 12, T0); // scope NULL = 全部库
    ins.run('q2', 'image', null, 'aa0000000001', 'L1', 3, T0 + 1);
    assert.throws(
      () => ins.run('q3', '视频', 'x', null, null, 0, T0),
      /CHECK/i,
      'kind 只认 text/image',
    );
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO recent_query (query_id, kind, at_ms) VALUES (?,?,?)')
          .run('q4', 'text', null),
      /NOT NULL/i,
      'at_ms NOT NULL',
    );
    const row = db
      .prepare(
        'SELECT text, image_ref, scope_lib_id, result_count FROM recent_query WHERE query_id = ?',
      )
      .get('q1');
    assert.deepEqual(
      [row.image_ref, row.scope_lib_id],
      [null, null],
      'scope 为 NULL 就是"全部库"；以图搜图的字段可缺',
    );
    const cols = db
      .prepare("PRAGMA index_xinfo('idx_recent_query_at')")
      .all()
      .filter((r) => r.key === 1);
    assert.deepEqual(
      cols.map((r) => [r.name, r.desc]),
      [['at_ms', 1]],
      '按查询时刻**降序**索引',
    );
  } finally {
    db.close();
  }
});

// ============================================================ S6 迁移 / 分层 / 幂等

test('S6 ⭐⭐ 迁移与分层：v6 · 版本派生 · 事实层/过程层归属 · 幂等 · 旧库升级不回归', () => {
  const versions = LIBRARY_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    versions.map((_, i) => i + 1),
    '版本从 1 起连续',
  );
  assert.equal(TARGET_SCHEMA_VERSION, versions[versions.length - 1], '目标版本 = 清单上限（派生）');
  assert.equal(
    LIBRARY_MIGRATIONS[5].name,
    'batch2-search-history',
    '搜索与历史是 v6（钉自己那一格）',
  );
  // ⚠️ B2-5FIX：v7 是"把建错位置的 recent_query 从库级删掉"——也钉住它自己那一格
  assert.equal(
    LIBRARY_MIGRATIONS[6].name,
    'batch2-drop-recent-query-from-library',
    'v7 是 B2-5FIX 的删除迁移',
  );
  for (const t of ['asset_name_fts', 'recent_view']) {
    assert.ok(LIBRARY_TABLES.includes(t), 'LIBRARY_TABLES 必须含 ' + t);
    assert.ok(EXPECTED_TABLES.includes(t), '应有清单必须含 ' + t);
    assert.ok(schemaTables().includes(t), '四组点名必须含 ' + t);
    assert.ok(libraryLayerTables().includes(t), t + ' 落在库级 .gs.db');
    assert.equal(appLayerTables().includes(t), false, t + ' 不许落在 app.db');
  }
  // B2-5FIX：`recent_query` 反过来 —— 在**应用级**，且库级派生清单里**没有**它
  assert.ok(APP_TABLES.includes('recent_query'), 'APP_TABLES 必须含 recent_query');
  assert.ok(schemaTables().includes('recent_query'), '四组点名必须含 recent_query');
  assert.ok(appLayerTables().includes('recent_query'), 'recent_query 落 app.db');
  assert.equal(libraryLayerTables().includes('recent_query'), false, 'recent_query 不许再落库级');
  assert.equal(
    LIBRARY_TABLES.includes('recent_query'),
    false,
    '库级派生清单里不该有它（派生已扣掉 v7 的 DROP —— 这正是那条 DROP 的作用）',
  );
  // 层归属（基线四层分类表 README.md:31-32）
  assert.ok(LIBRARY_VIRTUAL_TABLES.includes('asset_name_fts'), 'asset_name_fts 是虚拟表');
  assert.ok(
    tablesInLayer('fact').includes('asset_name_fts'),
    'asset_name_fts 属**事实层**（可重建）',
  );
  // 过程层只剩 recent_view（recent_query 已挪去应用层）
  assert.ok(
    tablesInLayer('process').includes('recent_view'),
    'recent_view 属过程层（"某个库里看过什么"）',
  );
  assert.equal(
    tablesInLayer('process').includes('recent_query'),
    false,
    'recent_query 已不在过程层',
  );
  // 旧库升级：只跑到 v5 的库 ⇒ 没有这三张表；再打开 ⇒ 只跑缺的那些；老数据还在
  const old = freshDb('S6-v5', LIBRARY_MIGRATIONS.slice(0, 5));
  try {
    assert.equal(readSchemaVersion(old.db), 5);
    const names = old.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(names.includes('recent_view'), false);
    createJob(old.db, { kind: 'ingest', now: () => T0, jobId: 'j-old' });
  } finally {
    old.db.close();
  }
  const up = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(up.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      up.migration.applied.map((m) => m.version),
      versions.filter((v) => v > 5),
    );
    assert.equal(up.db.prepare('SELECT COUNT(*) n FROM job').get().n, 1, '升级不动老数据');
    // **幂等**：再开一次 ⇒ 不跑迁移、虚表与触发器都不重复（`IF NOT EXISTS` 的作用）
    up.db.close();
    const again = openGsDb({ dbPath: old.dbPath, now: () => T0 });
    try {
      assert.equal(again.migration.applied.length, 0, '再开不再跑迁移');
      const triggers = again.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all()
        .map((r) => r.name)
        .filter((n) => n.startsWith('asset_name_fts_'))
        .sort();
      assert.deepEqual(
        triggers,
        ['asset_name_fts_ad', 'asset_name_fts_ai', 'asset_name_fts_au'],
        '触发器没有重复',
      );
      seedAsset(again.db, 'aa0000000001', 'VR-101.jpg');
      assert.deepEqual(
        search(again.db, quote('101')),
        ['aa0000000001'],
        '幂等重开之后 FTS 仍然工作',
      );
    } finally {
      again.db.close();
    }
  } finally {
    /* 已在上面关过 */
  }
});

// ============================================================ F 系列：B2-5FIX（`recent_query` 挪到应用级）

test('F1 ⭐⭐ 落点修正的机械证明：库级库里**没有** recent_query / 应用级库里有；recent_view 不受影响', () => {
  const lib = freshDb('F1-lib');
  const app = freshApp('F1-app');
  try {
    const libTables = lib.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    const appTables = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(
      libTables.includes('recent_query'),
      false,
      '库级库里不许有 recent_query（它记的是跨库历史）',
    );
    assert.equal(appTables.includes('recent_query'), true, '应用级库里必须有 recent_query');
    // recent_view **没错**（SPEC.md:171 明确「库级·过程」）⇒ 别把对的也改坏
    assert.equal(libTables.includes('recent_view'), true, 'recent_view 仍在库级');
    assert.equal(appTables.includes('recent_view'), false, 'recent_view 不该跑到应用级');
  } finally {
    lib.db.close();
    app.db.close();
  }
});

test('F2 ⭐⭐ 升级路径：v6-only 的库（旧搜索历史在库级）升到 v7 ⇒ 库级不再有该表；应用级新表**是空的**（不搬运）', () => {
  // ① 造一个"修正前"的库（只跑到 v6）并塞一行旧历史
  const old = freshDb('F2-v6', LIBRARY_MIGRATIONS.slice(0, 6));
  try {
    assert.equal(readSchemaVersion(old.db), 6);
    old.db
      .prepare('INSERT INTO recent_query (query_id, kind, text, at_ms) VALUES (?,?,?,?)')
      .run('old-1', 'text', '蓝天', T0);
    assert.equal(
      old.db.prepare('SELECT COUNT(*) n FROM recent_query').get().n,
      1,
      '修正前的库里确实有那张表、那行历史',
    );
  } finally {
    old.db.close();
  }
  // ② 用完整链（含 v7）再打开 ⇒ v7 把它删掉
  const up = openGsDb({ dbPath: old.dbPath, now: () => T0 });
  try {
    assert.equal(readSchemaVersion(up.db), TARGET_SCHEMA_VERSION);
    assert.deepEqual(
      up.migration.applied.map((m) => m.version),
      LIBRARY_MIGRATIONS.map((m) => m.version).filter((v) => v > 6),
      '只跑缺的那条 v7',
    );
    const names = up.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    assert.equal(
      names.includes('recent_query'),
      false,
      'v7 之后库级不再有 recent_query（旧历史随之删除）',
    );
    assert.equal(names.includes('recent_view'), true, 'recent_view 不受 v7 影响');
  } finally {
    up.db.close();
  }
  // ③ 应用级那边：表在、但**从空开始** —— 这就是"不搬运"的口径（写在 migrations.ts 的 v7 注释里）
  const app = freshApp('F2-app');
  try {
    assert.equal(
      app.db.prepare('SELECT COUNT(*) n FROM recent_query').get().n,
      0,
      '不搬运：旧搜索历史不跟过来（一次**明确且有界**的丢弃，不是静默的）',
    );
  } finally {
    app.db.close();
  }
});

test('F3 ⭐ 一份真相（机械）：库级链只有 v6 建 + v7 删（历史语句不许改），净表集不含它；应用级链恰好建一次', () => {
  const libSrc = fs.readFileSync(path.join(MAIN, 'db', 'migrations.ts'), 'utf8');
  const appSrc = fs.readFileSync(path.join(MAIN, 'db', 'app-migrations.ts'), 'utf8');
  // v6 的历史语句**不许改**：改了它对已升级的库静默不生效（这正是"为什么用 v7 删"的理由）
  assert.ok(
    /CREATE TABLE IF NOT EXISTS recent_query/.test(libSrc),
    'v6 里那条历史 CREATE 必须原样保留（改已跑过的迁移对已升级的库无效）',
  );
  assert.equal(
    (libSrc.match(/DROP TABLE IF EXISTS recent_query/g) ?? []).length,
    1,
    '库级链恰好有一条 DROP（v7）',
  );
  assert.equal(
    (appSrc.match(/CREATE TABLE IF NOT EXISTS recent_query/g) ?? []).length,
    1,
    '应用级链恰好建一次',
  );
  // 净结果（派生）：库级没有、应用级有
  assert.equal(LIBRARY_TABLES.includes('recent_query'), false, '库级净表集不含它');
  assert.equal(EXPECTED_TABLES.includes('recent_query'), false, '库级"应有表清单"也不含它');
  assert.ok(APP_TABLES.includes('recent_query'), '应用级清单含它');
});

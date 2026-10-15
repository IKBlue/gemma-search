#!/usr/bin/env node
// reports/2026-10-15-wave3/s4-accept.mjs —— S4 验收（task-55）：6 张表 + 100 条端到端
//
// 一条命令跑完**就绪的**判据，原始输出落 reports/2026-10-15-wave3/s4.txt。
//   node reports/2026-10-15-wave3/s4-accept.mjs
//
// ── 为什么不把断言再抄一遍（P1/P2）────────────────────────────────────────────
//   表清单 / 外键 / UNIQUE / 列集 这些**已经有单测**（apps/desktop/tests/db-schema.test.mjs），
//   A17 有 items-ipc.test.mjs，A15 有 app-db.test.mjs。本脚本**不去写第二份实现**，
//   而是①**跑那些测试文件**并把结果与结论收进来（就绪判据的机械复核），
//   ②只**新增**单测层没有的验收级判据：
//        · 设计基线 field-map ↔ 真 DDL 的双向覆盖（两份不同来源，不是抄列集）
//        · 100 条夹具的索引 ↔ 条目**自反性**（vector_row 双射 + top-1 是自己 + NULL 不入索引）
//        · 100 条夹具上的 items 只读 / 越界 total / facets 不从当前页推导
//        · A18 错误码空间：引擎 ERR == SPEC §5.2 的 28（机械核）
//
// ── 口径与边界（**不假装**）──────────────────────────────────────────────────
//   · 「npm test 全绿」**不在本脚本结论里**：S2（task-59）还在关 24 条单测红，写成 DEFERRED，
//     等它收口后补跑（见文件末尾 DEFERRED 段）。
//   · 本脚本**只读**产品代码与夹具；临时库落 data/_s4/（AGENTS §3：data/_* 是本机临时物）。
//   · 判定：任一 FAIL ⇒ 退出码 1；只有 PASS/SKIP ⇒ 0。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  APP_TABLES,
  LIBRARY_MIGRATIONS,
  LIBRARY_TABLES,
  LIBRARY_VIRTUAL_TABLES,
  SCHEMA_LAYERS,
  SCHEMA_LAYER_ORDER,
  createdTableNames,
  migrateApp,
  openGsDb,
  openNodeSqlite,
  readSchemaVersion,
  schemaTables,
  tablesInLayer,
} from '../../apps/desktop/src/main/db/index.ts';
import { runItemsQuery } from '../../apps/desktop/src/main/items-ipc.ts';
import { normalizeRootPath, insertLibrary } from '../../apps/desktop/src/main/app-db.ts';
import { readIndexBin } from '../../packages/engine/src/index.ts';
import { checkLibraryHealth } from '../../apps/desktop/src/main/library-health.ts';
import { materialDigest, rebuildLibraryDb } from '../../apps/desktop/src/main/library-rebuild.ts';
import { ERR } from '../../packages/engine/src/errors.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_s4', 'accept-' + process.pid);
const FIXTURE_LIB = path.join(ROOT, 'data', '_schema100', 'lib');
const DESIGN_DOC = path.join(ROOT, 'reports', '2026-10-15-schema-diff', 'DESIGN-6tables-and-contract.md');
const SPEC = path.join(ROOT, 'SPEC.md');
const SQLITE_INTERNAL = ['sqlite_sequence'];
let seq = 0;

function tmpDir(label) {
  const d = path.join(TMP, label + '-' + (++seq));
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const openLibrary = (label) => openGsDb({ dbPath: path.join(tmpDir(label), '.gs.db'), now: () => 1700000000000 });
function openApp(label) {
  const dbPath = path.join(tmpDir(label), 'app.db');
  const db = openNodeSqlite(dbPath);
  return { db, dbPath, migration: migrateApp(db, { now: () => 1700000000000 }) };
}
function allTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
}
function ourTables(db, virtuals) {
  const prefixes = virtuals.map((v) => v + '_');
  return allTables(db).filter((n) => !SQLITE_INTERNAL.includes(n) && !prefixes.some((p) => n.startsWith(p)));
}
function columnsOf(db, table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((r) => r.name);
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ================================================================ 小 harness

const rows = [];
let failed = 0;
function check(id, title, fn) {
  try {
    const detail = fn();
    rows.push({ id, title, status: 'PASS' });
    console.log('PASS  ' + id + '  ' + title);
    if (detail) console.log('        ' + detail);
  } catch (e) {
    failed += 1;
    rows.push({ id, title, status: 'FAIL' });
    console.log('FAIL  ' + id + '  ' + title);
    console.log('        ' + (e && e.message ? e.message : String(e)));
  }
}
function skip(id, title, why) {
  rows.push({ id, title, status: 'SKIP' });
  console.log('SKIP  ' + id + '  ' + title);
  console.log('        原因：' + why);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(msg + '\n        实际 ' + a + '\n        期望 ' + b);
}
/** 跑一个已就绪的单测文件（**不重写它的断言**，只收结论） */
function runTestFile(file, label) {
  const r = spawnSync(process.execPath, ['--test', '--test-isolation=none', file], { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/^# (pass|fail) \d+/gm) || [];
  const tail = out.trim().split('\n').slice(-5).map((l) => '        | ' + l).join('\n');
  if (r.status !== 0) {
    failed += 1;
    rows.push({ id: label, title: '单测文件 ' + path.basename(file), status: 'FAIL' });
    console.log('FAIL  ' + label + '  ' + path.basename(file) + '（exit=' + String(r.status) + '）');
    console.log('        ' + m.join(' · '));
    console.log(tail);
  } else {
    rows.push({ id: label, title: '单测文件 ' + path.basename(file), status: 'PASS' });
    console.log('PASS  ' + label + '  ' + path.basename(file));
    console.log('        ' + m.join(' · '));
  }
}

console.log('S4 验收 · 6 张表 + 100 条端到端');
console.log('仓库根 = ' + ROOT);
console.log('夹具库 = ' + FIXTURE_LIB);
console.log('时间   = ' + new Date().toISOString());
console.log('');
fs.mkdirSync(TMP, { recursive: true });

// ================================================================ A. 就绪单测的机械复核

console.log('── A. 就绪判据：跑既有单测（本脚本不重写它们的断言）────────────────');
runTestFile(path.join(ROOT, 'apps/desktop/tests/db-schema.test.mjs'), 'S4-U1');
runTestFile(path.join(ROOT, 'apps/desktop/tests/app-db.test.mjs'), 'S4-U2');
runTestFile(path.join(ROOT, 'apps/desktop/tests/items-ipc.test.mjs'), 'S4-U3');
console.log('');

// ================================================================ B. 验收级判据

console.log('── B. 验收级判据（本脚本新增，来源各不相同）──────────────────────');

check('S4-A14', 'DDL 建出的表 == 四层点名（双向），6 张且各点名一次；14 暂缓表两库都不存在', () => {
  const grouped = schemaTables();
  eq(grouped.length, 6, '四层点名去重后必须是 6 张');
  const fromDdl = [...LIBRARY_TABLES, ...APP_TABLES].sort();
  eq(fromDdl, grouped, 'DDL 建出的表与四层点名必须逐张对上');

  const lib = openLibrary('A14-lib');
  const app = openApp('A14-app');
  try {
    eq(ourTables(lib.db, LIBRARY_VIRTUAL_TABLES), [...LIBRARY_TABLES, 'schema_version'].sort(), '库级真表');
    eq(ourTables(app.db, []), [...APP_TABLES].sort(), '应用级真表');
    const seen = new Map();
    for (const layer of SCHEMA_LAYER_ORDER) {
      for (const n of SCHEMA_LAYERS[layer]) seen.set(n, (seen.get(n) || 0) + 1);
    }
    eq([...seen.values()], [1, 1, 1, 1, 1, 1], '每张表恰好点名一次');
    eq(tablesInLayer('intent'), [], '意图层本轮为空（空层合法）');
    const DEFERRED = ['app_setting', 'activity', 'recent_query', 'recent_view', 'asset_name_fts',
      'asset_user_meta', 'tag', 'asset_tag', 'collection', 'collection_item', 'asset_export',
      'job', 'health_run', 'health_finding'];
    eq(DEFERRED.length, 14, '暂缓表 14 张');
    const present = [];
    for (const n of DEFERRED) {
      if (allTables(lib.db).includes(n) || allTables(app.db).includes(n)) present.push(n);
    }
    eq(present, [], '第二轮的表本轮一张都不许被建出来');
    const oneLess = LIBRARY_MIGRATIONS.map((m) => ({
      version: m.version,
      name: m.name,
      statements: m.statements.filter((s) => !s.includes('CREATE TABLE IF NOT EXISTS asset_file ')),
    }));
    const derived = createdTableNames(oneLess.flatMap((m) => m.statements));
    assert(!derived.includes('asset_file'), '删掉 asset_file 的 DDL ⇒ 派生清单必须跟着少一张');
    return '6 张 / 双向一致 / 14 暂缓缺席 / 派生可证';
  } finally { lib.db.close(); app.db.close(); }
});

check('S4-FK', '外键 ON DELETE CASCADE 真生效：删 1 条 asset ⇒ asset_file 与 asset_index_state 同时走', () => {
  const lib = openLibrary('FK');
  try {
    const FIXED = 1700000000000;
    const uid = 'aa0000000001';
    lib.db.prepare('INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)')
      .run(uid, 'L1', 'CR', 'ID-1', 'ID-1.jpg', 'CR', 'CR/ID-1.jpg', FIXED);
    lib.db.prepare('INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?,?,?,?,?,?)')
      .run(uid, 'preview', 'CR/ID-1.jpg', '.jpg', 10, FIXED);
    lib.db.prepare('INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?,?,?,?,?,?)')
      .run(uid, 'archive', 'CR/ID-1.rar', '.rar', 20, FIXED);
    lib.db.prepare('INSERT INTO asset_index_state (uid) VALUES (?)').run(uid);
    const fks = lib.db.prepare('PRAGMA foreign_key_list(asset_file)').all();
    const fks2 = lib.db.prepare('PRAGMA foreign_key_list(asset_index_state)').all();
    eq(fks.map((f) => [f.table, f.on_delete]), [['asset', 'CASCADE']], 'asset_file 的外键');
    eq(fks2.map((f) => [f.table, f.on_delete]), [['asset', 'CASCADE']], 'asset_index_state 的外键');
    lib.db.prepare('DELETE FROM asset WHERE uid = ?').run(uid);
    const nf = lib.db.prepare('SELECT COUNT(*) n FROM asset_file WHERE uid = ?').get(uid).n;
    const ns = lib.db.prepare('SELECT COUNT(*) n FROM asset_index_state WHERE uid = ?').get(uid).n;
    eq([nf, ns], [0, 0], '两处子表必须跟着删（少删一处 = 孤儿行）');
    return 'asset_file + asset_index_state 两处都级联';
  } finally { lib.db.close(); }
});

check('S4-UNIQ', '关键 UNIQUE 真拒重复：asset(lib_id,rel_path) / library_registry.root / collect_dir.label + 单默认', () => {
  const lib = openLibrary('UNIQ-lib');
  const app = openApp('UNIQ-app');
  try {
    const FIXED = 1700000000000;
    const ins = (uid, libId, relPath) => lib.db.prepare('INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)')
      .run(uid, libId, 'CR', 'S' + uid, 'S' + uid + '.jpg', 'CR', relPath, FIXED);
    ins('aa0000000001', 'L1', 'CR/A.jpg');
    let dup = false;
    try { ins('aa0000000002', 'L1', 'CR/A.jpg'); } catch { dup = true; }
    assert(dup, 'asset(lib_id, rel_path) 必须拒绝同库同路径的第二条');
    ins('aa0000000003', 'L2', 'CR/A.jpg');
    eq(lib.db.prepare('SELECT COUNT(*) n FROM asset').get().n, 2, '不同库同名路径应当允许');

    const dirA = tmpDir('rootA');
    const dirB = tmpDir('rootB');
    insertLibrary(app.db, { libId: 'L1', root: dirA, now: () => FIXED });
    let rootDup = false;
    try { insertLibrary(app.db, { libId: 'L2', root: dirA, now: () => FIXED }); } catch { rootDup = true; }
    assert(rootDup, 'library_registry.root 必须 UNIQUE（同一目录不能登两次）');
    insertLibrary(app.db, { libId: 'L3', root: dirB, now: () => FIXED });

    const insCol = (id, label, isDefault) => app.db.prepare('INSERT INTO collect_dir (dir_id, label, abs_path, is_default, created_at_ms) VALUES (?,?,?,?,?)')
      .run(id, label, 'X:/take/' + id, isDefault, FIXED);
    insCol('c1', '素材待用', 1);
    let labelDup = false, defaultDup = false;
    try { insCol('c2', '素材待用', 0); } catch { labelDup = true; }
    try { insCol('c3', '第二个默认', 1); } catch { defaultDup = true; }
    assert(labelDup, 'collect_dir.label 必须 UNIQUE');
    assert(defaultDup, '默认取件目录只能有一个（偏唯一索引）');
    return 'asset(lib_id,rel_path) · root · label · 单默认 四处都真拒';
  } finally { lib.db.close(); app.db.close(); }
});

check('S4-FIELDMAP', 'field-map（设计基线 §1）↔ 真 DDL 双向覆盖：map 字段都在 DDL；DDL 每列都被 map 引用', () => {
  // 解析规则（**只认「#### 表名 + 紧跟的字段表」**）：一段表格在"非表格、非空"的行处结束。
  // ⚠️ 教训：第一版没做"段结束"，把后面 §2/§3 那些表格的行也算进了最后一张表 ⇒ 自造假漂移。
  const doc = fs.readFileSync(DESIGN_DOC, 'utf8').split('\n');
  const map = new Map();
  let current = null;
  let pending = new Set();
  const commit = () => {
    if (current && pending.size > 0 && !map.has(current)) map.set(current, pending);
    pending = new Set();
  };
  for (const line of doc) {
    const h = line.match(/^####\s+([a-z_]+)\b/);
    if (h) { commit(); current = h[1]; continue; }
    if (/^#{1,3}\s/.test(line)) { commit(); current = null; continue; }
    if (!current) continue;
    if (line.trim() === '') continue;
    if (/^\|\s*字段\s*\|/.test(line)) continue;
    if (/^\|[\-\s|]+\|$/.test(line)) continue;
    if (/^\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim());
      const fieldCell = cells[1] || '';
      if (!fieldCell) continue;
      for (const f of fieldCell.split('·')) {
        const name = f.trim();
        if (/^[a-z_][a-z0-9_]*$/.test(name)) pending.add(name);
      }
      continue;
    }
    commit(); current = null;
  }
  commit();
  const mappedTables = [...map.keys()].sort();
  const six = [...LIBRARY_TABLES, ...APP_TABLES].sort();
  eq(mappedTables, six, '设计基线 §1 点名的表必须正好是本轮 6 张');

  const lib = openLibrary('FM-lib');
  const app = openApp('FM-app');
  try {
    const ddlCols = new Map();
    for (const t of LIBRARY_TABLES) ddlCols.set(t, columnsOf(lib.db, t));
    for (const t of APP_TABLES) ddlCols.set(t, columnsOf(app.db, t));
    const missing = [];
    for (const [t, fields] of map) {
      for (const f of fields) if (!ddlCols.get(t).includes(f)) missing.push(t + '.' + f);
    }
    eq(missing, [], 'map 里有、DDL 里没有的字段（文档与实现漂移）');
    const INTERNAL_FIELDS = new Set([]);
    const undocumented = [];
    for (const [t, cols] of ddlCols) {
      for (const c of cols) if (!map.get(t).has(c) && !INTERNAL_FIELDS.has(t + '.' + c)) undocumented.push(t + '.' + c);
    }
    eq(undocumented, [], 'DDL 里没有任何出处的列（要么进 map，要么显式标为内部字段）');
    const total = [...map.values()].reduce((n, s) => n + s.size, 0);
    return 'map ' + String(mappedTables.length) + ' 表 / ' + String(total) + ' 字段；双向零漂移；内部字段 0 个';
  } finally { lib.db.close(); app.db.close(); }
});

check('S4-REFLEX', '索引 ↔ 条目自反性（100 条夹具）：vector_row 双射 + 取该行向量检索 top-1 是自己', () => {
  const dbPath = path.join(FIXTURE_LIB, '.gs.db');
  const indexPath = path.join(FIXTURE_LIB, '.gs-index.bin');
  assert(fs.existsSync(dbPath) && fs.existsSync(indexPath), '夹具缺失：' + FIXTURE_LIB + '（S2/S3 产出）');
  const bin = readIndexBin(indexPath);
  const db = openNodeSqlite(dbPath, { readOnly: true });
  try {
    eq([bin.count, bin.dim], [100, 768], '索引必须是 100 × 768');
    const rowsState = db.prepare('SELECT uid, vector_row FROM asset_index_state ORDER BY vector_row').all();
    const encoded = rowsState.filter((r) => r.vector_row !== null && r.vector_row !== undefined);
    eq(encoded.length, bin.count, '索引行数必须等于已编码条目数（多/少 = 索引与条目对不上）');
    const rowToUid = new Map();
    const collisions = [];
    for (const r of encoded) {
      if (rowToUid.has(r.vector_row)) collisions.push(r.vector_row);
      rowToUid.set(r.vector_row, r.uid);
    }
    eq(collisions, [], '两条件目不许指向同一个 vector_row（否则反查映射不成立）');
    const expectedRows = Array.from({ length: bin.count }, (_, i) => i);
    eq([...rowToUid.keys()].sort((a, b) => a - b), expectedRows, 'vector_row 必须恰好覆盖 0..count-1（不许有洞）');
    const dim = bin.dim, v = bin.vectors;
    const sample = encoded.filter((_, i) => i % 7 === 0);
    const bad = [];
    for (const r of sample) {
      const base = r.vector_row * dim;
      let bestRow = -1, best = -Infinity;
      for (let i = 0; i < bin.count; i++) {
        let dot = 0;
        const off = i * dim;
        for (let d = 0; d < dim; d++) dot += v[base + d] * v[off + d];
        if (dot > best) { best = dot; bestRow = i; }
      }
      if (rowToUid.get(bestRow) !== r.uid) bad.push(r.uid + ' → top-1 行 ' + String(bestRow) + ' 属于 ' + String(rowToUid.get(bestRow)));
    }
    eq(bad, [], '拿 vector_row 的向量检索，top-1 必须映射回它自己（对不上 = 索引行与条目错位）');
    return '100×768 · vector_row 双射 · 抽样 ' + String(sample.length) + ' 条 top-1 全为自身';
  } finally { db.close(); }
});

check('S4-ITEMS', 'A17：items 只读（跑前后 .gs.db 摘要一致）· 越界给空 rows 但 total 正确 · facets 不从当前页推导', () => {
  const dbPath = path.join(FIXTURE_LIB, '.gs.db');
  const before = sha256(fs.readFileSync(dbPath));
  const input = { libId: 'L1', libraries: [{ libId: 'L1', root: FIXTURE_LIB }], userDataDir: null };
  const first = runItemsQuery(input, { libId: 'L1', offset: 0, limit: 1 });
  assert(first.ok, 'items 必须成功：' + JSON.stringify(first).slice(0, 300));
  const all = runItemsQuery(input, { libId: 'L1', offset: 0, limit: 500 });
  const beyond = runItemsQuery(input, { libId: 'L1', offset: 1000, limit: 10 });
  const lastPage = runItemsQuery(input, { libId: 'L1', offset: 99, limit: 1 });
  const filtered = runItemsQuery(input, { libId: 'L1', folder: 'CR', offset: 0, limit: 5 });

  eq(all.data.total, 100, 'total 必须 = 100（筛选后总数）');
  eq(all.data.rows.length, 100, 'limit 500 应当拿满 100 行');
  assert(beyond.ok && beyond.data.rows.length === 0, '越界必须给空 rows');
  eq(beyond.data.total, 100, '越界时 total 仍须如实（写成 rows.length 就会是 0 ⇒ 这条会红）');

  const f = first.data.facets;
  eq(f.folders.map((x) => x.value).sort(), ['CR', 'CR+VR'], '第一页只有 1 行，facets 仍须含全库两个分类');
  eq(f.foldersTotal, 2, 'foldersTotal');
  eq(f.exts.map((x) => x.value).sort(), ['.jpeg', '.jpg', '.png'], 'exts facets 必须是全库的 3 种');
  eq(f.extsTotal, 3, 'extsTotal');
  eq(lastPage.data.facets, f, 'facets 跨分页必须逐字段稳定');
  eq(filtered.data.facets, f, 'facets 不受筛选影响');
  eq(filtered.data.total, 22, '按 folder=CR 筛选 total = 22');

  eq(sha256(fs.readFileSync(dbPath)), before, 'items 是只读的：.gs.db 跑前后必须逐字节一致');
  return 'total=100 · 越界 rows=0/total=100 · facets 稳定且全库 · .gs.db 摘要一致';
});

check('S4-A18', 'A18：引擎 ERR 键数 == 28，且与 SPEC §5.2 列出的码**同一个集合**', () => {
  const errKeys = Object.keys(ERR).sort();
  eq(errKeys.length, 28, '引擎 ERR 键数必须是 SPEC §5.2 的 28');
  const specLines = fs.readFileSync(SPEC, 'utf8').split('\n');
  const start = specLines.findIndex((l) => /^### 5\.2/.test(l));
  const end = specLines.findIndex((l, i) => i > start && /^### 5\.3/.test(l));
  assert(start > 0 && end > start, 'SPEC §5.2 段落定位失败');
  const specText = specLines.slice(start, end).join('\n');
  const tick = String.fromCharCode(96);
  const specCodes = [...new Set((specText.match(new RegExp(tick + '[A-Z][A-Z_]{2,}' + tick, 'g')) || []).map((s) => s.slice(1, -1)))].sort();
  eq(specCodes, errKeys, 'SPEC §5.2 的码集合与引擎 ERR 必须完全一致');
  assert(errKeys.includes('DB_OPEN_FAILED'), 'DB_OPEN_FAILED 必须在引擎码空间里（S7a）');
  eq(errKeys.filter((k) => k.startsWith('IMPORT_')).length, 7, 'IMPORT_* 一族 7 个');
  return '28 码 · SPEC ↔ 引擎逐项一致 · IMPORT_* 7 个 · DB_OPEN_FAILED 在';
});

check('S4-A15', 'A15：library_registry.root 规范化 —— 同一目录不同写法不能登两次，库里只存规范形', () => {
  const app = openApp('A15');
  try {
    const dir = tmpDir('real');
    const canonical = normalizeRootPath(dir);
    const canon = [dir, dir + path.sep, dir.toUpperCase(), dir.replace(/\\/g, '/')].map((s) => normalizeRootPath(s));
    const distinct = [...new Set(canon)];
    assert(distinct.length === 1 && distinct[0] === canonical, '同一目录的多种写法必须归一到同一个规范形，实际 ' + JSON.stringify(canon));
    insertLibrary(app.db, { libId: 'L1', root: dir });
    let dup = false;
    try { insertLibrary(app.db, { libId: 'L2', root: dir.toUpperCase() + path.sep }); } catch { dup = true; }
    assert(dup, '大小写/尾斜杠的第二种写法必须被 root UNIQUE 拒掉');
    eq(app.db.prepare('SELECT COUNT(*) n FROM library_registry').get().n, 1, '库里只该有一行');
    eq(app.db.prepare('SELECT root FROM library_registry').get().root, canonical, '库里只存规范形');
    return '4 种写法 → 1 个规范形；第二次登记被 UNIQUE 拒绝';
  } finally { app.db.close(); }
});

// ================================================================ A16（旧库不升级）

check('S4-A16', 'A16 旧库不升级：旧口径 .gs.db ⇒ 如实告知 + 丢弃重建 + 素材不动；**当前版本的库不被丢弃**（能红对照）', () => {
  // 源夹具 6 GB ⇒ 只取 3 条记录 + 3 组小文件，**在副本上**造库（源只读）
  const allItems = JSON.parse(fs.readFileSync(path.join(FIXTURE_LIB, 'items.json'), 'utf8'));
  assert(Array.isArray(allItems) && allItems.length >= 3, '夹具 items.json 读不出数组');
  const sample = allItems.slice(0, 3);
  const makeRoot = (label) => {
    const root = tmpDir(label);
    fs.writeFileSync(path.join(root, 'items.json'), JSON.stringify(sample, null, 2), 'utf8');
    for (const rec of sample) {
      for (const rel of [rec.relPath, rec.archiveRelPath]) {
        if (!rel) continue;
        const p = path.join(root, String(rel).split('\\').join(path.sep));
        fs.mkdirSync(path.dirname(p), { recursive: true });
        if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from('material-8f3a-' + String(rel), 'utf8'));
      }
    }
    return root;
  };

  // ① 旧口径库：旧表 items / library + schema_version = 2（**不在**本轮 6 张口径内）
  const oldRoot = makeRoot('A16-old');
  const oldDb = path.join(oldRoot, '.gs.db');
  const mk = openNodeSqlite(oldDb);
  mk.exec('CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 0), updated_at INTEGER NOT NULL);');
  mk.exec('CREATE TABLE IF NOT EXISTS library (lib_id TEXT PRIMARY KEY, lib_root TEXT, count INTEGER);');
  mk.exec('CREATE TABLE IF NOT EXISTS items (uid TEXT PRIMARY KEY, lib_id TEXT, rel_path TEXT, folder TEXT, stem TEXT);');
  mk.prepare('INSERT OR REPLACE INTO schema_version (id, version, updated_at) VALUES (1, 2, ?)').run(1700000000000);
  mk.prepare('INSERT OR REPLACE INTO library (lib_id, lib_root, count) VALUES (?,?,?)').run('L1', oldRoot, 0);
  mk.close();

  const healthOpts = { libId: 'L1', root: oldRoot, dbPath: oldDb, itemsJsonPath: path.join(oldRoot, 'items.json'), legacyLibrariesDir: null };

  // ② 如实告知：体检必须**说清**这是旧口径库，而不是当成好库
  const health = checkLibraryHealth(healthOpts);
  const schemaCheck = health.checks.find((c) => c.id === 'db-schema');
  assert(schemaCheck !== undefined, '体检报告里必须有 db-schema 这一项');
  eq(schemaCheck.ok, false, '旧口径库的 db-schema 不该通过（不假装兼容）');
  eq(schemaCheck.code, 'SCHEMA_TOO_NEW', '码必须是 SCHEMA_TOO_NEW（库比程序新）');
  assert(typeof schemaCheck.reason === 'string' && schemaCheck.reason.length > 0, '必须给出可读理由');
  eq(health.ok, false, '体检不得对旧口径库宣布 ok');
  eq(schemaCheck.rebuildable, true, '必须标为可重建（否则用户无路可走）');

  // ③ 不静默迁移：直接用产品入口打开它必须**拒绝**，而不是把旧表留着继续用
  let openErr = null;
  try { const o = openGsDb({ dbPath: oldDb }); o.db.close(); } catch (e) { openErr = e; }
  assert(openErr !== null, 'openGsDb 不该静默接受旧口径库（那就是"静默迁移/假装兼容"）');
  eq(openErr.code, 'SCHEMA_TOO_NEW', 'openGsDb 也必须报同一个码');

  // ④ 丢弃重建 + 素材不动
  const before = materialDigest(oldRoot, { withContent: true });
  const r = rebuildLibraryDb({ libId: 'L1', root: oldRoot, itemsJsonPath: path.join(oldRoot, 'items.json'), dbPath: oldDb, expectedCount: sample.length, checkBefore: true });
  assert(r.removedDbFiles.length >= 1, '旧 .gs.db 必须被真的删掉（removedDbFiles 为空 = 没丢）');
  eq(r.created, true, '重建必须新建一个库文件');
  eq([r.schema.fromVersion, r.schema.toVersion], [0, 1], 'schema 必须从 v0 建到 v1');
  eq(r.dbOk, true, '重建后的 db-* 检查必须全过');
  assert(typeof r.reason === 'string' && r.reason.includes('重建完成'), '报告必须给出重建理由：' + String(r.reason));
  const after = materialDigest(oldRoot, { withContent: true });
  eq(after.count, before.count, '素材条目数不许变');
  eq(after.digest, before.digest, '素材摘要（含内容 sha1）必须逐位相同 —— 重建不许动素材');

  const nw = openNodeSqlite(oldDb, { readOnly: true });
  const names = new Set(nw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name));
  nw.close();
  eq([names.has('items'), names.has('library')], [false, false], '旧表 items / library 必须被清掉（丢干净）');
  eq([...LIBRARY_TABLES, 'schema_version'].filter((x) => !names.has(x)), [], '绿地 6 张口径的表必须都在');

  // ⑤ 能红对照：**当前版本**的库不许被丢弃（证明上面的判据不是恒真）
  const curRoot = makeRoot('A16-current');
  const curDb = path.join(curRoot, '.gs.db');
  const first = openGsDb({ dbPath: curDb, now: () => 1700000000000 });
  first.db.close();
  const curHealth = checkLibraryHealth({ libId: 'L1', root: curRoot, dbPath: curDb, itemsJsonPath: path.join(curRoot, 'items.json'), legacyLibrariesDir: null });
  const curSchema = curHealth.checks.find((c) => c.id === 'db-schema');
  eq([curSchema.ok, curSchema.code], [true, ''], '当前版本的库必须通过 db-schema（不该被丢弃）');
  const second = openGsDb({ dbPath: curDb, now: () => 1700000000000 });
  const applied = second.migration.applied.length;
  const ver = readSchemaVersion(second.db);
  second.db.close();
  eq([applied, ver], [0, 1], '再打开必须幂等（applied=0、版本仍 v1）');
  assert(fs.existsSync(curDb), '当前版本的库文件必须还在（没被丢弃）');
  return '旧库：如实告知(SCHEMA_TOO_NEW/可重建) + 丢弃重建(v0→v1、旧表清空) + 素材 sha1 不变；对照：当前版本库 db-schema 通过且幂等不丢';
});

console.log('');
skip('S4-A18b', 'A18 第二半：同一个坏 .gs.db 经引擎端口与经体检返回同一个 DB_OPEN_FAILED',
  '依赖 S7b（task-61 pending：删 main 侧 DB_OPEN_FAILED→INDEX_CORRUPT 改名映射 + 端到端断言）');

console.log('');
console.log('── 汇总 ──────────────────────────────────────────────────────');
const width = Math.max(...rows.map((r) => r.id.length));
for (const r of rows) console.log('  ' + r.status.padEnd(4) + ' ' + r.id.padEnd(width) + '  ' + r.title);
const pass = rows.filter((r) => r.status === 'PASS').length;
const failN = rows.filter((r) => r.status === 'FAIL').length;
const sk = rows.filter((r) => r.status === 'SKIP').length;
console.log('  PASS ' + String(pass) + ' · FAIL ' + String(failN) + ' · SKIP ' + String(sk));
console.log('');
console.log('── DEFERRED（明确**不算进**本脚本结论）─────────────────────────');
console.log('  · npm test 全绿：S2（task-59）仍在关 24 条单测红 ⇒ 等 S2 收口后补跑。');
console.log('  · A18 第二半：见上面的 SKIP 原因。');
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);

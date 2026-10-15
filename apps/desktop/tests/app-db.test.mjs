// apps/desktop/tests/app-db.test.mjs —— S6：应用级 app.db 的 3 张表 + **每张表唯一写入口**
//
// 依据：设计基线 §1.1（字段/约束）· §2.3（每张表的唯一写入口）· schema-layers.ts（落点）。
// 这个文件只碰应用级；库级 3 张表（asset/asset_file/asset_index_state）由 S2 的测试覆盖。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appDbPath, deleteCollectDir, deleteLibrary, getLibrary, insertCollectDir, insertLibrary,
  listCollectDirs, listLibraries, openAppDb, readAppMeta, setDefaultCollectDir,
  updateLibraryEnabled, updateLibrarySortOrder,
} from '../src/main/app-db.ts';
import { APP_TABLES, APP_TARGET_SCHEMA_VERSION } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t58', 'app-db-test-' + process.pid);
const NOW = () => 1700000000000;

let app = null;
before(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  app = openAppDb({ userDataDir: TMP, now: NOW });
});
after(() => {
  try { if (app) app.close(); } catch { /* 已关 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 临时目录 */ }
});

test('D1 ⭐ 打开即建库：app.db 在 <userData>/app.db，应用级 3 张表齐全，账本推到目标版本', () => {
  assert.equal(app.dbPath, appDbPath(TMP));
  assert.ok(fs.existsSync(app.dbPath), 'app.db 应当被建出来');
  assert.equal(app.migration.toVersion, APP_TARGET_SCHEMA_VERSION);
  const names = app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r['name']);
  for (const t of APP_TABLES) assert.ok(names.includes(t), '缺表：' + t + '（实得 ' + names.join(',') + '）');
  assert.deepEqual([...APP_TABLES].sort(), ['app_meta', 'collect_dir', 'library_registry']);
  // app_meta 单行 + 版本
  const meta = readAppMeta(app.db);
  assert.equal(meta.schemaVersion, APP_TARGET_SCHEMA_VERSION);
});

test('D2 ⭐ library_registry：登记 → 规范化 root → 重复 root 被 UNIQUE 拦住 → 停用/排序/删除', () => {
  const row = insertLibrary(app.db, { libId: 'L1', root: TMP, displayName: '主库', now: NOW });
  assert.equal(row.libId, 'L1');
  assert.equal(row.root, TMP.replace(/[\\/]+$/, ''), 'root 落库前必须规范化（去尾分隔符等）');
  assert.equal(row.enabled, true, '默认启用');
  assert.equal(row.sortOrder, 0);

  // 同一个 root 再登记一次（换个 libId）⇒ UNIQUE 冲突要**如实抛**
  assert.throws(() => insertLibrary(app.db, { libId: 'L2', root: TMP + path.sep, displayName: '别名', now: NOW }));
  // 同一个 libId 再插 ⇒ PRIMARY KEY 冲突
  assert.throws(() => insertLibrary(app.db, { libId: 'L1', root: path.join(TMP, 'x'), displayName: 'x', now: NOW }));

  assert.equal(updateLibraryEnabled(app.db, 'L1', false, NOW).enabled, false);
  assert.equal(getLibrary(app.db, 'L1').enabled, false, '停用要落库');
  assert.equal(updateLibrarySortOrder(app.db, 'L1', 7, NOW).sortOrder, 7);
  assert.deepEqual(listLibraries(app.db).map((l) => l.libId), ['L1']);
  assert.equal(deleteLibrary(app.db, 'L1'), true);
  assert.equal(deleteLibrary(app.db, 'L1'), false, '删第二次 = 0 行（不撒谎说删到了）');
  assert.equal(listLibraries(app.db).length, 0);
});

test('D3 ⭐ collect_dir：默认项**只能有一个**（数据库约束，不靠 UI 自觉）', () => {
  const a = insertCollectDir(app.db, { absPath: path.join(TMP, 'out-a'), label: '待用A', makeDefault: true, now: NOW });
  assert.equal(a.isDefault, true);
  const b = insertCollectDir(app.db, { absPath: path.join(TMP, 'out-b'), label: '待用B', now: NOW });
  assert.equal(b.isDefault, false);
  assert.equal(listCollectDirs(app.db).filter((d) => d.isDefault).length, 1);
  assert.equal(listCollectDirs(app.db)[0].dirId, a.dirId, '默认项排在最前');

  // 切默认：旧的那条必须被清掉（单事务）
  const c = setDefaultCollectDir(app.db, b.dirId);
  assert.equal(c.dirId, b.dirId);
  const defaults = listCollectDirs(app.db).filter((d) => d.isDefault);
  assert.equal(defaults.length, 1, '永远只有一个默认项');
  assert.equal(defaults[0].dirId, b.dirId);

  // ⚠️ 约束是**数据库级**的：绕过本模块的写入口硬插第二条 default 必须失败
  assert.throws(
    () => app.db.prepare('INSERT INTO collect_dir (dir_id, label, abs_path, is_default, created_at_ms) VALUES (?, ?, ?, 1, ?)')
      .run('d-forced', '强行第二条', path.join(TMP, 'out-c'), NOW()),
    /UNIQUE|constraint/i,
    'unique index uniq_collect_default 必须真的在库上（不是靠写入方自觉）',
  );

  assert.equal(setDefaultCollectDir(app.db, 'd-不存在'), null, '不存在的 id ⇒ null（不改动任何行）');
  assert.equal(deleteCollectDir(app.db, b.dirId), true);
  assert.equal(listCollectDirs(app.db).length, 1);
});

test('D4 ⭐⭐ 唯一写入口（静态）：应用级 3 张表只被 app-db.ts / 迁移写', () => {
  const mainDir = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(mainDir);

  /** 谁在这个文件里**字面**写了某张表（DDL 里的 CREATE 不算写数据） */
  const writersOf = (table) => files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return new RegExp('(INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+' + table + '\\b)|(UPDATE\\s+' + table + '\\b)|(DELETE\\s+FROM\\s+' + table + '\\b)', 'i').test(src);
  }).map((f) => path.basename(f)).sort();

  assert.deepEqual(writersOf('library_registry'), ['app-db.ts'],
    'library_registry 的写入口只能有 app-db.ts（§2.3：每张表一个写入口）');
  assert.deepEqual(writersOf('collect_dir'), ['app-db.ts'],
    'collect_dir 的写入口只能有 app-db.ts');
  // app_meta 的写入口**只有迁移**（§2.3）—— 迁移账本的读写就在 app-migrations.ts 里，
  // 它是"迁移"这一件事的实现，不算第二个业务写入口（业务侧一律只读：readAppMeta）。
  assert.deepEqual(writersOf('app_meta'), ['app-migrations.ts'],
    'app_meta 只许迁移写（业务侧只读）');

  // 只读入口也收敛：谁 SELECT 这两张表
  const readers = files.filter((f) => /SELECT[\s\S]{0,80}FROM\s+(library_registry|collect_dir)/i.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.basename(f)).sort();
  assert.deepEqual(readers, ['app-db.ts'], '读也只该走 app-db.ts（避免第二份列名/形状定义）');
});

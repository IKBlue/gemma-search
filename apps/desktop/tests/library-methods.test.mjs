// apps/desktop/tests/library-methods.test.mjs —— T-15a：libraryHealth / libraryRebuild 的契约与行为
//
// 覆盖（对应任务书 §4）：
//   L1 契约：两条新方法登记了 · 未登记方法仍被拒 · .strict() 拒多传 · 缺 libId 被拒
//   L2 体检（健康库）：结构化结论全过
//   L3 体检（坏索引）：index 项 code=INDEX_CORRUPT —— **不许归成 INTERNAL**
//   L4 重建（真实副本）：删库重建后**素材摘要前后一致** + 索引字节未动 + 复检通过
//   L5 未知库：LIB_NOT_FOUND 信封（**不抛**）· userMessage 非空
//   L6 库根缺失：体检给结构化结论、重建给 LIB_ROOT_MISSING 信封（都不抛）
//   L7 坏 .gs.db：体检把它报出来（结构化）→ 重建修好 → 复检 ok
//   IM1（T-42）IMPORT_* 经信封出去**不得**变成 INDEX_CORRUPT（假因果）
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateCall, METHOD_NAMES } from '../src/shared/ipc.ts';
import { runLibraryHealth, runLibraryRebuild } from '../src/main/library-ipc.ts';
import { materialDigest } from '../src/main/library-rebuild.ts';
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL = path.join(ROOT, 'data', 'libraries', 'L1');
const TMP = path.join(ROOT, 'data', '_t15a2', 'library-methods-' + process.pid);
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

let base = '';
let items = [];
let meta = {};

function cloneBase(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(base, dir, { recursive: true });
  return dir;
}
const deps = (dir, libs) => ({
  libId: libs[0].libId,
  libraries: libs,
  userDataDir: path.join(TMP, 'userdata'),
});
const LIBS = (dir) => [{ libId: 'L1', root: dir }];

before(() => {
  assert.ok(
    fs.existsSync(path.join(REAL, 'items.json')),
    '需要真实库 data/libraries/L1（本机存在）',
  );
  fs.rmSync(TMP, { recursive: true, force: true });
  base = path.join(TMP, 'base');
  fs.mkdirSync(base, { recursive: true });
  fs.copyFileSync(path.join(REAL, 'items.json'), path.join(base, 'items.json'));
  fs.copyFileSync(path.join(REAL, 'meta.json'), path.join(base, 'meta.json'));
  fs.copyFileSync(path.join(REAL, 'index.bin'), path.join(base, '.gs-index.bin'));
  meta = JSON.parse(fs.readFileSync(path.join(base, 'meta.json'), 'utf8'));
  items = JSON.parse(fs.readFileSync(path.join(base, 'items.json'), 'utf8'));
  // 落两条真素材（materialDigest 要有非空内容才说得上"前后一致"）
  for (const it of items.slice(0, 2)) {
    const img = path.join(base, ...String(it.relPath).split('\\'));
    fs.mkdirSync(path.dirname(img), { recursive: true });
    fs.writeFileSync(img, TINY_JPEG);
    if (it.archiveRelPath) {
      const ap = path.join(base, ...String(it.archiveRelPath).split('\\'));
      fs.mkdirSync(path.dirname(ap), { recursive: true });
      fs.writeFileSync(ap, 'ARCHIVE-' + it.uid);
    }
  }
  // 一个健康的 .gs.db（走生产导入代码）
  const opened = openGsDb({ dbPath: path.join(base, '.gs.db') });
  try {
    importItemsFromJson({
      db: opened.db,
      library: { libId: meta.lib_id, root: base },
      itemsJsonPath: path.join(base, 'items.json'),
      expectedCount: meta.count,
    });
  } finally {
    opened.db.close();
  }
});

after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

test('L1 契约：两条新方法登记 · 未登记仍被拒 · .strict() 拒多传 · 缺/非法 libId 被拒', () => {
  assert.ok(METHOD_NAMES.includes('libraryHealth'), 'libraryHealth 必须在白名单里');
  assert.ok(METHOD_NAMES.includes('libraryRebuild'), 'libraryRebuild 必须在白名单里');

  // 未登记方法照旧被拒（新方法不该把闸门放松）
  assert.equal(validateCall('libraryNuke', { libId: 'L1' }).ok, false);
  assert.equal(validateCall('exec', {}).ok, false);

  // 合法形状
  assert.equal(validateCall('libraryHealth', { libId: 'L1' }).ok, true);
  assert.equal(validateCall('libraryRebuild', { libId: 'L1' }).ok, true);

  // .strict()：多传一个字段就拒（两条都要）
  assert.equal(
    validateCall('libraryHealth', { libId: 'L1', root: 'D:/x' }).ok,
    false,
    '体检多传 root 必须被拒',
  );
  assert.equal(
    validateCall('libraryRebuild', { libId: 'L1', path: 'D:/x' }).ok,
    false,
    '重建多传 path 必须被拒',
  );

  // 缺 libId / 形状不合法
  assert.equal(validateCall('libraryHealth', {}).ok, false);
  // ⚠️ 大小写**不是**形状问题：LibId 允许 [A-Za-z0-9_-]（permissions S3 的 'lib-A_1' 就是合法的）。
  //    真正不合法的是路径穿越与空串。
  assert.equal(validateCall('libraryHealth', { libId: 'a/b' }).ok, false, 'libId 不许有路径分隔符');
  assert.equal(validateCall('libraryRebuild', { libId: '' }).ok, false);
});

test('L2 体检（健康库）：结构化结论 · 每项 ok · 不需要重建', () => {
  const dir = cloneBase('healthy');
  const res = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(res.ok, true, JSON.stringify(res));
  const rep = res.data;
  assert.equal(rep.libId, 'L1');
  assert.equal(rep.ok, true, '健康库应当 ok=true：' + rep.reason);
  assert.equal(rep.needsDbRebuild, false);
  assert.equal(rep.needsIndexRebuild, false);
  const byId = Object.fromEntries(rep.checks.map((c) => [c.id, c]));
  assert.equal(byId['library-root'].ok, true);
  assert.equal(byId['index'].ok, true, JSON.stringify(byId['index']));
  assert.equal(byId['items-file'].ok, true);
  assert.equal(byId['db-file'].ok, true);
  assert.equal(byId['db-open'].ok, true);
  for (const c of rep.checks)
    assert.ok(c.reason && c.reason.length > 0, '每项都要有人话理由（ok 时也要）');
  assert.ok(rep.reason.length > 0);
});

test('L3 体检（坏索引）：index 项 code=INDEX_CORRUPT —— 不许归成 INTERNAL', () => {
  const dir = cloneBase('badindex');
  const idx = path.join(dir, '.gs-index.bin');
  const buf = fs.readFileSync(idx);
  buf.writeUInt32LE(0xdeadbeef, 0); // 破坏 MAGIC ⇒ 引擎五道校验必挂
  fs.writeFileSync(idx, buf);

  const res = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(res.ok, true, '体检对坏库也应当是"成功的结构化结论"，不是错误信封');
  const idxCheck = res.data.checks.find((c) => c.id === 'index');
  assert.equal(idxCheck.ok, false);
  assert.equal(
    idxCheck.code,
    'INDEX_CORRUPT',
    '坏索引必须是 INDEX_CORRUPT（实测 code=' + idxCheck.code + '）',
  );
  assert.notEqual(idxCheck.code, 'INTERNAL', '不许归成 INTERNAL');
  assert.equal(res.data.ok, false, '索引坏了 ⇒ 整库不 ok');
  assert.equal(res.data.needsIndexRebuild, true, '索引坏了要**重新建索引**，不是重建元数据');
});

test('L4 重建（真实副本）：素材摘要前后一致 · 索引字节未动 · 复检通过', () => {
  const dir = cloneBase('rebuild');
  const beforeDigest = materialDigest(dir);
  const indexSha1 = sha1(path.join(dir, '.gs-index.bin'));
  const dbBefore = fs.statSync(path.join(dir, '.gs.db')).size;

  const health0 = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(health0.ok, true);
  assert.equal(health0.data.ok, true, '前置条件：重建前是健康库');

  const res = runLibraryRebuild(deps(dir, LIBS(dir)));
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
  const rep = res.data;
  assert.equal(rep.libId, 'L1');
  assert.equal(rep.created, true, '.gs.db 应当是这次重建新建的');
  assert.ok(
    rep.removedDbFiles.length >= 1,
    '要真的删掉旧的 .gs.db（实测 ' + JSON.stringify(rep.removedDbFiles) + '）',
  );
  assert.equal(rep.import.dbCount, meta.count);
  assert.equal(rep.dbOk, true, '重建目标（db-* 检查）必须通过');
  assert.equal(rep.after.ok, true, '复检（整个库）必须通过：' + rep.after.reason);
  assert.equal(
    rep.index.action,
    'kept',
    '没给 indexBytes ⇒ 绝不动索引（实测 ' + rep.index.action + '）',
  );
  assert.ok(dbBefore > 0);

  // ⭐ 关键断言：素材摘要**前后完全一致**（重建只碰 .gs-* 命名空间）
  const afterDigest = materialDigest(dir);
  assert.deepEqual(afterDigest, beforeDigest, '重建前后素材摘要必须一致');
  assert.equal(sha1(path.join(dir, '.gs-index.bin')), indexSha1, '索引字节也必须一字未动');

  // 复检（第三次调用）也应当健康
  const health2 = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(health2.ok, true);
  assert.equal(health2.data.ok, true, '复检必须 ok：' + health2.data.reason);
  assert.equal(health2.data.needsDbRebuild, false);
});

test('L5 未知库：LIB_NOT_FOUND 信封（不抛）· userMessage 非空', () => {
  const dir = cloneBase('unknown');
  // ⚠️ 这里必须**显式**传"清单里只有 L1、却问 L9"：deps() 会取 libs[0].libId 当被问的库，
  //    写成 deps(dir, [{libId:'L9'...}]) 等于"问一个已登记的 L9"（第一版就是这么假绿的）。
  const unknown = {
    libId: 'L9',
    libraries: [{ libId: 'L1', root: dir }],
    userDataDir: path.join(TMP, 'userdata'),
  };
  const res = runLibraryHealth(unknown);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'LIB_NOT_FOUND');
  assert.ok(res.error.userMessage && res.error.userMessage.length > 0);
  assert.notEqual(res.error.code, 'INTERNAL');

  const r2 = runLibraryRebuild(unknown);
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, 'LIB_NOT_FOUND');
  assert.ok(r2.error.userMessage.length > 0);
});

test('L6 库根缺失：体检给结构化结论 · 重建给 LIB_ROOT_MISSING（都不抛）', () => {
  const gone = path.join(TMP, '不存在的库根-' + Date.now());
  const res = runLibraryHealth(deps(gone, LIBS(gone)));
  assert.equal(res.ok, true, '库根不在也要给出结构化结论（让人看见"盘没挂载"）');
  const root = res.data.checks.find((c) => c.id === 'library-root');
  assert.equal(root.ok, false);
  assert.equal(root.code, 'LIB_ROOT_MISSING');
  assert.equal(res.data.ok, false);

  const r2 = runLibraryRebuild(deps(gone, LIBS(gone)));
  assert.equal(r2.ok, false);
  assert.equal(r2.error.code, 'LIB_ROOT_MISSING', '重建不许静默建出空库根（U6）');
  assert.ok(r2.error.userMessage.length > 0);
});

test('L7 坏 .gs.db：体检报出来（结构化）→ 重建修好 → 复检 ok', () => {
  const dir = cloneBase('baddb');
  const dbPath = path.join(dir, '.gs.db');
  fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database at all'));

  const res = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(res.ok, true);
  const dbOpen = res.data.checks.find((c) => c.id === 'db-open');
  const dbIntegrity = res.data.checks.find((c) => c.id === 'db-integrity');
  const broken = [dbOpen, dbIntegrity].filter((c) => c && !c.ok);
  assert.ok(
    broken.length >= 1,
    '坏 .gs.db 必须被体检报出来：' +
      JSON.stringify(res.data.checks.map((c) => [c.id, c.ok, c.code])),
  );
  assert.equal(res.data.needsDbRebuild, true, '这一项是**可重建**的（rebuildable=true）');
  for (const c of broken)
    assert.notEqual(c.code, 'INTERNAL', '具体码要能说清坏在哪（实测 ' + c.code + '）');

  const rebuilt = runLibraryRebuild(deps(dir, LIBS(dir)));
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt).slice(0, 600));
  assert.equal(rebuilt.data.dbOk, true);
  assert.equal(rebuilt.data.import.dbCount, meta.count);

  const health2 = runLibraryHealth(deps(dir, LIBS(dir)));
  assert.equal(health2.data.ok, true, '重建之后必须真的好了：' + health2.data.reason);
  assert.equal(health2.data.needsDbRebuild, false);
});

test('IM1 ⭐ IMPORT_* 经信封出去**不得**变成 INDEX_CORRUPT（T-42 的假因果）', () => {
  // 复现手法（2026-10-15 · S2b 更新）：在 items.json 里制造**两条不同 uid、同一 rel_path**。
  //   它骗过导入的前置校验（只查重复 uid），在**写事务内**被计数复核抓到
  //   ⇒ GsDbError(IMPORT_COUNT_MISMATCH) ⇒ 经 library-ipc 的信封出去必须**还是** IMPORT_*。
  //
  // ⚠️ 旧手法（把 TEMP/TMP 指到不存在的目录）**已失效**：那是 S2 改写前的失败路径 ——
  //    旧导入用 3594 个占位符的 `NOT IN (...)` 大清单，SQLite 要落临时文件；
  //    S2 的导入逐行 upsert、不再溢出到临时文件 ⇒ 同一条复现在今天会**成功**（本轮实测 res.ok=true）。
  //    换触发点不是放宽：被钉的失败模式没变 ——「导入阶段的失败必须以 IMPORT_* 码出去，不许伪装成索引损坏」。
  const dir = cloneBase('importfail');
  const itemsPath = path.join(dir, 'items.json');
  const cloned = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  assert.ok(cloned.length >= 2, '夹具前提：items.json 至少两条');
  assert.notEqual(
    cloned[1].relPath,
    cloned[0].relPath,
    '夹具前提：前两条的 relPath 本来不同（否则这条断言空转）',
  );
  assert.notEqual(
    cloned[1].uid,
    cloned[0].uid,
    '夹具前提：两条 uid 不同 ⇒ 前置校验放行，失败发生在写事务内',
  );
  cloned[1].relPath = cloned[0].relPath; // 撞 UNIQUE(lib_id, rel_path) 的**路径**
  fs.writeFileSync(itemsPath, JSON.stringify(cloned), 'utf8');

  const res = runLibraryRebuild(deps(dir, LIBS(dir)));
  assert.equal(res.ok, false, '路径撞车必须让重建失败（这就是复现路径）');
  assert.equal(
    res.error.code,
    'IMPORT_COUNT_MISMATCH',
    '写事务内的计数复核失败 ⇒ 必须是这个 IMPORT_* 码（实测 ' + res.error.code + '）',
  );
  assert.notEqual(res.error.code, 'INDEX_CORRUPT', '**不许**把它说成索引损坏（假因果）');
  assert.equal(
    res.error.details.rawCode,
    res.error.code,
    'details.rawCode 必须与 code 同名（信封不许二次改名）',
  );
  assert.ok(res.error.userMessage.length > 0, 'userMessage 恒非空');
  // 文案判据要**精确**：拦的是"谎称索引文件坏了"，不是"提到索引两个字"
  //   （IMPORT_COUNT_MISMATCH 的引擎文案本来就写着"条目表与索引的条数对不上"，那是事实，不是假因果）。
  assert.ok(
    !/索引(文件)?(已)?损坏/.test(res.error.userMessage),
    '文案不许声称"索引损坏"（那是另一条因果）：' + res.error.userMessage,
  );

  // 更强的正向断言：写事务**整条回滚** ⇒ 新建的 .gs.db 里一条事实行都没有（"没有半份导入"）
  const opened = openGsDb({ dbPath: path.join(dir, '.gs.db'), readOnly: true });
  try {
    assert.equal(
      opened.db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
      0,
      '失败的导入不许留下半条 asset 行',
    );
    assert.equal(
      opened.db.prepare('SELECT COUNT(*) AS n FROM asset_file').get().n,
      0,
      'asset_file 同样不许留行（CASCADE 之外也要自证）',
    );
  } finally {
    opened.db.close();
  }
});

// apps/desktop/tests/storage-ports-main.test.mjs —— T-16b：主进程侧的三个存储端口 + 接上引擎
//
// 与 packages/engine/tests/storage-ports.test.mjs 的分工：
//   · 那边用**假端口**验引擎的两条分支（注入/不注入）行为等价；
//   · 这边验**真实现**：.gs.db / items.json 回落 / <库根>/.gs-index.bin / T-04 的落点解析，
//     以及"接上以后"端到端能跑（真素材 + 真索引，**非 fake 模式**）。
//
// 每条用例对应的失败模式：
//   M1 库解析端口不抛引擎错误   ⇒ 信封里 code 变成 INTERNAL，界面文案全成"出了点问题"
//   M2 回退落点被当成素材根     ⇒ scan/collect 跑到 userData 去数文件
//   M3 有 .gs.db 却去读 items.json ⇒ 新布局形同虚设（而且没人知道）
//   M4 回落**静默**发生         ⇒ 用户以为在读 .gs.db
//   M5 .gs.db 坏了报 INTERNAL   ⇒ 与"索引损坏"的处置（重建）完全不同，界面给不出正确指引
//   M6 第二份 GSIDX 解析        ⇒ 校验分叉（AGENTS P1）
//   M7 端到端接不上             ⇒ M0 判据①"找到"就不成立
//   M8 端口错误码在信封里丢了   ⇒ T-16a 钉的那条契约当场失效
//
// 跑法：node --test apps/desktop/tests/storage-ports-main.test.mjs（也在 npm test 的 glob 里）
// ⚠️ 全量门禁由 Lead 统一跑（TASKS §3.6）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngine } from '../../../packages/engine/src/engine.ts';
import { EngineError, ERR } from '../../../packages/engine/src/errors.ts';
import { makeLibrary, writeIndexFixture, fakeEncoder } from '../../../packages/engine/tests/helpers/lib-fixture.mjs';

import { importItemsFromJson, openGsDb } from '../src/main/db/index.ts';
import {
  createItemStorePort,
  createLibraryResolverPort,
  createStoragePorts,
  createVectorIndexPort,
} from '../src/main/storage-ports.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t16', 'ports-test-' + process.pid);
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

const isEngineError = (code) => (e) => {
  assert.ok(e instanceof EngineError, '必须是引擎的 EngineError（普通 Error 会被信封归成 INTERNAL）');
  if (code) assert.equal(e.code, code);
  return true;
};

/**
 * 引擎夹具的条目是**精简形状**（14 字段），而 `.gs.db` 的列契约是 **18 字段**（SPEC §1.1，
 * T-11b 的导入是严格校验的 —— 缺字段报 IMPORT_RECORD_INVALID）。这里把 4 个**派生**字段补齐：
 * name / absPath / archiveName / archiveAbsPath。补齐动作与真实扫描器同口径，不是放宽校验。
 */
function fullItems(items, libRoot) {
  return items.map((it) => {
    const rel = String(it.relPath).split('\\').join('/');
    const arch = it.archiveRelPath ? String(it.archiveRelPath).split('\\').join('/') : null;
    const abs = path.join(libRoot, ...rel.split('/'));
    const archAbs = arch ? path.join(libRoot, ...arch.split('/')) : null;
    const st = fs.statSync(abs);
    const ast = archAbs ? fs.statSync(archAbs) : null;
    // 显式写全 18 个字段（缺一个 importItemsFromJson 会当场报，这正是 T-11b 的严格性）
    return {
      uid: it.uid,
      libId: it.libId,
      folder: it.folder,
      stem: it.stem,
      name: rel.slice(rel.lastIndexOf('/') + 1),
      relPath: it.relPath,
      absPath: abs,
      imageExt: it.imageExt,
      imageSize: Number(st.size),
      imageMtime: Math.round(st.mtimeMs),
      archiveName: arch ? arch.slice(arch.lastIndexOf('/') + 1) : null,
      archiveRelPath: it.archiveRelPath ?? null,
      archiveAbsPath: archAbs,
      archiveExt: it.archiveExt ?? null,
      archiveSize: ast ? Number(ast.size) : null,
      archiveMtime: ast ? Math.round(ast.mtimeMs) : null,
      vectorRow: it.vectorRow ?? null,
      vectorSource: it.vectorSource ?? null,
    };
  });
}

/**
 * 新布局的库：**真素材**（makeLibrary：VR/CR 各 2 图 + 1 包）+ 最小合法索引 + .gs.db。
 * 索引/条目夹具复用引擎自己的 helpers/lib-fixture.mjs（**不再写第二份 GSIDX 构造器**）。
 */
function setupWired(label, { withDb = true } = {}) {
  const base = freshDir(label);
  const made = makeLibrary();
  const libRoot = path.join(base, 'lib');
  fs.cpSync(made.root, libRoot, { recursive: true });
  const bootstrap = path.join(base, 'bootstrap');
  const fx = writeIndexFixture(bootstrap, 'L1', made.rows, { libRoot, dim: 8 });
  fs.writeFileSync(path.join(libRoot, '.gs-index.bin'), fx.indexBuffer);
  const full = fullItems(fx.items, libRoot);
  fs.writeFileSync(path.join(libRoot, 'items.json'), JSON.stringify(full));
  if (withDb) {
    const opened = openGsDb({ dbPath: path.join(libRoot, '.gs.db') });
    try {
      importItemsFromJson({
        db: opened.db,
        library: { libId: 'L1', root: libRoot },
        itemsJsonPath: path.join(libRoot, 'items.json'),
        expectedCount: full.length,
      });
    } finally {
      opened.db.close();
    }
  }
  return { base, libRoot, fx, made, itemsJsonPath: path.join(libRoot, 'items.json') };
}

/** 断言信封失败，并返回 error 对象（便于继续看 code/details） */
function envelopeError(res) {
  assert.equal(res.ok, false, '这一次调用应当失败；实际 ' + JSON.stringify(res).slice(0, 200));
  assert.ok(res.error && typeof res.error.code === 'string', '信封里必须有机器可读的 code');
  return res.error;
}

// ============================================================ M1 库解析端口

test('M1 ⭐ 库解析端口：list/has/get/requireExistingRoot/storageOf；未知库与缺库根都抛引擎错误', () => {
  const s = setupWired('M1');
  const resolver = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot, label: '测试库' }] });

  assert.deepEqual(resolver.list(), [{ libId: 'L1', label: '测试库', root: s.libRoot }]);
  assert.equal(resolver.has('L1'), true);
  assert.equal(resolver.has('L9'), false);
  assert.deepEqual(resolver.get('L1'), { libId: 'L1', label: '测试库', root: s.libRoot });
  assert.doesNotThrow(() => resolver.requireExistingRoot('L1'));

  const layout = resolver.storageOf('L1');
  assert.equal(layout.root, s.libRoot, 'root 是**声明库根**（素材所在地）');
  assert.equal(layout.indexPath, path.join(s.libRoot, '.gs-index.bin'));
  assert.equal(layout.dbPath, path.join(s.libRoot, '.gs.db'));
  assert.equal(layout.journalPath, path.join(s.libRoot, '.gs-journal'));

  assert.throws(() => resolver.get('L9'), isEngineError(ERR.LIB_NOT_FOUND));
  assert.throws(() => resolver.storageOf('L9'), isEngineError(ERR.LIB_NOT_FOUND));

  const goneRoot = path.join(s.base, 'gone');
  const resolver2 = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: goneRoot }] });
  assert.throws(() => resolver2.requireExistingRoot('L1'), isEngineError(ERR.LIB_ROOT_MISSING));
});

test('M2 ⭐ 回退落点：库根不可用 ⇒ .gs-* 指到 userData，而 root 仍是声明库根（素材不搬家）', () => {
  const declared = 'X:\\not-mounted\\lib';
  const userData = 'C:\\ud';
  const fallbackRoot = path.join(userData, 'libraries', 'L1');
  const memFs = {
    existsSync: (p) => p === userData,
    isDirectory: (p) => p === userData,
    writeFileSync: () => {},
    mkdirSync: () => {},
    unlinkSync: () => {},
  };
  const resolver = createLibraryResolverPort({
    libraries: [{ libId: 'L1', root: declared }],
    userDataDir: userData,
    probeWrites: false, // 端口是读路径：不做写探测（那是 T-04 启动路径的职责）
    fs: memFs,
  });
  const layout = resolver.storageOf('L1');
  assert.equal(layout.root, declared, '素材根不跟着回退（scan/collect 必须数声明库根）');
  assert.equal(layout.indexPath, path.join(fallbackRoot, '.gs-index.bin'));
  assert.equal(layout.dbPath, path.join(fallbackRoot, '.gs.db'));
});

// ============================================================ M3/M4 ItemStorePort

test('M3 ⭐ 条目端口：有 .gs.db 就从 db 读，**不**回落（onFallback 一次都不该响）', () => {
  const s = setupWired('M3');
  const fell = [];
  const resolver = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot }] });
  const port = createItemStorePort({ libraries: resolver, onFallback: (m) => fell.push(m) });

  const items = port.listItems('L1');
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.uid).sort(), s.fx.items.map((i) => i.uid).sort());
  const one = port.getItem('L1', s.fx.items[2].uid);
  assert.equal(one.uid, s.fx.items[2].uid);
  assert.equal(one.relPath, s.fx.items[2].relPath, '库里存的 relPath 必须原样读回');
  assert.equal(port.getItem('L1', 'nosuchuid0000'), null, '找不到要返回 null（由引擎转 UID_NOT_FOUND）');
  assert.deepEqual(fell, [], '有 .gs.db 时不许走回落');
});

test('M4 ⭐ 条目端口回落：没有 .gs.db ⇒ 读 items.json，且**必须明说**（onFallback 带上路径）', () => {
  const s = setupWired('M4', { withDb: false });
  assert.equal(fs.existsSync(path.join(s.libRoot, '.gs.db')), false, '夹具前提：没有 .gs.db');
  const fell = [];
  const resolver = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot }] });
  const port = createItemStorePort({ libraries: resolver, onFallback: (m) => fell.push(m) });

  assert.equal(port.listItems('L1').length, 4);
  assert.equal(port.getItem('L1', s.fx.items[0].uid).uid, s.fx.items[0].uid);
  assert.ok(fell.length >= 1, '回落必须被说出来');
  assert.match(fell[0], /回落/, '文案要讲清发生了什么');
  assert.match(fell[0].replace(/\\\\/g, '/'), /items\.json/);
});

test('M5 ⭐ 条目端口错误码：.gs.db 损坏 ⇒ INDEX_CORRUPT；items.json 也没有 ⇒ INDEX_MISSING', () => {
  const s = setupWired('M5');
  const resolver = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot }] });
  const port = createItemStorePort({ libraries: resolver, onFallback: () => {} });

  const dbPath = path.join(s.libRoot, '.gs.db');
  const fd = fs.openSync(dbPath, 'r+');
  fs.writeSync(fd, Buffer.alloc(16, 0), 0, 16, 0);
  fs.closeSync(fd);
  assert.throws(() => port.listItems('L1'), isEngineError(ERR.INDEX_CORRUPT));
  assert.throws(() => port.getItem('L1', 'whatever0000'), isEngineError(ERR.INDEX_CORRUPT));

  const s2 = setupWired('M5b', { withDb: false });
  fs.rmSync(path.join(s2.libRoot, 'items.json'));
  const port2 = createItemStorePort({
    libraries: createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s2.libRoot }] }),
    onFallback: () => {},
  });
  assert.throws(() => port2.listItems('L1'), isEngineError(ERR.INDEX_MISSING));
});

// ============================================================ M6 VectorIndexPort

test('M6 ⭐ 索引端口：读回真索引（含向量块）；缺失/损坏都是引擎错误', () => {
  const s = setupWired('M6');
  const resolver = createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot }] });
  const port = createVectorIndexPort({ libraries: resolver });

  const bin = port.readIndex('L1');
  assert.equal(bin.count, 4);
  assert.equal(bin.dim, 8);
  assert.ok(bin.vectors instanceof Float32Array);
  assert.equal(bin.vectors.length, 4 * 8);

  const indexPath = path.join(s.libRoot, '.gs-index.bin');
  const bytes = fs.readFileSync(indexPath);
  fs.rmSync(indexPath);
  assert.throws(() => port.readIndex('L1'), isEngineError(ERR.INDEX_MISSING));
  fs.writeFileSync(indexPath, 'not a gsidx');
  assert.throws(() => port.readIndex('L1'), isEngineError(ERR.INDEX_CORRUPT));
  fs.writeFileSync(indexPath, bytes);

  // 底层抛**普通 Error** 时，端口也必须吐引擎错误（信封才有 code）
  const port2 = createVectorIndexPort({
    libraries: resolver,
    readIndexBin: () => {
      throw new Error('boom');
    },
  });
  assert.throws(() => port2.readIndex('L1'), isEngineError(ERR.INTERNAL));
});

// ============================================================ M7 接上引擎（端到端）

test('M7 ⭐⭐ 接上引擎（真素材 + 真索引，非 fake）：找库 → 检索 → 详情 → 取件', async () => {
  const s = setupWired('M7');
  const outDir = path.join(s.base, 'out');
  const ports = createStoragePorts({
    libraries: createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot, label: '测试库' }] }),
  });
  const engine = createEngine({
    config: { data_dir: path.join(s.base, 'data'), collect: { dirs: { out: outDir }, default: 'out' } },
    encoder: fakeEncoder('first'), // 与 fixture 第 0 行同向 ⇒ top-1 可预测
    storage: ports,
  });

  // ① 找到库
  const st = await engine.indexStatus();
  assert.equal(st.ok, true, JSON.stringify(st.error));
  const row = st.data.libs[0];
  assert.equal(row.root, s.libRoot);
  assert.equal(row.rootExists, true);
  assert.equal(row.indexed, 4, '条目数来自 .gs.db');
  assert.equal(row.encoded, 4, '向量行数来自 .gs-index.bin');
  assert.equal(row.dim, 8);
  assert.equal(row.healthy, true, JSON.stringify(row.problems));
  assert.ok(row.storage, '接了库解析端口 ⇒ 返回里应有 storage 块');
  assert.equal(row.storage.layout, 'library-root');
  assert.equal(row.storage.indexExists, true);
  assert.equal(row.storage.dbExists, true);

  // ② 检索：fakeEncoder('first') 与第 0 行同向 ⇒ 第 0 行必须是 top-1（且分数≈1）
  const res = await engine.search({ mode: 'text', text: '任意查询', topK: 4 });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.deepEqual(res.data.libsUsed, ['L1']);
  assert.equal(res.data.results.length, 4);
  assert.equal(res.data.results[0].uid, s.fx.items[0].uid, 'top-1 必须是与查询同向的那一行');
  assert.ok(res.data.results[0].score > 0.99, '同向向量的余弦应当≈1，实际 ' + res.data.results[0].score);
  assert.equal(res.data.results[0].band, 'high');

  // ③ 详情（走条目端口）
  const detail = await engine.item({ libId: 'L1', uid: s.fx.items[1].uid });
  assert.equal(detail.ok, true, JSON.stringify(detail.error));
  assert.equal(detail.data.uid, s.fx.items[1].uid);
  assert.equal(detail.data.relPath, s.fx.items[1].relPath);

  // ④ 取件：真复制到配置目录，字节一致
  const srcRel = s.fx.items[0].archiveRelPath || s.fx.items[0].relPath;
  const srcAbs = path.join(s.libRoot, ...srcRel.split('\\'));
  const srcSha = (await import('node:crypto')).createHash('sha1').update(fs.readFileSync(srcAbs)).digest('hex');
  const col = await engine.collect({ libId: 'L1', uids: [s.fx.items[0].uid], targetDirName: 'out' });
  assert.equal(col.ok, true, JSON.stringify(col.error));
  assert.equal(col.data.succeeded.length, 1, JSON.stringify(col.data));
  const destAbs = col.data.succeeded[0].path;
  assert.equal(
    (await import('node:crypto')).createHash('sha1').update(fs.readFileSync(destAbs)).digest('hex'),
    srcSha,
    'M0 判据②：取出的字节必须与源一致',
  );
  assert.equal(path.dirname(destAbs), outDir);
});

// ============================================================ M8 端口错误码进信封

test('M8 ⭐⭐ 端口错误进了信封还是**带码的**（不是 INTERNAL）', async () => {
  const s = setupWired('M8');
  const ports = createStoragePorts({
    libraries: createLibraryResolverPort({ libraries: [{ libId: 'L1', root: s.libRoot, label: '测试库' }] }),
  });
  const engine = createEngine({
    config: { data_dir: path.join(s.base, 'data') },
    encoder: fakeEncoder('first'),
    storage: ports,
  });

  // 索引坏掉：单库路径（item）⇒ 直接把端口错误抛进信封
  const indexPath = path.join(s.libRoot, '.gs-index.bin');
  const good = fs.readFileSync(indexPath);
  fs.writeFileSync(indexPath, 'not a gsidx');
  const itemBroken = await engine.item({ libId: 'L1', uid: s.fx.items[0].uid });
  const err1 = envelopeError(itemBroken);
  assert.equal(err1.code, ERR.INDEX_CORRUPT, '索引端口抛的是引擎错误 ⇒ 信封必须保住 INDEX_CORRUPT');
  assert.notEqual(err1.code, 'INTERNAL');
  assert.equal(typeof err1.userMessage, 'string');
  assert.ok(err1.userMessage.length > 0, 'Adapter 契约要求 userMessage 恒非空');
  fs.writeFileSync(indexPath, good);

  // 索引坏 + 多库选择路径（search）⇒ 库被 skip，但 skip 的 reason 里必须带原始 code
  fs.writeFileSync(indexPath, 'not a gsidx');
  const searchBroken = await engine.search({ mode: 'text', text: 'x' });
  const err2 = envelopeError(searchBroken);
  assert.equal(err2.details.skipped[0].reason.code, ERR.INDEX_CORRUPT, 'skipped 的原因里必须保留端口的 code');
  fs.writeFileSync(indexPath, good);

  // .gs.db 坏掉 ⇒ 条目端口抛 INDEX_CORRUPT（不是 INTERNAL）
  const dbPath = path.join(s.libRoot, '.gs.db');
  const fd = fs.openSync(dbPath, 'r+');
  fs.writeSync(fd, Buffer.alloc(16, 0), 0, 16, 0);
  fs.closeSync(fd);
  const itemDbBroken = await engine.item({ libId: 'L1', uid: s.fx.items[0].uid });
  const err3 = envelopeError(itemDbBroken);
  assert.equal(err3.code, ERR.INDEX_CORRUPT);
  assert.notEqual(err3.code, 'INTERNAL');
});

// apps/desktop/tests/library-config.test.mjs —— D2 配置解析的验收测试
//
// 为什么这个测试重要：D2 是「开箱即用」的根因缺陷。
// 主进程原先只读已被删除的 `config.json` ⇒ 库列表恒为空 ⇒ 界面永远 `LIB_NOT_FOUND`。
// 本测试把「库从哪来」的四条优先级逐条钉住，并**特别钉住第 4 条（索引自举）**，
// 因为它才是"本机零配置可用"的来源。
//
// 跑法：`npm test`（仓库根脚本已含本目录）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveLibraries, saveRegistry, loadRegistry, normalizeLibraries,
  discoverLibrariesFromIndex, DEFAULT_COLLECT, registryPath, parseCollectDirsEnv,
} from '../src/main/library-config.mjs';

/** 造一个临时"应用数据目录"，里面按需放 libraries/<id>/meta.json */
function tmpData({ libs = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-libcfg-'));
  for (const l of libs) {
    const d = path.join(dir, 'libraries', l.dirName || l.libId);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(l.meta), 'utf8');
  }
  return dir;
}
function tmpUserData() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gs-userdata-')); }
/** 造一个真实存在的目录当库根（resolveLibraries 只校验存在性） */
function tmpLibRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gs-libroot-')); }

test('① 索引自举：有 meta.json 就能推出库（本机零配置可用的关键）', () => {
  const root = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: root, count: 42 } }] });
  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData() });
  assert.equal(r.chosen, 'index-meta');
  assert.equal(r.libraries.length, 1);
  assert.equal(r.libraries[0].libId, 'L1');
  assert.equal(r.libraries[0].root, path.resolve(root));
  assert.equal(r.libraries[0].source, 'index-meta');
});

test('② 索引里没 meta.json / 没 lib_root / 解析失败 → 都不抛，只是没有库', () => {
  const dataDir = tmpData();
  // 放一个坏 meta 和一个没 lib_root 的 meta
  const bad = path.join(dataDir, 'libraries', 'BAD');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'meta.json'), '{ not json', 'utf8');
  const noRoot = path.join(dataDir, 'libraries', 'NOROOT');
  fs.mkdirSync(noRoot, { recursive: true });
  fs.writeFileSync(path.join(noRoot, 'meta.json'), JSON.stringify({ lib_id: 'NOROOT' }), 'utf8');

  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData() });
  assert.equal(r.libraries.length, 0);
  assert.equal(r.chosen, null);
  assert.ok(r.diagnostics.some((d) => d.includes('未找到任何库')));
  // 坏 meta 的原因要出现在诊断里，不能静默吞掉
  assert.ok(r.diagnostics.some((d) => d.includes('BAD')));
});

test('③ 优先级：环境变量压过一切', () => {
  const envRoot = tmpLibRoot(); const idxRoot = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: idxRoot } }] });
  const userDataDir = tmpUserData();
  saveRegistry(userDataDir, { libraries: [{ libId: 'L9', root: tmpLibRoot() }] });

  const r = resolveLibraries({ dataDir, userDataDir, config: { library_root: tmpLibRoot() }, envLibRoot: envRoot });
  assert.equal(r.chosen, 'env');
  assert.equal(r.libraries[0].root, path.resolve(envRoot));
});

test('④ 优先级：注册表压过 config 与索引自举', () => {
  const regRoot = tmpLibRoot(); const idxRoot = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: idxRoot } }] });
  const userDataDir = tmpUserData();
  saveRegistry(userDataDir, { libraries: [{ libId: 'L7', root: regRoot, label: '我的库' }] });

  const r = resolveLibraries({ dataDir, userDataDir, config: { library_root: tmpLibRoot() } });
  assert.equal(r.chosen, 'registry');
  assert.equal(r.libraries[0].libId, 'L7');
  assert.equal(r.libraries[0].root, path.resolve(regRoot));
  assert.equal(r.libraries[0].label, '我的库');
});

test('⑤ 优先级：config 压过索引自举（无注册表时）', () => {
  const cfgRoot = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: tmpLibRoot() } }] });
  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData(),
    config: { library_root: cfgRoot, lib_id: 'LX' } });
  assert.equal(r.chosen, 'config');
  assert.equal(r.libraries[0].libId, 'LX');
  assert.equal(r.libraries[0].root, path.resolve(cfgRoot));
});

test('⑥ 注册表损坏 → 不抛，退到下一优先级并留下 warning', () => {
  const idxRoot = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: idxRoot } }] });
  const userDataDir = tmpUserData();
  fs.writeFileSync(registryPath(userDataDir), '{ broken', 'utf8');

  const r = resolveLibraries({ dataDir, userDataDir });
  assert.equal(r.chosen, 'index-meta');                      // 成功降级
  assert.ok(r.warnings.some((w) => w.includes('注册表读取失败')));
});

test('⑦ F-04：取件白名单不再为空，且默认值来自规格', () => {
  const dataDir = tmpData();
  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData() });
  // 这是 F-04 的回归断言：原先 collect.dirs 恒为 {} ⇒ 任何 collect 都 COLLECT_DIR_NOT_ALLOWED
  assert.ok(Object.keys(r.collect.dirs).length > 0, '取件白名单不能为空');
  assert.deepEqual(r.collect.dirs, { ...DEFAULT_COLLECT.dirs });
  assert.equal(r.collect.default, '素材待用');
});

test('⑧ 取件白名单：环境变量 > 注册表 > config > 规格兜底', () => {
  const dataDir = tmpData();
  const userDataDir = tmpUserData();
  // config 有值时用它
  let r = resolveLibraries({ dataDir, userDataDir, config: { collect: { dirs: { 甲: 'D:\\甲' }, default: '甲' } } });
  assert.deepEqual(r.collect.dirs, { 甲: 'D:\\甲' });
  // 注册表有值时压过 config
  saveRegistry(userDataDir, { libraries: [], collect: { dirs: { 乙: 'D:\\乙' } } });
  r = resolveLibraries({ dataDir, userDataDir, config: { collect: { dirs: { 甲: 'D:\\甲' } } } });
  assert.deepEqual(r.collect.dirs, { 乙: 'D:\\乙' });
  // ⭐ 环境变量压过注册表与 config（P3 新增的入口）
  r = resolveLibraries({
    dataDir, userDataDir,
    config: { collect: { dirs: { 甲: 'D:\\甲' } } },
    envCollectDirs: '丙=D:\\丙;丁=D:\\丁',
  });
  assert.deepEqual(r.collect.dirs, { 丙: 'D:\\丙', 丁: 'D:\\丁' });
  assert.equal(r.collect.default, '丙', '默认项取第一条');
  assert.ok(r.diagnostics.some((d) => d.includes('GEMMA_COLLECT_DIRS')), '要能看出配置来自哪条路');
});

test('⑧b ⭐ parseCollectDirsEnv 解析不出东西时返回 null，**绝不返回空对象**', () => {
  // 空/垃圾输入一律 null —— 返回 {dirs:{}} 会让任何 collect 都 COLLECT_DIR_NOT_ALLOWED（F-04 复发）
  for (const junk of ['', '   ', null, undefined, 42, {}, '没有等号', '=没有名字', '名字=', ';;;']) {
    assert.equal(parseCollectDirsEnv(junk), null, `${JSON.stringify(junk)} 必须解析成 null`);
  }
  // 正常形态
  assert.deepEqual(parseCollectDirsEnv('A=C:\\a;B=C:\\b'), { dirs: { A: 'C:\\a', B: 'C:\\b' }, default: 'A' });
  // 路径里含 `=` ⇒ 只按**第一个** = 切（否则 Windows 上的怪路径会被切坏）
  assert.deepEqual(parseCollectDirsEnv('A=C:\\x=1=y'), { dirs: { A: 'C:\\x=1=y' }, default: 'A' });
  // 混入坏条目：好的留下，坏的不影响
  assert.deepEqual(parseCollectDirsEnv('A=C:\\a;坏条目;B=C:\\b'), { dirs: { A: 'C:\\a', B: 'C:\\b' }, default: 'A' });
});

test('⑧c ⭐ 垃圾环境变量**不能**把白名单弄空（F-04 回归防线）', () => {
  const dataDir = tmpData();
  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData(), envCollectDirs: '完全不是格式' });
  assert.ok(Object.keys(r.collect.dirs).length > 0, '解析失败必须退到兜底，而不是留一个空白名单');
  assert.deepEqual(r.collect.dirs, { ...DEFAULT_COLLECT.dirs });
  assert.ok(r.diagnostics.some((d) => d.includes('规格兜底')), '要如实说明用的是兜底值');
});

test('⑨ 库根不存在 → 如实报 warning，但仍把库交出去（不在这里判失败）', () => {
  const missing = path.join(os.tmpdir(), 'gs-not-a-real-dir-' + Date.now());
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: missing } }] });
  const r = resolveLibraries({ dataDir, userDataDir: tmpUserData() });
  assert.equal(r.libraries.length, 1);                        // 交出去
  assert.ok(r.warnings.some((w) => w.includes('库根不存在')));  // 但要说清
});

test('⑩ normalizeLibraries：非法条目被丢弃并给出原因，不静默改造', () => {
  const ok = tmpLibRoot();
  const { kept, dropped } = normalizeLibraries([
    { libId: 'L1', root: ok },
    { libId: 'bad id!', root: ok },      // 空格+感叹号
    { libId: 'L2', root: '' },           // 空路径
    { libId: '', root: ok },             // 空 id
    null,
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].libId, 'L1');
  assert.equal(dropped.length, 4);
  assert.ok(dropped.every((d) => typeof d.why === 'string' && d.why.length > 0));
});

test('⑪ meta 目录名与 meta.lib_id 不一致 → 以 meta 为准并说明', () => {
  const root = tmpLibRoot();
  const dataDir = tmpData({ libs: [{ dirName: 'DIRNAME', libId: 'REALID', meta: { lib_id: 'REALID', lib_root: root } }] });
  const { libraries, notes } = discoverLibrariesFromIndex(dataDir);
  assert.equal(libraries[0].libId, 'REALID');
  assert.ok(notes.some((n) => n.includes('不一致')));
});

test('⑫ 解析是纯读：调用 resolveLibraries 不产生任何文件', () => {
  const dataDir = tmpData({ libs: [{ libId: 'L1', meta: { lib_id: 'L1', lib_root: tmpLibRoot() } }] });
  const userDataDir = tmpUserData();
  const before = fs.readdirSync(userDataDir);
  resolveLibraries({ dataDir, userDataDir });
  assert.deepEqual(fs.readdirSync(userDataDir), before, '解析不该往 userData 写任何东西');
  assert.equal(loadRegistry(userDataDir), null, '没写过就不该有注册表');
});

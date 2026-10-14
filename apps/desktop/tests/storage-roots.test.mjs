// apps/desktop/tests/storage-roots.test.mjs —— T-04a 存储落点解析的验收测试
//
// 为什么这些用例重要（每一条都对应一个会**静默**出错的失败模式）：
//   · 库根不可写却继续往里写 ⇒ 失败被推迟到写索引那一刻，用户以为一切正常；
//   · 缺模型却给一个"默认目录" ⇒ 界面显示空结果，看起来像"库里没有"，其实是没模型；
//   · 可写性用 fs.access(W_OK) 判 ⇒ Windows 上 ACL 拒绝的目录**假报可写**（实测见模块文件头）；
//   · 解析过程顺手建目录 / 留探测文件 ⇒ 违反 SPEC §2.1 的库内写入不变式。
//
// 跑法：npm test（仓库根脚本已含本目录）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveModels, resolveStorageRoots, resolveLibraryStorage, probeWritable, describeStorageRoots,
  GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME, MODELS_DIRNAME, MODEL_MARKER_REL,
  MODEL_SEARCH_ORDER, modelSearchOrderText,
} from '../src/main/storage-roots.ts';

/** 期望的搜索顺序（SPEC §2，2026-10-14 所有者授权：显式覆盖优先）。
 *  ⚠️ 所有者看过界面后**可能改回**旧顺序 —— 那时候只需要改 storage-roots.ts 里的
 *     MODEL_SEARCH_ORDER 一行 + 下面这一行期望值，其它用例（都是按"谁赢"写的，不写死次序）不用动。 */
const EXPECTED_ORDER = ['user', 'app', 'userData'];

// 用固定的假路径（不碰真机）；Windows 形态，因为本项目只在 Windows 上跑。
const APP = 'C:\\gs\\app';
const UD = 'C:\\gs\\ud';
const LIB = 'D:\\libs\\L1';

function mkErr(code, p) { const e = new Error(code + ': ' + p); e.code = code; return e; }

/**
 * 内存文件系统：只实现本模块用到的那 5 个能力。
 * denied 里的目录写文件抛 EPERM —— 用来**确定性地**造出"目录在但不可写"，
 * 这在真机上要么需要管理员改 ACL、要么就会污染机器。
 */
function memFs(init) {
  const cfg = init || {};
  const dirs = new Set(cfg.dirs || []);
  const files = new Set(cfg.files || []);
  const denied = new Set(cfg.denied || []);
  const mkdirs = [];
  const writes = [];
  const unlinks = [];
  return {
    dirs, files, denied, mkdirs, writes, unlinks,
    existsSync: (p) => dirs.has(p) || files.has(p),
    isDirectory: (p) => dirs.has(p),
    writeFileSync: (p) => {
      const d = path.dirname(p);
      if (!dirs.has(d)) throw mkErr('ENOENT', p);
      if (denied.has(d)) throw mkErr('EPERM', p);
      files.add(p);
      writes.push(p);
    },
    mkdirSync: (p) => { mkdirs.push(p); dirs.add(p); },
    unlinkSync: (p) => { if (!files.has(p)) throw mkErr('ENOENT', p); files.delete(p); unlinks.push(p); },
  };
}

const modelMarker = (dir) => path.join(dir, MODEL_MARKER_REL);
const probeLeftovers = (f) => [...f.files].filter((p) => p.includes('.gs-write-probe-'));

// ============================================================ ① 模型落点

test('M1 程序目录可写且含模型 ⇒ 命中程序目录，installDir 也是它', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const f = memFs({ dirs: [APP, appModels, UD], files: [modelMarker(appModels)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, fs: f });

  assert.equal(r.found, appModels);
  assert.equal(r.source, 'app');
  assert.equal(r.installDir, appModels, '程序目录可写 ⇒ 建议就放程序目录');
  assert.equal(r.guidance, '', '找到模型时不该给"缺模型"指引');
  assert.equal(r.searched.length, 2, '没给用户指定目录 ⇒ 只有两个候选');
  assert.equal(r.searched[0].valid, true);
  assert.equal(r.searched[0].writable, true);
});

test('M2 程序目录**不可写** ⇒ 改用 userData（落点与 installDir 都跟着走）', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const udModels = path.join(UD, MODELS_DIRNAME);
  const f = memFs({ dirs: [APP, appModels, UD, udModels], denied: [appModels], files: [modelMarker(udModels)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, fs: f });

  assert.equal(r.found, udModels);
  assert.equal(r.source, 'userData');
  assert.equal(r.installDir, udModels, '程序目录不可写 ⇒ 建议放到 userData');
  assert.equal(r.searched[0].writable, false);
  assert.match(r.searched[0].writeReason, /EPERM/, '不可写的原始错误码必须留在理由里');
  assert.equal(r.searched[1].writable, true);
});

test('M3 用户指定目录命中 —— **新顺序里它排第一位**（旧顺序里是最后一位）', () => {
  const userDir = 'E:\\my-models';
  const f = memFs({ dirs: [APP, UD, userDir], files: [modelMarker(userDir)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, userModelDir: userDir, fs: f });

  assert.equal(r.found, userDir);
  assert.equal(r.source, 'user');
  assert.equal(r.searched[0].source, 'user', '用户指定必须**第一个**被找');
  assert.equal(r.searched.length, 3);
  assert.deepEqual(r.searched.map((c) => c.order), [1, 2, 3]);
});

test('M4 三位都没有 ⇒ found=null、指引非空且**列出找过的每条路径**', () => {
  const userDir = 'E:\\my-models';
  const f = memFs({ dirs: [APP, UD] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, userModelDir: userDir, fs: f });

  assert.equal(r.found, null, '找不到就是 null —— 不许编一个默认目录');
  assert.equal(r.installDir, null, '三个目录都不存在 ⇒ 没有可写候选');
  assert.ok(r.guidance.length > 0, '缺模型必须给指引');
  for (const p of [path.join(APP, MODELS_DIRNAME), path.join(UD, MODELS_DIRNAME), userDir]) {
    assert.ok(r.guidance.includes(p), '指引里必须出现找过的路径：' + p);
  }
  assert.match(r.guidance, /不会显示任何检索结果/, '要写明"不显示假结果"');
  // 指引里的顺序串是从常量派生的 ⇒ 顺序一改，文案自动跟着改（不许两处各写一半）
  assert.ok(r.guidance.includes(modelSearchOrderText()), '指引里的顺序必须与常量一致');
  assert.ok(r.guidance.includes('用户指定 → 程序目录 models/ → userData models/'), '缺模型时要说清新的优先级');
});

// ============================================================ ①b 优先级（SPEC §2：显式覆盖优先）

test('M6 ⭐ 用户指定**赢过**程序目录（两边都有模型 ⇒ 用户那份说了算）', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const userDir = 'E:\\my-models';
  const f = memFs({ dirs: [APP, appModels, UD, userDir], files: [modelMarker(appModels), modelMarker(userDir)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, userModelDir: userDir, fs: f });

  assert.equal(r.found, userDir, '显式指定的目录必须压过程序目录自带的那份');
  assert.equal(r.source, 'user');
  assert.equal(r.searched[1].source, 'app');
  assert.equal(r.searched[1].valid, true, '程序目录那份仍然要被找过并记为命中（不是没看见）');
});

test('M7 ⭐ 程序目录**赢过** userData（没给用户指定时）', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const udModels = path.join(UD, MODELS_DIRNAME);
  const f = memFs({ dirs: [APP, appModels, UD, udModels], files: [modelMarker(appModels), modelMarker(udModels)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, fs: f });

  assert.equal(r.found, appModels);
  assert.equal(r.source, 'app');
  assert.deepEqual(r.searched.map((c) => c.source), ['app', 'userData']);
});

test('M8 用户指定目录**存在但里面没有模型** ⇒ 不停下，继续往后找（app 命中）', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const userDir = 'E:\\my-models';
  const f = memFs({ dirs: [APP, appModels, UD, userDir], files: [modelMarker(appModels)] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, userModelDir: userDir, fs: f });

  assert.equal(r.found, appModels, '无效的显式目录不该把后面的候选挡住');
  assert.equal(r.source, 'app');
  assert.equal(r.searched[0].source, 'user');
  assert.equal(r.searched[0].valid, false);
  assert.equal(r.searched[0].dir, userDir);
});

test('M9 ⭐ 顺序**只有一处常量**：候选次序、日志文案、指引文案都从 MODEL_SEARCH_ORDER 派生', () => {
  assert.deepEqual([...MODEL_SEARCH_ORDER], EXPECTED_ORDER, '改顺序只该改 storage-roots.ts 的那一行 + 这里的期望值');
  assert.equal(modelSearchOrderText(), '用户指定 → 程序目录 models/ → userData models/');

  const userDir = 'E:\\my-models';
  const f = memFs({ dirs: [APP, UD, userDir] });
  const r = resolveModels({ appDir: APP, userDataDir: UD, userModelDir: userDir, fs: f });
  assert.deepEqual(r.searched.map((c) => c.source), [...MODEL_SEARCH_ORDER], '实际搜索次序必须等于常量');
});

test('M5 目录存在但没有 onnx/model.onnx ⇒ **不算命中**', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const f = memFs({ dirs: [APP, appModels] });
  const r = resolveModels({ appDir: APP, fs: f });

  assert.equal(r.found, null);
  assert.equal(r.searched.length, 1, '没有 userData / 用户指定 ⇒ 只有一个候选');
  assert.equal(r.searched[0].exists, true);
  assert.equal(r.searched[0].valid, false);
  assert.ok(r.searched[0].reason.includes(MODEL_MARKER_REL));
});

// ============================================================ ②③ 库根落点

test('L1 库根可写 ⇒ 索引 / 元数据 / 事务日志都在库根本身', () => {
  const f = memFs({ dirs: [LIB, UD] });
  const s = resolveLibraryStorage({ libId: 'L1', root: LIB }, { userDataDir: UD, fs: f });

  assert.equal(s.root, LIB);
  assert.equal(s.fallback, false);
  assert.equal(s.writable, true);
  assert.equal(s.index, path.join(LIB, GS_INDEX_NAME));
  assert.equal(s.db, path.join(LIB, GS_DB_NAME));
  assert.equal(s.journal, path.join(LIB, GS_JOURNAL_NAME));
  assert.equal(s.stagingDirName, '.gs-staging');
  assert.match(s.reason, /库根可写/);
  // 名字必须与 SPEC §2 的布局图逐字一致 —— 漂了就是"两处各写一半"
  assert.deepEqual([GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME], ['.gs-index.bin', '.gs.db', '.gs-journal']);
});

test('L2 库根不可写 ⇒ 回退 userData/libraries/<libId>，并说清为什么', () => {
  const f = memFs({ dirs: [LIB, UD], denied: [LIB] });
  const s = resolveLibraryStorage({ libId: 'L1', root: LIB }, { userDataDir: UD, fs: f });
  const fb = path.join(UD, 'libraries', 'L1');

  assert.equal(s.root, fb);
  assert.equal(s.fallback, true);
  assert.equal(s.writable, false, '回退目录还没建出来 ⇒ 现在不可写（如实报）');
  assert.equal(s.index, path.join(fb, '.gs-index.bin'));
  assert.equal(s.db, path.join(fb, '.gs.db'));
  assert.equal(s.journal, path.join(fb, '.gs-journal'));
  assert.match(s.reason, /库根不可写/);
  assert.match(s.reason, /回退 userData/);
  assert.match(s.reason, /EPERM/, '理由里要有原始错误码，否则人看不懂为什么');
  assert.ok(s.reason.includes(fb), '理由里要有回退落点');
});

test('L3 库根不存在（盘符变了 / 盘没挂载）⇒ 同样回退，理由说明"不存在"', () => {
  const f = memFs({ dirs: [UD] });
  const s = resolveLibraryStorage({ libId: 'L2', root: 'Z:\\gone' }, { userDataDir: UD, fs: f });

  assert.equal(s.fallback, true);
  assert.equal(s.root, path.join(UD, 'libraries', 'L2'));
  assert.match(s.reason, /目录不存在/);
});

test('L4 库根是文件（不是目录）⇒ 回退，理由说明"不是目录"', () => {
  const f = memFs({ dirs: [UD], files: [LIB] });
  const s = resolveLibraryStorage({ libId: 'L1', root: LIB }, { userDataDir: UD, fs: f });

  assert.equal(s.fallback, true);
  assert.match(s.reason, /不是目录/);
});

test('L5 库根不可写且没有 userData ⇒ 明确报"没有落点"，不假装有', () => {
  const f = memFs({ dirs: [LIB], denied: [LIB] });
  const s = resolveLibraryStorage({ libId: 'L1', root: LIB }, { userDataDir: null, fs: f });

  assert.equal(s.root, null);
  assert.equal(s.writable, false);
  assert.equal(s.index, null);
  assert.equal(s.db, null);
  assert.equal(s.journal, null);
  assert.match(s.reason, /没有落点/);
});

test('L6 多个库各解析一份落点（一个回退、一个不回退）', () => {
  const L2 = 'D:\\libs\\L2';
  const f = memFs({ dirs: [LIB, L2, UD], denied: [L2] });
  const r = resolveStorageRoots({
    appDir: APP, userDataDir: UD,
    libraries: [{ libId: 'L1', root: LIB }, { libId: 'L2', root: L2 }],
    fs: f,
  });

  assert.equal(r.libraries.length, 2);
  assert.equal(r.libraries[0].fallback, false);
  assert.equal(r.libraries[1].fallback, true);
  assert.equal(r.libraries[1].root, path.join(UD, 'libraries', 'L2'));
});

test('L7 一个库都没有 ⇒ 落点为空并说明原因（不编一个落点出来）', () => {
  const f = memFs({ dirs: [APP, UD] });
  const r = resolveStorageRoots({ appDir: APP, userDataDir: UD, libraries: [], fs: f });

  assert.equal(r.libraries.length, 0);
  assert.ok(r.notes.some((n) => n.includes('没有已解析的库')));
});

// ============================================================ 写探测

test('P1 探测文件写完即删、解析过程**不创建任何目录**', () => {
  const appModels = path.join(APP, MODELS_DIRNAME);
  const f = memFs({ dirs: [APP, appModels, UD, LIB], files: [modelMarker(appModels)] });
  resolveStorageRoots({ appDir: APP, userDataDir: UD, libraries: [{ libId: 'L1', root: LIB }], fs: f });

  assert.deepEqual(probeLeftovers(f), [], '库根 / 模型目录里不许残留探测文件');
  assert.deepEqual(f.mkdirs, [], '解析不该创建目录（启动路径不留副作用）');
  assert.equal(f.writes.length, f.unlinks.length, '每个探测文件都要被删掉');
  assert.ok(f.writes.length >= 2, '库根与模型目录各探测一次');
});

test('P2 probeWrites=false 时只按存在性判断，理由**必须**承认"没探测过"', () => {
  const f = memFs({ dirs: [LIB, UD], denied: [LIB] });
  const s = resolveLibraryStorage({ libId: 'L1', root: LIB }, { userDataDir: UD, fs: f, probeWrites: false });

  assert.equal(s.root, LIB);
  assert.equal(s.fallback, false);
  assert.match(s.reason, /未做写探测/, '没探测过就不许写成"可写"');
  assert.equal(f.writes.length, 0, '关掉探测 ⇒ 一次写都没有');
});

test('P3 probeWritable 用真实文件系统：真目录可写且不留文件，文件路径报 ENOTDIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-probe-'));
  try {
    const p = probeWritable(dir);
    assert.equal(p.writable, true);
    assert.equal(p.code, '');
    assert.deepEqual(fs.readdirSync(dir), [], '探测文件必须被删除');

    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'x', 'utf8');
    const p2 = probeWritable(file);
    assert.equal(p2.writable, false);
    assert.equal(p2.code, 'ENOTDIR');

    const p3 = probeWritable(path.join(dir, 'nope'));
    assert.equal(p3.writable, false);
    assert.equal(p3.code, 'ENOENT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================ 可读性与安全

test('D1 describeStorageRoots 把"落在哪 + 为什么"渲染成可读行（启动日志直接用）', () => {
  const f = memFs({ dirs: [APP, UD, LIB], denied: [LIB] });
  const r = resolveStorageRoots({ appDir: APP, userDataDir: UD, libraries: [{ libId: 'L1', root: LIB }], fs: f });
  const lines = describeStorageRoots(r);
  const text = lines.join('\n');

  assert.ok(text.includes('程序目录 = ' + APP));
  assert.ok(text.includes('userData = ' + UD));
  assert.ok(text.includes('模型搜索顺序'));
  // 顺序串必须与常量一致（顺序一改，日志自动跟着改；这条防的是"日志还印着旧顺序"）
  assert.ok(text.includes('模型搜索顺序 = ' + modelSearchOrderText()), '日志里的顺序必须来自 MODEL_SEARCH_ORDER');
  assert.ok(text.includes('未找到'), '没有模型时必须明说未找到');
  assert.ok(text.includes('库 L1：落点 = ' + path.join(UD, 'libraries', 'L1')));
  assert.ok(text.includes('回退 userData'));
  assert.ok(text.includes('.gs-index.bin'));
  assert.ok(text.includes('.gs-journal'));
  assert.ok(text.includes('.gs-staging'));
  assert.ok(lines.some((l) => l.includes('为什么 = ')), '要有"为什么是这个落点"这一行');
  assert.equal(text.includes('undefined'), false, '可读行里不许出现 undefined');
  for (const l of lines) assert.equal(typeof l, 'string');
});

test('S1 libId 里的路径分隔符被安全化（回退目录不许路径穿越）', () => {
  const f = memFs({ dirs: [UD] });
  const s = resolveLibraryStorage({ libId: '..\\..\\evil', root: 'Z:\\nope' }, { userDataDir: UD, fs: f });

  assert.equal(s.libId, '______evil');
  assert.equal(s.root, path.join(UD, 'libraries', '______evil'));
  assert.equal(s.root.includes('..'), false);
});

// ============================================================ 真实文件系统端到端

test('R1 真文件系统跑一遍：模型在程序目录、库根可写 ⇒ 落点如预期且零残留', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-roots-'));
  try {
    const appDir = path.join(base, 'app');
    const userDataDir = path.join(base, 'userData');
    const libRoot = path.join(base, 'lib');
    for (const d of [appDir, userDataDir, libRoot, path.join(appDir, MODELS_DIRNAME, 'onnx')]) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(path.join(appDir, MODELS_DIRNAME, MODEL_MARKER_REL), '', 'utf8');

    const r = resolveStorageRoots({ appDir, userDataDir, libraries: [{ libId: 'L1', root: libRoot }] });

    assert.equal(r.models.found, path.join(appDir, MODELS_DIRNAME));
    assert.equal(r.models.source, 'app');
    assert.equal(r.libraries[0].root, libRoot);
    assert.equal(r.libraries[0].fallback, false);
    assert.equal(r.libraries[0].index, path.join(libRoot, '.gs-index.bin'));

    const residue = fs.readdirSync(libRoot).filter((n) => n.includes('.gs-write-probe-'));
    assert.deepEqual(residue, [], '库根不许残留探测文件');
    assert.deepEqual(fs.readdirSync(userDataDir), [], 'userData 解析过程零写入');
    assert.deepEqual(fs.readdirSync(appDir).sort(), [MODELS_DIRNAME], '程序目录只该有 models/ —— 解析不建别的东西');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('R2 真文件系统：库根不存在 ⇒ 回退 userData，且**不在库根创建任何东西**', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-roots2-'));
  try {
    const userDataDir = path.join(base, 'userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    const missingLib = path.join(base, 'not-there');

    const r = resolveStorageRoots({ appDir: base, userDataDir, libraries: [{ libId: 'L1', root: missingLib }] });
    const s = r.libraries[0];

    assert.equal(s.fallback, true);
    assert.equal(s.root, path.join(userDataDir, 'libraries', 'L1'));
    assert.equal(fs.existsSync(missingLib), false, '解析不许把库根创建出来');
    assert.equal(fs.existsSync(path.join(userDataDir, 'libraries')), false, '解析不许建回退目录（首次写入时再建）');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

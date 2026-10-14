// apps/desktop/tests/index-location.test.mjs —— T-12a 索引落点 + 原子写入 + 校验后读取的验收测试
//
// 每条用例对应一个**会静默毁数据**的失败模式：
//   L1 落点算错              ⇒ 索引写到库外，拷库带不走，或覆盖到素材
//   L2 只写 .gs-* 的约束松了 ⇒ 一次笔误就能盖掉素材（SPEC §2.1 的写入不变式）
//   L3 原子写入/读回不一致   ⇒ 名字在、内容是半截，读的时候才发现
//   L4 失败后临时文件残留    ⇒ 库根里堆 .gs-index.bin.tmp-*，而且没人知道是不是"正在写"
//   L4a 坏 buffer 盖掉好索引 ⇒ 唯一不可逆的静默毁坏：旧索引没了、新索引是坏的
//   L5 写入碰了素材          ⇒ 除 .gs-* 外一律只读这条不变式被破
//   L6 读取不走五道校验      ⇒ 损坏的索引被当成"能用"，检索静默给空结果
//   L7 空字节/非字节输入     ⇒ 用 0 字节把一份好索引变成必然损坏的文件
//   L8 顺手 mkdir 库根       ⇒ 幽灵库（Lead 裁定 U6）
//
// 跑法：node --test apps/desktop/tests/index-location.test.mjs（也在 npm test 的 glob 里）
// 临时库落在仓库内 data/_t11/index-location-test-<pid>/（AGENTS §3：data/_* 是本机临时物，随时可删）。
// ⚠️ 环境：本会话沙箱把 electron.exe 的写限制在仓库内（G:\model / AppData EPERM），临时库故意用仓库内路径。
// ⚠️ 全量门禁 / npm test 由 Lead 统一跑（TASKS §3.6）。
//
// 夹具说明：**不**自己造 GSIDX 字节（那等于在测试里实现第二份格式），
//   而是拿仓库里真实存在的 data/libraries/L1/index.bin 当"合法索引"夹具；
//   坏夹具用同一份字节的首字节篡改 / 纯文本，不需要知道格式细节。
//   注：packages/indexer/src/build_index_onnx.ts 里有 writeIndexBin，但它是**无导出、顶层就跑 main() 的 CLI**，
//   导入它会真的开始构建索引 —— 所以测试不用它。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readIndexBin } from '../../../packages/engine/src/index.ts';
import {
  GS_INDEX_NAME,
  INDEX_TEMP_PREFIX,
  IndexFileError,
  assertWritableGsPath,
  indexPathFor,
  isGsWriteName,
  readIndexFile,
  writeIndexAtomically,
} from '../src/main/index-file.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t11', 'index-location-test-' + process.pid);
const REAL_INDEX = path.join(ROOT, 'data', 'libraries', 'L1', 'index.bin');

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

/** 建一个"库根"：真的放几个素材文件（写入测试要能证明它们一个字都没变） */
function makeLib(label, files = { 'CR/a.jpg': 'AAA', 'CR/a.rar': 'BBB', 'VR/b.jpg': 'CCC' }) {
  const dir = freshDir(label);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

/** 真实的合法索引字节；本机没有就跳过（并写明原因） */
let cachedReal = null;
function realIndexBytes(t) {
  if (cachedReal) return cachedReal;
  if (!fs.existsSync(REAL_INDEX)) {
    t.skip('本机没有 ' + REAL_INDEX + '（真实库未就位）—— 这条往返断言无法执行');
    return null;
  }
  cachedReal = fs.readFileSync(REAL_INDEX);
  return cachedReal;
}

function mkErr(code, p) {
  const e = new Error(code + ': ' + p);
  e.code = code;
  return e;
}
const throwsCode = (code) => (e) => e instanceof IndexFileError && e.code === code;

/** 递归列出目录里所有条目（相对路径，正斜杠） */
function allFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(p, base, out);
    else out.push({ rel: path.relative(base, p).split(path.sep).join('/'), path: p });
  }
  return out;
}

/**
 * 素材快照：**排除 .gs-*** 的全部条目（相对路径 + 内容 sha1 + mtimeMs + size）。
 * 内容 + mtime 都要比 —— 只看内容会漏掉"被重写了一遍但内容相同"（那也是动过素材）。
 */
function materialSnapshot(dir) {
  const out = {};
  for (const f of allFiles(dir)) {
    if (path.basename(f.rel).startsWith('.gs-')) continue;
    const st = fs.statSync(f.path);
    out[f.rel] = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      sha1: crypto.createHash('sha1').update(fs.readFileSync(f.path)).digest('hex'),
    };
  }
  return out;
}

/** 库根里残留的临时索引（不该有） */
function tempLeftovers(dir) {
  return fs.readdirSync(dir).filter((n) => n.startsWith(INDEX_TEMP_PREFIX));
}

/** 只实现了本模块用到的那 5 个能力的假 fs（用来造真机上不好复现的失败分支） */
function fakeFs(over = {}) {
  const calls = { write: [], rename: [], unlink: [] };
  return Object.assign(
    {
      calls,
      existsSync: () => true,
      sizeOfSync: () => 0,
      writeFileSyncedSync: (p, d) => {
        calls.write.push({ p, bytes: d.length });
      },
      renameSync: (a, b) => {
        calls.rename.push([a, b]);
      },
      unlinkSync: (p) => {
        calls.unlink.push(p);
      },
    },
    over,
  );
}

// ============================================================ L1 落点

test('L1 indexPathFor：<库根>/.gs-index.bin；空库根 ⇒ INDEX_ROOT_REQUIRED', () => {
  const dir = makeLib('L1');
  assert.equal(indexPathFor(dir), path.join(dir, '.gs-index.bin'));
  assert.equal(path.basename(indexPathFor(dir)), GS_INDEX_NAME, '文件名必须来自 GS_INDEX_NAME（单一来源）');
  assert.equal(indexPathFor('X:/lib'), path.join(path.resolve('X:/lib'), '.gs-index.bin'), '相对/斜杠形态都要 resolve');
  assert.equal(indexPathFor(dir + path.sep), path.join(dir, '.gs-index.bin'), '结尾分隔符不影响结果');
  assert.throws(() => indexPathFor('   '), throwsCode('INDEX_ROOT_REQUIRED'));
  assert.throws(() => indexPathFor(undefined), throwsCode('INDEX_ROOT_REQUIRED'));
  // 临时名前缀本身也必须落在 .gs- 命名空间里（扫描器会跳过）
  assert.ok(INDEX_TEMP_PREFIX.startsWith('.gs-'));
  assert.ok(isGsWriteName(INDEX_TEMP_PREFIX + '1234-1'));
});

// ============================================================ L2 只写 .gs-*

test('L2 ⭐ 命名约束：只允许库根的**直接子项**且名字是 .gs-*（素材路径一律拒）', () => {
  const dir = makeLib('L2');
  for (const name of ['.gs-index.bin', '.gs-index.bin.tmp-123-1', '.gs-write-probe-1-1', '.gs-db']) {
    assert.equal(assertWritableGsPath(dir, path.join(dir, name)), path.join(dir, name), name + ' 应放行');
    assert.equal(isGsWriteName(name), true);
  }
  const bad = [
    'CR/a.jpg', // 素材
    'a.jpg', // 库根下的普通文件
    'index.bin', // 少了点前缀
    '.gitignore', // 点前缀但不是 .gs-
    '.gs-', // 只有前缀，没有名字
    path.join('CR', '.gs-x'), // 子目录里的 .gs- 也不许（只允许直接子项）
    path.join('..', '.gs-outside'), // 路径穿越
    'CR', // 目录
  ];
  for (const rel of bad) {
    assert.throws(
      () => assertWritableGsPath(dir, path.join(dir, rel)),
      throwsCode('INDEX_PATH_OUTSIDE_GS'),
      JSON.stringify(rel) + ' 必须被拒',
    );
  }
  // 反例锚：判据不能"什么都拒"
  assert.equal(isGsWriteName('.gs-ok'), true);
  assert.equal(isGsWriteName(path.join('CR', '.gs-ok')), false, '带分隔符的名字不算 .gs-* 名字');
});

// ============================================================ L3 正常往返

test('L3 ⭐ 原子写入 + 读回：真实索引字节往返，count/dim/header 与引擎直接读原文件一致', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const dir = makeLib('L3');
  const materialsBefore = materialSnapshot(dir);

  const w = writeIndexAtomically(dir, bytes, { seq: 1 });
  assert.equal(w.path, indexPathFor(dir));
  assert.ok(w.tempPath.startsWith(path.join(dir, INDEX_TEMP_PREFIX)), '临时名必须是库根内的 ' + INDEX_TEMP_PREFIX + '<pid>-<seq>');
  assert.equal(w.bytes, bytes.length);
  assert.equal(w.validated, true, '默认要先过五道校验再 rename');
  assert.equal(w.count, 3594);
  assert.equal(w.dim, 768);
  assert.match(w.reason, /已原子写入/);
  assert.equal(fs.readFileSync(w.path).length, bytes.length, '目标文件字节数必须与输入一致');
  assert.deepEqual(tempLeftovers(dir), [], 'rename 之后不该有临时文件残留');

  const r = readIndexFile(dir);
  assert.equal(r.path, w.path);
  assert.equal(r.count, 3594);
  assert.equal(r.dim, 768);
  assert.equal(r.bytes, bytes.length);
  assert.deepEqual(r.header, readIndexBin(REAL_INDEX).header, '读回的 header 必须与引擎直接读原文件一致');

  // 覆盖写一次（同一条路径再写一遍）：仍然只有一份文件、没有残留
  const w2 = writeIndexAtomically(dir, bytes, { seq: 2 });
  assert.equal(fs.readFileSync(w2.path).length, bytes.length);
  assert.deepEqual(tempLeftovers(dir), []);
  assert.deepEqual(materialSnapshot(dir), materialsBefore, '素材必须一个字都没变');
});

// ============================================================ L4 失败 ⇒ 清理临时文件

test('L4a ⭐ 坏 buffer 不许覆盖好索引：校验不过 ⇒ 报错 + 清理临时文件 + 旧索引原样', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const dir = makeLib('L4a');
  writeIndexAtomically(dir, bytes, { seq: 1 });
  const goodDigest = crypto.createHash('sha1').update(fs.readFileSync(indexPathFor(dir))).digest('hex');

  let err = null;
  try {
    writeIndexAtomically(dir, Buffer.from('this is not a gsidx file at all'), { seq: 2 });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof IndexFileError);
  assert.equal(err.code, 'INDEX_WRITE_FAILED');
  assert.match(err.message, /放弃覆盖原索引/, '理由里必须写清"没有覆盖"');
  assert.match(err.message, /已清理临时文件/, '理由里必须留痕：临时文件已清理');
  assert.deepEqual(tempLeftovers(dir), [], '失败后不许留下 .gs-index.bin.tmp-*');
  assert.equal(
    crypto.createHash('sha1').update(fs.readFileSync(indexPathFor(dir))).digest('hex'),
    goodDigest,
    '旧索引必须原样保留',
  );
  assert.equal(readIndexFile(dir).count, 3594);
});

test('L4b ⭐ rename 失败（目标被目录占着）⇒ 报错 + 清理临时文件 + 不动那个目录', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const dir = makeLib('L4b');
  // 用"目标路径上放一个目录"造出真实 fs 上的确定性 rename 失败（Windows 实测 EPERM）
  fs.mkdirSync(indexPathFor(dir));

  let err = null;
  try {
    writeIndexAtomically(dir, bytes, { seq: 1 });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof IndexFileError, 'rename 失败必须抛 IndexFileError');
  assert.equal(err.code, 'INDEX_WRITE_FAILED');
  assert.match(err.message, /rename 覆盖失败/);
  assert.match(err.message, /已清理临时文件/);
  assert.deepEqual(tempLeftovers(dir), []);
  assert.equal(fs.statSync(indexPathFor(dir)).isDirectory(), true, '失败路径不许动目标');
});

test('L4c：连临时文件都删不掉 ⇒ 理由里必须留痕（不许静默留着）', () => {
  const dir = makeLib('L4c');
  const fsImpl = fakeFs({
    unlinkSync: (p) => {
      throw mkErr('EPERM', p);
    },
  });
  let err = null;
  try {
    writeIndexAtomically(dir, Buffer.from('junk'), {
      fs: fsImpl,
      validate: () => {
        throw new Error('夹具：故意让五道校验失败');
      },
      seq: 7,
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof IndexFileError);
  assert.equal(err.code, 'INDEX_WRITE_FAILED');
  assert.match(err.message, /临时文件未能删除/, '删不掉必须写出来，否则库里会莫名多一个文件而无人知道来源');
  assert.equal(fsImpl.calls.write.length, 1);
  assert.ok(fsImpl.calls.write[0].p.includes(INDEX_TEMP_PREFIX), '只写临时名，绝不直接写目标名');
  assert.deepEqual(fsImpl.calls.rename, [], '校验失败时不许 rename');
});

// ============================================================ L5 素材零写入

test('L5 ⭐ 写入只碰 .gs-*：素材的数量/内容/mtime 一个字都不许变', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const dir = makeLib('L5', { 'CR/a.jpg': 'AAA', 'CR/a.rar': 'BBB', 'VR/b.jpg': 'CCC', 'VR/x/y.png': 'DDD' });
  const before = materialSnapshot(dir);
  const namesBefore = new Set(allFiles(dir).map((f) => f.rel));

  writeIndexAtomically(dir, bytes, { seq: 1 });
  assert.throws(() => writeIndexAtomically(dir, Buffer.from('junk'), { seq: 2 }), throwsCode('INDEX_WRITE_FAILED'));

  assert.deepEqual(materialSnapshot(dir), before, '素材的相对路径集合、内容与 mtime 都必须完全不变');
  const added = allFiles(dir)
    .map((f) => f.rel)
    .filter((rel) => !namesBefore.has(rel));
  for (const rel of added) {
    assert.equal(
      isGsWriteName(path.basename(rel)),
      true,
      '新增的 ' + rel + ' 不是 .gs-* 名字 ⇒ 越界写入（SPEC §2.1）',
    );
  }
  assert.deepEqual(added, ['.gs-index.bin'], '本任务只该新增索引文件本身');
});

// ============================================================ L6 读取：五道校验归引擎

test('L6 readIndexFile：不存在 ⇒ 引擎 INDEX_MISSING；损坏 ⇒ 引擎 INDEX_CORRUPT（原样透传，不包一层）', () => {
  const dir = makeLib('L6');
  assert.throws(() => readIndexFile(dir), (e) => e && e.code === 'INDEX_MISSING');
  fs.writeFileSync(indexPathFor(dir), 'not a gsidx file', 'utf8');
  assert.throws(() => readIndexFile(dir), (e) => e && e.code === 'INDEX_CORRUPT');
  // 截断到 8 字节（比 MAGIC+headerLen 还短）同样是 INDEX_CORRUPT，不许"当空索引放过"
  fs.writeFileSync(indexPathFor(dir), Buffer.from('4753494458000001', 'hex'));
  assert.throws(() => readIndexFile(dir), (e) => e && e.code === 'INDEX_CORRUPT');
});

// ============================================================ L7 拒绝非法字节

test('L7 ⭐ 拒绝 0 字节与非 Uint8Array：不许用"空索引"盖掉好索引', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const dir = makeLib('L7');
  writeIndexAtomically(dir, bytes, { seq: 1 });
  const digest = crypto.createHash('sha1').update(fs.readFileSync(indexPathFor(dir))).digest('hex');

  assert.throws(() => writeIndexAtomically(dir, new Uint8Array(0)), throwsCode('INDEX_BYTES_REQUIRED'));
  assert.throws(() => writeIndexAtomically(dir, 'not bytes'), throwsCode('INDEX_BYTES_REQUIRED'));
  assert.throws(() => writeIndexAtomically(dir, null), throwsCode('INDEX_BYTES_REQUIRED'));

  assert.deepEqual(tempLeftovers(dir), []);
  assert.equal(
    crypto.createHash('sha1').update(fs.readFileSync(indexPathFor(dir))).digest('hex'),
    digest,
    '被拒的写入不许碰到目标文件',
  );
});

// ============================================================ L8 不建库根（U6）

test('L8 ⭐ 库根不存在 ⇒ 报错，不顺手创建（U6：静默建空库根 = 幽灵库）', () => {
  const missing = path.join(TMP, 'L8-parent', 'lib');
  let err = null;
  try {
    writeIndexAtomically(missing, Buffer.from('x'));
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof IndexFileError);
  assert.equal(err.code, 'INDEX_WRITE_FAILED');
  assert.match(err.message, /已清理临时文件|临时文件未能删除/);
  assert.equal(fs.existsSync(missing), false, '不许创建库根');
  assert.equal(fs.existsSync(path.dirname(missing)), false, '连父目录也不许顺手创建');
});

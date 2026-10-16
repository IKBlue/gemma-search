// apps/desktop/tests/index-corruption.test.mjs —— T-12b 索引五道校验**逐道破坏实测**
//
// 为什么每条都要"破坏前正常 + 破坏后报错"两条输出：
//   只报"破坏后报错了"说服力不够 —— 万一那个文件本来就打不开（路径写错、副本没写成），
//   断言照样绿，而五道校验一道都没验过。所以每道都先证明**同一份副本在破坏前读得通**（count=3594），
//   再证明破坏后报的是 INDEX_CORRUPT，并且 message 指向**那一道**（不是碰巧被别的一道拦下）。
//
// 为什么夹具要"知道布局"：要精准地只破坏一道，就必须按 SPEC §2.2 公布的布局改字节。
//   ⚠️ 但**判定全部由引擎做**：本文件不实现任何校验逻辑，只写字节 + 调产品路径 readIndexFile。
//      （readIndexFile → 引擎的 readIndexBin；全仓只有这一份 GSIDX 解析，AGENTS P1）
//
// 原件保护：所有破坏都发生在 data/_t12 下的**副本**上；after() 会重新哈希 data/libraries/L1/index.bin
//   并与本文件加载时的哈希比对 ⇒ 原件被动过就会红。
//
// 跑法：node --test apps/desktop/tests/index-corruption.test.mjs（也在 npm test 的 glob 里）
// ⚠️ 全量门禁 / npm test 由 Lead 统一跑（TASKS §3.6）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readIndexBin } from '../../../packages/engine/src/index.ts';
import { readIndexFile } from '../src/main/index-file.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t12', 'index-corruption-' + process.pid);
const REAL = path.join(ROOT, 'data', 'libraries', 'L1', 'index.bin');
const INDEX_NAME = '.gs-index.bin';
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** 原件指纹（加载时算一次）；after() 用它证明"没动原件" */
const ORIGINAL_SHA1 = fs.existsSync(REAL) ? sha1(fs.readFileSync(REAL)) : null;

let cached = null;
function realIndexBytes(t) {
  if (cached) return cached;
  if (ORIGINAL_SHA1 === null) {
    t.skip('本机没有 ' + REAL + '（真实库未就位）—— 这五道破坏实测无法执行');
    return null;
  }
  cached = fs.readFileSync(REAL);
  return cached;
}

let seq = 0;
/** 每个用例一个独立目录 + 一份副本（破坏只发生在副本上） */
function fixtureDir(label, bytes) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, INDEX_NAME), bytes);
  return dir;
}

/**
 * 按 SPEC §2.2 的布局取偏移。**只用于造夹具**（要精准破坏某一道就必须知道偏移），
 * 它不做任何校验判定 —— 判定归引擎。
 */
function layoutOf(buf) {
  const magicLen = 8;
  const headerLen = buf.readUInt32LE(magicLen);
  const headerStart = magicLen + 4;
  const header = JSON.parse(buf.subarray(headerStart, headerStart + headerLen).toString('utf8'));
  const blockBytes = header.count * header.dim * 4;
  const footLenOff = headerStart + headerLen + blockBytes;
  const footLen = buf.readUInt32LE(footLenOff);
  const footStart = footLenOff + 4;
  const footText = buf.subarray(footStart, footStart + footLen).toString('utf8');
  return { headerLen, headerStart, header, blockBytes, footLenOff, footLen, footStart, footText };
}

/** 等长替换 footer 里的一个数字（不等长会把第 4 道变成"footer 解析失败"，夹具就不成立了） */
function bumpFooterNumber(out, layout, key, delta) {
  // ⚠️ LINT-1（2026-10-16）：这里原来写的是 '"…"\s*:\s*(\d+)' —— 在**字符串字面量**里
  //    '\s' 的反斜杠会被 JS 吃掉（未知转义 ⇒ 只剩 's'）⇒ 实际正则是 "key"s*:s*(\d+)，
  //    **只有在 footer 恰好没有空白时才碰巧匹配**。改成 '\\s*' 才是真正的「容忍空白」，
  //    与这条注释的原意一致（「等长替换 footer 里的一个数字」）。这不是等价改写，是修一个潜在错正则。
  const m = new RegExp('"' + key + '"\\s*:\\s*(\\d+)').exec(layout.footText);
  assert.ok(m, '夹具前提：footer 里必须有 "' + key + '":<数字>');
  const bumped = String(Number(m[1]) + delta);
  assert.equal(
    bumped.length,
    m[1].length,
    '夹具前提：' + key + ' 加 ' + String(delta) + ' 后位数不能变',
  );
  const replaced =
    layout.footText.slice(0, m.index) +
    m[0].replace(m[1], bumped) +
    layout.footText.slice(m.index + m[0].length);
  assert.equal(replaced.length, layout.footText.length);
  out.write(replaced, layout.footStart, 'utf8');
  return out;
}

function mutate(bytes, kind, layout) {
  const out = Buffer.from(bytes);
  if (kind === 'magic') {
    out[0] = out[0] ^ 0xff; // 第 1 道：MAGIC 少一位/错一位
    return out;
  }
  if (kind === 'footer-json') {
    out.write('{{{{', layout.footStart, 'utf8'); // 第 2 道：footer 不再是合法 JSON（长度不变）
    return out;
  }
  if (kind === 'not-complete') {
    const m = /"complete"\s*:\s*true/.exec(layout.footText); // 第 3 道：true → null（等长、仍是合法 JSON）
    assert.ok(m, '夹具前提：footer 里必须有 "complete":true');
    const replaced =
      layout.footText.slice(0, m.index) +
      m[0].replace('true', 'null') +
      layout.footText.slice(m.index + m[0].length);
    assert.equal(replaced.length, layout.footText.length, '替换必须等长');
    out.write(replaced, layout.footStart, 'utf8');
    return out;
  }
  if (kind === 'footer-count') return bumpFooterNumber(out, layout, 'count', 1); // 第 4 道（count）
  if (kind === 'footer-dim') return bumpFooterNumber(out, layout, 'dim', 1); // 第 4 道（dim）
  if (kind === 'vector-byte') {
    out[layout.footLenOff - 1] = out[layout.footLenOff - 1] ^ 0xff; // 第 5 道：向量块内容变了、长度没变
    return out;
  }
  throw new Error('unknown mutation kind: ' + kind);
}

/** 破坏前：必须读得通（否则"破坏后报错"什么也证明不了）—— 也用 diagnostic 打出来当原始证据 */
function expectReadable(dir, t, label) {
  const r = readIndexFile(dir);
  assert.equal(r.count, 3594);
  assert.equal(r.dim, 768);
  t.diagnostic(
    label +
      ' 破坏前：count=' +
      String(r.count) +
      ' · dim=' +
      String(r.dim) +
      ' · bytes=' +
      String(r.bytes) +
      ' ⇒ 读取成功（同一份副本，只差下面那一处破坏）',
  );
  return r;
}

/** 破坏后：必须是 INDEX_CORRUPT，且 message 指向**那一道** */
function expectCorrupt(dir, pattern, t, label) {
  let err = null;
  try {
    readIndexFile(dir);
  } catch (e) {
    err = e;
  }
  assert.ok(err, label + '：破坏后必须抛错（静默返回半可信数据是最危险的失败模式）');
  t.diagnostic(
    label + ' 破坏后：name=' + err.name + ' · code=' + err.code + ' · message=' + err.message,
  );
  assert.equal(err.code, 'INDEX_CORRUPT', label + ' 必须报索引损坏，而不是别的错');
  assert.match(err.message, pattern, label + ' 的报错必须指向这一道');
  return err;
}

after(() => {
  if (ORIGINAL_SHA1 !== null) {
    assert.equal(
      sha1(fs.readFileSync(REAL)),
      ORIGINAL_SHA1,
      'data/libraries/L1/index.bin 原件被改动了 —— 本文件只许在副本上破坏',
    );
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ============================================================ D0 控制组

test('D0 ⭐ 控制组：副本本身可读（破坏前的基线），且原件指纹未变', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);
  assert.equal(bytes.length, 11042105, '真实索引字节数');
  assert.equal(layout.header.count, 3594);
  assert.equal(layout.header.dim, 768);
  const dir = fixtureDir('D0', bytes);
  const r = expectReadable(dir, t, 'D0');
  t.diagnostic(
    'D0 破坏前：count=' +
      String(r.count) +
      ' · dim=' +
      String(r.dim) +
      ' · bytes=' +
      String(r.bytes) +
      ' · headerLen=' +
      String(layout.headerLen) +
      ' · blockBytes=' +
      String(layout.blockBytes) +
      ' · footer=' +
      layout.footText,
  );
  assert.equal(
    sha1(fs.readFileSync(path.join(dir, INDEX_NAME))),
    ORIGINAL_SHA1,
    '副本必须与原件逐字节相同',
  );
  const engine = readIndexBin(REAL);
  assert.equal(engine.count, r.count);
  assert.equal(engine.dim, r.dim);
});

// ============================================================ D1–D5 五道

test('D1 ⭐ 第 1 道 MAGIC：改 1 个字节 ⇒ INDEX_CORRUPT（MAGIC 不符）', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);
  const dir = fixtureDir('D1', bytes);
  expectReadable(dir, t, 'D1');
  fs.writeFileSync(path.join(dir, INDEX_NAME), mutate(bytes, 'magic', layout));
  expectCorrupt(dir, /MAGIC 不符/, t, 'D1');
});

test('D2 ⭐ 第 2 道 footer 解析：footer 前缀改成非法 JSON ⇒ INDEX_CORRUPT（footer 解析失败）', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);
  const dir = fixtureDir('D2', bytes);
  expectReadable(dir, t, 'D2');
  fs.writeFileSync(path.join(dir, INDEX_NAME), mutate(bytes, 'footer-json', layout));
  expectCorrupt(dir, /footer 解析失败/, t, 'D2');
});

test('D3 ⭐ 第 3 道 complete：置成非 true（等长、仍是合法 JSON）⇒ INDEX_CORRUPT（视为写入未完成）', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);
  const dir = fixtureDir('D3', bytes);
  expectReadable(dir, t, 'D3');
  fs.writeFileSync(path.join(dir, INDEX_NAME), mutate(bytes, 'not-complete', layout));
  expectCorrupt(dir, /complete 不是 true|写入未完成/, t, 'D3');
});

test('D4 ⭐ 第 4 道 footer↔header 不一致：只改 footer 的 count / dim ⇒ INDEX_CORRUPT（不一致）', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);

  const dirCount = fixtureDir('D4-count', bytes);
  expectReadable(dirCount, t, 'D4-count');
  fs.writeFileSync(path.join(dirCount, INDEX_NAME), mutate(bytes, 'footer-count', layout));
  expectCorrupt(dirCount, /footer 与 header 不一致/, t, 'D4-count');

  const dirDim = fixtureDir('D4-dim', bytes);
  expectReadable(dirDim, t, 'D4-dim');
  fs.writeFileSync(path.join(dirDim, INDEX_NAME), mutate(bytes, 'footer-dim', layout));
  expectCorrupt(dirDim, /footer 与 header 不一致/, t, 'D4-dim');
});

test('D5 ⭐ 第 5 道 sha1：向量块里翻 1 个 bit（长度不变）⇒ INDEX_CORRUPT（sha1 不符）', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);
  const dir = fixtureDir('D5', bytes);
  expectReadable(dir, t, 'D5');
  fs.writeFileSync(path.join(dir, INDEX_NAME), mutate(bytes, 'vector-byte', layout));
  expectCorrupt(dir, /sha1 不符/, t, 'D5');
});

// ============================================================ D6（附）长度自洽的两道

test('D6 ⭐（附）长度自洽：文件太短 / headerLen 超出文件 / 向量块超出文件 也都是 INDEX_CORRUPT', (t) => {
  const bytes = realIndexBytes(t);
  if (!bytes) return;
  const layout = layoutOf(bytes);

  const dirShort = fixtureDir('D6-short', bytes.subarray(0, 10));
  expectCorrupt(dirShort, /文件太短/, t, 'D6-short');

  const hugeHeader = Buffer.from(bytes);
  hugeHeader.writeUInt32LE(0xffffff, 8);
  const dirHeader = fixtureDir('D6-headerLen', hugeHeader);
  expectCorrupt(dirHeader, /headerLen 超出文件/, t, 'D6-headerLen');

  const dirBlock = fixtureDir(
    'D6-block',
    bytes.subarray(0, layout.footLenOff - Math.floor(layout.blockBytes / 2)),
  );
  expectCorrupt(dirBlock, /向量块超出文件/, t, 'D6-block');

  // 反例锚：同一份 layout 下**没有**破坏的副本仍然读得通（否则上面三条可能"怎么都报错"）
  const dirGood = fixtureDir('D6-good', bytes);
  assert.equal(readIndexFile(dirGood).count, 3594);
});

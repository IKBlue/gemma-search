// apps/desktop/tests/thumb-cache.test.mjs —— thumb:// 的缓存与失败状态码（T-18）
//
// 为什么这些用例重要（每条对应一个会**静默**出错的方向）：
//   · 缓存写失败却让请求跟着失败 ⇒ 用户要的是图，却因为"记不住缓存"拿不到；
//   · 0 字节缓存被当成命中 ⇒ 界面拿到空图，而且**永远不会再重算**；
//   · 安全拒绝（PATH_ESCAPES_LIB / SYMLINK_REJECTED）与**我们自己的异常**被伪装成 404
//     ⇒ 用户以为"这张图不存在"，真实原因却可能是代码坏了（改动前 index.ts 就是这个行为）；
//   · 自己再写一份尺寸白名单 ⇒ 迟早与 thumb-url.ts 漂移（P1）。
//
// 跑法：npm test（仓库根脚本已含本目录）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  THUMB_CACHE_DIRNAME, THUMB_CACHE_EXT, thumbCachePath, readCachedThumb, writeCachedThumb, thumbServeStatus,
} from '../src/main/thumb-cache.ts';
import { parseThumbUrl, ALLOWED_SIZE } from '../src/main/thumb-url.ts';

const UID = 'aaa111aaa111';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-thumb-'));

// ============================================================ 缓存：路径与读写

test('C1 缓存路径只有一处实现：<dataDir>/thumbs/<libId>/<uid>@<size>.jpg', () => {
  const p = thumbCachePath({ dataDir: 'C:\\appdata', libId: 'L1', uid: UID, size: 256 });
  assert.equal(p, path.join('C:\\appdata', THUMB_CACHE_DIRNAME, 'L1', UID + '@256' + THUMB_CACHE_EXT));
  assert.equal(THUMB_CACHE_DIRNAME, 'thumbs');
  assert.equal(THUMB_CACHE_EXT, '.jpg');
  // 缓存必须在**数据目录**下（派生数据），不能落在素材库里
  assert.ok(p.startsWith(path.join('C:\\appdata', 'thumbs')));
});

test('C2 没有缓存 ⇒ hit=false 且理由写明"未命中"（**不抛**）', () => {
  const dir = tmp();
  try {
    const r = readCachedThumb(path.join(dir, 'nope.jpg'));
    assert.equal(r.hit, false);
    assert.equal(r.bytes, null);
    assert.match(r.reason, /未命中/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C3 真有缓存 ⇒ hit=true，字节逐位一致', () => {
  const dir = tmp();
  try {
    const p = path.join(dir, 'x.jpg');
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    fs.writeFileSync(p, payload);
    const r = readCachedThumb(p);
    assert.equal(r.hit, true);
    assert.deepEqual(r.bytes, payload);
    assert.match(r.reason, /命中/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C4 ⭐ 0 字节缓存算**未命中**（否则界面拿到空图，且永远不再重算）', () => {
  const dir = tmp();
  try {
    const p = path.join(dir, 'empty.jpg');
    fs.writeFileSync(p, '');
    const r = readCachedThumb(p);
    assert.equal(r.hit, false, '0 字节不是一张图');
    assert.match(r.reason, /0 字节/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C5 写缓存：目录不存在也会自己建出来（递归）', () => {
  const dir = tmp();
  try {
    const p = thumbCachePath({ dataDir: dir, libId: 'L1', uid: UID, size: 128 });
    const w = writeCachedThumb(p, Buffer.from('jpg'));
    assert.equal(w.ok, true);
    assert.equal(w.error, null);
    assert.equal(w.path, p);
    assert.equal(fs.readFileSync(p, 'utf8'), 'jpg');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C6 写不进去（拿文件当目录）⇒ ok=false + error 非空，**不抛**', () => {
  const dir = tmp();
  try {
    const asFile = path.join(dir, 'not-a-dir');
    fs.writeFileSync(asFile, 'x');
    const w = writeCachedThumb(path.join(asFile, 'sub', 'a.jpg'), Buffer.from('jpg'));
    assert.equal(w.ok, false, '缓存失败不该让请求失败 —— 但必须能看出来');
    assert.ok(w.error && w.error.length > 0, '失败原因要能进日志');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ============================================================ 失败 → 状态码：逐行钉住

const OK_BASE = { shapeOk: true, libId: 'L1', engineReady: true };

test('T1 形状/尺寸不合法 ⇒ 400（与"库在不在"无关）', () => {
  assert.equal(thumbServeStatus({ shapeOk: false, libId: '' }).status, 400);
  // 与白名单的**真实集成**：@999 在 parseThumbUrl 那层就被拒 ⇒ 走到这里必然是 400
  const parsed = parseThumbUrl('thumb://L1/' + UID + '@999');
  assert.equal(parsed.ok, false);
  assert.equal(thumbServeStatus({ shapeOk: parsed.ok, libId: '' }).status, 400);
});

test('T2 形状合法但库 id 还原不出来 ⇒ 404', () => {
  const d = thumbServeStatus({ shapeOk: true, libId: '', engineReady: true });
  assert.equal(d.status, 404);
  assert.match(d.reason, /库 id/);
});

test('T3 引擎未就绪 ⇒ 503（"暂时不能"不是"没有"）', () => {
  const d = thumbServeStatus({ shapeOk: true, libId: 'L1', engineReady: false });
  assert.equal(d.status, 503);
  assert.equal(d.internal, false);
});

test('T4 UID_NOT_FOUND / LIB_NOT_FOUND ⇒ 404（素材/库确实不在）', () => {
  for (const code of ['UID_NOT_FOUND', 'LIB_NOT_FOUND']) {
    const d = thumbServeStatus({ ...OK_BASE, resolveCode: code });
    assert.equal(d.status, 404, code + ' 应当 404');
    assert.equal(d.internal, false);
  }
});

test('T5 ⭐ PATH_ESCAPES_LIB / SYMLINK_REJECTED ⇒ **403**（安全拒绝不是"不存在"）', () => {
  for (const code of ['PATH_ESCAPES_LIB', 'SYMLINK_REJECTED']) {
    const d = thumbServeStatus({ ...OK_BASE, resolveCode: code });
    assert.equal(d.status, 403, code + ' 应当 403（改动前会被当成 404）');
    assert.equal(d.internal, false);
    assert.match(d.reason, /安全拒绝/);
  }
});

test('T6 ⭐⭐ 未知/内部错误码 ⇒ **500 且 internal=true**（不许伪装成 404）', () => {
  for (const code of ['INTERNAL', 'TYPE_ERROR', 'SOMETHING_NEW', 'UNKNOWN']) {
    const d = thumbServeStatus({ ...OK_BASE, resolveCode: code });
    assert.equal(d.status, 500, code + ' 是我们的问题，就该如实说 500');
    assert.notEqual(d.status, 404, '**绝不许**把我们的 bug 伪装成"这张图不存在"');
    assert.equal(d.internal, true, '要能一眼看出这是内部问题');
    assert.match(d.reason, /我们的问题/);
  }
});

test('T7 文件在但解不出图 ⇒ 415', () => {
  const d = thumbServeStatus({ ...OK_BASE, decoded: false });
  assert.equal(d.status, 415);
});

test('T8 全部通过 ⇒ null（可以出图）', () => {
  const d = thumbServeStatus({ ...OK_BASE, resolveCode: '', decoded: true });
  assert.equal(d.status, null);
  assert.equal(d.internal, false);
});

test('T9 顺序是契约：形状错 + 引擎未就绪 ⇒ **400**（先判形状，别被后一步抢先）', () => {
  assert.equal(thumbServeStatus({ shapeOk: false, libId: '', engineReady: false }).status, 400);
  // 引擎未就绪 + 有错误码 ⇒ 503 先于取路径失败
  assert.equal(thumbServeStatus({ ...OK_BASE, engineReady: false, resolveCode: 'UID_NOT_FOUND' }).status, 503);
});

test('T10 复用 thumb-url 的白名单，不另写一套：白名单里的尺寸都进得去、999 进不来', () => {
  for (const size of ALLOWED_SIZE) {
    const p = parseThumbUrl('thumb://L1/' + UID + '@' + size);
    assert.equal(p.ok, true, '@' + size + ' 是白名单里的，必须通过');
    assert.equal(thumbServeStatus({ ...OK_BASE, shapeOk: p.ok }).status, null);
  }
  assert.equal(parseThumbUrl('thumb://L1/' + UID + '@777').ok, false);
});

// ============================================================ 结构自检

test('S1 thumb-cache.ts 不 import electron（否则 node:test 根本加载不了它，本文件早就跑不起来）', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'apps/desktop/src/main/thumb-cache.ts'), 'utf8');
  assert.equal(/from\s+['"]electron['"]/.test(src), false);
  assert.equal(/require\(\s*['"]electron['"]/.test(src), false);
  // 形状/白名单必须**复用** thumb-url.ts，而不是在这里再实现一份
  assert.ok(src.includes("from './thumb-url.ts'"), '必须复用 thumb-url.ts 的解析与白名单');
  assert.equal(/new Set\(\[\s*128/.test(src), false, '不许在这里再写一份尺寸白名单');
});

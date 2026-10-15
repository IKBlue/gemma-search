// packages/engine/tests/fingerprint.test.mjs —— DF-1：库指纹必须跳过**保留命名空间**
//
// 为什么单列一组：指纹是"库有没有被动过"的**唯一判据**（SPEC-identity §5）。
// 它一旦把 `.gs-index.bin` / `.gs.db`(+边车) / staging 算进去，就会出现：**索引一重建，指纹就变**
// ⇒ `doScan()` 把"我们自己的派生数据变了"报成"库被改过"；而同一件事在 main/library-rebuild.ts 的
// `materialDigest()` 里有跳过 ⇒ 两套口径（P1）。这是 U11（把 .gs.db 当素材）那类问题的**第三次复发**。
//
// 断言分两层：
//   ① **机械断言**：指纹统计的文件数 == 扫描器认定的素材文件数（用同一份 gs-names.ts 判据，索引在场也成立）；
//   ② **语义断言**：改写/新增**保留命名空间**里的东西 ⇒ 指纹**不变**；改一个**素材** ⇒ 指纹**必须变**
//      （后半条防止"指纹根本不敏感"这种假绿）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fingerprintLines, fingerprintV1 } from '../src/fingerprint.ts';
import { scanLibrary } from '../src/scanner.ts';

const MATERIAL_FILES = 4;      // VR/ID-1.jpg · VR/ID-1.rar · CR/ID-2.png · CR/ID-2.zip
const RESERVED_ENTRIES = 7;    // 5 个文件 + .gs-journal/(目录) + VR/.gs-staging/(目录)

/** 造一个迷你库：2 组素材（图+包各 2）+ 一堆保留命名空间产物（含**子目录**里的 staging） */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-fp-'));
  const write = (rel, text) => {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  // 素材（4 个文件）
  write('VR/ID-1.jpg', 'jpeg-bytes-1');
  write('VR/ID-1.rar', 'rar-bytes-1');
  write('CR/ID-2.png', 'png-bytes-2');
  write('CR/ID-2.zip', 'zip-bytes-2');
  // 保留命名空间：索引 · .gs.db 家族 · 写探测 · journal · staging（staging 会建在**任意子目录**下）
  write('.gs-index.bin', 'GSIDX-fake-index-bytes');
  write('.gs.db', 'sqlite-fake');
  write('.gs.db-wal', 'wal');
  write('.gs.db-shm', 'shm');
  write('.gs-write-probe-999', 'probe');
  write('.gs-journal/txn1.log', 'journal');
  write('VR/.gs-staging/txn9/tmp.jpg', 'staged');
  return root;
}

test('DF-1 ⭐⭐ 指纹的文件数 == 扫描器的素材文件数（保留命名空间一律不算；索引在场也成立）', () => {
  const root = makeFixture();
  try {
    const fp = fingerprintLines(root);
    const scan = scanLibrary(root, { libId: 'L1' });
    assert.equal(fp.counts.files, MATERIAL_FILES,
      '指纹只该数 4 个素材文件（实得 ' + fp.counts.files + '）—— 多出来的就是保留命名空间');
    assert.equal(fp.counts.images, 2, '图 2');
    assert.equal(fp.counts.archives, 2, '包 2');
    assert.equal(fp.counts.other, 0, '素材里没有 other');
    assert.equal(scan.counts.images, 2, '扫描器认 2 条素材');
    assert.equal(scan.counts.paired, 2, '两条都配对');
    assert.equal(scan.counts.skippedReserved, RESERVED_ENTRIES,
      '扫描器跳过的保留条目数（实得 ' + scan.counts.skippedReserved + '）');
    // 机械断言：两侧数的是**同一批文件**（图 + 配对包）；也是"同一份跳过判据"的体现
    assert.equal(fp.counts.files, scan.counts.images + scan.counts.paired,
      '指纹文件数必须 == 扫描器的素材文件数');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('DF-1 ⭐⭐ 语义：改写/新增保留命名空间 ⇒ 指纹不变；改素材 ⇒ 指纹必须变', () => {
  const root = makeFixture();
  try {
    const before = fingerprintV1(root).fingerprint;
    // ① 索引"重建"（内容与长度都变）② .gs.db 边车重写 ③ 新增一个 .gs-* 文件
    fs.writeFileSync(path.join(root, '.gs-index.bin'), 'GSIDX-rebuilt-with-a-different-length');
    fs.writeFileSync(path.join(root, '.gs.db-wal'), 'wal-v2-with-more-bytes');
    fs.writeFileSync(path.join(root, '.gs-index.bin.tmp-1'), 'half-written');
    const afterRebuild = fingerprintV1(root);
    assert.equal(afterRebuild.fingerprint, before,
      '索引/元数据变化**不许**改动库指纹（否则 doScan 会把它报成「库被改过」）');
    assert.equal(afterRebuild.counts.files, MATERIAL_FILES, '保留命名空间仍未计入');
    // 反向对照：改一个**素材** ⇒ 指纹必须变（证明指纹不是不敏感的）
    fs.writeFileSync(path.join(root, 'VR', 'ID-1.jpg'), 'jpeg-bytes-1-changed');
    assert.notEqual(fingerprintV1(root).fingerprint, before, '素材变了，指纹必须变');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

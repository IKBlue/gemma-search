// packages/engine/tests/fingerprint.test.mjs —— DF-1/DF-3：库指纹的「素材定义」必须与扫描器一致
//
// 为什么单列一组：指纹是"库有没有被动过"的**唯一判据**（SPEC.md §1.5 库）。它一旦把
// `.gs-index.bin` / `.gs.db`(+边车) / staging（DF-1）或**隐藏项**（DF-3：`.DS_Store` 之类）算进去，
// 就会出现：**索引一重建 / 编辑器一写 `.DS_Store`，指纹就变** ⇒ `doScan()` 报"库被改过"，
// 而扫描 diff 什么都不显示（用户被告知"改过"却查不出改了什么）。
//
// 断言分三层：
//   ① **机械断言**：指纹统计的文件数 == 扫描器认定的素材文件数（同一份 gs-names.ts 判据，索引/隐藏项在场也成立）；
//   ② **语义断言**：改写/新增**保留命名空间**或**隐藏项** ⇒ 指纹**不变**；改**素材** ⇒ 指纹**必须变**；
//   ③ 扫描器的两个计数（skippedReserved / skippedHidden）仍然分别如实 —— 分类归一份实现，计数不合并。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fingerprintLines, fingerprintV1 } from '../src/fingerprint.ts';
import { scanLibrary } from '../src/scanner.ts';

const MATERIAL_FILES = 4; // VR/ID-1.jpg · VR/ID-1.rar · CR/ID-2.png · CR/ID-2.zip
const RESERVED_ENTRIES = 7; // 5 个文件 + .gs-journal/(目录) + VR/.gs-staging/(目录)
const HIDDEN_ENTRIES = 2; // .DS_Store(文件) + .hidden/(目录；里面的文件不进)

/** 迷你库：2 组素材 + 保留命名空间产物 + 隐藏项（含**子目录**里的 staging / 隐藏目录） */
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
  // 隐藏项（点开头、但**不是**保留名）：这一类以前会被算进指纹（DF-3 修的就是它）
  write('.DS_Store', 'macOS-junk');
  write('.hidden/x.jpg', 'hidden-dir-content');
  return root;
}

test('DF-1/DF-3 ⭐⭐ 指纹的文件数 == 扫描器的素材文件数（保留名与隐藏项一律不算）', () => {
  const root = makeFixture();
  try {
    const fp = fingerprintLines(root);
    const scan = scanLibrary(root, { libId: 'L1' });
    assert.equal(
      fp.counts.files,
      MATERIAL_FILES,
      '指纹只该数 4 个素材文件（实得 ' + fp.counts.files + '）—— 多出来的就是保留名/隐藏项',
    );
    assert.equal(fp.counts.images, 2, '图 2');
    assert.equal(fp.counts.archives, 2, '包 2');
    assert.equal(fp.counts.other, 0, '素材里没有 other');
    assert.equal(scan.counts.images, 2, '扫描器认 2 条素材');
    assert.equal(scan.counts.paired, 2, '两条都配对');
    assert.equal(
      scan.counts.skippedReserved,
      RESERVED_ENTRIES,
      '保留条目数如实（实得 ' + scan.counts.skippedReserved + '）',
    );
    assert.equal(
      scan.counts.skippedHidden,
      HIDDEN_ENTRIES,
      '隐藏条目数如实（实得 ' + scan.counts.skippedHidden + '）—— 分类归一份实现，但计数不合并',
    );
    // 机械断言：两侧数的是**同一批文件**（图 + 配对包）
    assert.equal(
      fp.counts.files,
      scan.counts.images + scan.counts.paired,
      '指纹文件数必须 == 扫描器的素材文件数',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DF-3 ⭐⭐ 语义：保留名/隐藏项出现或消失 ⇒ 指纹不变；改素材 ⇒ 指纹必须变', () => {
  const root = makeFixture();
  try {
    const before = fingerprintV1(root).fingerprint;
    // ① 索引"重建"（内容与长度都变）② .gs.db 边车重写 ③ 新增 .gs-* 文件 ④ 编辑器写 .DS_Store ⑤ 隐藏目录 churn
    fs.writeFileSync(path.join(root, '.gs-index.bin'), 'GSIDX-rebuilt-with-a-different-length');
    fs.writeFileSync(path.join(root, '.gs.db-wal'), 'wal-v2-with-more-bytes');
    fs.writeFileSync(path.join(root, '.gs-index.bin.tmp-1'), 'half-written');
    fs.writeFileSync(path.join(root, '.DS_Store'), 'macOS-junk-v2-with-different-size');
    fs.writeFileSync(path.join(root, '.hidden', 'x.jpg'), 'hidden-dir-content-changed');
    fs.writeFileSync(path.join(root, '.hidden', 'new.txt'), 'added');
    fs.mkdirSync(path.join(root, 'VR', '.thumbnails'), { recursive: true });
    fs.writeFileSync(path.join(root, 'VR', '.thumbnails', 't.jpg'), 'thumb');
    const afterRebuild = fingerprintV1(root);
    assert.equal(
      afterRebuild.fingerprint,
      before,
      '索引/元数据/隐藏项变化**不许**改动库指纹（否则 doScan 会把它报成「库被改过」而 diff 又空）',
    );
    assert.equal(afterRebuild.counts.files, MATERIAL_FILES, '保留名与隐藏项仍未计入');
    // 反向对照：改一个**素材** ⇒ 指纹必须变（证明指纹不是不敏感的）
    fs.writeFileSync(path.join(root, 'VR', 'ID-1.jpg'), 'jpeg-bytes-1-changed');
    assert.notEqual(fingerprintV1(root).fingerprint, before, '素材变了，指纹必须变');
    // 隐藏项的 churn 是**双向**：出现与消失都不该动指纹。
    // （注意不能拿 before 比：素材被改过之后 mtime 已经变了，指纹本来就该不同。）
    const base2 = fingerprintV1(root).fingerprint;
    fs.rmSync(path.join(root, '.DS_Store'));
    fs.mkdirSync(path.join(root, 'VR', '.cache'), { recursive: true });
    fs.writeFileSync(path.join(root, 'VR', '.cache', 'x.jpg'), 'cache');
    assert.equal(fingerprintV1(root).fingerprint, base2, '隐藏项出现/消失都不该动指纹');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

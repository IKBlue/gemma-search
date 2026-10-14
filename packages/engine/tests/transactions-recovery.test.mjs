// packages/engine/tests/transactions-recovery.test.mjs —— 启动恢复（规格 §4）
//
// 手法：**直接构造日志状态 + 摆好文件系统**，再调 `recoverJournal`。
//   这样每个状态都能精确、确定性地测到；"进程真被杀"由 §8 的 harness 另行验证
//   （`transactions-fault-injection.test.mjs`）。
//
// ⚠️ 只对 `data/_txn-test/` 下的夹具副本写。绝不碰真实素材库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { S } from '../src/transactions/states.ts';
import { writeTxn, listTxns, readTxn, txnPath } from '../src/transactions/journal.ts';
import { sha1File, sha1Of } from '../src/transactions/hash.ts';
import { stagingPathFor } from '../src/transactions/executor.ts';
import { recoverJournal } from '../src/transactions/recovery.ts';

const FIXTURE = path.resolve('fixtures/lib-a');
const WORK = path.resolve('data/_txn-test');

function setup(tag) {
  const base = path.join(WORK, `r-${tag}`);
  fs.rmSync(base, { recursive: true, force: true });
  const lib = path.join(base, 'lib');
  const journal = path.join(base, 'journal');
  fs.cpSync(FIXTURE, lib, { recursive: true });
  fs.mkdirSync(journal, { recursive: true });
  return { base, lib, journal };
}

const exists = (p) => fs.existsSync(p);
const ISO = '2026-10-13T00:00:00.000Z';

/**
 * 造一条日志记录并落盘。
 * `plan` 里的每一项描述**盘上应该是什么样**，测试自己先摆好文件，这里只负责写日志。
 */
function seed({ journalDir, txnId = 't1', state, files, indexDone = false }) {
  const rec = {
    txnId, state, op: 'move-folder', libId: 'lib-a', uid: 'u1', reason: '测试',
    createdAt: ISO, updatedAt: ISO,
    files: files.map((f) => ({
      role: f.role || 'image',
      src: f.src,
      dst: f.dst,
      stage: f.stage === undefined ? stagingPathFor(f.dst, txnId) : f.stage,
      size: f.srcExists === false ? 0 : fs.statSync(f.src).size,
      sha1: f.sha1,      stagedSha1: f.stagedSha1 ?? null,
      srcDeleted: f.srcDeleted ?? false,
      _idempotent: false,
    })),
    indexUpdate: { done: indexDone, before: null, after: null },
    undoOf: null,
  };
  writeTxn(journalDir, rec);
  return rec;
}

/** 摆一个 staging 文件（内容 = 源的内容，或故意损坏） */
function putStaging(stagePath, srcPath, corrupt = false) {
  fs.mkdirSync(path.dirname(stagePath), { recursive: true });
  if (corrupt) fs.writeFileSync(stagePath, 'CORRUPTED-CONTENT', 'utf8');
  else fs.copyFileSync(srcPath, stagePath);
}

function spyIndex(behavior = () => {}) {
  const calls = [];
  return { calls, port: { update: (c) => { calls.push(c); behavior(c); } } };
}

// ══════════════════════════════════════════════════════ §4 的判定表逐条

test('RC-1 `PREPARED` ⇒ **回退**：清 staging、源不动、落到 ABORTED 并归档', () => {
  const { lib, journal } = setup('1');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const rec = seed({ journalDir: journal, state: S.PREPARED, files: [{ src, dst, sha1: sha1File(src) }] });
  putStaging(rec.files[0].stage, src);                       // 假装写到一半被杀（日志还停在 PREPARED）

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });

  assert.equal(out.summary.aborted, 1);
  assert.equal(exists(rec.files[0].stage), false, '§4：回退要删 staging');
  assert.equal(exists(src), true, '源必须完好');
  assert.equal(exists(dst), false, '目标不该被创建');
  assert.deepEqual(listTxns(journal).txns, [], '落定后应已归档，不再出现在待恢复列表里');
});

test('RC-2 ⭐ `STAGED` 且校验一致 ⇒ **前进**：rename + 索引 + 清源，走完整条', () => {
  const { lib, journal } = setup('2');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.STAGED, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  putStaging(rec.files[0].stage, src);

  const idx = spyIndex();
  const out = recoverJournal({ journalDir: journal, indexPort: idx.port });

  assert.equal(out.summary.committed, 1, 'STAGED 且校验一致 ⇒ 应走完到 committed');
  assert.equal(exists(dst), true, '应推进到最终名');
  assert.equal(sha1File(dst), sha, '字节一致');
  assert.equal(exists(src), false, '清源');
  assert.equal(idx.calls.length, 1, '索引应更新一次');
  assert.equal(exists(rec.files[0].stage), false, 'staging 应已消失（被 rename 走）');
});

test('RC-3 ⭐ `STAGED` 但校验**不一致** ⇒ 回退（清 staging、源不动、绝不将坏字节扶正）', () => {
  const { lib, journal } = setup('3');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.STAGED, files: [{ src, dst, sha1: sha, stagedSha1: sha1Of('CORRUPTED-CONTENT') }] });
  putStaging(rec.files[0].stage, src, true);                 // staging 内容坏了

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });

  assert.equal(out.summary.aborted, 1);
  assert.equal(exists(dst), false, '坏字节绝不能被扶成最终文件');
  assert.equal(exists(src), true, '源完好');
  assert.equal(exists(src) && sha1File(src) === sha, true, '源字节未变');
  assert.equal(exists(rec.files[0].stage), false, '坏 staging 要清掉');
});

test('RC-4 ⭐⭐ 判定不唯一（staging 丢失 **且** 源已不在）⇒ `RECOVERY_NEEDED` **停下问人**', () => {
  const { lib, journal } = setup('4');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.STAGED, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  fs.rmSync(src);                                            // 源没了
  // staging 也没落盘（不创建）
  const idx = spyIndex();
  const out = recoverJournal({ journalDir: journal, indexPort: idx.port });

  assert.equal(out.summary.recoveryNeeded, 1, '§4：判定不唯一 ⇒ RECOVERY_NEEDED');
  assert.equal(out.pending.length, 1, '必须交出一条"待处理"（不静默）');
  const p = out.pending[0];
  assert.equal(p.libId, 'lib-a', '§4 要求列出：库');
  assert.equal(p.uid, 'u1', 'uid');
  assert.equal(p.files[0].src, src, '源');
  assert.equal(p.files[0].dst, dst, '目标');
  assert.match(p.reason, /不唯一/);
  assert.ok(p.ambiguity.length > 0 && p.ambiguity[0].reason, '要说明"缺什么/为什么不唯一"');
  assert.equal(idx.calls.length, 0, '问人期间绝不动索引');
  assert.deepEqual(listTxns(journal).txns.map((t) => t.state), [S.RECOVERY_NEEDED], '日志应落在 RECOVERY_NEEDED');
});

test('RC-5 ⭐ 源与目标都在且**字节不同** ⇒ 同样停下问人（不能挑一个）', () => {
  const { lib, journal } = setup('5');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.STAGED, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  putStaging(rec.files[0].stage, src);
  fs.copyFileSync(path.join(lib, 'VR', 'VR-103.jpg'), dst);   // 目标已存在，内容不同

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });
  assert.equal(out.summary.recoveryNeeded, 1);
  assert.match(out.pending[0].ambiguity[0].reason, /字节不同/);
  assert.equal(sha1File(dst) === sha1File(src), false, '两处内容保持各自的样子（谁都不许覆盖）');
});

test('RC-6 ⭐ `COMMITTED` 但索引未更新 ⇒ **只补索引**，然后清源（绝不出现索引指向不存在的文件）', () => {
  const { lib, journal } = setup('6');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.COMMITTED, indexDone: false, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);                                   // 已经 rename 完了（源不在、目标在）
  fs.rmSync(rec.files[0].stage, { force: true });

  const idx = spyIndex();
  const out = recoverJournal({ journalDir: journal, indexPort: idx.port });

  assert.equal(out.summary.committed, 1);
  assert.equal(idx.calls.length, 1, '索引必须补上');
  assert.equal(exists(dst), true, '目标还在');
  assert.equal(exists(src), false, '源已清');
});

test('RC-7 ⭐⭐ **幂等**：同一条事务恢复两次，第二次什么也不改、索引不再被调', () => {
  const { lib, journal } = setup('7');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.STAGED, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  putStaging(rec.files[0].stage, src);

  const idx1 = spyIndex();
  const out1 = recoverJournal({ journalDir: journal, indexPort: idx1.port });
  assert.equal(out1.summary.committed, 1);
  const dstSha = sha1File(dst);

  // 第二次：日志已归档 ⇒ 列表为空 ⇒ 什么都不做
  const idx2 = spyIndex();
  const out2 = recoverJournal({ journalDir: journal, indexPort: idx2.port });
  assert.equal(out2.summary.scanned, 0, '已归档的事务不该再被扫描到');
  assert.equal(idx2.calls.length, 0, '第二次不该再更新索引');
  assert.equal(sha1File(dst), dstSha, '目标内容一模一样');
  assert.equal(exists(src), false, '源仍是清的（没有被"复活"）');
});

test('RC-8 终态（CLEANED / ABORTED）⇒ **只归档、不动文件**', () => {
  const { lib, journal } = setup('8');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'VR', 'VR-103.jpg');            // 另一个**存在**的文件（VR-103 在 VR/ 下）
  const sha = sha1File(src);
  seed({ journalDir: journal, txnId: 'c1', state: S.CLEANED, files: [{ src, dst, sha1: sha }] });
  seed({ journalDir: journal, txnId: 'a1', state: S.ABORTED, files: [{ src, dst, sha1: sha }] });
  const srcSha = sha1File(src);
  const dstSha = sha1File(dst);

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });

  assert.equal(out.summary.archived, 2);
  assert.equal(sha1File(src), srcSha, '源一个字节都不许动');
  assert.equal(sha1File(dst), dstSha, '目标一个字节都不许动');
  assert.deepEqual(listTxns(journal).txns, [], '两条都归档了');
});

test('RC-9 索引端口在恢复时失败 ⇒ **停下报出来**，绝不当成"已完成"去清源', () => {
  const { lib, journal } = setup('9');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.COMMITTED, files: [{ src, dst, sha1: sha, stagedSha1: sha }] });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);

  const out = recoverJournal({ journalDir: journal, indexPort: { update: () => { throw new Error('索引盘满了'); } } });

  assert.equal(out.summary.recoveryNeeded, 1);
  assert.equal(exists(src), false, '源已在 rename 阶段就没了（这一步回不去）');
  assert.equal(exists(dst), true, '目标在');
  assert.match(out.pending[0].reason, /索引/);
});

test('RC-10 坏日志**不静默**：`broken` 要报出来，且不影响其它事务的恢复', () => {
  const { lib, journal } = setup('10');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const sha = sha1File(src);
  const rec = seed({ journalDir: journal, state: S.PREPARED, files: [{ src, dst, sha1: sha }] });
  fs.writeFileSync(path.join(journal, 'txn-坏掉.json'), '{ 半截 JSON', 'utf8');

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });

  assert.equal(out.broken.length, 1, '§4「不静默」：读不出来的日志必须被报出来');
  assert.equal(out.summary.aborted, 1, '另一条正常事务照常恢复');
  assert.equal(exists(src), true);
});

test('RC-11 多文件事务：只 rename 了一半 ⇒ 恢复把**另一半也补上**（不留半截）', () => {
  const { lib, journal } = setup('11');
  const img = path.join(lib, 'VR', 'VR-101.jpg');
  const arc = path.join(lib, 'VR', 'VR-101.rar');
  const imgDst = path.join(lib, 'CR', 'VR-101.jpg');
  const arcDst = path.join(lib, 'CR', 'VR-101.rar');
  const imgSha = sha1File(img);
  const arcSha = sha1File(arc);
  const rec = seed({
    journalDir: journal, state: S.VERIFIED,
    files: [
      { role: 'image', src: img, dst: imgDst, sha1: imgSha, stagedSha1: imgSha },
      { role: 'archive', src: arc, dst: arcDst, sha1: arcSha, stagedSha1: arcSha },
    ],
  });
  // 摆成"图已 rename、包还没"（§8 第 6 例）
  fs.mkdirSync(path.dirname(imgDst), { recursive: true });
  fs.renameSync(img, imgDst);
  putStaging(rec.files[1].stage, arc);                       // 包的 staging 还在

  const idx = spyIndex();
  const out = recoverJournal({ journalDir: journal, indexPort: idx.port });

  assert.equal(out.summary.committed, 1);
  assert.equal(exists(imgDst), true, '图在最终名');
  assert.equal(exists(arcDst), true, '⭐ 包也要被补上（§8 第 6 例：前进，不留半截）');
  assert.equal(sha1File(arcDst), arcSha, '包字节一致');
  assert.equal(exists(img), false);
  assert.equal(exists(arc), false, '两条源都清掉');
});

test('RC-13 ⭐⭐ 记录**不完整**（缺 `sha1`）⇒ 停下问人，**不许**被误读成"校验不一致"', () => {
  // 来历：我自己踩过一次 —— 测试助手把字段名写成 `sha` 而恢复读 `sha1`，
  // 于是 `JSON.stringify` 静默丢掉了这个键，恢复拿 `undefined` 去比哈希 ⇒
  // 把一个**合法**事务判成"校验失败 ⇒ ABORTED"，而理由完全是假的。
  // ⇒ 记录不完整属于"无法识别的状态"（§8 判据明令禁止的东西），必须**停下来问人**。
  const { lib, journal } = setup('13');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const stage = stagingPathFor(dst, 't1');
  const raw = {
    txnId: 't1', state: S.STAGED, op: 'move-folder', libId: 'lib-a', uid: 'u1',
    createdAt: ISO, updatedAt: ISO,
    // ⚠️ 刻意**不写** sha1
    files: [{ role: 'image', src, dst, stage, size: 1, stagedSha1: sha1File(src), srcDeleted: false, _idempotent: false }],
    indexUpdate: { done: false }, undoOf: null,
  };
  fs.writeFileSync(path.join(journal, 'txn-t1.json'), JSON.stringify(raw, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  fs.copyFileSync(src, stage);
  const srcSha = sha1File(src);

  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });

  assert.equal(out.summary.recoveryNeeded, 1, '不完整的记录必须停下问人');
  assert.match(out.pending[0].reason, /不完整/, '理由必须说"记录不完整"，不是"校验失败"');
  assert.match(out.pending[0].reason, /sha1/, '还要说清缺的是哪个字段');
  assert.equal(sha1File(src), srcSha, '源必须原封不动');
  assert.equal(exists(dst), false, '不许据一条不完整的记录去动目标');
  assert.equal(exists(stage), true, '也不许顺手清掉 staging（那可能是在场的唯一数据）');
});

test('RC-14 `writeTxn` 拒绝结构不完整的记录（在**写的时候**就炸，不留半截档案）', () => {
  const { journal } = setup('14');
  assert.throws(() => writeTxn(journal, { state: S.PREPARED, files: [] }), /txnId/, '缺 txnId 要炸');
  assert.throws(() => writeTxn(journal, { txnId: 'x', files: [] }), /state/, '缺 state 要炸');
  assert.throws(() => writeTxn(journal, { txnId: 'x', state: S.PREPARED }), /files/, '缺 files 要炸');
});

test('RC-12 恢复报告**不静默**：有未完成事务时 summary/pending 必须给得出东西', () => {
  const { lib, journal } = setup('12');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const rec = seed({ journalDir: journal, state: S.PREPARED, files: [{ src, dst, sha1: sha1File(src) }] });
  const out = recoverJournal({ journalDir: journal, indexPort: spyIndex().port });
  assert.equal(out.summary.scanned, 1, '要能说清"扫了几条"');
  assert.ok(rec.txnId, '（占位，确保 seed 真的写了东西）');
  assert.equal(typeof out.summary.committed, 'number');
});

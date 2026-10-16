// packages/engine/tests/transactions.test.mjs —— 事务模块：状态机 / 日志 / 执行器
//
// ⚠️ **本文件只对 `data/_txn-test/` 下的夹具副本做写操作。**
//    绝不对真实素材库、也绝不对 `fixtures/lib-a/` 本身写（每个用例都从夹具**复制**一份）。
//    这条纪律的出处：`TASKS.md` §1（P4）「入库/移出/故障注入**绝不对真实库跑**」。
//
// 本文件盯的是**两条不可动摇的规则**（`SPEC-transactions.md` §3）—— 它们错了的表现是**用户素材丢失**：
//   ① 源文件在 `COMMITTED` 且索引更新成功之前**绝不删除**
//   ② **绝不覆盖**已存在的不同内容文件；字节相同 ⇒ 幂等命中，跳过
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  S,
  FORWARD,
  TERMINAL,
  isTerminal,
  nextOf,
  canTransition,
  canCancel,
  recoveryActionOf,
  isAmbiguous,
  ACTION,
} from '../src/transactions/states.ts';
import {
  makeTxnId,
  txnFileName,
  txnPath,
  writeTxn,
  readTxn,
  listTxns,
  withState,
  archiveTxn,
  ensureJournalDir,
} from '../src/transactions/journal.ts';
import {
  createTxnExecutor,
  preflight,
  checkSpace,
  freeBytesOn,
  stagingPathFor,
  CRASH_POINTS,
} from '../src/transactions/executor.ts';
import { sha1File } from '../src/transactions/hash.ts';

const FIXTURE = path.resolve('fixtures/lib-a');
const WORK = path.resolve('data/_txn-test');

/** 每个用例一份**干净**的库副本 + 空日志目录 —— 用例之间不许互相看见 */
function setup(tag) {
  const base = path.join(WORK, tag);
  fs.rmSync(base, { recursive: true, force: true });
  const lib = path.join(base, 'lib');
  const journal = path.join(base, 'journal');
  fs.cpSync(FIXTURE, lib, { recursive: true });
  fs.mkdirSync(journal, { recursive: true });
  return { base, lib, journal };
}

/** 记录索引端口收到的调用 */
function spyIndex() {
  const calls = [];
  return {
    calls,
    port: {
      update: (c) => {
        calls.push(c);
      },
    },
  };
}

const exists = (p) => fs.existsSync(p);

// ══════════════════════════════════════════════════════ 状态机（§2/§4/§5）

test('TX-S1 主链只能**前进一步**，不许跳步（跳步会把中间的校验整段跳过）', () => {
  for (let i = 0; i < FORWARD.length - 1; i += 1) {
    assert.equal(
      canTransition(FORWARD[i], FORWARD[i + 1]),
      true,
      `${FORWARD[i]}→${FORWARD[i + 1]} 应允许`,
    );
    assert.equal(nextOf(FORWARD[i]), FORWARD[i + 1]);
  }
  assert.equal(canTransition(S.PREPARED, S.VERIFIED), false, 'PREPARED→VERIFIED 是跳步，必须拒绝');
  assert.equal(
    canTransition(S.STAGED, S.COMMITTED),
    false,
    'STAGED→COMMITTED 跳过了校验，必须拒绝',
  );
  assert.equal(nextOf(S.CLEANED), null, '终态没有下一步');
});

test('TX-S2 ⭐ `COMMITTED` **不许 ABORT**（§3 第 5 条：只能"完成它"，回退会制造半完成状态）', () => {
  assert.equal(canTransition(S.COMMITTED, S.ABORTED), false, 'COMMITTED→ABORTED 必须拒绝');
  // 而 COMMITTED 之前的三态都可以回退（§2 的图里有回退箭头）
  for (const st of [S.PREPARED, S.STAGED, S.VERIFIED]) {
    assert.equal(canTransition(st, S.ABORTED), true, `${st}→ABORTED 应允许`);
  }
});

test('TX-S3 终态不可再变（幂等恢复的前提：第二次恢复什么都不改）', () => {
  for (const st of TERMINAL) {
    assert.equal(isTerminal(st), true);
    assert.equal(canTransition(st, S.COMMITTED), false, `${st} 不该还能跃迁`);
    assert.equal(canTransition(st, S.RECOVERY_NEEDED), false, `${st} 不该还能进 RECOVERY_NEEDED`);
  }
});

test('TX-S4 ⭐ 取消只在**状态边界**生效：COMMITTED 之后不可取消（§5）', () => {
  assert.deepEqual([S.PREPARED, S.STAGED, S.VERIFIED].map(canCancel), [true, true, true]);
  assert.equal(canCancel(S.COMMITTED), false, '§5：COMMITTED 之后必须把索引更新完');
  assert.equal(canCancel(S.CLEANED), false);
  assert.equal(canCancel(S.ABORTED), false);
});

test('TX-S5 ⭐ 恢复判定表（§4）逐态对齐 —— 这张表决定"进程被杀之后前进还是回退"', () => {
  assert.equal(recoveryActionOf(S.PREPARED), ACTION.ROLLBACK, '§4：PREPARED → 回退（删 staging）');
  assert.equal(recoveryActionOf(S.STAGED), ACTION.VERIFY, '§4：STAGED → 校验 staging');
  assert.equal(recoveryActionOf(S.VERIFIED), ACTION.ADVANCE, '§4：VERIFIED → 前进');
  assert.equal(recoveryActionOf(S.COMMITTED), ACTION.ADVANCE, '§4：COMMITTED → 前进（更新索引）');
  assert.equal(
    recoveryActionOf(S.RECOVERY_NEEDED),
    ACTION.ASK_HUMAN,
    '判定不唯一 ⇒ 停下问人，绝不猜',
  );
  assert.equal(recoveryActionOf(S.CLEANED), ACTION.ARCHIVE);
  assert.equal(recoveryActionOf(S.ABORTED), ACTION.ARCHIVE);
  // 认不出的状态**不许猜** —— 归到"问人"
  assert.equal(
    recoveryActionOf('SOMETHING_NEW'),
    ACTION.ASK_HUMAN,
    '未知状态必须交给人，不许默认成前进',
  );
});

test('TX-S6 ⭐ 歧义判定（§4）：只有两种情形该停下问人，且**不能把"已完成"误判成歧义**', () => {
  // 情形一：源与目标都在且字节不同
  assert.equal(
    isAmbiguous({ srcExists: true, dstExists: true, sameBytes: false, stagingExists: true }),
    true,
  );
  // 情形二：staging 丢了、源也没了，**且目标不是期望的内容** ⇒ 数据去向不明
  assert.equal(
    isAmbiguous({
      srcExists: false,
      dstExists: false,
      sameBytes: null,
      stagingExists: false,
      dstHasExpectedBytes: null,
    }),
    true,
  );
  assert.equal(
    isAmbiguous({
      srcExists: false,
      dstExists: true,
      sameBytes: null,
      stagingExists: false,
      dstHasExpectedBytes: false,
    }),
    true,
  );
  // ⭐⭐ 关键的反面：staging 丢了、源也不在，但**目标就是期望的字节** ⇒ rename 已成功，不是歧义
  assert.equal(
    isAmbiguous({
      srcExists: false,
      dstExists: true,
      sameBytes: null,
      stagingExists: false,
      dstHasExpectedBytes: true,
    }),
    false,
    'COMMITTED 状态（已完成 rename）绝不能被判成"不唯一" —— 否则正常事务永远走不完',
  );
  // 正常情形不该误报
  assert.equal(
    isAmbiguous({ srcExists: true, dstExists: true, sameBytes: true, stagingExists: true }),
    false,
  );
  assert.equal(
    isAmbiguous({ srcExists: true, dstExists: false, sameBytes: null, stagingExists: false }),
    false,
    'staging 丢了但源还在 ⇒ 可以安全回退，不该问人',
  );
});

// ══════════════════════════════════════════════════════ 日志（§1）

test('TX-J1 txnId 形态与规格 §1 一致：`<utc>-<rand>`，且可用固定 now/rand 复现', () => {
  const id = makeTxnId(Date.UTC(2026, 9, 10, 12, 15, 30), 'a1b2c3');
  assert.equal(id, '20261010T121530Z-a1b2c3', '必须与规格示例逐字同形（它会写进日志文件名）');
  assert.equal(txnFileName(id), 'txn-20261010T121530Z-a1b2c3.json');
});

test('TX-J2 ⭐ 日志是**一事务一文件**且原子落盘（不留半截 JSON）', () => {
  const { journal } = setup('j2');
  const rec = { txnId: 'x1', state: S.PREPARED, files: [{ src: 'a', dst: 'b', stage: 'c' }] };
  const p = writeTxn(journal, rec);
  assert.equal(path.basename(p), txnFileName('x1'));
  assert.deepEqual(readTxn(p), rec, '写进去的必须能原样读回来');
  // 不留 .tmp 残留（否则恢复扫描会看到无法识别的文件）
  const leftovers = fs.readdirSync(journal).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `不该留 .tmp 残留：${leftovers.join(',')}`);
});

test('TX-J3 ⭐ 坏日志**不许让扫描崩**，而且要**可见**（"无法识别的状态"正是 §8 禁止的结果）', () => {
  const { journal } = setup('j3');
  writeTxn(journal, { txnId: 'good1', state: S.PREPARED, files: [] });
  fs.writeFileSync(path.join(journal, txnFileName('bad1')), '{ 这不是完整 JSON', 'utf8');
  const { txns, broken } = listTxns(journal);
  assert.equal(txns.length, 1, '好日志要读出来');
  assert.equal(txns[0].txnId, 'good1');
  assert.equal(broken.length, 1, '坏日志必须被**报出来**，不能静默跳过');
  assert.equal(broken[0].file, txnFileName('bad1'));
});

test('TX-J4 `withState` 不改入参（状态跃迁必须产生新对象，避免"已经改了一半"）', () => {
  const rec = { txnId: 'x', state: S.PREPARED };
  const next = withState(rec, S.STAGED, { note: 'hi' }, Date.UTC(2026, 0, 2));
  assert.equal(rec.state, S.PREPARED, '原对象不能被改动');
  assert.equal(rec.note, undefined);
  assert.equal(next.state, S.STAGED);
  assert.equal(next.note, 'hi');
  assert.equal(next.updatedAt, new Date(Date.UTC(2026, 0, 2)).toISOString());
});

test('TX-J5 终态归档：从 journal/ 移到 journal/archive/', () => {
  const { journal } = setup('j5');
  writeTxn(journal, { txnId: 'z1', state: S.CLEANED, files: [] });
  const to = archiveTxn(journal, 'z1');
  assert.ok(exists(to), '归档后文件应在 archive/ 下');
  assert.equal(exists(txnPath(journal, 'z1')), false, '原位置不该还在');
  assert.deepEqual(listTxns(journal).txns, [], '归档后不再出现在待恢复列表里');
});

// ══════════════════════════════════════════════════════ 执行器：正常路径

test('TX-E1 正常移动走完七步：CLEANED · 源已删 · 目标字节一致 · 索引恰好调一次 · staging 已清', () => {
  const { lib, journal } = setup('e1');
  const idx = spyIndex();
  const ex = createTxnExecutor({ journalDir: journal, indexPort: idx.port });
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const before = sha1File(src);

  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'move-folder',
    files: [{ role: 'image', src, dst }],
  });

  assert.equal(r.outcome, 'committed');
  assert.equal(exists(src), false, '§3 ⑦：CLEANED 之后源才被删');
  assert.equal(exists(dst), true);
  assert.equal(sha1File(dst), before, '字节必须一致（staging 校验的意义就在这里）');
  assert.equal(idx.calls.length, 1, '§3 ⑥：索引恰好更新一次');
  assert.equal(idx.calls[0].txnId, r.txnId);
  assert.equal(exists(path.join(lib, 'CR', '.gs-staging')), false, 'staging 目录不该留在素材库里');
  assert.deepEqual(
    listTxns(journal).txns.map((t) => t.state),
    [S.CLEANED],
  );
});

test('TX-E2 ⭐⭐ 规则①：**索引更新失败 ⇒ 源绝不能删**（否则"文件没了、索引还指着它"）', () => {
  const { lib, journal } = setup('e2');
  const ex = createTxnExecutor({
    journalDir: journal,
    indexPort: {
      update: () => {
        throw new Error('索引写坏了');
      },
    },
  });
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const before = sha1File(src);

  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'move-folder',
    files: [{ role: 'image', src, dst }],
  });

  assert.equal(r.outcome, 'recovery_needed', '索引失败必须停在需要恢复，而不是"成功"');
  assert.equal(exists(src), true, '⭐ 规则①：索引没更新成功，源**必须还在**');
  assert.equal(sha1File(src), before, '而且字节没变');
  assert.equal(exists(dst), true, '目标已经是最终名（这一步已经做完了）—— 所以只能前进，不能回退');
  // 日志状态：COMMITTED 之后才更新索引 ⇒ 失败时停在 RECOVERY_NEEDED
  assert.deepEqual(
    listTxns(journal).txns.map((t) => t.state),
    [S.RECOVERY_NEEDED],
  );
});

test('TX-E3 ⭐⭐ 规则②：目标已存在且**字节不同** ⇒ 拒绝，且**一个字节都不许动**', () => {
  const { lib, journal } = setup('e3');
  const idx = spyIndex();
  const ex = createTxnExecutor({ journalDir: journal, indexPort: idx.port });
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'VR', 'VR-103.jpg'); // 已存在，且内容不同
  const dstBefore = sha1File(dst);

  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'rename-id',
    files: [{ role: 'image', src, dst }],
  });

  assert.equal(r.outcome, 'aborted');
  assert.match(r.detail, /占用|不同/);
  assert.equal(sha1File(dst), dstBefore, '⭐ 规则②：目标文件一个字节都不许变');
  assert.equal(exists(src), true, '源也不许动');
  assert.equal(idx.calls.length, 0, '索引不该被更新');
  assert.deepEqual(listTxns(journal).txns, [], '§8 第 1 例：预检失败 ⇒ 日志都不写（什么都没发生）');
});

test('TX-E3b ⭐ 规则②的**幂等**那一半：目标字节相同 ⇒ 视为已命中、跳过该文件而不是再写一遍', () => {
  const { lib, journal } = setup('e3b');
  const idx = spyIndex();
  const ex = createTxnExecutor({ journalDir: journal, indexPort: idx.port });
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  fs.copyFileSync(src, dst); // 目标已是同一份内容
  const srcSha = sha1File(src);

  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'move-folder',
    files: [{ role: 'image', src, dst }],
  });

  assert.equal(r.outcome, 'committed', '同内容 ⇒ 幂等命中，不该当成"被占用"而失败');
  assert.equal(sha1File(dst), srcSha, '目标内容不变');
  assert.equal(exists(src), false, '幂等命中后仍应完成收尾（源被清理）');
  assert.equal(r.rec.files[0]._idempotent, true, '应被标记为幂等命中');
});

test('TX-E3c ⭐⭐ `src === dst` 必须被拒绝（否则"幂等命中 + 清源"会把文件本身删掉）', () => {
  const { lib, journal } = setup('e3c');
  const ex = createTxnExecutor({ journalDir: journal, indexPort: spyIndex().port });
  const p = path.join(lib, 'VR', 'VR-101.jpg');
  const before = sha1File(p);

  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'rename-id',
    files: [{ role: 'image', src: p, dst: p }],
  });

  assert.equal(r.outcome, 'aborted');
  assert.match(r.detail, /源与目标相同/);
  assert.equal(exists(p), true, '⭐ 文件必须还在');
  assert.equal(sha1File(p), before, '而且字节没变');
});

test('TX-E4 预检：源不存在 ⇒ 不写日志、不动任何东西', () => {
  const { lib, journal } = setup('e4');
  const ex = createTxnExecutor({ journalDir: journal, indexPort: spyIndex().port });
  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'move-folder',
    files: [
      {
        role: 'image',
        src: path.join(lib, 'VR', '不存在.jpg'),
        dst: path.join(lib, 'CR', 'x.jpg'),
      },
    ],
  });
  assert.equal(r.outcome, 'aborted');
  assert.equal(r.rec, null, '预检失败不该产生事务记录');
  assert.deepEqual(listTxns(journal).txns, []);
});

test('TX-E4b 多文件事务：图 + 包一起移动，两条都要到目标、源都要清干净', () => {
  const { lib, journal } = setup('e4b');
  const idx = spyIndex();
  const ex = createTxnExecutor({ journalDir: journal, indexPort: idx.port });
  const files = [
    {
      role: 'image',
      src: path.join(lib, 'VR', 'VR-101.jpg'),
      dst: path.join(lib, 'CR', 'VR-101.jpg'),
    },
    {
      role: 'archive',
      src: path.join(lib, 'VR', 'VR-101.rar'),
      dst: path.join(lib, 'CR', 'VR-101.rar'),
    },
  ];
  const shas = files.map((f) => sha1File(f.src));
  const r = ex.runMove({ libId: 'lib-a', uid: 'a1', op: 'move-folder', files });

  assert.equal(r.outcome, 'committed');
  files.forEach((f, i) => {
    assert.equal(exists(f.src), false, `源应已清：${f.src}`);
    assert.equal(exists(f.dst), true, `目标应有：${f.dst}`);
    assert.equal(sha1File(f.dst), shas[i], '字节一致');
  });
  assert.equal(idx.calls[0].files.length, 2, '索引更新要带上两个文件');
});

// ══════════════════════════════════════════════════════ 空间核算（§6）

test('TX-C1 ⭐ 空间核算用**目标所在目录**（相对路径也不许静默失败）', () => {
  const { lib, journal } = setup('c1');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  // 相对路径曾让 path.parse(...).root === '' ⇒ statfs('') ENOENT ⇒ 整条流程静默 abort（实测踩过）
  const relSrc = path.relative(process.cwd(), src);
  const relDst = path.relative(process.cwd(), dst);
  const sp = checkSpace([{ src: relSrc, dst: relDst }]);
  assert.equal(sp.ok, true, `相对路径也必须能算出空间：${sp.reason || ''}`);
  assert.ok(sp.need > 0);
  assert.ok(sp.details[0].free > 0, '应真的拿到可用字节');
  assert.equal(freeBytesOn(lib) !== null, true, '目标目录本身能 statfs');
});

test('TX-C2 ⭐ 空间不足 ⇒ **在 PREPARED 之前拒绝**，给出"需要 X、可用 Y"（§6）', () => {
  const { lib } = setup('c2');
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  // extraBytes 由调用方注入（规格里那几项随决策变化 ⇒ 不许在本模块写死）
  const sp = checkSpace([{ src, dst }], { extraBytes: Number.MAX_SAFE_INTEGER });
  assert.equal(sp.ok, false);
  assert.match(sp.reason, /空间不足/);
  assert.match(sp.reason, /需要 \d+ B、可用 \d+ B/, '必须给出具体数字（不许只说"空间不足"）');
});

test('TX-C3 没有 PREPARED 就不该有日志：空间不足时事务根本不开始', () => {
  const { lib, journal } = setup('c3');
  const ex = createTxnExecutor({ journalDir: journal, indexPort: spyIndex().port });
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const r = ex.runMove({
    libId: 'lib-a',
    uid: 'a1',
    op: 'move-folder',
    files: [{ role: 'image', src, dst }],
    extraBytes: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(r.outcome, 'aborted');
  assert.equal(r.rec, null);
  assert.deepEqual(listTxns(journal).txns, [], '§6：空间不足要在 PREPARED 之前拒绝');
  assert.equal(exists(src), true);
});

// ══════════════════════════════════════════════════════ 注入口的形态

test('TX-P1 staging 路径形态与 §1 示例一致：落在**目标目录**下的 `.gs-staging/<txnId>/`', () => {
  // ⚠️ 刻意**不写任何字面盘符**（§7/P3：不把本机绝对路径写进代码）。卷根从当前环境派生，
  //    断言的仍然是"staging 落在目标文件所在目录下"这个**形状**。
  const root = path.parse(process.cwd()).root; // 当前卷根，本文件里不出现任何盘符字面量
  const dst = path.join(root, 'lib', 'VR', 'ID-1.jpg');
  const p = stagingPathFor(dst, 'txnX');
  assert.equal(p, path.join(root, 'lib', 'VR', '.gs-staging', 'txnX', 'ID-1.jpg'));
  assert.equal(
    path.dirname(p).startsWith(path.dirname(dst)),
    true,
    'staging 必须在目标**同卷同目录**下（§3 ⑤ 的同卷 rename 依赖它）',
  );
});

test('TX-P2 注入点清单覆盖 §8 的 8 个位置（跨卷与重复恢复由测试额外驱动）', () => {
  assert.deepEqual(
    [...CRASH_POINTS],
    [
      'before-prepared',
      'after-prepared',
      'mid-staging',
      'after-staging',
      'after-verified',
      'mid-rename',
      'after-commit',
      'after-index',
    ],
  );
});

test('TX-P3 缺 `indexPort` 必须**拒绝构造**（否则"索引成功后才清源"无从保证）', () => {
  const { journal } = setup('p3');
  assert.throws(() => createTxnExecutor({ journalDir: journal }), /indexPort/);
  assert.throws(() => createTxnExecutor({ indexPort: { update() {} } }), /journalDir/);
});

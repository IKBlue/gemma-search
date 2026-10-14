// packages/engine/tests/transactions-fault-injection.test.mjs
// —— 规格 §8「故障注入测试（实现该模块时的硬门禁）」的 10 例
//
// §8 原文的硬要求：「必须**真的杀进程**，不能只做代码评审。在每个状态边界各注入一次」。
// ⇒ 本文件用 `spawn` + `child.kill()` **真的把子进程杀掉**，然后**在父进程里**跑一次启动恢复，
//    断言盘上留下的状态与 §8 的期望一致。
//
// ⚠️ 为什么必须真杀：抛异常会被 `catch` 接住（例如 rename 循环的 catch 把它变成 RECOVERY_NEEDED），
//    而进程真被杀时**没有任何 JS 收尾** ⇒ 日志停在被杀前的状态，恢复才能按 §4 前进。
//    两者的盘上状态不一样，所以"用异常模拟"会得出**错误的结论**（第一版就这么被误导过）。
//
// ⚠️ 只对 `data/_txn-test/` 下的夹具副本写。绝不碰真实素材库。
//
// 覆盖：§8 第 1–8 例（同卷，逐边界）+ 第 10 例（重复恢复幂等）。
// ❌ **第 9 例（跨卷 G:→E: 与拔盘）本环境无法验证** —— 见文件末尾 `FI-09` 的如实记录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTxns } from '../src/transactions/journal.ts';
import { sha1File } from '../src/transactions/hash.ts';
import { recoverJournal } from '../src/transactions/recovery.ts';

const CHILD = fileURLToPath(new URL('./helpers/txn-crash-child.mjs', import.meta.url));
const FIXTURE = path.resolve('fixtures/lib-a');
const WORK = path.resolve('data/_txn-test');

/** 每个边界：被杀之后**盘上应该是什么状态**，以及**恢复应该得出什么** */
const CASES = {
  'before-prepared': {
    journal: [], recover: { aborted: 0, committed: 0, recoveredFile: false },
    why: '§8 第 1 例：写 PREPARED 前被杀 ⇒ 什么都没发生，重试即可',
  },
  'after-prepared': {
    journal: ['PREPARED'], recover: { aborted: 1, committed: 0 },
    why: '§8 第 2 例：PREPARED 后被杀 ⇒ 恢复=回退；源完好',
  },
  'mid-staging': {
    journal: ['PREPARED'], recover: { aborted: 1, committed: 0 },
    why: '§8 第 3 例：staging 写到一半 ⇒ 恢复=回退；staging 被清理；源完好',
  },
  'after-staging': {
    journal: ['STAGED'], recover: { aborted: 0, committed: 1 },
    why: '§8 第 4 例：staging 完成、校验前 ⇒ 校验后前进或回退都可接受，但必须确定（这里是前进）',
  },
  'after-verified': {
    journal: ['VERIFIED'], recover: { aborted: 0, committed: 1 },
    why: '§8 第 5 例：校验通过、rename 前 ⇒ 恢复=前进',
  },
  'mid-rename': {
    journal: ['VERIFIED'], recover: { aborted: 0, committed: 1 },
    why: '§8 第 6 例：图已 rename、包未 rename ⇒ 恢复=把包也 rename（前进），不留半截',
  },
  'after-commit': {
    journal: ['COMMITTED'], recover: { aborted: 0, committed: 1 },
    why: '§8 第 7 例：rename 完成、索引未更新 ⇒ 恢复=更新索引；绝不出现索引指向不存在的文件',
  },
  'after-index': {
    journal: ['COMMITTED'], recover: { aborted: 0, committed: 1 },
    why: '§8 第 8 例：索引已更新、源未删 ⇒ 恢复=删源（且**不得重复更新索引**）',
  },
};

const exists = (p) => fs.existsSync(p);

function setup(tag) {
  const base = path.join(WORK, `fi-${tag}`);
  fs.rmSync(base, { recursive: true, force: true });
  const lib = path.join(base, 'lib');
  const journal = path.join(base, 'journal');
  const marker = path.join(base, 'marker');
  fs.cpSync(FIXTURE, lib, { recursive: true });
  fs.mkdirSync(journal, { recursive: true });
  fs.mkdirSync(marker, { recursive: true });
  return { base, lib, journal, marker };
}

/**
 * 启动子进程，**等它到达注入点，然后真的杀掉它**。
 *
 * 判据（两条都必须成立，才叫"真的杀了"）：
 *   ① `boundary.json` 存在 ⇒ 确实杀在预期的那个边界上（不是"没跑到就超时"）
 *   ② `done.json` **不存在** ⇒ 事务从未正常跑完 ⇒ 它是被中途终结的
 */
function killAtBoundary({ lib, journal, marker }, crashPoint, { patienceMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const boundary = path.join(marker, 'boundary.json');
    const child = spawn(process.execPath, [
      CHILD, lib, journal, crashPoint, marker, 'VR/VR-101.jpg', 'CR/VR-101.jpg',
    ], { stdio: 'ignore' });

    let terminated = false;
    let settle = null;
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (exists(boundary)) {                       // 到达边界 ⇒ 立刻杀（这就是 §8 要的"杀进程"）
        terminated = true;
        clearInterval(timer);
        child.kill('SIGKILL');
      } else if (Date.now() - t0 > patienceMs) {
        clearInterval(timer);
        child.kill('SIGKILL');
      }
    }, 15);

    child.on('error', (e) => { clearInterval(timer); reject(e); });
    child.on('exit', (code, signal) => {
      clearInterval(timer);
      settle = {
        code, signal, terminated,
        reachedBoundary: exists(boundary),
        finishedNormally: exists(path.join(marker, 'done.json')),
        elapsedMs: Date.now() - t0,
      };
      resolve(settle);
    });
  });
}

const indexCalls = (marker) => {
  const p = path.join(marker, 'index-called.json');
  return exists(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
};

for (const [crashPoint, expect] of Object.entries(CASES)) {
  test(`FI ${crashPoint} —— ${expect.why}`, async () => {
    const ctx = setup(crashPoint);
    const { lib, journal, marker } = ctx;
    const src = path.join(lib, 'VR', 'VR-101.jpg');
    const srcArc = path.join(lib, 'VR', 'VR-101.rar');
    const dst = path.join(lib, 'CR', 'VR-101.jpg');
    const dstArc = path.join(lib, 'CR', 'VR-101.rar');
    const origImg = sha1File(src);
    const origArc = sha1File(srcArc);

    // ── ① 真杀 ────────────────────────────────────────────────────
    const run = await killAtBoundary(ctx, crashPoint);
    assert.equal(run.reachedBoundary, true,
      `子进程没到达注入点 ${crashPoint}（它是被超时杀的，不能算数）：${JSON.stringify(run)}`);
    assert.equal(run.finishedNormally, false,
      '⭐ 事务居然正常跑完了 ⇒ 这不是"被杀"，本用例无效');
    assert.equal(run.terminated, true, `必须是由父进程在边界上终结的：${JSON.stringify(run)}`);

    // ── ② 盘上留下的日志状态 ──────────────────────────────────────
    const onDisk = listTxns(journal).txns.map((t) => t.state);
    assert.deepEqual(onDisk, expect.journal,
      `被杀之后日志状态应为 ${JSON.stringify(expect.journal)}，实际 ${JSON.stringify(onDisk)}`);

    // ── ③ ⭐⭐ 素材绝不许丢（§8 总判据）───────────────────────────
    const liveFiles = [...listTxns(journal).txns.flatMap((t) => t.files || [])];
    const staged = liveFiles.map((f) => f.stage).filter(Boolean);
    const findImg = [src, dst, ...staged, ...staged.map((s) => s.replace(/\\[^\\]+$/, '\\VR-101.jpg'))]
      .filter((p) => p && exists(p) && sha1File(p) === origImg);
    const findArc = [srcArc, dstArc, ...staged]
      .filter((p) => p && exists(p) && sha1File(p) === origArc);
    assert.ok(findImg.length >= 1,
      `⭐ 图的原始字节必须还能在盘上找到（源/目标/staging 之一），实际一个都没有 —— 这是丢素材`);
    assert.ok(findArc.length >= 1,
      `⭐ 包的原始字节必须还能在盘上找到，实际一个都没有`);

    // ── ④ 跑一次启动恢复（相当于"重启应用"）──────────────────────
    const idx = [];
    const out = recoverJournal({ journalDir: journal, indexPort: { update: (c) => idx.push(c) } });
    assert.equal(out.summary.aborted, expect.recover.aborted,
      `恢复后 aborted 应为 ${expect.recover.aborted}：${JSON.stringify(out.results)}`);
    assert.equal(out.summary.committed, expect.recover.committed,
      `恢复后 committed 应为 ${expect.recover.committed}：${JSON.stringify(out.results)}`);
    assert.equal(out.summary.recoveryNeeded, 0,
      `这些边界都该能**确定**地收场（§8：结果确定且可复现），不该问人：${JSON.stringify(out.pending)}`);
    assert.equal(out.broken.length, 0, '不该留下读不出来的日志');

    // ── ⑤ 收场之后：该前进的必须真的前进，该回退的源必须完好 ──────
    if (expect.recover.committed === 1) {
      assert.equal(exists(dst), true, '应推进到最终名');
      assert.equal(sha1File(dst), origImg, '目标字节必须与原图一致');
      assert.equal(exists(dstArc), true, '包也必须推进到最终名（§8 第 6 例：不留半截）');
      assert.equal(sha1File(dstArc), origArc, '包字节一致');
      assert.equal(exists(src), false, '收尾时源应被清理');
      assert.equal(exists(srcArc), false);
      assert.equal(idx.length + indexCalls(marker).length >= 1, true, '索引必须被更新过至少一次');
      // §8 第 8 例额外要求：索引已更新过 ⇒ 恢复**不得重复更新**
      if (crashPoint === 'after-index') {
        assert.equal(indexCalls(marker).length, 1, '被杀前索引恰好更新过一次');
        assert.equal(idx.length, 0, '⭐ 恢复**不得**再更新一次索引（幂等）');
      }
    } else {
      assert.equal(exists(src), true, '回退情形下源必须完好');
      assert.equal(sha1File(src), origImg, '源字节未变');
      assert.equal(exists(dst), false, '回退情形下不该产生最终文件');
    }

    // ── ⑥ 崩溃现场：staging 不该留在素材库里 ──────────────────────
    assert.equal(exists(path.join(lib, 'CR', '.gs-staging')), false,
      '恢复收场后 staging 目录不该留在素材库里');
  });
}

test('FI-10 ⭐⭐ 同一事务**重复恢复两次**：幂等 —— 第二次不改动任何东西（§8 第 10 例）', async () => {
  const ctx = setup('repeat');
  const { lib, journal, marker } = ctx;
  const src = path.join(lib, 'VR', 'VR-101.jpg');
  const dst = path.join(lib, 'CR', 'VR-101.jpg');
  const origImg = sha1File(src);

  const run = await killAtBoundary(ctx, 'after-commit');
  assert.equal(run.reachedBoundary, true);
  assert.equal(run.finishedNormally, false);

  const idx1 = [];
  const first = recoverJournal({ journalDir: journal, indexPort: { update: (c) => idx1.push(c) } });
  assert.equal(first.summary.committed, 1, '第一次恢复应把它做完');
  const dstSha = sha1File(dst);
  assert.equal(exists(src), false, '源已清');

  // 第二次恢复：日志已归档 ⇒ 扫不到任何东西
  const idx2 = [];
  const second = recoverJournal({ journalDir: journal, indexPort: { update: (c) => idx2.push(c) } });
  assert.equal(second.summary.scanned, 0, '⭐ 第二次不该再扫到未完成事务');
  assert.equal(idx2.length, 0, '⭐ 第二次不该再更新索引');
  assert.equal(sha1File(dst), dstSha, '目标内容一模一样');
  assert.equal(exists(dst), true);
  assert.equal(indexCalls(marker).length, 0, '被杀那一刻索引还没更新（这正是 after-commit 的含义）');
  assert.equal(origImg, dstSha, '（对照）目标就是我们原来那份字节');
});

test('FI-09 ⚠️ 跨卷（G:→E:）与"E: 拔盘" —— **本环境未验证**，如实记录（§8 第 9 例）', () => {
  // §8 第 9 例要求：跨卷（G:→E:）在第 3/5/7 点各注入一次，且"E: 拔盘"时预期停在 RECOVERY_NEEDED。
  //
  // ❌ **本环境跑不了，理由（实测，不是推测）**：
  //   ① 当前文件策略是 **workspace-write**，只能写会话工作区（`D:\USERS\Desktop\Agent\gemma-search`）；
  //      跨卷测试必须往另一个卷写 staging，会被沙箱拒。
  //   ② 本机虽有 C: / D: / E: / G: 四个卷（实测 `statfsSync` 都拿得到剩余空间），
  //      但按规格 E: 是**取件/移出保留区**、G: 是**库盘** —— 往那里写测试数据属于碰真实数据，
  //      与「绝不对真实素材库跑」的纪律冲突。
  //   ③ "拔盘"需要物理或 VHDX 层面的卸载，沙箱内无法模拟。
  //
  // ⇒ 本用例**不假装通过**：它断言的是"跨卷分支**没有被验证**"这个事实本身，
  //    以免以后有人看到 §8 有 10 条就以为 10 条都测过了。
  const covered = Object.keys(CASES).length;
  assert.equal(covered, 8, '同卷的 8 个边界已覆盖（第 1–8 例）');
  const UNVERIFIED_CROSS_VOLUME = {
    specCase: 9,
    what: '跨卷 G:→E: 在"第 3/5/7 点"各注入一次；以及 E: 拔盘时停在 RECOVERY_NEEDED',
    why: [
      '沙箱文件策略为 workspace-write，跨卷写 staging 会被拒',
      'E: 是取件区、G: 是库盘 —— 往那里写测试数据会碰真实数据，违反"绝不对真实库跑"',
      '拔盘需要在操作系统层卸载卷，沙箱内无法模拟',
    ],
    howToVerify: '在一台有**两个可写空卷**的机器上：把夹具复制到卷 A，dst 指向卷 B，'
      + '照本文件同样的 kill+恢复流程各跑一次；拔盘用 VHDX 挂载/卸载模拟。',
  };
  assert.ok(UNVERIFIED_CROSS_VOLUME.howToVerify.length > 0);
  console.log('  ⚠️ §8 第 9 例（跨卷 / 拔盘）**未验证**：' + UNVERIFIED_CROSS_VOLUME.why.join('；'));
});

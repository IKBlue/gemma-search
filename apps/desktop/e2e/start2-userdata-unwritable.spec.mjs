// apps/desktop/e2e/start2-userdata-unwritable.spec.mjs —— START-2：userData 不可写时的**降级路径**（进常规门禁）
//
// 来源：START-1 的副产品——那条路径**实测到过**（产品行为正确：不崩 + 如实记日志 + 继续跑），
//   但此前**没有任何自动化守着**：下次谁把它改成"静默吞掉"，不会有东西变红。
//
// ── 怎么**确定性地**造出"userData 不可写"（关键：触发器必须是我们的，不能是环境的）──
//   建一个真目录 data/_start2/ud-blocked，用 icacls **显式拒绝当前用户的写权限**，
//   再把它当 --user-data-dir 传进去。
//   ⚠️ 试过并**否掉**的方案：把 --user-data-dir 指向一个**文件**。
//      实测（2026-10-16）：Electron **忽略**无效的 user-data-dir，回落到默认 userData
//      （%APPDATA%\Electron）—— 而那条路径恰好被本执行环境的沙箱写限制挡住，
//      于是测试会"绿得毫无意义"：它实际测的是**环境**，不是我们构造的条件。
//      日志证据：探测结果里出现的是 C:\Users\...\AppData\Roaming\Electron，**不是**我们传的路径。
//   ⚠️ 也刻意**不**用"工作区外的临时目录"：那个 EPERM 同属环境行为（START-1 已定性）。
//
// ── 断言三条（卡片 §2）────────────────────────────────────────────────────
//   ① **不崩**：窗口照常出现；
//   ② **如实记日志**：「单实例锁不可用 + userData 不可写（带路径与原因）」与「app.db 操作失败」各一条；
//   ③ **应用仍可用**：主界面出现（#query）+ 一条真 IPC 往返成功（日志里的 invoke … → ok）。
//
// ⚠️ 本用例**不加 GEMMA_PERF 门控**：它是产品降级行为的守卫，必须进常规 e2e 门禁
//    （与那几个"默认 skip 的探针"口径不同——探针是量具，这是断言）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import { FIXTURE_LIB } from './helpers/app.mjs';
import { firstWindow, launchApp, ROOT } from './helpers/launch.mjs';

const APP_LOG = path.join(ROOT, 'data', '_app.log');
const BLOCK_DIR = path.join(ROOT, 'data', '_start2');
/** 这个目录**存在但写不了**（ACL 显式拒绝当前用户写）—— 触发器是我们造的，不是环境给的 */
const BLOCKED_USER_DATA = path.join(BLOCK_DIR, 'ud-blocked');

/** 起始清理：恢复继承 ACL 再删目录（带走 deny ACE 的目录删不掉 —— 实测踩到） */
function cleanBlockDir() {
  if (!fs.existsSync(BLOCK_DIR)) return;
  const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
  try {
    execFileSync('icacls', [BLOCK_DIR, '/reset'], { stdio: 'ignore' });
    execFileSync('icacls', [BLOCK_DIR, '/grant', user + ':(OI)(CI)F'], { stdio: 'ignore' });
  } catch {
    /* 尽力而为；下面 rmSync 会给出真实错误 */
  }
  fs.rmSync(BLOCK_DIR, { recursive: true, force: true });
}

/** 拒绝/恢复当前用户对该目录的写权限（deny 优先于 allow ⇒ 与"所有者"无关） */
function setWritable(dir, writable) {
  const user = execFileSync('whoami', { encoding: 'utf8' }).trim();
  if (writable) {
    execFileSync('icacls', [dir, '/remove:d', user], { stdio: 'ignore' });
    execFileSync('icacls', [dir, '/reset'], { stdio: 'ignore' });
  } else {
    execFileSync(
      'icacls',
      [dir, '/inheritance:r', '/grant:r', user + ':(OI)(CI)(RX)', '/deny', user + ':(OI)(CI)(W)'],
      { stdio: 'ignore' },
    );
  }
}

test('START-2 ⭐ userData 不可写：不崩 + 如实记日志（单实例锁 / app.db）+ 应用仍可用', async () => {
  // 这个上限不是"调大超时掩盖问题"：这条路径会先撞上 Chromium 对被拒缓存目录的重试（~6 s，START-1 已测得），
  // 而断言全是**结构性**的（窗口/日志/一次 IPC 成功），没有一条依赖"多快"。给到 120 s 只是别让慢机器误红。
  test.setTimeout(120_000);
  // 起始清理：先**恢复 ACL**再删（上一轮若在中途崩了，目录会带着 deny ACE 留在盘上，
  // 而 deny 过的目录连删都删不掉 —— 这是实测踩到的，别把顺序写反）。
  cleanBlockDir();
  fs.mkdirSync(BLOCKED_USER_DATA, { recursive: true });
  setWritable(BLOCKED_USER_DATA, false);
  // 先自证触发器真的生效（否则后面三条断言都是在测环境）：
  let denied = false;
  try {
    fs.writeFileSync(path.join(BLOCKED_USER_DATA, 'self-probe.txt'), 'x');
  } catch {
    denied = true;
  }
  expect(denied, '触发器没生效：这个目录必须**真的写不进去**（ACL 拒绝当前用户写）').toBe(true);

  const app = await launchApp({
    env: { GEMMA_CONFIG: '', GEMMA_LIB_ROOT: FIXTURE_LIB, GEMMA_FAKE: '' },
    extraArgs: ['--user-data-dir=' + BLOCKED_USER_DATA],
  });
  try {
    // ① 不崩：窗口照常出现（userData 不可写**不该**让应用起不来）
    const win = await firstWindow(app, 30_000);

    // ③ 应用仍可用（一）：主界面在（有库 ⇒ 进主界面，不是首启向导）
    await win.waitForSelector('#query', { timeout: 30_000 });

    const log = fs.readFileSync(APP_LOG, 'utf8');
    console.log(
      '[start2] 关键日志：\n' +
        log
          .split(/\r?\n/)
          .filter((l) => /单实例锁|不可写|app\.db 操作失败|→ ok|temp\]/.test(l))
          .slice(0, 12)
          .join('\n'),
    );

    // ② 如实记日志：单实例锁（含**我们那个**路径与原因）
    expect(log, '必须如实报「单实例锁不可用」而不是静默').toMatch(/单实例锁不可用/);
    expect(log, '必须写明原因（userData 不可写）').toMatch(/userData 不可写/);
    expect(log, '原因里必须带**被拒的那个路径**（证明触发的是我们构造的条件）').toContain(
      BLOCKED_USER_DATA,
    );
    expect(log, '要带原始系统原因，不许只说"失败了"').toMatch(/EPERM|EACCES|ENOTDIR|拒绝访问/);
    // ② 如实记日志：app.db
    expect(log, '必须如实报「app.db 操作失败」而不是静默').toMatch(/app\.db 操作失败/);
    expect(log, 'app.db 失败要带原始原因').toMatch(
      /unable to open database file|EPERM|EACCES|ENOTDIR/,
    );

    // ③ 应用仍可用（二）：一条真 IPC 往返仍然成功
    expect(log, 'userData 不可写时基础读操作仍要能用').toMatch(
      /invoke (libraryList|indexStatus) .*→ ok/,
    );
  } finally {
    await app.close().catch(() => {});
    setWritable(BLOCKED_USER_DATA, true);
    fs.rmSync(BLOCK_DIR, { recursive: true, force: true });
  }
});

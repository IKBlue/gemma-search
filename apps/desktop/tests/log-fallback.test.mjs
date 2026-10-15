// apps/desktop/tests/log-fallback.test.mjs —— T-22b：日志落点 + **写不进去必须可见**（不许静默）
//
// 为什么要有这条：T-22a 第一次真打包实测到打包态"零日志"（ROOT=asar ⇒ 目标不可写，而三处写入都在
// try/catch 里静默失败）。修法两条：① 打包态落 <userData>/logs ② 失败必须**大声报**（N7 诊断面板读 logStatus()）。
// 本文件断言的是 ② 与"非打包态的默认落点没被改坏"；打包态落 userData 由 22b.txt 的真打包实测负责
// （PACKED 由 HERE 是否含 app.asar 决定，单测里造不出 asar）。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const LOG_TS = fileURLToPath(new URL('../src/main/log.ts', import.meta.url));

test('L1 非打包态默认日志落点 = <ROOT>/data/_app.log，且写得进去（子进程跑，避免与本文件的毒化用例抢模块缓存）', () => {
  const env = Object.assign({}, process.env);
  delete env.GEMMA_APP_LOG; // 显式清掉：父进程/CI 设了它就不测默认分支了
  // ⚠️ Windows 上动态 import 绝对路径必须给 file:// URL（裸 D:\… 会 ERR_UNSUPPORTED_ESM_URL_SCHEME）
  const code =
    'const m = await import(' +
    JSON.stringify(pathToFileURL(LOG_TS).href) +
    ');' +
    'console.log("RESULT" + JSON.stringify({ root: m.ROOT, file: m.LOG_FILE, status: m.logStatus() }));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env,
    encoding: 'utf8',
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应当打出 RESULT 行');
  const r = JSON.parse(line.slice('RESULT'.length));
  assert.equal(
    r.file,
    path.join(r.root, 'data', '_app.log'),
    '非打包态默认落点必须是 <ROOT>/data/_app.log',
  );
  assert.equal(r.status.ok, true, '仓库内是可写的，logStatus().ok 应当是 true');
  assert.equal(r.status.failures, 0);
});

test('L2 写不进去 ⇒ **可见**：logStatus() 报错 + stderr/stdout 上有大声一行（不许静默吞掉）', () => {
  // ⚠️ **必须开子进程**（第一版写成同进程，被 npm test 抓出来）：
  //    LOG_FILE 在 log.ts 的**模块顶层**算一次；npm test 是 --test-isolation=none（一个进程跑所有文件），
  //    只要**任何**别的测试文件先 import 过 log.ts（例如 library-ipc.ts 那条链），模块就被缓存，
  //    本进程里再设 GEMMA_APP_LOG 也不会重算 ⇒ 这条会变成"看谁先 import"的运气测试（单独跑绿、全量跑红）。
  //    子进程 = 全新模块注册表 ⇒ 必然走导入期初始化，与文件顺序无关。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-log-poison-'));
  const blocker = path.join(tmp, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const poison = path.join(blocker, 'app.log');

  const code =
    'const m = await import(' +
    JSON.stringify(pathToFileURL(LOG_TS).href) +
    ');' +
    'const first = m.logStatus();' +
    'const threw = (() => { try { m.log("测试：写不进去也不能抛"); return false; } catch { return true; } })();' +
    'console.log("RESULT" + JSON.stringify({ file: m.LOG_FILE, first, threw, second: m.logStatus() }));';
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: Object.assign({}, process.env, { GEMMA_APP_LOG: poison }),
    encoding: 'utf8',
  });
  const all = String(r.stdout || '') + String(r.stderr || '');

  const line = String(r.stdout || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应当打出 RESULT 行；实际输出：' + all.slice(0, 500));
  const res = JSON.parse(line.slice('RESULT'.length));
  assert.equal(res.file, poison, 'GEMMA_APP_LOG 覆盖必须优先');
  assert.equal(res.first.ok, false, '写不进去时 ok 必须是 false');
  assert.ok(res.first.failures >= 1, '失败要计数（N7 要显示）');
  assert.ok(res.first.error, '失败要有原样错误文本');
  assert.match(
    all,
    /日志写入失败/,
    '必须有一行大声的失败提示（绕开 log() 自身直写 stderr/stdout）',
  );
  assert.match(all, /packed=/, '提示里要有 packed 标志，便于判断是不是打包态');
  assert.equal(res.threw, false, '不能因为日志挂了就让应用挂（log() 仍然不抛）');
  assert.ok(res.second.failures >= 2, '第二次写失败要接着计数');

  fs.rmSync(tmp, { recursive: true, force: true });
});

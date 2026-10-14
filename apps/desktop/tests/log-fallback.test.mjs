// apps/desktop/tests/log-fallback.test.mjs —— T-22b：日志落点 + **写不进去必须可见**（不许静默）
//
// 为什么要有这条：T-22a 第一次真打包实测到打包态"零日志"（ROOT=asar ⇒ 目标不可写，而三处写入都在
// try/catch 里静默失败）。修法两条：① 打包态落 <userData>/logs ② 失败必须**大声报**（N7 诊断面板读 logStatus()）。
// 本文件断言的是 ② 与"非打包态的默认落点没被改坏"；打包态落 userData 由 22b.txt 的真打包实测负责
// （PACKED 由 HERE 是否含 app.asar 决定，单测里造不出 asar）。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const LOG_TS = fileURLToPath(new URL('../src/main/log.ts', import.meta.url));

test('L1 非打包态默认日志落点 = <ROOT>/data/_app.log，且写得进去（子进程跑，避免与本文件的毒化用例抢模块缓存）', () => {
  const env = Object.assign({}, process.env);
  delete env.GEMMA_APP_LOG;                       // 显式清掉：父进程/CI 设了它就不测默认分支了
  // ⚠️ Windows 上动态 import 绝对路径必须给 file:// URL（裸 D:\… 会 ERR_UNSUPPORTED_ESM_URL_SCHEME）
  const code = 'const m = await import(' + JSON.stringify(pathToFileURL(LOG_TS).href) + ');'
    + 'console.log("RESULT" + JSON.stringify({ root: m.ROOT, file: m.LOG_FILE, status: m.logStatus() }));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应当打出 RESULT 行');
  const r = JSON.parse(line.slice('RESULT'.length));
  assert.equal(r.file, path.join(r.root, 'data', '_app.log'), '非打包态默认落点必须是 <ROOT>/data/_app.log');
  assert.equal(r.status.ok, true, '仓库内是可写的，logStatus().ok 应当是 true');
  assert.equal(r.status.failures, 0);
});

test('L2 写不进去 ⇒ **可见**：logStatus() 报错 + stderr/stdout 上有大声一行（不许静默吞掉）', async () => {
  // 毒化：让日志目标的**父路径是一个文件** ⇒ mkdirSync/appendFileSync 必然失败
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-log-poison-'));
  const blocker = path.join(tmp, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const poison = path.join(blocker, 'app.log');
  process.env.GEMMA_APP_LOG = poison;

  const captured = [];
  const origErr = process.stderr.write;
  const origOut = process.stdout.write;
  process.stderr.write = (chunk) => { captured.push(String(chunk)); return true; };
  process.stdout.write = (chunk) => { captured.push(String(chunk)); return true; };
  let mod;
  try {
    mod = await import('../src/main/log.ts');     // 本进程里**第一次**导入 ⇒ 导入期初始化就用毒化路径
  } finally {
    process.stderr.write = origErr;
    process.stdout.write = origOut;
  }

  assert.equal(mod.LOG_FILE, poison, 'GEMMA_APP_LOG 覆盖必须优先');
  const st = mod.logStatus();
  assert.equal(st.ok, false, '写不进去时 ok 必须是 false');
  assert.ok(st.failures >= 1, '失败要计数（N7 要显示）');
  assert.ok(st.error, '失败要有原样错误文本');
  const text = captured.join('');
  assert.match(text, /日志写入失败/, '必须有一行大声的失败提示（绕开 log() 自身直写 stderr/stdout）');
  assert.match(text, /packed=/, '提示里要有 packed 标志，便于判断是不是打包态');

  // 再写一行：仍然失败、仍然不抛（不能因为日志挂了就让应用挂）
  assert.doesNotThrow(() => mod.log('测试：写不进去也不能抛'));
  assert.ok(mod.logStatus().failures >= 2);

  fs.rmSync(tmp, { recursive: true, force: true });
});

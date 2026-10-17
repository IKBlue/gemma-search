// apps/desktop/tests/log-fallback.test.mjs —— T-22b + **TESTISO-1**：日志落点 + 写不进去必须可见
//
// TESTISO-1（2026-10-17）把这里的口径**升级**了：
//   旧行为：log.ts 在**模块导入期**截断 <ROOT>/data/_app.log ⇒ npm test 里任何 import 它的文件都会
//           清空 e2e 正在读的日志（并发跑时假红）。
//   新行为：导入期**零文件 I/O**；落点由 configureLogFile({ path }) 显式给出（主进程按 data_dir 配）；
//           没配置的进程**一个字节都不写**。写入改为**追加**（不截断）。
//   所以本文件断言两件事：① 只 import 不改共享日志 ② 配置的落点写不进去时**仍然大声可见**。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const LOG_TS = fileURLToPath(new URL('../src/main/log.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('L1 ⭐ 只 import 不配置 ⇒ **一字节都不写**（共享 <ROOT>/data/_app.log 逐字节不变）', () => {
  const sharedLog = path.join(ROOT, 'data', '_app.log');
  const before = fs.existsSync(sharedLog) ? fs.readFileSync(sharedLog) : null;
  const env = Object.assign({}, process.env);
  delete env.GEMMA_APP_LOG; // 显式清掉：父进程/CI 设了它就不测默认分支了

  const code =
    'const m = await import(' +
    JSON.stringify(pathToFileURL(LOG_TS).href) +
    ');' +
    'const st0 = m.logStatus();' +
    'const threw = (() => { try { m.log("导入期不该写盘"); return false; } catch { return true; } })();' +
    'const st1 = m.logStatus();' +
    'console.log("RESULT" + JSON.stringify({ root: m.ROOT, file: m.resolveLogFile(), configured: m.isLogFileConfigured(), st0, st1, threw }));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env,
    encoding: 'utf8',
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应当打出 RESULT 行');
  const r = JSON.parse(line.slice('RESULT'.length));

  // ① 诊断口径不变：默认解析路径仍是 <ROOT>/data/_app.log（logStatus 要能显示"该写哪儿"）
  assert.equal(
    r.file,
    path.join(r.root, 'data', '_app.log'),
    '默认落点解析必须是 <ROOT>/data/_app.log',
  );
  // ② **没有配置就不写**：configured=false，也没有失败（没尝试过），log() 不抛
  assert.equal(r.configured, false, '只 import 不 configure ⇒ 本进程不写日志文件');
  assert.equal(r.st1.ok, true, '没有尝试写就不该记失败');
  assert.equal(r.st1.failures, 0);
  assert.equal(r.st1.pending > 0, true, '未配置期间的行进缓冲（配好后再刷进文件）');
  assert.equal(r.threw, false, 'log() 永不抛');
  // ③ ⭐ 共享日志**逐字节不变**（旧行为会在 import 时把它截断 —— 这正是并发假红的根因）
  const after = fs.existsSync(sharedLog) ? fs.readFileSync(sharedLog) : null;
  assert.deepEqual(after, before, '导入 + 调用 log() 不许动共享日志（禁止导入期截断/写盘）');
});

test('L2 配置的落点写不进去 ⇒ **可见**：logStatus 报错 + stderr/stdout 大声一行（不许静默吞掉）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-log-poison-'));
  const blocker = path.join(tmp, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const poison = path.join(blocker, 'app.log');

  const code =
    'const m = await import(' +
    JSON.stringify(pathToFileURL(LOG_TS).href) +
    ');' +
    'const st0 = m.logStatus();' +
    'const st1 = m.configureLogFile({ path: ' +
    JSON.stringify(poison) +
    ' });' +
    'const threw = (() => { try { m.log("测试：写不进去也不能抛"); return false; } catch { return true; } })();' +
    'console.log("RESULT" + JSON.stringify({ file: st1.file, st0ok: st0.ok, st1, threw, after: m.logStatus() }));';
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: Object.assign({}, process.env, { GEMMA_APP_LOG: '' }),
    encoding: 'utf8',
  });
  const all = String(res.stdout || '') + String(res.stderr || '');
  const line = String(res.stdout || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应当打出 RESULT 行；实际输出：' + all.slice(0, 500));
  const r = JSON.parse(line.slice('RESULT'.length));

  assert.equal(r.file, poison, 'configureLogFile 给的落点必须生效');
  assert.equal(r.st1.configured, true);
  assert.equal(r.st1.ok, false, '写不进去时 ok 必须是 false');
  assert.ok(r.st1.failures >= 1, '失败要计数（N7 要显示）');
  assert.ok(r.st1.error, '失败要有原样错误文本');
  assert.match(
    all,
    /日志写入失败/,
    '必须有一行大声的失败提示（绕开 log() 自身直写 stderr/stdout）',
  );
  assert.match(all, /packed=/, '提示里要有 packed 标志，便于判断是不是打包态');
  assert.equal(r.threw, false, '不能因为日志挂了就让应用挂（log() 仍然不抛）');
  assert.ok(r.after.failures >= 1, '后续写失败要继续计数');

  fs.rmSync(tmp, { recursive: true, force: true });
});

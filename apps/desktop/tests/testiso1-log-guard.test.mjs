// apps/desktop/tests/testiso1-log-guard.test.mjs —— TESTISO-1：日志落点/导入期写盘的**机械守卫**
//
// 要守的三件事（全部能红）：
//   G1 **导入期零文件 I/O**：只 import log.ts（不 configure）⇒ 共享 <ROOT>/data/_app.log **逐字节不变**；
//   G2 **落点跟随调用方**：configureLogFile({ path }) 后写的是那个文件，共享文件仍然不动；
//   G3 **源码守卫（对象字面量调用口径）**：
//      · log.ts 里不许有 LOG_FILE 常量 / 不许有 writeFileSync / 不许模块顶层直接 fs.*；
//      · index.ts 必须以 **configureLogFile({ path: … DATA_DIR … })** 这种**对象字面量调用**接线
//        （P8 教训：注释里提到函数名不算证据）；
//      · helpers/app.mjs 每个场景都要暴露 logPath；first-paint/perf/start1-probe 不许再写死共享日志。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { maskComments } from './helpers/source-scan.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const E2E = path.join(ROOT, 'apps', 'desktop', 'e2e');
const LOG_TS = path.join(MAIN, 'log.ts');
const SHARED_LOG = path.join(ROOT, 'data', '_app.log');
const TMP = path.join(ROOT, 'data', '_testiso1', String(process.pid));

function runChild(code, env = {}) {
  const e = Object.assign({}, process.env, env);
  delete e.GEMMA_APP_LOG;
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      code.replace(/__LOG_TS__/g, JSON.stringify(pathToFileURL(LOG_TS).href)),
    ],
    { env: e, encoding: 'utf8' },
  );
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT'));
  assert.ok(line, '子进程应打出 RESULT；实际输出：' + out.slice(0, 400));
  return JSON.parse(line.slice('RESULT'.length));
}

// ============================================================ G1 导入期零文件 I/O

test('G1 ⭐ 只 import 不配置 ⇒ 共享 <ROOT>/data/_app.log **逐字节不变**（禁止导入期截断）', () => {
  const before = fs.existsSync(SHARED_LOG) ? fs.readFileSync(SHARED_LOG) : null;
  const r = runChild(
    'const m = await import(__LOG_TS__);' +
      'm.log("G1：导入期调用 log() 也不该写盘");' +
      'console.log("RESULT" + JSON.stringify({ configured: m.isLogFileConfigured(), status: m.logStatus() }));',
  );
  assert.equal(r.configured, false, '没有 configureLogFile ⇒ 本进程不写文件');
  assert.equal(r.status.ok, true, '没写就没失败');
  const after = fs.existsSync(SHARED_LOG) ? fs.readFileSync(SHARED_LOG) : null;
  assert.deepEqual(after, before, '导入 + log() 不许动共享日志');
});

// ============================================================ G2 落点跟随调用方

test('G2 ⭐ configureLogFile({ path }) ⇒ 写那个文件；共享日志不动', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const target = path.join(TMP, 'app.log');
  const sharedBefore = fs.existsSync(SHARED_LOG) ? fs.readFileSync(SHARED_LOG) : null;
  const r = runChild(
    'const m = await import(__LOG_TS__);' +
      'm.configureLogFile({ path: ' +
      JSON.stringify(target) +
      ' });' +
      'm.log("G2：这一行必须落在 target 里");' +
      'console.log("RESULT" + JSON.stringify({ status: m.logStatus() }));',
  );
  assert.equal(r.status.file, target);
  assert.equal(r.status.configured, true);
  assert.equal(fs.existsSync(target), true, 'target 必须真的被创建（按需创建）');
  const text = fs.readFileSync(target, 'utf8');
  assert.match(text, /=== gemma-search 启动 ===/, '配置前缓冲的头部行要按序刷进文件');
  assert.match(text, /G2：这一行必须落在 target 里/);
  const sharedAfter = fs.existsSync(SHARED_LOG) ? fs.readFileSync(SHARED_LOG) : null;
  assert.deepEqual(sharedAfter, sharedBefore, '写自己的文件时不许碰共享日志');
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ============================================================ G3 源码守卫（对象字面量口径）

test('G3 ⭐ 源码守卫：log.ts 不许导入期写盘/写死落点；index.ts 必须用**对象字面量调用**接线', () => {
  const logCode = maskComments(fs.readFileSync(LOG_TS, 'utf8'));
  // ① 不许再有写死的 LOG_FILE 常量（旧实现的核心；注释被 mask 掉，所以这里命中就是真代码）
  assert.equal(
    /\bLOG_FILE\b/.test(logCode),
    false,
    'log.ts 不许再有 LOG_FILE 常量（落点必须按需解析）',
  );
  // ② 不许有截断式写（writeFileSync 整个禁掉：日志只许 append）
  assert.equal(
    /writeFileSync\s*\(/.test(logCode),
    false,
    'log.ts 不许 writeFileSync（截断 = 假红根因）',
  );
  // ③ 模块顶层不许直接调 fs.*（必须都在函数体内）
  assert.equal(
    new RegExp('^fs\\.(writeFileSync|appendFileSync|mkdirSync)\\(', 'm').test(logCode),
    false,
    'log.ts 模块顶层不许直接 fs.*（导入期零文件 I/O）',
  );

  const idxCode = maskComments(fs.readFileSync(path.join(MAIN, 'index.ts'), 'utf8'));
  // ④ 接线必须是**对象字面量调用**，且路径来自 DATA_DIR（P8：注释里提到函数名不算证据）
  assert.match(
    idxCode,
    /configureLogFile\(\{\s*path:[^}]*DATA_DIR[^}]*\}\)/,
    'index.ts 必须 configureLogFile({ path: … DATA_DIR … }) —— 对象字面量调用，落点跟随 data_dir',
  );

  // ⑤ e2e：每个场景都暴露 logPath（每启动一份日志）
  const helperCode = maskComments(fs.readFileSync(path.join(E2E, 'helpers', 'app.mjs'), 'utf8'));
  const logPathCount = (helperCode.match(/logPath:\s*path\.join\(dataDir,\s*'_app\.log'\)/g) || [])
    .length;
  assert.equal(
    logPathCount,
    4,
    '四个场景 helper 都必须暴露 logPath（实际 ' + String(logPathCount) + '）',
  );

  // ⑥ 三个量具不许再写死共享日志落点
  for (const spec of ['first-paint.spec.mjs', 'perf.spec.mjs', 'start1-probe.spec.mjs']) {
    const code = maskComments(fs.readFileSync(path.join(E2E, spec), 'utf8'));
    assert.equal(
      /path\.join\(ROOT,\s*'data',\s*'_app\.log'\)/.test(code),
      false,
      spec + ' 不许再写死 <ROOT>/data/_app.log（应使用本次启动的 logPath / data_dir）',
    );
  }
});

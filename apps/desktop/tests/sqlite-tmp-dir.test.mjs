// apps/desktop/tests/sqlite-tmp-dir.test.mjs —— T-42：进程临时目录必须落在**应用自有、可写**的地方
//
// 根因（实测，四组对照，见 main/db/tmp-dir.ts 顶部）：
//   导入的写入阶段会让 SQLite 建临时文件；临时目录不可写 ⇒ SQLite 报 "unable to open database file"
//   ⇒ 整条导入回滚成 IMPORT_FAILED（用户以为"重建失败"）。
//   **这个构建读的是 TMP**，而且不会从不可用的 TMP 回退到 TEMP；**SQLITE_TMPDIR 被忽略**。
// 所以修复是"把 TMP/TEMP/TMPDIR/SQLITE_TMPDIR 一起指到 <userData>/tmp"，本文件把这个机制钉住。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { configureProcessTempDir, TEMP_ENV_KEYS, TEMP_DIR_OVERRIDE } from '../src/main/db/tmp-dir.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL = path.join(ROOT, 'data', 'libraries', 'L1');
const TMP = path.join(ROOT, 'data', '_t42', 'tmp-dir-test-' + process.pid);

function fixtureLib() {
  const dir = path.join(TMP, 'lib-' + String(Math.random()).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REAL, 'items.json'), path.join(dir, 'items.json'));
  fs.copyFileSync(path.join(REAL, 'meta.json'), path.join(dir, 'meta.json'));
  return dir;
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of new Set([...TEMP_ENV_KEYS, TEMP_DIR_OVERRIDE, ...Object.keys(overrides)])) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('ST1 默认落点：<userData>/tmp 被建出来，并把 TMP/TEMP/TMPDIR/SQLITE_TMPDIR **一起**指过去', () => {
  const base = path.join(TMP, 'userdata');
  withEnv(Object.fromEntries(TEMP_ENV_KEYS.map((k) => [k, undefined]).concat([[TEMP_DIR_OVERRIDE, undefined]])), () => {
    const r = configureProcessTempDir(base);
    assert.equal(r.dir, path.join(base, 'tmp'), r.why);
    assert.ok(fs.existsSync(path.join(base, 'tmp')), '目录必须真的建出来');
    for (const k of TEMP_ENV_KEYS) {
      assert.equal(process.env[k], path.join(base, 'tmp'), k + ' 必须被指向应用目录（少设一个就可能踩到"另一个才是被读的"）');
    }
  });
});

test('ST2 显式覆盖不可用时：**不假装成功**（保持环境原样，日志里有原文）', () => {
  const blocker = path.join(TMP, 'not-a-dir');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(blocker, 'x');                        // 父路径是文件 ⇒ mkdir 必然失败
  withEnv({ [TEMP_DIR_OVERRIDE]: path.join(blocker, 'tmp'), ...Object.fromEntries(TEMP_ENV_KEYS.map((k) => [k, undefined])) }, () => {
    const r = configureProcessTempDir(path.join(TMP, 'userdata2'));
    assert.equal(r.dir, null, '覆盖不可用就必须返回 null（不假装成功）');
    for (const k of TEMP_ENV_KEYS) assert.equal(process.env[k], undefined, '失败时不许偷偷设置 ' + k);
  });
});

test('ST3 ⭐ 机制钉住：TMP 才是被读的那个，SQLITE_TMPDIR 单独设没用', () => {
  const script = path.join(TMP, 'child-import.mjs');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(script, [
    'import { openGsDb } from ' + JSON.stringify(pathToFileURL(path.join(ROOT, 'apps/desktop/src/main/db/open.ts')).href) + ';',
    'import { importItemsFromJson } from ' + JSON.stringify(pathToFileURL(path.join(ROOT, 'apps/desktop/src/main/db/import.ts')).href) + ';',
    'const lib = process.env.CHILD_LIB;',
    'const opened = openGsDb({ dbPath: lib + "/.gs.db" });',
    'try {',
    '  const rep = importItemsFromJson({ db: opened.db, library: { libId: "L1", root: lib }, itemsJsonPath: lib + "/items.json", expectedCount: 3594 });',
    '  console.log("RESULT" + JSON.stringify({ ok: true, dbCount: rep.dbCount }));',
    '} catch (e) { console.log("RESULT" + JSON.stringify({ ok: false, code: e && e.code })); }',
    'finally { try { opened.db.close(); } catch {} }',
  ].join('\n'), 'utf8');

  const good = path.join(TMP, 'app-owned-tmp');
  const bad = path.join(TMP, 'no-such-temp-' + String(Date.now()));
  fs.mkdirSync(good, { recursive: true });

  const run = (extra) => {
    const lib = fixtureLib();
    const base = Object.assign({}, process.env, { CHILD_LIB: lib, TEMP: bad, TMP: bad, TMPDIR: bad });
    delete base.SQLITE_TMPDIR;
    for (const k of TEMP_ENV_KEYS) delete base[k];
    const r = spawnSync(process.execPath, [script], { env: Object.assign(base, { TEMP: bad, TMP: bad, TMPDIR: bad }, extra), encoding: 'utf8' });
    const line = String(r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('RESULT'));
    assert.ok(line, '子进程应打出 RESULT：' + (String(r.stdout) + String(r.stderr)).slice(0, 300));
    return JSON.parse(line.slice('RESULT'.length));
  };

  // (1) 应用自己的目录（四个变量全指向它）⇒ 成功 —— 这就是 index.ts 里那一步在做的事
  const fixed = run({ TEMP: good, TMP: good, TMPDIR: good, SQLITE_TMPDIR: good });
  assert.equal(fixed.ok, true, '临时目录可写 ⇒ 必须成功：' + JSON.stringify(fixed));
  assert.equal(fixed.dbCount, 3594);

  // (2) 只把 SQLITE_TMPDIR 指到可写目录 ⇒ **仍然失败**（这个构建忽略它）—— 证明"为什么必须设 TMP"
  const onlySqlite = run({ SQLITE_TMPDIR: good });
  assert.equal(onlySqlite.ok, false, '只设 SQLITE_TMPDIR 是不够的（实测被忽略）');
  assert.equal(onlySqlite.code, 'IMPORT_FAILED');

  // (3) 对照：一个可写的都没有 ⇒ 失败，且码是 IMPORT_FAILED（不是 INDEX_CORRUPT）
  const control = run({});
  assert.equal(control.ok, false, '对照组必须失败，证明上面两条不是恒真');
  assert.equal(control.code, 'IMPORT_FAILED');
});

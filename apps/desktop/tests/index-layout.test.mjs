// apps/desktop/tests/index-layout.test.mjs —— T-44：索引落点判据**只有一份**，体检与引擎口径必须一致
//
// 背景（T-15b 真窗口实测）：`data/libraries/L1` 是旧布局，而体检只找 `<库根>/.gs-index.bin`
//   ⇒ 体检报 index(INDEX_MISSING)，可那份旧布局索引**过得了引擎五道校验**（实测 count=3594）。
//   两边说法相反 = 两处各自判断「索引在哪」（P1）。修法：判据收到引擎的 resolveIndexLocation，
//   体检/端口/重建全部走它。
//
// 三种情形必须分得清（本文件的核心判据）：
//   ① 新布局（库根）② 旧布局（<dataDir>/libraries/<libId>/index.bin）回退 ③ 真缺失（两处都没有）
//   ⚠️ ② 不许被写成 ③ —— 那是**假因果**。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIndexLocation } from '../../../packages/engine/src/index-layout.ts';
import { checkLibraryHealth } from '../src/main/library-health.ts';
// ⚠️ 夹具**复用**引擎测试里那一份（P1：同一份库的构造只留一份）
import {
  makeLibrary,
  writeIndexFixture,
} from '../../../packages/engine/tests/helpers/lib-fixture.mjs';
import { resolveTestLibraryRoot } from '../../../packages/engine/tests/lib-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到仓库根');
    p = up;
  }
})();

/** 造临时库：图/包放库根；索引先写到**旧布局**位置，用例再按需拷到库根 */
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-layout-'));
  const libRoot = path.join(tmp, 'lib');
  const made = makeLibrary();
  fs.cpSync(made.root, libRoot, { recursive: true });
  const legacyDir = path.join(tmp, 'data', 'libraries');
  const fx = writeIndexFixture(path.join(legacyDir, 'L1'), 'L1', made.rows, { libRoot });
  return { tmp, libRoot, legacyDir, fx };
}

const indexCheck = (rep) => rep.checks.find((c) => c.id === 'index');

// ─────────────────────────────────────────── 判据本体（纯函数）

test('T44-U1 resolveIndexLocation：新布局 / 旧布局 / 都没有 —— layout 与 reason 都要说准', () => {
  const seen = new Set();
  const exists = (p) => seen.has(path.resolve(p));
  const root = path.join('C:', 'lib');
  const legacy = path.join('C:', 'data', 'libraries');
  const newPath = path.join(root, '.gs-index.bin');
  const oldPath = path.join(legacy, 'L1', 'index.bin');

  const none = resolveIndexLocation({
    libId: 'L1',
    libraryRoot: root,
    legacyLibrariesDir: legacy,
    exists,
  });
  assert.equal(none.layout, 'none');
  assert.equal(none.indexPath, null);
  assert.equal(none.preferredPath, newPath, '首选路径永远是**新布局**（没有命中时错误信息要指它）');
  assert.equal(none.candidates.length, 2);
  assert.ok(
    none.reason.includes(newPath) && none.reason.includes(oldPath),
    '理由里要列清找过哪些路径',
  );

  seen.add(path.resolve(oldPath));
  const old = resolveIndexLocation({
    libId: 'L1',
    libraryRoot: root,
    legacyLibrariesDir: legacy,
    exists,
  });
  assert.equal(old.layout, 'legacy');
  assert.equal(old.indexPath, oldPath);

  seen.add(path.resolve(newPath));
  const fresh = resolveIndexLocation({
    libId: 'L1',
    libraryRoot: root,
    legacyLibrariesDir: legacy,
    exists,
  });
  assert.equal(fresh.layout, 'library-root', '两处都有 ⇒ 新布局优先');
  assert.equal(fresh.indexPath, newPath);

  const onlyNew = resolveIndexLocation({ libId: 'L1', libraryRoot: root, exists });
  assert.equal(onlyNew.layout, 'library-root');
  assert.equal(onlyNew.candidates.length, 1, '不给旧布局根 ⇒ 不虚构一个候选');
});

// ─────────────────────────────────────────── 体检：三种情形

test('T44-H1 新布局：库根下的 .gs-index.bin 通过五道校验 ⇒ index ok · indexLayout=library-root', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.libRoot, '.gs-index.bin'), s.fx.indexBuffer);
  const rep = checkLibraryHealth({ libId: 'L1', root: s.libRoot, legacyLibrariesDir: s.legacyDir });
  const c = indexCheck(rep);
  assert.equal(rep.indexLayout, 'library-root');
  assert.equal(c.ok, true, c.reason);
  assert.equal(c.code, '');
  assert.ok(c.reason.includes('library-root'));
  assert.equal(rep.needsIndexRebuild, false);
});

test('T44-H2 ⭐ 旧布局回退：库根没有索引，但 <dataDir>/libraries/<libId>/index.bin 有效 ⇒ **照样 ok**（不许报缺失）', () => {
  const s = setup(); // 索引只在旧布局位置
  const rep = checkLibraryHealth({ libId: 'L1', root: s.libRoot, legacyLibrariesDir: s.legacyDir });
  const c = indexCheck(rep);
  assert.equal(rep.indexLayout, 'legacy');
  assert.equal(c.ok, true, '旧布局的索引是存在且可用的：' + c.reason);
  assert.equal(c.code, '', '⚠️ 不许用 INDEX_MISSING 冒充「旧布局」');
  assert.ok(c.reason.includes('legacy'), '理由要点明用的是旧布局回退：' + c.reason);
  assert.equal(rep.needsIndexRebuild, false);
});

test('T44-H3 真缺失：两处都没有 ⇒ INDEX_MISSING，且理由列出找过的两条路径', () => {
  const s = setup();
  fs.rmSync(path.join(s.legacyDir, 'L1'), { recursive: true, force: true }); // 旧布局那份也删掉
  const rep = checkLibraryHealth({ libId: 'L1', root: s.libRoot, legacyLibrariesDir: s.legacyDir });
  const c = indexCheck(rep);
  assert.equal(rep.indexLayout, 'none');
  assert.equal(c.ok, false);
  assert.equal(c.code, 'INDEX_MISSING', '只有真缺失才配这个码');
  assert.ok(c.reason.includes('.gs-index.bin') && c.reason.includes('index.bin'), c.reason);
  assert.equal(rep.needsIndexRebuild, true);
});

test('T44-H4 不给旧布局根（迁移完成后的口径）⇒ 只认新布局，缺了就是 INDEX_MISSING（与上面区分开）', () => {
  const s = setup(); // 旧布局里有索引，但调用方没给旧布局根
  const rep = checkLibraryHealth({ libId: 'L1', root: s.libRoot });
  const c = indexCheck(rep);
  assert.equal(rep.indexLayout, 'none');
  assert.equal(c.ok, false);
  assert.equal(c.code, 'INDEX_MISSING');
  assert.equal(
    c.reason.includes(s.legacyDir),
    false,
    '没给旧布局根就**不许**声称找过它（.gs-index.bin 里也含 index.bin 子串，所以按目录判）',
  );
});

// ─────────────────────────────────────────── 真库实跑（旧布局）

test('T44-R ⭐⭐ 真库实跑 data/libraries/L1（旧布局）：带旧布局根 ⇒ 过五道校验；不带 ⇒ 才会报 INDEX_MISSING', (t) => {
  const found = resolveTestLibraryRoot(REPO_ROOT);
  if (!found) return t.skip('本机没有可用的素材库根');
  const legacyDir = path.join(REPO_ROOT, 'data', 'libraries');
  const libId = found.libId || 'L1';
  if (!fs.existsSync(path.join(legacyDir, libId, 'index.bin')))
    return t.skip('本机没有旧布局索引可对账');

  const withLegacy = checkLibraryHealth({ libId, root: found.root, legacyLibrariesDir: legacyDir });
  const withoutLegacy = checkLibraryHealth({ libId, root: found.root });
  const a = indexCheck(withLegacy);
  const b = indexCheck(withoutLegacy);

  t.diagnostic('库根 ' + found.root + '（来源 ' + found.source + '）· 旧布局根 ' + legacyDir);
  t.diagnostic(
    '带旧布局根：layout=' +
      withLegacy.indexLayout +
      ' · ok=' +
      String(a.ok) +
      ' · code=' +
      JSON.stringify(a.code),
  );
  t.diagnostic('  reason: ' + a.reason);
  t.diagnostic(
    '不带（旧口径）：layout=' +
      withoutLegacy.indexLayout +
      ' · ok=' +
      String(b.ok) +
      ' · code=' +
      JSON.stringify(b.code),
  );
  t.diagnostic('  reason: ' + b.reason);

  assert.equal(a.ok, true, '真库那份旧布局索引应当过引擎五道校验：' + a.reason);
  assert.equal(withLegacy.indexLayout, 'legacy');
  assert.equal(b.ok, false, '反过来：只认新布局时才会报缺失 —— 这就是 T-15b 看到的那个 bug');
  assert.equal(b.code, 'INDEX_MISSING');
  assert.equal(withoutLegacy.indexLayout, 'none');
});

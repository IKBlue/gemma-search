// apps/desktop/tests/library-availability.test.mjs —— U18：库根不可用时**仍然可见 + 写明原因**
//
// 三条线一起测（它们共同构成「用户能不能知道库怎么了」）：
//   A 判据：`classifyRootSync` / `probeRootAvailability` —— 三种原因**必须分开**，且**永不抛**；
//   V 合并：`buildLibraryRows` + `applyAvailability` —— 已登记但路径不见了的库**不许被丢掉**；
//   R 挑选：渲染层 `resolveLibrary` —— chosen 不可用时改挑可用的，并把原因透传给界面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
  classifyRootSync,
  probeRootAvailability,
  probeRoots,
  DEFAULT_PROBE_TIMEOUT_MS,
} from '../src/main/library-availability.ts';
import {
  applyAvailability,
  buildLibraryRows,
  unavailableLibraries,
} from '../src/main/library-view.ts';
import { resolveLibrary } from '../src/renderer/src/utils/library-root.ts';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-u18-'));
const GOOD = path.join(TMP, 'lib-good');
const GONE = path.join(TMP, 'lib-gone');
const AS_FILE = path.join(TMP, 'lib-as-file');
before(() => {
  fs.mkdirSync(GOOD, { recursive: true });
  fs.writeFileSync(AS_FILE, 'not a dir');
});
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

const errWith = (code) => Object.assign(new Error('sythetic ' + code), { code });

// ============================================================ A 判据

test('A1 可用：真目录 ⇒ available 且 reason 为空串', () => {
  const a = classifyRootSync(GOOD);
  assert.equal(a.available, true);
  assert.equal(a.code, null);
  assert.equal(a.reason, '');
});

test('A2 not-found：路径不存在（拔盘/改名）⇒ 与"不可访问""不是目录"分开', () => {
  const a = classifyRootSync(GONE);
  assert.equal(a.available, false);
  assert.equal(a.code, 'not-found');
  assert.match(a.reason, /不存在/);
});

test('A3 not-a-directory：同名**文件**占位 ⇒ 单独一种原因', () => {
  const a = classifyRootSync(AS_FILE);
  assert.equal(a.available, false);
  assert.equal(a.code, 'not-a-directory');
  assert.match(a.reason, /不是目录/);
});

test('A4 inaccessible：EACCES / EPERM（注入造出来，不靠运气）', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const a = classifyRootSync('X:\\whatever', {
      statSync: () => {
        throw errWith(code);
      },
    });
    assert.equal(a.available, false);
    assert.equal(a.code, 'inaccessible', code + ' 必须归 inaccessible');
    assert.match(a.reason, /权限|不可访问/);
  }
});

test('A5 其它错误码同样归 inaccessible，且**把码写进理由**（不吞）', () => {
  const a = classifyRootSync('Y:\\whatever', {
    statSync: () => {
      throw errWith('EBUSY');
    },
  });
  assert.equal(a.code, 'inaccessible');
  assert.match(a.reason, /EBUSY/);
});

test('A6 空路径 ⇒ not-found（注册表里没记路径），不抛', () => {
  const a = classifyRootSync('   ');
  assert.equal(a.available, false);
  assert.equal(a.code, 'not-found');
  assert.match(a.reason, /空/);
});

test('A7 异步探测：ENOENT ⇒ not-found；超时 ⇒ **有界** inaccessible（不挂住启动）', async () => {
  const missing = await probeRootAvailability(GONE);
  assert.equal(missing.code, 'not-found');

  const started = Date.now();
  const slow = await probeRootAvailability('Z:\\never-answers', {
    statAsync: () =>
      new Promise(() => {
        /* 永不 resolve：模拟断开的网络盘 */
      }),
    timeoutMs: 40,
  });
  const took = Date.now() - started;
  assert.equal(slow.available, false);
  assert.equal(slow.code, 'inaccessible');
  assert.match(slow.reason, /超时/);
  assert.ok(took < 1000, '必须有界：实测 ' + String(took) + 'ms');
  assert.equal(DEFAULT_PROBE_TIMEOUT_MS, 400, '默认有界等待是 400ms（常量改了要一起改断言）');
});

test('A8 probeRoots：并发探测、**一个库卡住不影响其它库**', async () => {
  const map = await probeRoots([GOOD, 'Z:\\slow'], {
    statAsync: (p) =>
      p === 'Z:\\slow'
        ? new Promise(() => {
            /* 卡住 */
          })
        : Promise.resolve({ isDirectory: () => true }),
    timeoutMs: 40,
  });
  assert.equal(map.get(GOOD).available, true, '好库必须照常可用');
  assert.equal(map.get('Z:\\slow').available, false);
  assert.equal(map.size, 2);
});

// ============================================================ V 合并（U18 的核心）

function probeMap(pairs) {
  return new Map(pairs);
}

test('V1 ⭐⭐ 已登记但路径不见了的库**仍在列表里**，并带 available:false + 原因（能红锚点）', () => {
  const rows = buildLibraryRows({
    discovered: [{ libId: 'L1', root: GOOD, label: '好库', source: 'env', count: 3 }],
    registry: [
      { libId: 'L1', root: GOOD, displayName: '好库', enabled: true, sortOrder: 0 },
      { libId: 'L2', root: GONE, displayName: '拔了盘的库', enabled: true, sortOrder: 1 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.libId),
    ['L1', 'L2'],
    '注册表里的库不许在合并阶段被丢掉',
  );

  const views = applyAvailability(
    rows,
    probeMap([
      [GOOD, classifyRootSync(GOOD)],
      [GONE, classifyRootSync(GONE)],
    ]),
  );

  const gone = views.find((v) => v.libId === 'L2');
  assert.ok(gone, '**不可用的库必须还在列表里** —— 用户要看得见它，否则会以为库被删了');
  assert.equal(gone.available, false);
  assert.equal(gone.unavailableCode, 'not-found');
  assert.match(gone.unavailableReason, /不存在/);
  assert.equal(gone.registered, true);
  assert.equal(gone.source, 'registry');

  const good = views.find((v) => v.libId === 'L1');
  assert.equal(good.available, true);
  assert.equal(good.unavailableCode, null);
  assert.equal(good.unavailableReason, null);
  assert.equal(good.itemCount, 3, '可用库的计数照旧透出');

  // **能红（判别力自证）**：「把不可用库丢掉」的错误实现（U18 前界面的实际观感）
  const dropped = views.filter((v) => v.available);
  assert.ok(
    !dropped.some((v) => v.libId === 'L2'),
    '丢掉之后 L2 就消失了 —— V1 的断言因此在旧行为下必红',
  );
  assert.deepEqual(
    unavailableLibraries(views).map((v) => v.libId),
    ['L2'],
    '不可用名单只有 L2',
  );
});

test('V2 三种原因在**行上**分得开（界面按 unavailableCode 分支，不解析中文）', () => {
  const rows = buildLibraryRows({
    discovered: [
      { libId: 'A', root: 'A:\\gone', label: 'A', source: 'env' },
      { libId: 'B', root: 'B:\\file', label: 'B', source: 'env' },
      { libId: 'C', root: 'C:\\denied', label: 'C', source: 'env' },
    ],
    registry: [],
  });
  const views = applyAvailability(
    rows,
    probeMap([
      [
        'A:\\gone',
        { root: 'A:\\gone', available: false, code: 'not-found', reason: '库根不存在（…）' },
      ],
      [
        'B:\\file',
        {
          root: 'B:\\file',
          available: false,
          code: 'not-a-directory',
          reason: '库根不是目录（…）',
        },
      ],
      [
        'C:\\denied',
        {
          root: 'C:\\denied',
          available: false,
          code: 'inaccessible',
          reason: '库根不可访问：权限不足（EACCES）',
        },
      ],
    ]),
  );
  assert.deepEqual(
    views.map((v) => v.unavailableCode),
    ['not-found', 'not-a-directory', 'inaccessible'],
  );
  for (const v of views)
    assert.ok(v.unavailableReason && v.unavailableReason.length > 0, '不可用必须带人话理由');
  assert.equal(new Set(views.map((v) => v.unavailableReason)).size, 3, '三种理由不许长成同一句');
});

test('V3 合并口径不变：sortOrder 排序 · enabled:false 仍然列出 · 没探测到的行按可用处理', () => {
  const rows = buildLibraryRows({
    discovered: [
      { libId: 'L9', root: 'D:\\nine', label: 'L9', source: 'config' },
      { libId: 'L1', root: 'D:\\one', label: 'L1', source: 'env', count: 0 },
    ],
    registry: [
      { libId: 'L9', root: 'D:\\nine', displayName: '九号库', enabled: true, sortOrder: 5 },
      { libId: 'L1', root: 'D:\\one', displayName: '一号库', enabled: false, sortOrder: 2 },
      {
        libId: 'L5',
        root: 'D:\\five',
        displayName: '五号库（登记过、没被发现）',
        enabled: true,
        sortOrder: 3,
      },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.libId),
    ['L1', 'L5', 'L9'],
    '按 sortOrder 排',
  );
  assert.equal(
    rows.find((r) => r.libId === 'L1').enabled,
    false,
    '停用的库仍然列出（不是本卡要改的事）',
  );
  assert.equal(rows.find((r) => r.libId === 'L9').label, '九号库', '注册表的 display_name 优先');

  // 没给探测结果的行 ⇒ 按可用处理（契约：可选字段缺失 = 兼容）
  const views = applyAvailability(rows, new Map());
  for (const v of views) {
    assert.equal(v.available, true);
    assert.equal(v.unavailableCode, null);
    assert.equal(v.unavailableReason, null);
  }
});

// ============================================================ R 渲染层挑选

const GONE_RAW = 'Z:\\gone-disk';

test('R1 ⭐ 渲染层：chosen 可用就用它；chosen 不可用时**改挑可用的**（其余库照常可用）', () => {
  const data = {
    libraries: [
      {
        libId: 'L1',
        root: 'Z:\\gone',
        available: false,
        unavailableReason: '库根不存在（盘符变了、盘未挂载，或目录被删除/改名）',
      },
      { libId: 'L2', root: 'D:\\ok', available: true },
    ],
    chosen: 'L1',
  };
  const r = resolveLibrary(data);
  assert.equal(r.libId, 'L2', 'chosen 不可用时不许硬用它（否则整个界面卡在死路径上）');
  assert.equal(r.available, true);
  assert.equal(r.unavailableReason, null);
});

test('R2 ⭐ 渲染层：全都不可用时**不编一个假的** —— 如实返回它并带上原因', () => {
  const data = {
    libraries: [
      {
        libId: 'L1',
        root: GONE_RAW,
        available: false,
        unavailableReason: '库根不存在（盘符变了、盘未挂载，或目录被删除/改名）',
      },
    ],
    chosen: 'L1',
  };
  const r = resolveLibrary(data);
  assert.equal(r.libId, 'L1', '一个可用的都没有 ⇒ 仍然返回它（界面据此显示"不可用 + 原因"）');
  assert.equal(r.available, false);
  assert.match(r.unavailableReason, /不存在/);
});

test('R3 向后兼容：没有 available 字段的旧载荷 ⇒ 一律按可用处理（chosen 仍然优先）', () => {
  const data = {
    libraries: [
      { libId: 'L1', root: 'D:\\a' },
      { libId: 'L2', root: 'D:\\b' },
    ],
    chosen: 'L2',
  };
  const r = resolveLibrary(data);
  assert.equal(r.libId, 'L2');
  assert.equal(r.available, true);
  assert.equal(r.unavailableReason, null);
});

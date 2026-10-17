// apps/desktop/tests/collect-ledger.test.mjs —— WIRE-B：取件/交付的**留痕**（activity 1 行 + asset_export N 行）
//
// 要证的七件事：
//   ① ⭐⭐ **一次批量 = activity 1 行 + asset_export N 行，同一个 batch id**（B2-8 机械证明过的 1:N，
//      现在由**真实写入路径**的编排函数 `recordCollectBatch` 落实，跨两个数据库文件）；
//   ② 结果映射：succeeded ⇒ copied · skipped ⇒ skipped · failed ⇒ failed（reason 带错误码）；
//      activity.result 的判定：有 failed ⇒ failed；否则有 copied ⇒ ok；全 skipped ⇒ skipped；
//   ③ uid 指向 `asset` **最佳努力**（不认识的外键落 NULL，不让整批写不进去）；
//   ④ ⭐ **写入入口只有一处**（P1 · 静态）：`INSERT INTO activity` 只在 app-db.ts · `INSERT INTO asset_export`
//      只在 db/exports.ts · 编排函数 `recordCollectBatch` 只有一处定义 + 一处调用（index.ts 的 collect 钩子）；
//   ⑤ ⭐⭐ **失败不静默**：库/应用库拿不到 ⇒ `written:false` + `warning` 非空，**永不抛**（文件已复制的事实不受影响）；
//   ⑥ ⭐⭐ **补偿**：activity 写不进去时，**撤回**这一批 export 明细（不留"缺 1"的半条历史）；
//   ⑦ ⭐ 同一 batch 重放不会翻倍（activity 主键挡住；已写的明细被撤回）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { insertActivity, openAppDb } from '../src/main/app-db.ts';
import { recordCollectBatch } from '../src/main/collect-ledger.ts';
import { openGsDb } from '../src/main/db/open.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN_DIR = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_wireb', 'ledger-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

/** 造一对"已存在的库与应用库"，并返回它们的路径（asset 表里只放 uids 里给出的那些） */
function setup(label, uids) {
  const userDataDir = freshDir(label + '-app');
  const libDir = freshDir(label + '-lib');
  const libDbPath = path.join(libDir, '.gs.db');
  const app = openAppDb({ userDataDir, now: () => T0 });
  const lib = openGsDb({ dbPath: libDbPath, now: () => T0 });
  try {
    for (const uid of uids) {
      lib.db
        .prepare(
          'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(uid, 'L1', 'CR', 'A', 'A.jpg', 'CR', 'CR/' + uid + '.jpg', T0);
    }
  } finally {
    app.db.close();
    lib.db.close();
  }
  return { userDataDir, libDbPath };
}

const rowsOf = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({
    uid: 'aa000000' + String(1000 + start + i),
    assetName: 'asset-' + String(start + i) + '.zip',
    result: 'copied',
    reason: null,
  }));

function openPair(s) {
  return {
    app: openAppDb({ userDataDir: s.userDataDir, now: () => T0 }),
    lib: openGsDb({ dbPath: s.libDbPath, now: () => T0 }),
  };
}

const activityRows = (db) => db.prepare('SELECT * FROM activity ORDER BY at_ms').all();
const exportRows = (db) => db.prepare('SELECT * FROM asset_export ORDER BY asset_name').all();

// ============================================================ L1 ⭐⭐ 1:N

test('L1 ⭐⭐ 一次批量 = activity **1 行** + asset_export **N 行**，同一个 batch id（跨两库）', () => {
  const uids = ['aa0000001000', 'aa0000001001', 'aa0000001002'];
  const s = setup('L1', uids);
  const r = recordCollectBatch({
    userDataDir: s.userDataDir,
    libDbPath: s.libDbPath,
    libId: 'L1',
    batchId: 'j-batch-1',
    targetDir: 'D:/收集/2026',
    targetDirName: '2026',
    bytesTotal: 1234,
    now: () => T0,
    rows: [
      { uid: 'aa0000001000', assetName: 'a.zip', result: 'copied', reason: null },
      { uid: 'aa0000001001', assetName: 'b.zip', result: 'skipped', reason: 'already-exists' },
      { uid: 'aa0000001002', assetName: 'c.zip', result: 'failed', reason: 'DISK_FULL: 没空间' },
    ],
  });
  assert.deepEqual([r.written, r.exportRows, r.activity, r.warning], [true, 3, true, null]);
  const p = openPair(s);
  try {
    const acts = activityRows(p.app.db);
    assert.equal(acts.length, 1, 'activity 恰好 1 行（1:N 里的"1"）');
    assert.equal(acts[0].activity_id, 'j-batch-1', 'activity_id 就是这个 batch id');
    assert.equal(acts[0].kind, 'collect');
    assert.equal(acts[0].lib_id, 'L1');
    assert.equal(acts[0].result, 'failed', '有 failed ⇒ 整批结论 failed');
    const detail = JSON.parse(acts[0].detail_json);
    assert.equal(detail.copied, 1);
    assert.equal(detail.skipped, 1);
    assert.equal(detail.failed, 1);
    assert.equal(detail.target_dir, 'D:/收集/2026');
    const exps = exportRows(p.lib.db);
    assert.equal(exps.length, 3, 'asset_export 恰好 N=3 行');
    // 每一行都挂在同一个 batch 上（跨库的 1:N 关联靠它，不是外键 —— 两个库文件之间不可能有外键）
    assert.deepEqual(
      exps.map((e) => e.batch_id),
      ['j-batch-1', 'j-batch-1', 'j-batch-1'],
      'N 行共用一个 batch_id',
    );
    assert.deepEqual(
      exps.map((e) => [e.asset_name, e.result, e.reason]),
      [
        ['a.zip', 'copied', null],
        ['b.zip', 'skipped', 'already-exists'],
        ['c.zip', 'failed', 'DISK_FULL: 没空间'],
      ],
      '三种结局各自映射对',
    );
    assert.equal(
      exps.every((e) => e.kind === 'collect'),
      true,
    );
    assert.equal(
      exps.every((e) => e.uid !== null),
      true,
      '三条 uid 都在 asset 里 ⇒ 外键可写',
    );
  } finally {
    p.app.db.close();
    p.lib.db.close();
  }
});

test('L1b ⭐ activity.result 的判定表：全成功 ⇒ ok；全跳过 ⇒ skipped；有失败 ⇒ failed', () => {
  const cases = [
    { name: 'ok', rows: rowsOf(2).map((r) => ({ ...r, result: 'copied' })), want: 'ok' },
    {
      name: 'skipped',
      rows: rowsOf(2).map((r) => ({ ...r, result: 'skipped', reason: 'already-exists' })),
      want: 'skipped',
    },
    {
      name: 'failed',
      rows: rowsOf(2, 5).map((r) => ({ ...r, result: 'failed', reason: 'X' })),
      want: 'failed',
    },
  ];
  for (const c of cases) {
    const s = setup('L1b-' + c.name, [
      'aa0000001000',
      'aa0000001001',
      'aa0000001005',
      'aa0000001006',
    ]);
    recordCollectBatch({
      userDataDir: s.userDataDir,
      libDbPath: s.libDbPath,
      libId: 'L1',
      batchId: 'j-' + c.name,
      targetDir: 'D:/out',
      targetDirName: null,
      bytesTotal: 0,
      now: () => T0,
      rows: c.rows,
    });
    const p = openPair(s);
    try {
      assert.equal(activityRows(p.app.db)[0].result, c.want, '判定：' + c.name);
    } finally {
      p.app.db.close();
      p.lib.db.close();
    }
  }
});

// ============================================================ L3 uid 的最佳努力

test('L3 ⭐ uid 指向 asset 的最佳努力：不认识的 uid 落 NULL（不让整批写不进去），其余照写', () => {
  const s = setup('L3', ['aa0000001000']); // 只有一条在 asset 里
  const r = recordCollectBatch({
    userDataDir: s.userDataDir,
    libDbPath: s.libDbPath,
    libId: 'L1',
    batchId: 'j-fk',
    targetDir: 'D:/out',
    targetDirName: null,
    bytesTotal: 0,
    now: () => T0,
    rows: [
      { uid: 'aa0000001000', assetName: 'known.zip', result: 'copied', reason: null },
      { uid: 'aa0000009999', assetName: 'unknown.zip', result: 'copied', reason: null },
    ],
  });
  assert.equal(
    r.written,
    true,
    '有未知 uid 也要写成功（否则一次取件会因为一条历史没落行而整批失败）',
  );
  const p = openPair(s);
  try {
    const byName = Object.fromEntries(exportRows(p.lib.db).map((e) => [e.asset_name, e.uid]));
    assert.equal(byName['known.zip'], 'aa0000001000', '认识的 uid 照写');
    assert.equal(byName['unknown.zip'], null, '不认识的落 NULL（DDL 允许；比"整批写不进去"好）');
  } finally {
    p.app.db.close();
    p.lib.db.close();
  }
});

// ============================================================ L4 ⭐ 写入入口只有一处

test('L4 ⭐⭐ 写入入口只有一处（静态）：activity 只 app-db.ts 写 · asset_export 只 db/exports.ts 写 · 编排只有一处定义+一处调用', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(MAIN_DIR);
  const writersOf = (table) =>
    files
      .filter((f) =>
        new RegExp('INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+' + table + '\\b', 'i').test(
          fs.readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => path.basename(f))
      .sort();
  assert.deepEqual(
    writersOf('activity'),
    ['app-db.ts'],
    'activity 的写入口只能是 app-db.ts（§2.3）',
  );
  assert.deepEqual(
    writersOf('asset_export'),
    ['exports.ts'],
    'asset_export 的写入口只能是 db/exports.ts（§2.3）',
  );
  // 编排函数：定义一处（collect-ledger.ts）+ 调用一处（index.ts 的 collect 钩子）
  //   ⚠️ **收紧到"对象字面量调用"** `recordCollectBatch({ … )` —— 这样注释里提到函数名**不算数**
  //      （P8：不许用"注释里的代码"充当接线证据）。定义那一处用 `export function` 单独认。
  const callers = files
    .filter((f) => /recordCollectBatch\s*\(\s*\{/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(
    callers,
    ['index.ts'],
    '1:N 的编排只被 index.ts 的 collect 钩子**真的调用**（注释里提到它不算）',
  );
  const definers = files
    .filter((f) => /export function recordCollectBatch\s*\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(definers, ['collect-ledger.ts'], '编排函数只有一处定义');
  // 自检：上面两条不是恒真（名字打错会变成空数组）
  assert.ok(files.length > 10, '扫描到的 main 源文件数应当远超 10（否则说明走查逻辑坏了）');
});

// ============================================================ L5/L6/L7 失败与补偿

test('L5 ⭐⭐ 失败不静默：拿不到库/应用库 ⇒ written=false + warning 非空，**永不抛**', () => {
  const s = setup('L5', []);
  // ⚠️ 不能用"目录不存在"造失败：openGsDb 会把父目录建出来（这是**正常的建库行为**，不是缺陷）。
  //    真正的"打不开"是：父路径是个**文件** ⇒ 建不了目录/文件。这个坑先挖好。
  fs.writeFileSync(path.join(TMP, 'blocker-file'), 'not a dir');
  const cases = [
    { label: 'userDataDir 为空', input: { userDataDir: null, libDbPath: s.libDbPath } },
    { label: '.gs.db 落点为空', input: { userDataDir: s.userDataDir, libDbPath: null } },
    {
      label: '.gs.db 父路径是文件（打不开）',
      input: { userDataDir: s.userDataDir, libDbPath: path.join(TMP, 'blocker-file', '.gs.db') },
    },
    {
      label: '没有结果行',
      input: { userDataDir: s.userDataDir, libDbPath: s.libDbPath },
      empty: true,
    },
    {
      label: '没有 batch id',
      input: { userDataDir: s.userDataDir, libDbPath: s.libDbPath, batchId: '' },
    },
  ];
  for (const c of cases) {
    let out;
    assert.doesNotThrow(() => {
      out = recordCollectBatch({
        libId: 'L1',
        batchId: 'j-x',
        targetDir: 'D:/out',
        targetDirName: null,
        bytesTotal: 0,
        now: () => T0,
        rows: c.empty ? [] : rowsOf(1),
        ...c.input,
      });
    }, c.label + '：不许把"记历史失败"抛给调用方');
    assert.equal(out.written, false, c.label + '：written 必须 false');
    assert.equal(typeof out.warning, 'string', c.label + '：必须有 warning（不静默）');
    assert.ok(out.warning.length > 0, c.label + '：warning 不能是空串');
  }
});

test('L6 ⭐⭐ 补偿：activity 写不进去 ⇒ 撤回这一批 export 明细（不留"缺 1"的半条历史）', () => {
  const s = setup('L6', ['aa0000001000', 'aa0000001001']);
  // 先占住这个 batch id（activity 主键）⇒ 下一次 insertActivity 必然失败
  const app0 = openAppDb({ userDataDir: s.userDataDir, now: () => T0 });
  try {
    insertActivity(app0.db, {
      activityId: 'j-occupied',
      atMs: T0,
      kind: 'collect',
      subjectKind: 'library',
      libId: 'L1',
    });
  } finally {
    app0.db.close();
  }
  const r = recordCollectBatch({
    userDataDir: s.userDataDir,
    libDbPath: s.libDbPath,
    libId: 'L1',
    batchId: 'j-occupied',
    targetDir: 'D:/out',
    targetDirName: null,
    bytesTotal: 0,
    now: () => T0,
    rows: rowsOf(2),
  });
  assert.equal(r.written, false, 'activity 写不进去 ⇒ 整体不算写成');
  assert.ok(r.warning && r.warning.length > 0, '必须给出 warning');
  const p = openPair(s);
  try {
    assert.equal(
      exportRows(p.lib.db).length,
      0,
      '这一批明细必须被撤回（否则会留下 N 行却没有活动记录的半条历史）',
    );
    assert.equal(activityRows(p.app.db).length, 1, '原本那一行不受影响');
  } finally {
    p.app.db.close();
    p.lib.db.close();
  }
});

test('L7 ⭐ 同一 batch 重放不会翻倍（activity 主键挡住 + 已写明细被撤回）', () => {
  const s = setup('L7', ['aa0000001000']);
  const call = () =>
    recordCollectBatch({
      userDataDir: s.userDataDir,
      libDbPath: s.libDbPath,
      libId: 'L1',
      batchId: 'j-same',
      targetDir: 'D:/out',
      targetDirName: null,
      bytesTotal: 0,
      now: () => T0,
      rows: rowsOf(1),
    });
  assert.equal(call().written, true);
  const again = call();
  assert.equal(again.written, false, '第二次同 batch 不算写成（activity 主键挡住）');
  const p = openPair(s);
  try {
    assert.equal(exportRows(p.lib.db).length, 1, '明细没有翻倍');
    assert.equal(activityRows(p.app.db).length, 1, '活动记录也没有翻倍');
  } finally {
    p.app.db.close();
    p.lib.db.close();
  }
});

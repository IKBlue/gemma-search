// apps/desktop/tests/items-ipc.test.mjs —— S8：`items`（只读列表 + facets）
//
// 夹具**自建 6 张表里的库级 3 张**（asset / asset_file / asset_index_state），不依赖 S2 正在改的
// import 路径 ⇒ 在它的红窗口里也能跑。行 → 条目的映射复用 S2 的 joinedRowToItemRecord（耦合断言见 I8）。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runItemsQuery, ITEMS_ALIASES, FACET_LIMIT, SORT_KEYS } from '../src/main/items-ipc.ts';
import { joinedRowToItemRecord } from '../src/main/db/row-types.ts';
import { openGsDb } from '../src/main/db/open.ts';
import { openNodeSqlite } from '../src/main/db/sqlite-adapter.ts';
import { validateCall, METHOD_NAMES } from '../src/shared/ipc.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t62', 'items-' + process.pid);
const LIB = path.join(TMP, 'lib');
const LIB_ID = 'L1';
const T0 = 1700000000000;

/** 7 条：4 个分类（ZZ 刻意排在最后一页 —— 见 I4 的"能红②"） */
const FIXTURE = [
  {
    uid: '000000000001',
    folder: 'AA',
    stem: 'a1',
    rel: 'AA\\a1.jpg',
    ext: '.jpg',
    size: 11,
    mtime: T0 + 1,
    archive: 'AA\\a1.rar',
  },
  {
    uid: '000000000002',
    folder: 'AA',
    stem: 'a2',
    rel: 'AA\\a2.jpg',
    ext: '.jpg',
    size: 12,
    mtime: T0 + 5,
    archive: null,
  },
  {
    uid: '000000000003',
    folder: 'BB',
    stem: 'b1',
    rel: 'BB\\b1.png',
    ext: '.png',
    size: 13,
    mtime: T0 + 3,
    archive: 'BB\\b1.zip',
  },
  {
    uid: '000000000004',
    folder: 'BB',
    stem: 'b2',
    rel: 'BB\\b2.png',
    ext: '.png',
    size: 14,
    mtime: T0 + 2,
    archive: null,
  },
  {
    uid: '000000000005',
    folder: 'CC',
    stem: 'c1',
    rel: 'CC\\c1.jpeg',
    ext: '.jpeg',
    size: 15,
    mtime: T0 + 4,
    archive: null,
  },
  {
    uid: '000000000006',
    folder: 'DD',
    stem: 'd1',
    rel: 'DD\\d1.jpg',
    ext: '.jpg',
    size: 16,
    mtime: T0 + 6,
    archive: 'DD\\d1.7z',
  },
  {
    uid: '000000000007',
    folder: 'ZZ',
    stem: 'zz1',
    rel: 'ZZ\\zz1.jpg',
    ext: '.jpg',
    size: 17,
    mtime: T0 + 7,
    archive: null,
  },
];

const input = () => ({
  libId: LIB_ID,
  libraries: [{ libId: LIB_ID, root: LIB }],
  userDataDir: path.join(TMP, 'userdata'),
});
const q = (params) => runItemsQuery(input(), { libId: LIB_ID, ...params });
const digest = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

function seed() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(LIB, { recursive: true });
  const opened = openGsDb({ dbPath: path.join(LIB, '.gs.db') });
  const db = opened.db;
  try {
    for (const it of FIXTURE) {
      db.prepare(
        'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(it.uid, LIB_ID, it.folder, it.stem, it.stem, it.folder, it.rel, T0);
      db.prepare(
        'INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(it.uid, 'preview', it.rel, it.ext, it.size, it.mtime, 4, 3);
      if (it.archive) {
        db.prepare(
          'INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms, width, height) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
        ).run(it.uid, 'archive', it.archive, path.extname(it.archive), it.size * 10, it.mtime);
      }
      db.prepare('INSERT INTO asset_index_state (uid, vector_row) VALUES (?, ?)').run(
        it.uid,
        Number(it.uid) - 1,
      );
    }
  } finally {
    db.close();
  }
}

before(seed);
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

test('I1 契约：items 已登记 · 参数 .strict() · 不接受绝对路径 · 未登记方法仍被拒', () => {
  assert.ok(METHOD_NAMES.includes('items'), 'items 未登记：' + METHOD_NAMES.join(','));
  assert.equal(validateCall('items', { libId: 'L1' }).ok, true);
  assert.equal(
    validateCall('items', {
      libId: 'L1',
      folder: 'AA',
      ext: '.jpg',
      hasArchive: true,
      sort: '-imageMtime',
      offset: 10,
      limit: 50,
    }).ok,
    true,
  );
  assert.equal(
    validateCall('items', { libId: 'L1', root: 'D:/x' }).ok,
    false,
    '多传字段（含路径）必须被拒',
  );
  assert.equal(validateCall('items', {}).ok, false, 'libId 必填');
  assert.equal(validateCall('items', { libId: 'L1', limit: 0 }).ok, false, 'limit 下界 1');
  assert.equal(validateCall('items', { libId: 'L1', limit: 501 }).ok, false, 'limit 上界 500');
  assert.equal(validateCall('items', { libId: 'L1', sort: 'nope' }).ok, false, 'sort 只认白名单');
  // 未登记方法照旧被拒（S6 之后口径不变）
  assert.equal(validateCall('itemsNuke', { libId: 'L1' }).ok, false);
  assert.equal(validateCall('exec', {}).ok, false);
});

test('I2 分页语义：total 是筛选后总数 · 页间不重叠 · 排序确定', () => {
  const p1 = q({ limit: 3 });
  assert.equal(p1.ok, true);
  assert.equal(p1.data.total, 7);
  assert.equal(p1.data.rows.length, 3);
  assert.deepEqual(
    p1.data.rows.map((r) => r.relPath),
    ['AA\\a1.jpg', 'AA\\a2.jpg', 'BB\\b1.png'],
  );

  const p2 = q({ limit: 3, offset: 3 });
  assert.deepEqual(
    p2.data.rows.map((r) => r.relPath),
    ['BB\\b2.png', 'CC\\c1.jpeg', 'DD\\d1.jpg'],
  );
  assert.equal(p2.data.total, 7, 'total 与 offset 无关');

  const overlap = p1.data.rows.filter((a) => p2.data.rows.some((b) => b.uid === a.uid));
  assert.deepEqual(overlap, [], '两页不许有重复行（排序带 uid 兜底是为了这个）');

  const desc = q({ sort: '-imageMtime', limit: 2 });
  assert.deepEqual(
    desc.data.rows.map((r) => r.stem),
    ['zz1', 'd1'],
    '倒序按 preview mtime',
  );
  const folderSort = q({ sort: 'folder', limit: 1 });
  assert.equal(folderSort.data.rows[0].folder, 'AA');
});

test('I3 筛选语义：folder / ext / hasArchive 各自生效，且 total 跟着变', () => {
  const aa = q({ folder: 'AA' });
  assert.equal(aa.data.total, 2);
  assert.deepEqual(
    aa.data.rows.map((r) => r.stem),
    ['a1', 'a2'],
  );

  const png = q({ ext: '.png' });
  assert.equal(png.data.total, 2);
  assert.deepEqual(
    png.data.rows.map((r) => r.stem),
    ['b1', 'b2'],
  );

  const withArc = q({ hasArchive: true });
  assert.equal(withArc.data.total, 3);
  assert.deepEqual(
    withArc.data.rows.map((r) => r.stem),
    ['a1', 'b1', 'd1'],
  );
  for (const r of withArc.data.rows) assert.ok(r.archiveRelPath, '有包的条目必须带 archiveRelPath');

  const withoutArc = q({ hasArchive: false });
  assert.equal(withoutArc.data.total, 4);

  const combo = q({ folder: 'BB', ext: '.png', hasArchive: false });
  assert.equal(combo.data.total, 1);
  assert.equal(combo.data.rows[0].stem, 'b2');
});

test('I4 ⭐⭐ 越界：rows 空但 total 正确（能红①：total 写成 rows.length ⇒ 本条必红）', () => {
  const beyond = q({ offset: 100, limit: 10 });
  assert.equal(beyond.ok, true);
  assert.deepEqual(beyond.data.rows, [], '越界应当给空 rows');
  assert.equal(beyond.data.total, 7, '越界也必须如实给筛选后总数');

  // **能红①**：把 total 换成 rows.length 的"错误实现" —— 它必须与真实 total 不同。
  // 两个场景都抓得到（不是只有越界才抓得到）：
  const buggyTotal = (res) => res.data.rows.length;
  assert.notEqual(
    buggyTotal(beyond),
    beyond.data.total,
    '越界：rows.length=0 ≠ total=7 ⇒ 断言必红',
  );
  const onPage = q({ limit: 3 });
  assert.notEqual(buggyTotal(onPage), onPage.data.total, '满页但 limit<total：3 ≠ 7 ⇒ 断言也红');
  // 对照（证明这条不是恒真/恒假）：把整库一次取完时两者偶然相等
  const whole = q({ limit: 100 });
  assert.equal(
    buggyTotal(whole),
    whole.data.total,
    '整库取完时 7 == 7（所以判别力来自 limit<total 与越界，不是来自恒不等）',
  );
});

test('I5 ⭐⭐ facets 按全库统计、不受筛选影响（能红②：从 rows 推导 ⇒ 本条必红）', () => {
  const page = q({ limit: 3 }); // 第一页只有 AA/BB
  const folders = page.data.facets.folders.map((f) => f.value).sort();
  assert.deepEqual(
    folders,
    ['AA', 'BB', 'CC', 'DD', 'ZZ'],
    'facets 必须含全部分类（含不在本页的 CC/DD/ZZ）',
  );
  assert.equal(page.data.facets.foldersTotal, 5);
  assert.equal(page.data.facets.extsTotal, 3);
  assert.deepEqual(page.data.facets.exts.map((e) => e.value).sort(), ['.jpeg', '.jpg', '.png']);
  // count 降序：.jpg 有 4 条 ⇒ 排第一
  assert.equal(page.data.facets.exts[0].value, '.jpg');
  assert.equal(page.data.facets.exts[0].count, 4);
  const zz = page.data.facets.folders.find((f) => f.value === 'ZZ');
  assert.ok(zz, '**不在第一页**的分类 ZZ 必须出现在 facets 里');
  assert.equal(zz.count, 1);

  // **能红②**：从当前页样本推导的"错误实现"，它**看不到** ZZ ⇒ 断言能区分
  const facetsFromRows = (res) => [...new Set(res.data.rows.map((r) => r.folder))].sort();
  assert.ok(!facetsFromRows(page).includes('ZZ'), '从 rows 推导看不到 ZZ（这正是它错的地方）');
  assert.ok(folders.includes('ZZ'), '真实 facets 看得到 ZZ');

  // 筛选之后 facets 仍不变（下拉不该随筛选缩水 —— 否则用户没法换回别的分类）
  const filtered = q({ folder: 'AA' });
  assert.equal(filtered.data.total, 2);
  assert.deepEqual(filtered.data.facets.folders.map((f) => f.value).sort(), [
    'AA',
    'BB',
    'CC',
    'DD',
    'ZZ',
  ]);
  assert.equal(filtered.data.facets.foldersTotal, 5);

  // facets 上限与总数分开报（这里只验证"上限存在且>=总数"，真实 >200 的场景不造 200+ 行）
  assert.ok(page.data.facets.folders.length <= FACET_LIMIT);
});

test('I6 只读性：跑一遍列表后 .gs.db 摘要不变、库根不多出非 .gs-* 文件', () => {
  const dbPath = path.join(LIB, '.gs.db');
  const before = { sha: digest(dbPath), files: fs.readdirSync(LIB).sort() };
  for (const p of [
    { limit: 5 },
    { folder: 'BB' },
    { hasArchive: true },
    { offset: 6, limit: 5 },
    { sort: '-stem' },
  ]) {
    assert.equal(q(p).ok, true);
  }
  const afterFiles = fs.readdirSync(LIB).sort();
  // 允许 SQLite 生成 .gs.db 家族的边车（-wal/-shm），不许出现别的
  const added = afterFiles.filter((f) => !before.files.includes(f));
  for (const f of added) {
    assert.ok(
      /\.gs(-|\.)/.test(f),
      '库根出现了非 .gs-* 文件：' + f + '（浏览必须只读，且不能写探针文件）',
    );
  }
  assert.equal(digest(dbPath), before.sha, '.gs.db 内容摘要必须一字不变');
  assert.equal(q({ limit: 1 }).data.total, 7, '（再读一次仍然正常）');
});

test('I7 未知库 / 缺元数据：给带码信封，**不抛**，userMessage 非空', () => {
  const unknown = runItemsQuery({ ...input(), libId: 'L9' }, { libId: 'L9' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'LIB_NOT_FOUND');
  assert.ok(unknown.error.userMessage.length > 0);

  const empty = path.join(TMP, 'empty-lib');
  fs.mkdirSync(empty, { recursive: true });
  const noDb = runItemsQuery(
    {
      libId: 'L2',
      libraries: [{ libId: 'L2', root: empty }],
      userDataDir: path.join(TMP, 'userdata'),
    },
    { libId: 'L2' },
  );
  assert.equal(noDb.ok, false);
  assert.equal(
    noDb.error.code,
    'DB_MISSING',
    '没有 .gs.db 要如实说（实得 ' + noDb.error.code + '）',
  );
  assert.ok(noDb.error.userMessage.length > 0);
});

test('I8 ⭐ 耦合：本文件的列别名必须能被 S2 的 joinedRowToItemRecord 吃下（别名一改就红）', () => {
  // 造一行：键 = 我在 items-ipc.ts 里声明的**全部**别名
  const row = Object.fromEntries(ITEMS_ALIASES.map((a) => [a, null]));
  Object.assign(row, {
    uid: '000000000001',
    lib_id: LIB_ID,
    folder: 'AA',
    stem: 'a1',
    display_name: 'a1',
    rel_path: 'AA\\a1.jpg',
    image_ext: '.jpg',
    image_size: 11,
    image_mtime: T0,
    archive_rel_path: null,
    archive_ext: null,
    archive_size: null,
    archive_mtime: null,
    vector_row: 0,
  });
  const rec = joinedRowToItemRecord(row, LIB, 'items-coupling');
  assert.equal(rec.uid, '000000000001');
  assert.equal(rec.relPath, 'AA\\a1.jpg');
  assert.equal(rec.imageExt, '.jpg');
  assert.equal(rec.vectorRow, 0, 'vector_row 必须被映射器认出来（否则索引与条目对不上）');
  // 别名集合**逐字**钉住（14 个）：少一个 ⇒ 映射器拿不到该键；多一个 ⇒ SQL 里选了没人用的列
  assert.deepEqual(
    [...ITEMS_ALIASES],
    [
      'uid',
      'lib_id',
      'folder',
      'stem',
      'display_name',
      'rel_path',
      'image_ext',
      'image_size',
      'image_mtime',
      'archive_rel_path',
      'archive_ext',
      'archive_size',
      'archive_mtime',
      'vector_row',
    ],
  );
});

test('I9 ⭐ 按体积排序：imageSize 正序/倒序各一条（F2 浏览页「大小」列要的）', () => {
  // 夹具 preview 体积 = 11,12,13,14,15,16,17（各不同 ⇒ 顺序无歧义）
  const asc = q({ sort: 'imageSize' });
  assert.equal(
    asc.ok,
    true,
    'imageSize 必须是合法排序键（实得 ' + (asc.ok ? '' : asc.error.code) + '）',
  );
  assert.deepEqual(
    asc.data.rows.map((r) => r.imageSize),
    [11, 12, 13, 14, 15, 16, 17],
    '小 → 大',
  );
  assert.deepEqual(
    asc.data.rows.map((r) => r.stem),
    ['a1', 'a2', 'b1', 'b2', 'c1', 'd1', 'zz1'],
  );

  const desc = q({ sort: '-imageSize' });
  assert.equal(desc.ok, true);
  assert.deepEqual(
    desc.data.rows.map((r) => r.imageSize),
    [17, 16, 15, 14, 13, 12, 11],
    '大 → 小（界面「大小（大→小）」就是它）',
  );
  assert.deepEqual(
    desc.data.rows.map((r) => r.stem),
    ['zz1', 'd1', 'c1', 'b2', 'b1', 'a2', 'a1'],
  );

  // 排序**不影响** total 与 facets（SPEC §5.1：facets 恒按全库）
  assert.equal(asc.data.total, 7);
  assert.equal(desc.data.total, 7);
  assert.deepEqual(desc.data.facets.folders.map((f) => f.value).sort(), [
    'AA',
    'BB',
    'CC',
    'DD',
    'ZZ',
  ]);

  // 分页 + 排序一起用：两页不重叠、合起来正好 7 条
  const p1 = q({ sort: '-imageSize', limit: 3 });
  const p2 = q({ sort: '-imageSize', limit: 3, offset: 3 });
  assert.deepEqual(
    p1.data.rows.map((r) => r.stem),
    ['zz1', 'd1', 'c1'],
  );
  assert.deepEqual(
    p2.data.rows.map((r) => r.stem),
    ['b2', 'b1', 'a2'],
  );
  assert.equal(p1.data.total, 7, 'total 与排序/分页无关');
  assert.deepEqual(
    p1.data.rows.filter((a) => p2.data.rows.some((b) => b.uid === a.uid)),
    [],
  );
});

test('I10 ⭐⭐ archiveSize 排序 + **NULL 位次**（无包条目 = NULL，不是 0）', () => {
  // 夹具：有包 a1=110 / b1=130 / d1=160；无包 a2 / b2 / c1 / zz1 ⇒ archiveSize = NULL
  const asc = q({ sort: 'archiveSize' });
  assert.equal(
    asc.ok,
    true,
    'archiveSize 必须是合法排序键（实得 ' + (asc.ok ? '' : asc.error.code) + '）',
  );
  // ⚠️ **NULL 排最前**（SQLite 把 NULL 当最小值）+ NULL 之间按 a.uid 兜底 ⇒ 分页确定
  assert.deepEqual(
    asc.data.rows.map((r) => r.stem),
    ['a2', 'b2', 'c1', 'zz1', 'a1', 'b1', 'd1'],
  );
  assert.deepEqual(
    asc.data.rows.slice(0, 4).map((r) => r.archiveSize),
    [null, null, null, null],
  );
  assert.deepEqual(
    asc.data.rows.slice(4).map((r) => r.archiveSize),
    [110, 130, 160],
  );

  const desc = q({ sort: '-archiveSize' });
  assert.equal(desc.ok, true);
  // ⚠️ **NULL 排最后** ⇒ 界面按「包大小（大→小）」时无包条目落在末尾
  assert.deepEqual(
    desc.data.rows.map((r) => r.stem),
    ['d1', 'b1', 'a1', 'a2', 'b2', 'c1', 'zz1'],
  );
  assert.deepEqual(
    desc.data.rows.slice(0, 3).map((r) => r.archiveSize),
    [160, 130, 110],
  );
  assert.deepEqual(
    desc.data.rows.slice(3).map((r) => r.archiveSize),
    [null, null, null, null],
  );

  // NULL 是 **null 而不是 0**：界面显示「无包」而不是「0 B」
  assert.equal(asc.data.rows[0].archiveSize, null);
  assert.ok(!asc.data.rows.some((r) => r.archiveSize === 0), '无包条目不许被写成 0 字节');
  // 常见的错法：按包体积排序时用 INNER JOIN ⇒ 无包条目**整行消失**（7 → 3）
  assert.equal(asc.data.rows.length, 7, '无包条目必须仍在列表里（不是被 INNER JOIN 丢掉）');
  assert.equal(asc.data.total, 7);
  assert.equal(desc.data.total, 7);
});

test('I11 ⭐ 体积键分页在**含 NULL** 时仍然确定（不会同一行出现在两页）', () => {
  const all = q({ sort: 'archiveSize', limit: 100 }).data.rows.map((r) => r.uid);
  const pages = [];
  for (let off = 0; off < 7; off += 2)
    pages.push(...q({ sort: 'archiveSize', limit: 2, offset: off }).data.rows.map((r) => r.uid));
  assert.deepEqual(pages, all, '逐页拼起来必须与一次取完**同序同集合**');
  assert.equal(new Set(pages).size, 7, '不许有重复行');
});

test('I12 ⭐⭐ 白名单 ↔ 实现**双向对齐**（12 项逐字；少一个界面点不动、多一个契约先拒）', () => {
  assert.deepEqual(
    [...SORT_KEYS],
    [
      'relPath',
      '-relPath',
      'folder',
      '-folder',
      'stem',
      '-stem',
      'imageMtime',
      '-imageMtime',
      'imageSize',
      '-imageSize',
      'archiveSize',
      '-archiveSize',
    ],
    'SORT_KEYS 必须是这 12 项',
  );
  assert.equal(SORT_KEYS.length, 12);
  // 契约侧：12 项**全部**通过校验（少一个/多一个都会在这条红）
  for (const k of SORT_KEYS) {
    assert.equal(validateCall('items', { libId: 'L1', sort: k }).ok, true, '契约不认排序键：' + k);
  }
  // 反向：不在实现里的键不许被契约放行（防止契约比实现宽 → 排不动却不报错）
  for (const bogus of ['size', 'imageSizes', '-archiveSizeBytes', 'bytes']) {
    assert.equal(
      validateCall('items', { libId: 'L1', sort: bogus }).ok,
      false,
      '契约不该放行：' + bogus,
    );
  }
});

// ============================================================ DF-2：bigint 不许静默变 0

/**
 * 模拟 readBigInts：真实库 + 真实 SQL，只把**查询用到的**整数列换成 bigint（值不变、类型变）。
 *
 * ⚠️ 为什么只换这几列：`openGsDb` 会**先跑迁移**，而迁移账本的 `readVersionRow` 只接受 number
 * （遇到 bigint **响亮抛 META_ROW_MISSING** —— 那是它自己的正确行为，见 app-db.test.mjs 的 D5b）。
 * 全都换掉的话，测的就不是"列表读 bigint"而是"迁移读 bigint"了。这几列正是本模块 SELECT 的整数列。
 */
function bigintDriver(columns = ['n', 'count', 'size_bytes', 'mtime_ms', 'vector_row']) {
  return (file, options) => {
    const db = openNodeSqlite(file, options);
    const conv = (row) => {
      if (!row) return row;
      const out = { ...row };
      for (const k of columns) if (typeof out[k] === 'number') out[k] = BigInt(out[k]);
      return out;
    };
    return {
      exec: (s) => db.exec(s),
      close: () => db.close(),
      get isOpen() {
        return db.isOpen;
      },
      prepare: (s) => {
        const st = db.prepare(s);
        return {
          run: (...p) => st.run(...p),
          get: (...p) => conv(st.get(...p)),
          all: (...p) => st.all(...p).map(conv),
        };
      },
    };
  };
}

test('I13 ⭐⭐ COUNT/GROUP BY 的整数读成 bigint 也必须正确（total / facets 计数 不许静默变 0）', () => {
  // 只把**聚合列**换成 bigint（行字段由 S2 的映射器把关，见 I13b：它对 bigint 是**响亮拒绝**）
  const r = runItemsQuery(
    { ...input(), driver: bigintDriver(['n', 'count']) },
    { libId: LIB_ID, limit: 3 },
  );
  assert.equal(
    r.ok,
    true,
    'bigint 路径不许把查询搞崩：' + (r.ok ? '' : r.error.code + ' ' + r.error.message),
  );
  assert.equal(r.data.total, 7, 'COUNT(*) 读成 bigint 时不许静默变 0（旧写法就是 0）');
  assert.equal(r.data.facets.foldersTotal, 5, 'COUNT(DISTINCT folder) 同理');
  assert.equal(r.data.facets.extsTotal, 3);
  assert.equal(r.data.facets.exts[0].value, '.jpg');
  assert.equal(r.data.facets.exts[0].count, 4, 'GROUP BY 的 count 读成 bigint 时不许变 0');
  assert.equal(r.data.facets.folders.find((f) => f.value === 'ZZ').count, 1);
  assert.equal(r.data.rows.length, 3);
  assert.equal(r.data.rows[0].imageSize, 11, '行字段这条路（聚合关了 bigint）仍要正确');
  assert.equal(
    r.data.rows.find((x) => x.stem === 'a2' && x.folder === 'AA').archiveSize,
    null,
    '可空列仍是 null，不是 0',
  );
  // 排序/分页在聚合 bigint 路径下也必须成立
  const sorted = runItemsQuery(
    { ...input(), driver: bigintDriver(['n', 'count']) },
    { libId: LIB_ID, sort: '-imageSize', limit: 2 },
  );
  assert.deepEqual(
    sorted.data.rows.map((x) => x.stem),
    ['zz1', 'd1'],
  );
  assert.equal(sorted.data.total, 7);
});

test('I13b ⭐ 行字段读成 bigint ⇒ **响亮失败**（不是静默 0）—— 边界归 S2 的映射器，如实钉住', () => {
  // 实测：joinedRowToItemRecord（S2 的，我不改）对 bigint 是**显式拒绝**：
  //   IMPORT_RECORD_INVALID … 字段 vectorRow 类型不对：期望有限的 number 或 null，实际 bigint(0)
  // 即：行这条路在 bigint 下**不会**静默变 0/ null，而是给失败信封（userMessage 非空）。
  // 若将来映射器改成接受 bigint，我这边 numberOrNullOf 会接手收窄 —— 那时这条要跟着改成"成功且值正确"。
  // ⚠️ 注入的列名要用**本模块 SELECT 的别名**（image_size / image_mtime / archive_size / vector_row），
  //    不是底层列名（size_bytes）—— 我第一次写成 size_bytes，等于什么都没换，测试假绿。
  const r = runItemsQuery(
    { ...input(), driver: bigintDriver(['image_size']) },
    { libId: LIB_ID, limit: 1 },
  );
  assert.equal(r.ok, false, 'bigint 行字段必须落成失败信封（不许静默 0）');
  assert.ok(r.error.userMessage.length > 0, '信封契约：userMessage 恒非空');
  assert.match(
    r.error.message,
    /bigint|类型不对|IMPORT_RECORD_INVALID/i,
    '要说清是类型问题：' + r.error.message,
  );
  // 对照：同样的查询、不换类型 ⇒ 成功（证明上面不是恒失败）
  assert.equal(runItemsQuery(input(), { libId: LIB_ID, limit: 1 }).ok, true);
});

test('I14 ⭐ 取值类型不对 ⇒ 给**带码信封**（不是静默 0/空串，也不是抛穿到调用方）', () => {
  // 把 COUNT 换成不认识的类型（模拟列类型漂移）⇒ 必须变成失败信封 + 人话，而不是 0
  const bogus = (file, options) => {
    const db = openNodeSqlite(file, options);
    const conv = (row) => (row && Object.hasOwn(row, 'n') ? { ...row, n: {} } : row);
    return {
      exec: (s) => db.exec(s),
      close: () => db.close(),
      get isOpen() {
        return db.isOpen;
      },
      prepare: (s) => {
        const st = db.prepare(s);
        return {
          run: (...p) => st.run(...p),
          get: (...p) => conv(st.get(...p)),
          all: (...p) => st.all(...p).map(conv),
        };
      },
    };
  };
  const r = runItemsQuery({ ...input(), driver: bogus }, { libId: LIB_ID });
  assert.equal(r.ok, false, '类型不认识时必须失败（不许静默变 0 条）');
  assert.ok(r.error.userMessage.length > 0, '失败也要给人话（信封契约：userMessage 恒非空）');
  assert.match(
    r.error.message,
    /UNEXPECTED_SQL_VALUE|number|bigint/i,
    '报错要说清是不认识的类型：' + r.error.message,
  );
});

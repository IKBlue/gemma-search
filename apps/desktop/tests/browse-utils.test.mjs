// apps/desktop/tests/browse-utils.test.mjs —— P4-2：F2 浏览页的**纯函数 + 状态机**单测
//
// 为什么能这么测：`utils/browse.ts` 与 `store/browse.ts` 都不 import React、不碰 window.api
// （取数是**注入**的 `BrowseFetcher`）⇒ 纯 Node 里就能跑完「筛选 → 排序 → 分页 → 空态 → 状态机」。
//
// 这一组要钉住的是**判据本身**，尤其四件容易做错的事：
//   B3  缺失值（体积/时间未知）必须排**最后**，不能伪装成 0 或最早；
//   B6  「空库」与「筛选筛没了」必须是**两种**状态（混起来就是谎报）；
//   B11 真数据路径下**不许本地重排**（主进程筛/排是唯一判据，本地再排一次就是第二份实现，P1）；
//   B21 只发 **S8 白名单里那 8 个** sort 串（界面不许发明后端不认的排序键）。
//
// ⚠️ 行形状与 `SORTS` 都**照抄 S8 的 `ItemsWireRow` / `SORT_COLUMNS`**（见 utils/browse.ts 头部）。
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQuery, matchesFilters, sortRows, applyLocal, facetsOf, deriveBrowseView,
  facetOptions, facetHidden, sortWire, hasArchive, rowLabel, archiveSizeOf,
  NO_FILTERS, NO_FACETS, SORTS,
} from '../src/renderer/src/utils/browse.ts'
import { useBrowseStore } from '../src/renderer/src/store/browse.ts'

const S = () => useBrowseStore.getState()

function fakeBridge(reply) {
  const calls = []
  globalThis.window = {
    api: {
      invoke: async (method, params) => { calls.push({ method, params }); return reply(method, params) },
      onEvent: () => () => {},
      platform: 'win32',
    },
  }
  return calls
}
let savedWindow
beforeEach(() => { savedWindow = globalThis.window; S().__reset(); globalThis.window = undefined })
afterEach(() => { globalThis.window = savedWindow })

/** 造一行（**字段与 S8 的 ItemsWireRow 逐字对齐**：imageExt/imageSize/imageMtime + archiveRelPath） */
const row = (over = {}) => Object.assign({
  uid: 'a'.repeat(12), libId: 'L1', folder: 'VR', stem: 'x', relPath: 'VR/x.jpg',
  imageExt: '.jpg', imageSize: 1000, imageMtime: 1000,
  archiveRelPath: 'VR/x.zip', archiveExt: '.zip', archiveSize: 5000, archiveMtime: 1000,
  vectorRow: 0,
}, over)

const ROWS = [
  row({ uid: 'b'.repeat(12), stem: 'banana', relPath: 'CR/banana.jpg', folder: 'CR', imageExt: '.jpg', imageSize: 300, imageMtime: 3000, archiveRelPath: null, archiveExt: null }),
  row({ uid: 'a'.repeat(12), stem: 'apple', relPath: 'VR/apple.png', folder: 'VR', imageExt: '.png', imageSize: 200, imageMtime: 1000 }),
  row({ uid: 'c'.repeat(12), stem: 'cherry', relPath: 'VR/cherry.jpg', folder: 'VR', imageExt: '.jpg', imageSize: 100, imageMtime: 2000 }),
]

// ============================================================ 行形状的小工具

test('B0：「有没有包」只有一处判据（archiveRelPath == null ⇒ 缺包），展示名兜底顺序也固定', () => {
  assert.equal(hasArchive(row()), true)
  assert.equal(hasArchive(row({ archiveRelPath: null })), false)
  assert.equal(hasArchive(row({ archiveRelPath: '' })), false, '空串也是「没有」，别把它当有包')
  assert.equal(rowLabel(row({ name: '显示名' })), '显示名')
  assert.equal(rowLabel(row({ name: '' })), 'x', 'name 空 ⇒ 退到 stem')
  assert.equal(rowLabel(row({ name: '', stem: '' })), 'VR/x.jpg', '再空 ⇒ 退到 relPath')
})

// ============================================================ 筛选

test('B1：空筛选放行全部；每一维都真的在筛（目录 / 扩展名 / 有无包）', () => {
  assert.equal(ROWS.filter((r) => matchesFilters(r, NO_FILTERS)).length, 3)
  assert.deepEqual(ROWS.filter((r) => matchesFilters(r, { ...NO_FILTERS, folder: 'VR' })).map((r) => r.stem), ['apple', 'cherry'])
  assert.deepEqual(ROWS.filter((r) => matchesFilters(r, { ...NO_FILTERS, ext: '.jpg' })).map((r) => r.stem), ['banana', 'cherry'])
  assert.deepEqual(ROWS.filter((r) => matchesFilters(r, { ...NO_FILTERS, hasArchive: false })).map((r) => r.stem), ['banana'])
  // 扩展名大小写不敏感（扫描给的是小写，但用户手填不该被大小写坑）
  assert.equal(ROWS.filter((r) => matchesFilters(r, { ...NO_FILTERS, ext: '.JPG' })).length, 2)
})

test('B2：筛选条件是**与**关系（多维同时生效），且分类为空的行不会被分类筛选误放行', () => {
  const both = ROWS.filter((r) => matchesFilters(r, { folder: 'VR', ext: '.jpg', hasArchive: true }))
  assert.deepEqual(both.map((r) => r.stem), ['cherry'])
  const noFolder = row({ folder: '', stem: 'orphan' })
  assert.equal(matchesFilters(noFolder, { ...NO_FILTERS, folder: 'VR' }), false)
})

// ============================================================ 排序

test('B3 ⭐ 排序：名称升序 / 体积降序 / 时间降序，且**缺失值一律排最后**', () => {
  assert.deepEqual(sortRows(ROWS, 'name', 'asc').map((r) => r.stem), ['apple', 'banana', 'cherry'])
  assert.deepEqual(sortRows(ROWS, 'size', 'desc').map((r) => r.stem), ['banana', 'apple', 'cherry'])
  assert.deepEqual(sortRows(ROWS, 'mtime', 'desc').map((r) => r.stem), ['banana', 'cherry', 'apple'])
  const withMissing = [...ROWS, row({ uid: 'd'.repeat(12), stem: 'unknown-size', imageSize: null, imageMtime: null })]
  assert.equal(sortRows(withMissing, 'size', 'desc').at(-1).stem, 'unknown-size', '体积未知必须排最后，不能当成 0')
  assert.equal(sortRows(withMissing, 'mtime', 'desc').at(-1).stem, 'unknown-size', '时间未知同理')
})

test('B4：排序**不改原数组**（调用方拿到的 rows 是 store 里的那份，就地改会引发看不见的互相污染）', () => {
  const before = ROWS.map((r) => r.stem)
  sortRows(ROWS, 'size', 'desc')
  assert.deepEqual(ROWS.map((r) => r.stem), before)
})

// ============================================================ 分页 / 查询拼装（**S8 白名单**）

test('B5：applyLocal 的 total 是**筛选后**总数，offset/limit 只影响返回的行', () => {
  const all = applyLocal({ rows: ROWS })
  assert.equal(all.total, 3)
  assert.equal(all.rows.length, 3)
  const page = applyLocal({ rows: ROWS, offset: 1, limit: 1 })
  assert.equal(page.total, 3, '越界/分页时 total 仍要如实给筛选后的总数')
  assert.equal(page.rows.length, 1)
  const filtered = applyLocal({ rows: ROWS, filters: { ...NO_FILTERS, folder: 'VR' } })
  assert.equal(filtered.total, 2, 'total 必须是筛选后的数量，不是全库数量')
})

test('B5b：buildQuery 只带**真正要传**的字段（不筛 = 省略，不是传空串/undefined）', () => {
  const q = buildQuery({ libId: 'L1', filters: NO_FILTERS, sortKey: 'name', offset: 0, limit: 200 })
  assert.deepEqual(q, { libId: 'L1', sort: 'relPath', limit: 200 })
  const q2 = buildQuery({ libId: 'L1', filters: { folder: 'VR', ext: '', hasArchive: false }, offset: 5 })
  assert.deepEqual(q2, { libId: 'L1', folder: 'VR', hasArchive: false, offset: 5 },
    '空串扩展名 = 不筛（省略）；hasArchive=false 是**真筛选**，必须带上')
})

test('B21 ⭐⭐ 只发白名单里那 **12** 个 sort 串（S8b 定稿）；界面档 → wire 的映射逐条对', () => {
  // ⚠️ 与 `main/items-ipc.ts` 的 SORT_COLUMNS 逐字对齐（4 键 × 正倒 = 8，**S8b 加 size 两键** ⇒ 12）。
  //    这份清单是**照抄**，不是发明：界面发出不在里面的串，后端会 BAD_REQUEST。
  const WHITELIST = [
    'relPath', '-relPath', 'folder', '-folder', 'stem', '-stem',
    'imageMtime', '-imageMtime', 'imageSize', '-imageSize', 'archiveSize', '-archiveSize',
  ]
  assert.equal(WHITELIST.length, 12)
  for (const s of SORTS) assert.ok(WHITELIST.includes(s.wire), `${s.key} 的 wire "${s.wire}" 不在白名单里 ⇒ 后端会 BAD_REQUEST`)
  assert.equal(sortWire('name'), 'relPath')
  assert.equal(sortWire('size'), '-archiveSize', '「大小」= **包**体积，默认大→小（用户直觉里的大小是包）')
  assert.equal(sortWire('mtime'), '-imageMtime', '时间默认新→旧（方向编在串里）')
  assert.equal(sortWire('folder'), '-folder')
  assert.equal(sortWire('不存在的档'), 'relPath', '认不出来退回默认，不抛')
  for (const q of SORTS.map((s) => ({ sortKey: s.key }))) {
    assert.ok(WHITELIST.includes(buildQuery({ libId: 'L1', ...q }).sort))
  }
})

/**
 * B22 ⭐⭐ **界面不二次重排**（NULL 位次以后端为准）。
 *
 * 为什么这条必须钉：S8b 裁决了 NULL 语义 = SQLite 默认（**正序 NULL 最前 · 倒序 NULL 最后**），
 * 于是「大→小」时**无包条目排在末尾**。如果界面在拿到 rows 之后再排一次，就会出现
 * 「后端一套位次、界面另一套」—— 同一份数据，两处各说一套（正是本项目要消灭的病）。
 * ⇒ store 只允许**原样收下**后端给的顺序；本地排序器（`applyLocal`/`sortRows`）只能服务测试与注入路径。
 */
test('B22 ⭐⭐ 后端给的顺序（含 NULL 条目在末尾）界面**原样渲染**，不做二次排序', async () => {
  // 后端在「大→小（-archiveSize）」下的真实形状：大包在前、**无包（archiveSize=null）在末尾**
  const fromBackend = [
    // 故意让**预览**体积的顺序与**包**体积的顺序不同 —— 这样「本地若按预览排」会露馅
    row({ uid: '1'.repeat(12), stem: 'big', archiveSize: 900, archiveRelPath: 'VR/big.zip', imageSize: 100 }),
    row({ uid: '2'.repeat(12), stem: 'mid', archiveSize: 500, archiveRelPath: 'VR/mid.zip', imageSize: 999 }),
    row({ uid: '3'.repeat(12), stem: 'no-archive', archiveRelPath: null, archiveExt: null, archiveSize: null }),
  ]
  S().setSortKey('size')
  const seen = []
  await S().load(async (q) => { seen.push(q); return { ok: true, data: { rows: fromBackend, total: 3 } } }, 'L1')
  assert.equal(seen[0].sort, '-archiveSize', '排序档要翻译成 wire 串发出去（而不是本地排）')
  assert.deepEqual(S().rows.map((r) => r.stem), ['big', 'mid', 'no-archive'],
    '界面必须**原样**保留后端顺序（NULL 在末尾）—— 二次排序就是第二套位次')
  // 反证：本地排序器在同样输入下**会**把它排成别的样子（id 前缀 uid 会打乱），说明它绝不能用在真数据路径上
  const locallySorted = applyLocal({ rows: fromBackend, sort: 'size', direction: 'desc' }).rows.map((r) => r.stem)
  assert.notDeepEqual(locallySorted, ['big', 'mid', 'no-archive'],
    '本地排序器与后端位次**不是同一套**（这正是「界面别纠正后端」的理由）')
  // 无包 = null（不是 0）：显示层据此说「—」，而不是说「0 字节」
  assert.equal(archiveSizeOf(fromBackend[2]), null)
  assert.equal(archiveSizeOf(fromBackend[0]), 900)
})

// ============================================================ 空态（三种「什么都没有」）

test('B6 ⭐⭐ 「空库」与「筛没了」是两种状态 —— 不许把 0 条一律当「没东西」', () => {
  const base = { loading: false, error: null, filters: NO_FILTERS }
  assert.equal(deriveBrowseView({ ...base, libraryTotal: 0, filteredTotal: 0 }), 'empty', '库本身是空的')
  assert.equal(deriveBrowseView({ ...base, libraryTotal: 10, filteredTotal: 0 }), 'empty',
    '没筛选却 0 条 ⇒ 仍然是「库是空的」（此时 libraryTotal 与 filteredTotal 应当一致；不一致说明数据源有问题）')
  assert.equal(
    deriveBrowseView({ ...base, filters: { folder: 'VR', ext: null, hasArchive: null }, libraryTotal: 10, filteredTotal: 0 }),
    'no-match', '有素材但被筛掉了 —— 必须与「空库」区分开')
  assert.equal(deriveBrowseView({ ...base, libraryTotal: 10, filteredTotal: 7 }), 'ready')
})

test('B6b：loading 与 error 优先于一切（读不出来时绝不能说「库是空的」）', () => {
  assert.equal(deriveBrowseView({ loading: true, error: null, libraryTotal: null, filteredTotal: 0 }), 'loading')
  assert.equal(
    deriveBrowseView({ loading: false, error: { code: 'INDEX_CORRUPT', userMessage: '索引坏了' }, libraryTotal: 0, filteredTotal: 0 }),
    'error', '「读失败」不是「空库」—— 把 0 条当空库就是谎报（与诊断页同一条纪律）')
})

test('B7：facetsOf 只从**给它的那批行**取分类与扩展名（测试/注入路径），去重 + 排序', () => {
  const f = facetsOf(ROWS)
  assert.deepEqual(f.folders, ['CR', 'VR'])
  assert.deepEqual(f.exts, ['.jpg', '.png'])
  assert.deepEqual(facetsOf([]), { folders: [], exts: [] })
})

test('B8：SORTS 是**四**个档，且**标签与 wire 方向一致**（名称 A→Z / 大小 大→小 / 时间 新→旧 / 分类 Z→A）', () => {
  assert.deepEqual(SORTS.map((s) => s.key), ['name', 'size', 'mtime', 'folder'])
  assert.equal(sortWire('name'), 'relPath')
  assert.equal(sortWire('size'), '-archiveSize', '「大小」= 包体积，大→小')
  assert.equal(sortWire('mtime'), '-imageMtime')
  assert.equal(sortWire('folder'), '-folder')
  // 档数上限是 Lead 定的（≤5）：加档别默默超
  assert.ok(SORTS.length <= 5, `排序档 ${SORTS.length} 个，超过约定上限 5`)
})

// ============================================================ store（状态机 + 注入取数）

test('B9：load 把**注入的 fetcher** 收到的查询参数如实传下去，并收下 rows/total/page', async () => {
  const seen = []
  const fetcher = async (q) => {
    seen.push(q)
    return { ok: true, data: { rows: ROWS, total: 3, page: { offset: 0, limit: 200, sort: 'relPath' } } }
  }
  await S().load(fetcher, 'L1', { limit: 200 })
  assert.equal(S().loading, false)
  assert.equal(S().error, null)
  assert.equal(S().rows.length, 3)
  assert.equal(S().total, 3)
  assert.equal(S().page.sort, 'relPath', '主进程回显的 page 要收下（界面据此如实说「按什么排」）')
  assert.deepEqual(seen[0], { libId: 'L1', sort: 'relPath', limit: 200 })
})

test('B10：筛选/排序变化**真的进入下一次取数**（不是只改了界面状态）', async () => {
  const seen = []
  const fetcher = async (q) => { seen.push(q); return { ok: true, data: { rows: [], total: 0 } } }
  S().setFilter({ folder: 'VR', hasArchive: true })
  S().setSortKey('mtime')
  await S().load(fetcher, 'L1', { limit: 200 })
  assert.deepEqual(seen[0], { libId: 'L1', folder: 'VR', hasArchive: true, sort: '-imageMtime', limit: 200 })
})

test('B11 ⭐ 真数据路径**不做本地筛选/排序**：store 原样收下主进程给的 rows（同一份判断不许有两处）', async () => {
  const serverRows = [ROWS[1], ROWS[0]]
  const fetcher = async () => ({ ok: true, data: { rows: serverRows, total: 2 } })
  S().setFilter({ folder: 'VR' })
  await S().load(fetcher, 'L1')
  assert.deepEqual(S().rows.map((r) => r.stem), ['apple', 'banana'],
    'store 必须**原样**保留主进程给的顺序/集合 —— 本地再筛一次就是第二份实现（P1），而且会掩盖主进程的 bug')
})

test('B12：失败路径 —— 收下 Adapter 的错误、清空 rows、且**不**把 0 条当成功', async () => {
  const err = { code: 'INDEX_CORRUPT', message: 'raw', userMessage: '索引文件已损坏，需要重建。' }
  await S().load(async () => ({ ok: false, error: err }), 'L1')
  assert.equal(S().error.userMessage, '索引文件已损坏，需要重建。')
  assert.deepEqual(S().rows, [])
  assert.equal(S().page, null)
  assert.equal(S().view(), 'error')
})

test('B13：loadLibraryTotal 只取 1 行来拿 total（不为了一个数字拉全库），并区分空库/筛没了', async () => {
  const seen = []
  const fetcher = async (q) => { seen.push(q); return { ok: true, data: { rows: [ROWS[0]], total: 3594 } } }
  await S().loadLibraryTotal(fetcher, 'L1')
  assert.equal(S().libraryTotal, 3594)
  assert.equal(seen[0].limit, 1, '为了 total 不该拉全库')
  assert.equal(seen[0].libId, 'L1')
  assert.equal('folder' in seen[0], false, '总数必须是**未筛选**的总数，否则区分不出「空库」与「筛没了」')
  assert.equal('ext' in seen[0], false)
})

test('B14：没有库（libId 为空）⇒ 不取数、不报错、保持空态（页面显示「没有库」而不是「库空了」）', async () => {
  let called = 0
  const fetcher = async () => { called += 1; return { ok: true, data: { rows: [], total: 0 } } }
  await S().load(fetcher, '')
  await S().loadLibraryTotal(fetcher, '')
  assert.equal(called, 0, '没有库时一个 IPC 都不该发')
  assert.equal(S().error, null)
})

test('B15：没有真 IPC 也没有注入（Adapter 的 NO_BRIDGE）⇒ 如实报错，不静默成功', async () => {
  const fetcher = async () => {
    const r = await (await import('../src/renderer/src/adapter/api.ts')).invoke('libraryList', {})
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
  }
  await S().load(fetcher, 'L1')
  assert.equal(S().error.code, 'NO_BRIDGE')
  assert.equal(S().rows.length, 0)
  assert.equal(S().view(), 'error')
})

// ============================================================ facets（后端给的整库统计）

test('B16 ⭐ 下拉项来自**后端整库统计**，不从当前页样本推导（样本推导会漏值 + 随分页跳动）', () => {
  const pageRows = [row({ uid: 'e'.repeat(12), stem: 'in-page', folder: 'VR', imageExt: '.jpg' })]
  assert.deepEqual(facetsOf(pageRows).folders, ['VR'], '（对照）样本推导只看得到本页那一个')
  const fromBackend = {
    folders: [{ value: 'CR', count: 900 }, { value: 'VR', count: 42 }, { value: 'CR+VR', count: 7 }],
    exts: [{ value: '.jpg', count: 1000 }, { value: '.png', count: 12 }],
    foldersTotal: 3,
    extsTotal: 2,
  }
  assert.deepEqual(facetOptions(fromBackend, 'folders').map((f) => f.value), ['CR', 'VR', 'CR+VR'],
    '后端给的就是权威值：即使本页只有 VR，也要能看到 CR / CR+VR')
  assert.deepEqual(facetOptions(fromBackend, 'exts').map((x) => x.value), ['.jpg', '.png'])
})

test('B17：没有 facets（注入的假数据没给）⇒ 下拉项为空，**不拿样本冒充权威值**', () => {
  assert.deepEqual(facetOptions(null, 'folders'), [])
  assert.deepEqual(facetOptions(undefined, 'exts'), [])
  assert.deepEqual(facetOptions(NO_FACETS, 'folders'), [])
  assert.equal(facetHidden(null, 'folders'), 0)
  assert.equal(facetHidden(NO_FACETS, 'exts'), 0)
})

test('B18 ⭐ 后端截断了就如实说「还有 N 个」（foldersTotal - 已给条数），不假装列全了', () => {
  const truncated = {
    folders: [{ value: 'VR', count: 10 }, { value: 'CR', count: 9 }],
    exts: [{ value: '.jpg', count: 19 }],
    foldersTotal: 5,
    extsTotal: 1,
  }
  assert.equal(facetHidden(truncated, 'folders'), 3, '列了 2 个、库里共 5 个 ⇒ 还有 3 个没列')
  assert.equal(facetHidden(truncated, 'exts'), 0, '扩展名全列了 ⇒ 不许显示「还有 0 个」')
  assert.equal(facetHidden({ ...truncated, foldersTotal: 1 }, 'folders'), 0, '总数异常时不能算出负数')
})

test('B19：facetOptions 过滤掉空 value（后端偶发空串不该在下拉里出现一个空选项）', () => {
  const messy = {
    folders: [{ value: '', count: 3 }, { value: 'VR', count: 2 }, { value: null, count: 1 }],
    exts: [{ value: '.jpg', count: 5 }],
    foldersTotal: 3,
    extsTotal: 1,
  }
  assert.deepEqual(facetOptions(messy, 'folders').map((f) => f.value), ['VR'])
})

test('B20 ⭐ facets 是整库口径：loadLibraryTotal（不带筛选）收下它；load 没给 facets 时**保留**上一次', async () => {
  const facets = {
    folders: [{ value: 'VR', count: 2 }], exts: [{ value: '.jpg', count: 2 }], foldersTotal: 1, extsTotal: 1,
  }
  await S().loadLibraryTotal(async () => ({ ok: true, data: { rows: [], total: 2, facets } }), 'L1')
  assert.deepEqual(S().facets.folders, [{ value: 'VR', count: 2 }], '整库统计要收进 store')
  await S().load(async () => ({ ok: true, data: { rows: ROWS, total: 3 } }), 'L1')
  assert.deepEqual(S().facets.folders, [{ value: 'VR', count: 2 }], '没给 facets 时保留上一次，不清空')
  const next = { folders: [{ value: 'CR', count: 9 }], exts: [], foldersTotal: 1, extsTotal: 0 }
  await S().load(async () => ({ ok: true, data: { rows: [], total: 0, facets: next } }), 'L1')
  assert.deepEqual(S().facets.folders, [{ value: 'CR', count: 9 }])
})

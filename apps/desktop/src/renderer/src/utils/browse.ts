// utils/browse.ts —— F2「浏览整库」的**筛选 / 排序 / 空态判定**（Operation 层，纯函数）
//
// ── 为什么这些必须抽成纯函数（P4-2 的验收项）────────────────────────────────
//   `.tsx` 在 `node:test` 里加载不了 ⇒ 把筛选/排序写进组件等于**放弃自动化**（本项目反复栽过）。
//   抽出来之后：
//     · 单测能直接喂行数组，断言 `total` / 顺序 / 空态；
//     · 组件只负责「把状态交给它、把结果画出来」。
//
// ── ⚠️ 依赖注入：主进程版本还是本地版本（2026-10-15，S8 尚未落地）─────────────
//   `items` 是 S8（task-62）要实现的只读列表方法，**当前契约里还没有它**（§5.1 已写、实现未到）。
//   ⇒ 本模块提供 `applyLocal()` —— **本地**的筛选/排序，语义与 `items` 的入参一一对应，
//     用来：① 给单测确定性地断言语义；② S8 落地前用**注入的假数据**把页面跑起来。
//   ⇒ S8 落地后，真实路径是**把 `BrowseQuery` 发给主进程**（它按同一语义返回 rows/total）；
//     那时 UI **不再**本地重排（否则就是同一份判断的第二处实现，P1）。
//     所以 `applyLocal` 的定位写死为「测试/注入路径」，别在真数据路径上顺手用它。
//
// ── 空态为什么必须分开（SPEC：不许把「0 条」当「没东西」）──────────────────
//   三种「什么都没有」在界面上是**三件不同的事**，处理方式也不同：
//     · `empty`     —— 库是空的（还没有素材）⇒ 指引去扫描/入库；
//     · `no-match`  —— 有素材，但当前筛选条件筛没了 ⇒ 让用户改筛选（≠ 库坏了）；
//     · `error`     —— 读不出来（索引坏 / 库不可用）⇒ 给重建/诊断入口。
//   混成一个「没东西」会让用户以为库空了 —— 那是**谎报**（与 T-15b 同一条纪律）。
import type { AdapterError } from '../adapter/api.ts'

/** 列表的一行（`items` 的 `rows[]` 元素；字段按 SPEC §1 的 asset/asset_file 口径） */
export type BrowseRow = {
  uid: string
  libId?: string
  stem?: string
  relPath?: string
  folder?: string | null
  /** 预览图扩展名（小写、带点，例如 `.jpg`）；缺省 = 未知 */
  ext?: string | null
  /** 有没有同名压缩包（缺包是允许的常态） */
  hasArchive?: boolean
  size?: number | null
  mtime?: number | null
}

export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

export const SORTS: ReadonlyArray<{ key: SortKey; label: string; dir: SortDir }> = Object.freeze([
  Object.freeze({ key: 'name', label: '名称 A→Z', dir: 'asc' as SortDir }),
  Object.freeze({ key: 'size', label: '体积 大→小', dir: 'desc' as SortDir }),
  Object.freeze({ key: 'mtime', label: '时间 新→旧', dir: 'desc' as SortDir }),
])

/** 筛选条件（与 `items` 入参**一一对应**；`null`/`''` = 不筛，不是「筛空」） */
export type BrowseFilters = {
  folder: string | null
  ext: string | null
  /** null = 全部；true = 只看有包；false = 只看缺包 */
  hasArchive: boolean | null
}

export const NO_FILTERS: BrowseFilters = Object.freeze({ folder: null, ext: null, hasArchive: null })

export type BrowseQuery = {
  libId: string
  folder?: string
  ext?: string
  hasArchive?: boolean
  sort?: SortKey
  /** 主进程侧的排序方向。SPEC §5.1 只列了 `sort`，方向先由有序的枚举名承载（见 §报告未决 2） */
  direction?: SortDir
  offset?: number
  limit?: number
}

/**
 * 把「界面状态」翻成 `items` 的入参。
 * ⚠️ **不传 undefined 字段**：契约是 `.strict()`，但更实际的理由是——传 `undefined` 与不传在
 *    JSON 序列化后都可能出现，而「不筛」的语义必须以**省略**表达，不能靠一个空串（空串会被当成真筛选）。
 */
export function buildQuery(input: {
  libId: string
  filters?: BrowseFilters | null
  sort?: SortKey
  direction?: SortDir
  offset?: number
  limit?: number
}): BrowseQuery {
  const f = input.filters ?? NO_FILTERS
  const q: BrowseQuery = { libId: input.libId }
  if (typeof f.folder === 'string' && f.folder) q.folder = f.folder
  if (typeof f.ext === 'string' && f.ext) q.ext = f.ext
  if (typeof f.hasArchive === 'boolean') q.hasArchive = f.hasArchive
  if (input.sort) q.sort = input.sort
  if (input.direction) q.direction = input.direction
  if (typeof input.offset === 'number' && input.offset > 0) q.offset = input.offset
  if (typeof input.limit === 'number' && input.limit > 0) q.limit = input.limit
  return q
}

/** 一行是否满足筛选条件（**导出的判据只有这一份**，`applyLocal` 与将来主进程侧都按它对齐） */
export function matchesFilters(row: BrowseRow, f: BrowseFilters): boolean {
  if (f.folder && (row.folder ?? '') !== f.folder) return false
  if (f.ext) {
    const ext = (row.ext ?? '').toLowerCase()
    if (ext !== f.ext.toLowerCase()) return false
  }
  if (typeof f.hasArchive === 'boolean' && Boolean(row.hasArchive) !== f.hasArchive) return false
  return true
}

/** 数值字段是否**真的有值**（null / undefined / NaN / 非数字都算「没有」）。
 *  ⚠️ 别写成 `Number.isFinite(Number(x))` —— `Number(null) === 0` 是**有限数**，
 *    那会把「体积未知」当成「0 字节」排到最前面（本地实测踩到，B3 就是钉这一条的）。 */
function hasNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 排序（纯函数，不改原数组）。
 * · 名称：localeCompare('zh-Hans-CN')（中文目录名也按人读的顺序）；
 * · 体积 / 时间：**缺失值一律排最后**（不伪装成 0 / 最早）—— 两个方向都一样，
 *   所以缺失比较**不参与方向翻转**（翻了就变成「排最前」，与承诺相反）。
 */
export function sortRows(rows: readonly BrowseRow[], key: SortKey = 'name', dir: SortDir = 'asc'): BrowseRow[] {
  const out = [...rows]
  const text = (r: BrowseRow): string => String(r.stem || r.relPath || '')
  const numOf = (r: BrowseRow): number | null => {
    if (key === 'size') return hasNumber(r.size) ? r.size : null
    return hasNumber(r.mtime) ? r.mtime : null
  }
  out.sort((a, b) => {
    if (key === 'name') {
      const r = text(a).localeCompare(text(b), 'zh-Hans-CN')
      return dir === 'desc' ? -r : r
    }
    const an = numOf(a)
    const bn = numOf(b)
    if (an === null && bn === null) return 0
    if (an === null) return 1        // 缺失永远最后
    if (bn === null) return -1
    const r = an - bn
    return dir === 'desc' ? -r : r
  })
  return out
}

/**
 * **本地**筛选 + 排序（测试 / 注入路径专用）。
 * 与 `items` 的目标语义一一对应，返回的 `total` 是**筛选后**的总数（不是本次返回的行数）。
 */
export function applyLocal(input: {
  rows: readonly BrowseRow[]
  filters?: BrowseFilters | null
  sort?: SortKey
  direction?: SortDir
  offset?: number
  limit?: number
}): { rows: BrowseRow[]; total: number } {
  const f = input.filters ?? NO_FILTERS
  const all = input.rows.filter((r) => matchesFilters(r, f))
  const sorted = sortRows(all, input.sort ?? 'name', input.direction ?? 'asc')
  const offset = Math.max(0, input.offset ?? 0)
  const limit = input.limit && input.limit > 0 ? input.limit : sorted.length
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length }
}

/**
 * 缩略图 URL。**取图路径只有既有 `thumb://` 这一种**（不许自造第二种）。
 *
 * ⚠️ 为什么要有这个函数（不是直接在 JSX 里拼模板串）：
 *   `libId` / `uid` 任何一个缺失时，模板串会拼出 `thumb://undefined/<uid>@256` ——
 *   那既是一个**注定 400 的请求**，又会让界面上出现字面量 `undefined`（Apple Style V-42 那一类，
 *   `copy.test.mjs` 的 CP-3 会当场抓住）。
 *   ⇒ 缺参数就**返回 null**，由调用点显示「无预览」兜底 —— 不去请求、也不显示假 URL。
 */
export function thumbSrc(libId: string | null | undefined, uid: string | null | undefined, size = 256): string | null {
  const lib = typeof libId === 'string' ? libId.trim() : ''
  const id = typeof uid === 'string' ? uid.trim() : ''
  if (!lib || !id) return null
  return `thumb://${encodeURIComponent(lib)}/${id}@${size}`
}

/**
 * 下拉项（**由后端给**，2026-10-15 Lead 裁定 · SPEC §5.1 的 `facets`）。
 *
 * ⚠️ 为什么不能像第一版那样「从当前页样本推导」（那是**错的**，不是不优雅）：
 *   · **漏值**：不在本页的分类永远看不到；
 *   · **随分页跳动**：同一份数据翻到第 2 页，下拉项就变了 ⇒ 用户会以为库变了。
 *   ⇒ 后端按**整库**统计（不受筛选影响）：一条 GROUP BY，count 降序前 200 + 总数。
 */
export type FacetEntry = { value: string; count: number }

export type BrowseFacets = {
  folders: FacetEntry[]
  exts: FacetEntry[]
  /** 整库的分类总数（可能 > folders.length ⇒ 界面要如实说「还有 N 个」） */
  foldersTotal: number
  /** 整库的扩展名总数（同上） */
  extsTotal: number
}

/** 空 facets（后端还没给 / 注入路径没提供时用它，**不要**用样本推导去冒充权威值） */
export const NO_FACETS: BrowseFacets = Object.freeze({ folders: [], exts: [], foldersTotal: 0, extsTotal: 0 })

/**
 * 取要显示的项。真数据路径用这个（值来自 `items` 的 `facets`）。
 * ⚠️ 与下面 `facetsOf()` 的区别：那个只看**给它的那批行**（测试/注入路径），这个来自**整库统计**。
 */
export function facetOptions(facets: BrowseFacets | null | undefined, key: 'folders' | 'exts'): FacetEntry[] {
  if (!facets) return []
  const list = key === 'folders' ? facets.folders : facets.exts
  return Array.isArray(list) ? list.filter((e) => e && typeof e.value === 'string' && e.value) : []
}

/** 后端截断了多少项没给（0 = 全给了）—— 界面据此**如实说「还有 N 个」**，不假装列全了 */
export function facetHidden(facets: BrowseFacets | null | undefined, key: 'folders' | 'exts'): number {
  if (!facets) return 0
  const total = Number(key === 'folders' ? facets.foldersTotal : facets.extsTotal)
  const shown = facetOptions(facets, key).length
  if (!Number.isFinite(total) || total <= shown) return 0
  return total - shown
}

/**
 * 计算**给定这批行**里出现过的分类 / 扩展名。
 * ⚠️ 只在**测试 / 注入数据**路径上用（假数据没有 facets）。
 *    真数据路径**必须**用后端给的整库统计 —— 从样本推导会说谎（漏值 + 随分页跳动）。
 */
export function facetsOf(rows: readonly BrowseRow[]): { folders: string[]; exts: string[] } {
  const folders = new Set<string>()
  const exts = new Set<string>()
  for (const r of rows) {
    const folder = (r.folder ?? '').trim()
    if (folder) folders.add(folder)
    const ext = (r.ext ?? '').trim().toLowerCase()
    if (ext) exts.add(ext)
  }
  return { folders: [...folders].sort(), exts: [...exts].sort() }
}

/** 界面上要画的四种状态之一。**「空库」与「筛没了」是两件事**，不许合并 */
export type BrowseView = 'loading' | 'error' | 'empty' | 'no-match' | 'ready'

export function deriveBrowseView(input: {
  loading: boolean
  error: AdapterError | null
  /** **未筛选**时的库内总数（页面第一次不带筛选拉到的 total）；null = 还不知道 */
  libraryTotal: number | null
  /** 当前筛选后的总数（就是 `items` 返回的 total） */
  filteredTotal: number
  filters?: BrowseFilters | null
}): BrowseView {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  const f = input.filters ?? NO_FILTERS
  const filtered = Boolean(f.folder || f.ext || typeof f.hasArchive === 'boolean')
  if (input.filteredTotal > 0) return 'ready'
  // 总数 0：分清「库是空的」与「筛没了」
  if (!filtered) return 'empty'
  return input.libraryTotal === 0 ? 'empty' : 'no-match'
}

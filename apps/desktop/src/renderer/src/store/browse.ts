// store/browse.ts —— F2「浏览整库」的状态（Operation 层，P4-2）
//
// 分层（AGENTS §2）：本文件**不 import React**、不碰 `window.api` ⇒ 纯逻辑可在 `node:test` 里跑。
// 协议细节不在这里：取数由调用点注入一个 `BrowseFetcher`（页面传 Adapter 包装好的那个）。
//
// ── ⚠️ 为什么取数是**注入**的（而不是在 store 里直接 apiInvoke）────────────────
//   F2 的读路径是 `items`（SPEC §5.1 第 21 个方法），**实现是 S8（task-62），当前契约里还没有**。
//   把 `'items'` 写死在 store 里会：① 在 S8 落地前**通不过 tsc**（MethodName 联合里没有它）；
//   ② 让单测只能走真 IPC（那 S8 落地前根本没法测状态机）。
//   ⇒ 注入之后：单测喂**假数据**、真窗口喂真 Adapter；**页面组件一行都不用改**。
//   ⇒ 这也顺带满足任务书「S8 落地前用注入假数据跑单测」。
import { create } from 'zustand'

import type { AdapterError } from '../adapter/api.ts'
import { buildQuery, deriveBrowseView, NO_FILTERS, NO_FACETS } from '../utils/browse.ts'
import type { BrowseFacets, BrowseFilters, BrowseQuery, BrowseRow, BrowseView, SortDir, SortKey } from '../utils/browse.ts'

export type BrowsePageData = {
  rows: BrowseRow[]
  /** **筛选后**的总数（越界也如实给） */
  total: number
  /**
   * 下拉项：**按整库统计、不受筛选影响**（2026-10-15 Lead 裁定 · SPEC §5.1）。
   * ⚠️ 可选：注入的假数据可以不给 ⇒ 那时页面**不显示**下拉项，而不是拿当前页样本冒充权威值。
   */
  facets?: BrowseFacets
}

/** 取一页数据。真实现是 Adapter 包装的 `items`；单测/注入路径给假实现。 */
export type BrowseFetcher = (q: BrowseQuery) => Promise<
  { ok: true; data: BrowsePageData } | { ok: false; error: AdapterError }
>

export type BrowseState = {
  loading: boolean
  error: AdapterError | null
  rows: BrowseRow[]
  /** 当前筛选后的总数（`items` 返回的 total） */
  total: number
  /** **未筛选**时的库内总数（用来区分「空库」与「筛没了」）；null = 还不知道 */
  libraryTotal: number | null
  /** 下拉项（由 `items` 的 `facets` 给；没给就是空 —— 界面不拿样本推导冒充） */
  facets: BrowseFacets
  filters: BrowseFilters
  sort: SortKey
  direction: SortDir
}

export type BrowseStore = BrowseState & {
  setFilter: (patch: Partial<BrowseFilters>) => void
  resetFilters: () => void
  setSort: (sort: SortKey, direction: SortDir) => void
  /** 取当前筛选/排序下的一页；`fetcher` 由调用点注入（见文件头） */
  load: (fetcher: BrowseFetcher, libId: string, opts?: { offset?: number; limit?: number }) => Promise<void>
  /** 拉一次**不带筛选**的总数（只在进页面时调），用于空态判定 */
  loadLibraryTotal: (fetcher: BrowseFetcher, libId: string) => Promise<void>
  /** 派生：界面该画哪一种状态（空库 / 筛没了 / 出错 / 正常） */
  view: () => BrowseView
  __reset: () => void
}

const initial: BrowseState = {
  loading: false,
  error: null,
  rows: [],
  total: 0,
  libraryTotal: null,
  facets: { ...NO_FACETS },
  filters: { ...NO_FILTERS },
  sort: 'name',
  direction: 'asc',
}

export const useBrowseStore = create<BrowseStore>()((set, get) => ({
  ...initial,

  setFilter: (patch) => {
    // ⚠️ 只改传进来的那几项：漏写一个键就被清空是很容易犯的错（`{...filters, ...patch}` 一次成型）
    set((s) => ({ filters: { ...s.filters, ...patch } }))
  },

  resetFilters: () => set({ filters: { ...NO_FILTERS } }),

  setSort: (sort, direction) => set({ sort, direction }),

  load: async (fetcher, libId, opts) => {
    const s = get()
    if (!libId) { set({ loading: false, error: null, rows: [], total: 0 }); return }
    set({ loading: true, error: null })
    const q = buildQuery({
      libId,
      filters: s.filters,
      sort: s.sort,
      direction: s.direction,
      offset: opts?.offset ?? 0,
      limit: opts?.limit,
    })
    const r = await fetcher(q)
    if (!r.ok) {
      // 文案只用 Adapter 归一后的 userMessage（界面**不许**自造第二份兜底，L6 会抓）
      set({ loading: false, error: r.error, rows: [], total: 0 })
      return
    }
    // facets 是**整库统计**（不受筛选影响）⇒ 后端给了就更新；没给（注入路径）保留原值，
    // 免得翻页时下拉项忽然清空（那会看起来像「库变了」）。
    const next: Partial<BrowseState> = { loading: false, error: null, rows: r.data.rows, total: r.data.total }
    if (r.data.facets) next.facets = r.data.facets
    set(next)
  },

  loadLibraryTotal: async (fetcher, libId) => {
    if (!libId) return
    // 只取 1 行：我们只要 total 与 facets（越界/截断都由主进程如实给，见 SPEC §5.1）。
    // ⚠️ 这一次**不带筛选** ⇒ total 就是「库里有几条」，与 facets 的量纲一致（都是整库口径）。
    const r = await fetcher(buildQuery({ libId, filters: NO_FILTERS, limit: 1 }))
    if (!r.ok) { set({ libraryTotal: null }); return }
    const next: Partial<BrowseState> = { libraryTotal: r.data.total }
    if (r.data.facets) next.facets = r.data.facets
    set(next)
  },

  view: () => {
    const s = get()
    return deriveBrowseView({
      loading: s.loading,
      error: s.error,
      libraryTotal: s.libraryTotal,
      filteredTotal: s.total,
      filters: s.filters,
    })
  },

  __reset: () => set({ ...initial, filters: { ...NO_FILTERS }, facets: { ...NO_FACETS } }),
}))

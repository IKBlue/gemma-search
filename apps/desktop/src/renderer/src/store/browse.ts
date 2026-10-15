// store/browse.ts —— F2「浏览整库」的状态（Operation 层，P4-2）
//
// 分层（AGENTS §2）：本文件**不 import React**、不碰 `window.api` ⇒ 纯逻辑可在 `node:test` 里跑。
// 取数由调用点注入一个 `BrowseFetcher`（页面传 Adapter 包装好的那个）。
//
// ── 为什么取数是**注入**的 ────────────────────────────────────────────────
//   ① 单测能喂假数据（不必起 IPC / Electron）；② 页面组件与「谁去取」解耦。
//   S8 落地后真实现就是 `invoke('items', q)` —— 页面里一行的事（见 BrowsePage 的 fetcher）。
//
// ── 排序/分页为什么只存 `sortKey` 一个字段 ────────────────────────────────
//   S8 的 wire 里方向**编在 sort 字符串里**（`-imageMtime` = 倒序）⇒ 界面只持有一个「档」，
//   方向由 `sortWire()` 一处翻译。存两个字段（key + dir）会多出一份「它俩必须一致」的不变量。
import { create } from 'zustand';

import type { AdapterError } from '../adapter/api.ts';
import { buildQuery, deriveBrowseView, NO_FILTERS, NO_FACETS, SORTS } from '../utils/browse.ts';
import type {
  BrowseFacets,
  BrowseFilters,
  BrowseQuery,
  BrowseRow,
  BrowseView,
} from '../utils/browse.ts';

/** `items` 的返回（S8：rows / total / facets / page） */
export type BrowsePageData = {
  rows: BrowseRow[];
  /** **筛选后**的总数（越界也如实给） */
  total: number;
  /** 下拉项：**按整库统计、不受筛选影响**（SPEC §5.1） */
  facets?: BrowseFacets;
  /** 回显实际生效的分页/排序（界面能如实说「第几页 / 按什么排」） */
  page?: { offset: number; limit: number; sort: string };
};

/** 取一页数据。真实现是 Adapter 包装的 `items`；单测/注入路径给假实现。 */
export type BrowseFetcher = (
  q: BrowseQuery,
) => Promise<{ ok: true; data: BrowsePageData } | { ok: false; error: AdapterError }>;

export type BrowseState = {
  loading: boolean;
  error: AdapterError | null;
  rows: BrowseRow[];
  /** 当前筛选后的总数（`items` 返回的 total） */
  total: number;
  /** **未筛选**时的库内总数（用来区分「空库」与「筛没了」）；null = 还不知道 */
  libraryTotal: number | null;
  /** 下拉项（由 `items` 的 `facets` 给；没给就是空 —— 界面不拿样本推导冒充） */
  facets: BrowseFacets;
  /** 主进程回显的分页/排序（如实显示「已载入 N / 共 M」「按 X 排」） */
  page: { offset: number; limit: number; sort: string } | null;
  filters: BrowseFilters;
  /** 排序档（`utils/browse.ts` 的 SORTS[].key） */
  sortKey: string;
};

export const DEFAULT_SORT: string = SORTS[0].key;

export type BrowseStore = BrowseState & {
  setFilter: (patch: Partial<BrowseFilters>) => void;
  resetFilters: () => void;
  setSortKey: (key: string) => void;
  /** 取当前筛选/排序下的一页；`fetcher` 由调用点注入 */
  load: (
    fetcher: BrowseFetcher,
    libId: string,
    opts?: { offset?: number; limit?: number },
  ) => Promise<void>;
  /** 拉一次**不带筛选**的总数 + facets（只在进页面时调），用于空态判定与下拉项 */
  loadLibraryTotal: (fetcher: BrowseFetcher, libId: string) => Promise<void>;
  /** 派生：界面该画哪一种状态（空库 / 筛没了 / 出错 / 正常） */
  view: () => BrowseView;
  __reset: () => void;
};

const initial: BrowseState = {
  loading: false,
  error: null,
  rows: [],
  total: 0,
  libraryTotal: null,
  facets: { ...NO_FACETS },
  page: null,
  filters: { ...NO_FILTERS },
  sortKey: DEFAULT_SORT,
};

export const useBrowseStore = create<BrowseStore>()((set, get) => ({
  ...initial,

  setFilter: (patch) => {
    // ⚠️ 只改传进来的那几项：漏写一个键就被清空是很容易犯的错（一次成型）
    set((s) => ({ filters: { ...s.filters, ...patch } }));
  },

  resetFilters: () => set({ filters: { ...NO_FILTERS } }),

  setSortKey: (key) => set({ sortKey: key }),

  load: async (fetcher, libId, opts) => {
    const s = get();
    if (!libId) {
      set({ loading: false, error: null, rows: [], total: 0, page: null });
      return;
    }
    set({ loading: true, error: null });
    const q = buildQuery({
      libId,
      filters: s.filters,
      sortKey: s.sortKey,
      offset: opts?.offset ?? 0,
      limit: opts?.limit,
    });
    const r = await fetcher(q);
    if (!r.ok) {
      // 文案只用 Adapter 归一后的 userMessage（界面**不许**自造第二份兜底，L6 会抓）
      set({ loading: false, error: r.error, rows: [], total: 0, page: null });
      return;
    }
    // facets 是**整库统计**（不受筛选影响）⇒ 后端给了就更新；没给（注入路径）保留原值，
    // 免得翻页时下拉项忽然清空（那会看起来像「库变了」）。
    const next: Partial<BrowseState> = {
      loading: false,
      error: null,
      rows: r.data.rows,
      total: r.data.total,
      page: r.data.page ?? null,
    };
    if (r.data.facets) next.facets = r.data.facets;
    set(next);
  },

  loadLibraryTotal: async (fetcher, libId) => {
    if (!libId) return;
    // 只取 1 行：我们只要 total 与 facets（越界/截断都由主进程如实给，SPEC §5.1）。
    // ⚠️ 这一次**不带筛选** ⇒ total 就是「库里有几条」，与 facets 同量纲（都是整库口径）。
    const r = await fetcher(buildQuery({ libId, filters: NO_FILTERS, limit: 1 }));
    if (!r.ok) {
      set({ libraryTotal: null });
      return;
    }
    const next: Partial<BrowseState> = { libraryTotal: r.data.total };
    if (r.data.facets) next.facets = r.data.facets;
    set(next);
  },

  view: () => {
    const s = get();
    return deriveBrowseView({
      loading: s.loading,
      error: s.error,
      libraryTotal: s.libraryTotal,
      filteredTotal: s.total,
      filters: s.filters,
    });
  },

  __reset: () => set({ ...initial, filters: { ...NO_FILTERS }, facets: { ...NO_FACETS } }),
}));

// utils/browse.ts —— F2「浏览整库」的**筛选 / 排序 / 分页 / 空态**判据（Operation 层，纯函数）
//
// ── 行形状与排序**照抄 S8 的实现**（不是我的假设）────────────────────────────
//   `main/items-ipc.ts` 的 `ItemsWireRow` / `SORT_COLUMNS` 是权威：
//     rows[i] = { uid, libId, folder, stem, name, relPath, imageExt, imageSize, imageMtime,
//                 archiveRelPath, archiveExt, archiveSize, archiveMtime, vectorRow }   ← **无绝对路径**
//     sort 白名单只有 8 项：relPath | folder | stem | imageMtime（前缀 `-` = 倒序）
//   ⚠️ 两处与第一版的差异，都是**对齐 S8 实测**：
//     ① 字段名：ext/size/mtime → imageExt/imageSize/imageMtime；「有没有包」不再是一个布尔字段，
//        而是 `archiveRelPath != null`（与库口径一致：缺包 = 少一行）；
//     ② **没有按体积排序**：S8 的 SORT_COLUMNS 里没有 size 列 ⇒ 发 `-imageSize` 会被 BAD_REQUEST 拒。
//        所以界面**不提供**「体积排序」，而不是给一个点了会报错的选项（那是假承诺）。
//        要加体积排序 = 动契约白名单 ⇒ 属 S8 的范围，已报 Lead。
//
// ── 为什么筛选/排序抽成纯函数 ──────────────────────────────────────────────
//   `.tsx` 在 `node:test` 里加载不了 ⇒ 写进组件等于**放弃自动化**（本项目反复栽过）。
//
// ── ⚠️ 依赖注入：真路径 vs 本地路径 ────────────────────────────────────────
//   真数据路径 = 把 `BrowseQuery` 交给主进程（`items`），它按同一语义返回 rows/total/facets；
//   那时 UI **不再**本地重排（否则就是同一份判断的第二处实现，P1）。
//   `applyLocal` / `sortRows` / `matchesFilters` 只服务**测试与注入假数据**这两条路径。
import type { AdapterError } from '../adapter/api.ts';

/** 列表的一行（**与 S8 的 `ItemsWireRow` 逐字对齐**；没有绝对路径） */
export type BrowseRow = {
  uid: string;
  libId: string;
  folder: string;
  stem: string;
  /** 展示名（`display_name`）；缺省时用 stem */
  name?: string;
  relPath: string;
  imageExt: string;
  imageSize: number | null;
  imageMtime: number | null;
  /** 同名压缩包的相对路径；**null = 缺包**（不是空串） */
  archiveRelPath: string | null;
  archiveExt?: string | null;
  archiveSize?: number | null;
  archiveMtime?: number | null;
  vectorRow?: number | null;
};

/** 有没有包：**判据只有这一处**（缺包 = 少一行 ⇒ archiveRelPath == null） */
export function hasArchive(row: BrowseRow): boolean {
  return typeof row.archiveRelPath === 'string' && row.archiveRelPath.length > 0;
}

/** 包体积：**无包 = null**（不是 0）—— 与后端的 NULL 口径一致；界面显示时自己决定怎么表达「无」 */
export function archiveSizeOf(row: BrowseRow): number | null {
  if (!hasArchive(row)) return null;
  return typeof row.archiveSize === 'number' && Number.isFinite(row.archiveSize)
    ? row.archiveSize
    : null;
}

/** 展示名：优先 name，退到 stem，再退到 relPath（兜底顺序只在这里写一次） */
export function rowLabel(row: BrowseRow): string {
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (name) return name;
  const stem = typeof row.stem === 'string' ? row.stem.trim() : '';
  return stem || row.relPath || row.uid;
}

// ---------------------------------------------------------------- 排序（**只保留 S8 支持的三档**）

/** 界面的排序档：`wire` 就是发给主进程的 sort 字符串（'-' 前缀 = 倒序） */
export type SortOption = { key: string; label: string; wire: string };

export const SORTS: readonly SortOption[] = Object.freeze([
  Object.freeze({ key: 'name', label: '名称 A→Z', wire: 'relPath' }),
  // 「大小」= **包**体积（用户直觉里的「这个素材多大」是包）；预览体积是另一档，需要再加。
  Object.freeze({ key: 'size', label: '大小 大→小', wire: '-archiveSize' }),
  Object.freeze({ key: 'mtime', label: '时间 新→旧', wire: '-imageMtime' }),
  Object.freeze({ key: 'folder', label: '分类 Z→A', wire: '-folder' }),
]);

/** 界面档 → wire 串（认不出来就退回默认 relPath，不抛） */
export function sortWire(key: string): string {
  return SORTS.find((s) => s.key === key)?.wire ?? 'relPath';
}

/**
 * 本地排序用的三档（**测试/注入路径**）；与 wire 语义一一对应。
 *
 * ⚠️⚠️ **真数据路径绝不能用它**：NULL 位次由后端的 SQLite 语义决定
 *   （**正序 NULL 最前 · 倒序 NULL 最后**，S8b 已裁决并写进契约）。本地再排一次 = 第二套位次，
 *   正是「后端一套、界面另一套」——所以 store 只是**原样收下**后端给的顺序（B22 钉这一条）。
 */
export type LocalSortKey = 'name' | 'size' | 'mtime';
export type SortDir = 'asc' | 'desc';

/** 一个值是不是**真的有数**（null/undefined/NaN/非数字都算「没有」）
 *  ⚠️ 别写成 `Number.isFinite(Number(x))` —— `Number(null) === 0` 是有限数，
 *    那会把「体积未知」当成 0 排到最前面（本地实测踩到，B3 钉这一条）。 */
function hasNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 排序（纯函数，不改原数组）—— **测试/注入路径**用。
 * · 名称：localeCompare('zh-Hans-CN')；
 * · 体积/时间：**缺失值一律排最后**（不伪装成 0 / 最早），两个方向都一样（缺失比较不参与方向翻转）。
 */
export function sortRows(
  rows: readonly BrowseRow[],
  key: LocalSortKey = 'name',
  dir: SortDir = 'asc',
): BrowseRow[] {
  const out = [...rows];
  const numOf = (r: BrowseRow): number | null => {
    if (key === 'size') return hasNumber(r.imageSize) ? r.imageSize : null;
    return hasNumber(r.imageMtime) ? r.imageMtime : null;
  };
  out.sort((a, b) => {
    if (key === 'name') {
      const r = rowLabel(a).localeCompare(rowLabel(b), 'zh-Hans-CN');
      return dir === 'desc' ? -r : r;
    }
    const an = numOf(a);
    const bn = numOf(b);
    if (an === null && bn === null)
      return String(a.folder ?? '').localeCompare(String(b.folder ?? ''), 'zh-Hans-CN');
    if (an === null) return 1; // 缺失永远最后
    if (bn === null) return -1;
    const r = an - bn;
    return dir === 'desc' ? -r : r;
  });
  return out;
}

// ---------------------------------------------------------------- 筛选

/** 筛选条件（与 `items` 入参**一一对应**；null = 不筛，不是「筛空」） */
export type BrowseFilters = {
  folder: string | null;
  ext: string | null;
  /** null = 全部；true = 只看有包；false = 只看缺包 */
  hasArchive: boolean | null;
};

export const NO_FILTERS: BrowseFilters = Object.freeze({
  folder: null,
  ext: null,
  hasArchive: null,
});

/** 一行是否满足筛选（**判据只有这一份**） */
export function matchesFilters(row: BrowseRow, f: BrowseFilters): boolean {
  if (f.folder && (row.folder ?? '') !== f.folder) return false;
  if (f.ext) {
    const ext = (row.imageExt ?? '').toLowerCase();
    if (ext !== f.ext.toLowerCase()) return false;
  }
  if (typeof f.hasArchive === 'boolean' && hasArchive(row) !== f.hasArchive) return false;
  return true;
}

export type BrowseQuery = {
  libId: string;
  folder?: string;
  ext?: string;
  hasArchive?: boolean;
  /** S8 的 8 项白名单之一（'-' 前缀 = 倒序）；不传 = 主进程默认 relPath */
  sort?: string;
  offset?: number;
  limit?: number;
};

/**
 * 把「界面状态」翻成 `items` 的入参。
 * ⚠️ **不传 undefined 字段**：「不筛」必须以**省略**表达，不能靠空串（空串会被当成真筛选）。
 */
export function buildQuery(input: {
  libId: string;
  filters?: BrowseFilters | null;
  sortKey?: string;
  offset?: number;
  limit?: number;
}): BrowseQuery {
  const f = input.filters ?? NO_FILTERS;
  const q: BrowseQuery = { libId: input.libId };
  if (typeof f.folder === 'string' && f.folder) q.folder = f.folder;
  if (typeof f.ext === 'string' && f.ext) q.ext = f.ext;
  if (typeof f.hasArchive === 'boolean') q.hasArchive = f.hasArchive;
  if (input.sortKey) q.sort = sortWire(input.sortKey);
  if (typeof input.offset === 'number' && input.offset > 0) q.offset = input.offset;
  if (typeof input.limit === 'number' && input.limit > 0) q.limit = input.limit;
  return q;
}

/** **本地**筛选 + 排序（测试 / 注入路径专用）。`total` 是**筛选后**总数 */
export function applyLocal(input: {
  rows: readonly BrowseRow[];
  filters?: BrowseFilters | null;
  sort?: LocalSortKey;
  direction?: SortDir;
  offset?: number;
  limit?: number;
}): { rows: BrowseRow[]; total: number } {
  const f = input.filters ?? NO_FILTERS;
  const all = input.rows.filter((r) => matchesFilters(r, f));
  const sorted = sortRows(all, input.sort ?? 'name', input.direction ?? 'asc');
  const offset = Math.max(0, input.offset ?? 0);
  const limit = input.limit && input.limit > 0 ? input.limit : sorted.length;
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}

// ---------------------------------------------------------------- facets（**整库口径**，后端给）

/** 下拉项的一档（S8 的 `FacetValue`） */
export type FacetEntry = { value: string; count: number };

/**
 * 下拉项：**按整库统计、不受筛选影响**（Lead 2026-10-15 裁定 · SPEC §5.1）。
 * ⚠️ 不能从当前页样本推导 —— 漏值 + 随分页跳动（用户会以为库变了）。
 */
export type BrowseFacets = {
  folders: FacetEntry[];
  exts: FacetEntry[];
  foldersTotal: number;
  extsTotal: number;
};

/** 空 facets（后端还没答 / 注入路径没给时用它，**不要**用样本冒充权威值） */
export const NO_FACETS: BrowseFacets = Object.freeze({
  folders: [],
  exts: [],
  foldersTotal: 0,
  extsTotal: 0,
});

/** 取要显示的项（真数据路径用这个） */
export function facetOptions(
  facets: BrowseFacets | null | undefined,
  key: 'folders' | 'exts',
): FacetEntry[] {
  if (!facets) return [];
  const list = key === 'folders' ? facets.folders : facets.exts;
  return Array.isArray(list) ? list.filter((e) => e && typeof e.value === 'string' && e.value) : [];
}

/** 后端截断了多少项没给（0 = 全给了）—— 界面据此**如实说「还有 N 个」** */
export function facetHidden(
  facets: BrowseFacets | null | undefined,
  key: 'folders' | 'exts',
): number {
  if (!facets) return 0;
  const total = Number(key === 'folders' ? facets.foldersTotal : facets.extsTotal);
  const shown = facetOptions(facets, key).length;
  if (!Number.isFinite(total) || total <= shown) return 0;
  return total - shown;
}

/**
 * 计算**给定这批行**里出现过的分类 / 扩展名。
 * ⚠️ 只在**测试 / 注入数据**路径上用（假数据没有 facets）。真数据路径必须用后端整库统计。
 */
export function facetsOf(rows: readonly BrowseRow[]): { folders: string[]; exts: string[] } {
  const folders = new Set<string>();
  const exts = new Set<string>();
  for (const r of rows) {
    const folder = (r.folder ?? '').trim();
    if (folder) folders.add(folder);
    const ext = (r.imageExt ?? '').trim().toLowerCase();
    if (ext) exts.add(ext);
  }
  return { folders: [...folders].sort(), exts: [...exts].sort() };
}

// ---------------------------------------------------------------- 缩略图与空态

/**
 * 缩略图 URL。**取图路径只有既有 `thumb://` 这一种**（不许自造第二种）。
 * ⚠️ 缺 libId/uid 时模板串会拼出 `thumb://undefined/…` —— 那既注定 400，又让界面上出现
 *    字面量 undefined（`copy.test.mjs` 的 CP-3 会当场抓住）。⇒ 缺参返回 null，调用点显示「无预览」。
 */
export function thumbSrc(
  libId: string | null | undefined,
  uid: string | null | undefined,
  size = 256,
): string | null {
  const lib = typeof libId === 'string' ? libId.trim() : '';
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!lib || !id) return null;
  return `thumb://${encodeURIComponent(lib)}/${id}@${size}`;
}

/** 界面上要画的五种状态之一。**「空库」与「筛没了」是两件事**，不许合并 */
export type BrowseView = 'loading' | 'error' | 'empty' | 'no-match' | 'ready';

export function deriveBrowseView(input: {
  loading: boolean;
  error: AdapterError | null;
  /** **未筛选**时的库内总数（进页面时单独拉一次）；null = 还不知道 */
  libraryTotal: number | null;
  /** 当前筛选后的总数（`items` 返回的 total） */
  filteredTotal: number;
  filters?: BrowseFilters | null;
}): BrowseView {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  const f = input.filters ?? NO_FILTERS;
  const filtered = Boolean(f.folder || f.ext || typeof f.hasArchive === 'boolean');
  if (input.filteredTotal > 0) return 'ready';
  if (!filtered) return 'empty';
  return input.libraryTotal === 0 ? 'empty' : 'no-match';
}

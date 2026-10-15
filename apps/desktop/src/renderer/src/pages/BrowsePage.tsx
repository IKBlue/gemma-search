// BrowsePage —— F2「浏览整库」（P4-2）
//
// ── 这一页要解决什么 ──────────────────────────────────────────────────────
//   检索页回答「我要的那张图在哪」；浏览页回答「我这个库里到底有什么」。
//   3594+ 条不能一次性渲染（几千个 thumb:// 请求 + 几千个 DOM 节点）⇒ 虚拟滚动只画视口内的行。
//
// ── 数据从哪来（⚠️ 当前未接通，见下方 TODO）────────────────────────────────
//   读路径是 `items`（SPEC §5.1 第 21 个方法，只读列表：`{libId, folder?, ext?, hasArchive?, sort?, offset?, limit?}`
//   → `{rows, total}`）。**它的实现是 S8（task-62），当前契约里还没有这个方法** ⇒
//   本页把取数**注入**给 store（`BrowseFetcher`），这样：
//     · 单测用假数据跑（任务书要求）；
//     · S8 落地后**只改下面 `fetcher` 那三行**，页面/网格/store 一行不用动。
//   TODO(S8)：把 `apiInvoke('items', q)` 改成 `invoke<BrowsePageData>('items', q)`（或适配器包装）。
//
// ── 空态为什么分三种（不许把 0 条当「没东西」）────────────────────────────
//   · 库是空的  ⇒ 指引去扫描/入库；
//   · 筛没了    ⇒ 让用户改筛选（**不是**库坏了）；
//   · 读不出来  ⇒ 给诊断/重建入口（索引坏就是这种）。
//   三种混一个「没有内容」会让用户误判 —— 与 T-15b 的「不假装」同一条纪律。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import Chip from '../ui/Chip.tsx';
import Field from '../ui/Field.tsx';
import Toast from '../ui/Toast.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import BrowseGrid from '../search/BrowseGrid.tsx';
import { LABELS, itemPath } from '../router/paths.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';
import { resolveLibrary } from '../utils/library-root.ts';
import useLibraryConfig from '../hooks/useLibraryConfig.ts';
import { useEngine } from '../hooks/useEngine.ts';
import useToast from '../hooks/useToast.ts';
import { useBrowseStore } from '../store/browse.ts';
import type { BrowseFetcher, BrowsePageData } from '../store/browse.ts';
import { SORTS, facetOptions, facetHidden } from '../utils/browse.ts';
import type { BrowseRow } from '../utils/browse.ts';

/** 一次取多少条（S8：limit 默认 100 / **上限 500**；滚动到底再取下一页 = 后续卡片） */
const PAGE_SIZE = 200;

/** 主进程回显的 wire sort 串 → 中文（**认不出来原样显示**，不猜）—— `page.sort` 是权威 */
function sortLabel(wire: string): string {
  return SORTS.find((s) => s.wire === wire)?.label ?? wire;
}

/** 有包/缺包的三个档（null = 不筛） */
const ARCHIVE_CHOICES: ReadonlyArray<{ key: string; label: string; value: boolean | null }> =
  Object.freeze([
    Object.freeze({ key: 'all', label: '全部', value: null }),
    Object.freeze({ key: 'has', label: '有包', value: true }),
    Object.freeze({ key: 'missing', label: '缺包', value: false }),
  ]);

export default function BrowsePage() {
  useDocumentTitle(LABELS.browse);
  const { invoke } = useEngine();
  const { message, tone, show } = useToast();
  const { data: configData, loading: configLoading } = useLibraryConfig();
  const {
    loading,
    error,
    rows,
    total,
    libraryTotal,
    facets,
    page,
    filters,
    sortKey,
    setFilter,
    resetFilters,
    setSortKey,
    load,
    loadLibraryTotal,
    view,
  } = useBrowseStore();

  const lib = resolveLibrary(configData);
  const libId = lib?.libId ?? '';

  /**
   * 取数（F2 的读路径）。
   *
   * ⚠️ **当前是「契约未落地」的显式占位，不是可用的实现**（2026-10-15）：
   *   `items` 已写进 SPEC §5.1，但**实现是 S8（task-62）**，`shared/ipc.ts` 的 `MethodName` 里**还没有**它。
   *   渲染层不许自己加契约方法（边界），而 `invoke` 的 method 参数是**编译期白名单** ⇒ 现在写 `invoke('items',…)`
   *   会 TS2345。**刻意不写 `as MethodName` 之类的断言糊过去** —— 那会把「契约缺口」伪装成「已接通」，
   *   正是本仓库反复禁止的那种绿灯（P8）。
   *   ⇒ 因此这里**如实返回错误**：页面上会显示「列表方法还没接通」，而不是显示一个空的库。
   *     （空列表 = 「库是空的」是个**事实断言**，在方法不存在时断言它就是在说谎。）
   *
   * TODO(S8)：把下面那段换成
   *   const r = await invoke<BrowsePageData>('items', q)
   *   return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
   * 其余（store / 网格 / 空态 / 筛选排序）一行都不用改。
   */
  const fetcher = useMemo<BrowseFetcher>(() => {
    return async (q) => {
      // S8 已落地：`items` 在契约白名单里（`{rows,total,facets,page}`）。
      // Adapter 保证：永不抛、成功给 data、失败给非空 userMessage ⇒ 这里不需要第二套错误处理。
      const r = await invoke<BrowsePageData>('items', q);
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    };
  }, [invoke]);

  // 进页面（或库变了）时：拉一次总数 + 当前页
  const bootRef = useRef('');
  useEffect(() => {
    if (!libId) return;
    if (bootRef.current !== libId) {
      bootRef.current = libId;
      void loadLibraryTotal(fetcher, libId);
    }
    void load(fetcher, libId, { limit: PAGE_SIZE });
  }, [libId, fetcher, load, loadLibraryTotal]);

  // 筛选/排序变了 ⇒ 重新取（真数据路径由主进程筛/排；本地不重排，避免第二份判断）
  const filterKey = JSON.stringify({ filters, sortKey });
  const lastKeyRef = useRef(filterKey);
  useEffect(() => {
    if (!libId) return;
    if (lastKeyRef.current === filterKey && rows.length > 0) return;
    lastKeyRef.current = filterKey;
    void load(fetcher, libId, { limit: PAGE_SIZE });
  }, [filterKey, libId, fetcher, load, rows.length]);

  const open = useCallback(
    (row: BrowseRow) => {
      window.location.hash = '#' + itemPath(row.libId || libId, row.uid);
    },
    [libId],
  );

  const v = view();
  // 下拉项由**后端按整库统计**给（SPEC §5.1 的 facets · Lead 2026-10-15 裁定）。
  // ⚠️ **不再**从当前页样本推导 —— 那会漏值，而且会随分页跳动（用户会以为库变了）。
  const folderOpts = useMemo(() => facetOptions(facets, 'folders'), [facets]);
  const extOpts = useMemo(() => facetOptions(facets, 'exts'), [facets]);
  const folderHidden = useMemo(() => facetHidden(facets, 'folders'), [facets]);
  const extHidden = useMemo(() => facetHidden(facets, 'exts'), [facets]);

  const notImplemented = useCallback((what: string) => show(`「${what}」还没实现`, 'info'), [show]);

  const actions: ReactNode = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={() => void load(fetcher, libId, { limit: PAGE_SIZE })}
        disabled={loading || !libId}
        data-action="browse-refresh"
      >
        {loading ? '读取中…' : '刷新'}
      </Button>
      <Button size="sm" onClick={() => notImplemented('扫描入库（P5）')}>
        扫描入库…
      </Button>
    </div>
  );

  const toolbar: ReactNode = (
    <div className="panel mb-4" data-testid="browse-toolbar">
      <div className="flex flex-wrap items-center gap-2" data-testid="browse-folders">
        <span className="muted small">分类目录</span>
        <Chip active={filters.folder === null} onClick={() => setFilter({ folder: null })}>
          全部
        </Chip>
        {/* 下拉项来自**整库统计**（foldersTotal/folders 都是后端给的）；截断了就如实说「还有 N 个」 */}
        {folderOpts.map((f) => (
          <Chip
            key={f.value}
            active={filters.folder === f.value}
            onClick={() => setFilter({ folder: f.value })}
          >
            {f.value}（{f.count}）
          </Chip>
        ))}
        {folderHidden > 0 ? (
          <span className="muted small" data-testid="facet-folders-hidden">
            还有 {folderHidden} 个分类未列出
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="browse-archive">
        <span className="muted small">有无包</span>
        {ARCHIVE_CHOICES.map((c) => (
          <Chip
            key={c.key}
            active={filters.hasArchive === c.value}
            onClick={() => setFilter({ hasArchive: c.value })}
          >
            {c.label}
          </Chip>
        ))}
        <span className="muted small ml-2">扩展名</span>
        {extHidden > 0 ? (
          <span className="muted small" data-testid="facet-exts-hidden">
            还有 {extHidden} 个
          </span>
        ) : null}
        <Field
          className="auto"
          value={filters.ext ?? ''}
          onChange={(e) => setFilter({ ext: e.target.value ? e.target.value : null })}
          aria-label="扩展名"
        >
          <option value="">全部</option>
          {extOpts.map((x) => (
            <option key={x.value} value={x.value}>
              {x.value}（{x.count}）
            </option>
          ))}
        </Field>
        <span className="muted small ml-2">排序</span>
        {/* ⚠️ 别给 Field 传 `size`：它会被透传给原生 <select>，而 HTML 里 select 的 size 是
            「可见行数」（number），不是尺寸档 —— 传 `size="sm"` 会 TS2322，传数字又会改下拉外观。 */}
        <Field
          className="auto"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          aria-label="排序方式"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Field>
        <Button size="sm" onClick={resetFilters} disabled={loading} data-action="browse-reset">
          重置筛选
        </Button>
      </div>
    </div>
  );

  const empty = (
    <div className="panel empty" data-testid="browse-empty">
      <div className="empty-title">这个库里还没有素材</div>
      <p className="muted small">
        库根里一张预览图都没有 —— 这不是「筛选筛没了」。先扫描入库，或换一个库。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="text-accent" to="/health">
          去诊断页体检这个库
        </Link>
      </div>
    </div>
  );

  const noMatch = (
    <div className="panel empty" data-testid="browse-no-match">
      <div className="empty-title">当前的筛选条件没有匹配</div>
      <p className="muted small">
        库里{libraryTotal === null ? '' : `有 ${libraryTotal} 条素材`}，但没有一条符合现在的筛选。
        {libraryTotal === null ? '' : '（这不是库坏了，改一下筛选即可。）'}
      </p>
      <div className="mt-3">
        <Button size="sm" onClick={resetFilters} data-action="browse-reset-empty">
          重置筛选
        </Button>
      </div>
    </div>
  );

  const errorPanel = (
    <div className="panel" role="alert" data-testid="browse-error">
      <p className="err">{error?.userMessage}</p>
      {error?.code ? <p className="mono muted small">{error.code}</p> : null}
      <p className="muted small mt-2">
        读不到列表 —— 常见原因是索引/元数据损坏（体检会如实报出坏在哪）。这不是「库是空的」。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="text-accent" to="/health">
          打开诊断与重建
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
        <Main>
          <Topbar
            crumb={
              <>
                工作区 <span className="crumb-sep">/</span> <strong>{LABELS.browse}</strong>
              </>
            }
            actions={
              <Button variant="icon" asChild>
                <Link to="/" aria-label="返回搜索" title="返回搜索">
                  ←
                </Link>
              </Button>
            }
          />

          <div className="content">
            <PageHead
              eyebrow="BROWSE"
              title="浏览整库"
              subtitle="按分类、扩展名、有无包筛选；名称/体积/时间排序。缩略图按需生成，全部在本机。"
              actions={actions}
            />

            <div className="panel mb-4" data-testid="browse-library">
              {lib ? (
                <div className="text-caption text-ink">
                  <span className="mono">{lib.libId}</span>
                  <span className="muted"> · </span>
                  <span className="mono break-all">{lib.root || '（库根未知）'}</span>
                </div>
              ) : (
                <p className="muted small">
                  {configLoading
                    ? '正在读取库配置…'
                    : '还没有可浏览的库（先去首启向导添加一个素材库）。'}
                </p>
              )}
            </div>

            {toolbar}

            {/* 如实报「已载入 N / 共 M」与「按什么排」—— 主进程回显的 page 就是这两句的出处。
              不写的话用户会以为屏幕上这些就是全部（而这一版一次只取一页）。 */}
            {v === 'ready' ? (
              <p className="muted small mb-2" data-testid="browse-count">
                已载入 <b>{rows.length}</b> / 共 <b>{total}</b> 条
                {page ? ` · 按 ${sortLabel(page.sort)} 排序` : ''}
              </p>
            ) : null}

            {v === 'loading' && rows.length === 0 ? (
              <div className="panel">
                <p className="muted small">正在读取列表…</p>
              </div>
            ) : null}
            {v === 'error' ? errorPanel : null}
            {v === 'empty' ? empty : null}
            {v === 'no-match' ? noMatch : null}
            {v === 'ready' ? (
              <BrowseGrid libId={libId} rows={rows} total={total} onOpen={open} />
            ) : null}
            {!libId && !configLoading ? (
              <div className="panel" data-testid="browse-no-library">
                <p className="muted small">没有库，浏览页暂时无事可做。</p>
              </div>
            ) : null}
          </div>
        </Main>
      </AppShell>

      <Toast message={message} tone={tone} />
    </>
  );
}

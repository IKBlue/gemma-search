// SearchPage —— 检索页：store（状态）× 组件（渲染）× 令牌（视觉）
//
// 状态自 2026-10-13（T2）起由 **Zustand store** 持有（`store/search.js`），不再挂在组件里：
// 这样「从结果卡进详情页再返回，筛选与结果还在」才有实现基础（P3c 需要）。
// 本页只订阅 + 渲染；协议与编排都在 Operation 层。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import Toast from '../ui/Toast.tsx';
import ConfirmDialog from '../ui/ConfirmDialog.tsx';
import useToast from '../hooks/useToast.ts';
import { useEngine, useEngineEvents, useIndexStatus } from '../hooks/useEngine.ts';
import type { IndexStatusData } from '../hooks/useEngine.ts';
import { useSearchStore, sortResults } from '../store/search.ts';
import Gallery from '../search/Gallery.tsx';
import MetricsRow from '../search/MetricsRow.tsx';
import SearchPanel from '../search/SearchPanel.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import { LABELS } from '../router/paths.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';
import { classifyImageFiles } from '../utils/image-intake.ts';
import { decideShortfall } from '../utils/shortfall.ts';

/** 事件流里本页用到的字段（其余原样忽略；`unknown` 下不许直接取属性） */
type PageEvent = {
  type: string;
  device?: string;
  /** T-17：GPU→CPU 回退的**事实**（有值就说明发生过回退，不是用户自己选的 cpu） */
  deviceFallback?: { from?: string; to?: string; reason?: string } | null;
  /** T-31：**已验证**的执行提供者（拿不到时主进程给 null —— 那就不能按请求值说"在用 GPU"） */
  effectiveProvider?: string | null;
  /** T-31：GPU 可用性探测结果（界面据此说明"凭什么"，而不是复述请求值） */
  gpuProbe?: { available?: boolean | null; detail?: string } | null;
  loadMs?: number;
  message?: string;
  done?: number;
  total?: number;
  needsAttention?: unknown[];
};

/** File 在 Electron 渲染进程里带 path（dev/生产都可能缺；缺了就如实说拿不到） */
function filePath(f: File): string | null {
  const p = (f as File & { path?: unknown }).path;
  return typeof p === 'string' && p ? p : null;
}

export default function SearchPage() {
  useDocumentTitle(LABELS.search);
  const { invoke } = useEngine();
  const { message, tone, show } = useToast();
  const { lib, loading: indexLoading, error: indexError } = useIndexStatus();

  // 检索状态来自 store。整块订阅是刻意的：它是本页的根状态，拆成十几个 selector
  // 只增加噪音，不会减少重渲染（任意一项变了这一页都要重画）。
  const {
    mode,
    query,
    folder,
    sort,
    busy,
    rawResults,
    error,
    setMode,
    setQuery,
    setFolder,
    setSort,
    setQueryImagePath,
    clear,
    run,
    reveal,
    collect,
    // 取件是**破坏性操作**（写文件）⇒ 走「请求 → 确认」两步，状态在 store 里（T4）
    pendingCollect,
    requestCollect,
    cancelCollect,
    confirmCollect,
    // FR-012：最近搜索（主进程在检索成功后写 recent_query；这里只读回来展示/重放）
    recent,
    loadRecent,
    runText,
  } = useSearchStore();

  // FR-012：进页面读一次最近搜索。传 show 是刻意的 —— 除 DB_MISSING（首启正常态）外的读取失败**要出声**。
  useEffect(() => {
    void loadRecent(show);
  }, [loadRecent, show]);

  // 排序是**派生**的（纯函数），不进 store —— 否则 rawResults / sort / results 三者
  // 要手工保持同步，那是典型的「同一份事实两处存」。
  const results = useMemo(() => sortResults(rawResults, sort), [rawResults, sort]);
  // ⚠️ 用**引擎原序**（rawResults）判定弱匹配：用户切了"按文件名"排序后，第一条不再是"最相关"，
  //    但仍然要按相关性判断"库里有没有接近的"。
  const shortfall = useMemo(() => decideShortfall(rawResults), [rawResults]);

  const [device, setDevice] = useState('');
  const [imageName, setImageName] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEngineEvents((evt) => {
    if (!evt || typeof evt !== 'object') return;
    const e = evt as PageEvent;
    if (!e.type) return;
    if (e.type === 'encoder.ready') {
      // T-31：**不再拿 device 当"实际值"**（它只是请求值，两义写法已废）。三种情形分开说：
      //   · 回退过        ⇒ 明说"本机 GPU 不可用，已用 CPU"（契约 §3 不静默）
      //   · 已验证 EP     ⇒ 说"实际 <EP>"
      //   · 没验证出来    ⇒ 如实说"请求 X（实际 EP 未验证）"，**不许**把请求值说成事实
      setDevice(e.effectiveProvider || e.device || '');
      const ms = ((e.loadMs ?? 0) / 1000).toFixed(1);
      const label = e.deviceFallback
        ? `模型就绪 · ${e.device}（本机 GPU 不可用，已用 CPU）· ${ms}s`
        : e.effectiveProvider
          ? `模型就绪 · 实际 ${e.effectiveProvider} · ${ms}s`
          : `模型就绪 · 请求 ${e.device || '—'}（实际 EP 未验证）· ${ms}s`;
      show(label);
    } else if (e.type === 'encoder.failed') {
      setDevice('');
      show(`模型载入失败：${e.message}`, 'err');
    } else if (e.type === 'index.progress') {
      show(`索引中 ${e.done}/${e.total}`);
    } else if (e.type === 'recovery.report') {
      show(`上次操作未收尾：${(e.needsAttention || []).length} 项待处理`, 'err');
    }
  });

  const pickImage = useCallback(() => fileInputRef.current?.click(), []);
  const onFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const f = event.target.files?.[0];
      if (!f) return;
      const p = filePath(f);
      setQueryImagePath(p);
      setImageName(f.name || '');
      show(p ? `已选：${f.name}` : '无法取得真实路径', p ? 'info' : 'err');
    },
    [setQueryImagePath, show],
  );

  /**
   * 拖拽 / 粘贴进来的文件 ⇒ 以图搜（UX-1c）。
   *
   * 判定与拒绝理由都在 Operation 层（`utils/image-intake.ts`，纯函数、可单测）；这里只做三件事：
   * 收下 → 设状态 → **立刻检索**（卡面语义是"拖进来/粘进来就能搜"，不是"拖进来还得再点一下"）。
   * ⚠️ 剪贴板里是**位图**（截图）而不是文件时，`classifyImageFiles` 会如实拒绝并给可行动理由 ——
   *    那种输入需要主进程先把字节落成临时文件，属**新增 IPC（契约变更）**，未获批前不假装支持。
   */
  const intakeFiles = useCallback(
    (files: ArrayLike<{ name?: string; type?: string; path?: string }> | null) => {
      const r = classifyImageFiles(files);
      if (!r.ok) {
        show(r.reason, 'err');
        return;
      }
      setMode('image');
      setQueryImagePath(r.path);
      setImageName(r.name);
      show(`已选：${r.name}`);
      // run() 从 store 的 get() 读状态 ⇒ 上面三次 set 已同步生效，这里拿到的是新值
      void run(show);
    },
    [run, setMode, setQueryImagePath, show],
  );

  // 窗口级监听（只在搜索页挂载期间存在，卸载即摘掉，不影响其它页面）。
  useEffect(() => {
    const hasFiles = (dt: DataTransfer | null | undefined): boolean =>
      Boolean(dt && Array.from(dt.types ?? []).includes('Files'));
    const onDragOver = (e: DragEvent) => {
      // 不 preventDefault 的话，Chromium 会把整个窗口导航去打开那个文件
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      intakeFiles(e.dataTransfer?.files ?? null);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      // 纯文本粘贴（files 为空）照旧交给输入框，不抢事件
      if (!files || files.length === 0) return;
      e.preventDefault();
      intakeFiles(files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [intakeFiles]);

  const refreshStatus = useCallback(async () => {
    const r = await invoke<IndexStatusData>('indexStatus', {});
    const l = r.ok ? (r.data.libs || [])[0] : null;
    show(
      r.ok ? `索引：${l?.encoded ?? 0} / ${l?.indexed ?? 0} 条` : '读取索引状态失败',
      r.ok ? 'info' : 'err',
    );
  }, [invoke, show]);

  const notImplemented = useCallback(
    (label: string) => show(`「${label}」还没实现`, 'info'),
    [show],
  );

  const placeholder = useMemo(
    () =>
      mode === 'text'
        ? '试试：玻璃球多头吊灯 / 中古风木质吸顶灯 / 花卉图案装饰画'
        : imageName
          ? `已选参考图：${imageName}`
          : '点「以图搜图」选一张参考图后搜索',
    [mode, imageName],
  );

  const showHint = results === null && !error && !busy;

  return (
    <>
      <AppShell
        sidebar={
          <SearchSidebar
            lib={lib}
            indexLoading={indexLoading}
            indexError={indexError}
            onNotImplemented={(item) => notImplemented(item.label)}
          />
        }
      >
        <Main>
          <Topbar
            crumb={
              (
                <>
                  工作区 <span className="crumb-sep">/</span> <strong>语义搜索</strong>
                </>
              ) as ReactNode
            }
            actions={
              <>
                <Button
                  variant="icon"
                  aria-label="重新读取索引状态"
                  title="重新读取索引状态"
                  onClick={refreshStatus}
                >
                  ↻
                </Button>
                <Button
                  variant="icon"
                  aria-label="帮助"
                  title="帮助（尚未实现）"
                  onClick={() => show('帮助中心将在正式版本中提供')}
                >
                  ?
                </Button>
              </>
            }
          />

          <div className="content">
            <PageHead
              eyebrow="LOCAL · PRIVATE · SEMANTIC"
              title="找到你想要的那张图。"
              subtitle="用自然语言描述画面，搜索只在本地图库中进行。"
              actions={
                <>
                  <Button onClick={() => notImplemented('添加图库（P5）')}>＋ 添加图库</Button>
                  <Button variant="primary" onClick={() => notImplemented('更新索引（P3d/P4）')}>
                    ↻ 更新索引
                  </Button>
                </>
              }
            />

            <SearchPanel
              inputRef={inputRef}
              query={query}
              onQueryChange={(v) => {
                setQuery(v);
                if (v && mode === 'image') setMode('text');
              }}
              onSubmit={() => run(show)}
              busy={busy}
              placeholder={placeholder}
              folder={folder}
              onFolderChange={setFolder}
              sort={sort}
              onSortChange={(v) => {
                setSort(v);
                if (v === 'recent') show('「最近添加」需要索引提供 mtime，P3b 再补');
              }}
              mode={mode}
              onPickImage={() => {
                setMode('image');
                pickImage();
              }}
              imageName={imageName}
            />

            {/* FR-012：最近搜索。只列**有文本**的历史（以图搜图的行没有可点的文本，硬列出来只会点了没反应）；
                点一下 = 用同一段文本重新检索（`runText` 先写 state 再 run，避免读到旧 query）。 */}
            {recent.length ? (
              <div className="row wrap mt-2" data-testid="recent-queries">
                <span className="muted small">最近搜索</span>
                {recent.map((row) => (
                  <Button
                    key={`${row.at}-${row.q}`}
                    size="sm"
                    data-recent-query={row.q ?? ''}
                    title={row.hits === null ? '重新检索这一条' : `上次命中 ${row.hits} 条`}
                    onClick={() => void runText(row.q ?? '', show)}
                  >
                    {row.q}
                  </Button>
                ))}
              </div>
            ) : null}

            <MetricsRow lib={lib} indexLoading={indexLoading} device={device} />

            {showHint ? (
              <p className="hint">
                <b>输入描述后回车即可检索。</b>
                分数只在本查询方式内有意义；缩略图由本机按需生成，不上传任何数据。
              </p>
            ) : null}

            <Gallery
              results={results}
              error={error}
              loading={busy}
              // NOMATCH-1（U38 口径 A）：弱匹配只做提示 + shortfall，不硬判 no_close_match
              notice={shortfall.note || undefined}
              maxItems={shortfall.show ? shortfall.limit : undefined}
              onLocate={(item) => reveal(item, show)}
              // ⚠️ 不再直接 `collect` —— 取件会**写文件**，先经「请求 → 确认」（T4）
              onCollect={requestCollect}
              onClear={clear}
            />

            <p className="muted small mt-4">
              结果来自本机索引{lib ? `（${lib.libId} · dim ${lib.dim} · seq140）` : ''}；
              分类来自素材库目录，不是内容标签。
            </p>
          </div>

          <input
            ref={fileInputRef}
            className="hidden-file"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.bmp"
            aria-label="选择参考图"
            onChange={onFileChange}
          />
        </Main>
      </AppShell>
      <Toast message={message} tone={tone} />

      {/* 破坏性操作的确认（T4）。`onOpenChange(false)` 覆盖「ESC / 取消钮 / 点外面」三条路径 ——
          AlertDialog 的语义是必须有明确回应，所以点遮罩不会关，但 ESC 会，两者都走这里 ⇒ 一律丢弃请求。 */}
      <ConfirmDialog
        open={Boolean(pendingCollect)}
        onOpenChange={(next) => {
          if (!next) cancelCollect();
        }}
        title="把这套素材取件？"
        description={
          pendingCollect
            ? `会把「${pendingCollect.stem || pendingCollect.uid}」复制到取件目录。素材库本身不会被修改。`
            : ''
        }
        confirmText="取件"
        onConfirm={() => confirmCollect(show)}
      />
    </>
  );
}

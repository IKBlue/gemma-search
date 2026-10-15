// ItemPage —— 流程 2「图片详情」（**P3c**）
//
// ── 规格出处（照它做，别自己发挥）────────────────────────────────────────
//   `docs/design/UI-REVIEW-and-migration.md:234-238`：
//     · 左侧大图（可缩放/适应窗口）
//     · 右侧元数据：ID/分类/库/**两条绝对路径**/尺寸/体积/日期/索引状态/向量行
//     · 动作分区：**取件** / **维护（复用向量）** / **维护（需重编码，须提示）** / **危险区**
//     · 关键：把「是否需要重编码」**直接标在按钮上**（改目录/改ID 不重编码；换图/外部变更 要重编码）
//   `ROADMAP.md:221` 的验收：两条路径与索引状态正确显示；「需重编码」标注正确。
//
// ── 两条路径为什么能拿到 ────────────────────────────────────────────────
//   `item` 只给相对路径（契约 §2.2）；绝对路径来自**新增的只读方法 `itemPaths`**（契约 §2.2a）。
//   之所以不塞进 `item`：所有者 2026-10-13 决定 —— 那会让**每次取元数据都顺带交出库内路径**，
//   而 `itemPaths` 的语义就是「要路径」，暴露面收在明处、可审计。（原来 `absPathFor` 的注释
//   写着「刻意不经 IPC 暴露」，与 P3c 的需求直接冲突，那条注释已同步更正。）
//
// ── 分层 ──────────────────────────────────────────────────────────────
//   本文件是 **UI 层**：只渲染与触发。两个领域判断都抽到了 Operation 层（纯函数，可进 `npm test`）：
//     · `utils/index-state.js`  —— 索引状态四档怎么判
//     · `utils/item-actions.js` —— 动作四分区、要不要重编码、为什么点不动
//   破坏性动作的确认复用 **同一套** store 状态机 + `ui/ConfirmDialog`（不写第二份确认逻辑）。
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ReactNode } from 'react'

import AppShell from '../layout/AppShell.tsx'
import Main from '../layout/Main.tsx'
import PageHead from '../layout/PageHead.tsx'
import Topbar from '../layout/Topbar.tsx'
import Button from '../ui/Button.tsx'
import ConfirmDialog from '../ui/ConfirmDialog.tsx'
import Toast from '../ui/Toast.tsx'
import SearchSidebar from '../search/SearchSidebar.tsx'
import { LABELS } from '../router/paths.ts'
import { useDocumentTitle } from '../utils/useDocumentTitle.ts'
import { useEngine } from '../hooks/useEngine.ts'
import useToast from '../hooks/useToast.ts'
import { useSearchStore } from '../store/search.ts'
import { deriveIndexState, needsScanToDecide } from '../utils/index-state.ts'
import type { ScanDiff } from '../utils/index-state.ts'
import { buildItemActions, groupActions, reencodeBadge } from '../utils/item-actions.ts'
import type { ItemAction } from '../utils/item-actions.ts'
import { humanSize, humanTime } from '../utils/format.ts'
import type { SearchItem, SearchErrorish } from '../search/types.ts'

/** `item` 方法的 data（本页用到的字段；其余原样忽略） */
type ItemData = SearchItem & {
  /** `itemPaths` 的结果与本对象分开存（见下） */
  exists?: { image?: boolean; archive?: boolean } | null
}

/** `itemPaths` 的 data（契约 §2.2a：两条绝对路径） */
type ItemPaths = { imagePath?: string; archivePath?: string }

type PageState = {
  loading: boolean
  item: ItemData | null
  paths: ItemPaths | null
  error: SearchErrorish
}

/** 压缩包（`archive` 是 unknown ⇒ 在这里窄化一次；界面只读 ext/size） */
type Archive = { name?: string; ext?: string; size?: number }

function archiveOf(item: ItemData): Archive | null {
  const a = item.archive
  return a && typeof a === 'object' ? (a as Archive) : null
}

/** 元数据的一行（label + 值）。值一律 `break-all`：路径很长，不能撑破布局 */
function MetaRow({ label, children, mono = false, title }: { label: string; children: ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="flex gap-3 border-b border-line py-2 text-caption last:border-b-0" data-meta={label}>
      <span className="w-20 shrink-0 text-ink-muted">{label}</span>
      <span className={`min-w-0 flex-1 break-all text-ink${mono ? ' mono' : ''}`} title={title}>{children}</span>
    </div>
  )
}

/** 索引状态徽标 —— 文案与语气色都来自 `utils/index-state.js`，不在组件里重写 */
function StateBadge({ state }: { state: { key: string; label: string; tone: string; hint: string } }) {
  return (
    <span className="tag" data-state={state.key} data-tone={state.tone} title={state.hint}>
      {state.label}
    </span>
  )
}

export default function ItemPage() {
  useDocumentTitle(LABELS.item)
  const { libId, uid } = useParams()
  const { invoke } = useEngine()
  const { message, tone, show } = useToast()
  // 破坏性动作的确认流（与搜索结果页共用同一套 store 状态机）
  const { pendingCollect, requestCollect, cancelCollect, confirmCollect } = useSearchStore()

  const [data, setData] = useState<PageState>({ loading: true, item: null, paths: null, error: null })
  const [scanDiff, setScanDiff] = useState<ScanDiff>(null)
  const [scanning, setScanning] = useState(false)
  const [fit, setFit] = useState(true)          // 适应窗口 / 原始大小
  const [imgFailed, setImgFailed] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setData((d) => ({ ...d, loading: true, error: null }))
    // 两个只读调用：元数据（契约 §2.2）与两条绝对路径（§2.2a）。
    // Adapter 永不抛 ⇒ 不需要 try/catch，也就不需要第二套「调用异常」文案。
    const [it, paths] = await Promise.all([
      invoke<ItemData>('item', { libId, uid }),
      invoke<ItemPaths>('itemPaths', { libId, uid }),
    ])
    if (!it.ok) {
      setData({ loading: false, item: null, paths: null, error: it.error })
      return
    }
    setData({ loading: false, item: it.data, paths: paths.ok ? paths.data : null, error: null })
  }, [invoke, libId, uid])

  useEffect(() => { load() }, [load])

  /**
   * 「检查变更」—— 跑一次差分扫描（`scan`，只读）。
   * ⚠️ **刻意不自动跑**：全库 stat 一遍是重活，而用户没要求时不该发生
   *    （`DESIGN-app-details.md:414` 对「变更」的态度就是不自动动它）。
   */
  const checkChanges = useCallback(async (): Promise<void> => {
    setScanning(true)
    const r = await invoke<ScanDiff>('scan', { libId })
    setScanning(false)
    if (!r.ok) { show(r.error.userMessage, 'err'); return }
    setScanDiff(r.data)
    const n = (r.data?.changed || []).length + (r.data?.missing || []).length
    show(n ? `发现 ${n} 处变更（新增 ${(r.data?.added || []).length}）` : '没有发现变更')
  }, [invoke, libId, show])

  /**
   * 动作分发。禁用的一律不进来（`disabled` 时按钮本身就不可点）。
   *
   * ⚠️ 2026-10-15 · S6：原来这里还有一条 `invoke('mutate', …)` 的分支（改名/移动/重配对/移出库）。
   *    mutate 已按绿地契约 §2.2 删除（意图层标注表本轮没建）⇒ 那些动作在 item-actions 里
   *    已经统一成 op:null + 禁用，**到不了这里**；这条死分支随之删掉（留着就是第二份「以为有后端」的代码）。
   */
  const runAction = useCallback(async (action: ItemAction): Promise<void> => {
    if (action.id !== 'collect') return
    const it = data.item
    if (it) requestCollect({ uid: it.uid, libId: it.libId, stem: it.stem, exists: it.exists })
  }, [data.item, requestCollect])

  const item = data.item
  const archive = item ? archiveOf(item) : null
  const indexState = deriveIndexState(item, scanDiff)
  const groups = groupActions(buildItemActions({ item, indexState }))

  // ⚠️ 三个**早返回**：`data.loading` / `data.error` / `item === null` 都与下面分支里逐字相同的 JSX。
  //    为什么必须提前返回（2026-10-14 转 TSX 实测）：`item` 来自 `data.item`，
  //    在 return 里用三元链没法让 TS 把 `item` 收窄成非空 ⇒ 下面每个 `item.x` 都报 TS18047。
  //    收窄要靠**控制流**，不是靠断言 —— 本项目禁用 `any` / `as` 换绿灯。
  const loadingPanel = <div className="panel"><p className="muted small">正在读取…</p></div>
  const errorPanel = data.error ? (
    <div className="panel" role="alert">
      <p className="err" data-testid="item-error">{data.error.userMessage}</p>
      <p className="muted small">
        这条 uid 可能不属于当前库，或索引已重建（<span className="mono">{data.error.code}</span>）。
      </p>
    </div>
  ) : null
  const missingPanel = (
    <div className="panel empty" data-testid="item-missing">
      <div className="empty-title">没有这条素材的元数据</div>
      <div className="muted small">引擎返回里没有 item；重试一次，或从结果卡重新进入。</div>
    </div>
  )

  return (
    <>
      <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={<>工作区 <span className="crumb-sep">/</span> <Link to="/">语义搜索</Link> <span className="crumb-sep">/</span> <strong>图片详情</strong></>}
          actions={<Button variant="icon" asChild><Link to="/" aria-label="返回搜索" title="返回搜索">←</Link></Button>}
        />

        <div className="content">
          <PageHead
            eyebrow="ITEM"
            title={item ? (item.stem || item.relPath) : '图片详情'}
            subtitle={item
              ? `库 ${item.libId} · ${item.folder || '未分类'} · ${item.vectorSource === 'bmp-fallback' ? 'BMP 回退档' : '原生档'}`
              : '读取这条素材的索引元数据与磁盘实况。'}
            actions={
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={checkChanges} disabled={scanning}>
                  {scanning ? '正在扫描…' : '检查变更'}
                </Button>
                <Button size="sm" onClick={load} disabled={data.loading}>重新读取</Button>
              </div>
            }
          />

          {data.loading || data.error || !item ? (
            data.loading ? loadingPanel : data.error ? errorPanel : missingPanel
          ) : (
            <>
              <div className="flex flex-col gap-4 lg:flex-row">
                {/* ── 左：大图（适应窗口 / 原始大小）──────────────────────── */}
                <div className="panel shrink-0 lg:w-1/2">
                  <div className="flex min-h-60 items-center justify-center rounded-card bg-surface">
                    {imgFailed ? (
                      <div className="muted small" data-testid="image-fallback">
                        无预览（缩略图取不到 —— 文件可能已不在盘上）
                      </div>
                    ) : (
                      <img
                        className={fit ? 'max-h-96 w-full object-contain' : 'max-w-none'}
                        alt={`${item.stem || item.relPath} 预览图`}
                        src={`thumb://${encodeURIComponent(item.libId ?? '')}/${item.uid}@512`}
                        onError={() => setImgFailed(true)}
                      />
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => setFit((v) => !v)}>
                      {fit ? '原始大小' : '适应窗口'}
                    </Button>
                    <span className="muted small">
                      {item.exists?.image ? `在盘上 · ${humanSize(item.imageSize)}` : '⚠️ 文件已不在盘上'}
                    </span>
                  </div>
                </div>

                {/* ── 右：元数据 ────────────────────────────────────────── */}
                <div className="panel min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <StateBadge state={indexState} />
                    {needsScanToDecide(item) && !scanDiff ? (
                      <span className="muted small">（是否被外部改过要一次「检查变更」才知道）</span>
                    ) : null}
                  </div>

                  <MetaRow label="ID">{item.stem || '（无）'}</MetaRow>
                  {/* uid 是**稳定身份**（`sha1(lib_id|rel_dir|stem)[:12]`，已冻结）——
                      改名/换目录都不变，报障与脚本都靠它引用一条素材。所以放在明面上。
                      （它同时让「路由参数真的被用上了」可被断言：uid 错一位就会报 UID_NOT_FOUND。） */}
                  <MetaRow label="uid" mono>{item.uid}</MetaRow>
                  <MetaRow label="分类">{item.folder || '未分类'}</MetaRow>
                  <MetaRow label="库">{item.libId}</MetaRow>
                  <MetaRow label="向量档">
                    {item.vectorSource === 'bmp-fallback' ? 'bmp-fallback（BMP 回退解码）' : 'native'}
                  </MetaRow>
                  <MetaRow label="预览图">{humanSize(item.imageSize) || '—'}</MetaRow>
                  <MetaRow label="修改时间">{humanTime(item.imageMtime) || '—'}</MetaRow>
                  <MetaRow label="压缩包">
                    {archive ? `${archive.ext} · ${humanSize(archive.size) || '—'}` : '（无同名压缩包）'}
                  </MetaRow>

                  {/* 两条**绝对路径**（契约 §2.2a）。取不到就如实写，不拼字符串假装有 */}
                  <MetaRow label="图路径" mono title={data.paths?.imagePath || ''}>
                    {data.paths?.imagePath || <span className="muted">（未提供）</span>}
                  </MetaRow>
                  <MetaRow label="包路径" mono title={data.paths?.archivePath || ''}>
                    {data.paths?.archivePath || <span className="muted">（无）</span>}
                  </MetaRow>
                  <MetaRow label="相对路径" mono>{item.relPath}</MetaRow>

                  <div className="mt-3 flex flex-wrap gap-3 text-caption">
                    <span className={item.exists?.image ? 'tone-ok' : 'tone-err'}>
                      预览图{item.exists?.image ? '在盘上' : '已丢失'}
                    </span>
                    {archive ? (
                      <span className={item.exists?.archive ? 'tone-ok' : 'tone-err'}>
                        压缩包{item.exists?.archive ? '在盘上' : '已丢失'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* ── 动作四分区（规格 UI-REVIEW:236）───────────────────────
                  分区**永远四个都在** —— 少一个会让人以为「这个应用没有那类操作」。
                  每个按钮都带「需重编码 / 不重编码」角标（:237 明确要求标在按钮上）。 */}
              <div className="mt-4 grid gap-4 md:grid-cols-2" data-testid="action-groups">
                {groups.map((g) => (
                  <div className="panel" key={g.key} data-group={g.key}>
                    <div className="mb-1 font-semibold text-ink">{g.title}</div>
                    <div className="mb-3 text-caption text-ink-muted">{g.note}</div>
                    <div className="flex flex-wrap gap-2">
                      {g.actions.length === 0 ? (
                        <span className="muted small">（这一类当前没有可用动作）</span>
                      ) : g.actions.map((a) => (
                        <span key={a.id} className="inline-flex flex-col items-start gap-1">
                          <Button
                            size="sm"
                            variant={g.key === 'danger' ? 'outline-accent' : 'default'}
                            disabled={a.disabled}
                            title={a.reason || ''}
                            onClick={() => runAction(a)}
                            data-action={a.id}
                          >
                            {a.label}
                          </Button>
                          <span
                            className="text-caption"
                            data-badge={a.needsReencode ? 'reencode' : 'reuse'}
                            title={a.reason || ''}
                          >
                            <span className={a.needsReencode ? 'tone-warn' : 'tone-ok'}>{reencodeBadge(a)}</span>
                            {a.disabled && a.reason ? <span className="muted"> · {a.reason}</span> : null}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Main>
      </AppShell>

      {/* ⚠️ Toast 与确认弹窗放在 `<AppShell>` **外面** —— 与搜索页保持同一结构
          （`ConfirmDialog` 内部用 Portal，但这层结构一致更省心）。 */}
      <Toast message={message} tone={tone} />

      {/* 破坏性动作的确认（与搜索结果页共用同一套 store 状态机与同一个组件） */}
      <ConfirmDialog
        open={Boolean(pendingCollect)}
        onOpenChange={(next) => { if (!next) cancelCollect() }}
        title="把这套素材取件？"
        description={pendingCollect
          ? `会把「${pendingCollect.stem || pendingCollect.uid}」复制到取件目录。素材库本身不会被修改。`
          : ''}
        confirmText="取件"
        onConfirm={() => confirmCollect(show)}
      />
    </>
  )
}

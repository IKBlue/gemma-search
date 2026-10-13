// SearchPage —— 检索页：store（状态）× 组件（渲染）× 令牌（视觉）
//
// 状态自 2026-10-13（T2）起由 **Zustand store** 持有（`store/search.js`），不再挂在组件里：
// 这样"从结果卡进详情页再返回，筛选与结果还在"才有实现基础（P3c 需要）。
// 本页只订阅 + 渲染；协议与编排都在 Operation 层。
import { useCallback, useMemo, useRef, useState } from 'react'
import AppShell from '../layout/AppShell.jsx'
import Main from '../layout/Main.jsx'
import PageHead from '../layout/PageHead.jsx'
import Topbar from '../layout/Topbar.jsx'
import Button from '../ui/Button.jsx'
import Toast from '../ui/Toast.jsx'
import ConfirmDialog from '../ui/ConfirmDialog.jsx'
import useToast from '../hooks/useToast.js'
import { useEngine, useEngineEvents, useIndexStatus } from '../hooks/useEngine.js'
import { useSearchStore, sortResults } from '../store/search.js'
import Gallery from '../search/Gallery.jsx'
import MetricsRow from '../search/MetricsRow.jsx'
import SearchPanel from '../search/SearchPanel.jsx'
import SearchSidebar from '../search/SearchSidebar.jsx'

export default function SearchPage() {
  const { invoke } = useEngine()
  const { message, tone, show } = useToast()
  const { lib, loading: indexLoading, error: indexError } = useIndexStatus()

  // 检索状态来自 store。整块订阅是刻意的：它是本页的根状态，拆成十几个 selector
  // 只增加噪音，不会减少重渲染（任意一项变了这一页都要重画）。
  const {
    mode, query, folder, sort, busy, rawResults, error,
    setMode, setQuery, setFolder, setSort, setQueryImagePath,
    clear, run, reveal, collect,
    // 取件是**破坏性操作**（写文件）⇒ 走"请求 → 确认"两步，状态在 store 里（T4）
    pendingCollect, requestCollect, cancelCollect, confirmCollect,
  } = useSearchStore()

  // 排序是**派生**的（纯函数），不进 store —— 否则 rawResults / sort / results 三者
  // 要手工保持同步，那是典型的"同一份事实两处存"。
  const results = useMemo(() => sortResults(rawResults, sort), [rawResults, sort])

  const [device, setDevice] = useState('')
  const [imageName, setImageName] = useState('')

  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  useEngineEvents((evt) => {
    if (!evt || !evt.type) return
    if (evt.type === 'encoder.ready') {
      setDevice(evt.device || '')
      show(`模型就绪 · ${evt.device} · ${(evt.loadMs / 1000).toFixed(1)}s`)
    } else if (evt.type === 'encoder.failed') {
      setDevice('')
      show(`模型载入失败：${evt.message}`, 'err')
    } else if (evt.type === 'index.progress') {
      show(`索引中 ${evt.done}/${evt.total}`)
    } else if (evt.type === 'recovery.report') {
      show(`上次操作未收尾：${(evt.needsAttention || []).length} 项待处理`, 'err')
    }
  })

  const pickImage = useCallback(() => fileInputRef.current && fileInputRef.current.click(), [])
  const onFileChange = useCallback((event) => {
    const f = event.target.files && event.target.files[0]
    if (!f) return
    setQueryImagePath(f.path || null)
    setImageName(f.name || '')
    show(f.path ? `已选：${f.name}` : '无法取得真实路径', f.path ? 'info' : 'err')
  }, [setQueryImagePath, show])

  const refreshStatus = useCallback(async () => {
    const r = await invoke('indexStatus', {})
    const l = r.ok ? (r.data.libs || [])[0] : null
    show(r.ok ? `索引：${l ? l.encoded : 0} / ${l ? l.indexed : 0} 条` : '读取索引状态失败', r.ok ? 'info' : 'err')
  }, [invoke, show])

  const notImplemented = useCallback((label) => show(`「${label}」还没实现`, 'info'), [show])

  const placeholder = useMemo(() => (
    mode === 'text'
      ? '试试：玻璃球多头吊灯 / 中古风木质吸顶灯 / 花卉图案装饰画'
      : (imageName ? `已选参考图：${imageName}` : '点「以图搜图」选一张参考图后搜索')
  ), [mode, imageName])

  const showHint = results === null && !error && !busy

  return (
    <>
      <AppShell
        sidebar={(
          <SearchSidebar
            lib={lib}
            indexLoading={indexLoading}
            indexError={indexError}
            onNotImplemented={(item) => notImplemented(item.label)}
          />
        )}
      >
        <Main>
          <Topbar
            crumb={<>工作区 <span className="crumb-sep">/</span> <strong>语义搜索</strong></>}
            actions={(
              <>
                <Button variant="icon" aria-label="重新读取索引状态" title="重新读取索引状态" onClick={refreshStatus}>↻</Button>
                <Button variant="icon" aria-label="帮助" title="帮助（尚未实现）" onClick={() => show('帮助中心将在正式版本中提供')}>?</Button>
              </>
            )}
          />

          <div className="content">
            <PageHead
              eyebrow="LOCAL · PRIVATE · SEMANTIC"
              title="找到你想要的那张图。"
              subtitle="用自然语言描述画面，搜索只在本地图库中进行。"
              actions={(
                <>
                  <Button onClick={() => notImplemented('添加图库（P5）')}>＋ 添加图库</Button>
                  <Button variant="primary" onClick={() => notImplemented('更新索引（P3d/P4）')}>↻ 更新索引</Button>
                </>
              )}
            />

            <SearchPanel
              inputRef={inputRef}
              query={query}
              onQueryChange={(v) => { setQuery(v); if (v && mode === 'image') setMode('text') }}
              onSubmit={() => run(show)}
              busy={busy}
              placeholder={placeholder}
              folder={folder}
              onFolderChange={setFolder}
              sort={sort}
              onSortChange={(v) => { setSort(v); if (v === 'recent') show('「最近添加」需要索引提供 mtime，P3b 再补') }}
              mode={mode}
              onPickImage={() => { setMode('image'); pickImage() }}
              imageName={imageName}
            />

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
              onLocate={(item) => reveal(item, show)}
              // ⚠️ 不再直接 `collect` —— 取件会**写文件**，先经"请求 → 确认"（T4）
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

      {/* 破坏性操作的确认（T4）。`onOpenChange(false)` 覆盖"ESC / 取消钮 / 点外面"三条路径 ——
          AlertDialog 的语义是必须有明确回应，所以点遮罩不会关，但 ESC 会，两者都走这里 ⇒ 一律丢弃请求。 */}
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

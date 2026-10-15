// search/BrowseGrid.tsx —— F2 的虚拟滚动网格（P4-2）
//
// ── 为什么必须虚拟化（SPEC：3594+ 条不虚拟化会卡死）──────────────────────────
//   每一格都要挂 <img>（走 thumb://），全量渲染 = 几千个请求 + 几千个 DOM 节点。
//   所以只渲染**视口内的那几行**，其余用两个撑高的占位块顶着（`useVirtualizer` 的标准做法）。
//   ⚠️ 用 `@tanstack/react-virtual`（AGENTS §1 选定的轮子），**不自己写滚动数学**。
//
// ── 布局取整为什么这么写 ──────────────────────────────────────────────────
//   卡片最小宽度 / 间距都从**令牌**读（`--layout-browse-cell` / `--space-3`），不写像素；
//   列数由「容器宽 ÷ 卡片最小宽」取整得出。写死 4 列会在窄窗口下挤成一条缝。
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { humanSize } from '../utils/format.ts'
import { thumbSrc } from '../utils/browse.ts'
import type { BrowseRow } from '../utils/browse.ts'

const FALLBACK_CELL = 148      // 令牌读不到时的兜底宽度（正常路径永远走 var(--layout-browse-cell)）
const FALLBACK_GAP = 12
const ROW_H = 196              // 单行高度（缩略图 + 两行文字）；固定值才能让虚拟滚动精确

function readToken(name: string, fallback: number): number {
  // ⚠️ 这里的 `typeof document === 'undefined'` 是**刻意的**，不是疏忽：
  //    `document` 在 DOM lib 里是非可选全局，但 node:test / SSR 下它可能真的不存在 ——
  //    `typeof x === 'undefined'` 是唯一**不会抛 ReferenceError** 的探测写法。
  //    ⚠️ 它同时是 `copy.test.mjs` 的 **CP-3**（界面字符串里不许出现字面量 undefined）命中的地方，
  //       所以本文件在 CP-3 的 EXEMPT_FILES 里有**逐条豁免**（见那里的理由）—— 别把它当成漏网。
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const n = Number.parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export type BrowseGridProps = {
  libId: string
  rows: BrowseRow[]
  /** 行总数（= 主进程给的 `total`，**可能大于已拉到的行数**）——只用于滚动高度的诚实呈现 */
  total: number
  onOpen: (row: BrowseRow) => void
}

/** 一格：缩略图 + 名称 + 体积/包角标。整格可点（不是链接套按钮 —— 见 dom-validity V1/V2） */
function Cell({ row, libId, onOpen }: { row: BrowseRow; libId: string; onOpen: (row: BrowseRow) => void }) {
  const [failed, setFailed] = useState(false)
  const label = row.stem || row.relPath || row.uid
  // 库里一份素材的 libId 与页面当前库一致；行里没带就用页面的（缺任何一个都不拼 URL）
  const src = thumbSrc(row.libId || libId, row.uid)
  const noPreview = failed || src === null
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      data-browse-cell={row.uid}
      data-hasarchive={row.hasArchive ? 'yes' : 'no'}
      className="flex flex-col items-stretch gap-1 border border-line rounded-card bg-surface-raised p-2 text-left hover:border-accent"
      title={row.relPath || label}
    >
      <span className="relative block w-full rounded-xs bg-surface-2 overflow-hidden">
        {noPreview ? (
          <span className="flex h-full items-center justify-center muted small">无预览</span>
        ) : (
          <img
            className="block h-full w-full object-cover"
            loading="lazy"
            alt=""
            src={src}
            onError={() => setFailed(true)}
          />
        )}
      </span>
      <span className="truncate text-caption text-ink">{label}</span>
      <span className="flex items-center gap-1 text-micro muted">
        <span>{humanSize(row.size) || '—'}</span>
        <span aria-hidden="true">·</span>
        <span>{row.hasArchive ? '有包' : '缺包'}</span>
        {row.folder ? <span className="truncate">· {row.folder}</span> : null}
      </span>
    </button>
  )
}

export default function BrowseGrid({ libId, rows, total, onOpen }: BrowseGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState(4)
  const [cellW, setCellW] = useState(FALLBACK_CELL)
  const [gap, setGap] = useState(FALLBACK_GAP)

  // 容器宽变了就重算列数（窗口缩放 / 侧栏收起都会触发）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const min = readToken('--layout-browse-cell', FALLBACK_CELL)
    const g = readToken('--space-3', FALLBACK_GAP)
    const measure = (): void => {
      const width = el.clientWidth - 2 * g
      const n = Math.max(1, Math.floor(width / (min + g)))
      setCols(n)
      setGap(g)
      setCellW(min)
    }
    measure()
    // 同上：`typeof X === 'undefined'` 是不抛错的探测写法（ResizeObserver 在旧环境可能没有）
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rowCount = Math.max(0, Math.ceil(rows.length / cols))
  const rowStride = ROW_H + gap
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowStride,
    overscan: 3,
  })

  const items = virtualizer.getVirtualItems()
  const loadedRows = rows.length
  // ⚠️ 稀疏提示：`total > 已拉到` 时必须**如实说**，否则用户以为「就这么多」
  const partial = total > loadedRows

  return (
    <div className="panel" data-testid="browse-grid" data-total={String(total)} data-loaded={String(loadedRows)}>
      {partial ? (
        <p className="muted small mb-2" data-testid="browse-partial">
          当前已载入 {loadedRows} 条，库内匹配 {total} 条（这一版一次只取一页；滚动加载在后续卡片）
        </p>
      ) : null}
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: 'calc(var(--space-8) * 12)' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((v) => {
            const start = v.index * cols
            const slice = rows.slice(start, start + cols)
            return (
              <div
                key={v.key}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${v.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: `${gap}px`,
                  height: `${ROW_H}px`,
                }}
              >
                {slice.map((row) => <Cell key={row.uid} row={row} libId={libId} onOpen={onOpen} />)}
              </div>
            )
          })}
        </div>
      </div>
      <p className="muted small mt-2">
        每格最小宽 {cellW}px · 列数 {cols}（都来自令牌；缩略图走既有 thumb://，没有第二种取图路径）
      </p>
    </div>
  )
}

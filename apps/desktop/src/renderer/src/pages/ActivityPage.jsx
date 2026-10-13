// ActivityPage —— 「操作记录」（**P3d 的第二半**）
//
// ── 规格出处 ──────────────────────────────────────────────────────────
//   `docs/design/UI-REVIEW-and-migration.md:76`（§2.4 操作记录）：
//     「缺少**撤销状态**，这是本应用的安全底线」
//   `:250`（流程 4 失败/中断）：
//     「进入「操作记录」的**待处理**，并给"**重试 / 回退 / 保持现状**"」
//   `docs/spec/SPEC-transactions.md:229`：
//     「`mutate()` 返回事务 id；界面据 id 查询状态、显示进度、提供撤销入口」
//   `:141`：staging 丢失而源已不在 ⇒ `RECOVERY_NEEDED`，**界面弹「待处理操作」**
//
// ── 数据源 ────────────────────────────────────────────────────────────
//   `transactions`（契约 §2.11，2026-10-13 新增的**只读**方法）—— 契约里此前没有任何
//   列/查事务的方法，而规格要求"界面据 id 查询状态"，所以补了这一个（与 `itemPaths` 同口径：
//   要什么就给一个语义明确的只读方法，不把东西塞进别的方法的返回里）。
//
// ── ⚠️ 三条路必须**真的能走**，不能只画三个按钮 ────────────────────────────
//   · **重试** ⇒ 重新提交原操作（`mutate` 用原 op）
//   · **回退** ⇒ `mutate { op:'undo', params:{ txId } }`，由 `canUndo`/`canRollback` 决定可否点
//   · **保持现状** ⇒ **纯本地**（关掉提示，不动磁盘）—— 所以界面上要写明"不会改动任何文件"，
//     否则用户会以为点了就等于处理好了（那是谎报）
//   契约 §5 还规定：**不可回退**时要提示"需要手动处理"，而不是给一个点了没用的按钮。
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import AppShell from '../layout/AppShell.jsx'
import Main from '../layout/Main.jsx'
import PageHead from '../layout/PageHead.jsx'
import Topbar from '../layout/Topbar.jsx'
import Button from '../ui/Button.jsx'
import Toast from '../ui/Toast.jsx'
import SearchSidebar from '../search/SearchSidebar.jsx'
import { LABELS } from '../router/paths.js'
import { useDocumentTitle } from '../utils/useDocumentTitle.js'
import { useEngine, useIndexStatus } from '../hooks/useEngine.js'
import useToast from '../hooks/useToast.js'
import { humanTime } from '../utils/format.js'

/** 事务状态 → 文案与语气。集中一处，别散到组件里 */
const STATE_TEXT = {
  committed: { label: '已完成', tone: 'ok' },
  undone: { label: '已撤销', tone: 'muted' },
  aborted: { label: '已中止', tone: 'muted' },
  recovery_needed: { label: '待处理', tone: 'err' },
  staged: { label: '进行中', tone: 'warn' },
  committing: { label: '提交中', tone: 'warn' },
  'rolling-back': { label: '回退中', tone: 'warn' },
}

/** 操作名 → 中文（契约 §2.7 的 op 白名单 + ingest/undo） */
const OP_TEXT = {
  rename: '改 ID',
  moveFolder: '改分类',
  reattachArchive: '重新配对压缩包',
  moveOutOfLibrary: '移出素材库',
  undo: '撤销',
  ingest: '入库',
}

const stateOf = (t) => STATE_TEXT[t.state] || { label: t.state || '未知状态', tone: 'muted' }

export default function ActivityPage() {
  useDocumentTitle(LABELS.activity)
  const { invoke } = useEngine()
  const { message, tone, show } = useToast()
  const { lib, loading: idxLoading } = useIndexStatus()

  const [data, setData] = useState({ loading: true, list: [], blocked: false, error: null })
  const [busy, setBusy] = useState(null)
  /** 「保持现状」是**本地**决定：把这条从待处理列表里隐去，但**不动磁盘** */
  const [dismissed, setDismissed] = useState(() => new Set())

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true }))
    const r = await invoke('transactions', { limit: 50 })
    if (!r.ok) {
      setData({ loading: false, list: [], blocked: false, error: r.error })
      return
    }
    setData({ loading: false, list: r.data.transactions || [], blocked: Boolean(r.data.blocked), error: null })
  }, [invoke])

  useEffect(() => { load() }, [load])

  const pending = data.list.filter((t) => t.state === 'recovery_needed' && !dismissed.has(t.txId))

  /** 回退（撤销）：走契约 §5 的 `mutate { op:'undo' }` */
  const rollback = useCallback(async (tx) => {
    setBusy(`${tx.txId}:rollback`)
    const r = await invoke('mutate', { libId: tx.libId, op: 'undo', params: { txId: tx.txId } })
    setBusy(null)
    show(r.ok ? `已回退 ${tx.txId}` : r.error.userMessage, r.ok ? 'info' : 'err')
    if (r.ok) load()
  }, [invoke, show, load])

  /** 重试：重新提交原操作（`undo` 类型的记录没有可重试的原操作） */
  const retry = useCallback(async (tx) => {
    if (!tx.op || tx.op === 'undo') { show('这条没有可重试的原操作', 'err'); return }
    setBusy(`${tx.txId}:retry`)
    const r = await invoke('mutate', { libId: tx.libId, op: tx.op, params: {} })
    setBusy(null)
    show(r.ok ? `已重试 ${OP_TEXT[tx.op] || tx.op}` : r.error.userMessage, r.ok ? 'info' : 'err')
    if (r.ok) load()
  }, [invoke, show, load])

  return (
    <>
      <AppShell sidebar={<SearchSidebar lib={lib} indexLoading={idxLoading} indexError={null} />}>
        <Main>
          <Topbar
            crumb={<>工作区 <span className="crumb-sep">/</span> <strong>操作记录</strong></>}
            actions={<Button variant="icon" asChild><Link to="/" aria-label="返回搜索" title="返回搜索">←</Link></Button>}
          />

          <div className="content">
            <PageHead
              eyebrow="ACTIVITY"
              title="操作记录"
              subtitle="写操作都会留下事务记录。撤销状态是本应用的安全底线 —— 没记录下来的改动不该发生。"
              actions={<Button size="sm" onClick={load} disabled={data.loading}>重新读取</Button>}
            />

            {data.loading ? (
              <div className="panel"><p className="muted small">正在读取…</p></div>
            ) : data.error ? (
              <div className="panel" role="alert">
                <p className="err" data-testid="activity-error">{data.error.userMessage}</p>
                <p className="muted small">
                  真实模式下事务日志**还没实现**（<span className="mono">{data.error.code}</span>）——
                  `TODO.md` B-2-3 记着这件事。用 <span className="mono">GEMMA_FAKE=1 npm run dev</span> 可以看完整流程。
                </p>
              </div>
            ) : (
              <>
                {/* ── 待处理（RECOVERY_NEEDED 三条路，SPEC-transactions §4 / UI-REVIEW:250）── */}
                {data.blocked ? (
                  <p className="err mb-3" role="alert" data-testid="blocked-note">
                    ⚠️ 有未收尾的事务 —— 在此之前，**所有写操作都会被拒绝**（`RECOVERY_NEEDED`）。
                  </p>
                ) : null}

                {pending.length > 0 ? (
                  <div className="panel mb-4" data-testid="pending-panel">
                    <div className="mb-2 font-semibold text-err">待处理操作 {pending.length} 项</div>
                    {pending.map((tx) => (
                      <div className="border-t border-line py-3 first:border-t-0" key={tx.txId} data-pending={tx.txId}>
                        <div className="text-caption text-ink">
                          <span className="mono">{tx.txId}</span>
                          <span className="muted"> · {OP_TEXT[tx.op] || tx.op} · </span>
                          {tx.summary || '（无说明）'}
                        </div>
                        <p className="muted small mt-1">
                          契约 §5：**不可回退**的操作只能手动处理 —— 这里据 <span className="mono">canUndo</span>/<span className="mono">canRollback</span>
                          决定按钮是否可点，不给你一个点了没用的按钮。
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button size="sm" data-action={`retry:${tx.txId}`}
                                  disabled={busy === `${tx.txId}:retry` || !tx.op || tx.op === 'undo'}
                                  title={!tx.op || tx.op === 'undo' ? '这条没有可重试的原操作' : '重新提交原操作'}
                                  onClick={() => retry(tx)}>
                            {busy === `${tx.txId}:retry` ? '处理中…' : '重试'}
                          </Button>
                          <Button size="sm" data-action={`rollback:${tx.txId}`}
                                  disabled={busy === `${tx.txId}:rollback` || !(tx.canUndo || tx.canRollback)}
                                  title={tx.canUndo || tx.canRollback ? '按事务日志回退这次改动' : '这条已过撤销期，需要手动处理'}
                                  onClick={() => rollback(tx)}>
                            {busy === `${tx.txId}:rollback` ? '处理中…' : '回退'}
                          </Button>
                          <Button size="sm" data-action={`leave:${tx.txId}`}
                                  title="只把这条从待处理里隐去，**不会改动任何文件**"
                                  onClick={() => setDismissed((s) => new Set(s).add(tx.txId))}>
                            保持现状
                          </Button>
                          <span className="muted small">
                            「保持现状」只关闭提示，**不动磁盘** —— 文件仍是现在的样子
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* ── 事务表 ─────────────────────────────────────────────── */}
                <div className="panel">
                  <div className="mb-2 font-semibold text-ink">事务表（最近 {data.list.length} 条）</div>
                  {data.list.length === 0 ? (
                    <p className="muted small" data-testid="activity-empty">还没有任何写操作记录。</p>
                  ) : (
                    <table className="w-full text-left text-caption" data-testid="tx-table">
                      <thead>
                        <tr className="border-b border-line text-ink-muted">
                          <th className="py-2 pr-3 font-normal">事务</th>
                          <th className="py-2 pr-3 font-normal">操作</th>
                          <th className="py-2 pr-3 font-normal">状态</th>
                          <th className="py-2 pr-3 font-normal">开始</th>
                          <th className="py-2 pr-3 font-normal">可撤销</th>
                          <th className="py-2 font-normal">说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.list.map((tx) => {
                          const st = stateOf(tx)
                          return (
                            <tr className="border-b border-line last:border-b-0" key={tx.txId} data-tx={tx.txId}>
                              <td className="py-2 pr-3 mono">{tx.txId}</td>
                              <td className="py-2 pr-3">{OP_TEXT[tx.op] || tx.op}</td>
                              <td className="py-2 pr-3" data-tx-state={tx.state}>
                                <span className={st.tone === 'err' ? 'dot-err' : st.tone === 'ok' ? 'dot-ok' : st.tone === 'warn' ? 'dot-warn' : 'muted'}>
                                  {st.label}
                                </span>
                              </td>
                              <td className="py-2 pr-3 muted">{humanTime(tx.startedAt) || '—'}</td>
                              <td className="py-2 pr-3" data-tx-undo={tx.canUndo ? 'yes' : 'no'}>
                                {tx.canUndo || tx.canRollback
                                  ? <span className="dot-ok">可以</span>
                                  : <span className="muted">不可以</span>}
                              </td>
                              <td className="py-2 break-all">{tx.summary || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </Main>
      </AppShell>
      <Toast message={message} tone={tone} />
    </>
  )
}

// TasksPage —— 流程 3「索引任务」（**P3d**）
//
// ── 规格出处 ──────────────────────────────────────────────────────────
//   `docs/design/UI-REVIEW-and-migration.md:240-244`：
//     · 阶段条（扫描 → 配对 → 编码 → 校验 → 落盘）+ `已处理/总数` + `条/秒` + `ETA`
//     · 头部显示本次的 **model_revision / 权重精度 / 预处理版本 / seq**
//     · 失败项**可展开**（哪条、为什么、能否跳过）
//     · **取消**按钮标注"将在当前批次结束后停止"
//     · 完成后显示 **`复用 N · 新编码 M · 失败 K`** 与"数据正确性三项验收"的结果
//
// ── 状态放哪儿 ────────────────────────────────────────────────────────
//   进度是**主进程推来的事件流**（`window.api.onEvent` → `useEngineEvents`）。
//   归约逻辑在 `store/tasks.js`（纯函数 `reduceEvent`，已被 `task-store.test.mjs` 13 条钉住）。
//   本文件是 UI 层：只订阅、只渲染、只触发。
//
// ── ⚠️ 真话优先 ───────────────────────────────────────────────────────
//   真实模式下 `indexStart` 会返回 `INTERNAL「这个功能还没做好。」`（主进程显式拒绝那 4 个方法）。
//   本页**不**提前用"功能没做"把按钮禁用掉 —— 那等于在界面里再写一份"什么实现了"的清单（P1）。
//   按钮照给，引擎如实回答，`userMessage` 直接显示给用户。想在本地看完整流程就开模拟模式：
//   `GEMMA_FAKE=1 npm run dev`（契约 §8）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import AppShell from '../layout/AppShell.jsx'
import Main from '../layout/Main.jsx'
import PageHead from '../layout/PageHead.jsx'
import Topbar from '../layout/Topbar.jsx'
import Button from '../ui/Button.jsx'
import Field from '../ui/Field.jsx'
import Toast from '../ui/Toast.jsx'
import SearchSidebar from '../search/SearchSidebar.jsx'
import { LABELS } from '../router/paths.js'
import { useDocumentTitle } from '../utils/useDocumentTitle.js'
import { useEngine, useEngineEvents, useIndexStatus } from '../hooks/useEngine.js'
import useToast from '../hooks/useToast.js'
import { useTaskStore, PHASES, phaseLabel, progressPercent, etaText, outcomeSummary } from '../store/tasks.js'

/** 可选的 seq 档（`CONTRACT-engine-v1.md` §2.10：70/140/280 —— 唯一的提速杠杆） */
const SEQ_OPTIONS = [70, 140, 280]
const DEVICE_OPTIONS = [
  { value: 'webgpu', label: 'WebGPU（默认，快）' },
  { value: 'cpu', label: 'CPU（慢，但一定能跑）' },
]

/** 阶段条：走过的打勾、当前的高亮、后面的灰着 */
function PhaseBar({ current }) {
  const idx = PHASES.findIndex((p) => p.key === current)
  return (
    <ol className="flex flex-wrap items-center gap-2 text-caption" data-testid="phase-bar">
      {PHASES.map((p, i) => {
        const state = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'now' : 'todo'
        return (
          <li key={p.key} className="flex items-center gap-2" data-phase={p.key} data-phase-state={state}>
            <span className={state === 'done' ? 'tone-ok' : state === 'now' ? 'tone-warn' : 'muted'}>
              {state === 'done' ? '✓ ' : state === 'now' ? '● ' : '○ '}{p.label}
            </span>
            {i < PHASES.length - 1 ? <span className="muted">→</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/** 失败项：可展开（`<details>` 原生可键盘操作，不需要自己写 aria） */
function FailedList({ failed }) {
  if (!failed || failed.length === 0) return null
  return (
    <details className="panel mt-4" open data-testid="failed-list">
      <summary className="cursor-pointer font-semibold text-ink">
        失败 {failed.length} 条（点开看每一条为什么）
      </summary>
      <ul className="mt-2 space-y-1 text-caption">
        {failed.map((f, i) => (
          <li key={`${f.relPath}-${i}`} className="border-b border-line py-1 last:border-b-0" data-failed={f.relPath}>
            <span className="mono break-all text-ink">{f.relPath}</span>
            <span className="muted"> · 阶段 {phaseLabel(f.stage)} · </span>
            <span className="err">{f.error?.message || '未说明原因'}</span>
            <span className="muted">（{f.error?.code || '—'}）</span>
          </li>
        ))}
      </ul>
      <p className="muted small mt-2">
        「能否跳过」由引擎决定：这些条目不影响其余条目编码，但本次任务的 `ok` 会是 `false`。
      </p>
    </details>
  )
}

export default function TasksPage() {
  useDocumentTitle(LABELS.tasks)
  const { invoke } = useEngine()
  const { message, tone, show } = useToast()
  const { lib, loading: idxLoading } = useIndexStatus()
  const job = useTaskStore()

  const [seq, setSeq] = useState(140)
  const [device, setDevice] = useState('webgpu')
  const [busy, setBusy] = useState(null)
  /** 上一次跑完的 jobId —— 续跑要用它（契约 §2.10 `indexResume { jobId }`） */
  const [lastJobId, setLastJobId] = useState(null)

  // 事件流 → store。归约是纯函数（`store/tasks.js`），这里只做订阅。
  useEngineEvents(useCallback((evt) => { job.applyEvent(evt) }, [job]))

  useEffect(() => () => { /* 卸载不 reset：切走再回来还看得见上一次的结果 */ }, [])

  const pct = progressPercent(job)
  const summary = outcomeSummary(job)

  const start = useCallback(async () => {
    setBusy('start')
    const r = await invoke('indexStart', { libId: lib?.libId || 'L1', device, seq })
    setBusy(null)
    if (!r.ok) { show(r.error.userMessage, 'err'); return }
    setLastJobId(r.data.jobId)
    job.begin({ libId: lib?.libId || 'L1', jobId: r.data.jobId })
    show('已开始索引')
  }, [invoke, lib, device, seq, show, job])

  const cancel = useCallback(async () => {
    const jobId = job.jobId || lastJobId
    if (!jobId) { show('没有正在跑的任务', 'err'); return }
    setBusy('cancel')
    const r = await invoke('indexCancel', { jobId })
    setBusy(null)
    show(r.ok ? '已请求取消（会在当前批次结束后停止）' : r.error.userMessage, r.ok ? 'info' : 'err')
  }, [invoke, job, lastJobId, show])

  const resume = useCallback(async () => {
    const jobId = job.jobId || lastJobId
    if (!jobId) { show('没有可续跑的任务', 'err'); return }
    setBusy('resume')
    const r = await invoke('indexResume', { jobId })
    setBusy(null)
    if (!r.ok) { show(r.error.userMessage, 'err'); return }
    setLastJobId(r.data.jobId)
    job.begin({ libId: job.libId || lib?.libId || 'L1', jobId: r.data.jobId })
    show('已续跑')
  }, [invoke, job, lastJobId, lib, show])

  /** 本次索引口径：compat 是引擎给的 8 段串（`COMPAT_FIELDS`）。
   *  ⚠️ **不在这里解析它** —— 字段顺序是引擎的定义（`packages/engine/src/compat.mjs`），
   *  在渲染层再抄一份就是第二个事实来源（P1）。原样显示，加 title 便于复制。 */
  const compat = useMemo(() => lib?.compat || null, [lib])

  return (
    <>
      <AppShell sidebar={<SearchSidebar lib={lib} indexLoading={idxLoading} indexError={null} />}>
        <Main>
          <Topbar
            crumb={<>工作区 <span className="crumb-sep">/</span> <strong>索引任务</strong></>}
            actions={<Button variant="icon" asChild><Link to="/" aria-label="返回搜索" title="返回搜索">←</Link></Button>}
          />

          <div className="content">
            <PageHead
              eyebrow="TASKS"
              title="索引任务"
              subtitle="建索引会与检索争 GPU（实测速率减半）—— 跑的时候别同时搜。"
            />

            {/* ── 本次索引口径（UI-REVIEW:242）────────────────────────── */}
            <div className="panel">
              <div className="mb-2 font-semibold text-ink">本次索引口径</div>
              <div className="grid gap-3 text-caption md:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">库</span>
                  <span className="mono text-ink" data-testid="job-lib">{lib?.libId || '（未配置）'}</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">seq（唯一的提速杠杆）</span>
                  <Field value={seq} onChange={(e) => setSeq(Number(e.target.value))} aria-label="seq 档">
                    {SEQ_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Field>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-muted">设备</span>
                  <Field value={device} onChange={(e) => setDevice(e.target.value)} aria-label="设备">
                    {DEVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Field>
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-ink-muted">当前索引的 compat</span>
                  <span className="mono break-all text-ink" title={compat || ''} data-testid="job-compat">
                    {compat || '—'}
                  </span>
                  <span className="muted">（model_repo|revision|dtype|preproc|seq|dim|norm|pooling）</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={start} disabled={busy === 'start' || job.running} data-action="start">
                  {busy === 'start' ? '正在启动…' : '开始索引'}
                </Button>
                <Button onClick={cancel} disabled={busy === 'cancel' || !job.running} data-action="cancel">
                  取消
                </Button>
                <Button onClick={resume} disabled={busy === 'resume' || job.running || !lastJobId} data-action="resume">
                  续跑
                </Button>
                {/* 规格明确要求把这个承诺写在按钮旁边 */}
                <span className="muted small" data-testid="cancel-note">
                  取消：将在当前批次结束后停止（最多 2 秒内收尾，已编码的行保留，可续跑）
                </span>
              </div>
            </div>

            {/* ── 进度 ───────────────────────────────────────────────── */}
            <div className="panel mt-4" data-testid="job-progress">
              <PhaseBar current={job.phase} />

              <div className="mt-3 flex flex-wrap items-baseline gap-3 text-caption">
                <span className="text-ink" data-testid="job-counts">
                  已处理 <b>{job.done}</b> / {job.total || '—'}
                </span>
                <span className="muted" data-testid="job-rate">{job.ratePerSec || 0} 条/秒</span>
                <span className="muted" data-testid="job-eta">ETA {etaText(job)}</span>
                {job.skipped ? <span className="muted">跳过 {job.skipped}</span> : null}
                {job.failedCount ? <span className="err">失败 {job.failedCount}</span> : null}
              </div>

              {/* 进度条：`total` 未知时**不编百分比**，显示成不确定态 */}
              <div className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar"
                   aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : pct}
                   data-testid="job-bar" data-determinate={pct === null ? 'no' : 'yes'}>
                <div className="h-full rounded-pill bg-accent transition-all"
                     style={{ width: pct === null ? '25%' : `${pct}%` }} />
              </div>

              {job.running ? <p className="muted small mt-2">任务进行中…</p> : null}

              {/* GPU 回退必须显示（契约 §3「不静默」） */}
              {job.deviceFallback ? (
                <p className="mt-3 err" role="alert" data-testid="device-fallback">
                  ⚠️ 设备已回退：{job.deviceFallback.from} → {job.deviceFallback.to}
                  {job.deviceFallback.reason ? `（${job.deviceFallback.reason}）` : ''}
                </p>
              ) : null}

              {job.resumeNote ? (
                <p className="muted small mt-2" data-testid="resume-note">{job.resumeNote}</p>
              ) : null}

              {job.outcome ? (
                <div className="mt-3 border-t border-line pt-3 text-caption" data-testid="job-outcome">
                  {job.outcome.error ? (
                    // ⚠️ 不写 `userMessage || 兜底` —— 那会在 Adapter 之外造出第二份文案兜底（L6 / P2）。
                    //    引擎的 `index.failed` 带完整信封，所以正常路径一定有 userMessage；
                    //    真缺了就**如实说缺**，不编一句通用道歉。
                    <p className="err">
                      任务失败：{typeof job.outcome.error.userMessage === 'string' && job.outcome.error.userMessage.length > 0
                        ? job.outcome.error.userMessage
                        : '（引擎没有给出原因）'}
                    </p>
                  ) : (
                    <p className={job.outcome.ok ? 'text-ink' : 'err'} data-testid="job-summary">
                      {job.outcome.cancelled ? '已取消 · ' : job.outcome.ok ? '完成 · ' : '完成但有失败 · '}
                      复用 <b>{summary?.reused ?? 0}</b> · 新编码 <b>{summary?.encoded ?? 0}</b> · 失败 <b>{summary?.failed ?? 0}</b>
                      {job.outcome.compat ? <span className="muted"> · compat {String(job.outcome.compat).slice(0, 24)}…</span> : null}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <FailedList failed={job.failed} />

            {!job.running && !job.outcome && !job.phase ? (
              <div className="panel mt-4" data-testid="tasks-empty-hint">
                {/* ⚠️ **这段文案刻意不抄引擎那句原文，也不列出"哪几个方法没实现"** —— 两条理由都是实测教训：
                    ① **不许在界面里硬编码"哪些方法没实现"**：那是一份会漂移的清单，唯一来源是引擎的
                       `UNIMPLEMENTED_METHODS`（`AGENTS.md` §7）。界面靠"点一下看引擎怎么答"就够了。
                    ② **抄那句话会把自动化测垮**：E2E 的 `E10-f` 用 toast 的文案做判据，界面里再出现一遍
                       同样的字 ⇒ Playwright 匹配到 2 个元素（strict mode 报错）；更糟的是 toast 还没挂上时
                       它只匹配到这一段 ⇒ **断言假绿**（2026-10-13 实测：全套挂 2/3 次、单独跑却"通过"）。 */}
                <p className="muted small">
                  还没有跑过任务。点「开始索引」；真实模式下若这个功能还没接线，引擎会如实拒绝而不是假装在跑
                  —— 点一下就知道当前是什么状态。想在本地看完整流程（阶段条 / 进度 / 失败项 / 取消 / GPU 回退），
                  用模拟模式：<span className="mono">GEMMA_FAKE=1 npm run dev</span>。
                </p>
              </div>
            ) : null}
          </div>
        </Main>
      </AppShell>
      <Toast message={message} tone={tone} />
    </>
  )
}

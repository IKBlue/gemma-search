// store/tasks.js —— 索引任务的进度状态（Operation 层）
//
// ── 为什么状态在 store 而不是组件里（占位页的注释早就写明了）────────────────
//   进度是**主进程推来的事件流**（`window.api.onEvent`），不是轮询出来的。
//   把它放进组件，就等于让"事件怎么归约成界面状态"这段逻辑无法测试
//   （`.jsx` 加载不了 —— 本仓库反复栽在这上面）。
//   放进 store，归约函数 `reduceEvent` 就是**纯函数**，可以喂合成事件在 `npm test` 里断言。
//
// ── 契约依据 ──────────────────────────────────────────────────────────
//   `CONTRACT-engine-v1.md` §3「长任务：进度 / 取消 / 续跑 / 失败清单」：
//     · 进度至少每 500 ms 一次；**`done/total` 单调不减**（取消时会停在某值）
//     · 取消后最多 2 s 内发出 `index.done{ok:false}` 或 `index.failed`
//     · 续跑按 `compat` 判定；不等则不复用**并在事件里说明原因**（不许静默）
//     · 失败清单**不静默**：`failed[]` 每项含 `{relPath, stage, error}`；非空则 `index.done.ok = false`
//     · **GPU 回退不静默**：`index.progress` 带 `deviceFallback`，**界面必须显示**
//
// ── 分层纪律 ──────────────────────────────────────────────────────────
//   本文件**不 import React、不碰 window.api**（与 `store/search.js` 同规矩）。
//   事件由 `hooks/useEngineEvents` 订阅后调 `applyEvent` 推进来这里。
import { create } from 'zustand'

/**
 * 阶段条的五步（`UI-REVIEW-and-migration.md:241`：扫描 → 配对 → 编码 → 校验 → 落盘）。
 *
 * ⚠️ **与契约的差异，如实记下**：契约 §3 里 `phase` 只举了 `"encode" | "scan" | "finalize"` 三个，
 *    而界面规格要五步。这里按**五步**做（规格是界面的依据），并**容忍未知值** ——
 *    引擎将来加了新阶段，界面**原样显示那个词**，不崩也不假装认识（同 `band` 的"未知档位"处理）。
 */
export const PHASES = Object.freeze([
  Object.freeze({ key: 'scan', label: '扫描' }),
  Object.freeze({ key: 'pair', label: '配对' }),
  Object.freeze({ key: 'encode', label: '编码' }),
  Object.freeze({ key: 'verify', label: '校验' }),
  Object.freeze({ key: 'finalize', label: '落盘' }),
])

/** 阶段 key → 中文；**认不出来就原样返回**（不猜、不吞） */
export function phaseLabel(key) {
  if (!key) return ''
  const hit = PHASES.find((p) => p.key === key)
  return hit ? hit.label : String(key)
}

/** 初始状态（未开始任何任务） */
export const initialTasks = Object.freeze({
  running: false,
  jobId: null,
  libId: null,
  phase: null,
  done: 0,
  total: 0,
  skipped: 0,
  failedCount: 0,
  ratePerSec: 0,
  etaSec: null,
  /** GPU 回退公告（契约 §3 要求界面必须显示）。一旦出现就留到本次任务结束 */
  deviceFallback: null,
  /** 续跑时引擎给的说明（"复用 N 条（compat 相符）" / "复用 0 条：compat 不符"） */
  resumeNote: null,
  /** 失败清单 `[{relPath, stage, error}]` */
  failed: [],
  /** 收尾结果：`{ok, cancelled, indexed, total, reused, encoded, failed, compat}` 或 `{ok:false, error}` */
  outcome: null,
  /** 最近一次事件的时间戳（界面据此显示"最后更新"） */
  lastEventAt: 0,
  /** 收到的原始事件（保留最近 N 条；失败项"可展开"要看细节） */
  log: [],
})

const LOG_MAX = 200

/**
 * 把一条引擎事件归约进状态。**纯函数**（同输入必同输出）⇒ 可以喂合成事件测。
 *
 * @param {object} state
 * @param {object} evt  `index.progress` | `index.done` | `index.failed`
 * @param {number} [at] 时间戳（注入以便测试确定）
 */
export function reduceEvent(state, evt, at = 0) {
  if (!evt || typeof evt !== 'object' || !evt.type) return state
  const next = { ...state, lastEventAt: at, log: [...state.log, evt].slice(-LOG_MAX) }

  if (evt.type === 'index.progress') {
    // ⚠️ **单调不减**（契约 §3 原文）。乱序或迟到的进度不许把进度条往回拨 ——
    //    那会让用户以为任务在倒退。取消时 done 就停在某个值不动。
    const done = Math.max(Number(state.done) || 0, Number(evt.done) || 0)
    return {
      ...next,
      running: true,
      jobId: evt.jobId ?? state.jobId,
      libId: evt.libId ?? state.libId,
      phase: evt.phase ?? state.phase,
      done,
      total: Number(evt.total) || state.total,
      skipped: Number(evt.skipped) || state.skipped,
      failedCount: Number(evt.failed) || state.failedCount,
      ratePerSec: Number(evt.ratePerSec) || state.ratePerSec,
      // `etaSec` 允许为 null（还没算出来）—— 界面此时显示 "—"，不编一个数
      etaSec: evt.etaSec === undefined ? state.etaSec : evt.etaSec,
      // GPU 回退**不静默**：一旦公告就留住（后续进度未必每条都带）
      deviceFallback: evt.deviceFallback ?? state.deviceFallback,
      // 续跑说明也留住（引擎只在第一条里说明复用多少）
      resumeNote: evt.note ?? state.resumeNote,
    }
  }

  if (evt.type === 'index.done') {
    return {
      ...next,
      running: false,
      phase: 'finalize',
      jobId: evt.jobId ?? state.jobId,
      done: Math.max(Number(state.done) || 0, Number(evt.indexed) || 0),
      total: Number(evt.total) || state.total,
      failed: Array.isArray(evt.failed) ? evt.failed : [],
      failedCount: Array.isArray(evt.failed) ? evt.failed.length : state.failedCount,
      outcome: {
        ok: evt.ok !== false,
        cancelled: Boolean(evt.cancelled),
        indexed: Number(evt.indexed) || 0,
        total: Number(evt.total) || 0,
        reused: Number(evt.reused) || 0,
        encoded: Number(evt.encoded) || 0,
        failed: Array.isArray(evt.failed) ? evt.failed : [],
        compat: evt.compat ?? null,
      },
    }
  }

  if (evt.type === 'index.failed') {
    return {
      ...next,
      running: false,
      // ⚠️ **不做文案兜底**（`layering.test.mjs` 的 **L6** 会抓 —— 那是 P2 的机械判据）：
      //    「userMessage 兜底」只允许出现在 `adapter/api.js` **一处**。
      //    引擎的 `index.failed` 本来就带**完整错误信封**（契约 §1.1，含 userMessage），原样存下即可；
      //    真缺了就在界面上如实说"引擎没给原因"，而不是编一句通用道歉。
      outcome: { ok: false, error: evt.error ?? null },
    }
  }

  // 认不出的事件类型：**留着但不改状态**（不崩、不假装处理过）
  return next
}

/** 开始一次任务（本地先置状态，等第一条事件回来） */
export function startLocal(state, { libId, jobId = null }) {
  return { ...initialTasks, running: true, libId, jobId }
}

/**
 * 进度百分比（0–100）。
 * `total` 未知时返回 **null**，界面显示不确定进度条 —— 不编一个百分比。
 */
export function progressPercent(state) {
  const total = Number(state.total) || 0
  if (!total) return null
  return Math.max(0, Math.min(100, Math.round((Number(state.done) || 0) / total * 100)))
}

/** ETA 文案。⚠️ 引擎没给就写 "—"，不估算（契约 §3 的 `etaSec` 是引擎算的） */
export function etaText(state) {
  const s = state.etaSec
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '—'
  const n = Math.max(0, Math.round(Number(s)))
  if (n < 60) return `${n} 秒`
  return `${Math.floor(n / 60)} 分 ${String(n % 60).padStart(2, '0')} 秒`
}

/** 收尾摘要：`复用 N · 新编码 M · 失败 K`（UI-REVIEW:244 要求完成后显示） */
export function outcomeSummary(state) {
  const o = state.outcome
  if (!o || o.error) return null
  return { reused: o.reused || 0, encoded: o.encoded || 0, failed: (o.failed || []).length }
}

export const useTaskStore = create((set) => ({
  ...initialTasks,
  /** 事件入口（由 `useEngineEvents` 订阅后调） */
  applyEvent: (evt) => set((s) => reduceEvent(s, evt, Date.now())),
  /** 本地标记"已发起"，等第一条事件回来 */
  begin: (info) => set(() => startLocal(initialTasks, info)),
  reset: () => set(() => ({ ...initialTasks })),
  /** 只给测试用：把 store 回到初始态 */
  __reset: () => set(() => ({ ...initialTasks })),
  /** 供测试直接喂状态（不经过 Date.now，保证确定） */
  __applyAt: (evt, at) => set((s) => reduceEvent(s, evt, at)),
}))

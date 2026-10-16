// apps/desktop/src/main/db/jobs.ts —— 任务台账（`job` 表）的**唯一写入口**（B2-1）
//
// 为什么单独一个模块：这张表的四条语义都是**承诺**，而不是"存一下而已"——
//   · 进度**单调**（`progress_done` 只增不减）⇒ 界面上的进度条不许往回跳；
//   · 总数**可空**（扫描前不知道就不写）⇒ 不许编一个数字来"看起来在跑"；
//   · `phase` **会变** ⇒ 「不静默」= 用户能看到"正在统计文件 / 正在编码第 3 批"；
//   · 心跳 + 崩溃判定 ⇒ 进程被杀之后，**启动时把过期任务判失败**，
//     否则界面会永远显示一个**不存在的进度**（比没有进度更坏）。
//
// ⚠️ 约束分两层，两层都要（缺一层就有绕过去的路）：
//   ① **数据库级**：`progress_done` 回退 / 终态回到 running 都由 `migrations.ts` 的 trigger ABORT
//      —— 别的写入方（脚本、将来的第二个模块）也绕不过去；
//   ② **模块级**：本文件在 UPDATE 之前先给**类型化错误**（`JobError`），
//      让人话理由回到调用方，而不是只拿到 SQLite 的 RAISE 文本。
//
// ⚠️ 行取值走 DF-2 的同一套收窄（sqlite-adapter）：bigint ⇒ Number + 安全整数校验，类型不对就抛。
//    这里**不**写第二份 `typeof x === 'number' ? x : 0`。
//
// ⚠️ `job_id`：设计基线写的是 nanoid，但**本仓库没有安装 nanoid**（package.json 里没有，
//    装它属于"新增依赖"，不在本卡范围）⇒ 用 Node 内置 `crypto.randomUUID()`（同样的意图：不可猜、
//    不受并发影响）。job_id 目前**不经 IPC 暴露**（本卡不加契约方法）⇒ 形状不受契约约束。
//    要换成 nanoid 只需改 `newJobId()` 一处（已收敛在此）。

import crypto from 'node:crypto';

import { numberOf, numberOrNullOf, textOf, textOrNullOf } from './sqlite-adapter.ts';
import type { SqlDatabase, SqlValue } from './sqlite-adapter.ts';

/** 任务的种类（与 DDL 的 CHECK 逐字对应 —— 两处不一致会在写入时炸，不会静默） */
export const JOB_KINDS: readonly string[] = Object.freeze([
  'scan',
  'index',
  'health',
  'rebuild',
  'ingest',
]);
export type JobKind = 'scan' | 'index' | 'health' | 'rebuild' | 'ingest';

/** 任务状态（与 DDL 的 CHECK 逐字对应） */
export const JOB_STATES: readonly string[] = Object.freeze([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
]);
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** 终态：到了就不许再回 queued/running（DDL 里有 trigger 兜底） */
export const JOB_TERMINAL_STATES: readonly JobState[] = Object.freeze([
  'done',
  'failed',
  'cancelled',
]);

/**
 * 心跳过期的默认阈值（毫秒）。
 * ⚠️ 取值理由：任务在**运行中**应当每秒级刷新心跳（下一张卡的索引循环），
 *    5 分钟足够容纳"一次大批量编码"而不误杀；比它更短会把慢任务误判成崩溃，
 *    更长会让界面盯着一个死任务的进度看很久。调用方可显式覆盖（不写死在各处）。
 */
export const DEFAULT_JOB_STALE_MS: number = 5 * 60 * 1000;

/** 本模块的类型化错误（与 `IndexFileError` 同形：带 code，交给上层映射） */
export type JobErrorCode =
  | 'JOB_ID_REQUIRED'
  | 'JOB_CLOCK_INVALID'
  | 'JOB_KIND_INVALID'
  | 'JOB_STATE_INVALID'
  | 'JOB_NOT_FOUND'
  | 'JOB_PROGRESS_REGRESSION'
  | 'JOB_TOTAL_BELOW_DONE'
  | 'JOB_CURSOR_INVALID';

export class JobError extends Error {
  readonly code: JobErrorCode;
  constructor(code: JobErrorCode, message: string) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

/** 一行任务（字段与 DDL 一一对应；`null` 就是"没有"，不伪造 0） */
export interface JobRow {
  jobId: string;
  kind: JobKind;
  state: JobState;
  progressDone: number;
  progressTotal: number | null;
  phase: string | null;
  cursorJson: string | null;
  heartbeatAtMs: number | null;
  summaryJson: string | null;
  error: string | null;
  queuedAtMs: number | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

/**
 * 时钟注入的**唯一**收窄点。
 * ⚠️ 为什么要有它：这些 API 收 `now?: () => number`，而误传一个**数字**（很自然的笔误）
 *    原来会以 `TypeError: now is not a function` 的形式炸在深处 —— 看不出是哪个参数错了。
 *    现在抛带码的 JobError，理由里点名参数。**不静默兜底成 Date.now**（那会让"注入失效"看不出来）。
 */
function resolveClock(v: unknown, where: string): () => number {
  if (v === undefined) return Date.now;
  if (typeof v === 'function') return v as () => number;
  throw new JobError('JOB_CLOCK_INVALID', where + ' 需要 () => number，实得 ' + typeof v);
}

/** 新的任务 id（唯一生成点；要换 nanoid 只改这里） */
export function newJobId(): string {
  return crypto.randomUUID();
}

const asKind = (v: unknown, where: string): JobKind => {
  const s = textOf(v, where);
  if (!JOB_KINDS.includes(s))
    throw new JobError('JOB_KIND_INVALID', where + ' 不是合法 kind：' + s);
  return s as JobKind;
};
const asState = (v: unknown, where: string): JobState => {
  const s = textOf(v, where);
  if (!JOB_STATES.includes(s))
    throw new JobError('JOB_STATE_INVALID', where + ' 不是合法 state：' + s);
  return s as JobState;
};

function toJob(row: Record<string, SqlValue>): JobRow {
  return {
    jobId: textOf(row['job_id'], 'job.job_id'),
    kind: asKind(row['kind'], 'job.kind'),
    state: asState(row['state'], 'job.state'),
    progressDone: numberOf(row['progress_done'], 'job.progress_done'),
    progressTotal: numberOrNullOf(row['progress_total'], 'job.progress_total'),
    phase: textOrNullOf(row['phase'], 'job.phase'),
    cursorJson: textOrNullOf(row['cursor_json'], 'job.cursor_json'),
    heartbeatAtMs: numberOrNullOf(row['heartbeat_at_ms'], 'job.heartbeat_at_ms'),
    summaryJson: textOrNullOf(row['summary_json'], 'job.summary_json'),
    error: textOrNullOf(row['error'], 'job.error'),
    queuedAtMs: numberOrNullOf(row['queued_at_ms'], 'job.queued_at_ms'),
    startedAtMs: numberOrNullOf(row['started_at_ms'], 'job.started_at_ms'),
    finishedAtMs: numberOrNullOf(row['finished_at_ms'], 'job.finished_at_ms'),
  };
}

/** 读一条；不存在返回 null（**不编一行假的**） */
export function getJob(db: SqlDatabase, jobId: string): JobRow | null {
  const row = db.prepare('SELECT * FROM job WHERE job_id = ?').get(jobId);
  return row === undefined ? null : toJob(row);
}

function requireJob(db: SqlDatabase, jobId: string): JobRow {
  const row = getJob(db, jobId);
  if (!row) throw new JobError('JOB_NOT_FOUND', '没有这个任务：' + jobId);
  return row;
}

/** 全部任务（按入队时刻，其次 id —— 确定性顺序，测试/界面都靠它） */
export function listJobs(db: SqlDatabase): JobRow[] {
  return db.prepare('SELECT * FROM job ORDER BY queued_at_ms, job_id').all().map(toJob);
}

/** **未完成任务**（queued / running）—— 启动时要看的就是这一组 */
export function listUnfinishedJobs(db: SqlDatabase): JobRow[] {
  return db
    .prepare("SELECT * FROM job WHERE state IN ('queued', 'running') ORDER BY queued_at_ms, job_id")
    .all()
    .map(toJob);
}

export interface CreateJobInput {
  kind: JobKind;
  jobId?: string;
  now?: () => number;
  /** 入队时刻（默认 now()） */
  queuedAtMs?: number;
}

/** 入队一个新任务（state=queued，progress_done=0） */
export function createJob(db: SqlDatabase, input: CreateJobInput): JobRow {
  const now = resolveClock(input.now, 'createJob.now');
  const jobId =
    typeof input.jobId === 'string' && input.jobId.trim() ? input.jobId.trim() : newJobId();
  if (!jobId) throw new JobError('JOB_ID_REQUIRED', 'createJob 需要一个非空 jobId');
  if (!JOB_KINDS.includes(input.kind)) {
    throw new JobError('JOB_KIND_INVALID', '不认识的 kind：' + String(input.kind));
  }
  const queuedAtMs = typeof input.queuedAtMs === 'number' ? input.queuedAtMs : now();
  db.prepare(
    'INSERT INTO job (job_id, kind, state, progress_done, queued_at_ms, heartbeat_at_ms) VALUES (?, ?, ?, 0, ?, ?)',
  ).run(jobId, input.kind, 'queued', queuedAtMs, queuedAtMs);
  return requireJob(db, jobId);
}

/** queued → running（记 started_at_ms + 第一次心跳） */
export function startJob(db: SqlDatabase, jobId: string, now: () => number = Date.now): JobRow {
  const cur = requireJob(db, jobId);
  if (cur.state !== 'queued') {
    throw new JobError(
      'JOB_STATE_INVALID',
      '只有 queued 能开始，当前是 ' + cur.state + '：' + jobId,
    );
  }
  const ts = now();
  db.prepare(
    "UPDATE job SET state = 'running', started_at_ms = ?, heartbeat_at_ms = ? WHERE job_id = ?",
  ).run(ts, ts, jobId);
  return requireJob(db, jobId);
}

export interface ProgressInput {
  done: number;
  /** 不知道总数就**别传**（NULL = 不知道，不是 0） */
  total?: number | null;
  /** 当前子阶段（会变；不传 = 不改） */
  phase?: string | null;
  /** 断点（JSON 字符串；不传 = 不改） */
  cursorJson?: string | null;
  now?: () => number;
  /** 是否顺带刷新心跳（默认 true —— 有进度就是"我还在"的最好证据） */
  heartbeat?: boolean;
}

/**
 * 推进进度。**`progress_done` 只增不减**：回退在这里抛 `JOB_PROGRESS_REGRESSION`，
 * 就算绕过这里，DDL 的 trigger 也会 ABORT（两层都拦）。
 */
export function setProgress(db: SqlDatabase, jobId: string, input: ProgressInput): JobRow {
  const cur = requireJob(db, jobId);
  if (typeof input.done !== 'number' || !Number.isInteger(input.done) || input.done < 0) {
    throw new JobError(
      'JOB_PROGRESS_REGRESSION',
      'progress_done 必须是非负整数，实得 ' + String(input.done),
    );
  }
  if (input.done < cur.progressDone) {
    throw new JobError(
      'JOB_PROGRESS_REGRESSION',
      '进度只增不减：当前 ' +
        String(cur.progressDone) +
        '，收到 ' +
        String(input.done) +
        '（job ' +
        jobId +
        '）',
    );
  }
  if (typeof input.total === 'number' && input.total < input.done) {
    throw new JobError(
      'JOB_TOTAL_BELOW_DONE',
      '总数不许小于已完成的（会显示成超过 100% 的假进度）：total ' +
        String(input.total) +
        ' < done ' +
        String(input.done),
    );
  }
  const now = resolveClock(input.now, 'setProgress.now');
  const ts = now();
  const beat = input.heartbeat !== false;
  db.prepare(
    'UPDATE job SET progress_done = ?, progress_total = COALESCE(?, progress_total), phase = COALESCE(?, phase), ' +
      'cursor_json = COALESCE(?, cursor_json), heartbeat_at_ms = CASE WHEN ? THEN ? ELSE heartbeat_at_ms END ' +
      'WHERE job_id = ?',
  ).run(
    input.done,
    typeof input.total === 'number' ? input.total : null,
    typeof input.phase === 'string' ? input.phase : null,
    typeof input.cursorJson === 'string' ? input.cursorJson : null,
    beat ? 1 : 0,
    ts,
    jobId,
  );
  return requireJob(db, jobId);
}

/** 只刷心跳（长循环里没有进度变化时用；「我还活着」） */
export function heartbeat(db: SqlDatabase, jobId: string, now: () => number = Date.now): JobRow {
  const cur = requireJob(db, jobId);
  if (cur.state !== 'running') {
    throw new JobError(
      'JOB_STATE_INVALID',
      '只有 running 才刷心跳，当前是 ' + cur.state + '：' + jobId,
    );
  }
  db.prepare('UPDATE job SET heartbeat_at_ms = ? WHERE job_id = ?').run(now(), jobId);
  return requireJob(db, jobId);
}

export interface FinishJobInput {
  state: 'done' | 'failed' | 'cancelled';
  /** 结束统计（JSON；不传 = 保持原样） */
  summaryJson?: string | null;
  /** 失败原因（**存人话**，界面可直接显示） */
  error?: string | null;
  now?: () => number;
}

/** 收尾：写终态 + finished_at_ms */
export function finishJob(db: SqlDatabase, jobId: string, input: FinishJobInput): JobRow {
  const cur = requireJob(db, jobId);
  // ⚠️ 终态只写一次：一个已经结束的任务不该被"再结束一次"（那会静默改写历史 ——
  //    比如 done 之后又被标成 failed，或者取消一个早就完成的索引）。
  //    DDL 的 trigger 挡的是"终态 → queued/running"，挡不住"终态 → 另一个终态"，所以这条在模块层补。
  if (JOB_TERMINAL_STATES.includes(cur.state)) {
    throw new JobError(
      'JOB_STATE_INVALID',
      '任务已经是终态（' + cur.state + '），不许再结束一次：' + jobId,
    );
  }
  if (!JOB_TERMINAL_STATES.includes(input.state)) {
    throw new JobError('JOB_STATE_INVALID', 'finishJob 只接受终态，实得 ' + String(input.state));
  }
  const ts = resolveClock(input.now, 'finishJob.now')();
  db.prepare(
    'UPDATE job SET state = ?, summary_json = COALESCE(?, summary_json), error = COALESCE(?, error), ' +
      'finished_at_ms = ? WHERE job_id = ?',
  ).run(
    input.state,
    typeof input.summaryJson === 'string' ? input.summaryJson : null,
    typeof input.error === 'string' ? input.error : null,
    ts,
    jobId,
  );
  return requireJob(db, jobId);
}

/** 读断点（返回解析后的值；没有断点 = null）。**坏 JSON 抛错**，不静默当"没有断点" */
export function readCursor<T = unknown>(job: JobRow): T | null {
  if (job.cursorJson === null) return null;
  try {
    return JSON.parse(job.cursorJson) as T;
  } catch (e) {
    throw new JobError(
      'JOB_CURSOR_INVALID',
      '任务 ' +
        job.jobId +
        ' 的 cursor_json 不是合法 JSON（' +
        (e instanceof Error ? e.message : String(e)) +
        '）',
    );
  }
}

export interface SweepInput {
  now?: () => number;
  /** 心跳超过这么久没刷新 ⇒ 判失败（默认 DEFAULT_JOB_STALE_MS） */
  ttlMs?: number;
}

/**
 * **崩溃判定**：把「running 但心跳过期」的任务判成 `failed`（带人话理由）。
 *
 * 为什么必须有：进程被杀之后库里那条 `running` 会**永远**留着 ——
 * 界面于是显示一个"还在跑、其实早就死了"的进度，而且它**永远不会前进**。
 * 判失败是**唯一诚实的出口**（不是自动重跑：重跑是用户的决定，而且要新任务）。
 *
 * ⚠️ 只动 `running`；`queued`（还没开始）不算崩溃 —— 它没有心跳本来就不奇怪。
 * @returns 被判定失败的那些行（**判了谁要能说清**）
 */
export function sweepStaleJobs(db: SqlDatabase, input: SweepInput = {}): JobRow[] {
  const now = resolveClock(input.now, 'sweepStaleJobs.now');
  const ttlMs =
    typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEFAULT_JOB_STALE_MS;
  const ts = now();
  const cutoff = ts - ttlMs;
  const stale = db
    .prepare(
      "SELECT * FROM job WHERE state = 'running' AND (heartbeat_at_ms IS NULL OR heartbeat_at_ms < ?) " +
        'ORDER BY queued_at_ms, job_id',
    )
    .all(cutoff)
    .map(toJob);
  const done: JobRow[] = [];
  for (const job of stale) {
    db.prepare(
      "UPDATE job SET state = 'failed', error = ?, finished_at_ms = ? WHERE job_id = ? AND state = 'running'",
    ).run(
      '任务心跳过期（超过 ' +
        String(ttlMs) +
        'ms 没刷新）—— 进程可能被杀或断电；这条进度已不再可信，判为失败。',
      ts,
      job.jobId,
    );
    done.push(requireJob(db, job.jobId));
  }
  return done;
}

/** 启动时结算：先判过期，再给出「还能续跑的任务 + 它们的断点」 */
export interface StartupSettlement {
  /** 被判失败的任务（心跳过期） */
  failed: JobRow[];
  /** 还能续跑的（queued/running 且心跳新鲜）；`cursor` 已解析 */
  resumable: Array<{ job: JobRow; cursor: unknown }>;
}

/**
 * **进程启动/打开库之后调一次**（下一张卡接线到真实启动路径）。
 * 语义：库里的"在跑"必须与**现实**对齐 —— 死掉的判失败，活着的带着断点交出来。
 */
export function settleUnfinishedJobsOnStartup(
  db: SqlDatabase,
  input: SweepInput = {},
): StartupSettlement {
  const failed = sweepStaleJobs(db, input);
  const resumable = listUnfinishedJobs(db).map((job) => ({ job, cursor: readCursor(job) }));
  return { failed, resumable };
}

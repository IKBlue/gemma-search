// apps/desktop/src/main/index-jobs.ts —— **索引事件 → job 行状态机**（IDX-2b2）
//
// 为什么需要这一层：引擎零依赖、**不碰 SQLite**（AGENTS §1）⇒ 它只发事件；
//   `job` 行（库级 `.gs.db`）只能由主进程写。这里把「`index.progress` / `index.done` / `index.failed`」
//   映射成 job 台账的状态机，**唯一**的 DB 写入仍然走 `main/db/jobs.ts`（B2-1 已收敛为唯一写入口）。
//
// 三条纪律（都有测试钉住）：
//   ① **单调**：进度回退由 `jobs.ts` 的 `setProgress` 拒绝（DDL 里还有 trigger 兜底）；这里**不吞错**——
//      回退/非法值一律记日志（"不静默"），行保持旧值，绝不把状态改回去。
//   ② **终态不回头**：`done`/`failed`/`cancelled` 之后的重复事件只记日志、不再写行
//      （`jobs.ts` 的终态是不可逆的；重复写入会抛 `JOB_STATE_INVALID`）。
//   ③ **首条 progress 建行**：引擎保证 `indexStart`/`indexResume` 同步发首条 progress，
//      且 `jobId` 与返回一致 ⇒ 用第一条事件建行（不需要另一个"创建任务"的调用）。
//
// ⚠️ 仓库的 `job` 表**每库一份**（库级 `.gs.db`）：事件里带 `libId` ⇒ 按库缓存连接。
//   打开库（非只读）会触发 B2-1b 的**启动结算**：上次崩溃留下的 `running` 任务会被标成中断 ⇒
//   "允许续跑"就落在 `indexResume`（引擎用 `rebuild:false` 起构建，构建器按现有索引复用）。
import type { SqlDatabase } from './db/index.ts';
import { createJob, finishJob, getJob, JobError, setProgress, startJob } from './db/jobs.ts';
import type { JobRow } from './db/jobs.ts';
import { openGsDb } from './db/open.ts';

/** 解析后的事件（内部形状；`parseIndexEvent` 是唯一入口，绝不直接读未知对象） */
export interface IndexEvent {
  type: 'index.progress' | 'index.done' | 'index.failed';
  jobId: string;
  libId: string;
  /** progress 用：已完成（done 事件里退化为 0，不参与写入） */
  done: number;
  total: number | null;
  phase: string | null;
  ok: boolean | null;
  cancelled: boolean;
  /** `index.failed` / `index.done{ok:false}` 里带的错误码（写进 `error` 的前缀） */
  errorCode: string | null;
  errorMessage: string | null;
  /** 终态统计（进 `summary_json`）：复用/新编码/失败条数 + compat */
  reused: number | null;
  encoded: number | null;
  failedCount: number | null;
  compat: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

/**
 * **唯一**的事件解析点（纯函数，便于单测）。形状不对 ⇒ `null`（调用方记日志，绝不猜）。
 * 形状来自引擎侧定稿：`{type, jobId, libId, done, total, phase, ok, cancelled, error:{code}}`。
 */
export function parseIndexEvent(evt: unknown): IndexEvent | null {
  const r = asRecord(evt);
  if (!r) return null;
  const type = text(r.type);
  if (type !== 'index.progress' && type !== 'index.done' && type !== 'index.failed') return null;
  const jobId = text(r.jobId);
  const libId = text(r.libId);
  if (!jobId || !libId) return null;
  const err = asRecord(r.error);
  const errorCode = err ? text(err.code) || null : null;
  const errorMessage = err ? text(err.message) || null : null;
  const failed = Array.isArray(r.failed) ? r.failed.length : null;
  return {
    type,
    jobId,
    libId,
    done: int(r.done) ?? 0,
    total: int(r.total),
    phase: text(r.phase) || null,
    ok: typeof r.ok === 'boolean' ? r.ok : null,
    cancelled: r.cancelled === true,
    errorCode,
    errorMessage,
    reused: int(r.reused),
    encoded: int(r.encoded),
    failedCount: failed,
    compat: text(r.compat) || null,
  };
}

interface LibHandle {
  db: SqlDatabase;
  close: () => void;
}

export interface IndexJobRecorderOptions {
  /** 库 → `.gs.db` 落点（由 storage 端口解析；解析不到 ⇒ 记日志并跳过，不抛） */
  libDbPathOf: (libId: string) => string | null;
  /** 测试注入：默认 `openGsDb({ dbPath })`（非只读 ⇒ 会跑迁移 + 启动结算） */
  openDb?: (dbPath: string) => LibHandle;
  now?: () => number;
  log?: (...a: unknown[]) => void;
}

export interface IndexJobRecorder {
  /** 吃一条引擎事件；**永不抛**（IPC 事件回调里抛异常会打穿进程，且会让"已发生的事实"丢失） */
  ingest(evt: unknown): void;
  /**
   * 启动时**主动**把每个已登记库的台账打开一次 ⇒ 触发 B2-1b 的启动结算。
   * ⚠️ 为什么要主动：结算只在 `openGsDb`（非只读）时发生；不预热的话，上次崩溃留下的
   *    `running` 索引任务会**一直显示在跑**，直到用户下一次触发索引才被结算 —— 那是假的。
   */
  warmup(libIds: readonly string[]): void;
  /**
   * 这个进程里见过的 `jobId → libId`。
   * ⚠️ 用途：`indexResume` 在**跨重启**时必须有 `libId`（引擎没有持久履历），而 job 行是**每库一份**、
   *    不从库外查不到归属。同进程内（最常见：开始 → 取消 → 续跑）由这里补上，调用方就不必猜。
   */
  libIdOf(jobId: string): string | null;
  /** 关掉缓存的库连接（应用退出时） */
  close(): void;
}

/**
 * 创建索引任务的 job 台账记录器。
 * ⚠️ 一个进程一个实例（库连接要缓存：每条事件都开一次库会反复跑启动结算，既慢又误导）。
 */
export function createIndexJobRecorder(opts: IndexJobRecorderOptions): IndexJobRecorder {
  const openDb =
    opts.openDb ??
    ((dbPath: string): LibHandle => {
      const opened = openGsDb({ dbPath, now: opts.now });
      return { db: opened.db, close: () => opened.db.close() };
    });
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const handles = new Map<string, LibHandle | null>();
  /** `index.failed` 先到、`index.done{ok:false}` 后到 ⇒ 把错误码带到终态那一行 */
  const pendingError = new Map<string, string>();
  /** 进程内见过的 jobId → libId（见接口注释：给 indexResume 补 libId） */
  const libOfJob = new Map<string, string>();

  function dbFor(libId: string): LibHandle | null {
    if (handles.has(libId)) return handles.get(libId) ?? null;
    let handle: LibHandle | null = null;
    try {
      const dbPath = opts.libDbPathOf(libId);
      if (!dbPath) {
        log('!! [索引任务] 库元数据落点解析不到（job 行没有写入）：', libId);
      } else {
        handle = openDb(dbPath);
      }
    } catch (e) {
      log('!! [索引任务] 打开库元数据失败（job 行没有写入）：', libId, String(e));
      handle = null;
    }
    handles.set(libId, handle);
    return handle;
  }

  /** 拿一个"在跑"的 job 行：没有就建（首条事件），queued 就 start，终态返回 null。 */
  function ensureRunning(db: SqlDatabase, evt: IndexEvent): JobRow | null {
    let cur = getJob(db, evt.jobId);
    if (cur === null) {
      createJob(db, { kind: 'index', jobId: evt.jobId, now });
      cur = startJob(db, evt.jobId, now);
      return cur;
    }
    if (cur.state === 'queued') return startJob(db, evt.jobId, now);
    if (cur.state === 'running') return cur;
    // 终态：不再写（jobs.ts 的终态不可逆；重复写入会抛 JOB_STATE_INVALID）
    log('[索引任务] 已终态，忽略后续事件：', evt.jobId, '状态', cur.state, '事件', evt.type);
    return null;
  }

  function ingest(evt: unknown): void {
    const parsed = parseIndexEvent(evt);
    if (!parsed) {
      log('!! [索引任务] 事件形状不认识，已忽略（不猜）：', String(evt));
      return;
    }
    try {
      libOfJob.set(parsed.jobId, parsed.libId);
      const handle = dbFor(parsed.libId);
      if (!handle) return;
      if (parsed.type === 'index.failed') {
        if (parsed.errorCode) pendingError.set(parsed.jobId, parsed.errorCode);
        log('!! [索引任务] 失败事件：', parsed.jobId, parsed.errorCode ?? '(无码)');
        return;
      }
      const row = ensureRunning(handle.db, parsed);
      if (!row) return;
      if (parsed.type === 'index.progress') {
        try {
          setProgress(handle.db, parsed.jobId, {
            done: parsed.done,
            total: parsed.total,
            phase: parsed.phase,
            now,
          });
        } catch (e) {
          // 回退/非法值：**记日志**，行保持旧值（这正是"不静默"与"不把状态改回去"的落点）
          log(
            '!! [索引任务] 进度写回被拒（行保持旧值）：',
            parsed.jobId,
            e instanceof JobError ? e.code : String(e),
          );
        }
        return;
      }
      // index.done：终态。ok=false 且不是取消 ⇒ failed；ok=true ⇒ done；cancelled ⇒ cancelled。
      const cancelled = parsed.cancelled;
      const ok = parsed.ok === true && !cancelled;
      const state = cancelled ? 'cancelled' : ok ? 'done' : 'failed';
      const errorCode =
        state === 'failed' ? (pendingError.get(parsed.jobId) ?? parsed.errorCode) : null;
      // ⚠️ 偏离卡面一处（如实记）：`job` 表**没有 `error_code` 列**（B2-1 的 DDL 只有 `error`），
      //   而"加一列"必须走新迁移（改已发布的迁移 = 对已升级的库静默无效）—— 不属本卡。
      //   ⇒ 错误码写进 `error` 的**前缀**（`CODE: 人话`）：既显示得出来，也 grep 得到；不新开列。
      const errorText = errorCode
        ? errorCode + (parsed.errorMessage ? ': ' + parsed.errorMessage : '')
        : null;
      const summary =
        parsed.reused !== null || parsed.encoded !== null
          ? JSON.stringify({
              reused: parsed.reused,
              encoded: parsed.encoded,
              failed: parsed.failedCount,
              total: parsed.total,
              compat: parsed.compat,
            })
          : null;
      try {
        finishJob(handle.db, parsed.jobId, {
          state,
          error: errorText,
          summaryJson: summary,
          now,
        });
      } catch (e) {
        log(
          '!! [索引任务] 终态写入失败：',
          parsed.jobId,
          e instanceof JobError ? e.code : String(e),
        );
        return;
      }
      pendingError.delete(parsed.jobId);
      log('[索引任务] 终态：', parsed.jobId, state, errorCode ? '(' + errorCode + ')' : '');
    } catch (e) {
      // 兜底：**永不抛**（事件回调里抛异常会打穿主进程）
      log('!! [索引任务] 处理事件时出现未预期错误（已吞下并记录）：', String(e));
    }
  }

  return {
    ingest,
    warmup(libIds) {
      for (const libId of libIds) dbFor(libId);
    },
    libIdOf(jobId) {
      return libOfJob.get(jobId) ?? null;
    },
    close() {
      for (const h of handles.values()) {
        if (h) {
          try {
            h.close();
          } catch {
            /* 关闭失败不影响退出 */
          }
        }
      }
      handles.clear();
    },
  };
}

// packages/engine/src/index-jobs.ts —— 真实索引任务的**任务管理**（IDX-2b）
//
// 职责：把「注入的构建器」包成引擎的三个契约方法（indexStart / indexCancel / indexResume），并且：
//   ① 进度**单调不减**（AGENTS §5.2：进度类状态必须单调且不静默）—— 构建器回退的 done 直接丢弃；
//   ② 取消**在阶段边界**：只 abort，等构建器在安全点抛；**本次构建不会再调 writeIndex**
//      ⇒ 目标索引文件要么是旧的、要么是新的（原子写），不会留半个文件；
//   ③ 终态**必发**：成功 → index.done{ok:true}；取消 → index.done{cancelled:true}；
//      硬失败 → index.failed + index.done{ok:false}（不许安静停住）；
//   ④ 事件形状与 fake.ts **完全同形**（渲染层不用两套，P1）；
//   ⑤ 「未接线」与「接线了但环境不满足」**可区分**（Lead 2026-10-17 要求）：
//      前者 = 同步 INTERNAL（message 含 IDX-2b）；后者 = index.failed 事件里**真实错误码**（如 MODEL_MISSING/ENOENT）。
//
// 引擎**没有任何持久状态**（零依赖、不碰 SQLite）：跨进程的「上次跑到哪」由**构建器**从索引/元数据里算（reused），
// 本模块只保留**同进程**履历，用来让 indexResume 知道「哪个库、什么参数、已完成多少」。
import { ERR, fail, messageOf } from './errors.ts';
import type { IndexingPorts, IndexBuildSummary } from './index-ports.ts';

/** 注册表的最小子集（引擎既有形状；不 repeat 一份完整 LibraryRegistry） */
export interface IndexJobRegistry {
  requireExistingRoot(libId: string): void;
  get(libId: string): { libId: string; root: string; label?: string };
}

export interface IndexJob {
  jobId: string;
  libId: string;
  libRoot: string;
  device?: string;
  seq?: number;
  rebuild: boolean;
  total: number;
  done: number;
  phase: string;
  cancelled: boolean;
  controller: AbortController;
  startedAt: number;
}

/** 同进程履历（`jobs` 在终态就删，续跑要靠它）。导出是因为 api 的 `_jobHistory` 暴露给测试/诊断。 */
export interface JobHistory {
  jobId: string;
  libId: string;
  done: number;
  total: number;
  device?: string;
  seq?: number;
}

export interface IndexJobsOptions {
  registry: IndexJobRegistry;
  /** 事件出口（引擎的 onEvent） */
  emit: (ev: Record<string, unknown>) => void;
  now: () => number;
  /** null = 未接线（真实模式保持 IDX-2a 的行为） */
  ports: IndexingPorts | null;
  newJobId: () => string;
}

export type IndexStartRequest = {
  libId?: string;
  device?: string;
  seq?: number;
  rebuild?: boolean;
};
export type IndexJobRefRequest = { jobId?: string; libId?: string };

/** 取消判据：构建器抛的三类都算「取消」，不算「失败」 */
function isCancelError(e: unknown, cancelled: boolean): boolean {
  if (cancelled) return true;
  if (typeof e !== 'object' || e === null) return false;
  const name = (e as { name?: unknown }).name;
  if (name === 'BuildCancelledError' || name === 'AbortError') return true;
  return (e as { code?: unknown }).code === 'ABORT_ERR';
}

function codeOf(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c) return c;
  }
  return undefined;
}

export function createIndexJobs(opts: IndexJobsOptions) {
  const { registry, emit, now, ports } = opts;
  const jobs = new Map<string, IndexJob>();
  const history = new Map<string, JobHistory>();

  /** 未接线 ⇒ 同步 INTERNAL（IDX-2b 文案；与 IDX-2a 完全一致，不许变成「假成功」） */
  function requirePorts(): IndexingPorts {
    if (
      ports === null ||
      typeof ports.buildIndex !== 'function' ||
      typeof ports.writeIndex !== 'function'
    ) {
      throw fail(
        ERR.INTERNAL,
        '索引任务在真实模式下还没接线（IDX-2b 接入）；模拟模式可用 GEMMA_FAKE=1 演示。',
        {
          method: 'indexStart',
          plannedIn: 'IDX-2b',
        },
      );
    }
    return ports;
  }

  function emitProgress(
    job: IndexJob,
    p: { phase?: string; done?: number; total?: number; failed?: number; note?: string },
  ): void {
    const total = Number.isFinite(p.total) ? Math.max(job.total, p.total as number) : job.total;
    // ⚠️ 单调：构建器可能给出回退的 done（重扫/重试）—— 向上发出的值只增不减
    const done = Number.isFinite(p.done)
      ? Math.min(total > 0 ? total : Number.MAX_SAFE_INTEGER, Math.max(job.done, p.done as number))
      : job.done;
    job.total = total;
    job.done = done;
    if (p.phase) job.phase = p.phase;
    const elapsedSec = Math.max(0.001, (now() - job.startedAt) / 1000);
    const ratePerSec = Number((done / elapsedSec).toFixed(2));
    const ev: Record<string, unknown> = {
      type: 'index.progress',
      jobId: job.jobId,
      libId: job.libId,
      done,
      total: job.total,
      skipped: 0,
      failed: Number.isFinite(p.failed) ? p.failed : 0,
      ratePerSec,
      etaSec:
        ratePerSec > 0 && job.total > 0
          ? Math.max(0, Math.round((job.total - done) / ratePerSec))
          : null,
      phase: job.phase,
    };
    if (p.note) ev.note = p.note;
    emit(ev);
  }

  function finish(job: IndexJob, s: IndexBuildSummary | null, err: unknown): void {
    jobs.delete(job.jobId);
    if (job.cancelled || (err !== null && err !== undefined && isCancelError(err, false))) {
      // 取消：**不发 index.failed**（那不是失败）；failed 明细留空 —— 引擎不编造「哪条没编完」
      emit({
        type: 'index.done',
        jobId: job.jobId,
        libId: job.libId,
        ok: false,
        cancelled: true,
        indexed: job.done,
        total: job.total,
        reused: 0,
        encoded: 0,
        failed: [],
        compat: null,
        note: '已取消：停在阶段边界，索引文件保持原样（原子写只在成功跑完时发生）',
      });
      return;
    }
    if (err !== null && err !== undefined) {
      // ⚠️ 硬失败：真实错误码原样透出（MODEL_MISSING / ENOENT / LIB_ROOT_MISSING …）
      //    —— 与「未接线」的 INTERNAL 必须可区分（Lead 2026-10-17 要求）
      const code = codeOf(err) ?? 'BUILD_FAILED';
      emit({
        type: 'index.failed',
        jobId: job.jobId,
        libId: job.libId,
        error: { code, message: messageOf(err) },
      });
      emit({
        type: 'index.done',
        jobId: job.jobId,
        libId: job.libId,
        ok: false,
        cancelled: false,
        indexed: job.done,
        total: job.total,
        reused: 0,
        encoded: 0,
        failed: [],
        compat: null,
        note: '构建失败：' + messageOf(err),
      });
      return;
    }
    const sum = s as IndexBuildSummary;
    history.set(job.jobId, {
      jobId: job.jobId,
      libId: job.libId,
      done: sum.encoded + sum.reused,
      total: sum.total,
      device: job.device,
      seq: job.seq,
    });
    emit({
      type: 'index.done',
      jobId: job.jobId,
      libId: job.libId,
      ok: sum.failed === 0,
      cancelled: false,
      indexed: sum.encoded + sum.reused,
      total: sum.total,
      reused: sum.reused,
      encoded: sum.encoded,
      failed: sum.failedItems ?? [],
      compat: sum.compat ?? null,
    });
  }

  /** 起一个任务（异步跑构建；indexStart/indexResume 立刻返回） */
  function startInternal(req: {
    libId: string;
    device?: string;
    seq?: number;
    rebuild: boolean;
    reused?: number;
  }): { envelope: { jobId: string; total: number; phase: string }; job: IndexJob } {
    const p = requirePorts();
    registry.requireExistingRoot(req.libId);
    const root = registry.get(req.libId).root;
    const job: IndexJob = {
      jobId: opts.newJobId(),
      libId: req.libId,
      libRoot: root,
      device: req.device,
      seq: req.seq,
      rebuild: req.rebuild,
      total: 0,
      done: 0,
      phase: 'scan',
      cancelled: false,
      controller: new AbortController(),
      startedAt: now(),
    };
    jobs.set(job.jobId, job);
    // 首条 progress：total 在真实构建里要等 scan 阶段 ⇒ 这里如实报 0（未知），不假装知道
    emitProgress(job, { phase: 'scan', done: req.reused ?? 0, total: 0 });
    void (async () => {
      try {
        const sum = await p.buildIndex({
          libId: job.libId,
          libRoot: job.libRoot,
          device: job.device,
          seq: job.seq,
          rebuild: job.rebuild,
          signal: job.controller.signal,
          onProgress: (prog) => {
            if (job.cancelled) return;
            emitProgress(job, {
              phase: prog.phase,
              done: prog.done,
              total: prog.total,
              failed: prog.failed,
              note: prog.reused && prog.reused > 0 ? `复用 ${prog.reused} 条` : undefined,
            });
          },
          // ⚠️ 唯一原子写：补上 libRoot 后**原样透传**给主进程注入的写者；引擎不碰字节
          writeIndex: (input) => p.writeIndex({ libRoot: job.libRoot, bytes: input.bytes }),
        });
        finish(job, sum, null);
      } catch (e) {
        finish(job, null, e);
      }
    })();
    return { envelope: { jobId: job.jobId, total: 0, phase: 'scan' }, job };
  }

  return {
    start(req: IndexStartRequest = {}): { jobId: string; total: number; phase: string } {
      const libId = String(req.libId ?? '').trim();
      if (!libId) throw fail(ERR.BAD_REQUEST, 'indexStart 需要 libId', { method: 'indexStart' });
      return startInternal({
        libId,
        device: req.device,
        seq: req.seq,
        rebuild: req.rebuild === true,
      }).envelope;
    },

    cancel(req: IndexJobRefRequest = {}): { cancelled: boolean; reason?: string } {
      const jobId = req.jobId === undefined ? [...jobs.keys()][0] : String(req.jobId);
      const job = jobId === undefined ? undefined : jobs.get(jobId);
      if (!job) return { cancelled: false, reason: 'no-such-job' };
      job.cancelled = true;
      job.controller.abort(); // 只置信号；收尾等构建器在安全点抛（阶段边界）
      return { cancelled: true };
    },

    resume(req: IndexJobRefRequest = {}): {
      jobId: string;
      total: number;
      phase: string;
      reused: number;
    } {
      const jobId = req.jobId === undefined ? undefined : String(req.jobId);
      const h = jobId === undefined ? undefined : history.get(jobId);
      // 跨进程：引擎内存里没有履历 ⇒ 必须由调用方带 libId（main 从 job 行里取）
      const libId = h?.libId ?? (req.libId === undefined ? undefined : String(req.libId));
      if (libId === undefined || libId === '') {
        throw fail(
          ERR.BAD_REQUEST,
          '续跑需要 libId：进程重启后引擎内存里没有该任务的履历（jobId=' +
            String(jobId ?? '(无)') +
            '），请带 libId 再试',
          { method: 'indexResume', jobId: jobId ?? null },
        );
      }
      const reused = h?.done ?? 0;
      const started = startInternal({
        libId,
        device: h?.device,
        seq: h?.seq,
        rebuild: false,
        reused,
      });
      // 续跑的「复用」必须**不静默**（卡片约束 5）：单独发一条带 note 的 progress 说明复用来源
      emitProgress(started.job, {
        phase: 'scan',
        done: reused,
        total: h?.total ?? 0,
        note:
          reused > 0
            ? '复用 ' + String(reused) + ' 条（同进程履历）'
            : '复用 0 条：没有可复用的同进程履历（跨重启时以构建器上报为准）',
      });
      return { ...started.envelope, reused };
    },

    /** 测试与收尾用（引擎 dispose 时 abort 所有在跑任务） */
    _jobs: jobs,
    _history: history,
    dispose(): void {
      for (const j of jobs.values()) j.controller.abort();
      jobs.clear();
    },
  };
}

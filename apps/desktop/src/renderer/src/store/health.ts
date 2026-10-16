// store/health.ts —— 体检 / 重建元数据 的状态（Operation 层，T-15b · 2026-10-15）
//
// 分层（AGENTS §2）：本文件是 **Operation 层** —— 它调 Adapter，**不 import React**，
// 所以纯函数（`decideRebuildGate` / `rebuildSummary` / `checkLabel`）能在 `node:test` 里跑。
// ⚠️ 提示文案（toast）**不进 store**：它是 UI 关切，动作把它当参数收（`run(onToast)`），
//    与 `store/search.ts` / `store/tasks.ts` 同一口径。
//
// ── 为什么重建必须两段式（AGENTS §5.3，硬要求）──────────────────────────────
//   重建会**删掉 .gs.db 家族**（`.gs.db` / `-wal` / `-shm` / `-journal`）再重建 —— 那是**写操作**。
//   ⇒ 请求 → 确认；**取消 ⇒ 一个 IPC 都不发**；确认时**先清状态再执行**（连点只发一次）。
//   这套状态机刻意放在 store 里，理由与取件（`pendingCollect`）完全一样：
//   唯有如此，「取消 ⇒ 零 IPC」才是**可断言**的（见 `apps/desktop/tests/health-store.test.mjs` 的 HZ 系列）。
//
// ── 为什么没有事件也不影响「正在重建元数据」（SPEC §2.3）────────────────────
//   契约只批了这两个方法、**不发事件**（T-15a 明文）。所以进度只能是 UI 忙碌态：
//   `rebuilding` 一置位，页面就显示「正在重建元数据…」并禁用按钮 —— **不许装作没事**，
//   也不许自己编一个百分比（编进度 = 谎报，同 `store/tasks.ts` 对未知 total 的处理）。
import { create } from 'zustand';

import { invoke as apiInvoke } from '../adapter/api.ts';
import type { AdapterError } from '../adapter/api.ts';
import type { ToastFn } from './search.ts';

/** 体检项 id（主进程 `HealthCheckId` 的**拷贝**；渲染层不 import 主进程模块） */
export type HealthCheckId =
  | 'library-root'
  | 'items-file'
  | 'index'
  | 'db-file'
  | 'db-open'
  | 'db-schema'
  | 'db-integrity'
  | 'db-tables'
  | 'db-read'
  | (string & {});

/** 一项体检结论（**结构由主进程给**，界面只渲染，不自己判定） */
export type HealthCheck = {
  id: HealthCheckId;
  ok: boolean;
  /** 机器可读失败码；ok 时为空串（主进程契约：**不要**按 reason 分支） */
  code: string;
  /** 人话理由；ok 时也非空（主进程契约） */
  reason: string;
  /** 「删库重建」能不能修好这一项（索引不行 ⇒ false） */
  rebuildable: boolean;
};

/** 孤包明细（相对库根）—— 界面显示/复制用；**孤包没有 uid**（它不是素材） */
export type OrphanArchiveFinding = {
  relPath: string;
  ext: string;
};

/**
 * 孤包（只有包、没有图）—— 主进程给的**独立异常类别**（U12）。
 * ⚠️ 界面只渲染它，**不自己判定**：
 *   · 它**不是**失败检查项，也**不是损坏** —— 是**不完整**；
 *   · 文案必须带上「不算素材 · 不是损坏 · 重建修不好」（这三句是口径，不许改写）。
 */
export type OrphanArchive = {
  count: number;
  samples: OrphanArchiveFinding[];
  /** count > samples.length ⇒ 明细被截断（计数仍然真实） */
  truncated: boolean;
  /** 是否真的扫过：false ⇒ count=0 代表「没扫/扫描失败」，**不是**「没有孤包」 */
  scanned: boolean;
  error: string | null;
};

export type LibraryHealthReport = {
  libId: string;
  root: string;
  dbPath: string | null;
  indexPath: string;
  checks: HealthCheck[];
  /** 素材数 = 预览图条目（**孤包不计入**）；null = 没扫（库根不在） */
  materialCount: number | null;
  /** 独立异常类别：孤包（只有包、没有图） */
  orphanArchive: OrphanArchive;
  ok: boolean;
  needsDbRebuild: boolean;
  needsIndexRebuild: boolean;
  reason: string;
};

/** `rebuildLibraryDb` 的导入段（界面要显示的部分） */
export type RebuildImport = {
  dbCount?: number;
  inserted?: number;
  updated?: number;
  deleted?: number;
};

export type RebuildReport = {
  libId: string;
  root: string;
  dbPath: string;
  indexPath: string;
  before: LibraryHealthReport | null;
  /** 真正删掉的 .gs.db 文件（含边车）—— 报告里要**列出来**，不能只说「删了」 */
  removedDbFiles: string[];
  created: boolean;
  schema?: { fromVersion?: number; toVersion?: number; applied?: number[] };
  import?: RebuildImport;
  index?: { action?: string; detail?: string; count?: number | null; dim?: number | null };
  after: LibraryHealthReport;
  dbOk: boolean;
  indexOk: boolean;
  /** = `after.ok`：**整个库**都好了才 true（索引仍坏 ⇒ false，绝不假装成功） */
  ok: boolean;
  reason: string;
};

export type HealthPhase = 'idle' | 'checking' | 'ready' | 'error';
export type RebuildPhase = 'idle' | 'confirm' | 'running' | 'done' | 'error';

/** 待确认的重建请求。**只有 libId** —— 契约是 `.strict()`，多传字段会被主进程拒 */
export type RebuildRequest = { libId: string };

export type HealthState = {
  phase: HealthPhase;
  report: LibraryHealthReport | null;
  error: AdapterError | null;
  rebuildPhase: RebuildPhase;
  /** 待确认的重建请求（null = 没有待确认的东西 ⇒ 不弹确认框、一个 IPC 都不该发） */
  pendingRebuild: RebuildRequest | null;
  /** 上一次重建的报告（完成后显示；复检结果落在 report 里） */
  reportAfterRebuild: RebuildReport | null;
  /** 重建失败时的信封（人话在 userMessage，不在界面里再编一份） */
  rebuildError: AdapterError | null;
};

export type HealthStore = HealthState & {
  /** 体检（只读）。libId 由调用方给 —— 从哪来是 `utils/library-root.ts` 的事 */
  run: (libId: string, onToast?: ToastFn) => Promise<void>;
  /** 请求重建（**只记下来** → 界面据此弹确认框，不执行任何 IPC） */
  requestRebuild: (libId: string) => void;
  /** 取消（丢弃请求 —— 这是「用户拒绝」的唯一路径） */
  cancelRebuild: () => void;
  /** 确认执行。**先清 pendingRebuild 再执行**（连点两次只发一次 IPC） */
  confirmRebuild: (onToast?: ToastFn) => Promise<void>;
  /** 只给测试用：回到初始态（避免测试之间互相污染） */
  __reset: () => void;
};

const initial: HealthState = {
  phase: 'idle',
  report: null,
  error: null,
  rebuildPhase: 'idle',
  pendingRebuild: null,
  reportAfterRebuild: null,
  rebuildError: null,
};

/**
 * 重建按钮该不该可点、为什么 —— **纯函数**（可断言）。
 *
 * ⚠️ 2026-10-15（T-15b 真库实测后收紧口径）：**索引坏了不再挡住元数据重建**。
 *    它是一个**真实**的处境：老的旧布局库里只有 index.bin，体检会如实报 `index(INDEX_MISSING)`，
 *    而 `.gs.db` 可能同时是坏的（或没建出来）—— 这时用户点一下重建元数据**是正确且有用的**动作。
 *    先禁用按钮看着像「更安全」，实际是**堵住了一条能修好的路**，而且体检报告本来就说了索引还坏着
 *    （`after.indexOk=false` + `index.action='still-broken'`）⇒ 不假装成功。
 *    ⇒ 所以门只挡两种情况：**还没体检**（不知道该不该修）与**正在跑**（避免并发重建）。
 *    索引要不要重编码是**另一条路**（`indexStart`，目前是诚实桩），与本按钮无关。
 */
export function decideRebuildGate(input: {
  report: LibraryHealthReport | null;
  rebuildPhase: RebuildPhase;
}): { allowed: boolean; reason: string } {
  if (input.rebuildPhase === 'running')
    return { allowed: false, reason: '正在重建元数据，请等它跑完' };
  const report = input.report;
  if (!report) return { allowed: false, reason: '先跑一次体检，确认坏在哪' };
  if (!report.needsDbRebuild) return { allowed: false, reason: '体检没发现可重建的元数据问题' };
  return { allowed: true, reason: '' };
}

const CHECK_LABELS: Record<string, string> = {
  'library-root': '库根',
  'items-file': '条目表 items.json',
  index: '向量索引',
  'db-file': '元数据 .gs.db',
  'db-open': '打开 .gs.db',
  'db-schema': 'schema 版本',
  'db-integrity': '结构完整性',
  'db-tables': '数据表',
  'db-read': '可读性',
};

/** 体检项的显示名。**认不出来就原样显示那个 id**（不猜、不吞）—— 同 `phaseLabel` 的口径 */
export function checkLabel(id: string): string {
  return CHECK_LABELS[id] ?? id;
}

/** 重建报告的一句话摘要（删了什么 / 导入多少 / 索引处置）—— 纯函数，可断言 */
export function rebuildSummary(report: RebuildReport): string {
  const imp = report.import ?? {};
  const removed = report.removedDbFiles.length;
  const index = report.index?.action ?? '—';
  return (
    '删除 ' +
    String(removed) +
    ' 个 .gs.db 文件 · 导入 ' +
    String(imp.dbCount ?? 0) +
    ' 条' +
    '（新增 ' +
    String(imp.inserted ?? 0) +
    ' / 更新 ' +
    String(imp.updated ?? 0) +
    ' / 幽灵行 ' +
    String(imp.deleted ?? 0) +
    '）' +
    ' · 索引 ' +
    index
  );
}

export const useHealthStore = create<HealthStore>()((set, get) => ({
  ...initial,

  run: async (libId, onToast) => {
    if (!libId) {
      if (onToast) onToast('还没有可体检的库', 'err');
      return;
    }
    set({ phase: 'checking', error: null });
    // Adapter 永不抛 ⇒ 不需要 try/catch（见 adapter/api.ts 的 A5 断言）
    const r = await apiInvoke<LibraryHealthReport>('libraryHealth', { libId });
    if (!r.ok) {
      // 文案只用 Adapter 归一后的 userMessage —— 界面**不许**再抄一份兜底（L6 会抓）
      set({ phase: 'error', report: null, error: r.error });
      if (onToast) onToast(r.error.userMessage, 'err');
      return;
    }
    set({ phase: 'ready', report: r.data, error: null });
  },

  requestRebuild: (libId) => {
    if (!libId) return;
    set({ pendingRebuild: { libId } });
  },

  cancelRebuild: () => set({ pendingRebuild: null }),

  confirmRebuild: async (onToast) => {
    const pending = get().pendingRebuild;
    if (!pending) return; // 没有待确认项 ⇒ 什么都不做（防误调）
    // ⚠️ **先清状态再执行**：否则连点两次确认会发两次 IPC，而第二次重建在语义上是
    //    「刚建好的库再删一次」—— 不是一个安全的操作（同 store/search.ts 的 confirmCollect）。
    set({
      pendingRebuild: null,
      rebuildPhase: 'running',
      rebuildError: null,
      reportAfterRebuild: null,
    });
    const r = await apiInvoke<RebuildReport>('libraryRebuild', { libId: pending.libId });
    if (!r.ok) {
      set({ rebuildPhase: 'error', rebuildError: r.error });
      if (onToast) onToast(r.error.userMessage, 'err');
      return;
    }
    set({ rebuildPhase: 'done', reportAfterRebuild: r.data, rebuildError: null });
    if (onToast) {
      // 如实报：ok=false 表示「元数据修好了、但索引还坏着」—— 不许显示成成功
      onToast(
        r.data.ok ? '重建完成，复检通过' : '重建完成，但复检仍有问题',
        r.data.ok ? 'info' : 'err',
      );
    }
    // 自动复检一次（用**同一条**只读方法，不自己把 after 当结论硬塞进 report）
    await get().run(pending.libId);
  },

  __reset: () => set({ ...initial }),
}));

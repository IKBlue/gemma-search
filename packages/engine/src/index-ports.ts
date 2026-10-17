// packages/engine/src/index-ports.ts —— 真实索引构建的**注入端口**（IDX-2b）
//
// 为什么是「注入」而不是引擎自己调 indexer：
//   · 引擎**零第三方依赖、传输无关、不 import electron**（AGENTS §1）—— 更不能反向依赖 indexer；
//   · `modelDir` / `outDir` 这类**路径**不该出现在引擎里。
//     ⚠️ 注意：本文件的 `IndexBuildRequest` **故意没有** modelDir/outDir 字段 ——
//        「不写死路径」在这里是**类型层的机械保障**（引擎拿不到那两个字段，想写死也写不了），不是靠自律。
//   · 写索引只有**一处**原子写：由主进程注入 `writeIndex`（实现必须是 index-file.writeIndexAtomically）；
//     引擎只把 `libRoot` 补进去后透传给构建器，**从不自己写字节**。

/** 进度。字段与 IDX-1 的 `BuildProgress` 对齐（引擎只归一化/转发，不改语义）。 */
export interface IndexBuildProgress {
  phase: string;
  /** 已完成条数 —— 引擎保证向上发出的事件里**单调不减** */
  done: number;
  /** 总数（真实构建由 scan 阶段确定 ⇒ 首条 progress 才可能非 0） */
  total: number;
  reused?: number;
  failed?: number;
  rate?: number;
  etaSec?: number;
  message?: string;
}

/** 构建请求（引擎 → 主进程适配器的唯一形状） */
export interface IndexBuildRequest {
  libId: string;
  /** 库根绝对路径（引擎从注册表取；**不在**请求里传绝对路径进来） */
  libRoot: string;
  device?: string;
  seq?: number;
  /** true = 从头重建（不复用）；false/省略 = 允许构建器复用已编码行 */
  rebuild?: boolean;
  /** 取消信号：构建器在**安全点**检查后抛（IDX-1 的 BuildCancelledError） */
  signal: AbortSignal;
  onProgress: (p: IndexBuildProgress) => void;
  /**
   * 构建器落盘入口。引擎**已经绑好 libRoot** ⇒ 主进程收到的是 `{ bytes }`，
   * 直接转 `writeIndexAtomically(libRoot, bytes)`（**唯一**原子写；引擎从不碰字节）。
   */
  writeIndex: (input: { bytes: Uint8Array }) => void;
}

/** 构建结果（引擎据此填 `index.done` 与 `indexStart`/`indexResume` 的返回） */
export interface IndexBuildSummary {
  /** 扫描到的条目总数 */
  total: number;
  /** 本次新编码的条数 */
  encoded: number;
  /** 编码失败的条数（>0 ⇒ `index.done.ok === false`） */
  failed: number;
  /** 复用（未重编码）的条数 —— 进返回**与事件**（卡片约束 5） */
  reused: number;
  dim: number;
  compat?: string;
  /** 失败明细（可选）：构建器知道就给，引擎**不编造**明细 */
  failedItems?: Array<{ relPath: string; stage: string; error: { code: string; message: string } }>;
}

export type IndexBuildFn = (req: IndexBuildRequest) => Promise<IndexBuildSummary>;

/** 主进程注入的**唯一**原子写（实现 = `index-file.writeIndexAtomically(libRoot, bytes)`） */
export type IndexWriteFn = (input: { libRoot: string; bytes: Uint8Array }) => void;

/** 两个注入端口。**不传 ⇒ 真实模式如实返回 INTERNAL「IDX-2b 未接线」**（与 IDX-2a 完全一致）。 */
export interface IndexingPorts {
  buildIndex: IndexBuildFn;
  writeIndex: IndexWriteFn;
}

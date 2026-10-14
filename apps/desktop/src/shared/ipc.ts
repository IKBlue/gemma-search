// src/shared/ipc.ts —— IPC 契约的唯一来源（docs/spec/SPEC-security.md §2.1）
//
// 一份 zod schema 同时给出三样东西：
//   ① 运行时参数校验  ② 允许的方法名白名单  ③ **编译期类型**（2026-10-13 起，T1）
// 主进程与渲染进程都用它 —— 这样"参数白名单校验"不是口号，而是唯一入口。
//
// 为什么是 `.ts` 而不是 `.mjs`（T1 决策，2026-10-13）：
//   契约是本项目的核心资产（**16 个登记方法** = 引擎 13 + 库配置 3；**20 个错误码**），此前**只有运行时 zod 校验、没有编译期类型**，
//   于是 `npx tsc --noEmit` 返回 0 错误**是假的**（两个 tsconfig 的 `checkJs` 都关着）。
//   转成 `.ts` 后该文件**总是**被类型检查（`.ts` 不受 `checkJs` 开关影响），门禁才有真实内容。
//   Node ≥23.6 原生支持类型剥离 ⇒ `node:test` 可直接 import 本文件，无需构建步骤（实测 v24.14.0 通过）。
import { z } from 'zod';

export const LibId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, '库 id 形状不合法');
export const Uid = z.string().regex(/^[0-9a-f]{12}$/, 'uid 形状不合法');
export const Size = z.union([z.literal(128), z.literal(256), z.literal(512)]);

/** 通道名（只开两个，见 SPEC-security §2） */
export const CH_INVOKE = 'engine:invoke';
export const CH_EVENT = 'engine:event';

/**
 * 方法白名单。**未登记的方法一律拒绝**（不落到 default 分支不管）。
 * 注意：没有任何方法接受"绝对路径"，唯一例外是 search.queryImagePath
 * （用户临时选的库外查询图，只读 + 扩展名白名单在引擎里）。
 */
export const Methods = {
  search: z.object({
    mode: z.enum(['text', 'image', 'vector']),
    text: z.string().max(200).optional(),
    imageRef: z.object({ libId: LibId, uid: Uid }).strict().optional(),
    queryImagePath: z.string().max(4096).optional(),
    vector: z.array(z.number()).max(4096).optional(),
    libIds: z.array(LibId).max(32).optional(),
    topK: z.number().int().min(1).max(200).optional(),
    filters: z.object({
      folders: z.array(z.string().max(64)).max(32).optional(),
      exts: z.array(z.string().max(16)).max(32).optional(),
    }).strict().optional(),
  }).strict(),

  item: z.object({ libId: LibId, uid: Uid }).strict(),

  /**
   * `itemPaths` —— 两条**绝对路径**（2026-10-13 新增，契约 §2.2a）。
   *
   * ⚠️ **为什么单独一个方法，而不是往 `item` 里加字段**（所有者决定）：
   *   把绝对路径混进 `item`，等于**每一次取元数据都顺带把库内路径交出去**；
   *   而 P3c（图片详情）确实要显示它们（`ROADMAP.md:221` / `UI-REVIEW-and-migration.md:235`）。
   *   ⇒ 给它一个**语义就是"要路径"**的只读方法，暴露面收在明处、可审计。
   *   引擎侧仍走完整的库根包含校验与符号链接校验。
   * 契约 §9.1：冻结后**新增**方法/字段 = 兼容。
   */
  itemPaths: z.object({ libId: LibId, uid: Uid }).strict(),

  indexStatus: z.object({}).strict(),

  scan: z.object({ libId: LibId }).strict(),

  reveal: z.object({ libId: LibId, uid: Uid, target: z.enum(['image', 'archive']).optional() }).strict(),

  collect: z.object({
    libId: LibId,
    uids: z.array(Uid).min(1).max(200),
    targetDirName: z.string().max(64).optional(),
  }).strict(),

  // 下述方法在引擎里尚未实现（P1 后续切片），这里先登记形状，
  // 引擎返回 UNSUPPORTED 之外仍会被 zod 拦住非法参数。
  ingest: z.object({
    libId: LibId,
    sourcePaths: z.array(z.string().max(4096)).min(1).max(200),
    destFolder: z.string().max(64),
  }).strict(),

  mutate: z.object({
    libId: LibId,
    /**
     * ⚠️ **`uid` 对 `undo` 是可选的**（2026-10-13 更正）。
     *
     * 契约 §2.7 的表里写得很清楚：`undo` 的语义是「**撤销指定事务**」—— 由 `params.txId` 定位，
     * `uid` 对这件事**没有意义**。而 schema 原先把它写死成必填 ⇒ 调用方只能瞎塞一个 uid，
     * 否则连"撤销"都发不出去（实测：操作记录页的回退被 `BAD_REQUEST` 拦掉，状态没变）。
     * 折中：`uid` 改为可选 + `superRefine` 保证**除 undo 外仍然必填**。
     * 这属于**放宽**（原先合法的调用照旧合法）⇒ 契约 §9.1 口径的兼容改动。
     */
    uid: Uid.optional(),
    op: z.enum(['rename', 'moveFolder', 'reattachArchive', 'moveOutOfLibrary', 'undo']),
    params: z.record(z.string(), z.unknown()).optional(),
  }).strict()
    .superRefine((v, ctx) => {
      if (v.op !== 'undo' && typeof v.uid !== 'string') {
        ctx.addIssue({ code: 'custom', message: '除 undo 外，mutate 必须带 uid（undo 由 params.txId 定位）' });
      }
    }),

  indexStart: z.object({
    libId: LibId,
    device: z.enum(['webgpu', 'cpu']).optional(),
    seq: z.number().int().min(70).max(280).optional(),
    rebuild: z.boolean().optional(),
  }).strict(),

  indexCancel: z.object({ jobId: z.string().max(64) }).strict(),

  /**
   * `indexResume` —— 续跑（2026-10-13 补登记）。
   *
   * ⚠️ **契约 §2.10 早就写了这个方法**（"`indexResume { jobId }` 复用已编码行，按 `compat` 判定"），
   *   但**这张白名单里一直漏了它** ⇒ 它此前会被当成"引擎无此方法"拒掉（`BAD_REQUEST`）。
   *   是"契约正文"与"契约 schema"之间的漂移。P3d 的「续跑」要用它，故补登记。
   */
  indexResume: z.object({ jobId: z.string().max(64) }).strict(),

  /**
   * `transactions` —— 事务台账（2026-10-13 新增，契约 §2.11）。
   *
   * 依据 `docs/spec/SPEC-transactions.md:229`：「界面据 id 查询状态、提供撤销入口」。
   * 一个方法同时支持"列最近 N 条"与"查某一条"（`txId` 可选）。
   * ⚠️ 与 `itemPaths` 同一条规矩：**单独一个只读方法**，而不是把事务塞进别的方法的返回里 ——
   *    暴露面收在明处、可审计。
   */
  transactions: z.object({
    libId: LibId.optional(),
    txId: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).strict(),

  // ---- 库配置（D2 修复：首启向导需要读/写"库从哪来"）----
  // 只读：返回解析结果 + 诊断 + 警告（库来自环境变量/注册表/config/索引自举 四条路哪一条）
  libraryConfig: z.object({}).strict(),

  // 首启向导：让用户**亲自**选一个目录（主进程弹系统对话框）。
  // 渲染层本就拿不到 `dialog`；这是它唯一的间接通道，且必须由用户点击触发。
  libraryPickDir: z.object({}).strict(),

  // 注册（或更新）一个库：写 userData 注册表并重建引擎。
  // **不接受任意路径之外的形状**：root 是用户选/拷进来的目录，存在性由主进程校验。
  libraryAdd: z.object({
    libId: LibId.optional(),          // 省略则主进程自动分配（L1、L2…）
    root: z.string().min(1).max(4096),
    label: z.string().max(64).optional(),
  }).strict(),
};

export const METHOD_NAMES = Object.freeze(Object.keys(Methods));

/** 单次调用的载荷上限（SPEC-security §2.1 第 5 条） */
export const MAX_PAYLOAD_BYTES = 1024 * 1024;

// ============================================================================
// 编译期类型（T1 新增）—— 这些是 `.ts` 化的**唯一实际收益**，别删
// ============================================================================

/** 登记在册的方法名。`'exec'` / `'__proto__'` 之类**在类型上就通不过**。 */
export type MethodName = keyof typeof Methods;

/** 某个方法的**请求参数类型**，由 zod schema 推导（单一事实来源，不另写一份）。 */
export type Req<K extends MethodName> = z.infer<(typeof Methods)[K]>;

/** 引擎/主进程返回的**成功信封**（`data` 形状由调用方按方法填）。 */
export type OkEnvelope<D = unknown> = { ok: true; data: D; warnings?: string[] };

/** 引擎/主进程返回的**失败信封**。`userMessage` 是给界面直接显示的文案。 */
export type ErrEnvelope = {
  ok: false;
  error: { code: string; message: string; userMessage: string; details?: unknown };
};

export type Envelope<D = unknown> = OkEnvelope<D> | ErrEnvelope;

/**
 * `validateCall` 的返回。
 *
 * ⚠️ `params` 在成功分支上是 `unknown` 而不是 `Req<K>` —— 这是**刻意的**：
 * `validateCall(method, params)` 的 `method` 在运行时才确定（来自 IPC 消息），
 * 静态上无法把 `method` 与 `params` 关联起来。**假装能关联就是在撒谎**。
 * 需要精确类型的地方，调用方请自己用 `Req<'search'>` 这样的具体类型标注（见 `main/index.mjs`）。
 */
export type ValidateCallResult =
  | { ok: true; method: MethodName; params: unknown }
  | { ok: false; reason: string };

/**
 * 校验一次调用。
 *
 * `method` 刻意收 `unknown`：它的真实来源是 IPC 消息，**可能是任何东西**（含原型键）。
 * 只有穿过 `hasOwnProperty` 检查之后才把它当 `MethodName` 用。
 */
export function validateCall(method: unknown, params: unknown): ValidateCallResult {
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(Methods, method)) {
    return { ok: false, reason: '未登记的方法' };
  }
  let bytes: number;
  try {
    // ⚠️ 刻意**不用 Buffer**：本文件是主进程与渲染进程共用的契约，而渲染层没有 Node 全局
    //    （tsconfig.web.json 的 lib 只有 DOM）。TextEncoder 两边都有，UTF-8 字节数与 Buffer.byteLength 等价。
    bytes = new TextEncoder().encode(JSON.stringify(params ?? {})).length;
  } catch {
    return { ok: false, reason: '参数无法序列化' };
  }
  if (bytes > MAX_PAYLOAD_BYTES) return { ok: false, reason: `载荷过大（${bytes} 字节）` };

  // 上面已确认是自有键 ⇒ 这里的窄化是安全的（不是 `any`，是具体的 `MethodName`）
  const name = method as MethodName;
  const schema: z.ZodType = Methods[name];
  const r = schema.safeParse(params ?? {});
  if (!r.success) {
    return {
      ok: false,
      reason: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, method: name, params: r.data };
}

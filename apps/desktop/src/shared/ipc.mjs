// src/shared/ipc.mjs —— IPC 契约的唯一来源（docs/spec/SPEC-security.md §2.1）
//
// 一份 zod schema 同时给出：① 运行时参数校验 ② 允许的方法名白名单。
// 主进程与渲染进程都用它 —— 这样"参数白名单校验"不是口号，而是唯一入口。
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
    libId: LibId, uid: Uid,
    op: z.enum(['rename', 'moveFolder', 'reattachArchive', 'moveOutOfLibrary', 'undo']),
    params: z.record(z.string(), z.unknown()).optional(),
  }).strict(),

  indexStart: z.object({
    libId: LibId,
    device: z.enum(['webgpu', 'cpu']).optional(),
    seq: z.number().int().min(70).max(280).optional(),
    rebuild: z.boolean().optional(),
  }).strict(),

  indexCancel: z.object({ jobId: z.string().max(64) }).strict(),

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

/**
 * 校验一次调用。
 * @returns {{ok:true, method:string, params:object} | {ok:false, reason:string}}
 */
export function validateCall(method, params) {
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(Methods, method)) {
    return { ok: false, reason: '未登记的方法' };
  }
  try {
    const bytes = Buffer.byteLength(JSON.stringify(params ?? {}), 'utf8');
    if (bytes > MAX_PAYLOAD_BYTES) return { ok: false, reason: `载荷过大（${bytes} 字节）` };
  } catch {
    return { ok: false, reason: '参数无法序列化' };
  }
  const r = Methods[method].safeParse(params ?? {});
  if (!r.success) {
    return { ok: false, reason: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }
  return { ok: true, method, params: r.data };
}

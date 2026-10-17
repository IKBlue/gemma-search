// src/shared/ipc.ts —— IPC 契约的唯一来源（SPEC.md §5.1 方法表）
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

/** 通道名（只开两个，见 `SPEC.md` §5.1） */
export const CH_INVOKE = 'engine:invoke';
export const CH_EVENT = 'engine:event';

/**
 * 方法白名单。**未登记的方法一律拒绝**（不落到 default 分支不管）。
 *
 * ⚠️ 路径口径（SEC-1 · 2026-10-16 修正 —— 旧注释写「没有任何方法接受绝对路径，唯一例外是
 *    search.queryImagePath」是**与实现不符的声明**，别再照抄）：
 *   绝大多数方法**不接受任何绝对路径** —— 要定位东西就给 `libId`/`uid`，路径由主进程自己算。
 *   但**确有三处例外**：
 *     · `search.queryImagePath` —— 用户临时选的库外查询图（只读 + 引擎侧扩展名白名单）；
 *     · `libraryAdd.root`       —— 必须是 `libraryPickDir` **刚返回**的那个目录（主进程对账）；
 *     · `collectDirAdd.absPath` —— 取件白名单目录；**目前没有对应选择器**，只校验「存在且是目录」。
 *   纵深防御（第一道 = isTrustedSender + 严格 CSP + 无远程内容 + 这里的 zod `.strict()` 形状）：
 *     · `libraryAdd`：主进程 `main/dialog-paths.ts` 的闸门要求 root ∈ **本次会话由对话框返回过的**集合
 *       ⇒ **存在且是目录也不够**：凭空造的路径（哪怕它真的存在）一律 BAD_REQUEST；
 *     · `collectDirAdd`：没有选择器 ⇒ 只能退到「存在且是目录」（**已知缺口**，写在那里，不假装防住）。
 */
export const Methods = {
  search: z
    .object({
      mode: z.enum(['text', 'image', 'vector']),
      text: z.string().max(200).optional(),
      imageRef: z.object({ libId: LibId, uid: Uid }).strict().optional(),
      queryImagePath: z.string().max(4096).optional(),
      vector: z.array(z.number()).max(4096).optional(),
      libIds: z.array(LibId).max(32).optional(),
      topK: z.number().int().min(1).max(200).optional(),
      filters: z
        .object({
          folders: z.array(z.string().max(64)).max(32).optional(),
          exts: z.array(z.string().max(16)).max(32).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),

  item: z.object({ libId: LibId, uid: Uid }).strict(),

  /**
   * `itemPaths` —— 两条**绝对路径**（2026-10-13 新增，契约 §2.2a）。
   *
   * ⚠️ **为什么单独一个方法，而不是往 `item` 里加字段**（所有者决定）：
   *   把绝对路径混进 `item`，等于**每一次取元数据都顺带把库内路径交出去**；
   *   而 P3c（图片详情）确实要显示它们（`TASKS.md` §1（P3c） / `SPEC.md` §4）。
   *   ⇒ 给它一个**语义就是"要路径"**的只读方法，暴露面收在明处、可审计。
   *   引擎侧仍走完整的库根包含校验与符号链接校验。
   * 契约 §9.1：冻结后**新增**方法/字段 = 兼容。
   */
  itemPaths: z.object({ libId: LibId, uid: Uid }).strict(),

  /**
   * `items` —— **只读列表**（F2「逛整库」的读路径；2026-10-15 · S8 · SPEC §5.1，属兼容新增）。
   *
   * 为什么需要它：`scan` 只给**差异**（new/missing/changed）、`search` 空查询直接 BAD_REQUEST、
   *   `item` 只读一条 ⇒ 现有方法里**没有**一条能把整库列出来。
   *
   * · **只读**：不触发扫描、不进向量、**不写任何表**（实现见 main/items-ipc.ts）；
   * · `total` = **筛选后**总数，**越界也如实给**（不是 rows.length —— 越界时 rows 为空、total 照旧）；
   * · 返回里还带 `facets`（按**全库**统计的分类/扩展名，**不受筛选影响**），界面下拉据此生成，
   *   不许从当前页样本推导（会漏值、且随分页跳动）。
   * · **路径不进契约**：行里只有相对路径；要绝对路径走 `itemPaths`（那条方法的语义就是要路径）。
   */
  items: z
    .object({
      libId: LibId,
      folder: z.string().max(64).optional(),
      ext: z.string().max(16).optional(),
      hasArchive: z.boolean().optional(),
      /**
       * 排序键（**12 项**）：relPath(默认) · folder · stem · imageMtime · imageSize · archiveSize，
       * 每个都能加前缀 - 表示倒序（如 -imageSize = 按体积从大到小）。
       * ⚠️ **NULL 位次**：imageSize/archiveSize 来自 LEFT JOIN，**无包条目的 archiveSize 是 NULL**（不是 0）。
       *    实现按 SQLite 默认语义：**正序 NULL 排最前，倒序 NULL 排最后** ⇒ -archiveSize 把无包条目放末尾。
       */
      sort: z
        .enum([
          'relPath',
          'folder',
          'stem',
          'imageMtime',
          'imageSize',
          'archiveSize',
          '-relPath',
          '-folder',
          '-stem',
          '-imageMtime',
          '-imageSize',
          '-archiveSize',
        ])
        .optional(),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .strict(),

  indexStatus: z.object({}).strict(),

  scan: z.object({ libId: LibId }).strict(),

  reveal: z
    .object({ libId: LibId, uid: Uid, target: z.enum(['image', 'archive']).optional() })
    .strict(),

  collect: z
    .object({
      libId: LibId,
      uids: z.array(Uid).min(1).max(200),
      targetDirName: z.string().max(64).optional(),
    })
    .strict(),

  // ⚠️⚠️ 2026-10-15 · S6（所有者批准的设计基线 §2.2）：**6 个诚实桩已删除** ——
  //   ingest / mutate / transactions / indexStart / indexCancel / indexResume。
  //   绿地口径：契约**只暴露 6 张表支持得了的方法**；这 6 个对应的表（意图层标注表 · job 表）还没建，
  //   继续挂着就是「看起来能用」的假承诺。等表上线时**重新登记**（新增方法 = 兼容改动，§9.1）。
  //   ⚠️ 引擎侧那 6 个桩**保留**（packages/engine/src/engine.ts 的 UNIMPLEMENTED_METHODS）：
  //      它们是引擎自己的诚实桩；白名单删掉后**自然不可达**，删它们只会牵动 fake.ts 与 e2e，收益为零。
  //
  // ✅ 2026-10-17 · U35（所有者「批」）：**三个索引任务方法恢复登记**（indexStart / indexCancel / indexResume）。
  //   形状**照引擎 fake.ts 已实现的** StartJobRequest / StartJobResult / FakeJobRequest，不新造第二套
  //   （IDX-2b 接线真实实现时形状不用再改）。ingest / mutate / transactions **仍不在契约里**。
  //   ⚠️ 真实模式目前**没有**实现 ⇒ 引擎如实返回 INTERNAL，message 说明「IDX-2b 接入」，绝不静默成功（P6）。
  //      钉住位置：packages/engine/tests/fake.test.mjs F17 · e2e fake-mode.spec.mjs E8-d / E8-f。
  indexStart: z
    .object({
      libId: LibId.optional(),
      device: z.string().max(64).optional(),
      seq: z.number().int().min(0).max(1_000_000).optional(),
      rebuild: z.boolean().optional(),
    })
    .strict(),

  /** 取消一个索引任务（jobId 省略 = 取消当前那个 —— 与 fake.ts 的 FakeJobRequest 一致） */
  indexCancel: z.object({ jobId: z.string().min(1).max(64).optional() }).strict(),

  /** 续跑（能否复用由引擎按 compat 判定，不在契约层） */
  indexResume: z.object({ jobId: z.string().min(1).max(64).optional() }).strict(),

  // ---- 库：读（library_registry + 发现来源）与写（library_registry 是唯一写入口）----
  // 基线 §2.2：`libraryConfig` → **`libraryList`**（改名，不留两套）。
  // 载荷保留原有形状（libraries / chosen / warnings / diagnostics / registryPath）——
  // 那些是**发现诊断**，不是表；界面（LibraryGate / 首启向导）已经依赖它们。
  libraryList: z.object({}).strict(),

  // 首启向导：让用户**亲自**选一个目录（主进程弹系统对话框）。
  // 渲染层本就拿不到 `dialog`；这是它唯一的间接通道，且必须由用户点击触发。
  libraryPickDir: z.object({}).strict(),

  // 注册（或更新）一个库：写 app.db 的 library_registry 并重建引擎。
  // ⚠️ `root` 是**绝对路径**（三处例外之一，见文件头）：它必须来自 `libraryPickDir` 的结果。
  //    主进程两道判据：**来源对账**（main/dialog-paths.ts）+ **可用性**（main/library-availability.ts）。
  //    既不是「选了就行」（还要存在/可访问），也不是「存在就行」（还要真的是选出来的）。
  libraryAdd: z
    .object({
      libId: LibId.optional(), // 省略则主进程自动分配（L1、L2…）
      root: z.string().min(1).max(4096),
      label: z.string().max(64).optional(),
    })
    .strict(),

  /**
   * `libraryHealth` / `libraryRebuild` —— **2026-10-15 所有者批准新增**（SPEC §5 契约表）。
   *
   * · 体检（只读）：返回**结构化**健康结论（每项 ok + 错误码 + 人话理由），不抛；
   * · 重建元数据：删 `.gs.db` 家族并从 `items.json` 重新导入，**不得碰素材**，返回重建报告（含 before/after）。
   *
   * ⚠️ 为什么走 IPC 而不让渲染层自己算：体检要读 `.gs-index.bin`（引擎五道校验）与只读打开 `.gs.db`；
   *    重建要删/建文件 —— 都是**主进程的活**（渲染层拿不到 fs，也不该拿）。
   * ⚠️ 参数只有 `libId`：**本方法**的路径一律不进契约（由主进程用 T-04 的落点解析），
   *    与 item/scan 同一条规矩。（别写成「渲染进程传不进任何绝对路径」—— 契约里确有三处例外，
   *    见文件头；这里说的是**这两个方法**不受任何路径影响。）
   * ⚠️ `.strict()`：多传字段一律拒。契约 §9.1 说"新增方法/字段=兼容"，但**多传**不是兼容。
   * ⚠️ 本方法**不发事件**（只批了这两个方法）：重建期间的"正在重建元数据"由 UI 忙碌态满足（SPEC §2.3）。
   */
  libraryHealth: z.object({ libId: LibId }).strict(),

  libraryRebuild: z.object({ libId: LibId }).strict(),

  // ---- 基线 §2.2 新增：库注册表的写入口（唯一写 library_registry 的就是这 4 个 + libraryAdd）----
  // ⚠️ 库里只存**规范化后的 root**（大小写/短名/尾分隔符）—— 规范化在 main/app-db.ts，见那里的注释。
  /** 停用/启用：**不动任何文件**（停用 ≠ 删除）；enabled=0 的库不参与检索与入库 */
  librarySetEnabled: z.object({ libId: LibId, enabled: z.boolean() }).strict(),

  /** 排序：sort_order 越小越靠前（列表与检索顺序都读它） */
  libraryReorder: z
    .object({ libId: LibId, sortOrder: z.number().int().min(0).max(100000) })
    .strict(),

  /**
   * 取消登记（**默认只取消登记，不删任何文件**）；`deleteDb: true` 才删库内的 `.gs-*`。
   * ⚠️ 删库是破坏性操作 ⇒ 两段式（请求 → 确认）由界面负责，主进程只按这个显式开关执行；
   *    **任何情况下都不碰素材**（素材只有用户自己能动）。
   */
  libraryRemove: z.object({ libId: LibId, deleteDb: z.boolean().optional() }).strict(),

  // ---- 基线 §2.2 新增：取件白名单（应用级 collect_dir，唯一写入口就是这 3 个）----
  /** 白名单（含 is_default）；空数组是**合法**的（那表示「还没有允许的目录」，不是错误） */
  collectDirs: z.object({}).strict(),

  /**
   * ⚠️ `absPath` 是**绝对路径**（三处例外之一，见文件头）。契约里**没有**取件目录选择器
   * ⇒ 主进程只能校验「存在且是目录」（`main/dialog-paths.ts` 的 checkCollectDir，缺口写在那里）。
   * 将来加选择器时：把它的返回值喂进同一个闸门，再把这条注释与那里的缺口一起删。
   */
  collectDirAdd: z
    .object({
      absPath: z.string().min(1).max(4096),
      label: z.string().min(1).max(64),
      makeDefault: z.boolean().optional(),
    })
    .strict(),

  collectDirRemove: z.object({ dirId: z.string().min(1).max(128) }).strict(),

  collectDirSetDefault: z.object({ dirId: z.string().min(1).max(128) }).strict(),

  // ---- 基线 §2.2 新增：应用级账本（app_meta）—— **只读**；写它的只有迁移 ----
  appMeta: z.object({}).strict(),

  // ---- U27（2026-10-16 · SPEC §6 第 22 个方法）：应用自身健康（进程内事实）—— **只读** ----
  /**
   * `appHealth` —— 把「本次进程出现过未处理异常」这件**只活在主进程里**的事接到界面上。
   *
   * · **只读**：不改任何状态，可以随便查（界面只在启动 + 打开诊断面板时各查一次）；
   * · **恒成功**：不返回 `ok:false` —— 「查不到事实」本身就是一条事实（`unhealthy:false`）；
   * · **不含** `sessionExit` / **不持久化**「上次崩溃」：不写 `app_meta`（那会留下一个下次启动必然
   *   过期的假标记）。「上个会话异常退出」由**日志**说明，界面只给「打开日志」入口（宁可不显示，也不猜）；
   * · 数据**只来自** `main/crash-policy.ts` 的同一份进程内状态（不产生第二份真相）；
   * · 载荷**不含**路径 / 用户名 / 堆栈正文（摘要清洗在 `main/app-health.ts`），也**不上报**。
   */
  appHealth: z.object({}).strict(),
};

export const METHOD_NAMES = Object.freeze(Object.keys(Methods));

/** 单次调用的载荷上限（`SPEC.md` §5.1 第 5 条） */
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
  { ok: true; method: MethodName; params: unknown } | { ok: false; reason: string };

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

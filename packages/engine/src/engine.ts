// packages/engine/src/engine.ts —— 引擎主体：传输无关、依赖注入
//
// 设计要点（都是为了"可测 + 可换"）：
//   · **依赖全部注入**：库注册表、编码器、时钟、事件回调。本包因此零依赖，
//     测试里注入假编码器即可跑全部逻辑，不需要模型、不需要 GPU。
//   · **不 import electron / http**（契约 §0 的可执行判据）。
//   · 索引按库懒加载并缓存；`compat` 决定哪些库能一起检索（§6）。
//   · 所有方法返回契约 §1.1 的信封，**永不抛异常给调用方**。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ERR, fail, ok, envelope, messageOf } from './errors.ts';
import { readIndexBin, readItems, readMeta, relOf } from './index.ts';
import { compatComplete, compatEqual, compatKey, compatReason } from './compat.ts';
import { LibraryRegistry, resolveInLibrary, resolveQueryImage } from './library.ts';
import { fingerprintV1 } from './fingerprint.ts';
import { createFakeKit } from './fake.ts';
import { isReservedLibraryName } from './gs-names.ts';
import type { EngineEntry, IndexBin, IndexItem } from './index.ts';
import type { StoragePorts } from './storage-ports.ts';
// 旧布局索引文件名（**唯一来源**；本文件不另抄一个 'index.bin' 字面量）
import { LEGACY_INDEX_FILENAME } from './index-layout.ts';
import type { RegistryConfig } from './library.ts';
import type { FakeKit, FakeModeOptions, SampleIndex } from './fake.ts';

/**
 * 分数区间：**按模态分别定义**。
 * 契约 §2.1 明确：分数不可跨模态比大小，所以界面只能用引擎给的 band，
 * 不许自己拿"文本 0.78"和"图像 0.90"排序。
 *
 * ⚠️ 这些阈值是**暂定**的（依据 spike 实测：图像自检索 ~1.0、文本→图像 top-1 0.74–0.80），
 *    需要按 SPEC-acceptance 的流程在真实查询集上复核后再冻结。
 *
 * 类型写成 `Record<string, …>` 是因为 `mode` 是**运行期字符串**：真正的存在性检查是
 * `Object.hasOwn`（见 `bandOf` 的注释 —— 原型键会骗过 `if (!b)`）。
 */
export const BANDS: Readonly<Record<string, { high: number; mid: number }>> = Object.freeze({
  text: { high: 0.72, mid: 0.65 },
  image: { high: 0.9, mid: 0.8 },
});

/**
 * **尚未实现的方法（全仓唯一一份定义，2026-10-13 新增）。**
 *
 * 这些方法的**请求/响应形状已在契约里冻结**，但真实实现还没接线。
 * 两处都要用它，所以**必须**从这里读，不许各抄一份（P1）：
 *   ① 引擎自己：真实模式下如实返回 `ERR.INTERNAL`（**绝不假装成功**）；
 *   ② 主进程（`apps/desktop/src/main/index.mjs`）：在进引擎**之前**就拒绝，
 *      以便给出更明确的用户文案「这个功能还没做好。」。
 *
 * 模拟模式（契约 §8）下这些方法由 `fake.ts` 提供假实现 —— 那时主进程**不**拒绝。
 * 假套件返回对象的键**与这份清单一一对应**（`fake.test.mjs` 的 **F17** 会断言），
 * 所以引擎侧只要 `fakeKit[name]`，不需要另维护映射表。
 */
export const UNIMPLEMENTED_METHODS = Object.freeze([
  'ingest',
  'mutate',
  'transactions',
  'indexStart',
  'indexCancel',
  'indexResume',
]);

/** 从捕获到的异常里取 `code`（引擎抛的 EngineError 与 node 的 fs 错误都带它） */
function codeOf(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const c = (e as { code: unknown }).code;
  return typeof c === 'string' ? c : undefined;
}

/**
 * 运行期确认"这是假套件里的一个方法"。
 * 需要它是因为 `fakeKit[name]` 走的是**动态方法名** ⇒ 索引签名只能给出 unknown，
 * 而类型断言会把"套件里少接了一个方法"这种真问题藏起来（契约 §8 的演示能力会缺一块）。
 */
function isFakeMethod(v: unknown): v is (req: unknown) => unknown {
  return typeof v === 'function';
}

/**
 * 把一个分数映射到档位。
 *
 * ⚠️ **界面绝不能用自己算的阈值** —— 档位必须来自这里（见 `BANDS` 头注释与 F-02）。
 */
export function bandOf(score: number, mode: string): string {
  // ⚠️ 必须用 `Object.hasOwn`，**不能**写 `const b = BANDS[mode]; if (!b)`。
  // 后者会让**原型键**蒙混过关：`BANDS['toString']` 取到的是 `Object.prototype.toString`（真值！），
  // 于是 `bandOf(0.85,'toString')` ⇒ `b.high` 为 undefined ⇒ 返回 `'low'` ——
  // **又替一个不认识的模态编了档位**，与 R-3 同根因。测试用例集若只列 'vector'/'hybrid'
  // 这类普通字符串，会恰好绕开全部原型键（独立复核实测 I-5）。
  if (!Object.hasOwn(BANDS, mode)) return 'unknown';
  const b = BANDS[mode];
  if (score >= b.high) return 'high';
  if (score >= b.mid) return 'mid';
  return 'low';
}

/** L2 归一化。索引里的行已是 L2（SPEC-identity §6.2 `normalization:"l2"`），点积即余弦。 */
export function l2norm(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!(n > 0)) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** 索引在应用数据目录下的位置：<dataDir>/libraries/<libId>/ */
export function indexPathFor(dataDir: string, libId: string): string {
  return path.join(dataDir, 'libraries', libId);
}

/** 取件配置（config.collect）：**按名字**给目录，不按路径（见 resolveCollectDir 注释） */
export interface CollectConfig {
  dirs?: Record<string, string>;
  default?: string;
  [key: string]: unknown;
}

/**
 * 取件目标目录：**按名字配置**，不是按路径传。
 *
 * 契约 §2.5 的入参是 `targetDirName`（名字），这里把它解析成真实目录。
 * 这样白名单是**结构性**的 —— 渲染进程连"传一个白名单外的路径"都做不到，
 * 只能传一个已配置的名字。比"传路径再校验"更不容易出错。
 */
export function resolveCollectDir(
  targetDirName: string | null | undefined,
  collectCfg: CollectConfig | null | undefined,
): { name: string; dir: string } {
  const dirs: Record<string, string> = (collectCfg && collectCfg.dirs) || {};
  const name = targetDirName || (collectCfg && collectCfg.default) || Object.keys(dirs)[0];
  const dir = name ? dirs[name] : undefined;
  // `!name` 是 `!dir` 的蕴含条件（name 为空 ⇒ dirs[name] 必为空）—— 写出来只是为了让 TS 收窄，
  // 不改变任何运行期分支：两者都走同一个 throw。
  if (!name || !dir) {
    throw fail(
      ERR.COLLECT_DIR_NOT_ALLOWED,
      `取件目标不在允许列表：${targetDirName || '(未指定)'}`,
      { name: targetDirName || null, allowed: Object.keys(dirs) },
    );
  }
  return { name, dir: path.resolve(dir) };
}

/** 取件时复制哪一份：有包取包，无包取图（契约 §2.5 的 auto 语义）。 */
export function pickCollectSource(
  item: IndexItem,
  target = 'auto',
): { rel: string | null; kind: string } {
  const rel = relOf(item);
  const arc = item.archiveRelPath || null;
  if (target === 'archive') {
    if (!arc) throw fail(ERR.ITEM_MISSING_ON_DISK, `该素材没有同名包：${rel}`, { rel });
    return { rel: arc, kind: 'archive' };
  }
  if (target === 'image') return { rel, kind: 'image' };
  return arc ? { rel: arc, kind: 'archive' } : { rel, kind: 'image' };
}

/** 编码器端口（注入）：引擎只声明形状，不 import 任何 ONNX/transformers 实现 */
export interface EncoderPort {
  encodeText(text: string): Float32Array | Promise<Float32Array>;
  encodeImage(absPath: string): Float32Array | Promise<Float32Array>;
}

/** 外壳端口（P2 注入）：Electron 的 shell.showItemInFolder */
export interface ShellPort {
  reveal(absPath: string): void;
}

/** config.json 与引擎有关的部分（**外部 JSON**：字段可能缺失） */
export interface EngineConfig extends RegistryConfig {
  data_dir?: string;
  collect?: CollectConfig;
}

/** createEngine() 的入参 */
export interface EngineOptions {
  config?: EngineConfig;
  encoder?: EncoderPort | null;
  /** 索引根；缺省 <config.data_dir>/libraries */
  indexDir?: string | null;
  onEvent?: (ev: unknown) => void;
  now?: () => number;
  shell?: ShellPort | null;
  /** ⭐ 契约 §8 的模拟模式：无模型、无真实库。见 fake.ts 头注释 */
  fake?: boolean | FakeModeOptions;
  /**
   * 存储端口（T-16a）：**不传就完全走旧布局**
   * （`<dataDir>/libraries/<libId>/{index.bin,items.json,meta.json}`）。
   * 传了哪一项，哪一路就改走端口；三项互相独立。
   */
  storage?: StoragePorts | null;
}

/**
 * 引擎用到的注册表形状。**结构性**的：
 * `LibraryRegistry`（真实）与 `fake.ts` 的最小实现都满足它 ⇒ 引擎不必为模拟模式开第二条代码路径。
 */
export interface EngineRegistry {
  list(): Array<{ libId: string; label?: string; root: string }>;
  has(libId: string): boolean;
  get(libId: string): { libId: string; label?: string; root: string };
  requireExistingRoot(libId: string): void;
}

/** 长任务登记的形状（`api._jobs`；真实编码在 indexStart 实现） */
export interface JobState {
  kind: string;
  libId: string;
  cancelled: boolean;
}

/** 检索请求（契约 §2.1） */
export interface ImageRef {
  libId?: string;
  uid?: string;
}
export interface SearchFilters {
  folders?: string[];
  exts?: string[];
}
export interface SearchRequest {
  mode?: string;
  topK?: number;
  text?: string;
  queryImagePath?: string;
  imageRef?: ImageRef;
  vector?: ArrayLike<number>;
  libIds?: string[];
  filters?: SearchFilters;
}

/** 单条 / 两条路径的请求 */
export interface ItemRequest {
  libId?: string;
  uid?: string;
}
/** 扫描请求 */
export interface ScanRequest {
  libId?: string;
}
/** 取件请求 */
export interface CollectRequest {
  libId?: string;
  uids?: string[];
  targetDirName?: string;
  target?: string;
}
/** reveal 请求 */
export interface RevealRequest {
  libId?: string;
  uid?: string;
  target?: string;
}

export function createEngine({
  config = {},
  encoder = null, // { encodeText(text) -> Float32Array, encodeImage(absPath) -> Float32Array }
  indexDir = null, // 索引根；缺省 <config.data_dir>/libraries
  onEvent = () => {},
  now = () => Date.now(),
  shell = null, // { reveal(absPath) } —— P2 注入（Electron shell.showItemInFolder）
  fake = false, // ⭐ 契约 §8 的模拟模式：无模型、无真实库。见 fake.ts 头注释
  storage = null, // 存储端口（T-16a）：不传 ⇒ 旧布局，行为与改造前逐字一致
}: EngineOptions = {}) {
  // ── 模拟模式（契约 §8）────────────────────────────────────────────────
  // `fake: true` ⇒ 用 fixtures/sample-index.json 造一个**零真实文件系统**的库；
  // `fake: { fixture }` ⇒ 直接注入样例对象（测试用，不依赖路径解析）。
  // ⚠️ 真实模式（默认 `false`）**一行都不走这里**。
  const fakeObj: FakeModeOptions | null = fake && typeof fake === 'object' ? fake : null;
  const fakeKit: FakeKit | null = fake
    ? createFakeKit({
        fixture: (fakeObj?.fixture ?? null) as SampleIndex | null,
        onEvent,
        now,
        bandOf, // ⚠️ bandOf 注入 —— 不在这里重算档位阈值（见 fake.ts 头注释 ③）
        intervalMs: fakeObj ? (fakeObj.intervalMs ?? null) : null,
        setTimer: fakeObj?.setTimer,
        clearTimer: fakeObj?.clearTimer,
      })
    : null;

  // ── 存储端口（T-16a）──────────────────────────────────────────────────
  // 传了哪一项，哪一路就改走端口；三项互相独立；都不传 ⇒ 与改造前**逐字一致**（旧布局）。
  const itemStore = storage?.items ?? null;
  const indexPort = storage?.index ?? null;
  const resolver = storage?.libraries ?? null;
  /**
   * 旧布局从 `meta.json` 读"失败项台账"；新布局里它**不在这三个端口里**（属 T-16b/T-33）。
   * ⇒ 端口接管后该字段报 `null`（**未知**），不许用 0 假装"没有失败项"（那正是假绿）。
   */
  const metaFromFile = itemStore === null && indexPort === null;

  const registry: EngineRegistry = fakeKit
    ? fakeKit.registry
    : (resolver ?? new LibraryRegistry(config));
  const idxRoot =
    indexDir || path.join(config.data_dir || path.join(process.cwd(), 'data'), 'libraries');
  const cache = new Map<string, EngineEntry>(); // libId -> { header, items, vectors, meta, byUid, rowToRel }
  const jobs = new Map<string, JobState>(); // jobId -> { kind, libId, cancelled }

  function dirOf(libId: string): string {
    return path.join(idxRoot, libId);
  }

  /** 懒加载并缓存某库索引；任何损坏都抛 INDEX_*（由 envelope 转信封）。 */
  function load(libId: string, { reload = false }: { reload?: boolean } = {}): EngineEntry {
    // 模拟模式：索引来自内存，**不 requireExistingRoot、不读任何文件**（见 fake.ts 头注释 ①）
    if (fakeKit) return fakeKit.load(libId);
    const cached = cache.get(libId);
    if (!reload && cached) return cached;
    registry.requireExistingRoot(libId);
    const legacyDir = dirOf(libId); // 旧布局：索引/条目/meta 都在这里
    const layout = resolver ? resolver.storageOf(libId) : null; // 新布局：`.gs-*` 在**库根**
    // ② 向量索引：端口优先（`<库根>/.gs-index.bin`，实现里走引擎五道校验）；否则旧布局 index.bin
    // ⚠️ 无端口时**只**走旧布局（T-16a 的「不注入 ⇒ 与改造前逐字一致」）；有端口时落点由端口决定，
    //    而端口的落点判据就是 index-layout.ts 的 resolveIndexLocation（新布局 → 旧布局回退）。
    const bin: IndexBin = indexPort
      ? indexPort.readIndex(libId)
      : readIndexBin(path.join(legacyDir, LEGACY_INDEX_FILENAME));
    // ① 条目：端口优先（T-11 的 `.gs.db`）；否则旧布局 items.json
    const items: IndexItem[] = itemStore
      ? itemStore.listItems(libId)
      : readItems(path.join(legacyDir, 'items.json'));
    // meta：旧布局读 meta.json；新布局里元数据在 `.gs.db`（不在这三个端口里）⇒ 空对象、上层报"未知"
    const meta = metaFromFile ? readMeta(path.join(legacyDir, 'meta.json')) : {};
    const { header, vectors, count, dim } = bin;
    const byUid = new Map<string, IndexItem>();
    const rowToRel = new Map<number, unknown>();
    for (const it of items) {
      const rel = relOf(it);
      // 条目缺 uid 本不该发生（uid 是索引主键，SPEC-identity §2）；原 JS 会把 undefined 当键塞进去，
      // 这里落成空串 —— 两种都**取不到**任何真实 uid，语义等价。
      byUid.set(it.uid ?? '', it);
      if (it.vectorRow != null) rowToRel.set(it.vectorRow, rel);
    }
    // `dir`：新布局下就是**库根**（`.gs-*` 与素材同处）；旧布局下是索引目录（保持原语义）
    const entry: EngineEntry = {
      libId,
      dir: layout ? layout.root : legacyDir,
      header,
      vectors,
      count,
      dim,
      items,
      meta,
      byUid,
      rowToRel,
    };
    cache.set(libId, entry);
    return entry;
  }

  /**
   * 取一条条目（api.item / itemPaths / reveal / collect / search(image) 共用）。
   *
   * **先 load() 再查**：这样「索引缺失/损坏 ⇒ INDEX_*」的既有语义在**两条路**上都成立（行为等价）。
   * 注入条目端口时以**端口**为准 —— T-11 的 `.gs.db` 才是条目真相来源。
   */
  function itemOf(libId: string, uid: string): IndexItem | null {
    const e = load(libId);
    if (itemStore) return itemStore.getItem(libId, uid) ?? null;
    return e.byUid.get(uid) ?? null;
  }

  /** 兼容性基准：以第一个请求的库为准；其余不等的库进 skipped 并附结构化原因。 */
  function pickCompatible(libIds?: string[]): {
    loaded: EngineEntry[];
    skipped: Array<{ libId: string; reason: unknown }>;
    base: EngineEntry | null;
  } {
    const ids = libIds && libIds.length ? libIds : registry.list().map((l) => l.libId);
    const loaded: EngineEntry[] = [];
    const skipped: Array<{ libId: string; reason: unknown }> = [];
    let base: EngineEntry | null = null;
    for (const id of ids) {
      let e: EngineEntry;
      try {
        e = load(id);
      } catch (err) {
        skipped.push({
          libId: id,
          reason: {
            kind: 'unavailable',
            code: codeOf(err),
            userMessage: undefined,
            detail: messageOf(err),
          },
        });
        continue;
      }
      if (!compatComplete(e.header)) {
        skipped.push({
          libId: id,
          reason: {
            kind: 'compat-incomplete',
            missing: ['model_repo'],
            userMessage: '这个库的索引元数据不完整。',
          },
        });
        continue;
      }
      if (base === null) {
        base = e;
        loaded.push(e);
        continue;
      }
      if (compatEqual(base.header, e.header)) loaded.push(e);
      else
        skipped.push({
          libId: id,
          reason: compatReason(base.header, e.header, registry.get(id).label),
        });
    }
    return { loaded, skipped, base };
  }

  async function doSearch(req: SearchRequest = {}) {
    const mode = req.mode || 'text';
    const topK = Math.max(1, Math.min(200, Number(req.topK) || 50));
    if (!encoder) throw fail(ERR.MODEL_MISSING, '引擎未注入编码器');

    const t0 = now();
    // ---- 查询向量 ----
    let qvec: Float32Array | undefined;
    if (mode === 'text') {
      const text = String(req.text || '').trim();
      if (!text) throw fail(ERR.BAD_REQUEST, '查询文本为空');
      qvec = await encoder.encodeText(text);
    } else if (mode === 'image') {
      // 两种来源：库内条目（libId+uid）或用户临时挑的库外图（queryImagePath，唯一例外）
      let abs: string | undefined;
      const ref = req.imageRef;
      if (req.queryImagePath) {
        abs = resolveQueryImage(req.queryImagePath);
      } else if (ref && ref.libId && ref.uid) {
        const libId = ref.libId;
        const uid = ref.uid;
        const it = itemOf(libId, uid);
        if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`);
        abs = resolveInLibrary(registry.get(libId).root, relOf(it));
      } else if (req.vector) {
        qvec = Float32Array.from(req.vector);
      } else {
        throw fail(ERR.BAD_REQUEST, '图像查询需要 imageRef / queryImagePath / vector 之一');
      }
      if (!qvec) {
        // 走完上面三个分支后 abs 必然已被赋值的那个分支排除掉了 —— 显式写出来只是让类型收窄。
        if (abs === undefined) throw fail(ERR.INTERNAL, '图像查询没有解析出可用的图片路径');
        qvec = await encoder.encodeImage(abs);
      }
    } else if (mode === 'vector') {
      if (!req.vector) throw fail(ERR.BAD_REQUEST, 'vector 模式需要 vector');
      qvec = Float32Array.from(req.vector);
    } else {
      throw fail(ERR.BAD_REQUEST, `未知 mode：${mode}`);
    }
    if (!qvec || !qvec.length) throw fail(ERR.INTERNAL, '查询向量为空');

    // 查询向量**统一归一到 L2**：索引行已是 L2，两边都归一后点积就是余弦。
    // 这一步是防御性的 —— 编码器是注入的端口，若它忘了归一化，
    // 所有分数会被静默缩放（排序仍对、band 全错），很难发现。768 次乘加的代价可忽略。
    qvec = l2norm(qvec);

    // ---- 逐库打分并合并 ----
    const { loaded, skipped } = pickCompatible(req.libIds);
    if (!loaded.length) throw fail(ERR.INDEX_MISSING, '没有可检索的库', { skipped });

    const filters = req.filters || {};
    const folders = filters.folders ? new Set(filters.folders) : null;
    const exts = filters.exts ? new Set(filters.exts) : null;

    const scored: Array<{ libId: string; item: IndexItem; score: number }> = [];
    for (const e of loaded) {
      const { vectors, dim, items } = e;
      // doSearch 只在真实模式跑（模拟模式由 fakeKit.doSearch 接管）⇒ vectors 一定是 Float32Array。
      // 用 instanceof 收窄而**不是类型断言**：万一模拟 entry 混进打分路径，这里当场抛，
      // 不会静默算出满屏垃圾分数。
      if (!(vectors instanceof Float32Array)) {
        throw fail(ERR.INTERNAL, '索引向量块不是 Float32Array（模拟 entry 混进了打分路径）');
      }
      for (const it of items) {
        if (it.vectorRow == null) continue;
        // 原 JS 是 folders.has(it.folder)：folder 缺失时 Set.has(undefined) 为假 ⇒ 跳过。
        // 显式写出 folder != null 就是同一条语义（且不用把 undefined 硬塞进 Set）。
        if (folders && !(it.folder != null && folders.has(it.folder))) continue;
        if (exts && !exts.has(String(it.imageExt || '').toLowerCase())) continue;
        const off = it.vectorRow * dim;
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += vectors[off + i] * qvec[i];
        scored.push({ libId: e.libId, item: it, score: dot });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    return ok({
      libsUsed: loaded.map((e) => e.libId),
      libsSkipped: skipped,
      tookMs: now() - t0,
      results: top.map((r) => {
        const it = r.item;
        const rel = relOf(it);
        return {
          libId: r.libId,
          uid: it.uid,
          score: Number(r.score.toFixed(6)),
          band: bandOf(r.score, mode),
          relPath: rel,
          folder: it.folder,
          stem: it.stem,
          imageExt: it.imageExt,
          imageSize: it.imageSize,
          archive: it.archiveRelPath
            ? { relPath: it.archiveRelPath, ext: it.archiveExt, size: it.archiveSize }
            : null,
          thumbKey: `${r.libId}/${it.uid}`,
        };
      }),
    });
  }

  function doIndexStatus() {
    const libs = [];
    for (const l of registry.list()) {
      let rootOk = true;
      try {
        registry.requireExistingRoot(l.libId);
      } catch {
        rootOk = false;
      }
      let e: EngineEntry | null = null;
      const problems: Array<{ code: string | undefined; message: string }> = [];
      try {
        e = load(l.libId);
      } catch (err) {
        problems.push({ code: codeOf(err), message: messageOf(err) });
      }
      // 新布局：把 `.gs-*` 的**真实落点与存在性**如实报出来（"索引在不在库根下"是排障第一眼要看的东西）。
      // ⚠️ 它**不参与 healthy 判定**：数据可用性以端口为准 —— 端口读得到就是可用，
      //    读不到会在 problems 里给出带 code 的明确理由（不许假绿）。
      const layout = resolver ? resolver.storageOf(l.libId) : null;
      libs.push({
        libId: l.libId,
        label: l.label,
        root: l.root,
        rootExists: rootOk,
        indexed: e ? e.items.length : 0,
        encoded: e ? e.count : 0,
        dim: e ? e.dim : null,
        compat: e && compatComplete(e.header) ? compatKey(e.header) : null,
        builtAt: e ? e.header.built_at || null : null,
        // ⚠️ 旧布局从 meta.json 读失败项台账；新布局里那份台账**不在这三个端口里** ⇒ 报 null（**未知**），
        //    不用 0 假装"没有失败项" —— 那正是我们要防的假绿。
        failed:
          e && e.meta && Array.isArray(e.meta.failed)
            ? e.meta.failed.length
            : metaFromFile
              ? 0
              : null,
        healthy: rootOk && e !== null && problems.length === 0 && e.items.length === e.count,
        problems,
        // storage 块**只在库解析端口存在时出现** ⇒ 旧布局的返回形状逐字不变（既有 fixtures/e2e 不受影响）
        ...(layout
          ? {
              storage: {
                // 布局由**唯一判据**决定（index-layout.ts）—— 迁移期可能是旧布局回退，不许一律写死 'library-root'
                layout: layout.layout ?? 'library-root',
                root: layout.root,
                indexPath: layout.indexPath,
                dbPath: layout.dbPath,
                journalPath: layout.journalPath ?? null,
                indexExists: fs.existsSync(layout.indexPath),
                dbExists: fs.existsSync(layout.dbPath),
              },
            }
          : {}),
      });
    }
    return ok({ libs });
  }

  /** 差分扫描：新增 / 消失 / 变化。**只读**。 */
  function doScan({ libId }: ScanRequest = {}) {
    // 原 JS 把 undefined 直接交给注册表 ⇒ Map.get(undefined) 未命中 ⇒ LIB_NOT_FOUND。
    // 用空串走同一条路：**错误码不变**（只是消息里显示空而不是 undefined）。
    const id = libId ?? '';
    registry.requireExistingRoot(id);
    const e = load(id);
    const root = registry.get(id).root;

    const disk = new Map<string, { size: number; mtimeMs: number }>(); // relPath -> { size, mtimeMs }
    const walk = (dir: string): void => {
      for (const de of fs.readdirSync(dir, { withFileTypes: true })) {
        // ⚠️ 新布局把 `.gs-index.bin` / `.gs.db` / `.gs-staging/` 放在**库根**里 ——
        //    不跳过就会把它们报成"新增素材"（假发现），而且**不报错**。判据用唯一实现（U11）。
        //    隐藏项一并跳过（SPEC §1：所有条目扫描必须跳过 `.gs-*` 与隐藏项）。
        if (isReservedLibraryName(de.name)) continue;
        if (de.name.startsWith('.')) continue;
        const full = path.join(dir, de.name);
        if (de.isDirectory()) {
          walk(full);
          continue;
        }
        if (!de.isFile()) continue;
        const st = fs.statSync(full, { bigint: true });
        disk.set(path.relative(root, full), {
          size: Number(st.size),
          mtimeMs: Number(st.mtimeNs / 1_000_000n),
        });
      }
    };
    walk(root);

    const known = new Map<string, IndexItem>(); // relPath -> item
    for (const it of e.items) {
      const rel = relOf(it);
      if (rel) known.set(rel, it);
    }

    const fresh: Array<{ relPath: string; stem: string }> = [];
    const changed: Array<{ relPath: string; uid?: string; what: string[] }> = [];
    for (const [rel, s] of disk) {
      const it = known.get(rel);
      if (!it) {
        fresh.push({ relPath: rel, stem: path.basename(rel, path.extname(rel)) });
        continue;
      }
      const what: string[] = [];
      if (it.imageSize != null && Number(it.imageSize) !== s.size) what.push('size');
      if (it.imageMtime != null && Number(it.imageMtime) !== s.mtimeMs) what.push('mtime');
      if (what.length) changed.push({ relPath: rel, uid: it.uid, what });
    }
    const missing: Array<{ relPath: string; uid?: string }> = [];
    for (const [rel, it] of known) if (!disk.has(rel)) missing.push({ relPath: rel, uid: it.uid });

    const fp = fingerprintV1(root);
    return ok({
      new: fresh,
      missing,
      changed,
      fingerprintV1: fp.fingerprint,
      counts: fp.counts,
      filesTotal: fp.counts.files,
    });
  }

  /** 取件：把选中的包（或图）复制到**已配置的**目标目录。库侧零写入。 */
  function doCollect({ libId, uids, targetDirName, target = 'auto' }: CollectRequest = {}) {
    const id = libId ?? '';
    registry.requireExistingRoot(id);
    // 旧语义：**先**校验索引可读（缺索引/损坏 ⇒ 在这里就抛，而不是等到 uid 循环里）
    load(id);
    const root = registry.get(id).root;
    const list = Array.isArray(uids) ? uids : [];
    if (!list.length) throw fail(ERR.BAD_REQUEST, 'uids 为空');
    if (list.length > 200) throw fail(ERR.BAD_REQUEST, `一次最多取 200 件，收到 ${list.length}`);

    const { name, dir } = resolveCollectDir(targetDirName, config.collect);
    fs.mkdirSync(dir, { recursive: true });

    // 先算总量并做**空间预检**（不要复制到一半才发现不够）
    const plan: Array<{
      uid: string;
      abs: string;
      dest: string;
      size: number;
      kind: string;
      rel: string | null;
    }> = [];
    const failed: Array<{
      uid: string;
      error: { code: string; message: string; rel?: string | null };
    }> = [];
    const skipped: Array<{ uid: string; reason: string; path: string }> = [];
    let totalBytes = 0;
    for (const uid of list) {
      const it = itemOf(id, uid);
      if (!it) {
        failed.push({ uid, error: { code: ERR.UID_NOT_FOUND, message: 'uid 不在索引中' } });
        continue;
      }
      let src: { rel: string | null; kind: string };
      try {
        src = pickCollectSource(it, target);
      } catch (err) {
        failed.push({ uid, error: { code: codeOf(err) ?? ERR.INTERNAL, message: messageOf(err) } });
        continue;
      }
      const abs = resolveInLibrary(root, src.rel); // 含库根包含 + 链接校验
      if (!fs.existsSync(abs)) {
        failed.push({
          uid,
          error: { code: ERR.ITEM_MISSING_ON_DISK, message: '源文件不存在', rel: src.rel },
        });
        continue;
      }
      const size = fs.statSync(abs).size;
      const dest = path.join(dir, path.basename(abs));
      if (fs.existsSync(dest)) {
        skipped.push({ uid, reason: 'already-exists', path: dest });
        continue;
      }
      plan.push({ uid, abs, dest, size, kind: src.kind, rel: src.rel });
      totalBytes += size;
    }

    if (plan.length) {
      try {
        const st = fs.statfsSync(dir);
        const free = Number(st.bavail) * Number(st.bsize);
        if (free < totalBytes) {
          throw fail(ERR.DISK_FULL, `目标盘可用 ${free} 字节，需要 ${totalBytes} 字节`, {
            free,
            need: totalBytes,
            dir,
          });
        }
      } catch (err) {
        if (codeOf(err) === ERR.DISK_FULL) throw err;
        // statfs 不可用（老平台）→ 不阻断，交给写入时报错
      }
    }

    // ⚠️ jobId 必须**加密随机**（AGENTS：ID 新增处不自己拼随机）。旧写法 `j-` + 4 位 hex（Math.random）
    //    只有 65536 种且非加密随机 —— jobs 是 Map，撞了就把两次取件记成同一个 job。
    //    保留 `j-` 前缀（与 fake 引擎的 `j-fake-*` 同族，界面/日志口径不变），随机段用 v4 UUID。
    const jobId = `j-${crypto.randomUUID()}`;
    const succeeded: Array<{ uid: string; kind: string; path: string; bytes: number }> = [];
    for (const p of plan) {
      try {
        fs.copyFileSync(p.abs, p.dest, fs.constants.COPYFILE_EXCL); // EXCL：绝不覆盖
        succeeded.push({ uid: p.uid, kind: p.kind, path: p.dest, bytes: p.size });
      } catch (err) {
        const code = codeOf(err) === 'EEXIST' ? ERR.COLLECT_TARGET_EXISTS : ERR.INTERNAL;
        if (code === ERR.COLLECT_TARGET_EXISTS) {
          skipped.push({ uid: p.uid, reason: 'already-exists', path: p.dest });
        } else {
          failed.push({ uid: p.uid, error: { code, message: messageOf(err) } });
        }
      }
    }
    return ok({
      jobId,
      targetDirName: name,
      targetDir: dir,
      bytesTotal: totalBytes,
      succeeded,
      failed,
      skipped,
    });
  }

  // ---------------- 公开接口（每个都套信封） ----------------
  const api = {
    registry,
    /** 供测试与诊断：强制重新读索引 */
    reload(libId: string) {
      cache.delete(libId);
      return load(libId);
    },
    /**
     * 解析某条素材的绝对路径。**仅供主进程内部使用**（`thumb://` 协议处理器），
     * 刻意**不主动交给渲染进程** —— 契约 §0 要求"路径只能由 lib_id+uid 解析"。
     *
     * ⚠️ **2026-10-13 更正**：这里原来写着"把这个结果交给渲染进程就等于把绝对路径泄出去了"，
     * 而 P3c 明确要显示两条路径 ⇒ 那句话与需求冲突（而且 `reveal` 早就返回了 `path`，立场本就不自洽）。
     * 处置（所有者决定）：**不把它塞进 `item`**，而是新增一个语义明确、有文档、可审计的只读方法
     * **`itemPaths`**（见下面）。本方法保持"主进程内部用"的定位不变 —— 两条路各司其职。
     * 仍走完整的包含校验与符号链接校验。
     */
    absPathFor(libId: string, uid: string) {
      const it = itemOf(libId, uid);
      if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
      return resolveInLibrary(registry.get(libId).root, relOf(it));
    },
    search: (req: SearchRequest) =>
      envelope(async () => (fakeKit ? fakeKit.doSearch(req) : doSearch(req))),
    indexStatus: () => envelope(async () => (fakeKit ? fakeKit.doIndexStatus() : doIndexStatus())),
    scan: (req: ScanRequest) => envelope(async () => (fakeKit ? fakeKit.doScan(req) : doScan(req))),
    collect: (req: CollectRequest) => envelope(async () => doCollect(req)),
    item: ({ libId, uid }: ItemRequest = {}) =>
      envelope(async () => {
        // 模拟模式：索引在内存里，**不 requireExistingRoot、不读盘** —— 所以 exists 也走样例数据
        if (fakeKit) return fakeKit.doItem({ libId, uid });
        const id = libId ?? '';
        const it = itemOf(id, uid ?? '');
        if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
        const rel = relOf(it);
        const abs = resolveInLibrary(registry.get(id).root, rel);
        const arcAbs = it.archiveRelPath
          ? resolveInLibrary(registry.get(id).root, it.archiveRelPath)
          : null;
        return ok({
          libId,
          uid,
          relPath: rel,
          folder: it.folder,
          stem: it.stem,
          imageExt: it.imageExt,
          imageSize: it.imageSize,
          imageMtime: it.imageMtime,
          vectorSource: it.vectorSource || 'native',
          archive: it.archiveRelPath
            ? {
                relPath: it.archiveRelPath,
                ext: it.archiveExt,
                size: it.archiveSize,
                mtime: it.archiveMtime,
              }
            : null,
          exists: { image: fs.existsSync(abs), archive: arcAbs ? fs.existsSync(arcAbs) : false },
        });
      }),
    /**
     * 两条绝对路径（契约 §2.2a，2026-10-13 新增）。
     *
     * ⚠️ **为什么单独一个方法，而不是往 `item` 里加字段**（所有者 2026-10-13 决定）：
     *   `item` 是"索引元数据"。把绝对路径混进去，等于**每一次取元数据都顺带把库内路径交出去**；
     *   而本应用确实需要显示这两条路径（`ROADMAP.md:221` 的 P3c 验收 · `UI-REVIEW-and-migration.md:235` 流程 2）。
     *   ⇒ 给它一个**有名字、有文档、语义就是"要路径"**的只读方法，把暴露面收在明处、可审计。
     *   这也解掉了 `absPathFor` 那条注释与实际需求之间的冲突（见本文件里 `absPathFor` 的说明）。
     *
     * 仍走完整的**库根包含校验与符号链接校验**（`resolveInLibrary`）—— 不是绕开它们另开一条路。
     */
    itemPaths: ({ libId, uid }: ItemRequest = {}) =>
      envelope(async () => {
        // 模拟模式：路径由样例数据拼出，**不读盘**（fake.ts 头注释 ①）
        if (fakeKit) return fakeKit.doItemPaths({ libId, uid });
        const id = libId ?? '';
        const it = itemOf(id, uid ?? '');
        if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
        const root = registry.get(id).root;
        const imagePath = resolveInLibrary(root, relOf(it));
        const archivePath = it.archiveRelPath ? resolveInLibrary(root, it.archiveRelPath) : null;
        return ok({
          libId,
          uid,
          imagePath,
          archivePath,
          exists: {
            image: fs.existsSync(imagePath),
            archive: archivePath ? fs.existsSync(archivePath) : false,
          },
        });
      }),
    /**
     * 事务台账（契约 §2.11，2026-10-13 新增）。
     *
     * 依据 `docs/spec/SPEC-transactions.md:229`：
     *   「`mutate()` 返回事务 id；**界面据 id 查询状态**、显示进度、提供撤销入口」
     * 而契约里此前**没有**任何列/查事务的方法 ⇒ 界面侧无数据源。补上这一个只读方法。
     *
     * 返回值里的 `blocked` 表示"有未收尾事务" —— 此时**任何写方法都会被 `RECOVERY_NEEDED` 挡住**，
     * 界面据此把「待处理」提到显眼处（`SPEC-transactions.md:141`）。
     *
     * ⚠️ 真实模式**没有实现事务日志** ⇒ 如实返回 `INTERNAL`，不返回空数组假装"没有事务"。
     */
    // `transactions`（契约 §2.11）也由下面的生成式统一处理 —— 见 `UNIMPLEMENTED_METHODS`。
    // ── 长任务与写操作（契约 §2.6–§2.11 / §3 / §5）────────────────────────
    // 这几个方法的**形状已冻结、真实实现未接线**：
    //   · 真实模式 ⇒ **如实 `INTERNAL`**，绝不假装成功；
    //   · 模拟模式 ⇒ 交给 `fake.ts`（契约 §8，让「P3 不等真实库」的那条路）。
    //
    // ⚠️ 2026-10-13 改成**生成式**：原来这 6 个是逐段手抄的（每段除了方法名一模一样）—— 那是 P2。
    //    现在由 **`UNIMPLEMENTED_METHODS` 一份定义**驱动；假套件的键与方法名**一一对应**
    //    （见 `fake.ts` 的 return —— 那里刻意按方法名作键），所以这里只要 `fakeKit[name]`，
    //    不另设"方法名→套件名"的映射表（那种表两个方向都会漂移）。
    //    主进程也读这份清单来给出**一致的**用户文案（`main/index.mjs`）——
    //    这样"哪些没做"全仓只有一处定义（P1）。
    ...Object.fromEntries(
      UNIMPLEMENTED_METHODS.map((name): [string, (req: unknown) => Promise<unknown>] => [
        name,
        (req) =>
          envelope(async () => {
            if (!fakeKit) throw fail(ERR.INTERNAL, '这个功能还没做好。', { method: name });
            const fn = fakeKit[name];
            if (!isFakeMethod(fn)) {
              // 假套件里少接一个方法 = 契约 §8 的演示能力缺一块，必须显式炸而不是静默 undefined
              throw fail(ERR.INTERNAL, `模拟套件缺少实现：${name}`, { method: name });
            }
            return fn(req);
          }),
      ]),
    ),
    reveal: ({ libId, uid, target = 'archive' }: RevealRequest = {}) =>
      envelope(async () => {
        const id = libId ?? '';
        const it = itemOf(id, uid ?? '');
        if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
        const rel = target === 'archive' ? it.archiveRelPath || relOf(it) : relOf(it);
        const abs = resolveInLibrary(registry.get(id).root, rel);
        if (!fs.existsSync(abs))
          throw fail(ERR.ITEM_MISSING_ON_DISK, `文件不存在：${rel}`, { rel });

        // ⚠️ **未注入端口必须显式失败，不许返回 ok**（F-01，契约 §2.4 第 2 条）。
        //
        // 原来的写法是 `if (shell && …) shell.reveal(abs); return ok({revealed:true})` ——
        // 端口缺失时**照样**报成功。那不是"降级"，是**谎报**：界面会显示「已在资源管理器中定位」，
        // 而资源管理器毫无动静，用户与排障者都会往错的方向找。
        //
        // 而且这条**没有第二道防线**：`ok({revealed:true})` 的语义就是"已经定位了"，
        // 调用方无法区分"真定位了"和"什么都没做"。
        if (!shell || typeof shell.reveal !== 'function') {
          throw fail(
            ERR.PORT_MISSING,
            `未注入 shell 端口（reveal 需要外壳提供 { reveal(absPath) }；当前 ${shell ? '形状不对' : '未提供'}）`,
            { port: 'shell', got: shell === null || shell === undefined ? 'none' : typeof shell },
          );
        }
        // Electron 的 `shell.showItemInFolder` **返回 void、不报告失败**，所以这里**不能**
        // 断言"资源管理器一定弹出来了"。我们只保证：端口被调用了，且目标文件确实在盘上
        // （上面那条 existsSync 已证）。这个边界必须如实写在契约里，不得声称更强的保证。
        shell.reveal(abs);
        return ok({ revealed: true, path: abs });
      }),
    /** 长任务的通用取消入口（P1 只登记；实际编码在 indexStart 实现） */
    _jobs: jobs,
    _cache: cache,
    _onEvent: onEvent,
    /** 模拟模式的内部句柄（`fake:false` 时为 `null`）—— 供测试断言"零真实 fs"与收尾定时器 */
    _fake: fakeKit,
  };
  return api;
}

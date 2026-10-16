// apps/desktop/src/main/library-config.ts —— 库与配置的解析（D2 修复）
//
// 背景（为什么需要这个模块）：
//   主进程原先只从 `config.json` / `GEMMA_CONFIG` 读库根，而**那个文件早已随 Python 档退役被删除**，
//   仓库里也没有模板 ⇒ 库列表恒为空 ⇒ 界面永远 `LIB_NOT_FOUND`，开箱跑不出任何检索结果。
//   这是审查确认的缺陷 D2（**就地自述**：旧审查文档已随 v2 清除），也是一切界面工作的前置。
//
// 本模块的定位：
//   把「库从哪来」这条链从 `index.mjs` 里拆出来，做成**纯逻辑 + 可单测**的形态。
//   它**不依赖 Electron**（`userDataDir` 由调用方注入，主进程传 `app.getPath('userData')`），
//   这样它也能被 `node --test` 直接跑。
//
// 解析优先级（高 → 低，逐条都记 `source`，便于排障时直接看清"库是从哪来的"）：
//   1. `GEMMA_LIB_ROOT` 环境变量          —— 显式覆盖；仓里 7 个守卫/tools 都用这个惯例
//   2. `userData/library-registry.json`   —— **决策 9 的正规存储**（应用内注册表，本模块新建）
//   3. `config.json` / `GEMMA_CONFIG`     —— 兼容回退；**不是要求用户去配它**，只为不丢老用法
//   4. `data/libraries/*/meta.json` 自举  —— **本机已有索引时零配置可用**
//
//   第 4 条是关键：索引的 `meta.json` 里本就存着 `lib_id` 与 `lib_root`
//   （实测：`{"lib_id":"L1","lib_root":"G:\\model"}`）。既然索引知道自己描述哪个库，
//   就不该再让用户手工把同一事实抄一遍。⇒ 有索引的机器**开箱即用**。
//
// 取件白名单（`collect.dirs`，同时解掉缺陷 F-04）：
//   原先恒为 `{}` ⇒ 任何 `collect` 都返回 `COLLECT_DIR_NOT_ALLOWED`。
//   这里按 `SPEC.md` §2 存储布局（默认 `E:\素材待用\`）与
//   `SPEC.md` §2.1 写入不变式（移出走 `E:\移出素材\`）给默认值。
//
// ⚠️ **本模块只读 + 只在显式调用时写**。启动路径上**绝不写** userData，
//    以免"只是启动了一下"就产生副作用。写注册表只发生在 `saveRegistry()` 被调用时。
//
// 2026-10-14：本文件由 `library-config.mjs` 转为 `.ts`（全量 TypeScript）。
// **语义逐字未改**（四条优先级、取件白名单优先级、空 ⇒ null 的 F-04 防线都不动），只补类型。
import fs from 'node:fs';
import path from 'node:path';

import { classifyRootSync } from './library-availability.ts';

/** 注册表格式版本（结构变更时递增，读端据此判断） */
export const REGISTRY_VERSION = 1;
export const REGISTRY_FILE = 'library-registry.json';

/** libId 形状：与 `apps/desktop/src/shared/ipc.ts` 的 `LibId` 保持一致 */
const LIB_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * 取件目录的**规格兜底值**（来自 `SPEC.md` §2 与 §2.1，不是本项目现编的）。
 *
 * ⚠️ P3（2026-10-13）：这是**兜底**，不再是"唯一值"。解析顺序见 `resolveLibraries`：
 * **`GEMMA_COLLECT_DIRS` 环境变量 > 注册表 > `config.json` > 本兜底**。
 * 本常量之所以仍是绝对路径，是因为 SPEC 就是这么规定的 —— 改它要走 `PLAN.md` §9 变更控制，
 * 不在 T5 范围。**非 `E:` 盘的机器应当显式设 `GEMMA_COLLECT_DIRS`**（见 `parseCollectDirsEnv`）。
 */
export const DEFAULT_COLLECT = Object.freeze({
  dirs: Object.freeze({
    素材待用: 'E:\\素材待用',
    移出素材: 'E:\\移出素材',
  }),
  default: '素材待用',
});

/** 取件白名单：目录名 → 目录路径，外加默认项 */
export interface CollectDirs {
  dirs: Record<string, string>;
  default: string;
}

/** 只做形状判断的取件配置（注册表 / config.json 里的 `collect`） */
export interface CollectConfigLike {
  dirs?: Record<string, string>;
  default?: string;
}

/** 注册表文件的内容（外部 JSON：字段可能缺失、形状不可信） */
export interface RegistryData {
  libraries?: unknown;
  collect?: unknown;
}

/** `loadRegistry` 的返回 */
export interface RegistryLoadResult {
  path: string;
  data: RegistryData | null;
  error: string | null;
}

/** `saveRegistry` 的返回 */
export interface RegistrySaveResult {
  ok: boolean;
  path: string | null;
  error: string | null;
}

/** 归一化后的库条目（root 已 resolve） */
export interface NormalizedLibrary {
  libId: string;
  root: string;
  label: string;
}

/** 被丢弃的条目 + 原因（**不静默改造**） */
export interface DroppedLibrary {
  item: unknown;
  why: string;
}

/** 解析出的库条目（`source` 记录它来自四条路的哪一条） */
export interface LibraryEntry {
  libId: string;
  root: string;
  label: string;
  source: string;
  count?: number;
  indexPath?: string;
}

/** `discoverLibrariesFromIndex` 的返回 */
export interface DiscoverResult {
  libraries: LibraryEntry[];
  notes: string[];
}

/**
 * 主进程会读到的 `config.json` 字段（外部 JSON：都可能缺失）。
 * ⚠️ 只声明**已知字段**；引擎侧另有 `EngineConfig`，两者不合并（引擎不认识主进程字段）。
 */
export interface MainConfig {
  data_dir?: string;
  onnx_model_dir?: string;
  model_cache?: string;
  device?: string;
  lib_id?: string;
  library_root?: string;
  libraries?: unknown;
  collect?: unknown;
  [key: string]: unknown;
}

/** `resolveLibraries` 的入参 */
export interface ResolveLibrariesOptions {
  /** 应用数据目录（`data/`） */
  dataDir: string;
  /** `app.getPath('userData')`；缺省则跳过注册表这一层 */
  userDataDir?: string | null;
  /** 已读到的 `config.json`（可选） */
  config?: MainConfig;
  /** 上面那份 config 的来源路径（仅用于报告） */
  configPath?: string | null;
  /** `process.env.GEMMA_LIB_ROOT` */
  envLibRoot?: string;
  /** `process.env.GEMMA_COLLECT_DIRS` */
  envCollectDirs?: string;
}

/** `resolveLibraries` 的返回 */
export interface ResolveLibrariesResult {
  libraries: LibraryEntry[];
  collect: CollectDirs;
  chosen: string | null;
  diagnostics: string[];
  warnings: string[];
  registryPath: string;
}

/** `typeof x === 'object' && x !== null`（读外部 JSON 时的统一收窄） */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 注册表 / config 里的 `collect` 是否为对象（**形状由下游的 `dirs` 检查兜底**） */
function isCollectConfig(v: unknown): v is CollectConfigLike {
  return !!v && typeof v === 'object';
}

/**
 * 解析 `GEMMA_COLLECT_DIRS`（P3：给取件目录一个配置入口，与库根的 `GEMMA_LIB_ROOT` 同惯例）。
 *
 * 语法：`名称=路径` 多条用 `;` 分隔，例如
 *   `GEMMA_COLLECT_DIRS=素材待用=D:\收件;移出素材=D:\移出`
 * 路径里可以含 `=`，所以**只按第一个 `=` 切**。
 *
 * **保证不返回空**：解析不出任何条目就返回 `null`（调用方继续走下一优先级），
 * 绝不返回 `{dirs:{}}` —— 空的白名单会让任何 `collect` 都变成 `COLLECT_DIR_NOT_ALLOWED`
 * （那是缺陷 F-04，已修，不能再回来）。
 */
export function parseCollectDirsEnv(raw: unknown): CollectDirs | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  const dirs: Record<string, string> = {};
  for (const part of s.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue; // 没有 `=` 或名字为空 ⇒ 跳过这一条
    const name = seg.slice(0, eq).trim();
    const dir = seg.slice(eq + 1).trim();
    if (!name || !dir) continue;
    dirs[name] = dir;
  }
  const names = Object.keys(dirs);
  if (!names.length) return null; // **空 ⇒ null**，不是空对象（见上）
  return { dirs, default: names[0] };
}

export function registryPath(userDataDir: string): string {
  return path.join(userDataDir, REGISTRY_FILE);
}

/**
 * 读注册表。**任何异常都返回 null 而不是抛** ——
 * 配置坏了不该让应用起不来，调用方会退到下一优先级并把原因报出来。
 */
export function loadRegistry(userDataDir: string | null | undefined): RegistryLoadResult | null {
  if (!userDataDir) return null;
  const p = registryPath(userDataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return { path: p, data: raw as RegistryData, error: null };
  } catch (e) {
    return { path: p, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 写注册表（**只在用户明确注册/改设置时调用**）。
 * 返回 `{ok, path, error}`，不抛 —— 写失败要能让界面显示出来，而不是崩。
 */
export function saveRegistry(
  userDataDir: string | null | undefined,
  data: { libraries?: unknown; collect?: unknown },
): RegistrySaveResult {
  if (!userDataDir) return { ok: false, path: null, error: '无 userData 目录' };
  const p = registryPath(userDataDir);
  const payload = { version: REGISTRY_VERSION, ...data };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { ok: true, path: p, error: null };
  } catch (e) {
    return { ok: false, path: p, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 校验并归一一组库条目；非法条目**丢弃并记录**，不静默改造 */
export function normalizeLibraries(input: unknown): {
  kept: NormalizedLibrary[];
  dropped: DroppedLibrary[];
} {
  const kept: NormalizedLibrary[] = [];
  const dropped: DroppedLibrary[] = [];
  const items: unknown[] = Array.isArray(input) ? input : [];
  for (const l of items) {
    const libId = isRecord(l) && typeof l.libId === 'string' ? l.libId.trim() : '';
    const root = isRecord(l) && typeof l.root === 'string' ? l.root.trim() : '';
    if (!LIB_ID_RE.test(libId)) {
      dropped.push({ item: l, why: `libId 形状不合法：${JSON.stringify(libId)}` });
      continue;
    }
    if (!root) {
      dropped.push({ item: l, why: 'root 为空' });
      continue;
    }
    kept.push({
      libId,
      root: path.resolve(root),
      label: isRecord(l) && l.label ? String(l.label) : libId,
    });
  }
  return { kept, dropped };
}

/**
 * 从 `data/libraries/<id>/meta.json` 自举库列表。
 *
 * 这是"零配置可用"的来源：索引自己记着它属于哪个库、库根在哪。
 * 索引目录名（如 `L1`）就是 libId；`meta.lib_id` 若存在则以它为准（两者不一致时记 warning）。
 */
export function discoverLibrariesFromIndex(dataDir: string): DiscoverResult {
  const base = path.join(dataDir, 'libraries');
  const out: LibraryEntry[] = [];
  const notes: string[] = [];
  if (!fs.existsSync(base)) return { libraries: out, notes };
  for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const metaFile = path.join(base, dir.name, 'meta.json');
    if (!fs.existsSync(metaFile)) {
      notes.push(`跳过 ${dir.name}：没有 meta.json`);
      continue;
    }
    let meta: unknown;
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      notes.push(
        `跳过 ${dir.name}：meta.json 解析失败（${e instanceof Error ? e.message : String(e)}）`,
      );
      continue;
    }
    const libId = isRecord(meta) && meta.lib_id ? String(meta.lib_id) : dir.name;
    if (!LIB_ID_RE.test(libId)) {
      notes.push(`跳过 ${dir.name}：meta.lib_id 形状不合法`);
      continue;
    }
    if (libId !== dir.name)
      notes.push(`注意 ${dir.name}：目录名与 meta.lib_id（${libId}）不一致，以 meta 为准`);
    const root = isRecord(meta) && meta.lib_root ? String(meta.lib_root) : '';
    if (!root) {
      notes.push(`跳过 ${dir.name}：meta 里没有 lib_root`);
      continue;
    }
    out.push({
      libId,
      root: path.resolve(root),
      label: '主库',
      count: isRecord(meta) ? Number(meta.count) || 0 : 0,
      source: 'index-meta',
      indexPath: path.join(base, dir.name),
    });
  }
  return { libraries: out, notes };
}

/**
 * 解析出最终的库列表 + 取件白名单 + 一份**可读的诊断报告**。
 */
export function resolveLibraries({
  dataDir,
  userDataDir,
  config = {},
  configPath = null,
  envLibRoot = '',
  envCollectDirs = '',
}: ResolveLibrariesOptions): ResolveLibrariesResult {
  const diagnostics: string[] = [];
  const warnings: string[] = [];
  let libraries: LibraryEntry[] = [];
  let chosen: string | null = null;

  // 1) 环境变量显式覆盖
  if (envLibRoot && String(envLibRoot).trim()) {
    const root = path.resolve(String(envLibRoot).trim());
    const libId = config.lib_id ? String(config.lib_id) : 'L1';
    libraries = [{ libId, root, label: '主库（GEMMA_LIB_ROOT）', source: 'env' }];
    chosen = 'env';
    diagnostics.push(`库来自环境变量 GEMMA_LIB_ROOT = ${root}`);
  }

  // 2) 应用内注册表（决策 9 的正规存储）
  if (!chosen) {
    const reg = loadRegistry(userDataDir);
    if (reg && reg.error) {
      warnings.push(`注册表读取失败（会退到下一优先级）：${reg.path} — ${reg.error}`);
    } else if (reg && reg.data) {
      const { kept, dropped } = normalizeLibraries(reg.data.libraries);
      for (const d of dropped) warnings.push(`注册表里丢弃了一条库：${d.why}`);
      if (kept.length) {
        libraries = kept.map((l) => ({ ...l, source: 'registry' }));
        chosen = 'registry';
        diagnostics.push(`库来自应用内注册表：${reg.path}（${kept.length} 个）`);
      } else if (Array.isArray(reg.data.libraries) && reg.data.libraries.length) {
        warnings.push(`注册表存在但没有任何合法库条目：${reg.path}`);
      }
    }
  }

  // 3) config.json 兼容回退
  if (!chosen) {
    const fromCfg: unknown[] = [];
    if (Array.isArray(config.libraries) && config.libraries.length)
      fromCfg.push(...config.libraries);
    else if (config.library_root) {
      fromCfg.push({ libId: config.lib_id || 'L1', root: config.library_root, label: '主库' });
    }
    const { kept, dropped } = normalizeLibraries(fromCfg);
    for (const d of dropped) warnings.push(`config 里丢弃了一条库：${d.why}`);
    if (kept.length) {
      libraries = kept.map((l) => ({ ...l, source: 'config' }));
      chosen = 'config';
      diagnostics.push(`库来自 ${configPath || 'config'}（兼容回退）`);
    }
  }

  // 4) 从已有索引自举（本机零配置可用的关键）
  if (!chosen) {
    const disc = discoverLibrariesFromIndex(dataDir);
    for (const n of disc.notes) diagnostics.push(n);
    if (disc.libraries.length) {
      libraries = disc.libraries;
      chosen = 'index-meta';
      diagnostics.push(
        `库由已有索引自举（${disc.libraries.map((l) => `${l.libId}=${l.root}`).join(', ')}）—— 无需手工配置`,
      );
    }
  }

  if (!chosen) {
    diagnostics.push('未找到任何库：环境变量 / 注册表 / config.json / 已有索引 四条路都没有结果');
  }

  // 取件白名单：环境变量 > 注册表 > config > SPEC 兜底（P3：2026-10-13 补上环境变量这条入口）
  const envDirs = parseCollectDirsEnv(envCollectDirs);
  const regDirs = (() => {
    const reg = loadRegistry(userDataDir);
    const c: unknown = reg && reg.data ? reg.data.collect : null;
    return isCollectConfig(c) ? c : null;
  })();
  const collect: CollectDirs = (() => {
    const sources: Array<[CollectConfigLike | null, string]> = [
      [envDirs, '环境变量 GEMMA_COLLECT_DIRS'],
      [regDirs, '注册表'],
      [isCollectConfig(config.collect) ? config.collect : null, 'config.json'],
    ];
    for (const [src, from] of sources) {
      if (src && src.dirs && Object.keys(src.dirs).length) {
        diagnostics.push(`取件白名单来自${from}（${Object.keys(src.dirs).length} 个目录）`);
        return { dirs: { ...src.dirs }, default: src.default || Object.keys(src.dirs)[0] };
      }
    }
    // 走到这里说明三条路都没给 ⇒ 用规格兜底。**必须非空**（F-04 回归防线）。
    diagnostics.push('取件白名单来自规格兜底值（`SPEC.md` §2）；想换目录请设 `GEMMA_COLLECT_DIRS`');
    return { dirs: { ...DEFAULT_COLLECT.dirs }, default: DEFAULT_COLLECT.default };
  })();

  // 库根可用性：**如实报**，但不在这里判失败（引擎的 indexStatus 会给出结构化状态）。
  // ⚠️ U18：判据与 `libraryList` 的 `available/unavailableCode` **同一份**（main/library-availability.ts），
  //    别在这里再写一遍 existsSync 的另一种说法（P1）；文案也顺带分开了「不存在 / 不是目录 / 不可访问」。
  for (const l of libraries) {
    const a = classifyRootSync(l.root);
    if (!a.available) {
      warnings.push(`库根不可用（${String(a.code)}）：${l.libId} → ${l.root} —— ${a.reason}`);
    }
  }

  // ⚠️ `as string`：本函数走到这里时调用方必然已给出 userDataDir（启动路径在 `app.whenReady`
  //    之后才解析库）。原 JS 版在这里传 null/undefined 会由 `path.join` 抛 TypeError —— 保留同一行为，
  //    所以不用 `?? ''` 静默改写语义，只是在类型上显式声明这个前置条件。
  return {
    libraries,
    collect,
    chosen,
    diagnostics,
    warnings,
    registryPath: registryPath(userDataDir as string),
  };
}

// apps/desktop/src/main/storage-roots.ts —— 存储落点解析（T-04 · SPEC §2 的唯一实现）
//
// 为什么需要这个模块：
//   「东西该放哪」此前散落在好几处 —— 模型目录在 index.ts 的 resolveModelDir()、
//   索引在 data/libraries/<id>/、事务日志在引擎的 journalDir 参数里。没有一处能回答
//   "现在到底落在哪、为什么落在那儿"。本模块把三类落点收成**一处显式解析**，
//   并产出**可读的落点说明**（describeStorageRoots），启动时由 index.ts 打进日志。
//
// 三类落点（SPEC §2「存储布局（唯一权威）」）：
//   ① 模型（用户自备）：用户指定 → 程序目录 models/ → userData models/（**顺序只写在 MODEL_SEARCH_ORDER 一行里**）
//   ② 向量索引 .gs-index.bin + 元数据 .gs.db：**库根**
//   ③ 事务日志 .gs-journal/ + 暂存 .gs-staging/<txnId>/：**库根**（staging 见下面的说明）
//
// ⚠️ 本模块是**纯逻辑 + 依赖注入**：不 import electron，不读 app / process.env 全局单例，
//    所有输入（程序目录 / userData / 库列表 / 用户指定模型目录 / 文件系统能力）都由调用方传入。
//    这样它才能被 node --test 直接跑（index.ts import 了 electron，node:test 加载不了它）。
//
// ── 为什么"可写"要靠**真写一个探测文件**，而不是 fs.access(W_OK) ──────────────
//   实测（Windows · Node 24.14.0 · 本仓库，2026-10-14）：
//     对同一目录先 icacls /deny "<user>:(W)"，然后
//       fs.writeFileSync(<dir>/probe)  → EPERM（正确的"不可写"）
//       fs.accessSync(<dir>, fs.constants.W_OK) → **通过**（假报可写）
//   即 Node 文档早就写明的：Windows 上 access() 不检查 ACL。
//   ⇒ 用 access(W_OK) 判断"库根不可写 ⇒ 回退 userData"在 ACL 拒绝的场景下**永不触发**，
//     失败会被推迟到真正写索引时（那时用户已经以为一切正常）—— 这正是本项目最怕的**静默**。
//   ⇒ 所以探测方式 = 在**已存在**的目录里写一个 .gs-write-probe-* 临时文件，写完立刻删。
//     选 .gs- 前缀是**故意**的：SPEC §2.1 只允许库根出现 .gs-* 与 .gs-staging/，
//     探测文件因此落在允许的命名空间内，且 T-13 的扫描器本来就要跳过 .gs-*。
//     **本模块不创建任何目录**（探测只在目录已存在时进行）—— 启动路径不留副作用。
//
// ── 库根不可写时回退到哪 ───────────────────────────────────────────────
//   userData/libraries/<libId>/（USERDATA_LIBS_DIRNAME）。
//   选这个形状的理由：与既有 data/libraries/<libId>/ 的**索引自举布局同形**
//   （library-config.ts discoverLibrariesFromIndex 读的就是 <root>/libraries/<id>/meta.json），
//   且"一个库一个目录"，不会让多库的 .gs-index.bin 互相覆盖。
//
// 2026-10-14（T-04a）：本文件是新增，未改动任何既有行为。

import fs from 'node:fs';
import path from 'node:path';

// ⚠️ staging 目录名**只允许有一处定义**：引擎的 transactions/steps.ts 导出它，
//    executor.ts 也 import 它（那里原话：「这里导出，那边 import，不各写一份」）。
//    本模块只是把同一个常量接到"落点说明"里，不重新定义（P1）。
import { STAGING_DIRNAME } from '../../../../packages/engine/src/transactions/steps.ts';

// 库根下的点前缀命名空间（SPEC §2 的布局图）—— **名字的唯一来源在引擎侧**
// （`packages/engine/src/gs-names.ts`）：扫描器在引擎里、落点解析在主进程里，两边必须用**同一份**名字与判据；
// 各写一份正是 P1 的复发形态，而 2026-10-15 的 U11（`.gs.db` 不匹配 `.gs-` 前缀）就是两处判据同时踩的坑。
// 反向依赖（engine → main）会成环、也会破坏「引擎可脱离 Electron 单独测试」⇒ 唯一实现落引擎侧。
import {
  GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME, GS_WRITE_PROBE_PREFIX,
} from '../../../../packages/engine/src/gs-names.ts';
export { GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME };

/** 模型目录名 */
export const MODELS_DIRNAME: string = 'models';
/**
 * 「什么样的目录才算模型目录」的判据：含 onnx/model.onnx。
 * 与 index.ts 里既有的 resolveModelDir() 同口径（它扫的是 model_cache/<rev>/fp32/onnx/model.onnx）。
 */
export const MODEL_MARKER_REL: string = path.join('onnx', 'model.onnx');

/** 回退 userData 时的库子目录名（与 data/libraries/<libId>/ 同形） */
export const USERDATA_LIBS_DIRNAME: string = 'libraries';

/** 写探测文件的点前缀（落在 .gs- 命名空间内；名字的唯一来源同上，本文件不再写第二份字面量） */
const PROBE_PREFIX: string = GS_WRITE_PROBE_PREFIX;

/** 探测文件名的去重序号（同进程内多次探测不重名） */
let probeSeq = 0;

// ---------------------------------------------------------------- 文件系统能力（可注入）

/**
 * 本模块用到的**最小**文件系统能力。
 *
 * 为什么要这个端口而不是直接 import fs：单测需要造出"目录存在但写失败（EPERM）"
 * 与"盘不存在（ENOENT）"—— 在真机上 Windows 的权限模型没法在 node:test 里干净地模拟
 * （改 ACL 要管理员、且会污染机器）。注入端口让这些情形**确定性可测**。
 */
export interface StorageFs {
  existsSync(p: string): boolean;
  isDirectory(p: string): boolean;
  /** 列目录名（模型缓存那一位要在 <rev>/fp32 里挑可用的那个；失败要由实现自己吞掉或抛） */
  readdirSync(p: string): string[];
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string): void;
  unlinkSync(p: string): void;
}

/** 真实文件系统（生产路径的默认实现） */
export const NODE_FS: StorageFs = {
  existsSync: (p: string): boolean => fs.existsSync(p),
  isDirectory: (p: string): boolean => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  },
  readdirSync: (p: string): string[] => fs.readdirSync(p),
  writeFileSync: (p: string, data: string): void => { fs.writeFileSync(p, data, 'utf8'); },
  mkdirSync: (p: string): void => { fs.mkdirSync(p, { recursive: true }); },
  unlinkSync: (p: string): void => { fs.unlinkSync(p); },
};

/** unknown → 错误码（拿不到就是 UNKNOWN，不猜） */
function codeOf(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c) return c;
  }
  return 'UNKNOWN';
}

/** unknown → 可读文案 */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- 写探测

/** 一次写探测的结果。reason **必须**能直接贴进日志给人看。 */
export interface WriteProbe {
  writable: boolean;
  /** 机器可读的失败码；成功时空串 */
  code: string;
  reason: string;
}

/**
 * 目录可写吗？——**只对已存在的目录做真写探测**（见文件头的实测理由）。
 *
 * 不存在 / 不是目录 ⇒ 直接判不可写，**且不创建任何东西**。
 * 这是启动路径上唯一会产生写入的地方，写的是 .gs- 前缀的临时文件，写完立即删。
 */
export function probeWritable(dir: string, fsImpl: StorageFs = NODE_FS): WriteProbe {
  if (!dir) return { writable: false, code: 'EMPTY', reason: '目录为空，无法判断可写性' };
  if (!fsImpl.existsSync(dir)) return { writable: false, code: 'ENOENT', reason: `目录不存在：${dir}` };
  if (!fsImpl.isDirectory(dir)) return { writable: false, code: 'ENOTDIR', reason: `不是目录：${dir}` };

  const file = path.join(dir, PROBE_PREFIX + String(process.pid) + '-' + String(++probeSeq) + '-' + String(Date.now()));
  try {
    fsImpl.writeFileSync(file, '');
  } catch (e) {
    // ⚠️ 不要把 codeOf(e) 再拼一遍：Node 的 message 本身就是 "EPERM: operation not permitted, open '...'"，
    //    拼上就变成 "EPERM: EPERM: ..."（第一版实测输出如此，读起来像两回事）。
    return { writable: false, code: codeOf(e), reason: `目录不可写：${dir}（${messageOf(e)}）` };
  }
  let cleanup = '';
  try {
    fsImpl.unlinkSync(file);
  } catch (e) {
    // 删不掉不影响"能写"的结论，但必须留痕 —— 否则库里会莫名其妙多一个文件而无人知道来源。
    cleanup = `（探测文件未能删除：${file} — ${codeOf(e)}）`;
  }
  return { writable: true, code: '', reason: `目录可写：${dir}${cleanup}` };
}

/**
 * 关掉写探测时的退化判断：只看存在性。
 * ⚠️ 它会**误判可写**（ACL 拒绝的目录照样报 true）—— 只有在"绝不写入"的只读场景才该用它。
 */
function existenceOnlyProbe(dir: string, fsImpl: StorageFs): WriteProbe {
  if (!dir) return { writable: false, code: 'EMPTY', reason: '目录为空' };
  if (!fsImpl.existsSync(dir)) return { writable: false, code: 'ENOENT', reason: `目录不存在：${dir}` };
  if (!fsImpl.isDirectory(dir)) return { writable: false, code: 'ENOTDIR', reason: `不是目录：${dir}` };
  return { writable: true, code: '', reason: `目录存在：${dir}（未做写探测，可写性未验证）` };
}

// ---------------------------------------------------------------- ① 模型落点

/**
 * 模型候选来自哪一位。
 * ⚠️ 第四位 `modelCache` **不在 SPEC §2 的三条里** —— 它是本机既有的 model-cache 布局
 * （`<cache>/onnx/embeddinggemma-2/<rev>/fp32`）。收敛 P1 债时**不能顺手把它删掉**：
 * 那会把用户"现在就能用"的模型弄丢（收敛 ≠ 删位置）。它的位置由 MODEL_SEARCH_ORDER 统一管。
 */
export type ModelSource = 'app' | 'userData' | 'user' | 'modelCache';

/** 一个模型搜索候选（**每个都留痕**，"找过哪些路径"就是靠它报出来的） */
export interface ModelCandidate {
  /** 在**实际搜索次序**里的位置（1 起）；次序由 MODEL_SEARCH_ORDER 决定，不在这里写死 */
  order: number;
  source: ModelSource;
  /** 人读标签（日志里直接用） */
  label: string;
  dir: string;
  exists: boolean;
  /** 目录里有 onnx/model.onnx ⇒ 这才是模型目录（只看存在不算命中） */
  valid: boolean;
  /** 该目录现在能不能写（**不建目录**：不存在一律 false） */
  writable: boolean;
  /** 命中/未命中的理由 */
  reason: string;
  /** 可写性判定的理由（含 EPERM/ENOENT 等原始错误码） */
  writeReason: string;
}

/** 模型落点的解析结果 */
export interface ModelResolution {
  /** 真正找到的模型目录；**找不到就是 null** —— 绝不回退到"随便给一个" */
  found: string | null;
  source: ModelSource | null;
  /** 建议放置目录 = 搜索顺序里**第一个可写**的候选；一个都不可写 = null */
  installDir: string | null;
  /** 按 SPEC §2 顺序找过的每一个候选 */
  searched: ModelCandidate[];
  /** 缺模型时给用户看的指引（含找过哪些路径、该放哪、怎么重试）；找到时为空串 */
  guidance: string;
}

export interface ResolveModelsOptions {
  /** 程序目录（dev 态 = 仓库根；打包态 = exe 所在目录，由调用方决定） */
  appDir: string;
  /** app.getPath('userData')；缺省则跳过这一位 */
  userDataDir?: string | null;
  /** 用户在设置里指定的模型目录（config.json 的 onnx_model_dir） */
  userModelDir?: string | null;
  /** 既有 model-cache 的**基目录**（config.model_cache 或 <程序目录>/../model-cache）；缺省 = 跳过这一位 */
  modelCacheDir?: string | null;
  fs?: StorageFs;
}

/** 每种模型来源的人读标签（**顺序不在这里** —— 顺序只看 MODEL_SEARCH_ORDER） */
const MODEL_SOURCE_LABEL: Record<ModelSource, string> = {
  user: '用户指定',
  app: '程序目录 models/',
  userData: 'userData models/',
  modelCache: '既有模型缓存目录（model-cache）',
};

/**
 * ⭐ **模型搜索顺序的唯一来源**（SPEC §2）。
 *
 * ⚠️ 改顺序 = **只改这一行**。所有者看过界面后可能把它改回 ['app', 'userData', 'user']，
 *    那时候应当是一行的事（外加 storage-roots.test.mjs 里那条"顺序常量"断言）——
 *    别在任何别处再写第二份顺序（P1）。
 *
 * 2026-10-14 所有者授权调整（SPEC §2，挂"待界面复核"）：**显式覆盖优先**
 * ⇒ 用户在设置里指定的路径 → 程序目录 models/ → userData models/ →（最后）既有 model-cache 布局。
 *
 * ⚠️ 第四位 `modelCache`：本机既有的模型就放在那里（`<程序目录>/../model-cache/onnx/…`）。
 *    它是**兜底**而不是"该放模型的地方"，所以排在最后；但不放进这个常量里，
 *    就会出现"第二份候选顺序"（P1）——那正是 T-17 要收掉的债。
 */
export const MODEL_SEARCH_ORDER: readonly ModelSource[] = Object.freeze(['user', 'app', 'userData', 'modelCache']);

/** 顺序的人读串（日志与指引都用它；**从 MODEL_SEARCH_ORDER 派生**，不另写一份） */
export function modelSearchOrderText(): string {
  return MODEL_SEARCH_ORDER.map((s) => MODEL_SOURCE_LABEL[s]).join(' → ');
}

/**
 * 在**既有 model-cache 布局**里找第一个可用模型：`<base>/onnx/embeddinggemma-2/<rev>/fp32/onnx/model.onnx`。
 *
 * 为什么这段放在这里而不是 index.ts：`<rev>/fp32` 这个形状与 `onnx/model.onnx` 这个判据
 * **必须只有一份**（T-17 收敛：不许再有第二份"像不像模型目录"的判据）。index.ts 只提供**基目录**。
 *
 * @returns dir = 找到的 fp32 目录（找不到是 null）；note = 人读理由（进日志/指引）
 */
export function findModelCacheDir(base: string, fsImpl: StorageFs = NODE_FS): { dir: string | null; note: string } {
  const root = path.join(base, 'onnx', 'embeddinggemma-2');
  if (!base) return { dir: null, note: '没有配置模型缓存目录' };
  if (!fsImpl.existsSync(root)) return { dir: null, note: '缓存目录不存在：' + root };
  let revs: string[];
  try {
    revs = fsImpl.readdirSync(root);
  } catch (e) {
    return { dir: null, note: '缓存目录读不动：' + root + '（' + codeOf(e) + '）' };
  }
  for (const rev of revs) {
    const d = path.join(root, rev, 'fp32');
    if (fsImpl.existsSync(path.join(d, MODEL_MARKER_REL))) {
      return { dir: d, note: '缓存里找到 ' + MODEL_MARKER_REL + '（' + d + '）' };
    }
  }
  return { dir: null, note: '扫过 ' + revs.length + ' 个 revision，都没有 ' + MODEL_MARKER_REL + '（' + root + '）' };
}

/** 缺模型时的明确指引（T-17 的输入：能报出找过哪些路径 + 不假装可用） */
function buildModelGuidance(
  appDir: string, userDataDir: string | null, modelCacheDir: string | null, searched: ModelCandidate[],
): string {
  const lines: string[] = [];
  lines.push(`未找到 ONNX 模型（搜索顺序取自 SPEC §2：${modelSearchOrderText()}）。`);
  lines.push('已经找过：');
  for (const c of searched) lines.push(`  ${c.order}. ${c.label} = ${c.dir} ⇒ ${c.reason}`);
  lines.push(`放法（**任选其一，靠前的优先**；目录里必须有 ${MODEL_MARKER_REL}）：`);
  // ⚠️ 这里的列法顺序**跟着 MODEL_SEARCH_ORDER 走**，不另写一份 ——
  //    否则顺序一改，这段指引就开始骗人（"照抄的文案会漂移"是本仓库栽过的坑）。
  for (const source of MODEL_SEARCH_ORDER) {
    if (source === 'user') {
      lines.push('  · 在设置里指定模型目录（config.json 的 onnx_model_dir）—— 显式指定，**优先级最高**');
    } else if (source === 'app') {
      lines.push(`  · ${path.join(appDir, MODELS_DIRNAME, MODEL_MARKER_REL)}`);
    } else if (source === 'userData') {
      if (userDataDir) lines.push(`  · ${path.join(userDataDir, MODELS_DIRNAME, MODEL_MARKER_REL)}`);
    } else if (source === 'modelCache' && modelCacheDir) {
      lines.push('  · 或放进既有模型缓存布局：' + path.join(modelCacheDir, 'onnx', 'embeddinggemma-2', '<revision>', 'fp32', MODEL_MARKER_REL));
    }
  }
  lines.push('放好后重启应用即可重试。');
  lines.push('⚠️ 在找到模型之前**不会显示任何检索结果** —— 不假装可用（SPEC §2「都找不到 ⇒ 显示明确指引」）。');
  return lines.join('\n');
}

/**
 * 解析模型落点。顺序**只读 `MODEL_SEARCH_ORDER`**（SPEC §2：用户指定 → 程序目录 → userData）。
 *
 * ⚠️ 这里**不许再写一遍顺序**：候选由常量生成，所以改顺序只需要改常量那一行。
 *    某一位不可用（没给用户目录 / 没有 userData）就**跳过**—— 跳过不是改顺序，
 *    所以"已经找过"里的序号仍然是真实的搜索次序。
 */
export function resolveModels(opts: ResolveModelsOptions): ModelResolution {
  const fsImpl = opts.fs ?? NODE_FS;
  const userDataDir = opts.userDataDir ?? null;
  const userModelDir = (opts.userModelDir ?? '').trim();

  // 候选 = 顺序常量 × 当前可用的来源。order 是它在**实际搜索次序**里的位置（1 起）。
  const modelCacheDir = (opts.modelCacheDir ?? '').trim();
  const plan: Array<{ order: number; source: ModelSource; label: string; dir: string; note?: string }> = [];
  for (const source of MODEL_SEARCH_ORDER) {
    if (source === 'app') {
      plan.push({ order: plan.length + 1, source, label: MODEL_SOURCE_LABEL[source], dir: path.join(opts.appDir, MODELS_DIRNAME) });
    } else if (source === 'userData') {
      if (userDataDir) {
        plan.push({ order: plan.length + 1, source, label: MODEL_SOURCE_LABEL[source], dir: path.join(userDataDir, MODELS_DIRNAME) });
      }
    } else if (source === 'user') {
      if (userModelDir) {
        plan.push({ order: plan.length + 1, source, label: MODEL_SOURCE_LABEL[source], dir: path.resolve(userModelDir) });
      }
    } else if (modelCacheDir) {
      // 这一位不是一个固定目录：要在 <cache>/onnx/embeddinggemma-2/<rev>/fp32 里找出可用的那个
      const hit = findModelCacheDir(modelCacheDir, fsImpl);
      plan.push({
        order: plan.length + 1, source, label: MODEL_SOURCE_LABEL[source],
        dir: hit.dir ?? path.join(modelCacheDir, 'onnx', 'embeddinggemma-2'),
        note: hit.note,
      });
    }
  }

  const searched: ModelCandidate[] = plan.map((c) => {
    const exists = fsImpl.existsSync(c.dir);
    const valid = exists && fsImpl.existsSync(path.join(c.dir, MODEL_MARKER_REL));
    const probe: WriteProbe = exists
      ? probeWritable(c.dir, fsImpl)
      : { writable: false, code: 'ENOENT', reason: `目录不存在：${c.dir}` };
    const reason = c.note
      ? c.note
      : !exists
        ? `没有这个目录（${c.dir}）`
        : valid
          ? `命中：含 ${MODEL_MARKER_REL}（${c.dir}）`
          : `目录存在但没有 ${MODEL_MARKER_REL}（${c.dir}）`;
    return {
      order: c.order,
      source: c.source,
      label: c.label,
      dir: c.dir,
      exists,
      valid,
      writable: probe.writable,
      reason,
      writeReason: probe.reason,
    };
  });

  const hit = searched.find((c) => c.valid) ?? null;
  // ⚠️ installDir（"建议把模型放哪"）**排除 modelCache**：那是我们自己的缓存目录，
  //    不是让用户放模型的地方（放那儿下次被清缓存就没了）。
  const firstWritable = searched.find((c) => c.writable && c.source !== 'modelCache') ?? null;

  return {
    found: hit ? hit.dir : null,
    source: hit ? hit.source : null,
    installDir: firstWritable ? firstWritable.dir : null,
    searched,
    guidance: hit ? '' : buildModelGuidance(opts.appDir, userDataDir, modelCacheDir || null, searched),
  };
}

// ---------------------------------------------------------------- ②③ 库根落点

/** 已解析出的一个库（来自 library-config.ts 的 ResolveLibrariesResult.libraries） */
export interface LibraryRootInput {
  libId: string;
  root: string;
}

/**
 * 库 id 的安全化：回退目录名要用它拼路径，而本函数是公开的 ——
 * 不能假设调用方一定过了 library-config 的 LIB_ID_RE 校验（路径穿越要在这里断掉）。
 */
function safeLibIdSegment(libId: string): string {
  const s = (libId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return s || 'L1';
}

/** 一个库的三类落点 */
export interface LibraryStorage {
  libId: string;
  /** 注册表 / 环境变量 / 索引自举给出的库根 */
  declaredRoot: string;
  /** 实际落点根；**null = 没有可用落点**（库根不可写且没有 userData 可回退） */
  root: string | null;
  /** 是否用了 userData 回退 */
  fallback: boolean;
  /** 落点现在能不能写 */
  writable: boolean;
  /** 人读：为什么是这个落点 */
  reason: string;
  /** 向量索引落点 */
  index: string | null;
  /** 元数据（node:sqlite，可重建）落点 */
  db: string | null;
  /** 事务日志目录落点 */
  journal: string | null;
  /** staging 目录名（**唯一来源**是引擎的 STAGING_DIRNAME） */
  stagingDirName: string;
  /** staging 落点的语义说明（它不是全局一个目录，见下） */
  stagingNote: string;
}

export interface ResolveLibraryStorageOptions {
  userDataDir?: string | null;
  /** 是否允许写探测（默认 true）。关掉 = 纯只读解析，代价是 ACL 拒绝的库根会被误判可写 */
  probeWrites?: boolean;
  fs?: StorageFs;
}

function makeLibraryStorage(args: {
  libId: string;
  declaredRoot: string;
  root: string | null;
  fallback: boolean;
  writable: boolean;
  reason: string;
}): LibraryStorage {
  const { libId, declaredRoot, root, fallback, writable, reason } = args;
  return {
    libId,
    declaredRoot,
    root,
    fallback,
    writable,
    reason,
    index: root === null ? null : path.join(root, GS_INDEX_NAME),
    db: root === null ? null : path.join(root, GS_DB_NAME),
    journal: root === null ? null : path.join(root, GS_JOURNAL_NAME),
    stagingDirName: STAGING_DIRNAME,
    // ⚠️ 不能写成"库根/.gs-staging/"就完事：引擎实现是**每个写入目标所在目录**下一份
    //    （steps.ts/executor.ts：同卷 rename 才原子），SPEC §2 的布局图只是示意层级。
    //    事务语义不许改（TASKS §2「保留逻辑」），所以这里如实描述，不发明一个全局路径。
    stagingNote: `暂存目录是**每个写入目标所在目录**下一份（<目标目录>/${STAGING_DIRNAME}/<txnId>/），不是全局一个 —— 同卷 rename 才能原子；扫描素材时必须跳过 .gs-* 与 ${STAGING_DIRNAME}/`,
  };
}

/**
 * 解析一个库的三类落点。
 *
 * 规则（T-04）：库根可写 ⇒ 就用库根；**库根不可写 ⇒ 回退 userData**，并把原因写成人话。
 * 不抛异常：库根是坏盘 / 权限不足 / 盘符没了，应用都得能起来并把话说清楚。
 */
export function resolveLibraryStorage(
  lib: LibraryRootInput,
  opts: ResolveLibraryStorageOptions = {},
): LibraryStorage {
  const fsImpl = opts.fs ?? NODE_FS;
  const probeWrites = opts.probeWrites !== false;
  const userDataDir = opts.userDataDir ?? null;
  const libId = safeLibIdSegment(lib.libId);
  const declaredRoot = path.resolve(lib.root || '');
  const at = (dir: string): WriteProbe => (probeWrites ? probeWritable(dir, fsImpl) : existenceOnlyProbe(dir, fsImpl));

  const declaredProbe = at(declaredRoot);

  if (declaredProbe.writable) {
    // ⚠️ probeWrites=false 时 declaredProbe 只看了存在性 —— 理由必须照实说，
    //    不许把"没探测过"写成"可写"（这条路径会被日志原样打给人看）。
    const why = probeWrites
      ? `库根可写（写探测：${declaredProbe.reason}）`
      : '库根存在，但**未做写探测**（probeWrites=false），可写性未验证';
    return makeLibraryStorage({
      libId,
      declaredRoot,
      root: declaredRoot,
      fallback: false,
      writable: true,
      reason: `${why} ⇒ 索引 / 元数据 / 事务日志都写在**库根本身**（${declaredRoot}）`,
    });
  }

  if (!userDataDir) {
    return makeLibraryStorage({
      libId,
      declaredRoot,
      root: null,
      fallback: false,
      writable: false,
      reason:
        `库根不可用（${declaredProbe.reason}），且没有 userData 可以回退 ⇒ ` +
        '索引 / 元数据 / 事务日志**没有落点**。先解决库根（盘是否挂载 / 目录权限），或给应用一个可写的 userData。',
    });
  }

  const fallbackRoot = path.join(userDataDir, USERDATA_LIBS_DIRNAME, libId);
  const fbProbe = at(fallbackRoot);
  const userDataIsDir = fsImpl.existsSync(userDataDir) && fsImpl.isDirectory(userDataDir);
  const fbReason = fbProbe.writable
    ? `回退目录已存在且可写（${fallbackRoot}）`
    : fbProbe.code === 'ENOENT'
      ? (userDataIsDir
          ? `回退目录尚未创建（${fallbackRoot}）—— 首次写入时按需创建`
          : `回退目录尚未创建，且 userData 本身不存在（${fallbackRoot}）`)
      : `回退目录不可写（${fbProbe.reason}）`;

  return makeLibraryStorage({
    libId,
    declaredRoot,
    root: fallbackRoot,
    fallback: true,
    writable: fbProbe.writable,
    reason:
      `库根不可写 ⇒ 回退 userData。原因为：${declaredProbe.reason}。` +
      `落点 = ${fallbackRoot}；${fbReason}`,
  });
}

// ---------------------------------------------------------------- 总入口

export interface ResolveStorageRootsOptions {
  appDir: string;
  userDataDir?: string | null;
  /** library-config.ts 解析出的库列表（空/缺省 = 还没有库） */
  libraries?: LibraryRootInput[];
  userModelDir?: string | null;
  /** 既有 model-cache 的基目录（config.model_cache 或 <程序目录>/../model-cache） */
  modelCacheDir?: string | null;
  probeWrites?: boolean;
  fs?: StorageFs;
}

export interface StorageRootsResult {
  appDir: string;
  userDataDir: string | null;
  probeWrites: boolean;
  models: ModelResolution;
  libraries: LibraryStorage[];
  /** 其他需要一并说清的事（例如"一个库都没有"） */
  notes: string[];
}

/** 解析模型 + 每个库的三类落点。**纯函数**：不读全局、不建目录。 */
export function resolveStorageRoots(opts: ResolveStorageRootsOptions): StorageRootsResult {
  const fsImpl = opts.fs ?? NODE_FS;
  const userDataDir = opts.userDataDir ?? null;
  const probeWrites = opts.probeWrites !== false;

  const models = resolveModels({
    appDir: opts.appDir, userDataDir,
    userModelDir: opts.userModelDir, modelCacheDir: opts.modelCacheDir, fs: fsImpl,
  });

  const libs = opts.libraries ?? [];
  const libraries = libs.map((l) => resolveLibraryStorage(l, { userDataDir, probeWrites, fs: fsImpl }));

  const notes: string[] = [];
  if (!libraries.length) {
    notes.push(
      '没有已解析的库 ⇒ 索引 / .gs.db / 事务日志暂时没有落点；先解决「库从哪来」' +
      '（GEMMA_LIB_ROOT / userData 注册表 / data/libraries/* 索引自举，四条路见 library-config.ts）',
    );
  }
  return { appDir: opts.appDir, userDataDir, probeWrites, models, libraries, notes };
}

/**
 * 把解析结果渲染成**可读的日志行**（T-04 的"打印当前落点 + 为什么"就靠它）。
 *
 * 为什么单独一个函数：日志文案要在 node:test 里断言（"理由可读"是可验收项），
 * 而 index.ts 加载不了（它 import electron）。
 */
export function describeStorageRoots(r: StorageRootsResult): string[] {
  const out: string[] = [];
  const srcLabel = (s: ModelSource | null): string =>
    s === 'app' ? '程序目录 models/' : s === 'userData' ? 'userData models/' : s === 'user' ? '用户指定' : '(无)';

  out.push(`程序目录 = ${r.appDir}`);
  out.push(`userData = ${r.userDataDir ?? '(不可用)'}`);
  out.push(
    `写探测 = ${r.probeWrites
      ? '开启（在已存在的目录里写一个 .gs-write-probe-* 临时文件再删；不用 fs.access(W_OK) —— Windows 上它对 ACL 拒绝的目录会假报可写）'
      : '关闭（只看存在性，可写性未验证）'}`,
  );

  if (r.models.found) out.push(`模型 = ${r.models.found}（来源：${srcLabel(r.models.source)}）`);
  else out.push('模型 = **未找到**（在找到模型之前不会显示任何检索结果 —— 不假装可用）');
  out.push(`模型搜索顺序 = ${modelSearchOrderText()}`);
  for (const c of r.models.searched) out.push(`  ${c.order}. ${c.label} = ${c.dir} ⇒ ${c.reason}；${c.writeReason}`);
  if (r.models.installDir) {
    out.push(`模型建议放置目录 = ${r.models.installDir}（搜索顺序里第一个可写的候选；安装目录通常不可写，见 PLAN R8）`);
  } else if (!r.models.found) {
    out.push('模型候选目录现在都不可写：需要先建出 <程序目录>/models 或 <userData>/models，或在设置里指向一个可写目录。');
  }
  if (r.models.guidance) for (const line of r.models.guidance.split('\n')) out.push(`模型指引：${line}`);

  for (const l of r.libraries) {
    out.push(`库 ${l.libId}：声明库根 = ${l.declaredRoot}`);
    out.push(
      `库 ${l.libId}：落点 = ${l.root ?? '(无可用落点)'}${l.fallback ? '（**回退 userData**）' : '（用库根本身）'}` +
      `；为什么 = ${l.reason}`,
    );
    if (l.root !== null) {
      out.push(
        `库 ${l.libId}：索引 ${l.index ?? ''} · 元数据 ${l.db ?? ''} · 事务日志 ${l.journal ?? ''} · ` +
        `暂存 ${l.stagingDirName}/<txnId>/（${l.stagingNote}）`,
      );
    }
  }
  for (const n of r.notes) out.push(`说明：${n}`);
  return out;
}

// apps/desktop/src/main/index.ts —— Electron 主进程（P2）
//
// 职责（SPEC-security §2–§5）：
//   · 组装引擎（注入 ONNX 编码器端口）—— 库来源见 library-config.ts（D2 修复）
//   · 只开两个 IPC 通道：engine:invoke / engine:event
//   · 每个调用先做**来源校验**，再过**zod 白名单**，最后才打引擎
//   · 窗口姿态：nodeIntegration:false / contextIsolation:true / sandbox:true
//   · 拒绝新窗口与外部导航
//
// 刻意不做：不引 HTTP 端口、不加载任何远程内容、不自动更新。
//
// ── 本文件是 `app/main/index.mjs` 的迁移版（2026-10-10，electron-vite 工程化）──
// 行为保持逐条一致，只改三类事：① 资源路径（out/ 布局）② dev 态加载方式
// （`ELECTRON_RENDERER_URL`，见 electron.vite.config.mjs）③ 编码器改成**按需动态导入**
// （这样 transformers 的导入期失败可被捕获并报给界面，而不是让进程无声消失）。
//
// 2026-10-14：本文件由 `index.mjs` 转为 `.ts`（全量 TypeScript）。
// **安全语义逐字未改**：两条 IPC 通道与显式分派、来源校验、`thumb://` 形状/尺寸白名单与
// 400/404/403/415/503 映射、窗口三决策（来源校验/新窗口/导航）—— 只补类型。
//
// Electron 的 `electron` 模块在 ESM 下用默认导入再解构最稳：**具名导入会在
// 实例化阶段抛**，那时任何日志都来不及写（见下面的自愈分支）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, log } from './log.ts'; // ← 必须最先导入：导入即初始化日志
import { createEngine, UNIMPLEMENTED_METHODS } from '../../../../packages/engine/src/engine.ts';
import { CH_INVOKE, CH_EVENT, validateCall, METHOD_NAMES } from '../shared/ipc.ts';
import type { Envelope, MethodName, Req } from '../shared/ipc.ts';
import { resolveLibraries, registryPath } from './library-config.ts';
import type { MainConfig, ResolveLibrariesResult } from './library-config.ts';
import {
  resolveStorageRoots,
  describeStorageRoots,
  probeWritable,
  resolveModels,
} from './storage-roots.ts';
import type { ModelResolution } from './storage-roots.ts';
import type { GpuProbe } from './encoder-device.ts';
import { createSingleFlight } from './single-flight.ts';
import { decideWindowBounds, readSavedBounds, persistBounds } from './window-state.ts';
import type { BoundsDecision } from './window-state.ts';
import { createRevealPort } from './ports.ts';
import { createLibraryResolverPort, createStoragePorts } from './storage-ports.ts';
import { runLibraryHealth, runLibraryRebuild } from './library-ipc.ts';
import { runItemsQuery } from './items-ipc.ts';
import type { ItemsQueryParams } from './items-ipc.ts';
import { crashUnhealthyState, installCrashPolicy } from './crash-policy.ts';
import { queryAppHealth } from './app-health.ts';
import {
  appDbPath,
  deleteCollectDir,
  deleteLibrary,
  getLibrary,
  insertCollectDir,
  insertLibrary,
  listCollectDirs,
  listLibraries,
  normalizeRootPath,
  openAppDb,
  readAppMeta,
  setDefaultCollectDir,
  updateLibraryEnabled,
  updateLibraryRootAndName,
  updateLibrarySortOrder,
} from './app-db.ts';
import { removeGsDbFiles } from './db/index.ts';
import { GS_DB_NAME, GS_INDEX_NAME } from './storage-roots.ts';
import type { CollectDirRow, LibraryRow } from './app-db.ts';
import type { SqlDatabase } from './db/index.ts';
import { configureProcessTempDir } from './db/tmp-dir.ts';
import type { StoragePorts } from '../../../../packages/engine/src/storage-ports.ts';
import { parseThumbUrl, createLibIdResolver } from './thumb-url.ts';
import {
  thumbCachePath,
  readCachedThumb,
  writeCachedThumb,
  thumbServeStatus,
} from './thumb-cache.ts';
import {
  isTrustedSender as isTrustedSenderImpl,
  decideWindowOpen,
  decideNavigation,
} from './window-security.ts';
import type { InvokeEventLike } from './window-security.ts';
import type { Encoder } from './encoder.ts';
import type { SampleIndex } from '../../../../packages/engine/src/fake.ts';

import electron from 'electron';
import type { OpenDialogOptions } from 'electron';
const { app, BrowserWindow, ipcMain, protocol, nativeImage, dialog, shell, screen } = electron;
/** 本文件所在目录：dev/预览态是 `<根>/out/main`，打包态在 asar 内 */
const HERE: string = path.dirname(fileURLToPath(import.meta.url));

/** dev 态页面地址（由 electron-vite dev 注入；打包/预览态为空） */
const DEV_RENDERER_URL: string = process.env.ELECTRON_RENDERER_URL || '';

/**
 * 模拟模式（契约 `CONTRACT-engine-v1.md` §8「UI 用的测试数据与模拟接口」）。
 *
 * ⚠️ **只由显式环境变量打开**，绝不因为"检测到没有库"之类的条件自动生效 ——
 * 那会让"以为在看真库、其实在看样例"成为可能，而本项目最危险的失败模式就是**静默**。
 * 打开时 `buildEngine()` 会**大声记日志**（见那里的三条 log）。
 * 用法：`GEMMA_FAKE=1 npm run dev`（P3c/P3d 的界面开发与 E2E 靠它摆脱 ONNX 模型）。
 */
const FAKE_MODE: boolean = process.env.GEMMA_FAKE === '1';

/** 模拟模式的库根：与 `fixtures/sample-index.json` 的 `root` 一致，且本机不存在（见 fake.test.mjs 的 F1） */
const FAKE_LIB_ROOT = 'Z:\\__fake_library__';

/** catch / 事件回调里的 unknown → message 文案（与旧 `e.message` 同口径） */
function messageText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** catch / 事件回调里的 unknown → 错误码（旧 `e.code` 的口径；没有就空串） */
function codeText(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return '';
}

/** catch / 事件回调里的 unknown → 优先 stack 的文案（旧 `e && e.stack ? e.stack : …` 同口径） */
function stackText(e: unknown): string {
  if (e instanceof Error && e.stack) return e.stack;
  if (e && typeof e === 'object' && 'stack' in e) {
    const s = (e as { stack?: unknown }).stack;
    if (typeof s === 'string' && s) return s;
  }
  return String(e);
}

/** 与旧日志写法同口径：成功记 'ok'，失败记错误码（拿不到就空串） */
function resultCode(res: unknown): string {
  if (res && typeof res === 'object') {
    const rec = res as { ok?: unknown; error?: { code?: unknown } };
    if (rec.ok) return 'ok';
    const code = rec.error ? rec.error.code : undefined;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * 读模拟模式的样例索引（契约 §8 的 `fixtures/sample-index.json`）。
 *
 * 路径**从 `ROOT` 算**（主进程本来就知道仓库根），不用 `import.meta.url` —— 后者在打包后
 * 指向 `out/main/index.js`，上溯会落到仓库外（实测把主进程崩在建窗之前）。
 * ⚠️ 读不到就**抛**：模拟模式读不到数据却继续跑，只会让人以为"样例就是这样"，比崩更坏。
 */
function loadFakeFixture(): SampleIndex {
  const p = path.join(ROOT, 'fixtures', 'sample-index.json');
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw as SampleIndex;
  } catch (e) {
    throw new Error(
      `GEMMA_FAKE=1 但读不到样例索引：${p}\n` +
        `（原样错误：${messageText(e)}）\n` +
        '模拟模式需要仓库里的 fixtures/sample-index.json —— 打包态不含它，所以模拟模式只用于开发与 E2E。',
    );
  }
}

// ---------------------------------------------------------------- 运行环境自愈（§9 排障）
//
// `ELECTRON_RUN_AS_NODE=1` 会让 Electron 以**纯 Node** 运行，于是 `electron`
// 解析到 npm 包装包（一个 75 字符的 electron.exe 路径字符串），报错极具误导性：
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@huggingface/transformers'
//   SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
//   TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
// 对"这是一个 Electron 应用"而言意图毫无歧义，所以这里去掉该变量重新拉起自己。
if (process.env.ELECTRON_RUN_AS_NODE || !app || typeof app.whenReady !== 'function') {
  if (DEV_RENDERER_URL) {
    // dev 态**不能**自愈：dev server 由父进程（electron-vite）持有，
    // 重生一个 detached 实例会立刻失去它 —— 结果是"窗口开了但一片空白"。
    log('!! dev 态下 ELECTRON_RUN_AS_NODE 生效，无法自愈（重生会丢掉 dev server）');
    log(
      '   处理：用 `npm run dev`（该脚本会先清掉这个变量），或先 $env:ELECTRON_RUN_AS_NODE=$null',
    );
    process.exit(3);
  }
  log('ELECTRON_RUN_AS_NODE 生效（或 Electron API 不可用）→ 去掉该变量后重新拉起自身');
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, process.argv.slice(1), {
      env: cleanEnv,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    log('已拉起新进程 pid =', child.pid);
    process.exit(0);
  } catch (e) {
    log('!! 自愈失败：', e);
    process.exit(3);
  }
}

// ---------------------------------------------------------------- 配置（D2 修复：见 library-config.ts 文件头）
//
// 库从哪来 = 四条路按优先级：GEMMA_LIB_ROOT > userData 注册表 > config.json > 已有索引自举。
// 其中「索引自举」让**已有索引的机器零配置可用**（索引的 meta.json 本就存着 lib_id + lib_root）。
//
// ⚠️ `config.json` **不是要求用户去配的东西** —— 它只是最下面那条兼容回退。
//    它已随 Python 档退役被删除，仓库里也没有模板，所以正常情况下这一层就是空的。
function loadConfig(): { data: MainConfig; path: string | null } {
  const candidates = [process.env.GEMMA_CONFIG, path.join(ROOT, 'config.json')].filter(
    (p): p is string => Boolean(p),
  );
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const c: unknown = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
        log('配置来源', p);
        return { data: c as MainConfig, path: p };
      } catch (e) {
        log('配置读取失败', p, messageText(e));
      }
    }
  }
  return { data: {}, path: null };
}

const _cfg = loadConfig();
const config = _cfg.data;
const CONFIG_PATH = _cfg.path;
const DATA_DIR: string = config.data_dir || path.join(ROOT, 'data');

// userData：`app.getPath` 在 app ready 之前不可靠，所以延到 whenReady 里再解析。
// 但 `buildEngine()` 需要库列表，故用**惰性** getter —— 模块加载期零副作用，
// 也不会"只是启动了一下"就往用户目录写东西（写注册表只发生在 libraryAdd 被调用时）。
let USER_DATA_DIR: string | null = null;
let RESOLVED: ResolveLibrariesResult | null = null;

/**
 * 应用级 app.db 的一次性访问（打开 → 用 → 关）。
 *
 * ⚠️ 应用级 = **app.db**（<userData>/app.db），与库级 `.gs.db` 是**两套账本**（schema-layers.ts 的落点裁定）。
 * ⚠️ 任何失败都**不抛给 IPC**：返回 {ok:false} 并记日志，由调用方给出诚实结果 —— 信封要求"永不抛"。
 * ⚠️ app.db 的读写**只走 main/app-db.ts**（那里是 3 张应用表的唯一写入口，测试会静态钉住）。
 */
function withAppDb<T>(
  fn: (db: SqlDatabase) => T,
): { ok: true; value: T } | { ok: false; why: string } {
  if (!USER_DATA_DIR) return { ok: false, why: 'userData 未初始化（应用还没准备好）' };
  try {
    const app = openAppDb({ userDataDir: USER_DATA_DIR });
    try {
      return { ok: true, value: fn(app.db) };
    } finally {
      app.close();
    }
  } catch (e) {
    log('!! app.db 操作失败:', stackText(e));
    return { ok: false, why: messageText(e) };
  }
}

/**
 * app.db 里的库元数据（enabled / sort_order）。
 * **缺行 = 默认启用**：绿地口径下只有"用户显式停用/排序过"的库才有行（注册表记录的是用户意图）。
 */
/** `libraryList` 里一个库的形状（发现结果 + app.db 里的用户意图） */
interface LibraryView {
  libId: string;
  root: string;
  label: string;
  source: string;
  enabled: boolean;
  sortOrder: number;
  itemCount: number | null;
  registered: boolean;
}

/** app.db 操作失败 → 失败信封（**永不抛**；userMessage 恒非空） */
function appDbErrorEnvelope(why: string, what: string): Envelope {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: what + '失败：' + why,
      userMessage: '应用数据（app.db）读写失败，这次改动没有生效。详情见日志。',
      details: { what },
    },
  };
}

function registryMeta(): Map<string, LibraryRow> {
  const r = withAppDb((db) => listLibraries(db));
  return r.ok ? new Map(r.value.map((row: LibraryRow) => [row.libId, row])) : new Map();
}

/** 给「没登记过的库」补一行（用户第一次对它做写操作时）—— 只被写操作调用 */
function ensureLibraryRow(
  libId: string,
  root: string,
  label: string,
): { ok: true } | { ok: false; why: string } {
  const r = withAppDb((db) => {
    const existing = getLibrary(db, libId);
    if (existing) {
      // 库根可能变了（盘符/目录改名）：以**当前发现到的 root** 为准，如实更新
      // ⚠️ 走 app-db 的写入口（§2.3 唯一写入口；静态测试 D4 会抓"调用方自己写 SQL"）
      return updateLibraryRootAndName(db, libId, root, existing.displayName);
    }
    insertLibrary(db, { libId, root, displayName: label });
    return getLibrary(db, libId);
  });
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}
function librariesResolved(): ResolveLibrariesResult {
  if (!RESOLVED) {
    RESOLVED = resolveLibraries({
      dataDir: DATA_DIR,
      userDataDir: USER_DATA_DIR,
      config,
      configPath: CONFIG_PATH,
      envLibRoot: process.env.GEMMA_LIB_ROOT || '',
      // P3（2026-10-13）：取件目录也有了配置入口，与库根同惯例。
      // 不设它就用 SPEC 兜底值（`E:\素材待用` / `E:\移出素材`）—— 非 E: 盘的机器应显式设这个。
      envCollectDirs: process.env.GEMMA_COLLECT_DIRS || '',
    });
  }
  return RESOLVED;
}

/** 注册表变了（libraryAdd）后让解析结果与引擎一起失效重建 */
function invalidateLibraries(): void {
  RESOLVED = null;
  engine = null;
}

/**
 * 模型搜索 —— **唯一实现是 storage-roots.ts**（T-17 收敛）。
 *
 * 这里只做"把四个输入喂进去"：程序目录 / userData / 用户指定（config.onnx_model_dir）/
 * 既有 model-cache 基目录。**顺序与"像不像模型目录"的判据都不在本文件** ——
 * 原先那个 `resolveModelDir()` 自带一份 model_cache 扫描 + 一份 onnx/model.onnx 判据，
 * 与 storage-roots 的 MODEL_SEARCH_ORDER 构成两处实现（P1），且它不认「程序目录 models/」，
 * 导致"把模型放进程序目录"实际不通（T-04c 实跑坐实）。
 */
function modelCacheBase(): string {
  return typeof config.model_cache === 'string' && config.model_cache
    ? config.model_cache
    : path.join(ROOT, '..', 'model-cache');
}

function resolveModel(): ModelResolution {
  return resolveModels({
    appDir: storageAppDir(),
    userDataDir: USER_DATA_DIR,
    userModelDir: typeof config.onnx_model_dir === 'string' ? config.onnx_model_dir : null,
    modelCacheDir: modelCacheBase(),
  });
}

// ---------------------------------------------------------------- 存储落点（T-04 · SPEC §2）
//
// 为什么在这里打印：三类落点（模型 / 索引与 .gs.db / 事务日志）此前散在好几处，
// 没有一处能回答"现在落在哪、为什么"。解析逻辑全在 `storage-roots.ts`（可 node:test），
// 这里**只接线 + 打日志**。
//
// ⚠️ 库从哪来 = library-config.ts 的四条路（GEMMA_LIB_ROOT / 注册表 / config / 索引自举）。
// T-17 起：**模型搜索也只剩这一处**（resolveModel → storage-roots.resolveModels），
// 落点、顺序、判据、"为什么"全在同一份实现里，日志直接打印它的结果。
function storageAppDir(): string {
  try {
    // 打包态：exe 所在目录就是 SPEC §2 的「程序目录」（models/ 放它下面）；
    // dev 态没有 exe，用仓库根。
    return app.isPackaged ? path.dirname(app.getPath('exe')) : ROOT;
  } catch {
    return ROOT;
  }
}

function logStorageRoots(): void {
  try {
    const r = librariesResolved();
    const roots = resolveStorageRoots({
      appDir: storageAppDir(),
      userDataDir: USER_DATA_DIR,
      libraries: r.libraries.map((l) => ({ libId: l.libId, root: l.root })),
      // 「用户指定」这一位 = config.json 既有的 onnx_model_dir（没有就跳过这一位）
      userModelDir: typeof config.onnx_model_dir === 'string' ? config.onnx_model_dir : null,
      // 第四位 = 既有 model-cache 布局（本机现在就是靠它跑起来的，不能丢）
      modelCacheDir: modelCacheBase(),
    });
    log('[存储] ======== 本次启动的落点 ========');
    for (const line of describeStorageRoots(roots)) log('[存储]', line);
    // 编码器实际用哪个 = 同一份解析结果（T-17 收敛后不再有第二条路）
    log(
      '[存储] 编码器实际将使用的模型目录 =',
      roots.models.found ?? '(无 —— 检索会以 MODEL_MISSING 失败，不给假结果)',
    );
  } catch (e) {
    // 落点解析失败不许拦住启动：库根是坏盘 / 权限不足时，应用更要把话说清楚再继续。
    log('!! 存储落点解析失败（不影响启动）:', stackText(e));
  }
}

// ---------------------------------------------------------------- 引擎
type EngineApi = ReturnType<typeof createEngine>;
let engine: EngineApi | null = null;
let encoder: Encoder | null = null;
let encoderError: unknown = null;
const winRef: { win: electron.BrowserWindow | null } = { win: null };

function emit(evt: unknown): void {
  if (winRef.win && !winRef.win.isDestroyed()) winRef.win.webContents.send(CH_EVENT, evt);
}

/**
 * 按契约方法名取引擎方法（名字已过 `validateCall` 的白名单）。
 *
 * 为什么要这个函数：引擎把公开方法放在一个对象上（未实现的那 6 个是生成式挂上去的），
 * 而调用点的名字来自**运行时** IPC 消息 —— 静态上无法把它与具体属性关联，
 * 所以这里显式收成「函数或 null」（拿不到就走原先的「引擎无此方法」分支），而不是把类型整体放宽。
 */
/** 引擎方法的统一调用形状（IPC 载荷是 unknown ⇒ 入参只能收成 unknown） */
type EngineMethodFn = (req: unknown) => Promise<unknown>;

/**
 * `MethodName` 里**引擎真的有的**那些名字。
 *
 * ⚠️ DF-7 C：原实现用 `eng as unknown as Record<string, unknown>` 绕过类型系统 ⇒
 *    「引擎少暴露一个方法」「名字写错」都只能等**运行时**才炸。
 *    这个映射类型把不在 `EngineApi` 上的名字映射成 `never` ⇒
 *    用这种名字调 `engineMethod` 会**编译失败**（能红 = 类型门禁），而不是运行时返回 null。
 */
type EngineBackedMethod = { [K in MethodName]: K extends keyof EngineApi ? K : never }[MethodName];

/**
 * 运行时判定：引擎真的有这个方法吗？
 * **这是唯一一处「运行时方法名 → 类型收窄」的桥**；收窄之后调用点才能用 EngineBackedMethod 调 engineMethod。
 * 赋值给 `Partial<Record<MethodName, unknown>>` 是**结构化赋值、没有 as**：引擎多出来的键无所谓。
 */
function isEngineBackedMethod(eng: EngineApi, method: MethodName): method is EngineBackedMethod {
  const table: Partial<Record<MethodName, unknown>> = eng;
  return typeof table[method] === 'function';
}

function engineMethod(eng: EngineApi, method: EngineBackedMethod): EngineMethodFn | null {
  const table: Partial<Record<MethodName, unknown>> = eng;
  const fn = table[method];
  // 仅剩的一处收窄：各引擎方法签名不同，统一入口只能是 (req: unknown) => Promise<unknown>；
  // 上面已做 typeof 判定 ⇒ 这是运行时安全的收窄，不是绕过类型系统。
  return typeof fn === 'function' ? (fn as EngineMethodFn) : null;
}

/**
 * 存储端口（T-16b 的实现 + T-16c 的接线）：把 .gs.db / <库根>/.gs-index.bin / 库落点交给引擎。
 *
 * ⚠️ **只在真实模式装配**：`GEMMA_FAKE=1` 时返回 null —— 模拟模式的 e2e（62 条）必须**逐字不受影响**。
 *    （引擎在 fake 下走 fakeKit，压根不看 storage；这里连装都不装，省掉无谓的落点解析。）
 * ⚠️ 回落**明说**：ItemStorePort 找不到 .gs.db 时走 onFallback → 项目的 log()（统一落盘 data/_app.log），
 *    不散落 console.warn。
 * ⚠️ 装配失败**不拦启动**：大声记日志后回落到旧布局（引擎不注入 storage 时的既有行为，
 *    即 `<dataDir>/libraries/<libId>/{index.bin,items.json,meta.json}`）——
 *    与 logStorageRoots() 同一哲学：库根是坏盘/权限不足时，应用更要把话说清楚再继续。
 */
function buildStoragePorts(r: ResolveLibrariesResult): StoragePorts | null {
  try {
    const libraries = createLibraryResolverPort({
      libraries: r.libraries.map((l) => ({ libId: l.libId, root: l.root, label: l.label })),
      userDataDir: USER_DATA_DIR,
      // 迁移期：旧布局（<dataDir>/libraries/<libId>/index.bin）也要认 —— 判据只有引擎那一份（T-44）
      legacyLibrariesDir: path.join(DATA_DIR, 'libraries'),
    });
    const ports = createStoragePorts({
      libraries,
      onFallback: (m: string) => log('[存储][回落]', m),
    });
    log(
      '[存储] 端口已装配：items ← .gs.db（无则回落 items.json）· index ← 新布局库根 / 旧布局回退（T-44 唯一判据）· libraries ← 注册表 + T-04 落点',
    );
    return ports;
  } catch (e) {
    log('!! 存储端口装配失败（本次回落到旧布局 <dataDir>/libraries/<libId>）:', stackText(e));
    return null;
  }
}

function buildEngine(): ResolveLibrariesResult {
  const resolved = librariesResolved();
  // ⚠️ S6：`enabled = 0` 的库**不参与检索与入库**（设计基线 §1.1 的 DDL 注释）。
  //    注意：**不动任何文件** —— 停用只是"这次不给引擎"；库列表（libraryList）照样把它列出来。
  const meta = registryMeta();
  const active = resolved.libraries.filter((l) => meta.get(l.libId)?.enabled !== false);
  if (active.length !== resolved.libraries.length) {
    log(
      '[库] 停用的库不参与检索：',
      resolved.libraries.length - active.length,
      '个（共',
      resolved.libraries.length,
      '）',
    );
  }
  const r: ResolveLibrariesResult = { ...resolved, libraries: active };
  engine = createEngine({
    config: {
      libraries: r.libraries,
      data_dir: DATA_DIR,
      collect: { dirs: r.collect.dirs, default: r.collect.default },
    },
    encoder: {
      // 延迟到真正检索时才载模型：冷启动要 ≤5s，不能把 2.6s 的模型载入挡在出窗之前
      async encodeText(t: string) {
        const e = await ensureEncoder();
        return e.encodeText(t);
      },
      async encodeImage(p: string) {
        const e = await ensureEncoder();
        return e.encodeImage(p);
      },
    },
    onEvent: emit,
    // ⚠️ **必须注入**（F-01）：不注入的话引擎会返回 PORT_MISSING 而不是静默假成功。
    // 引擎不 import electron，所以"在资源管理器里定位"这个能力只能由外壳这样交进去。
    // 端口本身只负责调用；成功/失败的判定在引擎里（见 ports.ts 的注释）。
    shell: createRevealPort(shell),
    // 存储端口（T-16c 接线）：真实模式才装 —— 见 buildStoragePorts 的三条注释。
    // 不注入（fake 模式）时引擎走旧布局，与改造前逐字一致。
    storage: FAKE_MODE ? null : buildStoragePorts(r),
    // 模拟模式（契约 §8）：`GEMMA_FAKE=1` ⇒ 无模型、无真实库，界面可演示全部状态。
    // ⚠️ 只由**显式环境变量**打开，且启动时**大声记日志**（见下面的 log）—— 绝不静默生效。
    //
    // ⚠️ **fixture 由主进程读、再注入引擎**，不在引擎里按 `import.meta.url` 找文件。
    //    实测踩过：引擎源码里 `../../../fixtures/…` 在**打包后**会解成 `D:\fixtures\…`
    //    （`import.meta.url` 变成了 `out/main/index.js`）⇒ `readFileSync` 抛 ⇒ **主进程崩在建窗之前**
    //    ⇒ 症状是"窗口永远不出现"，跟"没有库"完全不像，很费时间。
    //    由主进程注入还顺带保住了引擎自己的设计原则：**传输无关、依赖全部注入**。
    fake: FAKE_MODE ? { fixture: loadFakeFixture() } : false,
  });
  if (FAKE_MODE) {
    log('⚠️⚠️ 模拟模式已开启（GEMMA_FAKE=1）：**没有真实素材库、没有模型、不读任何素材文件**。');
    log(
      '        catalog 来自 fixtures/sample-index.json；ingest/mutate 只在内存里改，进程退出即消失。',
    );
    log('        这只用于界面开发与 E2E —— 看到这条日志就说明当前**不能**用来判断检索质量。');
  }
  log(
    '引擎就绪 · 库',
    r.libraries.map((l) => `${l.libId}=${l.root}[${l.source}]`).join(', ') || '(无)',
  );
  // 诊断与警告写进日志：出问题时第一手材料就是 data/_app.log
  for (const d of r.diagnostics) log('[cfg]', d);
  for (const w of r.warnings) log('[cfg][warn]', w);
  log('[cfg] 取件白名单', JSON.stringify(r.collect.dirs), '默认', r.collect.default);
  return r;
}

/**
 * GPU 可用性探测（T-31 / S2b · 选 (a) 的理由见下方）。
 *
 * **为什么是"主进程主动问渲染进程"，而不是"渲染层 invoke 告诉主进程"**：
 *   · 权威来源只能是**渲染进程**（只有那里有真 navigator.gpu；主进程是 Node 上下文，
 *     transformers 甚至把"WebGPU 可用"恒置为真 —— 见 encoder-device.ts 文件头）；
 *   · 而 (a) 用 webContents.executeJavaScript **不需要新增 IPC 方法** ⇒ 不动 shared/ipc.ts 与 SPEC §5
 *     （契约变更必须先经所有者批准）。所以选 (a)。
 *
 * ⚠️ 方向性：探测只说"**能不能**用 GPU"，不说"**是不是**在用"。
 *   探测失败/超时一律按 **null（拿不到结论）** 处理 —— 那种情况下我们保留请求值，
 *   但 effectiveProvider 记 null（不许猜）；只有明确 false 才会退到 cpu。
 *
 * 结果**缓存一次**：requestAdapter 有成本，且同一进程里 GPU 可用性不会来回变。
 */
let gpuProbeCache: GpuProbe | null = null;
async function probeGpu(): Promise<GpuProbe> {
  if (gpuProbeCache) return gpuProbeCache;
  const win = winRef.win;
  if (!win || win.isDestroyed()) {
    gpuProbeCache = { available: null, detail: '探测时没有可用窗口（拿不到结论，不猜）' };
    return gpuProbeCache;
  }
  let result: GpuProbe;
  try {
    // 渲进程里跑：与主进程共用同一个 GPU 进程 / Dawn 栈（**推断**，见下）；超时保证不拖住编码器。
    const script =
      '(async () => {' +
      ' if (!navigator.gpu) return { available: false, detail: "渲染进程里没有 navigator.gpu" };' +
      ' try { const a = await navigator.gpu.requestAdapter();' +
      '   return a ? { available: true, detail: "requestAdapter 返回了适配器" }' +
      '            : { available: false, detail: "requestAdapter 返回 null（没有可用适配器）" }; }' +
      ' catch (e) { return { available: false, detail: "requestAdapter 抛错：" + String(e) }; }' +
      ' })()';
    const raw: unknown = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise((res) => setTimeout(() => res(null), 5000)),
    ]);
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { available?: unknown }).available === 'boolean'
    ) {
      const r = raw as { available: boolean; detail?: unknown };
      result = { available: r.available, detail: String(r.detail ?? '(无详情)') };
    } else {
      result = { available: null, detail: '探测超时或返回形状不可用（拿不到结论，不猜）' };
    }
  } catch (e) {
    result = { available: null, detail: '探测抛错：' + messageText(e) };
  }
  gpuProbeCache = result;
  log('[设备] GPU 探测：available=' + String(result.available) + ' · ' + result.detail);
  return result;
}

/**
 * T-41：**并发只允许一次载入**。
 *
 * 原先 ensureEncoder 只挡「已经有 encoder」，不挡「正在加载」⇒ 启动预热与用户检索并发时
 * 各自走完整个载入流程。实测（data/_t41）：并发 3 次检索 ⇒ 日志 3 行「载入完成」，模型被加载 3 次。
 * 现在把「进行中的那一次」收进 single-flight（纯模块 + 单测）：并发 N 次只调用一次 factory。
 * ⚠️ 失败语义**不变**：loadEncoderOnce 仍把错误记在 encoderError 上 ⇒ 后续调用直接抛同一个错，不重试。
 */
const encoderFlight = createSingleFlight<Encoder>();

async function ensureEncoder(): Promise<Encoder> {
  if (encoder) return encoder;
  if (encoderError) throw encoderError;
  return encoderFlight.run(loadEncoderOnce);
}

/** 真正载入模型的那一次（只会被 single-flight 调用；成功写 encoder，失败写 encoderError） */
async function loadEncoderOnce(): Promise<Encoder> {
  // T-17：模型搜索只有一处（resolveModel → storage-roots.resolveModels），
  // 找不到时把它的**可读指引**当错误文案 —— 说清找过哪些路径、该放哪儿、怎么重试。
  const resolution = resolveModel();
  const modelDir = resolution.found;
  if (!modelDir) {
    const guidance = resolution.guidance || '未找到 ONNX 模型目录';
    encoderError = Object.assign(new Error(guidance), { code: 'MODEL_MISSING' });
    log('!! 未找到模型 ⇒ 检索会以 MODEL_MISSING 失败（**不显示假结果**）：');
    for (const line of guidance.split('\n')) log('   ', line);
    // ⚠️ 这条也要发事件：原先的 MODEL_MISSING 是 throw 在 try **之前**，
    //    于是界面**一个提示都收不到**（只有主进程日志知道），用户只看到"搜不出东西"。
    //    契约 §3「不静默」：缺模型必须让界面说得出口。
    emit({ type: 'encoder.failed', message: guidance, code: 'MODEL_MISSING' });
    throw encoderError;
  }
  log('模型搜索命中：', modelDir, '（来源：' + (resolution.source ?? '?') + '）');
  try {
    // **动态导入**：编码器模块图会拉 `@huggingface/transformers` + 原生 onnxruntime。
    // 若它载入失败（原生模块缺失、路径不对…），动态导入才**catch 得到** ——
    // 静态导入会在模块实例化阶段抛出，那时连一行日志都不会留下。
    const { createEncoder } = await import('./encoder.ts');
    // ⚠️ `config.device` 是外部 JSON 里的字符串；原实现把它原样交给编码器（后者只认这两个值），
    //    这里用断言保留同一行为 —— 不改写成"非法值就回退 webgpu"的静默降级。
    const device = (config.device || 'webgpu') as 'webgpu' | 'cpu';
    // T-31：把**探测结果**喂进去 —— 设备语义的判定在 encoder-device.ts 的纯函数里，不在这里。
    const gpuProbe = await probeGpu();
    encoder = await createEncoder({ modelDir, seq: 140, device, gpuProbe, log });
    // T-17：回退要**说出口**。encoder 自己知道 requested/actual/原因，
    // 这里把它一并交给界面（并同步写一条显眼日志）——契约 §3「GPU 回退不静默」。
    if (encoder.deviceFallback) {
      const f = encoder.deviceFallback;
      log(
        '!! GPU 回退：' +
          f.from +
          ' → ' +
          f.to +
          '（原因：' +
          f.reason +
          '）—— 检索仍可用，但会慢一些',
      );
    } else if (encoder.deviceRequested !== encoder.device) {
      // 理论上到不了：只有在 createEncoder 里发生回退时两者才会不同。
      log(
        '!! 设备与请求不一致（requested=' +
          encoder.deviceRequested +
          ' actual=' +
          encoder.device +
          '）',
      );
    }
    // T-31：事件里**请求 / 实际 / 已验证 EP** 三个字段分开，界面不必再从 device 猜（S1 · S3）。
    emit({
      type: 'encoder.ready',
      device: encoder.device,
      loadMs: encoder.loadMs,
      deviceRequested: encoder.deviceRequested,
      deviceFallback: encoder.deviceFallback,
      effectiveProvider: encoder.effectiveProvider,
      gpuProbe: encoder.gpuProbe,
    });
    return encoder;
  } catch (e) {
    encoderError = e;
    log('!! 编码器不可用：', stackText(e));
    emit({ type: 'encoder.failed', message: messageText(e), code: codeText(e) || 'INTERNAL' });
    throw e;
  }
}

// ---------------------------------------------------------------- 应用自身地址（§2 + §5）
// 判据与"开新窗口/导航/来源校验"的**决策**都在 `main/window-security.ts`（可脱离 Electron 单测）；
// 这里只做**接线**，并把 DEV_RENDERER_URL 作为参数喂进去。
function isTrustedSender(event: InvokeEventLike): boolean {
  const w = winRef.win;
  return isTrustedSenderImpl(event, w, DEV_RENDERER_URL);
}

// ---------------------------------------------------------------- IPC（§2 + §4）
function registerIpc(): void {
  ipcMain.handle(CH_INVOKE, async (event, payload: unknown) => {
    const started = Date.now();
    if (!isTrustedSender(event)) {
      log('拒绝来源不明的调用');
      return {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          userMessage: '请求来源不被信任。',
          message: 'untrusted sender',
          details: {},
        },
      };
    }
    const rec: Record<string, unknown> =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const method = rec.method;
    const params = rec.params;
    const v = validateCall(method, params);
    if (!v.ok) {
      return {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: v.reason,
          userMessage: '请求参数不合法。',
          details: { reason: v.reason },
        },
      };
    }
    if (!engine) buildEngine();

    // 「外壳方法」（不是引擎方法）：库注册表 / 取件白名单 / 应用账本 / 体检重建。
    // ⚠️ S6（2026-10-15）按基线 §2.2 重列：`libraryConfig` 已改名 `libraryList`（不留两套），
    //    并新增 librarySetEnabled / libraryReorder / libraryRemove / collectDirs / collectDir* / appMeta。
    //    这些方法读写的**只有 6 张表**（应用级 app.db 3 张 + 库级 .gs.db 3 张），实现分别在
    //    main/app-db.ts（应用级唯一写入口）与 main/library-ipc.ts（体检/重建）。
    if (
      v.method === 'items' ||
      v.method === 'libraryList' ||
      v.method === 'libraryAdd' ||
      v.method === 'libraryPickDir' ||
      v.method === 'librarySetEnabled' ||
      v.method === 'libraryReorder' ||
      v.method === 'libraryRemove' ||
      v.method === 'collectDirs' ||
      v.method === 'collectDirAdd' ||
      v.method === 'collectDirRemove' ||
      v.method === 'collectDirSetDefault' ||
      v.method === 'appMeta' ||
      v.method === 'appHealth' ||
      v.method === 'libraryHealth' ||
      v.method === 'libraryRebuild'
    ) {
      const res = await handleLibraryMethod(v.method, v.params);
      log(`invoke ${v.method} ${Date.now() - started}ms → ${resultCode(res)}`);
      return res;
    }

    // 引擎里还没实现的方法在这里显式拒绝，避免"静默什么都不做"。
    // 模拟模式下**不拒绝** —— 由 `fake.ts` 提供假实现，这是契约 §8 让「P3 不等真实库」的那条路。
    // （真实模式仍然拒绝：不许假装成功，见引擎侧的 `INTERNAL`。）
    //
    // ⚠️ 清单来自**引擎导出的唯一一份**（`UNIMPLEMENTED_METHODS`）—— 原先是这里手写一份、
    //    引擎里再逐段写一遍，两处会漂移（P1）。现在"哪些没做"全仓只有一处定义。
    if (!FAKE_MODE && UNIMPLEMENTED_METHODS.includes(v.method)) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: `方法尚未实现：${v.method}`,
          userMessage: '这个功能还没做好。',
          details: { method: v.method },
        },
      };
    }
    const eng = engine;
    // buildEngine() 必定给 engine 赋值 ⇒ 这一条只是把类型收窄，运行期走不到。
    if (!eng) throw new Error('引擎未就绪：buildEngine() 没有装配引擎');
    // 先由断言函数收窄（运行时真的存在），engineMethod 才接受这个名字（类型层也保证它是 EngineApi 的键）
    const fn = isEngineBackedMethod(eng, v.method) ? engineMethod(eng, v.method) : null;
    if (!fn) {
      return {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: `引擎无此方法：${v.method}`,
          userMessage: '请求参数不合法。',
          details: {},
        },
      };
    }
    const res = await fn(v.params);
    log(`invoke ${v.method} ${Date.now() - started}ms → ${resultCode(res)}`);
    return res;
  });
  log('IPC 已注册 · 允许的方法：', METHOD_NAMES.join(', '));
}

// ---------------------------------------------------------------- 库配置 IPC（D2 修复）
//
// 为什么要单独一组方法：用户要能**在应用内**把库加进来（决策 9：注册表存应用数据目录）。
// 这三个方法**不经引擎** —— 引擎是传输无关的，它只接受"给我一组库"，
// 而"库从哪来 + 存哪儿"是外壳的事（`packages/engine/src/library.ts:137` 自己写着
// 「P1 从 config 派生单库；P5 扩为真正的多库注册表」，持久化不在引擎职责内）。
//
// 安全：仍然走同一条 `isTrustedSender` + zod 白名单；`libraryPickDir` 是唯一一个
// 让用户**主动**选目录的入口，且它只把结果交给主进程自己处理，**不把路径能力授予渲染层**
// —— 渲染层本来就拿不到 `dialog`，这个方法是它唯一的、需用户亲自点击的间接通道。
async function handleLibraryMethod(method: MethodName, params: unknown): Promise<Envelope> {
  // ---- items：只读列表（S8 · SPEC §5.1）----
  // 实现体在 main/items-ipc.ts（不 import electron ⇒ 可被 node:test 直接覆盖）。
  // 这里只负责把**已解析**的库清单与 userData 递进去 —— 库从哪来是 library-config 的事。
  if (method === 'items') {
    const p = (params && typeof params === 'object' ? params : {}) as ItemsQueryParams;
    const r = librariesResolved();
    return runItemsQuery(
      {
        libId: String(p.libId),
        libraries: r.libraries.map((l) => ({ libId: l.libId, root: l.root })),
        userDataDir: USER_DATA_DIR,
        legacyLibrariesDir: path.join(DATA_DIR, 'libraries'),
      },
      p,
    );
  }

  // ---- 体检 / 重建（T-15a · 2026-10-15 批准新增）----
  // 实现体在 main/library-ipc.ts（那边**不 import electron** ⇒ 可被 node:test 直接覆盖）。
  // 这里只负责"把**已解析**的库清单与 userData 递进去" —— 库从哪来是 library-config 的事。
  if (method === 'libraryHealth' || method === 'libraryRebuild') {
    const p = (params && typeof params === 'object' ? params : {}) as Req<'libraryHealth'>;
    const r = librariesResolved();
    const input = {
      libId: String(p.libId),
      libraries: r.libraries.map((l) => ({ libId: l.libId, root: l.root })),
      userDataDir: USER_DATA_DIR,
      // 旧布局根：体检/重建据此回退（T-44）；判据唯一来源是引擎的 resolveIndexLocation
      legacyLibrariesDir: path.join(DATA_DIR, 'libraries'),
    };
    return method === 'libraryHealth' ? runLibraryHealth(input) : runLibraryRebuild(input);
  }

  if (method === 'libraryList') {
    // 模拟模式：给一个**自洽的假世界**。少了这一步会出现很别扭的错配 ——
    // 引擎侧 `indexStatus` 报着 3 个样例库，而门禁（`decideGate` 判的是**本方法**的 `libraries.length`）
    // 因为一条真实库来源都没配而判成 `wizard` ⇒ **显示首启向导、检索界面根本不挂载**。
    // 实测踩过：E8-a/E8-b 卡在「找不到 #query」，看起来像选择器问题，其实是「没有库」。
    if (FAKE_MODE) {
      return {
        ok: true,
        data: {
          libraries: [
            {
              libId: 'L1',
              label: '示例库（模拟）',
              root: FAKE_LIB_ROOT,
              source: 'fake',
              enabled: true,
              sortOrder: 0,
              itemCount: null,
              registered: false,
            },
          ],
          collect: { dirs: {}, default: '' },
          chosen: 'fake（GEMMA_FAKE=1，没有真实素材库）',
          diagnostics: ['模拟模式：库列表来自 fixtures/sample-index.json，不是真实配置'],
          warnings: ['⚠️ 当前是模拟模式，检索结果与真实素材库无关'],
          registryPath: null,
        },
      };
    }
    // app.db 的 library_registry 是**用户意图**的权威（enabled / sort_order / display_name）；
    // 库根仍来自四条发现来源（env / 注册表 / config / 自举）—— 两者合并，缺行 = 默认启用。
    const r = librariesResolved();
    const meta = registryMeta();
    const libraries: LibraryView[] = r.libraries.map((l) => {
      const row = meta.get(l.libId);
      return {
        libId: l.libId,
        root: l.root,
        label: row ? row.displayName : l.label,
        source: l.source,
        enabled: row ? row.enabled : true,
        sortOrder: row ? row.sortOrder : 0,
        itemCount: typeof l.count === 'number' ? l.count : null,
        registered: row !== undefined,
      };
    });
    // 登记过、但四条来源都没发现它（盘没挂 / 被移走）⇒ **也要列出来**：
    // 否则用户会以为「明明加过，怎么没了」（绿地口径下不猜，只如实显示）。
    for (const row of meta.values()) {
      if (!libraries.some((l) => l.libId === row.libId)) {
        libraries.push({
          libId: row.libId,
          root: row.root,
          label: row.displayName,
          source: 'registry',
          enabled: row.enabled,
          sortOrder: row.sortOrder,
          itemCount: null,
          registered: true,
        });
      }
    }
    libraries.sort((a, b) => a.sortOrder - b.sortOrder || a.libId.localeCompare(b.libId));
    return {
      ok: true,
      data: {
        libraries,
        collect: r.collect,
        chosen: r.chosen,
        diagnostics: r.diagnostics,
        warnings: r.warnings,
        registryPath: r.registryPath,
        appDbPath: USER_DATA_DIR ? appDbPath(USER_DATA_DIR) : null,
      },
    };
  }

  // ---- 基线 §2.2 新增：库注册表写入口（library_registry 的唯一写入口之一）----
  if (method === 'librarySetEnabled' || method === 'libraryReorder' || method === 'libraryRemove') {
    const p = (params && typeof params === 'object' ? params : {}) as {
      libId?: unknown;
      enabled?: unknown;
      sortOrder?: unknown;
      deleteDb?: unknown;
    };
    const libId = String(p.libId ?? '');
    const found = librariesResolved();
    const target = found.libraries.find((l) => l.libId === libId);
    const known =
      target ??
      (registryMeta().get(libId)
        ? { libId, root: registryMeta().get(libId)!.root, label: libId }
        : null);
    if (!known) {
      return {
        ok: false,
        error: {
          code: 'LIB_NOT_FOUND',
          message: '未登记的库：' + libId,
          userMessage: '找不到这个素材库，可能已被移除。',
          details: { libId },
        },
      };
    }
    if (method === 'librarySetEnabled') {
      const enabled = p.enabled === true;
      const prep = ensureLibraryRow(known.libId, known.root, known.label);
      if (!prep.ok) return appDbErrorEnvelope(prep.why, '更新库状态');
      const r = withAppDb((db) => updateLibraryEnabled(db, libId, enabled));
      if (!r.ok) return appDbErrorEnvelope(r.why, '更新库状态');
      invalidateLibraries();
      log('[库] 停用/启用', libId, '→', enabled);
      return { ok: true, data: { libId, enabled } };
    }
    if (method === 'libraryReorder') {
      const sortOrder = typeof p.sortOrder === 'number' ? p.sortOrder : 0;
      const prep = ensureLibraryRow(known.libId, known.root, known.label);
      if (!prep.ok) return appDbErrorEnvelope(prep.why, '调整库顺序');
      const r = withAppDb((db) => updateLibrarySortOrder(db, libId, sortOrder));
      if (!r.ok) return appDbErrorEnvelope(r.why, '调整库顺序');
      if (r.value === null) {
        return {
          ok: false,
          error: {
            code: 'LIB_NOT_FOUND',
            message: '未登记的库：' + libId,
            userMessage: '找不到这个素材库，可能已被移除。',
            details: { libId },
          },
        };
      }
      invalidateLibraries();
      log('[库] 顺序', libId, '→', sortOrder);
      return { ok: true, data: { libId, sortOrder } };
    }
    // libraryRemove —— **默认只取消登记**；deleteDb:true 才删库内 .gs-*（素材永远不动）
    const deleteDb = p.deleteDb === true;
    const removedFiles: string[] = [];
    if (deleteDb && target) {
      try {
        removedFiles.push(...removeGsDbFiles(path.join(target.root, GS_DB_NAME)));
        const idx = path.join(target.root, GS_INDEX_NAME);
        if (fs.existsSync(idx)) {
          fs.rmSync(idx, { force: true });
          removedFiles.push(idx);
        }
      } catch (e) {
        log('!! 删库文件失败（只取消登记）：', stackText(e));
      }
    }
    const rm = withAppDb((db) => deleteLibrary(db, libId));
    if (!rm.ok) return appDbErrorEnvelope(rm.why, '取消登记');
    invalidateLibraries();
    log(
      '[库] 取消登记',
      libId,
      '· 删库文件 =',
      String(deleteDb),
      '· 删了',
      removedFiles.length,
      '个',
    );
    return {
      ok: true,
      data: {
        libId,
        registryRowRemoved: rm.value,
        deletedFiles: removedFiles,
        materialsUntouched: true,
      },
    };
  }

  // ---- 基线 §2.2 新增：取件白名单（应用级 collect_dir 的唯一写入口）----
  if (method === 'collectDirs') {
    const r = withAppDb((db) => listCollectDirs(db));
    if (!r.ok) return appDbErrorEnvelope(r.why, '读取取件白名单');
    return { ok: true, data: { dirs: r.value } };
  }

  if (
    method === 'collectDirAdd' ||
    method === 'collectDirRemove' ||
    method === 'collectDirSetDefault'
  ) {
    const p = (params && typeof params === 'object' ? params : {}) as {
      absPath?: unknown;
      label?: unknown;
      dirId?: unknown;
      makeDefault?: unknown;
    };
    if (method === 'collectDirAdd') {
      const r = withAppDb((db) =>
        insertCollectDir(db, {
          absPath: String(p.absPath ?? ''),
          label: String(p.label ?? ''),
          makeDefault: p.makeDefault === true,
        }),
      );
      if (!r.ok) return appDbErrorEnvelope(r.why, '添加取件目录');
      invalidateLibraries(); // 取件白名单进引擎 config ⇒ 解析结果要重建
      const all = withAppDb((db) => listCollectDirs(db));
      return { ok: true, data: { added: r.value, dirs: all.ok ? all.value : [r.value] } };
    }
    const dirId = String(p.dirId ?? '');
    if (method === 'collectDirRemove') {
      const r = withAppDb((db) => deleteCollectDir(db, dirId));
      if (!r.ok) return appDbErrorEnvelope(r.why, '移除取件目录');
      invalidateLibraries();
      const all = withAppDb((db) => listCollectDirs(db));
      return { ok: true, data: { removed: r.value, dirs: all.ok ? all.value : [] } };
    }
    const r = withAppDb((db) => setDefaultCollectDir(db, dirId));
    if (!r.ok) return appDbErrorEnvelope(r.why, '设置默认取件目录');
    if (r.value === null) {
      return {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: '白名单里没有这个目录：' + dirId,
          userMessage: '这条目录已经不在白名单里了。',
          details: { dirId },
        },
      };
    }
    invalidateLibraries();
    const all = withAppDb((db) => listCollectDirs(db));
    return { ok: true, data: { dir: r.value, dirs: all.ok ? all.value : [r.value] } };
  }

  // ---- U27（2026-10-16）：应用自身健康 —— **只读**、**恒成功**、不落库 ----
  // 数据唯一来源是 crash-policy 的进程内快照（同一份真相）；信封组装与摘要清洗在 main/app-health.ts。
  // ⚠️ 刻意**不**读日志、**不**持久化「上次崩溃」：那需要一个下次启动必然过期的标记（宁可不显示，也不猜）。
  if (method === 'appHealth') {
    return queryAppHealth(crashUnhealthyState());
  }

  // ---- 基线 §2.2 新增：应用级账本（app_meta）—— **只读**（写它的只有迁移）----
  if (method === 'appMeta') {
    const r = withAppDb((db) => readAppMeta(db));
    if (!r.ok) return appDbErrorEnvelope(r.why, '读取应用信息');
    return {
      ok: true,
      data: {
        schemaVersion: r.value ? r.value.schemaVersion : null,
        appDbPath: USER_DATA_DIR ? appDbPath(USER_DATA_DIR) : null,
        fakeMode: FAKE_MODE,
        appVersion: app.getVersion(),
      },
    };
  }

  if (method === 'libraryPickDir') {
    const w = winRef.win;
    const openOptions: OpenDialogOptions = {
      title: '选择素材库根目录',
      properties: ['openDirectory'],
    };
    const picked =
      w && !w.isDestroyed()
        ? await dialog.showOpenDialog(w, openOptions)
        : await dialog.showOpenDialog(openOptions);
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
      return { ok: true, data: { canceled: true, path: null } };
    }
    return { ok: true, data: { canceled: false, path: picked.filePaths[0] } };
  }

  // libraryAdd
  const p = (params && typeof params === 'object' ? params : {}) as Req<'libraryAdd'>;
  const root = path.resolve(String(p.root));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return {
      ok: false,
      error: {
        code: 'LIB_NOT_FOUND',
        message: `目录不存在：${root}`,
        userMessage: '这个目录不存在，或不是文件夹。请重新选择。',
        details: { root },
      },
    };
  }
  if (!USER_DATA_DIR) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'userData 未初始化',
        userMessage: '应用还没准备好，请稍后重试。',
        details: {},
      },
    };
  }

  // ⚠️ S6（基线 §2.2/§2.3）：库注册的**唯一写入口** = 应用级 app.db 的 `library_registry`。
  //    旧 `userData/library-registry.json` **不再写**（绿地口径：不留两套真相）；
  //    它只在 library-config 的发现顺序里作为**只读**来源存在（老用户升级时还能被认出来）。
  const existing = withAppDb((db) => listLibraries(db));
  if (!existing.ok) return appDbErrorEnvelope(existing.why, '读取库注册表');
  const used = new Set(existing.value.map((l) => l.libId));
  let libId = typeof p.libId === 'string' && p.libId.trim() ? p.libId.trim() : '';
  if (!libId) {
    let n = 1;
    while (used.has('L' + n)) n += 1; // 省略 libId 时自动分配：L1、L2…（跳过已占用的）
    libId = 'L' + n;
  }
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : libId;
  const normalized = normalizeRootPath(root);
  const saved = withAppDb((db) => {
    const row = getLibrary(db, libId);
    if (row) {
      // 已登记：更新 root/名字（**保持** enabled 与 sort_order —— 那两个是用户的意图）
      // ⚠️ 走 app-db 的写入口：§2.3 唯一写入口，静态测试 D4 会抓调用方自己写 SQL
      return updateLibraryRootAndName(db, libId, normalized, label);
    }
    return insertLibrary(db, { libId, root: normalized, displayName: label });
  });
  if (!saved.ok) return appDbErrorEnvelope(saved.why, '登记库');

  invalidateLibraries(); // 解析结果与引擎都作废，下次调用会用新列表重建
  log('已登记库', libId, '→', normalized, '（app.db library_registry）');
  const r = librariesResolved();
  return {
    ok: true,
    data: {
      added: saved.value,
      registryPath: USER_DATA_DIR ? appDbPath(USER_DATA_DIR) : null,
      libraries: r.libraries,
      warnings: r.warnings,
      diagnostics: r.diagnostics,
    },
  };
}

// ---------------------------------------------------------------- thumb:// 协议（SPEC-security §3）
//
// 形状**只允许** `thumb://<libId>/<uid>@<size>`。
// 路径绝不从 URL 取，而是由「注册表 + 索引」反查后再做包含校验 —— 这样
// 渲染进程无法用它读任意文件（它连"一个路径"都传不进来）。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// 缩略图缓存落点已收进 `thumb-cache.thumbCachePath`（**唯一实现**，P1）——
// 这里不再保留第二份路径拼法（两份迟早漂移，而缓存路径漂移＝缓存静默失效）。

// ⚠️ 形状解析、尺寸白名单**与失败状态码映射**已抽到 `main/thumb-url.ts`
// （SPEC-security §8 的 S4–S6）。抽出去的理由只有一个：`index.ts` import 了 electron，
// `node:test` 加载不了它 ⇒ 这段代码本来**零自动化覆盖**。它是渲染进程唯一能"指定读哪个文件"的表面。
// **行为变更（唯一一处，已记录）**：原实现把"库 id 无法还原"与"形状不对"合并成 400；
// 按 `SPEC-security.md` §3 的表（`libId` 不在注册表 ⇒ 404）现在拆成 404。这是**对齐 §3**。
async function listRegisteredLibIds(): Promise<string[]> {
  const eng = engine;
  if (!eng) return [];
  // 引擎的 indexStatus 是**零参**方法（原 JS 版多传的 `{}` 会被忽略）—— 这里保持同一调用语义。
  const st = await eng.indexStatus();
  if (!st || !st.ok) return [];
  const data: unknown = st.data;
  if (!data || typeof data !== 'object') return [];
  const libs = (data as { libs?: unknown }).libs;
  if (!Array.isArray(libs)) return [];
  return libs.map((l) =>
    l && typeof l === 'object' ? String((l as { libId?: unknown }).libId) : '',
  );
}
const resolveLibId = createLibIdResolver({ listLibIds: listRegisteredLibIds, log });
/** 引擎未就绪时不尝试还原（还原器本身对"空结果"也不会缓存，见 thumb-url.ts） */
async function canonicalLibId(host: string): Promise<string> {
  if (!engine) return '';
  return resolveLibId(host);
}

async function handleThumb(request: Request): Promise<Response> {
  // thumb://L1/<uid>@256  → host=libId, pathname=/<uid>@256
  const p = parseThumbUrl(request.url);
  // ⚠️ **顺序是契约**：先判形状（400），再判库（404），再看引擎是否就绪（503）。
  // 这三步与后面"取路径失败 / 解码失败"的映射**统一收在 `thumb-cache.thumbServeStatus`**
  // （表在该模块文件头；逐行有用例钉住）。写成 `thumbFailureStatus(p.ok ? 400 : p.status, libId)`
  // 会让形状错也返回 404 —— 实测被 `tools/verify_main_wiring.mjs`（**已移除 2026-10-13**）抓到。
  const libId = p.ok ? await canonicalLibId(p.rawHost) : '';
  const eng = engine;
  const pre = thumbServeStatus({ shapeOk: p.ok, libId, engineReady: Boolean(eng) });
  if (pre.status !== null) {
    log('thumb 拒绝', pre.reason, '→', pre.status);
    return new Response(pre.reason, { status: pre.status });
  }
  // 只为类型收窄：`thumbServeStatus` 返回 null 蕴含"形状合法 + 库已还原 + 引擎就绪"，
  // 所以运行期走不到这里（与下面 'thumb 引擎未就绪' 同一处置）。
  if (!p.ok || !eng) throw new Error('thumb：形状/引擎前置条件未满足（不可达）');
  const uid = p.uid;
  const size = p.size;
  log('thumb 请求', libId, uid, size);

  const cachePath = thumbCachePath({ dataDir: DATA_DIR, libId, uid, size });
  const cached = readCachedThumb(cachePath);
  if (cached.hit && cached.bytes) {
    log('thumb 缓存命中', libId, uid, size, cached.reason);
    return new Response(cached.bytes, { headers: { 'content-type': 'image/jpeg' } });
  }
  log('thumb 缓存未命中', cached.reason, '⇒ 重新生成');

  let src: string;
  try {
    src = eng.absPathFor(libId, uid); // 内含 库根包含 + 符号链接校验
  } catch (e) {
    // ⚠️ **本任务的核心修正**：不再 `SYMLINK_REJECTED ? 403 : 404` —— 那会把
    // `PATH_ESCAPES_LIB`（越界拒绝）与**任何内部异常**都说成"这张图不存在"。
    // 现在按 thumb-cache.ts 的表：素材不在 ⇒ 404 · 安全拒绝 ⇒ 403 · **其余 ⇒ 500**。
    const d = thumbServeStatus({
      shapeOk: true,
      libId,
      engineReady: true,
      resolveCode: codeText(e),
    });
    log('thumb 取路径失败', libId, uid, codeText(e) || messageText(e), '→', d.status, d.reason);
    return new Response(d.reason, { status: d.status ?? 500 });
  }
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) {
    const d = thumbServeStatus({ shapeOk: true, libId, engineReady: true, decoded: false });
    log('thumb 解码失败', src, '→', d.status, d.reason);
    return new Response(d.reason, { status: d.status ?? 415 });
  }

  const { width, height } = img.getSize();
  const scale = size / Math.max(width, height);
  const out =
    scale < 1
      ? img.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good',
        })
      : img;
  const jpg = out.toJPEG(82);
  const wrote = writeCachedThumb(cachePath, jpg);
  if (!wrote.ok) log('缩略图缓存写入失败', wrote.error);
  log(
    'thumb 生成成功',
    libId,
    uid,
    size,
    `${width}x${height}→${out.getSize().width}x${out.getSize().height}`,
    jpg.length,
  );
  return new Response(jpg, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' },
  });
}

// ---------------------------------------------------------------- 窗口（§5）
/** 窗口默认尺寸（回落值；不给 x/y 让 Electron 居中）与最小尺寸 */
const WIN_DEFAULT_WIDTH = 1440;
const WIN_DEFAULT_HEIGHT = 920;
const WIN_MIN_WIDTH = 1040;
const WIN_MIN_HEIGHT = 680;
/** 至少要露出这么多像素才算"用户看得见、抓得着"（标题栏量级） */
const WIN_MIN_VISIBLE = 64;

function createWindow(): electron.BrowserWindow {
  // T-10b：先按"上次的位置"算这次的开窗矩形。算不出来（第一次启动 / 文件坏了 / 屏幕变了 /
  // 旧坐标在屏幕外）就用默认尺寸并居中 —— 判定逻辑与理由全在 window-state.ts（纯函数）。
  // ⚠️ 恢复必须发生在**建窗之前**：先建再挪会看到窗口跳一下。
  const restored: BoundsDecision = (() => {
    if (!USER_DATA_DIR)
      return { bounds: null, source: 'default', reason: 'userData 未就绪 ⇒ 用默认尺寸并居中' };
    const saved = readSavedBounds(USER_DATA_DIR);
    if (saved.error) log('[窗口] 窗口状态读取失败（按"没存过"处理）:', saved.error);
    const areas = screen.getAllDisplays().map((d) => ({
      x: d.workArea.x,
      y: d.workArea.y,
      width: d.workArea.width,
      height: d.workArea.height,
    }));
    const d = decideWindowBounds({
      saved: saved.raw,
      workAreas: areas,
      minWidth: WIN_MIN_WIDTH,
      minHeight: WIN_MIN_HEIGHT,
      minVisible: WIN_MIN_VISIBLE,
    });
    log('[窗口]', d.reason, '· 屏幕数 =', areas.length, '· 状态文件 =', saved.path);
    return d;
  })();

  const win = new BrowserWindow({
    width: restored.bounds ? restored.bounds.width : WIN_DEFAULT_WIDTH,
    height: restored.bounds ? restored.bounds.height : WIN_DEFAULT_HEIGHT,
    ...(restored.bounds ? { x: restored.bounds.x, y: restored.bounds.y } : {}),
    minWidth: WIN_MIN_WIDTH,
    minHeight: WIN_MIN_HEIGHT,
    backgroundColor: '#f5f5f7',
    title: 'gemma-search · 素材库语义检索',
    show: false,
    webPreferences: {
      // preload 是 electron-vite 产出的 **CJS**（`out/preload/index.cjs`）：
      // `sandbox: true` 下渲染进程不加载 ESM preload，见 electron.vite.config.mjs。
      preload: path.join(HERE, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      webviewTag: false,
      devTools: true, // 决定 3：生产态也保留（理由见 SPEC-security §9）
    },
  });
  winRef.win = win;

  // T-10b：把窗口矩形记进 userData。**启动路径不写盘**；只在用户动过窗口或窗口关闭时写
  // （关闭时也写一次，是故意的：否则"开了没动就关"永远记不住，而这正是最常见的一次运行）。
  // ⚠️ 用 getNormalBounds()：最大化 / 全屏时 getBounds() 给的是"占满整屏"的矩形，
  //    存下来下次就丢掉了用户原本的窗口大小（恢复出来永远是全屏尺寸）。
  // 拖动窗口时 resize/move 会连发 ⇒ 500ms 防抖，最后再在 close 时补一次。
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = (): void => {
    if (!USER_DATA_DIR) return;
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
    const saved = persistBounds(USER_DATA_DIR, win.getNormalBounds());
    if (!saved.ok) log('[窗口] 窗口状态保存失败（不影响使用）:', saved.error);
  };
  const saveBoundsSoon = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  win.on('resize', saveBoundsSoon);
  win.on('move', saveBoundsSoon);
  win.on('close', () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
    }
    saveBounds();
  });

  win.once('ready-to-show', () => win.show()); // 冷启动不闪白
  // 决策在 window-security.ts（可单测），这里只接线
  win.webContents.setWindowOpenHandler(() => decideWindowOpen());
  win.webContents.on('will-navigate', (e, url) => {
    if (!decideNavigation(url, DEV_RENDERER_URL)) {
      e.preventDefault();
      log('阻止导航', url);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => log('渲染进程结束', JSON.stringify(d)));

  // 渲染进程的诊断信息也落到**同一个日志文件**：
  // 首次运行要用户"把日志发我"，如果 console 里的报错只在 DevTools 里，就得让他多跑一趟。
  // （Electron ≥37 的 `console-message` 传单个事件对象，旧版是 (event, level, message, …)；
  //   两种形状都兜住，免得升级 Electron 后这里静默丢日志。）
  // 开发/验收用：应用**自己**截自己（GS_CAPTURE=<png 路径>）。
  // 用系统截屏抓窗口不可靠：窗口被别的窗口盖住时，抓到的会是最上层那个应用（实测踩过）。
  win.webContents.on('did-finish-load', () => {
    log('渲染页加载完成');
    const target = process.env.GS_CAPTURE || '';
    if (!target) return;
    const delayMs = Number(process.env.GS_CAPTURE_DELAY_MS || 4000);
    setTimeout(async () => {
      try {
        // 可选：截图前先跑一次检索，让证据里能看到结果区（GS_CAPTURE_QUERY=<查询词>）
        const q = process.env.GS_CAPTURE_QUERY || '';
        if (q) {
          await win.webContents.executeJavaScript(
            '(() => {' +
              '  const i = document.getElementById("query");' +
              '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;' +
              '  setter.call(i, ' +
              JSON.stringify(q) +
              ');' +
              '  i.dispatchEvent(new Event("input", { bubbles: true }));' +
              '  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "搜索图片 →");' +
              '  if (btn) btn.click();' +
              '  return true;' +
              '})()',
          );
          await new Promise((r) => setTimeout(r, 2500)); // 等检索 + 缩略图渲染
        }
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, img.toPNG());
        const { width, height } = img.getSize();
        log('已截图', target, `${width}x${height}`);
      } catch (e) {
        log('截图失败', messageText(e));
      }
      if (process.env.GS_CAPTURE_EXIT !== '0') app.quit();
    }, delayMs);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    log('!! 渲染页加载失败', code, desc, url),
  );
  win.webContents.on('console-message', (...args: unknown[]) => {
    const a = args[0];
    // 新版是单个事件对象（带 message），旧版是 (event, level, message, …) —— 两种形状都兜住。
    const e: { level?: unknown; message?: unknown } =
      a && typeof a === 'object' && 'message' in a
        ? (a as { level?: unknown; message?: unknown })
        : { level: args[1], message: args[2] };
    log('[renderer]', e.level ?? '', e.message ?? '');
  });

  // F12 → DevTools（生产态也留：本机自用工具，排障收益 > 风险，见 SPEC-security §9 决定 3）
  // ⚠️ DF-6：**只有这一条手动路径** —— 生产态**不自动打开** DevTools。
  //    口径落点是 crash-policy.shouldAutoOpenDevTools()（恒 false），并由单测做源码扫描守着；
  //    要改成"自动开"必须同时改那个函数与扫描断言。
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  if (DEV_RENDERER_URL) {
    // dev：electron-vite 的 dev server（HMR）。**只**用注入的地址，不做任何拼接。
    win.loadURL(DEV_RENDERER_URL);
    log('窗口已创建 →', DEV_RENDERER_URL, '(dev server)');
  } else {
    const page = path.join(HERE, '..', 'renderer', 'index.html');
    win.loadFile(page);
    log('窗口已创建 →', page);
  }
  return win;
}

// ---------------------------------------------------------------- 生命周期
app.setAppUserModelId('com.gemmasearch.app');

// ---------------------------------------------------------------- 单实例锁（T-10a）
//
// 为什么必须有：第二次启动如果照样建窗，就会出现**两个窗口指向同一份 userData 与库索引**，
// 写类操作（取件 / 入库）会互相打架，而用户看上去只是"又打开了一个应用"，
// 完全不知道自己其实跑着两份。规范做法 = 单实例锁 + 把第二次启动转成"恢复并聚焦已有窗口"。
//
// ⚠️ 顺序是契约：**先抢锁，再建窗**。抢不到锁的那一次进程里**一个窗口都不许建** ——
//    否则界面照样出现两份，锁只挡住了一半。所以本文件把启动流程收进 startApp()，
//    只有拿到锁的那一次才把它注册给 app.whenReady()。
// ⚠️⚠️ requestSingleInstanceLock() 返回 false **有两种完全不同的含义**，必须分开处理：
//   ① 真的已有实例在跑（正常语义）；
//   ② **userData 不可写** ⇒ Chromium 建不出 lockfile（原始报错：
//      `process_singleton_win.cc:318 Lock file can not be created: 拒绝访问 (0x5)`）。
//   把 ② 当成 ① 的后果是**应用永远起不来**，而真实原因是"环境写不进去" —— 那正是本项目最怕的误判
//   （2026-10-14 实测踩到：本会话沙箱下 e2e 的临时 userData 不可写 ⇒ 10 条 e2e 全线变红，
//    看起来像"单实例锁把测试挡住了"，其实是把"建不出锁文件"误读成了"已有实例"）。
//   ⇒ 只有在**确认 userData 可写**时，false 才等于"已有实例"。
//   探测复用 storage-roots.ts 的 probeWritable（同一份实现，不新写第二份）。
let SINGLE_INSTANCE: boolean = app.requestSingleInstanceLock();
if (!SINGLE_INSTANCE) {
  const udProbe = probeWritable(app.getPath('userData'));
  if (!udProbe.writable) {
    SINGLE_INSTANCE = true; // 环境不支持锁 ⇒ 放行，照常启动（下面会大声写明）
    log(
      '⚠️ 单实例锁不可用：userData 不可写 ⇒ Chromium 建不出 lockfile，本次**按单实例放行**并照常启动。',
    );
    log('   userData =', app.getPath('userData'));
    log('   探测结果 =', udProbe.reason);
    log('   影响：本次不做单实例互斥（再启一个不会聚焦本窗口）；修好 userData 写权限后自动恢复。');
  } else {
    log(
      '已有实例在运行（单实例锁没拿到，且 userData 可写 ⇒ 确实是第二个实例）⇒ 本次**不建窗口**后退出',
    );
    app.quit();
  }
}

if (SINGLE_INSTANCE) {
  // 第二次启动时，Electron 会在**已有实例**上触发本事件 —— 这里只有恢复 + 聚焦，绝不新开窗口。
  app.on('second-instance', (_event: unknown, argv: string[], workingDirectory: string) => {
    log(
      '第二次启动被单实例锁拦下 ⇒ 恢复并聚焦已有窗口 · argv =',
      JSON.stringify(argv),
      '· cwd =',
      workingDirectory,
    );
    const w = winRef.win;
    if (!w || w.isDestroyed()) {
      // 窗口已经没了（正常路径是"关窗即退出"，走不到这里）—— 补建一个，别让第二次启动石沉大海。
      log('second-instance：已有窗口不可用 ⇒ 重新建窗');
      createWindow();
      return;
    }
    if (w.isMinimized()) w.restore(); // 最小化过就还原（否则焦点给了也看不见）
    w.show();
    w.focus();
    // 如实记录结果：Windows 的前台窗口规则可能不给焦点，日志要能看出"到没到位"，不能假装成功。
    log(
      'second-instance：已恢复并聚焦 · isMinimized =',
      w.isMinimized(),
      '· isFocused =',
      w.isFocused(),
    );
  });
}

/**
 * 启动流程本体。**只有拿到单实例锁的那一次**才会被注册给 app.whenReady()
 * （抽成命名函数只是为了把"抢锁"与"启动"分开读清楚，内容与原先逐字一致）。
 */
async function startApp(): Promise<void> {
  log('app ready');
  // userData 只能在这之后取；库解析（含注册表）也就从这里才真正开始
  try {
    USER_DATA_DIR = app.getPath('userData');
    log('userData', USER_DATA_DIR);
    log('注册表路径', registryPath(USER_DATA_DIR));
    // ⚠️ T-42：把 SQLite 的临时目录指到 <userData>/tmp —— 必须在**任何** SQLite 写入之前。
    //    系统 TEMP 不可写时（受限沙箱 / 锁死的企业机），导入写数据阶段会报
    //    "unable to open database file" 并整条回滚成 IMPORT_FAILED（实测复现：只改 TEMP 就能复现）。
    configureProcessTempDir(USER_DATA_DIR);
  } catch (e) {
    log('!! userData 解析失败（会退到索引自举）:', messageText(e));
  }
  try {
    protocol.handle('thumb', handleThumb); // 必须在窗口加载渲染页之前
    log('thumb:// 已注册');
    registerIpc();
    buildEngine();
    logStorageRoots(); // T-04：落点与"为什么"进日志（只记录，不改变行为）
    log('引擎阶段完成');
    createWindow();
    log('启动流程完成（窗口已创建）');
  } catch (e) {
    log('!! 启动流程异常:', stackText(e));
    throw e;
  }

  // 启动就绪后**后台**载模型（不挡出窗）；失败也不致命，检索时会再试并报错
  setTimeout(() => {
    ensureEncoder().catch((e: unknown) => log('预热失败', messageText(e)));
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// ⚠️ 抢不到锁的那一次**不注册** ready 回调 ⇒ 一个窗口都不建（已在上面的分支里 app.quit()）。
if (SINGLE_INSTANCE) app.whenReady().then(startApp);

app.on('window-all-closed', () => {
  app.quit();
}); // 关窗即退出（不做托盘）
// ------------------------------------------------ 未捕获异常 / 未处理 rejection（DF-6）
//
// 策略的**唯一落点**是 crash-policy.ts（文件头写着三条裁决与"为什么不用 app_meta"）：
//   · uncaughtException ⇒ 先把原因与"即将退出"落盘（log 是同步 appendFileSync，调用返回即已写盘），
//     再 app.exit(1)：进程此刻可能停在半初始化/半写状态，继续跑会把"引擎没装配完"当成正常；
//   · unhandledRejection ⇒ 记日志 + 标记进程内只读的"不健康"态（诊断可读），**不退出** ——
//     良性 rejection 不该杀掉应用。
// ⚠️ exit 钩子注入的是 app.exit：不用 process.exit —— 后者会跳过 Electron 的收尾，
//    而 app.exit 让渲染进程/协议一起有序退出；测试注入记录式钩子，不会真杀进程。
installCrashPolicy({
  log,
  exit: (code: number) => {
    app.exit(code);
  },
  isPackaged: app.isPackaged,
});

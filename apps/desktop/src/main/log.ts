// apps/desktop/src/main/log.ts —— 主进程日志（**必须写文件**）
//
// 为什么不是只 console.log（本项目实测踩过）：
//   Windows 上 Electron 是 **GUI 子系统程序**，主进程的 stdout **不连终端** ——
//   console.log 一条都看不到，表现出来就是"启动后什么都没发生"。
//   所以日志同时写 <根>/data/_app.log（可用 GEMMA_APP_LOG 覆盖）与 stdout
//   （dev 态 electron-vite 把 stdout 接回终端，所以两种运行方式都能读到）。
//
// 模块导入即初始化：截断上一轮日志并写下本轮头部。副作用写在模块顶层是**故意的** ——
// 它必须早于任何可能抛错的导入执行，否则"导入期失败"会连一行日志都不留。
//
// 2026-10-14：本文件由 log.mjs 转为 .ts（全量 TypeScript 的第一块）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE: string = path.dirname(fileURLToPath(import.meta.url));

/**
 * 应用根目录（仓库根：package.json(workspaces) / data/ 所在处）。
 *
 * ⚠️ **不能用固定层级的 resolve(HERE, '..', ...)** —— 本次目录重构的真坑：
 *   同一个模块在两种运行态下距仓库根的级数**不同**：
 *     · 源码态  HERE = <仓库根>/apps/desktop/src/main → 距根 **4** 级
 *     · 构建态  HERE = <仓库根>/out/main            → 距根 **2** 级
 *   所以按层级数写死**只对一种态成立**，另一种会静默指到仓库根之外。
 *   因此这里改为**向上找标记**（深度无关）。
 */

/** 退化标记：仓库根下必然存在的文件。⚠️ 引擎转 .ts 后这里要同步（改名不同步 = 静默失效）。 */
const ENGINE_MARKER: string = path.join('packages', 'engine', 'src', 'engine.ts');

/** package.json 里声明了 workspaces ⇔ 这是本仓库的仓库根 */
function isWorkspaceRoot(dir: string): boolean {
  try {
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) return false;
    // 容忍 UTF-8 BOM：Windows 编辑器写出的 package.json 可能带 BOM，而 JSON.parse 会直接抛。
    const txt = fs.readFileSync(pkg, 'utf8').replace(/^\uFEFF/, '');
    return (JSON.parse(txt) as { workspaces?: unknown }).workspaces !== undefined;
  } catch {
    return false; // 坏了/不可读就当它不是，继续向上
  }
}

/** 从 start 向上找仓库根；找不到返回 null（打包态或未知布局） */
function detectRepoRoot(start: string): string | null {
  let engineRoot: string | null = null;
  for (let p = start; ;) {
    if (isWorkspaceRoot(p)) return p;
    if (engineRoot === null && fs.existsSync(path.join(p, ENGINE_MARKER))) engineRoot = p;
    const up = path.dirname(p);
    if (up === p) return engineRoot; // 已到盘根：退而求其次
    p = up;
  }
}

/** 兜底：**只在标记探测完全失败时**才用（多半是打包态 —— 那时根本没有"仓库根"）。 */
const FALLBACK_ROOT: string = path.resolve(HERE, '..', '..');

/** 打包态：本模块在 app.asar 内运行（与 ROOT 解成什么无关，看 HERE 这个事实） */
const PACKED: boolean = HERE.includes('app.asar');

/**
 * 打包态的日志目录 = Electron 的 userData/logs（userData 是 Electron 保证可写的那个目录）。
 *
 * ⚠️ 为什么不能用 ROOT：打包态 ROOT 会解成 **asar 内的路径**（asar 里那份 package.json 声明了
 *    workspaces ⇒ detectRepoRoot 认了它），往它下面写必然失败 ⇒ 打包后**一条日志都没有**。
 *    这是 T-22a 第一次真打包抓到的 P0（实测：仓库 data/_app.log mtime 不变、asar 下也没有文件）。
 * ⚠️ 为什么不在顶层 import electron：本文件必须能被 node:test 直接加载（那里没有 electron），
 *    而且它的副作用要**早于任何可能抛错的导入**执行 —— 顶层 import electron 会把这两条都破坏。
 *    所以只在 PACKED 时惰性 require 一次；解析不出来就回落旧行为，并由 announceFailure() **大声报**。
 * ⚠️ app.getPath('userData') 在 app ready 之前就可读（Electron 文档口径），此处正是那个时机。
 */
function packedUserDataDir(): string | null {
  if (!PACKED) return null;
  try {
    const req = createRequire(import.meta.url);
    const el = req('electron') as { app?: { getPath?: (name: string) => string } };
    const p =
      el && el.app && typeof el.app.getPath === 'function' ? el.app.getPath('userData') : '';
    return typeof p === 'string' && p ? p : null;
  } catch {
    return null;
  }
}

/** 打包态解析到的 userData（解析不出来 = null ⇒ 回落 <ROOT>/data 并报错） */
const PACKED_USER_DATA: string | null = packedUserDataDir();

export const ROOT: string = process.env.GEMMA_ROOT || detectRepoRoot(HERE) || FALLBACK_ROOT;

/**
 * 日志文件**落点**（TESTISO-1 重写）：**按需解析 + 显式配置**，不在导入期写死一个常量。
 *
 * 旧行为（已删）：模块顶层算出 LOG_FILE 并**立刻** `writeFileSync(LOG_FILE, '')` 截断 ——
 *   `npm test` 里任何 import 到 log.ts 的文件都会截断 `<ROOT>/data/_app.log`，
 *   于是并发跑单测时**任何读这份日志的 e2e 都会假红**（WIRE-A 实测踩到）。
 *
 * 新口径（三条，缺一不可）：
 *   ① **导入期零文件 I/O**：import 只登记缓冲；没有 configureLogFile 就**一个字节都不写**；
 *   ② **落点跟随调用方**：主进程用 `<data_dir>/_app.log` 配置（data_dir 来自 config.json，
 *      e2e 每个启动是独立 temp data_dir ⇒ 每个进程自己的日志）；
 *   ③ **不截断**：打开时 `appendFileSync`（按需创建），同一文件里多进程写也只是追加。
 */
/** 显式覆盖（测试/排障）；优先级高于 configureLogFile 的入参（见 index.ts 的接线） */
function envLogFile(): string | null {
  const p = typeof process.env.GEMMA_APP_LOG === 'string' ? process.env.GEMMA_APP_LOG.trim() : '';
  return p ? p : null;
}

/** 未配置时的默认落点：打包态 <userData>/logs/app.log（T-22a），否则 <ROOT>/data/_app.log */
function defaultLogFile(): string {
  return PACKED && PACKED_USER_DATA
    ? path.join(PACKED_USER_DATA, 'logs', 'app.log')
    : path.join(ROOT, 'data', '_app.log');
}

/** 已配置的落点（null = 还没配置 ⇒ 不写任何文件） */
let configuredFile: string | null = null;

/** 配置前产生的行（含导入期头部）：有界缓冲，configureLogFile 时**按序**刷进文件 */
const PRELOG: string[] = [];
const PRELOG_MAX = 200;

/** 当前解析到的落点（诊断/测试读；**不代表已经写过**） */
export function resolveLogFile(): string {
  return configuredFile ?? envLogFile() ?? defaultLogFile();
}

/** 是否已经被显式配置（false ⇒ 本进程不会写任何日志文件） */
export function isLogFileConfigured(): boolean {
  return configuredFile !== null;
}

const stamp = (): string => new Date().toISOString().slice(11, 23);

/** 任何值 → 一行可读字符串（永不抛） */
const fmt = (x: unknown): string =>
  typeof x === 'string'
    ? x
    : x && typeof x === 'object' && typeof (x as { stack?: unknown }).stack === 'string'
      ? (x as { stack: string }).stack
      : (() => {
          try {
            return JSON.stringify(x);
          } catch {
            return String(x);
          }
        })();

/**
 * 首次写日志时的**自我断言**：ROOT 必须真的是仓库根。
 * 判定与上面的探测**用同一套标记**（否则"怎么找的"和"怎么验的"会互相打架）。
 * 打包态（PACKED）根本没有仓库根可言 ⇒ 直接跳过断言，改由下面那条 asar 警告负责。
 */
let rootAsserted = false;
function assertRootOnce(): void {
  if (rootAsserted) return; // 先置位 → 下面递归调用 log() 时不会重入
  rootAsserted = true;
  if (PACKED) return; // 打包态无仓库根可言

  const hasWorkspaces = isWorkspaceRoot(ROOT);
  const hasEngineMarker = fs.existsSync(path.join(ROOT, ENGINE_MARKER));
  if (hasWorkspaces || hasEngineMarker) {
    if (!hasWorkspaces) {
      log('提示：ROOT 由引擎标记认出；package.json 尚未声明 "workspaces"。');
    }
    return;
  }

  log('!'.repeat(82));
  log('!! ROOT 解析可疑 —— 它不是仓库根。');
  log('!!   ROOT =', ROOT);
  log('!!   HERE =', HERE);
  log('!!   查过 =', path.join(ROOT, 'package.json'), '（不存在/无 workspaces）');
  log('!!         ', path.join(ROOT, ENGINE_MARKER), '（不存在）');
  log(
    '!!   后果 = 日志会写到错误目录（静默）、data/ 也会找错 —— 请设 GEMMA_ROOT=<仓库根> 后重跑。',
  );
  log('!'.repeat(82));
}

/** 日志写入状态：**诊断面板 N7 要显示它** —— 打包态写不进去时不许"看起来正常"（T-22a 的 P0） */
export interface LogStatus {
  file: string;
  dir: string;
  ok: boolean;
  failures: number;
  error: string | null;
  packed: boolean;
  /** 是否已被显式配置（false ⇒ 本进程不写文件；TESTISO-1 新增） */
  configured: boolean;
  /** 还没刷进文件的缓冲行数（configured=false 时通常 > 0） */
  pending: number;
}
let logOk = true;
let logFailures = 0;
let logError: string | null = null;
let failureAnnounced = false;

/** 读当前日志落点与写入状态（N7 用；也可用于测试断言"失败可见"） */
export function logStatus(): LogStatus {
  const file = resolveLogFile();
  return {
    file,
    dir: path.dirname(file),
    ok: logOk,
    failures: logFailures,
    error: logError,
    packed: PACKED,
    configured: configuredFile !== null,
    pending: PRELOG.length,
  };
}

/**
 * 第一次写失败时**绕开 log() 自身**大声报一次（stderr + stdout 直写）。
 *
 * 为什么不只记状态：打包态是 GUI 子系统程序，用户看不到 stderr/stdout 时，
 * "日志写不了"会被当成"应用没启动" —— 必须至少有一个不沉默的通道（N7 之后补界面显示）。
 * 也**不能**用 log() 报，它自己正要写那个失败的文件（会递归）。
 */
export function announceLogFailure(err: unknown): void {
  if (failureAnnounced) return;
  failureAnnounced = true;
  const msg =
    '[gemma-search] !! 日志写入失败：' +
    fmt(err) +
    ' · 目标 = ' +
    resolveLogFile() +
    ' · packed=' +
    String(PACKED) +
    ' · 后续仍会尝试写入；诊断面板可读 logStatus()';
  try {
    process.stderr.write(msg + '\n');
  } catch {
    /* GUI 子系统可能没有 stderr */
  }
  try {
    process.stdout.write(msg + '\n');
  } catch {
    /* 同上 */
  }
}

/** 记一次写失败：状态 + 大声报一次（永不抛） */
function noteFailure(err: unknown): void {
  logOk = false;
  logFailures += 1;
  logError = fmt(err);
  announceLogFailure(err);
}

/** 追加一行到已配置的日志文件（**不截断**：append，按需创建） */
function appendLine(line: string): void {
  if (configuredFile === null) return;
  try {
    fs.appendFileSync(configuredFile, line, 'utf8');
  } catch (e) {
    noteFailure(e);
  }
}

/**
 * 配置日志落点（**唯一入口**；测试与主进程都走它）。
 *
 * · 不在导入期调用它就是"本进程不写日志文件"——这正是 TESTISO-1 要的：
 *   单测 import log.ts 不会碰共享文件（旧行为会截断 <ROOT>/data/_app.log）。
 * · 只创建/追加，**绝不截断**：同一文件被多个进程写时最多是追加交错，不会互相清空。
 * · 配置前缓冲的头部行会**按序**刷进去（所以应用日志仍有 `=== gemma-search 启动 ===` 头）。
 */
export function configureLogFile({ path: nextPath }: { path: string }): LogStatus {
  const p = typeof nextPath === 'string' ? nextPath.trim() : '';
  if (!p) {
    // 空路径 = 明确"不写文件"（保持未配置）：不静默挑一个别的落点
    return logStatus();
  }
  configuredFile = p;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  } catch (e) {
    noteFailure(e);
  }
  // flush 缓冲（导入期头部行）：先清空再写，避免 log() 递归重复入缓冲
  const pending = PRELOG.splice(0, PRELOG.length);
  for (const line of pending) appendLine(line);
  log('日志文件 =', p);
  return logStatus();
}

/** 写一行日志：文件（**已配置时**）+ stdout，两边都失败也不能让应用崩。 */
export function log(...args: unknown[]): void {
  assertRootOnce(); // ← 首次调用即自检（递归安全：标志已先置位）
  const line = `[` + stamp() + `] ` + args.map(fmt).join(' ') + '\n';
  if (configuredFile === null) {
    // ⚠️ **未配置 ⇒ 不写任何文件**（只 stdout + 有界缓冲）—— 禁止导入期截断/写死落点的落点
    if (PRELOG.length < PRELOG_MAX) PRELOG.push(line);
  } else {
    appendLine(line);
  }
  try {
    process.stdout.write(line);
  } catch {
    /* GUI 子系统没有 stdout */
  }
}

// ---------------------------------------------------------------- 导入期：**零文件 I/O**
// ⚠️ TESTISO-1（2026-10-17）：这里**故意不再** mkdir / writeFileSync。
//    旧行为在模块顶层截断 <ROOT>/data/_app.log —— 单测一 import 就清空 e2e 正在读的日志（假红）。
//    现在导入期只把头部写进**内存缓冲**；真正落盘发生在 configureLogFile()（主进程按 data_dir 调）或永不发生。
// ⚠️ 写不进去**仍必须可见**（T-22a 的 P0）：失败在 configureLogFile()/appendLine() 里记进 logStatus()
//    并大声报一次（见 announceLogFailure）—— 而不是靠导入期那次写。
log('=== gemma-search 启动 ===');
log(
  'electron',
  process.versions.electron,
  '· chrome',
  process.versions.chrome,
  '· node',
  process.versions.node,
);
log('ELECTRON_RUN_AS_NODE =', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null));
log('argv =', JSON.stringify(process.argv.slice(1)));
log('日志文件 =', resolveLogFile());
log(
  '日志落点来源 =',
  process.env.GEMMA_APP_LOG
    ? 'GEMMA_APP_LOG 覆盖'
    : PACKED && PACKED_USER_DATA
      ? '打包态 <userData>/logs'
      : '<ROOT>/data',
  '· PACKED =',
  PACKED,
);
log('应用根 =', ROOT);
if (PACKED || resolveLogFile().includes('app.asar')) {
  log(
    '!! 注意：应用根落在 asar 内（HERE=' +
      HERE +
      '），data/ 无法写入 —— 打包态需要改用 userData（P6）',
  );
}

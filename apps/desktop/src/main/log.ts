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
    return false;                      // 坏了/不可读就当它不是，继续向上
  }
}

/** 从 start 向上找仓库根；找不到返回 null（打包态或未知布局） */
function detectRepoRoot(start: string): string | null {
  let engineRoot: string | null = null;
  for (let p = start; ;) {
    if (isWorkspaceRoot(p)) return p;
    if (engineRoot === null && fs.existsSync(path.join(p, ENGINE_MARKER))) engineRoot = p;
    const up = path.dirname(p);
    if (up === p) return engineRoot;   // 已到盘根：退而求其次
    p = up;
  }
}

/** 兜底：**只在标记探测完全失败时**才用（多半是打包态 —— 那时根本没有"仓库根"）。 */
const FALLBACK_ROOT: string = path.resolve(HERE, '..', '..');

export const ROOT: string = process.env.GEMMA_ROOT || detectRepoRoot(HERE) || FALLBACK_ROOT;

export const LOG_FILE: string = process.env.GEMMA_APP_LOG || path.join(ROOT, 'data', '_app.log');

/** 打包态：本模块在 app.asar 内运行（与 ROOT 解成什么无关，看 HERE 这个事实） */
const PACKED: boolean = HERE.includes('app.asar');

const stamp = (): string => new Date().toISOString().slice(11, 23);

/** 任何值 → 一行可读字符串（永不抛） */
const fmt = (x: unknown): string =>
  typeof x === 'string' ? x
    : x && typeof x === 'object' && typeof (x as { stack?: unknown }).stack === 'string'
      ? (x as { stack: string }).stack
      : (() => { try { return JSON.stringify(x); } catch { return String(x); } })();

/**
 * 首次写日志时的**自我断言**：ROOT 必须真的是仓库根。
 * 判定与上面的探测**用同一套标记**（否则"怎么找的"和"怎么验的"会互相打架）。
 * 打包态（PACKED）根本没有仓库根可言 ⇒ 直接跳过断言，改由下面那条 asar 警告负责。
 */
let rootAsserted = false;
function assertRootOnce(): void {
  if (rootAsserted) return;            // 先置位 → 下面递归调用 log() 时不会重入
  rootAsserted = true;
  if (PACKED) return;                  // 打包态无仓库根可言

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
  log('!!   后果 = 日志会写到错误目录（静默）、data/ 也会找错 —— 请设 GEMMA_ROOT=<仓库根> 后重跑。');
  log('!'.repeat(82));
}

/** 写一行日志：文件 + stdout，两边都失败也不能让应用崩。 */
export function log(...args: unknown[]): void {
  assertRootOnce();                    // ← 首次调用即自检（递归安全：标志已先置位）
  const line = `[` + stamp() + `] ` + args.map(fmt).join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch { /* 日志写不了不是致命错误 */ }
  try { process.stdout.write(line); } catch { /* GUI 子系统没有 stdout */ }
}

// ---------------------------------------------------------------- 初始化
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch { /* ignore */ }
try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch { /* ignore */ }

log('=== gemma-search 启动 ===');
log('electron', process.versions.electron, '· chrome', process.versions.chrome, '· node', process.versions.node);
log('ELECTRON_RUN_AS_NODE =', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null));
log('argv =', JSON.stringify(process.argv.slice(1)));
log('日志文件 =', LOG_FILE);
log('应用根 =', ROOT);
if (PACKED || LOG_FILE.includes('app.asar')) {
  log('!! 注意：应用根落在 asar 内（HERE=' + HERE + '），data/ 无法写入 —— 打包态需要改用 userData（P6）');
}

// apps/desktop/src/main/log.mjs —— 主进程日志（**必须写文件**）
//
// 为什么不是只 console.log（本项目实测踩过，见 app/main/bootstrap.cjs 的记录）：
//   Windows 上 Electron 是 **GUI 子系统程序**，主进程的 stdout **不连终端** ——
//   `console.log` 一条都看不到，表现出来就是"启动后什么都没发生"。
//   所以日志同时写 `<根>/data/_app.log`（可用 GEMMA_APP_LOG 覆盖）与 stdout
//   （dev 态 electron-vite 把 stdout 接回终端，所以两种运行方式都能读到）。
//
// 模块导入即初始化：截断上一轮日志并写下本轮头部。副作用写在模块顶层是**故意的** ——
// 它必须早于任何可能抛错的导入执行，否则"导入期失败"会连一行日志都不留。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 应用根目录（仓库根：`package.json`(workspaces) / `data/` 所在处）。
 *
 * ⚠️ **不能用固定层级的 `resolve(HERE, '..', ...)`** —— 本次目录重构的真坑，记在这里免得再犯：
 *   同一个模块在两种运行态下距仓库根的级数**不同**：
 *     · 源码态  HERE = `<仓库根>/apps/desktop/src/main` → 距根 **4** 级
 *     · 构建态  HERE = `<仓库根>/out/main`（electron-vite 把 main 打进这里；
 *               `package.json` 的 `"main"` 就是 `./out/main/index.js`）→ 距根 **2** 级
 *   所以 `resolve(HERE,'..','..')`（旧值，源码态曾是 `src/main` 时两者恰好都是 2 级）
 *   与 `resolve(HERE,'..','..','..','..')`（搬到 apps/ 之后的源码态）
 *   **各自只对一种态成立**：另一种会静默指到仓库根之外 —— 日志写到别的地方，
 *   程序照跑、不报错，正是"最容易静默出错"的那类问题。
 *   因此这里改为**向上找标记**（深度无关），两种态都解到同一个根：
 *     首选「`package.json` 且声明了 `workspaces`」＝ npm workspaces 根＝仓库根；
 *     退化到「含 `packages/engine/src/engine.mjs`」（workspaces 尚未声明时也能成立）。
 *
 * 打包态（P6 未做）：`out/main` 在 `app.asar` 内，asar 里**没有仓库根可言** ——
 *   检测会失败并退回 asar 根；`data/` 在 asar 内不可写。这一点由下面的 asar 警告
 *   按事实报出，**不在这里假装已经解决**（P6 要改用 `path.dirname(app.getPath('exe'))`
 *   或 `app.getPath('userData')`）。
 */

/** 退化标记：仓库根下必然存在的文件（P1 搬家后的路径） */
const ENGINE_MARKER = path.join('packages', 'engine', 'src', 'engine.mjs');

/** `package.json` 里声明了 `workspaces` ⇔ 这是本仓库的仓库根 */
function isWorkspaceRoot(dir) {
  try {
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) return false;
    // 容忍 UTF-8 BOM：Windows 编辑器写出的 package.json 可能带 BOM，而 JSON.parse 会直接抛。
    // 不容忍的话 ROOT 会退化到引擎标记（仍然正确），但断言会**误报** —— 一条会乱叫的告警没人信。
    const txt = fs.readFileSync(pkg, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(txt).workspaces !== undefined;
  } catch {
    return false;                      // 坏了/不可读就当它不是，继续向上
  }
}

/** 从 start 向上找仓库根；找不到返回 null（打包态或未知布局） */
function detectRepoRoot(start) {
  let engineRoot = null;
  for (let p = start; ;) {
    if (isWorkspaceRoot(p)) return p;
    if (!engineRoot && fs.existsSync(path.join(p, ENGINE_MARKER))) engineRoot = p;
    const up = path.dirname(p);
    if (up === p) return engineRoot;   // 已到盘根：退而求其次
    p = up;
  }
}

/**
 * 兜底：**只在标记探测完全失败时**才用（多半是打包态 —— 那时根本没有"仓库根"）。
 *
 * ⚠️ 这里**刻意按层级数 `..`**，而层级数**两态不同**（这就是本文件不再靠层级数做主判据的原因）：
 *   · 构建态 `out/main`            → `..`/`..` = 仓库根 ✅
 *   · 源码态 `apps/desktop/src/main` → `..`/`..` = `<仓库根>/apps/desktop` ❌
 * 所以：正常两态都走 `detectRepoRoot()`（标记式，深度无关），**走不到这里**；
 * 真走到这里时 `assertRootOnce()` 会打醒目横幅（源码态确实会误报 —— 那是**故意的**：
 * 与其静默用错根，不如吵一声并让你用 `GEMMA_ROOT` 指定）。
 * 打包态由 `PACKED` 分支跳过断言（见下），不会误报。
 */
const FALLBACK_ROOT = path.resolve(HERE, '..', '..');

export const ROOT = process.env.GEMMA_ROOT || detectRepoRoot(HERE) || FALLBACK_ROOT;

export const LOG_FILE = process.env.GEMMA_APP_LOG || path.join(ROOT, 'data', '_app.log');

/** 打包态：本模块在 `app.asar` 内运行（与 ROOT 解成什么无关，看 HERE 这个事实） */
const PACKED = HERE.includes('app.asar');

const stamp = () => new Date().toISOString().slice(11, 23);
const fmt = (x) =>
  typeof x === 'string' ? x : x && x.stack ? x.stack : (() => {
    try { return JSON.stringify(x); } catch { return String(x); }
  })();

/**
 * 首次写日志时的**自我断言**：ROOT 必须真的是仓库根。
 *
 * 判定与上面的探测**用同一套标记**（否则"怎么找的"和"怎么验的"会互相打架）：
 *   ✅ 确认 = `package.json` 声明了 `workspaces` **或** 存在 `packages/engine/src/engine.mjs`
 *      —— 后者正是 7 个守卫共用的仓库根标记，也是本次重构冻结后的路径。
 *   ❌ 两者都没有 → 打印醒目横幅。
 *
 * 为什么必须有它：ROOT 解错是**静默**的 —— 日志文件会建在别处、程序照跑，
 * 只有"日志去哪了"这个线索，而它恰恰是排障时唯一想看的东西。上面 4 级/2 级的
 * 双态差异就是这么被漏掉的。代价只有两次 `fs.existsSync` + 一次读 `package.json`。
 *
 * 为什么**打包态不会误报**：断言的前提是"ROOT 应当等于仓库根"，而打包态（`PACKED`）
 * 里根本没有仓库根 —— 代码在 `app.asar` 内，`data/` 按设计要改用 userData（P6）。
 * 所以这里在打包态**直接跳过**断言，改由下面那条 asar 事实警告负责报"不可写"。
 * 于是断言只会在它真正适用的两个态（源码态 / 构建态）里发声，不会变成狼来了。
 */
let rootAsserted = false;
function assertRootOnce() {
  if (rootAsserted) return;            // 先置位 → 下面递归调用 log() 时不会重入
  rootAsserted = true;
  if (PACKED) return;                  // 打包态无仓库根可言（见上）

  const hasWorkspaces = isWorkspaceRoot(ROOT);
  const hasEngineMarker = fs.existsSync(path.join(ROOT, ENGINE_MARKER));
  if (hasWorkspaces || hasEngineMarker) {
    // workspaces 声明由 P2-B 落地；它还没到位时 ROOT 仍由退化标记认出，提示一句即可，
    // **不**当成 ROOT 错了 —— 把两件事混成一条告警会让人不再信任这条告警。
    if (!hasWorkspaces) {
      log('提示：ROOT 由 packages/engine/src/engine.mjs 认出；package.json 尚未声明 "workspaces"。');
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
export function log(...args) {
  assertRootOnce();                    // ← 首次调用即自检（递归安全：标志已先置位）
  const line = `[${stamp()}] ${args.map(fmt).join(' ')}\n`;
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
  log('!! 注意：应用根落在 asar 内（HERE=' + HERE + '），`data/` 无法写入 —— 打包态需要改用 userData（P6）');
}

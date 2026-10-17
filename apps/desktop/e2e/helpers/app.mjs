// apps/desktop/e2e/helpers/app.mjs —— 两个标准场景的启动器
//
// 为什么需要"场景"而不是直接 launch：
//   应用的行为**强依赖"有没有库"** —— 一个库都没有时它会用首启向导挡住整个界面（D2）。
//   而本机**有真实库**（`G:\model` 且 `data/libraries/L1/` 存在）⇒ 默认启动永远进主界面。
//   所以两种场景必须**各造一次干净环境**，否则测不到另一条分支。
//
// 造"无库"要把库的四条来源**全部堵死**（`library-config.mjs` 的解析顺序）：
//   ① `GEMMA_LIB_ROOT`  —— 设成空串（空串是 falsy ⇒ 那条路被跳过）
//   ② `userData/library-registry.json` —— 用 `--user-data-dir` 指向临时空目录
//   ③ `GEMMA_CONFIG` / `config.json` —— 指向一个临时 JSON，里面**不写 lib_root**
//   ④ `data/libraries/*/meta.json` 自举 —— 同一个临时 JSON 把 `data_dir` 指到空目录
// 四条都断了，才会真的没有库。少堵一条，测出来的就是"有库"分支，而测试还会"通过"——
// 那是最坏的一种假绿（本仓库栽过的坑就是这个形状）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IMG_EXT } from '../../../../packages/engine/src/fingerprint.ts';

import { launchApp, E2E_TMP_ROOT } from './launch.mjs';

/** 夹具库（**不是**本机真实库 —— E2E 不该依赖 `G:\model`） */
export const FIXTURE_LIB = fileURLToPath(new URL('../fixtures/lib-mini', import.meta.url));

/**
 * 夹具库里**至少**要有几张图，才算「有库」场景成立。
 *
 * 为什么这条必须存在（T-43 / F-2）：夹具目录不存在时，过去 `launchWithLibrary()` 照样
 * 把 `GEMMA_LIB_ROOT` 指过去、界面照样进主界面、这批 spec **照样全绿** —— 「有库」场景
 * 退化成了空库而没有任何人知道。所以「夹具有几张图」必须可断言。
 */
export const MIN_FIXTURE_IMAGES = 3;

/** 递归数夹具库里的图片（扩展名判据用引擎的 `IMG_EXT` —— 不留第二份扩展名列表，P1） */
function countFixtureImages(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) n += countFixtureImages(p);
    else if (IMG_EXT.has(path.extname(ent.name).toLowerCase())) n += 1;
  }
  return n;
}

/**
 * 建一个临时目录（调用方负责在 finally 里删）。
 * ⚠️ START-1：底座是**工作区内**的 `E2E_TMP_ROOT`，不是 `os.tmpdir()` ——
 *    工作区之外写入会被环境拒绝 ⇒ Chromium 重试 ~6.1 s（理由与证据见 helpers/launch.mjs 的常量注释）。
 */
function tmpDir(tag) {
  fs.mkdirSync(E2E_TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(E2E_TMP_ROOT, `${tag}-`));
}

// FIXTURE-DB-1（task-124·2026-10-17）：把**被跟踪的夹具库**复制成本轮**临时库**。
//
// 为什么必须复制：产品按 SPEC §3 把 `.gs.db` 写在**库根**下 —— 这没错；错的是 e2e 把
// `apps/desktop/e2e/fixtures/lib-mini`（**仓库里被跟踪的契约夹具**）直接当库根：
//   ⇒ 每轮 e2e 都会在那个目录里生成/重写 `.gs.db`（未跟踪 ⇒ `git add -A` 误提交风险），
//      而且 11 个 spec 每轮都在**同一个** `.gs.db` 上叠加 ⇒ **跨 run 状态污染**（旧 schema /
//      半写事务会被带进下一轮，可能让测试假绿或假红）。
// 修法：复制到 `E2E_TMP_ROOT`（`data/_e2e-tmp/`，已被 .gitignore 覆盖）下的 `lib-mini-XXXX/lib-mini/`，
//   库根指副本 ⇒ 夹具本体**只读**，且**每轮都是全新库**。
// ⚠️ 副本的 basename 仍是 `lib-mini`（`gate.spec.mjs` 断侧栏文本含 `lib-mini` ⇒ 行为不变）。
/**
 * 复制夹具库到本轮临时目录；调用方负责调 `cleanup()`（或把它并进别人的 finally）。
 */
export function makeFixtureLibCopy() {
  const parent = tmpDir('lib-mini');
  const root = path.join(parent, 'lib-mini');
  fs.cpSync(FIXTURE_LIB, root, { recursive: true });
  return { root, cleanup: () => rmTmp(parent) };
}

/** 建一份"只有 data_dir、没有任何库来源"的临时配置 */
function writeBareConfig(userData, dataDir) {
  const p = path.join(userData, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ data_dir: dataDir }), 'utf8');
  return p;
}

/**
 * 收尾：删掉本次场景造的两个临时目录。
 * ⚠️ 原先只删 `userData`，`dataDir` 一直留在系统临时目录里（一天跑几十次就积几十个）。
 *    临时目录删不掉不致命，所以静默忽略——但**要试**。
 */
function rmTmp(...dirs) {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录，删不掉不致命 */
    }
  }
}

/**
 * 启动一个「**已登记但库根不见了**」的应用（U18 场景）。
 *
 * 复现方式：把 `GEMMA_LIB_ROOT` 指到一个**不存在**的路径、其余库来源照旧堵死。
 * ⚠️ 这里**故意不做** `launchWithLibrary()` 那种"夹具必须存在"的硬失败 ——
 *    本场景要测的**正是**"路径不存在"这件事：`library-config` 对不存在的库根只报一条 warning、
 *    仍然把库交出去（所以界面照样进主界面），而 U18 要求**界面上看得见它 + 写明原因**。
 * ⇒ 断言「主界面里出现不可用横幅」才算过；若哪天库被静默丢掉，这条会红。
 *
 * @returns `{ app, cleanup, missingRoot }`（`missingRoot` 供断言/排障时打印）
 */
export async function launchWithMissingLibrary() {
  const userData = tmpDir('userdata');
  const dataDir = tmpDir('data');
  const cfgPath = writeBareConfig(userData, dataDir);
  // 一个**必然不存在**的库根：先建一个临时目录再往里拼一级（不依赖任何盘符/权限假设）
  const missingRoot = path.join(tmpDir('missing-root'), 'lib-does-not-exist');

  const app = await launchApp({
    // 三条"堵住别的库来源"的理由同 launchWithoutLibrary；只有 GEMMA_LIB_ROOT 是非空但不存在
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: missingRoot,
      GEMMA_COLLECT_DIRS: '',
      GEMMA_FAKE: '',
    },
    extraArgs: [`--user-data-dir=${userData}`],
  });

  return {
    app,
    missingRoot,
    /** TESTISO-1：本进程自己的日志（落点跟随 data_dir ⇒ 每个启动一份，不与他人共享） */
    logPath: path.join(dataDir, '_app.log'),
    cleanup: () => rmTmp(userData, dataDir, path.dirname(missingRoot)),
  };
}

/**
 * 启动一个"**没有库**"的应用 → 应该看到首启向导。
 *
 * ⚠️ `GEMMA_LIB_ROOT: ''` 是刻意的：`launchApp` 会用 `process.env` 打底，
 *    若父进程（或 CI）恰好设了这个变量，不显式置空就会静默变成"有库"分支。
 */
export async function launchWithoutLibrary() {
  const userData = tmpDir('userdata');
  const dataDir = tmpDir('data'); // 空目录 ⇒ 第 ④ 条自举找不到 meta.json
  const cfgPath = writeBareConfig(userData, dataDir);

  const app = await launchApp({
    // ⚠️ `GEMMA_FAKE: ''` 与本文件的 `GEMMA_LIB_ROOT: ''` 同样必要：
    //    `launchApp` 用 `process.env` 打底，父进程（或 CI）一旦设了 `GEMMA_FAKE=1`，
    //    这个"真实模式"场景就会**静默**变成模拟模式，而测试**照样会过** ——
    //    那是最坏的一种假绿（本文件头的注释警告的正是这个形状）。
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: '', GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '' },
    extraArgs: [`--user-data-dir=${userData}`],
  });

  return {
    app,
    /** TESTISO-1：本进程自己的日志（落点跟随 data_dir ⇒ 每个启动一份，不与他人共享） */
    logPath: path.join(dataDir, '_app.log'),
    cleanup: () => rmTmp(userData, dataDir),
  };
}

/**
 * 启动一个"**有库**"的应用 → 应该进主界面（路由与检索界面可测）。
 * 用 `GEMMA_LIB_ROOT` 指到**夹具目录**（第 ① 条），不依赖本机真实库。
 */
export async function launchWithLibrary() {
  // ⚠️ 2026-10-15（T-43 / F-2）：夹具目录**必须真的存在且有图**，否则本函数会静默把
  //    `GEMMA_LIB_ROOT` 指向一个不存在的路径 —— 而 `library-config` 对不存在只是**一条 warning**，
  //    `decideGate()`（utils/gate.ts:34）又只看 `libraries.length` ⇒ 界面照样进主界面，
  //    这批 spec **在「空库」上跑还是全绿**。实测（2026-10-15）：FIXTURE_LIB 曾指向
  //    `e2e/fixtures/lib-mini`（当时不存在），27 条 spec 25 passed / 2 failed（那 2 条是并发构建
  //    导致的 electron.launch 超时），且 gate E1-c 把那条**不存在的路径**当「证据」打印出来并通过了。
  //    ⇒ 在这里**硬失败**：把「夹具没了」变成响亮的红，而不是又一片空的绿。
  const images = countFixtureImages(FIXTURE_LIB);
  if (!fs.existsSync(FIXTURE_LIB) || !fs.statSync(FIXTURE_LIB).isDirectory()) {
    throw new Error(
      `E2E 夹具库不存在：${FIXTURE_LIB}（「有库」场景会静默退化成空库 ⇒ 断言是空的绿）`,
    );
  }
  if (images < MIN_FIXTURE_IMAGES) {
    throw new Error(
      `E2E 夹具库 ${FIXTURE_LIB} 里只有 ${images} 张图（要求 ≥ ${MIN_FIXTURE_IMAGES}）—— 空的「有库」场景没有意义`,
    );
  }

  const userData = tmpDir('userdata');
  const dataDir = tmpDir('data');
  const cfgPath = writeBareConfig(userData, dataDir);
  // FIXTURE-DB-1：库根用**副本**（夹具本体只读；每轮全新库，避免跨 run 状态污染）
  const lib = makeFixtureLibCopy();

  const app = await launchApp({
    // ⚠️ `GEMMA_FAKE: ''` 见 `launchWithoutLibrary` 的注释 —— 这里是**最要紧**的一处：
    //    同一个 spec 文件里前几条用例用 `launchFake()`，这条用的是真实模式；
    //    不显式置空的话，"真实模式"那条会静默跑成模拟模式（`E10-f` 实测出现过这种假绿/假红）。
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: lib.root, GEMMA_FAKE: '' },
    extraArgs: [`--user-data-dir=${userData}`],
  });

  return {
    app,
    libRoot: lib.root,
    /** TESTISO-1：本进程自己的日志（落点跟随 data_dir ⇒ 每个启动一份，不与他人共享） */
    logPath: path.join(dataDir, '_app.log'),
    cleanup: () => {
      rmTmp(userData, dataDir);
      lib.cleanup();
    },
  };
}

/**
 * 启动**模拟模式**（`GEMMA_FAKE=1`，契约 §8）→ 界面用 `fixtures/sample-index.json` 的样例数据。
 *
 * ⭐ 为什么这个场景很关键：P3c/P3d 的验收需要**有结果、有进度、有失败项、有 RECOVERY_NEEDED**，
 *    而真实检索要 ONNX 模型 + 已注册索引（本环境跑不了）。
 *    模拟模式让这些状态**可复跑**地出现在真窗口里。
 *
 * ⚠️ 刻意**不设** `GEMMA_LIB_ROOT`：模拟模式的库来自 fixture，不该被真实库路径干扰。
 *    但要把另外三条来源也堵掉（同 `launchWithoutLibrary` 的理由）—— 否则"样例"与"真库"混在一起，
 *    测试会绿得毫无意义。
 */
export async function launchFake() {
  const userData = tmpDir('fake-userdata');
  const dataDir = tmpDir('fake-data');
  const cfgPath = writeBareConfig(userData, dataDir);

  const app = await launchApp({
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: '', GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '1' },
    extraArgs: [`--user-data-dir=${userData}`],
  });

  return {
    app,
    /** TESTISO-1：本进程自己的日志（落点跟随 data_dir ⇒ 每个启动一份，不与他人共享） */
    logPath: path.join(dataDir, '_app.log'),
    cleanup: () => rmTmp(userData, dataDir),
  };
}

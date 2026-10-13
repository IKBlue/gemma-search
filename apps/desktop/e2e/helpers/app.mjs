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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchApp } from './launch.mjs'

/** 夹具库（**不是**本机真实库 —— E2E 不该依赖 `G:\model`） */
export const FIXTURE_LIB = fileURLToPath(new URL('../fixtures/lib-mini', import.meta.url))

/** 建一个临时目录（调用方负责在 finally 里删） */
function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gemma-e2e-${tag}-`))
}

/** 建一份"只有 data_dir、没有任何库来源"的临时配置 */
function writeBareConfig(userData, dataDir) {
  const p = path.join(userData, 'config.json')
  fs.writeFileSync(p, JSON.stringify({ data_dir: dataDir }), 'utf8')
  return p
}

/**
 * 收尾：删掉本次场景造的两个临时目录。
 * ⚠️ 原先只删 `userData`，`dataDir` 一直留在系统临时目录里（一天跑几十次就积几十个）。
 *    临时目录删不掉不致命，所以静默忽略——但**要试**。
 */
function rmTmp(...dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 临时目录，删不掉不致命 */ }
  }
}

/**
 * 启动一个"**没有库**"的应用 → 应该看到首启向导。
 *
 * ⚠️ `GEMMA_LIB_ROOT: ''` 是刻意的：`launchApp` 会用 `process.env` 打底，
 *    若父进程（或 CI）恰好设了这个变量，不显式置空就会静默变成"有库"分支。
 */
export async function launchWithoutLibrary() {
  const userData = tmpDir('userdata')
  const dataDir = tmpDir('data')          // 空目录 ⇒ 第 ④ 条自举找不到 meta.json
  const cfgPath = writeBareConfig(userData, dataDir)

  const app = await launchApp({
    // ⚠️ `GEMMA_FAKE: ''` 与本文件的 `GEMMA_LIB_ROOT: ''` 同样必要：
    //    `launchApp` 用 `process.env` 打底，父进程（或 CI）一旦设了 `GEMMA_FAKE=1`，
    //    这个"真实模式"场景就会**静默**变成模拟模式，而测试**照样会过** ——
    //    那是最坏的一种假绿（本文件头的注释警告的正是这个形状）。
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: '', GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '' },
    extraArgs: [`--user-data-dir=${userData}`],
  })

  return {
    app,
    cleanup: () => rmTmp(userData, dataDir),
  }
}

/**
 * 启动一个"**有库**"的应用 → 应该进主界面（路由与检索界面可测）。
 * 用 `GEMMA_LIB_ROOT` 指到**夹具目录**（第 ① 条），不依赖本机真实库。
 */
export async function launchWithLibrary() {
  const userData = tmpDir('userdata')
  const dataDir = tmpDir('data')
  const cfgPath = writeBareConfig(userData, dataDir)

  const app = await launchApp({
    // ⚠️ `GEMMA_FAKE: ''` 见 `launchWithoutLibrary` 的注释 —— 这里是**最要紧**的一处：
    //    同一个 spec 文件里前几条用例用 `launchFake()`，这条用的是真实模式；
    //    不显式置空的话，"真实模式"那条会静默跑成模拟模式（`E10-f` 实测出现过这种假绿/假红）。
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: FIXTURE_LIB, GEMMA_FAKE: '' },
    extraArgs: [`--user-data-dir=${userData}`],
  })

  return {
    app,
    libRoot: FIXTURE_LIB,
    cleanup: () => rmTmp(userData, dataDir),
  }
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
  const userData = tmpDir('fake-userdata')
  const dataDir = tmpDir('fake-data')
  const cfgPath = writeBareConfig(userData, dataDir)

  const app = await launchApp({
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: '', GEMMA_COLLECT_DIRS: '', GEMMA_FAKE: '1' },
    extraArgs: [`--user-data-dir=${userData}`],
  })

  return {
    app,
    cleanup: () => rmTmp(userData, dataDir),
  }
}

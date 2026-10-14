# 项目部署与分发说明（Deployment）

> **状态**：现行 · **最后核对**：2026-10-12
> **权威范围**：从零克隆到跑起来 · 打包与分发现状 · 原生模块部署风险 · 离线保证 · 部署缺口清单。
> 它**不定义**成功标准（见 `docs/spec/SPEC-acceptance.md`）。
>
> **本文定位**：说明**从零克隆到跑起来**、**打包分发到别的机器**、以及**部署上尚未做/未验证的部分**。
> ⚠️ **P6（打包与离线）尚未执行**：本文区分「已实现」与「已设计但未验证」，不把计划写成事实。
> 事实基准：`docs/audit/00-current-state.md`。
> 路径按 monorepo 新布局书写（`npm test` 的 glob、守卫与产物路径已在 P2 适配）。

---

## 1. 已实现：开发机运行

### 1.1 前置

| 项 | 要求 | 依据 |
|---|---|---|
| Node | ≥ 20 | `package.json` `engines` |
| 平台 | Windows（主目标）· macOS / Linux 配置存在但未验证 | `electron-builder.yml` |
| 素材库 | `G:\model`（3594 图 + 3594 包，207.3 GB） | `docs/plan/ROADMAP.md` §0 |
| 模型 | `onnx-community/embeddinggemma-2-ONNX` · revision `daa72c5…` · fp32（**1.63 GB**） | 索引 `meta.json` 实测 |
| 索引 | `data/libraries/L1/`（≈13 MB） | 实测存在 |

### 1.2 三步跑起来

```powershell
git clone https://github.com/IKBlue/gemma-search.git
cd gemma-search
npm install
```

**唯一已知的安装坑（实测过）**：Electron 二进制可能下不下来（包装上、平台二进制没下来）。

```powershell
# 若卡在 electron 二进制下载（报 fetch failed，且 %LOCALAPPDATA%\electron\Cache 为空）：
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
# 实测：直连 GitHub releases 页面 HEAD 返回 200，但**资产下载**会失败；换镜像后正常（246 MB）
```

### 1.3 运行

```powershell
npm run dev      # dev server + HMR（改渲染层即时生效）
npm run build    # 产出 out/main · out/preload · out/renderer
npm start        # 跑刚 build 出来的产物（接近打包态）

# 受限环境（Chromium 进程沙箱起不来 → Electron 秒退、日志一行都不生成）：
npm run dev:restricted      # = dev --noSandbox
npm run start:restricted    # 跑构建产物（file://）
```

`dev`/`start` 走 `scripts/electron-vite.mjs`，它做两件事（都有理由）：
1. 摘掉 `ELECTRON_RUN_AS_NODE`（该变量会让 Electron 以**纯 Node** 运行，报错极具误导性）
2. 探测本机沙箱是否可用，**只为这一次启动**附加 `--no-sandbox`，并把判断依据打印出来
   （普通机器上不会出现这一行；**不固化进产品**）

### 1.4 日志（排障第一站）

| 项 | 说明 |
|---|---|
| 位置 | `data\_app.log` |
| 为什么需要它 | Windows 上 Electron 是 GUI 子系统程序，**主进程 stdout 不连终端**，`console.log` 一条都看不到 |
| 覆盖范围 | 主进程诊断 **+** 渲染进程 console（主进程转发到同一文件） |

---

## 2. ✅ 配置：**已修**（D2 · 2026-10-12）

> **以下是修复前的原文与实际状态**，保留作记录 —— 它说明这个部署阻塞项**当时是什么样、为什么必须修**。
> 修复内容见本节末尾。

| 文档说（当时） | 代码做（当时） | 实际（当时） |
|---|---|---|
| `README.md`：「**没有配置文件了**。旧的 `config.json` / 环境变量体系随 Python 层一起删除。素材库位置由应用内的**库注册表**管理」 | `apps/desktop/src/main/index.mjs` 的 `loadConfig()` 读 **`config.json`**；`GEMMA_CONFIG` 环境变量优先 | `Test-Path config.json` → **False** ⇒ 配置读不到 |
| `README.md`：库注册表在 `packages/engine/src/library.mjs` | `LibraryRegistry` 是**纯内存派生**，注释自己写「P1 从 `config.json` 派生单库；**P5 扩为真正的多库注册表**」 | **无持久化**（P5 才做） |
| ~~`docs/plan/PRE-KICKOFF-CHECK.md` 教用户「克隆后必须知道去哪配 `library_root`」~~ | 同左 | **该文件已删除**（本轮重构并入 `AGENTS.md`） |

**当时的后果链**：

```
config.json 不存在
  → loadConfig() 静默返回 {}
  → LIB_ROOT = ''
  → buildEngine() 传空 libraries 数组
  → 界面永远显示「未配置素材库（config.json 的 library_root）」
  → 检索报 INDEX_MISSING / LIB_NOT_FOUND
  → collect 也必失败（collect.dirs = {}）
```

### ✅ 已修：库的四条来源 + 首启向导（2026-10-12）

**代码行为已变**，本次部署不再有这一阻塞项：

| 现在 | 说明 |
|---|---|
| **① `GEMMA_LIB_ROOT` 环境变量** | 显式覆盖，`tools/` 里的守卫一直用这个惯例 |
| **② `userData/library-registry.json`** | 决策 9 的正规存储；由首启向导写入 |
| **③ `config.json`** | **只是兼容回退**，不再要求用户去配它 |
| **④ 已有索引自举** | 读 `data/libraries/*/meta.json` 的 `lib_id` + `lib_root` ⇒ **本机零配置可用** |
| **取件白名单** | 不再为空：默认 `E:\素材待用` / `E:\移出素材`（F-04 同时解决） |
| **无库时** | 界面显示**首启向导**（选文件夹 → 写注册表），不是裸 `LIB_NOT_FOUND` |

实现 `apps/desktop/src/main/library-config.mjs`；测试 `apps/desktop/tests/library-config.test.mjs`（12 条）
+ `tools/verify_renderer_dom.mjs` §8（7 条）—— **⚠️ 该守卫已于 2026-10-13 移除**，界面侧的向导验证现在没有自动化。定性见 [`../audit/AUDIT-FINAL.md`](../audit/AUDIT-FINAL.md) 与 `AGENTS.md` §7.2。
**仍然断的**：`loadConfig()` 本身没删（它是第③层），只是不再是主来源；`P5` 的真·多库注册表 CRUD 仍欠。

---

## 3. 打包与分发（P6，**未执行**）

### 3.1 现状

| 项 | 状态 |
|---|---|
| `electron-builder.yml` | ✅ **形状正确，但从未打包验证** |
| 图标 | ❌ 仍是 electron-vite 脚手架的**默认图标**（配置文件自己注明「P6 换真图标」） |
| 安装器产物 | ❌ 无 |
| 干净机器验收 | ❌ 未做 |

### 3.2 配置里已写明的**待修项**（原文自注，不是我的判断）

| 项 | 配置文件原文 |
|---|---|
| `asarUnpack` 不完整 | 「`asarUnpack` 只列了 `resources`；`onnxruntime-node` / `sharp` 的原生 `.node` 在 asar 里加载不了，**P6 必须按实测把它们加进 `asarUnpack`**，别照抄，要实测」 |
| 模型与索引不入安装器 | 「模型（fp32 1.63 GB）与索引**不进安装器**（`SPEC-app.md` §3：NSIS 约 2 GB 封顶）」 |

### 3.3 打包命令（已定义，未验证）

```powershell
npm run build:unpack     # = build && electron-builder --dir（不生成安装器）
npm run build:win        # = build && electron-builder --win（NSIS 安装器）
```

`win.target = nsis`，`artifactName = ${name}-${version}-setup.${ext}`，
`createDesktopShortcut: always`。

### 3.4 分发设计的三个前提（决策 2）

| # | 前提 | 状态 |
|---|---|---|
| 1 | 安装器**不含**模型与索引 | ⚠️ 配置已按此写（`files` 排除了 `data` 等），**未验证** |
| 2 | 模型**首次获取** | ❌ 未实现（无下载/导入流程；`MODEL_MISSING` 文案是「还没有准备好模型文件，先下载一次」，但**没有那条路径**） |
| 3 | 干净机器验收 | ❌ 未做 |

⇒ **分发能力目前是 0**：没有安装器、没有模型获取路径、没有干净机器验证。

---

## 4. 运行时依赖与原生模块（部署风险点）

| 依赖 | 为什么不能进 bundle | 部署影响 |
|---|---|---|
| `onnxruntime-node` | 带原生 `.node` | 必须 `asarUnpack`，且**必须与目标平台/架构匹配** |
| `sharp` | 带原生 `.node` | 同上（`package.json` 注明了它必须**显式声明**，因为是 transformers 的可选传递依赖） |
| `@huggingface/transformers` | 会拉上面两个 | external，运行时从 `node_modules` 解析 |
| `bmp-js` | 纯 JS | 无 |
| `electron` | — | 由 electron-builder 处理 |

`electron.vite.config.mjs` 用 `externalizeDepsPlugin()` 把 `dependencies` **全部**列为 external。
理由（原文）：electron-vite 5 默认 `ssr.noExternal=true` 会把 `node_modules` 全打进去，而原生 `.node` **打进 bundle 必坏**。

**跨平台含义**：原生模块 ⇒ **不能跨平台交叉打包**（Windows 上打不出 macOS 包）。
`electron-builder.yml` 里有 `mac` / `linux` 段，但**从未验证**。

---

## 5. 离线保证（成功标准 9）

| 检查项 | 状态 |
|---|---|
| 渲染层 CSP 无远程源（`default-src 'self'`，`object-src 'none'`） | ✅ `apps/desktop/src/renderer/index.html` |
| 无 HTTP 端口 / 无自动更新 | ✅ `apps/desktop/src/main/index.mjs` 刻意不做 |
| 索引与检索路径无网络调用 | ✅ 读本地文件 + 本地编码器 |
| **真断网实测** | ❌ **未做** |
| 模型文件本地化 | ✅ 本机已有（1.63 GB）；但分发时需首次获取（未实现） |

---

## 6. 部署检查清单（**可用的部分**）

```powershell
# 1) 环境与依赖
node -v                                  # 期望 ≥ v20
npm install                              # 卡住见 §1.2 镜像方案

# 2) 引擎自证（不需要模型/GPU）
npm test                                 # 期望 tests 113 / pass 112 / fail 0 / skipped 1

# 3) 构建三端
npm run build



```

**本环境限制（影响可复现性）**：

| 步骤 | 本环境能否跑 |
|---|---|
| 1-3 | ✅ 可以 |
| （原 4/5/6：产物形状 / Electron 出窗 / 文档引用） | ❌ **2026-10-13 起这些守卫已移除**，无对应步骤 |
| 编码路径校验（`verify_encoder_path.mjs`） | ❌ 需模型目录 |

---

## 7. 部署上**未做 / 未验证**的完整清单

| # | 项 | 阻塞什么 |
|---|---|---|
| P1 | **配置来源**（§2） | 阻塞一切——跑起来就看不到库 |
| P2 | 安装器（NSIS） | 阻塞分发（决策 2 的核心诉求） |
| P3 | 真图标 | 分发观感 |
| P4 | `asarUnpack` 按实测补全 | 打包后原生模块加载失败 |
| P5 | 模型首次获取路径 | 干净机器无法使用 |
| P6 | 冷启动 ≤ 5 秒计时 | 成功标准 1 |
| P7 | 打包后行为验证 | 成功标准 1 / 3 / 4 |
| P8 | 干净机器验收 | 成功标准全部 |
| P9 | 断网实测 | 成功标准 9 |
| P10 | 授权确认（`LICENSE` MIT **待所有者确认**） | 对外发布 |

---

## 8. 本文未覆盖

- macOS / Linux 的实际打包与签名（`build/entitlements.mac.plist` 存在但未验证）
- 模型下载/导入流程的设计（当前**不存在**，需先出设计）
- 安装器体积实测（NSIS 约 2 GB 封顶是 `SPEC-app.md` §3 的约束，未实测）

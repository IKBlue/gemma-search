# AGENTS.md · 在这个仓库里怎么干活

> **本文件只记两样东西：① 项目架构 · ② 执行规范。** 它**不记**待办与缺陷。
> - 项目是什么、现在什么状态、怎么跑 → [`README.md`](README.md)
> - **还有什么没做完 / 什么坏了** → [`TODO.md`](TODO.md)
> - 什么顺序、什么算做完 → [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)
>
> **别在本文件里加 TODO 或 BUG** —— 那是 `TODO.md` 的职责（单一事实来源）。
> 本文合并了原 `AGENTS.md`（任务宪章）与 `PROJECT-GUIDE.md`（结构总览），两者已不再单独存在。
>
> 最后核对：2026-10-13 · 对应布局：monorepo（`apps/` + `packages/`，见 [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) §1，该结构已冻结）

---

## 0. 治理宪章（所有者指令，优先级最高）

1. **技术栈 / 框架 / 目录检查**：对标行业最佳实践，检索现有插件与方案；执行过程拆成**可验证的 subtasks**，先写清验收标准，再让**独立 Agent 复核**。
2. **UI/UX 检查（Apple Style）**：同样对标行业最佳实践（指名规范与章节，不写「主流做法」），拆成可验证 subtasks + 验收标准 + 独立复核。
3. **最终 review 与文档整理**：覆盖项目需求、设计、实现、测试、部署五类文档。

**由第 1、2 条派生的常驻纪律**（对本仓库所有后续工作生效）：

- 结论必须可追溯：每条带 `文件:行号` 或「命令 + 原始输出」；无证据的写【判断，非实测】。
- 必须区分三种东西：**① 代码事实 · ② 文档声称 · ③ 行业做法**。混在一起写就是耍流氓。
- 复核者不得只读结论，必须自己跑命令、自己回原文件核对。

### 0.1 所有者追加约束（2026-10-13，优先级同 §0）

#### 严格禁止事项

| # | 禁止 | 判据（**怎么算违反**，别靠感觉） |
|---|---|---|
| **P1** | **创建同一概念的多个实现** | 同一件事在仓库里有**两份代码 / 两份定义**。原则：**单一事实来源**（同 §4）——发现两处不一致，**改错的那处**，不要两处各改一半 |
| **P2** | **复制粘贴代码块** | 同一段逻辑（**哪怕有细微差异**）出现在 ≥2 处 → **提取到共享函数/模块**再复用 |
| **P3** | **硬编码应可配置的值** | 绝对路径、目录、端口、数量上限、超时、默认库位置等**写死在代码里** → **从配置文件或环境变量取**（与 §7「不把本机绝对路径写进代码」同源） |

#### 强制要求

| # | 要求 | 怎么做（**可执行**的做法） |
|---|---|---|
| **R1** | **债务预防** | **建新功能前先查有没有现成的**：grep 全仓 + 读 §4 权威表。确认没有再新建，**并在回报里写明"查过了，没有"**（不是默默新建） |
| **R2** | **新建文件必须修正目录结构** | 新文件落在 §3 规定的位置。**若磁盘结构与本文档不一致 → 改文档或改结构，两者必须一致**，不允许留下"文档说 A、磁盘是 B" |

#### 三层架构（MVC 分层，新增代码必须遵守）

```
UI(组件) ──> Operation(store/composable/utils) ──> Adapter(唯一 invoke 入口) ──> repo/service
```

| 层 | 职责 | 放在哪 | 禁止 |
|---|---|---|---|
| **UI**（组件 / View） | 只做渲染与用户交互 | `renderer/src/{pages,layout,ui,search}/**` | ❌ **不得直接碰 `window.api`**；不得写业务规则 |
| **Operation**（store / composable / utils） | 状态与编排；把 Adapter 的结果转成界面要的形状 | `renderer/src/store/**`（**新**）· `renderer/src/hooks/**` · `renderer/src/utils/**` | ❌ 不得散落协议细节（协议归 Adapter） |
| **Adapter**（**唯一 invoke 入口**） | **全应用只有一个地方碰 `window.api`**；统一解包错误信封、统一类型 | `renderer/src/adapter/**`（**新**） | ❌ 不得有第二个文件直调 `window.api` |
| **repo / service** | 数据来源 | `apps/desktop/src/main/**` · `packages/engine/**` | — |

**现状（2026-10-13）：这套架构是「目标态」，尚未落地。** 已实测的违例（3 个文件 7 处直调 `window.api` ·
UI 层直调 · 20 处信封解包 · 硬编码取件目录 · `cx.js` 与 `clsx` 同概念）
**逐条列在 [`TODO.md`](TODO.md) A 节**，每条带 `文件:行号` 与复现命令 —— **本文件不再重复，也不在别处再列一遍**。

⚠️ **规范（现在就要守）**：不要往第 4 个文件里再加 `window.api` 直调（违例会继续变大）；
碰引擎的新代码**一律经 `hooks/` 或未来的 `adapter/`**。

### 0.2 技术栈：现状与目标（2026-10-13 所有者指令）

**目标栈**：Electron · React · **TypeScript** · **shadcn/ui** · **Tailwind CSS** · **Zustand** · **React Router**。
⇒ 面向该目标的技术迁移**是一个计划，不是规范** —— 逐项实测现状、串行任务（T1→T5→T2→T3→T4）与
"依赖清账"全部在 **[`TODO.md`](TODO.md) B-1**；逐条验收标准在 [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) §10。

⚠️ **两条必须记住的规范**：
- **在 Tailwind 真正落地之前**，§3 的"手写 CSS + `var(--*)`"仍是现行规则 —— 别提前混写两套。
- **`npx tsc --noEmit` 目前是「假绿」**（两个 tsconfig 的 `checkJs` 都关着 ⇒ 0 错误）。
  **在 T1 完成前，不得声称"类型检查通过"。**

---

## 1. 这个仓库是什么

本地素材库的**离线语义检索**桌面应用：用中文描述找图、以图搜图，命中后给出同名模型压缩包的绝对路径。全离线、绝不写素材库。
技术栈、当前进度、命令与已知边界 → **[`README.md`](README.md)**（本文不重复）。

---

## 2. 目录职责表（每个顶层目录「管什么 · 能不能改 · 进不进 git」）

**「进不进 git」很关键**：不进的目录删了不会影响别人克隆——它们本该由命令生成。

| 路径 | 管什么 | 能改吗 | 进 git？ |
|---|---|---|---|
| `apps/desktop/` | Electron 应用：`src/main`（窗口/IPC/`thumb://`/日志）· `src/preload`（安全桥，产物必须 CJS）· `src/renderer`（React 19 界面）· `src/shared/ipc.mjs`（**IPC 契约唯一来源**） | ✅ 主战场 | ✅ |
| `packages/engine/` | 搜索引擎本体：`src/*.mjs`（**零第三方依赖**、传输无关）+ `tests/*.test.mjs` | ✅ 改完必须过 `npm test` | ✅ |
| `packages/indexer/` | 索引构建（ONNX + WebGPU）与重采样兼容层、BMP 解码；唯一能建索引的地方 | ⚠️ 谨慎：动了要重建索引验证 | ✅ |
| `packages/design-tokens/tokens.css` | **视觉令牌唯一来源**（生产依赖，被 `apps/desktop/src/renderer/src/main.jsx` 直接 import） | ✅ 只在这里加令牌，不要复制第二份。⚠️ **2026-10-13 所有者已确认降级**：Tailwind 接管后本文件成为**主题输入之一**（不再是"唯一来源"），见 `docs/plan/ROADMAP.md` §10；**落地前仍是唯一来源** | ✅ |
| `docs/` | 全部正文文档：`spec/`（约束）· `design/`（设计）· `guide/`（上手/排障）· `plan/`（做什么、什么顺序）· `audit/`（审查产物）· `archive/`（**已失效的东西全放这里**）。⚠️ **行动清单不在这里**，在根目录 [`TODO.md`](TODO.md) | ✅ 见 §6 纪律 | ✅ |
| `tools/` | **2 个只读守卫**（`verify_encoder_path` / `check_search`，本机都跑不动）+ `probe_electron_start/` | ✅ | ✅ |
| `scripts/` | 启动辅助（`electron-vite.mjs`：摘 `ELECTRON_RUN_AS_NODE`、探测沙箱、必要时加 `--no-sandbox`） | ⚠️ 谨慎 | ✅ |
| `reports/` | 门禁证据，命名 `G-<字母>-<日期>/`。**项目规则：无归档证据 = 门禁未通过** | ✅ 只能加新证据，不改历史证据 | ✅ md/json/csv；截图否（见 `.gitignore`） |
| `build/` | 打包图标 + 签名配置（electron-builder 的 `buildResources`）。**不是产物目录** | ⚠️ 别当产物删了 | ✅ |
| `resources/` | 打包辅助资源目录（当前为空） | ⚠️ 谨慎 | ✅ |
| `reference/MODEL_CARD.md` | 官方模型卡（外部资料） | ❌ 只读 | ✅ |
| `data/` | 索引、日志、诊断中间物、缩略图缓存 | ⚠️ **`_` 开头的一律可删；其余是正在用的索引，别删** | 🔸 绝大多数否 |
| `out/` | 构建产物（`npm run build` 生成） | ❌ 别手改 | ❌ |
| `node_modules/` · `.npm-cache/` | 第三方库与缓存 | ❌ 别碰 | ❌ |
| `tests/` | 预留的**跨包**集成测试位置（当前**不存在**；引擎单测随引擎走，在 `packages/engine/tests/`） | — | （未来）✅ |
| 根配置文件 | `package.json`（workspaces 根）· `electron.vite.config.mjs` · `electron-builder.yml` · `tsconfig*.json` · `.gitignore` · `.gitattributes` · `LICENSE` | ⚠️ **改前先问**（会同时影响构建、守卫与所有人） | ✅ |

**约定**：仓库根**只放** `AGENTS.md` · `README.md` · `TODO.md` 三份 `.md`。
⚠️ **2026-10-13：原先强制它的 `verify-doc-refs.mjs` 已移除** ⇒ 这条现在**没有自动化**，只能靠人看（见 §5.2）。
本轮审查的三份汇总报告在 `docs/audit/`（`AUDIT-FINAL.md` · `STACK-AUDIT.md` · `UIUX-AUDIT.md`）。

---

## 3. 新东西该放哪儿（最实用的一节）

| 你要加的东西 | 放哪儿 | 注意 |
|---|---|---|
| 界面页面 / 组件 | `apps/desktop/src/renderer/src/`（页面进 `pages/`，通用组件进 `ui/`，布局进 `layout/`，hooks 进 `hooks/`） | 样式写**手写 CSS**（`renderer.css`），不引入 Tailwind 类名。⚠️ **2026-10-13 所有者已确认反转**：将落地 Tailwind + shadcn/ui（**Tailwind 成为样式来源**、`tokens.css` 降级为其输入），见 `docs/plan/ROADMAP.md` §10。**在 §10.3 第 4 步落地前，本行仍是现行规则** —— 别提前混写两套。<br>⚠️ **UI 层不得直接碰 `window.api`**（见 §0.1 三层架构） |
| **Operation 层**（状态 / 编排 / 工具） | `renderer/src/store/**`（**新，Zustand 落地后**）· `renderer/src/hooks/**` · `renderer/src/utils/**` | 把 Adapter 的原始结果转成界面要的形状；**不放协议细节**（那归 Adapter）。🔴 **`store/` 与 `utils/` 目前尚不存在**（属未完成项，见 [`TODO.md`](TODO.md) B-1/B-2）—— 新建时按此路径，别另发明一个 |
| **Adapter 层**（**唯一 invoke 入口**） | `renderer/src/adapter/**`（**新**） | ⚠️ **全应用只有这里能碰 `window.api`**；统一解包 `{ok,data,warnings}` / `{ok:false,error}` 与统一类型。🔴 **目前不存在**：现有 7 处直调散在 3 个文件 —— 清单见 [`TODO.md`](TODO.md) **A-1**，迁移见 `task-21` |
| 通用去重工具（class 合并等） | 与 Tailwind 一起定：**用已装的 `clsx` + `tailwind-merge`（shadcn 的 `cn()`）** | ⚠️ `ui/cx.js` 是**同一概念的既有实现**（P1）。Tailwind 落地时**必须合并成一份**，不要留下两套 class 合并工具 |
| 引擎能力 | `packages/engine/src/` + 对应测试放 `packages/engine/tests/` | **必须保持零第三方依赖**，且不得 import `electron` / `http` |
| 契约 / 新 IPC 方法 | `apps/desktop/src/shared/ipc.mjs` | ⚠️ **唯一来源**。preload **不需要改**（它是通用转发 `invoke`，校验全在 zod 白名单）；要同步的是 `docs/spec/CONTRACT-engine-v1.md`。⚠️ 若新方法**不经引擎**（由主进程直接处理，如库配置三个方法），还要在 `main/index.mjs` 的 `registerIpc` 里**显式分派**，否则会被当成"引擎无此方法"拒绝 |
| 索引构建 / 重采样 / 解码 | `packages/indexer/src/` | 改了编码路径必须重建索引并给证据 |
| 新的守卫 / 校验脚本 | `tools/verify_*.mjs` | 只读、退出码 0/1、写完自己跑一遍 |
| 一次性调查 / 探针 | `tools/probe_electron_start/` 或 `docs/archive/spike/` | **别放仓库根** |
| 规格 / 设计 / 上手文档 | `docs/spec/` · `docs/design/` · `docs/guide/` | **绝不放仓库根** |
| 计划与进度 | `docs/plan/ROADMAP.md` | 它是「做什么、什么顺序」的唯一出处 |
| 审查证据 / 基线 | `docs/audit/` | 带 `文件:行号`；现状基线只有 Lead 能改 |
| 门禁证据 | `reports/G-<字母>-<日期>/` | **必须进 git**，否则算没通过；协议见 `reports/README.md` |
| 设计令牌 | `packages/design-tokens/tokens.css` | 别复制第二份；加完跑样式守卫 |
| 被取代 / 已失效的东西 | `docs/archive/` | 留档不删（git 历史仍可回溯） |
| 临时试验、日志、备份 | `data/_*` | 已 gitignore，随时可删 |

**命名与文件类型**（照现状，别发明第三套）：

- 引擎 / 主进程 / 守卫 / 构建脚本 → `.mjs`（纯 ESM）
- preload 源码 `.js`，**构建产物必须 `.cjs`**（`sandbox: true` 不加载 ESM preload）
- 渲染层 → `.jsx` / `.js`（React 19，**普通 JS，不是 TypeScript**）
- 测试 → `*.test.mjs`，用 `node:test`，**跟着被测包走**
- 文档 → 约束类用大写主题名（`SPEC-*` / `DESIGN-*` / `CONTRACT-*`），过程类用小写连字符
- CSS 令牌 → `--kebab-case`，只在 `tokens.css` 定义

---

## 4. 权威关系表（消灭「同一件事两处说法」的根因）

**每件事只有一个出处。发现两处不一致：改错的那处，别在两处各改一半。**

| 这件事 | 以谁为准 |
|---|---|
| 项目是什么 · 现在什么状态 · 怎么跑 | [`README.md`](README.md) |
| 在这个仓库里怎么干活（本文件：**项目架构 + 执行规范**） | `AGENTS.md` |
| 文档谁指向谁 | [`docs/README.md`](docs/README.md) |
| 做什么、什么顺序、什么算做完 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用技术栈与目录结构 | [`docs/spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口形状（方法 / 错误码 / 事件 / 恢复） | [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 索引元数据 / 身份 / 配对 / 指纹 | [`docs/spec/SPEC-identity.md`](docs/spec/SPEC-identity.md) |
| 事务 / 撤销 / 并发（**规格已成文，实现未开始**） | [`docs/spec/SPEC-transactions.md`](docs/spec/SPEC-transactions.md) |
| **验收阈值 / 性能口径 / 门禁**（阈值唯一出处） | [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 传输层与外壳安全（IPC / `thumb://` / 渲染进程姿态 / 权限用例） | [`docs/spec/SPEC-security.md`](docs/spec/SPEC-security.md) |
| UI / UX | [`docs/design/UI-REVIEW-and-migration.md`](docs/design/UI-REVIEW-and-migration.md)（摘要见 `DESIGN-app-details.md` §一） |
| 视觉令牌 | [`docs/design/DESIGN-tokens.md`](docs/design/DESIGN-tokens.md)（可执行版 = `packages/design-tokens/tokens.css`） |
| **现在还有什么没做完 / 什么坏了**（行动清单，唯一） | [`TODO.md`](TODO.md) |
| 历史欠账台账（逐条已清/未清，含陈旧记录） | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 本次 monorepo 重构怎么执行 | [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) |
| 现状事实基线（审查用） | [`docs/audit/00-current-state.md`](docs/audit/00-current-state.md) |
| 门禁证据协议 | [`reports/README.md`](reports/README.md) |
| 模型前缀 / seq / 精度上限的依据 | [`reference/MODEL_CARD.md`](reference/MODEL_CARD.md) |

---

## 5. 门禁与验收

### 5.1 期望值（对不上就是没做完）

| 门禁 | 期望 |
|---|---|
| `npm test` | `tests 113 · pass 112 · fail 0 · skipped 1`（引擎 74；桌面 39 = 库配置 12 + reveal 端口 4 + 权限 13 + 窗口安全 10） |
| `npm run build` | 成功，且 `out/main` · `out/preload` · `out/renderer` 三端齐备（**已实测通过**；受限沙箱内需提权，见下） |
| 守卫 | 下表 EXIT=0（**2026-10-13 起只剩 2 个**；其余 6 个按所有者指令移除，见 §5.2 的说明） |
| 证据 | 每条被声称通过的 G-* 门禁，在 `reports/` 里都有归档证据 |

**那个跳过（如实记录，不要当成通过）**：

1. 本环境无法创建**文件**符号链接（`EPERM`）→ 该条跳过。**这是环境限制**：目录联接（junction）能建，文件符号链接不能。这条断言的是「库内指向库外的符号链接必须被拒」，在能建链接的机器上会真跑（`packages/engine/tests/security.test.mjs` ④）。

> ✅ **D2 修复的连带效果（2026-10-12）**：原先还有**两条永久跳过**，因为它们在测试里**自己直读 `config.json`** 拿库根，而那个文件早已删除。
> 它们现在改为用**与生产同序**的解析（`packages/engine/tests/lib-root.mjs`：环境变量 → `config.json` → **索引自举**），于是**都真的跑起来了**：
> - `指纹 v1：与 baseline-v1.json 记录的值一致` —— JS 与 Python 的指纹**逐字节一致**（真实跑，2.9 s）
> - `uid: 整库唯一性` —— 扫过真实库全部图片，**0 处 UID 碰撞**
>
> ⇒ 跳过数 **3 → 1**，通过数 **65 → 79**。**这不是"把测试改绿"**：库根来自索引元数据（生产实际来源），断言的内容一个字没放松。

**另一条环境限制（2026-10-12 已实测解除，但边界本身仍存在 —— 保留记录）**

`npm run build` 在**受限沙箱**（例如某些 CI / 容器，含本项目的 agent 执行沙箱）内**会失败**，且**失败点在加载配置之前**：

```text
failed to load config from electron.vite.config.mjs
error during build: Error: spawn EPERM
    at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)
    at bundleConfigFile (node_modules/electron-vite/dist/chunks/lib.js:1710:26)
```

根因：esbuild 用 **piped stdio spawn 一个常驻服务进程**，受限沙箱不允许 —— **这是环境限制，不是配置或代码问题**（连配置文件都还没加载到）。

> ✅ **2026-10-12 已在提权下实际跑通**（`spawn EPERM` 消失，EXIT=0）：
> ```
> out/main/index.js                       49.49 kB
> out/main/chunks/{bmp_decode,encoder}-*.js
> out/preload/index.cjs                    0.82 kB
> out/renderer/index.html                  1.15 kB   ← 注意构建日志里是
> out/renderer/assets/index-*.css         25.50 kB     `../../../../out/renderer/…`，
> out/renderer/assets/index-*.js         673.37 kB     正是 outDir 显式配置生效的实证
> ```
> ⚠️ **下面两条守卫已于 2026-10-13 移除**（原件在 `data/_removed-guards-backup/`）—— 这是**当天的真实记录**，保留不改写，但**不再可复跑**。
> 随后 **`verify_app_build.mjs` EXIT=0**（含 preload 是 CJS、依赖 external、路径相对、CSP 在、`thumb://` 还在）
> 与 **`verify_renderer_dom.mjs` EXIT=0**（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件全过），
> 两条**首次获得判定**。

- （历史教训）原先 `verify_app_build` / `verify_renderer_dom` / `smoke_app` 这三条依赖 `out/` 的检查，
  必须在一次成功的 `npm run build` 之后才有意义（顺序不能反）—— **这三条已移除**，此条留作提醒。
- `out/` **不进 git**（`.gitignore` 已覆盖），所以**新克隆的仓库里它不存在** ——
  直接跑那三条守卫会报「找不到 `out/main/index.js`」，**那是缺前置条件，不是重构坏了**（同样已移除）。
- 仍然**未验证**的是真启动 Electron 出窗与打包态 —— 见 [`TODO.md`](TODO.md) B-3。

### 5.2 两个守卫（全部只读）

> ⚠️ **2026-10-13：所有者指令「仅保留 `verify_encoder_path` 与 `check_search`，其余全部移除」。**
> 被移除的 6 个：`verify_app_build` · `verify_main_wiring` · `verify_renderer_dom` · `verify_renderer_styles` · `smoke_app` · `verify-doc-refs`。
> **原件已备份在 `data/_removed-guards-backup/`**（含从未提交的 `verify_main_wiring.mjs` —— 不在备份里就永久丢失）。
> 恢复方式：拷回 `tools/` + 还原 `package.json` 的 `smoke` 脚本。该目录已 gitignore，可随时删。

| 守卫 | 断言什么 | 前置条件 |
|---|---|---|
| `node tools/verify_encoder_path.mjs --model <ONNX 模型目录>` | 编码路径一致性（**跑真实推理**）：改过编码路径就必须重建索引，否则检索质量静默退化 | 本机有 ONNX 模型目录 |
| `node tools/check_search.mjs` | 检索**端到端**自查（向量模式，走引擎真实检索路径）。退出码 `0`=打通 · `1`=失败/无结果 · `2`=参数缺失 | 已有查询向量与已注册索引 |

**这两个都有个现实问题：本机（agent 沙箱）跑不动** —— 需要模型目录与已注册索引。
⇒ **"守卫全绿"在本环境已无法验证**，不要声称验证过。

#### 移除的代价

逐条"失去了什么能力 / 后果是什么"见 **[`TODO.md`](TODO.md) B-4**（含备份路径与恢复方式）。
一句话：**以下回归现在没有自动化** —— F-01 静默假成功 · F-02 界面自算阈值 · 首启向导 ·
S11/S12/S13 窗口与来源校验 · `thumb://` 状态码 · preload 暴露面 · 根目录纪律。
只剩 `npm test` 的纯逻辑单测（引擎 74 + 桌面 39）覆盖其中一部分。

#### 仍然有效的那句话

> 守卫**证明不了**的事情，不要当成证明了。现在更要紧：**"没跑过" ≠ "没问题"**。

### 5.3 两条硬规则

1. **无归档证据 = 门禁未通过。** 结论要落到 `reports/G-<字母>-<日期>/`，否则不算。
2. **`reports/` 里的 G-B 索引质量判据已不可复跑**（`tools/quality/` 随 Python 档退役被删）→ 那些证据是**存档**，不能独立重算。引用时必须写明这一点，不得声称「本轮实测」。

---

## 6. 写作纪律

- **正文文档放 `docs/`**（spec / design / guide / plan / audit）；**仓库根只留 `AGENTS.md` + `README.md` + `TODO.md`**。
- **引用写「仓库根相对」路径**（`docs/spec/SPEC-app.md`），不要写 `../`——引用散落在不同深度，`../` 会随深度变化，根相对写法全局一致。
- **改文档后自己过一遍引用**：死引用与根目录越界**已经没有守卫了**（见下条），只能靠人看。
- ⚠️ **2026-10-13：`verify-doc-refs.mjs` 已按所有者指令移除** —— 根目录纪律与死引用解算
  从此**没有自动化**，只能靠人看。移除前它刚被修成真门禁（6 条历史误报清零），所以这次移除
  等于把那份清理工作一起放弃了；若日后要恢复，原件在 `data/_removed-guards-backup/verify-doc-refs.mjs`。

### 定位行号：必须用 `read` 工具或 node，**不要用 `Get-Content`**

PowerShell 5.1 的 `Get-Content` 按 GBK 解码 UTF-8 中文，多字节字符被拆坏并**合并行**，于是行号全错。
实测（2026-10-12，同一份文件同一时刻）：

| 文件 | `Get-Content` 数出 | 按 UTF-8 读实际 |
|---|---|---|
| `docs/design/DESIGN-tokens.md` | **245** | **292** |
| `docs/spec/SPEC-acceptance.md` | **259** | **347** |

（这两份正在被编辑，具体数字会变；**结论不变**：定位行号只用 `read` 工具或 node。）

```powershell
# ✅ 正确：拿真实行号
node -e "const s=require('fs').readFileSync('docs/design/DESIGN-tokens.md','utf8');console.log(s.split('\n').length)"
```

### 结论的写法

- 每条结论带 `文件:行号` 或「命令 + 原始输出」；无证据标【判断，非实测】。
- 引用既有证据（`reports/`）时写「引用既有证据」，**不要写成「本轮实测」**。
- **不得声称未验证的能力**（见 §7）。

---

## 7. 明确禁止与已知边界

**禁止**

> ⚠️ **2026-10-13 追加的三条（P1 同概念多实现 · P2 复制粘贴 · P3 硬编码可配置值）见 §0.1** —— 那三条优先级更高，且已列出**现成违例**。以下为既有禁止项。

- **不写素材库。** 检索、缩略图、`scan` 等只读操作在文件系统上**零写入**；写入素材库只允许走 `docs/spec/SPEC-transactions.md` 的四步纪律（且当前 `ingest`/`mutate` 尚未实现）。
- **不把本机绝对路径写进代码或文档**（如 `G:\model`）。库位置由配置提供；文档里的示例路径要标明是示例。<br>⚠️ **已知有一处现存违例**（取件目录默认值硬编码）—— 逐条与修法见 [`TODO.md`](TODO.md) **A-3**，本文件不重复记 BUG。
- **不在 `packages/engine/` 里 import `electron` 或 `http`**（「传输无关」的可执行判据，单测会拦）。
- **不让渲染进程拿到 `ipcRenderer` 或任意绝对路径入参**；路径只能由 `libId + uid` 解析。
- **不声称嵌入模型「看得出图里是什么」**——它只产出向量。
- **不自动 `git commit` / `push`**，除非所有者明确要求。
- **不把 `--no-sandbox` 固化进产品**（它只是受限环境的降级开关）。

**已知边界（如实写明，不得含糊）**

| 边界 | 事实 |
|---|---|
| **未验证的能力**（冷启动 · 打包态 · 真实 `thumb://` · 真窗口行为） | **均未验证，不得据此声称可用**。逐条与原因见 [`TODO.md`](TODO.md) B-3 |
| 受限沙箱 | Chromium 进程沙箱起不来时 Electron 会**秒退且一行日志都不生成**；此时用 `npm run dev:restricted` / `npm run start:restricted`（= 附加 `--no-sandbox`）。**普通终端不需要**。 |
| 生产态 DevTools | 生产态保留 `devTools: true` 是**已决策项**（`docs/spec/SPEC-security.md` §9 决定 3），不是疏漏。 |
| 日志 | 主进程与渲染进程的诊断都写 `data\_app.log`。Windows 上 Electron 是 GUI 子系统程序，**stdout 不连终端**，`console.log` 一条都看不到。 |
| **D2 · 库根配置缺口** | ✅ **已修（2026-10-12）**：库不再只从 `config.json` 读。主进程按**四条优先级**解析（`apps/desktop/src/main/library-config.mjs`）：① `GEMMA_LIB_ROOT` 环境变量 ② `userData/library-registry.json`（决策 9 的正规存储）③ `config.json`（兼容回退，**不要求用户去配**）④ **从已有索引 `data/libraries/*/meta.json` 自举**（`meta` 里本就存着 `lib_id` + `lib_root`）⇒ **有索引的机器零配置即用**。无库时界面显示**首启向导**（`pages/LibraryGate.jsx` → `FirstRunWizard.jsx`）而不是裸 `LIB_NOT_FOUND`。测试 `apps/desktop/tests/library-config.test.mjs`（12 条）+ `verify_renderer_dom.mjs` §8（7 条） |
| **F-04 · 取件白名单为空** | ✅ **随 D2 一并解决**：`collect.dirs` 原先恒为 `{}` ⇒ 任何 `collect` 都返回 `COLLECT_DIR_NOT_ALLOWED`。现按规格给默认值（`E:\素材待用` / `E:\移出素材`，出处 `docs/spec/SPEC-app.md` §9 与 `docs/spec/SPEC-transactions.md` §7），并可由注册表覆盖 |
| **F-01 · `reveal` 未接线** | ✅ **已修（2026-10-12）**：原先主进程**从未注入 `shell` 端口**，而引擎在无 `shell` 时仍返回 `ok({revealed:true})` ⇒ **静默假成功**。现在：① 引擎在端口缺失/形状不对时返回**新错误码 `PORT_MISSING`**（绝不 `ok`），且顺序是**先确认文件在盘上再调端口**；② `apps/desktop/src/main/index.mjs` 注入 `shell: createRevealPort(shell)`（`apps/desktop/src/main/ports.mjs`）。**回归锁定（⚠️ 2026-10-13 已削弱）**：引擎 +5 条单测 · 端口本体 +4 条（`apps/desktop/tests/ports.test.mjs`）**仍然有效**；但原本在**行为面**锁它的 `verify_main_wiring.mjs`（真调 `reveal`、断言壳端口真的收到绝对路径）**已随所有者指令移除** ⇒ **"接线接上了"现在只有纯逻辑单测，没有行为证据**。恢复方式见 §5.2 的备份路径。⚠️ **能力边界**：`shell.showItemInFolder` **返回 void、不报告失败** ⇒ 成功文案写「已请求在资源管理器中定位（系统未回报结果）」，**不写**「已定位」。<br>⚠️ **§1b 写对不容易，两个反复被证伪的坑（都在注释里写明）**：① **必须先剥注释** —— 实测 bundle **保留源码行注释**，直接匹配会命中 `// shell: createRevealPort(...)`；而"注释掉一行"正是禁用接线的常见手法。剥注释器还必须**认识正则字面量**（含引号的正则 `/["']/g` 会让朴素实现误入字符串模式 ⇒ 被注释的接线重新可匹配；差分实测证实）。**不能用 `esbuild.transform`** —— 它在受限沙箱 `spawn EPERM`，会让守卫整体失效。② **必须取"调用点的实参"** —— 引擎函数签名里就写着形参 `shell = null`，若按"第一个 `createEngine(`"取，会取到**函数声明**，"接线有没有接上"就永远为真 |
| **F-02 · 界面自算分数阈值** | ✅ **已修（2026-10-12）**：原先 `ui/Score.jsx` 硬编码 `0.97/0.93` ⇒ **每次文本检索的全部结果都被标成「较弱」**（文本真实 top-1 在 0.74–0.80）。现在档位**只来自引擎的 `item.band`**，`band` 缺失时**只显示分数、不猜档位**。**⚠️ 回归锁定已失效（2026-10-13）**：原先锁它的 `verify_renderer_styles.mjs` §5 与 `verify_renderer_dom.mjs` §10 **均已随所有者指令移除** ⇒ 现在**只剩渲染层单测**，改 `ui/Score.jsx` 时特别小心（见 [`TODO.md`](TODO.md) C-2） |
| 未实现的契约方法 / 多库注册表 / 两个页面 | **未完成项**，清单见 [`TODO.md`](TODO.md) B-2（本表只记"边界事实"，不记待办） |
| 素材库只读 | 检索**不移动、不复制、不重命名、不删除**任何素材；结果是路径。 |
| 20 个假 `.jpg` | 预览图里有 20 个文件名是 `.jpg`、实际内容是 BMP（集中在 `VR`）。解码路径会自动回退，**它们不是坏文件**。 |
| 索引与库位置绑定 | 索引里存了素材的**绝对路径**；素材库再次移动会让索引失效，必须重建。 |
| 索引不能边建边查 | 建索引与检索争 GPU，实测速率减半。 |

---

## 8. 术语表

| 词 | 白话 |
|---|---|
| **向量 / embedding** | 把一段文字或一张图变成一串数字，让「意思相近」变成「数字相近」；本项目的统一维度是 **768** |
| **索引 (index)** | 事先算好并存的向量集合，落在 `data/libraries/<libId>/` |
| **引擎 (engine)** | 干活的「大脑」，不含界面：`packages/engine/`，**零第三方依赖** |
| **契约 (contract)** | 接口形状约定（有哪些方法、会报什么错）——先冻结，再写实现 |
| **门禁 (gate)** | 必须通过的检查点（`G-A`…`G-E2`） |
| **证据 (evidence)** | 门禁通过的凭据，存 `reports/`。**没有归档证据 = 门禁没通过** |
| **守卫 (guard)** | `tools/` 下**只读**校验脚本，跑完给 EXIT 码。⚠️ 2026-10-13 起**只剩 2 个**（见 §5.2） |
| **主进程 / 渲染进程** | 主进程管窗口与磁盘；渲染进程就是那个网页界面。两者严格隔离 |
| **preload / 安全桥** | 界面唯一能用的通道（只暴露 `invoke` / `onEvent` / `platform`），别的够不着 |
| **IPC** | 主进程与渲染进程之间的受控通信（本项目 2 个通道、**13 个方法**白名单：原 11 个引擎方法 + 库配置的 `libraryConfig`/`libraryPickDir`/`libraryAdd`） |
| **`thumb://`** | 缩略图自定义协议，形状**只允许** `thumb://<libId>/<uid>@<size>`——路径不由 URL 提供 |
| **配对 (pairing)** | 靠文件名主干相同，把 `ID-123.jpg` 与 `ID-123.rar` 认成一套素材；索引里**显式存了两个绝对路径** |
| **uid** | `sha1(lib_id\|rel_dir\|stem)[:12]`，12 位 hex，**已冻结** |
| **`compat`** | 兼容性判定键（8 项，不含 device/GPU）。只有 `compat` 相等的库才能合并检索 |
| **`band`** | 引擎按**同一模态内**区间给出的分数档（`high`/`mid`/`low`）。**界面不得自己算阈值，也不得跨模态比分数**。⚠️ 还可能是 `unknown`：模态不在引擎的 `BANDS` 里时引擎**拒绝定档**（2026-10-12 修 R-3），此时界面**只显示分数、不显示档位文案** |
| **`seq`** | 图像 soft token 预算（70/140/280）。是唯一的提速杠杆，**换档必须全量重建索引** |
| **设计令牌 (token)** | 颜色/字体/间距等视觉常量，唯一来源 `packages/design-tokens/tokens.css` |
| **ONNX / WebGPU** | 模型的通用交换格式 / 让浏览器直接用显卡算的技术；WebGPU 不可用时回落 CPU |
| **monorepo / workspaces** | 一个仓库多个包：`apps/*` + `packages/*`，用 npm workspaces 声明；**包之间用相对路径 import，不用包名解析** |

---

*本文件与磁盘不一致时，先修结构或代码，再回来改本文件——不要在两处各写一半。*

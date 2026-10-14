# AGENTS.md · 在这个仓库里怎么干活（规范手册）

> **本文件只记一件事：规范与要求。** 它**不记**状态、进度、违规史、教训与实测数字。
> - **事实 / 现状**（层 · 命令 · 目录 · store · 约定索引 · 文档索引，一页看完）→ [`docs/PROJECT-INFO.md`](docs/PROJECT-INFO.md)
> - **违规 / 未做 / 证据 / 教训**（唯一行动清单 + C 节防回归）→ [`TODO.md`](TODO.md)
> - 项目是什么、怎么跑 → [`README.md`](README.md) · 什么顺序、什么算做完 → [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)
>
> ### 三份文件的分工（**别在别处再列一遍**）
>
> | 问题 | 看哪 |
> |---|---|
> | **规范与要求**（必须 / 禁止 / 放哪儿 / 以谁为准 / 门禁是什么 / 怎么写结论） | **本文件** |
> | 事实与现状（层 · 命令 · 目录 · store · 约定索引 · 文档索引 —— **一份 AGENT 开发使用文档**） | [`docs/PROJECT-INFO.md`](docs/PROJECT-INFO.md)（**派生导航，非权威**） |
> | 动作、证据、教训（未做 / 已修 BUG / 防回归 / 实测原始输出） | [`TODO.md`](TODO.md) |
>
> **别在本文件里加 TODO / BUG / 状态 / 实测数字** —— 那是 `TODO.md` 的职责。
>
> ⚠️ **§编号已于 2026-10-14 重排**（骨架照 `docs/PROJECT-INFO.md` 的 §1–§7）。
> **旧编号引用**（含 `docs/audit/`、`reports/` 等**冻结件**里的）→ 见 [`docs/README.md`](docs/README.md) 的「AGENTS.md 章节重排对照」。
>
> 最后核对：2026-10-14（本轮：登记 `docs/PROJECT-INFO.md` · 重排为 §0–§7 + 附录 A · 违规/未做/证据/教训全部外迁 `TODO.md`）

---


### 0.1 所有者追加约束（2026-10-13，优先级同 §0）

#### 严格禁止事项

| # | 禁止 | 判据（**怎么算违反**，别靠感觉） |
|---|---|---|
| **P1** | **创建同一概念的多个实现** | 同一件事在仓库里有**两份代码 / 两份定义**。原则：**单一事实来源**（同 §7.1）——发现两处不一致，**改错的那处**，不要两处各改一半 |
| **P2** | **复制粘贴代码块** | 同一段逻辑（**哪怕有细微差异**）出现在 ≥2 处 → **提取到共享函数/模块**再复用 |
| **P3** | **硬编码应可配置的值** | 绝对路径、目录、端口、数量上限、超时、默认库位置等**写死在代码里** → 从配置文件或环境变量取（同 §6.5） |

#### 强制要求

| # | 要求 | 怎么做（**可执行**的做法） |
|---|---|---|
| **R1** | **债务预防** | **建新功能前先查有没有现成的**：grep 全仓 + 读 §7.1 权威表。确认没有再新建，**并在回报里写明"查过了，没有"**（不是默默新建） |
| **R2** | **新建文件必须修正目录结构** | 新文件落在 §4 规定的位置。**若磁盘结构与本文档不一致 → 改文档或改结构，两者必须一致**，不允许留下"文档说 A、磁盘是 B" |

> **四层架构与分层纪律** → §2。**编码 / 写作 / 样式约定** → §6。

---

## 1. Stack（技术栈规范）

**目标栈**：Electron · React · **TypeScript** · **shadcn/ui** · **Tailwind CSS** · **Zustand** · **React Router**。

| # | 规范 | 判据 / 后果 |
|---|---|---|
| **S1** | 面向目标栈的技术迁移**是一个计划，不是规范** | 逐项实测现状、串行推进；现状与进度见 [`TODO.md`](TODO.md) B-1 |
| **S2** | 在 Tailwind 真正落地之前，"手写 CSS + `var(--*)`"**仍是现行规则** | 别提前混写两套 |
| **S3** | **不得声称"全局类型检查通过"** | `npm run typecheck` **只覆盖 `.ts`**（当前唯一有内容的来源是 `apps/desktop/src/shared/ipc.ts`）；两个 tsconfig 的 `checkJs` 仍是 `false`，`.js` / `.jsx` / `.mjs` 一律不参与检查 |
| **S4** | **契约边界用 `.ts`**（`apps/desktop/src/shared/ipc.ts`） | `.ts` **总会被类型检查**（不受 `checkJs` 影响）⇒ 这是 `typecheck` 唯一有内容的来源；Node ≥23.6 原生类型剥离，`node:test` 可直接 import，**不需要构建步骤** |
| **S5** | 引擎（`packages/engine/`）**零第三方依赖**、**传输无关** | 不得 import `electron` / `http`（单测会拦）—— 它必须能脱离 Electron 被单独测试 |
| **S6** | **视觉令牌只在 `packages/design-tokens/tokens.css` 定义**；`@theme inline` 只做映射、**不复制值** | 别复制第二份色值/字号定义。Tailwind 接管后该文件是**主题输入之一**，落地前仍是唯一来源 |
| **S7** | 新样式写 **Tailwind 类**：数字走**令牌阶梯**（`--spacing: var(--space-1)` ⇒ `px-3` = `--space-3`；`min-h-11` = 44px = `--touch-min`）；**禁用任意值**（`px-[11px]`）；颜色**不写死**（用 `bg-surface` / `text-ink` / `border-line`，不许 `bg-[#0071e3]`） | 写死色值 = 造出第二份令牌，断言会红 |

---

## 2. 项目模式（MVC / 四层）

本项目是**四层**（比经典 MVC 多一层 Adapter），并且**有机械断言**：`apps/desktop/tests/layering.test.mjs` 的 **L1–L7**（+ `source-scan.test.mjs` 扫描器自检）。

```
UI(组件) ──> Operation(store/hooks/utils) ──> Adapter(唯一 invoke 入口) ──> Data(主进程/引擎)
```

| 层 | 职责 | 放在哪 | 禁止 |
|---|---|---|---|
| **UI**（组件 / View） | 只做渲染与用户交互 | `renderer/src/{pages,layout,ui,search}/**` | ❌ **不得直接碰 `window.api`**；不得写业务规则；不得直接 import Adapter |
| **Operation**（store / hooks / utils） | 状态与编排；把 Adapter 的结果转成界面要的形状 | `renderer/src/store/**` · `renderer/src/hooks/**` · `renderer/src/utils/**` | ❌ 不得散落协议细节（协议归 Adapter） |
| **Adapter**（**唯一 invoke 入口**） | 全应用**只有一个地方**碰 `window.api`；统一解包信封、统一类型 | `renderer/src/adapter/**` | ❌ 不得有第二个文件直调 `window.api` |
| **Data**（command / repo / service） | 数据来源与分派 | `apps/desktop/src/main/**`（来源校验 → zod 白名单 → 显式分派）· `packages/engine/**` · `packages/indexer/**` | 见 §6.5（引擎零依赖、渲染进程姿态） |

**硬性要求**

1. Adapter 是**唯一解包处**：`{ok,data,warnings}` / `{ok:false,error}`；`userMessage` **恒非空**；**永不抛异常**；**不 import React**。
2. **UI 层零 `window.api`**；UI 不得直接 import Adapter（协议细节归 Operation）。
3. **领域判断不许写进 `.jsx`** —— `.jsx` 在 `node:test` 里加载不了，塞进去等于放弃自动化（抽到 `utils/*.js`）。
4. **渲染进程不得拿到 `ipcRenderer`，也不得接受任意绝对路径入参**；路径只能由 `libId + uid` 解析。
5. 新代码碰引擎**一律经 Operation 层**（`hooks/` / `store/`）。
6. **路由路径的唯一来源是 `router/paths.js`**（纯数据、无 JSX，这样 `node:test` 能用 `matchRoutes()` 真解算）；组件映射与启动期断言在 `router/index.jsx`；用 **hash 路由**（打包态是 `file://`，history 深链会 404）。

---

## 3. Commands（门禁与验收规范）

> **两条独立门禁，不要混**：`npm test`（`node:test`，纯逻辑、无 GUI）与 `npm run e2e`（Playwright，**真启动 Electron**）。
> **绿了哪一条就只说哪一条** —— 别用"测试全绿"含糊过去。

| 门禁 | 期望 |
|---|---|
| `npm test` | `tests 313 · pass 312 · fail 0 · skipped 1`（**期望值**；证据、逐文件分解与那 1 条跳过的原因见 [`TODO.md`](TODO.md) **B-5-3**） |
| `npm run build` | 成功，且 `out/main` · `out/preload` · `out/renderer` 三端齐备（受限沙箱内需提权，原文见 `TODO.md` B-5-3） |
| `npm run typecheck` | EXIT=0，**且注入类型错误时必须变红**。⚠️ **只覆盖 `.ts`**（见 §1 S3） |
| `npm run e2e` | 真窗口套件；**需要能出窗的环境**，沙箱内需 `--no-sandbox` **且要提权**（助手已带 `--no-sandbox`） |
| 守卫 | 见下表，**全部只读** |
| 证据 | 每条被声称通过的 G-* 门禁，在 `reports/` 里都有归档证据 |

**只有 2 个守卫，且本机（沙箱）跑不动**（需模型目录 + 已注册索引）⇒ **"守卫全绿"在本环境已无法验证**，不要声称验证过。

| 守卫 | 断言什么 | 前置条件 |
|---|---|---|
| `node tools/verify_encoder_path.mjs --model <ONNX 模型目录>` | 编码路径一致性（**跑真实推理**）：改过编码路径就必须重建索引，否则检索质量静默退化 | 本机有 ONNX 模型目录 |
| `node tools/check_search.mjs` | 检索**端到端**自查（向量模式，走引擎真实检索路径）。退出码 `0`=打通 · `1`=失败/无结果 · `2`=参数缺失 | 已有查询向量与已注册索引 |

**规范**

1. **无归档证据 = 门禁未通过** —— 结论要落到 `reports/G-<字母>-<日期>/`。
2. **不新建守卫**：机械检查一律做成 `npm test` 里的断言。`tools/verify_*.mjs` 只读、退出码 0/1、写完自己跑一遍。
3. 引用**已不可复跑**的旧证据（如 G-B 的索引质量判据——`tools/quality/` 随 Python 档退役被删）必须写明「这是存档、不能独立重算」，**不得写成「本轮实测」**。
4. **已移除的守卫不许写进新文档** —— 清单、代价与逐条归属见 [`TODO.md`](TODO.md) **B-4**（唯一的权威对照表）。
5. **受限环境**：Chromium 进程沙箱起不来时 Electron 会**秒退且一行日志都不生成**，此时用 `npm run dev:restricted` / `npm run start:restricted`（= 附加 `--no-sandbox`）；**普通终端不需要**。

---

## 4. Architecture（目录职责与放置规则）

| 路径 | 管什么 | 能改吗 | 进 git？ |
|---|---|---|---|
| `apps/desktop/` | Electron 应用：`src/main`（窗口 / IPC / `thumb://` / 日志）· `src/preload`（安全桥，**产物必须 CJS**）· `src/renderer`（React 19 界面；内含 `adapter/` `store/` `hooks/` `utils/` `router/` `pages/` `layout/` `ui/` `search/` `styles/`）· `e2e/`（Playwright）· `src/shared/ipc.ts`（**IPC 契约唯一来源**） | ✅ 主战场 | ✅ |
| `packages/engine/` | 搜索引擎本体：`src/*.mjs`（**零第三方依赖**、传输无关）+ `tests/` | ✅ 改完必须过 `npm test` | ✅ |
| `packages/indexer/` | 索引构建（ONNX + WebGPU）、重采样兼容层、BMP 解码；**唯一能建索引的地方** | ⚠️ 动了要重建索引验证 | ✅ |
| `packages/design-tokens/tokens.css` | 视觉令牌（见 §1 S6） | ✅ 只在这里加令牌 | ✅ |
| `docs/` | 全部正文文档：`spec/`（约束）· `design/`（设计）· `guide/`（上手/排障）· `plan/`（做什么、什么顺序）· `audit/`（审查产物）· `archive/`（**已失效的东西全放这里**）。**根级**放总览类：`PROJECT-INFO.md` · `DEBT-CLEANUP.md` · `MIGRATION-PLAN.md`。⚠️ **行动清单不在这里**<br>`docs/design/ui-kit/`：**入库** `build.mjs` + `kit-data.json`；**不入库** `index.html`（派生物）。它是**参照物不是应用 UI**：不消费 `tokens.css`，也不受"渲染层零色值字面量"那条断言约束 | ✅ 见 §6.1 | ✅ |
| `fixtures/` | 契约 §8 要求的样例索引（`sample-index.json`）+ P4 事务夹具库（`lib-a/`，32 文件 / 6 目录）。⚠️ **路径是契约指定的，别挪**；事务类测试只对它写副本 | ✅ | ✅ |
| `tools/` | 2 个只读守卫 + `probe_electron_start/`（最小探针 + 判读表） | ✅ | ✅ |
| `scripts/` | 启动辅助（`electron-vite.mjs`：摘 `ELECTRON_RUN_AS_NODE`、探测沙箱、必要时加 `--no-sandbox`） | ⚠️ 谨慎 | ✅ |
| `reports/` | 门禁证据，命名 `G-<字母>-<日期>/`。**无归档证据 = 门禁未通过** | ✅ 只能加新证据，**不改历史证据** | ✅ md/json/csv；截图否 |
| `build/` · `resources/` | 打包图标 + 签名配置（`buildResources`）· 打包辅助资源。**`build/` 不是产物目录** | ⚠️ 别当产物删了 | ✅ |
| `reference/MODEL_CARD.md` | 官方模型卡（外部资料） | ❌ 只读 | ✅ |
| `data/` | 索引、日志、诊断中间物、缩略图缓存 | ⚠️ **`_` 开头的一律可删；其余是正在用的索引，别删** | 🔸 绝大多数否 |
| `out/` · `node_modules/` · `.npm-cache/` | 构建产物 / 依赖与缓存 | ❌ 别手改、别碰 | ❌ |
| `tests/` | 预留的**跨包**集成测试位置（当前不存在；引擎单测随引擎走） | — | （未来）✅ |
| 根配置文件 | `package.json`（workspaces 根）· `electron.vite.config.mjs` · `electron-builder.yml` · `tsconfig*.json` · `.gitignore` · `.gitattributes` · `LICENSE` | ⚠️ **改前先问**（同时影响构建、守卫与所有人） | ✅ |

**根目录纪律**：仓库根**只放** `AGENTS.md` · `README.md` · `TODO.md` 三份 `.md`。
**已登记的例外（1 个，别再加）**：`违规的UI.md` —— UI/UX 违规的**唯一详表**（所有者明确指示；报告只引用 `V-nn`）。**要挪走它必须先问所有者**。
⚠️ 原先强制这条的 `verify-doc-refs.mjs` **已移除** ⇒ **没有自动化，只能靠人看**（见 §6.1）。

**新东西该放哪儿**

| 你要加的东西 | 放哪儿 | 注意 |
|---|---|---|
| 界面页面 / 组件 | `renderer/src/`：页面 → `pages/`，通用组件 → `ui/`，布局 → `layout/` | 新样式见 §1 S7；`<Link>` 与按钮见 §6.3；新页面必须设窗口标题（§6.3） |
| Operation 层（状态 / 编排 / 工具） | `renderer/src/{store,hooks,utils}/` | 见 §5；领域判断不进 `.jsx` |
| Adapter 层（**唯一 invoke 入口**） | `renderer/src/adapter/` | 见 §2 硬性要求 1 |
| 路由 | `renderer/src/router/` | 路径唯一来源 `paths.js`；新页面同时改 `paths.js` 与 `COMPONENTS` |
| E2E 用例 | `apps/desktop/e2e/*.spec.mjs` | 启动参数集中在 `e2e/helpers/launch.mjs`，别在 spec 里各写一遍 |
| 引擎能力 | `packages/engine/src/` + 测试 `packages/engine/tests/` | 保持零第三方依赖（§1 S5） |
| 契约 / 新 IPC 方法 | `apps/desktop/src/shared/ipc.ts` | **唯一来源**；preload 不用改；同步 `docs/spec/CONTRACT-engine-v1.md`；**不经引擎**的方法还要在 `main/index.mjs` 的 `registerIpc` 里显式分派 |
| 索引构建 / 重采样 / 解码 | `packages/indexer/src/` | 改了编码路径必须重建索引并给证据 |
| 守卫 / 校验脚本 | `tools/verify_*.mjs` | 只读、退出码 0/1；**不新增**（§3 规范 2） |
| 一次性调查 / 探针 | `tools/probe_electron_start/` 或 `docs/archive/spike/` | **别放仓库根** |
| 规格 / 设计 / 上手文档 | `docs/{spec,design,guide}/` | **绝不放仓库根** |
| **项目全景 / 派生导航类文档** | `docs/` **根级** | ⚠️ **只做导航与索引，不复制权威内容**；新增或改名**必须同步** §7.1 + `docs/README.md` §1 |
| 计划与进度 | `docs/plan/ROADMAP.md` | 「做什么、什么顺序」的唯一出处 |
| 审查证据 / 现状基线 | `docs/audit/` | 带 `文件:行号`；现状基线只有 Lead 能改 |
| 门禁证据 | `reports/G-<字母>-<日期>/` | **必须进 git**，否则算没通过；协议见 `reports/README.md` |
| 被取代 / 已失效的东西 | `docs/archive/` | 留档不删（git 历史仍可回溯） |
| 临时试验、日志、备份 | `data/_*` | 已 gitignore，随时可删 |

**命名与文件类型**（照现状，别发明第三套）

- 引擎 / 主进程 / 守卫 / 构建脚本 → `.mjs`（纯 ESM）
- **契约边界 → `.ts`**（§1 S4）；preload 源码 `.js`，**构建产物必须 `.cjs`**（`sandbox: true` 不加载 ESM preload）
- 渲染层 → `.jsx` / `.js`（React 19，**普通 JS，不是 TypeScript**）
- 测试 → `*.test.mjs`，用 `node:test`，**跟着被测包走**
- 文档 → 约束类用大写主题名（`SPEC-*` / `DESIGN-*` / `CONTRACT-*`），过程类用小写连字符
- CSS 令牌 → `--kebab-case`，只在 `tokens.css` 定义

---

## 5. Store Architecture（状态与持久化规范）

| # | 规范 | 判据 / 后果 |
|---|---|---|
| **T1** | 渲染层 store 只放**状态与编排**；**持久化一律归主进程** | 项目**没有** `zustand/persist`，也不用 `localStorage` / `sessionStorage`；库注册表写 `userData/library-registry.json`，兼容回退配置是 `config.json` |
| **T2** | 事件流归约写成**纯函数** | 纯函数才能在 `node:test` 里跑（例：`store/tasks.js` 的 `reduceEvent`） |
| **T3** | **领域判断抽到 `utils/*.js`**，不写进组件 | `.jsx` 在 `node:test` 里加载不了 ⇒ 写进组件等于放弃自动化 |
| **T4** | 破坏性操作必须走「**请求 → 确认**」两段式 | **取消 ⇒ 一个 IPC 都不许发**；确认时**先清状态再执行**（连点只发一次） |
| **T5** | 界面**不得自算阈值**、不得跨模态比分数；档位**只来自引擎的 `item.band`**；`band` 缺失或 `unknown` 时**只显示分数、不猜档位** | 自算阈值会把结果整片标错档 |
| **T6** | 进度 / 事件类状态必须**单调**且**不静默** | 迟到的进度不许把进度条往回拨；失败项非空 ⇒ `ok:false`；GPU 回退、续跑说明必须留住并显示 |

---

## 6. Convention（编码 / 写作 / 样式约定）

### 6.1 写作与结论

- **正文文档放 `docs/`**；仓库根只留三份 `.md`（+ §4 的例外）。
- **引用写「仓库根相对」路径**（`docs/spec/SPEC-app.md`），**不要写 `../`** —— 引用散落在不同深度，`../` 会随深度变化，根相对写法全局一致。
- **改文档后自己过一遍引用**：死引用与根目录越界**没有守卫了**（§4），只能靠人看。
- **每条结论带 `文件:行号` 或「命令 + 原始输出」**；无证据标【判断，非实测】；引用旧证据写「引用既有证据」，**不写成「本轮实测」**。
- **不得声称未验证的能力**（清单见 §7.2）。
- **注释写"为什么"**：把踩过的坑与反例写进注释，并区分 ① 代码事实 · ② 文档声称 · ③ 行业做法。

### 6.2 定位行号：只用 `read` 工具或 node

**不要用 `Get-Content`** —— PowerShell 5.1 按 GBK 解码 UTF-8 中文，多字节字符被拆坏并**合并行**，行号全错。

```powershell
# ✅ 正确
node -e "const s=require('fs').readFileSync('docs/plan/ROADMAP.md','utf8');console.log(s.split('\n').length)"
```

### 6.3 用户可见文案与 class

- `<Link>` 上要用按钮样式：**必须 `<Button asChild><Link …></Link></Button>`** —— 写成 `<Button><Link>` 会渲染出 **`<a>` 嵌在 `<button>`**：HTML 规范禁止、变成两个可聚焦元素（读屏念成"按钮里有个链接"）、图标不居中。`asChild` 走 Radix `Slot`，只渲染一个 `<a>`。
- **修饰态写「互斥」不写「叠加」**：`cx(BASE, active ? ACTIVE : IDLE)`。叠加式（`cx(BASE, active && "bg-ink")`）里两个工具类**同优先级**，谁赢只取决于产出 CSS 顺序。
- **新页面必须设窗口标题**：`useDocumentTitle(LABELS.xxx)`（`LABELS` 在 `router/paths.js`，是页面名的唯一来源）。不调 ⇒ 任务栏标题不随路由变。
- **界面文案不许硬编码引擎会说的那句话**（那是第二个事实来源、会漂移，还会让断言歧义）；让用户点一下看引擎怎么答。
- **用户文案兜底只允许一份**（在 Adapter 里），调用点不再抄第二套 `try/catch`。
- 错误提示**不自动消失**，并走 `alert` 语义而不是 `status`。

### 6.4 class 合并与字号档

- class 合并**只有一份实现**：`ui/cn.js` = `twMerge(clsx(...))`。`clsx` 只拼接（`cn('px-3','px-2')` 两个类都留下，谁生效只看 CSS 顺序）；`twMerge` 按冲突组消解（后者胜）。
- **加新字号档必须同时改两处**：`styles/tailwind.css` 的 `@theme { --text-* }` **和** `ui/cn.js` 的 `TEXT_SIZES`。漏了后者 ⇒ `tailwind-merge` 把那个自定义名归进 `text-color` 通配组、与 `text-ink` 判为冲突、**静默丢掉字号**（构建通过、页面不白屏，只有真窗口量计算样式才看得出来）。

### 6.5 明确禁止（清单）

- **不写素材库**：检索、缩略图、`scan` 等只读操作在文件系统上**零写入**；写素材库只允许走 `docs/spec/SPEC-transactions.md` 的四步纪律。
- **不把本机绝对路径写进代码或文档**（如 `G:\model`）。库位置由配置提供；文档里的示例路径要标明是示例。
- **不在 `packages/engine/` 里 import `electron` 或 `http`**（§1 S5）。
- **不让渲染进程拿到 `ipcRenderer`，也不接受任意绝对路径入参**；路径只能由 `libId + uid` 解析。
- **不声称嵌入模型「看得出图里是什么」** —— 它只产出向量。
- **不把 `--no-sandbox` 固化进产品** —— 它只是受限环境的降级开关（§3 规范 5）。
- **不自动 `git commit` / `push`**，除非所有者明确要求。
- **不新建同一概念的第二份实现 / 第二份定义**（P1/P2，§0.1）。

---

## 7. document（文档去哪 / 以谁为准 / 边界）

### 7.1 权威关系表（消灭「同一件事两处说法」的根因）

**每件事只有一个出处。发现两处不一致：改错的那处，别在两处各改一半。**

| 这件事 | 以谁为准 |
|---|---|
| 项目是什么 · 现在什么状态 · 怎么跑 | [`README.md`](README.md) |
| **在这个仓库里怎么干活**（项目规范 + 执行要求 —— 本文件） | `AGENTS.md` |
| **项目全景**（层 / 命令 / 目录 / store / 约定 / 文档，一页总览 —— **AGENT 开发使用文档**） | [`docs/PROJECT-INFO.md`](docs/PROJECT-INFO.md)（**派生导航，非权威**：与本表任何上游冲突，以上游为准并回来修它） |
| 文档谁指向谁 | [`docs/README.md`](docs/README.md) |
| **现状有什么没做完 / 什么坏了 / 教训 / 证据** | [`TODO.md`](TODO.md) |
| 做什么、什么顺序、什么算做完 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用技术栈与目录结构 | [`docs/spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口形状（方法 / 错误码 / 事件 / 恢复） | [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 索引元数据 / 身份 / 配对 / 指纹 | [`docs/spec/SPEC-identity.md`](docs/spec/SPEC-identity.md) |
| 文件事务 / 撤销 / 并发与崩溃恢复 | [`docs/spec/SPEC-transactions.md`](docs/spec/SPEC-transactions.md) |
| **验收阈值 / 性能口径**（阈值唯一出处） | [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 传输层与外壳安全（IPC / `thumb://` / 渲染进程姿态 / 权限用例） | [`docs/spec/SPEC-security.md`](docs/spec/SPEC-security.md) |
| UI / UX | [`docs/design/UI-REVIEW-and-migration.md`](docs/design/UI-REVIEW-and-migration.md) |
| **UI/UX 违规台账**（**唯一详表**，报告只引用 `V-nn`） | [`违规的UI.md`](违规的UI.md)（仓库根，已登记例外） |
| Apple HIG 基线数值 / 应用对差（**参照物，不是令牌来源**） | [`docs/design/UI-KIT.md`](docs/design/UI-KIT.md)（可执行参照站由 `docs/design/ui-kit/build.mjs` 生成） |
| 视觉令牌 | [`docs/design/DESIGN-tokens.md`](docs/design/DESIGN-tokens.md)（可执行版 = `packages/design-tokens/tokens.css`） |
| 历史欠账台账（逐条已清 / 未清） | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 本次 monorepo 重构怎么执行 | [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) |
| 门禁证据协议 | [`reports/README.md`](reports/README.md) |
| 模型前缀 / seq / 精度上限的依据 | [`reference/MODEL_CARD.md`](reference/MODEL_CARD.md) |
| **旧 §编号 → 新章节** | [`docs/README.md`](docs/README.md)「AGENTS.md 章节重排对照（2026-10-14）」 |

### 7.2 边界与「未验证」的口径

- **未验证的能力不得声称可用**：冷启动计时 · 打包态 · 真实 `thumb://` 取图 · iframe 内 `invoke` · 真实 `indexStart` 的取消与 ETA。逐条与原因见 [`TODO.md`](TODO.md) **B-3**。
- **已实测的窗口安全边界**：`window.open` **真被 deny** · 外部导航**真被拦** · preload 暴露面恰好三键 · `file://` 导航是**前缀放行**（实测能把界面导航走 ⇒ 落 `chrome-error://`）—— 见 `docs/spec/SPEC-security.md` §8.1。
- **素材库只读**：检索**不移动、不复制、不重命名、不删除**任何素材；结果是路径。
- **索引与库位置绑定**：索引里存的是素材的**绝对路径** ⇒ 库再移动会让索引失效、必须重建；**索引不能边建边查**（与检索争 GPU）。
- **预览图里有 20 个文件名是 `.jpg`、内容实为 BMP**（集中在 `VR/`）—— 解码路径会自动回退，**它们不是坏文件**。
- **生产态保留 `devTools: true` 是已决策项**（`docs/spec/SPEC-security.md` §9 决定 3），不是疏漏。
- **日志**：主进程与渲染进程的诊断都写 `data\_app.log` —— Windows 上 Electron 是 GUI 子系统程序，**stdout 不连终端**，`console.log` 一条都看不到。

---

## 附录 A · 术语表

| 词 | 白话 |
|---|---|
| **向量 / embedding** | 把一段文字或一张图变成一串数字，让「意思相近」变成「数字相近」；本项目的统一维度是 **768** |
| **索引 (index)** | 事先算好并存的向量集合，落在 `data/libraries/<libId>/` |
| **引擎 (engine)** | 干活的「大脑」，不含界面：`packages/engine/`，**零第三方依赖** |
| **契约 (contract)** | 接口形状约定（有哪些方法、会报什么错）——先冻结，再写实现 |
| **门禁 (gate)** | 必须通过的检查点（`G-A`…`G-E2`） |
| **证据 (evidence)** | 门禁通过的凭据，存 `reports/`。**没有归档证据 = 门禁没通过** |
| **守卫 (guard)** | `tools/` 下**只读**校验脚本，跑完给 EXIT 码（现存 **2** 个，见 §3） |
| **派生导航** | 从权威文档**派生**的索引 / 总览（如 `docs/PROJECT-INFO.md`）：便于上手，**不是判据**。与上游冲突时以上游为准（§7.1） |
| **主进程 / 渲染进程** | 主进程管窗口与磁盘；渲染进程就是那个网页界面。两者严格隔离 |
| **preload / 安全桥** | 界面唯一能用的通道（只暴露 `invoke` / `onEvent` / `platform`），别的够不着 |
| **IPC** | 主进程与渲染进程之间的受控通信（**2 条通道**、**16 个方法**白名单 = 引擎 13 + 库配置 3）。⚠️ 清单以 `apps/desktop/src/shared/ipc.ts` 的 `Methods` 为准（取数：`node --input-type=module -e "import('./apps/desktop/src/shared/ipc.ts').then(m=>console.log(m.METHOD_NAMES.length))"`）。⚠️ **`thumb://` 是协议不是 IPC 方法** |
| **`thumb://`** | 缩略图自定义协议，形状**只允许** `thumb://<libId>/<uid>@<size>`——路径不由 URL 提供 |
| **配对 (pairing)** | 靠文件名主干相同，把 `ID-123.jpg` 与 `ID-123.rar` 认成一套素材；索引里**显式存了两个绝对路径** |
| **uid** | `sha1(lib_id\|rel_dir\|stem)[:12]`，12 位 hex，**已冻结** |
| **`compat`** | 兼容性判定键（8 项，不含 device/GPU）。只有 `compat` 相等的库才能合并检索 |
| **`band`** | 引擎按**同一模态内**区间给出的分数档（`high`/`mid`/`low`，也可能是 `unknown` ⇒ 引擎**拒绝定档**）。**界面不得自己算阈值，也不得跨模态比分数** |
| **`seq`** | 图像 soft token 预算（70/140/280）。是唯一的提速杠杆，**换档必须全量重建索引** |
| **设计令牌 (token)** | 颜色 / 字体 / 间距等视觉常量，定义在 `packages/design-tokens/tokens.css` |
| **ONNX / WebGPU** | 模型的通用交换格式 / 让浏览器直接用显卡算的技术；WebGPU 不可用时回落 CPU |
| **monorepo / workspaces** | 一个仓库多个包：`apps/*` + `packages/*`，用 npm workspaces 声明；**包之间用相对路径 import，不用包名解析** |

---

*本文件与磁盘不一致时，先修结构或代码，再回来改本文件——不要在两处各写一半。*

# TODO · 未完成项与待修 BUG

> **这份文件的唯一职责：回答「现在还有什么没做完 / 有什么坏了」。**
> 怎么干活、目录职责、约束与纪律 → [`AGENTS.md`](AGENTS.md)。项目是什么、怎么跑 → [`README.md`](README.md)。
>
> **单一事实来源分工（重要，别在别处再列一遍）**
> | 问题 | 看哪 |
> |---|---|
> | **现在要做什么 / 什么坏了**（可勾选行动清单） | **本文件** |
> | 什么顺序、什么算做完、验收阈值 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) · [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
> | 历史欠账台账（已清 / 未清逐条） | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
>
> ⚠️ **本文件只记"动作与证据"，不记"架构与规范"** —— 那两样在 `AGENTS.md`。
> ⚠️ 每条都要带 `文件:行号` 或可复跑的命令；**无证据的写【判断，非实测】**。
>
> 最后核对：2026-10-13

---

## A. 需修复 BUG（**已实测的违例**，不是猜测）

> 全部来自 `AGENTS.md` §0.1 的三条所有者禁令（P1 同概念多实现 / P2 复制粘贴 / P3 硬编码可配置值）
> 与三层架构。**实测命令都写在「怎么复现」里**，改完请把该行勾掉并把数字更新。

### A-1 🔴 三层架构违例：Adapter 不是唯一入口 — `task-21`（T5）

| 项 | 内容 |
|---|---|
| **现象** | 渲染层**3 个文件、7 处**直接调 `window.api`，没有 Adapter 层 |
| **证据** | `apps/desktop/src/renderer/src/hooks/useEngine.js` ×3 · `hooks/useLibraryConfig.js` ×1 · `pages/FirstRunWizard.jsx` ×3 |
| **怎么复现** | `grep -rn "window\.api" apps/desktop/src/renderer/src` |
| **标准** | 命中**全部**落在 `adapter/**`；`pages/ layout/ ui/ search/` 下 **0 命中** |
| **附加** | `pages/FirstRunWizard.jsx` 必须回归纯 UI（UI 层不得碰 Adapter） |
| **验收** | 见 `task-21`；且**新守卫 `verify_layering.mjs` 必须能红**（往 UI 里加一行 `window.api.invoke` ⇒ EXIT≠0） |
| **状态** | ☐ 未开工 |

### A-2 🔴 禁 P2：同一段逻辑复制了 20 处 — `task-21`（T5）

| 项 | 内容 |
|---|---|
| **现象** | 错误信封解包（`r.ok` / `error.code` / `userMessage`）散在 **6 个文件、20 处** |
| **证据** | `hooks/useEngine.js` 4 · `hooks/useLibraryConfig.js` 2 · `hooks/useSearch.js` 8 · `pages/FirstRunWizard.jsx` 3 · `pages/SearchPage.jsx` 2 · `search/Gallery.jsx` 1 |
| **标准** | 解包只出现在 Adapter（或 Operation 的单一处）；给出**改前/改后处数对比** |
| **状态** | ☐ 未开工 |

### A-3 🟠 禁 P3：硬编码本机绝对路径 — `task-21`（T5）

| 项 | 内容 |
|---|---|
| **现象** | 取件目录默认值写死 `E:\素材待用` / `E:\移出素材` |
| **证据** | `apps/desktop/src/main/library-config.mjs:43-44` |
| **⚠️ 改的时候别踩** | 它是 F-04 修复时按 SPEC 给的默认值。**`collect.dirs` 不得再变空** —— 否则 `COLLECT_DIR_NOT_ALLOWED` 复发（F-04 回归） |
| **验收** | `apps/desktop/tests/library-config.test.mjs`（12 条）全过，且断言默认目录存在 |
| **状态** | ☐ 未开工 |

### A-4 🟡 禁 P1：class 合并工具有两份同概念实现 — `task-20`（T4）

| 项 | 内容 |
|---|---|
| **现象** | `ui/cx.js`（本地实现，被 2 个文件引用）vs 已装的 `clsx` + `tailwind-merge`（= shadcn 的 `cn()`） |
| **证据** | `apps/desktop/src/renderer/src/ui/cx.js`；引用方 `layout/Sidebar.jsx:5` · `ui/Button.jsx:4` |
| **标准** | 合并成**一份**（用 `cn()`），不留两套 |
| **为何不现在做** | 与 Tailwind 落地同批（`task-20`），单独改会白改两次 |
| **状态** | ☐ 未开工（随 T4） |

### A-5 🟡 分层规则**没有守卫** — `task-21`（T5）

| 项 | 内容 |
|---|---|
| **现象** | 三层架构现在是**纯纪律**，靠人看；本仓库已两次证明"抓不到回归的守卫等于没有守卫" |
| **标准** | 新建 `tools/verify_layering.mjs`（只读、EXIT 0/1、报警给 `文件:行号`），且**双向验证**过 |
| **状态** | ☐ 未开工 |

---

## B. 未完成项

### B-1 技术栈迁移（所有者 2026-10-13 指令）

**目标栈**：Electron · React · **TypeScript** · **shadcn/ui** · **Tailwind CSS** · **Zustand** · **React Router**

**实测现状**（`grep` + `package.json`）：

| 项 | 现状 |
|---|---|
| Electron · React | ✅ 已在用（React 是**普通 JS/JSX，不是 TS**） |
| TypeScript | ⚠️ `typescript ^7.0.2` 已装，**渲染层/主进程全是 `.js`/`.jsx`/`.mjs`**；两个 tsconfig 的 `checkJs` **都关着** |
| Tailwind CSS | ⚠️ `tailwindcss` + `@tailwindcss/vite` 已装，**构建里没有插件**，渲染层零 import |
| shadcn/ui | ⚠️ 基础依赖全装了（`clsx` `tailwind-merge` `class-variance-authority` `lucide-react` `@radix-ui/react-dialog` `@radix-ui/react-alert-dialog`），**渲染层零 import** |
| Zustand | ⚠️ `zustand ^5.0.15` 已装，**零 import**（状态现为本地 hooks） |
| React Router | ❌ **未安装**（7 项里唯一要新增依赖的） |

**⚠️ `npx tsc --noEmit` 目前是「假绿」**（EXIT=0 / 0 错误，因为 `checkJs` 关着）。
临时打开 `checkJs` 后的**真实规模**：渲染层 **148** 错 · 主进程侧（含 `packages/engine/src` + `tools/`）**472** 错。
⇒ **在 T1 完成前，不得声称"类型检查通过"。**

**已拆成串行任务**（顺序不可乱；因为 `package.json` 与 `renderer/` 是共享写入面）：

| 任务 | 做什么 | 前置 |
|---|---|---|
| `task-17` **T1** | 契约边界先转 TS（`shared/ipc.mjs` → `.ts` + `z.infer` 导出）+ 加回 `typecheck` 脚本（**且必须能红**） | — |
| `task-21` **T5** | 三层架构落地 + A-1~A-5 的修复 + 分层守卫 | T1 |
| `task-18` **T2** | Zustand 接管状态 + React Router 接管多页 | T5 |
| `task-19` **T3** | Tailwind 接管样式生成层（**含重写样式守卫**） | T2 |
| `task-20` **T4** | shadcn/ui 按需接入 + **依赖清账**（消除 ~38 MB 已装未用） | T3 |

**详细验收标准** → `docs/plan/ROADMAP.md` §10（逐条表格，**不要在这里重复**）。

### B-2 未实现的功能

| # | 项 | 现状 / 证据 | 状态 |
|---|---|---|---|
| B-2-1 | **多页路由** | 现在是单页：`App.jsx → LibraryGate → SearchPage`。而 P3c（图片详情）· P3d（索引任务/操作记录）**本来就是多页** | ☐ 随 `task-18` |
| B-2-2 | **D8 多库注册表未持久化** | 只有「从配置派生单库」（`packages/engine/src/library.mjs`）；真正的多库注册表是 **P5**，**无任何持久化** | ☐ 未开工 |
| B-2-3 | **四个契约方法未实现** | `ingest` / `mutate` / `indexStart` / `indexCancel` 由主进程**显式拒绝**（P4/P5 欠账）。契约形状已冻结 → `docs/spec/CONTRACT-engine-v1.md` §2.5–§2.10 | ☐ 未开工 |
| B-2-4 | **P3c / P3d 两个页面** | 断点所在（见 `docs/plan/ROADMAP.md` §0「下一步」） | ☐ 未开工 |
| B-2-5 | **未接线的依赖** | `@tanstack/react-virtual`（浏览整库 3594 条时需要）· `lucide-react` 等 —— 见 B-1 的"依赖清账" | ☐ 随 `task-20` |

### B-3 未验证的能力（**不得声称可用**）

| # | 能力 | 为什么未验证 |
|---|---|---|
| B-3-1 | **冷启动耗时** | 从未测过 |
| B-3-2 | **打包后行为** | 从未打包验证 |
| B-3-3 | **真实 `thumb://` 取图** | 守卫只在**假 `electron`** 下验证过逻辑；真实协议取图未测 |
| B-3-4 | **真 Electron 窗口行为** | `window.open` 是否真被 deny、iframe 内 `invoke` 是否真被拒、`process` 到底暴露什么 —— 全部**未实测**（原靠 `smoke_app.mjs`，该守卫已于 2026-10-13 移除） |
| B-3-5 | **受限沙箱内的 `npm run build`** | 在 agent 沙箱里是 `spawn EPERM`（esbuild 常驻服务）⇒ 需提权；**这是环境限制，不是配置问题** |

### B-4 验证能力缺口（2026-10-13 移除 6 个守卫的后果）

> 所有者指令「仅保留 `verify_encoder_path` + `check_search`」。原件已备份在
> `data/_removed-guards-backup/`（**含从未提交的 `verify_main_wiring.mjs`**，不在备份里就永久丢失）。
> 恢复：拷回 `tools/` + 还原本文件 B-4 提到的 `package.json` 脚本。

| 失去的能力 | 原本由谁提供 | 后果 |
|---|---|---|
| 构建产物形状（ESM/CJS · external · CSP · preload 暴露面） | `verify_app_build` | 产物形状**零检查** |
| ⭐ **接线在行为上是否活着** | `verify_main_wiring` | F-01 `reveal` 静默假成功 · S11/S12/S13 · `thumb://` 状态码 **不再有行为证据** |
| 渲染层真跑（jsdom） | `verify_renderer_dom` | 首启向导 · F-01 文案 · F-02 档位 · S10 XSS **零检查** |
| 样式纪律 + F-02 界面自算阈值 | `verify_renderer_styles` | 界面可能再次硬编码阈值 |
| 真启动 Electron | `smoke_app` | "能不能出窗"**无法回答** |
| 文档引用解算 + 根目录纪律 | `verify-doc-refs` | 死链接与根目录堆积**无检查** |

**现存 2 个守卫都能启动，但本沙箱跑不动**（需模型目录 + 已注册索引）⇒
**"守卫全绿"在本环境已无法验证**，不要声称验证过。
可选补强（未开工）：写一个 `npm run verify` 把现存守卫串成一条可复现命令。

---

## C. 已修但**别改回去**（防回归清单）

> 这些不是 TODO，是**改相邻代码时的地雷**。完整边界说明见 `AGENTS.md` §7。

| # | 已修的缺陷 | 改什么会踩到 | 谁在锁 |
|---|---|---|---|
| C-1 | **F-01 · `reveal` 静默假成功** —— 引擎在无 `shell` 端口时**曾返回 `ok({revealed:true})`** | 动 `packages/engine/src/engine.mjs` 的 `reveal` 分支，或 `main/index.mjs` 的 `shell:` 注入 | 引擎 +5 条单测 · 端口本体 +4 条（⚠️ 原本的**行为层**锁定已随 `verify_main_wiring` 移除） |
| C-2 | **F-02 · 界面自算分数阈值** —— `ui/Score.jsx` 曾硬编码 `0.97/0.93`，导致**每次检索全被标成"较弱"** | 动 `ui/Score.jsx` 的 `band` 来源 | 原样式守卫**已移除** ⇒ 现在**只剩渲染层单测**，改的时候特别小心 |
| C-3 | **D2 · 库根配置** —— 曾只从 `config.json` 读 | 动 `main/library-config.mjs` 的四条优先级 | `apps/desktop/tests/library-config.test.mjs`（12 条） |
| C-4 | **F-04 · 取件白名单为空** —— `collect.dirs` 曾恒为 `{}` | 见 A-3（改硬编码时**别让它变空**） | 同上 12 条 |
| C-5 | **R-3 · `band` 原型键** —— `bandOf` 曾用 `BANDS[mode]`，`mode='toString'` 会命中原型 | 动 `engine.mjs` 的 `bandOf` | 引擎单测（`Object.hasOwn`） |
| C-6 | **`thumb://` 状态码映射** —— 曾把"形状错"也返回 404，§3 要求 **400** | 动 `thumb-url.mjs` 的 `thumbFailureStatus` | `apps/desktop/tests/permissions.test.mjs`「S6」 |

---

## D. 怎么用这份文件

1. **开工前**：从 A / B 里挑，确认它的验收标准（很多在 `docs/plan/ROADMAP.md` §10）。
2. **改完**：勾掉该行（`☐` → `☑`）并把**实测数字**更新（例如 A-1 的"7 处"若变成 0 就写 0）。
   ⚠️ **不要只把框打勾而数字还是旧的** —— 那正是本项目反复栽的坑（"断言看起来对，其实没测"）。
3. **新发现的问题**：按 A（有实测证据的坏） / B（没做完）分类加进来，**带上 `文件:行号` 或复现命令**。
4. **不在这里写架构与规范** —— 那些进 `AGENTS.md`；也不重复 ROADMAP 的验收表，只放指针。

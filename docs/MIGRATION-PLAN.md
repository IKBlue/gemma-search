# MIGRATION-PLAN · 全新项目化：monorepo 目录重组 + 单一 AGENTS.md + 消除冲突

> **状态**：现行（**本次重构的唯一执行依据，已冻结**）· **最后核对**：2026-10-12
> **权威范围**：P1 搬家 · P2 路径与构建 · P3 单一 `AGENTS.md` · P4 规格与设计重写 · P5 归档归位 · P6 独立复核 · P7 终验。
> **本文的目录结构、阶段划分与验收标准是冻结决定**，执行者不得在实施里另立方案；只更新其内部引用的旧路径。
> 执行进度与实测偏差写在 §2 的「执行说明」注里（不删原文，只加注）。

> **本文件是本次重构的唯一执行依据。** 由 Lead 冻结（所有者已选定：**幅度 B = monorepo 化**·**旧内容 A = 重写删除**）。
> 执行者若认为某步不可行，**先提出来改本文件**，不要在实施里另立方案。
>
> 前置事实基准：`docs/audit/00-current-state.md`（含 D1-D14 冲突清单）。
> **本重构的目标不是"再写一份文档"，而是让仓库里不再存在互相矛盾的说法。**

---

## 1. 目标目录结构（冻结）

```
gemma-search/
├── AGENTS.md                     ★ 唯一权威「工作指南」（合并原 AGENTS.md + PROJECT-GUIDE.md + 治理规则）
├── README.md                       技术总览（面向使用者/接手者）
├── package.json                    npm workspaces 根
├── package-lock.json
├── electron.vite.config.mjs        三端构建（显式 outDir → <root>/out）
├── electron-builder.yml            打包配置
├── tsconfig.json · tsconfig.node.json · tsconfig.web.json
├── .gitignore · .gitattributes · LICENSE
│
├── apps/
│   └── desktop/                    Electron 应用（原 src/）
│       ├── package.json            @gemma-search/desktop
│       ├── src/main/{index,encoder,log}.mjs
│       ├── src/preload/index.js
│       ├── src/renderer/{index.html, src/**}
│       └── src/shared/ipc.mjs      ★ 契约唯一来源
│
├── packages/
│   ├── engine/                     原 core/（零依赖、传输无关）
│   │   ├── package.json            @gemma-search/engine
│   │   ├── src/{engine,index,library,fingerprint,compat,errors}.mjs
│   │   └── tests/*.test.mjs        原 tests/（引擎单测跟引擎走）
│   └── indexer/                    原 onnx-spike/（索引构建 + 重采样兼容层）
│       ├── package.json            @gemma-search/indexer
│       └── src/*.mjs
│
├── docs/                           全部正文文档
│   ├── README.md                   ★ 文档总索引（谁指向谁）
│   ├── MIGRATION-PLAN.md           本次重构的执行依据（冻结）
│   ├── DEBT-CLEANUP.md             债务账本（**历史记录**，已有状态头）
│   ├── spec/                       现行规格（**重写：删掉 Python 时代与未落地承诺**）
│   ├── design/                     现行设计（tokens / app-details / ui）
│   ├── guide/                      上手、部署、排障
│   ├── plan/                       ROADMAP.md（做什么、什么顺序）+ 五套项目文档 DOCS-*.md
│   ├── audit/                      本次审查产物（00 基线 · 01 判据 · 三份报告 · 证据 · 复核）
│   └── archive/                    **已失效的东西全放这里**（见 §4）
│
├── tools/                          守卫（7 个，只读）+ probe_electron_start/
├── scripts/                        启动辅助（electron-vite.mjs）
├── reference/MODEL_CARD.md         官方模型卡（外部资料，只读）
├── build/                          打包图标 + 签名配置（**不是产物目录**）
├── reports/                        门禁证据（保留原名：项目规则「无归档证据 = 门禁未通过」）
├── data/                           索引 + 日志 + 诊断（绝大多数不进 git）
└── （以下为**未来**位置，当前不存在）
    └── tests/                      跨包集成测试（引擎单测已随包走，在 packages/engine/tests/）
```

> **[执行后修订 2026-10-12]** 上面这棵树已按**实际结果**校正了三处，与原计划不同：
> ① **补上 `docs/plan/`**（原 §1 漏列，与 §1.1/§3 自相矛盾）；
> ② `spike/` · `static/` · `archive/` 不是"并列顶层目录"，它们**已被移进 `docs/archive/`**
> （`docs/archive/{spike,prototype,legacy}`），所以从顶层树里去掉；
> ③ `tests/` **当前不存在**（只在 `AGENTS.md` §2 里作为未来位置登记），原计划把它画成顶层目录是错的。
> 另：根目录**只有** `AGENTS.md` + `README.md` 两份 `.md`（`verify-doc-refs` 实测越界 0）。

### 1.1 三份根文档 → 两份

| 原来 | 去向 | 理由 |
|---|---|---|
| `AGENTS.md`（任务宪章） | **并入新的 `AGENTS.md`** | 用户明确要求「单一 AGENTS.md」 |
| `PROJECT-GUIDE.md`（零基础总览） | **并入新的 `AGENTS.md`** | 二者都是"怎么在这个仓库里干活"，81% 内容重叠；且 `PROJECT-GUIDE` 自身有 D3/D4 两处失真 |
| `TASK-PLAN.md`（阶段计划） | `docs/plan/ROADMAP.md` | 它是"做什么/什么顺序"，属正文；且含大量 Python 段落需重写 |

**新 `AGENTS.md` 的定位（一句话）**：**唯一权威的「在这个仓库里怎么干活」** —— 目录职责、命名与放置规则、权威关系、门禁与验收、写作纪律、禁止事项。
`README.md` 定位：**项目是什么、现在什么状态、怎么跑起来**。

### 1.2 与守卫白名单的和解

`tools/verify-doc-refs.mjs:130` 现在的白名单是 `['README.md','PROJECT-GUIDE.md','TASK-PLAN.md']`。
重构后根目录只该有 **`AGENTS.md` + `README.md`**：

```js
const ALLOWED_ROOT = new Set(['AGENTS.md', 'README.md']);
```

⇒ 一举解决当前 D3/D4 的根因（文档该放哪）与「AGENTS.md 越界」红门。

---

## 2. 会打破的 7 处路径耦合（已实测逐一列出）

> ### ⚠️ 本节有两处**计划本身写错了**，实施时被 `code-paths` 用磁盘事实纠正（2026-10-12，Lead 已复核确认）
>
> | 本节的错 | 事实 | 谁发现 |
> |---|---|---|
> | 第 1/3 条写 `'../../../packages/...'`（**3 级**） | `apps/desktop/src/main/` 距仓库根是 **4 级**。实测：3 级 → 解析失败；4 级 → 成功 | code-paths |
> | 第 4 条写「`log.mjs` 的 ROOT 改成 **4 级**」 | **两态深度不同，不存在固定层级**：源码态 `apps/desktop/src/main` 要 4 级，而**构建态 `out/main` 只要 2 级**（`package.json` 的 `"main": "./out/main/index.js"`）。改成 4 级会在构建态把 ROOT 解到**项目外** —— 正是本条要防的静默失败 | code-paths |
>
> **实际采用的修法**（比原计划更稳）：`log.mjs` 改为**向上找标记**（`package.json` 含 `workspaces`，退化到 `packages/engine/src/engine.mjs`），**深度无关**；
> 并在首次 `log()` 时做一次**自检**（不匹配就打醒目横幅），打包态（`HERE` 含 `app.asar`）跳过自检 ——
> 因为打包态根本没有「仓库根」这个概念（`data/` 按设计要改 userData，属 P6）。
>
> **教训**：凡"按层级数 `..`"的路径假设，都必须同时考虑**源码态与构建态**；本仓库的 `ROOT` 探测统一改为标记式。

| # | 位置 | 现状 | 改后 |
|---|---|---|---|
| 1 | `src/main/index.mjs:25` | `from '../../core/engine.mjs'` | `from '../../../../packages/engine/src/engine.mjs'`（**4 级**，见上注） |
| 2 | `src/main/index.mjs:26` | `from '../../src/shared/ipc.mjs'` | `from '../shared/ipc.mjs'`（同在 apps/desktop/src 下） |
| 3 | `src/main/encoder.mjs:12,47` | `'../../onnx-spike/resize_compat.mjs'` / `bmp_decode.mjs` | `'../../../../packages/indexer/src/…'`（**4 级**） |
| 4 | `src/main/log.mjs:25` | `ROOT = resolve(HERE,'..','..')`（`out/main`→根） | ❌ **原计划「改成 4 级」是错的** → 实际：**标记式向上探测**（见上注），源码态/构建态通吃 |
| 5 | **6 个守卫的根探测** | 向上找 `core/engine.mjs` | 向上找 **`packages/engine/src/engine.mjs`**（`smoke_app:30` · `verify-doc-refs:31` · `verify_app_build:24` · `verify_encoder_path:30` · `verify_renderer_dom:25` · `verify_renderer_styles:22`）|
| 6 | `tools/*` 里的硬编码目录 | `'src','renderer'` · `'onnx-spike'` · `'core'` · `'static','prototype'` | `'apps/desktop/src/renderer'` · `'packages/indexer/src'` · `'packages/engine/src'` · `'packages/design-tokens'`（见 §5） |
| 7 | 测试 import | `'../core/*.mjs'` · `'../data/*'` · ROOT 探测 | `'../src/*.mjs'`（测试随引擎走）· ROOT 改为向上找 `packages/engine/src/engine.mjs` |
| 8 | **`tools/check_search.mjs`（计划漏列）** | 无根探测 + `path.resolve('data')` + **硬编码 `G:\model`** | 补同一套根探测；库根改 `--lib` / `GEMMA_LIB_ROOT`，缺参数**明确报错非 0 退出** |

> **`verify_app_build.mjs:20` 与 `verify_encoder_path.mjs:26` 的注释已经写着「搬目录也不会失效」** ——
> 它们的设计意图就是为这次重构准备的。只需把标记文件的路径换掉。

---

## 3. 执行阶段与门禁（**顺序不可并行跨越**）

> 为什么必须先搬完再改内容：搬文件与改内容若并行，两人会同时动同一文件 → 覆盖。
> 因此 **Phase 1（搬家）由 Lead 独自完成并冻结**，之后才允许并行。

| Phase | 内容 | 谁 | 门禁 | **实际结果（2026-10-12）** |
|---|---|---|---|---|
| **P1** | **纯 `git mv` 搬家**（不改一行内容） | **Lead 独占** | `git status` 只有 rename；`git diff --stat -M` 显示 0 内容改动 | ✅ **120 个 rename · 0 内容改动**（`git diff --cached -M --stat` 末行「120 files changed, 0 insertions, 0 deletions」）。另删除：空壳 `core/ src/ tests/`、`onnx-spike/node_modules`（473 MB 重复依赖树 → 消除双 `RawImage` 隐患 R6）。
> **独立复核补充（2026-10-12）**：`docs/archive/spike/*.json` 在 `--numstat` 里显示 `-  -`，我原以为那是"二进制"。复核者**逐个比对 blob hash** 证明它们**内容完全未变** —— `-  -` 只是 **git 对超长行的处理**（这些 JSON 是单行超长），**不是二进制标记**。结论（0 内容改动）成立，**我原来的理由写错了**，在此更正。 |
| **P2** | 修路径耦合 + 根探测 + 构建配置 + `package.json` workspaces/scripts + `.gitignore` | 代码线 + 构建线 teammate | `npm test` 68/65/0/3 · 守卫 EXIT=0 · `npm run build` 成功 | ✅ **`npm test` = 68/65/0/3** · `verify_renderer_styles` EXIT=0 · `verify-doc-refs` 根目录越界 **0** · ⚠️ **`npm run build` 无法在本沙箱验证**（esbuild `spawn EPERM`，见 §7 末行）—— 需非受限终端终验 |
| **P3** | **单一 `AGENTS.md`** + `README.md` + `docs/README.md` 指向体系 | 文档线 teammate | `verify-doc-refs` 死引用 0（外部 URL 除外） | ✅ `AGENTS.md`（§0 治理宪章 + 8 节）、`README.md`、`docs/README.md`、`docs/guide/{GETTING-STARTED,TROUBLESHOOTING}.md` 齐备；删 3 份旧索引文档；**根目录 .md = 恰好 2 份** |
| **P4** | `docs/spec/*` `docs/design/*` **重写删旧** | 规格线 teammate | 全仓 grep 无 `.py` 命令 / 无 `config.json` 教学 / 无未标注栈承诺 | ✅ 13 份文档加统一状态头；`docs/plan/` 死引用 **17→0**；栈承诺改为与实现一致（JS/JSX + 手写 CSS + 自研 `ui/`）；数字改对（24 依赖 / 1089.9 MB / 68 测） |
| **P5** | `docs/archive/` 归位 + `TASK-PLAN`→`docs/plan/ROADMAP.md` | Lead | 旧路径全仓无引用 | ✅ `docs/archive/{spike,prototype,legacy}`；`PROJECT-GUIDE.md` 归档；三份审查报告归位 `docs/audit/` |
| **P6** | **独立复核**（验证者自己跑命令，不看实施者结论） | verifier | verdict + blockers=0 | ⏳ 见 §3.1 |
| **P7** | Lead 终验 | Lead | 上表全绿 + `git diff -M` 可追溯 | ⏳ |

### 3.1 执行中的**六处计划偏差**（都按磁盘事实改了，已回写本文档）
| # | 计划写的 | 事实 | 发现者 |
|---|---|---|---|
| 1 | 相对深度 3 级 `'../../../packages/...'` | **4 级**（`apps/desktop/src/main` 距根 4 级） | code-paths |
| 2 | `log.mjs` 的 ROOT「改成 4 级」 | **两态深度不同**（源码 4 / 构建 2）⇒ 改用**标记式探测 + 首跑自检** | code-paths |
| 3 | 6 个守卫的根探测 | 还有**第 7 个** `check_search.mjs` 既无根探测、又硬编码 `G:\model` | code-paths |
| 4 | 「本环境不重跑 `npm install`」 | **必须跑一次**：`--package-lock-only` 只补锁文件条目、**不建符号链接** ⇒ `npm ls`/`npm ci` 仍失败 | build-config |
| 5 | （未预见）`npm run build` 可得 | **本沙箱内不可能**（esbuild `spawn EPERM`） | build-config |
| 6 | （未预见）`verify_encoder_path` 可得判定 | 该守卫**在 Windows 上从未跑成过**（动态 `import(绝对路径)` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`）；修好后**当场抓到应用侧 BMP 回退的真实 bug** | code-paths |

**回退点**：`git` HEAD = `4555c1b` 是唯一回退点。每个 Phase 完成后 Lead 记录一次 `git status` 快照。
**不做的事**：不 `git commit`（除非所有者要求）；不 push；不改 `data/` 里的索引；不改 `tools/verify-doc-refs.mjs` 的判定逻辑（只改白名单与标记路径）。
**例外（已发生，需所有者知情）**：重构期间顺带修了一个**真实产品缺陷** —— `apps/desktop/src/main/encoder.mjs:48` 把 `Buffer` 传给要**路径**的 `readBmpAsRawImage(filePath)`，导致应用侧 BMP 回退（那 20 张「名为 `.jpg` 实为 BMP」的图）在**以图搜图时抛错**。发现方式见上表第 6 行。**这是本次唯一的非目录类代码改动。**

### 3.2 独立验证发现的问题（2026-10-12，见 `docs/audit/REVIEW-MIGRATION.md`）

> 独立验证者（未参与重构）给 **`pass-with-issues`**，2 条 blocker + 5 条反驳，**全部经 Lead 复核确认属实并已处置**。

| # | 发现 | 处置 |
|---|---|---|
| **B-1** | `reports/README.md` 是**现行权威文件**（`AGENTS.md` §3/§4 指它），但迁移完全没碰它 ⇒ 里面 5 条命令**全部不可执行**（`.venv` / `quality_*.py` / `onnx-spike/` / `TASK-PLAN` / `G:\model`） | ✅ **Lead 已重写该文件**：「复现一遍 G-B」整节标为**已作废**并说明为什么不可复算；阈值与协议保留；去掉硬编码 `G:\model` |
| **B-2** | `apps/desktop/src/README.md` 的模块位置说明与磁盘**相反**（称 `encoder.mjs`「逐字一致 / 路径深度未变」、称两个关键件「仍在 `onnx-spike/`」「这一轮刻意不动」、称 `start:legacy` 仍可跑） | ✅ **Lead 已整体重写该文件**（它记的是更早一次 `app/`→`src/` 迁移，已被两次取代） |
| R-1 | `npm ls --depth=0` 实为 **EXIT=1 + 4 个 `invalid`**，任务口径只查 UNMET 会**掩盖非 0 退出** | ✅ 交付说明改用 `npm ci --dry-run`（EXIT=0）作为强证据；`invalid` 经隔离复现判为 **npm 11.9 假阴性** |
| R-2 | 6 条死引用的根因**不是同一类**：`REVIEW-UIUX-AUDIT.md:432` 的 `materials.md` 是**中文散文里的文档名**（不在 URL、不在反引号里），另 5 条才是裸 URL 末段 | ✅ 本文件与交付说明改为「**两类**：散文裸写文件名 + 外部 URL 末段」 |
| R-3 | 3 个包 manifest 的**注释示例**用了错误的 3 级相对深度（那些文件距根实为 **2 级**）；真实 import 全部正确 | ✅ Lead 已改 3 处注释并加「相对深度别照抄」的警告 |
| R-4 | 「**0 内容改动**」**只在 `--cached` 层成立**：`git diff -M HEAD` = 149 files / 1613+ / 1930− | ✅ 已限定作用域（本表第 P1 行措辞是「`--cached` 层的搬运」；全仓改动量见交付说明） |
| R-5 | `log.mjs` 的**兜底**仍按层级数 `..`，只对构建态正确（源码态会落到 `<根>/apps/desktop`） | ✅ Lead 已加注释说明「这是**故意**的吵一声」；正常两态走标记式探测，走不到兜底 |
| 更正 | `AGENTS.md` §5.1 称 2/3 两个 skip 是「**死引用，会永久跳过**」——**错**：真正缺的只有 `config.json`；`data/baseline-v1.json` **是被 git 跟踪的** | ✅ 已发回 `docs-guide` 更正为「**D2 处置后可复活**」 |

**验证者如实登记的 limits（未验证，不得替它放行）**：`npm run build`（esbuild `spawn EPERM`，失败于 `loadConfigFromFile` **配置尚未求值**，故不能归因于配置内容）· `out/` 三端齐备性 · `verify_app_build` · `verify_renderer_dom` · `smoke_app` · `verify_encoder_path`（⇒ **`encoder.mjs` 的 BMP 修复未获运行时证实**，只核了 diff 与代码事实）· `check_search` · 真实 `npm ci` · 打包态。

---

## 4. 「重写删除旧内容」的具体删除清单（所有者选了 A）

> **[执行说明 2026-10-12]** 清单里带 `archive/`、`static/_archive/` 前缀的条目，**实际处置是"归档"而不是"物理删除"** ——
> 因为所有者同时选了 B（monorepo 化），而这些目录整体被移进了 `docs/archive/`
> （`archive/` → `docs/archive/legacy/` · `static/` → `docs/archive/prototype/` · `spike/` → `docs/archive/spike/`）。
> 留在 `docs/archive/` 符合仓库既有纪律（「留档不删，git 可回溯」），且不妨碍"现行文档不得自相矛盾"这个目标。
> **其余的删除（Python 段 / `config.json` 教学 / 栈承诺）已按 A 方案逐处执行。**

**删除**（git 历史仍可回溯，所以是安全的）：

| 对象 | 为什么删 |
|---|---|
| 全仓所有 **Python 时代内容**：`python.exe` / `.venv` / `tools/*.py` 命令段 / `preflight_p05.py` / `requirements*` / `start_server.cmd` | 仓库 0 个 Python 文件，这些命令**全部不可执行** |
| **`config.json` / `config.example.json` 教学段** | 文件已删；`README.md:87` 自己说「没有配置文件了」 |
| **TS + Tailwind + shadcn/ui + zustand + Lucide + react-virtual 的栈承诺** | 实际是 JS/JSX + 手写 CSS + 自研 `ui/`；18 个依赖零 import |
| `archive/` 下 21 个 `_patch_*_20261010.mjs`（一次性补丁脚本，已应用完毕） | 已生效，不再是依据 |
| `archive/app-shell-20261010/`、`archive/plan-*.md`（被取代的旧外壳与旧计划） | `archive/README.md` 自己说「不再是依据」 |
| `static/_archive/`（被取代的 mockup） | 同上 |
| `PROJECT-GUIDE.md` 的 D3/D4 失真段 | 与磁盘不符 |

**保留但必须标注状态**（不能删，因为它们是"为什么这么定"的证据）：

| 对象 | 标注 |
|---|---|
| `reports/`（门禁证据） | 保留原名（项目规则：无归档证据 = 门禁未通过）；`docs/README.md` 注明 G-B 判据已不可复跑 |
| `reference/MODEL_CARD.md` | 外部资料，只读 |
| `docs/spec/SPEC-transactions.md` | P4 未实现的规格（**是设计依据，不是历史**）→ 标注「待实现」 |
| `docs/spec/CONTRACT-engine-v1.md` | **现行权威**，但需补 `reveal` 的 `shell` 注入要求（见 F-01） |
| `spike/` → `docs/archive/spike/` · `static/` → `docs/archive/prototype/` | 路线决策与设计证据 |

---

## 5. 一个必须写明的例外：`tokens.css` 仍是视觉唯一来源

**没有第二个地方定义视觉常量。** 所以即使原型套件整体进 `docs/archive/prototype/`，
`tokens.css` 仍然是**生产依赖**（`apps/desktop/src/renderer/src/main.jsx` 直接 import 它）。

处置（二选一，**Lead 选 ①**）：

1. **把 `tokens.css` 提升为正式资产**：`packages/design-tokens/tokens.css`，原型套件其余部分进 `docs/archive/prototype/`。
   这符合「令牌唯一来源」的既有纪律，也不再让生产代码依赖归档目录。
2. 保持原位并把 `docs/archive/prototype/` 标为「含生产依赖」。

⇒ 选 ①。`verify_renderer_styles.mjs` 的 `TOKENS` 路径随之改。

---

## 6. 验收标准（DoD）

重构完成当且仅当：

1. **`npm test`** → `tests 68 · pass 65 · fail 0 · skipped 3`（与重构前逐项一致）— ✅ **已达成**
2. **四个守卫 EXIT=0**：`verify_app_build` · `verify_renderer_styles` · `verify_renderer_dom` · （`verify-doc-refs` 的**两类已知误报**除外，且根目录越界必须为 0）
   — ⚠️ **部分达成**：`verify_renderer_styles` **EXIT=0**；`verify-doc-refs` **根目录越界 0**、死引用 6（**两类误报**：外部 URL 末段 5 条 + 中文散文里裸写的文档名 1 条，均见 `AGENTS.md` §6）。
   **`verify_app_build` / `verify_renderer_dom` 未获判定** —— 它们依赖 `out/`，而本沙箱**跑不了 `npm run build`**（见第 3 条）
3. **`npm run build`** 成功，且 `out/{main,preload,renderer}` 三端产物齐备
   — ❌ **本沙箱内不可能执行**：esbuild 用 piped stdio spawn 常驻服务 → `spawn EPERM`，失败点在 **`loadConfigFromFile`（配置尚未被求值）** ⇒ 不能归因于配置内容。
   **必须在非受限终端跑一次**。`out/` 当前不存在（P1 前的过期产物已删，避免守卫校验旧产物得出误导结论）
4. **`git diff -M`（内容层）只包含预期改动**，无意外文件 — ✅ **已达成**（独立验证者逐项归类 44 项：路径修正 18 / 配置迁移 10 / 文档重写 15 / 已声明例外 1；**`unexpected_changes = []`**）
5. **全仓 grep 不再命中**：`config.json` 教学 · `\.py\b` 命令 · `shadcn` 无标注承诺 · `PROJECT-GUIDE` — ✅ **已达成**（残留仅出现在「已标注作废」的说明块、`docs/archive/`、以及 `docs/MIGRATION-PLAN.md` 自身的删除清单/偏差记录里）
6. **根目录只剩** `AGENTS.md` + `README.md` 两份 `.md` — ✅ **已达成**（`verify-doc-refs` 第 2 项：✓ 只有入口与行动依据）
7. **独立复核 verdict = pass**，blockers 清零 — ⚠️ **第一轮 `pass-with-issues`（blockers 2 + 反驳 5）**，全部经 Lead 复核确认并处置；详见 §3.2
8. 未 `git commit`、未 push、未改 `data/` 索引 — ✅ **已达成**

> **DoD 未全绿的项只有一类：`npm run build` 及其两条下游检查。** 这是**环境限制**，不是重构结果。
> 它必须在普通终端验一次 —— **在那之前，不得声称"构建在 monorepo 下成立"**。

---

## 7. 风险与对策

| 风险 | 对策 | 实际结果 |
|---|---|---|
| **6 个守卫的根探测全指向 `core/engine.mjs`** —— 搬完 `core/` 后全部失效（报"找不到项目根"） | P1 后**立刻**在 P2 修这 6 个文件；期间不跑守卫、只用 `git status`/`ls` 验证搬家 | ✅ 已修，守卫可跑 |
| `log.mjs` 的 `ROOT` 深度假设（`out/main`→根 2 级）在 `apps/desktop/src/main` 下变 4 级 | ~~P2 显式改 + 加断言~~ → **改法错了**：两态深度不同（源码 4 级 / 构建 2 级） | ✅ 改为**标记式探测 + 首次 `log()` 自检**（见 §2 注） |
| electron-vite 默认把产物写到工程根的 `out/`，现在工程根变成 `apps/desktop/` | `electron.vite.config.mjs` **显式设 `build.outDir`** 指向 `<仓库根>/out`，保持守卫与 `electron-builder.yml` 的假设不变 | ✅ 三段 outDir 实测为绝对路径 `<根>/out/*`；另**必须**显式给 renderer 的 `rollupOptions.input`（否则默认探测落空 → 构建失败） |
| npm workspaces 引入后 `npm install` 行为变化 | ~~本环境不重跑 install~~ → 实测**必须跑一次**：`--package-lock-only` 只为锁文件补上 4 个 workspace 条目，但**不建符号链接** ⇒ `npm ls`/`npm ci` 仍失败 | ✅ 已跑 `npm install --ignore-scripts --cache .npm-cache`（沙箱禁写全局 npm cache）→ 4 个 Junction 建好 |
| 搬 `tests/` 到 `packages/engine/tests/` 会让 `npm test` 的 glob 失配 | `package.json` 脚本同步改 `packages/engine/tests/*.test.mjs`，并在 P2 立刻跑 | ✅ `tests 68 · pass 65 · fail 0 · skipped 3` |
| **（新发现）`npm run build` 在本沙箱内无法执行** | — | ⚠️ **未解决**：esbuild 用 piped stdio spawn 常驻服务 → `spawn EPERM`，失败在**加载配置**之前。需在**非受限终端**跑一次作为终验 |
| **（新发现）`npm ci` 曾经必然失败** | 根锁文件是单包形态（无 workspace 条目） | ✅ 已用 `npm install --package-lock-only` 重新生成（649 → 663 条，含 4 个 `@gemma-search/*`） |
| 文档重构面大（13 份 + 新增），容易再生矛盾 | P3/P4 完成后由**独立验证者**用「全仓 grep + 逐条 D1-D14 复查」验收 |

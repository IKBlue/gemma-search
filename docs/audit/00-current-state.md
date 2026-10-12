# 00 · 现状基线（审查用唯一事实来源）

> **本文件的定位**：本仓库存在大量「文档描述」与「代码实际」不一致的地方，且文档自身在 §0 已声明
> 「`SPEC-*.md` / 当时的 `TASK-PLAN.md`（现已改名 `docs/plan/ROADMAP.md`）里仍大量提到已退役的 Python 档，不是现状」。
> 为避免三份审查报告各说各话，本文件由 **Lead 独立核对磁盘与命令输出后写成**，
> 作为后续所有审查（`STACK-AUDIT.md` · `UIUX-AUDIT.md` · `AUDIT-FINAL.md`）的**共同事实基准**。
>
> **纪律**：本文件中每条事实都带证据（文件行号 / 命令 / 命令输出）。凡未亲自核对的一律标 `未核实`。
> 若下游审查发现本条与磁盘不符，**以磁盘为准并回写本文件**（只有 Lead 能改）。

- 核对时间：2026-10-10 之后的本轮审查
- 核对人：Lead
- 仓库 HEAD：`4555c1b chore!: 旧档 Python 层整体退役 —— 仓库从此零 Python`
- 工作区状态：干净，唯一未跟踪文件 `AGENTS.md`（`git status --short` 实测）

---

## 1. 交付物与进度：计划 vs 实际

| 计划（`TASK-PLAN.md` §3） | 计划状态 | **磁盘实测状态** | 证据 |
|---|---|---|---|
| P0 基线复核 | ✅ 已完成 | ✅ 证据在 `data/baseline-v1.json`、`reports/G-B-*` | — |
| P0.5 索引重建 | ✅ v2 PASS | ✅ `data/libraries/L1/` 存在（3594 条） | `core/engine.mjs` `indexStatus` |
| P1 引擎 `core/` | ✅ 68 测 | ✅ **68 测 · 65 过 · 0 失败 · 3 跳过**（`npm test` 实跑） | 见 §4 |
| P1.5 Electron 内冒烟 | 计划中 | ✅ 有证据 `reports/G-D-p2-electron/` | — |
| P2 Electron 骨架 | 计划中 | ✅ `src/main` · `src/preload` · `src/renderer` 齐备 | — |
| **P3 界面** | **四步** | ⚠️ **只完成 1 页（语义搜索）**；`App.jsx` 只有 `<SearchPage />` | `src/renderer/src/App.jsx:6-8` |
| P4 入库与增量 | 未做 | ❌ `ingest` 被主进程显式拒绝 | `src/main/index.mjs:191-195` |
| P5 多库管理 | 未做 | ❌ 注册表支持多库，但界面无入口（按钮点了只弹 toast） | `SearchPage.jsx:99` |
| P6 打包与离线 | 未做 | ❌ 无安装器产物；`build/` 只有图标与签名配置 | — |
| P7 退役旧档 | ✅ **提前执行** | ✅ 0 个 Python 文件 | `git log 4555c1b` |

**结论**：项目实际处于 **P3 的第 1/4 步**，而非 `TASK-PLAN.md` §0 措辞暗示的「P3 进行中」。
第 ① 条宪章（技术栈对标）和第 ② 条（UI/UX 对标）都必须以这个进度为前提——对标**已建成部分**，
对**未建成部分**只给「规格是否偏离最佳实践」的判断，不假装它已实现。

---

## 2. 技术栈：声称 vs 实际

| 项 | `TASK-PLAN.md` §0 / `SPEC-app.md` §3 声称 | **实际** | 证据 |
|---|---|---|---|
| 语言 | **TypeScript** | ❌ **普通 JS/JSX**（`.mjs` / `.js` / `.jsx`），全仓 **0 个 `.ts`/`.tsx`** | `package.json` 无 `typecheck` 脚本；`tsconfig.web.json` `checkJs:false` |
| UI 组件库 | **shadcn/ui** | ❌ **自研 ui/**（10 个组件，普通函数组件 + `cx()`） | `src/renderer/src/ui/*.jsx` |
| 样式 | **Tailwind** | ⚠️ Tailwind **已装未用**：`tailwindcss`+`@tailwindcss/vite` 在 devDependencies，但 `electron.vite.config.mjs` 的 `renderer.plugins` **只有 `react()` 与 `devCspRelax()`，没有 tailwind 插件** | `electron.vite.config.mjs:69` |
| 视觉实现 | 令牌唯一来源 `static/prototype/tokens.css` | ✅ 一致：`renderer.css` 只消费 `var(--*)`，有守卫 `tools/verify_renderer_styles.mjs` | `renderer.css:1-10` |
| CSS 变量注入 | — | ⚠️ `renderer.css` 里**查不到 `:root` 令牌定义**，令牌来自 `main.jsx` 直接 import 跨出 renderer root 的 `static/prototype/tokens.css` | `electron.vite.config.mjs:67-68` |
| 外壳 | Electron | ✅ Electron 44.7（`out/` 有构建产物） | `out/renderer/assets/index-*.js` 673 KB |
| 引擎 | Node ESM、零依赖、传输无关 | ✅ **成立且被守卫**：`core/` 只用 `node:fs`/`node:path`/`node:crypto`，6 个文件 | `core/*.mjs` 顶部 import |
| 编码 | ONNX + WebGPU，109 维 | ✅ **768 维** | `README.md:6` · `SPEC-identity.md` |

> **重要更正**：第 ① 条宪章描述「对标行业最佳实践」，但**规格文档承诺的栈和实际栈是两套**。
> 审查必须先判定「承诺的那套（TS + Tailwind + shadcn）是否为最佳实践」，
> 再判定「实际这套（JS + 手写 CSS + 自研 ui）代价多大」。二者不可混为一谈。

---

## 3. 安全姿态（实测）

| 项 | 值 | 证据 |
|---|---|---|
| `nodeIntegration` | `false` | `src/main/index.mjs:297` |
| `contextIsolation` | `true` | `src/main/index.mjs:298` |
| `sandbox` | `true` | `src/main/index.mjs:299` |
| preload 暴露面 | **3 个成员**：`invoke` / `onEvent` / `platform`；**不暴露 `ipcRenderer`** | `src/preload/index.js:15-28` |
| IPC 通道数 | **2 个**：`engine:invoke` / `engine:event` | `src/shared/ipc.mjs:12-13` |
| 方法白名单 | **11 个**，用 zod `.strict()` 逐方法校验 | `src/shared/ipc.mjs:20-71` |
| 载荷上限 | 1 MiB | `src/shared/ipc.mjs:76` |
| 来源校验 | 校 `event.sender` === 主窗口 + 拒 iframe + 校 URL | `src/main/index.mjs:163-171` |
| CSP | `default-src 'self'`，**无远程源**，`object-src 'none'` | `src/renderer/index.html:8-10` |
| 新窗口 / 导航 | 全拒 | `src/main/index.mjs:310-313` |
| `thumb://` 形状 | **只允许** `thumb://<libId>/<uid>@<size>`，路径不由 URL 提供 | `src/main/index.mjs:242` |
| `devTools` | **生产态也留 `true`**（已决策，见 `SPEC-security.md` §9 决定 3） | `src/main/index.mjs:304` |
| 权限测试 | `tests/security.test.mjs`（绝对路径 / `..` / 联接 / 符号链接 / 白名单段匹配…） | `tests/security.test.mjs` |

**未测/未验证**（审查须标注，不得声称通过）：

- 符号链接拒绝测试**跳过**了：`本环境无法创建文件符号链接：EPERM`（`npm test` 输出实测）
- 指纹跨语言一致性测试**跳过**：`缺 config.json 或 baseline-v1.json`
- uid 整库唯一性测试**跳过**：`无 config.json`

---

## 4. 本轮实跑命令与原始输出（可复现）

```powershell
npm test
# ℹ tests 68   ℹ pass 65   ℹ fail 0   ℹ skipped 3   ℹ duration_ms 530.371
# 跳过三项的原因（原始输出）：
#   # 本环境无法创建文件符号链接：EPERM: operation not permitted, symlink '...'
#   # 缺 config.json 或 baseline-v1.json
#   # 无 config.json
```

> **值得注意**：`config.json` 已随 Python 档退役被删除（`README.md:33`），
> 但 `tests/uid.test.mjs` 与 `tests/security.test.mjs` 仍以它为数据源 → **3 个跳过里有 2 个是死引用**。
> 第 ③ 条宪章（最终 review）必须处置这条。

---

## 5. 仓库自身的文档一致性问题（已发现，待审查确认）

| # | 问题 | 证据 | 性质 |
|---|---|---|---|
| D1 | `README.md:47` 与 `PROJECT-GUIDE.md:70,98` 说 `tools/` 有 **6 个**守卫；**实测 7 个**，多出的 `verify-doc-refs.mjs` 不在 `README.md:94-103` 的命令清单里 | `(Get-ChildItem tools -File -Filter *.mjs).Count` = **7** | 计数过期 + 该守卫**当前 EXIT=1**（见下） |
| ~~D1附~~ | ~~「全仓无一处提到 `verify-doc-refs.mjs`」~~ | ❌ **本条已推翻（Lead 复核）**：`docs/README.md:92` 明确写了 `node tools\verify-doc-refs.mjs  # 全仓引用解算 + 根目录越界检查（只读）` | 记录我的判断错误 |
| D2 | `src/main/index.mjs:68-86` `loadConfig()` 读 **`config.json`**，而该文件已被退役删除 | `loadConfig` 找不到时静默返回 `{}` → `LIB_ROOT=''` → `buildEngine()` 传空库列表 → 界面永远是 `LIB_NOT_FOUND` | **文档说删了但代码还在读** |
| D3 | `PROJECT-GUIDE.md:157` 说「新的规格/设计文档放**仓库根**」；而 `README.md:145-153` 列出的文档实际在 `docs/spec/`、`docs/design/` | `PROJECT-GUIDE.md` §6 表 vs 实际目录布局；`docs/` 下实测 13 个 `.md` | 文档自相矛盾 |
| D4 | 文档反复声称「仓库根 **24 个文件**」「**13 份**根目录权威文档」（`PROJECT-GUIDE.md:114,160,186,213-214`） | 根目录**文件实测 14 个**（含 `AGENTS.md`）/ 条目 33 个；13 份权威文档**全在 `docs/` 里**，根目录只有 `README.md`/`PROJECT-GUIDE.md`/`TASK-PLAN.md` | **数字与位置双双失真** |
| D5 | `src/main/index.mjs:191` 拒绝 `ingest/mutate/indexStart/indexCancel`；而 `src/shared/ipc.mjs:49-70` 已登记它们的 schema | 契约「先冻结形状」与实现「显式拒绝」并存 | **定性：设计取舍（诚实降级），不是缺陷** —— 第②条审查补强：`SearchPage.jsx:99-100` 的「＋ 添加图库」「↻ 更新索引」**不 disabled**，点击后弹明确 toast，符合判据 §3 对「死功能必须记录用户实际会看到什么」的正向做法。**唯一要求：契约「冻结形状」与实际能力要有一处对齐说明** |
| ~~D5附~~ | ~~「`METHOD_NAMES` 会广播这 11 个方法（渲染层能拿到）」~~ | ❌ **本条已推翻（Lead 复核）**：grep 全仓，`METHOD_NAMES` **只出现在 2 处** —— 定义处 `src/shared/ipc.mjs:73` 与使用处 `src/main/index.mjs:205`（**只用于写一行日志**）。渲染层拿不到它 | 记录我的判断错误 |
| D6 | `engine.reveal()` 在未注入 `shell` 时**静默成功**：`if (shell && …) shell.reveal(abs)` 不满足也 `return ok({revealed:true})`；而 `src/main/index.mjs:118-126` **从未注入 `shell`** | `core/engine.mjs:434-435` vs `src/main/index.mjs:118` | **已确认为真实缺陷**（第①条审查判 Critical，Lead 复核同意） |
| **D9** | **`SPEC-security.md:192` 把 `sharp` 列在「刻意**不引入**」，而它实际是生产依赖且被生产路径使用** | `package.json:45` 在 `dependencies`；`src/main/encoder.mjs:12` → `onnx-spike/resize_compat.mjs:35` `await import('sharp')`（**动态** import，静态 grep 会漏） | 安全规格的依赖清单**反向失真** |
| **D10** | `package.json:59` 注释称「打开 checkJs 会报 **222** 条 noImplicitAny（实测）」 | 第①条审查实测：node 侧 noImplicitAny 家族 **111** / 两侧合计 **197**；且强制 `--checkJs` 后总错误 **356 条**（126 渲染层 + 230 node） | 数字不可复现（**非本轮实测**，引用第①条审查 E1.3） |
| **D11** | **界面自己算分数档位，完全无视引擎给的 `band`，且阈值与引擎不同源** | 引擎：`core/engine.mjs:25-28` `text:{high:0.72,mid:0.65}` / `image:{high:0.90,mid:0.80}` ⇒ 返回 `band: high\|mid\|low`。界面：`src/renderer/src/ui/Score.jsx:4-6` 硬编码 `0.97/0.93`，产出 `same\|like\|weak`；全仓 grep **`item.band` 0 命中** | **违反契约明文**（第②条审查独立发现同一处，判 Critical 9，含截图实证） |
| **D12** | **`static/prototype/` 没有任何令牌守卫**：`tools/verify_renderer_styles.mjs:29` 扫描根只有 `src/renderer/src` | 原型套件实测含硬编码色值（`#858aff` / `#8b91ff` 等，分布在 7 个 HTML + 1 个 CSS），含文档声称「已全量替换」的靛蓝残留 | 设计资产绕过纪律 |
| **D13** | **令牌守卫只查单向**：`verify_renderer_styles.mjs:98` 仅断言 `used → defined`，**不查 `defined → used`** | 实测 **35 个令牌（34%）定义了从未被消费**；其中 `--cat-uncat-bg/fg` 对应的「未分类」标签**不可达**，因为 `src/renderer/src/ui/Tag.jsx:4` 的 `CLASS = { VR, CR, 'CR+VR' }` **不含 `'未分类'`**，于是「未分类」与「其他」**同色** | 守卫的方向性缺口 + 一个不可达的分类展示 |
| **D14** | **`seq` 同屏两个来源**：页脚写死文本，指标卡动态读 `compat` | `src/renderer/src/pages/SearchPage.jsx:140` 硬编码 `` `… seq140）` ``；`src/renderer/src/search/MetricsRow.jsx:25,37` 从 `lib.compat.split('|')[4]` 动态取。**换 seq 后同屏两个数字互相矛盾** | 真实缺陷（换档即暴露） |

> D6 需在第 ③ 条宪章的最终 review 里定性：是「P2 未接线的已知欠账」还是「静默假成功」。
>
> **D6 已加重（本轮新证据）**：`tests/engine.test.mjs:314-323` 的测试**自己注入了 shell**
> （`createEngine({ …, shell: { reveal: (p) => seen.push(p) } })`）并断言 `seen` 被写。
> 也就是说：**单测是绿的，因为它注入了应用里从不注入的那个端口。**
> 这是「测试通过掩盖接线缺失」的典型形态 —— 单测测的是引擎能力，不是应用的接线。
> 用户可见后果：点「定位」→ 弹「已在资源管理器中定位」→ 资源管理器**什么都不发生**。

### 5.1 根因归纳：**`config.json` 是三条缺陷的共同上游**

| 缺陷 | 为什么是 `config.json` 引起的 |
|---|---|
| D2 | `loadConfig()` 直接读它；文件不存在 → 静默 `{}` → `LIB_ROOT=''` → 库列表为空 → 界面永远「未配置素材库」 |
| R3（取件默认必失败，见 `docs/plan/DOCS-REQUIREMENTS.md` §6） | `config.collect` 为空 → `collect.dirs = {}` → 任何 `targetDirName` 都 `COLLECT_DIR_NOT_ALLOWED` |
| 3 个跳过测试中的 2 个 | `tests/uid.test.mjs:59`、`tests/security.test.mjs:176` 都以 `config.json` 为数据源 → 永久跳过 |

#### 5.1.1 D11 的性质：**不是「UI 审美问题」，是「契约被违反 + 用户看到错误结论」**

| 面 | 事实 |
|---|---|
| 契约明文 | `docs/spec/CONTRACT-engine-v1.md:107` 注释「分数区间由共享常量定义，**界面不自己算阈值**」；`:114`「`band` 由引擎按**同一模态内**的区间给出」 |
| 引擎实际给的 | `core/engine.mjs:227` `band: bandOf(r.score, mode)` ⇒ `high` / `mid` / `low`（文本 0.72/0.65，图像 0.90/0.80，`:25-28`）。
> ⚠️ 本格曾写 `:226`，实为 **`:227`**（`:226` 是 `score:`）—— 由第②条审查的二次复核指出（`REVIEW-UIUX-AUDIT.md` §10），Lead 已更正 |
| **引擎源码注释自己写的** | `core/engine.mjs:19-20`：「契约 §2.1 明确：分数不可跨模态比大小，所以**界面只能用引擎给的 band**，不许自己拿"文本 0.78"和"图像 0.90"排序」—— **引擎把「界面该怎么做」写在自己的源码里，界面没照做**。这条由第②条审查在处置 B2 时挖出，Lead 已复读确认属实 |
| 界面实际做的 | `src/renderer/src/ui/Score.jsx:4-6` 自己判 `0.97 → same` / `0.93 → like` / 否则 `weak`；**`item.band` 全仓 0 命中** |
| **用户可见后果** | 实测文本→图像 top-1 余弦区间 **0.74–0.80**（`core/engine.mjs:22` 注释自述）⇒ **全部落进 `weak`（"较弱"）**。也就是说：**用户检索文本，所有结果都会被标成「较弱」，包括真正最匹配的那张。** 引擎判的 `high`（≥0.72）完全没被用上 |
| 与单测的关系 | `tests/engine.test.mjs` 有一条 `search(text)：命中同向条目，band 由引擎给（界面不自己算）` —— **它测的是引擎给了 band，没测界面用没用** |

> **定级：Critical（Score 3×3 = 9）** —— `影响面 3`（主信号被系统性标错，用户据此判断该不该用这张图）× `触发可能性 3`（**每一次文本检索都发生**）。
>
> ⚠️ **本行曾写「High（Score 6）」，与本文 `:115` 的「Critical 9」自相矛盾** —— 由第②条审查的独立复核发现（`docs/audit/REVIEW-UIUX-AUDIT.md` blocker B4）。
> Lead 复核后**统一为 Critical 9**，理由：① `触发可能性` 是 **3 而非 2**（不是「特定动作下发生」，是**每次文本检索必然发生**）；
> ② 判据 §3 对 Critical 的定义是「功能静默失败且用户无感」，本条完全命中 —— 用户**无从知道**「较弱」是错的；
> ③ 独立复核者用不同路径**也**算出 9/Critical。**这条自相矛盾由 Lead 负责，已更正**（记录在案，不隐藏）。
>
> 这是 Lead 的独立发现，两条宪章都没单独覆盖（①看的是栈，②看的是 UI 规范；这是**契约一致性**问题）。
> 第②条审查独立发现了同一处（编号 U-01，判 Critical 9），但**其修复方向有误** —— 见 `AUDIT-FINAL.md` §11。


> 且 `docs/plan/PRE-KICKOFF-CHECK.md:147-149`（**注意：该文件已在本次重构中删除**）仍在告诉用户「克隆后必须知道去哪配 `library_root`」——
> 而**该配置文件在本仓库已不存在**，`README.md:87` 也明说「没有配置文件了，素材库位置由库注册表管理」。
> 这是「文档三方互斥」：`README` 说没有配置文件，`PRE-KICKOFF` 说要配 `config.json`，代码在读 `config.json`。
> 登记为 **D7**。
>
> 另：`README.md:88` 说库注册表是「`core/library.mjs`」，而 `core/library.mjs` 只是**把 config 里的
> 库列表变成注册表对象**（`LibraryRegistry(config)`），**没有任何持久化**。
> 所以「库注册表管理素材库位置」这个说法目前**没有对应的持久化实现** —— 登记为 **D8**。
>
> **D8 已核实（代码自带声明）**：`core/library.mjs:137` 的注释自己写着
> 「P1 从 `config.json` 派生单库；**P5 扩为真正的多库注册表**」。
> 所以这在**代码侧是「按计划未做」**，而在**文档侧是「README 把未做说成了已做」**。
> 定性：**文档欠账，不是代码缺陷** —— 但它是 D2/R2 这条根因链的下游，
> 因为「注册表管理库位置」与「必须读 config.json」这两句话不能同时为真。

---

## 6. 索引与数据现状

| 项 | 值 | 证据 |
|---|---|---|
| 已接受索引 | `data/libraries/L1/` | `README.md:21` |
| 规模 | 3594 条 · dim 768 · float32 | `README.md:115-117` |
| 素材库 | `G:\model`（3594 图 + 3594 包，207.3 GB） | `README.md:6` · `TASK-PLAN.md:25` |
| 索引是否在本机可读 | **未核实**（`G:` 与本环境是否同一台机器需确认） | — |

> ⚠️ **本环境限制**：`data/libraries/L1/` 与 `G:\model` 的存在性、可读性，
> 以及 `npm run build` / Electron 实跑，**Lead 在本轮未全部实测**。
> 凡引用者必须标注为「引用既有证据」而非「本轮实测」。

---

## 6.1 ⚠️ 仓库自检门禁**当前是红的**（EXIT=1），Lead 实测

```powershell
node tools\verify-doc-refs.mjs
# 扫描引用 102 处
# **死引用 7 处**：…
# !! 3 份不该留在根目录：AGENTS.md, STACK-AUDIT.md, UIUX-AUDIT.md（正文应放 docs/）
# **未通过**：死引用 7 · 根目录越界 3
# EXIT=1
```

**归因（诚实拆分，不甩锅给工具也不甩锅给用户）**：

| 报警项 | 谁造成的 | 处置 |
|---|---|---|
| 死引用 7 处（→ `AUDIT-FINAL.md` / `REVIEW-*.md` / `uiux-evidence.md`） | **本轮审查自己**：先写了引用、后写文件 | ✅ **由 Lead 补齐文件后自然消解**（写 `AUDIT-FINAL.md` 与两份 REVIEW 必须发生） |
| 根目录越界：`AGENTS.md` | **用户提供的任务宪章**，不在本仓库既有白名单内 | ⚠️ **不动它**。它是用户指令，移动它会破坏任务宪章的权威位置 |
| 根目录越界：`STACK-AUDIT.md` · `UIUX-AUDIT.md` | **本轮审查**，且**位置由宪章③的验收标准第 §1 节冻结** | ⚠️ 二选一：改验收标准把它们放进 `docs/`，**或**把这个守卫的白名单扩到「审查交付物」。**按「只做审查与文档、不改代码」的口径，Lead 选择在 `AUDIT-FINAL.md` 里显式登记两者并说明取舍，不擅自改脚本也不擅自搬文件** |

> 这条本身是个有价值的发现：**仓库有一个会失败、却不在任何自动化里、也不在 README 命令清单里的守卫**。
> 换句话说，`AGENTS.md`（任务宪章）放进仓库根的那一刻，这个门禁就已经红了，而**没有任何机制会让人看到**。
> 第①条审查把它独立成 **P7（6 · High）**。

---

## 7. 审查纪律（三份报告共同遵守）

1. **不声称未验证的能力**。仓库自己立了这条规矩（`README.md:179`
   「冷启动耗时 / 打包后行为 / 真实 `thumb://` 取图 尚未验证，不要据此声称可用」），审查同样适用。
2. **每条结论带证据**：`文件:行号` 或命令 + 输出。无证据的判断标 `【判断，非实测】`。
3. **区分三种东西**：① 代码事实 ② 文档声称 ③ 行业做法。混在一起写就是耍流氓。
4. **发现与本文冲突**：以磁盘为准，并立即报告 Lead 回写本文，不得各自另立事实。

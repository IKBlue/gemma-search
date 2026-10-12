# AGENTS.md · 在这个仓库里怎么干活

> **本文件是唯一权威的「工作指南」**：目录职责 · 东西该放哪儿 · 什么算做完 · 写作纪律 · 禁止事项。
> **它不重复项目介绍。** 想知道「这是什么、现在什么状态、怎么跑起来」，读 [`README.md`](README.md)。
> 本文合并了原 `AGENTS.md`（任务宪章）与 `PROJECT-GUIDE.md`（结构总览），两者已不再单独存在。
>
> 最后核对：2026-10-12 · 对应布局：monorepo（`apps/` + `packages/`，见 [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) §1，该结构已冻结）

---

## 0. 治理宪章（所有者指令，优先级最高）

1. **技术栈 / 框架 / 目录检查**：对标行业最佳实践，检索现有插件与方案；执行过程拆成**可验证的 subtasks**，先写清验收标准，再让**独立 Agent 复核**。
2. **UI/UX 检查（Apple Style）**：同样对标行业最佳实践（指名规范与章节，不写「主流做法」），拆成可验证 subtasks + 验收标准 + 独立复核。
3. **最终 review 与文档整理**：覆盖项目需求、设计、实现、测试、部署五类文档。

**由第 1、2 条派生的常驻纪律**（对本仓库所有后续工作生效）：

- 结论必须可追溯：每条带 `文件:行号` 或「命令 + 原始输出」；无证据的写【判断，非实测】。
- 必须区分三种东西：**① 代码事实 · ② 文档声称 · ③ 行业做法**。混在一起写就是耍流氓。
- 复核者不得只读结论，必须自己跑命令、自己回原文件核对。

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
| `packages/design-tokens/tokens.css` | **视觉令牌唯一来源**（生产依赖，被 `apps/desktop/src/renderer/src/main.jsx` 直接 import） | ✅ 只在这里加令牌，不要复制第二份 | ✅ |
| `docs/` | 全部正文文档：`spec/`（约束）· `design/`（设计）· `guide/`（上手/排障）· `plan/`（做什么、什么顺序）· `audit/`（审查产物）· `archive/`（**已失效的东西全放这里**） | ✅ 见 §6 纪律 | ✅ |
| `tools/` | 7 个只读守卫 + `probe_electron_start/`（Electron 起不来的最小探针） | ✅ 改完自己先跑一遍 | ✅ |
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

**约定**：仓库根**只放** `AGENTS.md` + `README.md` 两份 `.md`（`tools/verify-doc-refs.mjs` 的第 2 项会检查这一点）。
本轮审查的三份汇总报告在 `docs/audit/`（`AUDIT-FINAL.md` · `STACK-AUDIT.md` · `UIUX-AUDIT.md`）。

---

## 3. 新东西该放哪儿（最实用的一节）

| 你要加的东西 | 放哪儿 | 注意 |
|---|---|---|
| 界面页面 / 组件 | `apps/desktop/src/renderer/src/`（页面进 `pages/`，通用组件进 `ui/`，布局进 `layout/`，hooks 进 `hooks/`） | 样式写**手写 CSS**（`renderer.css`），不引入 Tailwind 类名 |
| 引擎能力 | `packages/engine/src/` + 对应测试放 `packages/engine/tests/` | **必须保持零第三方依赖**，且不得 import `electron` / `http` |
| 契约 / 新 IPC 方法 | `apps/desktop/src/shared/ipc.mjs` | ⚠️ **唯一来源**。改完必须同步 `apps/desktop/src/preload/index.js`（那里是**手抄的字面量**，不是 import）与 `docs/spec/CONTRACT-engine-v1.md` |
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
| 在这个仓库里怎么干活（本文件） | `AGENTS.md` |
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
| 还欠什么 | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 本次 monorepo 重构怎么执行 | [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) |
| 现状事实基线（审查用） | [`docs/audit/00-current-state.md`](docs/audit/00-current-state.md) |
| 门禁证据协议 | [`reports/README.md`](reports/README.md) |
| 模型前缀 / seq / 精度上限的依据 | [`reference/MODEL_CARD.md`](reference/MODEL_CARD.md) |

---

## 5. 门禁与验收

### 5.1 期望值（对不上就是没做完）

| 门禁 | 期望 |
|---|---|
| `npm test` | `tests 68 · pass 65 · fail 0 · skipped 3` |
| `npm run build` | 成功，且 `out/main` · `out/preload` · `out/renderer` 三端齐备（**受限沙箱内不可能成功**，见下） |
| 守卫 | 下表 EXIT=0（`verify-doc-refs.mjs` 的**两类已知误报**除外 —— 外部 URL 末段 5 条 + 散文里裸写的文档名 1 条，见 §6；根目录越界必须为 0） |
| 证据 | 每条被声称通过的 G-* 门禁，在 `reports/` 里都有归档证据 |

**3 个跳过的原因（如实记录，不要当成通过）**：

1. 本环境无法创建文件符号链接（`EPERM`）→ 符号链接拒绝用例跳过。
2. 与 3. 两项依赖 `config.json` / `data/baseline-v1.json` 作为数据源。**`baseline-v1.json` 在库里**（`git ls-files data/baseline-v1.json` 有值，实测），**真正缺的只有 `config.json`**（不存在、也未被 git 跟踪）。
   ⚠️ 所以这两项**不是永久性死引用** —— 缺的是**一个可提供的文件**，D2（见 §7）被处置后即可复活。
   复活还需**索引记录的库根在本机存在**，否则会以另一条原因继续跳过：`packages/engine/tests/security.test.mjs:193`「无记录值或库不存在」、`packages/engine/tests/uid.test.mjs:73`「素材库不存在」。
   在 D2 解决前它们会一直跳过：**不要当成通过**，也**不要**误记成「测试坏了」。

**另一条环境限制（与上面第 1 条并列，不是产品缺陷）**

`npm run build` 在受限沙箱（例如某些 CI / 容器）内**会失败**，且**失败点在加载配置之前**：

```text
failed to load config from electron.vite.config.mjs
error during build: Error: spawn EPERM
    at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)
    at bundleConfigFile (node_modules/electron-vite/dist/chunks/lib.js:1710:26)
```

根因：esbuild 用 **piped stdio spawn 一个常驻服务进程**，该沙箱不允许 —— **这是环境限制，不是配置或代码问题**（连配置文件都还没加载到）。

- 因此 `verify_app_build.mjs` / `verify_renderer_dom.mjs` / `smoke_app.mjs` 这三条**依赖 `out/`** 的检查，
  **必须在普通终端跑过一次 `npm run build` 之后**才有意义。
- 截至本次重构 `out/` **不存在**（P1 之前的过期产物已删除，免得守卫校验旧产物得出误导结论）
  ⇒ **这三条在受限环境内未获判定**：如实记为**未验证**，**不要当作通过**，也不要记成「重构把构建改坏了」。

### 5.2 七个守卫（全部只读）

| 守卫 | 断言什么 | 前置条件 |
|---|---|---|
| `node tools/verify_app_build.mjs` | 产物形状：ESM/CJS、依赖 external、相对路径、原生模块未内联 | 先 `npm run build` |
| `node tools/verify_renderer_dom.mjs` | React 渲染层在 jsdom 里**真跑**：启动 / 文字检索 / 以图搜图 / 结果卡 / 事件 | 先 `npm run build` |
| `node tools/verify_renderer_styles.mjs` | 渲染层样式与令牌一致性。**注意它的方向性**：只校验「用到的令牌都已定义」，**不查「定义了但没人用」** | 无 |
| `node tools/verify_encoder_path.mjs --model <ONNX 模型目录>` | 编码路径一致性（跑真实推理） | 本机有 ONNX 模型目录 |
| `node tools/smoke_app.mjs` | 应用冒烟：真启动构建产物并给判定（退出码 0/1/2/3/4 分档） | 先 `npm run build`；受限环境加 `--no-sandbox` |
| `node tools/check_search.mjs` | 检索端到端自查（向量模式，走引擎真实检索路径） | 已有查询向量与已注册索引 |
| `node tools/verify-doc-refs.mjs` | 全仓 `.md` 引用解算 + 根目录越界检查 | 无 |

> 守卫**证明不了**的事情，不要当成证明了：DOM 守卫不证明 CSS 生效、`thumb://` 真能取到图、真实 IPC 或真实窗口（它自己在注释里写明了）；样式守卫只查一个方向。

### 5.3 两条硬规则

1. **无归档证据 = 门禁未通过。** 结论要落到 `reports/G-<字母>-<日期>/`，否则不算。
2. **`reports/` 里的 G-B 索引质量判据已不可复跑**（`tools/quality/` 随 Python 档退役被删）→ 那些证据是**存档**，不能独立重算。引用时必须写明这一点，不得声称「本轮实测」。

---

## 6. 写作纪律

```powershell
node tools\verify-doc-refs.mjs      # 全仓 .md 引用解算 + 根目录越界检查（只读）
```

- **正文文档放 `docs/`**（spec / design / guide / plan / audit）；**仓库根只留 `AGENTS.md` + `README.md`**。
- **引用写「仓库根相对」路径**（`docs/spec/SPEC-app.md`），不要写 `../`——引用散落在不同深度，`../` 会随深度变化，根相对写法全局一致。
- **改文档后跑守卫**；新增的死引用自己清掉。
- **已知误报有两类**（当前 6 条死引用全属这两类，都在 `docs/audit/`，**不计入你的账**，但也不要新增）：
  - **① 外部 URL 的末段**（5 条）：URL 路径以 `xxx.md` 结尾的镜像文件 —— `docs/audit/uiux-evidence.md:624-627` 的 `color.md` / `materials.md` / `typography.md` 与那条 jsDelivr 路径；
  - **② 中文散文里裸写的文档名**（1 条）：`docs/audit/REVIEW-UIUX-AUDIT.md:432` 的 `materials.md` —— **既不在 URL 里，也不在行内代码里**，只是正文里提到了一个形如文档名的词。
  > 守卫只做「形如 `.md` 的引用解算」，**不区分这两者**。**先分类再归因**，否则下一位审查者会漏掉第 ② 类（它不在 URL 里，按"外部 URL 误报"一句话就盖过去了）。

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

- **不写素材库。** 检索、缩略图、`scan` 等只读操作在文件系统上**零写入**；写入素材库只允许走 `docs/spec/SPEC-transactions.md` 的四步纪律（且当前 `ingest`/`mutate` 尚未实现）。
- **不把本机绝对路径写进代码或文档**（如 `G:\model`）。库位置由配置提供；文档里的示例路径要标明是示例。
- **不在 `packages/engine/` 里 import `electron` 或 `http`**（「传输无关」的可执行判据，单测会拦）。
- **不让渲染进程拿到 `ipcRenderer` 或任意绝对路径入参**；路径只能由 `libId + uid` 解析。
- **不声称嵌入模型「看得出图里是什么」**——它只产出向量。
- **不自动 `git commit` / `push`**，除非所有者明确要求。
- **不把 `--no-sandbox` 固化进产品**（它只是受限环境的降级开关）。

**已知边界（如实写明，不得含糊）**

| 边界 | 事实 |
|---|---|
| **未验证的能力** | **冷启动耗时 · 打包后行为 · 真实 `thumb://` 取图** 均**尚未验证**。任何文档、报告、提交信息都不得据此声称可用。 |
| 受限沙箱 | Chromium 进程沙箱起不来时 Electron 会**秒退且一行日志都不生成**；此时用 `npm run dev:restricted` / `npm run start:restricted`（= 附加 `--no-sandbox`）。**普通终端不需要**。 |
| 生产态 DevTools | 生产态保留 `devTools: true` 是**已决策项**（`docs/spec/SPEC-security.md` §9 决定 3），不是疏漏。 |
| 日志 | 主进程与渲染进程的诊断都写 `data\_app.log`。Windows 上 Electron 是 GUI 子系统程序，**stdout 不连终端**，`console.log` 一条都看不到。 |
| **D2 · 库根配置缺口** | 主进程仍从 `config.json`（或 `GEMMA_CONFIG`）读库根，而**该文件已不在仓库里，也没有模板**；找不到时静默用空库 → 开箱即跑不出检索结果（界面只会得到 `LIB_NOT_FOUND`）。**未修**，处置属代码线，不要用「再写一份 config 教学」搪塞。 |
| **D8 · 多库注册表未持久化** | 现在只有「从配置派生单库」（`packages/engine/src/library.mjs`）；**真正的多库注册表是 P5，未实现**，没有任何持久化。 |
| **F-01 · `reveal` 未接线** | 主进程**从未注入 `shell` 端口**，引擎在无 `shell` 时仍返回 `ok({revealed:true})`（**静默假成功**；单测是绿的，因为测试自己注入了那个端口）。要求见 `docs/spec/CONTRACT-engine-v1.md` §2.4。 |
| 未实现的契约方法 | `ingest` / `mutate` / `indexStart` / `indexCancel` 由主进程**显式拒绝**（P4/P5 欠账），契约先冻结了形状。见 `docs/spec/CONTRACT-engine-v1.md` §2.5–§2.10。 |
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
| **守卫 (guard)** | `tools/` 下 7 个只读校验脚本，跑完给 EXIT 码 |
| **主进程 / 渲染进程** | 主进程管窗口与磁盘；渲染进程就是那个网页界面。两者严格隔离 |
| **preload / 安全桥** | 界面唯一能用的通道（只暴露 `invoke` / `onEvent` / `platform`），别的够不着 |
| **IPC** | 主进程与渲染进程之间的受控通信（本项目 2 个通道、11 个方法白名单） |
| **`thumb://`** | 缩略图自定义协议，形状**只允许** `thumb://<libId>/<uid>@<size>`——路径不由 URL 提供 |
| **配对 (pairing)** | 靠文件名主干相同，把 `ID-123.jpg` 与 `ID-123.rar` 认成一套素材；索引里**显式存了两个绝对路径** |
| **uid** | `sha1(lib_id\|rel_dir\|stem)[:12]`，12 位 hex，**已冻结** |
| **`compat`** | 兼容性判定键（8 项，不含 device/GPU）。只有 `compat` 相等的库才能合并检索 |
| **`band`** | 引擎按**同一模态内**区间给出的分数档（`high`/`mid`/`low`）。**界面不得自己算阈值，也不得跨模态比分数** |
| **`seq`** | 图像 soft token 预算（70/140/280）。是唯一的提速杠杆，**换档必须全量重建索引** |
| **设计令牌 (token)** | 颜色/字体/间距等视觉常量，唯一来源 `packages/design-tokens/tokens.css` |
| **ONNX / WebGPU** | 模型的通用交换格式 / 让浏览器直接用显卡算的技术；WebGPU 不可用时回落 CPU |
| **monorepo / workspaces** | 一个仓库多个包：`apps/*` + `packages/*`，用 npm workspaces 声明；**包之间用相对路径 import，不用包名解析** |

---

*本文件与磁盘不一致时，先修结构或代码，再回来改本文件——不要在两处各写一半。*

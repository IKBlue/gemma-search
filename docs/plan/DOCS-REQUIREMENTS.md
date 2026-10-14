# 项目需求说明（Requirements）

> **状态**：现行 · **最后核对**：2026-10-12
> **权威范围**：需求收敛与**实现状态标注**（哪些已实现、哪些没有）。它**不定义**需求与阈值。
>
> **本文定位**：把散落在 `docs/plan/ROADMAP.md`（决策与阶段）、`docs/spec/SPEC-app.md`（成功标准）、
> `docs/spec/SPEC-acceptance.md`（阈值）里的**需求**收敛到一处，并标注**哪些已实现、哪些没有**。
>
> **权威关系不变**：阈值仍以 `docs/spec/SPEC-acceptance.md` 为准，阶段顺序仍以 `docs/plan/ROADMAP.md` 为准。
> 本文若与它们冲突，**以它们为准**并回来修本文。
>
> **事实基准**：`docs/audit/00-current-state.md`（Lead 按磁盘核对）。

---

## 1. 一句话需求

> 把 `G:\model` 这个本地素材库变成一个**离线可用**的桌面工具：
> **用一句话找得到那张图，并且能直接把它的同名模型压缩包取出来。**

不做的事（明确边界）：不联网、不上传、不做内容识别、不解析压缩包内容、不真删除文件。

---

## 2. 干系人与使用场景

| 项 | 内容 | 来源 |
|---|---|---|
| 用户 | 本人（素材收集者，Windows） | `docs/plan/ROADMAP.md` §0 |
| 是否分发 | **是** —— 要分发到别的机器 | 决策 2 |
| 因此的前提 | 安装器**不含**模型与索引；模型首次获取；干净机器验收 | `docs/plan/ROADMAP.md` §0 |
| 素材库 | `G:\model`：3594 预览图 + 3594 压缩包，207.3 GB | `docs/plan/ROADMAP.md` §0 |
| 包格式分布 | `.rar` 2329 / `.zip` 1189 / `.7z` 76 | `docs/plan/ROADMAP.md` §0 |

**核心场景（按重要性）**

| # | 场景 | 用户动作 | 期望结果 |
|---|---|---|---|
| S1 | 找图 | 输入中文描述（如「现代简约布艺沙发」）→ 回车 | 网格里出现按相似度排序的缩略图 |
| S2 | 取包 | 对某条结果点「定位」或「取件」 | 资源管理器定位到 `.rar`，或复制到 `E:\素材待用\` |
| S3 | 以图搜图 | 选一张参考图 → 搜索 | 与 S1 同构 |
| S4 | 入库 | 把库外新素材放进来 | 立即可检索，且可撤销 |
| S5 | 管多库 | 注册第二个库 | 跨库检索只合并 `compat` 一致的库 |

---

## 3. 成功标准（9 条，逐条可测）

> 原文：`docs/plan/ROADMAP.md` §1。完整定义：`docs/spec/SPEC-app.md` §9。
> **不要在这里改标准，改规格。**

| # | 标准 | 验收方式 | **当前实现状态** |
|---|---|---|---|
| 1 | 双击启动 ≤ **5 秒**出可用窗口 | 打包环境计时 | ⚠️ 未验证（未打包） |
| 1b | 模型载入中搜索 → **排队**并提示，不静默失败 | P3b 验收 | ❌ 未实现（`useSearch` 只显示「首次会载入模型，约 3 秒」文案，无排队语义） |
| 2 | 文本查询（热）P50 ≤ 80 ms / P95 ≤ 150 ms；图像查询（热）P50 ≤ 1.0 s / P95 ≤ 1.5 s | `SPEC-acceptance.md` §3 计时边界 | ⚠️ 未按该口径实测 |
| 3 | 结果以缩略图网格呈现，应用内可见 | 缩略图零 404 | ⚠️ 代码齐备（`thumb://`），**真实取图未验证** |
| 4 | 任一条可一键在资源管理器**定位**其压缩包 | 人工确认 | ❌ **代码走通但无效** —— 见 §6 缺陷 R1 |
| 5 | 可把包**复制**到指定目录（默认 `E:\素材待用\`） | 人工确认 | ⚠️ 引擎已实现且有空间预检；`collect.dirs` 白名单未配置 → 默认必失败 |
| 6 | 能**入库**新素材并索引；能管**增量** | 入库后立即可检索 | ❌ `ingest` 被主进程显式拒绝 |
| 7 | 增删查改齐备；「删」只提供**移出库**（可还原） | 从 `E:\移出素材\` 原样还原 | ❌ `mutate` 被主进程显式拒绝 |
| 8 | 支持**多库**；跨库检索只合并 `compat` 一致的库 | 故意注册 seq 不一致的库 | ⚠️ 引擎已实现 `pickCompatible`；**界面仍无入口**（库配置目前只能加库，没有"注册第二个库并在界面上切/看理由"的流程 —— 那是 P5）。配置来源本身已修（R2 ✅） |
| 9 | **断网可用**；对素材库的写入只经入库/事务流程 | 断网全功能；扫描前后库指纹一致 | ⚠️ 索引/检索路径无网络调用；**未做断网实测** |

**一句话**：9 条里 **0 条已完整验收**，其中 **4 条代码层面就不可用**（1b / 4 / 6 / 7）。

---

## 4. 非功能需求

| 类别 | 要求 | 依据 | 状态 |
|---|---|---|---|
| **离线** | 不联网、不上传、不调云服务 | `README.md`（离线声明） | ✅ CSP 无远程源；索引/检索只用本机 |
| **只读素材库** | 检索不写库；写入只经入库/事务 | 决策 5 | ✅ 检索路径只读 |
| **安全** | IPC 方法白名单 + zod；窗口三隔离；`thumb://` 形状受限 | `docs/spec/SPEC-security.md` | ✅ 详见「实现说明」§安全 |
| **可测** | 引擎必须能脱离 Electron 被单测 | `AGENTS.md` §4（目录职责） | ✅ 68 引擎测（+ 12 桌面配置测），注入假编码器 |
| **可换外壳** | `packages/engine/src/` 零依赖、传输无关 | 同上 | ✅ 且有守卫 |
| **可移植** | 代码里不写死本机路径 | `AGENTS.md` §7.2（边界口径） | ⚠️ 索引 `items.json` 仍存 `absPath`/`archiveAbsPath`（派生数据，但会失效） |
| **分发** | 安装器不含模型与索引 | 决策 2 | ❌ P6 未做 |
| **许可** | MIT + 模型 Apache-2.0 说明 | 根 `LICENSE` | ⚠️ **待所有者最终确认** |

---

## 5. 已锁定的决策（12 + 4，不再重开）

> 原文：`docs/plan/ROADMAP.md` §2。此处只列**与本轮审查结论直接相关**的几条。

| # | 决策 | 对本轮审查的含义 |
|---|---|---|
| 3 | 后端 Node + ONNX + WebGPU，不要 Python | ✅ 已达成：0 个 Python 文件 |
| 4 | 精度 fp32 + `image_seq_length = 140` | ✅ 索引 `meta.json` 实测 `preprocessing_version:2` · `seq_length:140` · `model_weights_dtype:fp32` |
| 5 | **允许直接写 `G:\model`**，但必须走四步写入纪律 | ⚠️ 写入流程（P4）尚未实现，所以这条目前无实际风险 |
| 6 | 不做自动分类；默认进 `未分类\` | ✅ 索引实测 folder 分布：`VR 2809 / CR 630 / CR+VR 78 / 其他 77`，**无 `未分类`**（尚未入库过） |
| 9 | 索引存**应用数据目录** | ✅ `data/libraries/L1/` |
| 11 | 传输层用 **IPC**；REST 推迟 | ✅ 只开 2 个通道 |
| 12 | 旧档（HTTP + MCP）最后才退役 | ⚠️ **已提前执行**（`4555c1b`），代价见 `docs/DEBT-CLEANUP.md` §十二 |

---

## 6. 需求 vs 实现：四个真实缺口（Lead 已核对）

| ID | 缺陷 | 证据 | 用户可见后果 |
|---|---|---|---|
| **R1** | **「定位」按钮是死的**：`packages/engine/src/engine.mjs:434` 只在 `shell` 存在时调 `shell.reveal()`，但 `apps/desktop/src/main/index.mjs:118-126` **从未把 `shell` 传给 `createEngine`**；不满足条件也 `return ok({ revealed:true })` | `packages/engine/src/engine.mjs:427-436` vs `apps/desktop/src/main/index.mjs:118`；`grep -n shell src/main/index.mjs` **0 命中** | 界面弹「已在资源管理器中定位」，**资源管理器什么都不发生** |
| ~~**R2**~~ | ~~**配置来源已断**：`loadConfig()` 读 `config.json`~~ | ✅ **已修（D2，2026-10-12）**：四路解析（`GEMMA_LIB_ROOT` > `userData/library-registry.json` > `config.json` > **索引自举**）+ 无库时首启向导；实现 `apps/desktop/src/main/library-config.mjs`，测试 `apps/desktop/tests/library-config.test.mjs`（12 条） | ✅ **已修** |
| ~~**R3**~~ | ~~**取件默认必失败**：`collect.dirs` 白名单为空~~ | ✅ **已修（F-04）**：默认 `{素材待用:'E:\素材待用', 移出素材:'E:\移出素材'}`，可由注册表覆盖 | ✅ **已修** |
| **R4** | **4 个功能未实现**：`ingest` / `mutate` / `indexStart` / `indexCancel` 被主进程显式拒绝 | `apps/desktop/src/main/index.mjs:191-195` | 满足成功标准 6（入库）与 7（CRUD）的功能点不存在；界面按钮点了只弹 toast |

> R1 的性质最严重：**它不是「没实现」，而是「实现了但静默谎报成功」**。
> 按验收标准 §3 口径：安全/正确性类缺陷至少 High；「静默假成功」应评 **High**。

---

## 7. 需求追踪矩阵（需求 → 代码 → 验收）

| 需求 | 实现位置 | 测试覆盖 | 验收证据 |
|---|---|---|---|
| 文本检索 | `packages/engine/src/engine.mjs` `doSearch` | ✅ `packages/engine/tests/engine.test.mjs` | ⚠️ 无端到端真实模型证据 |
| 图像检索 | 同上（3 种来源） | ✅ | ⚠️ 同上 |
| 缩略图 | `apps/desktop/src/main/index.mjs` `handleThumb` | ❌ **无测试** | ⚠️ 无真实取图证据 |
| 定位 | `engine.reveal` | ✅ 单测（`packages/engine/tests/engine.test.mjs` 含 `REVEALED`） | ❌ **实际无效**（R1） |
| 取件 | `engine.collect` | ✅ 含空间预检 / EXCL 不覆盖 | ⚠️ 默认配置必失败（R3） |
| 索引状态 | `engine.indexStatus` | ✅ | — |
| 差分扫描 | `engine.doScan` | ✅ | — |
| 入库 / CRUD | ❌ 无 | ❌ | ❌ |
| IPC 白名单 | `apps/desktop/src/shared/ipc.ts` | ✅ `packages/engine/tests/security.test.mjs` | — |
| 库注册表 | `packages/engine/src/library.mjs` | ✅ | — |
| 库指纹 | `packages/engine/src/fingerprint.mjs` | ✅ | ⚠️ 跨语言一致性测试**跳过**（缺 `baseline-v1.json`） |

---

## 8. 「无归档证据 = 门禁未通过」

项目自定规则（`AGENTS.md` §3 规范 1）。当前门禁状态：

| 门禁 | 状态 | 证据 |
|---|---|---|
| G-A 基线复核 | ✅ 5/5 | `data/baseline-v1.json` |
| G-B 索引质量 v1 | ❌ **FAIL** | `reports/G-B-20261010/` |
| G-B 索引质量 v2 | ✅ **PASS** | `reports/G-B-20261010-v2/`（⚠️ **判据已不可复跑**，`tools/quality/` 已删） |
| G-C 契约冻结 | — | `docs/spec/CONTRACT-engine-v1.md` 已成文 |
| G-D P2 应用实跑 | ✅ | `reports/G-D-p2-electron/` |
| **G-E 应用验收** | ❌ 未做 | 需 P3–P6 完成 |

---

## 9. 本文未覆盖

- 逐条需求的**性能数字**（标准 2）本环境无 GPU + 无模型目录，未实测。
- `E:\素材待用\` / `E:\移出素材\` 目标盘在**本环境是否存在**未核实。
- 标准 9「断网可用」未做真断网实测。
- 决策 1–2、7–8、10 的**用户侧影响**未在本文件展开（见 `docs/plan/ROADMAP.md` §2 原文）。

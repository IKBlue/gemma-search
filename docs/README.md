# docs/ · 文档索引与权威关系

> 全部正文文档都在本目录下。**入口在仓库根**：[`README.md`](README.md)（项目是什么、什么状态、怎么跑）
> · [`AGENTS.md`](AGENTS.md)（在这个仓库里怎么干活）。
> 本文回答：**有哪些文档 · 谁指向谁 · 哪件事以谁为准 · 怎么加新文档**。

最后核对：2026-10-12

---

## 1. 目录地图

```
仓库根（只留两份 .md）
├── README.md            项目是什么 · 现在什么状态 · 怎么跑 · 已知边界
└── AGENTS.md            ★ 唯一权威「工作指南」：目录职责、放置规则、权威关系、门禁、写作纪律

docs/
├── README.md            ← 本文：索引 + 权威关系
├── MIGRATION-PLAN.md    本次 monorepo 重构的执行依据（目录结构已冻结）
├── DEBT-CLEANUP.md      债务账本：清了什么、还欠什么
├── spec/                约束（"必须怎样"）
│   ├── SPEC-app.md                 应用规格：目标、成功标准、技术栈、边界
│   ├── SPEC-identity.md            身份与配对：uid、文件身份、库指纹、索引格式
│   ├── SPEC-security.md            威胁模型、IPC 白名单、**明确不防的边界**
│   ├── SPEC-transactions.md        文件事务与崩溃恢复（规格已成文，实现未开始）
│   ├── SPEC-acceptance.md          验收与口径（**阈值唯一出处**）
│   └── CONTRACT-engine-v1.md       引擎接口契约：19 错误码 + 10 方法
├── design/              设计（"做成什么样"）
│   ├── DESIGN-tokens.md            ★ 视觉令牌唯一来源（可执行版 packages/design-tokens/tokens.css）
│   ├── DESIGN-app-details.md       详细设计：UI、库管理、索引、入库
│   └── UI-REVIEW-and-migration.md  UI 评审与迁移路线（**UI 以它为准**）
├── guide/               上手与排障
│   ├── GETTING-STARTED.md          从克隆到跑起来
│   └── TROUBLESHOOTING.md          常见故障与判读
├── plan/                计划与阶段文档
│   ├── ROADMAP.md                  ★ 唯一行动依据：阶段、门禁、交付物、风险
│   └── DOCS-*.md                   需求/设计/实现/测试/部署五份阶段说明
├── audit/               本轮审查产物（事实与判据）
│   ├── README.md                   审查区导航
│   ├── 00-current-state.md         ★ 现状事实基线（只有 Lead 能改）
│   ├── 01-acceptance-criteria.md   冻结的验收标准：G1-G7 · 严重度口径 · S1-S10 / U1-U10
│   ├── stack-evidence.md · uiux-evidence.md         两份报告的原始证据附录
│   ├── REVIEW-STACK-AUDIT.md · REVIEW-UIUX-AUDIT.md 独立复核记录
│   └── STACK-AUDIT.md · UIUX-AUDIT.md · AUDIT-FINAL.md  三份汇总报告（技术栈 / UIUX / 最终 review）
└── archive/             已失效/历史（**不再是依据**）
    ├── legacy/          旧计划、旧应用外壳、原 PROJECT-GUIDE（已并入 AGENTS.md）
    ├── prototype/       原型套件（tokens.css 已提升为生产资产，不在此处）
    └── spike/           当初技术路线选型的证据
```

**不在 `docs/` 的文档**（各有归属，故意不搬）：

| 位置 | 是什么 |
|---|---|
| `reference/MODEL_CARD.md` | 官方模型卡（外部资料，只读引用） |
| `reports/README.md` | 门禁证据协议（与证据同处，见 §4） |
| `apps/desktop/src/README.md` · `apps/desktop/src/renderer/README.md` | 应用主体的就地说明（改代码前先读） |
| `tools/probe_electron_start/` | Electron 起不来时的最小探针 + 判读表 |

> 仓库根**只有** `AGENTS.md` + `README.md` 两份 `.md`。⚠️ **2026-10-13 起没有守卫强制这一条了**
> （原由 `tools/verify-doc-refs.mjs` 的第 2 项检查，该守卫已移除），只能靠人看。本轮审查的三份汇总报告已经归位到 `docs/audit/`。

---

## 2. 权威关系（同一件事只有一个出处）

发现两处不一致：**改错的那处**，不要在两处各改一半。完整表（含"怎么干活"类）见 [`AGENTS.md`](AGENTS.md) §4。

| 这件事 | 以谁为准 |
|---|---|
| 项目是什么 / 什么状态 / 怎么跑 | [`README.md`](../README.md) |
| **现在还有什么没做完 / 什么坏了** | [`TODO.md`](../TODO.md)（仓库根） |
| 怎么干活（目录职责、放置、门禁、写作纪律） | [`AGENTS.md`](AGENTS.md) |
| 顺序与进度（做什么、什么顺序、什么算做完） | [`plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用技术栈与目录结构 | [`spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口形状（方法 / 错误码 / 事件 / 恢复） | [`spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 索引元数据 / 身份 / 配对 / 指纹 | [`spec/SPEC-identity.md`](docs/spec/SPEC-identity.md) |
| 事务 / 撤销 / 并发 | [`spec/SPEC-transactions.md`](docs/spec/SPEC-transactions.md) |
| **验收阈值 / 性能口径 / 门禁** | [`spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 传输层与外壳安全 | [`spec/SPEC-security.md`](docs/spec/SPEC-security.md) |
| **UI / UX** | [`design/UI-REVIEW-and-migration.md`](docs/design/UI-REVIEW-and-migration.md)（摘要见 `DESIGN-app-details.md` §一） |
| **视觉令牌** | [`design/DESIGN-tokens.md`](docs/design/DESIGN-tokens.md)（可执行版 = `packages/design-tokens/tokens.css`） |
| 还欠什么 | [`DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 本次重构怎么执行（目录结构已冻结） | [`MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) |
| 现状事实（审查基线） | [`audit/00-current-state.md`](docs/audit/00-current-state.md) |
| 本次审查的判据 | [`audit/01-acceptance-criteria.md`](docs/audit/01-acceptance-criteria.md) |
| 本次审查的结论与缺口优先级（最终 review） | [`audit/AUDIT-FINAL.md`](docs/audit/AUDIT-FINAL.md) |
| 门禁证据协议 | [`reports/README.md`](reports/README.md) |

---

## 3. 阶段文档（`plan/DOCS-*.md`）的性质

`DOCS-REQUIREMENTS.md` · `DOCS-DESIGN.md` · `DOCS-IMPLEMENTATION.md` · `DOCS-TESTING.md` · `DOCS-DEPLOYMENT.md`
按软件工程阶段组织（需求 / 设计 / 实现 / 测试 / 部署），性质是**收敛与索引**，不取代上面 §2 的权威文档：

- 阈值仍以 [`spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) 为准；
- 顺序仍以 [`plan/ROADMAP.md`](docs/plan/ROADMAP.md) 为准。

**冲突时以上述两份为准，并回来修阶段文档。**

---

## 4. 门禁证据

**项目规则：无归档证据 = 门禁未通过。** 证据一律在 `reports/G-<字母>-<日期>/`，命名与协议见 [`reports/README.md`](reports/README.md)。

| 目录 | 门禁 |
|---|---|
| `reports/G-B-20261010/` | 索引质量 v1 —— **判 FAIL**（重采样实现有问题） |
| `reports/G-B-20261010-v2/` | 索引质量 v2 —— **判 PASS**（修后全量重建） |
| `reports/G-D-p2-electron/` | P2 应用实跑（Electron 出窗 + React + WebGPU） |

> ⚠️ **G-B 判据已不可复跑**：`tools/quality/` 随 Python 档退役被删。
> 上面的证据从此是**存档**，不能独立重算——引用时不得写成「本轮实测」。

---

## 5. 改文档时的纪律（完整版见 `AGENTS.md` §6）

```powershell
```

- **正文文档放 `docs/`**；仓库根只留 `AGENTS.md` + `README.md`。
- **引用写「仓库根相对」路径**（`docs/spec/SPEC-app.md`），不要写 `../`——引用散落在不同深度，根相对写法全局一致。
- **改完跑一遍守卫**；新增的死引用自己清掉。
- **别用 `Get-Content` 定位行号**：PowerShell 5.1 按 GBK 解码 UTF-8 中文，多字节字符被拆坏并**合并行**。
  实测（2026-10-12）：`design/DESIGN-tokens.md` 被数成 245 行、实际 **292** 行；`spec/SPEC-acceptance.md` 被数成 259 行、实际 **347** 行。
  用 `read` 工具或 node。
- **已知误报有两类**（守卫只做「形如 `.md` 的引用解算」，**不区分这两者**；**先分类再归因**，否则会漏掉第 ② 类）：
  ① **外部 URL 的末段** —— 镜像文件名，如 `docs/audit/uiux-evidence.md:624-627` 的 `color.md` / `materials.md` / `typography.md` 与那条 jsDelivr 路径；
  ② **中文散文里裸写的文档名** —— 既不在 URL、也不在行内代码里，如 `docs/audit/REVIEW-UIUX-AUDIT.md:432` 的 `materials.md`。
  这两类**不计入你的账**，但别新增。

---

## 6. 归档区的意思是「不再是依据」

`docs/archive/` 下的所有内容（`legacy/` · `prototype/` · `spike/`）都是**历史证据**：它记录"当初为什么这么选""旧东西长什么样"，**不是现状、不是依据**。

- 别删（git 历史虽可回溯，但它们是决策依据）；
- 别再往里加新东西，也别让现行文档依赖它们；
- 唯一例外已处置：`tokens.css` 曾住在原型目录，现已是**正式生产资产** `packages/design-tokens/tokens.css`（见 [`design/DESIGN-tokens.md`](docs/design/DESIGN-tokens.md)）。

# 文档索引与权威关系

> 这里是全部正文文档的索引。**入口在仓库根**：
> [`../README.md`](../README.md)（技术版）· [`../PROJECT-GUIDE.md`](../PROJECT-GUIDE.md)（零基础结构总览）
> · [`../TASK-PLAN.md`](../TASK-PLAN.md)（⭐ 唯一行动依据）。

---

## 1. 文档在哪

```
仓库根（只留入口 + 行动依据）
├── README.md            技术总览：当前状态、命令、代价
├── PROJECT-GUIDE.md     零基础结构总览：框架图、目录职责、新文件该放哪儿
└── TASK-PLAN.md         ⭐ 唯一行动依据：阶段 P0–P7、门禁、交付物

docs/
├── README.md            ← 本文：索引 + 权威关系
├── DEBT-CLEANUP.md      债务账本：清了什么、还欠什么
├── plan/
│   └── PRE-KICKOFF-CHECK.md       立项前检查清单
├── spec/
│   ├── SPEC-app.md                应用规格：目标、成功标准、技术栈、边界
│   ├── SPEC-identity.md           身份与配对：uid、文件身份、库指纹、索引格式
│   ├── SPEC-security.md           威胁模型、IPC 白名单、明确不防的边界
│   ├── SPEC-transactions.md       文件事务与崩溃恢复
│   ├── SPEC-acceptance.md         验收与口径（**阈值唯一出处**）
│   └── CONTRACT-engine-v1.md      引擎接口契约：19 错误码 + 10 方法
└── design/
    ├── DESIGN-tokens.md           ⭐ 视觉唯一来源（可执行版 static/prototype/tokens.css）
    ├── DESIGN-app-details.md      详细设计：UI、库管理、索引、入库
    └── UI-REVIEW-and-migration.md UI 评审与迁移路线
```

**不在 docs/ 的文档**（各有归属，故意不搬）：

| 位置 | 是什么 |
|---|---|
| `../reference/MODEL_CARD.md` | 官方模型卡（外部资料，只读引用） |
| `../reports/README.md` | 门禁证据协议（与证据同处，见 §3） |
| `../src/README.md` · `../src/renderer/README.md` | 应用主体的就地说明 |
| `../spike/README.md` | 路线决策证据的说明 |
| `../archive/` | 被取代的旧计划与旧应用外壳（**不再是依据**） |

---

## 2. 权威关系（避免同一件事两处说法不一致）

| 这件事 | 以谁为准 |
|---|---|
| **顺序与进度** | `../TASK-PLAN.md` |
| 应用技术栈与目录结构 | `spec/SPEC-app.md` |
| 传输层与外壳安全（IPC / `thumb://` / 渲染进程姿态 / 权限用例） | `spec/SPEC-security.md` |
| 引擎接口形状（方法 / 错误码 / 事件 / 恢复） | `spec/CONTRACT-engine-v1.md` |
| 索引元数据 / 身份 / 配对 / 指纹 | `spec/SPEC-identity.md` |
| 事务 / 撤销 / 并发 | `spec/SPEC-transactions.md` |
| **验收阈值 / 性能口径 / 门禁** | `spec/SPEC-acceptance.md` |
| **UI** | `design/UI-REVIEW-and-migration.md`（`design/DESIGN-app-details.md` §一 是摘要） |
| **视觉令牌** | `design/DESIGN-tokens.md`（可执行版本 `../static/prototype/tokens.css`） |
| 还欠什么 | `DEBT-CLEANUP.md` |

---

## 3. 门禁证据

**项目规则：无归档证据 = 门禁未通过。** 证据一律在 `../reports/G-<字母>-<日期>/`，
命名与协议见 [`../reports/README.md`](../reports/README.md)。

| 目录 | 门禁 |
|---|---|
| `../reports/G-B-20261010/` | 索引质量 v1 —— **判 FAIL**（重采样实现有问题） |
| `../reports/G-B-20261010-v2/` | 索引质量 v2 —— **判 PASS**（修后全量重建） |
| `../reports/G-D-p2-electron/` | P2 应用实跑（Electron 出窗 + React + WebGPU） |

> ⚠️ **G-B 判据已不可复跑**：`tools/quality/` 随 Python 档退役被删（见 `DEBT-CLEANUP.md` §十二）。
> 上面的证据从此是**存档**，不能独立重算。

---

## 4. ⚠️ 文档里仍提到已退役的 Python 档

`spec/` 与 `plan/` 下的文档大量提到已删除的 Python 检索档（旧 CLI 命令、`tools/*.py` 门禁、
P7 退役流程）。**那些段落描述的是退役前的历史状态，不是现状。**

现状以 `../README.md` §0 与 `DEBT-CLEANUP.md` §十二 为准。这批文档的统一改写尚未进行。

---

## 5. 改文档时的纪律

```powershell
node tools\verify-doc-refs.mjs      # 全仓引用解算 + 根目录越界检查（只读）
```

- **正文文档放 `docs/`**（plan / spec / design）；仓库根只留入口与 `TASK-PLAN.md`。
- **引用写"仓库根相对"**（`docs/spec/SPEC-app.md`），不要写 `../`——
  引用散落在不同深度，`../` 会随深度变化，根相对写法全局一致。
- 别把 CSS 令牌名写成 `radius.md` 这种形式：它会被当成文件引用。用反引号包住（`` `radius.md` ``）
  仍会被按文件解算，所以更稳妥的是写成 `` `radius.md` `` 时确认全仓没有同名文件。

# docs/audit —— 本次审查的证据档案（**冻结于重构之前**）

> ## ⚠️ 读之前必看：这批文档里的路径是**重构前**的
>
> 本目录的全部内容，是**在 monorepo 重构（`docs/MIGRATION-PLAN.md`）发生之前**采集的证据。
> 因此里面出现的 `core/` · `src/` · `tests/` · `onnx-spike/` · `static/prototype/` 等路径，
> **在当时是正确的，现在已不是**。
>
> **为什么不改写它们**：这些文件的价值在于「当时磁盘上到底是什么样」。
> 事后把路径改成新布局，就等于**伪造当时观察到的事实** —— 那会让整批证据失去证明力。
> 所以本目录**整体冻结**，只加这份说明。
>
> ### 路径对照表（旧 → 新）
>
> | 审查文档里写的 | 重构后的实际位置 |
> |---|---|
> | `core/*.mjs` | `packages/engine/src/*.mjs` |
> | `tests/*.test.mjs` | `packages/engine/tests/*.test.mjs` |
> | `src/main/*` | `apps/desktop/src/main/*` |
> | `src/preload/*` | `apps/desktop/src/preload/*` |
> | `src/renderer/*` | `apps/desktop/src/renderer/*` |
> | `src/shared/ipc.mjs` | `apps/desktop/src/shared/ipc.mjs` |
> | `onnx-spike/*.mjs` | `packages/indexer/src/*.mjs` |
> | `static/prototype/tokens.css` | **`packages/design-tokens/tokens.css`**（已提升为正式生产资产） |
> | `static/prototype/*`（其余） | `docs/archive/prototype/prototype/*` |
> | `spike/*` | `docs/archive/spike/*` |
> | `archive/*` | `docs/archive/legacy/*` |
> | `PROJECT-GUIDE.md` | 已并入根 `AGENTS.md`；原件在 `docs/archive/legacy/PROJECT-GUIDE.md` |
> | `TASK-PLAN.md` | `docs/plan/ROADMAP.md` |
>
> **行号也不再可靠**：上述文件在重构后虽未改内容，但若后续修复缺陷（如 F-01 `reveal` 注入 `shell`），
> 行号会偏移。**引用审查结论时请引用「问题编号」，不要引用行号。**
>
> **还有一类引用是「当时存在、现在已删」的文件**（例如重构中被删的 `docs/plan/PRE-KICKOFF-CHECK.md`、
> `docs/plan/PROJECT-DOC-INDEX.md`、`docs/plan/README.md`）。本目录**不为它们做逐处改写** ——
> 那同样是伪造当时的观察。**判断原则**：本目录里出现的任何路径，都当作"当时的事实记录"来读，
> 需要当前路径时查上面的对照表或 `docs/README.md`。

---

## 文件清单

| 文件 | 是什么 | 谁写的 |
|---|---|---|
| `00-current-state.md` | **现状基线**：重构前磁盘事实的唯一来源；含 D1-D14 冲突清单 | Lead |
| `01-acceptance-criteria.md` | 冻结的审查判据：通用门 G1-G7 · 严重度口径 · 必答问题 | Lead |
| `stack-evidence.md` | 宪章① 的原始命令输出附录（E0-E10） | stack-auditor |
| `uiux-evidence.md` | 宪章② 的原始命令输出 / 数值表附录 | uiux-auditor |
| `REVIEW-STACK-AUDIT.md` | 宪章① 的两轮独立复核（含 blockers 与自我纠错） | review-1 |
| `REVIEW-UIUX-AUDIT.md` | 宪章② 的两轮独立复核 | review-2 |

**审查报告本身在仓库根**：`STACK-AUDIT.md` · `UIUX-AUDIT.md` · `AUDIT-FINAL.md`。

---

## 这批证据的效力边界（重要）

| 结论 | 现在是否仍然成立 |
|---|---|
| **审查发现的缺陷**（`AUDIT-FINAL.md` §4 的 F-01~F-05） | 需**按编号**回原文件复查 —— 重构**没有修复**它们，只搬了位置 |
| **文档与磁盘的 14 处冲突**（D1-D14） | ✅ **本次重构已逐条消除**（见 `AGENTS.md` 与 `docs/plan/ROADMAP.md` 的说明） |
| **`reports/` 的门禁证据** | ⚠️ 部分**不可复跑**（`tools/quality/` 判据随 Python 档退役删除） |
| **未验证项**（冷启动计时 / 打包后行为 / 真实 `thumb://` 取图） | ❌ **至今仍未验证**，`README.md` 已如实保留这一声明 |

> **门禁规则不变**：「无归档证据 = 门禁未通过」。本目录就是那批证据的归档入口之一。

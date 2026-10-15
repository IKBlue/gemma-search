> ⚠️ **已过期（2026-10-14 早期快照）** —— 本文结论**已被取代**，**不要作为依据**。现行入口：`reports/2026-10-15-wave3/ACCEPTANCE-INDEX.md`（判据索引）与 `reports/2026-10-15-wave3/HANDOFF.md`（收工交班）。保留本文件仅为**追溯**。

# 只读审计 · IPC 契约现状（为 T-08 定范围）

> 日期：2026-10-15 · 类型：**本轮只读审计**（无代码改动） · 用途：给 T-08 划出真实工作量

## 事实（`文件:行号`）

- 契约唯一来源：`apps/desktop/src/shared/ipc.ts:27` 的 `Methods`，方法名清单在 `:146` 的 `METHOD_NAMES`。
- 通道：`main/index.ts:30` 引入 `CH_INVOKE`，`main/index.ts:363` 启动时打印允许的方法清单。
- 未实现清单：`packages/engine/src/engine.ts:50` 的 `UNIMPLEMENTED_METHODS`（**唯一一份定义**，假套件由它生成）。

## 16 个方法的两类

| 类别 | 方法 | 说明 |
|---|---|---|
| **已实现（10）** | `search` · `item` · `itemPaths` · `indexStatus` · `scan` · `reveal` · `collect` · `libraryConfig` · `libraryPickDir` · `libraryAdd` | 走引擎真实现；M0 薄切片（启动→找到→取件）依赖的正是这些 |
| **诚实桩（6）** | `ingest` · `mutate` · `transactions` · `indexStart` · `indexCancel` · `indexResume` | 落在 P1/P2（T-11…T-18）与事务 UI；现在返回「未实现」而**不假装能跑** |

## 对 T-08 的结论

1. **契约本身不需要重列** —— 它是唯一来源、zod 校验与信封都已到位 ⇒ T-08 的真实剩余工作是**核对 + 断言**（未登记方法被拒、契约与 SPEC §5 逐条对齐）。
2. 原描述里的「文档类新方法」应**归 P7 门控**（F7 没有语料就不开工）—— 已据此修正 TASKS.md 的 T-08 行。
3. 6 个桩的**实现**分别属于 T-11…T-18（数据与索引 / 检索内核），不属于 T-08。
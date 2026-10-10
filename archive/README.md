# archive / 已归档文档

这里的文档**不再是行动依据**。留着是为了可追溯"当初怎么想的、后来为什么改"。

| 文件 | 原位置 | 是什么 | 被谁取代 |
|---|---|---|---|
| `plan-agent-skill.md` | 根目录 `plan.md` | **「本地以图搜图 Agent Skill」的计划书** —— 触发条件、工作区规则、输出格式。它规划的是**给 DSH 用的技能**，不是应用 | 已定：**做独立应用，不做插件/技能形态**。见 `docs/spec/SPEC-app.md` §0–§1 |
| `plan-electron-draft.md` | `tasks/plan.md` | Electron 应用的**早期草稿**（外壳选型、路径、架构、P0–P6 阶段） | `TASK-PLAN.md`（阶段已重排）+ 四份 `SPEC-*.md`（约束已细化） |
| `app-shell-20261010/` | 根目录 `app/` | **手搓的旧应用外壳**（主进程 + preload + 渲染页，无构建工具） | `src/`（electron-vite 三端主体，2026-10-10 迁移）。仍可用 `npm run start:legacy` 跑起来；**等你验证 `npm run dev` 通过后就可删** |
| `patch_prototype_pages.py` | 根目录同名 | 一次性原型页补丁脚本（改 `static/prototype/*.html`，带 dry-run 与命中数核对） | 原型已定型且已接入设计令牌；要再改直接改页面或等 P3a 换成 React。保留是为了追溯"那批页面是怎么被批量改的" |
| `_migrate_layout_20261010.py` | `data/`（不入库） | 一次性：把根目录脚本归类到 `tools/` · `tools/quality/` · `spike/probes/`，并逐文件把"本文件目录 = 项目根"改写成**向上找 `core/engine.mjs`** | 已完成；保留是为了追溯那次移动的精确规则 |
| `_fix_doc_paths_20261010.py` | `data/`（不入库） | 一次性：同步文档里被移动脚本的命令路径（带 dry-run 与逐处命中数） | 同上 |

## ⚠️ 但前者里有**仍然有效**的技术更正

`plan-agent-skill.md` 描述的方案有多处**被实测推翻**，这些更正是有价值的，已提升为
`README.md` §8 的表格（扁平库 / 图像前缀 / 1 万张估算 / 内存 / 索引位置 / Zvec）。
**读那份归档时请配合 README §8 一起看**，否则会照抄已被推翻的假设
（最典型：按"扁平库 + `iterdir()` + stem 配对"实现会扫到 **0 张图**）。

## 归档规则（与 DEBT-CLEANUP 一致）

被取代的成果**归档不删除**；同时必须在别处写清"被谁取代、为什么"，
不让后来的人对着两份都像有效的计划猜。

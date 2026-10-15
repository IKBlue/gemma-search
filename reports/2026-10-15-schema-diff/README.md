# 提案 schema 对照现有代码（A） + 表数口径核对（C）

日期：2026-10-15 · 执行：Lead · 对象：`prototypes/PROPOSAL-schema-v1.html`（v1.2）

## 0. 这次要回答什么

| 问题 | 回答在哪 |
|---|---|
| **A** 提案里的表，哪些已经在代码里、哪些要改、哪些全新、哪些与实现冲突 | §2 |
| **C** 表数到底几张（提案里出现了三个数）、逐表分类有没有漏 | §1 |

**核实方法**（不是读记忆）：
1. **机械提取**提案 HTML 的表卡与字段行（正则解析 `tbl-h/h3` 与 `tr/td.f/td.t`），不靠人眼数；
2. 逐条在**代码**里找落点：`apps/desktop/src/main/db/migrations.ts`（DDL 权威）· `library-config.ts`（注册表落点）· `import.ts`（重建会不会恢复）；
3. 能实测的前提就实测（FTS5 可用性用 `node:sqlite` 真建虚表）。

---

## 1. 【C】表数：提案里出现了**三个不同的数**，实际是 **20 张**

| 出处 | 它说的数 | 它实际列出的 |
|---|---|---|
| 开头/落地顺序 | **18 张**（应用级 **4** + 库级 **14**） | — |
| 分组节（两个数据库） | 应用级 **4 张** / 库级 **12 张** | 应用级列了 **6** 个（app_meta · library_registry · app_setting · collect_dir · activity · recent_query）；库级列了 **14** 个（事实 3 + 过程 5 + 意图 6） |
| 逐表分类节 | 标题写 18 | 实际点名 **3 + 7 + 7 + 3 = 20** |

**逐表分类节的点名（这是唯一列全的）**：

| 组 | 表 |
|---|---|
| 事实层（丢掉重建） | `asset` · `asset_file` · `asset_name_fts`（+ 门控 `document` · `doc_chunk`） |
| 过程层（尽量留） | `asset_index_state` · `job` · `health_run` · `health_finding` · `recent_view` · `recent_query` · `activity` |
| 意图层（必须留） | `asset_user_meta` · `tag` · `asset_tag` · `collection` · `collection_item` · `asset_export` · `collect_dir`（+ 门控 `doc_dir`） |
| 应用层（不参与库级重建） | `app_meta` · `library_registry` · `app_setting` |

⇒ **物理表 20 张**（应用级 **6** + 库级 **14**）。**18 与 4/12 都是错的**，且不是笔误级别的错：
**它自己定的规矩是「迁移建出的每一张表都必须在四组之一点名，忘分类就测试变红」——而它自己的点名表就已经和标题对不上。**

### 1.1 归属冲突（比数字更要紧）

`activity` · `recent_query` · `recent_view` 在**两份清单里归了不同的家**：

| 表 | 分组节说 | 分类节说 | 为什么这个冲突是真的 |
|---|---|---|---|
| `activity` | 应用级（`userData/app.db`） | 过程层（库级 `.gs.db`） | 若在库级 ⇒「重建某库」会碰操作记录；若在应用级 ⇒ 一次跨库批量操作只有一行 |
| `recent_query` | 应用级 | 过程层（库级） | 检索历史天然跨库；字段里也有 `scope_lib_id = NULL` 表示全部库 |
| `recent_view` | （未提） | 过程层（库级） | uid 是库内派生物 ⇒ 库级合理；但「接着上次看」若跨库就要应用级 |

**必须二选一定死**，否则 §5 的「重建只碰库级」这条规则落不了地。**我的建议**：`activity` / `recent_query` / `recent_view` 都放**应用级**
（它们是**跨库的用户行为**，不是某个库的属性；库级表用 `lib_id` 列做筛选就够）。若采纳，应用级 6 张、库级 14 张。

---

## 2. 【A】逐表对照现有代码

### 2.1 代码里今天真正存在的东西

| 落点 | 内容 | 出处 |
|---|---|---|
| `<库根>/.gs.db` | **8 张表**：`schema_version`(元表) · `library` · `items` · `doc_dirs` · `documents` · `doc_chunks` · `health_runs` · `health_ledger` | `main/db/migrations.ts`（v1 core + v2 docs-and-health） |
| `userData/library-registry.json` | **库注册表的权威副本**（不是 SQL） | `main/library-config.ts:15,38`（标记为「决策 9 的正规存储」） |
| `config.json` + `GEMMA_*` 环境变量 | 仅作**兼容回退**：库根候选、取件白名单（`GEMMA_COLLECT_DIRS`）、onnx 模型目录 | `main/index.ts:166-208` · `:341` |
| 应用级数据库 | **不存在** | — |

### 2.2 差异表（提案 20 张 → 代码）

| # | 提案表 | 现有落点 | 状态 | 差异要点 |
|---|---|---|---|---|
| 1 | `app_meta` | 无（应用级 DB 不存在） | **全新** | 同时要决定「两套独立迁移账本」怎么记（现有是 `.gs.db` 里的 `schema_version` 单表） |
| 2 | `app_setting` | `config.json` + `GEMMA_*` | **要改** | 搬进 DB 后，`config.json` 的「兼容回退」定位要不要保留、优先级怎么排，必须写清 |
| 3 | `library_registry` | `userData/library-registry.json`（权威）+ `.gs.db.library`（镜像） | **要改** | 现有 `library` 表多 8 列（`fallback` `compat_key_version` `model_repo` `model_revision` `dim` `seq` `item_count` `meta_json`）⇒ 要指定归处：进注册表、进 `asset_index_state`、还是删 |
| 4 | `collect_dir` | `collect.dirs` 来自 `GEMMA_COLLECT_DIRS` / `config.json` | **要改** | 白名单是**安全边界**，落库才能审计与展示；现在是启动时解析出来的数组 |
| 5 | `activity` | 无 | **全新** | 见 §1.1 归属 |
| 6 | `recent_query` | 无 | **全新** | 见 §3.4（它的唯一约束有个真问题） |
| 7 | `asset` | `.gs.db.items`（**18 列宽表**） | **要改（拆）** | 现有 `items` 把「条目」与「两个文件角色」混在一张表；要拆成 `asset` + `asset_file`。现有 `name` 与提案 `display_name` 语义要定死 |
| 8 | `asset_file` | 无（散在 `items` 的 `image_*` 6 列 + `archive_*` 6 列） | **要改（拆）** | 拆出后「缺包 = 少一行」；现有 `image_mtime` 与提案 `mtime_ms` 的**单位口径**要统一（见 §4.3） |
| 9 | `asset_name_fts` | 无 | **全新** | FTS5 实测**可用**（§5.1）；现在按文件名只能全表 `LIKE` |
| 10 | `asset_index_state` | `items.vector_row` + `items.vector_source` | **要改** | 现有两列只够推「有没有编码」，**推不出**失败原因/排除/何时编码过；提案改为存**时刻**（更对） |
| 11 | `asset_user_meta` | 无 | **全新** | 评分/备注/收藏今天**完全没有存储**（详情页只读） |
| 12 | `tag` · `asset_tag` | 无 | **全新** | — |
| 13 | `collection` · `collection_item` | 无 | **全新** | F6 交付现在没有「集合」概念 |
| 14 | `asset_export` | 无（`collect` 不留痕） | **全新** | 取件/交付**都没有历史**；`activity` 与它不重复（一次批量 = activity 1 行 + export N 行） |
| 15 | `job` | 无（进度只在内存，靠 `index.progress` 事件推） | **全新** | 现在**崩了就不知道**；SPEC「进度单调且不静默」目前靠进程活着 |
| 16 | `health_run` · `health_finding` | `.gs.db.health_runs` · `health_ledger` | **要改** | 现有结构不同：run 有 `item_count`/`summary_json`，ledger 是 `target_path`（提案为 `target_rel_path`）、无 `job_id`（提案要求体检挂 job，避免第二套任务机制） |
| 17 | `recent_view` | 无 | **全新** | 见 §1.1 归属 |
| 18 | `doc_dir` · `document` · `doc_chunk` | **已存在**（`.gs.db` v2 已建三张） | **冲突（顺序相反）** | 提案把它们列为**门控**「本轮不建」，而**代码里已经建好了** ⇒ 两边顺序不一致。而且 `doc_dirs` 现在**重建即丢**（§4.1，真缺陷） |
| 19 | （现有）`schema_version` | `.gs.db` 元表（单行 id=1） | **要改** | 提案用 `app_meta.schema_version` + 两套独立迁移替代；现在的单表机制要跟着改（T-11a 的 `EXPECTED_TABLES` 断言也要同步） |

**汇总**（严格按 20 张计）：

| 状态 | 张数 | 是哪些 |
|---|---|---|
| **全新**（代码里完全没有落点） | **12** | `app_meta` · `activity` · `recent_query` · `asset_name_fts` · `asset_user_meta` · `tag` · `asset_tag` · `collection` · `collection_item` · `asset_export` · `job` · `recent_view` |
| **要改**（有落点，但结构/位置要变） | **8** | `app_setting`（config.json→DB）· `library_registry`（userData JSON→DB）· `collect_dir`（env/config→DB）· `asset` · `asset_file`（从 `items` 拆出）· `asset_index_state`（从 `vector_row/vector_source` 扩成时刻）· `health_run` · `health_finding` |
| **代码已存在但提案列为门控**（顺序相反） | 3（**不计入 20**） | `doc_dir` · `document` · `doc_chunk` |
| **现有元表要被替代** | 1（不计入 20） | `schema_version`（改为 `app_meta.schema_version` + 两套独立迁移账本） |

---

## 3. 核对过程中发现的**提案自身问题**（都可修，且必须修）

| # | 问题 | 证据 | 建议修法 |
|---|---|---|---|
| 3.1 | 表数三处不一致（4/12 · 18 · 20） | §1 的两个列表 | 统一为 20（或定死应用级归属后重算），并让「逐表分类」的清单成为**唯一**来源 |
| 3.2 | `activity`/`recent_query`/`recent_view` 归属冲突 | 两份清单 | 见 §1.1 建议：放应用级 |
| 3.3 | **`UNIQUE (lib_id, rel_path)` 建不出来** | 它在 `asset` 卡的约束块（HTML:695），但 `asset` 的字段里**没有 `rel_path`**（只有 `rel_dir`）；`rel_path` 在 `asset_file`，而 `asset_file` **没有 `lib_id`** | 三选一：① `asset` 加 `rel_path` 列并唯一；② `asset_file` 加 `lib_id`（**这与它自己「不冗余」的原则冲突，要显式认账**）；③ 唯一性改由扫描器在应用层保证（弱） |
| 3.4 | **`recent_query` 的唯一约束在「全部库」场景失效** | `scope_lib_id` 是**可空**（`NULL = 全部库`，HTML:607-609），而约束是 `UNIQUE (kind, text, scope_lib_id)`（:626）。SQLite **多个 NULL 互不冲突** ⇒ 反复搜同一个词（全部库）**每次新增一行**，把真正的历史挤掉 | 用哨兵值（`scope_lib_id NOT NULL DEFAULT ''`，`''` = 全部库）或两条偏唯一索引。**它自己在 HTML:200 写过这个坑**，但没落实 |
| 3.5 | `job` 的约束等于**全局串行** | `UNIQUE ON job((1)) WHERE state IN ('queued','running')`（:963） | 这是「同时只能有一个在跑的任务」——索引/扫描/体检/重建/入库**全部串行**。若是本意就写明；若想让「索引」与「体检」并行，约束要改成按 `kind` 分组 |

---

## 4. 三条**独立于 schema 选择**的既有缺陷（我独立验证过，代码里今天就是这样）

| # | 事实 | 我怎么验的 | 后果 |
|---|---|---|---|
| 4.1 | **重建会抹掉 `doc_dirs` 与体检历史**：重建第①步 `removeGsDbFiles`（删整个文件），之后 `import.ts` **只导回 `items` + `library`** | `grep 'doc_dirs\|health_runs\|health_ledger' apps/desktop/src/main/db/import.ts` ⇒ **零命中** | F7 一上线，用户加过的文档目录**重建一次就没了**；体检历史同理（但体检可重跑，属过程层） |
| 4.2 | **改名/移动磁盘文件 ⇒ 标注变孤儿**：`uid = sha1(lib_id \| rel_dir \| stem)`，**uid 是路径的纯函数** | `packages/engine/src/uid.ts:3` | 今天还没暴露（还没有标注表）；一旦上标签/评分，整理一次目录全丢 |
| 4.3 | **mtime 口径不止一种，而引擎拿它做相等比较** | `engine.ts:524` 用 `Number(st.mtimeNs / 1_000_000n)`（BigInt 截断）、`:542` 用 `!==` 判「文件改过没有」；indexer / 测试各处写法不同 | 「待重编码」会**无理由抖动**（同文件不同路径得到不同值） |

**这 4.1 尤其要紧**：它不依赖要不要采用提案——**现状就有**，只差 F7 上线把它变成真丢数据。

---

## 5. 我顺手验证掉的两个前提

### 5.1 FTS5 可用（提案的 `asset_name_fts` 可行）

```
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');"
⇒ FTS5 = OK
```
（`node:sqlite` 是 Electron 内置的 SQLite，FTS5 编译进来了 ⇒ 关键词子串搜索这条设计**不是空想**。）

### 5.2 Windows 路径会让 `library_registry.root` 的 `UNIQUE` 变弱

Windows 上 `G:\Model` 与 `g:\model` 是**同一个目录**，`G:\PROGRA~1\x` 与 `G:\Program Files\x` 也是；但 `UNIQUE` 是**文本比较** ⇒ 同一个库根能被登记两次。
登记时对 `root` 做**规范化**（大小写 + 短名 + 尾斜杠 + 分隔符）并只存规范形，否则「同一个目录两条记录」会让「全部库」出现重复素材。

---

## 6. 结论与建议

1. **这份 schema 作为目标设计是完整的**（20 张表 · 四层持久性 · 导出机制 · 落地顺序），但**它现在是提案，代码里几乎没有**：现有只覆盖其中 **8 张表**的一部分（`library` / `items` / 文档三表 / 体检两表），应用级数据库**根本不存在**。
2. **采用它 = 重写 `.gs.db` + 重写导入/重建路径**（`items` 18 列宽表 → `asset` + `asset_file`），并新增一个应用级 DB；不是「加几张表」。
3. **提案自身有 5 处要先修**（§3），其中 3.3 与 3.4 是**建表就会当场失败或行为不符合它自己写的纪律**的那类。
4. **§4 的三条与现实无关，可以先修**（尤其 4.1 的 `doc_dirs` 丢失），它们不需要等 schema 决策。
5. 改 `SPEC.md` §1/§2/§3/§7 与 `AGENTS.md` §5 属所有者 —— 本报告**不改任何规格、不改任何代码**。

---

## 7. 证明不了什么

· 本报告只做**静态对照 + 两处实测**（FTS5 可用性、grep 命中）；**没有**跑过提案里的任何 DDL（提案没有可执行 SQL）。
· 「20 张表」是按提案文本与 HTML 表卡机械提取的结果；**提案作者若认为某张不该算表（如虚表 `asset_name_fts`），数会变**——所以 §1 把每一处出处都列了出来，供核对。
· 现有代码侧只读了 `migrations.ts` / `library-config.ts` / `import.ts` 与两处 grep；**没有**逐个模块确认「是否还有别的 JSON 落点」（例如快捷键、外观设置）——若要更严，需要一次全仓 `userData` 写入点的扫描。

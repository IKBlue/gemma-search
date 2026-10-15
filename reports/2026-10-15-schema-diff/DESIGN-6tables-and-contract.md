# 设计基线（所有者裁定：**全新项目**，先定数据表 + 接口）

日期：2026-10-15 · 状态：**待所有者批准** · 批准后写进 SPEC.md §1/§2/§5 并据此实施

> 所有者口径：**全新项目；优先设计数据表，和对接口**。⇒ 本文件是**实施前的设计基线**，不是提案（prototypes/ 里那三份是素材，已被本文件吸收/裁减）。

---

## 0. 三条基线原则（从所有者裁定推出）

| # | 原则 | 由来 |
|---|---|---|
| 1 | **只建现在就要用的表**（6 张），其余随功能上线 | 所有者选 **B**（TASKS §4 · U19） |
| 2 | **每个字段要么被某个操作用到，要么是扫描就能拿到的事实** | field-map 的 55 个操作是验收口径 |
| 3 | **接口只暴露这些表能支持的操作**；为不存在的表开的接口一律不开 | 「先定表，再对接口」 |

**两个数据库**（绿地划清，解决鸡生蛋问题）：

`~
userData/app.db          应用级 3 张 —— 跨库的配置与注册表
<库根>/.gs.db            库级   3 张 —— 跟着库走，拷库即带走
`~

⚠️ **跨库外键不存在**（SQLite 无此能力）⇒ asset.lib_id 只是普通 TEXT，**不做** REFERENCES。这是两个库划分的必然代价，写进注释。

---

## 1. 数据表（6 张，逐字段定稿）

### 1.1 应用级 userData/app.db

#### app_meta —— 版本与迁移账本（1 行，id=1）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK, CHECK (id = 1) | 单行守卫（不变式由 CHECK 保证，不靠调用方自觉） |
| schema_version | INTEGER | NOT NULL, CHECK (>= 0) | 应用级迁移版本；**只有这一处真相** |
| created_at_ms · updated_at_ms | INTEGER | NOT NULL | 建立 / 上次迁移时刻 |

#### library_registry —— 库注册表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| lib_id | TEXT | PK | 库标识（1–32 字符）；**写进 uid 派生公式 ⇒ 一旦分配不可改** |
| root | TEXT | NOT NULL, UNIQUE | 库根绝对路径；登记前**规范化**（大小写/短名/尾斜杠），否则 Windows 上同一目录能登两次 |
| display_name | TEXT | NOT NULL | 界面显示名（名字是你的，路径是事实） |
| enabled | INTEGER | NOT NULL DEFAULT 1, CHECK in (0,1) | 是否参与检索/入库；停用不动任何文件 |
| compat_key | TEXT | NULL | 这个库的索引是用哪套兼容键建的（合并检索的门限） |
| sort_order | INTEGER | NOT NULL DEFAULT 0, INDEX | 侧栏顺序（同值按 lib_id 兜底，保证稳定） |
| registered_at_ms · updated_at_ms | INTEGER | NOT NULL | 登记 / 修改时刻 |

#### collect_dir —— 取件白名单（**安全边界**）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| dir_id | TEXT | PK | nanoid |
| label | TEXT | NOT NULL, UNIQUE | 目录名（界面显示） |
| abs_path | TEXT | NOT NULL | **取件只允许写进这些目录**，其余一律拒绝 |
| is_default | INTEGER | NOT NULL DEFAULT 0, CHECK in (0,1) | 默认目标 |
| created_at_ms | INTEGER | NOT NULL | 加入时刻 |

**偏唯一索引（只允许一个默认）**：CREATE UNIQUE INDEX uniq_collect_default ON collect_dir ((1)) WHERE is_default = 1

### 1.2 库级 <库根>/.gs.db

#### asset —— 条目（**一个条目 = 一张预览图 + 可选同名包**）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| uid | TEXT | PK | 12 位小写 hex；**扫描时匹配认领**（先按 (lib_id, rel_path) 命中就保留原 uid） |
| lib_id | TEXT | NOT NULL | 普通 TEXT（**跨库外键建不出来**，见 §0） |
| folder | TEXT | NOT NULL | 分类目录（浏览与筛选的主维度） |
| stem | TEXT | NOT NULL | 文件名主干（配对靠它；唯一来源在扫描器） |
| display_name | TEXT | NOT NULL | 界面显示名（默认 = 主干 + 扩展名，可改，**不改磁盘**） |
| rel_dir | TEXT | NOT NULL | 相对目录的**规范形**（库根 ⇒ 空串；进 uid 公式） |
| rel_path | TEXT | NOT NULL | 相对路径（**扫描匹配与唯一性的落点**） |
| discovered_at_ms | INTEGER | NOT NULL | 首次被发现时刻 |

**唯一约束**：UNIQUE (lib_id, rel_path) —— 防止同一文件被登记两次（uid 不再由路径派生，路径唯一性必须**显式声明**）
**索引**：idx_asset_lib_folder ON asset (lib_id, folder) · idx_asset_stem ON asset (stem)

**本批刻意不加的列**（都随功能上线）：deleted_at_ms（回收站）· dup_group_id（重复分组）· content_created_at_ms（按内容时间浏览）

#### asset_file —— 文件角色（**缺包 = 少一行**，不是一个 NULL 块）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| uid | TEXT | NOT NULL, REFERENCES asset(uid) **ON DELETE CASCADE** | 同库外键 ✅ |
| role | TEXT | NOT NULL, CHECK in (preview, archive) | 预览图 / 同名包 |
| rel_path | TEXT | NOT NULL | 相对路径 |
| ext | TEXT | NOT NULL | 扩展名 |
| size_bytes | INTEGER | NOT NULL | 大小（扫描事实） |
| mtime_ms | INTEGER | NOT NULL | 修改时刻（**统一口径**：BigInt mtimeNs / 1e6 截断，全库唯一写入口） |
| width · height | INTEGER | NULL | 像素尺寸；**扫描就能拿到** ⇒ 现在就存，免得以后重扫 |

**主键**：PRIMARY KEY (uid, role) · **索引**：idx_asset_file_path ON asset_file (rel_path)
**本批不加**：thumb_hash（首屏占位图，UI 增强）· content_hash_kind/value（去重功能，且要真算哈希）

#### asset_index_state —— 索引状态（**存时刻，不存枚举**）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| uid | TEXT | PK, REFERENCES asset(uid) ON DELETE CASCADE | 1:1 于条目 |
| encoded_at_ms | INTEGER | NULL | **成功编码时刻**；NULL = 从未成功 |
| encoded_mtime_ms | INTEGER | NULL | 编码时该文件的 mtime ⇒ 与当前 mtime 不等 = **待重编码**（**算出来的，不是存的**） |
| compat_key | TEXT | NULL | 编码时用的兼容键 ⇒ 与库的 compat_key 不等 = 待重编码（模型换了） |
| attempt_count | INTEGER | NOT NULL DEFAULT 0 | 尝试次数 |
| last_error · last_error_at_ms | TEXT · INTEGER | NULL | **失败原因**（没有它，「编码失败」这一档无法解释） |
| excluded_at_ms | INTEGER | NULL | 用户**主动排除**索引（意图，优先级最高） |
| checked_at_ms | INTEGER | NULL | 上次核对时刻（界面要能说「这是上次已知状态，可能过期」） |

**索引**：idx_state_pending ON asset_index_state (encoded_at_ms) WHERE encoded_at_ms IS NULL · idx_state_excluded ON asset_index_state (excluded_at_ms) WHERE excluded_at_ms IS NOT NULL

**状态 8 档全部派生**（一个字都不存）：已排除 > 编码失败 > 编码中 > 图片丢失 > 已移除 > 待重编码 > 待编码 > 已编码。
**本批不物化** needs_reencode（跨表比较无法索引；100 条无所谓，等浏览页要筛再迁移加列 + 对账检查）

---

## 2. 接口（对接口：每张表 ↔ 谁能读写它）

### 2.1 引擎端口（packages/engine/src/storage-ports.ts，主进程实现）

| 端口 | 读哪些表 | 现状 |
|---|---|---|
| LibraryResolverPort | library_registry | 已存在（T-16a/b），**把落点换成 app.db** |
| ItemStorePort | asset + asset_file + asset_index_state（合成引擎的 Item 形状） | 已存在，**列映射按 §1 改** |
| VectorIndexPort | .gs-index.bin（不是表） | 已存在，不动 |

### 2.2 IPC 契约（shared/ipc.ts = 唯一来源）—— **只保留这 6 张表支持得了的方法**

| 方法 | 读 | 写 | 参数 | 返回（信封内） |
|---|---|---|---|---|
| libraryList | library_registry | — | — | 库数组（含 enabled/compat/sort_order/条目数） |
| libraryPickDir | — | — | — | 选中的绝对路径（原生目录选择，已有，保留） |
| libraryAdd | library_registry | library_registry（+ 建目录/迁移） | {root, label?} | 新库条目（root 入库前**规范化**） |
| librarySetEnabled | | library_registry | {libId, enabled} | 更新后的条目 |
| libraryReorder | | library_registry | {libId, sortOrder} | 更新后的条目 |
| libraryRemove | | library_registry | {libId, deleteDb?} | 报告（删了什么）；**默认只取消登记**，删库两段式 |
| scan | asset · asset_file | asset · asset_file | {libId} | 扫描结果（新增/变更/消失计数）——**扫描是唯一的文件事实写入口** |
| indexStatus | asset_index_state · .gs-index.bin | — | {libId} | 状态 + 各档计数 + layout（已有，改读新表） |
| search | asset · asset_file · .gs-index.bin | — | {query\|image, scope, limit} | 结果（uid/分数/档位/路径） |
| item | asset · asset_file · asset_index_state | — | {uid} | 条目详情 |
| itemPaths | asset · asset_file | — | {uid} | 预览图/包两条路径 |
| collect | collect_dir · asset_file | 只写目标目录 | {uid\|[uid], targetDir} | 逐条结果（copied/skipped/failed）——**白名单校验唯一入口** |
| collectDirs | collect_dir | — | — | 白名单数组（含 is_default） |
| collectDirAdd · collectDirRemove · collectDirSetDefault | | collect_dir | {absPath, label} 等 | 更新后的数组 |
| appMeta | app_meta | — | — | {schemaVersion, …}（诊断页显示版本） |
| reveal | —（用 itemPaths） | — | {uid} | ok |

**本批不开的方法**（等对应的表）：libraryHealth（体检台账 = health_run/finding）· ingest / mutate / transactions（意图层标注表）· indexStart / indexCancel / indexResume（job 表）· 标签/评分/集合/交付历史相关的一切。

⚠️ 现有契约里那 6 个**诚实桩**（ingest / mutate / transactions / indexStart / indexCancel / indexResume）在绿地口径下**应当删除**，而不是继续挂着 —— 它们对应的表还没建。

### 2.3 每张表的**唯一写入口**（防漂移）

| 表 | 谁能写 |
|---|---|
| library_registry | 只为 library* 那组方法 |
| collect_dir | 只为 collectDir* 那组方法 |
| asset / asset_file | **只有扫描**（scan）；索引任务只写 asset_index_state |
| asset_index_state | **只有索引任务**；excluded_at_ms 另由用户的排除操作写 |
| app_meta | 只有迁移 |

---

## 3. 迁移与重建（绿地）

| 项 | 定稿 |
|---|---|
| 迁移机制 | **一套实现**（migration-engine.ts 参数化出两套账本）：应用级用 app_meta.schema_version、库级用 schema_version |
| 新旧关系 | **不支持旧库升级**（绿地）：发现旧版 .gs.db ⇒ 丢弃重建，并**如实告知用户** |
| 重建规则 | **丢事实层、留过程层与意图层** —— 本批：事实 = asset/asset_file（可重建）· 过程 = asset_index_state（尽量留）· 意图 = 无 |
| 保留命名空间 | .gs-* ∪ .gs.db 家族 ∪ .gs-staging/（唯一实现 gs-names.ts）；app.db 在 userData，**不属于**库内保留名 |

---

## 4. 与提案的差异（本文件对 PROPOSAL-schema-v1.html 的裁剪）

| 提案 | 本基线 | 为什么 |
|---|---|---|
| 20 张表 | **6 张** | 所有者裁定 B |
| asset 11 列 | **8 列** | 砍 deleted_at_ms / dup_group_id / content_created_at_ms（回收站 / 去重 / 按内容时间浏览，均为后续功能） |
| asset_file 10 列 | **7 列** | 砍 thumb_hash（UI 占位）与 content_hash_*（去重要真算哈希） |
| asset_index_state 物化 needs_reencode | **不物化** | 跨表比较无法索引；等要筛再加列并对账 |
| recent_view 跨库 FK | **删掉该表** | 进第二批；顺带回避了跨库外键这个死结 |
| 体检 / 任务 / 标签 / 集合 / 导出 / 设置 / 历史 | **全部推迟** | 对应的表随功能上线 |

---

## 5. 批准后要做的四件事

1. 把 §1/§2/§3 写进 SPEC.md（§1 数据模型 · §2 存储布局 · §5 契约）；
2. main/db 的 DDL 收到 6 张（S1b 正在做）；契约按 §2.2 **重列**（删 6 个桩 + 增 collectDir* / appMeta 等）；
3. **S2** 用 100 条素材建库（asset / asset_file 拆分 + library_registry / collect_dir / app_meta）；
4. **S3** 100×768 索引 + asset_index_state 时刻；**S4** 验收（含 field-map ↔ DDL 双向覆盖）。

## 6. 这份文件证明不了什么

· 字段取舍是**按 field-map 的操作引用数**做的判断，不是实测（没有跑过 100 条之外的数据量）；
· 「6 张够用」的边界是 **S1–S4 这条链路**（扫描 → 索引 → 检索 → 详情 → 取件）；
· 状态 8 档的**派生规则**在 §1.2 写全了，但**实不实际**要等 S3/S4 用真数据验。

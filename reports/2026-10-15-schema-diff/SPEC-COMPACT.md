> ⚠️ **提案快照，勿作依据**：本文是 `prototypes/PROPOSAL-schema-v1.html`（v1.2）在 **2026-10-15 11:51** 的机械提取，用于当时写 DDL。
> 本轮**已采用 6 张表**（U19/U20），**权威在 `SPEC.md §1` 与真 DDL**（`apps/desktop/src/main/db/migrations.ts`）。保留本文仅为**追溯**提案与最终设计的差异。

# 提案 schema 的**机械提取**（给实现者用，不必再读 103KB HTML）

来源：`prototypes/PROPOSAL-schema-v1.html`（v1.2）；由 Lead 用正则从 HTML 表卡提取字段/类型/约束/说明。
用法：**照此写 DDL**；但必须先按 `reports/2026-10-15-schema-diff/README.md` §3 的 5 条结论修正。

## app_meta  [本轮]  · 字段 3

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK CHECK id=1 | 单行守卫。 |
| `schema_version` | INTEGER | NOT NULL | 迁移版本。版本不符 ⇒ 重建（绿地模型明确接受这件事）。 |
| `created_at_ms / updated_at_ms` | INTEGER | NOT NULL | 建立 / 最后迁移时刻。 |

## library_registry  [本轮]  · 字段 7

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `lib_id` | TEXT | PK 格式 1–32 字符 | 库标识，写进 uid 的派生公式 ⇒ 一旦分配不可改 。 |
| `root` | TEXT | NOT NULL UNIQUE | 库根绝对路径。 UNIQUE 防止同一个目录被登记两次。 |
| `display_name` | TEXT | NOT NULL | 界面显示名。与 root 分开——名字是你的，路径是事实。 |
| `enabled` | INTEGER | NOT NULL CHECK 0/1 DEFAULT 1 | 是否参与检索与入库。停用不动任何文件。 |
| `compat_key` | TEXT | NULL | 这个库的索引是用哪套 8 段兼容键建的。 不兼容的库不能合并检索 。 |
| `sort_order` | INTEGER | NOT NULL DEFAULT 0 INDEX | v1.2 新增。 侧栏库列表的顺序。 顺序是你的，不该由路径字母序或登记时间决定 —— 你有 4 个库时，"常用的排前面"是真实需求。同值时按 lib_id 兜底保证稳定。 |
| `registered_at_ms / updated_at_ms` | INTEGER | NOT NULL | 登记 / 修改时刻。 |

## collect_dir  [本轮]  · 字段 4

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `dir_id` | TEXT | PK | nanoid。 |
| `label` | TEXT | NOT NULL UNIQUE | 目录名（"素材待用" / "移出素材"）。 |
| `abs_path` | TEXT | NOT NULL | 绝对路径。 取件只允许写进这些目录 ，其余一律拒绝。 |
| `is_default` | INTEGER | NOT NULL CHECK 0/1 DEFAULT 0 | 默认取件目标。界面只应允许一个为 1。 |

## app_setting  [v1.2 新增]  · 字段 3

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `key` | TEXT | PK | 设置键。形如 theme / model.dir / collect.default 。 |
| `value_json` | TEXT | NOT NULL | 值， 统一存 JSON （字符串也是 JSON 字符串）。 这样布尔/数组/对象不必各开一列， 加设置不需要迁移 。 |
| `updated_at_ms` | INTEGER | NOT NULL | 最后修改时刻。 |

## activity  [v1.2 新增]  · 字段 8

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `activity_id` | TEXT | PK | nanoid。也是批量操作的 batch_id （一族操作归一个 id）。 |
| `at_ms` | INTEGER | NOT NULL INDEX DESC | 发生时刻。倒序索引 ⇒ 列表页第一屏是索引扫描。 |
| `kind` | TEXT | NOT NULL CHECK 枚举 | collect / deliver / trash / restore / purge / tag.add / tag.remove / collection.add / index.exclude / index.in |
| `subject_kind` | TEXT | NOT NULL CHECK 枚举 | asset / library / tag / collection / app 。 |
| `subject_id` | TEXT | NULL | 对象 id（uid / lib_id / tag_id …）。批量操作时为空，明细在 detail_json 。 |
| `lib_id` | TEXT | NULL | 涉及哪个库。 可空 ——因为有些操作（登记库）不属于任何库。 |
| `result` | TEXT | CHECK ok/skipped/failed | 与 asset_export.result 同一套词。 |
| `detail_json` | TEXT | NULL | 结构化参数，不存渲染好的文字。 理由见下。 |

## recent_query  [v1.2 新增]  · 字段 7

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `query_id` | TEXT | PK | nanoid。 |
| `kind` | TEXT | CHECK text/image | 文字搜 / 以图搜图。 两者要分开记 ，否则重跑时不知道该拿什么当输入。 |
| `text` | TEXT | NULL | 查询文本（ kind='text' 时非空）。 |
| `image_ref` | TEXT | NULL | 以图搜图时的参考图 uid（ kind='image' 时非空）。 存 uid 不存绝对路径 ——路径会变，uid 不会。 |
| `scope_lib_id` | TEXT | NULL | 当时的检索范围。 NULL = 全部库。 重跑时必须还原当时的范围 ，否则结果对不上，用户会以为索引坏了。 |
| `result_count` | INTEGER | NULL | 当时命中数。用于显示与"结果变少了"的对照。 |
| `at_ms` | INTEGER | NOT NULL INDEX DESC | 查询时刻。 |

## asset  [本轮]  · 字段 11

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | PK 12 位小写 hex | v1.1 改动：生成一次，永不变 （对齐 Immich 的 @PrimaryGeneratedColumn() id ）。 不再是 sha1(lib_id|rel_dir|stem) —— 那个公式让 改名/移动 = 丢 |
| `lib_id` | TEXT | NOT NULL INDEX | 所属库。虽然每个库一个文件，仍显式带上—— 便于将来把多库的体检结果并起来看。 |
| `folder` | TEXT | NOT NULL | 一级分类目录（CR / VR / CR+VR / 其他）。 |
| `stem` | TEXT | NOT NULL | 文件名主干。参与配对（找同名压缩包）。 改名时更新它，但不动 uid。 |
| `display_name` | TEXT | NOT NULL | 界面显示名。 与 stem 分开 （对齐 Immich 的 originalFileName ）：你可以只改显示名而不动磁盘上的文件。 |
| `rel_dir` | TEXT | NOT NULL | 相对库根的目录（不含文件名）。 索引以相对路径为准 ⇒ 库整体搬盘后索引仍可用。 |
| `content_created_at_ms` | INTEGER | NULL INDEX | v1.1 新增 （对齐 Immich 的 fileCreatedAt ）。 "这张图是什么时候做的" ——用于按内容时间浏览排序。 取不到就 NULL（很多素材没有 EXIF）。 与 mtime_ms 是两件事 ： 前者 |
| `deleted_at_ms` | INTEGER | NULL 偏索引 | 软删除 （对齐 Immich 的 @DeleteDateColumn ）。 NULL = 在用；非空 = 已移入回收站。 所有常规查询默认 WHERE deleted_at_ms IS NULL 。 |
| `dup_group_id` | TEXT | NULL INDEX | v1.1 新增 （对齐 Immich 的 duplicateId ）。 同一 id 的行互为重复，由体检填写。 不存它就是每次体检都要重算全库两两比较 ——几千条能跑，几万条跑不动。 |
| `discovered_at_ms` | INTEGER | NOT NULL | 首次被发现时刻。用于"最近入库"。 |
| `updated_at_ms` | INTEGER | NOT NULL | 本行最后修改时刻。 |

**附加（asset 卡内第 2 张表）**：
- PRIMARY KEY (uid) —— 按 uid 取单条。
- UNIQUE (lib_id, rel_path) v1.1 新增 ：防止同一个文件被登记两次。 因为 uid 不再由路径派生， 路径的唯一 —— 配对与按名查。

## asset_file  [本轮]  · 字段 10

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | FK asset.uid PK(1/2) CASCADE | 条目。 |
| `role` | TEXT | PK(2/2) CHECK image/archive | 文件角色。 缺包 = 没有 role='archive' 的行 。 将来加"预览视频/许可证 PDF"只是扩 CHECK 列表。 |
| `rel_path` | TEXT | NOT NULL INDEX | 相对库根路径。索引与定位都以它为准。 |
| `ext` | TEXT | NOT NULL | 扩展名（小写，不含点）。 |
| `size_bytes` | INTEGER | NOT NULL | 字节数。 单位在名字里 。 |
| `mtime_ms` | INTEGER | NOT NULL | 唯一口径的修改时刻 ： BigInt mtimeNs / 1_000_000n （截断）。 判"文件被外部改过"就比它。 注意它与 asset.content_created_at_ms 是两件事 —— 这个用于判过期， |
| `width / height` | INTEGER | NULL INDEX(w) | v1.1 新增 （对齐 Immich 的 width / height ）。 只对 role='image' 有值。 必须是整数，不能是 "1920 × 1440" 字符串 —— 字符串不能排序、不能筛"≥4K"。原型的 |
| `thumb_hash` | BLOB | NULL | v1.1 新增 （对齐 Immich 的 thumbhash ）。 约 25 字节的占位图哈希 （只对 role='image' ）。 网格先用它画出模糊色块、再渐进换真图 ⇒ 瀑布流首屏不用等任何缩略图 。对几千张图的 |
| `content_hash_kind` | TEXT | NULL CHECK sha1/sha256 | v1.1 新增，成对出现 （对齐 Immich 的 checksumAlgorithm ）。 一个裸哈希在换算法后无法解释 ——你必须知道它是怎么算出来的。 |
| `content_hash_value` | TEXT | NULL 偏索引 | 内容哈希值。 惰性计算 ——只在体检查重复时算，不扫描时算。 全库算一遍要读几十 GB，不能塞进日常路径。 与 kind 是一对，缺一不可。 |

## asset_name_fts  [本轮]

（无字段行；此卡不是数据表）

## asset_index_state  [本轮]  · 字段 10

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | PK FK asset.uid CASCADE | 1:1。主键即外键，不需要额外关联表。 |
| `encoded_at_ms` | INTEGER | NULL 偏索引 | 编码成功时刻。 NULL = 从未成功。 偏索引 WHERE encoded_at_ms IS NULL ⇒ "待编码/失败"筛选是索引查找而非全表扫。 |
| `encoded_mtime_ms` | INTEGER | NULL | 编码那一刻该文件的 mtime 快照。 这是判"文件改过没有"的基准 —— 存快照，不存布尔 ，因为快照还能回答"何时改的"。 |
| `compat_key` | TEXT | NULL | 编码时用的 8 段兼容键。与库当前 compat 不等 ⇒ 模型换了，向量不在同一语义空间 。 |
| `needs_reencode` | INTEGER | NOT NULL CHECK 0/1 DEFAULT 0 偏索引 | 唯一一处物化。 由扫描器顺手维护（它本来就要 stat 每个文件）。 偏索引 WHERE needs_reencode = 1 ⇒ 只索引异常的那几十行。 |
| `attempt_count` | INTEGER | NOT NULL DEFAULT 0 | 累计尝试次数。 失败 3 次后不再自动重试 ——避免一个坏文件每次建索引都拖慢一遍。 |
| `last_error` | TEXT | NULL | 上次失败原因， 存人话不存错误码 。直接显示给用户，前端不再翻译一次。 |
| `last_error_at_ms` | INTEGER | NULL | 上次失败时刻。 与 encoded_at_ms 并存合法 ： "三天前成功过、今天重编码失败"是真实状态。 |
| `excluded_at_ms` | INTEGER | NULL 偏索引 | 用户手动排除索引的时刻。 本表唯一完全不可再生的字段。 判定优先级最高——你的选择不该被任何系统推断覆盖。 |
| `checked_at_ms` | INTEGER | NULL | 上次 差分扫描 的时刻。界面据此显示"这个状态基于何时"， 避免"库里显示已编码、其实文件三个月前就被换过"这种静默错误。 |

## job  [v1.2 新增]  · 字段 11

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `job_id` | TEXT | PK | nanoid。 |
| `kind` | TEXT | NOT NULL CHECK 枚举 | scan / index / health / rebuild / ingest 。 |
| `state` | TEXT | NOT NULL CHECK 枚举 偏索引 | queued / running / done / failed / cancelled 。 |
| `progress_done` | INTEGER | NOT NULL DEFAULT 0 | 已完成数。 只增不减 ——"进度单调"这条规格在字段层的落点。 |
| `progress_total` | INTEGER | NULL | 总数。可空：扫描前还不知道有多少， 不要为了显示百分比编一个 。 |
| `phase` | TEXT | NULL | 当前子阶段（"统计文件" / "编码第 3 批"）。 "不静默"的意思是这条会变 ，而不是只有一个转圈。 |
| `cursor_json` | TEXT | NULL | 断点续跑位置 （如最后处理成功的 rel_path ）。 崩溃后重启从这继续，而不是从头再来一遍 3594 条。 |
| `heartbeat_at_ms` | INTEGER | NULL | 崩溃检测的关键。 运行中定期刷新。 启动时把" running 但心跳已过期"的任务判为 failed —— 否则它会永远卡在"运行中" ， 界面永远显示一个不存在的进度。 |
| `summary_json` | TEXT | NULL | 结束时的统计（新增 / 缺失 / 失败各多少）。 |
| `error` | TEXT | NULL | 失败原因。 存人话 ，直接可显示。 |
| `queued_at_ms / started_at_ms / finished_at_ms` | INTEGER | NULL | 三个时刻。 finished - started 就是实际耗时，用于"还要多久"的估算。 |

## health_run / health_finding  [v1.2 新增]  · 字段 14

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `run_id` | TEXT | PK | nanoid。 |
| `job_id` | TEXT | FK job NULL | 关联任务 ⇒ 体检的进度与取消复用同一套任务机制， 不另写一份 （P1）。 |
| `state` | TEXT | CHECK 枚举 | running / done / failed / cancelled 。 |
| `started_at_ms / finished_at_ms` | INTEGER | NULL | 起止时刻。 |
| `summary_json` | TEXT | NULL | 各检查的计数（用于体检页的概览与图表）。 |
| `finding_id` | INTEGER | PK AUTOINCREMENT | 自增。这条流水 不需要跨库唯一 ，用整数最省（与条目 id 不同）。 |
| `run_id` | TEXT | FK health_run CASCADE | 哪一次体检发现的。 |
| `check_id` | TEXT | NOT NULL | missing-archive / dup-exact / ext-mismatch / state-cache-drift / excluded-stale / zero-byte 等。 state-cache-dri |
| `severity` | TEXT | CHECK info/warn/error | 严重度。 与索引状态的语气体同一套词 ，不另造一套。 |
| `target_uid` | TEXT | NULL | 涉及哪条素材（如果是一条）。 |
| `target_rel_path` | TEXT | NULL | 涉及哪个路径（如果不成条目，例如孤儿压缩包）。 |
| `detail` | TEXT | NOT NULL | 人话说明 ，直接显示（与 activity 相反： 这里是引擎给的诊断结论，本身就是唯一来源，不存在"第二份渲染"）。 |
| `detail_json` | TEXT | NULL | 结构化明细，用于导出 CSV 与"跳转到该条"。 |
| `created_at_ms` | INTEGER | NOT NULL | 发现时刻。 |

**附加（health_run / health_finding 卡内第 2 张表）**：
- finding_id —— INTEGER PK AUTOINCREMENT 自增。这条流水 不需要跨库唯一 ，用整数最省（与条目 id 不同）。
- run_id —— TEXT FK health_run CASCADE 哪一次体检发现的。
- check_id —— TEXT NOT NULL missing-archive / dup-exact / ext-mismatch / state-cache-drift / excluded-stale / zero-byte 等。 state-cache-drift 就是我上一版承诺的对账检查 —— 重算全库 n
- severity —— TEXT CHECK info/warn/error 严重度。 与索引状态的语气体同一套词 ，不另造一套。
- target_uid —— TEXT NULL 涉及哪条素材（如果是一条）。
- target_rel_path —— TEXT NULL 涉及哪个路径（如果不成条目，例如孤儿压缩包）。
- detail —— TEXT NOT NULL 人话说明 ，直接显示（与 activity 相反： 这里是引擎给的诊断结论，本身就是唯一来源，不存在"第二份渲染"）。
- detail_json —— TEXT NULL 结构化明细，用于导出 CSV 与"跳转到该条"。
- created_at_ms —— INTEGER NOT NULL 发现时刻。

## recent_view  [v1.2 新增]  · 字段 3

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | PK FK asset.uid CASCADE | uid 就是主键 ——同一条看多次只保留最后一次，天然去重，不需要额外的唯一约束或清理逻辑。 |
| `viewed_at_ms` | INTEGER | NOT NULL INDEX DESC | 最后查看时刻。 |
| `view_count` | INTEGER | NOT NULL DEFAULT 1 | 看了几次。用于把"反复看的"排前面—— 这比单纯按时间排更有用 。 |

## asset_user_meta  [本轮]  · 字段 5

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | PK FK asset.uid CASCADE | 1:1。没有行 = 还没被标注过（合法状态，不是缺失）。 |
| `rating` | INTEGER | NULL CHECK 1..5 | 用 NULL 表示未评分，不用 0 —— 0 会让你分不清"没评"和"评了零分"，而后者语义上不存在。范围写进 CHECK。 |
| `note` | TEXT | NULL | 自由备注。不设长度上限——截断是界面的事，不是存储的事。 |
| `updated_at_ms` | INTEGER | NOT NULL | 最后编辑时刻。 |
| `is_favorite` | INTEGER | NOT NULL CHECK 0/1 DEFAULT 0 偏索引 | v1.1 新增 （对齐 Immich 的 isFavorite ）。 收藏是一列布尔，不是一张关联表 ——它是比特级的用户意图，而"筛收藏"是高频查询。 偏索引 WHERE is_favorite = 1 。 |

## asset_export  [v1.2 改名]  · 字段 9

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `export_id` | TEXT | PK | nanoid。 |
| `kind` | TEXT | NOT NULL CHECK collect/deliver | 取件 vs 交付。 两者共用同一张表，因为它们的结果分类、目标目录语义、 "跳过原因"结构完全相同。 |
| `uid` | TEXT | NULL FK asset.uid SET NULL | 可空 + SET NULL，不是 NO CASCADE。 条目被彻底删除后置空—— "我导出过它"这件事仍然成立 ， 但也不该留着外键挡住建素材的删除。 |
| `asset_name` | TEXT | NOT NULL | 导出那一刻的名字快照。 这是"历史记录表"的标准做法： 反范式存快照 ， 这样条目改名或被删后，历史里看到的仍是当时的名字，而不会变成一个空 uid。 |
| `batch_id` | TEXT | NULL 偏索引 | 同一次批量操作的 id（复用 activity.activity_id ）。 用于"撤销上一次批量导出"与把 12 行归成一条历史。 不能建外键 —— activity 在应用级 DB，跨库无外键。 |
| `target_dir` | TEXT | NOT NULL | 导出到哪个白名单目录。 |
| `result` | TEXT | CHECK copied/skipped/failed | SPEC §3 F6 要的三分类 。取件也共用这套词—— "已存在所以跳过"在两种动作里都是同一件事。 |
| `reason` | TEXT | NULL | 跳过/失败的具体原因，人话。 |
| `at_ms` | INTEGER | NOT NULL | 发生时刻。 |

**附加（asset_export 卡内第 2 张表）**：
- idx_export_uid (uid, at_ms DESC) 详情页显示"这条被导出过几次、最近一次何时"， 也是"是否已交付"的推导来 —— 导出历史列表。

## tag  [本轮]  · 字段 3

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `tag_id` | TEXT | PK | nanoid。 不用自增 ：跨库合并标签时会撞。 |
| `name` | TEXT | NOT NULL UNIQUE | 单用户 ⇒ 唯一约束只到 name ， 不需要 Immich 的 (userId, value) 复合唯一。 |
| `created_at_ms` | INTEGER | NOT NULL | 用于"最近用的标签"排序——比字母序有用得多。 |

## asset_tag  [本轮]  · 字段 3

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `uid` | TEXT | FK asset.uid PK(1/2) CASCADE | 与 tag_id 组成复合主键 ⇒ 天然防止同一标签重复贴在同一条上 。 |
| `tag_id` | TEXT | FK tag PK(2/2) CASCADE | 标签。 |
| `added_at_ms` | INTEGER | NOT NULL | 贴上时刻。 |

## collection / collection_item  [本轮]  · 字段 7

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `collection_id` | TEXT | PK | nanoid。 |
| `name` | TEXT | NOT NULL | 不加 UNIQUE ——同名集合合理（去年与今年的提案可以同名）。 |
| `note` | TEXT | NULL | 集合级备注。 |
| `created_at_ms / updated_at_ms` | INTEGER | NOT NULL | 创建 / 修改时刻。 |
| `collection_id` | TEXT | FK collection PK(1/2) CASCADE | 集合。 |
| `uid` | TEXT | FK asset.uid PK(2/2) CASCADE | 条目。 |
| `added_at_ms` | INTEGER | NOT NULL | 加入时刻，也是默认排序键。 |

**附加（collection / collection_item 卡内第 2 张表）**：
- collection_id —— TEXT FK collection PK(1/2) CASCADE 集合。
- uid —— TEXT FK asset.uid PK(2/2) CASCADE 条目。
- added_at_ms —— INTEGER NOT NULL 加入时刻，也是默认排序键。

**附加（collection / collection_item 卡内第 3 张表）**：
- PRIMARY KEY (collection_id, uid) —— 「集合里有哪些」+ 防重复加入。
- idx_collection_item_uid (uid) —— 「这条被哪些集合收了」——详情页要显示它。

## 导出格式（版本化 JSON）  [v1.2]

（无字段行；此卡不是数据表）

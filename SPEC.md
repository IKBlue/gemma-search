# SPEC.md · 规格书（行为与阈值的唯一出处）

> 做成什么样、怎么验收。**改本文件 = 改需求。**
> 最后核对：2026-10-15 · 配套：[`/AGENTS.md`](/AGENTS.md)（规范）· [`/PLAN.md`](/PLAN.md)（顺序）· [`/TASKS.md`](/TASKS.md)（动作）

## 0. 定位

| 项 | 值 |
|---|---|
| 这是什么 | 一个**离线**的本地素材库 + 文档检索桌面应用；用一句话或一张图找到东西，并把它取出来 |
| 给谁用 | 要**分发给别人**：干净机器上装得上、启动得起来；模型由用户自备，缺模型时给明确指引 |
| 形态 | Electron 桌面应用；**单进程内跑检索**，不联网、不上传、不接云服务 |
| 本文件权威范围 | 功能行为 · 数据模型 · 存储布局 · 界面基线 · 契约形状 · 非功能口径 · **验收阈值** |

**范围边界（明确不做）**

| 不做 | 为什么 |
|---|---|
| **OCR**（扫描件/纯图片 PDF） | 只处理可抽取文本；抽不到就如实说「无法提取文本」，不假装支持 |
| **生成式回答（LLM）** | 文档检索只做**定位**：给最相关片段 + 出处，由人自己读 |
| **云服务 / 联网** | 全离线；模型与索引都在本机 |
| **解析压缩包内容** | 不抽取 zip/rar/7z 内的文档；包只作为「可交付的素材」被复制 |
| **DWG/DXF 文本检索** | 不纳入检索（抽取困难）；在体检里只做「存在性/大小」登记 |

> 🔒 **门控项（2026-10-14 复核）**：**多库合并检索（F4 的合并部分）** 与 **文档检索（F7）** 不是"先做"的部分。
> 进入条件：① 文档检索 —— 先有 **10–30 份真实文档**并证明可用；② 多库合并 —— **真的有第二个库**。
> 在此之前：登记/切换（F4 的注册表部分）可以做，抽取链路可以搭，但**不投重资源**。

---

## 1. 数据模型

> **2026-10-15 所有者批准设计基线**（`reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md`；HTML 版 `prototypes/DESIGN-6tables.html`）。
> 本轮**只建 6 张表**（所有者裁定 B · `TASKS §4 U19/U20`），其余随功能上线。
> ⚠️ **旧设计已废弃**：`items` 18 字段宽表 · `library` 表 · 文档三表 · 体检两表 —— **不再出现在本规格里**（第二批名单见 §1.6）。

### 1.1 总览：两个数据库 · 6 张表 · 四层持久性

| 层 | 表 | 落在 | 丢了会怎样 |
|---|---|---|---|
| **事实** | `asset` · `asset_file` | 库级 `.gs.db` | 可丢：扫描素材即可重建 |
| **过程** | `asset_index_state` | 库级 `.gs.db` | 尽量留：丢了要重编码（能重算） |
| **意图** | （本轮为空） | 库级 `.gs.db` | **必须留**：用户自己做的，丢了不可再生 |
| **应用** | `app_meta` · `library_registry` · `collect_dir` | 应用级 `userData/app.db` | 不参与库级重建 |

- **物理落点与层一一对应**：库级 3 张 + 迁移账本 `schema_version`；应用级 3 张（`app_meta` **兼应用级账本**）。
- ⚠️ **跨库外键不存在**（SQLite 无此能力）：`asset.lib_id` 是普通 TEXT，**不做** REFERENCES —— 这是"两个数据库"划分的必然代价。
- 每张表的**唯一写入口**见 §5.2；迁移机制与四层分类的实现见 `main/db/{migration-engine,schema-layers}.ts`。

### 1.2 库级 `<库根>/.gs.db`（3 张）

#### `asset` —— 条目（一个条目 = 一张预览图 + 可选同名包）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `uid` | TEXT PK | 12 位小写 hex；**扫描时匹配认领**（先按 `(lib_id, rel_path)` 命中就保留原 uid） |
| `lib_id` | TEXT NOT NULL | 所属库（**普通 TEXT，无外键**） |
| `folder` | TEXT NOT NULL | 分类目录（浏览与筛选的主维度） |
| `stem` | TEXT NOT NULL | 文件名主干（配对靠它；唯一来源在扫描器） |
| `display_name` | TEXT NOT NULL | 界面显示名（默认 = 主干 + 扩展名，可改，**不改磁盘**） |
| `rel_dir` | TEXT NOT NULL | 相对目录的**规范形**（库根 ⇒ 空串） |
| `rel_path` | TEXT NOT NULL | 相对路径（**扫描匹配与唯一性的落点**） |
| `discovered_at_ms` | INTEGER NOT NULL | 首次被发现时刻 |

- **唯一约束**：`UNIQUE (lib_id, rel_path)` —— 防止同一个文件被登记两次（uid 不再由路径派生，路径唯一性必须**显式声明**）。
- **索引**：`idx_asset_lib_folder (lib_id, folder)` · `idx_asset_stem (stem)`。
- **本批刻意不加的列**（随功能上线）：`deleted_at_ms`（回收站）· `dup_group_id`（重复分组）· `content_created_at_ms`（按内容时间浏览）。加列 = **一条迁移**。
- `uid` 的 12-hex 形状与 `rel_dir` 的规范形由**唯一写入口**（扫描器）保证，DDL 只保证 NOT NULL —— 约束集以设计基线 §1.2 为准。

#### `asset_file` —— 文件角色（**缺包 = 少一行**，不是一个 NULL 块）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `uid` | TEXT NOT NULL, **REFERENCES asset(uid) ON DELETE CASCADE** | 同库外键 ✅ |
| `role` | TEXT NOT NULL, CHECK in (`preview`,`archive`) | 预览图 / 同名包 |
| `rel_path` | TEXT NOT NULL | 相对路径 |
| `ext` | TEXT NOT NULL | 扩展名 |
| `size_bytes` | INTEGER NOT NULL | 大小（扫描事实） |
| `mtime_ms` | INTEGER NOT NULL | 修改时刻（**统一口径**：`BigInt mtimeNs / 1_000_000n` 截断，全库唯一写入口） |
| `width` · `height` | INTEGER NULL | 像素尺寸（只有 `role='preview'` 有值；**扫描就能拿到** ⇒ 现在就存，免得以后重扫） |

- **主键**：`PRIMARY KEY (uid, role)` · **索引**：`idx_asset_file_path (rel_path)`。
- **本批不加**：`thumb_hash`（首屏占位图，UI 增强）· `content_hash_kind/value`（去重功能，且要真算哈希）。

#### `asset_index_state` —— 索引状态（**存时刻，不存枚举**）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `uid` | TEXT PK, **REFERENCES asset(uid) ON DELETE CASCADE** | 1:1 于条目 |
| `encoded_at_ms` | INTEGER NULL | **成功编码时刻**；NULL = 从未成功 |
| `encoded_mtime_ms` | INTEGER NULL | 编码时该文件的 mtime ⇒ 与当前 mtime 不等 = **待重编码（算出来的，不是存的）** |
| `compat_key` | TEXT NULL | 编码时用的兼容键 ⇒ 与库的 `compat_key` 不等 = 待重编码（模型换了） |
| `vector_row` | INTEGER NULL | **该条目在 `.gs-index.bin` 里的行号**（索引任务写）。GSIDX 是**稠密矩阵**，引擎靠它把命中行映射回条目 —— 没有它索引与条目对不上（2026-10-15 绿地修正） |
| `attempt_count` | INTEGER NOT NULL DEFAULT 0 | 尝试次数 |
| `last_error` · `last_error_at_ms` | TEXT · INTEGER NULL | 失败原因（没有它，「编码失败」这一档无法解释） |
| `excluded_at_ms` | INTEGER NULL | 用户**主动排除**索引（意图，优先级最高） |
| `checked_at_ms` | INTEGER NULL | 上次核对时刻（界面要能说「这是上次已知状态，可能过期」） |

- **索引**：`idx_state_pending (encoded_at_ms) WHERE encoded_at_ms IS NULL` · `idx_state_excluded (excluded_at_ms) WHERE excluded_at_ms IS NOT NULL`。
- **状态 8 档全部派生**（一个字都不存）：已排除 > 编码失败 > 编码中 > 图片丢失 > 已移除 > 待重编码 > 待编码 > 已编码。
- **本批不物化 `needs_reencode`**：跨表比较无法索引；等浏览页要筛再加列 + 对账检查（一条迁移）。

### 1.3 应用级 `userData/app.db`（3 张）

#### `app_meta` —— 版本与迁移账本（1 行，id=1）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `id` | INTEGER PK, CHECK (`id = 1`) | 单行守卫（不变式由 CHECK 保证，不靠调用方自觉） |
| `schema_version` | INTEGER NOT NULL, CHECK (`>= 0`) | 应用级迁移版本；**只有这一处真相** |
| `created_at_ms` · `updated_at_ms` | INTEGER NOT NULL | 建立 / 上次迁移时刻 |

#### `library_registry` —— 库注册表

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `lib_id` | TEXT PK | 库标识（1–32 字符）；写进 uid 派生公式 ⇒ **一旦分配不可改** |
| `root` | TEXT NOT NULL **UNIQUE** | 库根绝对路径；登记前**规范化**（大小写 / 8.3 短名 / 尾斜杠 / 分隔符），否则 Windows 上同一目录能登两次 |
| `display_name` | TEXT NOT NULL | 界面显示名（名字是你的，路径是事实） |
| `enabled` | INTEGER NOT NULL DEFAULT 1, CHECK in (0,1) | 是否参与检索/入库；**停用不动任何文件** |
| `compat_key` | TEXT NULL | 这个库的索引是用哪套兼容键建的（合并检索的门限） |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | 侧栏顺序（同值按 `lib_id` 兜底，保证稳定） |
| `registered_at_ms` · `updated_at_ms` | INTEGER NOT NULL | 登记 / 修改时刻 |

- **索引**：`idx_library_registry_sort (sort_order, lib_id)`。

#### `collect_dir` —— 取件白名单（**安全边界**）

| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `dir_id` | TEXT PK | nanoid |
| `label` | TEXT NOT NULL **UNIQUE** | 目录名（界面显示） |
| `abs_path` | TEXT NOT NULL | **取件只允许写进这些目录**，其余一律拒绝 |
| `is_default` | INTEGER NOT NULL DEFAULT 0, CHECK in (0,1) | 默认取件目标 |
| `created_at_ms` | INTEGER NOT NULL | 加入时刻 |

- **偏唯一索引（只允许一个默认）**：`uniq_collect_default ON collect_dir ((1)) WHERE is_default = 1`。

### 1.4 向量与索引

| 项 | 值 |
|---|---|
| 模型 | `onnx-community/embeddinggemma-2-ONNX`（fp32，多模态） |
| 维度 / 归一化 / 池化 | **768** · L2 · mean_soft_tokens |
| 图像 soft token 预算 | `seq = 140`（换档必须**全量重建索引**） |
| 查询前缀 | `task: search result | query: `（查询文本必须带） |
| 文档前缀 | `title: none | text: `（**文档与分块编码必须带**，否则与图像不在同一语义区） |
| 精度 | fp32；**换精度必须重建并重测** |

**`compat` 键**（只有相等才能合并检索）：`模型仓库 \| revision \| dtype \| preprocessing_version \| seq \| dim \| normalization \| pooling`（8 段，与现有实现一致）。

### 1.5 库

| 项 | 值 |
|---|---|
| 库根 | 素材库目录（示例：`G:\model`）；索引与 SQL **写在库根下**（点前缀文件） |
| 注册表落点 | **`userData/app.db` 的 `library_registry` 表**（唯一权威；`userData/library-registry.json` 退役） |
| 多库 | 可登记多个库；**默认跨库合并检索**（只合并 `compat` 相同的库），可限定单库 |
| 启用/停用 | `library_registry.enabled`；**停用不动任何文件**（不删素材、不删索引） |
| 顺序 | `library_registry.sort_order`（同值按 `lib_id` 兜底）——顺序是你的，不该由路径字母序决定 |
| `root` 规范化 | 登记前规范化（大小写 / 8.3 短名 / 尾斜杠 / 分隔符），库里**只存规范形**；否则 Windows 上同一目录能登两次（UNIQUE 是文本比较） |
| 库指纹 | 库根 + 条目数 + compat + 构建时间；用于判断「索引是否还是这个库的」 |

### 1.6 第二批（**未建表**：随功能上线，各加一条迁移）

本轮**不建**的表（表名与字段口径见提案与设计基线 §4；**不要**因为"迟早要用"提前建）：

| 归属 | 表 |
|---|---|
| 库级·事实 | `asset_name_fts`（文件名 FTS5） |
| 库级·过程 | `job`（任务台账）· `health_run` · `health_finding`（体检台账）· `recent_view` |
| 库级·意图 | `asset_user_meta` · `tag` · `asset_tag` · `collection` · `collection_item` · `asset_export` |
| 应用级 | `app_setting` · `activity` · `recent_query` |
| 🔒 门控 F7 | `doc_dir` · `document` · `doc_chunk`（文档检索；进入条件 = 先有 10–30 份真实文档） |

> **加表 = 一条迁移**（迁移机制与四层分类已就位，见 `main/db/migration-engine.ts` / `schema-layers.ts`）。
> **第二波加表会被测试逼着分类**：`db-schema.test.mjs` 强制「迁移建出的每一张表都必须在四层里被点名」（临时删一条分类 ⇒ 立即变红）。
> F7 的抽取/分块口径（PDF/DOCX/MD/TXT；不做 OCR；目标 600–900 字符/块、重叠约 12%、优先段落/句末切分、PDF 记页号）在 F7 生效时随迁移一起定稿。

---

## 2. 存储布局（唯一权威）

```
<程序目录>/
├── models/                 模型（用户自备；搜索顺序见下）
└── ...                     应用本体

<userData>/
└── app.db                  应用级 3 张：app_meta（兼应用级账本）· library_registry · collect_dir

<库根>/
├── CR\  CR+VR\  VR\  其他\        素材（**只读**）
├── .gs-index.bin           向量索引（格式见 §2.2）
├── .gs.db                  库级 3 张：asset · asset_file · asset_index_state（+ 迁移账本 schema_version）
├── .gs-journal/            事务日志（txn-*.json → archive/）
└── .gs-staging/<txnId>/    事务暂存（写入类工作流期间存在）
```

**两个数据库**

| 库 | 落点 | 内容 | 参与库级重建？ |
|---|---|---|---|
| 应用级 | `userData/app.db` | `app_meta`（兼账本）· `library_registry` · `collect_dir` | ❌ 不参与（跨库的配置与注册表） |
| 库级 | `<库根>/.gs.db` | `asset` · `asset_file` · `asset_index_state`（+ 账本 `schema_version`） | ✅ 跟着库走，**拷库即带走** |

**四层持久性（重建时怎么处理）**

| 层 | 本轮的表 | 重建规则 |
|---|---|---|
| **事实** | `asset` · `asset_file` | **丢**（可从素材扫描重建） |
| **过程** | `asset_index_state` | **留**（尽量保留；真丢了要重编码） |
| **意图** | （本轮为空） | **留**（用户自己做的，不可再生） |
| **应用** | `app_meta` · `library_registry` · `collect_dir` | **不参与库级重建**（在 userData） |

**重建规则（可断言）**：重建 = 删 `.gs.db` 家族并重建 ⇒ **丢事实层、留过程层与意图层**；重建**不得碰素材**（§2.1）；重建期间界面必须显示「正在重建元数据」，不许装作没事。

**旧库不支持升级（绿地）**：发现旧版 `.gs.db`（不在本轮 6 张表的口径内）⇒ **丢弃重建**，并**如实告知用户** —— 不许假装兼容，也不许静默就地迁移。

**模型搜索顺序**：**用户在设置里指定的路径 → 程序目录 `models/` → userData `models/`**。
都找不到 ⇒ 启动后显示明确指引（放哪、缺什么、怎么重试），**不假装可用**。
（推荐再补一键下载：校验 + 断点续传。）

> ⚠️ 2026-10-14 **所有者授权调整**：原顺序把「用户指定」放在**最后**，而用户**显式指定**的路径理应优先于程序目录自带的那份（显式覆盖 > 自带 > 默认）。
> 所有者指示：**先按新顺序实现，并挂到 P0 TODO 待办**；**等界面出来后由所有者复核**（若改回，只需调整 `storage-roots.ts` 里的一处顺序常量 + 单测）。

### 2.1 写入不变式（可断言）

> **保留命名空间**（我们自己的文件；唯一实现 `packages/engine/src/gs-names.ts`）= `.gs-*`（`.gs-index.bin` · `.gs-journal` · `.gs-write-probe-*` …）∪ **`.gs.db` 家族**（`.gs.db` / `.gs.db-wal` / `.gs.db-shm` / `.gs.db-journal`）∪ staging（`.gs-staging/`）。
> ⚠️ 2026-10-15（U11 实测）：`.gs.db` **不匹配** `.gs-*` 前缀（第 4 个字符是 `.`），三个边车同样不匹配 ⇒ **判据不许用前缀、也不许各处各写一份**。

1. 除**保留命名空间**外，**素材目录一律只读**：检索 / 浏览 / 缩略图 / 体检**零写入**。
2. 所有条目扫描（浏览、体检、入库差分）**必须跳过保留命名空间**与隐藏项。
3. `.gs.db` 是**派生数据**：损坏或版本不符时**删除重建**，不参与事务恢复。
4. 真相来源 = 素材文件 + `.gs-index.bin` + `.gs-journal/`。

### 2.2 `.gs-index.bin` 格式（GSIDX v1）

> ⚠️ 2026-10-14 按 `packages/engine/src/index.ts` 的 `readIndexBin` 逐行校对后修正：**[8,12) 是 headerLen，不是 count；header 是一段 JSON，不是固定字段**。

```
[0,8)              MAGIC = 47 53 49 44 58 00 00 01   ("GSIDX" + 版本)
[8,12)             u32 LE headerLen
[12, 12+headerLen) headerJSON（{ count, dim, … }）
[...]              向量块：count × dim × float32（行优先）
末尾               u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete }
```

**损坏判定（五道，缺一不可）**：MAGIC 不符 · footer 解析失败 · `complete !== true`（写入未完成）· footer 与 header 的 count/dim 不一致 · sha1 不符。**任一条不满足即视为损坏**，界面必须说「索引已损坏，需要重建」，不许静默给出空结果。

### 2.3 便携与迁移

- 索引里**以 `relPath` 为准**（绝对路径仅作展示与定位）；库整体搬到别的盘 ⇒ **索引仍可用**。
- 索引在库根 ⇒ 拷库即带走索引；但**模型不在库内**，换机器仍需自备模型。
- `.gs.db` 可安全删除（会重建）；**重建 = 丢事实层、留过程层与意图层**（见 §2 的四层表）；重建期间界面必须显示「正在重建元数据」，不许装作没事。
- **旧库不支持升级**：不在本轮 6 张表口径内的旧 `.gs.db` ⇒ **丢弃重建**并**如实告知**（不静默迁移）。

---

## 3. 功能规格（F1–F7）

每条格式：**输入 · 输出 · 状态 · 错误与文案 · 边界 · 验收**。错误码见 §5。

### F1 找 → 取

| 项 | 规格 |
|---|---|
| 输入 | 文本查询（中文/英文）· 以图搜图（库内条目或用户临时选的库外图片）· 向量文件（调试用） |
| 输出 | 结果列表：缩略图 · 分数 · **档位 `band`**（由引擎给，界面不得自算）· 两条路径 |
| 状态 | 空闲 / 检索中（骨架 + `aria-busy`）/ 有结果 / 无结果 / 失败 |
| 错误 | `MODEL_MISSING`（模型未就绪）· `LIB_NOT_FOUND` · `INDEX_MISSING` · `INDEX_CORRUPT` · `UID_NOT_FOUND` · `ITEM_MISSING_ON_DISK` |
| 取件 | 复制压缩包到白名单目录；**破坏性操作两段式**：请求 → 确认；取消 ⇒ **零 IPC**；确认时先清状态再执行（连点只发一次） |
| 边界 | 目标同名 ⇒ `COLLECT_TARGET_EXISTS`（不覆盖、不改名）；目录不在白名单 ⇒ `COLLECT_DIR_NOT_ALLOWED`；磁盘不足 ⇒ `DISK_FULL`（预检，未开始写） |
| 验收 | 文本/图像查询都能出结果；取件成功 = 目标字节与源一致 + 源未被改动；取消确认框后**零写入**；定位按钮文案只说「已请求定位（系统未回报结果）」 |

### F2 逛（浏览整库）

| 项 | 规格 |
|---|---|
| 输入 | 无查询；筛选（分类目录 / 扩展名 / 有无包 / 尺寸区间 / 时间区间）· 排序（名称/大小/时间/分类型）· 分页或虚拟滚动 |
| 输出 | 网格 + 结果计数 + 当前筛选条件（可清除） |
| 状态 | 加载中 / 有内容 / 空结果 / 失败 |
| 边界 | 全库 3594 条量级；**不得一次性渲染全部**（虚拟滚动或分页，二者选一实现） |
| 验收 | 筛选与排序由 SQL 完成（不加载全量 JSON）；滚动不卡；计数与实际一致 |

### F3 收（入库 / 增量 / 建索引）

> ⏳ **第二批**：`ingest` / `mutate` 方法与 `job` 表随功能上线（§1.6）；本轮**不建这些表、也不开这些方法**。事务文件机制（`.gs-journal/` · `.gs-staging/`）仍在，下面写的是目标口径。

| 项 | 规格 |
|---|---|
| 输入 | 一个或多个源目录（库外）· 目标库 · 是否移动/复制 |
| 输出 | 进度（阶段 + 已完成/总数 + 失败项可展开）· 结果摘要 |
| 事务纪律 | **必须走已实现的四步事务**：PREPARED → STAGED → VERIFIED → COMMITTED → CLEANED；日志写 `.gs-journal/`，暂存写 `.gs-staging/<txnId>/` |
| 两条铁律 | ① **索引更新失败 ⇒ 源文件绝不删**；② 目标已存在且**字节不同** ⇒ 拒绝、一个字节都不动（字节相同 ⇒ 视为已命中并跳过） |
| 崩溃恢复 | 启动时扫描 journal：非终态事务按恢复判定表**前进 / 回退 / 停下问人**；`RECOVERY_NEEDED` 必须让用户看见 |
| 错误 | `DISK_FULL`（预检，PREPARED 之前）· `RECOVERY_NEEDED` · `PATH_ESCAPES_LIB` · `SYMLINK_REJECTED` · `JOB_BUSY` |
| 边界 | 不解析压缩包内容；跨卷移动按「复制→校验→删源」；同名冲突按铁律② |
| 验收 | 7 步走完：目标字节一致 + 源已删 + 索引恰好更新一次 + staging 已清；**故障注入**（进程被杀）后重启能给出正确的前进/回退/问人判定 |

### F4 多库

> 🔒 **合并检索是门控项**：进入条件 = **真有第二个库**。注册表 / 启用停用 / 切换属于 P1，可先做。

| 项 | 规格 |
|---|---|
| 输入 | 登记 / 移除库（库根路径）· 启用/停用 · 选择检索范围 |
| 输出 | 库列表（路径 · 条目数 · compat · 索引状态 · 指纹） |
| 合并规则 | **只有 compat 相同的库能合并检索**；不兼容的库**跳过并给出原因**（结构化原因，不是静默丢弃） |
| 错误 | `LIB_ROOT_MISSING`（盘符变了/盘没挂载）· `INDEX_MISSING` · `COMPAT_MISMATCH` |
| 验收 | 故意登记一个 seq 不一致的库 ⇒ 被排除且原因可见；移除库不删任何文件 |

### F5 体检

> ⏳ **第二批（部分）**：体检**台账**表（`health_run` / `health_finding`）随第二批；「精确 / 疑似重复」还依赖 `asset_file` 本批**刻意未加**的内容哈希列（§1.2）。
> ✅ **保留**：即时体检 **`libraryHealth`** 与 **`libraryRebuild`** —— 它们只读 `.gs-index.bin` / `.gs.db`，**不依赖**未建的表（见 §5.1 · U21）。下面的检查项是目标口径。

| 项 | 规格 |
|---|---|
| 检查项 | ① **精确重复**（同 sha1）② **疑似重复**（向量近邻，阈值可配，默认列出 top-N 供人工判断）③ **缺包**（有图无包）④ **有包无图** ⑤ **零字节文件** ⑥ **扩展名与内容不符**（读魔数）⑦ **索引健康**（五道校验 + 条目数与索引行数一致） |
| 输出 | 按检查项分组的清单，每条可跳转到对应条目；**导出报告**（json/csv） |
| 边界 | **只读**：体检绝不改动、移动、删除任何素材 |
| 验收 | 对现有库实测：缺包 0 / 有包无图 0 / **扩展名与内容不符共 105 条** —— 其中 **`.jpg` 实为 BMP = 20**（已知且合法，走 `bmp-fallback`）、**`.png` 实为 JPEG = 68**、**`.jpg` 实为 PNG = 17**。⇒ **体检基准是 105**；沿用「20」会漏报 85 条（2026-10-15 所有者批准校准，实测见 `reports/2026-10-15-wave3/13a.txt`） |

### F6 交付（把东西给出去）

| 项 | 规格 |
|---|---|
| 输入 | 选中的条目集合 · 目标目录 |
| 输出 | 目标目录里出现：**压缩包 + 同名预览图**（别人不装本软件也能看） |
| 规则 | 默认**复制**（不移动）；同名冲突：**不覆盖**，跳过并在结果里列出；预检磁盘空间 |
| 状态 | 进度可取消；结果含「已复制 / 已跳过（原因）/ 失败（原因）」三分类 |
| 验收 | 选中 N 条 ⇒ 复制 N 个包 + N 张图（缺包的条目只复制图并如实标注）；不产生任何删除 |

### F7 文档检索（只定位，不生成）

> ⏳ **表进第二批**：`doc_dir` / `document` / `doc_chunk` 本轮不建（§1.6）；门控进入条件不变。

> 🔒 **门控项**：进入条件 = **先拿到 10–30 份真实文档**并确认格式分布（当前本机没有文档语料）。

| 项 | 规格 |
|---|---|
| 输入 | 登记一个或多个**本地目录**（PDF/DOCX/MD/TXT）· 查询文本 |
| 输出 | 分块列表：**片段文本** + **出处**（文件路径 + 页码/章节，能取到就取）+ 分数 + band |
| 编码 | 文档与分块必须用 **document_prefix** 编码；查询用 **query_prefix**；与图像**同一 768 维空间** |
| 索引 | 分块向量追加进同一向量索引（或按库分文件）；在 SQL 里记录每块对应的**向量行号**（列名随 F7 的迁移定） |
| 状态 | 抽取中 / 建索引中（可取消）/ 就绪 / 无结果 |
| 错误 | 抽取失败 ⇒ `unextractable`（保留条目并显示原因）；模型缺失 ⇒ `MODEL_MISSING` |
| 边界 | **不做 OCR**；不生成答案；不联网 |
| 验收 | 用 10–30 份真实文档：查询能命中正确文件与片段；点出处能打开文件；**召回排序不得把图像结果混进去**（同空间但分模态展示） |

---

## 4. 界面规格

**信息架构**：左侧栏（检索 / 浏览 / 文档 / 任务 / 操作记录 / 设置）+ 主区。窗口标题随路由变。

**路由**（hash）：`/` 检索 · `/browse` 浏览 · `/docs` 文档检索 · `/item/:libId/:uid` 详情 · `/tasks` 任务 · `/activity` 操作记录 · `/settings` 设置。

**Apple HIG（macOS 桌面口径）基线**

| 项 | 阈值 |
|---|---|
| 命中区 | ≥ **44×44 px**（桌面口径） |
| 正文对比度 | ≥ **4.5:1**；非文字图形（圆点/图标）≥ **3:1** |
| 焦点可见 | 必须可见，且不改动元素自身圆角 |
| 动效 | 尊重 `prefers-reduced-motion`；不做进入动画与悬停位移 |
| 材质 | 顶栏毛玻璃；尊重 reduce-transparency / increase-contrast |
| 文案 | 用户语言；不出现内部术语与 undefined；错误文案不自动消失 |

**可访问性**：`role`/`aria-*` 正确；破坏性确认框用 `alertdialog` + 焦点陷阱 + ESC + 焦点归还（**默认焦点停在安全一侧**）；四档状态色不得只靠颜色区分。

---

## 5. 契约（引擎 / IPC）

**信封**：所有方法返回 `{ok:true,data,warnings}` 或 `{ok:false,error:{code,message,userMessage,details?}}`；**永不抛异常给调用方**；`userMessage` **恒非空且不含绝对路径**。

**通道**：2 条 IPC（`engine:invoke` · `engine:event`）；方法白名单见 `shared/ipc.ts`（**唯一来源**）。

### 5.1 方法表（按设计基线 §2.2 重列；**唯一来源仍是 `shared/ipc.ts`**）

**保留（形状不变，改读新表）**：`search` · `item` · `itemPaths` · `scan` · `indexStatus` · `reveal` · `collect` · `libraryPickDir` · `libraryAdd`

**改造**（读/写哪张表变了；参数形状不变）

| 方法 | 变化 |
|---|---|
| `libraryConfig` → **`libraryList`** | 库列表改读 `library_registry`（含 `enabled` / `compat_key` / `sort_order`）；`userData/library-registry.json` 退役 |
| `scan` | 写 `asset` + `asset_file`（**扫描是文件事实的唯一写入口**） |
| `item` · `itemPaths` | 读 `asset` + `asset_file`（旧 `items` 宽表口径**废弃**） |
| `indexStatus` | 读 `asset_index_state`（状态由时刻**派生**，不存枚举） |
| `collect` | 目标白名单改读 `collect_dir` |

**新增**：`librarySetEnabled` · `libraryReorder` · `libraryRemove` · `collectDirs` · `collectDirAdd` · `collectDirRemove` · `collectDirSetDefault` · `appMeta`（诊断页显示应用级版本）

**删除**（对应的表本轮不存在 ⇒ **不为不存在的表开接口**）

- 6 个诚实桩：`ingest` · `mutate` · `transactions` · `indexStart` · `indexCancel` · `indexResume`
- 文档类方法（F7 门控；表进第二批）

**保留（既有能力，不依赖未建的表）** —— 2026-10-15 Lead 裁定 **U21**

- **`libraryHealth`**：即时体检**只读** `.gs-index.bin` 与 `.gs.db`（那 6 张表）⇒ 随第二批的是**体检台账**（`health_run` / `health_finding`），**不是体检本身**。
- **`libraryRebuild`**：删库重建仍按 §2 执行 —— **事实层由「重新扫描库根」重新得到**（`items.json` **不是**事实来源，它只是旧口径的载体，仅作 S2 的 100 条取样输入）；重建写那 6 张表，**不依赖**任何第二批的表。
  ⚠️ 删掉它等于撤掉 **A11「用户能自救」**（而 T-42 刚把「真机重建走不通」修好）。

> **体检与重建仍以既有 IPC 方法暴露**（`libraryHealth` / `libraryRebuild`，U21）；随第二批的只是**体检台账表**（`health_run` / `health_finding`）。`.gs.db` 仍可安全删除并按 §2 的四层规则重建。

### 5.2 每张表的**唯一写入口**（防漂移）

| 表 | 谁能写 |
|---|---|
| `library_registry` | 只为 `library*` 那组方法 |
| `collect_dir` | 只为 `collectDir*` 那组方法 |
| `asset` · `asset_file` | **只有扫描**（`scan`）；索引任务**只**写 `asset_index_state` |
| `asset_index_state` | **只有索引任务**；`excluded_at_ms` 另由用户的排除操作写 |
| `app_meta` | 只有迁移 |

**错误码（27 个：新增=兼容，改名=破坏性）**

**本轮仍会产生（23 个）**：`BAD_REQUEST` · `LIB_NOT_FOUND` · `LIB_ROOT_MISSING` · `INDEX_MISSING` · `INDEX_CORRUPT` · `UID_NOT_FOUND` · `ITEM_MISSING_ON_DISK` · `COMPAT_MISMATCH` · `PATH_ESCAPES_LIB` · `SYMLINK_REJECTED` · `COLLECT_DIR_NOT_ALLOWED` · `COLLECT_TARGET_EXISTS` · `DISK_FULL` · `MODEL_MISSING` · `PORT_MISSING` · `INTERNAL`
**元数据导入 / 重建一族（2026-10-15 新增 · 属兼容）**：`IMPORT_FAILED` · `IMPORT_INPUT_INVALID` · `IMPORT_SOURCE_INVALID` · `IMPORT_INDEX_UNREADABLE` · `IMPORT_RECORD_INVALID` · `IMPORT_DUPLICATE_UID` · `IMPORT_COUNT_MISMATCH`。
语义 = **元数据导入/重建阶段的失败**（含临时目录或库根不可写）；
⚠️ **不得归成 `INDEX_CORRUPT`**（索引并没有坏）—— 那是**假因果**：用户会看到「索引文件已损坏」而体检说索引是好的（2026-10-15 T-15b/T-42 实测）。
用户文案：`IMPORT_FAILED` = 「重建元数据时写不进去（临时目录或库根不可写），**本次没有改动任何数据**。」

**随第二批（4 个）**：`JOB_NOT_FOUND` · `JOB_BUSY` · `RECOVERY_NEEDED` · `UNDO_EXPIRED` —— 对应 `job` 表 / 事务与撤销，那些表进第二批时一并启用。
⚠️ 它们**此刻仍在引擎的错误码联合体**里（`packages/engine/src/errors.ts`），只是**本轮 IPC 不暴露**相应方法 ⇒ SPEC 与代码**并不矛盾**：
**码在引擎里，路不在契约里**。（不主动删这些引擎码：删它们要动 `fake.ts` 与 e2e，收益为零。）

**事件**：`index.progress`（单调不减）· `index.done` · `index.failed` · `encoder.ready`（含 `device` **= 请求值** · `effectiveProvider` **= 实际，取不到就 `null`（不许猜）** · `deviceFallback` · 耗时）· `encoder.fallback`（GPU → CPU，必须显示，不许静默）。

> ⚠️ 2026-10-15（U2 实测）：`device` 曾同时被读成「请求」与「实际」两种意思。现拆开：`device` 只表示**我们请求的值**，真实执行提供者看 `effectiveProvider`（取不到就是 `null`）。依据：ORT profile 里 `device=webgpu` ⇒ `WebGpuExecutionProvider` 6192 次、`device=cpu` ⇒ `CPUExecutionProvider` 6396 次（`reports/2026-10-15-wave3/u2.txt`）。

### 5.3 `thumb://` 协议与失败状态映射

**形状**：`thumb://<libId>/<uid>@<size>`；`size` 只允许白名单值（`main/thumb-url.ts`）。**判定顺序也是契约**（形状 → 库 → 引擎 → 取路径 → 解码）。

| 情况 | 状态码 | 语义 |
|---|---|---|
| 形状 / 尺寸不合法 | **400** | 请求本身错 |
| `UID_NOT_FOUND` · `LIB_NOT_FOUND` · 库 id 还原不出 | **404** | 素材确实不在 |
| `PATH_ESCAPES_LIB` · `SYMLINK_REJECTED` | **403** | **安全拒绝**（不是「不存在」） |
| 引擎未就绪 | **503** | 稍后重试 |
| 解码失败 | **415** | 文件不是可用图片 |
| **其余（含未知码与我们自己的异常）** | **500**（`internal=true`） | **如实说「是我们的问题」** |

> ⚠️ 2026-10-15（U13 实测）：旧实现写成 `SYMLINK_REJECTED ? 403 : 404` ⇒ 把**安全拒绝**与**我们自己的 bug** 一起伪装成 404「这张图不存在」，排障线索与安全信号同时被抹平。实现与逐行用例：`main/thumb-cache.ts` + `tests/thumb-cache.test.mjs`（含「未知码 ⇒ 500 且 ≠404」）。
> 缓存：落在**数据目录**（派生数据、可删可重建），**不写素材目录**（P4）。

---

## 6. 非功能

| 维度 | 规格 |
|---|---|
| 性能 | **行为约束**：任何 >300 ms 的操作必须有进度或忙碌指示；可取消的操作**必须在边界停止**；界面在检索/索引期间不得冻结。
**实测基线**（2026-10-15 · i7-11700K · **CPU** · 非打包态 · 证据 `reports/2026-10-15-wave3/19.txt`）：库就绪 **<1s** · 编码器**懒加载**（首次检索前 ~2.7s，含模型 1.8s）· 文本检索 P50 **52ms** / P95 **62–69ms** · 图像检索 P50 **1.48s**（≈文本的 **28 倍**，视觉塔在 CPU）· 主进程内存峰值 ~**2.28 GiB**。
**验收阈值（2026-10-15 所有者批准 · 按模态分档）**：**文本 P95 ≤ 150ms** · **图像 P95 ≤ 2s** · **首次检索（含模型加载）不计入阈值**，单列展示。⇒ 两者共用一条阈值必然误判。 |
| 离线 | 全功能离线；不发起任何外部网络请求（模型由用户自备） |
| 安全 | preload 只暴露 3 个成员；渲染进程无 Node 能力、无任意路径入参；自定义协议形状受限（只接受 `libId + uid@size`）；`window.open` 与外部导航被拦 |
| 日志 | 主进程与渲染进程诊断都写文件（Windows 上 Electron 无 stdout）；日志不得含用户文件的绝对路径以外泄形式 |
| 数据安全 | 破坏性操作永远先确认；取消 ⇒ 零写入；任何写入都可回退或可重建 |

---

## 7. 验收判据（阈值唯一出处）

| # | 判据 |
|---|---|
| A1 | 7 条工作流在干净安装上都能走通（模型自备后） |
| A2 | 门禁：类型 + 单测 + 构建全绿；E2E 覆盖主流程 |
| A3 | 库内写入不变式成立：除**保留命名空间**（§2.1）外零写入（可用文件 mtime/哈希快照对比证明） |
| A4 | 事务两条铁律有故障注入证据（杀进程后恢复判定正确） |
| A5 | 索引五道校验中任意一道被破坏时，界面报「索引损坏」而不是空结果 |
| A6 | 对比度与命中区达标（真窗口量计算样式） |
| A7 | 缺模型时启动给明确指引，且不显示任何假结果 |
| A8 | 多库合并只合并 compat 相同的库，被排除的库原因可见 |
| A9 | 文档检索能给出片段与出处，且不做生成 |
| A10 | 交付只复制不删除，冲突不覆盖 |
| A11 | **重建可达且规则正确**：对损坏的 `.gs.db` 能**删库重建**，且**丢事实层、留过程层与意图层**（§2 四层表）；重建前后**素材摘要一致**（机械断言）。⚠️ 界面上的「体检结论 + 一键重建」入口随**第二批**（体检台账 = `health_run`/`health_finding`，见 §1.6） |
| A12 | **设备语义正确**：`device` = 请求值、`effectiveProvider` = 实际或 `null`；本机 GPU 不可用时界面**明说已回退**，**不许**报 webgpu（2026-10-15 U2/T-31） |
| A13 | `thumb://` 失败状态按 §5.3 映射：安全拒绝 ⇒ 403、内部异常 ⇒ 500（**不许**伪装成 404） |
| A14 | **6 张表且每张被点名**：`main/db` 的 DDL 建出的表 == §1.1 四层分类点名的 6 张（**清单从 DDL 派生、双向断言**）；表数 = 6（另加两本迁移账本：库级 `schema_version` · 应用级 `app_meta`）。**第二批加表时若忘了分类 ⇒ 该断言变红** |
| A15 | **`library_registry.root` 规范化 + UNIQUE**：同一目录的不同写法（大小写 / 8.3 短名 / 尾斜杠）**不能登记两次**（登记前规范化，库里只存规范形） |
| A16 | **旧库不升级**：不在本轮 6 张表口径内的旧 `.gs.db` ⇒ **丢弃重建并如实告知**（不静默迁移、不假装兼容） |

---

## 8. 未验证 / 未定（**不得声称可用**）

| 项 | 状态 |
|---|---|
| 冷启动耗时 | ✅ **已测**（2026-10-15 · 非打包态）：主界面可见 ~0.9s · 库就绪 <1s · 编码器懒加载 ~2.7s（证据 `19.txt`） |
| 真实缩略图协议取图 | ✅ **已测**：源码态与**打包态**都能取到（@256/@512，证据 `22a.txt`） |
| 性能数字（检索 P50/P95、内存峰值） | ✅ **已测**（文本 P50 52ms / 图像 P50 1.48s / 峰值 2.28 GiB；阈值已按模态分档，见 §6）。**索引吞吐仍待测** |
| 打包态行为 | **部分已测**（2026-10-15：asar 3.43 GiB → 176.1 MB · 打包后日志落 userData · `thumb://` 可用 · preload 三键 · `pageerror` 0，证据 `22b.txt`）；**仍未测**：NSIS 安装器/卸载/签名/图标/干净机器/首次向导/自动更新/**默认 %APPDATA% userData** |
| 文档抽取质量与分块参数 | **待实测校准** |
| `node:sqlite` 在真 Electron 主进程内的行为 | 已在 `ELECTRON_RUN_AS_NODE` 下验过可用（Node 24.21.0）；**主进程内仍需复验** |
| 旧索引质量结论（v2 PASS） | **旧证据已随旧文档体系清除**，重新建索引后需重测 |


---

## 9. 功能全景与优先级（PM 视角 · 2026-10-14 补）

> §3 的 F1–F7 是**功能域**；本节是把它补成**能交付的产品**还缺的那些「非功能域」能力，并标明优先级与主选实现（见 AGENTS.md §1 的主流依赖表）。
> 优先级：**P0 = 第一版必须有**；**P1 = 第一版应该有的体验**；**P2 = 可延后**。

| # | 能力 | 优先级 | 为什么需要 |
|---|---|---|---|
| N1 | 首次运行向导（选素材库 → 选模型目录 → 选文档目录 → 完成） | P0 | 没有它，分发给别人等于交一个报错窗口 |
| N2 | 拖拽导入：拖文件夹=入库；拖图片=以图搜图 | P0 | 最高频入口，比找菜单快十倍 |
| N3 | 快捷键全流程（方向键移动 · Enter 定位 · Space 预览 · Esc 清空 · Ctrl/Cmd+K 命令面板 · Ctrl+V 粘图搜） | P0 | 桌面应用的核心体验差异点 |
| N4 | 设置中心（库 · 目录 · 模型路径 · 文档目录 · 主题 · 快捷键 · 日志导出） | P0 | 所有可配置值的唯一入口（AGENTS P3 要求） |
| N5 | 浅色/深色/跟随系统 + 尊重 reduce-motion / reduce-transparency | P0 | Apple HIG 基线的一部分 |
| N6 | 单实例锁 + 窗口尺寸/位置记忆 | P0 | 多开会互相抢索引；不记窗口是桌面应用的硬伤 |
| N7 | 诊断面板（版本 · 模型/设备 · 索引健康 · 日志导出） | P1 | 分发给别人后，唯一能远程问诊的入口 |
| N8 | 收藏 / 标签 / 自定义集合 | P1 | 「逛」和「交付」都需要临时分组 |
| N9 | 搜索与浏览历史（最近查看） | P1 | 重复找同一批东西是常态 |
| N10 | 结果对比（并排看两条） | P2 | 选型/交付前常有 |
| N11 | 库外目录变化监视（chokidar）：提示重新扫描 | P1 | 库被别人改动时，索引会静默过期 |
| N12 | 配置导出/导入 · 数据备份 | P2 | 换机器时省事 |
| N13 | 托盘常驻 + 后台索引 | P2 | 长任务不阻塞使用 |
| N14 | 自动更新（electron-updater） | P2 | 需要更新服务器；离线分发可先不做 |
| N15 | 批量多选与批量动作（取件 / 交付 / 导出报告） | P0 | 单条操作在批量场景下不可用 |
| N16 | 文档命中高亮 + 打开所在页 | P1 | 只给片段不给定位，用户还要自己找 |
| N17 | 未实现功能的显式占位（禁用并写明原因，而不是点了没反应） | P0 | 旧项目踩过「点了只弹 toast」的坑 |
| N18 | ESLint + Prettier 统一格式（开发依赖） | P1 | 多人/多轮协作的底线 |

> 🔒 与 §3 一致：多库合并（F4）与文档检索（F7）是**门控项**；本节列的是把它们做成好体验所需的配套能力，**不改变它们的进入条件**。

**明确不引入的**：Electron 替代外壳 · Redux · LangChain 全家桶 · 向量数据库服务（Qdrant/Milvus 等）· ORM · OCR 引擎。
*本文件与实现不一致时：先确认哪个是对的，再改另一方 —— 不许两处各写一半。*


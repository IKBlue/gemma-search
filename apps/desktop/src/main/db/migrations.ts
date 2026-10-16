// apps/desktop/src/main/db/migrations.ts —— **库级** `.gs.db` 的绿地 schema（本轮 **3 张**）
//
// **字段/约束/索引的唯一依据 = reports/2026-10-15-schema-diff/DESIGN-6tables-and-contract.md §1.2**
// （所有者口径：全新项目，先定数据表；B：只建现在就要用的 6 张）。提案（PROPOSAL-schema-v1.html）
// 里多出来的列**一律不加** —— 以后要用 = 一条迁移，绿地红利就在这里。
//
// 2026-10-15 · S1：绿地重写。旧 v1/v2（library / items / doc_dirs / documents / doc_chunks /
//   health_runs / health_ledger 共 8 张）**整体丢弃**，不写兼容迁移。
// 2026-10-15 · S1b：本文件 = 库级 **3 张**：`asset`（事实）· `asset_file`（事实）· `asset_index_state`（过程）。
//   其余 14 张随功能上线，各加一条迁移。`schema_version` 是**迁移账本**（机制表），不计入 6。
//
// 机制**没有跟着缩水**（这正是"只留 6 张"不丢能力的原因）：
//   · migration-engine.ts 仍是**唯一**迁移实现（库级/应用级共用一份）；
//   · 两套账本 —— 库级 `schema_version` / 应用级 `app_meta.schema_version` —— **各自独立**；
//   · 应有表清单**从 DDL 派生**，四层点名（schema-layers.ts）仍是唯一分类来源；
//     测试强制「迁移建出的每一张表都必须在四组里被点名」⇒ **第二批加表时会被逼着分类**。
//
// ⚠️ **跨库外键不存在**（SQLite 无此能力）⇒ `asset.lib_id` 只是普通 TEXT，**不做** REFERENCES。
//    这是"两个库"划分的必然代价（设计基线 §0）。
//
// 存储纪律：**不存绝对路径**（索引/定位一律以库根相对路径为准，库整体搬盘后仍可用）。

import {
  SCHEMA_VERSION_LEDGER,
  bootstrapLedger,
  createdTableNames,
  migrateWithLedger,
  targetVersionOf,
  uniqueSorted,
  validateMigrations,
  virtualTableNames,
  type Migration,
  type MigrationResult,
  type MigrateWithLedgerOptions,
} from './migration-engine.ts';
import type { SqlDatabase } from './sqlite-adapter.ts';

// ================================================================ 库级 DDL（本轮 3 张）

/** 事实层 ① `asset` —— 条目（一个条目 = 一张预览图 + 可选同名包） */
const T_ASSET: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset (
  uid              TEXT    PRIMARY KEY NOT NULL,
  lib_id           TEXT    NOT NULL,
  folder           TEXT    NOT NULL,
  stem             TEXT    NOT NULL,
  display_name     TEXT    NOT NULL,
  rel_dir          TEXT    NOT NULL,
  rel_path         TEXT    NOT NULL,
  discovered_at_ms INTEGER NOT NULL,
  UNIQUE (lib_id, rel_path)
);`,

  // ⚠️ uid 的"12 位小写 hex"形状由**唯一写入口**（扫描器/uid 生成器）保证，DDL **不**额外加 CHECK
  //    —— 约束集以设计基线 §1.2 为准（那列只写 PK）。同理 rel_dir 的"规范形（库根 ⇒ 空串）"
  //    也是写入口的事：DDL 只保证 NOT NULL。
  //
  // ⚠️ `UNIQUE (lib_id, rel_path)` 落在**真实列**上：提案把这条唯一约束写在 asset 卡，但 asset
  //    没有 rel_path（只有 rel_dir），而 rel_path 在 asset_file、asset_file 又没有 lib_id
  //    ⇒ 按提案原样**根本建不出来**（README §3.3）。设计基线 §1.2 的定稿就是给 asset.rel_path，
  //    与 asset_file(role='preview').rel_path 同值（扫描器同事务写两处）。
  //    接受这份冗余的理由：「同一路径不许登记两次」必须落在**条目级**（跨 role 也成立），
  //    而 asset_file 没有 lib_id、单独表达不了"同库同路径唯一"。
  //
  // 本批**刻意不加**的列（都随功能上线）：deleted_at_ms（回收站）· dup_group_id（重复分组）·
  //   content_created_at_ms（按内容时间浏览）。加它们 = 一条迁移，不要"迟早要用"提前加。
  'CREATE INDEX IF NOT EXISTS idx_asset_lib_folder ON asset (lib_id, folder);',
  'CREATE INDEX IF NOT EXISTS idx_asset_stem ON asset (stem);',
];

/** 事实层 ② `asset_file` —— 文件角色（**缺包 = 少一行**，不是一个 NULL 块） */
const T_ASSET_FILE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_file (
  uid        TEXT    NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('preview', 'archive')),
  rel_path   TEXT    NOT NULL,
  ext        TEXT    NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  PRIMARY KEY (uid, role)
);`,
  // mtime_ms 的口径**全库唯一**：BigInt mtimeNs / 1_000_000n（截断）。判"文件被外部改过"就比它。
  // width/height 只有 role='preview' 有值；**扫描就能拿到** ⇒ 现在就存，免得以后重扫。
  // 本批**不加**：thumb_hash（首屏占位图，UI 增强）· content_hash_kind/value（去重要真算哈希）。
  'CREATE INDEX IF NOT EXISTS idx_asset_file_path ON asset_file (rel_path);',
];

/** 过程层 ① `asset_index_state` —— 索引状态（**存时刻，不存枚举**） */
const T_ASSET_INDEX_STATE: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_index_state (
  uid              TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  encoded_at_ms    INTEGER,
  encoded_mtime_ms INTEGER,
  compat_key       TEXT,
  vector_row       INTEGER,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_error_at_ms INTEGER,
  excluded_at_ms   INTEGER,
  checked_at_ms    INTEGER
);`,
  // ⚠️ 2026-10-15 **绿地修正**：加 `vector_row`（该条目在 `.gs-index.bin` 里的行号）。
  //    理由：GSIDX v1 是**稠密矩阵**（行优先），引擎靠 `Item.vectorRow` 把命中行映射回条目 ——
  //    没有这一列，索引与条目就对不上。它属**过程层**（索引任务写，由 S3 写入），不是「迟早要用」的列。
  // ⚠️ 本批**不物化** `needs_reencode`（提案有）：待重编码 = "当前 mtime ≠ encoded_mtime_ms" 或
  //    "库 compat_key ≠ 本行 compat_key"，都是**跨表比较**，物化成一列既无法索引又要对账
  //    （设计基线 §1.2）。等浏览页真要筛这一档，再加列 + 对账检查（一条迁移）。
  // 状态 8 档全部**派生**（已排除 > 编码失败 > 编码中 > 图片丢失 > 已移除 > 待重编码 > 待编码 > 已编码），
  // 一个字都不存 —— 理由是同一件事不设第二份真相。
  'CREATE INDEX IF NOT EXISTS idx_state_pending ON asset_index_state (encoded_at_ms) WHERE encoded_at_ms IS NULL;',
  'CREATE INDEX IF NOT EXISTS idx_state_excluded ON asset_index_state (excluded_at_ms) WHERE excluded_at_ms IS NOT NULL;',
];

/**
 * 过程层 ② `job` —— **任务台账**（B2-1 · 字段照抄 `BATCH2-PLAN` 第 1 张的设计基线）。
 *
 * 为什么必须有它（审查报告的「产品无法冷启动」= 建索引，而建索引要先有任务台账）：
 *   进度此前**只活在内存**里 —— 进程一崩，"谁在跑、跑到哪、心跳什么时候"全没了，
 *   而 SPEC 明写「进度单调且**不静默**」是**功能承诺**。这张表就是那条承诺的落点。
 *
 * 四个字段的语义都是**承诺**，不是装饰：
 *   · `progress_done` **只增不减** —— 字段层的落点 + 一条 **trigger**（见下）把"回退"变成数据库级错误；
 *   · `progress_total` **可空** —— 扫描前不知道总数时**不许编一个**（编了就是谎报进度条）；
 *   · `phase` 会变 —— 「不静默」= 界面能看到"正在统计文件/正在编码第 3 批"，而不是只有一个转圈；
 *   · `heartbeat_at_ms` —— 崩溃检测：启动时把"运行中但心跳过期"的行判 `failed`，
 *     否则界面会**永远显示一个不存在的进度**（比没有进度更坏）。
 *
 * ⚠️ 13 个物理列 = 设计基线的 **11 个字段行**（三个时刻算一行）—— 与 `asset_file` 的口径一致。
 * ⚠️ 落点：**库级** `.gs.db`（过程层）—— 任务天然属于"某一个库"；丢了只是重算，不是用户数据。
 */
const T_JOB: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS job (
  -- job_id：设计基线写 nanoid，本仓未装该依赖 ⇒ 用内置 crypto.randomUUID()
  --   （偏离已获 Lead 2026-10-16 批准；生成点收敛在 main/db/jobs.ts 的 newJobId()；内部 id，不经 IPC）
  job_id          TEXT    PRIMARY KEY NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('scan', 'index', 'health', 'rebuild', 'ingest')),
  state           TEXT    NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress_done   INTEGER NOT NULL DEFAULT 0,
  progress_total  INTEGER,
  phase           TEXT,
  cursor_json     TEXT,
  heartbeat_at_ms INTEGER,
  summary_json    TEXT,
  error           TEXT,
  queued_at_ms    INTEGER,
  started_at_ms   INTEGER,
  finished_at_ms  INTEGER
);`,
  // ⚠️ 三个时刻**可空**：照抄设计基线（不在字段层额外收紧）。queued_at_ms 实践上总会写，
  //    但"表必须允许缺"这条留给了写入口，免得将来某条迁移路径被迫造假值。
  'CREATE INDEX IF NOT EXISTS idx_job_state ON job (state, queued_at_ms);',
  'CREATE INDEX IF NOT EXISTS idx_job_heartbeat ON job (heartbeat_at_ms);',
  // ⚠️ **进度单调是数据库级约束**，不只靠调用方自觉：回退 UPDATE 直接 ABORT。
  //    为什么用 trigger 而不是 CHECK：CHECK 看不到旧值（NEW 里没有 OLD），表达不了"只增不减"。
  `
CREATE TRIGGER IF NOT EXISTS job_progress_monotonic
BEFORE UPDATE OF progress_done ON job
WHEN NEW.progress_done < OLD.progress_done
BEGIN
  SELECT RAISE(ABORT, 'job.progress_done 只增不减（SPEC：进度单调且不静默）');
END;`,
  // 状态机也不许乱跳：终态（done/failed/cancelled）**不许**再回到 running/queued。
  // 为什么也要 trigger：崩溃恢复会把 running 判成 failed（那是唯一合法的"从运行中离开"），
  //   而"failed 又变回 running"会让界面看到一个永远在跑、其实已经死掉的进度。
  `
CREATE TRIGGER IF NOT EXISTS job_terminal_state_frozen
BEFORE UPDATE OF state ON job
WHEN OLD.state IN ('done', 'failed', 'cancelled') AND NEW.state IN ('queued', 'running')
BEGIN
  SELECT RAISE(ABORT, 'job.state 已到终态，不许回到 queued/running');
END;`,
];

/**
 * 库级迁移清单（绿地：v1 三张；**v2 加 `job`** —— B2-1）。
 *
 * **第二批的表各加一条新迁移**（v2、v3…），机制与账本都不用动。
 * 测试用**注入的自定义清单**覆盖"多条按序推进"。
 */
const LIBRARY_V1: readonly string[] = Object.freeze([
  ...T_ASSET,
  ...T_ASSET_FILE,
  ...T_ASSET_INDEX_STATE,
]);

/**
 * 过程层 ③④ `health_run` / `health_finding` —— **体检台账**（B2-2 · 字段照抄设计基线
 * `reports/2026-10-15-schema-diff/SPEC-COMPACT.md` §「health_run / health_finding [v1.2 新增] · 字段 14」）。
 *
 * ⚠️ **不是 `job` 的第二份实现**（P1）：设计基线原话是「体检的进度与取消**复用同一套任务机制，不另写一份**」
 *    ⇒ `health_run.job_id` **外键关联 `job`**，而**不**在这里复制 `progress_done / progress_total /
 *    phase / cursor_json / heartbeat_at_ms`。这张表只记"**这一次体检本身**"（状态与汇总），
 *    进度/断点/心跳**永远只有 `job` 一处**（测试里有一条断言专门钉这件事：列集里不许出现那些字段）。
 *
 * ⚠️ 与基线的**一处偏离（可发现）**：基线给 `finding_id` 写的是 `INTEGER PK AUTOINCREMENT`，
 *    本仓用 `INTEGER PRIMARY KEY`（rowid 别名，**同样自增**）。原因：`AUTOINCREMENT` 会让 SQLite 建一张
 *    内部表 `sqlite_sequence`，而本仓的 schema 自检**明确要求库里不出现它**
 *    （`db-schema.test.mjs` G2：`本轮没有 AUTOINCREMENT 表`）——那条自检是本卡不动的产品约束。
 *    语义不受影响：基线要的是"流水号自增且不需要跨库唯一"，`INTEGER PRIMARY KEY` 正是这个语义。
 */
const T_HEALTH: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS health_run (
  run_id          TEXT    PRIMARY KEY NOT NULL,
  job_id          TEXT    REFERENCES job (job_id),
  state           TEXT    CHECK (state IN ('running', 'done', 'failed', 'cancelled')),
  started_at_ms   INTEGER,
  finished_at_ms  INTEGER,
  summary_json    TEXT
);`,
  `
CREATE TABLE IF NOT EXISTS health_finding (
  finding_id      INTEGER PRIMARY KEY,
  run_id          TEXT    NOT NULL REFERENCES health_run (run_id) ON DELETE CASCADE,
  check_id        TEXT    NOT NULL,
  severity        TEXT    CHECK (severity IN ('info', 'warn', 'error')),
  target_uid      TEXT,
  target_rel_path TEXT,
  detail          TEXT    NOT NULL,
  detail_json     TEXT,
  created_at_ms   INTEGER NOT NULL
);`,
  // 查询模式（每条索引都对应一个真的会跑的查询，不预建"迟早有用"的索引）：
  'CREATE INDEX IF NOT EXISTS idx_health_run_job ON health_run (job_id);',
  'CREATE INDEX IF NOT EXISTS idx_health_finding_run ON health_finding (run_id);',
  'CREATE INDEX IF NOT EXISTS idx_health_finding_check ON health_finding (check_id);',
];

/**
 * v2：**任务台账**（B2-1）。
 *
 * ⚠️ 为什么是**新的一条迁移**而不是改 v1：v1 已经在真实库里跑过了（账户里那条版本是「已发生的事」）。
 *    改 v1 等于对已升级的库**静默不生效**（版本号没变 ⇒ 不会再跑），那正是最难查的一类漂移。
 *    ⇒ 第二次加表就加 v2，版本号由 targetVersionOf 从清单派生（不另写数字）。
 */
const LIBRARY_V2: readonly string[] = Object.freeze([...T_JOB]);

/**
 * **意图层** `asset_user_meta` —— 条目标注：评分 / 备注 / 收藏（B2-3 · 字段照抄设计基线
 * `reports/2026-10-15-schema-diff/SPEC-COMPACT.md` §「asset_user_meta [本轮] · 字段 5」，第 179-187 行）。
 *
 * 为什么必须有它：详情页的「组织」块（评分/备注/收藏）是**资产管理最常摸的功能**，而今天这些
 * **完全没有存储**（详情页只读）⇒ 表就是它的落点。设计基线把它评为"**只 1 张表，性价比最高**"。
 *
 * ⚠️ **层归属 = 意图层（必须留）**（先核对了基线四层分类表 `reports/2026-10-15-schema-diff/README.md:33`，
 *    `asset_user_meta` 明确列在**意图层**）：评分/备注/收藏是**用户自己做的标注**，
 *    重建元数据**绝不能**把它们抹掉 —— 过程层的定义是"丢了能重算"，这几样**丢了没法重算**。
 *
 * 逐字段的"为什么"（照抄基线的理由）：
 *   · `uid` **PK + FK asset.uid ON DELETE CASCADE** —— **1:1**：没有行 = 还没被标注过（**合法状态，不是缺失**）；
 *     素材真被删了，标注跟着走（CASCADE）——没有素材的标注没有意义；
 *   · `rating` 可空 + **CHECK 1..5** —— 用 **NULL 表示"未评分"**，不用 0：0 会让人分不清"没评"与"评了 0 分"，
 *     而后者语义上不存在；范围写进 CHECK（数据库层挡，不靠界面自觉）；
 *   · `note` 可空 —— 自由备注，**不设长度上限**（截断是界面的事，不是存储的事）；
 *   · `updated_at_ms` NOT NULL —— 最后编辑时刻；
 *   · `is_favorite` NOT NULL DEFAULT 0 + **CHECK 0/1** —— 收藏是**一列布尔**而不是一张关联表：
 *     它是比特级的用户意图，而"筛收藏"是高频查询。
 *
 * ⚠️ 与 `asset_export` / `job` 的边界：本表是**条目的标注**（1 条素材最多 1 行）；
 *    导出历史是"发生过的事"（1 条素材 N 行，见 `asset_export`）；任务进度是"谁在跑"（`job`，与标注无关）。
 */
const T_USER_META: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_user_meta (
  uid           TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  note          TEXT,
  updated_at_ms INTEGER NOT NULL,
  is_favorite   INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1))
);`,
  // 基线在 `is_favorite` 的约束列里点名要"**偏索引** WHERE is_favorite = 1"（名字由本仓定）：
  //   "筛收藏"是高频查询，而绝大多数行并不是收藏 ⇒ 偏索引只索引真正需要的那一小撮。
  'CREATE INDEX IF NOT EXISTS idx_meta_favorite ON asset_user_meta (is_favorite) WHERE is_favorite = 1;',
];

/**
 * **事实层** `asset_name_fts` + **过程层** `recent_query` / `recent_view`（B2-5 · 搜索与历史）。
 * 字段/形状照设计基线 `reports/2026-10-15-schema-diff/SPEC-COMPACT.md`：
 *   · `asset_name_fts`（§106「[本轮]」）—— 基线原话是「**（无字段行；此卡不是数据表）**」；
 *   · `recent_query`（§59 · 字段 7）· `recent_view`（§171 · 字段 3）。
 * 层归属**先核对了基线四层分类表**（`README.md:31-32`）：`asset_name_fts` 属**事实层**（丢掉可重建）、
 *   `recent_query` / `recent_view` 属**过程层**（尽量留，丢了只是少一份历史）。
 *
 * ── 为什么用 FTS5 而不是 LIKE ────────────────────────────────────────────────
 * 基线原话：「现在按名找只能 LIKE；**FTS5 已实测可用**」。`LIKE '%x%'` 是全表扫 + 每行子串匹配；
 *   FTS5 建索引后是**索引查找**。本卡已实测（SQLite 3.51.2 · `node:sqlite`）：
 *   `CREATE VIRTUAL TABLE … IF NOT EXISTS … fts5(…)` 可重复执行（迁移幂等）；外部内容 + 触发器同步
 *   INSERT / UPDATE / DELETE 三条路径全部走到位。
 *
 * ── ⚠️ 形状是**本卡定的**（基线没给字段行）—— 写清是为了避免"看起来像自造" ──────────
 * 基线只说"文件名子串搜"，**没有列**（因为它"不是数据表"）。本卡取**最小可用形状**：
 *   索引列 `name`（喂 `asset.display_name`）+ `content='asset'`（**外部内容**：不复制名字文本，
 *   单一事实来源仍是 `asset`）。查询按 rowid 回查内容表：
 *     `SELECT a.uid FROM asset_name_fts JOIN asset a ON a.rowid = asset_name_fts.rowid
 *        WHERE asset_name_fts MATCH ?`
 *   ⚠️ **外部内容表只暴露自己声明的列**（实测：`SELECT uid FROM asset_name_fts` → no such column）⇒ 必须 JOIN。
 *
 * ── `tokenize='trigram'`：为了兑现基线里的"**子串**"两个字 ──────────────────────
 * 默认 `unicode61` 是**按词元**切：`VR-101.jpg` → `vr`/`101`/`jpg` ⇒ 找 `101` 能中，
 *   但找 `R-10` **中不了**（跨词元）。基线写的是"**子串**搜" ⇒ 用 **trigram**（实测 `R-101` 命中 `VR-101.jpg`）。
 *   代价（如实记）：trigram 索引更大；查询串**至少 3 个字符**才有意义。
 * ⚠️ **MATCH 的右边是表达式，不是纯文本**：`-`、`:`、`*` 有语法含义 ⇒ 用户输入必须**加引号**
 *   （实测：裸 `R-101` 直接报 `no such column: 101`，加引号成 `"R-101"` 才正常）。
 *   本卡只落地表；这条留给"按名搜"那张卡 —— 写在这里是为了别让"用户搜带连字符的文件名就报错"再被踩一次。
 *
 * ── ⚠️ 同步**只有一处** = 这三条触发器（P1）──────────────────────────────────
 * 写 `asset` 的路径不止一条（导入 `import.ts` · 扫描 `scanLibrary` · 重建 `rebuildLibraryDb`，
 *   将来还会有"改显示名"的功能）⇒ 同步若写在**应用层**，每加一条写入路径就多一次"记得同步"的机会，
 *   漏一处就是**静默的搜索不一致**（明明存在却搜不到）。放进**触发器**：
 *   ① 只有一处（就是这个 DDL）；② 任何写入路径自动生效，调用方不必知道 FTS 存在。
 *   代价：每次写 `asset` 多三条行级触发器开销（`asset` 的写入本来就是批量，可接受）。
 * ⚠️ 迁移**幂等**：`CREATE VIRTUAL TABLE IF NOT EXISTS` 与 `CREATE TRIGGER IF NOT EXISTS` 都可重复执行（已实测）。
 */
const T_SEARCH: readonly string[] = [
  `
CREATE VIRTUAL TABLE IF NOT EXISTS asset_name_fts USING fts5(
  name,
  content='asset',
  content_rowid='rowid',
  tokenize='trigram'
);`,
  // ── 同步：唯一的三条触发器（见上面的 P1 说明）──
  `
CREATE TRIGGER IF NOT EXISTS asset_name_fts_ai AFTER INSERT ON asset BEGIN
  INSERT INTO asset_name_fts (rowid, name) VALUES (new.rowid, new.display_name);
END;`,
  `
CREATE TRIGGER IF NOT EXISTS asset_name_fts_ad AFTER DELETE ON asset BEGIN
  INSERT INTO asset_name_fts (asset_name_fts, rowid, name) VALUES ('delete', old.rowid, old.display_name);
END;`,
  // 只关心 display_name：其它列（大小/时间戳）改了不需要重建索引 ⇒ 触发器更窄，写路径更便宜
  `
CREATE TRIGGER IF NOT EXISTS asset_name_fts_au AFTER UPDATE OF display_name ON asset BEGIN
  INSERT INTO asset_name_fts (asset_name_fts, rowid, name) VALUES ('delete', old.rowid, old.display_name);
  INSERT INTO asset_name_fts (rowid, name) VALUES (new.rowid, new.display_name);
END;`,
  `
CREATE TABLE IF NOT EXISTS recent_query (
  query_id      TEXT    PRIMARY KEY NOT NULL,
  kind          TEXT    CHECK (kind IN ('text', 'image')),
  text          TEXT,
  image_ref     TEXT,
  scope_lib_id  TEXT,
  result_count  INTEGER,
  at_ms         INTEGER NOT NULL
);`,
  'CREATE INDEX IF NOT EXISTS idx_recent_query_at ON recent_query (at_ms DESC);',
  `
CREATE TABLE IF NOT EXISTS recent_view (
  uid           TEXT    PRIMARY KEY NOT NULL REFERENCES asset (uid) ON DELETE CASCADE,
  viewed_at_ms  INTEGER NOT NULL,
  view_count    INTEGER NOT NULL DEFAULT 1
);`,
  'CREATE INDEX IF NOT EXISTS idx_recent_view_at ON recent_view (viewed_at_ms DESC);',
];

/**
 * **意图层** `asset_export` —— 交付 / 取件**留痕**（B2-2 · 字段照抄设计基线
 * `reports/2026-10-15-schema-diff/SPEC-COMPACT.md` §「asset_export [v1.2 改名] · 字段 9」，第 189-204 行）。
 *
 * 为什么必须有它：`collect` 现在**把文件复制出去却什么都不留** —— SPEC §3 F6 承诺的三分类
 * （已复制 / 已跳过 / 失败）与「历史列表」**没有落点**。这张表就是那条承诺的落点。
 *
 * ⚠️ **层归属 = 意图层（必须留）**，不是过程层：
 *   设计基线的四层分类表（`reports/2026-10-15-schema-diff/README.md:33`）把 `asset_export` 列在
 *   **意图层（必须留）**；语义也对得上 —— 「我在什么时候把哪一条导出到了哪个目录」是**用户做过的事**，
 *   **丢了没法重算**（过程层的定义是"丢了能重算"：编码状态、体检台账都属于那类）。
 *   ⇒ 任务卡面上写的"(过程层)"与此冲突，按 AGENTS §0「任务与规格不符 → 以规格为准」处理为**意图层**。
 *
 * 逐字段的"为什么"（照抄基线的理由，不是我自己想的）：
 *   · `kind` collect/deliver —— **取件与交付共用一张表**：两者的结果分类、目标目录语义、"跳过原因"结构完全相同；
 *   · `uid` **可空 + ON DELETE SET NULL**（不是 CASCADE）—— 条目被彻底删除后**置空**："我导出过它"这件事**仍然成立**，
 *     外键也不该挡住建素材的删除；
 *   · `asset_name` **快照（NOT NULL）**—— 历史记录表的标准做法：条目改名/被删之后，历史里看到的仍是**当时的名字**，
 *     不会变成一个空 uid（与上一行是一对：**去关联但留名字**）；
 *   · `batch_id`（可空，**不建外键**）—— 同一次批量操作的 id（复用 `activity.activity_id`），用于"把 N 行归成一条历史"；
 *     **不能建外键**：`activity` 在**应用级** `app.db`，跨库没有外键（基线原话）；
 *   · `target_dir` NOT NULL —— 导出到哪个**白名单**目录（`collect_dir` 那条安全边界的落点）；
 *   · `result` copied/skipped/failed —— SPEC §3 F6 要的三分类；**取件也共用这套词**（"已存在所以跳过"在两种动作里是同一件事）；
 *   · `reason` 可空 —— 跳过/失败的**具体原因（人话）**；
 *   · `at_ms` NOT NULL —— 发生时刻。
 *
 * ⚠️ **与 `job` / `health_run` 的边界**（"一次批量 = 谁一行"）：
 *   · `job`（过程层）= **任务**台账：谁在跑、跑到哪、心跳 —— 一次批量**一行**（进度）；
 *   · `health_run`/`health_finding`（过程层）= **体检**台账 —— 与导出无关；
 *   · `asset_export`（**意图层**）= **一次批量里、每一条素材一行**。设计基线 `BATCH2-PLAN.md:30` 的原话是
 *     「一次批量 = `activity` 1 行 + `export` N 行」⇒ 导出 N 条就写 N 行，同 `batch_id`。
 *   ⇒ 本表**不复制** `job` 的任何进度/心跳字段（那些只有 `job` 一处）。
 */
const T_EXPORT: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS asset_export (
  export_id   TEXT    PRIMARY KEY NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('collect', 'deliver')),
  uid         TEXT    REFERENCES asset (uid) ON DELETE SET NULL,
  asset_name  TEXT    NOT NULL,
  batch_id    TEXT,
  target_dir  TEXT    NOT NULL,
  result      TEXT    CHECK (result IN ('copied', 'skipped', 'failed')),
  reason      TEXT,
  at_ms       INTEGER NOT NULL
);`,
  // 基线「附加」段**唯一**指定的索引：详情页要显示"这条被导出过几次、最近一次何时"，
  //   也是"是否已交付"的推导来源。DESC 与查询方向一致（历史列表按时间倒序看）。
  // ⚠️ 基线把 batch_id 标为"偏索引"但附加清单**只给了这一条** ⇒ 本卡**不擅自加**第二条；
  //    "把 N 行归成一条历史"那个查询等历史列表落地时按查询再加（不预建"迟早有用"的索引）。
  'CREATE INDEX IF NOT EXISTS idx_export_uid ON asset_export (uid, at_ms DESC);',
];

/**
 * v3：**体检台账**（设计基线的第二批第 4 张 —— 卡号曾误记为 B2-2，实为 B2-4）。
 * 仍然遵守 v2 的同一条规矩：**加表 = 加一条新迁移**，绝不回头改 v1/v2
 * （改已跑过的迁移对已升级的库静默不生效）。
 */
const LIBRARY_V3: readonly string[] = Object.freeze([...T_HEALTH]);

/**
 * v4：**交付/取件留痕**（B2-2）。
 * 同一条规矩：**加表 = 加一条新迁移**，不回头改 v1/v2/v3（改已跑过的迁移对已升级的库静默不生效）。
 */
const LIBRARY_V4: readonly string[] = Object.freeze([...T_EXPORT]);

/**
 * v5：**条目标注**（B2-3）。
 * 同一条规矩：**加表 = 加一条新迁移**，不回头改 v1–v4（改已跑过的迁移对已升级的库静默不生效）。
 */
const LIBRARY_V5: readonly string[] = Object.freeze([...T_USER_META]);

/**
 * v6：**搜索与历史**（B2-5：`asset_name_fts` · `recent_query` · `recent_view`）。
 * 同一条规矩：**加表 = 加一条新迁移**，不回头改 v1–v5；本条 DDL 全部 `IF NOT EXISTS` ⇒ 可重复执行。
 */
const LIBRARY_V6: readonly string[] = Object.freeze([...T_SEARCH]);

export const LIBRARY_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'greenfield-library-3', statements: LIBRARY_V1 }),
  Object.freeze({ version: 2, name: 'batch2-job-ledger', statements: LIBRARY_V2 }),
  Object.freeze({ version: 3, name: 'batch2-health-ledger', statements: LIBRARY_V3 }),
  Object.freeze({ version: 4, name: 'batch2-asset-export', statements: LIBRARY_V4 }),
  Object.freeze({ version: 5, name: 'batch2-asset-user-meta', statements: LIBRARY_V5 }),
  Object.freeze({ version: 6, name: 'batch2-search-history', statements: LIBRARY_V6 }),
]);

/** 本程序知道的**库级**最高版本（从清单派生，不另写数字） */
export const TARGET_SCHEMA_VERSION: number = targetVersionOf(LIBRARY_MIGRATIONS);

// ---------------------------------------------------------------- 应有表清单（从 DDL 派生）

/** 库级业务表（**从 DDL 派生**，不手写第二份清单）—— v1 三张 + v2 的 `job` = 4 张 */
export const LIBRARY_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(
    LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => createdTableNames(m.statements)),
  ),
);

/** 库级虚拟表（本轮没有 FTS；第二批的 asset_name_fts 会在这里出现，影子表按它排除） */
export const LIBRARY_VIRTUAL_TABLES: readonly string[] = Object.freeze(
  uniqueSorted(
    LIBRARY_MIGRATIONS.flatMap((m: Migration): string[] => virtualTableNames(m.statements)),
  ),
);

/**
 * 库级 `.gs.db` 里**应当存在**的全部表（含迁移账本 `schema_version`）。
 * 用途：T-15a 的完整性自检（apps/desktop/src/main/library-health.ts）。
 * ⚠️ 账本表不计入「表数」，但它确实在库里 ⇒ 这份清单必须含它（现在是 4 业务表 + 账本 = 5）。
 */
export const EXPECTED_TABLES: readonly string[] = Object.freeze(
  uniqueSorted([...createdTableNames(SCHEMA_VERSION_LEDGER.ddl), ...LIBRARY_TABLES]),
);

// ---------------------------------------------------------------- 账本读写（库级便捷封装）

/** 建账本表并保证 id=1 那一行存在；每次 migrate 都调，代价是两条 no-op 语句 */
export function ensureSchemaVersionTable(db: SqlDatabase, now: () => number): void {
  bootstrapLedger(db, SCHEMA_VERSION_LEDGER, now);
}

/** 读库级当前版本；账本没有 id=1 的行 = 建表逻辑被绕过，抛错而不是"当成 0" */
export function readSchemaVersion(db: SqlDatabase): number {
  return SCHEMA_VERSION_LEDGER.readVersion(db);
}

/** `migrate` 的选项（与迁移引擎同形，只是 `migrations` 可缺省为库级清单） */
export interface MigrateOptions {
  /** 覆盖迁移清单（测试用它做"先跑一条、再跑全量"与"注入一条坏迁移"） */
  migrations?: readonly Migration[];
  /** 时钟注入（版本行时间可复现） */
  now?: () => number;
}

/**
 * 把库级 `.gs.db` 推进到清单里的最高版本。**幂等**：已是最新就什么都不做、也不报错。
 * 不负责：建父目录、开库（open.ts）、删库重建（removeGsDbFiles）。
 */
export function migrate(db: SqlDatabase, opts: MigrateOptions = {}): MigrationResult {
  const options: MigrateWithLedgerOptions = {
    migrations: opts.migrations ?? LIBRARY_MIGRATIONS,
    now: opts.now,
  };
  return migrateWithLedger(db, SCHEMA_VERSION_LEDGER, options);
}

// 既有调用方（open.ts / library-health.ts）从本文件取引擎件；统一在这里转出（不各自 import 引擎）
export { SCHEMA_VERSION_LEDGER, targetVersionOf, validateMigrations };
export { SCHEMA_VERSION_ROW_ID, SCHEMA_VERSION_TABLE } from './migration-engine.ts';
export type {
  AppliedMigration,
  Migration,
  MigrationLedger,
  MigrationResult,
} from './migration-engine.ts';

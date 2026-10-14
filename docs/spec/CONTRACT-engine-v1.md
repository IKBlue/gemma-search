# 引擎接口契约 v1（`docs/spec/CONTRACT-engine-v1.md`）

> **状态**：**现行**（接口形状已冻结；任何改动按 §9 规则升版本并同步实现）
> **最后核对**：2026-10-12
> **权威范围**：引擎接口形状（方法 / 错误码 / 事件 / 恢复）
> **权威**：身份/配对/指纹以 `docs/spec/SPEC-identity.md` 为准，
> 事务状态机以 `docs/spec/SPEC-transactions.md` 为准，阈值以 `docs/spec/SPEC-acceptance.md` 为准，顺序以 `docs/plan/ROADMAP.md` 为准。
> **目的**：让 P3 的四步界面开发**不必等真实素材库**也能进行（见 §8 模拟接口）。

---

## 0. 三条不可协商的约束

| # | 约束 | 可执行判据 |
|---|---|---|
| 1 | **传输无关** | `packages/engine/` 里 import `electron` 或 `http` 即违规（单测会拦） |
| 2 | **路径只能由 `lib_id + uid` 解析** | 任何接受"绝对路径"入参的方法都违规（§7 不变量 ①） |
| 3 | **只读操作绝不写库** | `search`/`item`/`thumbPath`/`scan`/`indexStatus` 在文件系统上零写入 |

**没有全局可变状态**：引擎以 `createEngine({ config })` 返回实例；测试可并行建多个实例。

---

> ⚠️ **2026-10-13：本文档里凡引用 `verify_app_build` / `verify_main_wiring` / `verify_renderer_dom` /
> `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` 的地方，那些守卫**已按所有者指令移除**
> （原件备份在 `data/_removed-guards-backup/`）。文中的"有自动化/由它断言"一律**不再成立**；
> 现存守卫只剩 `verify_encoder_path` 与 `check_search`，且两者都需要模型与已注册索引（沙箱跑不动）。
> 详见 [`TODO.md`](../TODO.md) B-4 的"移除的代价"。

## 1. 通用形状

### 1.1 调用与返回

所有方法**同步或异步皆返回同一信封**，永不抛异常给调用方（内部异常转成 `ok:false`）：

```jsonc
// 成功
{ "ok": true, "data": { /* 方法各自的 data 形状 */ }, "warnings": [] }

// 失败
{
  "ok": false,
  "error": {
    "code": "LIB_NOT_FOUND",          // 稳定机器码（§1.3）
    "message": "库未注册：L2",          // 面向开发者，可含标识符
    "userMessage": "找不到素材库，可能已被移动或移除。", // 面向用户，中文，不含路径与堆栈
    "details": { }                     // 结构化补充（见各方法）
  }
}
```

**约定**
- `code` 是**稳定契约**，界面按它分支；**绝不**按 `message` 分支
- `userMessage` 不含绝对路径（界面可能把它显示给用户，也可能被截图外发）
- `details` 里可以含路径与期望/实际值，供诊断面板展示

### 1.2 标识符

| 名称 | 形状 | 说明 |
|---|---|---|
| `libId` | `"L1"` 这类短 id | 库注册表分配（P5）；P0.5 的索引用 `L1` |
| `uid` | 12 位 hex | `sha1(lib_id\|rel_dir\|stem)[:12]`，**冻结**（SPEC-identity §3） |
| `relPath` | `"CR\ID-689938.jpeg"` | 相对库根，`\` 分隔，盘符统一小写 |

**引擎的公开方法只接受 `libId + uid`**（或 `relPath` 作为**显示用**回传值，不作为入参）。

### 1.3 错误码表（**每个码都要有对应用例**，P1 验收项）

| code | 触发 | 用户可见文案（`userMessage`） |
|---|---|---|
| `BAD_REQUEST` | zod 校验失败 | 请求参数不合法。 |
| `LIB_NOT_FOUND` | `libId` 未注册 | 找不到素材库，可能已被移动或移除。 |
| `LIB_ROOT_MISSING` | 注册表里的库根不存在 | 素材库目录不存在（可能盘符变了或盘未挂载）。 |
| `INDEX_MISSING` | 该库无索引 | 这个库还没有索引，先建一次索引。 |
| `INDEX_CORRUPT` | MAGIC/footer/sha1 校验失败 | 索引文件已损坏，需要重建。 |
| `UID_NOT_FOUND` | `uid` 不在索引里 | 这条素材已不在索引中（可能已被移出库）。 |
| `ITEM_MISSING_ON_DISK` | 索引里有、磁盘上没了 | 素材文件找不到了，可能被移动或删除。 |
| `COMPAT_MISMATCH` | 多库合并时 `compat` 不等 | 这个库与当前库的索引不兼容，无法一起检索。 |
| `PATH_ESCAPES_LIB` | 解析后的路径不在库根内 | 拒绝访问：目标超出了素材库范围。 |
| `SYMLINK_REJECTED` | 符号链接/联接点越界 | 拒绝访问：检测到指向库外的链接。 |
| `COLLECT_DIR_NOT_ALLOWED` | 取件目标不在白名单 | 不允许写入该目录，请在设置里选择允许的目录。 |
| `COLLECT_TARGET_EXISTS` | 目标已存在同名文件 | 目标目录已有同名文件。 |
| `DISK_FULL` | 预检发现空间不足 | 目标磁盘空间不足。 |
| `JOB_NOT_FOUND` | 任务 id 无效 | 任务不存在或已结束。 |
| `JOB_BUSY` | 该库已有同类任务在跑 | 这个库已经在执行同类任务了。 |
| `RECOVERY_NEEDED` | 上次事务未收尾 | 上次操作未完成，需要先恢复（见 §5）。 |
| `UNDO_EXPIRED` | 撤销窗口已过 | 这次操作已超过可撤销期限。 |
| `MODEL_MISSING` | 模型未就绪 | 还没有准备好模型文件，先下载一次。 |
| `PORT_MISSING` | **外壳没注入引擎所需的能力端口**（当前仅 `reveal` 的 `shell`） | 这个功能在当前环境里不可用（缺少所需的系统接口）。 |
| `INTERNAL` | 兜底 | 出了点问题，详情见日志。 |

---

## 2. 方法

> 下表 `req` / `data` 都是 JSON 形状。**zod schema 是唯一来源**（`apps/desktop/src/shared/ipc.ts`：方法白名单 + 逐方法 `.strict()` 校验 + 载荷上限）。
> TS 类型是**计划中**的：当前 `tsconfig*.json` 的 `checkJs: false`，**没有 typecheck 门禁**。

### 2.0 实现状态（2026-10-13 更新 · 与契约的对齐说明）

契约**冻结形状**与实现**尚未接线**可以并存，但必须有一处写明现状 —— 就是本节。

| 方法 | 契约 | 实现 |
|---|---|---|
| `search` · `item` · `thumbPath` · `scan` · `indexStatus` | 已冻结 | ✅ 已实现 |
| `itemPaths`（§2.2a，**新**） | 已冻结 | ✅ 已实现 |
| `reveal` | 已冻结（§2.4 含 `shell` 注入的现行要求） | ✅ **已接线**（F-01 已修，2026-10-12，见 §2.4） |
| `collect` | 已冻结 | ⚠️ 库根配置缺口下默认必失败（见 §2.5） |
| `transactions`（§2.11，**新**） | 已冻结 | ❌ 真实模式未接线 → 见 §2.12；**模拟模式下可完整演示** |
| `ingest` · `mutate` · `indexStart` · `indexCancel` · `indexResume` | **冻结形状**（先定形状，界面可并行开发） | ❌ 真实模式未接线 → 见 §2.12 |

> 这是**有意的诚实降级**：未实现的方法给出明确错误 + 明确文案，用户看得到「这个功能还没做好」。
>
> ⚠️ **2026-10-13 收敛**：这份"哪些没实现"的清单原先在**主进程手写一份**
> （`missing` 数组）、引擎里再逐段写一遍 —— 两处会漂移（P1）。现在**只有一处**：
> 引擎导出的 **`UNIMPLEMENTED_METHODS`**（§2.12），主进程直接 import 它。
> ⇒ **本节表格若与那份清单不一致，以代码为准并回来改本表。**

### 2.1 `search`

```jsonc
// req
{ "mode": "text" | "image" | "vector",
  "text": "北欧吊灯",                    // mode=text 必填
  "imageRef": { "libId": "L1", "uid": "ab12cd34ef56" },  // mode=image 必填（也可用 refPath 指向库外查询图，见下）
  "queryImagePath": "D:\\x.jpg",         // 允许：**查询图是用户临时选的，不在库内**，
                                         // 但只读、不写、且必须通过扩展名白名单
  "libIds": ["L1", "L2"],                // 缺省 = 全部 compat 相等的库
  "topK": 50,                            // 1..200，缺省 50
  "filters": { "folders": ["VR"], "exts": [".jpg"] } }

// data
{ "libsUsed": ["L1"], "libsSkipped": [ { "libId": "L2", "reason": { /* §6 结构化原因 */ } } ],
  "tookMs": 39,
  "results": [
    { "libId": "L1", "uid": "ab12cd34ef56", "score": 0.7821,
      "band": "high" | "mid" | "low" | "unknown",  // 分数区间由引擎常量定义，界面不自己算阈值
                                                // "unknown" = 模态不在 BANDS 里 ⇒ 引擎**拒绝**定档（见下）
      "relPath": "VR\\ID-x.jpg", "folder": "VR", "stem": "ID-x",
      "imageExt": ".jpg", "imageSize": 41233,
      "archive": { "relPath": "VR\\ID-x.rar", "ext": ".rar", "size": 8911028 } | null,
      "thumbKey": "L1/ab12cd34ef56" } ] }
```

- **分数不可跨模态比大小**（SPEC-acceptance §2.2）：界面**不得**把"文本查询的 0.78"与"图像查询的 0.90"排序比较。`band` 由引擎按**同一模态内**的区间给出。
- ✅ **`band` 可能是 `"unknown"`（2026-10-12 修 R-3）**：引擎只认 `BANDS` 里定义的模态（当前 `text` / `image`）。**不认识的模态不再静默套用文本阈值**，而是返回 `"unknown"`。
  历史写法是 `BANDS[mode] || BANDS.text`，于是 `bandOf(0.85, 'vector')` 会给出 `'high'` —— 而 `vector` 根本不该用文本区间。
  这与 F-02（界面自算阈值）是**同一根因**：不懂模态的东西替分数下结论。
  **界面义务**：收到 `"unknown"` 时**只显示分数、不显示档位文案**（`ui/Score.jsx` 已如此：`BAND_TEXT` 里没有这个键 ⇒ 自然降级）。
- `libIds` 里 `compat` 不相等的库**不报错**，而是进 `libsSkipped` 并附原因（§6）—— 界面置灰并显示原因。

### 2.2 `item`

```jsonc
// req
{ "libId": "L1", "uid": "ab12cd34ef56" }
// data —— 索引里的完整条目 + 磁盘实况（**不隐藏"文件没了"**）
{ "libId": "L1", "uid": "…", "relPath": "VR\\ID-x.jpg", "folder": "VR", "stem": "ID-x",
  "imageExt": ".jpg", "imageSize": 41233, "imageMtime": 1760000000000,
  "vectorSource": "native" | "bmp-fallback",
  "archive": { "relPath": "…", "ext": ".rar", "size": 8911028, "mtime": 1760000000000 } | null,
  "exists": { "image": true, "archive": true } }
```

### 2.2a `itemPaths`（**2026-10-13 新增**，只读）

```jsonc
// req
{ "libId": "L1", "uid": "ab12cd34ef56" }
// data —— 只要**绝对路径**（两条都可能为 null：文件不在了 / 本来就没有包）
{ "libId": "L1", "uid": "…",
  "imagePath": "Z:\\lib\\VR\\ID-x.jpg" | null,
  "archivePath": "Z:\\lib\\VR\\ID-x.rar" | null,
  "exists": { "image": true, "archive": true } }
```

**为什么要单独一个方法，而不是把两个字段加进 §2.2 的 `item`**（2026-10-13 所有者决定）：

- `item` 的语义是「**索引元数据 + 磁盘实况**」，返回的是**相对**路径；界面的 99% 用途只需要这些。
- 绝对路径是**另一种东西**：它把库的物理布局交出去。`engine.mjs` 里 `absPathFor` 原来的注释写着
  「刻意不经 IPC 暴露」—— 而 P3c 的验收明确要求「元数据里显示**两条绝对路径**」，两者直接冲突。
- 解法不是把字段塞进 `item`（那会让**每一次取元数据都顺带交出路径**），而是**一个语义明确的只读方法**：
  谁要路径谁调它，暴露面收在明处、可审计。与 §2.3 `thumbPath` 同一条思路。

**§9.1 兼容性**：**新增**方法 = 兼容（既有调用不受影响）。方法总数 13 → 15（+`itemPaths`，+`indexResume` 见 §2.10）。

**用例**：`packages/engine/tests/fake.test.mjs` **F3/F12**（`item` **不含**绝对路径 + 两者字段集合）·
`apps/desktop/e2e/item-detail.spec.mjs` **E9-a**（真窗口里断言两条绝对路径的具体值）·
`apps/desktop/e2e/fake-mode.spec.mjs` **E8-e**。

### 2.3 `thumbPath`

```jsonc
// req
{ "libId": "L1", "uid": "…", "size": 256 }   // size ∈ {128, 256, 512}
// data
{ "cachePath": "…\\thumbs\\L1\\ab\\ab12cd34ef56@256.jpg", "generated": true }
```

- **命中缓存直接返回**；未命中则生成并落盘到**应用数据目录**（绝不写库）
- 界面**不拼路径**，一律用返回的 `cachePath`（`thumb://` 协议只接受 `libId/uid@size`，见 P2）

### 2.4 `reveal`

```jsonc
// req —— 二选一
{ "libId": "L1", "uid": "…", "target": "archive" | "image" }
// data
{ "revealed": true, "path": "G:\\model\\VR\\ID-x.rar" }   // 只读操作，不移动、不复制
```

**现行要求（2026-10-12 补，随 F-01 登记）**

1. **主进程必须在 `createEngine()` 时注入 `shell` 端口**（形状 `{ reveal(absPath) }`；Electron 侧即 `shell.showItemInFolder`）。`reveal` 是**唯一**依赖该端口的方法。
2. **未注入时不得返回成功。** `ok({ revealed: true })` 的语义是「已在资源管理器中定位」；在 `shell` 不存在时返回它，等于**静默假成功** —— 用户会看到成功提示而资源管理器毫无动静。

### ✅ 已修（F-01，2026-10-12）

| 项 | 结果 |
|---|---|
| 引擎判定 | `packages/engine/src/engine.mjs` 的 `reveal`：端口缺失或形状不对 ⇒ **`PORT_MISSING` 失败信封**，绝不 `ok`。顺序为 **先 `existsSync` 再调端口**，所以"文件早就没了"不会弹出空目录 |
| 端口注入 | `apps/desktop/src/main/index.mjs` 的 `buildEngine()` 注入 **`shell: createRevealPort(shell)`**（实现在 `apps/desktop/src/main/ports.mjs`；形状仍是 `{ reveal(absPath) }`，实现体调用 `shell.showItemInFolder`） |
| 回归锁定 | 引擎 +5 条（未注入 / 三种坏形状 / 文件缺失时**端口零调用** / 端口抛错归 `INTERNAL` / 文案不含绝对路径）· 端口本体 +4 条（`apps/desktop/tests/ports.test.mjs`）· **接线层**：`tools/verify_app_build.mjs` §1b 在**构建产物的 main bundle** 上断言 `shell: createRevealPort(...)` 存在（⚠️ **先剥注释再匹配** —— 实测 bundle 会保留源码行注释，直接 grep 会命中被注释掉的那行）· 渲染层 §9 断言失败必须显示失败、成功文案不得越界 |
| 为什么单测曾经是绿的 | 原用例（`engine.test.mjs:314`）**自己注入了 `shell`**，测的是"引擎能力"，**不是应用的接线** —— 这是「测试通过掩盖接线缺失」的典型形态，本身没错，但必须再有应用侧的断言 |

> ⚠️ **能力边界（必须如实写，不得声称更强的保证）**
> Electron 官方 `shell.showItemInFolder(fullPath)` **返回 void，不报告失败**
> （对比：`shell.openPath(path)` 才 `Returns Promise<string>`，失败时给错误串）。
> 所以本方法成功时我们**只保证两件事**：① 目标文件确实在盘上（`existsSync` 已证）；② 端口**被调用过**。
> 我们**保证不了**「资源管理器真的弹出来了」、**也保证不了**「它被置到了前台」
> （Electron 上游 `electron/electron#4349` 就是"窗口不置前"）。
> 若将来需要可判定的成功，唯一的路是改用 `shell.openPath` 并检查它返回的错误串 —— 但那会**打开文件**而不是**定位文件**，是不同的语义。
> 来源：<https://www.electronjs.org/docs/latest/api/shell>

### 2.5 `collect`（取件 = 复制到白名单目录）

```jsonc
// req
{ "libId": "L1", "uids": ["…", "…"], "targetDirName": "素材待用" }
// data —— 逐项结果，**部分成功必须如实呈现**
{ "jobId": "j-7f3a", "targetDir": "E:\\素材待用\\",
  "succeeded": [ { "uid": "…", "path": "E:\\素材待用\\ID-x.rar", "bytes": 8911028 } ],
  "failed":    [ { "uid": "…", "error": { /* 信封 */ } } ],
  "skipped":   [ { "uid": "…", "reason": "already-exists" } ] }
```

- `targetDirName` 必须在**白名单**内（默认 `E:\素材待用\`，可在设置里增删）
- **不写库**：取件是"库 → 库外"，库侧零写入

> ✅ **当前状态（2026-10-12，F-04 已修）**：白名单来自 `collect.dirs`，现在**不再是空对象**。
> 主进程按 `registry.collect` > `config.collect` > **默认值** 解析，默认
> `{素材待用:'E:\素材待用', 移出素材:'E:\移出素材'}`（出处 `docs/spec/SPEC-app.md` §9 与 `docs/spec/SPEC-transactions.md` §7）。
> ⇒ 取件在**库与库根都解析出来**之后即可成功，不再必然 `COLLECT_DIR_NOT_ALLOWED`。
> 实现见 `apps/desktop/src/main/library-config.mjs`；回归断言见 `apps/desktop/tests/library-config.test.mjs` ⑦⑧。

### 2.6 `ingest`（入库：把库外素材放进库）

```jsonc
// req
{ "libId": "L1", "sourcePaths": ["D:\\incoming\\a.jpg"], "destFolder": "VR" }
// data —— 与 collect 同构：succeeded / failed / skipped + jobId
```
- **必须走四步写入纪律**（`docs/spec/SPEC-transactions.md`）：预检 → 事务日志 → 原子落盘 → 可撤销
- 目标同名冲突 → `skipped`（`reason: "name-conflict"`），**不覆盖**

### 2.7 `mutate`（改 / 移出库）

```jsonc
// req
{ "libId": "L1", "uid": "…",
  "op": "rename" | "moveFolder" | "reattachArchive" | "moveOutOfLibrary" | "undo",
  "params": { } }
```

⚠️ **`uid` 对 `undo` 是「可选」的（2026-10-13 更正）**：下表写明 `undo` = 撤销**指定事务**，
由 `params.txId` 定位 ⇒ `uid` 对它**没有意义**。此前 schema 把它写死成必填，调用方只能瞎塞一个，
否则连"撤销"都发不出去（实测：操作记录页的「回退」被 `BAD_REQUEST` 拦掉、状态不变，E2E `E11-d` 抓到）。
现在 `uid` 可省略，但**除 `undo` 外仍然必填**（`shared/ipc.ts` 的 `superRefine`）。
这是**放宽**（原先合法的调用照旧合法）⇒ §9.1 口径的兼容改动；用例见 `permissions.test.mjs` **S15**（双向验证过）。

| op | 语义 | 需重编码 | 可撤销 |
|---|---|---|---|
| `rename` | 改主干名（图与包同步） | 否（uid 不变，relPath 变） | ✅ |
| `moveFolder` | 在库内换分类文件夹 | 否 | ✅ |
| `reattachArchive` | 换/补同名包 | 否 | ✅ |
| `moveOutOfLibrary` | **移出库** → `E:\移出素材\` | 否 | ✅ |
| `undo` | 撤销指定事务 | — | — |

- **没有真删除**（决策：只提供"移出库"）
- 未收尾的事务存在时，任何写操作先返回 `RECOVERY_NEEDED`（§5）

### 2.8 `scan`（差分：新增 / 消失 / 变化）

```jsonc
// req
{ "libId": "L1" }
// data
{ "new": [ { "relPath": "…", "stem": "…" } ], "missing": [ { "uid": "…" } ],
  "changed": [ { "uid": "…", "what": ["size", "mtime"] } ],
  "fingerprintV1": "3c62f15c…", "filesTotal": 7188 }
```
只读。

### 2.9 `indexStatus`

```jsonc
// data
{ "libs": [ { "libId": "L1", "root": "G:\\model", "indexed": 3594, "encoded": 3594,
              "dim": 768, "compat": "…|140|768|l2|…", "builtAt": "…",
              "failed": 0, "healthy": true,
              "problems": [] } ] }
```

### 2.10 `indexStart` / `indexCancel` / `indexResume`

```jsonc
// indexStart req
{ "libId": "L1", "device": "webgpu" | "cpu", "seq": 140, "rebuild": false }
// data
{ "jobId": "j-91b2" }
```
返回 `jobId` 后**进度经事件流推送**（§3），不轮询。
`indexCancel { jobId }` → `{ "cancelled": true }`；`indexResume { jobId }` 复用已编码行（按 `compat` 判定）。

⚠️ **2026-10-13 补记（实现与文档漂移）**：`indexResume` 在本文档里一直有，
但 `shared/ipc.ts` 的 zod 白名单**漏了它** ⇒ 调用会被当成「未登记的方法」直接拒绝。
P3d 要用它（续跑）时才发现，已补进白名单。**教训**：契约文档与白名单是两份东西，
加方法时**两边都要动**（`AGENTS.md` §4「契约 / 新 IPC 方法」那一行写的就是这件事）。

### 2.11 `transactions`（**2026-10-13 新增**，只读）

```jsonc
// req —— 三者都可选：默认"列最近 50 条"
{ "libId": "L1", "txId": "tx-2f9c", "limit": 50 }   // limit ∈ [1,200]
// data
{ "transactions": [ {
    "txId": "tx-2f9c", "libId": "L1", "op": "moveOutOfLibrary",
    "state": "committed" | "undone" | "aborted" | "recovery_needed" | …,
    "startedAt": 1760003000000, "finishedAt": null,
    "canUndo": true, "canRollback": true,
    "summary": "移出 1 件：跨卷复制未完成", "changes": [ { "uid": "…", "relPath": "…", "kind": "move" } ]
  } ],
  "blocked": false }   // ← true 表示"有未收尾事务"，此时**任何写方法都会被 RECOVERY_NEEDED 挡住**
```

**依据**：`docs/spec/SPEC-transactions.md:229`——「`mutate()` 返回事务 id；**界面据 id 查询状态**、
显示进度、提供撤销入口」。而契约里此前**没有任何**列/查事务的方法 ⇒ 操作记录页没有数据源。
补上这一个（与 §2.2a `itemPaths` 同口径：要什么就给一个语义明确的只读方法）。

**界面怎么用**：
- `state === 'recovery_needed'` 的行 = 「待处理」，按 §5 给「**重试 / 回退 / 保持现状**」三条路
  （`UI-REVIEW-and-migration.md:250`）；
- `canUndo` / `canRollback` 决定「回退」按钮可不可点——**不可回退的要提示"需要手动处理"**，
  不许给一个点了没用的按钮（§5）；
- `blocked` 用来把「待处理」提到显眼处（`SPEC-transactions.md:141`）。

**为什么 `changes` 里带 `uid`**：回退（`mutate{op:'undo'}`）不需要 uid，但**重试**要用原 op 重放，
界面得知道这条事务动了哪些素材。字段是**新增**⇒ §9.1 兼容。

**用例**：`packages/engine/tests/fake.test.mjs` **F14/F15/F15b/F15c/F16/F17** ·
`apps/desktop/e2e/activity.spec.mjs` **E11-a…E11-f** · `permissions.test.mjs` **S16**。

### 2.12 未实现方法的**唯一清单**

`packages/engine/src/engine.mjs` 导出 `UNIMPLEMENTED_METHODS`
（当前 = `ingest` · `mutate` · `transactions` · `indexStart` · `indexCancel` · `indexResume`）。

- **形状已冻结、真实实现未接线**：真实模式下这些方法如实返回 `INTERNAL`（**绝不假装成功**）；
- **主进程也读这份清单**（`apps/desktop/src/main/index.mjs`），在进引擎前拒绝并给出
  更明确的用户文案「这个功能还没做好。」；
- **模拟模式**（§8）下不拒绝，由 `fake.mjs` 提供假实现。

⚠️ 这份清单**全仓只有一处定义**（原先主进程手写一份、引擎里逐段写一遍，两处会漂移 —— P1）。
`fake.test.mjs` 的 **F17** 断言"假套件里每一个都接上了"，两边一旦漂移就红。

---

## 3. 长任务：进度 / 取消 / 续跑 / 失败清单

**事件流**（引擎通过注入的 `onEvent` 回调发出；P2 用 `webContents.send` 转发到渲染进程）：

```jsonc
{ "type": "index.progress", "jobId": "j-91b2", "libId": "L1",
  "done": 525, "total": 3594, "skipped": 0, "failed": 0,
  "ratePerSec": 1.96, "etaSec": 1566, "phase": "encode" | "scan" | "finalize" }

{ "type": "index.done", "jobId": "…", "ok": true,
  "indexed": 3594, "failed": [], "compat": "…" }

{ "type": "index.failed", "jobId": "…", "error": { /* 信封 */ } }
```

| 关注点 | 契约 |
|---|---|
| **进度** | 至少每 **500 ms** 一次；`done/total` 单调不减（取消时会停在某值） |
| **取消** | `indexCancel` 后最多 **2 s** 内发出 `index.done{ok:false}` 或 `index.failed{code:"INTERNAL"}`；**已编码行保留**（续跑用） |
| **续跑** | `indexResume` 必须**按 `compat` 判定**：不等则**不复用**并在事件里说明原因（"复用 0 条：compat 不符"） |
| **失败清单** | **不静默**：`failed[]` 每项含 `{ "relPath", "stage", "error" }`；只要非空，`index.done.ok = false` |
| **GPU 回退** | 回落 `cpu` **不静默**：`index.progress` 带 `deviceFallback: { from: "webgpu", to: "cpu", reason }`，界面必须显示 |

---

## 4. 只读与写入的分界（界面可直接依赖）

| 方法 | 写库 | 写应用数据目录 | 可撤销 |
|---|---|---|---|
| `search` `item` `scan` `indexStatus` | ❌ | ❌ | — |
| `thumbPath` | ❌ | ✅ 缩略图缓存 | — |
| `reveal` | ❌ | ❌ | —（**F-01 已修 2026-10-12**：需外壳注入 `shell` 端口，未注入返回 `PORT_MISSING`） |
| `collect` | ❌ | ❌ | — |
| `ingest` `mutate` | ✅ **四步纪律** | ✅ 事务日志 | ✅ |
| `indexStart` | ❌（索引在应用数据目录） | ✅ 索引文件 | ❌（重建即可） |

---

## 5. 事务与 `RECOVERY_NEEDED`

状态机以 `docs/spec/SPEC-transactions.md` 为准，这里只固定**接口可见部分**：

```jsonc
// 任何写方法在存在未收尾事务时的返回
{ "ok": false, "error": { "code": "RECOVERY_NEEDED",
  "userMessage": "上次操作未完成，需要先恢复。",
  "details": { "libId": "L1", "txId": "tx-2f9c",
               "state": "staged" | "committing" | "rolling-back",
               "startedAt": "…", "canUndo": true, "canRollback": true } } }
```

**恢复操作**（界面据 `canUndo` / `canRollback` 决定按钮）：

```jsonc
// mutate { op: "undo", params: { txId: "tx-2f9c" } }   → 回退该事务
// 或（若不可回退）由界面提示"需要手动处理"，并在诊断面板展示 details
```

**启动恢复**：`createEngine()` 时自动扫描事务日志并尝试收尾；结果以事件发出：

```jsonc
{ "type": "recovery.report", "recovered": [ { "txId": "…", "action": "rolled-back" } ],
  "needsAttention": [ { "txId": "…", "reason": "跨卷复制中断，源文件完好、目标不完整", "details": {} } ] }
```

**界面规则**：`needsAttention` 非空时**必须**在启动后显示显式提示（`docs/design/DESIGN-app-details.md` §1.5 的"三类非正常状态"之一），不得静默。

---

## 6. 多库兼容性失败：**结构化原因**

```jsonc
// libsSkipped[].reason
{ "kind": "compat-mismatch",
  "mismatches": [
    { "field": "seq_length", "expected": 140, "actual": 280 },
    { "field": "model_weights_dtype", "expected": "fp32", "actual": "q4f16" } ],
  "expectedCompat": "onnx-community/embeddinggemma-2-ONNX|daa72c5…|fp32|1|140|768|l2|mean_soft_tokens",
  "actualCompat":   "onnx-community/embeddinggemma-2-ONNX|daa72c5…|q4f16|1|280|768|l2|mean_soft_tokens",
  "userMessage": "这个库的索引档位不同（seq 280、q4f16），无法与当前库一起检索。" }
```

**界面必须显示"哪一项不符 + 期望值 + 实际值"**，而不是一句"不兼容"。
`compat` 的成员只有 8 项（SPEC-identity §6.3）；`device`/`gpu_model` **不参与**，否则 CPU 回退会拒绝自己的索引。

---

## 7. 引擎层安全不变量（G-C 的 P1 部分 —— **编码前已定**）

| # | 不变量 | 可执行判据（单测） |
|---|---|---|
| ① | 路径**只能**由 `lib_id + uid` 解析 | 给它一个绝对路径入参 → `BAD_REQUEST`；`packages/engine/` 里无 `path.join(root, clientInput)` 形态 |
| ② | 取件目标目录**白名单** | `collect` 传白名单外目录 → `COLLECT_DIR_NOT_ALLOWED` |
| ③ | **库根包含校验** | 索引里塞入 `..\..\evil` 形态的 `relPath` → 解析后越界 → `PATH_ESCAPES_LIB` |
| ④ | **符号链接 / 联接点** | 库内放一个指向库外的链接 → 拒绝并给 `SYMLINK_REJECTED`（用 `fs.realpath` 后比较前缀） |
| ⑤ | 只读操作**绝不写库** | 跑完 4 个只读方法后，库的 `fingerprintV1` 不变 |

> 这 5 条**不是实现细节**：P2 的 `thumb://` 协议与 IPC 白名单都要靠它们兜底。

---

## 8. UI 用的测试数据与模拟接口（**P3 不等真实库**）

契约要求提供两份可注入的东西，让 P3a–P3d 独立开发：

```jsonc
// fixtures/sample-index.json —— 约 30 条，覆盖全部展示分支
{ "items": [
  { "uid": "…", "relPath": "VR\\ID-1.jpg", "folder": "VR", "archive": { "ext": ".rar" } },
  { "uid": "…", "relPath": "CR\\ID-2.png", "folder": "CR", "archive": null },          // 有图无包
  { "uid": "…", "relPath": "CR+VR\\ID-3.bmp", "folder": "CR+VR", "vectorSource": "bmp-fallback" }, // 回退档
  { "uid": "…", "relPath": "其他\\ID-4.jpeg", "folder": "其他", "exists": { "image": false } } ] } // 文件已不在
```

```jsonc
// createEngine({ config, fake: true }) —— 模拟模式（无模型、无真实库）
// 行为：search 返回固定排序；indexStart 发假进度（约 10 s 走完）；
//       ingest/mutate 只在内存里改；**绝不触碰真实文件系统**
```

**P3 的验收依赖它**：界面在 `fake:true` 下必须能演示全部状态（空、加载、无结果、无索引、
索引损坏、`RECOVERY_NEEDED`、`COMPAT_MISMATCH`、部分成功）。

### 8.1 实现状态：✅ **已落地（2026-10-13）**

⚠️ **在此之前本节一直是"文档声称"而代码里没有** —— 引擎里零 `fake`、`fixtures/` 目录不存在。
后果是 P3c/P3d 的验收只能"人工对着真库看"，而真库要 ONNX 模型 + 已注册索引
（本环境跑不了）⇒ 那两页的验收**实际上无法复跑**。补上之后它们才变成可执行断言。

| 件 | 位置 | 怎么开 |
|---|---|---|
| 样例索引（3 库 / 30 条，覆盖全部分支） | `fixtures/sample-index.json`（**仓库根**，契约指定的路径） | — |
| 假套件（零真实 FS） | `packages/engine/src/fake.mjs` | `createEngine({ fake: { fixture } })` |
| 主进程开关 | `apps/desktop/src/main/index.mjs`（读 `ROOT/fixtures/…` 并**注入**引擎） | `GEMMA_FAKE=1` |

**演示分支实测清单**（`packages/engine/tests/fake.test.mjs` **F10** 钉住）：
空（`__empty__`）· 加载 · 无结果 · 无索引 · **索引损坏**（L3）· **`COMPAT_MISMATCH`**（L2）·
**`RECOVERY_NEEDED`** · 部分成功（失败清单）· 待重编码 · 已从索引移除 · GPU 回退 · BMP 回退档。

**⚠️ 两条必须记住的边界**：

1. **模拟模式证明的是"接线通、界面能渲染状态"，不是检索质量。** 真实检索质量与缩略图内容
   仍然**未验证**（`TODO.md` B-3）—— 这条不能含糊。
2. **夹具在渲染层读不到**：引擎的 `import.meta.url` 在打包后位于 `out/main/index.js`，
   上溯三层会解到仓库外（实测：主进程**崩在建窗之前**，症状是"窗口永不出现"）。
   ⇒ **由主进程读文件、把对象注入引擎**（它本来就持有 `ROOT`），这同时保住了引擎
   "传输无关、依赖全部注入"的设计原则。

**"假的必须与真的同形"**（否则页面在模拟模式能跑、在真库上拿到 `undefined`）：
`fake.test.mjs` 的 **F12**（`item`/`itemPaths` 字段集合逐字比对）与 **F13**
（`indexStatus.compat` 必须是 `COMPAT_FIELDS` 的 8 段竖线串）就是为此立的。
⚠️ 这两条各自抓到过一次真分歧：我第一版给 `item` 多加了个 `indexState` 字段、
给 `compat` 返回了一个词 `'fake'`。

---

## 9. 冻结规则

1. 冻结后**新增**字段 = 兼容（旧界面忽略它）
2. **改名 / 改语义 / 删字段 / 改错误码字符串** = 破坏性 → 必须升 `v2` 并保留 v1 一个周期
3. 每次改动都要同步：`docs/spec/CONTRACT-engine-v1.md` → `apps/desktop/src/shared/ipc.ts`（zod 校验 + 方法白名单）→ `apps/desktop/src/preload/index.js`（**手抄的字面量**，不是 import）→ 单测用例
4. **每个错误码都要有至少一个用例**（P1 验收会逐个查）

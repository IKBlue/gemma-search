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
| `INTERNAL` | 兜底 | 出了点问题，详情见日志。 |

---

## 2. 方法

> 下表 `req` / `data` 都是 JSON 形状。**zod schema 是唯一来源**（`apps/desktop/src/shared/ipc.mjs`：方法白名单 + 逐方法 `.strict()` 校验 + 载荷上限）。
> TS 类型是**计划中**的：当前 `tsconfig*.json` 的 `checkJs: false`，**没有 typecheck 门禁**。

### 2.0 实现状态（2026-10-12 · 与契约的对齐说明）

契约**冻结形状**与实现**尚未接线**可以并存，但必须有一处写明现状 —— 就是本节。

| 方法 | 契约 | 实现 |
|---|---|---|
| `search` · `item` · `thumbPath` · `scan` · `indexStatus` | 已冻结 | ✅ 已实现 |
| `reveal` | 已冻结（§2.4 含 `shell` 注入的现行要求） | ⚠️ **未接线**（F-01，见 §2.4） |
| `collect` | 已冻结 | ⚠️ 库根配置缺口下默认必失败（见 §2.5） |
| `ingest` · `mutate` · `indexStart` · `indexCancel` | **冻结形状**（先定形状，界面可并行开发） | ❌ 主进程**显式拒绝**：返回 `{ code: "INTERNAL", userMessage: "这个功能还没做好。", details: { method } }`，不是静默无反应 |

> 这是**有意的诚实降级**：未实现的方法给出明确错误 + 明确文案，用户看得到「这个功能还没做好」。
> 相关清单在 `apps/desktop/src/main/index.mjs`（`missing` 数组，与 §2.5–§2.10 对应）与 `apps/desktop/src/shared/ipc.mjs`（方法白名单）。

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
      "band": "high" | "mid" | "low",       // 分数区间由共享常量定义，界面不自己算阈值
      "relPath": "VR\\ID-x.jpg", "folder": "VR", "stem": "ID-x",
      "imageExt": ".jpg", "imageSize": 41233,
      "archive": { "relPath": "VR\\ID-x.rar", "ext": ".rar", "size": 8911028 } | null,
      "thumbKey": "L1/ab12cd34ef56" } ] }
```

- **分数不可跨模态比大小**（SPEC-acceptance §2.2）：界面**不得**把"文本查询的 0.78"与"图像查询的 0.90"排序比较。`band` 由引擎按**同一模态内**的区间给出。
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
3. **当前实现不符合第 1、2 条（F-01，未修）**：
   - `apps/desktop/src/main/index.mjs` 的 `buildEngine()` **从未注入 `shell`**；
   - `packages/engine/src/engine.mjs` 的 `reveal` 只在 `shell && typeof shell.reveal === 'function'` 时才调用它，否则**照样** `return ok({ revealed: true, path: abs })`。
4. **单测为什么是绿的**：`packages/engine/tests/engine.test.mjs` 自己注入了 `shell`（`shell: { reveal: (p) => seen.push(p) }`）并断言被调用。
   也就是说：**单测测的是引擎能力，不是应用的接线** —— 这正是「测试通过掩盖接线缺失」的典型形态。

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

> ⚠️ **当前状态（2026-10-12）**：白名单来自主进程读取的配置（`config.collect.dirs`）。
> 而**仓库里没有配置文件**（缺口 D2，见 `docs/audit/00-current-state.md` §5）⇒ 白名单实际为空
> ⇒ **任何 `collect` 都会返回 `COLLECT_DIR_NOT_ALLOWED`**。这是配置缺口的下游，不是取件逻辑本身的问题。

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
| `reveal` | ❌ | ❌ | — |
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

---

## 9. 冻结规则

1. 冻结后**新增**字段 = 兼容（旧界面忽略它）
2. **改名 / 改语义 / 删字段 / 改错误码字符串** = 破坏性 → 必须升 `v2` 并保留 v1 一个周期
3. 每次改动都要同步：`docs/spec/CONTRACT-engine-v1.md` → `apps/desktop/src/shared/ipc.mjs`（zod 校验 + 方法白名单）→ `apps/desktop/src/preload/index.js`（**手抄的字面量**，不是 import）→ 单测用例
4. **每个错误码都要有至少一个用例**（P1 验收会逐个查）

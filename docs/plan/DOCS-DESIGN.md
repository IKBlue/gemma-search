# 项目设计说明（Design）

> **状态**：现行 · **最后核对**：2026-10-12
> **权威范围**：**已落地设计的说明**（实际做成了什么样、为什么这样做）与设计缺口清单。
> 它**不定义**约束 ── 约束在 `docs/spec/` 与 `docs/design/`。
>
> **本文定位**：把**已经落地的设计**收敛成一份可通读的说明，并与**规格**做区分。
> 规格回答「应该是什么样」（`docs/spec/` · `docs/design/`），本文回答「**实际做成了什么样、为什么这样做**」。
>
> 冲突时的权威顺序：`docs/spec/*` > `docs/design/*` > 本文。
> 事实基准：`docs/audit/00-current-state.md`。
>
> ⚠️ **代码已搬到 monorepo 布局**（`apps/` + `packages/`），本文所有路径按**新布局**书写；
> 搬迁本身不改行为（见 `docs/MIGRATION-PLAN.md`）。

---

> ⚠️ **2026-10-13：本文档里凡引用 `verify_app_build` / `verify_main_wiring` / `verify_renderer_dom` /
> `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` 的地方，那些守卫**已按所有者指令移除**
> （原件备份在 `data/_removed-guards-backup/`）。文中的"有自动化/由它断言"一律**不再成立**；
> 现存守卫只剩 `verify_encoder_path` 与 `check_search`，且两者都需要模型与已注册索引（沙箱跑不动）。
> 详见 [`TODO.md`](/../TODO.md) B-4 的"移除的代价"。

## 1. 分层架构（已落地）

```
┌ 渲染进程 ────────────────────────────────────────────────────────┐
│ apps/desktop/src/renderer/src/    React 19 · 只消费 var(--*)      │
│ 仅有的能力来源 = window.api（3 个成员）                            │
├ preload ─────────────────────────────────────────────────────────┤
│ apps/desktop/src/preload/index.js  沙箱化 · 产出必须是 CJS         │
│ invoke / onEvent / platform ——「不暴露 ipcRenderer 本体」          │
├ 契约 ────────────────────────────────────────────────────────────┤
│ apps/desktop/src/shared/ipc.ts    唯一来源：方法白名单 + zod       │
│ 2 个通道 · 13 个方法 · 1 MiB 载荷上限                              │
├ 主进程 ──────────────────────────────────────────────────────────┤
│ apps/desktop/src/main/index.mjs    窗口 / IPC 分发 / thumb://      │
│ 来源校验 → zod 白名单 → 引擎                                       │
├ 引擎 ────────────────────────────────────────────────────────────┤
│ packages/engine/src/               零依赖 · 传输无关 · 68 测（+ 桌面 12 测）        │
│ engine / index / library / fingerprint / compat / errors          │
└──────────────────────────────────────────────────────────────────┘
```

**这条分层的可执行判据**：`packages/engine/src/` 顶部只允许出现 `node:fs` / `node:path` / `node:crypto`。
不是靠约定，是靠能一眼看完的 import 列表。

### 1.1 为什么引擎必须零依赖

| 理由 | 说明 |
|---|---|
| 可测 | 68 个引擎单测直接跑 `packages/engine/src/`，**不需要模型、不需要 GPU、不需要 Electron** |
| 可换外壳 | 将来换掉 Electron 不必重写检索逻辑 |
| 结构性杜绝 | 零依赖 ⇒ **不可能** import electron（这一条比"约定不要 import"强） |
| 环境约束 | 受限沙箱下 `npm install` 会因 npm 用管道捕获子进程输出而 EPERM —— 这是本项目**开发环境**的约束，不是产品要求 |

### 1.2 依赖注入点（`createEngine` 的参数）

| 参数 | 作用 | 应用里注入了吗 |
|---|---|---|
| `config` | 库列表 + 数据目录 + 取件白名单 | ✅ 部分（见缺陷 R2/R3） |
| `encoder` | `{ encodeText, encodeImage }` —— 唯一需要模型的地方 | ✅ 懒加载包装 |
| `onEvent` | 索引进度 / 编码器就绪等推送 | ✅ |
| `now` | 时钟（测试可注入假时钟） | ❌ 用默认 |
| `shell` | `{ reveal(absPath) }` —— 文件定位端口 | ❌ **从未注入 → 缺陷 R1** |

> **设计意图是对的**（把副作用做成端口），**接线是缺的**。
> 而 `packages/engine/tests/engine.test.mjs`（`reveal` 用例自注入 shell） 自己注入了 shell 所以测试是绿的 —— 见基线 D6。

---

## 2. 数据模型

### 2.1 一条素材（`items.json` 的单条）

```jsonc
{
  "uid": "8a70380a9575",              // 12 位小写 hex，由 libId+relDir+stem 派生（确定性）
  "libId": "L1",
  "folder": "CR+VR",                  // 渲染器分类（来自目录名），不是内容标签
  "stem": "ID-10083808",
  "name": "ID-10083808.jpg",
  "relPath": "CR+VR\\ID-10083808.jpg",
  "absPath": "G:\\model\\CR+VR\\ID-10083808.jpg",   // ⚠️ 本机绝对路径 → 换机即失效
  "imageExt": ".jpg", "imageSize": 92213, "imageMtime": 1626318115936,
  "archiveName": "ID-10083808.rar",
  "archiveRelPath": "CR+VR\\ID-10083808.rar",
  "archiveAbsPath": "G:\\model\\CR+VR\\ID-10083808.rar",  // ⚠️ 同上
  "archiveExt": ".rar", "archiveSize": 3393183, "archiveMtime": 1626318115812,
  "vectorRow": 0,                     // 该条在 index.bin 里的行号
  "vectorSource": "native"
}
```

**配对规则**：靠**文件名主干相同**（`ID-1.jpg` ↔ `ID-1.rar`），且**显式存了两个相对路径**，
不是隐含约定。这样"图有包无 / 包有图无"是可数的（验收 B 项）。

### 2.2 索引三件套（`data/libraries/L1/`）

| 文件 | 内容 | 实测大小 |
|---|---|---|
| `index.bin` | 3594 × 768 float32（L2 归一化后，点积即余弦） | 11,042,105 B（≈11 MB） |
| `items.json` | 3594 条元数据 | 1,968,550 B（≈1.9 MB） |
| `meta.json` | 格式版本 / `compat` / 模型 revision / 预处理 / 计数 | 1,521 B |
| `_ACCEPTED.txt` | 接受标记（G-B v2 PASS 引用） | 159 B |

`meta.json` 实测关键字段：

```jsonc
{ "format_version": 1, "compat_key_version": 1,
  "model_repo": "onnx-community/embeddinggemma-2-ONNX",
  "model_revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
  "model_weights_dtype": "fp32", "audio_disabled": true,
  "preprocessing_version": 2,
  "preprocessing": { "image_seq_length": 140, "patch_size": 16, "resample": 3,
                     "resample_impl": "resize_compat(pil-like)", "do_normalize": false },
  "seq_length": 140, "dim": 768, "embedding_dtype": "float32",
  "normalization": "l2", "pooling": "mean_soft_tokens",
  "query_prefix": "task: search result | query: ",
  "document_prefix": "title: none | text: ",
  "count": 3594, "lib_id": "L1", "failed": [], "bmpFallbackUsed": 20 }
```

> **`preprocessing_version: 2` 是本项目最有价值的一处修复**：v1 的重采样与**参考实现**（已退役的 Python 侧）不一致
> （transformers.js 用 `sharp.affine(bicubic)` 无抗锯齿 vs 参考实现用 `PIL.resize(BICUBIC)` 展宽核支撑），
> 导致 G-B 判 FAIL（min 余弦 0.9153）。修后 min → 0.995969。
> 详见 `reports/G-B-20261010-v2/DIAGNOSIS-resample.md`。

### 2.3 `compat`：哪些库能一起检索

`compat` 是**跨库合并的准入条件**。两个库只有 `compat` 完全一致才允许合并检索，
否则进 `libsSkipped` 并附**结构化原因**（不是静默丢弃）。

实测分库分布：`VR 2809` · `CR 630` · `CR+VR 78` · `其他 77` = **3594**，`未分类 0`（尚未入库过）。

### 2.4 索引为什么存绝对路径（已知取舍）

`absPath` / `archiveAbsPath` 让配对无需重算，代价是**库一移动索引就失效**。
`README.md` 已如实登记。**但**：本轮 grep 确认**渲染层与引擎都不读这两个字段**
（引擎只用 `relPath` + 注册表根重新解析）—— 所以它们目前是**冗余字段**，
既占空间又在换机时制造误导。建议改造方式见 `docs/audit/AUDIT-FINAL.md`。

---

## 3. 安全设计（已落地，逐条可查）

### 3.1 五条引擎层不变量（`packages/engine/src/library.mjs` 开头的注释即声明）

| # | 不变量 | 实现位置 |
|---|---|---|
| ① | 路径只能由 `lib_id + uid` 解析，**不接受客户端给的绝对路径** | `resolveInLibrary` / `resolveQueryImage` |
| ② | 取件目标目录白名单（**按名字**，不是按路径） | `resolveCollectDir` + `assertCollectDirAllowed` |
| ③ | 库根包含校验（**词法**层） | `sameOrUnder(target, rootAbs)` |
| ④ | 真实路径包含校验（拦符号链接 / 联接点 / 8.3 短名） | `fs.realpathSync.native` 双向比较 |
| ⑤ | 只读操作绝不写库 | 检索路径无写调用；取件是「库 → 库外」 |

> ② 的设计值得单独指出：**渲染进程连「传一个白名单外的路径」都做不到**，
> 只能传一个**已配置的名字**。比「传路径再校验」少一整类出错可能。

### 3.2 传输层

| 项 | 值 |
|---|---|
| 通道 | `engine:invoke` / `engine:event`（**只有两个**） |
| preload 暴露 | `invoke` / `onEvent` / `platform`（**三个成员**，无 `ipcRenderer`） |
| 校验顺序 | 来源校验 → 载荷上限 → zod 白名单 → 引擎 |
| 来源校验 | `event.sender === 主窗口` + `frame.parent === null`（拒 iframe）+ URL 必须是应用自身 |
| 载荷上限 | 1 MiB |
| 未登记方法 | **一律拒绝**（查 `Methods` 的 own property），不落 default 分支 |

### 3.3 `thumb://` 协议

**形状只允许 `thumb://<libId>/<uid>@<size>`**，路径**绝不从 URL 取**，
而是「注册表 + 索引」反查后再做包含校验 → 渲染进程**连一个路径都传不进来**。

两处必须知道的实现细节（都踩过）：

| 坑 | 处理 |
|---|---|
| URL 的 host **一律小写**，而 `libId` 是大小写敏感的（`L1`） | `canonicalLibId()` 建映射还原 |
| `sandbox: true` 的渲染进程**不加载 ESM preload** | `electron.vite.config.mjs` 显式把 preload 压回 CJS + `.cjs` |

### 3.4 明确不防的边界

见 `docs/spec/SPEC-security.md`（含「本机自用工具」的威胁模型取舍，
例如生产态保留 DevTools 是**已决策**项，不是遗漏）。

---

## 4. 构建设计

三端一体（electron-vite 5 + Vite 7），三个**不显然但必须这么写**的点：

| 点 | 为什么 | 位置 |
|---|---|---|
| **依赖不打包进主进程** | electron-vite 5 默认 `ssr.noExternal=true` 会把 `node_modules` 全打进去；而 `@huggingface/transformers`→`onnxruntime-node`、`resize_compat`→`sharp` 都带原生 `.node`，打进 bundle 必坏 | `externalizeDepsPlugin()` |
| **preload 必须是 CJS** | `package.json` 是 `"type":"module"`，但 `sandbox:true` 不加载 ESM preload | `output.format='cjs'` + `entryFileNames='[name].cjs'` |
| **插件版本跟着 Vite 走** | `@vitejs/plugin-react` 锁 `^5`；v6 的 peer 要求 Vite 8，装了会 ERESOLVE | `package.json` |

另有一处**只影响 dev** 的放宽：`devCspRelax()` 仅 `apply:'serve'`，
把 `connect-src` 加上 `ws://localhost:*` 以放行 HMR —— **生产态 CSP 一个字都不改**。

---

## 5. 视觉设计（令牌唯一来源）

| 项 | 设计 |
|---|---|
| 唯一来源 | `packages/design-tokens/tokens.css`（`docs/design/DESIGN-tokens.md` §10 的可执行版） |
| 消费方式 | `apps/desktop/src/renderer/src/renderer.css` **只消费 `var(--*)`**：不写死颜色、间距只用 `--space-*`、字号只用 `--type-*` |
| 跨界引用 | `apps/desktop/src/renderer/src/main.jsx` 直接 import 跨出 renderer root 的 `tokens.css`——**不复制第二份**，避免两份漂移 |
| 检查 | ~~`tools/verify_renderer_styles.mjs` + `tools/verify_renderer_dom.mjs`~~ ⚠️ **该守卫已于 2026-10-13 按所有者指令移除** ⇒ 改由 **`npm test` 断言**承担（见 `task-19`）；现存守卫只剩 `verify_encoder_path` / `check_search`（见 `AGENTS.md` §3） |
| 令牌清单 | 颜色（Apple 语义色系）· 字号阶梯（`--type-*`）· 8pt 间距（`--space-*`）· 圆角 · 阴影 · `--touch-min:44px` |

> **Apple 风格符合度的逐项对差**不在本文——见 [`../audit/UIUX-AUDIT.md`](../audit/UIUX-AUDIT.md)（宪章②产出物）。

---

## 6. 设计决策及其代价（诚实记录）

| 决策 | 收益 | 代价（必须承认） |
|---|---|---|
| 引擎零依赖 | 可测 / 可换 / 结构性安全 | 自定义二进制 `index.bin`、手写余弦、无社区生态 |
| 索引存本机绝对路径 | 配对无需重算 | 库一移动即失效（**且实测是冗余字段**） |
| `sandbox:true` | 最强隔离 | preload 被迫 CJS；ESM 生态不能用 |
| IPC 而非 REST | 无 localhost 攻击面（CSRF / DNS-rebinding） | 无法外部脚本化 |
| 生产态留 DevTools | 本机排障收益 > 风险 | 已在 `docs/spec/SPEC-security.md` 登记为**已知取舍** |
| 暴力余弦（无向量库） | 3594×768 下更简单更快 | 规模上到十万级需换实现 |
| 默认过滤到 4 个渲染器分类 | 与库目录一致 | `未分类`（入库默认目录）条目会被默认排除 —— 目前库内为 0 条，尚不暴露 |

---

## 7. 未被设计覆盖的部分（缺口）

| 缺口 | 影响 |
|---|---|
| **库注册表的持久化** | `LibraryRegistry` 是纯内存派生（`packages/engine/src/library.mjs:137` 自己标注「P5 扩为真正的多库注册表」）；没有持久化 ⇒ 库位置无来源 |
| **配置的存放位置** | `config.json` 已删但代码仍在读（基线 D2/D7）⇒ 需要一次「配置来源」设计决策 |
| **入库 / 事务** | `docs/spec/SPEC-transactions.md` 已成文，代码 0 行 |
| **多库界面** | 引擎支持，界面无入口 |
| **打包后行为** | `electron-builder.yml` 形状正确但**从未打包验证**；`asarUnpack` 只列了 `resources/**`，`onnxruntime-node` / `sharp` 的原生 `.node` 未列入（配置文件自己注明「P6 必须按实测加进去」） |
| **深色模式** | ⚠️ **本条已更正**：令牌体系**有**暗色档（`packages/design-tokens/tokens.css` §4 的 `prefers-color-scheme` 与 `:root[data-theme="dark"]`，对应 `docs/design/DESIGN-tokens.md` §10）。真正的缺口是**渲染层没有接**：`apps/desktop/src/renderer/` 下 `prefers-color-scheme` **0 命中**、主进程也没有 `nativeTheme` —— 所以界面只呈现浅色档（见 `docs/audit/UIUX-AUDIT.md`） |

---

## 8. 本文未覆盖

- 逐屏 UI 细节（见 `docs/design/DESIGN-app-details.md`）
- 事务状态机设计（见 `docs/spec/SPEC-transactions.md`）
- 身份 / uid 种子 / 指纹算法（见 `docs/spec/SPEC-identity.md`）
- 性能口径与计时边界（见 `docs/spec/SPEC-acceptance.md` §3）

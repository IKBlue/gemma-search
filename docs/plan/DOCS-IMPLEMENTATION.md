# 项目实现说明（Implementation）

> **状态**：现行 · **最后核对**：2026-10-12
> **权威范围**：逐模块的**实现说明**（代码实际怎么写的）与实现缺口清单。
>
> **本文定位**：逐模块说明**代码实际怎么实现的**，含每个模块的职责、关键实现手法、
> 以及**已知的实现缺口**。规格见 `docs/spec/`，设计意图见 [`DOCS-DESIGN.md`](DOCS-DESIGN.md)。
> 事实基准：`docs/audit/00-current-state.md`。
>
> ⚠️ **路径按 monorepo 新布局书写**（`apps/desktop/src/…` · `packages/engine/src/…` · `packages/indexer/src/…`）。
> 文中 `文件:行号` 记录的是**重构前 HEAD `4555c1b`**（P1 是纯 `git mv`，行号未变）；
> 但 P2 已在 `apps/desktop/src/main/*.mjs`、`packages/engine/tests/*.mjs` 与 `tools/*.mjs` 里改过 import，
> **这些文件的行号可能已偏移** —— 引用时以**路径**为准，行号只作定位参考。

---

## 1. 代码规模（实测）

| 区域 | 文件数 | 行数 | 说明 |
|---|---|---|---|
| `packages/engine/src/` 引擎 | 6 | **868** | 零依赖，被 68 个引擎单测直接跑 |
| `apps/desktop/src/main/` 主进程 | 3 | 473 | 窗口 / IPC / `thumb://` / 日志 / 编码器 |
| `apps/desktop/src/renderer/src/` 界面 | 24 | ~800 | 22 个 `.jsx` + 3 hook + 1 CSS |
| `apps/desktop/src/preload/` | 1 | 20 | 安全桥（产出 20 行，但它是安全边界） |
| `apps/desktop/src/shared/` 契约 | 1 | 75 | 方法白名单 + zod |
| `packages/engine/tests/` | 5 | 777 | `node:test`，68 项（+ `lib-root.mjs` 夹具） |
| `tools/` 守卫 | 7 | 875 | 只读校验 |
| `packages/indexer/src/` 索引构建 | 12 | 1521 | 离线实验室（**唯一**能建索引的地方） |
| `scripts/` | 1 | 114 | 启动辅助 |
| **合计** | **59** | **≈5 600** | （不含 `node_modules` / 原型 / 归档） |

> 值得注意的比例：**引擎 868 行 / 测试 777 行 ≈ 0.9:1**。引擎的测试密度是健康的。

---

## 2. `packages/engine/src/` —— 引擎（零依赖）

### 2.1 `engine.mjs`（390 行）—— 主体

| 导出 | 职责 | 关键实现手法 |
|---|---|---|
| `createEngine({config, encoder, indexDir, onEvent, now, shell})` | 组装 | **全依赖注入** ⇒ 测试注入假编码器即可跑全部逻辑 |
| `doSearch` | 三种模态检索 | 逐库打分 → 合并 → 排序 → topK；`queryImagePath` 是**唯一**的库外路径例外 |
| `doIndexStatus` | 库健康度 | `healthy = rootOk && 有索引 && 无 problem && items.length === count` |
| `doScan` | 差分扫描（只读） | 遍历磁盘建 `disk` 表，与索引对比出 `new / changed / missing` |
| `doCollect` | 取件 | **先算总量 → `statfsSync` 空间预检 → `COPYFILE_EXCL` 逐件复制** |
| `reveal` | 定位文件 | 走注入的 `shell` 端口（**应用里没注入 → 缺陷 R1**） |
| `bandOf` | 分数分档 | **按模态分别定义**（文本 `0.72/0.65`；图像 `0.90/0.80`），**暂定值** |
| `l2norm` | 查询向量归一 | 防御性：编码器忘了归一 → 分数被静默缩放（排序对、band 全错） |
| `resolveCollectDir` | 取件白名单 | **按名字配置**，不是按路径传 ⇒ 白名单是结构性的 |

**三个值得点名的实现细节**

1. **每行都套信封**：`search: (req) => envelope(() => doSearch(req))` ⇒ 契约「永不抛异常给调用方」是**结构性**保证。
2. **`absPathFor` 刻意不经 IPC 暴露**（`packages/engine/src/engine.mjs:399`）：只给主进程 `thumb://` 用。
   理由写在注释里——「把这个结果交给渲染进程就等于把绝对路径泄出去了」。
3. **分数带宽注释诚实**：`BANDS` 上方明确写着「这些阈值是**暂定**的…需要复核后再冻结」。

### 2.2 `index.mjs`（90 行）—— `index.bin` 读取与强校验

文件布局：

```
[0,8)            MAGIC = 47 53 49 44 58 00 00 01   ("GSIDX" + 0x00 0x00 0x01)
[8,12)           u32 LE headerLen
[12,12+hlen)     headerJSON (utf8)
之后             float32 块 (count × dim，行主序)
末尾             u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete }
```

**「任何校验不过都抛 `INDEX_CORRUPT`，绝不返回半可信数据」** —— 六道校验：

| # | 校验 | 失败后果 |
|---|---|---|
| 1 | 文件长度 ≥ 12 | `INDEX_CORRUPT` |
| 2 | MAGIC 8 字节逐字节相等 | 同 |
| 3 | `headerLen` 不越界 | 同 |
| 4 | `header.count/dim` > 0 | 同 |
| 5 | `footer.complete === true` | **写入未完成** |
| 6 | `sha1(vector block)` 与 footer 记录一致 | 静默损坏 |

外加 `footer.count/dim` 与 header 交叉校验。
`Float32Array` 用**拷贝**构造（`Buffer.from(ab).set(body)`）以保证 4 字节对齐且不共享生命周期。

> 这里的严格程度有历史原因：旧实现的 `MAGIC` 是 7 字节而读端按 8 字节比 ⇒ `readIndexBin` 永远返回 `null`
> ⇒ **「可续跑」从未生效**且不报错（`docs/plan/ROADMAP.md`）。所以现在「宁可判损坏，也不给半可信数据」。

另：`relOf()` 同时兼容 `relPath`（新）与 `rel_path`（旧 Python 档），是**显式的格式换代桥接**。

### 2.3 `library.mjs`（160 行）—— 注册表 + 安全路径

`resolveInLibrary()` 的四步（顺序不可调换）：

1. `isSafeRelPath` —— 拒绝对路径 / 盘符 / UNC / `..` / NUL
2. **词法**包含校验（便宜，拦住绝大多数越界）
3. **真实路径**包含校验（`fs.realpathSync.native` 双向）—— 拦符号链接 / 联接点 / 8.3 短名
4. 目标**不存在**时：向上找最深的已存在祖先，再对祖先做真实路径校验
   （防「经由链接到达的位置」）

`sameOrUnder()` 在 Windows 下**小写化**后比较（NTFS 默认不区分大小写），
且**前缀比较带分隔符**（`E:\素材待用-x` 不算命中 `E:\素材待用`）。
这两点都有对应的测试（`packages/engine/tests/security.test.mjs`）。

### 2.4 `errors.mjs`（81 行）—— 19 个错误码 + 信封

| 导出 | 作用 |
|---|---|
| `ERR` | 19 个错误码，`Object.freeze` 冻结（「冻结后新增=兼容，改名=破坏性」） |
| `USER_MESSAGE` | 19 条**用户可见文案**，且**不含绝对路径**（界面可能被截图外发） |
| `EngineError` / `fail` | 类型化内部错误 |
| `ok` / `err` / `envelope` | 信封构造 + 「永不抛给调用方」包装 |

有一条专门的测试：**每个错误码都必须有用户文案，且文案不含绝对路径**。

### 2.5 `compat.mjs`（56 行）· `fingerprint.mjs`（91 行）

- `compat`：给出**跨库能否合并检索**的键与结构化原因（`compatEqual` / `compatReason` / `compatComplete`）
- `fingerprint.mjs`：库指纹 v1 —— 用于「扫描前后库指纹一致」这条不变量的验证

---

## 3. `apps/desktop/src/main/` —— 主进程

### 3.1 `index.mjs`（336 行）

| 块 | 职责 | 关键点 |
|---|---|---|
| 环境自愈 | 摘掉 `ELECTRON_RUN_AS_NODE` 重新拉起自己 | 该变量会让 Electron 以**纯 Node** 跑，报错极具误导性（注释列了三种误导性报错原文）；**dev 态不自愈**（重生会丢掉 dev server） |
| 配置 | `loadConfig()` 读 `config.json` | ⚠️ **文件已不存在 → 缺陷 R2** |
| 引擎 | `buildEngine()` + `ensureEncoder()` | 编码器**动态 import**（静态 import 会在模块实例化阶段抛，那时日志都来不及写） |
| 来源校验 | `isTrustedSender(event)` | `sender === 主窗口` + 拒 iframe + URL 必须是应用自身 |
| IPC 分发 | `ipcMain.handle(CH_INVOKE, …)` | 来源 → 载荷 → zod → 引擎；4 个未实现方法显式拒绝 |
| `thumb://` | `handleThumb(request)` | 形状只允许 `thumb://<libId>/<uid>@<size>`；路径由「注册表 + 索引」反查 |
| 窗口 | `createWindow()` | 三隔离 + 拒新窗口/导航 + 生产态留 DevTools（已决策） |
| 日志 | `log.mjs` | 主进程与渲染进程**同一个日志文件**（Electron 是 GUI 子系统程序，stdout 不连终端） |
| 自截图 | `GS_CAPTURE=<png>` | 应用自己截自己（用系统截屏抓窗口不可靠——被覆盖时会抓到别的应用） |

`thumb://` 的缓存与回退：

```
缓存命中 → 读 thumbs/<libId>/<uid>@<size>.jpg
未命中   → engine.absPathFor()（含库根包含 + 符号链接校验）
         → nativeImage.createFromPath → resize → toJPEG(82) → 落盘
```

### 3.2 `encoder.mjs`（103 行）· `log.mjs`（34 行）

- `encoder.mjs`：ONNX + WebGPU 编码器（重采样兼容层 `resize_compat` 的安装点）
- `log.mjs`：必须**最先导入**（导入即初始化日志），因为后面的模块可能在实例化阶段就抛

---

## 4. `apps/desktop/src/shared/ipc.mjs`（75 行）—— 契约唯一来源

一份 zod schema **同时**给出两件事：

1. **运行时参数校验**（`.strict()` ⇒ 多余字段直接拒绝）
2. **允许的方法名白名单**（`METHOD_NAMES` 由 `Object.keys(Methods)` 派生）

13 个方法。**引擎方法 10 个**：`search` · `item` · `indexStatus` · `scan` · `reveal` · `collect` ·
`ingest` · `mutate` · `indexStart` · `indexCancel`（后 4 个仅登记形状，主进程显式拒绝）。
**库配置 3 个（D2 新增，不经引擎、由主进程直接处理）**：`libraryConfig` · `libraryPickDir` · `libraryAdd`。

`validateCall()` 的顺序：方法名白名单 → 载荷 ≤ 1 MiB → zod `safeParse`。

> ⚠️ **已知不一致**：`apps/desktop/src/preload/index.js` 里的两个通道名是**手抄的字面量**，不是 import。
> 但**方法名不在 preload 里**（它通用转发 `invoke`），所以新增方法**不需要改 preload** —— 校验全在 zod 白名单。
> 真正的坑是另一个：库配置这 3 个方法由主进程 `registerIpc` **显式分派**，不在引擎上；忘了分派会被当成"引擎无此方法"拒绝。
> 这是刻意的（sandbox preload 的产物约束），但代价是**改通道名时必须同步这两处**（契约 + preload），
> 否则 IPC 会静默断开。`AGENTS.md` §3 已把它列为「改动时必须同步」的点。

---

## 5. `apps/desktop/src/renderer/` —— 界面

### 5.1 结构

```
renderer/
├── index.html          CSP + 挂载点
└── src/
    ├── main.jsx        React 挂载 + import renderer.css + import tokens.css
    ├── App.jsx         目前只有 <SearchPage />（**这就是 P3 只做了 1/4 的物证**）
    ├── renderer.css    281 行，只消费 var(--*)
    ├── hooks/          useEngine · useSearch · useToast
    ├── layout/         AppShell · Sidebar · Topbar · Main · PageHead
    ├── pages/          SearchPage
    ├── search/         SearchPanel · SearchSidebar · Gallery · PhotoCard · MetricsRow
    └── ui/             10 个自研组件（Button · Chip · Field · Metric · Progress · Score · SearchBox · Tag · Toast · cx）
```

### 5.2 `useSearch.js`（86 行）—— 检索状态机

| 职责 | 实现 |
|---|---|
| 参数拼装 | `{mode, topK:60, filters:{folders}}`；文本走 `text`，图像走 `queryImagePath` |
| 分类筛选 | **硬编码** `FOLDERS = ['VR','CR','CR+VR','其他']` |
| 排序 | 本地排序：`score`（默认）/ `name` / `recent`（recent **无数据源**，只弹提示） |
| 错误呈现 | 失败时 `setRawResults([])` + `setError(r.error)` ⇒ 界面显示 `userMessage` + 错误码 |
| 跨库跳过 | `libsSkipped` 非空时 toast 告知第一个原因 |

**两处实现问题（Lead 已核对）**

1. **分类白名单与库目录耦合**：`FOLDERS` 硬编码在渲染层，且默认检索**只查这 4 类**。
   库内实测确实只有这 4 类（`未分类 0` 条），所以**当前不暴露**；
   但一旦入库功能上线，「未分类」条目会被**默认过滤掉**。
   而空态文案（`Gallery.jsx:40`）写的是「换个说法，或把**渲染器分类**切回「全部」」——
   用户从没改过筛选，却被告知去改它。
2. **`sort === 'recent'` 是死选项**：没有数据源，选中只弹提示，且 `useMemo` 里
   `else if (sort !== 'recent')` ⇒ 选 `recent` 时**不排序**（保持后端相关度序）。

### 5.3 状态与反馈

| 状态 | 实现 |
|---|---|
| 载入（模型/检索） | `Gallery` 渲染 8 张骨架卡（`aria-hidden`） |
| 错误 | 面板显示 `userMessage` + 错误码（mono 字体） |
| 空结果 | 「没有匹配的素材」+ 提示切回「全部」 |
| 未检索 | 引导块（hint） |
| Toast | `useToast` + `Toast` 组件（`info` / `err` 两种 tone） |
| 事件推送 | `useEngineEvents` 处理 `encoder.ready` / `encoder.failed` / `index.progress` / `recovery.report` |

#### ⚠️ 成功标准 1b 未实现

「模型载入中就搜索 → **请求排队**并显示『模型载入中，稍候』」——
实际实现是：`useSearch` 直接 `await invoke('search')`，主进程 `ensureEncoder()` 会等模型载完，
期间界面只显示文案「检索中…（首次会载入模型，约 3 秒）」。
**没有排队语义、没有「模型载入中」的独立状态**，且文案里的「约 3 秒」是未经本环境验证的估算值。

---

## 6. 实现缺口汇总（按影响排序）

| # | 缺口 | 证据 | 性质 |
|---|---|---|---|
| I1 | ~~**`reveal` 静默假成功**~~ | ✅ **已修（F-01，2026-10-12）**：引擎返回 `PORT_MISSING`；主进程注入 `shell: createRevealPort(shell)`（`apps/desktop/src/main/ports.mjs`）；回归锁定见引擎 +5 条 / `apps/desktop/tests/ports.test.mjs` +4 条 / 守卫 §9 | ✅ **已修** |
| I2 | ~~**配置来源已断** —— 读已删除的 `config.json`~~ | ✅ **已修（D2，2026-10-12）**：库改为四路解析（`GEMMA_LIB_ROOT` > `userData/library-registry.json` > `config.json` > **索引自举**），实现 `apps/desktop/src/main/library-config.mjs` | ✅ **已修** |
| I3 | ~~**取件默认必失败** —— `collect.dirs` 为空~~ | ✅ **已修（F-04）**：默认 `{素材待用, 移出素材}`，可由注册表覆盖 | ✅ **已修** |
| I4 | **入库 / CRUD / 索引任务 全未实现**（4 个方法显式拒绝） | `apps/desktop/src/main/index.mjs:191-195` | 按计划未做（P4/P5） |
| I5 | **界面只有 1 页**（原型 6 页） | `apps/desktop/src/renderer/src/App.jsx` | 按计划未做（P3 的 3/4） |
| I6 | 成功标准 1b（模型载入中排队）未实现 | `apps/desktop/src/renderer/src/hooks/useSearch.js` | 按计划未做（P3b） |
| I7 | `thumb://` **无测试** | 无对应测试文件 | 测试缺口 |
| I8 | 生产态 DevTools **开着** | `apps/desktop/src/main/index.mjs:304` | 已决策的取舍 |
| I9 | `items.json` 存 `absPath`/`archiveAbsPath`，但**无任何代码读取** | grep 0 命中（渲染层与引擎） | 冗余字段 + 换机误导 |

---

## 7. 本文未覆盖

- `packages/indexer/src/` 索引构建器内部实现（1521 行，**该包没有 README**；诊断证据在 `reports/`）
- `scripts/electron-vite.mjs` 启动辅助的完整行为（114 行）
- 渲染层样式与 Apple 规范的逐项对差 → 见 [`../audit/UIUX-AUDIT.md`](../audit/UIUX-AUDIT.md)
- 技术栈选型的行业对标 → 见 [`../audit/STACK-AUDIT.md`](../audit/STACK-AUDIT.md)

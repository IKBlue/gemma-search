# TODO · 未完成项与待修 BUG

> **这份文件的唯一职责：回答「现在还有什么没做完 / 有什么坏了」。**
> 怎么干活、目录职责、约束与纪律 → [`AGENTS.md`](AGENTS.md)。项目是什么、怎么跑 → [`README.md`](README.md)。
>
> **单一事实来源分工（重要，别在别处再列一遍）**
> | 问题 | 看哪 |
> |---|---|
> | **现在要做什么 / 什么坏了**（可勾选行动清单） | **本文件** |
> | 什么顺序、什么算做完、验收阈值 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) · [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
> | 历史欠账台账（已清 / 未清逐条） | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
>
> ⚠️ **本文件只记"动作、证据、教训"**，不记"架构与规范" —— 规范在 [`AGENTS.md`](AGENTS.md)，事实与现状在 [`docs/PROJECT-INFO.md`](docs/PROJECT-INFO.md)。
> ⚠️ 每条都要带 `文件:行号` 或可复跑的命令；**无证据的写【判断，非实测】**。
>
> 最后核对：2026-10-14（本轮：重建 B-4 · C 节补 F-01 文案边界与扫描器两条坑 · B-5-3 留档门禁原始输出）

---

## A. 需修复 BUG（**已实测的违例**，不是猜测）

> 口径（所有者 2026-10-13）：**不引用已删守卫，也不新建守卫** —— 机械检查一律做成 `npm test` 里的断言。
> **A 节已于 2026-10-13 由 `task-21`（T5）执行完毕**（A-4 除外，它随 T4）。

### ✅ A-1 三层架构：Adapter 成为唯一入口 — **已修（T5-A/B/C）**

| 项 | 内容 |
|---|---|
| **改前** | **3 个文件、6 处**真实 `window.api` 直调：`hooks/useEngine.js` ×3（10/18/33）· `hooks/useLibraryConfig.js` ×1（16）· `pages/FirstRunWizard.jsx` ×2（26/39） |
| ⚠️ **原先记的 7 处是错的** | 旧记录说 `FirstRunWizard` ×3 —— 第 3 处（:13）其实是**注释**。**朴素的 `grep` 会把注释算成违例**，这正是旧记录出错的原因 |
| **改后（实测）** | **Adapter 之外 0 处**；全渲染层只剩 `adapter/api.js:52` 一处（合法） |
| **怎么复现** | `node --test --test-isolation=none apps/desktop/tests/layering.test.mjs`（L1/L2/L4） |
| **UI 层回归纯 UI** | `FirstRunWizard.jsx` 的两个库操作上移到 `hooks/useLibraryConfig.js` 的 `pickDir()` / `addLibrary()`，向导只吃 props |
| **状态** | ☑ 已完成 |

### ✅ A-2 禁 P2：重复的兜底实现 — **已修（T5-A/B/C）**

| 项 | 内容 |
|---|---|
| **改前** | 三种"重复实现"散在 6 个文件：① 用户文案兜底 `userMessage \|\| 默认` ② 每个调用点自己写 `try/catch` 编"调用异常" ③ 手工判 `r.error && r.error.x` |
| **改后（实测）** | ① **0 处**（只剩 `adapter/api.js:37`，唯一一份）② **0 处** ③ **0 处** |
| **一个可核对的数字** | **整个渲染层现在只有 1 个 `try/catch`，在 Adapter 里** —— Adapter 永不抛，调用点不再需要第二套错误处理 |
| **机制** | Adapter 保证 `error.userMessage` **永远是非空字符串** ⇒ 调用点不再抄兜底 |
| **怎么复现** | `layering.test.mjs` 的 **L6**（往 UI 层再抄一份兜底 ⇒ 变红，已双向验证） |
| **状态** | ☑ 已完成 |

### ✅ A-3 禁 P3：取件目录硬编码 — **已修（T5-D），但有一处如实保留**

| 项 | 内容 |
|---|---|
| **改前** | `main/library-config.mjs:43-44` 写死 `E:\素材待用` / `E:\移出素材`，且**没有任何配置入口** |
| **改后** | 解析链变成 **`GEMMA_COLLECT_DIRS` 环境变量 > 注册表 > `config.json` > 规格兜底**（与库根的 `GEMMA_LIB_ROOT` 同惯例）；新增 `parseCollectDirsEnv()`，**解析不出东西返回 `null` 而不是空对象** |
| ⚠️ **仍然保留的硬编码** | 那两个绝对路径**作为规格兜底仍在**（`DEFAULT_COLLECT`）—— 因为 `docs/spec/SPEC-app.md` §9 就是这么规定的，**改它要走规格变更控制，不在 T5 范围**。⇒ 非 `E:` 盘的机器应显式设 `GEMMA_COLLECT_DIRS` |
| **F-04 不回归** | 测试新增 ⑧b/⑧c：垃圾环境变量**不得**把白名单弄空（`collect.dirs` 变空会让任何 `collect` 都 `COLLECT_DIR_NOT_ALLOWED`） |
| **状态** | ☑ 已完成（含残留说明） |

### ✅ A-4 禁 P1：class 合并工具有两份 — **已修（T4）**

| 项 | 内容 |
|---|---|
| **现象** | `ui/cx.js`（本地实现）vs 已装的 `clsx` + `tailwind-merge`（= shadcn 的 `cn()`） |
| **为何仍未修** | 与 Tailwind 落地同批（`task-20` T4）—— 单独改会白改两次 |
| **改后** | ✅ `ui/cn.js` = `twMerge(clsx(...))` —— **全应用唯一一份**；`ui/cx.js` **已删除**。`Sidebar` / `Button` / `Chip` 三处已切过去 |
| **为什么留 `tailwind-merge`（不是只用 clsx）** | `clsx` 只拼接：`cn('px-3', 'px-2')` 两个类都留下，谁生效只看产出 CSS 顺序 —— **T3 迁移时真栽过**（Chip 选中态底色不变）。`twMerge` 按冲突组消解、后者胜 ⇒ 这类静默 bug 不再出现 |
| **怎么复现** | `deps.test.mjs` 的 **D-D**（`ui/` 下只允许 `cn.js` 一份 + 没人 import 已删的 `cx.js`）与 **D-E**（`cn` 必须真的是 `twMerge(clsx(...))`） |
| **状态** | ☑ 已完成（2026-10-13 T4） |

### ✅ A-5 分层规则没有检查 — **已修（T5-E）**

| 项 | 内容 |
|---|---|
| **标准** | `apps/desktop/tests/layering.test.mjs`（**断言，不是守卫**）+ `source-scan.test.mjs`（扫描器自检） |
| **断言** | L1 `window.api` 只在 `adapter/` · L2 UI 层零 `window.api` · L3 UI 不得直接 import Adapter · L4 Operation 层零 `window.api` · L5 Adapter 不 import React · L6 文案兜底只允许一份 · L7 反向自证 |
| ⭐ **双向验证（已实测）** | 往 UI 层注入一行 `window.api.invoke` ⇒ **L1+L2 变红（fail 2）**；再注入一份文案兜底 ⇒ **L6 变红（fail 1）**；还原 ⇒ 全绿 |
| **⭐ 扫描器必须区分代码与注释** | 朴素的 `grep` 会把注释算成违例（本仓库旧记录就这么错过一次）。`source-scan.mjs` 有 **8 条自检**，含当年栽过的两个坑：**含引号的正则字面量**、**被注释掉的接线不算** |
| **状态** | ☑ 已完成 |

**T5 门禁**：`npm test` **141 · pass 140 · fail 0 · skipped 1**（113 → 141，新增 28 条）· `npm run build` EXIT=0（三端齐备）· `npm run typecheck` EXIT=0

---
## B. 未完成项

### B-1 技术栈迁移（所有者 2026-10-13 指令）

**目标栈**：Electron · React · **TypeScript** · **shadcn/ui** · **Tailwind CSS** · **Zustand** · **React Router**

**迁移前实测现状**（2026-10-13 的 `grep` + `package.json`）—— **这是历史记录，别读成现状**：

| 项 | 迁移前现状 |
|---|---|
| Electron · React | ✅ 已在用（React 是**普通 JS/JSX，不是 TS**） |
| TypeScript | ⚠️ `typescript ^7.0.2` 已装，**渲染层/主进程全是 `.js`/`.jsx`/`.mjs`**；两个 tsconfig 的 `checkJs` **都关着** |
| Tailwind CSS | ⚠️ `tailwindcss` + `@tailwindcss/vite` 已装，**构建里没有插件**，渲染层零 import |
| shadcn/ui | ⚠️ 基础依赖全装了（`clsx` `tailwind-merge` `class-variance-authority` `lucide-react` `@radix-ui/react-dialog` `@radix-ui/react-alert-dialog`），**渲染层零 import** |
| Zustand | ⚠️ `zustand ^5.0.15` 已装，**零 import**（状态现为本地 hooks） |
| React Router | ❌ **未安装**（7 项里唯一要新增依赖的） |

> **现状（2026-10-14）**：**T1–T5 已全部完成** —— 见下方逐条完成记录。一句话版：Tailwind 生成层已接线 ·
> Zustand 与 React Router 真接入 · `cn()` 收口 · 依赖清账（"已装零 import" 19 → 0，`lucide-react` / `@tanstack/react-virtual` **已删**）·
> `npm run typecheck` 门禁存在且 EXIT=0（**只覆盖 `.ts`**）。⇒ 下表只作**迁移前的基线**保留。

**⚠️ 关于类型门禁（迁移期的结论，仍然成立）**：`npx tsc --noEmit` 曾因 `checkJs` 关着而**「假绿」**（EXIT=0 / 0 错误）。
临时打开 `checkJs` 后的**真实规模**：渲染层 **148** 错 · 主进程侧（含 `packages/engine/src` + `tools/`）**472** 错。
⇒ **门禁只覆盖 `.ts`，永远不得声称"全局类型检查通过"。**

**已拆成串行任务**（顺序不可乱；因为 `package.json` 与 `renderer/` 是共享写入面）：

| 任务 | 做什么 | 前置 |
|---|---|---|
| `task-17` **T1** | ✅ **已完成 2026-10-13**（见下方「T1 完成记录」）—— **6 项验收里 5 项达标、1 项只做了一半** | — |
| `task-21` **T5** | ✅ **已完成 2026-10-13**（A-1/A-2/A-3/A-5 已修；A-4 随 T4） | T1 |
| `task-18` **T2** | ✅ **已完成 2026-10-13**（见下方「T2 完成记录」） | T5 |
| `task-19` **T3** | ✅ **已完成 2026-10-13**（见下方「T3 完成记录」） | T2 |
| `task-20` **T4** | ✅ **已完成 2026-10-13**（见下方「T4 完成记录」） | T3 |

**详细验收标准** → `docs/plan/ROADMAP.md` §10（逐条表格，**不要在这里重复**）。

#### T1 完成记录（2026-10-13）

| 验收 | 结果 |
|---|---|
| 1 `npm run typecheck` 存在且 EXIT=0 | ✅ |
| 2 ⭐ **门禁能红** | ✅ 注入 `const x: number = "str"` ⇒ `apps/desktop/src/shared/ipc.ts(165,7): error TS2322` + **EXIT=1**；还原 ⇒ EXIT=0 |
| 3 契约类型被导出**且被用上** | ⚠️ **只做到一半**：导出了 `MethodName` / `Req<K>` / `OkEnvelope` / `ErrEnvelope` / `Envelope` / `ValidateCallResult`，但 **grep 不到任何消费者**。原因：`checkJs: false` ⇒ `.mjs` 调用方即使用 JSDoc `@type` 也不会被检查，加了就是装饰。**真正的消费要等 T5（Adapter 转 TS）或 T2–T4 打开 `checkJs`** |
| 4 没用 `any` 换绿灯 | ✅ `ipc.ts` 内 `: any` / `as any` 0 命中 |
| 5 node 能加载 `ipc.ts` | ✅ Node **v24.14.0** 原生类型剥离，`npm test` fail=0 |
| 6 回归 | ✅ `npm test` 113·112·0·1 · `npm run build` **EXIT=0** 且产物含契约（`out/main/index.js` 命中 `engine:invoke` 2 处） |

**⚠️ 因此现在的正确说法是**：型别门禁**已能为真、但只覆盖 `ipc.ts` 一个文件**。
**不得说"类型检查通过"** —— `checkJs` 仍关着，`.js/.jsx/.mjs` 全部未检查（ROADMAP §10.1.1：渲染层 148 错 / 主进程侧 472 错）。
这条缺口已记在 `TODO.md` 的 B-1（T3–T4 打开 `checkJs` 时收口），**不要当成已完成**。

#### T2 完成记录（2026-10-13）

| 项 | 实测结果 |
|---|---|
| `react-router` 真 import | ✅ **4 处**：`router/index.jsx` · `layout/Sidebar.jsx`（`NavLink`）· `pages/ItemPage.jsx` · `pages/TasksPage.jsx`。**v7.18.4** —— 此前未安装，是 7 项里唯一新增的依赖 |
| ≥3 条路由可达 | ✅ `/` · `/item/:libId/:uid` · `/tasks`。用 react-router 的 **`matchRoutes()` 真解算**（`router.test.mjs` 5 条），不是 grep 字符串 |
| `zustand` 真 import | ✅ **1 处**：`store/search.js`（此前是"已装零 import"） |
| 被取代的本地 hook **已删除** | ✅ `hooks/useSearch.js` **已删**；渲染层已无任何地方 import 它（精确 grep = **0**） |
| ⭐ 状态切换真的生效 | ✅ `search-store.test.mjs` 12 条：setX 真的改 state · `run()` 参数拼装（「全部」→ 四个目录）· 校验失败**不发 IPC** · busy 时挡住重复调用 · 失败时 `rawResults` 变 `[]` 而不是留着旧结果 |
| ⭐ 首启向导不回归 | ✅ 判定抽成纯函数 `utils/gate.js` 的 `decideGate()` ⇒ 进 `npm test`（`gate.test.mjs` 6 条）。**此前这条行为只被已删的 DOM 守卫覆盖过** |
| 回归 | ✅ `npm test` **164 · 163 · 0 · 1** · `layering.test.mjs` **L1–L7 全绿**（新目录 `store/` `router/` `utils/` 不违反分层）· `npm run build` EXIT=0 |

**⭐ 双向验证（已实测）**：
- 让 `decideGate` 恒返回 `app`（= 无库也进主界面，即 **D2 回归**）⇒ `npm test` **fail 3 / EXIT=1**（G3/G5/G6）
- 从路由表删掉 `/item` 那条 ⇒ `npm test` **fail 2 / EXIT=1**（R1 路由数不足 + R3 参数捕获）
- 还原 ⇒ **全绿**

**⚠️ 人工核对（自动测不到的部分）—— 这条仍是待办**：
真实渲染 · 点击侧栏导航 · hash 变化 · 返回键 —— 这些要 DOM。覆盖渲染层的 DOM 守卫已于 2026-10-13 移除，
而本环境的 `npm run dev` 需要能出窗（见 `TODO.md` B-3）⇒ **不得仅凭 `npm test` 绿就声称"多页没问题"**。
⇒ ☑ **已退役（2026-10-13，同日接入 Playwright）**：这条待办不再需要人工做 ——
`npm run e2e` 的 **E2 系列**真的启动应用点侧栏、读 hash、验未知路由回退；**E1 系列**验无库时显示向导。
见 `apps/desktop/e2e/routing.spec.mjs` 与 `gate.spec.mjs`。

#### ☑ T2 的「人工核对观感」已执行（2026-10-13）—— 并抓出两处真缺陷

**做法**：起草 `data/_t2-verify.mjs`（Playwright 真启动 Electron）—— 点 3 条路由、每页截图、
并**同时**从渲染进程（`location`/`document.title`）与**主进程**（`BrowserWindow.getURL()/getTitle()`）两侧记录事实。

**⭐ 先纠正一个说法**：Electron 窗口**没有浏览器地址栏**。所谓"地址栏跟着变"只能验两件事：
渲染进程的 `location.hash`、以及主进程看到的 `win.webContents.getURL()`。两者都验了。

| 操作 | `location.hash` | `<h1>` | 主进程 `win.url` |
|---|---|---|---|
| 默认落点 | `""` | 找到你想要的那张图。 | 无 hash |
| 点「索引任务」 | `#/tasks` | 索引任务与操作记录 | **带 `#/tasks`** |
| 点「语义搜索」 | `#/` | 找到你想要的那张图。 | 带 `#/` |
| 深链 `/item/L1/0123456789ab` | `#/item/L1/0123456789ab` | 图片详情 | **带参数** |
| 未知 hash | `#/`（回退） | 找到你想要的那张图。 | 回退 |

窗口数始终 **1** · `visible=true` · 侧栏当前项高亮正确 · 面包屑正确。**路由本身没问题。**

**❌ 但观感上抓出两处真缺陷（都是 T2 引入的，已修）**：

**① `<a>` 嵌在 `<button>` 里（4 处）** —— `ItemPage:29,48` · `TasksPage:28,41` 写成了
`<Button><Link>…</Link></Button>`。三条后果，都不是审美问题：
- **HTML 规范禁止**（交互内容不得嵌套交互内容）
- **可访问性坏掉**：变成两个可聚焦元素，读屏会念成"按钮里有个链接"
- **视觉坏掉**：图标按钮内容不居中（截图里可见）
修法：`Button` 补 **`asChild`**（Radix `Slot` 把 props/className 合并到子元素 ⇒ 只渲染一个 `<a>`）。
⇒ `@radix-ui/react-slot` **重新接入生产依赖**（T4 删它是因为当时零 import；现在真用了，生产依赖 12 → **13**）。

**② `document.title` 从不随路由变** —— `index.html` 与主进程建窗时各硬编码一份，切到「索引任务」
任务栏还写着"素材语义检索"。修法：`router/paths.js` 导出 **`LABELS`**(页面名唯一来源) + `APP_NAME`，
`utils/useDocumentTitle.js` 一处实现，3 个页面各调一行。实测三条路由三个标题，**主进程 `win.title` 同步**。

**⭐ 两处都变成了常驻断言（人工核对 → 断言，这是它该有的归宿）**：
- `apps/desktop/tests/dom-validity.test.mjs` **V1–V4**（静态：不许按钮套链接 / `Button` 真有 `asChild` / 标题单一来源）
- `apps/desktop/e2e/routing.spec.mjs` **E6-a/b/c**（真窗口：DOM 里 `button > a` = 0 · 返回控件是 link · 标题随路由变）
- **双向验证**：把 `asChild` 去掉 ⇒ `npm test` **fail 1** 且精确报出 `TasksPage.jsx → <Button><Link`；还原 ⇒ 全绿

⚠️ **我先前的一个判断是错的，如实记下**：从低分辨率截图我怀疑"右上角图标按钮没居中"，
**实测 `centerOffset = {dx:0, dy:-0.6}`**（36×36，`justify-content: center`）⇒ **它本来是居中的**。
截图看走眼 —— 所以这类结论必须量，不能靠看。

#### T3 完成记录（2026-10-13）

| 项 | 实测结果 |
|---|---|
| Tailwind **真的生成类** | ✅ `@tailwindcss/vite` 接进 `electron.vite.config.mjs` 的 renderer 段；入口 `renderer/src/styles/tailwind.css`。产物实测：`.min-h-11{min-height:calc(var(--space-1) * 11)}` · `.px-3{padding-inline:calc(var(--space-1) * 3)}` · `.bg-surface-raised{background-color:var(--color-bg-elevated)}` · `.rounded-control{border-radius:var(--radius-md)}` |
| ⭐ **色值只有一处定义** | ✅ **渲染层裸色值 = 0**（实测，已剥注释/字符串）；色彩值只在 `tokens.css`（78 处）。⚠️ **`@theme` 映射里 0 个字面值** —— `@theme inline` 的语义就是不复制值（所以产物里查不到 `--color-surface`，**这是对的**） |
| ⭐ **断言能红** | ✅ 往 `ui/Toast.jsx` 注入 `'#ff0000'` ⇒ **只有 T1 红 / fail 1**，且报出 `Toast.jsx → #ff0000`；往 `ui/Score.jsx` 注入 `0.97` ⇒ **只有 T2 红 / fail 1**，报出 `Score.jsx → 0.97`。还原 ⇒ 全绿 |
| F-02 的断言**没丢** | ✅ 已接回：`styles.test.mjs` 的 **T2**（0.6~0.99 阈值常量）+ **T2b**（`Score.jsx` 必须消费 `band`、未知 band 拒绝定档） |
| 职责边界写清楚 | ✅ `renderer.css` 头部写明"手写层 vs 生成层"、import 顺序的**理由**、以及**迁移比例** |
| 回归 | ✅ `npm test` **175 · 174 · 0 · 1** · `npm run e2e` **18 passed** · `npm run build` EXIT=0 |

**⭐ 迁移进度（如实记账，不许读成"迁完了"）**：迁移前 **126** 条规则 ⇒ 迁出 **12** 条（**≈9.5%**），现 **114** 条仍在 `renderer.css`。
- 已**整族迁完并删除旧规则**：`Button`（`.btn` / `.btn.primary` / `.btn.wide` / `.icon-btn` / `.card-acts .btn` / `.card-acts .btn.pri`）· `Chip`（`.chip` / `.chip.active`）
- 两个绕过组件的裸用法已收编（`LibraryGate` 的"重试"、`Gallery` 的"清除选择"）

**⭐ 迁移保真度验证（新增 `e2e/styles.spec.mjs`，5 条）**：判据是**令牌本身**，不是写死的期望值 ——
`getComputedStyle` 读迁移后的计算值，断言它**等于该令牌的计算值**（改令牌时测试跟着变，不会变成假门禁）。
实测：Button(default) radius 8px=`--radius-sm` · minH 44px=`--touch-min` · padding 8/12px · 13px；primary `#0071e3`/`#fff`；icon 36×36 · radius 10px；Chip radius 999px · minH 32px · padding 8/16px。

**⚠️ 迁移中真栽的两个坑（都已写进代码注释，别重踩）**：
1. **修饰态写"叠加"会失效** —— `cx(BASE, active && "bg-ink")` 里两个工具类**同优先级**，谁赢只取决于产出 CSS 的顺序。旧 CSS 的 `.chip.active` 是独立规则所以永远赢，迁到 Tailwind 后这个保证没了 ⇒ 实测"点筛选胶囊底色不变"（`E4-e` 抓到）。**改成互斥**：`cx(BASE, active ? ACTIVE : IDLE)`。
2. **色值/类名断言用 `maskNonCode` 会变成空断言** —— 真实违例写在**字符串**里（`'#ff0000'`、`className="btn"`），而它会连字符串一起抹掉。为此新增 `maskComments`（只抹注释、保留字符串），并补了 `source-scan.test.mjs` 的 S9–S12。**这是双向验证抓到的**：第一次注入 hex，T1 竟然不变红。


#### T4 完成记录（2026-10-13）

| 项 | 实测结果 |
|---|---|
| ⭐ **不再有"已装零 import"** | ✅ 生产依赖 **25 → 12**，其中零 import **19 → 0**；开发依赖 14 → 12。**测量方法可复跑**：`npm test` 的 `deps.test.mjs` **D-A**（读 `package.json` + 四形态引用扫描，零 import 且不在白名单就红） |
| ⭐ **断言能红** | ✅ 往 `package.json` 注入一个"声明了但零 import"的 `left-pad` ⇒ **D-A 红 / fail 1** 且指名道姓；还原 ⇒ 全绿 |
| 确认弹窗（真缺口） | ✅ `ui/ConfirmDialog.jsx` 用 **Radix `AlertDialog`**（`role="alertdialog"` + 焦点陷阱 + ESC + 焦点归还 + 点遮罩不误关）。接线：`PhotoCard` 的「取件」→ `requestCollect` → 弹窗 → `confirmCollect` |
| ⭐ 取消后动作**未执行** | ✅ `search-store.test.mjs` **Z13–Z17**：`requestCollect` 零 IPC · `cancelCollect` 后仍零 IPC · `confirmCollect` 发一次且**先清状态再执行**（连点两次只发一次）· 无待确认项时是空操作 |
| ⭐ `aria-*` 缺口补上且**可验证** | ✅ E2E `a11y.spec.mjs` **4 条**（真窗口）：Chip 的 `aria-pressed` 真的翻转 · 侧栏 `aria-current="page"` 跟着路由走 · 空闲时不渲染弹窗 · 图标按钮有可读名字 |
| `cn()` 收口 | ✅ `ui/cx.js` 已删除；`deps.test.mjs` **D-D/D-E** 钉住"只有一份实现" |
| 回归 | ✅ `npm test` **191 · 190 · 0 · 1** · `npm run e2e` **22 passed** · `npm run build` EXIT=0 · `npm run typecheck` EXIT=0 |

**删掉的（逐条确认零引用）**：11 × `@radix-ui/react-{checkbox,dialog,dropdown-menu,label,popover,select,slot,switch,tabs,toast,tooltip}` ·
`@tanstack/react-virtual` · `lucide-react` · 开发依赖 `vitest`（本仓库用 `node:test`）· `jsdom`（原 DOM 守卫的依赖）。

**⭐ 差点删错的（本轮最重要的教训）**：第一版测量**只匹配静态 `from`/`require`**，于是 `sharp` 与 `bmp-js` 被判成"零 import" ——
而它们其实是**动态**加载的（`packages/indexer/src/bmp_decode.mjs:139` 的 `await import('sharp')`、`:55` 的 `await import('bmp-js')`）。
删掉它们 = **编码路径静默坏掉**。⇒ `deps.test.mjs` 的 **D-C** 专门钉这条（"断言自己有效：能看见动态 `import()`"）。

**⚠️⚠️ T4 第二个真 BUG：`tailwind-merge` 把我们的自定义字号当颜色吃掉了**
   E2E 的 `styles.spec.mjs` **E4-a/b/d** 在首次全量跑时报红（`color` / `fontSize` 与令牌不符）——
   根因：twMerge 默认配置里 `text-*` 分两组，`font-size` 只认**内置档位**，其余 `text-<任意>` 落到
   `text-color` 的**通配**组。我们用的是自定义名（`text-caption` 由 `@theme --text-*` 生成）⇒
   它以为是颜色，与 `text-ink` 判冲突、**丢掉字号**。
   症状极具误导性：**构建通过、页面不白屏**，只有真窗口量 `getComputedStyle` 才看得出来。
   ⇒ 修法 `extendTailwindMerge` 登记 8 个字号名；回归锁 `styles.test.mjs` 的 **T5/T5b**（纯函数、不需要 DOM、比 E2E 快得多）。

**⚠️ 测试的坑：断言把自己数进去了** —— `deps.test.mjs` 为了写断言必须把依赖名当**数据**写出来，
于是它自己被当成"有 import" ⇒ D-A 永远绿、D-C 永远红。修法：扫描范围**排除这一个文件**（并在代码里写明为什么）。

**⚠️ 人工核对（自动测不到）**：确认弹窗的 **ESC 关闭 / 焦点落位** —— 要走到"有检索结果"才会出现，
而检索需要 ONNX 模型（`TODO.md` B-3）。`a11y.spec.mjs` 只覆盖到"空闲时不渲染"。
⇒ ☑ **已完成（2026-10-13）**：确认弹窗的 **ESC / 焦点落位 / 焦点归还**，**全部在真窗口里实测**。
详见下方「T4 的 ESC / 焦点核对」。

**2026-10-13 的一次尝试（未成功，但把解锁方法找到了）**：
这条一直卡在"弹窗只在**有检索结果**时出现，而检索需要 ONNX 模型"。试了两条路：
- ❌ **替换 `window.api`** —— 不可行。实测 `configurable:false / writable:false / frozen:true`
  （contextBridge 的安全加固，**是特性不是障碍**，别去绕它）。
- ✅ **在主进程的 `ipcMain.handle('engine:invoke')` 打桩**（`main/index.mjs:207`）—— **这条路是通的**，
  而且它是**正确的缝**：替换的只是"要 300MB 模型的引擎"，渲染进程侧全是真的
  （真 preload → 真 IPC → 真 adapter → 真 store → 真 PhotoCard → 真 ConfirmDialog → 真 Radix）。
  ⇒ **顺带解开一个更大的死结：结果区 UI 从此不依赖模型也能自动化。**

已写成 `apps/desktop/e2e/confirm-dialog.spec.mjs`（6 条：弹前不发 IPC · 焦点陷阱 · ESC 不执行 ·
取消不执行 + 焦点归还 · 确认恰好一次 · 连点只发一次）。
✅ **6 条已全部调通并通过**，见下面的完成记录。

#### ☑ T4 的 ESC / 焦点核对（2026-10-13，真窗口实测）

**做法**：`apps/desktop/e2e/confirm-dialog.spec.mjs` 的 **E7-a…E7-f（6 条）**，在真 Electron 窗口里跑。
关键解锁点：**在主进程的 `ipcMain.handle('engine:invoke')` 打桩**（`main/index.mjs:207`）——
只把"要 300MB 模型的引擎"换掉，**渲染进程侧全是真的**（真 preload → 真 IPC → 真 adapter → 真 store
→ 真 PhotoCard → 真 ConfirmDialog → 真 Radix）。⇒ **"结果区 UI"从此不依赖模型也能自动化。**

| 断言 | 实测结果 |
|---|---|
| 点「取件」先弹确认框，**此刻零 `collect`** | ✅ E7-a |
| **焦点陷阱**：打开后焦点落进弹窗；连按 6 次 Tab 焦点始终在弹窗内 | ✅ E7-b（实测落在 `BUTTON "取消"`） |
| **ESC 关闭**，且此后**一个 `collect` 都没发** | ✅ E7-c |
| 点「取消」不执行 + **焦点归还**给触发它的「取件」 | ✅ E7-d（实测归还给 `BUTTON "取件"`） |
| **确认才执行**：`collect` 恰好一次，参数 `{libId:'L1',uids:['aaa111aaa111']}` | ✅ E7-e |
| 连点两次确认只发一次（先清状态再执行） | ✅ E7-f |

**⭐ 双向验证**：把 `onOpenChange` 注入成空操作（ESC 关不掉）⇒ **E7-c 变红**（`fail 1` / EXIT=1，
报 `toHaveCount failed`）；还原 ⇒ 6 条全绿。⇒ **这条断言有牙**，不是摆设。

**⚠️ 更正一处原验收措辞**：任务里写的是"焦点落在**确认钮**上"，**实测落在「取消」上** ——
而且**这是对的**：破坏性操作的确认框，默认焦点应当停在**安全的那一侧**，
误按 Enter 不该把文件搬走（macOS HIG 的破坏性确认惯例）。**别"顺手改成落在确认钮上"。**

**⭐ 核对过程又抓出一个真缺陷（已修）**：点「取消」关闭后，`document.activeElement` 是 **`BODY`** ——
**焦点没归还**，键盘/读屏用户会"迷路"（下一个 Tab 从页面开头重新开始）。
根因：`ConfirmDialog` 用的是**受控 `open`**，那个「取件」按钮**不是 `AlertDialog.Trigger`**
⇒ Radix 内部没有 trigger 可归还（原文件里"Radix 会归还焦点"那句注释是**错的**，已改）。
修法：`onOpenAutoFocus` 记下来源 + `onCloseAutoFocus` 里 `preventDefault()` 后显式 `focus()`。
⚠️ **必须在 `onOpenAutoFocus` 采样，不能用 `useEffect(…, [open])`** —— React 的 effect 是**子先父后**，
`Content` 的挂载 effect 已经把焦点移到「取消」了，父组件再读 `activeElement` 抓到的是**弹窗里那个按钮**，
关闭时它已卸载 ⇒ 不还。这个坑第一次改**就是这么错的**（E7-d 仍然红）。

**⚠️ 打桩自身的两个坑（都写在 spec 文件头，别再踩）**：
① **桩必须回答"启动期"方法**（`libraryConfig` / `indexStatus`），不能对未知方法一律回 `{}` ——
   第一版就是这么写的，`LibraryGate` 拿到空 data ⇒ `decideGate()` 判成 `wizard` ⇒ 显示首启向导、
   **压根没有输入框** ⇒ 6 条全卡在 `locator.fill` 超时，**症状伪装成"选择器不对"**。
② **装桩后必须 `reload()`** —— `firstWindow()` 只等 `domcontentloaded`（`helpers/launch.mjs:58`），
   React 还没挂载，启动调用会**竞态**落到桩上。reload 之后应用是"对着桩"完成启动的，时序才确定。

**⚠️ 打桩的边界（别读成"什么都测了"）**：它替换的是**引擎语义**，被绕过的包括 zod 参数校验、
1 MiB 载荷上限、真实 engine 的错误码 —— 那些由 `permissions.test.mjs`(13 条) 与引擎单测覆盖。
**⚠️ 环境限制（新遇到，已记录）**：本轮起 `npm run build` 出现
`[vite:esbuild-transpile] remove ...Temp\esbuild-...: Access is denied`（esbuild 删不掉系统 Temp 里的临时文件）。
**绕法**：把 `TEMP`/`TMP` 指到工作区内（如 `data/_esbuild-tmp`）后 EXIT=0。
⛔ **没有**把这个绕法写进 `package.json` —— 那是环境怪癖，不该固化进产品配置（同 §7「不把 `--no-sandbox` 固化」的道理）。
**⚠️ 仍留在手写层的（不属 T3 范围）**：其余 114 条规则（基础层、布局外壳、卡片/骨架/弹窗等）—— 逐族推进。

### B-2 未实现的功能

| # | 项 | 现状 / 证据 | 状态 |
|---|---|---|---|
| B-2-1 | ~~**多页路由**~~ | ✅ **已完成（2026-10-13 T2；同日扩到 4 条）**：hash 路由 **4** 条（`/` · `/item/:libId/:uid` · `/tasks` · **`/activity`**）· 侧栏「索引任务」**与「操作记录」**都可点 · 未知 hash 回搜索页。✅ 真实导航由 **E2 + E6 + E11-a**（真窗口）覆盖，且 2026-10-13 人工核对过一轮 | ☑ 已完成 |
| B-2-2 | **D8 多库注册表未持久化** | 只有「从配置派生单库」（`packages/engine/src/library.mjs`）；真正的多库注册表是 **P5**，**无任何持久化** | ☐ 未开工 |
| B-2-3 | **未实现的契约方法** | 现在**只有一处清单**：`packages/engine/src/engine.mjs` 的 **`UNIMPLEMENTED_METHODS`** = `ingest` · `mutate` · `transactions` · `indexStart` · `indexCancel` · `indexResume`（主进程直接 import，统一返回「这个功能还没做好。」）。契约形状已冻结 → `docs/spec/CONTRACT-engine-v1.md` §2.0/§2.12。<br>⚠️ **注意方法数从"四个"变成了"六个"**：P3d 实现过程中补了 `transactions`（契约 §2.11）与 `indexResume` 的白名单登记 —— 它们**在此之前连"被拒绝"都算不上**（`indexResume` 会被当成"未登记的方法"）。 | ☐ 未开工（P4/P5） |
| B-2-4 | ~~**P3c / P3d 两个页面**~~ | ✅ **已完成（2026-10-13）**：`pages/ItemPage.jsx`（P3c）· `pages/TasksPage.jsx` + `pages/ActivityPage.jsx`（P3d）。<br>**前置**：契约 §8 的**模拟模式**此前完全缺失 ⇒ P3c/P3d 的验收本不可复跑，同日补齐（`fixtures/sample-index.json` + `fake.mjs` + `GEMMA_FAKE=1`）。<br>**证据**：E2E **E8**(6) + **E9**(6) + **E10**(6) + **E11**(6)；单测 `item-actions`(10) · `task-store`(13) · 引擎 `fake`(22)。<br>⚠️ **如实标注两处未验**：① 「取消在边界生效」与「ETA 误差 <30%」是在**模拟模式**下验的，真实 `indexStart` 未接线；② 详情页的「重新编码这一条」「替换预览图」两个按钮**契约里没有对应方法** ⇒ 禁用并写明原因（不是坏掉）。 | ☑ 已完成 |
| B-2-5 | **未做的虚拟滚动（不是"未接线的依赖"）** | ⚠️ **原写「`@tanstack/react-virtual` / `lucide-react` 等未接线」已过期**：T4 依赖清账时二者因**零 import 被删除**（见 B-1），已不在 `package.json` 里。**真正缺的是功能**：浏览整库 3594 条需要虚拟滚动，当前 `search/Gallery.jsx` 未实现 | ☐ 未开工（原状态写「随 `task-20`」，而 task-20 已完成 ⇒ **指针已过期，本轮更正**） |
| B-2-6 | **P3c/P3d 用到的三条新契约面**（2026-10-13 新增，**均已进契约文档**） | ① `itemPaths`（§2.2a，只读；P3c 的"两条绝对路径"）② `transactions`（§2.11，只读；操作记录的数据源，依据 `SPEC-transactions.md:229`）③ `mutate` 的 `uid` 对 `undo` 放宽为可选（§2.7）。<br>三条都是 **§9.1 口径的兼容改动**（新增 / 放宽）。⚠️ **真实模式实现仍未接线**（除 `itemPaths`：它已真实现）。 | ☐ 实现待 P4/P5 |

### B-3 未验证的能力（**不得声称可用**）

| # | 能力 | 为什么未验证 |
|---|---|---|
| B-3-1 | **冷启动耗时** | 从未测过 |
| B-3-2 | **打包后行为** | 从未打包验证 |
| B-3-3 | **真实 `thumb://` 取图** | 守卫只在**假 `electron`** 下验证过逻辑；真实协议取图未测 |
| B-3-4 | **真 Electron 窗口行为** | ⚠️ **部分已实测（2026-10-13，Playwright E2E）**：✅ `window.open` **真被 deny**（返回 null、无第二窗口 —— `window-security.spec.mjs` E3-a）· ✅ 外部导航**真被拦**（URL 不变 + 渲染层仍活 —— E3-b）· ✅ `process`/`require`/`module` 在真窗口里全 `undefined`（`smoke.spec.mjs` E0）· ✅ 出窗与界面渲染（E0/E1）。❌ **仍未实测**：iframe 内调 `invoke` 是否真被拒（E2E 里可造 iframe，尚未做）· 真实 `thumb://` 取图 |
| B-3-5 | **受限沙箱内的 `npm run build`** | 在 agent 沙箱里是 `spawn EPERM`（esbuild 常驻服务）⇒ 需提权；**这是环境限制，不是配置问题** |
| B-3-6 | **模拟模式的真实边界（2026-10-13 新增，务必别含糊）** | `GEMMA_FAKE=1` 下 E8–E11 证明的是「**接线通 + 界面能渲染全部状态**」，**不是**检索质量、**不是**编码正确性。假进度、假事务、假路径都来自 `fixtures/sample-index.json`。凡引用 E8–E11 的结论，都要同时说明这一点。 |
| B-3-7 | **取消"边界生效"与 ETA 精度** | 在**模拟模式**下验过（E10-d：取消后 `done` 停在中途、`< 30`）；**真实 `indexStart` 未接线** ⇒ 真机上的取消延迟与 ETA 误差**仍未实测**（ROADMAP 写的是"误差 <30%"、"最多 2 s 收尾"）。 |

### B-4 被移除的 6 个守卫（**代价与逐条归属** —— 唯一权威）

> 所有者指令（2026-10-13）：「仅保留 `verify_encoder_path` + `check_search`，其余全部移除」。
> 被移除的 6 个：`verify_app_build` · `verify_main_wiring` · `verify_renderer_dom` · `verify_renderer_styles` · `smoke_app` · `verify-doc-refs`。
> **原件已备份在 `data/_removed-guards-backup/`**（含从未提交的 `verify_main_wiring.mjs` —— 不在备份里就永久丢失）。
> **恢复方式**：拷回 `tools/` + 还原 `package.json` 的 `smoke` 脚本。
>
> ⚠️ **引用本表时不要读成"现在全都没有"**：移除当天（2026-10-13）又接入了 Playwright（`npm run e2e`），
> 把**渲染层与真窗口那一层**补了回来，而且比原来强（原来 `verify_main_wiring` 用的是**假 `electron`**，现在是真的）。
> 「现在谁负责」一列是最新的。

| 能力 | 原本由谁提供 | 移除后的状态 | 现在谁负责 |
|---|---|---|---|
| 出窗能力 | `smoke_app` | 无 | ✅ **E2E E0**（真启动 + 读真窗口，非白屏、0 控制台错误） |
| preload 暴露面 / S9 渲染进程 Node 能力 | `verify_app_build` | 无 | ✅ **E2E E0** —— 在真窗口里读真的 `window.api`（恰好三键），不再是产物文本断言 |
| 首启向导真界面（D2） | `verify_renderer_dom` | 无 | ✅ **E2E E1** |
| S11/S12 窗口安全**真行为** | `verify_main_wiring` | 无 | ✅ **E2E E3**（比原来的假 `electron` 强） |
| S13 iframe 来源校验 | `verify_main_wiring` | 无 | ❌ **仍无**（E2E 里可以造 iframe，尚未做）—— 见 B-3-4 |
| 路由真导航 | `verify_renderer_dom` | 无 | ✅ **E2E E2** |
| ⭐ **接线在行为上是否活着** | `verify_main_wiring` | 无 | ⚠️ **只剩纯逻辑单测**：F-01 `reveal` 由引擎单测 + `ports.test.mjs` 覆盖，**行为层无证据** |
| 分层 / 文案收敛 / 路由表 / 门禁判定 | 无（原本靠人看） | 无 | ✅ **`npm test`**（`layering.test.mjs` L1–L7 等断言，2026-10-13 新增 49 条） |
| 结果区 UI（结果卡 / 取件确认 / 档位渲染 / 定位失败文案） | `verify_renderer_dom` | 无 | ✅ **E2E E7**（靠**主进程 IPC 打桩**摆脱模型依赖，在真窗口里跑真组件） |
| **真实检索质量 / 缩略图内容** | — | 无 | ❌ **仍无** —— 要真模型 + 已注册索引（见 B-3）；打桩测的是**接线与界面**，不是编码质量 |
| 样式与令牌纪律 + F-02 界面自算阈值 | `verify_renderer_styles` | 无 | ✅ **2026-10-13（T3）已接回**：`styles.test.mjs` 的 T1/T1c/T2/T2b（双向验证过）+ E2E E4 |
| 产物形状（ESM/CJS · external · CSP · preload） | `verify_app_build` | 无 | ❌ **仍无** |
| 打包态 / 冷启动计时 | — | 无 | ❌ **仍无**（P6 的 G-E1）—— 见 B-3-1 / B-3-2 |
| 文档引用解算 + 根目录纪律 | `verify-doc-refs` | 无 | ❌ **仍无**（只能靠人看；2026-10-14 `AGENTS.md` 改版后另有「旧编号映射表」需人工维护） |

**现存 2 个守卫都能启动，但本沙箱跑不动**（需模型目录 + 已注册索引）⇒
**"守卫全绿"在本环境已无法验证**，不要声称验证过。
⇒ **本仓库唯一可跑的自动化门禁是 `npm test`**（2026-10-14 实测 **313** 条纯逻辑单测）。
原本考虑过写 `npm run verify` 把这两个守卫串起来，**已否决**（两个都跑不动，加了也只是空壳）。

---

### B-5 门禁自身的可靠性（2026-10-13 —— **已定位并修复，但教训要留**）

> ⚠️ **为什么单独立一节**：这一节记的不是产品缺陷，而是**门禁自己曾经不可靠**。
> 它必须显式记下来 —— 否则下一个人看到"56 passed"会以为它是确定性的，
> 而看到一次红又会误判成产品回归。

#### B-5-1 · `npm run e2e` 全套偶发单条失败 → **已定位：是断言写错，不是 flake**

| 项 | 内容 |
|---|---|
| **现象** | 全套（2.4 分钟 / 约 60 次 Electron 起停）里 `tasks.spec.mjs` 的 **E10-f** 挂；**单独跑该文件、或单独跑那条用例都通过**。观察到的故障率约 **2/3**。 |
| **真因**（终于拿到原始输出） | `Error: strict mode violation: getByText(/这个功能还没做好/) resolved to 2 elements`：<br>① 我写的**空态提示文案里抄了引擎那句原文**；② toast 出现后，同一句话在页面上有了**两个**元素。<br>⇒ 负载高时 toast 先挂上 ⇒ 匹配到 2 个 ⇒ **报错**；负载低时 toast 还没挂上 ⇒ 只匹配到那段提示 ⇒ **断言假绿**。<br>**所以这条断言从来没有真正验过 toast**，而它"偶发变红"其实是唯一一次说了实话。 |
| **修复** | ① `pages/TasksPage.jsx`：空态文案**不再抄引擎原文**，也不再列"哪几个方法没实现"（那是会漂移的清单；界面靠"点一下看引擎怎么答"）；<br>② `e2e/tasks.spec.mjs`：靶子改成唯一的 **`#toast`**（`ui/Toast.jsx` 的 id，始终在 DOM 里）并用 `toContainText`（不依赖 `show` 类对应的 CSS）；<br>③ 加一条**回归断言**：空态提示**不许**包含那句原文。 |
| **验证** | **双向**：把旧文案注回去 ⇒ E10-f **红**在回归断言上（`Expected substring: not "这个功能还没做好"`）；还原 ⇒ 通过。<br>**重复性**：全套**连跑两次 = 56 passed / 56 passed**（此前 2/3 会挂）。 |
| **状态** | ☑ 已修 |

#### B-5-2 · 通用教训（写给下一个人，也写给未来的我）

| # | 教训 | 判据 |
|---|---|---|
| a | **断言的靶子必须唯一** | 用 `getByText(一段话)` 之前先问："这句话在页面上只可能出现在一处吗？" —— 否则不是 strict 报错、就是**匹配到别的东西而假绿**。优先用 `data-testid` / 稳定的 id / role。 |
| b | **"界面文案"与"引擎文案"不许重复** | 界面里**硬编码**引擎会说的一句话，既造出第二个事实来源（P1，会漂移），又会让基于那句话的断言歧义。**让用户点一下看引擎怎么答**就够了。 |
| c | **"偶发失败"先当 bug 查，别当噪音** | 这条故障被"单独跑能过"掩盖了三轮。**拿到完整的错误块**（而不是 grep 一行）才看见真因 —— `strict mode violation` 那几个字一直在输出里。 |
| d | **不许用 `retries` 把它盖住** | 重试会让 flake 静默消失，与本仓库"断言必须能红"的口径直接冲突。 |

#### B-5-3 · 环境限制与门禁实测留档（2026-10-14）

**① `npm test` 的那 1 条跳过 = 环境限制，不是通过。** 本环境无法创建**文件**符号链接（`EPERM`：目录联接能建，文件符号链接不能）。该条断言的是「库内指向库外的符号链接必须被拒」，在能建链接的机器上会真跑（`packages/engine/tests/security.test.mjs` ④）。

> 历史（2026-10-12，D2 修复的连带效果）：原先还有**两条永久跳过**，因为测试自己直读已删除的 `config.json` 拿库根；改为**与生产同序**的解析（环境变量 → `config.json` → **索引自举**）后，两条**都真的跑起来了** ⇒ 跳过数 **3 → 1**，通过数 **65 → 79**。**这不是"把测试改绿"**：库根来自索引元数据（生产实际来源），断言内容一个字没放松。

**② 受限沙箱里的 `npm run build` 会失败，且失败点在加载配置之前**：

```text
failed to load config from electron.vite.config.mjs
error during build: Error: spawn EPERM
    at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)
    at bundleConfigFile (node_modules/electron-vite/dist/chunks/lib.js:1710:26)
```

根因：esbuild 用 **piped stdio spawn 一个常驻服务进程**，受限沙箱不允许 ⇒ **这是环境限制，不是配置或代码问题**（连配置文件都还没加载到）。✅ **2026-10-12 已在提权下实际跑通**（EXIT=0，`out/{main,preload,renderer}` 三端齐备）。

**③ 本轮门禁实测原始输出（2026-10-14）** —— `AGENTS.md` 只留**期望值**，证据与分解留在这里：

- `npm test`：`tests 313 · pass 312 · fail 0 · skipped 1`（EXIT=0，`duration_ms` ≈ 15.8 s）。
  逐文件分解：引擎 **148** = engine 33 + fake 22 + index 18 + security 16 + uid 7 + transactions 24 + transactions-recovery 14 + transactions-fault-injection 10 + transactions-write-path 4；
  桌面 **165** = 原 152 + **contrast 4** + **copy 5** + **style-contract 4**。
- `npm run typecheck`：EXIT=0（⚠️ **只覆盖 `.ts`**，当前唯一有内容的来源是 `shared/ipc.ts` —— 见 B-1 的 T1 记录）。
- `npm run e2e`：**本轮未复跑**（需能出窗的环境 + 提权）⇒ 静态计数 **62 条**（12 个 spec 文件，含 `uiux-p0.spec.mjs` E12 的 6 条）；最后一次实测仍是 2026-10-13 的 **`56 passed`**。



---

### B-6 UI/UX 治理（Apple Style 审查，2026-10-13）—— **第一段已做，标注处未完成**

> 审查产物：仓库根 [`违规的UI.md`](违规的UI.md)（**违规唯一详表**，44 条 = 原审查 42 + 补登 V-43/V-44）·
> [`docs/audit/UIUX-APPLE-STYLE-AUDIT.md`](docs/audit/UIUX-APPLE-STYLE-AUDIT.md)（论证与优先级）·
> [`docs/design/UI-KIT.md`](docs/design/UI-KIT.md)（Apple HIG 基线对差）。
> ⚠️ 这三份 + `docs/design/ui-kit/`（生成器与数据）**目前仍未提交** —— 见下表"未完成"第 2 条。

**已修（本轮实测，带断言）**

| 编号 | 内容 | 落点 |
|---|---|---|
| **V-28**（Critical） | 详情页原先**界面不可达** ⇒ 结果卡标题变真链接；新增 `itemPath()` 作为路由形状的唯一来源 | `search/PhotoCard.jsx` · `router/paths.js` |
| **V-01** | 侧栏当前页类名恒 `undefined` ⇒ 修为互斥形态；并补 `.nav a[aria-current="page"]` **兜底**（防御纵深） | `layout/Sidebar.jsx` · `renderer.css` |
| **V-02** | `.dot-*` 被当"文字语气类"用在 **6 处文字 span** ⇒ 新增 `.tone-*`（着色在 `color`）；真圆点（`SearchSidebar.jsx` 的 `dot dot-ok`）**保留** | `renderer.css` + 6 处调用点 |
| **V-03** | 分数档位色当正文只有 2.22/2.06 ⇒ 新增 `--color-success-text`/`--color-warning-text`，`--score-same/like` 改指它们 | `packages/design-tokens/tokens.css` |
| **V-15** | 错误文案无独立规则（只有 `.toast.err` 复合选择器）⇒ 补独立 `.err` | `renderer.css` |
| **V-16** | 错误 toast 恒 `role="status"` + 2.6s 自动消失 ⇒ 改 `alert`/`assertive`，且**不自动消失** | `ui/Toast.jsx` · `hooks/useToast.js` |
| V-17 | `text-err` 不是合法 Tailwind 类（静默失效）⇒ 改 `text-critical-text` | `pages/ActivityPage.jsx` |
| V-05/V-06/V-07 | 4 个分类标签前景 3.96–4.29 · 深色 CR+VR **3.47** · 浅色误用深色档橙 ⇒ 按同色系压暗阶梯重取值（≥4.5） | `tokens.css` 两套块 |
| V-40（High） | 用户可见文案里 **9 处** `**加粗**` 会按字面显示 ⇒ 去掉星号 | ActivityPage · TasksPage · `utils/item-actions.js` |
| V-42 | toast 显示 **undefined** ⇒ 真机制是 `setMessage(String(msg))`（`String(undefined)==='undefined'`）⇒ 新增 `normalizeMessage` | `hooks/useToast.js` |
| **V-43**（**本轮新发现**） | 错误 toast 白字压 `--color-critical` 只有 **3.55:1** ⇒ 新增 `--toast-err-bg`（白字 5.26） | `tokens.css` · `renderer.css` |
| **V-44**（**本轮新发现**） | 状态圆点是 **8px 非文字图形**，用 `--color-success` 只有 **2.22:1**（SC 1.4.11 要 3:1）⇒ 改用可读变体 | `renderer.css` `.dot-*` |

**新建的四类防线（按根因，不逐条打补丁）**

| 类 | 文件 | 双向验证 |
|---|---|---|
| **A** 类名/属性 ↔ 样式层契约 | `apps/desktop/tests/style-contract.test.mjs`（SC-0…SC-3） | ✅ 拆 `.err` 规则 ⇒ SC-2 红；`text-critical-text`→`text-err` ⇒ SC-1 红 |
| **B** 侧栏当前页（真窗口） | `apps/desktop/e2e/uiux-p0.spec.mjs`（E12-a…f） | ✅ 改回旧表达式 ⇒ E12-c/e 红；**两条路都拆** ⇒ E12-d 也红（证明非空断言） |
| **C** WCAG AA 对比度（由令牌计算） | `apps/desktop/tests/contrast.test.mjs`（CT-0…CT-3） | ✅ 注入旧前景 + 制造深色块键漂移 ⇒ CT-1/CT-2/CT-3 红 |
| **D** 用户可见文案 | `apps/desktop/tests/copy.test.mjs`（CP-0…CP-4） | ✅ 退回 `String(msg)` ⇒ CP-0 红；注入 `**跑过**` ⇒ CP-2 红 |

**门禁（本轮末实测）**：`npm test` **313 · 312 · 0 · 1** · `npm run e2e` **62 passed**（连跑 2 次。

**未完成 / 待办**

| # | 项 | 说明 |
|---|---|---|
| ~~B-6-1~~ | ~~**独立 Agent 复核（宪章 §0 硬要求）**~~ **✅ 已取消（2026-10-14 所有者指令）** | 该要求已从 `AGENTS.md` §0 **移除** ⇒ 本项**不再适用**（原记录：本轮发起后被取消、未做）。历史文档仍会提到它 —— 见 `AGENTS.md` §0 的说明 |
| B-6-2 | ✅ **审查产物与改动已入库** | 4 个审查产物（`违规的UI.md` · `docs/audit/UIUX-APPLE-STYLE-AUDIT.md` · `docs/design/UI-KIT.md` · `docs/design/ui-kit/{build.mjs,kit-data.json}`）与全部改动**已随本次提交入库并推送**（见 `git log`）。⚠️ `docs/design/ui-kit/index.html`（1.2 MB 派生物）**按设计不入库** —— `.gitignore` 有理由，且已实测可由 `node docs/design/ui-kit/build.mjs` 逐字节重建 |
| B-6-3 | ✅ **V-04 已核对（2026-10-14）—— 结论：未修** | `data-tone` **确实输出**（全仓唯一一处：`pages/ItemPage.jsx:55`，与 `data-state` 写同一行 `<span className="tag" …>` 上）；但 **CSS 里没有任何 `[data-tone]` / `[data-state]` 选择器** —— `renderer.css` 只有 `.tone-*` 前景色（:141-143）与 `.tag.VR/.CR/.CRVR` 分类色（:277-279）。⇒ 索引状态四档**仍只靠文字区分**，V-04 的原始问题（四档徽标颜色相同）**未被修复**。修法：给 `[data-state]` 补四档规则（或复用 `.tone-*`）并加断言 | ☐ 未修（本轮只做核对，**别当成已修**） |
| B-6-4 | **审计 P1/P2 的其余条目** | V-09 · V-10 · V-11 · V-12 · V-13 · V-14 · V-18–V-27 · V-29–V-39 · **V-41** —— 逐条见仓库根台账与报告 §13 |
| B-6-5 | **V-41 刻意不做成断言** | 审计把它归 P2 且写明"多为**登记决定**"；做成断言只会逼出"关掉"或"堆白名单"（本仓库反复栽过）。这是**决定**，不是漏了 |
| B-6-6 | **审计 §14 的未覆盖项** | 打包态与冷启动 · 真实检索质量与缩略图内容 · **读屏实机**（结论基于 `aria-*` 存在性，**不是**读屏实测）· 系统级偏好真窗口 · 高 DPI —— **均未验证，不得声称已验** |

**本轮留下的三条教训（改相邻代码时看这里）**

1. **注入/改写工具必须先剥注释**：本仓库注释里大量引用代码片段（`setMessage(String(msg))`、旧 `cn(...)`），
   裸字符串替换会**命中注释而不是代码** ⇒ 会得出**完全相反**的结论。已有现成的 `helpers/source-scan.mjs` 的 `maskComments`。
   **两次踩过**：一次是把注入打到注释上、一次是断言被"注释里的旧代码"误判成违规。
2. **构建不能用管道吞退出码**：`npm run build 2>&1 | Out-Null` 会把失败吞掉，而 e2e 跑的是**旧产物** ⇒ 出现"测试全绿但代码是坏的"。
   判断成败要看**产物**（`out/renderer/assets/*` 的时间戳与内容），不是退出码。
3. **断言不能只匹配函数名**：`/normalizeMessage\(msg\)/` 会被**函数定义**满足 ⇒ 把调用点改回 `String(msg)` 也照样绿。
   必须断言**确切的调用表达式**。这条是**双向验证当场抓出来的**。

### B-7 文档↔代码一致性缺口（**2026-10-14 完整性核对 · 已全部修复**）

> 起因：一次「项目完整度」核对 —— **门禁 4/4 全绿，问题全在文档与交付层**。每条都带证据与复现方式；
> 已修的写清改成了什么，避免下一个人照旧文档再走一遍。

| # | 缺口（改前） | 证据 | 处置 |
|---|---|---|---|
| **B-7-1** | **工作树未提交**：40 个已改文件 + `docs/PROJECT-INFO.md` 未跟踪，而 `AGENTS.md` 已把后者当作「事实/现状」来源 ⇒ 克隆者拿到断链指针 | `git status --porcelain`（40 M + 1 ??） | ✅ 已提交 **`082e0d6`**（41 文件，+763/−450），工作树干净 |
| **B-7-2** | `README.md` 状态节过期：写「测试 90 项 · 89 过」·「P3 只完成 1/4 页」·「`npm test` 164 条 / e2e 13 条」·「没有 typecheck 门禁」 | 本轮实测 313/312/0/1 · e2e **62 passed** · `typecheck` EXIT=0 | ✅ 全部改为实测值；新增「技术栈迁移 T1–T5 ✅」一行；P4 的未实现清单补齐为 **6 个**方法 |
| **B-7-3** | `docs/plan/ROADMAP.md` 停在 2026-10-12：页头「P3 ⚠️ 只完成 1/4 页」· §0「测试 113 条」· §0 形态行「全仓 0 个 `.ts/.tsx`…没有 typecheck 门禁」· 任务表 P3b/P3c/P3d「❌ 未开始」 | 代码事实（4 路由 / 6 页面 / 1 个 `.ts` / `typecheck` 在 `package.json`） | ✅ 页头与任务表按现状改；「下一步」改为 **P4 → P5 → P6** |
| **B-7-4** | **错误码数少算 1**（4 处写 19，实为 **20** —— `PORT_MISSING` 于 2026-10-12 新增） | `errors.mjs:7-30` 共 20 个键 | ✅ `errors.mjs` · `ipc.ts:8` · `docs/README.md:32` · `PROJECT-INFO.md:279` 全部改为 20 |
| **B-7-5** | `docs/README.md` 另两处过期：§1 写 `SPEC-transactions`「实现未开始」（地基已实现 + 4 个测试文件）· 写契约「10 方法」（实为引擎 13 / IPC 登记 16） | `packages/engine/src/transactions/` · `shared/ipc.ts` | ✅ 已改 |
| **B-7-6** | **契约 §2.0 有一行是错的**：`CONTRACT-engine-v1.md:105` 把 `thumbPath` 列为「✅ 已实现」，而全仓代码**搜不到它** | 全仓 grep：仅本文档与 `docs/archive/`；实际走 `thumb://` 协议（`main/index.mjs` 的 `protocol.handle('thumb')` + `PhotoCard.jsx:34`） | ✅ §2.0 移出「已实现」行 · §2.3 加「已被协议取代」标注 · §4 表同步 |
| **B-7-7** | **V-43 / V-44 已修但没进台账**（台账自称「唯一详表」，原审查 42 条） | `TODO.md` B-6 表 + `tokens.css:57` · `renderer.css:309` · `contrast.test.mjs:113-120` | ✅ 台账补 **V-43 / V-44**（含判据 / 复现 / 验收）；统计 **42 → 44 条**（Medium 22 → 24）；原审计报告**保持 42 条冻结快照**并在 `PROJECT-INFO.md` 注明 |
| **B-7-8** | **文档引用解不开**：76 份 `.md` / 204 条内部链接里，**56 条**按文件相对解算失败（其中 **8 条**两种口径都死，全在 `docs/audit/`）—— 根因是「根相对」写法不带前导 `/` 在 GitHub 上点不开 | 死链自检（口径见下） | ✅ 56 条全部改为可解算形式（带前导 `/` 的仓库根相对）；`AGENTS.md` §6.1 写明形式与**自检口径**。**修后实测死链 0** |
| **B-7-9** | 就地 README 过期：`apps/desktop/src/README.md` 的 §6 欠账表（typecheck「刻意没有」· 技术栈「均未接入」· **D2 未修** · **F-01 未修**）与 `renderer/README.md` 的组件树（仍指已删除的 `hooks/useSearch.js` 与 `ui/cx`，App.jsx 写「当前只有检索一页」） | `package.json` · `store/search.js` · `router/paths.js` | ✅ **已修（2026-10-14 补）**：`src/README.md` 更正 §1 目录树 + §6 四条（typecheck / 技术栈 / **D2 已修** / **F-01 已修**）+ §7 重构后实跑（e2e **62 passed**）；`renderer/README.md` 组件树按现状重写（adapter · store · router · utils · styles · 6 个页面） |
| **B-7-10** | `PROJECT-INFO.md` 自己的两处小错：索引构建写「11 个 `.mjs`」（实 12）· 头部写「工作树 `ac97978`，`git status` 干净」 | 静态计数 · `git status` | ✅ 已改（12 个；头部改为 `082e0d6`） |

**死链自检口径**（只读、无依赖；已写进 `AGENTS.md` §6.1）：遍历所有 `.md`，对每条 `](…)` 先按**文件相对**解算、失败再按**仓库根**（前导 `/`）解算，两处都不存在即死链。

**本轮门禁复跑（修复后，2026-10-14）**：`npm test` **313 · 312 · 0 · 1**（EXIT=0）· `npm run typecheck` EXIT=0 ·
`npm run build` EXIT=0（三端齐备，**需提权**）· `npm run e2e` **62 passed**（EXIT=0，**需提权**）。

---

## C. 已修但**别改回去**（防回归清单）

> 这些不是 TODO，是**改相邻代码时的地雷**。完整边界说明见 `AGENTS.md` §7.2。

| # | 已修的缺陷 | 改什么会踩到 | 谁在锁 |
|---|---|---|---|
| C-1 | **F-01 · `reveal` 静默假成功** —— 引擎在无 `shell` 端口时**曾返回 `ok({revealed:true})`**。修复后：端口缺失/形状不对一律返回 **`PORT_MISSING`**（绝不 `ok`），且顺序是**先确认文件在盘上、再调端口**。<br>⚠️ **能力边界**：`shell.showItemInFolder` **返回 void、不报告失败** ⇒ 成功文案只能写「已请求在资源管理器中定位（系统未回报结果）」，**不许写「已定位」** | 动 `packages/engine/src/engine.mjs` 的 `reveal` 分支，或 `main/index.mjs` 的 `shell:` 注入 | 引擎 +5 条单测 · 端口本体 +4 条 · `search-store.test.mjs` **Z10**（文案断言）；⚠️ **行为层**锁定已随 `verify_main_wiring` 移除（见 B-4） |
| C-2 | **F-02 · 界面自算分数阈值** —— `ui/Score.jsx` 曾硬编码 `0.97/0.93`，导致**每次检索全被标成"较弱"** | 动 `ui/Score.jsx` 的 `band` 来源 | 原样式守卫**已移除** ⇒ 现在**只剩渲染层单测**，改的时候特别小心 |
| C-3 | **D2 · 库根配置** —— 曾只从 `config.json` 读，于是"有索引但没配置文件"的机器开箱即得 `LIB_NOT_FOUND`。现在按**四条优先级**解析：① `GEMMA_LIB_ROOT` ② `userData/library-registry.json` ③ `config.json`（兼容回退，**不要求用户去配**）④ **从已有索引 `data/libraries/*/meta.json` 自举**（`meta` 里本就存着 `lib_id` + `lib_root`）⇒ **有索引即零配置可用**；无库时界面走**首启向导**而不是裸报错 | 动 `main/library-config.mjs` 的解析链 | `apps/desktop/tests/library-config.test.mjs`（**14** 条：原 12 + T5-D 新增 2） |
| C-4 | **F-04 · 取件白名单为空** —— `collect.dirs` 曾恒为 `{}` | 见 A-3（改硬编码时**别让它变空**） | 同上 12 条 |
| C-5 | **R-3 · `band` 原型键** —— `bandOf` 曾用 `BANDS[mode]`，`mode='toString'` 会命中原型 | 动 `engine.mjs` 的 `bandOf` | 引擎单测（`Object.hasOwn`） |
| C-6 | **`thumb://` 状态码映射** —— 曾把"形状错"也返回 404，§3 要求 **400** | 动 `thumb-url.mjs` 的 `thumbFailureStatus` | `apps/desktop/tests/permissions.test.mjs`「S6」 |
| C-7 ⭐⭐ | **共享扫描器"模板插值之后整段失明"**（2026-10-13 修）—— `source-scan.mjs` 处理完模板串的 `${...}` 后 `continue` 回**主循环**、没回模板串，于是收尾反引号被当成新模板的起始，一路吞到文件尾。<br>**后果双向**：① **假阴**（危险方向）—— `SearchPage.jsx:55+` / `TasksPage.jsx:76+` 等区域被整段抹成空格，基于它的 **L1–L7 / T1–T6 断言在那些地方恒为真**（剧场）；② **假阳** —— 注释里的反引号内容会漏出来再匹配一次（L6 曾被自己的注释绊倒）。 | 动 `apps/desktop/tests/helpers/source-scan.mjs` 的 `scanCore`（**任何**注释/字符串/模板/正则的扫描逻辑） | `source-scan.test.mjs` 的 **S13/S14/S16**（三条一起，双向验证过：注回旧缺陷 ⇒ 三条同时红） |
| C-8 ⭐ | **"哪些方法没实现"曾有两份清单** —— 主进程手写 `missing` 数组、引擎里逐段手抄 6 个方法（P1+P2） | 加/改未实现的契约方法时 | `packages/engine/src/engine.mjs` 的 **`UNIMPLEMENTED_METHODS`**（唯一来源，主进程 import）· `fake.test.mjs` **F17**（断言假套件里每个都接上了） |
| C-9 ⭐ | **`mutate` 的 `uid` 曾对 `undo` 也必填** —— 而契约 §2.7 写明 undo 由 `params.txId` 定位 ⇒ 操作记录页的「回退」被 `BAD_REQUEST` 拦掉、状态不变（E11-d 抓到） | 动 `shared/ipc.ts` 的 `mutate` schema | `permissions.test.mjs` **S15**（**双向都断言**：undo 不该要 uid、其余 op 必须带。两个方向各注入一次都验过会红） |
| C-10 ⭐ | **L6 的判据曾太松** —— 旧正则"同一行里有 `\|\|` 就算"，把 `show(r.ok ? \`…${OP_TEXT[tx.op] \|\| tx.op}\` : r.error.userMessage)` 误判成文案兜底。假阳性的代价是逼人不敢写注释、不敢同行用 `\|\|`，最后检查会被关掉 | 动 `layering.test.mjs` 的 `USERMSG_FALLBACK` | `layering.test.mjs` **L6b**（真兜底抓到 / 同行无关的 `\|\|` 放过 / 注释里的不算） |
| C-11 ⭐ | **两个"剧场断言"（自证伪）** —— ① `T2`（`done` 单调不减）原先断的是**最终值**，而"最后一条事件胜出"本来就会给出那个值 ⇒ **拆掉守卫照样通过**；② 我第一版给 `mockComments` 写的 S13/S14 用的是 `colors()`（保留字符串内容）⇒ 失步在它眼里**看不见**。**两次都是"注入缺陷 → 没变红"才发现的。** | 写任何新断言时 | 已修正：`T2` 改断**中间态**；`S13/S14` 改断在 `maskNonCode` 上。**教训：新断言必须做一次"拆掉防线"的验证** |
| C-12 ⭐ | **扫描/改写源码时的两条坑**（原记在旧 `AGENTS.md` 的「已知边界」表，2026-10-14 迁到这里）<br>① **必须先剥注释** —— 源码/产物里**保留行注释**，直接匹配会命中被注释掉的接线，而"注释掉一行"正是禁用接线的常见手法；剥注释器还必须**认识正则字面量**（含引号的正则如 `/["']/g` 会让朴素实现误入字符串模式 ⇒ 被注释的接线重新可匹配，差分实测证实）。<br>② **必须取"调用点的实参"** —— 引擎函数签名里写着形参 `shell = null`，若按"第一个 `createEngine(`"取，会取到**函数声明**，"接线有没有接上"就永远为真。<br>⚠️ **不能用 `esbuild.transform` 代替剥注释器** —— 它在受限沙箱 `spawn EPERM`（见 B-5-3），会让守卫整体失效 | 写任何"扫源码找接线 / 找违例"的断言或工具时 | `apps/desktop/tests/helpers/source-scan.mjs` · `source-scan.test.mjs` **S1–S16b** |

---

## D. 怎么用这份文件

1. **开工前**：从 A / B 里挑，确认它的验收标准（很多在 `docs/plan/ROADMAP.md` §10）。
2. **改完**：勾掉该行（`☐` → `☑`）并把**实测数字**更新（例如 A-1 的"7 处"若变成 0 就写 0）。
   ⚠️ **不要只把框打勾而数字还是旧的** —— 那正是本项目反复栽的坑（"断言看起来对，其实没测"）。
3. **新发现的问题**：按 A（有实测证据的坏） / B（没做完）分类加进来，**带上 `文件:行号` 或复现命令**。
4. **不在这里写架构与规范** —— 那些进 `AGENTS.md`；也不重复 ROADMAP 的验收表，只放指针。

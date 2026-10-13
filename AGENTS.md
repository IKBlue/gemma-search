# AGENTS.md · 在这个仓库里怎么干活

> **本文件只记两样东西：① 项目架构 · ② 执行规范。** 它**不记**待办与缺陷。
> - 项目是什么、现在什么状态、怎么跑 → [`README.md`](README.md)
> - **还有什么没做完 / 什么坏了** → [`TODO.md`](TODO.md)
> - 什么顺序、什么算做完 → [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md)
>
> **别在本文件里加 TODO 或 BUG** —— 那是 `TODO.md` 的职责（单一事实来源）。
> 本文合并了原 `AGENTS.md`（任务宪章）与 `PROJECT-GUIDE.md`（结构总览），两者已不再单独存在。
>
> 最后核对：2026-10-13 · 对应布局：monorepo（`apps/` + `packages/`，见 [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) §1，该结构已冻结）

---

## 0. 治理宪章（所有者指令，优先级最高）

1. **技术栈 / 框架 / 目录检查**：对标行业最佳实践，检索现有插件与方案；执行过程拆成**可验证的 subtasks**，先写清验收标准，再让**独立 Agent 复核**。
2. **UI/UX 检查（Apple Style）**：同样对标行业最佳实践（指名规范与章节，不写「主流做法」），拆成可验证 subtasks + 验收标准 + 独立复核。
3. **最终 review 与文档整理**：覆盖项目需求、设计、实现、测试、部署五类文档。

**由第 1、2 条派生的常驻纪律**（对本仓库所有后续工作生效）：

- 结论必须可追溯：每条带 `文件:行号` 或「命令 + 原始输出」；无证据的写【判断，非实测】。
- 必须区分三种东西：**① 代码事实 · ② 文档声称 · ③ 行业做法**。混在一起写就是耍流氓。
- 复核者不得只读结论，必须自己跑命令、自己回原文件核对。

### 0.1 所有者追加约束（2026-10-13，优先级同 §0）

#### 严格禁止事项

| # | 禁止 | 判据（**怎么算违反**，别靠感觉） |
|---|---|---|
| **P1** | **创建同一概念的多个实现** | 同一件事在仓库里有**两份代码 / 两份定义**。原则：**单一事实来源**（同 §4）——发现两处不一致，**改错的那处**，不要两处各改一半 |
| **P2** | **复制粘贴代码块** | 同一段逻辑（**哪怕有细微差异**）出现在 ≥2 处 → **提取到共享函数/模块**再复用 |
| **P3** | **硬编码应可配置的值** | 绝对路径、目录、端口、数量上限、超时、默认库位置等**写死在代码里** → **从配置文件或环境变量取**（与 §7「不把本机绝对路径写进代码」同源） |

#### 强制要求

| # | 要求 | 怎么做（**可执行**的做法） |
|---|---|---|
| **R1** | **债务预防** | **建新功能前先查有没有现成的**：grep 全仓 + 读 §4 权威表。确认没有再新建，**并在回报里写明"查过了，没有"**（不是默默新建） |
| **R2** | **新建文件必须修正目录结构** | 新文件落在 §3 规定的位置。**若磁盘结构与本文档不一致 → 改文档或改结构，两者必须一致**，不允许留下"文档说 A、磁盘是 B" |

#### 三层架构（MVC 分层，新增代码必须遵守）

```
UI(组件) ──> Operation(store/composable/utils) ──> Adapter(唯一 invoke 入口) ──> repo/service
```

| 层 | 职责 | 放在哪 | 禁止 |
|---|---|---|---|
| **UI**（组件 / View） | 只做渲染与用户交互 | `renderer/src/{pages,layout,ui,search}/**` | ❌ **不得直接碰 `window.api`**；不得写业务规则 |
| **Operation**（store / composable / utils） | 状态与编排；把 Adapter 的结果转成界面要的形状 | `renderer/src/store/**`（**新**）· `renderer/src/hooks/**` · `renderer/src/utils/**` | ❌ 不得散落协议细节（协议归 Adapter） |
| **Adapter**（**唯一 invoke 入口**） | **全应用只有一个地方碰 `window.api`**；统一解包错误信封、统一类型 | `renderer/src/adapter/**`（**新**） | ❌ 不得有第二个文件直调 `window.api` |
| **repo / service** | 数据来源 | `apps/desktop/src/main/**` · `packages/engine/**` | — |

**现状（2026-10-13，T5 已落地）**：
- ✅ **Adapter 是唯一入口** —— 全渲染层只有 `adapter/api.js` 碰 `window.api`（改前 3 文件 6 处）
- ✅ **UI 层零 `window.api`** —— `FirstRunWizard` 的库操作上移到 Operation 层，向导回归纯 UI
- ✅ **无重复兜底** —— 整个渲染层只剩 1 个 `try/catch`（在 Adapter 里）；改前同类逻辑散在 6 个文件
- ✅ **取件目录可配置** —— `GEMMA_COLLECT_DIRS` > 注册表 > config > 规格兜底（P3；规格兜底仍是绝对路径，见 `TODO.md` A-3）
- ✅ **class 合并只有一份实现**（2026-10-13 T4）：`ui/cn.js` = `twMerge(clsx(...))`；旧 `ui/cx.js` **已删除**（P1/A-4 收口）。断言见 `deps.test.mjs` 的 D-D

**机械检查已经上牙**：`apps/desktop/tests/layering.test.mjs`（L1–L7）+ `source-scan.test.mjs`（扫描器自检）。
**已双向验证**：往 UI 层注入一行 `window.api.invoke` ⇒ `npm test` 变红。逐条与实测数字见 [`TODO.md`](TODO.md) A 节。

⚠️ **规范（现在就要守，且已有断言拦住）**：不要在任何非 `adapter/` 文件里加 `window.api` 直调；
碰引擎的新代码**一律经 `hooks/` 或未来的 `adapter/`**。

### 0.2 技术栈：现状与目标（2026-10-13 所有者指令）

**目标栈**：Electron · React · **TypeScript** · **shadcn/ui** · **Tailwind CSS** · **Zustand** · **React Router**。
⇒ 面向该目标的技术迁移**是一个计划，不是规范** —— 逐项实测现状、串行任务（T1→T5→T2→T3→T4）与
"依赖清账"全部在 **[`TODO.md`](TODO.md) B-1**；逐条验收标准在 [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) §10。

⚠️ **两条必须记住的规范**：
- **在 Tailwind 真正落地之前**，§3 的"手写 CSS + `var(--*)`"仍是现行规则 —— 别提前混写两套。
- ✅ **T1 已完成（2026-10-13）**：`npm run typecheck` 已加回，且**能为真**
  （往 `apps/desktop/src/shared/ipc.ts` 注入一个类型错误 ⇒ `error TS2322` + EXIT=1；还原 ⇒ EXIT=0，双向实测）。
- ⚠️ **但它只覆盖 `.ts` 文件**（当前只有 `ipc.ts` 一个）：两个 tsconfig 的 `checkJs` **仍然是 `false`**，
  `.js`/`.jsx`/`.mjs` 一律不参与检查。**不得声称"全局类型检查通过"** —— 实测打开 `checkJs` 后是
  渲染层 148 错 / 主进程侧 472 错（`docs/plan/ROADMAP.md` §10.1.1），那是 T3–T4 要还的债。
- ✅ **T2 已完成（2026-10-13）**：**React Router 接管多页**（hash 路由 —— 打包态是 `file://`；
  4 条路由 `/` · `/item/:libId/:uid` · `/tasks` · `/activity`）· **Zustand 接管检索状态**（`store/search.js`；
  `hooks/useSearch.js` **已删除**，不留两份实现）。
  ⚠️ **能自动验证到哪一步**：路由表用 react-router 自己的 `matchRoutes()` 真解算（`router.test.mjs` 5 条）·
  门禁判定抽成纯函数后进 `npm test`（`gate.test.mjs` 6 条）· store 状态切换与 IPC 参数拼装（`search-store.test.mjs` 12 条）。
  ✅ **原先"验证不到"的那部分已由 E2E 兑现（2026-10-13，同日）**：真实渲染 / 点击导航 / hash 变化
  —— `npm run e2e` 的 **E2 系列**真的启动应用、真的点侧栏、真的读 hash（`routing.spec.mjs` 5 条）。
- ✅ **T3 已完成（2026-10-13）**：**Tailwind v4 接管样式生成层**（`@tailwindcss/vite` 接进构建）。
  入口 `renderer/src/styles/tailwind.css`，用 **`@theme inline`** 把 `tokens.css` 的令牌映射成工具类
  ⇒ **色值仍然只有一处定义**（生成的类长这样：`.bg-surface-raised{background-color:var(--color-bg-elevated)}`）。
  ⚠️ **三件必须知道的事**：
  ① **故意不引 preflight** —— `renderer.css` 已有自己的基础层，两套 reset 叠加会打坏现有外观；
  ② **间距数值档与令牌恒等** —— `--spacing: var(--space-1)` ⇒ `px-3` = `calc(var(--space-1)*3)`，
     **不是巧合的 12px**（实测产物确认）；
  ③ **迁移只做了约 9.5%** —— 126 条规则里迁出 **12** 条（`Button` 整族 · `Chip` · 含那个上下文覆盖
     `.card-acts .btn.pri`），**其余 114 条仍在 `renderer.css`**。别读成"迁完了"。
  ✅ **迁移保真度有真窗口验证**：`npm run e2e` 的 **E4 系列**（5 条）用 `getComputedStyle` 断言
     迁移后每个视觉值**仍等于该令牌的计算值** —— 判据是令牌本身，不是写死的期望值。
- ✅ **T4 已完成（2026-10-13）**：**shadcn 风格按需接入 + 依赖清账**。
  · **依赖**：生产 **25 → 12**，其中"已装零 import"**19 → 0**（`deps.test.mjs` **D-A** 是可复跑的测量与回归锁）。
  · **补的真缺口**：`ui/ConfirmDialog.jsx`（Radix `AlertDialog`）—— 取件是**写文件**的破坏性操作，
    原先点一下就直接执行、**没有任何确认**；现在走"请求 → 确认"，且**取消 ⇒ 一个 IPC 都没发**（store 断言 Z13–Z17）。
  · **无障碍**：`Chip` 补 `aria-pressed`（真窗口验过会翻转）· 侧栏 `aria-current="page"` 由 `NavLink` 提供并被 E2E 钉住。
  · **class 合并收口**：`ui/cx.js` **已删除**，只剩 `ui/cn.js`（`twMerge(clsx(...))` + `extendTailwindMerge`）。
  ⚠️ **T4 最值得记的教训（两个"测试自己抓出来的真 BUG"）**：
  ① **差一点删错依赖** —— 第一版只匹配静态 `from`/`require`，把 `sharp`/`bmp-js` 判成"零 import"，
     而它们是**动态**加载的（`bmp_decode.mjs:139` / `:55` 的 `await import(...)`）。删掉＝编码路径静默坏。
     现在 `deps.test.mjs` 的 **D-C** 专门钉"断言能看见动态 import"。
  ② **`tailwind-merge` 会把我们的自定义字号当颜色吃掉** —— 见 §3 的 `cn.js` 那条。
  ✅ **「ESC / 焦点落位」已实测（2026-10-13，E2E E7 系列 6 条）**：ESC 关闭且**零 IPC** · 焦点陷阱
  （连按 6 次 Tab 不逃逸）· 焦点归还给触发按钮 · 取消不执行 · 确认恰好一次 · 连点只发一次。
  **解锁方法**：在主进程 `ipcMain.handle('engine:invoke')` 打桩（`main/index.mjs:207`）—— 只换引擎，
  渲染侧全真 ⇒ **结果区 UI 从此不依赖模型也能自动化**。零副作用：打桩只发生在测试进程里。
  ⚠️ **两处别搞错**：① 焦点**落在「取消」**不是「确认」—— 破坏性操作的**安全默认**，别去"修"它；
  ② 焦点归还**必须自己写**（受控 `open` 没有 `Trigger`），且采样要用 `onOpenAutoFocus`、
  不能用 `useEffect([open])`（React effect **子先父后**，那时焦点已被 Radix 移走了）。

---

## 1. 这个仓库是什么

本地素材库的**离线语义检索**桌面应用：用中文描述找图、以图搜图，命中后给出同名模型压缩包的绝对路径。全离线、绝不写素材库。
技术栈、当前进度、命令与已知边界 → **[`README.md`](README.md)**（本文不重复）。

---

## 2. 目录职责表（每个顶层目录「管什么 · 能不能改 · 进不进 git」）

**「进不进 git」很关键**：不进的目录删了不会影响别人克隆——它们本该由命令生成。

| 路径 | 管什么 | 能改吗 | 进 git？ |
|---|---|---|---|
| `apps/desktop/` | Electron 应用：`src/main`（窗口/IPC/`thumb://`/日志）· `src/preload`（安全桥，产物必须 CJS）· `src/renderer`（React 19 界面；内部含 `adapter/` `store/` `hooks/` `utils/` `router/` `pages/` `layout/` `ui/` `search/` `styles/`）· `e2e/`（Playwright，真启动 Electron）· `src/shared/ipc.ts`（**IPC 契约唯一来源**） | ✅ 主战场 | ✅ |
| `packages/engine/` | 搜索引擎本体：`src/*.mjs`（**零第三方依赖**、传输无关）+ `tests/*.test.mjs` | ✅ 改完必须过 `npm test` | ✅ |
| `packages/indexer/` | 索引构建（ONNX + WebGPU）与重采样兼容层、BMP 解码；唯一能建索引的地方 | ⚠️ 谨慎：动了要重建索引验证 | ✅ |
| `packages/design-tokens/tokens.css` | **视觉令牌唯一来源**（生产依赖，被 `apps/desktop/src/renderer/src/main.jsx` 直接 import） | ✅ 只在这里加令牌，不要复制第二份。⚠️ **2026-10-13 所有者已确认降级**：Tailwind 接管后本文件成为**主题输入之一**（不再是"唯一来源"），见 `docs/plan/ROADMAP.md` §10；**落地前仍是唯一来源** | ✅ |
| `docs/` | 全部正文文档：`spec/`（约束）· `design/`（设计）· `guide/`（上手/排障）· `plan/`（做什么、什么顺序）· `audit/`（审查产物）· `archive/`（**已失效的东西全放这里**）。⚠️ **行动清单不在这里**，在根目录 [`TODO.md`](TODO.md)<br>✅ **2026-10-13 新增 `docs/design/ui-kit/`**（Apple macOS UI Kit 参照物，配合 `docs/design/UI-KIT.md`）：**入库** `build.mjs`（生成器）+ `kit-data.json`（抽取结果 527 KB）；**不入库** `index.html`（1.2 MB 派生物，`.gitignore` 有理由）。重建：`node docs/design/ui-kit/build.mjs`（**不需要外部 Sketch 套件** —— 它只用已入库的 kit-data.json；已实测产物逐字节相同）。⚠️ 它是**参照物不是应用 UI**：不消费 `tokens.css`，也不受"渲染层零色值字面量"那条断言约束（那条只扫 `apps/desktop/src/renderer`） | ✅ 见 §6 纪律 | ✅ |
| `fixtures/` | **契约 §8 要求的样例索引**：`sample-index.json`（3 库 / 30 条，覆盖空 / 无结果 / 无索引 / 索引损坏 / `COMPAT_MISMATCH` / `RECOVERY_NEEDED` / 部分成功 / 待重编码 / 已移除 / GPU 回退 / BMP 回退档）。⚠️ **路径是契约指定的**（`fixtures/sample-index.json`），别挪。<br>由**主进程**读入并**注入**引擎（渲染层读不到 —— 打包后 `import.meta.url` 会解到仓库外，实测主进程崩在建窗之前）；用 `GEMMA_FAKE=1` 打开。加演示分支要同步 `fake.test.mjs` 的 **F10**<br>✅ **2026-10-13 新增 `lib-a/`**：P4 写操作/故障注入的**夹具库**（32 文件 / 6 目录，覆盖配对全分支含"只有包"与两个**歧义**分支；内容是**确定性合成的 ASCII 字节，不是真图** —— 事务只看字节与扩展名）。`manifest.json` 记每份 sha1；复现配方写在它自己的 `README.md` 里。**事务类测试只对它做写操作，且都写副本** | ✅ | ✅ |
| `tools/` | **2 个只读守卫**（`verify_encoder_path` / `check_search`，本机都跑不动）+ `probe_electron_start/` | ✅ | ✅ |
| `scripts/` | 启动辅助（`electron-vite.mjs`：摘 `ELECTRON_RUN_AS_NODE`、探测沙箱、必要时加 `--no-sandbox`） | ⚠️ 谨慎 | ✅ |
| `reports/` | 门禁证据，命名 `G-<字母>-<日期>/`。**项目规则：无归档证据 = 门禁未通过** | ✅ 只能加新证据，不改历史证据 | ✅ md/json/csv；截图否（见 `.gitignore`） |
| `build/` | 打包图标 + 签名配置（electron-builder 的 `buildResources`）。**不是产物目录** | ⚠️ 别当产物删了 | ✅ |
| `resources/` | 打包辅助资源目录（当前为空） | ⚠️ 谨慎 | ✅ |
| `reference/MODEL_CARD.md` | 官方模型卡（外部资料） | ❌ 只读 | ✅ |
| `data/` | 索引、日志、诊断中间物、缩略图缓存 | ⚠️ **`_` 开头的一律可删；其余是正在用的索引，别删** | 🔸 绝大多数否 |
| `out/` | 构建产物（`npm run build` 生成） | ❌ 别手改 | ❌ |
| `node_modules/` · `.npm-cache/` | 第三方库与缓存 | ❌ 别碰 | ❌ |
| `tests/` | 预留的**跨包**集成测试位置（当前**不存在**；引擎单测随引擎走，在 `packages/engine/tests/`） | — | （未来）✅ |
| 根配置文件 | `package.json`（workspaces 根）· `electron.vite.config.mjs` · `electron-builder.yml` · `tsconfig*.json` · `.gitignore` · `.gitattributes` · `LICENSE` | ⚠️ **改前先问**（会同时影响构建、守卫与所有人） | ✅ |

**约定**：仓库根**只放** `AGENTS.md` · `README.md` · `TODO.md` 三份 `.md`。
⚠️ **2026-10-13：原先强制它的 `verify-doc-refs.mjs` 已移除** ⇒ 这条现在**没有自动化**，只能靠人看（见 §5.2）。
⚠️ **已登记的例外（1 个，别再加）**：`违规的UI.md` —— **所有者 2026-10-13 明确指示**放在仓库根（那是 Apple Style 审查的**违规唯一详表**，报告只引用 `V-nn` 编号、不复制该表）。例外本身也写在该文件的头部，避免后来者以为是纪律漏洞。**要挪走它必须先问所有者**（引用它的地方：`docs/audit/UIUX-APPLE-STYLE-AUDIT.md` 与 `docs/design/UI-KIT.md`）。
本轮审查的三份汇总报告在 `docs/audit/`（`AUDIT-FINAL.md` · `STACK-AUDIT.md` · `UIUX-AUDIT.md`）。

---

## 3. 新东西该放哪儿（最实用的一节）

| 你要加的东西 | 放哪儿 | 注意 |
|---|---|---|
| 界面页面 / 组件 | `apps/desktop/src/renderer/src/`（页面进 `pages/`，通用组件进 `ui/`，布局进 `layout/`，hooks 进 `hooks/`） | ✅ **2026-10-13（T3）起：新样式写 Tailwind 类**（生成层 = `styles/tailwind.css`）。
  ⚠️ **类名里的数字要走令牌阶梯**：`--spacing: var(--space-1)` ⇒ `N` 档 = 4px×N，所以 `px-3` = `--space-3`、`min-h-11` = 44px = `--touch-min`。**别用任意值**（`px-[11px]`）。
  ⚠️ **颜色不许写死**：用 `bg-surface` / `text-ink` / `border-line` 这类映射，**不要** `bg-[#0071e3]` —— 那会造出第二份色值（T1 断言会红）。
  ⚠️⚠️ **要在 `<Link>` 上用按钮样式，必须 `<Button asChild><Link …></Link></Button>`** ——
    写成 `<Button><Link>…</Link></Button>` 会渲染出 **`<a>` 嵌在 `<button>` 里**：HTML 规范禁止、
    两个可聚焦元素（读屏念成"按钮里有个链接"）、图标不居中。**T2 真栽过 4 处**（截图可见）。
    `asChild` 走 Radix `Slot`，最终只渲染一个 `<a>`。断言：`dom-validity.test.mjs` V1/V2 + E2E `routing.spec.mjs` E6-a/b。
  ⚠️ **新页面必须设窗口标题**：调 `useDocumentTitle(LABELS.xxx)`（`LABELS` 在 `router/paths.js`，是页面名的唯一来源）。
    不调的话任务栏标题不会变 —— 多页应用里这是很明显的观感缺口（T2 时真这样）。
  ⚠️ **修饰态写「互斥」不写「叠加」**：`cx(BASE, active ? ACTIVE : IDLE)`。叠加式（`cx(BASE, active && "bg-ink")`）看着更 DRY，但两个工具类**同优先级**，谁赢只取决于产出顺序 —— 迁移时真栽过（见 `ui/Chip.jsx` 头注释）。
  🔸 **`renderer.css` 仍在**（114 条未迁规则）：基础层与未迁移的组件样式留在这里，**逐族迁出**。进度记在 `renderer.css` 头部。
<br>⚠️ **UI 层不得直接碰 `window.api`**（见 §0.1 三层架构） |
| **Operation 层**（状态 / 编排 / 工具） | `renderer/src/store/**` · `renderer/src/hooks/**` · `renderer/src/utils/**` | 把 Adapter 的原始结果转成界面要的形状；**不放协议细节**（那归 Adapter）。✅ 现有：`store/search.js`（检索状态）· **`store/tasks.js`（索引任务的事件归约，纯函数 `reduceEvent` —— P3d）** ·
  `hooks/useEngine.js` `useLibraryConfig.js` `useToast.js` · `utils/gate.js`（门禁判定）· `utils/useDocumentTitle.js`（窗口标题）· **`utils/index-state.js`（索引状态四档）** · **`utils/item-actions.js`（动作四分区 + 是否需重编码 + 为什么点不动）** · **`utils/format.js`（`humanSize`/`humanTime`）**。
  ⚠️ **领域判断别写进 `.jsx`** —— `.jsx` 在 `node:test` 里加载不了，塞进去就等于放弃自动化（P3c/P3d 的两块判断都是因此抽出来的）。 |
| **E2E 测试** | `apps/desktop/e2e/**` | ⚠️ **不是守卫**，是 Playwright 套件（`npm run e2e`）。它**真启动 Electron**，所以能验证 `node:test` 碰不到的东西：真渲染、真导航、真 preload、真窗口安全行为。
  加用例：`e2e/*.spec.mjs`；启动/场景的公共逻辑在 `e2e/helpers/`（**不要**在 spec 里各写一遍启动参数 —— 那三个坑见 `helpers/launch.mjs` 头部注释）。产物 `test-results/` 已 gitignore |
| **路由** | `renderer/src/router/**` | ⚠️ **路由路径的唯一来源是 `router/paths.js`**（纯数据、无 JSX —— 这样 `node:test` 能用 `matchRoutes()` 真解算）。
  组件映射在 `router/index.jsx`，那里有条**启动期断言**：表里有 key 却没有组件就当场抛（宁可启动即失败，也别白屏）。
  用 **hash 路由**：打包态是 `file://`，history 路由的深链会 404。**新页面要同时改 `paths.js` 与 `COMPONENTS`** |
| **Adapter 层**（**唯一 invoke 入口**） | `renderer/src/adapter/**` | ⚠️ **全应用只有这里能碰 `window.api`**；统一解包 `{ok,data,warnings}` / `{ok:false,error}` 与统一类型。✅ **已落地（2026-10-13，T5）**：`adapter/api.js` —— 全渲染层**唯一**碰 `window.api` 的地方；统一解包信封、`userMessage` 永远非空、**永不抛异常**。改前是 3 文件 6 处直调（见 [`TODO.md`](TODO.md) A-1）。`layering.test.mjs` 的 L1/L3/L5 会拦住回退 |
| 通用去重工具（class 合并等） | `renderer/src/ui/cn.js` —— **全应用唯一一份** | ✅ **2026-10-13（T4）已收口**：`cn = twMerge(clsx(...))`；旧的 `ui/cx.js` **已删除**（那是 P1 的现成违例）。
  ⚠️ **`tailwind-merge` 不是多余的**：`clsx` 只拼接，`cn('px-3', 'px-2')` 若只有 clsx 会**两个类都留下**，谁生效取决于产出 CSS 顺序 —— T3 迁移时真栽过（Chip 选中态底色不变）。`twMerge` 按冲突组消掉前者 ⇒ 这类 bug 不再出现。
  ⚠️ **别再加第二份** —— `deps.test.mjs` 的 **D-D** 会红（它检查 `ui/` 下只有 `cn.js` 一份实现，且没人 import 已删的 `cx.js`）
  ⚠️⚠️ **加新字号档必须同时改两处**：`styles/tailwind.css` 的 `@theme { --text-* }` **和** `ui/cn.js` 的 `TEXT_SIZES`。
    漏了后者 ⇒ `tailwind-merge` 不认识那个名字，把它归进 `text-color` 通配组 ⇒ 与 `text-ink` 判为冲突、**静默丢掉字号**。
    **T4 真踩过**：构建通过、页面不白屏，只有真窗口量计算样式才看得出来（E2E `styles.spec.mjs` 的 E4-a/b/d 抓到）。
    回归锁：`styles.test.mjs` 的 **T5**（8 个档位逐个断言两者都在）与 **T5b**（清单与 `@theme` 一一对应） |
| 引擎能力 | `packages/engine/src/` + 对应测试放 `packages/engine/tests/` | **必须保持零第三方依赖**，且不得 import `electron` / `http` |
| 契约 / 新 IPC 方法 | `apps/desktop/src/shared/ipc.ts` | ⚠️ **唯一来源**。preload **不需要改**（它是通用转发 `invoke`，校验全在 zod 白名单）；要同步的是 `docs/spec/CONTRACT-engine-v1.md`。⚠️ 若新方法**不经引擎**（由主进程直接处理，如库配置三个方法），还要在 `main/index.mjs` 的 `registerIpc` 里**显式分派**，否则会被当成"引擎无此方法"拒绝 |
| 索引构建 / 重采样 / 解码 | `packages/indexer/src/` | 改了编码路径必须重建索引并给证据 |
| 新的守卫 / 校验脚本 | `tools/verify_*.mjs` | 只读、退出码 0/1、写完自己跑一遍 |
| 一次性调查 / 探针 | `tools/probe_electron_start/` 或 `docs/archive/spike/` | **别放仓库根** |
| 规格 / 设计 / 上手文档 | `docs/spec/` · `docs/design/` · `docs/guide/` | **绝不放仓库根** |
| 计划与进度 | `docs/plan/ROADMAP.md` | 它是「做什么、什么顺序」的唯一出处 |
| 审查证据 / 基线 | `docs/audit/` | 带 `文件:行号`；现状基线只有 Lead 能改 |
| 门禁证据 | `reports/G-<字母>-<日期>/` | **必须进 git**，否则算没通过；协议见 `reports/README.md` |
| 设计令牌 | `packages/design-tokens/tokens.css` | 别复制第二份；加完跑样式守卫 |
| 被取代 / 已失效的东西 | `docs/archive/` | 留档不删（git 历史仍可回溯） |
| 临时试验、日志、备份 | `data/_*` | 已 gitignore，随时可删 |

**命名与文件类型**（照现状，别发明第三套）：

- 引擎 / 主进程 / 守卫 / 构建脚本 → `.mjs`（纯 ESM）
- **契约边界 → `.ts`**（2026-10-13 起：`apps/desktop/src/shared/ipc.ts`）。⚠️ 只有这里的 `.ts` 是刻意的：
  `.ts` **总会被类型检查**（不受 `checkJs` 开关影响）⇒ 这是 `npm run typecheck` 目前唯一有内容的来源。
  Node ≥23.6 原生类型剥离，所以 `node:test` 能直接 import 它，**不需要构建步骤**
- preload 源码 `.js`，**构建产物必须 `.cjs`**（`sandbox: true` 不加载 ESM preload）
- 渲染层 → `.jsx` / `.js`（React 19，**普通 JS，不是 TypeScript**）
- 测试 → `*.test.mjs`，用 `node:test`，**跟着被测包走**
- 文档 → 约束类用大写主题名（`SPEC-*` / `DESIGN-*` / `CONTRACT-*`），过程类用小写连字符
- CSS 令牌 → `--kebab-case`，只在 `tokens.css` 定义

---

## 4. 权威关系表（消灭「同一件事两处说法」的根因）

**每件事只有一个出处。发现两处不一致：改错的那处，别在两处各改一半。**

| 这件事 | 以谁为准 |
|---|---|
| 项目是什么 · 现在什么状态 · 怎么跑 | [`README.md`](README.md) |
| 在这个仓库里怎么干活（本文件：**项目架构 + 执行规范**） | `AGENTS.md` |
| 文档谁指向谁 | [`docs/README.md`](docs/README.md) |
| 做什么、什么顺序、什么算做完 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用技术栈与目录结构 | [`docs/spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口形状（方法 / 错误码 / 事件 / 恢复） | [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 索引元数据 / 身份 / 配对 / 指纹 | [`docs/spec/SPEC-identity.md`](docs/spec/SPEC-identity.md) |
| 事务 / 撤销 / 并发（**地基已实现 2026-10-13；`ingest`/`mutate` 未接线**） | [`docs/spec/SPEC-transactions.md`](docs/spec/SPEC-transactions.md) |
| **验收阈值 / 性能口径 / 门禁**（阈值唯一出处） | [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 传输层与外壳安全（IPC / `thumb://` / 渲染进程姿态 / 权限用例） | [`docs/spec/SPEC-security.md`](docs/spec/SPEC-security.md) |
| UI / UX | [`docs/design/UI-REVIEW-and-migration.md`](docs/design/UI-REVIEW-and-migration.md)（摘要见 `DESIGN-app-details.md` §一） |
| **UI/UX 违规台账**（**唯一详表**，报告只引用 `V-nn`） | [`违规的UI.md`](违规的UI.md)（仓库根 —— **已登记的例外**，见 §2 约定） |
| **Apple HIG 基线数值 / 应用对差**（**参照物，不是令牌来源**） | [`docs/design/UI-KIT.md`](docs/design/UI-KIT.md)（可执行参照站由 `docs/design/ui-kit/build.mjs` 生成） |
| **本轮 Apple Style 审查报告**（结论 / 优先级 / 可复现命令） | [`docs/audit/UIUX-APPLE-STYLE-AUDIT.md`](docs/audit/UIUX-APPLE-STYLE-AUDIT.md) |
| 视觉令牌 | [`docs/design/DESIGN-tokens.md`](docs/design/DESIGN-tokens.md)（可执行版 = `packages/design-tokens/tokens.css`） |
| **现在还有什么没做完 / 什么坏了**（行动清单，唯一） | [`TODO.md`](TODO.md) |
| 历史欠账台账（逐条已清/未清，含陈旧记录） | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 本次 monorepo 重构怎么执行 | [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) |
| 现状事实基线（审查用） | [`docs/audit/00-current-state.md`](docs/audit/00-current-state.md) |
| 门禁证据协议 | [`reports/README.md`](reports/README.md) |
| 模型前缀 / seq / 精度上限的依据 | [`reference/MODEL_CARD.md`](reference/MODEL_CARD.md) |

---

## 5. 门禁与验收

### 5.1 期望值（对不上就是没做完）

> **两条独立的门禁，不要混**：`npm test`（`node:test`，纯逻辑，无 GUI，**300 条**）与
> `npm run e2e`（Playwright，真启动 Electron，**56 条**）。前者快、随时能跑；后者慢、**需要能出窗的环境**。
> 绿了哪一条就只说哪一条 —— 别用"测试全绿"含糊过去。

| 门禁 | 期望 |
|---|---|
| `npm test` | `tests 300 · pass 299 · fail 0 · skipped 1`（**2026-10-13 实测**。引擎 **148** = engine 33 + fake 22 + index 18 + security 16 + uid 7 + **transactions 24** + **transactions-recovery 14** + **transactions-fault-injection 10** + **transactions-write-path 4**；桌面 **152** = library-config 14 + permissions 15 + search-store 17 + source-scan 17 + task-store 13 + adapter 11 + item-actions 10 + styles 10 + window-security 10 + deps 8 + layering 8 + gate 6 + router 5 + dom-validity 4 + ports 4） |
| `npm run build` | 成功，且 `out/main` · `out/preload` · `out/renderer` 三端齐备（**已实测通过**；受限沙箱内需提权，见下） |
| `npm run typecheck` | EXIT=0，**且注入类型错误时必须变红**（2026-10-13 T1 加回）。⚠️ **只覆盖 `.ts`** —— 当前仅 `ipc.ts` |
| `npm run e2e` | **`56 passed`**（**2026-10-13 实测**）。系列：E0 出窗与安全 · E1 首启向导 · E2 路由（含 `/item` 参数消费）· E3 窗口安全真行为 · E4 样式保真 · E5 无障碍 · E6 返回控件语义 · E7 确认弹窗（6 条，靠**主进程 IPC 打桩**摆脱模型依赖）· **E8 模拟模式（6 条）** · **E9 图片详情 P3c（6 条）** · **E10 索引任务 P3d（6 条）** · **E11 操作记录（6 条）**。<br>⚠️ **它真启动 Electron** ⇒ 在 agent 沙箱内需要 `--no-sandbox`（助手已带）**且要提权**；普通终端直接跑即可 |
| 守卫 | 下表 EXIT=0（**2026-10-13 起只剩 2 个**；其余 6 个按所有者指令移除，见 §5.2 的说明） |
| 证据 | 每条被声称通过的 G-* 门禁，在 `reports/` 里都有归档证据 |

**那个跳过（如实记录，不要当成通过）**：

1. 本环境无法创建**文件**符号链接（`EPERM`）→ 该条跳过。**这是环境限制**：目录联接（junction）能建，文件符号链接不能。这条断言的是「库内指向库外的符号链接必须被拒」，在能建链接的机器上会真跑（`packages/engine/tests/security.test.mjs` ④）。

> ✅ **D2 修复的连带效果（2026-10-12）**：原先还有**两条永久跳过**，因为它们在测试里**自己直读 `config.json`** 拿库根，而那个文件早已删除。
> 它们现在改为用**与生产同序**的解析（`packages/engine/tests/lib-root.mjs`：环境变量 → `config.json` → **索引自举**），于是**都真的跑起来了**：
> - `指纹 v1：与 baseline-v1.json 记录的值一致` —— JS 与 Python 的指纹**逐字节一致**（真实跑，2.9 s）
> - `uid: 整库唯一性` —— 扫过真实库全部图片，**0 处 UID 碰撞**
>
> ⇒ 跳过数 **3 → 1**，通过数 **65 → 79**。**这不是"把测试改绿"**：库根来自索引元数据（生产实际来源），断言的内容一个字没放松。

**另一条环境限制（2026-10-12 已实测解除，但边界本身仍存在 —— 保留记录）**

`npm run build` 在**受限沙箱**（例如某些 CI / 容器，含本项目的 agent 执行沙箱）内**会失败**，且**失败点在加载配置之前**：

```text
failed to load config from electron.vite.config.mjs
error during build: Error: spawn EPERM
    at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)
    at bundleConfigFile (node_modules/electron-vite/dist/chunks/lib.js:1710:26)
```

根因：esbuild 用 **piped stdio spawn 一个常驻服务进程**，受限沙箱不允许 —— **这是环境限制，不是配置或代码问题**（连配置文件都还没加载到）。

> ✅ **2026-10-12 已在提权下实际跑通**（`spawn EPERM` 消失，EXIT=0）：
> ```
> out/main/index.js                       49.49 kB
> out/main/chunks/{bmp_decode,encoder}-*.js
> out/preload/index.cjs                    0.82 kB
> out/renderer/index.html                  1.15 kB   ← 注意构建日志里是
> out/renderer/assets/index-*.css         25.50 kB     `../../../../out/renderer/…`，
> out/renderer/assets/index-*.js         673.37 kB     正是 outDir 显式配置生效的实证
> ```
> ⚠️ **下面两条守卫已于 2026-10-13 移除**（原件在 `data/_removed-guards-backup/`）—— 这是**当天的真实记录**，保留不改写，但**不再可复跑**。
> 随后 **`verify_app_build.mjs` EXIT=0**（含 preload 是 CJS、依赖 external、路径相对、CSP 在、`thumb://` 还在）
> 与 **`verify_renderer_dom.mjs` EXIT=0**（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件全过），
> 两条**首次获得判定**。

- （历史教训）原先 `verify_app_build` / `verify_renderer_dom` / `smoke_app` 这三条依赖 `out/` 的检查，
  必须在一次成功的 `npm run build` 之后才有意义（顺序不能反）—— **这三条已移除**，此条留作提醒。
- `out/` **不进 git**（`.gitignore` 已覆盖），所以**新克隆的仓库里它不存在** ——
  直接跑那三条守卫会报「找不到 `out/main/index.js`」，**那是缺前置条件，不是重构坏了**（同样已移除）。
- ✅ **"能不能出窗"已不再是未验证项**（2026-10-13）：`npm run e2e` 的 **E0** 就是"真启动 + 读真窗口"，
  已实测通过（`window.api` 恰好三键 · `require/module/process` 全 `undefined` · 非白屏 · 0 控制台错误）。
- ❌ **仍然未验证**的是**打包态**与冷启动计时 —— 见 [`TODO.md`](TODO.md) B-3。

### 5.2 两个守卫（全部只读）

> ⚠️ **2026-10-13：所有者指令「仅保留 `verify_encoder_path` 与 `check_search`，其余全部移除」。**
> 被移除的 6 个：`verify_app_build` · `verify_main_wiring` · `verify_renderer_dom` · `verify_renderer_styles` · `smoke_app` · `verify-doc-refs`。
> **原件已备份在 `data/_removed-guards-backup/`**（含从未提交的 `verify_main_wiring.mjs` —— 不在备份里就永久丢失）。
> 恢复方式：拷回 `tools/` + 还原 `package.json` 的 `smoke` 脚本。该目录已 gitignore，可随时删。

| 守卫 | 断言什么 | 前置条件 |
|---|---|---|
| `node tools/verify_encoder_path.mjs --model <ONNX 模型目录>` | 编码路径一致性（**跑真实推理**）：改过编码路径就必须重建索引，否则检索质量静默退化 | 本机有 ONNX 模型目录 |
| `node tools/check_search.mjs` | 检索**端到端**自查（向量模式，走引擎真实检索路径）。退出码 `0`=打通 · `1`=失败/无结果 · `2`=参数缺失 | 已有查询向量与已注册索引 |

**这两个都有个现实问题：本机（agent 沙箱）跑不动** —— 需要模型目录与已注册索引。
⇒ **"守卫全绿"在本环境已无法验证**，不要声称验证过。

#### 移除的代价，以及 2026-10-13 补回了哪一部分

⚠️ **必读**：守卫移除后，**2026-10-13 又接入了 Playwright（`npm run e2e`）** —— 它把**渲染层与真窗口那一层**补了回来，而且比原来强（原来 `verify_main_wiring` 用的是**假 `electron`**，现在是真的）。

| 能力 | 移除后的状态 | 现在谁负责 |
|---|---|---|
| 出窗能力 | 无 | ✅ **E2E E0**（真启动，曾由 `smoke_app` 负责） |
| preload 暴露面 / S9 渲染进程 Node 能力 | 无 | ✅ **E2E E0** —— 在**真窗口里读真的 `window.api`**，不再是产物文本断言 |
| 首启向导真界面（D2） | 无 | ✅ **E2E E1** |
| S11/S12 窗口安全**真行为** | 无 | ✅ **E2E E3** —— 比原来的假 electron 强 |
| 路由真导航 | 无 | ✅ **E2E E2** |
| 分层 / 文案收敛 / 路由表 / 门禁判定 | 无 | ✅ **`npm test`**（49 条，2026-10-13 新增） |
| **结果区 UI**（结果卡 / 取件确认 / 档位渲染 / 定位失败文案） | 无 | ✅ **E2E E7**（2026-10-13）—— 靠**主进程 IPC 打桩**摆脱模型依赖，在真窗口里跑真组件 |
| **真实检索质量 / 缩略图内容** | 无 | ❌ **仍无** —— 那要真模型 + 已注册索引（`TODO.md` B-3）；打桩测的是**接线与界面**，不是编码质量 |
| **样式与令牌纪律** | 无 | ✅ **E2E E4 + `npm test` T1/T1c/T2/T2b**（2026-10-13 T3 接回）—— 色值唯一、@theme 只许 `var()`、F-02 阈值、以及**迁移保真度**（真窗口计算值 === 令牌值） |
| **S13 iframe 来源校验** | 无 | ❌ **仍无**（E2E 里可以造 iframe，尚未做） |
| **产物形状（ESM/CJS/CSP）** | 无 | ❌ **仍无**（原 `verify_app_build` 的职责） |
| 打包态 / 冷启动计时 | 无 | ❌ **仍无**（P6 的 G-E1） |
| 根目录纪律 / 死引用解算 | 无 | ❌ **仍无**（原 `verify-doc-refs`，只能靠人看） |

逐条与备份路径见 **[`TODO.md`](TODO.md) B-4**。

#### 仍然有效的那句话

> 守卫**证明不了**的事情，不要当成证明了。现在更要紧：**"没跑过" ≠ "没问题"**。

### 5.3 两条硬规则

1. **无归档证据 = 门禁未通过。** 结论要落到 `reports/G-<字母>-<日期>/`，否则不算。
2. **`reports/` 里的 G-B 索引质量判据已不可复跑**（`tools/quality/` 随 Python 档退役被删）→ 那些证据是**存档**，不能独立重算。引用时必须写明这一点，不得声称「本轮实测」。

---

## 6. 写作纪律

- **正文文档放 `docs/`**（spec / design / guide / plan / audit）；**仓库根只留 `AGENTS.md` + `README.md` + `TODO.md`**。
- **引用写「仓库根相对」路径**（`docs/spec/SPEC-app.md`），不要写 `../`——引用散落在不同深度，`../` 会随深度变化，根相对写法全局一致。
- **改文档后自己过一遍引用**：死引用与根目录越界**已经没有守卫了**（见下条），只能靠人看。
- ⚠️ **2026-10-13：`verify-doc-refs.mjs` 已按所有者指令移除** —— 根目录纪律与死引用解算
  从此**没有自动化**，只能靠人看。移除前它刚被修成真门禁（6 条历史误报清零），所以这次移除
  等于把那份清理工作一起放弃了；若日后要恢复，原件在 `data/_removed-guards-backup/verify-doc-refs.mjs`。

### 定位行号：必须用 `read` 工具或 node，**不要用 `Get-Content`**

PowerShell 5.1 的 `Get-Content` 按 GBK 解码 UTF-8 中文，多字节字符被拆坏并**合并行**，于是行号全错。
实测（2026-10-12，同一份文件同一时刻）：

| 文件 | `Get-Content` 数出 | 按 UTF-8 读实际 |
|---|---|---|
| `docs/design/DESIGN-tokens.md` | **245** | **292** |
| `docs/spec/SPEC-acceptance.md` | **259** | **347** |

（这两份正在被编辑，具体数字会变；**结论不变**：定位行号只用 `read` 工具或 node。）

```powershell
# ✅ 正确：拿真实行号
node -e "const s=require('fs').readFileSync('docs/design/DESIGN-tokens.md','utf8');console.log(s.split('\n').length)"
```

### 结论的写法

- 每条结论带 `文件:行号` 或「命令 + 原始输出」；无证据标【判断，非实测】。
- 引用既有证据（`reports/`）时写「引用既有证据」，**不要写成「本轮实测」**。
- **不得声称未验证的能力**（见 §7）。

---

## 7. 明确禁止与已知边界

**禁止**

> ⚠️ **2026-10-13 追加的三条（P1 同概念多实现 · P2 复制粘贴 · P3 硬编码可配置值）见 §0.1** —— 那三条优先级更高，且已列出**现成违例**。以下为既有禁止项。

- **不写素材库。** 检索、缩略图、`scan` 等只读操作在文件系统上**零写入**；写入素材库只允许走 `docs/spec/SPEC-transactions.md` 的四步纪律（且当前 `ingest`/`mutate` 尚未实现）。
- **不把本机绝对路径写进代码或文档**（如 `G:\model`）。库位置由配置提供；文档里的示例路径要标明是示例。<br>✅ **T5-D（2026-10-13）已给出配置入口**：取件目录改为 `GEMMA_COLLECT_DIRS` > 注册表 > `config.json` > 规格兜底。⚠️ **规格兜底本身仍是绝对路径**（SPEC-app §9 规定，改它要走规格变更控制）⇒ 非 `E:` 盘的机器应显式设环境变量。逐条见 [`TODO.md`](TODO.md) **A-3**。
- **不在 `packages/engine/` 里 import `electron` 或 `http`**（「传输无关」的可执行判据，单测会拦）。
- **不让渲染进程拿到 `ipcRenderer` 或任意绝对路径入参**；路径只能由 `libId + uid` 解析。
- **不声称嵌入模型「看得出图里是什么」**——它只产出向量。
- **不自动 `git commit` / `push`**，除非所有者明确要求。
- **不把 `--no-sandbox` 固化进产品**（它只是受限环境的降级开关）。

**已知边界（如实写明，不得含糊）**

| 边界 | 事实 |
|---|---|
| **未验证的能力**（冷启动计时 · 打包态 · 真实 `thumb://` 取图 · iframe 内 `invoke`） | **均未验证，不得据此声称可用**。逐条与原因见 [`TODO.md`](TODO.md) B-3 |
| **~~真窗口行为~~** | ✅ **已实测（2026-10-13，Playwright E2E）**：`window.open` **真被 deny**（返回 null、无第二窗口）· 外部导航**真被拦**（URL 不变、渲染层仍活）· preload 暴露面恰好三键 · `require/module/process` 全 `undefined`。⚠️ **但仍有一条实测出的边界**：`file://` 导航是**前缀放行**，实测能把界面导航走（落到 `chrome-error://`）—— 见 `docs/spec/SPEC-security.md` §8.1 |
| 受限沙箱 | Chromium 进程沙箱起不来时 Electron 会**秒退且一行日志都不生成**；此时用 `npm run dev:restricted` / `npm run start:restricted`（= 附加 `--no-sandbox`）。**普通终端不需要**。 |
| 生产态 DevTools | 生产态保留 `devTools: true` 是**已决策项**（`docs/spec/SPEC-security.md` §9 决定 3），不是疏漏。 |
| 日志 | 主进程与渲染进程的诊断都写 `data\_app.log`。Windows 上 Electron 是 GUI 子系统程序，**stdout 不连终端**，`console.log` 一条都看不到。 |
| **D2 · 库根配置缺口** | ✅ **已修（2026-10-12）**：库不再只从 `config.json` 读。主进程按**四条优先级**解析（`apps/desktop/src/main/library-config.mjs`）：① `GEMMA_LIB_ROOT` 环境变量 ② `userData/library-registry.json`（决策 9 的正规存储）③ `config.json`（兼容回退，**不要求用户去配**）④ **从已有索引 `data/libraries/*/meta.json` 自举**（`meta` 里本就存着 `lib_id` + `lib_root`）⇒ **有索引的机器零配置即用**。无库时界面显示**首启向导**（`pages/LibraryGate.jsx` → `FirstRunWizard.jsx`）而不是裸 `LIB_NOT_FOUND`。测试 `apps/desktop/tests/library-config.test.mjs`（现 **14** 条：原 12 条 + T5-D 新增 2 条）。⚠️ 原写的 `verify_renderer_dom.mjs` §8（7 条）**已随守卫移除** ⇒ 界面侧的向导行为现在只有单测 + 人工核对 |
| **F-04 · 取件白名单为空** | ✅ **随 D2 一并解决**：`collect.dirs` 原先恒为 `{}` ⇒ 任何 `collect` 都返回 `COLLECT_DIR_NOT_ALLOWED`。现按规格给默认值（`E:\素材待用` / `E:\移出素材`，出处 `docs/spec/SPEC-app.md` §9 与 `docs/spec/SPEC-transactions.md` §7），并可由注册表覆盖 |
| **F-01 · `reveal` 未接线** | ✅ **已修（2026-10-12）**：原先主进程**从未注入 `shell` 端口**，而引擎在无 `shell` 时仍返回 `ok({revealed:true})` ⇒ **静默假成功**。现在：① 引擎在端口缺失/形状不对时返回**新错误码 `PORT_MISSING`**（绝不 `ok`），且顺序是**先确认文件在盘上再调端口**；② `apps/desktop/src/main/index.mjs` 注入 `shell: createRevealPort(shell)`（`apps/desktop/src/main/ports.mjs`）。**回归锁定（⚠️ 2026-10-13 已削弱）**：引擎 +5 条单测 · 端口本体 +4 条（`apps/desktop/tests/ports.test.mjs`）**仍然有效**；但原本在**行为面**锁它的 `verify_main_wiring.mjs`（真调 `reveal`、断言壳端口真的收到绝对路径）**已随所有者指令移除** ⇒ **"接线接上了"现在只有纯逻辑单测，没有行为证据**。恢复方式见 §5.2 的备份路径。⚠️ **能力边界**：`shell.showItemInFolder` **返回 void、不报告失败** ⇒ 成功文案写「已请求在资源管理器中定位（系统未回报结果）」，**不写**「已定位」。<br>⚠️ **§1b 写对不容易，两个反复被证伪的坑（都在注释里写明）**：① **必须先剥注释** —— 实测 bundle **保留源码行注释**，直接匹配会命中 `// shell: createRevealPort(...)`；而"注释掉一行"正是禁用接线的常见手法。剥注释器还必须**认识正则字面量**（含引号的正则 `/["']/g` 会让朴素实现误入字符串模式 ⇒ 被注释的接线重新可匹配；差分实测证实）。**不能用 `esbuild.transform`** —— 它在受限沙箱 `spawn EPERM`，会让守卫整体失效。② **必须取"调用点的实参"** —— 引擎函数签名里就写着形参 `shell = null`，若按"第一个 `createEngine(`"取，会取到**函数声明**，"接线有没有接上"就永远为真 |
| **F-02 · 界面自算分数阈值** | ✅ **已修（2026-10-12）**：原先 `ui/Score.jsx` 硬编码 `0.97/0.93` ⇒ **每次文本检索的全部结果都被标成「较弱」**（文本真实 top-1 在 0.74–0.80）。现在档位**只来自引擎的 `item.band`**，`band` 缺失时**只显示分数、不猜档位**。**回归锁定（2026-10-13 已接回）**：原先锁它的 `verify_renderer_styles.mjs` §5 与 `verify_renderer_dom.mjs` §10 **已随所有者指令移除**，
但 **T3 把这条断言接了回来**：`apps/desktop/tests/styles.test.mjs` 的 **T2**（渲染层不得出现 0.6~0.99 的阈值常量）
与 **T2b**（`Score.jsx` 必须消费 `band`、且未知 band 拒绝定档）。**已双向验证**：往 `Score.jsx` 注入 `0.97` ⇒ `fail 1` 且报出 `Score.jsx → 0.97`。
⚠️ 能力边界不变：`band` 本身是不是"对的"仍取决于引擎（`TODO.md` C-2） |
| 未实现的契约方法 / 多库注册表 | ⚠️ **未完成项**，清单见 [`TODO.md`](TODO.md) B-2（本表只记"边界事实"，不记待办）。<br>✅ **2026-10-13 起有唯一一处定义**：`packages/engine/src/engine.mjs` 的 **`UNIMPLEMENTED_METHODS`**（= ingest · mutate · transactions · indexStart · indexCancel · indexResume），主进程直接 import 它 ⇒ 真实模式统一返回「这个功能还没做好。」。<br>⚠️ **P3a–P3d 四个页面已全部实现**（`/` · `/item/:libId/:uid` · `/tasks` · `/activity`）—— 这一行原先写的"两个页面未做"已过期 |
| 素材库只读 | 检索**不移动、不复制、不重命名、不删除**任何素材；结果是路径。 |
| 20 个假 `.jpg` | 预览图里有 20 个文件名是 `.jpg`、实际内容是 BMP（集中在 `VR`）。解码路径会自动回退，**它们不是坏文件**。 |
| 索引与库位置绑定 | 索引里存了素材的**绝对路径**；素材库再次移动会让索引失效，必须重建。 |
| 索引不能边建边查 | 建索引与检索争 GPU，实测速率减半。 |

---

## 8. 术语表

| 词 | 白话 |
|---|---|
| **向量 / embedding** | 把一段文字或一张图变成一串数字，让「意思相近」变成「数字相近」；本项目的统一维度是 **768** |
| **索引 (index)** | 事先算好并存的向量集合，落在 `data/libraries/<libId>/` |
| **引擎 (engine)** | 干活的「大脑」，不含界面：`packages/engine/`，**零第三方依赖** |
| **契约 (contract)** | 接口形状约定（有哪些方法、会报什么错）——先冻结，再写实现 |
| **门禁 (gate)** | 必须通过的检查点（`G-A`…`G-E2`） |
| **证据 (evidence)** | 门禁通过的凭据，存 `reports/`。**没有归档证据 = 门禁没通过** |
| **守卫 (guard)** | `tools/` 下**只读**校验脚本，跑完给 EXIT 码。⚠️ 2026-10-13 起**只剩 2 个**（见 §5.2） |
| **主进程 / 渲染进程** | 主进程管窗口与磁盘；渲染进程就是那个网页界面。两者严格隔离 |
| **preload / 安全桥** | 界面唯一能用的通道（只暴露 `invoke` / `onEvent` / `platform`），别的够不着 |
| **IPC** | 主进程与渲染进程之间的受控通信（本项目 2 个通道、**16 个方法**白名单：引擎 **13** = search · item · **itemPaths** · thumbPath · reveal · collect · ingest · mutate · **transactions** · scan · indexStatus · indexStart · indexCancel · indexResume 里的 13 个，+ 库配置的 `libraryConfig`/`libraryPickDir`/`libraryAdd` 3 个）。⚠️ 清单以 `shared/ipc.ts` 为准 |
| **`thumb://`** | 缩略图自定义协议，形状**只允许** `thumb://<libId>/<uid>@<size>`——路径不由 URL 提供 |
| **配对 (pairing)** | 靠文件名主干相同，把 `ID-123.jpg` 与 `ID-123.rar` 认成一套素材；索引里**显式存了两个绝对路径** |
| **uid** | `sha1(lib_id\|rel_dir\|stem)[:12]`，12 位 hex，**已冻结** |
| **`compat`** | 兼容性判定键（8 项，不含 device/GPU）。只有 `compat` 相等的库才能合并检索 |
| **`band`** | 引擎按**同一模态内**区间给出的分数档（`high`/`mid`/`low`）。**界面不得自己算阈值，也不得跨模态比分数**。⚠️ 还可能是 `unknown`：模态不在引擎的 `BANDS` 里时引擎**拒绝定档**（2026-10-12 修 R-3），此时界面**只显示分数、不显示档位文案** |
| **`seq`** | 图像 soft token 预算（70/140/280）。是唯一的提速杠杆，**换档必须全量重建索引** |
| **设计令牌 (token)** | 颜色/字体/间距等视觉常量，唯一来源 `packages/design-tokens/tokens.css` |
| **ONNX / WebGPU** | 模型的通用交换格式 / 让浏览器直接用显卡算的技术；WebGPU 不可用时回落 CPU |
| **monorepo / workspaces** | 一个仓库多个包：`apps/*` + `packages/*`，用 npm workspaces 声明；**包之间用相对路径 import，不用包名解析** |

---

*本文件与磁盘不一致时，先修结构或代码，再回来改本文件——不要在两处各写一半。*

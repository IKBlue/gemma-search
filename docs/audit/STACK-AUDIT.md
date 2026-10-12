# STACK-AUDIT · ① 项目框架与技术栈对标审计

> **宪章条目 ①**：项目框架和技术栈检查（技术栈、项目框架、项目目录），对标行业最佳实践。
> **共同事实基准**：`docs/audit/00-current-state.md`（下称 **基线**）。
> **判据**：`docs/audit/01-acceptance-criteria.md`（下称 **判据**）§2 G1-G7 / §3 严重度 / §4 S1-S10。
> **原始证据**：`docs/audit/stack-evidence.md`（下称 **E 文件**，正文用 `E1.3` 形式引用）。
> 用中文。审查为**只读**：未改动任何源码、配置、他人文件（写入范围见 §13 自检 G1）。

---

## 1. 审查范围与基线

| 项 | 值 |
|---|---|
| 仓库 HEAD | `4555c1b`「chore!: 旧档 Python 层整体退役 —— 仓库从此零 Python」（2026-10-10 18:03:55 +0800） |
| 审查对象 | 工程化与依赖面：`package.json` · 三份 `tsconfig` · `electron.vite.config.mjs` · `electron-builder.yml` · `src/`（31 文件/1313 LOC）· `core/`（6/868）· `tests/`（4/777）· `tools/`（7/875）· `scripts/`（1/114）· `onnx-spike/` · `spike/` · `archive/` · `docs/spec` 与 `docs/design` 中的技术栈声称 |
| 进度前提（基线 §1） | 项目实际处于 **P3 的第 1/4 步**：界面只有 1 页（语义搜索）。**只对标已建成部分**；未建成部分只判「规格是否偏离最佳实践」，不假装已实现 |
| 本轮实跑 | `npm test`、`npx tsc --noEmit -p tsconfig.web.json`（以及 `--checkJs` 对照）、4 个只读守卫、`npm ls --depth=0`、grep 依赖实际使用、依赖体积/文件数、`git log` / `git status`、`web_fetch` 3 篇外部基准文档 |
| 版本口径 | 文中「实测」= 本轮本机跑出的输出（见 E 文件）；「引用」= 仓内既有文档/报告的数字，未由本轮复现 |

判据 §3 要求两条基线事实先钉死（两条都经本轮独立复核，见 E7.1）：

- `npm test` → **tests 68 · pass 65 · fail 0 · skipped 3**（与基线 §4 完全一致，无冲突）。
- 全仓 `.ts/.tsx` = **0**；Tailwind/Radix/zustand/react-virtual **已装未用**（与基线 §2 一致）。

---

## 2. 总体结论

**一句话**：这是一个**工程纪律明显高于其进度**的仓库 —— 引擎分层、产物形状守卫、IPC 契约与安全姿态都达到了同类桌面应用的上游水准，但**「规格承诺的技术栈」与「实际技术栈」是两套东西**，且**类型门禁是假绿的、测试只覆盖引擎一层、打包分发在结构上还没接通**。

| 维度 | 评级 | 依据（一句话） |
|---|---|---|
| 目录与分层 | **A-** | `core/` 零依赖且真的成立（E3）；但生产运行时反向依赖实验目录 `onnx-spike/`（E4） |
| 构建链 | **B+** | electron-vite 三端布局与 external 策略正确且有产物守卫（E4）；preload 的 external 配置是隐患、类型门禁假绿（P1） |
| 依赖治理 | **D** | 24 个生产依赖里 **18 个零 import** 且仍进安装包；`SPEC-security` 的供应链清单与实测不符（P5/P9） |
| 测试策略 | **C** | 引擎 68 测质量高，但 `tests/` 与 `src/` 零交集 → 主进程/preload/IPC 无一根自动化网（P4） |
| 分发就绪 | **F** | 打包态 `ROOT` 落在 asar 内、模型不可获取、`asarUnpack` 未定 —— 现在装到别的机器必然不可用（P6） |
| 文档一致性 | **D+** | 技术栈、依赖数、文件数、仓库布局四处声称与磁盘不符（P9-P14） |

**对标结论（判据 S1/S4）**：架构**骨架**方向正确（对标 immich 的 `server/` + `web/` + `machine-learning/` 拆分），但**栈**选型在本轮的实际实现里已经**用脚投票背离了规格**：不写 TS、不接 Tailwind、不接 Radix，而是手写 CSS + 10 个自研组件。这不是错误（见 §5 的判定），**错误在于规格文档没有跟着改**，导致 18 个依赖白装、类型门禁形同虚设、P3a 的工期预估建立在过期的前提上。

---

## 3. 依赖拓扑与分层评价（S1、S2）

### S1 · 分层是否达到同类项目水准？

**结论：分层方向正确，层级本身干净；但「哪一层依赖哪一层」被一条反向依赖破坏 —— 这使它在「分层」这一项上低于对标项目。**（本节结论属**行业做法对比 + 代码事实**）

**代码事实**（E3/E4）：

- `core/`（6 文件/868 LOC）只 import `node:fs` / `node:path` / `node:crypto` 与自身相对路径，**无任何裸包说明符**。
- `src/main/index.mjs:25` 反向 `import { createEngine } from '../../core/engine.mjs'`，编码器通过**端口注入**（`src/main/index.mjs:120-126`），`core/` 不知道 Electron 存在 —— 这正是「传输无关」的实现形态，质量高。
- `src/preload/index.js:10` 只 import `electron`；`src/shared/ipc.mjs:5` 只 import `zod` —— 共享契约层干净。

**行业做法对比（指名）**：

| 对标项目 | 其分层 | 本仓库对应物 | 差在哪 |
|---|---|---|---|
| **immich**（`docs.immich.app/developer/directories/`，本轮 web_fetch 核实）：monorepo = `server/` · `web/` · `machine-learning/` · `packages/{cli,sdk,scripts}` · `mobile/` | 推理（machine-learning）与业务（server）与前端（web）是**并列的包**，各自独立装依赖 | `core/`（引擎）· `src/main`（外壳）· `src/renderer`（界面） | 方向一致。差别：immich 用 **workspaces 把每个包变成有自己 `package.json` 的独立单元**；本仓库 `core/` 没有自己的 `package.json`（零依赖使其可行），而**该有自己的 `package.json` 的不是 core，而是 `onnx-spike/`** —— 它确实有一个（E2.2），这使得仓库事实上是**两个 npm 项目**，却没有 workspaces 统一管理 |
| **librephotos**（`apps/{backend,frontend}` + `packages/`，引自 `PROJECT-GUIDE.md:202`，属**文档声称**，本轮未独立核实） | 同样的 app/package 二分 | 同上 | 同上 |
| **VS Code / Obsidian 类 Electron 应用**（**行业做法**：`src/vs/...` 分层 + 每层独立 tsconfig，主进程与渲染进程各自编译目标） | 三层各自独立编译单元与类型边界 | 主进程/preload/core/**渲染层**共用 `src/` 一棵树，只有 3 个 tsconfig 做分区 | 类型边界靠 tsconfig 表达是对的（本仓库已这么做），但**没有 typecheck 门禁 → 边界只是注释**（见 P1） |

**关键缺陷（代码事实，本轮新增）**：

```
src/main/encoder.mjs:12  import { … } from '../../onnx-spike/resize_compat.mjs';
src/main/encoder.mjs:47  const { readBmpAsRawImage } = await import('../../onnx-spike/bmp_decode.mjs');
```

`onnx-spike/` 是 `PROJECT-GUIDE.md:72-74` 定义的**「离线实验室」**（"唯一能建索引的地方"，`PROJECT-GUIDE.md:100` 写「⚠️ 谨慎，动了要重建索引验证」），却同时是**生产主进程的运行时依赖**。滚 fallback 的结果是 `out/main/chunks/bmp_decode-*.js` 与 `encoder-*.js`（E4）—— 打包产物里确实带了 spike 的代码。

后果有两层：

1. **分层被反向依赖穿透**（`src/` → `onnx-spike/` → 又回 `@huggingface/transformers`），任何按文档语义清理 `onnx-spike/` 的人会打断主进程；
2. `onnx-spike/` 自带 `package.json` + `node_modules`（**34 包 / 3222 文件 / 473.2 MB**，E2.2），仓里因此存在**两份同版本 `@huggingface/transformers`**。仓内 `docs/DEBT-CLEANUP.md:86`（债务 #14）自认此危害并自认「**仍未根治**的是源文件位置（在 `onnx-spike/`）与不打包的校验路径」。

### S2 · `core/` 的零依赖是否「真的可执行验证」？

**结论：声明是真的（结构上成立），但「可执行验证」= 否。仓库有 7 个守卫，没有一个断言这件事；零依赖目前只靠纪律与 code review。**（**代码事实**）

- 声明为真：E3 列出 `core/` 全部顶层 import，仅 `node:*` + 内部相对路径。
- **无守卫**：`Select-String -Path tools\*.mjs -Pattern 'core'` 的全部命中都是「用 `core/engine.mjs` 反查项目根」或「import core 做功能校验」，**没有一条检查 import 说明符**（E3）。
- 因此 S2 的答案是：**验证方式存在但只有人工一种**。这与 `PROJECT-GUIDE.md:96`「`core\` … **零依赖**」的强硬措辞形成落差 —— 一个 10 行脚本就能变成门禁（见 P8 建议）。

### S3 前置：依赖拓扑图（实测）

```
root package.json (24 prod / 13 dev)
├── 真正被 import（共 6 个 = 4 静态 + 2 仅经 onnx-spike 动态 import）：
│      react, react-dom, zod, @huggingface/transformers, sharp*, bmp-js*
│                            （*sharp / bmp-js 只被 onnx-spike/* 动态 import，经 encoder.mjs 进主进程 bundle）
├── 零 import 但声明为生产依赖（18 = 24 − 6）：12×@radix-ui/react-* · zustand · @tanstack/react-virtual
│                                    · lucide-react · clsx · tailwind-merge · class-variance-authority
└── devDeps 中零使用（3）：tailwindcss · @tailwindcss/vite · vitest
onnx-spike/  ← 第二个 npm 项目，自带 node_modules(473 MB) 与 @huggingface/transformers 副本
node_modules 实测：21,472 文件 / 1089.9 MB / 334 顶层包（E2.1）
```

---

## 4. 构建链评价（S3）

**结论：三端构建的**形状**是对的，且有产物守卫兜底；但配置里有一处会在未来静默炸掉的隐患（preload 的 external），而「类型」这一环完全没接上。**（**代码事实 + 行业做法**）

**做对的三件事**（都有产物证据，E4）：

1. **external 策略**：`electron.vite.config.mjs:47,56` 对 main/preload 启用 `externalizeDepsPlugin()`，理由是原生模块（`onnxruntime-node` 的 `.node`、`sharp` 的 libvips）不能进 bundle。`verify_app_build.mjs` 逐项断言 `onnxruntime_binding` / `libvips` / `sharp-win32` / `sharp.node` **未被内联** → [OK]（E1.4）。这是 Electron 打包最常踩的坑，本项目有**可复跑的断言**，优于多数同类项目。
2. **preload 强制 CJS**：`electron.vite.config.mjs:58-61` 显式 `format:'cjs', entryFileNames:'[name].cjs'`，理由（`sandbox:true` 的渲染进程不加载 ESM preload）与官方说明一致（electron-vite 故障排除：「从 Electron 20 开始，预加载脚本默认沙盒化…需要将所有依赖全量打包到同一个预加载脚本中」，https://cn.electron-vite.org/guide/troubleshooting ）。产物 `out/preload/index.cjs` 被断言「用 `require("electron")`、无任何 ESM 语句」。
3. **dev 态 CSP 放宽只作用于 serve**：`electron.vite.config.mjs:32-43` 的 `devCspRelax()` 带 `apply:'serve'`，生产 CSP 一字不改；产物守卫再断言 CSP meta 在、无 `unsafe-eval`、脚本路径是相对路径。

**隐患一（Vite/electron-vite 配置）**：`preload` 也套了 `externalizeDepsPlugin()`。当前无害（`src/preload/index.js` 只 import `electron`），但**沙箱 preload 不能 require 外部模块**（同上官方文档）。一旦有人往 preload 加一个 `zod` 或 `clsx`，`external` 会让它在运行时 `require` 一个 asar 内的模块 → 报 `Unable to load preload scripts`。行业模板（electron-vite 官方 `create-electron` 模板）在 preload 上通常不排除依赖，正是这个原因。**建议**：删掉 `preload.plugins` 里的 `externalizeDepsPlugin()`（现在删零风险，因为唯一 import 是 `electron`，它是 Electron 注入的、本来就必须 external），或加一条断言「preload 源码的裸 import 只有 `electron`」。**验收**：`node tools/verify_app_build.mjs` 仍全过 + 新增断言；`git grep -n "^import" src/preload/` 只有 `electron`。

**隐患二（判据 S3 的「有无更优解」）**：`main` 产出 ESM（`"type":"module"`）+ `"main": "./out/main/index.js"` 自洽，Electron 44 支持 ESM，**不需要换 CJS**。若追求更保守的可分发性，替代方案是 electron-vite 的 `build.rollupOptions.output.format:'cjs'`，但那会牵动 `import`→`require` 全量改写，**收益（兼容旧 Electron）小于代价**，故**建议保持**。

**隐患三**：`type: module` + `composite: true` + `noEmit: true` 的三份 tsconfig **能编译但什么都没检查**（P1）。

---

## 5. 规格栈 vs 实际栈（S4）—— 本报告重点

### 5.1 事实面（先把两套栈摊开）

| 层 | 规格承诺（`文档声称`） | 实际（`代码事实`） | 判定 |
|---|---|---|---|
| 语言 | `TASK-PLAN.md:23`「Electron + **TypeScript** + React + Tailwind + shadcn/ui」；`SPEC-app.md:63,184` 语言=TypeScript，主进程/渲染进程都 TS | 全仓 **0 个 `.ts/.tsx`**；31 个 `.js/.jsx/.mjs`；主进程 `.mjs` | ❌ 未实现 |
| UI 框架 | React 19 | ✅ React 19.3（`main.jsx:9-11`，产物挂载证据 `[ui] React 已挂载 · react 19.3.0`） | ✅ 一致 |
| 组件库 | `SPEC-app.md:65`「**shadcn/ui + Radix UI**」，理由写明「Radix 提供 AlertDialog/Dialog/Popover/Toast，正是文件操作确认弹窗所需」 | 自研 `src/renderer/src/ui/` 10 个普通函数组件 + `cx()`（`cx.js:1` 注释「不值得为此引 clsx」）；**12 个 Radix 包 0 import**（E2） | ❌ 未实现 |
| 样式 | `SPEC-app.md:66`「**Tailwind CSS**」；`DESIGN-tokens.md:234`「§11 映射到 Tailwind + shadcn/ui」 | 手写 `renderer.css`（只消费 `var(--*)`，有守卫 `verify_renderer_styles.mjs` 全过）；Tailwind 插件**未装**（`electron.vite.config.mjs:69` 只有 `[react(), devCspRelax()]`） | ❌ 未实现，且**已装未用** |
| 图标 | `SPEC-app.md:67`「**Lucide**（本地包，离线）」 | `lucide-react` 0 import；原型里的 Unicode 字符仍在用 | ❌ 未实现 |
| 状态 | `SPEC-app.md:70`「**zustand**」 | 0 import；界面状态住在 `hooks/useSearch.js`（useState） | ❌ 未实现 |
| 长列表 | `SPEC-app.md:71`「**@tanstack/react-virtual**（仅浏览整库）」 | 0 import；浏览整库那页还没写（P3 只完成 1/4） | ⏸ 未到需要它的阶段 |
| 契约校验 | `SPEC-app.md:69`「zod + 共享类型，一套定义同时导出 TS 类型」 | zod **真的在用**（`src/shared/ipc.mjs:5`，`.strict()` 逐方法校验），但**导出的不是 TS 类型**（没有 TS） | ⚠️ 一半 |
| 单测 | `SPEC-app.md:72`「**vitest**」 | `node:test`（`package.json:19`）；vitest 装了 0 使用；`SPEC-security.md:206-215` 已如实登记此处偏离并建议「core 继续 node:test / app 用 vitest」 | ⚠️ 已登记偏离 |

### 5.2 两套栈分别评判

**（A）规格承诺的那套（TS + Tailwind + shadcn/ui + zustand + Radix）是不是最佳实践？**

**结论：对「一个 Windows 单人自用、离线、视觉规范自成体系（`DESIGN-tokens.md` 是唯一权威）」的 Electron 桌面工具，这套栈是主流但**并非最优**；其中 Tailwind 与 shadcn/ui 与本项目已建成的令牌体系存在真实冲突，而 zustand/Radix 的价值取决于「多页 + 弹窗 + 长列表」何时到来。**（**行业做法 + 代码事实**）

- **TS**：✅ 该上。理由不是「主流如此」，而是本项目的**核心资产是契约**：`src/shared/ipc.mjs` 的 11 个方法与 19 个错误码（`SPEC-app.md`）目前**只有运行时校验，没有编译期类型**。`SPEC-app.md:69` 自己写的是「一份 schema 同时导出运行时校验与 TS 类型」—— zod 的 `z.infer` 本来就是为此设计的，**当前只用了一半能力**。同类的 Electron 桌面应用（如 **jan**（44.9k★，引自 `PROJECT-GUIDE.md:197`，属文档声称））用 TS 正是为了 IPC 边界的类型安全。
- **Radix**：✅ 若真要做「不可逆操作的最后一道确认」（`SPEC-security.md:180`：AlertDialog 用于文件操作确认），Radix 的焦点陷阱/`aria-*` 是**买得到的正确性**，自研 `Dialog` 是最容易出 a11y bug 的地方。当前 0 import 意味着**这条安全/无障碍需求目前完全没有实现手段**（不是「用别的方式实现了」）。
- **zustand**：⚠️ 中性。当前 1 页界面用 `useState` 足够；等 P3c「图片详情 + 任务状态 + 事件流」落地时再评估不迟。**现在就装是纯负担**。
- **Tailwind**：❌ **不建议上**。两条硬理由（+一条已更正为中立事实）：① `DESIGN-tokens.md` 要求「视觉值一律取自令牌、组件里不写十六进制」（`TASK-PLAN.md:212` 原文），而 `renderer.css` 已达成「0 颜色字面量 + 67 个 `var(--*)` 全部有定义」（`verify_renderer_styles.mjs` 实测，E1.4）—— 引入 Tailwind 会把视觉决策从**一个可 grep 的 CSS 文件**打散到 22 个 JSX 的 class 串里，现有守卫 `verify_renderer_styles.mjs` 的「无内联视觉值」断言将无法覆盖；② 现有样式量小且高度定制：源文件 `src/renderer/src/renderer.css` **14,050 B**（构建产物 `out/renderer/assets/index-BCVIX9rf.css` 24,916 B，E4），换来的是「深色侧栏 + 浅色工作区」这种**少量且高度定制**的视觉，Tailwind 的效用函数式复用收益极低；③ **CSP 不构成理由（本轮更正）**：本项目生产 CSP **本来就含** `style-src 'self' 'unsafe-inline'`（`src/renderer/index.html:9`；`:7` 注释自述这是 **Vite 注入样式**所需、与 Tailwind 无关），而 `SPEC-security.md:310-311` 位于 §10.4「如果你仍要更严」，是**可选的收窄建议**（`:314` 自述「这不提升安全性」，`:266` 的最终推荐是**保留** `'unsafe-inline'`）——因此 Tailwind **不新增**任何让步，但也**不解决**已存在的放宽；是否收窄是独立议题（见 `SPEC-security.md` §10.4），不构成对 Tailwind 的否决理由。
- **shadcn/ui**：❌ 与 Tailwind 绑死（它就是 Tailwind 组件源码），同上否决；若只要 Radix 的无障碍原语，**直接引 `@radix-ui/react-*` 即可**，不必经过 shadcn。

**（B）实际那套（普通 JS/JSX + 手写 CSS + 自研 ui/）代价多大？**

- **手写 CSS + 自研 ui/**：✅ **保持**。`ui/` 10 个组件共约 300 行级（`src/renderer/src/ui` 10 文件），且被 `verify_renderer_styles.mjs`（令牌纪律）与 `verify_renderer_dom.mjs`（jsdom 真跑）双守卫覆盖；这是一套**自有、可改、无上游破坏性升级**的组件层，符合 `DESIGN-tokens.md` 的令牌体系。以本项目规模（目标 6 页），自研成本 < 接入 Tailwind 后重写全部视觉决策的成本。
- **普通 JS（不转 TS）**：❌ **建议迁移，但分两步、只在有类型收益处做**。代价本轮有硬数据：

| 指标 | 实测（E1.3） |
|---|---|
| 现在 `npx tsc --noEmit -p tsconfig.web.json` 的结果 | **EXIT=0、0 报错**（假绿，见 P1） |
| 强制 `--checkJs` 后渲染层真实错误 | **126 条**（TS7031×64、TS7006×20、TS2339×17、TS2741×13、TS2322×6…） |
| 强制 `--checkJs` 后 node 侧（main/preload/shared/core）真实错误 | **230 条**（含 `onnx-spike/` 42 条） |
| 第一方错误合计 | **314 条** |
| `noImplicitAny` 家族（7006/7031/7005/7019/7053） | web 86 + node 111 = **197 条**（web 侧：7031×64 + 7006×20 + 7019×1 + 7053×1） |
| `tsc` 单次耗时（node 项目） | **6851 ms** |
| 待转文件 | `src/` 31 个（1313 LOC）+ `core/` 6 个（868 LOC）= **37 文件 / 2181 LOC** |
| `package.json:59` 声称的「222 条 noImplicitAny（实测）」 | **无法复现**（node 侧 111，两侧合计 197） |

**迁移建议（可执行、分步）**：

1. **先修假绿门禁**（P1），零迁移成本：把 `package.json` 的 `typecheck` 加回来（`tsc -b` 或两条 `tsc --noEmit -p`），**并在迁移完成前把 `checkJs` 打开、把当前 230 条错误列入白名单/`// @ts-expect-error` 记账**（不要用 `any` 涂绿 —— 这是仓内 `package.json:58-60` 自己反对的做法）。
2. **第一步只转契约边界**（收益最高、改动最小）：`src/shared/ipc.mjs` → `ipc.ts`，导出 `type Call = z.infer<...>`；`src/preload/index.js` → `index.ts`（3 个成员，5 条错误）；主进程 `index.mjs` 的 `ipcMain.handle` 回调加类型。**验收**：`npx tsc --noEmit -p tsconfig.node.json` 在**只开这三处**的范围内 0 错误；渲染层仍走 JS（`checkJs:false` 但 `allowJs`），门禁按 tsconfig 分区逐步收紧。
3. **第二步渲染层**：126 条错误里 **99 条集中在 7 个文件**（SearchPanel 18 / SearchPage 13 / useSearch 13 / MetricsRow 9 / useEngine 9 / Sidebar 8 / Gallery 7，E1.3），先给 `hooks/useEngine.js`、`hooks/useSearch.js` 定义 `EngineResult<T>` 与事件类型，预计能消掉其中一半。
4. **`onnx-spike/` 不纳入类型门禁**（42 条错误）—— 它该做的是**搬到 `src/main/` 并纳入门禁**（P8）。
5. **不建议**一次把 37 个文件都改成 `.ts`：那是 314 条错误的攻坚，在 P3 只完成 1/4 页面的当下，性价比低于先把「已建成的 1/4」的类型边界锁住。

---

## 6. 依赖选型逐个判决（S5）

判据原文点名 7 个（zod / sharp / @huggingface/transformers / bmp-js / zustand / @tanstack/react-virtual / Radix）。逐个判决如下（**代码事实**：`import` 命中见 E2；体积见 E2.1）：

| # | 依赖 | 判决 | 依据 | 处置建议 |
|---|---|---|---|---|
| 1 | `zod` 4.6 | ✅ **保留** | `src/shared/ipc.mjs:5` 真实使用；`.strict()` 逐方法校验 + 1 MiB 载荷上限（`ipc.mjs:76-96`），是「IPC 参数白名单」的唯一落点 | 保留；转 TS 后加 `z.infer` 导出类型（§5.2-A） |
| 2 | `@huggingface/transformers` 4.3.1 | ✅ **保留** | `src/main/encoder.mjs:11`；`meta.json` 记录同版本进索引 compat | 保留；注意仓内有**两份**副本（P8） |
| 3 | `sharp` 0.35.5 | ✅ **保留（但文档要改）** | 动态 import 于 `onnx-spike/resize_compat.mjs:35`，被生产编码路径经 `src/main/encoder.mjs:12` 引入；`package.json:55-56` 明确解释「本是传递依赖，靠传递依赖迟早会断」 | 保留；**修正 `SPEC-security.md:192`「刻意不引入 sharp」的矛盾**（P9） |
| 4 | `bmp-js` 0.1.0 | ✅ **保留** | `onnx-spike/bmp_decode.mjs:55`；`meta.json` 的 `bmpFallbackUsed: 20` 证明这件 fallback 真实被用到（库里 20 张 `.jpg` 实为 BMP）；自带布局自检（`bmp_decode.mjs:128`） | 保留 |
| 5 | `zustand` 5.0 | ❌ **现在删**（或降级为「P3c 再装」） | 全仓 0 import（E2） | 从 `dependencies` 移除；`SPEC-app.md:70` 的承诺改成「P3c 评估」 |
| 6 | `@tanstack/react-virtual` | ⚠️ **保留判断但移出生产依赖** | 0 import；它服务的「浏览整库 3594 条」页尚未实现（P3 1/4） | 移出 `dependencies`，等该页真开写时再装（或先用 3594 个节点实测性能再决定） |
| 7 | 12 × `@radix-ui/react-*` | ❌ **现在删 12 个**；`AlertDialog` 的需求**保留为决策**，等 P3b/P3c 再按需装 | 0 import（E2）；其中只有 `AlertDialog`/`Dialog`/`Popover`/`Toast` 有明确需求场景（`SPEC-security.md:180`），`Checkbox/Switch/Tabs/Select/Tooltip/DropdownMenu/Slot/Label` 8 个在已完成页面里**没有落点** | 移除全部 **12** 个（`package.json:26-37` 实测 12 个）→ 等 P3b/P3c 真写确认弹窗时**只装 `@radix-ui/react-alert-dialog`（及必要传递）**，并**同时**把「用 Radix 管理焦点 / 不用 dangerouslySetInnerHTML」写进 UI 验收 |
| 8 | `lucide-react` 1.55 | ❌ **现在删** | 0 import；**34.1 MB / 4328 文件**，是全部无用依赖里最贵的一个（E2.1）；当前界面用的是 Unicode 字符（`Sidebar.jsx` 渲染结果 `⌕语义搜索▣图片详情` 可见，E1.4） | 移除；若真要图标，改用**按需 import 单个 SVG**（`lucide-react/icons/*`）或直接内联 SVG |
| 9 | `clsx` + `tailwind-merge` + `class-variance-authority` | ❌ **现在删** | 0 import；`src/renderer/src/ui/cx.js:1` 自述「不值得为此引 clsx」—— 项目已经**明确选择**了不用它们；tailwind-merge/cva 是 Tailwind/shadcn 的配套（Tailwind 不上，它们就没有意义） | 移除三者 |
| 10 | `tailwindcss` + `@tailwindcss/vite`（devDeps） | ❌ **现在删** | 0 使用（E2）；插件未进 `renderer.plugins` | 若采纳 §5.2「保持手写 CSS」，一并删除；若要保留 Tailwind 路线，则**必须先改 `electron.vite.config.mjs:69` 并给出令牌映射的落地页**，不能停在「装了不用」 |
| 11 | `vitest`（devDeps） | ⚠️ **删除或接线，二选一** | 0 使用（E2）；`SPEC-security.md:212-215` 已给出「core 用 node:test / app 用 vitest」的建议，但 app 侧一行 vitest 代码都没有 | 现在删；等 app 侧真要写组件测试时再装 |
| 12 | `jsdom`（devDeps） | ✅ **保留** | `tools/verify_renderer_dom.mjs:19` 真实使用 | 保留 |
| 13 | `@emnapi/runtime` / `@img/sharp-wasm32` | ⚠️ `extraneous` | `npm ls --depth=0` 报 `extraneous`（E2）：存在于 `node_modules` 但不在依赖树里 | 与 sharp 的平台可选依赖有关；`npm ci` 后应消失。**验收**：干净克隆 + `npm ci` 后 `npm ls --depth=0` 不再有 `extraneous` 行 |

**总量结论**：删掉 #5、#6（暂）、#7-#11 后，生产依赖从 **24 → 6**（保留 `@huggingface/transformers`、`sharp`、`bmp-js`、`zod`、`react`、`react-dom`；24 − 18 = 6 与 §E2 的逐个判决一致），`node_modules` 生产侧可减 **~38 MB / ~4,838 文件**（E2.1），安装包与供应链面同步缩小。**验收**：`npm ls --depth=0` 无 `extraneous`；`node tools/verify_app_build.mjs`、`node tools/verify_renderer_dom.mjs`、`node tools/verify_renderer_styles.mjs`、`npm test` 四者仍全过。

---

## 7. 测试策略缺口（S6）

**结论：测的深度好、测的**广度**缺一块最关键的 —— 68 条测试全部落在 `core/`，`src/` 三层的自动化覆盖是 0。**（**代码事实 + 行业做法**）

**覆盖了什么**（代码事实，E1.1）：

| 区域 | 条数 | 质量评价 |
|---|---|---|
| `tests/engine.test.mjs` | 27 | 高：信封不抛异常、band 随模态、多库 compat 跳过、filters、以图搜图路径解析、编码器忘归一化时引擎自归一 |
| `tests/index.test.mjs` | 18 | 高：MAGIC/截断/footer.complete/sha1 逐项损坏都拒绝，`INDEX_MISSING` 与 `INDEX_CORRUPT` 分开 |
| `tests/security.test.mjs` | 16 | 高：绝对路径/`..`/前缀兄弟目录/目录联接/取件白名单整段匹配 |
| `tests/uid.test.mjs` | 7 | 中：含黄金向量 |
| 合计 | **68（65 过 / 0 失败 / 3 跳过）** | |

**漏了什么**（每条都实测过证据）：

| 未覆盖对象 | 证据 | 风险 |
|---|---|---|
| `src/main/index.mjs`（405 行：窗口姿态、IPC 分发、`isTrustedSender`、`thumb://` 协议、`resolveModelDir`、`loadConfig`） | `Select-String -Path tests\*.mjs -Pattern "src/"` → **0 命中**（E1.1） | 环境与安全相关分支改坏无人知 |
| `src/preload/index.js`（暴露面 = 3 成员，不能暴露 `ipcRenderer`） | 同上 | 一旦有人多暴露一个成员，测试不报 |
| `src/shared/ipc.mjs`（11 方法 zod 白名单 + 1 MiB 上限 + 未登记方法拒绝） | 同上 | **`SPEC-security.md` 声称的「IPC 参数白名单」这门安全边界，没有任何单测** |
| `thumb://` 形状校验与 libId 大小写还原 | 同上 | `src/main/index.mjs:238-250` 的脆弱点（URL host 小写）只有注释，无断言 |
| 真实 IPC（渲染 ↔ preload ↔ 主进程） | `tools/verify_renderer_dom.mjs:12-13` 自述「**不能**证明：…真实 IPC、真实窗口」 | 渲染层守卫用**桩 IPC**（输出显示 `indexStatus → L1 3594/3594` 是桩喂的真实引擎） |
| Electron 出窗 / 打包后行为 | `README.md:179` 自述未验证；`npm run smoke`（`tools/smoke_app.mjs`）需要真实 GUI 会话，本轮**未跑**（E10） | 「能不能出窗」不在任何自动化里 |

**行业做法对比（指名）**：

- **VS Code**（Electron，`@vscode/test-electron`）：把「不需要 Electron 的纯逻辑单测」与「需要真实 Electron 的集成测试」**分成两条流水线**；渲染层再用浏览器自动化。
- **Playwright 的 Electron 支持**（`_electron.launch({ args: ['out/main/index.js'] })`）：这是目前 Electron E2E 的事实标准（Spectron 已废弃），能真的点按钮、断言窗口与 IPC。
- **immich**：`server/`（Jest 集成测试 + 真实 DB）、`web/`（Vitest 组件测试）、`machine-learning/`（pytest）**每包各自有测试入口**（`docs.immich.app/developer/testing`，本轮未点开该页，此处按目录结构推论 → 标 **【判断，非实测】**）。

**缺口的最小补法（可执行）**：

1. **`src/shared/ipc.mjs` 立刻补测**（最高性价比，纯函数、无依赖）：`validateCall('search', {mode:'text',text:'x',evil:1})` 必须 `ok:false`；11 个方法逐个「合法通过 / 多一个字段被 `.strict()` 拒」；载荷 > 1 MiB 被拒。**验收**：新增 `tests/ipc.test.mjs`，`npm test` 条数从 68 → ≥90 且全过。**注意**：`tests/*.test.mjs` 是 `node:test`，`ipc.mjs` import 了 `zod`，因此这条测试**打破「tests 只依赖 node 内置」的现状** —— 这是可接受的（zod 已是生产依赖），但要在 `package.json` 注释里如实登记。
2. **`tools/verify_app_build.mjs` 增加「preload 暴露面」断言**：读 `out/preload/index.cjs`，断言 `contextBridge.exposeInMainWorld` 的键集合 = `{invoke,onEvent,platform}`、且文件里不出现 `require("ipcRenderer")` 之外的直接导出（现有断言已查「没有把 ipcRenderer 本体暴露出去」，建议升级为**键集合白名单**）。
3. **引入 Playwright Electron E2E 作为 L4**（1 条用例即可）：启动 `out/main/index.js`，断言窗口标题、`indexStatus` 被调用、CSP 生效。**验收**：`npx playwright test e2e/app.spec.mjs` 在无头环境通过。这条同时能替掉 `README.md:179` 的「未验证」声明。

---

## 8. 打包与分发（S7）

**结论：`electron-builder.yml` 的形状正确，但「分发到别的机器」在当前代码结构下**不可能成立** —— 不是配置没写全，而是**运行时的根目录/模型/索引三条路径都指向开发机**。结论为**代码事实 + 静态推断**（本轮未跑 electron-builder，见 E10）。**

**事实链（每条都有代码位置）**：

1. `src/main/log.mjs:25` `ROOT = path.resolve(HERE,'..','..')`；打包后 `HERE` 在 `app.asar` 内 → `ROOT` = `app.asar` 内的路径；**同一文件 `:52-53` 自己打印警告**「应用根落在 asar 内，`data/` 无法写入 —— 打包态需要改用 userData（P6）」。
2. 于是打包态下：日志写不进（`:38` 的 `catch` 吞掉）、`loadConfig()` 读 `app.asar/config.json`（不存在，E5）→ `LIB_ROOT=''` → `index.mjs:117` `libraries = []` → 引擎一个库都没有；`THUMB_DIR = app.asar/data/thumbs`（`index.mjs:217`）→ `mkdirSync` 必失败（`:281` 吞掉）。
3. 模型：`src/main/index.mjs:96-97` 找 `<ROOT>/../model-cache/onnx/embeddinggemma-2/<rev>/fp32`（打包态 = `resources/model-cache`，**`resources/` 实测为空**，E5）；`src/main/encoder.mjs:62-63` 又设了 `allowRemoteModels = false` → **首次获取模型的通路不存在**。
4. 安装器排除规则：`electron-builder.yml:16` `'!onnx-spike/*'`，而主进程 bundle 里已经内联了 spike 的代码（E4）→ 形状上能自洽；但 `:21-22` `asarUnpack` **只有 `resources/**`**，`:5-6` 自认「`onnxruntime-node` / `sharp` 的原生 `.node` 在 asar 里加载不了，P6 必须按实测把它们加进 asarUnpack」。
5. `npmRebuild: false`（`:41`）—— 对「预编译二进制随包分发」是合理选择，但前提是 `asarUnpack` 正确；否则 `.node` 在 asar 内无法加载。

**与规格的冲突（`文档声称` vs `代码事实`）**：`SPEC-app.md:99-101` 写「应用 = Electron(~200 MB) + 模型(q4f16/fp16/fp32) + 索引(11 MB)…**模型与索引不进安装器**：安装器只装应用，模型首次获取，索引随库生成」。这句话有两个未落地的支点：①「模型首次获取」没有实现（`allowRemoteModels=false` 且无 UI 入口）；②「索引随库生成」需要 `ingest`/`indexStart`，而它们被主进程显式拒绝（`index.mjs:191-195`，基线 D5/P15）。

**行业做法对比（指名，用于给「合规处置」一个参照）**：

- **electron-builder 官方语义**（https://mintlify.wiki/electron-userland/electron-builder/concepts/application-contents ，本轮 web_fetch）：默认打包 app 代码 + `node_modules` 生产依赖；**原生 `.node` 必须 `asarUnpack`**；**大体积外部资源应走 `extraResources`**（而不是塞进 asar）。本项目的模型（1.63 GB）与索引（11 MB）正属于 `extraResources` 的典型对象，但当前配置里**没有 `extraResources` 段**。
- **immich**：模型由 `machine-learning` 容器**按需下载到可配置的 cache 目录**（`docs.immich.app` 的 model-cache 讨论；`PROJECT-GUIDE.md:203` 也如实记录了「immich/photoprism 都让用户自己下载，离线保证被削弱」作为本项目的差异化理由）。**本项目把这条差异化写成了规格，却没有实现下载器** —— 这是「相对优势目前只是文档」。
- **NSIS 2 GB 上限**（`SPEC-app.md:100` 自述）确实是 fp32 模型不能进安装器的正当理由；因此正确解法不是「把模型塞进包」，而是**补齐首启获取路径**（见下）。

**建议（可执行）**：

1. **P6 之前先修路径**：把 `log.mjs:25` 的 `ROOT` 改为「打包态用 `app.getPath('userData')`，dev/预览态保持 `ROOT`」，并把 `DATA_DIR`/`THUMB_DIR`/日志文件全部改挂到 userData。**验收**：新增用例或用 `ELECTRON_RUN_AS_NODE=0` 打包态运行，断言 `data/_app.log` 落在 `%APPDATA%/gemma-search/` 下。
2. **模型获取做成显式动作**：新增一个 `model:ensure` 的 IPC 方法（或首启向导），在用户确认后临时打开 `allowRemoteModels`，把模型落到 `userData/model-cache/<rev>/fp32`；`resolveModelDir()` 优先查该目录。**验收**：在一台没有 `D:\USERS\Desktop\Agent\model-cache` 的机器上（或把该目录改名后）启动打包产物，能走到「下载模型」而不是 `MODEL_MISSING`。
3. **`electron-builder.yml` 补两处**：`asarUnpack` 加 `**/node_modules/{onnxruntime-node,sharp,@img}/**`（按实测，不照抄）；把模型/索引约定为 `extraResources`（或明确写「由首启下载到 userData」）。**验收**：`npx electron-builder --dir` 后解包 `.asar`，`node -e "require('sharp')"`、`require('onnxruntime-node')` 在 `app.asar.unpacked` 下可加载。
4. **别急着改 `npmRebuild`**：当前 false 是对的；只有当你决定在构建机重编原生模块时才需要 true。

---

## 9. 索引格式与检索算法（S8）

**结论：3594×768 用「自研单文件 + 暴力余弦」是**正确**的工程选择，且实现质量高于多数同类项目（逐项校验、绝不返回半可信数据）；换向量库的拐点远未到来。**（**代码事实 + 算术**；「拐点」部分为**判断，非实测**）

**规模算术（可复算）**：

| 量 | 值 | 算法 |
|---|---|---|
| 向量数 × 维度 | 3594 × 768 | `meta.json` |
| `index.bin` 期望大小 | 11,040,768 B + 头尾 | `3594 × 768 × 4`（float32） |
| 实测大小 | **11,042,105 B** | `data/libraries/L1/index.bin`（E5） |
| 单次查询乘加 | **2,760,192 次**（≈5.5 MFLOP） | `core/engine.mjs:208-209` 的二重循环 |
| 索引常驻内存 | **11.0 MB** | 全量 `readFileSync`（`core/index.mjs:30`） |
| 仓内既有实测延迟 | **7 ms 返回 5 条** | `docs/DEBT-CLEANUP.md:378`（引用）；本轮桩 IPC 记 42ms 含 UI（E6） |

**格式评价（代码事实）**：`core/index.mjs:3-8` 的自描述布局（MAGIC 8 B + headerLen + headerJSON + float32 块 + footerLen + footerJSON{count,dim,sha1,complete}）在**可诊断性**上优于「裸 `.npy` + 旁挂 JSON」：

- 8 字节 MAGIC（`index.mjs:16`），并在注释里记录了历史事故「旧实现因 MAGIC 长度 7 vs 8 而静默失效」（`:11`）；
- `footer.complete !== true` → 视为写入未完成（`:68`），这是**崩溃中断可检测**的正解；
- 向量块 sha1 逐字节校验（`:72-75`），`load()` 懒加载 + 缓存（`engine.mjs:102-122`）→ 校验成本只在每个库首次搜索时付一次；
- 缺点（**判断，非实测**）：格式**只认 float32**（`blockBytes = count*dim*4` 写死在 `:53`），没有 dtype/量化/压缩字段，也没有分块与 mmap。当维度或精度档变化（`SPEC-app.md:54` 提到 fp16/q4f16 档位）时**必须换格式版本**（`meta.json` 里已有 `format_version: 1` 可承载，但目前没有 v2 的读路径）。

**算法评价**：`scored.sort` 是 O(n log n) 全排序而非 top-K 堆（`engine.mjs:213`），在 n=3594 时无所谓；精确暴力（等价 FAISS `IndexFlatIP`）在「单用户、本机、3594 条」下**比任何近似索引都更准且更快**（免建索引、免调参、免召回率折损）。`docs/immich` 等同类项目上向量库（chroma / qdrant / VectorChord；`PROJECT-GUIDE.md:204` 列举）是因为它们要服务**多用户 + 持续写入 + 百万级**，与本项目场景不同。

**何时需要换？（算术 + 判断，非实测）**

| 规模 | 暴力余弦粗略代价（单核，按 7 ms @ 3594 线性外推） | 结论 |
|---|---|---|
| 3.6k（现在） | ~7 ms | 保持 |
| 10^5 | ~0.2 s/查询 + 307 MB 内存 | 仍可保持，但开始需要「查询并发/缓存」 |
| 10^6 | ~2 s/查询 + 3.07 GB 内存（float32 全量 `readFileSync` 会直接失败） | **必须换**：量化（int8/pq）或 hnswlib/FAISS `IndexHNSWFlat`，或 sqlite-vec |
| 10^7 | 不可行 | 必须 ANN + 分片 |

**建议（可执行）**：

1. **不改算法**。把 §9 的规模算术写进 `docs/spec/SPEC-identity.md`（现在该文只描述字段，没有「何时该换」的判据），并在 `core/index.mjs` 的头部注释里补上「格式只支持 float32；引入 fp16 档位前必须先升 `format_version` 并写 v2 读路径」。
2. **在 `readIndexBin` 加一条守护**：读入前先 `fs.statSync(file).size` 与 `12 + 4 + blockBytes + 4` 做下界比较，避免对超大文件先 `readFileSync` 再报错（当前 `:30` 先全量读入）。**验收**：构造一个 1 GB 的假 `index.bin`（MAGIC 正确、header 说 dim=768/count=10^8），断言报错路径不 OOM。**这一条属「防御性改进」，不是当前缺陷。**
3. **多库合并排序**（`engine.mjs:213`）在库数 > 8 且每库 > 10^5 时再考虑「每库 top-K 归并」；当前 1 库，不需动。

---

## 10. 门禁覆盖盲区（S9）

判据要求「列清单」。以下每条都有证据（E1.5/E8），**按「有没有自动化」排序**：

| # | 盲区 | 证据 | 一旦出事的表现 |
|---|---|---|---|
| 1 | **没有 CI**（无 `.github/`） | `Test-Path .github` → False | 7 个守卫全靠人肉记得跑 |
| 2 | **`npm test` 只跑 `tests/`** | `package.json:19` | 6 个只读守卫（含**当前正在失败**的 `verify-doc-refs.mjs`）永远不会被自动触发 |
| 3 | **类型门禁不存在且假绿** | 无 `typecheck` 脚本；`npx tsc --noEmit -p tsconfig.web.json` → EXIT=0 / 0 错误（E1.2） | 「我跑了 tsc，是绿的」= 假安全感（P1） |
| 4 | **无提交钩子 / 无 lint / 无格式化** | package.json 匹配 `husky|lint-staged|eslint|prettier` → 0 命中 | 风格与死代码靠 review |
| 5 | **`core/` 零依赖无守卫** | E3：7 个守卫无一检查 import 说明符 | 有人 `import fs-extra`，无人拦 |
| 6 | **主进程/preload/IPC 无测试** | E1.1：`tests/` 对 `src/` 引用 = 0 | 安全姿态（`sandbox`、暴露面、白名单）回归无网（P4） |
| 7 | **无打包产物验证** | 无脚本引用 `asarUnpack`/`dist/`；`verify_app_build.mjs` 只查 `out/` 形状（自述「只证明产物形状正确」） | 「本机能跑、换机器白屏」 |
| 8 | **无依赖安全审计** | 无 `npm audit`（只读）接线；`SPEC-security.md:195` 拒绝的是 `audit fix --force`，不是「审计」 | 供应链 CVE 无人看 |
| 9 | **CSP 只有存在性断言** | `verify_app_build.mjs` 断言「CSP meta 还在 / 无 unsafe-eval」 | 有人加 `unsafe-inline` 到 `script-src`，断言仍过 |
| 10 | **文档引用解算的计数是动态量、且仍是门禁** | `verify-doc-refs.mjs` 的「扫描引用 / 死引用 / 根目录越界」三个数**随审查产物增加而增长**：本轮早期快照 50/0/1（E1.4）→ 基线 §6.1 102/7/3 → 复核者 106/10/3 → Lead 复跑 109/7/4。**计数变化本身不是缺陷**；缺陷是它不在自动化里（见 #1/#2） | 未解算的引用（如代码注释里的路径）漂移无人知；且越界的正是审查交付物自身（`STACK-AUDIT.md` / `UIUX-AUDIT.md` / `AGENTS.md`），交付前必须处置否则 EXIT=1 |
| 11 | **无 i18n / 编码守卫** | 无相关脚本 | 中文注释/文案在 GBK 控制台下乱码（E0 已实测一次误判风险） |

---

## 11. 问题清单（S10）

**评分口径（本报告统一，先声明再打分）**（判据 §3：`Score = 影响面(1-3) × 触发可能性(1-3)`）：

- **影响面**：`3` = 用户可见功能受损 / 安全或数据边界；`2` = 工程与交付面（构建、测试、依赖、分发、治理）；`1` = 文档措辞。
- **触发可能性**：`3` = 现在就成立 / 必然发生；`2` = 在特定动作下发生（打包、改 `onnx-spike/`、加页面、装机器）；`1` = 偶发。
- 等级映射严格按判据 §3 表：9=Critical / 6=High / 4=Medium / 1-3=Low。

| ID | 严重度 | 一句话 | 证据 | 影响（用户/工程） | 建议（改哪个文件 + 怎么验） | 覆盖 |
|---|---|---|---|---|---|---|
| **P1** | **6 · High**（2×3） | **类型门禁是假绿的**：任务书要求的 `npx tsc --noEmit -p tsconfig.web.json` 返回 **EXIT=0 / 0 错误**，因为 `checkJs:false` 且 `include` 里只有 `.js/.jsx`；真开 `--checkJs` 后是 126（渲染层）+230（node 侧）条错误 | `tsconfig.web.json:10-11,20`；E1.2（EXIT=0，输出只有 npm notice）；E1.3（126/230）；`package.json:58-60` 自述「刻意没有 typecheck 脚本」；全仓 0 个 `.ts/.tsx` | 工程：「跑过类型检查」这个结论永远不能被相信；契约层（`ipc.mjs` 11 方法）没有编译期类型 | `package.json` 加 `"typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"`；**同时**把 `checkJs` 打开并在迁移期把 314 条错误逐文件记账（`// @ts-expect-error` 带原因），**不要撒 `any`**。验：`npm run typecheck` 退出码非 0 且错误条数与 E1.3 一致（证明门禁真的在看代码） | 新 |
| **P2** | **9 · Critical**（3×3） | **`reveal` 静默假成功**：主进程从未注入 `shell`，引擎却无条件 `return ok({revealed:true})`，界面因此**必弹「已在资源管理器中定位」而资源管理器不打开** | `core/engine.mjs:434-435`；`src/main/index.mjs:120-126`（只传 `config/encoder/onEvent`）；全仓 `\bshell\b` 在 `src/main/` **0 命中**；用户可见链 `src/renderer/src/hooks/useSearch.js:80` `onToast(r.ok ? '已在资源管理器中定位' : …)`；`tests/engine.test.mjs:314-317` 只测注入 shell 的正例 | 用户：点「定位」得到**成功提示且无事发生**（判据 §3 的「功能静默失败且用户无感」= Critical 定义）；工程：`ok` 语义被污染，调用方无法用它判断。**可达性前提**（复核者指出、Lead 同意保留 Critical）：需先有可用库才走得到结果卡片上的「定位」按钮 —— 无库状态是 P3 的缺陷；**库可用时 100% 复现** | `src/main/index.mjs`：`import electron` 解构里补 `shell`，并在 `createEngine({…})` 里注入 `shell: { reveal: (abs) => shell.showItemInFolder(abs) }`；`core/engine.mjs:434` 在 `shell` 缺失时改为 `throw fail(ERR.INTERNAL, 'reveal 端口未注入')`（宁可显式失败也不要假成功）。验：`npm test` 增一条「未注入 shell → 返回错误信封」；`tools/verify_renderer_dom.mjs` 增一条「reveal 失败时 toast 为错误态」 | 基线 D6 |
| **P3** | **6 · High**（2×3） | **配置源已退役但代码仍在读**：`loadConfig()` 只找 `config.json`/`GEMMA_CONFIG`，而 `config.json` 已删 → `library_root=''` → 引擎库列表为空 → 界面永远没有库 | `src/main/index.mjs:68-91,117`；`Test-Path config.json` → False；`README.md:87`「没有配置文件了…素材库位置由应用内的库注册表管理」；E5 | 用户：启动后无库可用（`LIB_NOT_FOUND`），且**没有 UI 入口能添加库**（P5 未做）→ 判据 §3「死功能」+「用户可执行路径受损」 | 二选一并落到代码：①`src/main/index.mjs` 改读 `userData/library-registry.json`（`core/library.mjs` 的注册表序列化）；②在 P5 之前**至少在 UI 上给出「未注册任何库 + 如何注册」的空态**。验：删除所有 config 后 `npm start`，界面必须显示可操作的引导而不是空白/`LIB_NOT_FOUND` 错误码 | 基线 D2 |
| **P4** | **6 · High**（3×2） | **测试分层缺口**：68 条测试**全部**只 import `core/`，`src/main`、`src/preload`、`src/shared/ipc.mjs`（IPC 白名单这条安全边界）**一根自动化网都没有** | E1.1（`Select-String -Path tests\*.mjs -Pattern "src/"` → 0 命中）；`tools/verify_renderer_dom.mjs:12-13` 自述不能证明真实 IPC；`SPEC-security.md` 声称的 IPC 白名单无对应测试 | 工程/安全：判据 §3 强制项「安全边界失效 → 至少 High」；改 `ipc.mjs` 或 preload 暴露面无人拦 | 先补 `tests/ipc.test.mjs`（纯函数、无 Electron）：11 方法逐个「合法过 / 多字段被 `.strict()` 拒」、未登记方法拒、>1 MiB 拒；再补 `tools/verify_app_build.mjs` 的 preload **键集合白名单**断言；最后引 Playwright Electron E2E 1 条。验：`npm test` ≥90 且全过；`node tools/verify_app_build.mjs` 全过 | 新 |
| **P5** | **6 · High**（2×3） | **18 个生产依赖零 import 却仍进安装包**：12×Radix + zustand + @tanstack/react-virtual + lucide-react + clsx + tailwind-merge + class-variance-authority；体积约 **38 MB / ~4,838 文件**（`lucide-react` 一个就 34.1 MB / 4328 文件） | E2（逐个 grep，0 命中）；E2.1（体积表）；`cx.js:1` 自述不引 clsx；`electron-builder.yml` 未排除这些生产依赖 | 交付：安装包与解包体积、供应链攻击面；且 `SPEC-security.md:167` 的「依赖最少」自述被自身证伪 | 按 §6 表格删除/降级；改 `package.json` 后验：`npm ls --depth=0` 无 `extraneous`，`npm test` + 3 个 `verify_*` 全过，再跑一次 `npm run build && node tools/verify_app_build.mjs` | 新 |
| **P6** | **6 · High**（3×2） | **打包分发在结构上未接通**：打包态 `ROOT` 落在 `app.asar` 内、模型目录写死在 `<ROOT>/../model-cache`、`allowRemoteModels=false`、`resources/` 为空、`asarUnpack` 只列 `resources/**` → 装到别的机器必然 `MODEL_MISSING` + 无库 | `src/main/log.mjs:25,52-53`（自认 P6 未解决）；`src/main/index.mjs:96-97`；`src/main/encoder.mjs:62-63`；`electron-builder.yml:5-6,21-22`；`resources/` 实测空；`SPEC-app.md:99-101` 承诺「模型首次获取」但无实现；`README.md:179` 自述未验证 | 交付：判据 S7「分发到别的机器」= 不成立（**不判 Critical**：失败是**可见的**错误码，非静默、无数据损坏） | §8 三步：①`log.mjs` 的 `ROOT` 打包态改 `app.getPath('userData')` 并改挂 `DATA_DIR/THUMB_DIR/日志`；②补 `model:ensure`（用户确认后下载到 userData）；③`asarUnpack` 补 `onnxruntime-node`/`sharp`/`@img`（实测为准）。验：`npx electron-builder --dir` 后在**改名/移除 `D:\USERS\Desktop\Agent\model-cache`** 的机器上启动，能走到「下载模型」并成功建库 | 新 |
| **P7** | **6 · High**（2×3） | **门禁不在任何自动化里，且唯一红灯无人知**：无 CI、无提交钩子、`npm test` 不跑守卫；`node tools/verify-doc-refs.mjs` **EXIT=1**（原因是**根目录越界 + 死引用**；越界名单含 `AGENTS.md` **与审查交付物** `AUDIT-FINAL.md`/`STACK-AUDIT.md`/`UIUX-AUDIT.md` 自身），而该守卫**不在** `README.md:94-103` 的命令清单里、也不在 `package.json` 里 | E1.4（EXIT=1 + **交付前快照** 原始输出；该计数是动态量：50/0/1 → 基线 §6.1 的 102/7/3 → 复核者 106/10/3 → Lead 109/7/4 → **作者同期复跑 109/7/4**）；E1.5（package.json 只 wire 了 `smoke`）；`Test-Path .github` → False；`README.md:94-103` 六条命令不含 `verify-doc-refs` | 治理：**任务宪章与审查交付物本身让仓库自检变红**，而且没有任何机制会让任何人看到 → 判据 §3「文档说做了、代码没做」类，且是**当前实际失败** | ①处置根目录越界：`AGENTS.md` 与三份根目录审查交付物（`AUDIT-FINAL.md`/`STACK-AUDIT.md`/`UIUX-AUDIT.md`）按守卫白名单归位（宪章不属于「入口+治理」；三份交付物可由 Lead 决定是移入 `docs/audit/` 还是在守卫里加显式例外并写理由）；②`package.json` 加 `"verify": "node tools/verify-doc-refs.mjs && node tools/verify_app_build.mjs && node tools/verify_renderer_styles.mjs && node tools/verify_renderer_dom.mjs"`，并让 `test` 或 CI 依赖它；③补最小 CI（`.github/workflows/ci.yml`：`npm ci && npm test && npm run verify`）。验：`npm run verify` EXIT=0；在 CI 里故意改坏一处引用，CI 必须红 | **部分新**：基线 D1（`00-current-state.md:105`）与 §6.1（`:164` 起）**已记**「该守卫当前 EXIT=1 + 死引用 7」；本轮**新增**的是：无 CI、无提交钩子、`npm test`/`package.json` 完全不接线，且 EXIT=1 会随审查文件增加而**持续恶化**（50→102→106→109） |
| **P8** | **4 · Medium**（2×2） | **生产运行时反向依赖实验目录**：`src/main/encoder.mjs` 静态/动态 import `onnx-spike/`；该目录自带 `package.json` + 473 MB `node_modules`（第二份 `@huggingface/transformers`） | `src/main/encoder.mjs:12,47`；`onnx-spike/package.json`（自述 dependencies）；E2.2（34 包/3222 文件/473.2 MB）；`docs/DEBT-CLEANUP.md:86` 自认「仍未根治」；`PROJECT-GUIDE.md:72-74,100` 称其为「离线实验室」「谨慎改动」 | 工程：分层被穿透；任何按文档语义清理 `onnx-spike/` 的动作都会打断主进程；不打包路径下仍存在双份类对象风险 | 把 `resize_compat.mjs` 与 `bmp_decode.mjs` **移动**到 `src/main/encoder/`（并把 `onnx-spike/` 内其余构建器改为从 `src/main` 引同一份实现），删除 `onnx-spike/package.json` 与 `onnx-spike/node_modules`，全仓统一用根依赖树；**或**改成 npm workspaces（`onnx-spike` 作为 workspace 包）并让 `src/main` 通过包名引用。验：`npm ls --depth=0` 无重复 `@huggingface/transformers`；`node tools/verify_app_build.mjs` 全过；`node tools/verify_encoder_path.mjs --model <dir>` 仍过（这条正是「不打包路径」的双份风险守卫，必须先跑它再动） | 新 |
| **P9** | **4 · Medium**（2×2） | **`SPEC-security.md` §7 供应链清单与实测不符**：生产依赖 21（实测 24）；`node_modules` 596 MB/16,894 文件/288 顶层包（实测 1089.9 MB/21,472/334）；**`sharp` 被列在「刻意不引入」却实际是生产依赖且被生产路径使用** | `docs/spec/SPEC-security.md:167-168`、`:192`；`package.json:24-49`；E2（sharp 真实使用）、E2.1 | 治理/安全：安全规格的依赖清单是审计入口，三处数字 + 一处反向结论失真 → 「依赖最小」不可审 | 改 `docs/spec/SPEC-security.md` §7.1/§7.2/§7.3：数字用实测（24 / 1089.9 MB / 21,472 / 334），把 `sharp` 从 §7.3「不引入」移到 §7.2 并写明理由（`package.json:55-56` 已有现成理由）；`SPEC-security.md:208`「61 条测试」改 68。验：新增一条守卫或用 `node -e` 比对 `package.json` 依赖数与文档中的数字（可加进 `verify-doc-refs.mjs` 的扩展） | 新 |
| **P10** | **4 · Medium**（2×2） | **规格承诺栈与实际栈的系统性偏离**：`TASK-PLAN.md:23` / `SPEC-app.md:63-71,184` / `DESIGN-tokens.md:234` 承诺 TS + Tailwind + shadcn/ui + Lucide + zustand + react-virtual，实际是 JS/JSX + 手写 CSS + 自研 `ui/`（0 个 `.ts`） | E7.3（逐行摘录）；E1.2（0 个 `.ts/.tsx`）；E2（Radix/zustand/tailwind 全 0 import） | 治理：P3a 的工期与依赖决策建立在过期前提上；18 个无用依赖是这个偏离的**直接后果** | 采纳 §5.2 的判定并**改文档到与实现一致**：`TASK-PLAN.md:23` 形态改为 `Electron + JavaScript(ESM/JSX) + React + 手写 CSS（令牌制） + 自研 ui/`；`SPEC-app.md` §3 前端表逐行标注「实际 / 计划」；`DESIGN-tokens.md:234` 的 Tailwind 映射章节标注「已否决，理由见 STACK-AUDIT §5」；TS 迁移仍在计划里（二步走，见 §5.2）但必须写明**没有 typecheck 门禁**这一点。验：`verify-doc-refs.mjs` 仍绿；`grep -rn "shadcn" docs/ TASK-PLAN.md` 的每处都带「已否决/计划」标注 | 新 |
| **P11** | **3 · Low**（1×3） | **守卫数量文档过期**：文档说 `tools/` 6 个守卫，实测 7 个；漏掉的正是**当前失败的** `verify-doc-refs.mjs` | `README.md:47`、`README.md:94-103`（6 条命令）、`PROJECT-GUIDE.md:70,98`；`tools/` 实测 7 个 `.mjs`（E1.5）；`docs/README.md:92` 实际提到过它 | 治理：读者会以为没有这个守卫（与 P7 合流） | 三处改 6→7 并把 `node tools/verify-doc-refs.mjs` 加进 `README.md` §2 命令清单。验：`Get-ChildItem tools -File -Filter *.mjs` 计数与文档数字一致 | 基线 D1（**附更正**：基线说「全仓无一处提到它」，实际 `docs/README.md:92` 已入库提到 → 见 §12 更正表） |
| **P12** | **3 · Low**（1×3） | **`PROJECT-GUIDE.md` 自相矛盾**：§6 表格说「新的规格/设计文档 → **仓库根**」，而同文件 §5 的表格与实际布局都在 `docs/spec`、`docs/design` | `PROJECT-GUIDE.md:157` vs `:114-133`；`docs/` 实测 `spec/` 6 个 + `design/` 3 个；HEAD 提交 `dc0ceb2`「正文文档从仓库根收进 docs/」 | 治理：新人会把新文档放错位置 | 改 `PROJECT-GUIDE.md:157` 为 `docs/spec` 或 `docs/design`（并同步 §5 的「13 份文档」标题 —— 见 P13）。验：`node tools/verify-doc-refs.mjs` 仍绿（该守卫恰好管这条） | 基线 D3 |
| **P13** | **3 · Low**（1×3） | **根目录文件数与文档位置双双失真**：文档说「仓库根 24 个文件」「13 份项目级权威文档在根目录」，实测根目录 **14 个文件**、13 份文档**全在 `docs/`** | `PROJECT-GUIDE.md:160,186,213`；`Get-ChildItem -File` 实测 14 个；根目录条目 33 个 | 治理：结构总览的基线数字错的，后续所有「几份文档」的推理都不可靠 | 改 `PROJECT-GUIDE.md:160,186,213` 三处：根目录 14 个文件（含 `AGENTS.md`）、权威文档在 `docs/`；§6 的「放根目录是刻意选择」段落整体改写为历史说明。验：与 `Get-ChildItem -File` 计数一致 | 基线 D4 |
| **P14** | **3 · Low**（1×3） | **`SPEC-app.md` 的命令区仍是 Python 时代**：`:119` 写 `pnpm test # vitest`、`:128-131` 写 `& ..\.venv\Scripts\python.exe tools/preflight_p05.py`；而实际是 `npm test`（`node:test`）、仓库 0 个 Python 文件 | `docs/spec/SPEC-app.md:119,128-131`；`package.json:19`；`README.md:95`；E1.1/E2 | 治理：规格文档是 S4 的判据来源，其可执行段落不可执行会污染整个技栈评估 | 改 `SPEC-app.md` §4 为现状命令（`npm test` / `npm run build` / 6 个守卫），删除 `.venv` 段；与 `README.md` §4 的「这批文档的统一改写尚未进行」欠账合并成一次提交。验：文档里出现的每条命令都在**本机可跑**（逐条执行） | 基线 §4 的连带 + **部分新**：基线 §0 前言已声明「SPEC-*.md 里仍大量提到已退役的 Python 档」，`README.md:165-167` 也自述这批文档改写未做；本轮新增的是**具体到 `:119` 的 `pnpm test # vitest` 与 `:128-131` 四行 `.venv` 命令**，并指出它污染了 S4 的判据来源 |
| **P15** | **1 · Low**（1×1） | **`SPEC-app` 承诺的 4 个方法在实现里被显式拒绝**（`ingest`/`mutate`/`indexStart`/`indexCancel`），契约先冻结、实现后补 —— **定性为设计取舍，不是缺陷** | `src/shared/ipc.mjs:49-70`（已登记 schema）；`src/main/index.mjs:190-195`（显式拒绝，注释说明「避免静默什么都不做」）；`SPEC-app` §六 承诺 P4/P5 | 工程：这是**正确的做法**（宁可显式拒绝也不静默）；唯一问题是基线对它的描述不准（见 §12 更正表） | 保持现状。若要更稳：把这 4 个方法在 `METHOD_NAMES` 之外单独导出 `IMPLEMENTED_METHOD_NAMES`，让渲染层能据此禁用按钮而不是点了才报错。验：`npm test` 增一条「未实现方法返回 INTERNAL 且 userMessage 非空」 | 基线 D5（**附更正**） |

**统计**：Critical 1（P2）· High 6（P1/P3/P4/P5/P6/P7）· Medium 3（P8/P9/P10）· Low 5（P11-P15）。
**新发现问题：全新 7 条**（P1/P4/P5/P6/P8/P9/P10）+ **部分新 2 条**（P7：基线 D1/§6.1 已记 EXIT=1 与死引用，本轮新增「无 CI / 无钩子 / 不接线 / 持续恶化」；P14：基线 §0 前言已记「SPEC 里有 Python 档」，本轮具体到行号并指出污染 S4 判据）。其余 6 条为基线 §5 D1-D6 的独立复核（P2=D6 · P3=D2 · P11=D1 · P12=D3 · P13=D4 · P15=D5）。**全新发现 7 条 ≥ 判据要求的 2 条**。

---

## 12. 对基线的两处更正（G3 要求的主动回写建议）

判据 G3 要求「与基线冲突必须附新证据」。本轮**未发现与基线相反的事实**，但发现**基线两处描述过强**，建议 Lead 回写（只有 Lead 能改 `00-current-state.md`）：

| 基线原文 | 实测 | 证据 |
|---|---|---|
| D1：「`verify-doc-refs.mjs`（文档死引用守卫，**全仓无一处提到它**）」 | **不成立**：`docs/README.md:92` 明确写了 `node tools\verify-doc-refs.mjs  # 全仓引用解算 + 根目录越界检查（只读）`，且该文件已在 HEAD 提交 `dc0ceb2`（2026-10-10 18:02:52）入库 | `git log -1 -- docs/README.md`；E7.1 |
| D5：「`METHOD_NAMES` 会**广播**这 11 个方法」 | **不成立**：`METHOD_NAMES` 全仓只被 `src/main/index.mjs:205` 用于**写一行日志**；preload 只暴露 `invoke/onEvent/platform`，渲染层拿不到方法名列表 | `Grep METHOD_NAMES` → 7 处命中，`src/` 内只有 `ipc.mjs:73`（定义）与 `main/index.mjs:26,205`（import + log）；E7.1 |

另有两条**基线未记但同类**的事实，建议一并补入基线（都属「文档说做了、代码没做」族）：
`package.json:59` 声称的「222 条 noImplicitAny」实测不可复现（node 侧 111，两侧合计 197）；
`docs/spec/SPEC-security.md:192` 把 `sharp` 列为「刻意不引入」而它实际是生产依赖（P9）。

---

## 13. 本轮未覆盖 / 无法验证

1. **未跑 `npm run build`**：`out/`（main 46.6 KB / preload / renderer 673 KB）是**既有产物**，`verify_app_build.mjs` 与 `verify_renderer_dom.mjs` 校验的都是上一轮的产物；本轮只证明「这些产物形状与逻辑正确」，**不证明「当前源码能构建出它」**。
2. **未跑 electron-builder（`--dir` / `--win`）**：会下载 winCodeSign 等外部资源并写 `dist/`，超出只读审查范围。因此 §8 的结论是**代码事实 + 静态推断**，不是打包实测；`electron-builder.yml` 的 `files` 通配深度（`!src/*` 是否递归）**未验证**。
3. **未跑 `npm run dev` / `npm start` / `tools/smoke_app.mjs`**：需要真实 GUI 会话。因此**「能不能出窗」本轮未验证**（与 `README.md:179` 的既有声明一致）。
4. **未跑 `tools/verify_encoder_path.mjs` / `check_search.mjs`**：需要模型目录/查询向量参数，且会做真实 GPU 推理；「不打包路径下两份 `@huggingface/transformers`」的风险（P8）**本轮未实测复现**，只有仓内 `docs/DEBT-CLEANUP.md:86` 的自述与目录事实支撑。
5. **未做依赖安全审计**：未跑 `npm audit`，P5/P9 只谈体积与语义，**不声称存在/不存在 CVE**。
6. **未核实基线 §6 的**「索引是否在本机可读」外部约束：`G:\model` 与 `data/libraries/L1/` 本轮均 `Test-Path` = True，但**未比对 3594 条索引与库内文件的一一对应**（那属于数据面，不属本轮技栈范围）。
7. **未核实 `PROJECT-GUIDE.md` §8 的 11 项目调研**：本轮只独立核实了 **immich** 的目录结构（web_fetch `docs.immich.app/developer/directories/`）；librephotos / jan / photoprism / anything-llm 等的布局引自该文档，标为**「引用既有文档，未独立核实」**。
8. **S8 的「换库拐点」是算术外推 + 判断**（`【判断，非实测】`）：7 ms@3594 是仓内既有实测（`docs/DEBT-CLEANUP.md:378`），10^5/10^6 的量级是我按线性外推算的，**没有在真实 10^5/10^6 数据集上测过**。
9. **环境限制（会影响你复跑时的观感）**：本会话的 `pwsh` 实为 **Windows PowerShell 5.1 + GBK 控制台**，直接 `Get-Content` 中文 UTF-8 文件会乱码（E0）；本轮曾据此误判 `_ACCEPTED.txt`「编码坏了」，用 `-Encoding UTF8` 复读后**已撤销该误判**（不作为问题列出）。复跑本报告的数字时请用 `-Encoding UTF8`，或改用 PowerShell 7。

---

## 14. 自检表（判据 §2 G1-G7 逐条）

| 门 | 判据 | 结论 | 理由 / 抽查 |
|---|---|---|---|
| **G1** | 不声称未验证的能力：每个「已验证」都能追溯到 `文件:行号` 或命令+输出 | ✅ **通过** | 全文事实性结论均带行号或 E 编号；`tsc` 两侧错误数（126/230）来自本轮实跑；唯一的推断性结论（S8 拐点、`electron-builder` 打包行为、`files` 通配深度）已显式标 `【判断，非实测】` 或写入 §13。**抽查 5 条**：P2（`core/engine.mjs:434` + `useSearch.js:80`）· P1（E1.2 EXIT=0 + E1.3 126/230）· P5（E2 grep 0 命中 + E2.1 体积）· P7（E1.4 EXIT=1；**该段已按独立复核 B5 标注为「交付前快照」并列出 50→102→106→109 的动态计数**）· P3（`Test-Path config.json`=False + `index.mjs:117`）。**首轮曾被复核判「部分满足」的唯一原因（E1.4 证据不同期）已在本轮修正** |
| **G2** | 区分三类事实 `代码事实` / `文档声称` / `行业做法` | ✅ **通过** | 每条结论显式标注（例：§3「本节结论属行业做法对比 + 代码事实」；§5.2-A 标「行业做法 + 代码事实」；§6 表头标「代码事实」；§8 标「代码事实 + 静态推断」）。**默认规则**：带 `文件:行号` 的是代码事实，写「承诺/声称」的是文档声称，写「对标/行业做法」并带 URL 或项目名的是行业做法；混写处已拆句 |
| **G3** | 与基线零冲突 | ✅ **通过** | 基线 §1/§2/§3/§4/§5/§6 逐项复核无相反结论（E7.1）；发现基线**两处描述过强**，未自行另立事实，而是列入 §12 供 Lead 回写（附新证据）。基线 D1-D6 全部保留原编号可追溯。**首轮曾被复核判「部分满足」的两点已修正**：① E1.4 与基线 §6.1 的快照不一致 → 已在证据附录标注「交付前快照」并列出动态计数（B5）；② P7 的「覆盖」栏曾把基线说成「未记已失败」→ 已改为「**部分新**」并引 `00-current-state.md:105` 与 §6.1（B2） |
| **G4** | 严重度可复算：`Score = 影响面 × 触发可能性` + 映射等级 | ✅ **通过** | §11 开头先声明统一打分口径，再逐条给 `(影响面×触发)` 与等级；**抽查 3 条复算**：P2 `3×3=9→Critical`；P1 `2×3=6→High`；P8 `2×2=4→Medium`（P8 取「触发 2」的理由：只在有人按文档语义动 `onnx-spike/` 或走不打包路径时发生，已写在建议栏） |
| **G5** | 有可执行建议：改哪里 + 怎么验 | ✅ **通过** | §11 每条建议都含「改哪个文件」+「怎么验」；§4/§6/§7/§8/§9 的建议同样两段式（例：§6「改 `package.json` → 验 `npm ls --depth=0` 无 extraneous + 3 个 verify 全过」）。**通读未发现「建议优化」「注意规范」类空话** |
| **G6** | 诚实列未覆盖 | ✅ **通过** | §13 共 9 条，含本轮**未跑**的 build / electron-builder / dev / smoke / encoder 验证 / audit，以及环境限制（PowerShell 5.1 乱码导致的一次误判及撤销）与「引用未独立核实」的边界 |
| **G7** | 中文 | ✅ **通过** | 全文中文（代码标识符、命令、错误码、URL 保留原文） |

**写入合规**：本轮只写了 3 个允许路径 —— `STACK-AUDIT.md`、`docs/audit/stack-evidence.md`（第三个 `docs/audit/notes-stack-auditor.md` 未使用）。
`git status --short` 复核：除 `?? AGENTS.md`（既有）、`?? docs/audit/`（本轮审查目录）、`?? docs/plan/DOCS-*.md`（Lead 的文档任务）外，**无任何源码/配置被修改**；
本轮命令唯一产生的文件 `tsconfig.web.tsbuildinfo` 已删除并恢复原状（E9）。

---

## 15. 给 Lead / 复核者的三条最高优先级（供第 ③ 条宪章 F1/F2 使用）

1. **P2（Critical，基线 D6）**：`reveal` 静默假成功有**完整证据链**（引擎 `:434` → 主进程未注入 → 界面必弹成功文案），建议在 `AUDIT-FINAL.md` 的 F2 里定为**真缺陷**而非「已知欠账」——因为它的表现是**假成功**，符合判据 §3 的 Critical 定义。
2. **P1 + P7（High）**：本仓库的门禁体系「看起来很多、实际没有自动跑、而且有一半是假绿的」。`npx tsc --noEmit -p tsconfig.web.json` 的 EXIT=0 是**最能误导人的一条**，建议在最终 review 的「离可交付还差什么」里单列。
3. **P5 + P10（High/Medium）**：18 个零使用依赖与「规格承诺栈 vs 实际栈」是同一件事的两面。修法不是逐包删除，而是**先决定栈**（本报告建议：保持 JS + 手写 CSS + 自研 ui；Radix 按需只引 AlertDialog；TS 二步走），再让文档与 `package.json` 一起收敛。

---

## 16. 独立复核 B1-B6 的处置记录（本次修订）

> 复核文件：`docs/audit/REVIEW-STACK-AUDIT.md`（`verdict: pass-with-issues`，blockers 6 条；该文件为**只读**，本轮未改动）。
> 以下逐条给出处置位置与改后内容。**所有 blocker 均已处置**，另接受了复核者关于 P2 可达性的建议（非 blocker）。

| Blocker | 复核意见 | 处置 | 位置 |
|---|---|---|---|
| **B1** | §5.2-A Tailwind 否决理由②（CSP）证据不支持 | **已改写**：该条从「硬否决理由」降为「**CSP 不构成理由（本轮更正）**」——原文承认生产 CSP 本就含 `style-src 'self' 'unsafe-inline'`（`index.html:9`，`:7` 注释自述系 Vite 注入所需、与 Tailwind 无关）；`SPEC-security.md:310-311` 位于 §10.4「如果你仍要更严」，`:314` 自述「这不提升安全性」、`:266` 推荐**保留** `'unsafe-inline'`。结论改为「Tailwind 不新增让步、也不解决已存在的放宽；是否收窄是独立议题」。**理由①（令牌纪律）③（收益比）保留，S4 结论不变** | §5.2-A（Tailwind 段） |
| **B2** | P7「覆盖」栏错写基线（基线已记 EXIT=1） | **已改写**为「**部分新**：基线 D1（`00-current-state.md:105`）与 §6.1（`:164` 起）已记「当前 EXIT=1 + 死引用 7」；本轮**新增**的是无 CI、无提交钩子、`npm test`/`package.json` 完全不接线、且 EXIT=1 随审查文件增加而持续恶化」。**并据此改准 §11 末尾统计口径**：全新 7 条 + 部分新 2 条（P7、P14）+ 基线复核 6 条 | §11 P7 行 + §11 统计段 |
| **B3** | §3 依赖拓扑内部算术错（19 / 5+2） | **已改**：`:93` 「（19）」→「**（18 = 24 − 6）**」；`:91` 「（5+2）」→「**共 6 个 = 4 静态 + 2 仅经 onnx-spike 动态 import**」 | §3 依赖拓扑图 |
| **B4** | 「现有 CSS 24,916 B」把构建产物当源文件 | **已改**为「源文件 `src/renderer/src/renderer.css` **14,050 B**（构建产物 `out/renderer/assets/index-BCVIX9rf.css` 24,916 B，E4）」。两者本轮均已复测确认 | §5.2-A（③） |
| **B5** | E1.4 证据不同期 + P7 单一归因 | **已改**：E 文件 E1.4 该段标注「**交付前快照**（当时 50/0/1）」并补入动态计数链（50→基线 §6.1 的 102/7/3→复核者 106/10/3→Lead 109/7/4→**作者同期复跑 109/7/4**，附死引用 7 处/越界 4 份的明细）；P7 的失败原因改为「**根目录越界（含 `AGENTS.md` 与审查交付物 `AUDIT-FINAL.md`/`STACK-AUDIT.md`/`UIUX-AUDIT.md` 自身）+ 死引用**」，不再单一归因 `AGENTS.md` | `docs/audit/stack-evidence.md` E1.4 + §11 P7 行 + §10 第 10 行 |
| **B6** | §6 第 7 行「删 11 个」与处置栏「12 个」矛盾 | **已改**：判决栏改为「❌ **现在删 12 个**；`AlertDialog` 的需求**保留为决策**，等 P3b/P3c 再按需装」，并注明 `package.json:26-37` 实测 12 个 | §6 第 7 行 |
| （建议，非 blocker） | P2 补可达性前提 | **已接受并写入**：P2 的「影响」栏补「**可达性前提**：需先有可用库才走得到结果卡片上的「定位」按钮（无库状态是 P3 的缺陷）；**库可用时 100% 复现**」，维持 9 · Critical | §11 P2 行 |

**连带更新**：§14 的 G1/G3 行已注明「首轮被复核判『部分满足』的原因已修正」（B5 → G1；B2+B5 → G3）。
**未改动**：`REVIEW-STACK-AUDIT.md`、`AUDIT-FINAL.md`、`00-current-state.md`、`01-acceptance-criteria.md` 及任何源码/配置。
**修订后复跑**：`node tools/verify-doc-refs.mjs` → EXIT=1（109 / 7 / 4，与 Lead 一致，原因均为审查/文档产物自身）；`src/renderer/src/renderer.css` = 14,050 B、`out/renderer/assets/index-BCVIX9rf.css` = 24,916 B。

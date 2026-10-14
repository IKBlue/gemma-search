# 应用主体（Electron）

> 状态：**现行** · 最后核对：**2026-10-14** · 权威范围：`apps/desktop/src/` 的模块职责与就地说明
> ⚠️ 本轮校正了 §1 目录树与 §6 的 4 条过期欠账（typecheck / 技术栈 / D2 / F-01 —— 后两者**已修**）；当前事实以 [`docs/PROJECT-INFO.md`](../../../docs/PROJECT-INFO.md) 为准
>
> 位置变更：本文原在 `src/README.md`，2026-10-12 的 monorepo 重构（`docs/MIGRATION-PLAN.md`）
> 把 `src/` 整体搬到了 `apps/desktop/src/`。**内容已按新布局校正**。
> 想知道「在这个仓库里怎么干活」→ [`../../../AGENTS.md`](../../../AGENTS.md)；
> 「这是什么、怎么跑」→ [`../../../README.md`](../../../README.md)。

## 1. 目录与职责

```
apps/desktop/src/
├── main/             主进程（Node 环境）
│   ├── index.mjs       组装引擎 · 只开 engine:invoke/engine:event 两条 IPC · thumb:// 协议 · 窗口姿态
│   ├── encoder.mjs     编码器端口（ONNX + WebGPU，BMP 回退）—— 引擎只声明"要一个能编码的端口"
│   ├── ports.mjs       注入引擎的能力端口（shell.showItemInFolder，F-01）
│   ├── library-config.mjs 库根 / 取件目录四路解析 + userData 注册表
│   ├── thumb-url.mjs   thumb:// 形状解析 + 尺寸白名单 + 失败状态码映射
│   ├── window-security.mjs 来源判定 / 新窗口 / 导航三个决策
│   └── log.mjs         日志（**必须写文件**，见 §3）+ 仓库根探测（标记式，源码态/构建态通吃）
├── preload/index.js    白名单桥：只暴露 invoke / onEvent / platform（**不暴露 ipcRenderer**）
├── renderer/           渲染进程（沙箱）
│   ├── index.html      CSP + 挂载点 #root（DOM 结构由 React 生成）
│   ├── src/main.jsx    React 入口（挂载 + 加载令牌与样式）
│   ├── src/renderer.css 界面样式（**只消费 `var(--token)`**，不写死颜色）
│   ├── src/App.jsx     应用根：只挂 `<LibraryGate />`（有库进路由，无库进首启向导）
│   ├── src/adapter/    全应用**唯一** `window.api` 入口（解包信封、永不抛、userMessage 恒非空）
│   ├── src/store/      Zustand：search.js（检索 + 取件确认状态机）· tasks.js（进度事件归约，纯函数）
│   ├── src/router/     paths.js（路径与页面名唯一来源）· index.jsx（组件映射 + 启动期断言）
│   ├── src/hooks/      useEngine（invoke / 事件订阅 / indexStatus）· useLibraryConfig · useToast
│   ├── src/utils/      gate · index-state · item-actions · format · useDocumentTitle
│   ├── src/pages/      6 个页面：LibraryGate · FirstRunWizard · SearchPage · ItemPage · TasksPage · ActivityPage
│   ├── src/styles/     tailwind.css（`@theme inline` 只映射令牌，不复制值）
│   └── src/ui/         12 个自研通用组件（含 ConfirmDialog · cn.js）
└── shared/ipc.ts    IPC 契约唯一来源（zod 白名单 + 方法名）—— 主进程与渲染进程共用
```

**不在这个目录里的两个关键件**（别到这里找）：

| 件 | 实际位置 | 为什么在别处 |
|---|---|---|
| 引擎 | `packages/engine/` | **传输无关、零第三方依赖**（`AGENTS.md` §1 S5）——它必须能被脱离 Electron 单独测试 |
| 编码兼容层 / BMP 解码 / 索引构建 | `packages/indexer/src/` | 索引构建、查询、应用三条路径**共用同一份实现**，不能只放在应用里 |
| 视觉令牌 | `packages/design-tokens/tokens.css` | **唯一来源**，由 `renderer/src/main.jsx` 直接 import |

## 2. 命令

```powershell
npm run dev      # dev server + HMR，改渲染进程代码即时生效
npm run build    # → out/main · out/preload · out/renderer（产物在**仓库根** out/）
npm start        # electron-vite preview：跑 build 出来的产物（最接近打包态）
npm test         # 引擎单测（node:test，不经传输层）
npm run dev:restricted / npm run start:restricted   # 受限环境（Chromium 沙箱起不来）用
```

> **已移除**：`npm run start:legacy`。它指向的 `app/` 旧外壳已归档到
> `docs/archive/legacy/app-shell-20261010/`（归档的定义就是「不再是依据」），
> 留一条能跑的脚本等于把退役外壳摆在受支持入口旁边。
> 需要对照时直接：`electron docs/archive/legacy/app-shell-20261010/main/bootstrap.cjs`。

`dev` / `start` 都经 `scripts/electron-vite.mjs` 转发，它会**先摘掉 `ELECTRON_RUN_AS_NODE`**：
该变量会让 Electron 以纯 Node 运行，症状是"找不到 transformers / 没有具名导出 BrowserWindow"，
极具误导性。dev 态不能靠主进程自愈（dev server 在父进程手里），所以在这一层拦掉。

## 3. 构建产物形状（可核对，不用信任本文档）

| 产物 | 必须是 | 为什么 |
|---|---|---|
| `out/main/index.js` | **ESM**（`package.json` 是 `type: module`） | Electron ≥28 支持 ESM 主进程 |
| `out/preload/index.cjs` | **CJS**，且只 `require('electron')` | `sandbox: true` 的渲染进程**不加载 ESM preload** |
| `out/renderer/index.html` | `<script type="module" src="./assets/…">`（**相对路径**） | 打包后是 `file://` 加载 |
| `out/main/chunks/encoder-*.js` | `import … from "@huggingface/transformers"` 保持**外部** | 原生模块（onnxruntime-node / sharp）不能进 bundle |

```powershell
npm run build
```

> ✅ **2026-10-12 重构后已实测通过**：`npm run build` EXIT=0，三端齐备；`verify_app_build.mjs` 与
> `verify_renderer_dom.mjs` 均 **EXIT=0**。
>
> ⚠️ **顺序不能反**：在**无提权的受限沙箱**（例如某些 CI / 容器）里 `npm run build` 仍会失败
> （esbuild 常驻服务 `spawn EPERM`，**失败点在加载配置之前**）—— 环境限制，不是配置问题。
> 又因 `out/` **不进 git**（新克隆里不存在），上面两条守卫**必须先成功 build 一次**才有意义，
> 否则会报「找不到 `out/main/index.js`」。详见 `AGENTS.md` §3。

> ℹ️ **历史记录注（2026-10-13）**：本文中出现的 `verify_app_build` / `verify_main_wiring` /
> `verify_renderer_dom` / `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` **均已于 2026-10-13
> 按所有者指令移除**（原件在 `data/_removed-guards-backup/`）。下面这些"实测通过/EXIT=0"是**当时的真实记录**，
> 保留不改写；但它们**不再可复跑**。

## 4. 日志在 `data/_app.log`

Windows 上 Electron 是 **GUI 子系统程序**：主进程 stdout **不连终端**，`console.log` 一条都看不到。
所以：主进程日志、渲染进程 console、页面加载失败、渲染进程崩溃**全部**写进
`data/_app.log`（同时尽力写 stdout，dev 态 electron-vite 会把它接回终端）。

**首次运行请把 `data/_app.log` 回传** —— 里面有：electron/chrome/node 版本、配置来源、
`thumb://` 注册、IPC 注册、引擎就绪、窗口创建、编码器载入（或载入失败原因）、渲染进程报错、
以及**应用根（`ROOT`）与它的自检结果**（见 `main/log.mjs`：解析不出仓库根时会打醒目横幅）。

F12 可开 DevTools（生产态也保留，理由见 `docs/spec/SPEC-security.md` §9 决定 3）。

## 5. Electron 内实跑结果（2026-10-10 · 证据 `reports/G-D-p2-electron/`）

**能跑。** 1440×920 窗口里渲染 React 界面：

- 窗口标题 `gemma-search · 素材库语义检索`；关窗即退出，无残留进程
- `[renderer] info [ui] React 已挂载 · react 19.3.0` → 渲染层在 Electron 里跑的是 React
- `invoke indexStatus 2ms → ok` → preload 白名单 + 来源校验 + zod 校验 + 引擎，整条链路打通
- `载入模型 dtype=fp32 seq=140 device=webgpu` / `载入完成 2.4s` → **WebGPU 在 Electron 内能起来**
- 界面显示「模型就绪 · webgpu · 2.6s」

**承载环境的硬约束**：Chromium 的进程沙箱起不来时，Electron 必须加 `--no-sandbox` 才能出窗
（不加则 `0x80000003` 秒退；判据见 `tools/probe_electron_start/README.md`）。
**这是承载环境的限制，不是应用的配置。** `scripts/electron-vite.mjs` 启动前会探测一次：
探测到沙箱不可用就**只为本次**附加 `--noSandbox` 并打印判断依据。

> ⚠️ 上述证据采于 **2026-10-10**，当时代码在 `src/`。重构只搬了路径、未改窗口姿态与 IPC 逻辑，
> 但**本次重构后没有重跑 Electron** —— 引用时请注明是「引用既有证据」，不要写成「本轮实测」。

## 6. 已知取舍与欠账（没做的也写出来）

| # | 事项 | 现状 | 何时 |
|---|---|---|---|
| 1 | `npm run typecheck` | ✅ **已有脚本（T1，2026-10-13），EXIT=0** —— 但**只覆盖 `.ts`**（唯一有内容的来源是 `src/shared/ipc.ts`；两个 tsconfig 的 `checkJs` 仍为 `false`）。⇒ **不得声称"全局类型检查通过"**；打开 `checkJs` 的真实规模是渲染层 148 错 / 主进程侧 472 错 | 覆盖 `.js/.jsx/.mjs` 是 T2–T4 之后的更大工程（**不是漏了脚本**） |
| 2 | 技术栈 | ✅ **T1–T5 已落地（2026-10-13）**：**Tailwind** 生成层（`styles/tailwind.css` + `@tailwindcss/vite`）· **Zustand**（`store/search.js`）· **React Router 7**（hash 路由 4 条）· **Radix**（AlertDialog 确认框 · Slot 的 `asChild`）· `clsx`+`tailwind-merge` 收口为 `ui/cn.js`。**Lucide / react-virtual 已从依赖中删除**（T4 依赖清账：零 import 19 → 0）；仍留在手写 CSS 的是 114 条旧规则，逐族迁移中。全文见 `docs/PROJECT-INFO.md` | 剩余手写规则逐族迁 Tailwind |
| 3 | 打包（asar / 原生 `.node` / 图标） | `electron-builder.yml` 只保证形状；`asarUnpack` 未按实测补；图标仍是脚手架默认 | P6 |
| 4 | 打包态 `data/` 落在 asar 内 | `log.mjs` 会**打印警告**而不是假装没事；需改 `app.getPath('userData')` | P6 |
| 5 | `app/` 旧外壳 | 已归档到 `docs/archive/legacy/app-shell-20261010/`；`start:legacy` 脚本已删（理由见 §2） | — |
| 6 | CSP 只设了 `meta`，没设响应头 | `docs/spec/SPEC-security.md` §5 要求两者都设；打包态是 `file://`，`onHeadersReceived` 根本不触发，所以不能只在 dev 加个假的 | P6 定方案 |
| 7 | ~~**库根配置缺口（D2）**~~ | ✅ **已修（2026-10-12）**：库按**四条优先级**解析（`GEMMA_LIB_ROOT` → `userData/library-registry.json` → `config.json` → **已有索引自举**）⇒ 有索引即零配置可用；无库时界面走**首启向导**。实现 `main/library-config.mjs`，测试 `apps/desktop/tests/library-config.test.mjs`（14 条） | — |
| 8 | ~~**`reveal` 未接线（F-01）**~~ | ✅ **已修（2026-10-12）**：`main/ports.mjs` 注入 `shell.showItemInFolder`；引擎在端口缺失/形状不对时返回 **`PORT_MISSING`**，绝不 `ok`。⚠️ 能力边界：`showItemInFolder` 返回 void、不报失败 ⇒ 文案只能写「已请求…（系统未回报结果）」。见 `docs/spec/CONTRACT-engine-v1.md` §2.4 | — |

## 7. 仍未验证的（**不声称可用**）

- [ ] 冷启动 ≤5 s（**未计时**）
- [ ] 打包态（asar）内的 WebGPU 与真实 `thumb://` 取图（P6）
- [x] **本次 monorepo 重构后的 Electron 实跑** —— ✅ 2026-10-14：`npm run e2e` **62 passed**（真启动 Electron；含出窗、路由、窗口安全、样式令牌、确认框、模拟模式四页）
- [x] 产品态（`file://`）能出窗 —— 2026-10-10 实跑
- [x] 渲染层是 React 并已挂载 —— 2026-10-10 实跑
- [x] WebGPU 在 Electron 内能起来 —— 2026-10-10 实跑

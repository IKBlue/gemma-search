# 应用主体（electron-vite）· P2

> 这一节 2026-10-10 加入。**上一版的应用在 `app/`**（手搓、无构建、普通 JS），
> 本文档所在的 `src/` 是它的取代者：同一个应用，换成 electron-vite 三端一体的工程主体。

## 1. 目录与职责

```
src/
├── main/           主进程（Node 环境）
│   ├── index.mjs     组装引擎 · 只开 engine:invoke/engine:event 两条 IPC · thumb:// 协议 · 窗口姿态
│   ├── encoder.mjs   编码器端口（ONNX + WebGPU，BMP 回退）—— 引擎只声明"要一个能编码的端口"
│   └── log.mjs       日志（**必须写文件**，见 §4）
├── preload/index.js  白名单桥：只暴露 invoke / onEvent / platform
├── renderer/         渲染进程（沙箱）
│   ├── index.html      CSP + 挂载点 #root（DOM 结构由 React 生成）
│   ├── src/main.jsx    React 入口（挂载 + 加载令牌与样式）
│   ├── src/App.jsx     检索界面（React 组件；原 main.js 的逐行为对照迁移）
│   └── src/app.css     界面样式（取设计令牌，未改）
└── shared/ipc.mjs    IPC 契约唯一来源（zod 白名单 + 方法名）—— main 与将来前端共用

core/                 引擎：传输无关、零依赖（**不在这里**，刻意留在根，见 CONTRACT-engine-v1.md）
```

## 2. 命令

```powershell
npm run dev      # dev server + HMR，改渲染进程代码即时生效
npm run build    # → out/main · out/preload · out/renderer
npm start        # = electron-vite preview：跑 build 出来的产物（最接近打包态）
npm test         # 引擎单测（node:test，不经传输层）
npm run start:legacy   # 回退档：跑 app/ 里的旧外壳（只在需要对照时用）
```

`dev` / `start` 都经 `scripts/electron-vite.mjs` 转发，它会**先摘掉 `ELECTRON_RUN_AS_NODE`**：
该变量会让 Electron 以纯 Node 运行，症状是"找不到 transformers / 没有具名导出 BrowserWindow"，
极具误导性。dev 态不能靠主进程自愈（dev server 在父进程手里），所以在这一层拦掉。

## 3. 构建产物形状（可核对，不用信任本文档）

`npm run build` 后：

| 产物 | 必须是 | 为什么 |
|---|---|---|
| `out/main/index.js` | **ESM**（`package.json` 是 `type: module`） | Electron ≥28 支持 ESM 主进程 |
| `out/preload/index.cjs` | **CJS**，且只 `require('electron')` | `sandbox: true` 的渲染进程**不加载 ESM preload** |
| `out/renderer/index.html` | `<script type="module" src="./assets/…">`（**相对路径**） | 打包后是 `file://` 加载 |
| `out/main/chunks/encoder-*.js` | `import … from "@huggingface/transformers"` 保持**外部** | 原生模块（onnxruntime-node / sharp）不能进 bundle |

一条命令核对全部四项（不需要 Electron）：

```powershell
npm run build
node tools/verify_app_build.mjs      # 产物存在与形状：ESM/CJS/external/相对路径/原生模块未内联/CSP 还在
node tools/verify_renderer_dom.mjs   # 渲染进程逻辑：启动 / 搜索 / 交互（最小 DOM 桩，不需 Electron）
```
```

## 4. 日志在 `data/_app.log`

Windows 上 Electron 是 **GUI 子系统程序**：主进程 stdout **不连终端**，`console.log` 一条都看不到。
所以：主进程日志、渲染进程 console、页面加载失败、渲染进程崩溃**全部**写进
`data/_app.log`（同时尽力写 stdout，dev 态 electron-vite 会把它接回终端）。

**首次运行请把 `data/_app.log` 回传** —— 里面有：electron/chrome/node 版本、配置来源、
`thumb://` 注册、IPC 注册、引擎就绪、窗口创建、编码器载入（或载入失败原因）、渲染进程报错。

F12 可开 DevTools（生产态也保留，理由见 SPEC-security §9 决定 3）。

## 5. 这次迁移「只改工程化」——逐条交代

| 项 | 改动 | 理由 |
|---|---|---|
| 布局 | `app/{main,preload,renderer}` → `src/{main,preload,renderer}`（+ 既有 `src/shared`） | electron-vite 的约定；`core/` 与相对路径深度不变 |
| `encoder.mjs` | **逐字一致**，只多一行迁移注释 | 它的相对路径深度未变（`../../onnx-spike/…`），没有理由动它 |
| `preload` | 源语法 CJS → ESM，**产出仍是 CJS** | 由构建固定格式，比手写 `.cjs` 更难出错 |
| 渲染进程 | `renderer.js` → `src/main.js`；两张样式表改由模块 `import` | 交给 Vite 处理，去掉 HTML 里跨出 root 的 `<link>` 相对路径 |
| IPC 来源校验 | 增加 dev server 地址分支（`ELECTRON_RENDERER_URL`） | 原来的 `file://` 白名单会在 dev 态**拒绝所有 IPC**（这个坑不修，dev 一定"能开但什么都没反应"） |
| 编码器 | 静态 import → **按需动态 import** | ① 冷启动不载模型 ② 导入期失败变成**可捕获**并报给界面，而不是无声消失 |
| 日志 | `bootstrap.cjs`（CJS + 动态 import 兜底）→ `log.mjs` + 主进程自愈 | 构建工具接管了"入口"；写文件与自愈的诉求不变 |
| 主进程事件 | 新增渲染进程 console / 加载失败 / 崩溃都落日志 | 首次验收要"把日志发我"，少让用户跑一趟 |

**行为未改**：窗口姿态（`nodeIntegration:false` / `contextIsolation:true` / `sandbox:true`）、
IPC 白名单、`thumb://` 形状（只按 libId+uid 解析，不做路径拼接）、拒绝新窗口/外部导航、
关窗即退出、引擎与库的组装方式 —— 全部与 `app/` 版逐条对应。

## 6. Electron 内实跑结果（2026-10-10 · 证据 `reports/G-D-p2-electron/`）

**能跑。** 根目录 Electron 应用在 1440×920 窗口里渲染 React 界面：

- 窗口标题 `gemma-search · 素材库语义检索`；关窗即退出，无残留进程
- `[renderer] info [ui] React 已挂载 · react 19.3.0` → 渲染层在 Electron 里跑的是 React（不是旧的手写 DOM）
- `invoke indexStatus 2ms → ok` → preload 白名单 + 来源校验 + zod 校验 + 引擎，整条链路打通
- `载入模型 dtype=fp32 seq=140 device=webgpu` / `载入完成 2.4s` → **P1.5 的核心问题已答：WebGPU 在 Electron 内能起来**
- 界面显示「模型就绪 · webgpu · 2.6s」

**本环境的硬约束**：Chromium 的进程沙箱起不来，Electron 必须加 `--no-sandbox` 才能出窗
（不加则 `0x80000003` 秒退；判据见 `tools/probe_electron_start/README.md`）。
**这是承载环境的限制，不是应用的配置**。`scripts/electron-vite.mjs` 启动前会探测一次：
探测到沙箱不可用就**只为本次**附加 `--noSandbox --entry out/main/index.js` 并打印判断依据；
也可显式用 `npm run dev:restricted`（跑构建产物则是 `npm run start:restricted`）。

仍未验的（不声称可用）：

- [ ] 冷启动 ≤5 s（未计时）· 打包态（asar）内的 WebGPU（P6）
- [x] 产品态（`file://`）能出窗 —— 已实跑
- [x] 渲染层是 React 并已挂载 —— 已实跑
- [x] **WebGPU 在 Electron 内能起来** —— 已实跑
- [~] 侧栏读数：IPC 通了，但引擎报 **INDEX_MISSING**（`0/0 · dim null`）—— 索引尚未登记（P0.5-c）
- [ ] 中文检索出结果 / 缩略图零 404 —— 依赖上一条

## 7. 已知取舍与欠账（没做的也写出来）

| # | 事项 | 现状 | 何时 |
|---|---|---|---|
| 1 | `npm run typecheck` | **刻意没有这个脚本**：迁移期还是普通 JS，打开 `checkJs` 会报 222 条 `noImplicitAny`（实测），撒 `any` 只是把红灯涂绿。tsconfig 已写好，P3a 转 TS 时接上 | P3a |
| 2 | ~~界面仍是普通 JS + DOM~~ **已迁 React**（2026-10-10：`main.jsx` + `App.jsx`，`app.css` 与令牌未改） | 迁移与 React 化已经一起做完；设计系统（Tailwind + shadcn/ui + 令牌接进 Tailwind）仍是 P3a 的活 | P3a |
| 3 | `bmp_decode.mjs` / `resize_compat.mjs` 仍在 `onnx-spike/` | 打包后它们**会被 inline 进主进程 bundle**（不再是双份运行时），所以不阻塞；但源文件位置仍不合产品树。**这一轮刻意不动**：它们是索引构建 / 查询 / 应用三条路径共用的关键件，且 `data/idx-full-v2` 正是一次**进行中**的全量重建（midbuild 快照）—— 挪它要重跑跨语言金标 `tools/verify_resize.py`，那是独立的一步 | v2 归档后 |
| 4 | 打包（asar / 原生 .node / 图标） | `electron-builder.yml` 只保证形状；`asarUnpack` 未按实测补 | P6 |
| 5 | 打包态 `data/` 落在 asar 内 | `log.mjs` 会**打印警告**而不是假装没事；需改 `app.getPath('userData')` | P6 |
| 6 | `app/` 旧外壳 | **已归档**到 `archive/app-shell-20261010/`（2026-10-10）；`npm run start:legacy` 仍可跑它。没删的理由：新版还从没在你机器上跑起来过，删了就没有已知能启动的形态 | 你验证 `npm run dev` 通过后删除 |
| 7 | CSP 只设了 `meta`，没设响应头 | SPEC-security §5 要求两者都设；打包态是 `file://`，`onHeadersReceived` 根本不触发，所以不能只在 dev 加个假的 | P6 定方案 |

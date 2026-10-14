# PROJECT-INFO · gemma-search 项目信息总览

> **这份文档的定位（先读，避免变成第二份权威）**：它是**派生导航** —— 把「这个项目由哪些层、哪些命令、哪些目录、哪些 store、哪些约定、哪些文档组成」在**一页里**说清，
> 便于上手与评审。**它不是权威**：阈值以 [`spec/SPEC-acceptance.md`](spec/SPEC-acceptance.md) 为准，接口形状以
> [`spec/CONTRACT-engine-v1.md`](spec/CONTRACT-engine-v1.md) 为准，顺序以 [`plan/ROADMAP.md`](plan/ROADMAP.md) 为准，
> 怎么干活以 [`../AGENTS.md`](../AGENTS.md) 为准，未完成项以 [`../TODO.md`](../TODO.md) 为准。
> 本文件与上述任何一份冲突时，**以上述为准，并回来修本文件**（`AGENTS.md` §7.1）。
>
> | 项 | 值 |
> |---|---|
> | 生成/核对日期 | **2026-10-14** |
> | 被核对的代码 | 工作树 `ac97978`（`feat(uiux): 把 Apple Style 审查从"报告"变成治理机制 + 修完 P0 六条`），`git status` 干净 |
> | 口径 | `本轮实测` = 生成本文件时真跑过并留下原始输出（附录 B）；`静态计数` = 数源码得到、未运行；`引用既有` = 取自 `reports/` 或 `AGENTS.md` 的既有记录，**不当成本轮实测** |
> | 生成方式 | 逐文件读源码头注释 + 跑门禁命令；每条数字都有出处，未实测的写【判断，非实测】 |

---

## 1. Stack

| 层 | 技术 |
|---|---|
| 桌面外壳 | **Electron 44.7**（ESM 主进程）· `BrowserWindow` · 自定义协议 `thumb://` · `dialog` / `shell.showItemInFolder` |
| 渲染层 UI | **React 19.3** + `react-dom` 19.3 · JSX（**普通 JS，不是 TS**）· `renderer/src` 下 **42 个 `.js`/`.jsx` + 2 个 CSS**（静态计数） |
| 路由 | **react-router 7.18** —— **hash 路由**（打包态是 `file://`，history 深链会 404；`router/paths.js:8-9`） |
| 状态 | **Zustand 5.0**（vanilla `create`，**不依赖 React** ⇒ 可在纯 Node 里单测；`store/search.js:13`） |
| 样式·生成层 | **Tailwind CSS 4.3** + `@tailwindcss/vite`（`@theme inline` 把令牌映射成工具类；**故意不引 preflight**；`styles/tailwind.css:9-14`） |
| 样式·手写层 | `renderer/src/renderer.css` **418 行**（`read` 口径）；迁移前 126 条规则、T3 迁出 12 条 ⇒ **114 条未迁**（`renderer.css:6-10`） |
| 视觉令牌 | `packages/design-tokens/tokens.css` —— 生产依赖，由 `renderer/src/main.jsx` 直接 import |
| 组件原语 | 自研 `ui/*`（shadcn 风格的 `cva` 写法）：`Button` `Chip` `Field` `Metric` `Progress` `Score` `SearchBox` `Tag` `Toast` |
| 交互原语 | **Radix**：`@radix-ui/react-alert-dialog`（破坏性操作确认）· `@radix-ui/react-slot`（`asChild` 单元素渲染） |
| class 合并 | `clsx` + `tailwind-merge` = `ui/cn.js`（**全应用唯一一份**，`deps.test.mjs` D-D 钉住） |
| 契约与校验 | **zod 4**（**16 个**登记方法白名单 + 1 MB 载荷上限，`shared/ipc.ts`）+ **TypeScript 7**（仅 `.ts` 参与 `tsc`） |
| 安全桥 | `contextBridge`（preload 源码 ESM → **构建产物必须 CJS**），只暴露 `invoke` / `onEvent` / `platform` |
| 传输 | **2 条 IPC 通道**：`engine:invoke` · `engine:event`（`shared/ipc.ts:19-20`） |
| 引擎 | **Node ESM**，`packages/engine`，**零第三方依赖**（`dependencies: {}`，是架构决策不是遗漏）；`engine.mjs` 约 590 行 + 事务模块 6 文件 |
| 语义编码 | `@huggingface/transformers` 4.3（ONNX Runtime）· **WebGPU 优先 / CPU 回退** · dtype `fp32` · `seq` 70/140/280 · **dim 768** |
| 图像预处理 | `sharp` 0.35（resize，对齐 PIL 参考实现）· `bmp-js` 0.1（BMP 回退，**动态 `await import`** ⇒ 依赖清账脚本必须能看见动态 import，`deps.test.mjs` D-C） |
| 索引构建 | `packages/indexer/src` 11 个 `.mjs`：`build_index_onnx.mjs`（约 590 行）· `encode_queries.mjs` · `resize_compat.mjs` · `bmp_decode.mjs` + 7 个探针/一次性验证脚本 |
| 数据格式 | `data/libraries/<libId>/{index.bin(float32), items.json, meta.json}`；契约样例 `fixtures/sample-index.json` |
| 测试 | **`node:test`**：`npm test` **本轮实测 `tests 313 · pass 312 · fail 0 · skipped 1`**（88.6 s）+ **Playwright 1.64**：12 个 spec 文件 / **62 条（静态计数）**，真启动 Electron |
| 构建/打包 | **electron-vite 5** + Vite 7 + `@vitejs/plugin-react` · **electron-builder 26**（`electron-builder.yml` 只保证形状，**未产出安装器**，P6 欠账） |
| 语言/运行时 | `.mjs`（引擎/主进程/脚本）· `.ts`（契约边界）· `.jsx`/`.js`（渲染）· package.json `engines.node >= 20`；本机实测 Node v24 |
| 日志 | 主进程日志 + 渲染进程 console 全部写 `data/_app.log`（Windows 上 Electron 无 stdout，`main/log.mjs`） |
| 文档/证据体系 | `docs/`（spec·design·guide·plan·audit·archive）+ `reports/G-*`（**无归档证据 = 门禁未通过**） |

---

## 2. 项目模式（MVC）

⚠️ 本项目**不用** `component / command / repos / service` 这套命名。实际是**四层**（比经典 MVC 多一层 Adapter），并且**有机械断言**：
`apps/desktop/tests/layering.test.mjs` 的 L1–L7。

```
UI(组件) ──> Operation(store/hooks/utils) ──> Adapter(唯一 invoke 入口) ──> Data(主进程/引擎)
```

| 经典 MVC 词 | 本项目对应 | 实际目录/文件 | 纪律（违反 ⇒ `npm test` 判红） |
|---|---|---|---|
| **UI**（component/view） | 渲染层 | `renderer/src/pages/**`（6 页）· `layout/**`（5）· `ui/**`（11）· `search/**`（5）· `App.jsx` · `main.jsx` · `renderer.css` · `styles/tailwind.css` | ❌ 不得碰 `window.api`；❌ 不得直接 import Adapter；不得写业务规则（L1/L2/L3） |
| **Operation**（store / composable / utils） | Operation 层 | `store/search.js`（检索 + 取件确认状态机）· `store/tasks.js`（进度事件归约）· `hooks/useEngine.js` `useLibraryConfig.js` `useToast.js` · `utils/{gate,index-state,item-actions,format}.js` · `utils/useDocumentTitle.js` · `router/**` | ❌ 零 `window.api`（L4）；不散落协议细节（协议归 Adapter）；**领域判断不得写进 `.jsx`** —— `.jsx` 在 `node:test` 里加载不了，塞进去等于放弃自动化 |
| **（模板没有的第 3 层）Adapter** | 传输适配 | **`adapter/api.js`（全应用唯一一份）** | 唯一解包 `{ok,data,warnings}` / `{ok:false,error}` 处；`userMessage` **恒非空**；**永不抛异常**；不 import React（L1/L5/L6） |
| **Data**（command / repo / service） | 主进程分派 + 引擎服务 | **command** = `main/index.mjs` 的 `registerIpc`（来源校验 → zod 白名单 → 显式分派；不经引擎的方法在此显式处理）· **repo/service** = `packages/engine/src/**`（`engine.mjs` + `library/index/compat/errors/fingerprint/fake/transactions`）· **索引/编码** = `packages/indexer/src/**` · **端口注入** = `main/{encoder,ports,thumb-url,library-config,log}.mjs` | 引擎**零依赖、不 import `electron`/`http`**；渲染进程拿不到 `ipcRenderer`、拿不到任意绝对路径入参 |

**视图流**：`main.jsx` → `App.jsx` → `LibraryGate.jsx`（有库 ⇒ `AppShell` + 路由；无库 ⇒ `FirstRunWizard`）→ 4 条路由
`/` · `/item/:libId/:uid` · `/tasks` · `/activity`；路径与页面名的**唯一来源**是 `router/paths.js`，组件映射与启动期断言在 `router/index.jsx`。

---

## 3. Commands

### 3.1 现行 npm 脚本（`package.json:15-27`）

| 命令 | 用途 |
|---|---|
| `npm install` | 装依赖（卡在 electron 二进制 → 见 3.4） |
| `npm run dev` | electron-vite dev server + HMR（经 `scripts/electron-vite.mjs`） |
| `npm run dev:restricted` | 受限环境 = `dev --noSandbox --entry out/main/index.js` |
| `npm run build` | 三端构建 → `out/{main,preload,renderer}` |
| `npm start` | `preview`：跑 build 出来的产物（最接近打包态） |
| `npm run start:restricted` | 受限环境的 preview |
| `npm run build:unpack` | `build && electron-builder --dir`（P6，未产出） |
| `npm run build:win` | `build && electron-builder --win`（P6，未产出） |
| `npm test` | `node --test --test-isolation=none "packages/engine/tests/*.test.mjs" "apps/desktop/tests/*.test.mjs"` |
| `npm run test:watch` | 同上 + `--watch` |
| `npm run e2e` | `playwright test -c apps/desktop/e2e/playwright.config.mjs`（真启动 Electron，沙箱内需提权） |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`（**只覆盖 `.ts`**；本轮实测 EXIT=0） |

### 3.2 单测子集与自检（开发期常用）

```powershell
node --test --test-isolation=none apps/desktop/tests/layering.test.mjs   # 单个断言文件
node --check <任意 .mjs>                                                # 语法自检
node -e "…"                                                             # 行号/规模测量（别用 Get-Content 定位行号）
```

### 3.3 守卫与索引（`AGENTS.md` §3；守卫本机沙箱跑不动）

```powershell
# 只读守卫（现存 2 个）
node tools/verify_encoder_path.mjs --model <ONNX 模型目录> [--index data/idx-full-v2] [--device webgpu] [--text "北欧吊灯"]
node tools/check_search.mjs --lib <素材库根> [向量文件]        # 或先设 GEMMA_LIB_ROOT

# 索引与查询向量
node packages/indexer/src/build_index_onnx.mjs --model <ONNX 模型目录> --lib <素材库根> --out data/idx-full --seq 140 --device webgpu --lib-id L1
node packages/indexer/src/encode_queries.mjs --model <目录> --in queries.json --out vectors.json [--seq 140] [--device webgpu]
```

同目录其余脚本（各有用途，均为一等命令）：`spike_onnx.mjs` · `spike_device.mjs` · `check_resize_golden.mjs --manifest <m.json> --out <r.json> [--kernel cubic]` ·
`diagnose_resize_kernel.mjs --model <d> --in <l.json> --out <r.json>` · `probe_resize_pixels.mjs <图> <w> <h> <前缀>` · `probe_proc_shape.mjs` · `test_mismatch.mjs` · `verify_bmp2.mjs`。

### 3.4 首次安装 / 排障

```powershell
git clone https://github.com/IKBlue/gemma-search.git
cd gemma-search ; npm install
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'   # 二进制下载失败时
node node_modules/electron/install.js
git config core.quotepath false        # 中文文件名不显示成八进制转义
git config core.autocrlf false         # 行尾交给 .gitattributes
node -v

# 「Electron 起不来」定性（判读表见 tools/probe_electron_start/README.md）
$env:ELECTRON_RUN_AS_NODE = $null
.\node_modules\electron\dist\electron.exe tools\probe_electron_start
type tools\probe_electron_start\probe.log

# 归档外壳（只作对照，不是受支持入口）
electron docs/archive/legacy/app-shell-20261010/main/bootstrap.cjs

# 重建 Apple UI Kit 参照站
node docs/design/ui-kit/build.mjs [--kit "<Apple macOS UI Kit 目录>"]
```

### 3.5 环境变量（配置入口，grep 自源码）

| 变量 | 作用 | 出处 |
|---|---|---|
| `GEMMA_LIB_ROOT` | 库根（第 1 优先级） | `main/index.mjs:147` · `main/library-config.mjs` |
| `GEMMA_COLLECT_DIRS` | 取件目录白名单（第 1 优先级） | `main/index.mjs:150` |
| `GEMMA_CONFIG` | 兼容回退配置文件路径 | `main/index.mjs:115` |
| `GEMMA_FAKE=1` | **模拟模式**（读 `fixtures/sample-index.json`，只由显式变量打开） | `main/index.mjs:52` |
| `GEMMA_ROOT` | 仓库根覆盖 | `main/log.mjs:81` |
| `GEMMA_APP_LOG` | 日志文件路径覆盖 | `main/log.mjs:83` |
| `GEMMA_ONNX_MODEL` | 模型目录（守卫/索引脚本的默认值） | `tools/verify_encoder_path.mjs:37` · `indexer/src/encode_queries.mjs:27` |
| `GEMMA_GPU_MODEL` / `GEMMA_GPU_DRIVER` | DirectML/GPU 后端选择 | `indexer/src/build_index_onnx.mjs:116-117` |
| `ELECTRON_MIRROR` / `ELECTRON_RUN_AS_NODE` | 框架侧（后者会被启动助手摘掉） | `README.md:49` · `scripts/electron-vite.mjs:48` |

### 3.6 已移除、**勿写入新文档**（`AGENTS.md` §3）

`node tools/verify_app_build.mjs` · `verify_main_wiring.mjs` · `verify_renderer_dom.mjs` · `verify_renderer_styles.mjs` · `smoke_app.mjs` · `verify-doc-refs.mjs`
—— 2026-10-13 按所有者指令移除，原件备份在 `data/_removed-guards-backup/`。

---

## 4. Architecture

```
gemma-search/
├─ package.json                  # workspaces 根 · 11 个 npm 脚本 · 运行时依赖唯一声明处 · main=./out/main/index.js
├─ electron.vite.config.mjs      # 三段显式 outDir → <仓库根>/out/{main,preload,renderer}；dependencies 全 external
├─ electron-builder.yml          # 打包配置（仅形状，未产出安装器）
├─ tsconfig.json/.node/.web      # 两段 TS 工程；checkJs=false ⇒ 只有 .ts 参与检查
├─ README.md                     # 项目是什么 · 状态 · 怎么跑（⚠️ 状态节已过期，见附录 A）
├─ AGENTS.md                     # 治理宪章 + 三层架构 + 放置规则 + 权威关系 + 门禁 + 写作纪律
├─ TODO.md                       # 唯一行动清单（待修 BUG / 未完成项 / 防回归）
├─ 违规的UI.md                    # UI/UX 违规唯一详表 V-01…V-42（根目录已登记例外）
├─ apps/desktop/                 # Electron 应用（主战场）
│  ├─ src/main/                  # 主进程：命令分派 + 能力注入
│  │  ├─ index.mjs               # 597 行：组装引擎 · 注册 2 条 IPC · thumb:// · 窗口姿态 · FAKE 模式 · 拒绝未实现方法
│  │  ├─ encoder.mjs             # 编码器端口：ONNX + WebGPU → {encodeText, encodeImage}，含 BMP 回退
│  │  ├─ library-config.mjs      # 库根/取件目录四路解析 + userData 注册表读写（D2 / F-04 修复）
│  │  ├─ log.mjs                 # 日志必须写文件 data/_app.log + 仓库根探测（解析不出会打横幅）
│  │  ├─ ports.mjs               # 注入引擎的能力端口（shell.showItemInFolder，F-01）
│  │  ├─ thumb-url.mjs           # thumb://<libId>/<uid>@<size> 形状解析 + 尺寸白名单
│  │  └─ window-security.mjs     # 来源判定 / 新窗口 / 导航 三个决策（S11 / S12 / S13）
│  ├─ src/preload/index.js       # 安全桥：只暴露 invoke / onEvent / platform（源 ESM → 产物 .cjs）
│  ├─ src/shared/ipc.ts          # ★ IPC 契约唯一来源：16 方法 zod 白名单 + 编译期类型 + validateCall（213 行）
│  ├─ src/renderer/
│  │  ├─ index.html              # CSP(meta) + 挂载点 #root
│  │  └─ src/
│  │     ├─ main.jsx             # 入口：挂载 + 按序引入 tokens.css → tailwind.css → renderer.css
│  │     ├─ App.jsx              # 应用根：只挂 LibraryGate
│  │     ├─ adapter/api.js       # ★ Adapter：全应用唯一 window.api 入口；永不抛；userMessage 恒非空（126 行）
│  │     ├─ router/              # paths.js（路由/文案唯一来源，纯数据）· index.jsx（组件映射 + 启动期断言）
│  │     ├─ store/               # search.js（检索状态 + 取件确认）· tasks.js（进度事件归约，纯函数）
│  │     ├─ hooks/               # useEngine.js（invoke / 事件订阅 / indexStatus）· useLibraryConfig.js · useToast.js
│  │     ├─ utils/               # gate.js · index-state.js · item-actions.js · format.js · useDocumentTitle.js
│  │     ├─ layout/              # AppShell · Sidebar · Topbar · Main · PageHead
│  │     ├─ search/              # SearchPanel · MetricsRow · Gallery · PhotoCard · SearchSidebar
│  │     ├─ pages/               # LibraryGate · FirstRunWizard · SearchPage · ItemPage · TasksPage · ActivityPage
│  │     ├─ ui/                  # Button Chip Field Metric Progress Score SearchBox Tag Toast ConfirmDialog cn.js
│  │     ├─ renderer.css         # 手写层 418 行（126 → 114 条未迁）
│  │     └─ styles/tailwind.css  # 生成层入口：@theme inline 映射令牌；不引 preflight
│  ├─ tests/                     # node:test 18 个 *.test.mjs（分层/样式/依赖/契约/安全/路由/store/文案/对比度…）+ helpers/
│  └─ e2e/                       # Playwright 12 spec + helpers(launch/app/engine-stub) + fixtures/lib-mini
├─ packages/
│  ├─ engine/                    # 引擎：零第三方依赖（dependencies:{}）
│  │  ├─ src/engine.mjs          # 约 590 行主体：方法实现 + UNIMPLEMENTED_METHODS 单一定义
│  │  ├─ src/library.mjs         # 库注册表 + 安全路径解析
│  │  ├─ src/index.mjs           # index.bin 读取与强校验
│  │  ├─ src/compat.mjs          # 兼容性判定键（合并检索的门槛）
│  │  ├─ src/errors.mjs          # 错误码与结果信封
│  │  ├─ src/fingerprint.mjs     # 库指纹 v1
│  │  ├─ src/fake.mjs            # 契约 §8 模拟模式
│  │  └─ src/transactions/       # P4 地基：states · journal · executor · recovery · steps · hash
│  ├─ indexer/src/               # build_index_onnx · encode_queries · resize_compat · bmp_decode + 7 个探针
│  └─ design-tokens/tokens.css   # 视觉令牌唯一来源（生产资产）
├─ docs/                         # 全部正文文档（见 §7）
├─ fixtures/                     # sample-index.json（契约 §8 样例）· lib-a/（P4 事务夹具库 32 文件 / 6 目录）
├─ tools/                        # 2 个只读守卫 + probe_electron_start/（最小 Electron 探针 + 判读表）
├─ scripts/electron-vite.mjs     # 启动辅助：摘 ELECTRON_RUN_AS_NODE · 探测沙箱 · 失败带参重试
├─ reports/                      # 门禁证据：G-B-20261010(-v2) · G-D-20261013 · G-D-p2-electron
├─ build/ · resources/ · reference/   # 打包图标+签名 · 空资源目录 · 官方模型卡（只读）
└─ data/ · out/ · node_modules/  # 索引与日志(不进 git) · 构建产物(不进 git) · 依赖
```

---

## 5. Store Architecture

⚠️ 先说结论：**项目没有任何 `zustand/persist`，也没有 `localStorage` / `sessionStorage`**（全仓 grep 零命中）——
⇒ 渲染层 store 的 **persist key 全部为空**，刷新即回初始态；**真正的持久化在主进程侧**。

| store | file | persist key | purpose |
|---|---|---|---|
| `useSearchStore` | `renderer/src/store/search.js`（155 行） | **无**（无 persist、无 storage） | 检索状态：`mode/query/folder/sort/busy/meta/rawResults/error/queryImagePath`；动作 `run/reveal/collect/clear`；**破坏性操作确认状态机** `pendingCollect` + `requestCollect/cancelCollect/confirmCollect`（取消 ⇒ **零 IPC**，断言 Z13–Z17）。另导出纯函数 `sortResults` / `FOLDERS` / `CHIPS` |
| `useTaskStore` | `renderer/src/store/tasks.js`（188 行） | **无**（进度是主进程推来的事件流，内存归约） | 索引任务进度：纯函数 `reduceEvent`（`index.progress` **单调不减** / `index.done` / `index.failed`）+ `PHASES` 五步 + `progressPercent` / `etaText` / `outcomeSummary`；动作 `applyEvent/begin/reset` |
| （对照·非 store）`useLibraryConfig` | `renderer/src/hooks/useLibraryConfig.js` | 无（`useState`） | 读「库从哪来」的解析结果 + 首启向导 `pickDir` / `addLibrary` |
| （对照·非 store）`useIndexStatus` | `renderer/src/hooks/useEngine.js` | 无（`useState`） | 启动信息：库 + 索引健康度（`indexStatus`） |
| （对照·非 store）`useToast` | `renderer/src/hooks/useToast.js` | 无（`useState` + 定时器） | 轻提示：消息 + 语气 + 自动消失（错误 toast 不自动消失，V-16） |

**真正的持久化位置（不在渲染层）**

| 数据 | 位置 | 写入方 |
|---|---|---|
| 库注册表 | `userData/library-registry.json` | `libraryAdd` → `saveRegistry`（`main/library-config.mjs`） |
| 兼容回退配置 | `config.json`（`GEMMA_CONFIG` 可覆盖） | 用户/历史配置，**不要求配** |
| 索引自举源 | `data/libraries/*/meta.json`（含 `lib_id` + `lib_root`） | 索引构建 ⇒ **有索引即零配置可用** |
| 诊断日志 | `data/_app.log` | 主进程 + 渲染进程 console 转发 |

⚠️ **多库注册表没有界面入口**（P5 欠账）——「多库不是真的」，现状是「从配置派生单库」，见 [`../README.md`](../README.md) §4 与 [`../TODO.md`](../TODO.md) B 节。

---

## 6. Convention

| # | 约定 | 出处 / 强制方式 |
|---|---|---|
| C1 | **单一事实来源**：同一概念只有一份实现/定义；发现两处不一致**改错的那处**，不要两处各改一半 | `AGENTS.md` §0.1 P1、§7.1 权威关系表 |
| C2 | **禁止复制粘贴**：同段逻辑（哪怕有细微差异）出现在 ≥2 处 ⇒ 提取共享模块再复用 | §0.1 P2；`layering.test.mjs` **L6**（文案兜底只许一处）· `deps.test.mjs` **D-D**（`cn` 只许一份） |
| C3 | **禁止硬编码应可配置的值**：绝对路径 / 目录 / 端口 / 上限 / 超时 ⇒ 配置或环境变量 | §0.1 P3；解析链 `GEMMA_LIB_ROOT` > 注册表 > `config.json` > 规格兜底 |
| C4 | **分层**：UI → Operation → Adapter → Data；`window.api` **只允许**出现在 `adapter/api.js` | `AGENTS.md` §2；`layering.test.mjs` L1–L7 + `source-scan.test.mjs`（扫描器**区分代码与注释**） |
| C5 | **领域判断不进 `.jsx`**（`.jsx` 在 `node:test` 里加载不了 ⇒ 等于放弃自动化） | `AGENTS.md` §2；`utils/{gate,index-state,item-actions}.js` 即为此抽出 |
| C6 | **命名与文件类型**：引擎/主进程/脚本 `.mjs`；契约边界 `.ts`；preload **产物** `.cjs`；渲染 `.jsx`/`.js`；测试 `*.test.mjs`；文档约束类大写主题名（`SPEC-`/`DESIGN-`/`CONTRACT-`）、过程类小写连字符；CSS 令牌 `--kebab-case` 只在 `tokens.css` | `AGENTS.md` §4 |
| C7 | **样式**：新样式优先 Tailwind 类；数字走令牌阶梯（`--spacing: var(--space-1)` ⇒ `px-3` = `--space-3`，**禁用任意值** `px-[11px]`）；颜色**不许写死**（用 `bg-surface`/`text-ink`）；修饰态写**互斥**不写叠加；`<Button asChild><Link/></Button>`；新页面必须 `useDocumentTitle(LABELS.x)` | §3；`styles.test.mjs` T1/T1c/T2 · `dom-validity.test.mjs` V1/V2 · E2E E4/E6 |
| C8 | **注释写"为什么"**：写清踩过的坑与反例；必须区分 **① 代码事实 · ② 文档声称 · ③ 行业做法** | `AGENTS.md` §0 / §6.1；全仓文件头注释即范例 |
| C9 | **结论可追溯**：每条带 `文件:行号` 或「命令 + 原始输出」；无证据写【判断，非实测】；引用旧证据写「引用既有证据」 | §6 |
| C10 | **定位行号只用 `read` 工具或 node**：PowerShell `Get-Content` 按 GBK 解码 UTF-8 中文会拆坏并**合并行**（实测差 47–88 行） | §6 |
| C11 | **测试纪律**：`node:test` 跟着被测包走；新断言必须**双向验证**（拆掉防线 ⇒ 必须变红）；E2E 放 `e2e/`，启动参数集中在 `helpers/launch.mjs` | §3 · §4；本轮实测 313 条 |
| C12 | **安全**：检索**不写素材库**（只读）；引擎零依赖、不 import `electron`/`http`；渲染进程无 `ipcRenderer`、无任意绝对路径入参；**不把 `--no-sandbox` 固化进产品** | `AGENTS.md` §6.5 |
| C13 | **门禁与证据**：`npm test` / `npm run build` / `npm run typecheck` / `npm run e2e` 各自独立报数，不许用"测试全绿"含糊过去；**无归档证据 = 门禁未通过** | §3、`reports/README.md` |
| C14 | **文档写作**：正文放 `docs/`；仓库根只留 `AGENTS.md` + `README.md` + `TODO.md`（+ 已登记例外 `违规的UI.md`）；引用写**仓库根相对**路径，不写 `../` | §2 / §6（⚠️ 原 `verify-doc-refs` 守卫 2026-10-13 已移除 ⇒ **现无自动化**，只能靠人看） |
| C15 | **不自动 `git commit` / `push`**，除非所有者明确要求 | §7 |

---

## 7. document

| 文档 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 项目是什么 · 当前状态 · 快速开始 · 验证命令 · 索引 · 已知边界 · 文档导航 |
| [`../AGENTS.md`](../AGENTS.md) | **唯一权威「工作指南」**：治理宪章、禁止项、三层架构、目录职责表、东西放哪儿、权威关系表、门禁与验收、写作纪律、术语表 |
| [`../TODO.md`](../TODO.md) | **唯一行动清单**：A 已修 BUG（逐条带证据与复现命令）· B 未完成项 · C 缺证据项 · T1–T5 迁移记录（470 行） |
| [`../违规的UI.md`](../违规的UI.md) | **UI/UX 违规唯一详表** `V-01…V-42`（报告只引用编号；已登记为根目录例外） |
| [`README.md`](README.md) | 文档索引 + 权威关系 + 目录地图 + 门禁证据 + 改文档纪律 |
| [`MIGRATION-PLAN.md`](MIGRATION-PLAN.md) | monorepo 重构执行依据（`apps/` + `packages/` 结构已冻结） |
| [`DEBT-CLEANUP.md`](DEBT-CLEANUP.md) | 历史欠账台账（已清 / 未清逐条，含陈旧记录） |
| [`spec/SPEC-app.md`](spec/SPEC-app.md) | 应用规格：目标、成功标准、技术栈、边界 |
| [`spec/CONTRACT-engine-v1.md`](spec/CONTRACT-engine-v1.md) | 引擎接口契约：19 错误码 · 方法形状 · 事件 · 恢复 · §8 模拟模式 |
| [`spec/SPEC-identity.md`](spec/SPEC-identity.md) | 身份与配对：`uid`、文件身份、库指纹、索引格式 |
| [`spec/SPEC-security.md`](spec/SPEC-security.md) | 威胁模型、IPC 白名单、渲染进程姿态、**明确不防的边界**、权限用例 |
| [`spec/SPEC-transactions.md`](spec/SPEC-transactions.md) | 文件事务、四步纪律、撤销、并发与崩溃恢复（地基已实现，`ingest`/`mutate` 未接线） |
| [`spec/SPEC-acceptance.md`](spec/SPEC-acceptance.md) | **验收阈值 / 性能口径 / 门禁的唯一出处** |
| [`design/DESIGN-tokens.md`](design/DESIGN-tokens.md) | 视觉令牌说明（可执行版 `packages/design-tokens/tokens.css`） |
| [`design/DESIGN-app-details.md`](design/DESIGN-app-details.md) | 详细设计：UI、库管理、索引、入库流程 |
| [`design/UI-REVIEW-and-migration.md`](design/UI-REVIEW-and-migration.md) | **UI 以它为准**：界面评审与迁移路线（含流程 1–4 与键盘） |
| [`design/UI-KIT.md`](design/UI-KIT.md) | Apple macOS UI Kit **基线数值 + 应用对差**（参照物，不是令牌来源，不定义应用令牌） |
| [`design/ui-kit/`](design/ui-kit) | 可执行参照站：`build.mjs`（生成器，唯一实现）+ `kit-data.json`（527 KB 数据快照）+ `index.html`（1.2 MB 派生物） |
| [`guide/GETTING-STARTED.md`](guide/GETTING-STARTED.md) | 从克隆到跑起来（含 electron 镜像、git 配置） |
| [`guide/TROUBLESHOOTING.md`](guide/TROUBLESHOOTING.md) | 常见故障与判读（先看 `data/_app.log`；起不来用 `tools/probe_electron_start/`） |
| [`plan/ROADMAP.md`](plan/ROADMAP.md) | **做什么、什么顺序、什么算做完**（阶段 / 门禁 / 交付物 / 风险，含 §10 迁移验收） |
| [`plan/DOCS-REQUIREMENTS.md`](plan/DOCS-REQUIREMENTS.md) · [DESIGN](plan/DOCS-DESIGN.md) · [IMPLEMENTATION](plan/DOCS-IMPLEMENTATION.md) · [TESTING](plan/DOCS-TESTING.md) · [DEPLOYMENT](plan/DOCS-DEPLOYMENT.md) | 五份阶段文档（需求/设计/实现/测试/部署）；性质是**收敛与索引**，阈值与顺序仍以 spec / ROADMAP 为准 |
| [`audit/00-current-state.md`](audit/00-current-state.md) | **现状事实基线**（只有 Lead 能改） |
| [`audit/01-acceptance-criteria.md`](audit/01-acceptance-criteria.md) | 冻结判据：G1–G7 · 严重度口径 · S1–S10 / U1–U10 |
| [`audit/AUDIT-FINAL.md`](audit/AUDIT-FINAL.md) · [`STACK-AUDIT.md`](audit/STACK-AUDIT.md) · [`UIUX-AUDIT.md`](audit/UIUX-AUDIT.md) | 三份汇总报告（最终 review / 技术栈 / UIUX，冻结批次） |
| [`audit/UIUX-APPLE-STYLE-AUDIT.md`](audit/UIUX-APPLE-STYLE-AUDIT.md) | **当前 4 页 + Tailwind/Radix 之后**的 Apple Style 全新审查：42 条违规（Critical 1 / High 8 / Medium 22 / Low 11）+ 逐条改法（889 行） |
| [`audit/stack-evidence.md`](audit/stack-evidence.md) · [`uiux-evidence.md`](audit/uiux-evidence.md) · `REVIEW-*.md` | 两份证据附录 + 独立复核记录 |
| [`archive/`](archive) | **已失效/历史**：`legacy/`（旧计划 · 旧外壳 · 原 PROJECT-GUIDE）· `prototype/`（原型套件）· `spike/`（选型证据）——「不再是依据」 |
| [`../reference/MODEL_CARD.md`](../reference/MODEL_CARD.md) | 官方模型卡（前缀 / `seq` / 精度上限依据；外部资料，只读） |
| [`../reports/README.md`](../reports/README.md) | 门禁证据协议 + `G-B-20261010(-v2)` · `G-D-20261013` · `G-D-p2-electron` 索引 |
| [`../apps/desktop/src/README.md`](../apps/desktop/src/README.md) · [`../apps/desktop/src/renderer/README.md`](../apps/desktop/src/renderer/README.md) | 应用主体 / 渲染层的就地说明（⚠️ 部分内容已过期，见附录 A） |
| [`../fixtures/lib-a/README.md`](../fixtures/lib-a/README.md) · [`../tools/probe_electron_start/README.md`](../tools/probe_electron_start/README.md) | P4 夹具库复现配方 · Electron「起不来」判读表 |
| [`PROJECT-INFO.md`](PROJECT-INFO.md) | **本文件**：Stack · MVC · Commands · Architecture · Store · Convention · 文档索引（派生导航，非权威） |

---

## 附录 A · 文档 ↔ 代码一致性核对（6 处：2 处已修 · 4 处未修；另有 1 处补充已修）

> 这只是**核对记录**，不是行动清单 —— 行动项归属 [`../TODO.md`](../TODO.md)（单一事实来源）。
> 每条都给 `文件:行号` + 实测/代码证据。

| # | 文档声明 | 代码/实测事实（证据） |
|---|---|---|
| A1 | `README.md:20`「测试期望 90 项 · 89 过」；`README.md:96`「`npm test` 164 条 · `e2e` 13 条」 | **本轮实测 `tests 313 · pass 312 · fail 0 · skipped 1`**（附录 B.1）；e2e 按 spec 文件**静态计数 62 条**（附录 B.3） |
| A2 | `README.md:24`「`App.jsx` 只挂了 `<SearchPage />`，其余页面未做」 | `App.jsx:10` 只挂 `LibraryGate`；`router/paths.js:12-17` 已有 4 条路由，`pages/{ItemPage,TasksPage,ActivityPage}.jsx` 均存在 |
| A3 | ✅ **已修（2026-10-14）** —— 原（旧 §5.1）：`AGENTS.md` 期望 `tests 300 · pass 299 · fail 0 · skipped 1` | 本轮实测 **313 / 312 / 0 / 1**（新增 `contrast` **4** / `copy` **5** / `style-contract` **4**，共 13 条）。`AGENTS.md` §3 已改为实测值（引擎 148 · 桌面 **165**）+ 取数命令 |
| A4 | ✅ **已修（2026-10-14）** —— 原：`AGENTS.md` 附录 A 把 `thumbPath` 列为 IPC 方法 | `shared/ipc.ts:27-144` 的 `Methods` 实为 **16 个**（13 引擎 + 3 库配置）；`thumb://` 是**协议**不是 IPC 方法。附录 A 已按源码重列（附取数命令），并注明旧版枚举出 **14** 个名字却写"13 个" |
| A5 | `apps/desktop/src/README.md:116`「刻意没有 typecheck 脚本」；`:117`「Tailwind / shadcn / zustand / Radix 均未接入」 | `package.json:24` 已有 `typecheck`（本轮 **EXIT=0**）；`package.json:60-71` 已含 `zustand`、`@radix-ui/react-alert-dialog`、`@radix-ui/react-slot`、`tailwindcss`、`tailwind-merge` |
| A6 | `apps/desktop/src/renderer/README.md:31` 指 `hooks/useSearch.js`、`ui/cx` | 二者均已删除：现为 `store/search.js` 与 `ui/cn.js`（P1 收口；`deps.test.mjs` **D-D** 钉住「`ui/` 下只允许 `cn.js` 一份」） |

补充（同类，未计入上表）：`docs/README.md:14` 写「仓库根只留两份 `.md`」，实际有 4 份（`README.md` / `AGENTS.md` / `TODO.md` + 已登记例外 `违规的UI.md`）——`AGENTS.md` §4 已更新，`docs/README.md` 未跟上。✅ **已修（2026-10-14）**：`docs/README.md` §1 目录地图与 §5 已改为「三份 + 1 例外」，根部清单补齐 `TODO.md` 与例外项。

---

## 附录 B · 本轮实测原始输出（2026-10-14）

### B.1 `npm test`

```text
ℹ tests 313
ℹ suites 0
ℹ pass 312
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 88645.9133
[exit code: 0]
```

那 **1 条跳过是环境限制**：本环境无法创建**文件**符号链接（`EPERM`），断言的是「库内指向库外的符号链接必须被拒」，
在能建链接的机器上会真跑（`packages/engine/tests/security.test.mjs` ④）。

### B.2 `npm run typecheck`

```text
> gemma-search@0.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
EXIT=0
```

⚠️ 它**只覆盖 `.ts`**（当前唯一一个有内容的来源是 `shared/ipc.ts`）；两个 tsconfig 的 `checkJs` 仍为 `false`，
`.js`/`.jsx`/`.mjs` 一律不参与检查 ⇒ **不得声称"全局类型检查通过"**（打开后是渲染层 148 错 / 主进程侧 472 错，见 `docs/plan/ROADMAP.md` §10.1.1）。

### B.3 `npm run e2e` 用例静态计数（**未运行**，数 `test(` 得到）

| spec 文件 | 条数 |
|---|---|
| `smoke.spec.mjs`（E0） | 1 |
| `gate.spec.mjs`（E1） | 3 |
| `routing.spec.mjs`（E2/E6） | 9 |
| `window-security.spec.mjs`（E3） | 4 |
| `styles.spec.mjs`（E4） | 5 |
| `a11y.spec.mjs`（E5） | 4 |
| `confirm-dialog.spec.mjs`（E7） | 6 |
| `fake-mode.spec.mjs`（E8） | 6 |
| `item-detail.spec.mjs`（E9） | 6 |
| `tasks.spec.mjs`（E10） | 6 |
| `activity.spec.mjs`（E11） | 6 |
| `uiux-p0.spec.mjs`（E12，最新提交新增） | 6 |
| **合计** | **62** |

⚠️ `AGENTS.md` §3 记的是 **2026-10-13 实测 `56 passed`**（= 上表去掉 E12 的 6 条），本轮**未复跑 E2E**（需能出窗的环境 + 提权）。

### B.4 其余静态数字的取法

| 数字 | 取法 |
|---|---|
| 渲染层 42 个 `.js`/`.jsx` + 2 个 CSS | 遍历 `apps/desktop/src/renderer/src` 按扩展名计数 |
| 11 个 npm 脚本 | `package.json:15-27`：dev · start · build · build:unpack · build:win · test · test:watch · e2e · typecheck · dev:restricted · start:restricted |
| apps/desktop/tests 18 个 `*.test.mjs` | 按 `tests/*.test.mjs` 计数（不含 `helpers/source-scan.mjs`） |
| 16 个 IPC 方法 | `shared/ipc.ts` 的 `Methods` 键（运行时经 `METHOD_NAMES` 导出） |
| 2 条 IPC 通道 | `shared/ipc.ts:19-20` |
| `renderer.css` 418 行 · `main/index.mjs` 597 行 · `shared/ipc.ts` 213 行 | `read` 工具的分页总数（**不是** PowerShell `Get-Content`） |

---

## 维护约定（改本文件时一起做）

1. 本文件**不复制权威内容**：阈值、契约形状、顺序、未完成项一律指向上游，改上游时回来改引用。
2. 与代码有关的数字（脚本数、方法数、测试数、文件数）必须**可复跑**，并在改动后重新实测（附录 B 同步）。
3. 新增/删除正文文档时，**同时**更新 §7 与本文件在 [`README.md`](README.md) §1 目录地图里的登记 —— 两边必须一致（`AGENTS.md` §0.1 R2）。

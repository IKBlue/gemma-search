# gemma-search

本地素材库的**离线语义检索**桌面应用：用中文描述找图、以图搜图，命中后给出同名模型压缩包的绝对路径。

- **模型**：`google/embeddinggemma-2`（多模态，统一 **768 维**空间）
- **形态**：Electron 桌面窗口 + **零第三方依赖**的 Node ESM 引擎 + ONNX/WebGPU 编码
- **全离线**：不联网、不上传、不调用云服务；检索**绝不写素材库**（结果只是路径）

> 🧭 **要动手改代码/文档？先读 [`AGENTS.md`](AGENTS.md)** —— 目录职责、东西该放哪儿、权威关系、门禁与写作纪律。
> 本文只讲「是什么 · 现在什么状态 · 怎么跑 · 怎么验」。

**仓库布局**（monorepo，npm workspaces）：`apps/desktop`（Electron 应用）· `packages/engine`（引擎 + 单测）· `packages/indexer`（索引构建与重采样兼容层）· `packages/design-tokens`（视觉令牌唯一来源）· `docs/`（全部正文文档）· `tools/`（只读守卫）。

---

## 0. 当前状态（先读这一节）

| | 状态 |
|---|---|
| **引擎** `packages/engine/` | ✅ 测试期望 `90 项 · 89 过 · 0 失败 · 1 跳过`（引擎 74 + 桌面 16）。**那 1 项跳过是环境限制**（无法建文件符号链接）；原先另有 2 项"永久跳过"，D2 修复后已复活，见 §4 |
| **桌面外壳** `apps/desktop/` | ✅ 已在 Electron 内实跑出窗（React 渲染 + WebGPU 编码器载入，证据 `reports/G-D-p2-electron/`；**引用既有证据，本轮未复跑**）。✅ 库从四路解析（含索引自举），无库时给**首启向导** |
| **索引** | ✅ 已接受：`data/libraries/L1/`（3594 条 · dim 768 · float32）。**该索引在本机的存在性与可读性未在本轮核实** |
| **G-B 索引质量判定** | ✅ v2 判 **PASS**（min 0.967894 · 中位 0.999263；证据 `reports/G-B-20261010-v2/`）。判据脚本已随旧档退役，**不可复跑** |
| **P3 界面** | ⚠️ **只完成 4 步中的第 1 步**：`App.jsx` 只挂了 `<SearchPage />`。其余页面未做 |
| **P4 入库与增量** | ❌ 未做：主进程显式拒绝 `ingest` / `mutate` / `indexStart` / `indexCancel` |
| **P5 多库管理** | ❌ 未做：界面无入口；多库注册表**无持久化** |
| **P6 打包与离线分发** | ❌ 未做：无安装器产物；`build/` 里只有图标与签名配置 |
| **④ 人工复核** | ⏳ 未执行（非门槛，所有者决定） |

> **开箱可用（D2 已修，2026-10-12）**：主进程不再只认 `config.json`。库按**四条优先级**解析
> （`GEMMA_LIB_ROOT` 环境变量 → `userData/library-registry.json` → `config.json` → **已有索引自举**），
> 最后一条让**本机零配置可用** —— 索引的 `meta.json` 里本就存着 `lib_id` 与 `lib_root`。
> 一个库都没有时（干净机器），界面显示**首启向导**让你选文件夹，而不是静默空库 + `LIB_NOT_FOUND`。
> 实现见 `apps/desktop/src/main/library-config.mjs`，测试 `apps/desktop/tests/library-config.test.mjs`（12 条）。

> **本项目没有 Python**：早期存在一套 Python 检索档，已于 2026-10-10 整体退役 —— 仓库自身 **0 个 `.py` 文件**（`node_modules/` 里第三方自带的除外）。退役的代价与欠账记在 [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md)。

---

## 1. 快速开始

```powershell
git clone https://github.com/IKBlue/gemma-search.git
cd gemma-search
npm install

# ⚠️ 若卡在 electron 二进制下载（报 fetch failed，且 %LOCALAPPDATA%\electron\Cache 为空）：
#    npm 包装上了、平台二进制没下来。用镜像显式取一次：
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
#    实测：直连 GitHub 的 releases 页面 HEAD 返回 200，但**资产下载**会失败；
#    换 npmmirror 镜像后正常（electron.exe 246 MB）。换机器构建同理。
```

跑起来：

```powershell
npm run dev      # dev server + HMR（改渲染层即时生效）
npm run build    # 产出 out/main · out/preload · out/renderer
npm start        # 跑刚 build 出来的产物（接近打包态）

# 受限环境（Chromium 进程沙箱起不来 → Electron 秒退、日志一行都不生成）：
npm run dev:restricted      # = dev --noSandbox
npm run start:restricted    # 跑构建产物（file://）
```

> `dev`/`start` 走 `scripts/electron-vite.mjs`：它会先摘掉 `ELECTRON_RUN_AS_NODE`
> （该变量会让 Electron 以**纯 Node** 运行，报错极具误导性），并探测本机沙箱是否可用，
> 只为这一次启动附加 `--no-sandbox`，且把判断依据打印出来。**普通机器上不会出现这一行，也不要把它固化进产品。**

> **日志**：主进程与渲染进程的诊断都写到 `data\_app.log`（Windows 上 Electron 是 GUI 子系统程序，
> stdout 不连终端，`console.log` 一条都看不到）。排查问题时先看这个文件。

更细的上手步骤与排障见 [`docs/guide/GETTING-STARTED.md`](docs/guide/GETTING-STARTED.md) 与 [`docs/guide/TROUBLESHOOTING.md`](docs/guide/TROUBLESHOOTING.md)。

---

## 1.5 现在还有什么没做完 / 什么坏了

→ **[`TODO.md`](TODO.md)**（**唯一行动清单**：待修 BUG · 未完成项 · 防回归清单）。
本文只讲"是什么 / 怎么跑"；架构与执行规范看 [`AGENTS.md`](AGENTS.md)。

---

## 2. 验证（全部只读）

```powershell
npm test                                  # 单测（node:test，纯逻辑，不需要 GUI）
npm run e2e                               # E2E（Playwright，**真启动 Electron** —— 需要能出窗的环境）
npm run build                             # 三端构建

node tools\verify_encoder_path.mjs --model <ONNX 模型目录>   # 编码路径一致性（跑真实推理）
node tools\check_search.mjs               # 检索端到端自查（向量模式，需已有查询向量）
```

- **两条独立门禁，不要混**：`npm test`（164 条，快、随时能跑）与 `npm run e2e`（13 条，**真启动 Electron**）。
  ⚠️ 在 agent 沙箱内 `npm run e2e` **需要提权**（Chromium 进程沙箱起不来 ⇒ 启动助手已带 `--no-sandbox`）；普通终端直接跑。
- 现存守卫**只剩上面 2 个**（其余 6 个已按所有者指令移除，原件备份在 `data/_removed-guards-backup/`）——
  这两个都需要模型目录与已注册索引，**在 agent 沙箱里跑不动**；
  「移除后失去了什么 / 2026-10-13 又补回了哪一部分」见 [`TODO.md`](TODO.md) B-4 的对照表。
- 期望值、前置条件、以及「守卫证明不了什么」，见 [`AGENTS.md`](AGENTS.md) §3。
- 若「Electron 起不来」需要定性：`tools\probe_electron_start\`（最小 Electron 探针 + 判读表）。
- **无归档证据 = 门禁未通过**：结论要落到 `reports/G-<字母>-<日期>/`，协议见 [`reports/README.md`](reports/README.md)。

> ✅ **`npm run build` 已实测通过**（2026-10-12）：三端产物齐备（`out/main` 49.49 kB · `out/preload/index.cjs` 0.82 kB · `out/renderer` html/css/js），
> 随后 **`verify_app_build.mjs` EXIT=0**（产物形状：ESM/CJS、依赖 external、相对路径、CSP 在、`thumb://` 还在）
> 与 **`verify_renderer_dom.mjs` EXIT=0**（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件全过）。
>
> ⚠️ **但顺序不能反**：在**无提权的受限沙箱**（例如某些 CI / 容器）里 `npm run build` 仍会失败 ——
> `failed to load config from electron.vite.config.mjs` → `error during build: Error: spawn EPERM`
> （来自 esbuild 的**常驻服务进程**，piped stdio spawn 被沙箱禁止），**失败发生在加载配置之前**。
> 这是**环境限制，不是配置或代码问题**，也不是「重构把构建改坏了」。
> 又因为 `out/` **不进 git**（新克隆里不存在），所以 `verify_app_build.mjs` / `verify_renderer_dom.mjs` / `smoke_app.mjs`
> 这三条**依赖 `out/` 的检查，必须先成功跑过一次 `npm run build`**，否则会报「找不到 `out/main/index.js`」。
>
> 口径：这与 [`AGENTS.md`](AGENTS.md) §3 记的「本环境无法创建文件符号链接（`EPERM`）→ 符号链接用例跳过」**并列**，都属**环境限制**，不是产品缺陷。
> 仍然**未验证**：`smoke_app.mjs`（真启动 Electron 出窗）· 打包态 · 冷启动计时 · 真实 `thumb://` 取图。

---

> ℹ️ **历史记录注（2026-10-13）**：本文中出现的 `verify_app_build` / `verify_main_wiring` /
> `verify_renderer_dom` / `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` **均已于 2026-10-13
> 按所有者指令移除**（原件在 `data/_removed-guards-backup/`）。下面这些"实测通过/EXIT=0"是**当时的真实记录**，
> 保留不改写；但它们**不再可复跑**。

## 3. 索引

索引已构建并接受，落在 `data/libraries/L1/`（证据出自既有报告，本轮未复跑）：

| 文件 | 内容 |
|---|---|
| `index.bin` | 3594 × 768 float32 向量（约 11 MB） |
| `items.json` | 每条素材的元数据：`uid` · `relPath` · **`absPath`** · **`archiveAbsPath`** · 尺寸/时间戳 · `vectorRow` |
| `meta.json` | 格式版本 · `compat` · 模型 revision · `preprocessing` · `dim` · 计数 · 库指纹 |

**配对规则**：靠文件名主干相同（`ID-1.jpg` ↔ `ID-1.rar`），并在索引里**显式存了两个绝对路径**，不是隐含约定。

**重建索引**（唯一可用路径，在 `packages/indexer/src/`）：

```powershell
node packages/indexer/src/build_index_onnx.mjs --model <ONNX 模型目录> --lib <素材库根> `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1
```

> `seq`（图像 soft token 预算 70/140/280）是唯一的提速杠杆；**换档必须全量重建**。
> 建索引时不要同时检索：两者争 GPU，实测速率减半。
> 索引里含素材的**绝对路径**（含本机库位置），因此它**不进 git**——别人克隆后自己建一份。

---

## 4. 已知边界

- **未验证的能力**：**冷启动耗时 · 打包后行为 · 真实 `thumb://` 取图** 均**尚未验证**，不要据此声称可用。
- **它是嵌入模型，不产出文字描述。** 只能回答「哪张图与你的查询最接近」，不能告诉你「图里是什么」。
- 检索**不写素材库、不移动、不复制文件**：结果是路径。
- **库从哪来（D2，✅ 已修 2026-10-12）**：主进程按四条优先级解析，① `GEMMA_LIB_ROOT` 环境变量
  ② `userData/library-registry.json` ③ `config.json`（兼容回退，**不要求你去配**）
  ④ **已有索引自举**（`data/libraries/*/meta.json` 里存着 `lib_id` + `lib_root`）。
  ⇒ **有索引的机器零配置即用**；一个库都没有时，界面显示**首启向导**让你选文件夹，而不是让你对着 `LIB_NOT_FOUND` 发愣。
- **多库不是真的（D8）**：当前只有「从配置派生单库」，**没有持久化的库注册表**（P5 未做）。
- **`reveal` 已修（F-01，2026-10-12）**：引擎在端口缺失时返回 `PORT_MISSING`（不再静默假成功），主进程已注入 `shell` 端口。⚠️ 边界：`shell.showItemInFolder` 返回 void、不报失败，只保证「文件在盘上 + 端口被调用过」。旧描述：rue})`。
- **契约方法与实现不同步**：`ingest` / `mutate` / `indexStart` / `indexCancel` 已在契约里冻结形状，但主进程**显式拒绝**（P4/P5 欠账）。见 [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md)。
- 预览图里有 **20 个文件名叫 `.jpg`、实际内容是 BMP**（集中在 `VR`）。解码路径会自动回退，**它们不是坏文件**。
- 素材库**再次移动**会让索引里的绝对路径失效，需要重建。
- 受限沙箱内必须加 `--no-sandbox`（Chromium 进程沙箱起不来 → 秒退）；**普通终端不需要**，也不要把它固化进产品。
- 生产态保留 DevTools 是**已决策项**（`docs/spec/SPEC-security.md` §9 决定 3），不是疏漏。
- **TypeScript 迁移只是计划**：当前界面是 JS/JSX，`tsconfig*.json` 只服务于编辑器，**没有 typecheck 门禁**（`checkJs: false`）。

---

## 5. 文档

入口：[`docs/README.md`](docs/README.md)（文档索引与权威关系）。

| 我想知道 | 读这个 |
|---|---|
| 在这个仓库里怎么干活 | [`AGENTS.md`](AGENTS.md) |
| 做到哪一步了、下一步做什么 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用规格与技术栈 | [`docs/spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口契约 | [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 验收阈值与门禁口径 | [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 上手 / 排障 | [`docs/guide/GETTING-STARTED.md`](docs/guide/GETTING-STARTED.md) · [`docs/guide/TROUBLESHOOTING.md`](docs/guide/TROUBLESHOOTING.md) |
| 还欠什么 | [`docs/DEBT-CLEANUP.md`](docs/DEBT-CLEANUP.md) |
| 模型卡（前缀 / seq / 精度依据） | [`reference/MODEL_CARD.md`](reference/MODEL_CARD.md) |

---

## 6. 许可

代码见 [`LICENSE`](LICENSE)（MIT）。模型权重 `google/embeddinggemma-2` 为 **Apache-2.0**（Google 发布），与本项目代码授权相互独立，详见 `LICENSE` 末尾。

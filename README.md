# gemma-search

本地素材库的**离线语义检索**桌面应用：用中文描述找图、以图搜图，命中后给出同名模型压缩包的绝对路径。

- **模型**：`google/embeddinggemma-2`（多模态，统一 **768 维**空间）
- **素材库**：`G:\model` —— **3594 张预览图 + 3594 个同名压缩包**，分 `VR` / `CR` / `CR+VR` / `其他` 四类
- **技术栈**：Electron + Vite + React 19（界面）· 零依赖 Node ESM 引擎（`core/`）· ONNX Runtime WebGPU（编码）
- **全离线**：不联网、不上传、不调用云服务

> 🧭 **第一次来？先读 [`PROJECT-GUIDE.md`](PROJECT-GUIDE.md)** —— 零基础版结构总览：
> 每个文件夹管什么、新东西该放哪儿、常见困惑速查。本文是技术版。

---

## 0. 当前状态（先读这一节）

| | 状态 |
|---|---|
| **桌面应用** | ✅ 已在 Electron 内实跑出窗（React 渲染 + WebGPU 编码器载入 2.4 s；证据 `reports/G-D-p2-electron/`） |
| **引擎** `core/` | ✅ 68 个单测（65 过 · 0 失败 · 3 跳过） |
| **索引** | ✅ 已接受：`data/libraries/L1/`（3594/3594 · dim 768 · healthy） |
| **G-B 质量判定** | ✅ v2 自动判定 **PASS**（min 0.967894 · 中位 0.999263）；证据 `reports/G-B-20261010-v2/` |
| **④ 人工复核** | ⏳ 未执行（非门槛，所有者决定；保留为待查清单） |
| **P6 打包** | ⏳ 未做（图标仍是脚手架默认图标） |

### ⚠️ 旧档 Python 层已退役（2026-10-10）

**本项目现在没有任何 Python。** 早期存在一套 Python + MCP + CLI + HTTP 的检索档，已按所有者决定**整体删除**：

- 旧的 12 个 Python 模块（`gemma_lib.py` / `cli.py` / `mcp_server.py` / `server.py` / `build_index.py` …）
- `tools/` 下 20 个 Python 守门与质量判据脚本、`spike/` 下 16 个一次性探针、`archive/` 下 4 个旧脚本
- `requirements.txt` / `requirements.lock.txt` / `start_server.cmd` / `config.example.json` / `config.json`

**因此以下能力已不存在**（详见 `docs/DEBT-CLEANUP.md` §十二，那里逐条写了代价）：

| 已移除 | 后果 |
|---|---|
| `mcp_server.py` | `mcp__gemma-search__*` 工具失效，直到新应用提供等价能力 |
| 命令行 / HTTP 网页入口 | 只能用桌面应用检索 |
| `tools/verify_docs.py` | 文档死引用 / 索引覆盖门禁没了 |
| `tools/verify_tokens.py` | 设计令牌纪律门禁没了（但 `static/prototype/tokens.css` 仍是视觉唯一来源） |
| `tools/verify_syntax.py` | 全仓语法体检没了 |
| `tools/scan_repo_pollution.py` | 机密 / 本机耦合 / 大文件扫描没了 |
| `tools/quality/`（10 个） | **G-B 三道验收判据无法再复跑**，`reports/` 里的证据成为存档、不可独立复现 |
| `build_index.py` | torch 格式索引构建器没了；`onnx-spike/build_index_onnx.mjs` 是唯一剩下的构建器 |

> `tools/` 里剩下的是 6 个 **Node** 守卫（构建形状 / 渲染层 DOM / 样式 / 编码路径 / 冒烟 / 检索自查），它们服务于本应用，与旧档无关。

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
> 只为这一次启动附加 `--no-sandbox`，且把判断依据打印出来。普通机器上不会出现这一行。

> **日志**：主进程与渲染进程的诊断都写到 `data\_app.log`（Windows 上 Electron 是 GUI 子系统程序，
> stdout 不连终端，`console.log` 一条都看不到）。首次运行请把这个文件回传。

### 最少需要的配置

**没有配置文件了。** 旧的 `config.json` / 环境变量体系随 Python 层一起删除。
素材库位置由应用内的**库注册表**管理（`core/library.mjs`），索引落在 `data/libraries/<libId>/`。

---

## 2. 验证（全部只读）

```powershell
npm test                                  # 引擎单测（node:test，不经传输层）：68 项
npm run build                             # 三端构建
node tools\verify_app_build.mjs           # 产物形状（ESM/CJS/external/相对路径/原生模块未内联）
node tools\verify_renderer_dom.mjs        # React 渲染层在 jsdom 里真跑（启动/搜索/交互/事件）
node tools\verify_renderer_styles.mjs     # 渲染层样式与令牌一致性
node tools\verify_encoder_path.mjs --model <ONNX 模型目录>   # 编码路径一致性（跑真实推理）
node tools\smoke_app.mjs                  # 应用冒烟：真启动构建产物并给判定（受限环境加 --no-sandbox）
node tools\check_search.mjs               # 检索端到端自查（需先有查询向量）
```

> 若「Electron 起不来」需要定性：`tools\probe_electron_start\`（最小 Electron 探针 + 判读表）。

---

## 3. 索引

索引已构建并接受，落在 `data/libraries/L1/`：

| 文件 | 内容 |
|---|---|
| `index.bin` | 3594 × 768 float32 向量（约 11 MB） |
| `items.json` | 每条素材的元数据：`uid` · `relPath` · **`absPath`** · **`archiveAbsPath`** · 尺寸/时间戳 · `vectorRow` |
| `meta.json` | 格式版本 · `compat` · 模型 revision · `preprocessing` · `dim` · 计数 · 库指纹 |

**配对规则**：靠文件名主干相同（`ID-1.jpg` ↔ `ID-1.rar`），在索引里**显式存了两个绝对路径**，
不是隐含约定。索引与检索**永不写素材库**——只返回路径。

**重建索引**（唯一可用路径）：

```powershell
node onnx-spike/build_index_onnx.mjs --model <ONNX 模型目录> --lib "G:\model" `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1
```

> `seq`（图像 soft token 预算 70/140/280）是唯一的提速杠杆；**换档必须全量重建**。
> 建索引时不要同时检索：两者争 GPU，实测速率减半。

---

## 4. 文档索引

**先读 `TASK-PLAN.md`** —— 唯一的行动依据（做什么、按什么顺序、什么算做完）。

| 文档 | 讲什么 |
|---|---|
| **`PROJECT-GUIDE.md`** | 🧭 零基础结构总览：框架图、目录职责、新文件该放哪儿、术语词典 |
| **`TASK-PLAN.md`** | ⭐ 最终任务计划书：阶段 P0–P7、门禁、交付物、风险 |
| `docs/spec/SPEC-app.md` | 应用规格：目标、成功标准、技术栈、边界 |
| `docs/spec/SPEC-security.md` | 威胁模型与**明确不防**的边界 · IPC 单通道白名单 + zod · `thumb://` 加固 · 渲染进程姿态与 CSP · 4 条渲染层不变量 · 16 条权限测试用例 |
| `docs/spec/SPEC-identity.md` | 身份与配对：uid 语义、文件身份、库指纹、索引格式 |
| `docs/spec/SPEC-transactions.md` | 文件事务与崩溃恢复：状态机、事务日志、跨卷、启动恢复、撤销、并发 |
| `docs/spec/SPEC-acceptance.md` | 验收与口径：三项独立验收、语义质量阈值、性能计时边界、门禁 |
| **`docs/spec/CONTRACT-engine-v1.md`** | 引擎接口契约：19 错误码 + 用户文案 · 10 个方法 · 长任务进度/取消/续跑 · 5 条安全不变量 |
| **`docs/design/DESIGN-tokens.md`** | ⭐ 视觉唯一来源：Apple 风格设计令牌（可执行版 = `static/prototype/tokens.css`） |
| `docs/design/DESIGN-app-details.md` | 详细设计：UI、库管理、索引、模型管理、入库增量、CRUD 与多库 |
| `docs/design/UI-REVIEW-and-migration.md` | UI 评审与迁移路线（**UI 以它为准**） |
| `docs/DEBT-CLEANUP.md` | **债务账本**：清了什么、还欠什么（§十一 合规审查 20 项 · §十二 Python 退役） |
| `docs/plan/PRE-KICKOFF-CHECK.md` | 立项前检查清单 |
| `reference\MODEL_CARD.md` | 官方模型卡（前缀 / seq / float16 限制的依据） |
| `archive\` | 被取代的旧计划与旧应用外壳（**不再是依据**，见其 README） |

**权威关系**（避免同一件事两处说法不一致）：

- UI → `docs/design/UI-REVIEW-and-migration.md` 为准 · 视觉令牌 → `docs/design/DESIGN-tokens.md` 为准
- 索引元数据 / 身份 / 配对 / 指纹 → `docs/spec/SPEC-identity.md` 为准
- 事务 / 撤销 / 并发 → `docs/spec/SPEC-transactions.md` 为准
- 验收阈值 / 性能口径 / 门禁 → `docs/spec/SPEC-acceptance.md` 为准
- 顺序与进度 → `TASK-PLAN.md` 为准
- 传输层与外壳安全 → `docs/spec/SPEC-security.md` 为准 · 引擎接口形状 → `docs/spec/CONTRACT-engine-v1.md` 为准

> ⚠️ **`SPEC-*.md` / `TASK-PLAN.md` / `DESIGN-*.md` 里仍大量提到 Python 档（P7 退役流程、旧 CLI 命令、
> `tools/*.py` 门禁）。那些段落描述的是退役前的历史状态，不是现状** ——
> 现状以本文 §0 与 `docs/DEBT-CLEANUP.md` §十二 为准。这批文档的统一改写尚未进行（见账本）。

---

## 5. 已知边界

- **它是嵌入模型，不产出文字描述。** 只能回答「哪张图与你的查询最接近」，不能告诉你「图里是什么」。
- 检索**不写素材库、不移动、不复制文件**：结果是路径。
- 预览图里有 **20 个文件名叫 `.jpg`、实际内容是 BMP**（集中在 `VR`）。解码路径会自动回退，**它们不是坏文件**。
- 素材库**再次移动**会让索引里的绝对路径失效，需要重建。
- 受限沙箱内必须加 `--no-sandbox`（Chromium 进程沙箱起不来 → 秒退）；
  **普通终端不需要**，也不要把它固化进产品。
- **冷启动耗时 / 打包后行为 / 真实 `thumb://` 取图**尚未验证，不要据此声称可用。

---

## 6. 许可

见 [`LICENSE`](LICENSE)。

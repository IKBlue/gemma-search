# 素材库语义检索（EmbeddingGemma 2）

用 **Google EmbeddingGemma 2** 给 `G:\model` 素材库做语义检索：
**用中文描述找图**、**以图搜图**，命中后给出同名模型压缩包的绝对路径。

- 模型：`google/embeddinggemma-2`（740M 多模态，文本/图像/音频/视频统一 **768 维**空间）
- 素材库：`G:\model` —— **3594 张预览图 + 3594 个同名压缩包**，分 `VR` / `CR` / `CR+VR` / `其他` 四层
- 环境：`D:\USERS\Desktop\Agent\.venv`（uv 管理）
- 索引：`data\embeddings.npy` + `items.json` + `meta.json`（**3594/3594 已编完**）

---

## 0. 当前状态与文档索引（先读这一节）

**这个仓库里有两件不同的事**，别混淆：

| | 状态 | 说明 |
|---|---|---|
| **A. 现在的检索档（Python + MCP）** | ✅ **在跑** | 本 README 的 §1–§9 讲的就是它。DSH 里的 `mcp__gemma-search__*` 工具、CLI、HTTP 网页都属这一档 |
| **B. 独立桌面应用（Electron + Vite + React）** | ✅ **已在 Electron 内实跑出窗（React 渲染 + WebGPU 载入；证据 `reports/G-D-p2-electron/`）** | 取代 A：Electron 应用，不再依赖 DSH。引擎 `core/`（68 测全过）与 electron-vite 三端主体（`src/main` · `src/preload` · `src/renderer`）已就位；渲染层 2026-10-10 由手写 DOM 迁到 **React**，并在本机 Electron 内实跑（受限沙箱需 `--no-sandbox`）。规格见下方文档索引 |

> **A 会在新应用验收通过后才退役**（计划里的 P7）。
> 现在就删会留下"两边都不能用"的空窗，所以 MCP 注册与 `server.py` 都还在。
>
> **✅ 当前 G-B 状态（2026-10-10）**：
> v1 判 FAIL（min 0.9153）→ 根因是**重采样实现** → 修复后 v2 全量重建完成（3594/3594 · 0 失败）。
> v2 **自动判定 PASS**：min **0.967894** · 中位 **0.999263** · ② 平均重合率 ✔ · ③ self 5/5 与 hard 2/2 全中。
> 判据 ① 的最小值门槛经项目所有者决定 **0.970 → 0.700**（写进 `SPEC-acceptance.md` §2.2 并注明代价）。
> **索引已接受**：`data/libraries/L1/`（3594/3594 · dim 768 · healthy），检索端到端可用；
> 证据链 `reports/G-B-20261010-v2/`（含 `TAIL-400x300.md` 尾部观察）；**④ 人工复核（轻档）待确认**。

### 新机器上手（克隆后 3 步）

仓库里**不含**任何本机路径、索引与模型权重（见 `.gitignore`）。克隆后按下面配置：

```powershell
git clone https://github.com/IKBlue/gemma-search.git
cd gemma-search

# ① 配置素材库位置（二选一）
#    a) 写 config.json（不入库）—— 模板见 config.example.json
#    b) 或用环境变量（优先级更高）：
#       $env:GEMMA_LIBRARY_ROOT = "G:\model"
#       $env:GEMMA_MODEL_CACHE  = "D:\models"

# ② 建 Python 环境并下模型
python -m venv .venv
& .\.venv\Scripts\pip install -r requirements.txt        # 下限；要复现实测数字用 requirements.lock.txt
& .\.venv\Scripts\python.exe download_model.py

# ③ 建索引（3594 条约 25 分钟；可中断续跑）
& .\.venv\Scripts\python.exe build_index.py
```

**应用（Node/Electron）依赖** —— 与上面那套 Python 档相互独立：

```powershell
npm install
# ⚠️ 若卡在 electron 的二进制下载（报 `fetch failed`，且 %LOCALAPPDATA%\electron\Cache 为空）：
#    npm 包装上了、平台二进制没下来。用镜像显式取一次：
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
#    实测：直连 GitHub 的 releases 页面 HEAD 返回 200，但**资产下载**会失败；
#    换 npmmirror 镜像后正常（electron.exe 246 MB）。这一点对"在别的机器上构建"同样适用。
```

**跑应用（2026-10-10 起：electron-vite 工程化）**：

```powershell
npm run dev      # dev server + HMR（改渲染进程代码即时生效）
npm run build    # 产出 out/main · out/preload · out/renderer
npm start        # = electron-vite preview：跑刚 build 出来的产物（接近打包态）

# 受限环境（Chromium 的进程沙箱起不来 → Electron 秒退、日志一行都不生成）：
npm run dev:restricted      # = dev --noSandbox --entry out/main/index.js
npm run start:restricted    # 同上，但跑构建产物（file://）
```

> 上面那两个 `:restricted` 只是把 electron-vite **自带的**开关显式写出来；
> 正常情况下**不需要**用它们 —— `scripts/electron-vite.mjs` 启动前会探测一次
> （`electron --version` 失败、加 `--no-sandbox` 正常 = 本机沙箱不可用），探测到就
> **只为这一次启动**附加那两个开关，并把判断依据打印出来。普通机器上不会出现这一行。

> `dev`/`start` 走的是 `scripts/electron-vite.mjs`：它会先摘掉 `ELECTRON_RUN_AS_NODE`。
> 这个变量会让 Electron 以**纯 Node** 运行（报错极具误导性，见下），而 dev 态**不能**
> 靠主进程自愈 —— dev server 在父进程手里，重生实例会丢掉它。

> **日志**：主进程与渲染进程的诊断都写到 `data\_app.log`（Windows 上 Electron 是 GUI 子系统
> 程序，stdout 不连终端，`console.log` 一条都看不到）。首次运行请把这个文件回传。

> 注意两者用途不同：**Python 档是当前唯一在用的检索服务**（MCP/CLI/HTTP），
> **Node 档是新应用**（引擎 `core/` + Electron/React 主体 `src/`）。旧档到 P7 才退役。

**可配置项一览**（`config.json` 键 ↔ 环境变量；**环境变量优先**）：

| config.json | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `workspace` | `GEMMA_WORKSPACE` | 项目根的上一级 | 工作区 |
| `library_root` | `GEMMA_LIBRARY_ROOT` | `<workspace>/model` | **素材库根目录（必填）** |
| `data_dir` | `GEMMA_DATA_DIR` | `<项目根>/data` | 索引产物目录 |
| `model_cache` | `GEMMA_MODEL_CACHE` | `<workspace>/model-cache` | 模型缓存 |
| `model_id` | `GEMMA_MODEL_ID` | `google/embeddinggemma-2` | 模型 id |
| — | `GEMMA_CONFIG` | `<项目根>/config.json` | 配置文件位置 |

> 配置没配好时**不会静默扫到 0 张**：`gemma_lib` 会打印「素材库目录不存在 + 当前配置摘要」。
> 排查：`python -c "import gemma_lib as G; print(G.config_summary())"`

### 克隆后要跑的守卫（全部只读）

```powershell
& .\.venv\Scripts\python.exe tools\verify_syntax.py       # 全仓语法体检（.py 编译 + node --check）—— 3 秒，改完脚本就跑
& .\.venv\Scripts\python.exe tools\check_staged.py         # 提交前：暂存区规模与违规
& .\.venv\Scripts\python.exe tools\scan_repo_pollution.py  # 机密 / 本机耦合 / 大文件
& .\.venv\Scripts\python.exe tools\verify_docs.py          # 文档完整性（死引用 / 索引覆盖）
& .\.venv\Scripts\python.exe tools\verify_tokens.py        # 设计令牌纪律（写死颜色 / 悬空 var()）
& .\.venv\Scripts\python.exe tools\verify_resize.py        # 重采样兼容层 vs PIL（**含否定对照**，改了编码器必跑）
```

应用侧（需要 Node；**不需要 Electron**）：

```powershell
npm run build                            # 三端构建
node tools\verify_app_build.mjs          # 产物形状（ESM/CJS/external/相对路径/原生模块未内联）
node tools\verify_renderer_dom.mjs       # React 渲染层在 jsdom 里真跑（启动/搜索/交互/事件）
node tools\verify_encoder_path.mjs --model <ONNX 模型目录>   # 编码路径一致性（会跑真实推理）
```

> 若“Electron 起不来”需要定性：`tools\probe_electron_start\`（最小 Electron 探针 + 判读表）。

> 为什么要有 `verify_syntax.py`：2026-10-10 扫出 **3 个门禁/质量脚本在提交里就是语法错误**
> （某次编辑吞掉一行，注释把 `, ext))` 吃了进去）。它们不属于任何自动测试，
> 只有"真要跑那一项"时才炸 —— 而那正是最需要它的时候。

应用侧（Node/Electron，**不需要 Electron** 就能跑的那部分）：

```powershell
npm test                     # 引擎单测（node:test，不经传输层）
npm run build                # electron-vite 三端构建
node tools/verify_app_build.mjs     # 构建产物形状（ESM / CJS / external / 相对路径 / 原生模块未内联）
node tools/verify_renderer_dom.mjs  # React 渲染层在 jsdom 里真跑（启动 / 搜索 / 交互 / 事件，不需 Electron）
node tools/smoke_app.mjs             # 应用冒烟：真启动构建产物并给判定（受限环境加 --no-sandbox）
```

#### 应用实跑结论（2026-10-10 · 证据 `reports/G-D-p2-electron/`）

```powershell
npm run build     # 三端：main / preload / renderer（React）
npm run dev       # 你自己的终端：dev server + Electron 窗口 + HMR
npm start         # 跑构建产物（file://），最接近打包态
```

- **已实跑**：Electron 出窗（标题「gemma-search · 素材库语义检索」）· React 渲染层挂载 ·
  `invoke indexStatus` 打通 · 编码器**在 Electron 内以 WebGPU 载入（2.4 s）**
  —— 这一条同时是 P1.5 的核心问题（WebGPU 能否在 Electron 里起来）的答案。
- **受限沙箱内**必须加 `--no-sandbox`（Chromium 的进程沙箱起不来 → `0x80000003` 秒退）；
  **普通终端不需要**，也不要把它固化进产品。
- **`web/` 已删除**（2026-10-10）：它是浏览器预览的过渡产物，与根工程构成两套依赖、
  两份令牌的相互污染。React 界面直接住在 `src/renderer`，令牌仍是唯一来源
  `static/prototype/tokens.css`（不复制第二份）。
- 界面能开、IPC 通，但**检索还出不了结果**：引擎报 `INDEX_MISSING`（索引尚未登记，属 P0.5-c）。

### 文档索引

**先读 `TASK-PLAN.md`** —— 那是唯一的行动依据（做什么、按什么顺序、什么算做完）。
下面这些是它的约束来源：

| 文档 | 讲什么 |
|---|---|
| **`TASK-PLAN.md`** | ⭐ **最终任务计划书**：阶段 P0–P7、门禁、交付物、风险、下一步 |
| `SPEC-app.md` | 应用规格：目标、成功标准、技术栈（含前端选型）、边界 |
| `DESIGN-app-details.md` | 详细设计：UI、库管理、索引、模型管理、入库增量、CRUD 与多库、传输层 |
| `SPEC-transactions.md` | 文件事务与崩溃恢复：状态机、事务日志、跨卷流程、启动恢复、撤销、并发、空间核算 |
| `SPEC-identity.md` | 身份与配对：uid 语义、文件身份、库指纹、索引元数据（拆开含混的 `precision`）、索引格式 |
| `SPEC-acceptance.md` | 验收与口径：三项独立验收、语义质量阈值、性能计时边界、离线与打包验证、门禁 |
| **`SPEC-security.md`** | **P2 前置门禁**：威胁模型与**明确不防**的边界 · IPC 单通道白名单 + zod · `thumb://` 加固 · 来源验证 · 渲染进程姿态与 CSP · 4 条渲染层不变量 · **16 条权限测试用例** |
| **`CONTRACT-engine-v1.md`** | **引擎接口契约**（待 P1 验收时冻结）：19 错误码 + 用户文案 · 10 个方法 · 长任务进度/取消/续跑 · `RECOVERY_NEEDED` 恢复 · 多库结构不兼容原因 · 5 条安全不变量 · P3 用 fixtures |
| **`DESIGN-tokens.md`** | ⭐ **视觉唯一来源**：Apple 风格设计令牌（颜色 / 字体 / 间距 / 圆角 / 材质 / 控件 / 动效 / 可访问性 + CSS 变量 + Tailwind·shadcn 映射）。可执行版本 = `static/prototype/tokens.css` |
| `UI-REVIEW-and-migration.md` | UI 评审与迁移：逐页评审、领域差异、技术选型增补、四个关键流程、迁移路线 |
| `DEBT-CLEANUP.md` | **债务账本**：清了什么、还欠什么 |
| `reference/MODEL_CARD.md` | 官方模型卡（前缀 / seq / float16 限制的依据） |
| `archive/` | 两份被取代的旧计划（**不再是依据**，见其 README） |

**文档的权威关系**（避免同一件事两处说法不一致）：

- **UI** → `UI-REVIEW-and-migration.md` 为准，`DESIGN-app-details.md` §一 为摘要
- **索引元数据 / 身份 / 配对 / 指纹** → `SPEC-identity.md` 为准
- **事务 / 撤销 / 并发** → `SPEC-transactions.md` 为准
- **验收阈值 / 性能口径 / 门禁** → `SPEC-acceptance.md` 为准
- **顺序与进度** → `TASK-PLAN.md` 为准
- **应用技术栈与目录结构**（`core/` `app/` `src/shared/`）→ `SPEC-app.md` §3–§5 为准
  （2026-10-10 已按锁定决策重写 §4–§10；此前它残留着「Python 子进程 + CUDA + 单库 + 库只读」的旧形态）
- **传输层与外壳安全**（IPC 白名单 / `thumb://` / 渲染进程姿态 / 权限测试用例）→ `SPEC-security.md` 为准
  （**P2 的前置门禁**；引擎层的 5 条安全不变量在 `CONTRACT-engine-v1.md` §7，已实现并有测试）
- **引擎接口形状**（方法 / 错误码 / 事件 / 恢复）→ `CONTRACT-engine-v1.md` 为准

### 页面

| 文件 | 内容 |
|---|---|
| `static/plan-overview.html` | 计划总览页（9 章，可打印） |
| `static/prototype/index.html` | **UI 原型套件入口**（6 页，离线可开；**已接入设计令牌**） |
| `static/prototype/tokens.css` | **设计令牌的可执行版本**（`DESIGN-tokens.md` §10 + 领域补充） |
| `tools/verify_tokens.py` | **令牌纪律守卫**：写死颜色 / 悬空 `var()` / 加载顺序；改样式后必跑 |

---

**三个入口，同一份检索内核**（`search.py`）：

| 入口 | 用途 | 文件 |
|---|---|---|
| **MCP Server** | Agent 调用（首选） | `mcp_server.py` |
| **CLI** | 命令行 / MCP 未注册时的回退档 | `cli.py` |
| **HTTP + 网页** | 人用（缩略图、点选、资源管理器定位） | `server.py` + `static/index.html` |

---

## 1. 快速开始

```powershell
cd D:\USERS\Desktop\Agent\gemma-search

# 命令行检索
& ..\.venv\Scripts\python.exe cli.py search-text "现代简约布艺沙发" --top-k 5
& ..\.venv\Scripts\python.exe cli.py search-image "G:\model\VR\ID-xxx.jpg" --top-k 5
& ..\.venv\Scripts\python.exe cli.py stats

# 网页界面（可选）
& ..\.venv\Scripts\python.exe server.py            # http://127.0.0.1:8760/
# 或双击 start_server.cmd
```

环境变量由脚本自己设好（`HF_HOME` / `HF_HUB_OFFLINE`），无需手工导出。

> ⏱ **耗时与调用档位强相关**（同机实测）：**MCP 工具**的模型驻留进程，文本查询约 **37 毫秒**；
> **CLI 每次调用约 11.2 秒**——它是新进程，约 11 秒的固定成本全在载模型与 CUDA 初始化上，
> 真正的检索只占 37 毫秒。
> 因此**需要连续检索时请注册 MCP（§2）**；`warmup` 作为独立 CLI 调用没有意义
> （它预热的进程随后即退出），只对 MCP 与常驻的 HTTP 服务有效。

## 2. MCP 注册

`cli.py mcp-config` 会打印可直接粘贴的片段：

```json
{
  "gemma-search": {
    "command": "D:\\USERS\\Desktop\\Agent\\.venv\\Scripts\\python.exe",
    "args": ["D:\\USERS\\Desktop\\Agent\\gemma-search\\mcp_server.py"],
    "env": {
      "HF_HOME": "D:\\USERS\\Desktop\\Agent\\model-cache\\hf",
      "HF_HUB_CACHE": "D:\\USERS\\Desktop\\Agent\\model-cache\\hf\\hub",
      "HF_HUB_OFFLINE": "1",
      "PYTHONIOENCODING": "utf-8"
    }
  }
}
```

注册后暴露 5 个工具：`search_by_image`、`search_by_text`、`get_item`、`get_index_stats`、`warmup`。

> 环境变量必须随注册项下发：`HF_HOME` 指到工作区内（否则 HF 会去写工作区外、被沙箱拒绝），
> `HF_HUB_OFFLINE=1` 避免每次启动做符号链接探测（本机不支持符号链接）。

## 3. 索引构建（**只走 CLI**）

刻意不把建索引做成 MCP 工具：一次要跑几分钟到几十分钟，会阻塞协议调用。

```powershell
& ..\.venv\Scripts\python.exe cli.py build --seq 140            # 续跑（默认）
& ..\.venv\Scripts\python.exe cli.py build --seq 140 --rebuild  # 全量重算
& ..\.venv\Scripts\python.exe cli.py build --prune              # 顺带诊断失效条目
```

| 参数 | 说明 |
|---|---|
| `--seq` | 图像 soft token 预算（70/140/280）。**唯一的提速杠杆**；换档位必须 `--rebuild` |
| `--device` | `cpu` / `cuda`，缺省自动 |
| `--batch` / `--save-every` | 批大小与落盘频率（默认 8 / 64） |

**实测编码速度**（本机 RTX 2060 + i9 级 16 线程 CPU）：

| 设备 | 精度 | 秒/张 | 3594 张 |
|---|---|---|---|
| CPU | float32 | 1.84（seq=140）/ 3.90（seq=280） | 1.8 h / 4.3 h |
| **GPU** | **float32** | **0.30~0.49** | **约 18~29 分钟** |
| GPU | bfloat16 | **5.57（反而慢 11 倍）** | 不可用 |

可中断续跑：未变更的图不重算（复用判定**同时校验"已存向量非零"**，
否则中断留下的零向量占位会被当成已完成，索引永远补不齐——这是本项目实测踩过的坑）。

## 4. 精度选择（**实测推翻了模型卡的通用规则**）

模型卡（`reference/MODEL_CARD.md` 第 189–200 行）说：
`dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32`，
并明令 **禁用 float16**（激活范围超出 fp16 动态范围，会**静默返回 NaN 或退化向量**）。

**但在本机这条规则会选错**：RTX 2060 是 Turing(sm_75)，**没有原生 bf16**，
而 `torch.cuda.is_bf16_supported()` 仍返回 **True**。按它选 bf16 的实测后果：

| dtype | 秒/张 | L2 归一化 | 峰值显存 |
|---|---|---|---|
| bfloat16 | 5.573 | **失效（范数≠1）** | **6.57 GB（超 6 GB 上限）** |
| **float32** | **0.485** | 正常 | 2.69 GB |

因此本项目改为按**计算能力**判定：bf16 仅用于 sm_80（Ampere）及以上，否则 fp32——
等价于模型卡"有原生支持才用 bf16"的本意。

另经**同进程实测**：CPU 与 GPU 的 fp32 向量逐张余弦 **1.0000**，故索引可跨设备混建。

## 5. 环境（已就绪，如需重建）

```powershell
# 本机 uv 在 C:\Users\Administrator\.local\bin\uv.exe
# ⚠️ 受限沙箱下 uv 必须提权：它要用管道拉起 Python 子进程，受限模式直接 os error 5
$env:UV_CACHE_DIR = "D:\USERS\Desktop\Agent\.uv-cache"     # 必须落在工作区内
uv venv D:\USERS\Desktop\Agent\.venv --python D:\Python\3.12.10\python.exe
uv pip install --python D:\USERS\Desktop\Agent\.venv\Scripts\python.exe `
   torch torchvision transformers sentence-transformers accelerate pillow numpy safetensors mcp
# 换 CUDA 版 torch（cu126）：注意 uv 默认只认第一个含该包的索引，需加策略参数
uv pip install --python D:\USERS\Desktop\Agent\.venv\Scripts\python.exe `
   --index-url https://download.pytorch.org/whl/cu126 `
   --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match `
   "torch==2.14.1+cu126" "torchvision==0.29.1+cu126"
```

关键版本（实测可用）：`torch 2.14.1+cu126`、`transformers 5.19.0`、
`sentence-transformers 6.1.0`、`mcp 2.3.0`、`pydantic 2.14.0`。

> ⚠️ **transformers 必须 ≥5.19**：系统 `D:\Python\3.12.10` 自带的 5.12.1
> **不认识 `embedding_gemma2` 架构**，会直接加载失败。
>
> ⚠️ **mcp 2.x 把 `FastMCP` 改名为 `MCPServer`**（`from mcp.server.mcpserver import MCPServer`）。
> `mcp_server.py` 对 2.x / 1.x / 独立 fastmcp 包三种形态都做了兼容。

模型权重已下载到工作区内（1.42 GB）：`model-cache\hf\hub\models--google--embeddinggemma-2\`

## 6. 验证

```powershell
& ..\.venv\Scripts\python.exe mcp_server.py --selftest   # 工具层（含错误路径）9 项
& ..\.venv\Scripts\python.exe verify_mcp.py              # 协议级 + 一致性 17 项
& ..\.venv\Scripts\python.exe verify_app.py              # HTTP 界面 11 项
& ..\.venv\Scripts\python.exe spike\probes\probe_gpu.py               # GPU 与 CUDA 轮子可用性
& ..\.venv\Scripts\python.exe spike\probes\probe_gpu_speed.py --cross # 同进程 CPU vs GPU 向量一致性
& ..\.venv\Scripts\python.exe tools/baseline_report.py                      # 基线复核（G-A 门禁：指纹 + 备份旧索引）
```

`verify_mcp.py` 覆盖：**stdout 纯 JSON-RPC**（stdio MCP 最易翻车处）、
MCP 协议结果与进程内直调逐字段一致、MCP↔CLI 一致、确定性、无 NaN、关键 meta 字段。

## 7. 文件一览

> **2026-10-10 重排**：根目录脚本按角色归类（`tools/` 门禁与校验 · `tools/quality/` 质量判定 ·
> `spike/probes/` 一次性探针 · `archive/` 被取代的东西）。移动时逐文件改写了
> "本文件所在目录 = 项目根" 的假设 → 改成**向上找 `core/engine.mjs`**，所以再搬一次也不会错。
> 旧 Python 检索档**仍在根目录而且仍可运行** —— 它是当前唯一在用的检索服务，
> 按 P7 计划在应用验收通过后退役（见 §0）。

```
gemma-search\
├── 【当前形态 · 独立桌面应用（electron-vite）】─────────────
├── src\                       应用主体（正文见 src\README.md）
│   ├── main\                  主进程：index.mjs（IPC/thumb://窗口）· encoder.mjs（编码器端口）· log.mjs
│   ├── preload\index.js       白名单 preload（**产物必须是 CJS**，sandbox 要求）
│   ├── renderer\              index.html + src/main.js（迁移期普通 JS；P3a 换 React + Tailwind）
│   └── shared\ipc.mjs         IPC 契约唯一来源（zod 白名单）
├── core\                      引擎：传输无关、零依赖（68 测）
├── electron.vite.config.mjs   三端构建配置（dependencies 全部 external，理由写在文件里）
├── tsconfig.json / .node / .web  编辑器用；**暂不作门禁**（checkJs 关，见 package.json 注释）
├── electron-builder.yml       打包配置（P6 才用；图标仍是脚手架默认图标）
├── build\ resources\          打包资源（图标 / entitlements）
├── scripts\electron-vite.mjs  dev/start 前摘掉 ELECTRON_RUN_AS_NODE
├── out\                       构建产物（不入库，`npm run build` 生成）
│
├── 【门禁与校验 · 只读，可直接跑】───────────────────────
├── tools\verify_syntax.py     全仓语法体检（.py 编译 + node --check）★ 新增
├── tools\verify_docs.py       文档完整性（死引用 / 索引覆盖 / 计划书要求）
├── tools\verify_tokens.py     设计令牌纪律（写死颜色 / 悬空 var()）
├── tools\verify_resize.py     重采样兼容层 vs PIL（跨语言金标，含**否定对照**）
├── tools\verify_app_build.mjs 应用构建产物的**形状**（ESM/CJS/external/相对路径，不需要 Electron）
├── tools\verify_encoder_path.mjs  产品编码路径一致性（不需要 Electron）
├── tools\check_staged.py      提交前：暂存区规模与违规
├── tools\scan_repo_pollution.py  机密 / 本机耦合 / 大文件
├── tools\preflight_p05.py     P0.5 立项前把关（12 项可执行检查）
├── tools\baseline_report.py   G-A 基线复核 + 备份旧索引
├── tools\fetch_onnx_model.py  取 ONNX 模型（可续跑 / 校验 sha256 / 钉 revision）
├── tools\index_bin.py         index.bin 读写（被质量工具 import）
├── tools\quality\             质量判定（G-B 三道判据 + 诊断）
│      quality_vector_equiv · quality_top10 · quality_report · quality_anchor ·
│      quality_rank_margin · quality_tail_attrib · quality_fixture_eval ·
│      quality_resize_variants · make_quality_set · sniff_extensions
│
├── 【证据 / 原型 / 产物】─────────────────────────────
├── spike\                     后端路线决策的证据（勿删，见其 README.md）
│   ├── probes\                一次性探针（GPU-CUDA 不可用 · BMP 布局 · 像素对照 · 预处理差异）
│   └── ref*.json / onnx*.json    torch 与 ONNX 的向量对照
├── onnx-spike\                ONNX 侧构建器与 spike 脚本（**索引构建的唯一可用路径**）
├── static\prototype\          UI 原型套件（6 页 + 共享 style/app.css/app.js）—— P3a 的界面依据
├── static\plan-overview.html   计划总览页
├── static\_archive\           被取代的两份单文件原型（归档不删）
├── reports\                   门禁证据（G-A / G-B 报告与对照表）
├── data\                      索引产物 + 本机诊断中间物（多数不入库）
│
├── 【旧档 · P7 退役 —— 仍在根目录且可正常运行】────────────
├── gemma_lib.py store.py search.py tools.py cli.py        检索档本体（MCP/CLI/HTTP 共用）
├── mcp_server.py server.py static\index.html              MCP 与 HTTP 两个入口
├── build_index.py verify_app.py verify_mcp.py             torch 档的构建与验收
├── register_mcp.py download_model.py start_server.cmd     DSH 注册 / 模型下载 / 双击启动
│
└── 【文档】──────────────────────────────────────────
    README.md（本文）· TASK-PLAN.md ⭐ 唯一行动依据 · SPEC-app / -transactions /
    -identity / -security / -acceptance · DESIGN-app-details / -tokens ·
    UI-REVIEW-and-migration · CONTRACT-engine-v1 · PRE-KICKOFF-CHECK ·
    DEBT-CLEANUP（债务账本）· reference\MODEL_CARD.md · archive\（旧计划 + 旧应用外壳）
```

## 8. 与原始方案的偏差（均已实测更正）

> 「原始方案」= 归档的 `archive/plan-agent-skill.md`。
> 注意：它规划的是**给 DSH 用的技能**，不是本应用；下面每条都是照抄它会踩的坑。

| 原始方案的说法 | 实测事实 |
|---|---|
| 素材库**扁平**，`iterdir()` + `stem` 配对 | 是 **4 个子文件夹**；逐目录配对。照抄会扫到 **0 张图** |
| 图像传 `prompt_name="document"` | 模型卡：**前缀只作用于文本**，图像**不加任何前缀** |
| 约 1 万张、37.3 毫秒/张（M5 Pro GPU） | **3594 对**；本机 CPU 1.84 秒/张、**GPU 0.30~0.49 秒/张** |
| 内存 300~400 MB | 实测进程常驻 **2.3~2.7 GB** |
| 索引写 `_index.json` 到素材库根 | 那是在写 `G:\model`（工作区外）；索引一律留在 `data\` |
| 向量库 Zvec | Zvec 真实存在（阿里开源 0.7.0），但本项目规模用不上：3594×768 暴力余弦约 **0.3 毫秒**。已按"先 numpy、过 5 万再换"实现，后端可替换 |

## 9. 已知边界

- **它是嵌入模型，不产出文字描述。** 只能回答"哪张图与你的查询最接近"，
  不能告诉你"图里是什么"。需要描述图片应当用生成式视觉模型。
- 检索**不写素材库、不移动、不复制文件**：结果是路径。
- 预览图里有 **20 个文件名叫 `.jpg`、实际内容是 BMP**（集中在 `VR`）。
  torchvision 的 `decode_image` 不支持 BMP，编码器会自动回退到 PIL——**它们不是坏文件**。
- 素材库**再次移动**会让索引里的绝对路径失效；`build_index.py --prune` 会输出
  `data\orphans.json` 记录失效/新增条目。
- **建索引时不要同时跑检索**（MCP 或网页）：两者争 GPU/CPU，实测速率减半。
- `start_server.cmd` 必须是**纯 ASCII**：`cmd.exe` 按本机代码页 936 解析批处理文件，
  里面的 UTF-8 中文会被解成乱码并当成命令执行（本项目踩过）。中文提示一律由 Python 输出。
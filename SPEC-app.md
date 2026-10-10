# SPEC: 素材库语义检索独立应用（Material Library Search App）

> 状态：**待批准**（Phase 1 Specify 产出，已并入你的 4 项决策）。批准后才进入 Phase 2 Plan。
> 本文档是"我们造什么、为什么、怎么算做完"的唯一依据。

---

## 0. 背景与动机

工作区已有一套**可用的检索核心**，但**入口形态都不合适**：

| 现有形态 | 问题 |
|---|---|
| MCP 工具（已注册进 DSH） | 只能在 DSH 会话里用；我给你路径，**你在 DSH 里打不开 `G:\` 的图**（`present.open` 源码注释写明只开 "workspace file"，实测 500） |
| CLI（`cli.py`） | 每次新进程 **11.2 秒**（载模型固定开销），不适合交互式翻看 |
| HTTP 界面（`server.py` + `static/index.html`） | 已有缩略图网格，但要手动起服务，且不算"应用" |
| DSH 右栏插件（**已撤销并清除**） | 侵入 DSH 配置、槽位契约不确定、曾导致 DSH 起不来 |

**结论**：做**独立应用**，自己拥有窗口、自己读 `G:\`、自己显示图。不依附 DSH。

## 1. Objective

给建模/美术工作者一个**本地、离线可用**的素材库检索器。

> **部署形态（已定，决策 2）**：**要分发到别的机器**，不只是本机自用。因此：
> · 安装器**只含应用本体**，**不含模型与索引**
> · 模型**首次运行获取**（联网下载 或 指向本地副本），索引**随库在本机首次生成**
> · 分发默认精度档**与已验证配置一致（fp32 + 预处理 v1 + seq140）**；`q4f16` 质量未测，要用需先验证
> · 需做**干净机器验收**（无模型缓存 / 无网络 / 干净用户配置）

- **找素材**：一句中文描述，或一张参考图 → 找出 `G:\model` 里最接近的预览图
- **看到图**：结果以缩略图网格呈现，**应用自己显示**
- **取到包**：一键①在资源管理器**定位**同名压缩包，或②**复制**到指定目录
- **维护索引**：应用内**图形界面**扫描更新，带进度与取消
- **不联网**：模型与索引全在本地，断网可用

**成功的样子**：双击图标 → ≤5 秒出窗口 → 输入"现代简约布艺沙发" → ≤200 ms 出网格 → 点一条 → 资源管理器弹出并选中该 `.rar`。

## 2. 用户与场景

- **首要用户**：你（本机 `MARCO\Administrator`，RTX 2060 / 6 GB，16 逻辑核）
- **典型场景**：收到参考图 → 丢进应用 → 判断库里有没有同款 → 有就取包；新素材拖进应用即可入库
- **不包含**：多人协作、云端同步、素材内容编辑（改图／改模型）；**包含**入库与增量管理（见 §六 设计与 §6.3 修订）

## 3. Tech Stack

**运行时（spike 实测后定稿）：纯 Node，不再需要 Python**

| 项 | 决定 | 依据（全部实测） |
|---|---|---|
| 推理 | **`@huggingface/transformers` 4.3.1 + `onnxruntime-node` 1.30.0** | 文本塔与 torch **bit-exact（余弦 1.000000）** |
| 设备 | **`device: 'webgpu'`**（失败则回落 `cpu`） | 图像 **0.42 s/张 @seq140**（CPU 是 1.39 s）；向量与 CPU **小数点后 6 位一致** |
| 模型 | `onnx-community/embeddinggemma-2-ONNX`，**只下文本塔+视觉塔**（跳过音频塔） | 音频塔占仓库 40% 体积，检索用不到 |
| 精度档 | 默认 **q4f16（243 MB）**；fp16（837 MB）；fp32（1.63 GB，与 spike 对照同精度） | 逐文件量过体积 |
| 设备精度 | **float32**（`dtype: 'fp32'`） | 本机 bf16 实测慢 11× 且 L2 归一化失效；float16 模型卡禁用 |
| 取像预算 | **`image_seq_length = 140`** | 现有索引即 140，且已证明够用；280 会慢一倍 |
| 外壳 | **Electron** | Node 生态齐备，无需新增工具链 |

**前端（已定，详见 `UI-REVIEW-and-migration.md` §4）**

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | **TypeScript** | 前端、IPC 参数、业务类型三处一致 |
| UI 框架 | **React** | 结果网格 / 筛选面板 / 任务状态等复杂交互 |
| 组件库 | **shadcn/ui + Radix UI** | 关键：Radix 提供 `AlertDialog`/`Dialog`/`Popover`/`Toast`，正是**文件操作确认弹窗**所需的焦点管理与 `aria-*` |
| 样式 | **Tailwind CSS** | 统一间距与颜色；深色侧栏 + 浅色工作区 |
| 图标 | **Lucide** | 本地包，离线；替换原型里的 Unicode 字符 |
| 工程化 | **electron-vite** | 主进程/预加载/渲染三端一体构建，产物直喂 electron-builder |
| 契约校验 | **zod** + 共享类型 | 落实审核要求：**IPC 参数白名单校验**，一套定义同时导出 TS 类型 |
| 状态 | **zustand**（+ IPC 事件流） | 索引进度是**推送**而非轮询，**不引入** TanStack Query |
| 长列表 | **@tanstack/react-virtual** | **仅用于浏览整库**（3594 条）；搜索结果 Top-K ≤ 100 **不需要** |
| 单测 | **vitest** | 引擎与事务状态机；不引入 CI |
| 字体 | **系统字体栈**或自托管 | 离线要求下**不得**回退到联网 CDN |

> 明确不做：图表库、双主题同时实现、数据请求库、表单库、复杂动画。理由见 `UI-REVIEW-and-migration.md` §8。

**已排除的路线（都有实测依据）**

| 路线 | 结果 |
|---|---|
| ONNX + **DirectML** | ❌ 结构上跑不了：`Reshape node_view_1` → `E_INVALIDARG`（两次确认，与精度无关） |
| ONNX + **CUDA** | ❌ Windows 上不支持：`Unsupported device: "cuda". Should be one of: dml, webgpu, cpu` |
| ONNX + **CPU** | ⚠️ 可用但慢：1.32 s/张（WebGPU 的 3.3×慢），仅作 WebGPU 的回退 |
| **Tauri** | 需先装 Rust 工具链（实测 `.cargo` 不存在，PATH 里是卸载残留）；优势只剩体积，而后端成本才是大头 |

**性能对照（20 张实测，同一批图）**

| | torch（CUDA/Python） | ONNX CPU | **ONNX WebGPU** |
|---|---|---|---|
| 模型载入 | 3.70 s | 2.11 s | **2.57–2.63 s** |
| 图像 seq140 | 0.16 s/张 | 1.32 s/张 | **0.42 s/张** |
| 图像 seq280 | 0.34 s/张 | 3.42 s/张 | **0.80 s/张** |
| 文本 | ~50 ms/条 | ~36 ms/条 | **~21 ms/条** |
| 建索引 3594 张 @140 | ~10 分钟 | ~1.3 小时 | **~25 分钟** |
| 向量 vs torch | 基准 | 中位 0.9957 | **与 CPU 逐位一致** |

**因为不再有 Python，打包结论也变了**
- 旧结论（5 GB 级、不可分发、需拉起 venv 子进程）**作废**
- 新结论：应用 = Electron（~200 MB）+ 模型（q4f16 243 MB / fp16 837 MB / fp32 1.63 GB）+ 索引（11 MB）
- ⚠️ **但"打进一个包"要注意上限**：NSIS 安装器约 **2 GB** 封顶，Electron + fp32 模型（1.63 GB）会顶到边缘。
  因此**模型与索引不进安装器**（见上"部署形态"）：安装器只装应用，模型首次获取，索引随库生成
- **不再需要**：`.venv` 4.35 GB、Python 子进程、HTTP 端口、torch/transformers/sentence-transformers

**一次性迁移成本**
- 图像索引**必须用 ONNX 重建**（两侧预处理差约 0.4%：中位余弦 0.9957）
- 按 seq140 计 **约 25 分钟**（WebGPU），完成前不可检索——由「增量」视图显示进度
- 现有索引 `data/embeddings.npy`（140 精度）**保留作对照**，不直接复用（跨 seq 差异最差 0.76，绝不可混）

## 4. Commands

```powershell
$py  = "D:\USERS\Desktop\Agent\.venv\Scripts\python.exe"
$env:HF_HOME = "D:\USERS\Desktop\Agent\model-cache\hf"
$env:HF_HUB_OFFLINE = "1"

# 建/续建索引（可中断续跑；GPU 实测 0.3 秒/张）
& $py cli.py build --seq 140

# 索引状态
& $py cli.py stats

# 后端（开发态）
& $py server.py --port 8760

# 无头查询（脚本化）
& $py cli.py --json search-text "现代简约布艺沙发" --top-k 5
& $py cli.py --json search-image "G:\model\VR\ID-xxx.jpg" --top-k 5

# 应用（新增）
cd app; npm run dev      # 开发态：Electron + 热重载
cd app; npm run build    # 产出可运行目录
cd app; npm start        # 运行已构建版本

# 自检
& $py verify_app.py      # 后端接口 11 项（将扩充）
```

## 5. Project Structure

```
D:\USERS\Desktop\Agent\gemma-search\      ← 项目根（沿用）
├── gemma_lib.py  store.py  search.py  tools.py  build_index.py   ← 稳定核心，不改
├── server.py           后端 HTTP API + 静态界面（已成为应用后端）
├── cli.py              命令行（保留：无头查询与索引维护）
├── static/index.html   单文件界面（应用窗口加载它）
├── app\                **新增**：Electron 外壳
│   ├── main.js         主进程：起后端子进程、开窗、IPC（定位/复制/索引）
│   ├── preload.js      安全的 IPC 桥
│   ├── renderer\       界面（加载 static/index.html 或自带页面）
│   └── package.json    electron / electron-builder 依赖
├── data\               索引、查询图、预览副本
├── tests\              **新增**：应用层无头自检
└── SPEC-app.md         本文档

# 本期将移除（应用取代 MCP 档后）
mcp_server.py  register_mcp.py  verify_mcp.py
+ DSH profile 的 cordis.patch.yml 里那条 mcp-gemma-search 注册
```

**关键约束**：`gemma_lib.py` / `store.py` / `search.py` / `tools.py` 是已验证的稳定核心，应用层**只调用不改行为**。

## 6. Code Style

Python：关键处标注类型；**日志一律走 stderr**（`_log`），绝不 `print` 到 stdout（stdout 属协议通道，曾因此踩坑）。

```python
def _log(*a, **kw):
    """所有诊断输出走 stderr：stdout 属于协议通道。"""
    kw.setdefault("file", sys.stderr)
    kw.setdefault("flush", True)
    print(*a, **kw)

def reveal_in_explorer(path: str) -> None:
    """在资源管理器里定位文件（不复制、不移动素材库内容）。"""
    _log("[app] 定位:", path)
    subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
```

JS：主进程用 CommonJS，渲染进程通过 `preload.js` 暴露的白名单 API 访问能力，**不开 `nodeIntegration`**。
前端沿用 `static/index.html` 的单文件风格、**无 CDN**（必须离线）。

## 7. Testing Strategy

- **无头自检脚本**（沿用现有模式，不引入 pytest）：
  - `verify_app.py` 扩为后端 + 应用层检查
  - 新增 `tests\verify_shell.mjs`：主进程 IPC 处理器（定位/复制/索引进度）的纯函数单测
- **确定性优先**：文件相关断言用"路径存在 / 字节数 / 哈希"，不靠肉眼
- **人工验收**（无法自动化，单列）：缩略图是否显示、定位是否弹出资源管理器、索引进度是否推进
- **不引入**：pytest / CI / 前端测试框架

## 8. Boundaries

**Always**
- 跑自检通过后再宣布功能完成
- `G:\model` **只读**：不写、不移、不改名
- 日志走 stderr
- 编码只用 CUDA + float32

**Ask first**
- 新增第三方依赖（尤其前端框架、打包器）
- 改索引格式或向量维度（`embeddings.npy` / `items.json`）
- 写工作区以外的任何文件（含 DSH 配置——**已因此出过两次事故**）
- 删除素材库或索引里的任何东西

**Never**
- 声称嵌入模型"看得出图里是什么"（它是嵌入模型，只产出向量）
- 用 `Set-Content -Encoding UTF8` 写配置（PS 5.1 会加 BOM，曾导致 DSH 起不来）
- 在没备份的情况下重写 JSON/YAML 配置
- 把 `G:\model` 的文件复制进库外目录当"备份"

## 9. Success Criteria

1. **窗口可达**：双击启动，≤5 秒出可用窗口（不含首次模型加载）
2. **检索够快**：模型已加载后，文本查询 ≤200 ms 出结果（现状 MCP 档实测 39 ms）
3. **图能看见**：结果以缩略图网格呈现，**应用内直接可见**
4. **能定位**：任一条结果可一键在资源管理器选中其同名 `.rar`/`.zip`
5. **能取包**：可把选中的包**复制**到指定目录（目标目录可配置，默认桌面 `待用素材\`）
6. **能维护索引**：应用内有扫描更新入口，**显示进度、可取消**，且更新期间检索不静默抢 GPU
7. **离线可用**：断网全部功能正常
8. **不碰素材库**：全程对 `G:\model` 零写入（用文件数与 mtime 核对）
9. **索引自洽**：`stats` 显示 `encoded == indexed`，无待编码项

## 10. 已定决策与遗留问题

**已定（本轮）**

| # | 决策 | 结果 |
|---|---|---|
| Q1 | 外壳 | **Electron**（实测无 Rust 工具链；Node 齐备） |
| Q2 | 取件语义 | **A + B**：资源管理器定位 **和** 复制包到指定目录 |
| Q3 | 索引维护 | **B**：应用内图形界面，带进度与取消 |
| Q6 | 与 DSH 关系 | **B**：应用取代 MCP 档；`mcp_server.py` 等与其 DSH 注册**一并移除** |

**按默认处理（你要改就说）**
- Q4 库路径：**固定 `G:\model`**，不做多库（本期）
- Q5 常驻：**不做开机自启/托盘**，用时双击

**遗留问题（需你确认，否则我按推荐执行）**
1. **Electron 还是坚持 Tauri？**（见 §3；选 Tauri 需先装 Rust 工具链）
2. **MCP 档的移除时机**：推荐**等应用验证通过后**再移除，避免出现"两边都不能用"的窗口期。你也可要求现在就移除。
3. **复制包的目标目录**默认用桌面 `待用素材\` 是否可以？还是你指定别的路径？

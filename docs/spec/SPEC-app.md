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
| 精度档 | **默认 `fp32`（1.63 GB）** —— 与已验证配置一致。`fp16`（837 MB）/ `q4f16`（243 MB）体积更小但**检索质量从未测量**，要用必须先补质量验证并登记新的 `compat` | 体积逐文件量过；见 §10 Q8 |
| 设备精度 | **float32**（`dtype: 'fp32'`） | 本机 bf16 实测慢 11× 且 L2 归一化失效；float16 模型卡禁用 |
| 取像预算 | **`image_seq_length = 140`** | 现有索引即 140，且已证明够用；280 会慢一倍 |
| 外壳 | **Electron** | Node 生态齐备，无需新增工具链 |

**前端（已定，详见 `docs/design/UI-REVIEW-and-migration.md` §4）**

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

> 明确不做：图表库、双主题同时实现、数据请求库、表单库、复杂动画。理由见 `docs/design/UI-REVIEW-and-migration.md` §8。

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

> **本节 2026-10-10 重写**：旧内容（`$py server.py --port 8760`）属**已作废的 Python 子进程形态**。
> 标「P2 起」的命令在 Electron 骨架落地前不存在。

```powershell
cd D:\USERS\Desktop\Agent\gemma-search

# 引擎无头单测（不经传输层）—— P1 的主要验收手段
pnpm test                        # vitest，只跑 core/ 与 transactions/

# 建/续建索引（WebGPU 实测约 2.1–2.4 条/秒 → 3594 条约 25 分钟；可中断续跑）
$env:GEMMA_GPU_MODEL  = (nvidia-smi --query-gpu=name --format=csv,noheader | Select-Object -First 1).Trim()
$env:GEMMA_GPU_DRIVER = (nvidia-smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim()
node onnx-spike/build_index_onnx.mjs --model <ONNX 模型目录> --lib "G:\model" `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1

# 门禁：预检 + 三道质量判据 + 证据报告
& ..\.venv\Scripts\python.exe tools/preflight_p05.py --with-resume-test
& ..\.venv\Scripts\python.exe tools/quality/quality_vector_equiv.py --new-index data/idx-full
& ..\.venv\Scripts\python.exe tools/quality/quality_top10.py --model <ONNX 模型目录> --new-index data/idx-full
& ..\.venv\Scripts\python.exe tools/quality/quality_report.py --new-index data/idx-full

# 应用（Node/Electron）依赖与开发态（P2 起）
npm install
# ⚠️ electron 的平台二进制**不随 npm 包一起来**：
#    若 %LOCALAPPDATA%\electron\Cache 为空且报 `fetch failed`，用镜像显式取一次：
#    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
#    node node_modules/electron/install.js
#    实测：GitHub releases 页面 HEAD 返回 200，但**资产下载**失败；npmmirror 镜像正常。
#    刻意不写进仓库的 .npmrc —— 那是本机网络环境的权宜，钉死会连累网络正常的机器。
npm run dev                      # electron-vite dev server + HMR（经 scripts/electron-vite.mjs）
npm run build                    # 三端产出 → out/main · out/preload · out/renderer
npm start                        # = electron-vite preview：跑 build 出来的产物
# 上面 dev/start 经 scripts/electron-vite.mjs 转发：它会先摘掉 ELECTRON_RUN_AS_NODE
# （该变量会让 Electron 以纯 Node 运行，dev 态无法靠主进程自愈）。
# 日志：主进程 + 渲染进程诊断都写 data\_app.log（GUI 子系统没有 stdout）。
```

## 5. Project Structure

```
gemma-search\
├── core\                     **引擎：传输无关**（无 Electron / 无 HTTP / 无全局状态）
│   ├── engine.mjs            方法入口（见 docs/spec/CONTRACT-engine-v1.md）
│   ├── index.mjs             index.bin 读写与强校验（MAGIC / footer / 向量块 sha1）
│   ├── uid.mjs               uid = sha1(lib_id|rel_dir|stem)[:12]（**冻结**）
│   ├── compat.mjs            兼容性判定键（SPEC-identity §6.3）
│   └── transactions\         状态机 + 事务日志 + 启动恢复 + 撤销
├── src\                      **应用主体（electron-vite）**（P2，2026-10-10 迁移）
│   ├── main\                 主进程：载引擎、编码器端口、thumb:// 协议、IPC、日志（见 src/README.md）
│   ├── preload\              contextBridge 白名单（**产物必须 CJS**，sandbox 要求）
│   ├── renderer\             index.html + src/main.js（迁移期普通 JS；P3a 换 React + Tailwind + shadcn/ui）
│   └── shared\               跨端共享的 IPC 契约与 zod schema（唯一来源）
├── electron.vite.config.mjs  三端构建配置（dependencies 全部 external）
├── tsconfig.{json,node,web}.json  编辑器用；**暂不作 typecheck 门禁**（checkJs 关，P3a 转 TS 时接上）
├── electron-builder.yml      打包配置（P6 才用）
├── build\ resources\         打包资源（图标 / entitlements）
├── app\                      ⚠️ **已被 src\ 取代**，留作可回退档（`npm run start:legacy`），验证通过后归档
├── tests\                   引擎与事务的无头单测（vitest）
├── onnx-spike\              索引构建器与 spike（**当前唯一可用的构建路径**）
├── static\prototype\        UI 原型（评审用，已接入设计令牌）
├── data\                    索引与派生物（多数不入库，见 .gitignore）
└── <旧 Python 档>            gemma_lib.py / store.py / search.py / server.py / cli.py …
                              **保留至 P7**：它仍是当前唯一在用的检索档
```

**关于旧 Python 档**：§3 定的是「新应用不再需要 Python」，**不等于现在就删**。
P7 之前它们保持原样（只调用、不改行为），并继续服务 DSH 里的 MCP 工具。

## 6. Code Style

- **引擎（`core/`）**：纯 ESM `.mjs`，无框架依赖。**不 import `electron`、不 import `http`**
  —— 这是「传输无关」的**可执行判据**：`core/` 里出现这两者即违规，单测会拦住
- **主进程 / 渲染进程**：TypeScript。渲染进程 `nodeIntegration:false`、`contextIsolation:true`，
  只能经 preload 暴露的白名单 API 访问能力
- **IPC 契约**：zod schema 定义一次，同时导出 TS 类型（放 `src/shared/`）
- **日志**：引擎与主进程的诊断输出走 **stderr**，stdout 属协议通道（旧档曾因此踩坑）
- **离线**：不得引用任何 CDN；字体用系统栈或自托管

## 7. Testing Strategy

- **引擎无头单测（vitest）**：直接打 `core/`，不经传输层 —— P1 验收的主要手段
- **故障注入 10 项**（`docs/spec/SPEC-transactions.md` §8）：**真杀进程**，验启动恢复
- **确定性优先**：文件断言用「路径存在 / 字节数 / 哈希」，不靠肉眼
- **人工验收（无法自动化，单列）**：缩略图是否显示、定位是否弹出资源管理器、进度是否推进
- **不引入 CI**。Python 侧沿用既有 `verify_*.py` 自检脚本 —— 那是**旧档**的守卫

## 8. Boundaries

**Always**
- 跑自检通过后再宣布功能完成；关键结论要附可复现命令
- 写素材库**必须**走四步纪律（见 `docs/spec/SPEC-transactions.md`）
- 路径**只能**由 `lib_id + uid` 解析；**不接受客户端给的绝对路径**
- **库根包含校验**：解析后的真实路径必须仍在库根内（符号链接 / 联接点越界即拒绝）
- 只读操作绝不写库

**Ask first**
- 新增第三方依赖（尤其前端框架、打包器）
- 改 `index.bin` 格式、UID 规则或向量维度
- 写工作区以外的任何文件（含 DSH 配置 —— **已因此出过两次事故**）
- 删除素材库或索引里的任何东西

**Never**
- 声称嵌入模型「看得出图里是什么」（它只产出向量）
- 用 `Set-Content -Encoding UTF8` 写配置（PS 5.1 会加 BOM，曾导致 DSH 起不来）
- 在没备份的情况下重写 JSON/YAML 配置
- 把 `G:\model` 的文件复制进库外目录当「备份」
- 在 `core/` 里 import `electron` 或 `http`

## 9. Success Criteria

1. **窗口可达**：双击启动，≤5 秒出可用窗口（不含首次模型加载）
2. **检索够快**：模型已加载后，文本查询 ≤200 ms 出结果（旧档实测 39 ms 作参照）
3. **图能看见**：结果以缩略图网格呈现，应用内直接可见
4. **能定位**：任一条结果可一键在资源管理器选中其同名包
5. **能取件**：可把选中的包复制到指定目录（默认 `E:\素材待用\`，可配置）
6. **能维护索引**：应用内有扫描/增量入口，显示进度、可取消，且更新期间检索不静默抢 GPU
7. **离线可用**：断网全部功能正常
8. **写库有纪律**：任何写入可撤销、可审计；**移出库**走 `E:\移出素材\`，不提供真删除
9. **索引自洽**：`indexStatus` 显示 `encoded == indexed` 无待编码项；`failed[]` 为空或逐条归因
10. **多库**：可注册多个库；跨库检索**只合并 `compat` 相等的库**，其余置灰并给出**结构化原因**

## 10. 已定决策与遗留问题

**已定（全部锁定，逐条可追溯）**

| # | 事项 | 结论 |
|---|---|---|
| Q1 | 外壳 | **Electron**（实测无 Rust 工具链） |
| Q2 | 取件语义 | **定位 + 复制**两者都有 |
| Q3 | 索引维护 | 应用内图形界面，带进度与取消 |
| Q4 | 库路径 | **多库**（本节旧文「固定 `G:\model`，不做多库」**已作废**） |
| Q5 | 常驻 | 不做开机自启 / 托盘 |
| Q6 | 与 DSH 关系 | 应用取代 MCP 档；**退役放最后（P7）**，避免「两边都不能用」的窗口期 |
| Q7 | 运行时 | **纯 Node**（无 Python 子进程、无 HTTP 端口） |
| Q8 | 精度档 | **默认 fp32 + 预处理 v1 + seq140** —— q4f16 / fp16 的检索质量**从未测量**，统一 fp32 以免 `compat` 分歧 |
| Q9 | 写库 | **允许**，但必须走四步纪律；删除只提供「移出库」 |
| Q10 | 传输层 | **IPC**（不引入 REST；触发条件见 `docs/design/DESIGN-app-details.md` §8.4） |
| Q11 | 打包 | 安装器**只装应用**；模型首次获取、索引随库生成（P6 目标含其他机器） |
| Q12 | 侧栏深浅 | 见 `TASK-PLAN.md` §8 决策 4 |

**遗留问题**：无阻塞项。

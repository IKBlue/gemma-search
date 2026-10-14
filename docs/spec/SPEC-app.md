# SPEC: 素材库语义检索独立应用（Material Library Search App）

> 状态：**现行**（已批准，执行到 P3）
> 最后核对：2026-10-12
> 权威范围：应用技术栈与目录结构 · 目标与成功标准 · 边界
> 本文档是"我们造什么、为什么、怎么算做完"的依据；**技术栈表以实际实现为准**（权威关系见 `AGENTS.md` §7.1）。

---

## 0. 背景与动机

工作区早期存在过几种入口形态，**都不适合日常翻看素材**：MCP 工具只能在 agent 会话里调用；命令行每次冷启动都要重新载模型；本地 HTTP 页面要手动起服务、不算应用。

**结论**：做**独立应用** —— 自己拥有窗口、自己读素材库、自己显示图，不依附任何会话或服务。这些早期形态已随旧档整体退役（仓库现在**零 Python 文件**，欠账见 `docs/DEBT-CLEANUP.md`）。

## 1. Objective

给建模/美术工作者一个**本地、离线可用**的素材库检索器。

> **部署形态（已定，决策 2）**：**要分发到别的机器**，不只是本机自用。因此：
> · 安装器**只含应用本体**，**不含模型与索引**
> · 模型**首次运行获取**（联网下载 或 指向本地副本），索引**随库在本机首次生成**
> · 分发默认精度档**与已验证配置一致（fp32 + 预处理 v2 + seq140）**；`q4f16` 质量未测，要用需先验证
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

**前端（**以实际实现为准**，详见 `docs/design/UI-REVIEW-and-migration.md`）**

| 层 | 实际选型 | 说明 |
|---|---|---|
| 语言 | **普通 JS / JSX**（`.js` / `.jsx`，全仓 **0 个 `.ts`/`.tsx`**） | **TypeScript 迁移是计划**（P3a），当前 `tsconfig*.json` 的 `checkJs: false`，**没有 typecheck 门禁** |
| UI 框架 | **React 19**（`react` / `react-dom` + `@vitejs/plugin-react`） | 结果网格 / 侧栏 / 面板等交互 |
| 组件库 | **自研 `ui/`**（约 10 个函数组件 + 极小 `cx()` class 合并） | 不引第三方组件库 |
| 样式 | **迁移前＝手写 CSS**：`renderer.css` 只消费 `var(--*)` 令牌 | ⚠️ **2026-10-13 所有者已确认反转**：落地 TypeScript + Tailwind CSS + shadcn/ui + Zustand + React Router，且**允许 Tailwind 成为新的样式来源**（`tokens.css` 降级为其输入之一）。详见 `docs/plan/ROADMAP.md` §10（迁移规模/顺序/验收）。**在 §10.3 第 4 步落地前，新组件仍按手写 CSS 写** |
| 状态 | **自研 hooks**（`useEngine` / `useSearch` / `useToast`）+ IPC 事件流 | 索引进度是**推送**而非轮询；`zustand` 已装但零 import。**2026-10-13 已决定改用 Zustand**（ROADMAP §10.3 第 3 步） |
| 长列表 | **暂无虚拟化**（P3 只做到搜索页） | `@tanstack/react-virtual` 已装但零 import；需要时再接 |
| 路由 | **单页**（`LibraryGate → SearchPage`） | **2026-10-13 已决定接 React Router**（ROADMAP §10.3 第 3 步）；P3c/P3d 的多页本来就缺它 |
| 工程化 | **electron-vite**（三端一体构建） | 产物显式落 `<仓库根>/out/{main,preload,renderer}` |
| 契约校验 | **zod**（`apps/desktop/src/shared/ipc.ts`） | 方法白名单 + 逐方法 `.strict()` + 载荷上限；**TS 类型是计划中**，当前不导出 |
| 单测 | **`node:test`**（`npm test`） | 引擎与事务状态机；`vitest` 已装但零使用 |
| 字体 | **系统字体栈** | 离线要求下**不得**回退到联网 CDN |

> ⚠️ **依赖声明与实际使用有落差**：`@radix-ui/*` · `lucide-react` · `zustand` · `@tanstack/react-virtual` · `clsx` · `class-variance-authority` · `tailwind-merge` · `tailwindcss` 仍列在 `package.json`，但在 `apps/desktop/src/` 下**全仓零 import**（实测 grep）。
> 这是历史栈承诺（TS + Tailwind + shadcn/ui）的残留，**不是现行技术栈**。清理依赖属独立事项，本轮不做增删。

> 明确不做：图表库、双主题同时实现、数据请求库、表单库、复杂动画。

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

**打包结论**
- 应用 = Electron（~200 MB）+ 模型（q4f16 243 MB / fp16 837 MB / fp32 1.63 GB）+ 索引（11 MB）
- ⚠️ **"打进一个包"要注意上限**：NSIS 安装器约 **2 GB** 封顶，Electron + fp32 模型（1.63 GB）会顶到边缘。
  因此**模型与索引不进安装器**（见上"部署形态"）：安装器只装应用，模型首次获取，索引随库生成
- 交付面因此只有应用本体；模型与索引都是**首次运行/随库生成**的本机产物

**一次性迁移成本**
- 图像索引**必须用 ONNX 重建**（两侧预处理差约 0.4%：中位余弦 0.9957）
- 按 seq140 计 **约 25 分钟**（WebGPU），完成前不可检索——由「增量」视图显示进度
- 旧格式索引（`data/embeddings.npy`，140 精度）**保留作对照**，不直接复用（跨 seq 差异最差 0.76，绝不可混）


## 4. Commands

> **本节 2026-10-12 重写**：命令区只保留**当前真能跑**的东西。早期形态的命令（子进程、HTTP 端口、旧质量判据脚本）已随旧档退役，不再列出。

```powershell
cd <仓库根>

# 引擎无头单测（node:test，不经传输层）
npm test                                  # 期望：tests 113 · pass 112 · fail 0 · skipped 1

# 应用（Electron）开发与构建
npm install
# ⚠️ electron 的平台二进制**不随 npm 包一起来**：
#    若 %LOCALAPPDATA%\electron\Cache 为空且报 `fetch failed`，用镜像显式取一次：
#    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
#    node node_modules/electron/install.js
#    实测：GitHub releases 页面 HEAD 返回 200，但**资产下载**失败；npmmirror 镜像正常。
#    刻意不写进仓库的 .npmrc —— 那是本机网络环境的权宜，钉死会连累网络正常的机器。
npm run dev                               # electron-vite dev server + HMR（经 scripts/electron-vite.mjs）
npm run build                             # 三端产出 → out/main · out/preload · out/renderer
npm start                                 # 跑 build 出来的产物
npm run dev:restricted / start:restricted # 受限环境（Chromium 沙箱起不来）才用，附加 --no-sandbox

# 建/续建索引（WebGPU 实测约 2.1–2.4 条/秒 → 3594 条约 25 分钟；可中断续跑）
node packages/indexer/src/build_index_onnx.mjs --model <ONNX 模型目录> --lib <素材库根> `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1

# 守卫（全部只读；期望值与前置条件见 AGENTS.md §3）
node tools/verify_encoder_path.mjs --model <ONNX 模型目录>   # 编码路径（跑真实推理）
node tools/check_search.mjs               # 检索端到端自查（需查询向量）
```

> 已按所有者指令移除**（原件备份在 `data/_removed-guards-backup/`）。上面只列现存的两个 —— 这两个都需要
> 模型目录与已注册索引，**在 agent 沙箱里跑不动**；移除的代价见 [`TODO.md`](../TODO.md) B-4。

> 日志：主进程 + 渲染进程诊断都写 `data\_app.log`（GUI 子系统没有 stdout）。
> 前后端命令口径的完整版（含每个守卫的前置条件与"证明不了什么"）见 `AGENTS.md` §3 与 `README.md` §2。

## 5. Project Structure

> **2026-10-12 按 monorepo 布局重写**（目录结构已冻结，见 `docs/MIGRATION-PLAN.md` §1）。每个顶层目录的职责与「能不能改 / 进不进 git」见 `AGENTS.md` §4。

```
gemma-search/
├── AGENTS.md · README.md          仓库根只留这两份 .md
├── package.json                   npm workspaces 根（apps/* + packages/*）
├── apps/
│   └── desktop/                   Electron 应用
│       ├── src/main/              主进程：载引擎、编码器端口、thumb:// 协议、IPC 分发、日志
│       ├── src/preload/           安全桥（**产物必须 CJS**，sandbox 要求）
│       ├── src/renderer/          index.html + React 19 界面（普通 JS/JSX + 手写 CSS）
│       └── src/shared/ipc.ts     ★ IPC 契约唯一来源（方法白名单 + zod 校验）
├── packages/
│   ├── engine/                    ★ 引擎：传输无关、**零第三方依赖**
│   │   ├── src/{engine,index,library,fingerprint,compat,errors}.mjs
│   │   └── tests/*.test.mjs       引擎单测（node:test，跟引擎走）
│   ├── indexer/                   索引构建（ONNX + WebGPU）+ 重采样兼容层 + BMP 解码
│   └── design-tokens/tokens.css   ★ 视觉令牌唯一来源（生产依赖）
├── docs/                          全部正文文档：spec / design / guide / plan / audit / archive
├── tools/                         7 个只读守卫 + Electron 启动探针
├── reports/                       门禁证据（无归档证据 = 门禁未通过）
├── reference/MODEL_CARD.md        官方模型卡（只读）
├── data/                          索引 + 日志 + 诊断（绝大多数不进 git）
├── build/                         打包图标 + 签名配置（**不是产物目录**）
└── out/                           构建产物（不进 git）
```

**关于历史**：早期曾有一套 Python 检索档与一个被取代的应用外壳，均已退役；被取代的旧计划与旧外壳归档在 `docs/archive/`（**不再是依据**）。

## 6. Code Style

- **引擎（`packages/engine/`）**：纯 ESM `.mjs`，无框架依赖。**不 import `electron`、不 import `http`**
  —— 这是「传输无关」的**可执行判据**：那里出现这两者即违规，单测会拦住
- **主进程 / 渲染进程**：**普通 JS / JSX**（迁移期的既定形态；TS 迁移是计划，见 §3）。
  渲染进程 `nodeIntegration:false` / `contextIsolation:true` / `sandbox:true`，
  只能经 preload 暴露的白名单 API 访问能力
- **IPC 契约**：zod schema 定义一次（`apps/desktop/src/shared/ipc.ts`）；**当前不导出 TS 类型**（P3a 迁 TS 时再补）
- **日志**：主进程与渲染进程的诊断都写日志文件（`data\_app.log`）。**不要依赖 stdout** ——
  Windows 上 Electron 是 GUI 子系统程序，stdout 不连终端
- **离线**：不得引用任何 CDN；字体用系统字体栈

## 7. Testing Strategy

- **引擎无头单测（`node:test`）**：`npm test` 直接打 `packages/engine/src/`，不经传输层
- **7 个 Node 守卫**（只读）：产物形状 · 渲染层在 jsdom 真跑 · 样式与令牌一致性 · 编码路径 · 应用冒烟 · 检索端到端 · 文档引用
- **故障注入 10 项**（`docs/spec/SPEC-transactions.md` §8）：**真杀进程**，验启动恢复 ——**尚未实现**（事务功能本身未开始）
- **确定性优先**：文件断言用「路径存在 / 字节数 / 哈希」，不靠肉眼
- **人工验收（无法自动化，单列）**：缩略图是否显示、定位是否弹出资源管理器、进度是否推进
- **不引入 CI**：单测与守卫都在本机跑；「无归档证据 = 门禁未通过」，证据落 `reports/`

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
- 用 `Set-Content -Encoding UTF8` 写 JSON / 配置（PS 5.1 会加 BOM，本仓库历史上因此出过起不来的事故）
- 在没备份的情况下重写 JSON/YAML 配置
- 把素材库的文件复制进库外目录当「备份」
- 在 `packages/engine/` 里 import `electron` 或 `http`

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
| Q6 | 与旧检索档的关系 | 旧档（含 MCP 入口）**已于 2026-10-10 整体退役**（原计划的 P7 被提前执行）；本应用是**唯一入口**，仓库自身 0 个 `.py` 文件 |
| Q7 | 运行时 | **纯 Node**（无 Python 子进程、无 HTTP 端口） |
| Q8 | 精度档 | **默认 fp32 + 预处理 v2 + seq140** —— q4f16 / fp16 的检索质量**从未测量**，统一 fp32 以免 `compat` 分歧。**v2 不是笔误**：它是把 Node 侧重采样对齐参考实现（`resize_compat(pil-like)`）的那次修复，也就是 G-B 由 **FAIL 翻到 PASS** 的原因。实测 `data/libraries/L1/meta.json`：`preprocessing_version = 2` · `resample_impl = resize_compat(pil-like)` · `compat` 第 4 段 = `2` |
| Q9 | 写库 | **允许**，但必须走四步纪律；删除只提供「移出库」 |
| Q10 | 传输层 | **IPC**（不引入 REST；触发条件见 `docs/design/DESIGN-app-details.md` §8.4） |
| Q11 | 打包 | 安装器**只装应用**；模型首次获取、索引随库生成（P6 目标含其他机器） |
| Q12 | 侧栏深浅 | 见 `docs/plan/ROADMAP.md` §8 决策 4 |

**遗留问题**：无阻塞项。

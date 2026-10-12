# TROUBLESHOOTING · 常见故障与判读

> 每条给：**症状 → 原因 → 动作**。判断不了时先看 `data\_app.log`（Windows 上 Electron 的 stdout 不连终端）。
> 环境与验收口径见 [`GETTING-STARTED.md`](docs/guide/GETTING-STARTED.md)；门禁期望值见 [`AGENTS.md`](AGENTS.md) §5。

最后核对：2026-10-12

---

## 1. 应用起不来

| 症状 | 原因 | 动作 |
|---|---|---|
| 敲 `npm run dev` / `npm start` 后**什么都不发生**，日志一行都没有 | Chromium 进程沙箱在本环境起不来（受限沙箱 / 容器 / 部分企业策略），Electron **秒退**；或主进程压根没跑到 JS | ① 用 `npm run dev:restricted` / `npm run start:restricted`（只为这次启动加 `--no-sandbox`）；② 还要定性就用 `node tools\smoke_app.mjs` |
| 报错信息像"在跑 Node 而不是 Electron"（如 `require`/`electron` 未定义、行为像纯 Node） | 环境里有 `ELECTRON_RUN_AS_NODE`，它会让 Electron 以**纯 Node** 运行 | `npm run dev` / `npm start` 已经经 `scripts/electron-vite.mjs` 摘掉这个变量；**别绕过脚本直接敲 electron** |
| `npm install` 报 `fetch failed`，且 `%LOCALAPPDATA%\electron\Cache` 为空 | npm 包装上了，但 Electron 的平台二进制没下下来 | 用镜像显式取一次：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'` 然后 `node node_modules/electron/install.js` |
| 窗口出来了但界面空白 | 渲染层资源没被打进去 / 产物是旧的 | `npm run build` 后重试；再不行跑 `node tools\verify_app_build.mjs`（产物形状）与 `node tools\verify_renderer_dom.mjs`（渲染层真跑） |

**"窗口没出来"和"主进程没启动"在终端上长得一模一样** —— 这正是 `tools/smoke_app.mjs` 存在的理由：它直接跑构建产物、把日志指到独立文件、并把子进程的输出接回来，最后按退出码分档（`1` 产物缺失 / `2` 没跑到 JS / `3` 跑到 JS 但没出窗 / `4` 起来了但有报错）。

---

## 2. 守卫报错

| 症状 | 原因 | 动作 |
|---|---|---|
| 守卫抛 `找不到项目根（向上找不到 packages/engine/src/engine.mjs）` | 守卫靠**向上找标记文件**定位仓库根（这是刻意设计：搬目录也不会失效）。标记文件被改名/移动了 | 确认 `packages/engine/src/engine.mjs` 存在；否则说明目录结构被动过，先修结构 |
| `verify-doc-refs.mjs` 报 `xxx` 为死引用 | 守卫只做「形如 `.md` 的引用解算」。**误报有两类**：① **外部 URL 的末段**（镜像文件名，如 `color.md` / `typography.md`，见 `docs/audit/uiux-evidence.md:624-627`）；② **中文散文里裸写的文档名**（不在 URL、也不在行内代码里，如 `docs/audit/REVIEW-UIUX-AUDIT.md:432` 的 `materials.md`） | 这两类**不计入你的账**；但别新增。真正要清的是**仓库内**的死引用。**先分类再归因** —— 别一律写成"URL 误报" |
| `verify-doc-refs.mjs` 报「N 份不该留在根目录」 | 根目录纪律：只允许 `AGENTS.md` + `README.md` | 把正文文档移到 `docs/`；见 [`AGENTS.md`](AGENTS.md) §6 |
| `verify_renderer_dom.mjs` 说找不到 `out/renderer` | 它跑的是**构建产物**，不是源码 | 先 `npm run build` |
| `verify_renderer_styles.mjs` **通过**，但界面里明明有写死的颜色 | 这个守卫**只查一个方向**：它校验「用到的令牌都已定义」，**不查「定义了但没人用」**，也不扫 `docs/archive/prototype/` | 守门不等于没问题；写死颜色要人工看 |
| `verify_encoder_path.mjs` 报缺参数 | 它要跑真实推理 | `node tools\verify_encoder_path.mjs --model <ONNX 模型目录>` |
| `check_search.mjs` 报读不到查询向量 / 库找不到 | 它是一次性端到端自查，需要**已注册的索引 + 真实查询向量** | 先用索引构建器建/确认索引，再准备查询向量文件 |

---

## 3. 功能层面的"看起来坏了"

| 症状 | 原因（都是已记录在案的缺口，不是你没装好） | 动作 |
|---|---|---|
| 应用起来了，但**检索永远没有结果**，界面提示 `LIB_NOT_FOUND` | **D2**：仓库里没有 `config.json`，主进程却从它读库根 → 空库启动 | 这是未修缺口。**不要**去发明第二套配置来源或写一份 config 教学；先登记/处置 D2。见 [`AGENTS.md`](AGENTS.md) §7 |
| 点「定位」提示成功，但资源管理器**什么都没发生** | **F-01**：主进程从未注入 `shell` 端口，引擎在无 `shell` 时仍返回 `ok({revealed:true})` —— **静默假成功**（单测绿是因为测试自己注入了那个端口） | 要求见 `docs/spec/CONTRACT-engine-v1.md` §2.4；修的是接线，不是文档 |
| 「＋ 添加图库」「↻ 更新索引」点了只弹一个提示 | **P4/P5 未做**：主进程对 `ingest`/`mutate`/`indexStart`/`indexCancel` **显式拒绝** | 这是**有意的诚实降级**（不假装能干），不是崩溃。见 `docs/spec/CONTRACT-engine-v1.md` §2.5–§2.10 |
| 结果卡上的档位（"相似/较弱"）看着不对劲 | **D11**：界面自己算阈值（`0.97/0.93`），**没用引擎给的 `band`**，且阈值与引擎不同源；而契约明文要求「界面不自己算阈值」 | 代码侧缺陷（不是文档问题）。契约依据见 `docs/spec/CONTRACT-engine-v1.md` §2.1 |
| 20 个文件叫 `.jpg`、实际是 BMP，担心是坏文件 | 已知事实 | **不是坏文件**：解码路径会自动回退 |
| 换过素材库位置后全部条目报"素材文件找不到" | 索引里存的是**绝对路径**，库移动即失效 | 重建索引 |
| 索引报 `INDEX_CORRUPT` | MAGIC / footer / 向量块 sha1 校验失败 | 重建索引（见 [`GETTING-STARTED.md`](docs/guide/GETTING-STARTED.md) §4） |

---

## 4. 性能与"太慢了"

| 症状 | 原因 | 动作 |
|---|---|---|
| 图像编码明显变慢，界面提示回退 | WebGPU 不可用 → 回落 CPU（CPU 约为 WebGPU 的 1/3 速度） | 属预期回退。契约要求**不静默**：事件里带 `deviceFallback`，界面必须显示 |
| 建索引要 20 分钟以上 | 3594 张 @seq140 在 WebGPU 上的实测量级就是**约 25 分钟** | 正常。`seq` 是唯一提速杠杆，**换档必须全量重建** |
| 建索引时检索变慢一半 | 两者争 GPU | **不要边建边查** |
| **冷启动到底几秒？** | **尚未验证** | 不许声称。`docs/spec/SPEC-acceptance.md` §3.2 定义了口径（双击 → 窗口可交互 ≤5 s），但没有实测证据 |

---

## 5. 文档 / 工具链的坑

| 症状 | 原因 | 动作 |
|---|---|---|
| 用 `Get-Content` 数行号，结果和编辑器对不上 | PowerShell 5.1 按 GBK 解码 UTF-8 中文，多字节字符被拆坏并**合并行** | 用 `read` 工具或 node。实测（2026-10-12）：`docs/design/DESIGN-tokens.md` 被数成 245 行、实际 **292** 行；`docs/spec/SPEC-acceptance.md` 被数成 259 行、实际 **347** 行 |
| 中文乱码（`閰嶇疆` 之类） | 同上：以非 UTF-8 方式读/写 UTF-8 文件 | 读写一律按 UTF-8；别用 `Set-Content -Encoding UTF8`（PS 5.1 会加 BOM） |
| 想引用文档却不知道写哪种路径 | 引用散落在不同深度，`../` 会随深度变化 | **统一写仓库根相对**（`docs/spec/SPEC-app.md`）；见 [`AGENTS.md`](AGENTS.md) §6 |
| 声称了某个能力，被要求给证据 | 本仓库规则：**无归档证据 = 门禁未通过**；`reports/` 里 G-B 的判据脚本已随旧档退役、**不可复跑** | 把结论落到 `reports/G-<字母>-<日期>/`；引用旧证据时写明"不可复跑/引用既有证据"，不要写成"本轮实测" |
| 冷启动 / 打包后行为 / 真实 `thumb://` 取图 | **三者均尚未验证** | 任何文档、报告、提交信息都不得据此声称可用 |

---

## 6. 还是不行

1. 先看 `data\_app.log`（运行日志）与 `reports/` 里同类门禁的既有证据。
2. 再跑一遍对应的守卫，把**原始输出**留下来（不要只描述"失败了"）。
3. 到仓库里登记：结论带 `文件:行号` 或「命令 + 原始输出」；区分**代码事实 / 文档声称 / 行业做法**。
4. 缺口若属已有记录（D2 / D8 / D11 / D14 / F-01 / P4/P5 未做），**不要另立一套说法** —— 到 [`docs/audit/00-current-state.md`](docs/audit/00-current-state.md) 核对，冲突以磁盘为准并回写基线。

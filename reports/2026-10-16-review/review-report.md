# gemma-search 全面体检报告

> 生成：2026-10-16 · 方式：独立只读审查（不采信项目 md 的既有结论，结论以「命令+输出 / 文件:行号」为证据）
> 范围：代码 4 块 + 工程门禁 + 安全 + 依赖 + 打包 + 质量属性 + 界面功能完整性（不含文档审计）
> 严重程度：🔴致命 · 🟠严重 · 🟡中等 · 🟢轻微 · ⚪建议

---

## 0. 结论摘要（TL;DR）

这个项目**代码质量与安全设计在同类型桌面应用里属于上乘**：Electron 安全基线、路径安全、事务崩溃恢复、四层架构分层、破坏性操作两段式确认，都做得扎实，**未发现 🔴 致命缺陷**。

主要短板集中在三处：

1. **构建/打包链路当前是断的，且从未端到端验证过**（S1 + S2）—— 渲染端构建在本环境失败、`out/renderer` 为空、打包配置自述「从未真正打包过」。
2. **几个规格书标 P0 的界面功能缺失**—— 设置中心、快捷键、拖拽导入、批量多选、深浅色主题。
3. **元数据全押在实验性 `node:sqlite` 上**（S3）—— Node 24 下仍是 Release Candidate，未来可能变更/移除。

---

## 1. 门禁实测（工程门禁是否「真有效」）

| 门禁 | 命令 | 结果 | 结论 |
|---|---|---|---|
| 单测 | `npm test` | 644 通过 / 0 失败 / 1 跳过（645 用例，160s） | 🟢 真绿（崩溃注入、事务七步、编码边界都有真断言） |
| 类型 | `npm run typecheck` | EXIT=0（node + web 两段） | 🟢 通过，但**只覆盖 `.ts`**（checkJs 关闭，`.js/.mjs` 不查） |
| 构建 | `npm run build` | EXIT=1 失败 | 🔴 渲染端构建失败（见 S1） |
| E2E | `npm run e2e` | 未运行 | ⚪ 需 `--no-sandbox`+提权，且渲染产物为空 |

---

## 2. 缺陷发现清单

### 🟠 严重

**S1 · 构建门禁 RED：渲染端构建失败，`out/renderer` 为空**（第 5.3 / 8.2）
- 位置：`npm run build` 输出，重跑 3 次复现
- 描述：main（258KB）、preload（0.85KB）构建成功，但 client（renderer）段在 esbuild 转译时报 `remove ...\Temp\esbuild-xxx: Access is denied`，产物 `out/renderer` 为 0 字节 ⇒ 应用当前无法从构建产物启动。
- 证据：`npm run build` → `Build failed in 1.93s · [vite:esbuild-transpile] remove ... Access is denied`
- 定性：【环境 or 产品待定】esbuild 在 Windows 上删临时文件被拒通常由 Defender/杀软锁定所致；但换 `TMP` 到项目内目录仍复现，不能排除 esbuild/Vite 版本问题。
- 建议：① 确认杀软是否锁定 `%LocalAppData%\Temp` 并加排除；② 清理 `node_modules/.vite` 缓存重试；③ 在能绿的环境复跑后再验证打包态。

**S2 · 打包「从未真正验证过」**（第 8.1 / 8.2）
- 位置：`electron-builder.yml:1-10`（文件头自述）
- 描述：配置明确写着「从未真正打包过」；`asarUnpack` 只列 `resources/**`，而 `onnxruntime-node`/`sharp` 的原生 `.node` 在 asar 内加载不了、需实测加入 asarUnpack；模型 fp32 1.63GB 不进安装器（用户自备）。
- 证据：`electron-builder.yml:1-7` 注释原文；`dist/win-unpacked` 停留在 10-14。
- 建议：P6 阶段以 `npm run build:unpack` 实测打包态冷启动 + 编码 + 取图，按实测补全 asarUnpack。

### 🟡 中等

**S3 · 元数据全押在实验性 `node:sqlite` 上**（第 3.4 / 0.2）
- 位置：`apps/desktop/src/main/db/open.ts`、`sqlite-adapter.ts` 等 8 个文件 import `node:sqlite`
- 描述：6 张表全用 Node 内置实验性 API。Node 官方标 Stability 1.2（Release Candidate），不受语义化版本约束、未来可变更/移除。有薄适配层隔离，但风险真实。
- 证据：Node 官方文档 `nodejs.org/api/sqlite.html`（Stability 1.2）
- 建议：保留适配层 + 锁定 Electron 版本；升级前必测 SQLite 行为；备好「better-sqlite3 / WASM SQLite」逃生路线。

**S4 · 两个方法接受渲染层传来的绝对路径，与「渲染层传不进路径」设计声明不符**（第 6.3 / 3.2）
- 位置：`shared/ipc.ts`（`libraryAdd.root`、`collectDirAdd.absPath`）
- 描述：设计注释多处声称「渲染进程传不进任何绝对路径」，但这两处例外。虽被 `isTrustedSender` + 严格 CSP + 无远程内容大幅缓解，仍是纵深防御缺口。
- 建议：`libraryAdd`/`collectDirAdd` 只接受「本次对话框返回的路径」，或主进程二次校验「该路径确由用户对话框选中」。

**S5 · 设置中心（N4，P0）缺失**（第 10）
- 位置：`search/SearchSidebar.tsx:28`（`settings` 无 `to`）；`router/paths.ts` 无 settings 路由
- 建议：补 `/settings` 页面 + 路由 + 侧栏 `to`（详见 §4.4 设计方案）。

**S6 · 入库/增量（F3）缺失**（第 10）
- 位置：`SearchSidebar.tsx:22`（`入库与增量` 禁用占位，等数据表上线）

**S7 · 文档检索（F7）门控 + 侧栏连入口都没有**（第 10）
- 位置：`SearchSidebar.tsx:14-28`（NAV 数组无 docs 项）
- 描述：F7 是门控项（需 10–30 份真实文档才启动），但侧栏连「禁用占位」都没有，与 SPEC §4 信息架构（侧栏含「文档」）不符。

**S8 · 快捷键（N3，P0）基本缺失**（第 10）
- 位置：`search/SearchPanel.tsx:55-56`（仅搜索框 Enter）
- 描述：无 Cmd/Ctrl+K 命令面板、无方向键在结果间移动、无 Space 预览、无 Esc 清空、无 Ctrl+V 粘图搜。

### 🟢 轻微

**S9 · `cmdk` 依赖装了但零 import**（第 7.5）
- 位置：`package.json`（`cmdk@1.1.1`）；全仓 grep 无 import
- 建议：接上命令面板（配合 S8），否则删依赖。

**S10 · `bmp_decode.ts` 被同一模块静态+动态双 import**（第 2.4）
- 位置：`npm run build` 警告：`bmp_decode.ts is dynamically imported ... but also statically imported by encoder.ts`
- 建议：统一为一种 import 方式。

**S11 · 生产态保留 `devTools: true`**（第 6.1）
- 位置：`main/index.ts:1358`
- 建议：确认打开 DevTools 不会暴露敏感路径/能力（本地离线工具风险较低）。

### ⚪ 建议

**S12 · `npm audit` 无法执行**（环境限制）
- 位置：`npm audit` → 镜像源 `registry.npmmirror.com` 返回 `[NOT_IMPLEMENTED] audit endpoint`
- 建议：换官方源或手动查 sharp/onnxruntime/electron 已知 CVE。

**S13 · `node_modules/.vite` 残留 5 个 `deps_temp_*` 目录**（第 9.6，环境卫生）
**S14 · 应用图标仍是脚手架默认图标**（第 8.1，`electron-builder.yml:2-3` 自述）

---

## 3. 做得好的地方（正面，供对照）

1. **Electron 安全基线近乎满分**：`nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` / `webSecurity:true` / `webviewTag:false` / `allowRunningInsecureContent:false`（`main/index.ts:1352-1360`）；CSP 严格 `script-src 'self'`（无 unsafe-inline/unsafe-eval，`renderer/index.html:8-14`）；新窗口无条件 deny、外部导航拦截、来源校验三重判定（`window-security.ts`）。
2. **preload 暴露面最小**：只有 `invoke`/`onEvent`/`platform` 三个成员，不泄漏 `ipcRenderer`（`preload/index.ts`）。
3. **保留命名空间判定正确**：`gs-names.ts` 逐字处理 `.gs.db` 家族（第 4 字符是 `.` 不是 `-` 的坑），三处复用同一判据。
4. **路径安全扎实**：`thumb://` 不从 URL 取路径（注册表反查）；`resolveInLibrary` 逐段 `realpath` 防符号链接；`assertCollectDirAllowed` 词法+真实路径双重校验（junction 防穿透）。
5. **破坏性操作两段式**：`requestCollect → confirmCollect`，先清 `pendingCollect` 再执行（`store/search.ts:224-244`），取消零 IPC。
6. **引擎真零依赖**：无第三方 import；事务 fault-injection 测试真实模拟崩溃并断言恢复。
7. **band 档位只在引擎算**（`bandOf`），界面不自算阈值、不跨模态比分数。

---

## 4. 界面功能模块：现状审查 · 应有清单 · 缺口 · 对接建议

> 这是本报告的核心补充章节，回答四个问题：现在界面有哪些功能、应该有哪些、缺哪些要补齐、现有功能怎么和界面接得更好。

### 4.1 现有功能模块与界面对接现状

| 功能模块 | 界面入口 | 实现状态 | 对接评价 |
|---|---|---|---|
| 语义搜索（F1 找） | 侧栏「语义搜索」→ `/` | ✅ 已实现 | 文本 + 以图搜图 + band 展示，闭环完整 |
| 图片详情 | 结果卡点击 → `/item/:libId/:uid` | ✅ 已实现 | 详情 + 取件 + 定位到文件夹；侧栏该入口目前是禁用占位（仅从结果进入） |
| 浏览图库（F2 逛） | 侧栏「浏览图库」→ `/browse` | ✅ 已实现 | 网格 + 筛选 + 排序 + 计数 |
| 索引任务 | 侧栏「索引任务」→ `/tasks` | ✅ 已实现 | 进度 + 失败项展开 |
| 操作记录 | 侧栏「操作记录」→ `/activity` | ✅ 已实现 | 写操作审计 |
| 诊断与重建（F5 体检） | 侧栏「诊断与重建」→ `/health` | ✅ 已实现 | 体检 + 重建（两段式确认） |
| 首次运行向导 | 无库时自动进入 | ✅ 已实现 | 选库 → 选模型 |
| 库门禁 | 无库/库不可用时 | ✅ 已实现 | 锁定 + 引导 |
| 多库管理（F4 登记） | LibraryGate / 向导 | ⚠️ 部分实现 | 登记/启用/停用有；**库切换/列表 UI 待完善** |
| 设置中心（N4） | 侧栏「设置」禁用占位 | ❌ 缺失 | P0 |
| 入库/增量（F3 收） | 侧栏「入库与增量」禁用占位 | ❌ 缺失 | 门控（等数据表） |
| 文档检索（F7） | 侧栏无入口 | ❌ 缺失 | 门控 |

### 4.2 应有功能清单（这类 App 该有的，含当前实现状态）

| 类别 | 功能 | 当前状态 |
|---|---|---|
| 找 | 文字搜索 | ✅ |
| | 以图搜图（库内/库外拖入/粘贴） | 🟡 库外按钮有；拖入/粘贴无 |
| | 结果展示（缩略图+分数+band） | ✅ |
| | 搜索历史 / 无结果提示 | ❌ 历史无；无结果有 |
| 看 | 大图预览（灯箱缩放切换） | 🟡 需确认缩放/键盘切图 |
| | 文件信息 + 定位到文件夹 | ✅ |
| 逛 | 网格浏览 + 筛选 + 排序 + 计数 | ✅ |
| 取 | 复制到白名单目录 + 冲突处理 | ✅ 单条 |
| | 批量取件/交付 | ❌ |
| 收 | 首次向导 | ✅ |
| | 添加入库（移动/复制 + 进度 + 失败可见） | ❌（门控） |
| 管 | 多库登记/启用停用/切换 | 🟡 部分 |
| | 设置中心 | ❌ |
| 诊 | 体检 + 诊断面板 + 重建 | ✅ |
| 记 | 任务列表 + 操作记录 | ✅ |
| 体验 | 快捷键（Cmd+K/方向键/Space/Esc） | ❌ |
| | 拖拽导入 | ❌ |
| | 深浅色主题 + 跟随系统 | ❌ |
| | 单实例锁 + 窗口位置记忆 | ✅ |
| | 收藏/标签/集合 | ❌ |
| | 最近查看历史 | ❌ |
| | 批量多选 | ❌ |
| | 结果对比 | ❌ |
| | 库外监视（chokidar） | ❌ |
| | 备份/配置导入导出 | ❌ |
| | 托盘 + 后台索引 | ❌ |
| | 自动更新 | ❌ |
| | 未实现功能显式占位 | 🟡 部分（侧栏有；文档检索无） |

### 4.3 需要补齐的功能项（按优先级）

**P0（第一版必须有）**

| 功能 | 一句话说明 | 依赖/前置 |
|---|---|---|
| 设置中心 | 模型路径/库/目录/主题/快捷键/日志导出的唯一入口 | 新增 `/settings` 页 + 路由 |
| 快捷键 | Cmd+K 命令面板、方向键移动、Enter 定位、Space 预览、Esc 清空、Ctrl+V 粘图搜 | `cmdk` 已装未用（S9） |
| 拖拽导入 | 拖文件夹=入库；拖图片=以图搜图 | 拖拽事件 + 现有 search/ingest 通道 |
| 批量多选 | 结果网格多选 → 批量取件/交付 | `collect` 契约已支持 uids 数组 |
| 深浅色主题 | nativeTheme + prefers-color-scheme + 尊重 reduce-motion | tokens.css 已有令牌体系 |

**P1（第一版应该有的体验）**

| 功能 | 一句话说明 | 依赖/前置 |
|---|---|---|
| 入库/增量（F3） | 把素材收进库（移动/复制 + 进度 + 失败展开） | 等 job 表上线 |
| 多库管理完善 | 库列表 + 切换 + 兼容性提示（compat 不兼容给出原因） | libraryList 已有读路径 |
| 收藏/标签/集合 | 临时分组，供「逛」和「交付」复用 | 意图层表 |
| 搜索/浏览历史 | 最近查看、最近搜索 | 应用级表 |
| 库外监视（chokidar） | 库被外部改动时提示重新扫描 | chokidar（已在依赖清单） |
| 文档命中高亮 | 文档检索结果高亮 + 打开所在页 | 随 F7 |

**P2（可延后）**

文档检索（F7，门控）· 结果对比 · 备份/配置导入导出 · 托盘+后台索引 · 自动更新（需更新服务器）。

### 4.4 当前功能项与界面对接的建议（怎么接得更好）

| 功能 | 现状问题 | 对接建议 |
|---|---|---|
| 以图搜图 | 只有「选一张库外参考图」按钮 | 加 ① 拖图片到搜索框 ② Ctrl+V 粘贴搜图 ③ 结果卡上「以此图搜图」 |
| 图片详情 | 侧栏「图片详情」是禁用占位，但实际可从结果进入 | 二选一：要么给 `to` 让它真可达（配一个默认/最近条目），要么改文案为「从结果进入」避免误导 |
| 取件 | 单条取件已闭环 | 接批量多选（契约 `collect.uids` 已支持数组，UI 只差多选态 + 汇总确认框） |
| 诊断与重建 | 健康检查结果只在本页 | 把「检查项未全通过」做成侧栏/顶栏徽标，让用户不用进页就知道有异常 |
| 库切换 | 多库登记有、但切换入口散在向导/门禁 | 在顶栏加「库选择器」下拉（列库名+条目数+compat 状态），切换即时重建检索范围 |
| 未实现占位 | 侧栏「设置/入库」有占位，但「文档检索」无 | 补一个禁用的「文档」占位（title 写明「待文档语料」），符合「显式占位」纪律 |
| 空态/失败态 | 搜索页四态较完整 | 逐页核对：浏览页/任务页/诊断页的「空结果」与「失败」态是否都有，缺的补统一空态组件 |

---

## 5. 判定尺子（网络研究摘要）

- **Electron 安全基线**（官方 security 清单）：sandbox v20 起默认开；关 nodeIntegration、开 contextIsolation、禁远程内容、勤更新 Electron → 本项目全部满足。
- **node:sqlite**（Node 官方文档）：Node 24 下 Stability 1.2（RC），仍实验性 → 支撑 S3。
- **EmbeddingGemma 2**：740M 参数、768 维、CPU/GPU 本地离线，同类桌面应用（Semantra）同款模型 → 印证选型合理。

---

## 6. 本轮未能验证 / 环境受限（如实声明）

| 项 | 原因 |
|---|---|
| E2E（63 条真窗口） | 需 `--no-sandbox`+提权 + 渲染产物为空 |
| 打包态冷启动 | 渲染构建失败（S1）阻断 |
| `npm audit` 依赖漏洞 | 镜像源不支持 audit（S12） |
| arm64 产物 | 本机无 arm64 机器 |
| 索引重采样 golden 校验数值 | 依赖 ONNX 模型（本机缺模型），仅静态审代码路径 |

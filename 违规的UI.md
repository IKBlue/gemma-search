# 违规的 UI —— Apple Style 桌面程序审查台账

> **这是什么**：2026-10-13 对 `gemma-search` 桌面应用当前 4 条路由 + 首启向导做的一次 Apple Style（**桌面程序**口径）全维审查里，**逐条可复现的违规台账**。
> **这不是什么**：**不是行动清单**。要做什么、什么顺序，唯一出处仍是根目录 `TODO.md`（`AGENTS.md` §7.1）。本文件是**审查证据快照**；是否把条目并进 `TODO.md` 由所有者决定。
>
> **位置例外（显式登记）**：本文件位于**仓库根**，是所有者本轮明确指示，与 `AGENTS.md` §4「仓库根只放 `AGENTS.md` · `README.md` · `TODO.md`」冲突。登记在此，避免后来者以为是纪律漏洞。
> **详细论证与整改优先级** → `docs/audit/UIUX-APPLE-STYLE-AUDIT.md`（下称**报告**）。本文件是违规的**唯一详表**，报告只引用 `V-nn` 编号，不重复列。

- 审查日期：2026-10-13 · 被审产物：`out/`（构建于 2026-10-13T06:35:04Z，**晚于**最新渲染层源码 06:35:01Z ⇒ 截图与代码同版）
- 审查对象：`apps/desktop/src/renderer/`（44 个 `.jsx`/`.js` + `renderer.css` + `styles/tailwind.css`）· `packages/design-tokens/tokens.css` · `apps/desktop/src/main/index.mjs`（窗口与协议）· `apps/desktop/src/renderer/index.html`
- 证据类型：**代码事实**（`file:line`）· **真窗口实测**（Playwright 启动真 Electron 后读 `getComputedStyle` 与 DOM，原样输出在报告附录）· **脚本复算**（WCAG 对比度）· **命令输出**。无证据的标【判断，非实测】。

## 判据与严重度口径

| 类别 | 具体条目（不写「主流做法」） |
|---|---|
| Apple HIG | Sidebars · Buttons（normal / primary / **destructive**）· Toolbars（统一标题栏）· Windows（恢复尺寸与位置）· Menus · Materials（Reduce Transparency）· Motion（Reduce Motion）· Color（语义色 / 深色模式 / 不硬编码色值）· Typography · Layout · Progress indicators（determinate / indeterminate）· Feedback · Lists and tables · Loading · Writing |
| W3C WCAG 2.2 | SC 1.4.3 Contrast Minimum (AA, 正文 4.5:1) · 1.4.11 非文字 3:1 (AA) · 1.4.13 (AA) · 2.1.1 (A) · 2.2.1 (A) · 2.4.3 (A) · 2.4.7 (AA) · 2.4.11 (AA) · 2.5.5 (AAA, 44px) · 2.5.8 (AA, 24px) · 3.3.1 (A) · 4.1.2 (A) · 4.1.3 (AA) |
| 项目自有 | `docs/design/UI-REVIEW-and-migration.md` §6（流程 1–4 与键盘要求）· `--touch-min:44px`（`tokens.css:63`）· `AGENTS.md` §1 S7（类名走令牌阶梯、颜色不许写死、不写任意值） |

**严重度**（沿用已冻结的 `docs/audit/01-acceptance-criteria.md` §3 口径）：`Score = 影响面(1–3) × 触发可能性(1–3)`。
影响面 3 = 主任务路径或全应用 · 2 = 单页或单类状态 · 1 = 局部装饰；触发 3 = 必现 · 2 = 常态会出现 · 1 = 边缘。
`9 = Critical · 6 = High · 4 = Medium · ≤3 = Low`。每条都写出两个因子，可复算。

**统计**：违规 **42** 条 ⇒ Critical **1** · High **8** · Medium **22** · Low **11**。

---

## 摘要表

| 编号 | 级别 | 维度 | 一句话 |
|---|---|---|---|
| V-01 | High (2×3=6) | 视觉/导航 | 侧栏「当前页」在视觉上完全不可见（真窗口实测无 class） |
| V-02 | High (2×3=6) | 视觉/语义 | `.dot-*` 被当文字语气类用 ⇒ 文字背后出现绿/黄/红色块 |
| V-03 | High (2×3=6) | 配色 | 结果区**主信号**（分数档位）对比度 2.06–2.22:1，远低于 4.5:1 |
| V-04 | Medium (2×2=4) | 状态视觉 | 索引状态四档徽标颜色完全相同（真窗口实测） |
| V-05 | Medium (2×2=4) | 配色 | 4 个分类标签 11px 前景 3.96–4.29:1 |
| V-06 | Medium (2×2=4) | 配色/深色 | 深色模式下 CR+VR 标签 **2.55:1**（派生底色跟了 success、前景没跟） |
| V-07 | Low (1×2=2) | 配色 | 浅色用了 Apple 深色档橙 `#ff9f0a`；深色块未覆盖该值 |
| V-08 | Low (1×3=3) | 配色 | 强调色是 apple.com 网页蓝，不是 HIG `systemBlue` |
| V-09 | Low (1×2=2) | 视觉 | 卡片悬停只有描边变色，无深度反馈【判断，非实测】 |
| V-10 | Low (1×2=2) | 视觉 | `:focus-visible` 规则改了 `border-radius`，覆盖组件自己的圆角 |
| V-11 | Medium (2×2=4) | 桌面壳 | 原生标题栏 + 68px 应用内顶栏 = 双 chrome |
| V-12 | Medium (2×3=6) | 桌面壳 | 主进程硬编码 `#f5f5f7`（绕过令牌；深色闪白）+ 窗口标题第二份文案 |
| V-13 | Low (1×2=2) | 桌面壳 | 不记忆窗口尺寸与位置；无自定义应用菜单 |
| V-14 | Low (1×1=1) | 布局 | `minWidth 1040` 令 760px 断点成死代码；`.content` 上限无自动居中 |
| V-15 | High (2×3=6) | 状态 | `.err` 类**不存在** ⇒ 错误文本与正文同色 |
| V-16 | High (3×2=6) | 状态 | 错误与成功共用同一条 toast：2.6s 自动消失 + 恒 `role="status"` |
| V-17 | Medium (1×3=3) | 状态 | `text-err` 不是合法 Tailwind 类（`@theme` 无 `--color-err`） |
| V-18 | Medium (2×2=4) | 状态 | `index.progress` 每条事件都弹 toast（契约要求 ≤500ms 一条） |
| V-19 | Medium (2×2=4) | 状态 | 不确定进度条不动（宽度恒 25%）⇒ 与卡死无法区分 |
| V-20 | Medium (2×2=4) | 状态 | 「保持现状」不持久：换页或刷新即复活 |
| V-21 | Medium (2×2=4) | 状态 | 提交中只禁用被点的那个按钮，同类写操作仍可点 |
| V-22 | Medium (2×2=4) | 无障碍/状态 | 骨架屏 `aria-hidden`，无 `aria-busy`、无「正在检索」播报 |
| V-23 | Medium (2×2=4) | 状态 | 缩略图失败只有「无预览」，不区分「不在盘上」与「解码失败」（实测 25 次 415） |
| V-24 | Low (1×2=2) | 信息 | 指标卡「预览图 N · 压缩包 N」两个数字同源，易读成两类计数 |
| V-25 | Medium (1×3=3) | 信息 | 页脚**硬编码** `seq140`，与任务页展示的 compat 真值可能不一致 |
| V-26 | Low (1×2=2) | 健壮性 | 无 React ErrorBoundary ⇒ 渲染异常即白屏 |
| V-27 | Low (1×2=2) | 状态 | Gate 载入态 `return null` ⇒ 首屏空白一瞬 |
| V-28 | **Critical (3×3=9)** | 信息架构 | 图片详情页**从界面不可达**：`PATHS.item` 定义了却无任何链接 |
| V-29 | High (3×2=6) | 交互 | 与自有规格差 5 项键盘能力；拖入图片与 `Ctrl+V` 未实现 |
| V-30 | Medium (2×3=6) | 交互 | 三个**可点的空按钮**（帮助 / 添加图库 / 更新索引）只弹 toast |
| V-31 | Medium (2×3=6) | 交互 | 排序「最近添加」可选中但无效果 |
| V-32 | High (2×3=6) | 状态一致性 | 详情页侧栏传 `lib={null}` ⇒「未配置 / 需要处理 / 0%」 |
| V-33 | Medium (2×2=4) | 交互/配色 | 危险区按钮用蓝色描边，破坏性动作**不显红** |
| V-34 | Medium (2×2=4) | 交互 | 卡片主操作（定位 / 取件）只在 hover 或 focus 时出现 |
| V-35 | Medium (2×2=4) | 无障碍 | 4 个 disabled 侧栏项仍是**可聚焦**的链接 |
| V-36 | Medium (2×2=4) | 无障碍 | 首启向导自称 `aria-modal` 但不是真对话框（实测焦点停在 BODY） |
| V-37 | Medium (2×2=4) | 无障碍 | 只尊重 reduced-motion，不尊重 Reduce Transparency 与 Increase Contrast（顶栏却用毛玻璃） |
| V-38 | Medium (2×2=4) | 无障碍 | 交互控件实测 32–37px，低于项目自定 `--touch-min:44px` |
| V-39 | Low (1×2=2) | 文案 | 分数显示 4 位小数（例 `0.8234`），信息噪声【判断，非实测】 |
| V-40 | High (2×3=6) | 文案 | 界面**直接显示未渲染的 Markdown**（`**加粗**` 按字面渲染） |
| V-41 | Low (1×2=2) | 文案/心智 | 开发者术语外露（thumb 协议 · compat · seq · dim · uid · 错误码 · canUndo） |
| V-42 | Medium (2×2=4) | 状态/文案 | toast 里直接显示 **undefined**（真窗口截图实测） |

## A · 视觉与配色

### V-01 · High（影响面 2 × 触发 3 = 6）· 侧栏当前页零视觉指示
- **违规**：4 条路由切换时，侧栏对应项**没有任何视觉变化** —— 用户只能靠页面标题猜自己在哪。
- **判据**：HIG › **Sidebars**（selection appearance：当前项必须有选中外观）。
- **事实**：`layout/Sidebar.jsx:45` 写 `className={({ isActive }) => cn(active || isActive, false) || undefined}` —— `clsx(true, false) === ""`（实测），故该表达式**恒为 undefined**；而唯一的选择器 `.nav a.active`（`renderer.css:97`）**永不命中**，也没有 `[aria-current="page"]` 兜底（全仓 grep 0 处）。真窗口实测：`navActiveClass = null`、`backgroundColor = rgba(0, 0, 0, 0)`、`boxShadow = none`（三条路由一致）。
- **复现**：`node data/_uiux-capture/capture.mjs` → 看 `FACTS_JSON.search.navActiveClass`；或报告 §2 的 NavLink 渲染探针（输出 `<a aria-current="page" href="/">语义搜索</a>`，**无 class 属性**）。
- **建议**：改成 `cn({ active: isActive })`；并补 `.nav a[aria-current="page"]` 作双保险（即便 className 再写错也不会退回无色）。
- **验收**：真窗口断言当前项带 `active` 类**且**计算背景不等于 `rgba(0, 0, 0, 0)`。

### V-02 · High（2×3=6）· 状态圆点类被当成文字语气类
- **违规**：状态文字（"在盘上 / 需重编码 / 已完成 / 可以"）背后出现**实心绿、黄、红色块** —— "点"这个视觉隐喻没了，观感像高亮标记。
- **判据**：HIG › **Color**（状态用语义色，但不得牺牲排版层级）。
- **事实**：`renderer.css:117-120` 只定义 `.dot`（8×8 圆点）与三个只设 `background` 的修饰类；被误用 6 处：`pages/ItemPage.jsx:224,228,264` · `pages/TasksPage.jsx:54` · `pages/ActivityPage.jsx:208,215`。真窗口实测 `.dot-ok` 的计算样式：`color: rgb(110, 110, 115) / background: rgb(52, 199, 89)` —— 颜色确实落在**背景**上。
- **复现**：同探针看 `FACTS_JSON.*.sample.dotOk`。
- **建议**：要么给这些 span 补 `dot`（变成真圆点、文字回归 ink），要么新增 `.tone-ok / .tone-warn / .tone-err` 语义类（把颜色放在 `color` 上），并把圆点类收窄为纯圆点。
- **验收**：被修元素的 `background-color` 为透明，颜色落在 `color`；真窗口断言。

### V-03 · High（2×3=6；若把 WCAG AA 当合规硬门槛，则按 3×3=9 计为 Critical）· 结果区主信号对比度不足
- **违规**：检索结果的**核心信息**（分数档位）用色违反 AA：同款 2.22:1、很接近 2.06:1。
- **判据**：WCAG 2.2 **SC 1.4.3** Contrast (Minimum) AA —— 正文 4.5:1（11px 中文属正文，不适用"大字 3:1"例外）；同一元素连 **SC 1.4.11**（非文字 3:1）也不达标。
- **事实**：`tokens.css:92-93` `--score-same: var(--color-success)`（`#34c759`）与 `--score-like: var(--color-warning)`（`#ff9f0a`）；落点 `renderer.css:250-251` 的 `.score.high / .mid`，字号 11px（`--type-micro`）。脚本复算见报告 §4 全表：**light 2.22 / 2.06**；dark 反而是 8.32 / 8.19。
- **复现**：`node data/_uiux-capture/contrast.mjs` → `light 分数 high` 与 `light 分数 mid` 两行。
- **建议**：档位色不要落在文本上 —— 文字保持 `--color-text-primary`，把档位色移到**圆点或胶囊底**（正好复用 V-02 的圆点类）；若坚持文字着色，需换不小于 4.5:1 的可读档并用同一脚本复算。
- **验收**：脚本对 `.score` 实际前景与背景对复算不小于 4.5:1。

### V-04 · Medium（2×2=4）· 索引状态四档视觉无差别
- **违规**：已编码 / 待编码 / 待重编码 / 已从索引移除 四个徽标**长得一模一样**（都是中灰标签），状态信息只剩文字。
- **判据**：HIG › **Color**（用语义色区分状态）；`utils/index-state.js:18-23` 已为每档定义了语气字段，属于"设计了但没渲染"。
- **事实**：`pages/ItemPage.jsx:55` 输出 `data-state` 与 `data-tone`，但全仓 CSS **没有任何** `[data-tone]` 或 `[data-state]` 规则。真窗口实测 `[data-state]`：`color: rgb(105, 112, 125) / background: rgb(236, 238, 242)` —— 与默认标签逐位相同。
- **复现**：探针 `FACTS_JSON.item.sample.dataState` 与 `tagDefault` 对比。
- **建议**：补 `.tag[data-tone="ok"] / [data-tone="warn"] / [data-tone="err"]` 三条规则，颜色仍取令牌。
- **验收**：四档两两计算背景不同；真窗口断言。

### V-05 · Medium（2×2=4）· 分类标签前景对比度不足
- **违规**：4 个分类标签 11px 前景全部低于 4.5:1。
- **判据**：WCAG 2.2 SC 1.4.3 AA。
- **事实**：脚本复算 light 档：VR `3.96` · CR `4.28` · 其他 `4.29` · 未分类 `4.00`（CR+VR `4.53` 通过）。令牌见 `tokens.css:83-89`，落点 `renderer.css:239-247`。
- **复现**：`node data/_uiux-capture/contrast.mjs` 的 light 档标签四行。
- **建议**：把四个 `--cat-*-fg` 加深到不小于 4.5:1（底色可不动）。
- **验收**：脚本四行全 PASS。

### V-06 · Medium（2×2=4）· 深色模式 CR+VR 标签只有 2.55:1
- **违规**：深色模式下「CR+VR」标签前景 `#1a7f37` 压在深绿底 `#203627` 上 ⇒ **2.55:1**，比浅色还糟；3:1 非文字阈值也不达标。
- **判据**：WCAG 2.2 SC 1.4.3 与 1.4.11；HIG › **Dark Mode**（两套外观都要各自验证）。
- **事实**：`tokens.css:85` 的 `--cat-crvr-bg` 是 `color-mix` 派生的，会跟着深色的 `--color-success: #30d158` 一起变暗绿；而 `--cat-crvr-fg` 是**写死的** `#1a7f37`，两个深色块（`:168-189` 与 `:191-210`）都**没有**覆盖它。脚本同时实测：两个深色块**逐字节一致、无漂移**，且未覆盖的标签前景恰好是 `--cat-crvr-fg` 这一个。
- **复现**：`node data/_uiux-capture/contrast.mjs` → `dark 标签 CR+VR` 行与脚本末尾的"深色模式未覆盖"诊断行。
- **建议**：在深色块补 `--cat-crvr-fg`；或把前景也改成 `color-mix` 派生，从根上消除"底跟着走、前景没跟"这一类漂移。
- **验收**：脚本 dark 档 CR+VR 行 PASS。

### V-07 · Low（1×2=2）· 浅色用了 Apple 深色档橙
- **事实**：`tokens.css:41` `--color-warning: #ff9f0a` 是 Apple **深色**外观的橙；浅色档应为 `#ff9500`。且两个深色块都没有重定义它（深色档恰好正确，属歪打正着）。
- **判据**：HIG › **Color**（浅色与深色各一套官方值）〔数值出处与诚实声明见报告 §1〕。
- **建议**：浅色改 `#ff9500`，深色块显式写回 `#ff9f0a` —— 让每一档都显式，别靠巧合。

### V-08 · Low（1×3=3）· 强调色是网页蓝，不是系统蓝
- **事实**：`tokens.css:38` `#0071e3` 与 `:177,199` `#2997ff` 是 apple.com 的网页蓝；HIG `systemBlue` 是 `#007AFF` 与 `#0A84FF`。
- **判据**：HIG › **Color**（system colors）。**【判断，非实测】**：这是可辩护的品牌选择（与网页视觉一致），但既然审查口径是"Apple Style 桌面程序"，就必须**显式登记为有意偏离**，而不是当成系统色。
- **建议**：保留现状并在 `docs/design/DESIGN-tokens.md` 标注"有意偏离 HIG systemBlue"；或切到系统蓝。

### V-09 · Low（1×2=2）· 卡片悬停无深度反馈【判断，非实测】
- **事实**：`renderer.css:226` 只有 `.photo-card:hover { border-color: var(--color-accent) }` —— 无阴影、无位移。
- **判据**：HIG › **Design themes: Depth**。**【判断，非实测】**：`tokens.css` §8 明令"不做进入动画与悬停位移"，所以这是**有意取舍**；但要登记，否则会被读成疏漏。
- **建议**：保留可以，但要在 `DESIGN-tokens.md` §8 写明"悬停只变描边"是决定，不是遗漏。

### V-10 · Low（1×2=2）· 焦点环改写圆角
- **事实**：`tokens.css:235-239` 与 `renderer.css:52` 的 `:focus-visible` 规则里带 `border-radius: var(--radius-sm)` ⇒ 聚焦瞬间把组件自己的圆角（胶囊 999px、卡片 12px）改成 8px。
- **判据**：WCAG 2.2 SC 2.4.7（焦点可见本身没问题，本条是**副作用**）。
- **建议**：删掉该 `border-radius`（`outline` 本就跟随元素圆角）。

---

## B · 布局与桌面壳

### V-11 · Medium（2×2=4）· 双标题栏
- **事实**：`apps/desktop/src/main/index.mjs:471-489` 的窗口未设 `titleBarStyle` 或自定义标题栏 ⇒ 保留原生标题栏；其下又有 68px 的 `.topbar`（`renderer.css:127-136`：毛玻璃 + 面包屑 + 图标按钮）。Windows 上就是"系统标题栏 + 应用标题栏"两层 chrome。
- **判据**：HIG › **Toolbars**（统一标题栏：工具项应与标题同一行，不重复窗口控件）。
- **建议**：二选一 —— ① 用 `titleBarStyle: 'hidden'` 加拖拽区，把顶栏变成真标题栏；② 去掉顶栏，把面包屑与动作并入页面头部。

### V-12 · Medium（2×3=6）· 主进程硬编码色值与第二份窗口标题
- **事实**：`apps/desktop/src/main/index.mjs:473` `backgroundColor: '#f5f5f7'` 是令牌之外**唯一**的色值字面量（`apps/desktop/tests/styles.test.mjs` 的 T1 只扫渲染层，所以没拦住）；深色外观下建窗瞬间会闪一下浅色。`:474` 的 `title` 是第二份文案，与 `router/paths.js` 的 `APP_NAME` 与 `LABELS` 重复（`dom-validity.test.mjs` 的 V4 同样只查渲染层）。
- **判据**：`AGENTS.md` §1 S7「颜色不许写死」；HIG › **Dark Mode**（不应有浅色闪屏）。
- **建议**：窗口底色从令牌派生，或按 `nativeTheme.shouldUseDarkColors` 二选一；标题初值从共享常量取。
- **验收**：全仓在 `apps/desktop/src/main` 下扫色值字面量为 0，或在文档里登记唯一例外。

### V-13 · Low（1×2=2）· 不记忆窗口状态、无应用菜单
- **事实**：grep 实测 `apps/desktop/src/main` 里 `getBounds` 与 `setBounds` **0 处**、`setApplicationMenu` 与 `buildFromTemplate` **0 处** ⇒ 尺寸位置不恢复，只有 Electron 默认菜单（含 Toggle Developer Tools）。
- **判据**：HIG › **Windows**（恢复上次尺寸与位置）· **Menus**（桌面应用应有应用菜单与快捷键发现路径）。
- **建议**：持久化 `win.getBounds()`；给出最小应用菜单，或**显式决定"无菜单"并登记**。

### V-14 · Low（1×1=1）· 断点死代码与内容上限
- **事实**：`apps/desktop/src/main/index.mjs:472` 的 `minWidth: 1040` 让 `renderer.css:288` 的 `@media (max-width: 760px)` **永不可达**；`.content` 有 `max-width: 1500px`（`renderer.css:142`）却没有自动外边距。真窗口实测：窗口 1440 时 `innerWidth 1432 / offsetLeft 220 / maxWidth 1500px` ⇒ **当前尺寸下上限根本不生效**，只有窗口宽超过约 1720px 才会出现右侧空白。
- **建议**：删 760 断点或放宽 `minWidth`；若要超宽屏居中，补 `margin-inline: auto`。

---

## C · 状态与反馈

### V-15 · High（2×3=6）· 错误类不存在，错误文本没有样式
- **违规**：所有错误文案与正文**同色同字重**，错误与正常信息在视觉上不可区分。
- **判据**：WCAG 2.2 **SC 3.3.1** Error Identification (A)；HIG › **Feedback**。
- **事实**：全仓 CSS 只有 `.toast.err`（`renderer.css:277`），**没有** `.err` 规则；却被用于 `pages/ItemPage.jsx:155` · `pages/TasksPage.jsx:78,234,250` · `pages/ActivityPage.jsx:127`。
- **关键连带（比上面更要紧）**：`--color-critical` 作**正文**只有 **3.55:1**（脚本复算）⇒ **单纯补一条"错误文字用 critical"的规则仍然不合格**。修这条必须同时引入一个不小于 4.5:1 的正文红令牌。
- **建议**：① 新增正文红令牌（浅色需不小于 4.5:1）② 定义错误语义类 ③ 错误态同时给图标或前缀，不只靠颜色。
- **验收**：脚本对新的错误前景复算不小于 4.5:1；真窗口断言错误文案计算色不等于正文色。

### V-16 · High（3×2=6）· 错误会自己消失，且从不被当告警播报
- **违规**：唯一的错误反馈通道是右下角 toast：**2.6 秒后自动消失**、无关闭按钮、无历史，且**恒为** `role="status"` 与 `aria-live="polite"` —— 读屏不会把它当告警，用户离开一瞬间就永久错过。
- **判据**：WCAG 2.2 SC 4.1.3 Status Messages (AA)；SC 2.2.1 Timing Adjustable (A)（**本条适用性有争议**，见报告 §14 边界）；HIG › **Feedback**（失败信息要可操作、不能被自动抹掉）。
- **事实**：`hooks/useToast.js:4` 的 `useToast(ms = 2600)` 对错误与成功用同一个时长；`ui/Toast.jsx:6` 的角色写死无分支；错误路径至少 6 处（`store/search.js:115` · `pages/SearchPage.jsx:57,61,71,77` · `pages/TasksPage.jsx:115,127` 等）。
- **建议**：错误改 `role="alert"` 且不自动消失（或明显延长并给关闭按钮）；写操作结果改为页内常驻区块。
- **验收**：真窗口断言错误 toast 的角色为 `alert`，且 3 秒后仍在 DOM。

### V-17 · Medium（1×3=3）· 错误色类不是合法 Tailwind 类
- **事实**：`pages/ActivityPage.jsx:144` 用了 `text-err`，而 `styles/tailwind.css` 的 `@theme` 里没有 `--color-err` ⇒ **该类不会被生成**，标题保持默认色。
- **判据**：`AGENTS.md` §1 S7（颜色用映射好的语义别名）；WCAG 2.2 SC 1.4.3。
- **建议**：改用已注册的语义色（`--color-critical` 已映射，可直接用 `text-critical`）。

### V-18 · Medium（2×2=4）· 进度事件逐条弹 toast
- **事实**：`pages/SearchPage.jsx:58-59` 对**每条** `index.progress` 调用 toast；而契约要求进度事件至少每 500ms 一条（`store/tasks.js:11` 引 `CONTRACT-engine-v1.md` §3）⇒ 文本高频重写、无法阅读，且每次都重置 2600ms 计时器。
- **判据**：HIG › **Progress indicators**（进度应有一个稳定呈现位置，而不是转瞬即逝的提示）。
- **建议**：进度只在 `/tasks` 页显示（那里已有阶段条与进度条）；检索页最多提示一次"索引中"。
- **验收**：一次索引会话里 toast 文本变化次数不超过 1（真窗口可计数）。

### V-19 · Medium（2×2=4）· 不确定进度条是静止的
- **事实**：`pages/TasksPage.jsx:223-228` 在 `pct === null` 时把内层宽度**硬写成 25%**；渲染层 grep `animation` 与 `@keyframes` 为 **0 命中**。
- **判据**：HIG › **Progress indicators**（不确定态**必须在动**，否则与卡死不可区分）。
- **建议**：加一条循环动画，并在 `prefers-reduced-motion` 下退化为静态文字"处理中…"。
- **验收**：真窗口断言不确定态宽度随时间变化。

### V-20 · Medium（2×2=4）· 「保持现状」不留痕
- **事实**：`pages/ActivityPage.jsx:71` 的 `dismissed` 是**组件内 state** ⇒ 离开 `/activity` 再回来、或刷新，待处理项**原样复活**；用户会以为自己已经处理过了。
- **判据**：HIG › **Feedback**（状态必须与用户动作一致）；项目 `SPEC-transactions.md` 把该决定定义为纯本地。
- **建议**：用 store 持有（与 `store/search.js` 的 `pendingCollect` 同规矩），或明确写"只对本次会话有效"。
- **验收**：可进 `npm test` 的断言 —— 该状态不随组件卸载丢失。

### V-21 · Medium（2×2=4）· 提交中不禁用同类动作
- **事实**：`pages/ItemPage.jsx:252` 的 `disabled={a.disabled || busy === a.id}` 只禁用被点的那一个；同一分区其它写操作按钮在请求飞行中仍可点。
- **判据**：项目规格 `docs/design/UI-REVIEW-and-migration.md:249`（"写操作进行中：卡片显示进行中且禁用重复触发"）——**文档声称做了，代码没做**；HIG › **Feedback**。
- **建议**：改成 `disabled={a.disabled || Boolean(busy)}`。
- **验收**：真窗口断言点击 A 后 B 也处于禁用态。

### V-22 · Medium（2×2=4）· 骨架屏对读屏是空的
- **事实**：`search/Gallery.jsx:9` 的骨架卡带 `aria-hidden="true"`，加载分支（`:22-27`）没有 `aria-busy`、也没有任何可读文本；结果数量变化同样没有 live region。
- **判据**：WCAG 2.2 SC 4.1.3 (AA)。
- **建议**：容器加 `aria-busy="true"` 与视觉隐藏的"正在检索…"；结果区加 `aria-live="polite"` 播报"找到 N 套素材"。

### V-23 · Medium（2×2=4）· 「无预览」不说是哪一种原因
- **事实**：缩略图失败只有一句"无预览"（`search/PhotoCard.jsx:19`；`pages/ItemPage.jsx:167-169` 稍好，写了"文件可能已不在盘上"）。真窗口实测（模拟模式）控制台出现 **25 次** `415 (Unsupported Media Type)`，来源是 `apps/desktop/src/main/index.mjs:453` 的 `if (img.isEmpty()) … status: 415`。
- **判据**：HIG › **Loading** 与 **Feedback**（占位状态要说清是"没有"还是"取不到"）。
- **建议**：把"文件不存在"与"解码失败"分开表述（`item.exists` 已知时可直接判断），并让缩略图协议区分 404 与 415。
- **边界**：模拟模式下没有真实文件，这条 415 是**预期**的；本节要点是"**界面无法区分两种失败**"，不是"假模式报错"。

### V-24 · Low（1×2=2）· 指标卡两个数字同源
- **事实**：`search/MetricsRow.jsx:30` 的注释行写 `预览图 N · 压缩包 N`，两个 N 都来自同一个 `indexed` ⇒ 读起来像"两类计数"，实际是同一个数重复。
- **建议**：删掉其一，或换成真实可得的两个量。

### V-25 · Medium（1×3=3）· 页脚硬编码 seq
- **事实**：`pages/SearchPage.jsx:162` 写死 `seq140`；而 `/tasks` 页展示的是 `compat` 里解析出来的真值（`pages/TasksPage.jsx:185-188`）⇒ **同一个应用两处说法可能不一致**，且违反 `AGENTS.md` P3（硬编码应可配置的值）。
- **建议**：从 `lib.compat` 取；取不到就不显示。

### V-26 · Low（1×2=2）· 无 ErrorBoundary
- **事实**：全仓无 `componentDidCatch` 与 `ErrorBoundary`；对照 `router/index.jsx:30-33` 的启动期断言（作者在意"宁可启动即失败也别白屏"），渲染期异常却没有任何兜底。
- **建议**：在外层加一个最小 boundary，白屏时给"复制诊断信息"入口。

### V-27 · Low（1×2=2）· 载入态空白
- **事实**：`pages/LibraryGate.jsx:37` 的 `if (where === 'loading') return null` ⇒ 首屏有一瞬纯白。
- **判据**：HIG › **Loading**（占位优于空白）。
- **建议**：给一个与最终布局同构的最小骨架。

### V-42 · Medium（2×2=4）· 提示文案里直接显示 undefined
- **违规**：检索页的"跳过"提示原样渲染成 **"有 2 个库被跳过：undefined"** —— 内部字段缺失被当成文案显示给用户。
- **判据**：HIG › **Writing**（面向用户的文本必须是最终形态）；WCAG 2.2 SC 3.3.1（告警必须能被理解）。与 V-40 同源，但这条更硬：undefined 不是人能读的。
- **事实**：`store/search.js:102` 直接拼 `skipped[0].reason.userMessage`，而跳过项的形状不保证有 `reason.userMessage`。真窗口实测（模拟模式）：截图 `data/_uiux-shots/2-search.png` **右下角 toast** 的文本就是 "有 2 个库被跳过：undefined"。
- **复现**：`node data/_uiux-capture/capture.mjs` → 打开 `data/_uiux-shots/2-search.png` 看右下角。
- **说明**：这条是**真窗口实测发现的** —— 静态读码时它只是"一个可能为空的字段"，只有把界面跑起来才看到它真的显示出来了。
- **建议**：缺字段就不显示该片段（有 `reason.userMessage` 才拼），并加一条机械断言：**渲染文本不得包含 undefined**。
- **验收**：真窗口断言 toast 文本不含 `undefined`。

## D · 交互与键盘

### V-28 · Critical（影响面 3 × 触发 3 = 9）· 图片详情页从界面不可达
- **违规**：`/item/:libId/:uid` 是**已实现且有 E2E 覆盖**的页面（`item-detail.spec.mjs` 的 E9 系列 6 条），但**用户在界面上没有任何路径到达它** —— 只能手改地址栏 hash。
- **判据**：HIG › **Layout** 与 **Navigation**（可达性）；项目 `docs/design/UI-REVIEW-and-migration.md:234-238` 明确写"从结果卡进入"。
- **事实**：`router/paths.js:14` 定义了 `PATHS.item`，但全渲染层 grep `PATHS` 只有路由表自己在用（`paths.js:40-43`），**没有任何链接构造该路径**；侧栏该项是 `disabled`（`search/SearchSidebar.jsx:13`，title 写着"P3c（从结果卡进入）"）；结果卡 `search/PhotoCard.jsx` 里没有任何链接，整卡不可点。真窗口实测：`/item` 路由下 `navActiveClass = "(无 aria-current 项)"` —— 连"当前页"都不存在。
- **复现**：`node data/_uiux-capture/capture.mjs` → 看 `FACTS_JSON.item.navActiveClass`；或 grep `PATHS.item` 在渲染层（只有 `paths.js` 自身命中）。
- **建议**：把缩略图与标题包一层链接（路由是参数化字符串，用 `generatePath` 或直接拼 `/item/ + libId + / + uid`）。
- **验收**：新增一条 E2E —— 从检索结果**点卡片**能进入 `/item`；且 E9 原有的直改 hash 路径仍通过。

### V-29 · High（3×2=6）· 键盘能力与自有规格差 5 项
- **违规**：规格写明的键盘操作绝大多数没实现。
- **判据**：项目 `docs/design/UI-REVIEW-and-migration.md:232`（方向键选择 · Enter 定位 · Ctrl+C 复制包路径 · Esc 清空 · 空格预览）与 `:228`（Enter / 点搜索 / 拖入图片 / Ctrl+V 粘图）；WCAG 2.2 SC 2.1.1 (A)。
- **事实**：渲染层唯一的键盘处理是 `search/SearchPanel.jsx:26` 的 `if (e.key === 'Enter') onSubmit()`；grep 实测无方向键处理、无 `Escape`、无拖放（`dragover/drop`）、无粘贴（`paste`）监听。
- **建议**：按规格逐条补，先做检索框与结果网格；把"按键到意图"的映射放在 Operation 层做纯函数，才进得了 `npm test`。

### V-30 · Medium（2×3=6）· 三个可点的空按钮
- **事实**：`pages/SearchPage.jsx:108`（帮助）`:120`（添加图库）`:121`（更新索引）—— 都能点、都有悬停反馈，点了只弹一句 toast。对照：侧栏的未实现项是"禁用 + title 说明阶段"（`search/SearchSidebar.jsx:16-18`）⇒ **同一件事两种表达**。
- **判据**：HIG › **Feedback** 与 **Writing**（不要给出会骗人的控件）；`AGENTS.md` P1（同一概念不要两种做法）。
- **建议**：统一走禁用加说明，或统一走"点击解释为什么还不能用" —— 二选一，别各一半。

### V-31 · Medium（2×3=6）· 假选项
- **事实**：`search/SearchPanel.jsx:11` 提供"最近添加"，选中后 `pages/SearchPage.jsx:136` 只弹一句"需要索引提供 mtime"，结果仍按相关度排 ⇒ 控件在撒谎。
- **建议**：实现前先禁用或隐藏该选项。

### V-32 · High（2×3=6）· 详情页侧栏自相矛盾
- **事实**：`pages/ItemPage.jsx:127` 传 `<SearchSidebar lib={null} indexLoading={false} indexError={null} />` ⇒ 详情页侧栏恒显示「未配置 / 索引状态需要处理 / 0% 已建立索引」，而同屏元数据区正在显示这个库的真实条目；`/tasks` 与 `/activity` 传的是真值（`pages/TasksPage.jsx:149`）。
- **判据**：HIG › **Sidebars**（源列表信息必须与内容一致）；这条还会让用户**以为索引坏了**。
- **建议**：与其它页一样注入真实的索引状态。

### V-33 · Medium（2×2=4）· 破坏性动作不显红
- **事实**：`pages/ItemPage.jsx:251` 危险区用蓝色描边变体 —— "移出素材库"只拿到蓝色描边；全仓 `--color-critical` 在按钮上**零使用**（只在 toast 与圆点上）。
- **判据**：HIG › **Buttons**（destructive 用红色并写明动词）。
- **建议**：给按钮原语加 destructive 变体，仅用于危险区；动词保持"移出素材库"。

### V-34 · Medium（2×2=4）· 主操作藏在悬停里
- **事实**：`renderer.css:230-235` `.card-acts { opacity: 0 }`，只有 hover 或 focus-within 才可见 ⇒「定位 / 取件」是结果卡的**主操作**，静止态完全不可见（键盘可达，因为按钮仍在 Tab 序里）。
- **判据**：HIG › **Layout** 与 **Feedback**（重要操作不应只靠悬停暴露）。
- **建议**：至少把「取件」常驻，或常驻一个"更多"入口，悬停再展开次级动作。

### V-35 · Medium（2×2=4）· 禁用的导航项仍可聚焦
- **事实**：`layout/Sidebar.jsx:54-64` 的禁用分支渲染 `<a href="#" aria-disabled>`，**没有** `tabIndex={-1}` ⇒ Tab 会停在 4 个"点了没反应"的链接上。
- **判据**：WCAG 2.2 SC 2.4.3 (A)；HIG › **Accessibility**。
- **建议**：禁用项加 `tabIndex={-1}`，或干脆不渲染成可交互元素。

---

## E · 无障碍

### V-36 · Medium（2×2=4）· 首启向导不是真对话框
- **事实**：`pages/FirstRunWizard.jsx:54` 有 `role="dialog"` 与 `aria-modal="true"`，但无焦点陷阱、无初始焦点、无 `aria-describedby`。真窗口实测（无库启动）：`activeElementOnLoad = "BODY"`、`ariaDescribedby = null`。对照 `ui/ConfirmDialog.jsx`（Radix AlertDialog）是**做对了**的。
- **判据**：WCAG 2.2 SC 2.4.3 (A) 与 4.1.2 (A)；HIG › **Accessibility**。
- **建议**：直接复用已有那套（本项目已有先例与理由，见 `ConfirmDialog.jsx:5-11`），不要手写第二套 overlay。

### V-37 · Medium（2×2=4）· 只尊重一种偏好
- **事实**：`tokens.css:242-244` 有 `prefers-reduced-motion`（`renderer.css:280-282` 还重复了一份）；**没有** `prefers-reduced-transparency` 与 `prefers-contrast`，而顶栏用了 `backdrop-filter: saturate(180%) blur(20px)`（`renderer.css:131`）。
- **判据**：HIG › **Materials**（Reduce Transparency）与 **Accessibility**（Increase Contrast）。
- **建议**：加两条媒体查询 —— 减透明度时顶栏退化为不透明底；增对比度时加深分隔线与次要文字。

### V-38 · Medium（2×2=4）· 控件小于项目自定的 44px
- **事实**：真窗口实测 —— 顶栏图标按钮 **36px**（`ui/Button.jsx:38`）；小按钮 **32px**（`:43`；`/activity` 与 `/item` 命中）；筛选胶囊 **37px**（`ui/Chip.jsx:23`）。项目自定 `--touch-min: 44px`（`tokens.css:63`）。
- **判据**：WCAG 2.2 **SC 2.5.8** Target Size Minimum (AA, 24px) **已通过**；**SC 2.5.5**（AAA, 44px）未过；真正被违反的是**项目自己的令牌**。
- **建议**：明确取舍 —— 桌面鼠标精度下 32px 可接受，但要么把 `--touch-min` 的适用面写清（触摸或主要动作），要么把这些控件提到 44。**别让令牌与实现两处说法不一致**。

---

## F · 心智模型与文案

### V-39 · Low（1×2=2）· 分数显示 4 位小数
- **事实**：`ui/Score.jsx:41` 用 `Number(score).toFixed(4)` ⇒ 每张结果卡都出现 `0.8234` 这样的四位小数，而引擎的分数并没有这个精度含义。
- **判据**：HIG › **Writing**（数字精度应与决策相关）。**【判断，非实测】**：四位小数不会误导（分数本来就不可跨模态比较），属信息噪声。
- **建议**：降到 2–3 位，或按档位决定精度。真正的判据是"用户会不会拿它做比较"—— `docs/spec/CONTRACT-engine-v1.md` 明确分数**不可跨模态比大小**，所以精度越高越容易被误用。

### V-40 · High（2×3=6）· 界面直接显示未渲染的 Markdown
- **违规**：用户看到的是带星号与反引号的原文 —— 一眼就是"没做完"。
- **判据**：HIG › **Writing**（面向用户的文本必须是最终形态）；这是**文本渲染缺陷**，不是措辞问题。
- **事实**（注释剥离后扫描 + 真窗口实测）：真窗口 DOM 实测命中 **3 处** —— `/tasks`：`取消：**将在当前批次结束后停止**…`；`/activity`：`「保持现状」只关闭提示，**不动磁盘**…`；`/item`：`只改路径与配对，**不重新编码**`（来自 `utils/item-actions.js:27`）。源码里还有（部分同一批在真窗口未展开）：`pages/TasksPage.jsx:84,203,277` · `pages/ActivityPage.jsx:129,130,138,153,170,175`，其中多行还带反引号（例如错误码与 `ok` 这类字面量）。
- **复现**：`node data/_uiux-capture/capture.mjs` → 看 `FACTS_JSON.*.rawMarkdownNodes`。
- **建议**：改成 `<b>` 与 `<code>` 元素；**并加一条机械断言**（渲染层可见文本不得含未配对的星号或反引号），否则会再犯 —— 这批字符串是注释风格的直接外溢。
- **验收**：真窗口 `rawMarkdownNodes.length === 0`。

### V-41 · Low（1×2=2）· 开发者术语外露
- **事实**：面向用户的文案里出现 compat、seq、`dim`、`seq140`（`pages/SearchPage.jsx:162`、`pages/TasksPage.jsx:188`）、原始 `uid` 与 `libId`、错误码 `RECOVERY_NEEDED`（`pages/ActivityPage.jsx:138`）、`canUndo` 与 `canRollback`（`:153-154`）、以及 `GEMMA_FAKE=1 npm run dev`（`pages/TasksPage.jsx:279`、`pages/ActivityPage.jsx:130`）。
- **判据**：HIG › **Writing**（用用户的语言，不用实现细节）。
- **建议**：技术细节收进可展开的"详情"；开发者指令留在 title 或 README，不进主文案。

---

## 复现命令清单（全部只读）

| 目的 | 命令 |
|---|---|
| 对比度全表（含深色与两块对差） | `node data/_uiux-capture/contrast.mjs` |
| 5 张截图 + 真窗口事实表 | `node data/_uiux-capture/capture.mjs`（需提权；沙箱内 Electron 需 --no-sandbox，探针已带） |
| 侧栏无 class 的最小复现 | 报告 §2 的一条 node 单行命令（react-dom/server 加 createMemoryRouter） |
| 错误类与圆点类是否有 CSS 规则 | grep `.err` 与 `.dot-ok` 在 `apps/desktop/src/renderer/src` |
| 详情页是否可达 | grep `PATHS.item` 在渲染层（只有 `paths.js` 命中） |
| 主进程是否有菜单与窗口记忆 | grep `setApplicationMenu` · `buildFromTemplate` · `getBounds` · `setBounds` 在 `apps/desktop/src/main` |
| 未渲染的 Markdown | 报告 §A.2 的"剥离注释后扫可见文本"脚本 |

---

## 版本戳

- 生成时间：2026-10-13（Asia/Shanghai）
- 被审产物：`out/` 构建于 2026-10-13T06:35:04Z；截图写入于 06:51–06:52Z —— **晚于**构建，也与最新源码同版
- 结论效期：**以本次 HEAD 为准**。改代码后请按上面的"复现命令清单"重跑，不要沿用旧结论（`AGENTS.md` §3 规范 1：无归档证据 = 门禁未通过）。

*本文件与报告编号一一对应；报告只引用编号，不复制本表。*

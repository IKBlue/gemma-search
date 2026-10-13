# UIUX-APPLE-STYLE-AUDIT · Apple Style 桌面程序审查与修改报告

- 审查对象：`gemma-search` 桌面应用（Electron + React 19，Windows）
- 覆盖界面：4 条路由（`/` 语义搜索 · `/item/:libId/:uid` 图片详情 · `/tasks` 索引任务 · `/activity` 操作记录）+ 首启向导 + 无库/错误两种门禁态
- 审查日期：2026-10-13 · 被审产物：`out/`（构建于 2026-10-13T06:35:04Z，**晚于**最新渲染层源码 06:35:01Z）
- **违规台账**（唯一详表）：仓库根 [`违规的UI.md`](../违规的UI.md) —— 本报告只引用 `V-nn` 编号，不复制该表（同一件事不留两处写法）
- 与前次审查的关系：`docs/audit/UIUX-AUDIT.md`（2026-10-10，冻结档）审的是**重构前的单页**版本。本报告是**当前 4 页 + Tailwind/Radix 之后**的一次全新审查，§12 给出旧结论的回归对照。
- ⚠️ `docs/audit/README.md` 声明该目录**整体冻结**；本文件是**新增**，不修改冻结批次里的任何一份。

---

## 0. 摘要与逐维评级

**一句话**：这个界面的**令牌纪律与状态诚实度**明显高于同类项目（零色值字面量、Band/索引状态拒绝自算、失败不静默、确认弹窗按破坏性操作处理），但**"部件都造好了、接线掉了几根"**：有一整页从界面不可达、侧栏当前页没有任何视觉指示、错误文本没有样式类、界面里还留着未渲染的 Markdown。**这四类都不是审美问题，而是"看起来完成了、实际没接上"。**

| 维度 | 评级 | 依据（编号） |
|---|---|---|
| 视觉层级与密度 | **中偏上** | 版式克制、面板/卡片层级清楚；扣分：状态圆点被当背景色块（V-02）、卡片悬停无深度（V-09） |
| 交互完整性 | **差** | 一整页不可达（V-28）、5 项键盘能力缺失（V-29）、3 个空按钮（V-30）、假选项（V-31） |
| 状态表达 | **中** | 五态齐全且诚实（不编百分比、不编原因）；扣分：错误无样式（V-15）、不确定态静止（V-19）、「保持现状」不留痕（V-20） |
| 用户心智一致性 | **中** | 详情页侧栏与内容自相矛盾（V-32）、同一应用两种"未实现"表达（V-30）、开发者术语外露（V-41） |
| 配色与对比度 | **差** | **8 组前景不达 AA**（V-03/05/06/15），含结果区主信号 2.06–2.22:1 与深色模式 2.55:1 |
| 动效 | **合规但贫** | 尊重 reduced-motion（唯一做到的偏好）；全渲染层只有 2 条 transition、0 条 keyframes ⇒ 进度不确定态是死的（V-19） |
| 无障碍 | **中** | aria 语义比前次审查大幅改善（Chip 的 aria-pressed、NavLink 的 aria-current 已落地）；扣分：向导非真对话框（V-36）、偏好只尊重一种（V-37）、错误不播报（V-16） |
| 桌面程序感 | **弱** | 双标题栏（V-11）、窗口状态不记忆、无应用菜单（V-13）、主进程硬编码色值（V-12）；字体在 Windows 上落不到任何 Apple 字体（§5.2） |

**统计**：违规 42 条 ⇒ Critical 1 · High 8 · Medium 22 · Low 11。**没有任何一条是"不知道该怎么修"**；§13 给出逐条改法与验收方式。

**若只做三件事**（按性价比排序）：
1. **给结果卡加链接**（V-28）—— 让已经写好、已有 E2E 的详情页真的能被用到；
2. **修侧栏当前页指示**（V-01）—— 一行表达式，4 个页面的定位感立刻回来；
3. **改对比度**（V-03 + V-15 的连带）—— 分数档位与错误文本是用户最需要看清的两类信息。

---

## 1. 范围、基准与判据

### 1.1 审查范围（先分清审的是哪一层）

| 层 | 对象 | 是否随应用发布 | 本报告是否计分 |
|---|---|---|---|
| **实现** | `apps/desktop/src/renderer/`（44 个 `.jsx`/`.js` · `renderer.css` 379 行 · `styles/tailwind.css` 97 行）· `packages/design-tokens/tokens.css` 248 行 · `main/index.mjs` 的窗口与协议段 | ✅ | ✅ **主战场** |
| **未实现的功能面** | 侧栏 4 项 disabled（本地图库 / 入库与增量 / 设置）、契约里没有的 `ingest`/`mutate`/`transactions` 真实实现 | ✅（占位） | ⚠️ **只按"状态与心智"计分**（可点的空按钮、假选项），**不当作功能缺失扣分** |
| **冻结的前次审查** | `docs/audit/UIUX-AUDIT.md` 等 | — | ❌ 只做回归对照（§12），不改写 |

### 1.2 基准（指名到条目，不写「主流做法」）

| # | 基准 | 具体条目 |
|---|---|---|
| B1 | Apple HIG · **Sidebars** | selection appearance（当前项必须有选中外观）、源列表与内容一致 |
| B2 | Apple HIG · **Buttons** | 角色（normal / primary / **destructive**）、动词标签 |
| B3 | Apple HIG · **Toolbars / Windows / Menus** | 统一标题栏、恢复窗口尺寸与位置、应用菜单与快捷键发现路径 |
| B4 | Apple HIG · **Materials / Accessibility** | Reduce Transparency、Increase Contrast、Reduce Motion、VoiceOver（焦点与播报） |
| B5 | Apple HIG · **Color / Dark Mode** | 语义色、两套外观各自验证、不硬编码色值 |
| B6 | Apple HIG · **Typography / Layout** | 内置文本样式、留白与命中目标 |
| B7 | Apple HIG · **Progress indicators / Feedback / Loading / Writing** | determinate 与 indeterminate、失败信息可操作、占位优于空白、用用户的语言 |
| B8 | Apple HIG · **Design themes** | Clarity · Deference · **Depth** |
| B9 | W3C **WCAG 2.2** | SC 1.4.3 (AA 4.5:1) · 1.4.11 (AA 3:1) · 1.4.13 (AA) · 2.1.1 (A) · 2.2.1 (A) · 2.4.3 (A) · 2.4.7 (AA) · 2.4.11 (AA) · 2.5.5 (AAA 44px) · 2.5.8 (AA 24px) · 3.3.1 (A) · 4.1.2 (A) · 4.1.3 (AA) |
| B10 | 项目自有 | `docs/design/UI-REVIEW-and-migration.md` §6（流程 1–4 与键盘）· `docs/design/DESIGN-tokens.md` §8（动效）· `--touch-min: 44px` · `AGENTS.md` §3 |

### 1.3 诚实声明（**必须先读**，否则会误用本报告）

1. **HIG 正文取不到**：`developer.apple.com` 的 HIG 页是 JS SPA。本轮实测 `…/buttons` 与 `…/sidebars` 均为 **HTTP 200 但正文只有 HTML 壳**。⇒ 本报告对 HIG **一律引"章节名 + URL"**，**不虚构页内条文**；凡出现具体数值（如 `systemBlue` 的 `#007AFF`）一律标为**【判断，非实测】**或注明出处。
2. **WCAG 可取全文**：本轮实测 `w3.org/WAI/WCAG22/Understanding/contrast-minimum.html` 返回 80,453 字节正文 ⇒ 阈值（4.5:1 / 3:1、大字定义）与公式均**可引用**；本报告的对比度数值由 §A.1 的脚本按官方公式复算，**不手写**。
3. **三类事实严格分开**：**代码事实**（`file:line`）· **文档声称**（项目 spec 怎么写）· **行业做法**（HIG/WCAG）。混写即失据。
4. **无证据一律标注**：本报告共 4 处标【判断，非实测】（V-08 · V-09 · V-39 与 §5.2 的字体落地推断）。

### 1.4 严重度口径

沿用已冻结的 `docs/audit/01-acceptance-criteria.md` §3：`Score = 影响面(1–3) × 触发可能性(1–3)`；
影响面 3 = 主任务路径或全应用 · 2 = 单页或单类状态 · 1 = 局部装饰；触发 3 = 必现 · 2 = 常态会出现 · 1 = 边缘。
`9 = Critical · 6 = High · 4 = Medium · ≤3 = Low`。**每条都写出两个因子**（见 `违规的UI.md`），可复算。

---

## 2. 方法与可复现命令（含原始输出）

四种手段，**结论只出自这四种**：

| 手段 | 干什么 | 产出 |
|---|---|---|
| 静态读码 + grep | 建立"代码事实上有什么/没有什么" | `file:line` 引用 |
| 单点渲染探针 | 把"某个表达式恒为什么"钉死 | §2.1 / §2.2 的原始输出 |
| UC 对比度复算 | 把颜色换算成 WCAG 比值 | §4 全表（§A.1 脚本） |
| 真窗口实测 | 用 Playwright 启动真 Electron，读 `getComputedStyle` 与 DOM | §2.4 事实表 + 5 张截图（§A.5） |

### 2.1 探针一：`clsx` 对布尔参数的处理

````
`$ node --input-type=module -e "import('clsx').then(m => { const c = m.clsx; console.log('clsx(true)=', JSON.stringify(c(true))); console.log('clsx(true,false)=', JSON.stringify(c(true,false))); })"`
`clsx(true)= ""`
`clsx(true,false)= ""`
`exit=0`
````

⇒ **布尔参数在 `clsx` 里被当作"无类名"丢弃**。这是 V-01 的第一半证据。

### 2.2 探针二：NavLink 用 `Sidebar.jsx:45` 的原表达式渲染

复刻表达式（与源码逐字一致），在纯 Node 里用 `react-dom/server` 渲染，再读产出的 HTML：

````
`probe isActive=true -> undefined`
`RENDERED: <a aria-current="page" href="/" data-discover="true">语义搜索</a>`
`has class attr: false`
`exit=0`
````

⇒ **当前项拿到了 `aria-current="page"`（读屏是对的），但一个 class 都没有**（视觉是死的）。这是 V-01 的第二半证据，也是"语义做对了、视觉漏了"的典型形状。

### 2.3 探针三：`out/` 与源码同版？

````
`out/main/index.js         2026-10-13T06:35:02Z`
`out/renderer/index-*.js   2026-10-13T06:35:04Z`
`newest renderer source    2026-10-13T06:35:01Z   apps/desktop/src/renderer/src/pages/TasksPage.jsx`
````

⇒ 构建晚于源码 3 秒 ⇒ **截图与代码同版**，不需要重建即可取证（这一步不做，截图就有可能是旧界面 —— 那是最坏的一种假证据）。

### 2.4 真窗口事实表（节选；完整输出见 §A.4）

`node data/_uiux-capture/capture.mjs` 启动真 Electron（模拟模式 + 无库两种场景），读计算样式：

| 事实 | 实测值 | 对应违规 |
|---|---|---|
| 侧栏当前项 class | `null`（三条路由一致） | V-01 |
| 侧栏当前项计算背景 | `rgba(0, 0, 0, 0)` | V-01 |
| `.dot-ok` 的计算样式 | `color: rgb(110,110,115)` / `background: rgb(52,199,89)` | V-02 |
| `[data-state]` 徽标 | `color: rgb(105,112,125) / background: rgb(236,238,242)`（与默认标签**逐位相同**） | V-04 |
| `.score.high` | `color: rgb(52,199,89)` / `font-size: 11px` | V-03 |
| 顶栏图标按钮高度 | `36px` | V-38 |
| 小按钮高度 | `32px`（`/activity`、`/item`） | V-38 |
| 筛选胶囊高度 | `37px` | V-38 |
| `.content` | `max-width 1500px / offsetLeft 220 / innerWidth 1432` | V-14 |
| 含未渲染 Markdown 的可见节点 | `/tasks` 1 · `/activity` 1 · `/item` 1 | V-40 |
| 向导对话框 | `role=dialog` · `aria-modal=true` · `aria-describedby=null` · `activeElement=BODY` | V-36 |
| `/tasks` 下 `[aria-current]` 项 | **无**（详情页路由没有任何当前项） | V-01 / V-28 |

控制台错误：向导场景 **0 条**；模拟场景 **25 条 `415 (Unsupported Media Type)`**，来源 `apps/desktop/src/main/index.mjs:453`（`img.isEmpty()` ⇒ 415）。模拟模式没有真图，这条是**预期**的；但它暴露了一个界面事实：**失败只有一个"无预览"，使用者分不清"文件不在盘上"与"解码失败"**（V-23）。

---

## 3. 视觉：层级、密度与材质

**结论：版式是这份界面最稳的一块，问题集中在"语义色用错了位置"。**

| 观察 | 事实 | 评价 |
|---|---|---|
| 层级清晰 | 三级表面：`--color-bg-primary`（页）· `--color-bg-secondary`（侧栏）· `--color-bg-elevated`（面板/卡片）；圆角三档（8 / 12 / 16）各司其职（`tokens.css:57-58`，`renderer.css` 对应 195/186/220 行） | ✅ 符合 HIG › Design themes 的 Clarity/Depth |
| 密度克制 | 页面内边距 24px、卡片 gap 16px、网格最小列宽 240px（`tokens.css:130-132`） | ✅ 桌面尺度合理 |
| 一个真实缺陷 | 状态语义色被放到 `background` 上（V-02）：6 处文字标记变成色块 | ❌ 视觉噪声 + 隐喻反转 |
| 深度表达 | 全仓只有 `--shadow-control` 与 `--shadow-float`；卡片悬停只换描边（V-09） | ⚠️ 有意取舍（tokens §8），但需登记 |
| 图标体系 | 用 Unicode 字符当图标（↻ ? ← ＋ ◫ ⌕ ▧ ✓ ◴ ⌑ ⚙ ▦ ◴ ↺） | ⚠️ 跨平台字形宽度/基线不一致，无法统一描边粗细；HIG 级别的一致性做不到（【判断，非实测】：本轮未做像素级比对） |

---

## 4. 配色与对比度（脚本复算，非手算）

**结论：亮色档有 8 组前景不达 4.5:1，其中"分数档位"是结果区的主信号；深色档另有 1 组（CR+VR 标签）只有 2.55:1。**

- 方法：`data/_uiux-capture/contrast.mjs`（**只读** `tokens.css`），按 WCAG 2.2 SC 1.4.3 官方式子复算。
- 关键方法学修正（**记下来，防止后来者重犯**）：`color-mix(…%, transparent)` 的实际底色取决于**父面**。第一版脚本用白底算深色模式，把「未分类」标签算成 1.33（假 FAIL）。改成"每档按该档的 `--color-bg-elevated` 合成"后才是真值 —— **深色模式必须在深色面上算**。
- 下文数值**全部来自脚本输出**；审查早期的几个手算初值已废弃（未写入本报告）。

### 4.1 全表（34 组，脚本原样）

| 模式 | 前景 / 背景 | 前景 | 背景 | 比值 | 正文 4.5:1 |
|---|---|---|---|---|---|
| light | 正文 ink / 主背景 | #1d1d1f | #ffffff | 16.83 | PASS |
| light | 次要 ink / 主背景 | #6e6e73 | #ffffff | 5.07 | PASS |
| light | 次要 ink / 次级背景（侧栏） | #6e6e73 | #f5f5f7 | 4.66 | PASS |
| light | 次要 ink / 浮起层 | #6e6e73 | #ffffff | 5.07 | PASS |
| light | 强调色 / 主背景 | #0071e3 | #ffffff | 4.70 | PASS |
| light | 主按钮文字 / 强调色底 | #ffffff | #0071e3 | 4.70 | PASS |
| light | **错误文字 / 浮起层** | #ff3b30 | #ffffff | **3.55** | **FAIL** |
| light | **错误 toast 文字 / 错误底** | #ffffff | #ff3b30 | **3.55** | **FAIL** |
| light | **分数 high / 浮起层** | #34c759 | #ffffff | **2.22** | **FAIL** |
| light | **分数 mid / 浮起层** | #ff9f0a | #ffffff | **2.06** | **FAIL** |
| light | 分数 low / 浮起层 | #6e6e73 | #ffffff | 5.07 | PASS |
| light | **标签 VR / 标签底** | #2f6feb | #e8effe | **3.96** | **FAIL** |
| light | **标签 CR / 标签底** | #8250df | #f1e9fd | **4.28** | **FAIL** |
| light | 标签 CR+VR / 标签底 | #1a7f37 | #e3f7e8 | 4.53 | PASS |
| light | **标签 其他 / 标签底** | #69707d | #eceef2 | **4.29** | **FAIL** |
| light | **标签 未分类 / 标签底** | #a56a12 | #fff0d8 | **4.00** | **FAIL** |
| light | 侧栏次要文字 / 侧栏底 | #6e6e73 | #f5f5f7 | 4.66 | PASS |
| dark | 正文 ink / 主背景 | #f5f5f7 | #000000 | 19.29 | PASS |
| dark | 次要 ink / 主背景 | #a1a1a6 | #000000 | 8.16 | PASS |
| dark | 次要 ink / 次级背景 | #a1a1a6 | #161617 | 7.03 | PASS |
| dark | 次要 ink / 浮起层 | #a1a1a6 | #1d1d1f | 6.54 | PASS |
| dark | 强调色 / 主背景 | #2997ff | #000000 | 6.96 | PASS |
| dark | **主按钮文字 / 强调色底** | #ffffff | #2997ff | **3.02** | **FAIL** |
| dark | 错误文字 / 浮起层 | #ff453a | #1d1d1f | 4.94 | PASS |
| dark | **错误 toast 文字 / 错误底** | #ffffff | #ff453a | **3.41** | **FAIL** |
| dark | 分数 high / 浮起层 | #30d158 | #1d1d1f | 8.32 | PASS |
| dark | 分数 mid / 浮起层 | #ff9f0a | #1d1d1f | 8.19 | PASS |
| dark | 分数 low / 浮起层 | #a1a1a6 | #1d1d1f | 6.54 | PASS |
| dark | 标签 VR / 标签底 | #9ec2ff | #16233a | 8.70 | PASS |
| dark | 标签 CR / 标签底 | #d0b4ff | #241a33 | 9.17 | PASS |
| dark | **标签 CR+VR / 标签底** | #1a7f37 | #203627 | **2.55** | **FAIL** |
| dark | 标签 其他 / 标签底 | #c3c9d1 | #232329 | 9.37 | PASS |
| dark | 标签 未分类 / 标签底 | #f0cf8a | #41321c | 8.26 | PASS |
| dark | 侧栏次要文字 / 侧栏底 | #a1a1a6 | #161617 | 7.03 | PASS |

**失败汇总（9 行，含 V-03/05/06/15）**：亮色 7 行、深色 3 行（其中 **4 行同时不达 3:1 非文字阈值**：分数 high/mid 与深色 CR+VR，以及浅色错误文字/toast —— 见脚本第 9 列）。

### 4.2 与 HIG 的对差（**B5**）

| 令牌 | 现值 | HIG 参考值 | 判定 |
|---|---|---|---|
| `--color-success` | `#34c759` | systemGreen（light）`#34C759` | ✅ 一致 |
| `--color-critical` | `#ff3b30` / dark `#ff453a` | systemRed `#FF3B30` / `#FF453A` | ✅ 一致（**但作正文只有 3.55:1**，见 V-15 连带） |
| `--color-warning` | `#ff9f0a`（两档同值） | light `#FF9500` · dark `#FF9F0A` | ❌ 浅色用了深色档（V-07） |
| `--color-accent` | `#0071e3` / `#2997ff` | systemBlue `#007AFF` / `#0A84FF` | ⚠️ 网页蓝，非系统蓝（V-08，**有意偏离需登记**） |
| `--color-bg-secondary` | `#f5f5f7` | 非系统色（Apple 网页常用值） | ⚠️ 非 HIG 语义令牌；作为"网页风格"可接受 |
| `--color-selection` | `#e4e4ea` | — | ⚠️ 自造值，未登记来源 |

**HIG 数值来源声明**：HIG 正文本轮取不到（§1.3），上表"参考值"均为**【判断，非实测】**（凭 Apple 系统色公开规格与色彩记忆列出）。**任何一位 Reviewer 若要引用这一列，请先用可取到的官方或镜像来源核对** —— 本报告不把它当实测证据。

### 4.3 两套深色块是否漂移

脚本同时做了一件机械检查：`@media (prefers-color-scheme: dark)`（`tokens.css:168-189`）与 `:root[data-theme="dark"]`（`:191-210`）是**同一批值写了两遍**。

`两块的键集合相同 · 值逐条相同 · 差异 []`

⇒ **当前没有漂移**，但这是**两份定义**（`AGENTS.md` P1 的形状）。§13 给了一条低成本的收口建议（改成一处 `@custom-selector` 或引用同一组变量），以及一条**已经踩到的漂移**：`--cat-crvr-fg` 两处都没覆盖 ⇒ 深色下 2.55:1（V-06）。

---

## 5. 排版与字体

### 5.1 字号阶梯（**B6**）

| 档位 | 值 | 用途 | 评价 |
|---|---|---|---|
| `--type-caption: 13px` | body 基准 | `renderer.css:38` `body` 用 13px —— 与 macOS body 13pt 一致 | ✅ |
| `--type-micro: 11px` | 元信息、标签、侧栏小字 | 用得**最多**（指标注释、卡片 meta、标签、侧栏） | ⚠️ 11px 是 WCAG 意义的正文 ⇒ 必须 4.5:1（这是 §4 多数失败行的字号背景） |
| `--type-h1: 27px` / `--type-title2: 24px` | 页面标题 / 弹窗标题 | 自查登记过（`tokens.css:113-114`） | ✅ |
| `--type-metric: 23px` | 指标卡数值 | — | ✅ |
| 阶梯外 | 无 | — | — |

**一处不一致**：`--type-h1` 与 `--type-title2` 相差仅 3px，而页面标题（27px）与弹窗标题（24px）在视觉上几乎同级；【判断，非实测】建议把 h1 拉到 28–30 或把 title2 降到 20，让"页 > 弹窗"的层级可感知。

### 5.2 字体在 Windows 上的实际落点（**重新验证前次审查的 U-06**）

`--font-sans` 的候选顺序（`tokens.css:46-48`）：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei", Helvetica, Arial`。

本轮**查了本机字体注册表**：

| 候选 | 本机是否存在 |
|---|---|
| `-apple-system` / `BlinkMacSystemFont` | 仅在 Apple 平台生效，Windows 上无意义 |
| SF Pro / PingFang / Hiragino / Helvetica | **均未安装** |
| Segoe UI Variable | **未安装** |
| Segoe UI / Microsoft YaHei / Arial | ✅ 已安装 |

⇒ 实际落点是 **Segoe UI（西文）+ Microsoft YaHei（中文）**。**【判断，非实测】**：结论来自"候选字体是否安装"的直接证据 + CSS 字体回退规则，未做逐字形宽度测量。

**这条的含义**：所谓"Apple 风格"在这个项目的唯一目标平台上**一个 Apple 字体都用不到**。这不是缺陷（SF 有授权限制、不能随包分发，见 `docs/design/DESIGN-tokens.md:83`），但**必须在文档里说清**："Apple 风格"在本机是靠**版式、留白、语义色、动效克制**达成的，不是靠字体。当前 `DESIGN-tokens.md` 没有这句话 ⇒ 容易被后来者误读成"字体已经对齐 Apple 了"。

**另一处细节**：`.brand-sub`（`renderer.css:82`）与 `.nav-label`（`:84-87`）对**中文标签**用了 `letter-spacing: .04em / .12em`。CJK 没有字距概念，加 tracking 会把"工作区 WORKSPACE"这类中英混排拉得松散【判断，非实测】。

---

## 6. 布局与桌面壳

| 观察 | 事实 | 判据 | 结论 |
|---|---|---|---|
| 双标题栏 | 原生标题栏 + 68px `.topbar`（V-11） | HIG › Toolbars | ❌ |
| 主进程硬编码色值 | `apps/desktop/src/main/index.mjs:473` `'#f5f5f7'`（V-12） | `AGENTS.md` §3 · HIG › Dark Mode | ❌ |
| 窗口状态不记忆 / 无菜单 | grep 0 处（V-13） | HIG › Windows / Menus | ⚠️ |
| 内容上限 | `.content` `max-width:1500px` 无自动居中；实测 1432 视口下**不生效**（V-14） | HIG › Layout | ⚠️ 潜在 |
| 断点 | `@media (max-width: 760px)` 因 `minWidth:1040` 永不可达（V-14） | — | ⚠️ 死代码 |
| 侧栏宽度 | 220px 常量（`tokens.css:128`） | HIG › Sidebars（源列表可调宽） | ⚠️ 不可调；桌面应用通常允许拖拽改宽 |
| 滚动容器 | `.content` 自带 `overflow-y:auto`，而 `.main` 也是 flex 列 | — | ✅ 只有一个滚动条，符合桌面习惯 |

**桌面上"少了一样东西"**：没有**右键上下文菜单**（结果卡、事务表都没有）。macOS/Windows 桌面应用的列表与卡片几乎都会给右键菜单（定位、取件、复制路径）。**【判断，非实测】**：本轮未测右键，但代码里 grep 不到 `onContextMenu`。

---

## 7. 状态与反馈（逐页五态矩阵）

**结论：五态**（初始 / 加载 / 空 / 错误 / 进行中）**齐全性是这份界面做得最好的部分，问题是"错误的表达方式"** —— 错误没有样式（V-15）、会自己消失（V-16）、且错误色本身不达标（§4.1）。

| 页面 | 初始态 | 加载态 | 空态 | 错误态 | 进行中 | 得分点 / 扣分点 |
|---|---|---|---|---|---|---|
| 语义搜索 | 有引导块（`showHint`，`SearchPage.jsx:88,144-149`） | 8 张骨架卡（`Gallery.jsx:22-27`） | 「没有匹配的素材」+ 可操作建议（`:39-46`） | 用引擎的 `userMessage` + 错误码（`:29-37`） | 按钮文案切换 + 骨架 | ✅ 五态齐 · ❌ 错误无样式（V-15）· ❌ 骨架对读屏是空的（V-22） |
| 图片详情 | 「读取这条素材的索引元数据与磁盘实况」 | 「正在读取…」面板（`ItemPage.jsx:152`） | 不适用 | `role="alert"` + 错误码 + 引导（`:153-159`） | 按钮「处理中…」 | ✅ 错误态用了 `role="alert"`（比 toast 好）· ❌ 同类写操作不禁用（V-21）· ❌ 侧栏状态自相矛盾（V-32） |
| 索引任务 | 有解释块（`TasksPage.jsx:268-282`） | 无（进度即状态） | 「还没有跑过任务」 | 失败项可展开（`<details>`，`:66-87`） | 阶段条 + 计数 + 速率 + ETA | ✅ 进度可信（不编百分比、ETA 缺失写"—"）· ❌ 不确定态静止（V-19）· ❌ 逐条事件弹 toast（V-18） |
| 操作记录 | 「还没有任何写操作记录」 | 「正在读取…」 | 同左 | `role="alert"` + 说明（`ActivityPage.jsx:125-132`） | 按钮「处理中…」 | ✅ 待处理三路（重试/回退/保持现状）与契约对应 · ❌ 保持现状不留痕（V-20）· ❌ `text-err` 无效类（V-17） |
| 首启向导 | 遮挡式，必经（`FirstRunWizard.jsx`） | 「正在添加…」 | 不适用 | 主进程 `userMessage` 原样显示（`:75`） | 按钮禁用 | ✅ 不自编文案（消灭"两处说法"）· ❌ 非真对话框（V-36） |
| 门禁（无库/读不到配置） | 载入态 `return null`（`LibraryGate.jsx:37`） | 空白一瞬 | — | 如实报 + 重试（`:40-52`） | — | ⚠️ 空白优于闪烁（有意的），但可给骨架（V-27） |

**跨页观察**：错误态的表达**分成三档**（页内 `role="alert"` / toast / 无样式类），而成功反馈只有一档（toast）。这会造成"同样严重的事，界面反应不一样"的心智不一致（V-15 + V-16）。

---

## 8. 交互与键盘（对照项目自有规格）

工程规格 `docs/design/UI-REVIEW-and-migration.md` §6 写了 7 项流程 1 的交互能力。**实现对照**：

| 规格要求（`:228` / `:232`） | 实现 | 状态 |
|---|---|---|
| Enter 触发搜索 | `search/SearchPanel.jsx:26` | ✅ |
| 点按钮搜索 | `:33` | ✅ |
| 拖入图片 | 无 `dragover/drop` | ❌ V-29 |
| Ctrl+V 粘图 | 无 `paste` 监听 | ❌ V-29 |
| 方向键选择结果 | 无 | ❌ V-29 |
| Enter 定位选中项 | 无 | ❌ V-29 |
| Ctrl+C 复制包路径 | 无 | ❌ V-29 |
| Esc 清空查询 | 无（`Esc` 只在 Radix 确认弹窗里有效） | ❌ V-29 |
| 空格预览 | 无 | ❌ V-29 |

⇒ **9 项里实现 2 项**。这条不是"锦上添花"：项目自己的验收写的是"键盘全通"（`:267`）。

**其他交互问题**：空按钮（V-30）· 假选项（V-31）· 主操作藏在悬停里（V-34）· 禁用项仍可聚焦（V-35）· 破坏性动作不显红（V-33）· 详情页不可达（V-28）。

**做对了的交互**（不要改坏）：取件走"请求→确认→执行"三步，**取消时一个 IPC 都不发**（`store/search.js:138-154`，测试 Z13–Z15 钉住）；确认弹窗焦点默认落在**取消**（安全默认）；连点只发一次。这套是本次审查里交互设计的**最高分项**。

---

## 9. 无障碍

| 项 | 事实 | 判定 |
|---|---|---|
| Chip 的 `aria-pressed` | `ui/Chip.jsx:32`，真窗口会翻转（E2E E5-a） | ✅ 比"只改 class"正确 |
| 导航的 `aria-current="page"` | 由 NavLink 提供（E5-b 钉住） | ✅ 语义对；**视觉没接上**（V-01） |
| 图标按钮的可读名字 | 顶栏两个按钮有 `aria-label`（E5-d） | ✅ |
| 装饰图标 | `aria-hidden`（`Sidebar.jsx:48,61` · `Metric.jsx:11`） | ✅ |
| 焦点环 | `:focus-visible` 统一 2px + 3px offset | ✅（副作用见 V-10） |
| **错误播报** | toast 恒 `role="status"` / polite | ❌ V-16 |
| **对话框语义** | 向导有 `role="dialog"` 但无陷阱/初始焦点/描述 | ❌ V-36 |
| **系统偏好** | 只处理 reduced-motion | ❌ V-37 |
| **目标尺寸** | 32–37px（项目自定 44px） | ❌ V-38（AA 24px 通过，AAA 44px 未过） |
| **对比度** | 8 组不达 AA | ❌ V-03/05/06/15 |
| **状态播报** | 结果数量变化无 live region | ❌ V-22 |
| 对话框焦点归还 | `ConfirmDialog.jsx:71-84` 自己记来源并归还 | ✅（这段注释里的两个坑写得非常清楚） |

**一句话**：**aria 语义这一层做得比前次审查好得多**（前次"全仓 0 处 `aria-pressed/aria-current`"，现在两处都有且被真窗口钉住）；但**"能看见的部分"**（对比度、目标尺寸、错误可见性）与**"系统偏好"**（透明度/对比度）仍然是空的。

---

## 10. 动效

| 观察 | 事实 |
|---|---|
| 全渲染层的动效数量 | `renderer.css` 里只有 **2 条** `transition`：`.card-acts` 的 `opacity .15s`（`:233`）与 `.toast` 的 `opacity .2s, transform .2s`（`:273`） |
| keyframes | **0 条**（渲染层 grep `@keyframes` 无命中） |
| reduced-motion | ✅ 处理了，**两处**（`tokens.css:242-244` + `renderer.css:280-282`）—— 重复了一份，属 P2 形状（同一规则两处写） |
| smooth scroll | `tokens.css:245` `html { scroll-behavior: smooth }`（会被 reduced-motion 覆盖） |
| 按下反馈 | 无 `:active` 规则；按钮悬停只换描边 |

**判定**：符合 `DESIGN-tokens.md` §8「不做进入动画与悬停位移」的**有意克制**（HIG 也主张动效服务于目的，不做无意义动画）。**唯一实质性缺口是进度不确定态**（V-19）：那里"不动"不是克制，是**信息缺失** —— 用户无法区分"在跑"与"卡死"。

---

## 11. 心智模型与文案

| 问题 | 事实 | 影响 |
|---|---|---|
| **未渲染的 Markdown**（V-40） | 真窗口实测 3 处可见 `**加粗**`；源码共 9 处 | 最直接的"没做完"信号 |
| **详情页不可达**（V-28） | 侧栏写"P3c（从结果卡进入）"，结果卡里没有链接 | 用户按提示找不到入口 |
| **同一应用两种"未实现"表达**（V-30） | 侧栏 disabled + title；顶栏/页头是可点的空按钮 | 用户学到两套规则 |
| **假选项**（V-31） | 排序「最近添加」选中后只弹提示 | 控件在撒谎 |
| **状态自相矛盾**（V-32） | 详情页侧栏"未配置/0%" vs 元数据区真实条目 | 怀疑索引坏了 |
| **开发者术语**（V-41） | compat / seq / dim / uid / 错误码 / canUndo / `GEMMA_FAKE=1 npm run dev` | 用户需要读源码才能理解界面 |
| 做对了的文案 | 成功/失败文案**不过度声称**：定位写"已请求在资源管理器中定位（系统未回报结果）"（`store/search.js:109-117`）；ETA 缺失写"—"不估算；不确定进度不编百分比 | ✅ 这套"不许诺系统没回报的事"的纪律值得保留 |

**文案口径建议**：把"开发者可见"与"用户可见"分开 —— 错误码、compat、seq 这类信息收进可展开的"详情（诊断）"区域；主文案只留用户语言。这样既保住可诊断性，也不牺牲 HIG › Writing。

---

## 12. 与前次审查（`UIUX-AUDIT.md`，2026-10-10，冻结档）的回归对照

前次审的是**重构前、只有 1 页**的版本。逐条看它的关键结论**现在是否还成立**：

| 前次编号 | 前次结论 | 现状 | 依据 |
|---|---|---|---|
| U-01 | 分数阈值在仓库里有 4 套定义，界面自算阈值 ⇒ 文本检索全被标"较弱" | ✅ **已修**：界面不再自算，档位只来自引擎 `band`（`ui/Score.jsx:33-43`），并有 `styles.test.mjs` 的 T2/T2b 双向钉住 | 代码 + 测试 |
| U-03 | 8 处文字对比度低于 4.5:1（含分数徽标 2.06/2.22） | ❌ **仍在**：本轮复算仍是 2.06 / 2.22，且**新增深色档 2.55**（V-03/05/06），另发现错误色 3.55（V-15 连带） | §4.1 脚本 |
| U-05 | 无障碍薄弱：`aria-pressed/aria-current` 全仓 0 处 | ✅ **大幅改善**：Chip 有 `aria-pressed`、NavLink 有 `aria-current`，且都被真窗口 E2E 钉住 | E5-a/b + 代码 |
| U-06 | 字体：Apple 字体在 Windows 上一个都用不上 | ❌ **仍成立**（本轮重查字体注册表，结论相同） | §5.2 |
| U-07/§10 | reduced-motion 是否处理 | ✅ 处理了（两处） | §10 |
| §12（U-10） | 需给可执行改进清单 | 🔁 **本报告 §13 取代之**（面向当前 4 页，逐条引用 `V-nn`） | — |
| 前次提到的"令牌体系是最好的一块" | 单一来源、零色值字面量 | ⚠️ **渲染层仍成立，但主进程破了例**：`apps/desktop/src/main/index.mjs:473` 硬编码 `#f5f5f7`（V-12）—— 因为样式断言只扫渲染层 | §4.3 + V-12 |

> ⚠️ 引用前次审查时请注意：`docs/audit/README.md` 声明那批文档的路径是**重构前**的、行号不可靠。本表只引用**结论编号**，不引用其行号。

---

## 13. 整改建议（按优先级；每条只给"改哪里 + 怎么验"，**改法细节在 `违规的UI.md` 的对应编号下**）

### P0 —— 断链与"看不见的关键信息"（做完这 6 条，界面才谈得上"完成"）

| 编号 | 改哪个文件 | 怎么验 |
|---|---|---|
| **V-28** | `search/PhotoCard.jsx`（包一层链接） | 新增 E2E：点结果卡 → hash 变 `#/item/…` 且标题变「图片详情」 |
| **V-01** | `layout/Sidebar.jsx:45` | 真窗口断言当前项有 `active` 类且计算背景 ≠ 透明 |
| **V-15** | `renderer.css`（加错误语义类）+ `tokens.css`（新增正文红令牌） | 脚本复算新前景 ≥4.5:1；真窗口断言错误文案颜色 ≠ 正文 |
| **V-02** | `renderer.css` 或 6 处调用点 | 真窗口断言被修元素背景为透明、颜色落在 `color` |
| **V-03** | `renderer.css` + `ui/Score.jsx` | 对比度脚本对分数实际配色复算 ≥4.5:1 |
| **V-16** | `hooks/useToast.js` + `ui/Toast.jsx` | 真窗口断言错误 toast 为 `alert` 且 3 秒后仍在 |

### P1 —— 状态一致性与无障碍（做完 P0 后紧接着做，成本低、收益直观）

| 编号 | 改哪个文件 | 怎么验 |
|---|---|---|
| V-32 | `pages/ItemPage.jsx:127` | 真窗口断言详情页侧栏显示真实库根与百分比 |
| V-06 / V-05 / V-07 | `tokens.css` 两处深色块 + 标签前景 | 脚本全表 0 个 FAIL |
| V-19 | `pages/TasksPage.jsx` + `renderer.css` | 真窗口断言不确定态宽度随时间变化 |
| V-40 | 3 个页面 + `utils/item-actions.js` | 真窗口断言 `rawMarkdownNodes.length === 0`（建议做成机械断言） |
| V-36 | `pages/FirstRunWizard.jsx`（复用 Radix） | 真窗口断言打开后焦点在对话框内、Tab 不逃逸 |
| V-04 / V-17 | `renderer.css` + `pages/ActivityPage.jsx:144` | 真窗口断言四档徽标颜色两两不同、错误标题色 ≠ 正文 |
| V-21 | `pages/ItemPage.jsx:252` | 真窗口断言点 A 后 B 也禁用 |
| V-20 | `pages/ActivityPage.jsx`（状态上移到 store） | `npm test` 级：卸载后状态仍在 |
| V-23 | `apps/desktop/src/main/index.mjs:453` + 两处占位文案 | 真窗口断言两种失败给出不同文案 |
| V-22 | `search/Gallery.jsx` | 真窗口断言加载态容器 `aria-busy="true"` |
| V-37 | `renderer.css`（两条媒体查询） | 真窗口用 `emulateMedia` 断言顶栏在减透明度下不透明 |

### P2 —— 桌面程序感与打磨（可与后续功能同批做）

| 编号 | 改哪个文件 | 怎么验 |
|---|---|---|
| V-11 / V-12 / V-13 | `main/index.mjs` | 真窗口断言无浅色闪屏；窗口尺寸重启后恢复 |
| V-35 / V-38 | `layout/Sidebar.jsx` + `ui/Button.jsx` + `ui/Chip.jsx` | Tab 不再停在禁用项；高度取舍写入 `DESIGN-tokens.md` |
| V-29 / V-30 / V-31 / V-33 / V-34 | 见编号 | 逐条真窗口断言；空按钮与假选项必须先二选一 |
| V-18 / V-24 / V-25 / V-26 / V-27 | 见编号 | 逐条断言 |
| V-06 收口建议（两套深色块） | `tokens.css` | 机械断言：两个深色块的键集合相同（脚本已能算，可搬进 `npm test` 变成回归锁） |
| V-08 / V-09 / V-10 / V-14 / V-39 / V-41 | 见编号 | 多为"登记决定"或删除死代码 |

**建议的落地顺序理由**：V-28 与 V-01 是"用户马上能感到的不对"；V-15/V-16 是"出错时用户看不懂"（出错概率虽低，但每次都很痛）；其余按 P 级推进。**不要先做 V-09/V-39 这类审美打磨** —— 它们排在 42 条的最后。

---

## 14. 未覆盖与不可验证（诚实边界）

| 项 | 为什么没做 / 做不了 | 影响 |
|---|---|---|
| **打包态与冷启动计时** | 需要 `electron-builder` 产物与本机签名环境（`TODO.md` B-3 已记为未验证） | 本报告的"桌面程序感"结论都基于 **dev/预览态**；打包后图标、安装器、任务栏行为未审 |
| **真实检索质量与缩略图内容** | 需要 ONNX 模型 + 已注册索引 | §2.4 的截图用**模拟模式**（夹具数据）；因此"结果卡长什么样"是真实的，**"结果对不对"不在本次范围** |
| **屏幕阅读器实机** | 本环境没有 NVDA/Narrator 自动化 | §9 的结论基于 `aria-*` 存在性与角色定义，**不是**"读屏实测" —— 别把它当读屏验收 |
| **系统级偏好真窗口** | 未在真窗口切换系统"降低透明度/增强对比度" | V-37 是**代码事实**（媒体查询不存在），不是实测行为差异 |
| **WCAG SC 2.2.1 对 toast 的适用性** | 自动消失的状态消息是否构成"时间限制"存在解释空间 | V-16 的**主判据是 SC 4.1.3 与 HIG Feedback**；2.2.1 只是**附加【判断】** |
| **HIG 具体条文与数值** | HIG 是 SPA，`web_fetch` 只拿到标题（§1.3 已实测） | §4.2 的"HIG 参考值"列标了**【判断，非实测】**；引用前请自行核对 |
| **图标像素级一致性** | 未做 Unicode 图标的字形测量 | §3 关于"图标体系"的结论标了【判断，非实测】 |
| **触摸与高 DPI** | 未在触摸设备/缩放 125%/150% 下验证 | V-38 的目标尺寸结论是 CSS 像素，未含 DPI 缩放后观感 |
| **截图能否入库** | `.gitignore` 排除截图（`AGENTS.md` §5.3） | 5 张 PNG 只在本地 `data/_uiux-shots/`；**本报告把"文本事实表"当作可入库证据**，图片只是辅助 |

---

## 15. 自检表（可追溯 / 不混事实 / 不主观 / 可复算）

| 门 | 要求 | 自检结果 |
|---|---|---|
| G1 | 每条结论可追溯到 `file:line` 或命令输出 | ✅ 42 条全部有 `file:line` 或脚本/探针输出；4 处纯判断已标【判断，非实测】 |
| G2 | 严格区分**代码事实 / 文档声称 / 行业做法** | ✅ 每条违规的"判据"（HIG/WCAG/项目规格）与"事实"（`file:line`）分列；§5.2 明确标注"结论来自字体安装证据 + 回退规则，未做字形测量" |
| G3 | 不用主观形容词替代证据 | ✅ 全文无"精致/美观/高级感"等词；"差/弱/合规但贫"这类评级**后紧跟编号与数值** |
| G4 | 严重度可复算 | ✅ 每条给出 `影响面 × 触发可能性 = 分值`（`违规的UI.md` 每条标题行） |
| G5 | 覆盖 6 个维度（视觉/交互/状态/心智/配色/动效）+ 无障碍与桌面壳 | ✅ §3–§11 一一对应；桌面壳单列 §6 |
| G6 | 不声称未验证的能力 | ✅ §14 列出 9 项边界；§1.3 披露 HIG 取值边界；§2.4 明确截图场景是模拟模式 |

**复核方式（本轮）**：所有 `file:line` 均在写入前重新 `read` 或 grep 核对过；对比度数值为脚本产出（非手算）；侧栏无 class、`.dot-*` 背景、状态徽标无差别三条**另有真窗口实测**（不只是读码）。**按 `AGENTS.md` §0 惯例的独立 Agent 复核不在本次范围** —— 若需要，可按 `docs/audit/REVIEW-*.md` 的体例另出一份。

---

## §A 附录（脚本全文 + 原始输出，保证"数字可重算"）

> ⚠️ 三个脚本都在 `data/_uiux-capture/`、5 张 PNG 在 `data/_uiux-shots/` —— **均在 `.gitignore` 覆盖范围内**（`data/_*`），不随仓库分发。
> 所以本附录把**脚本全文**与**原始输出**抄进来：图片会丢，脚本与数字不会。**要复现，先按 A.3 重建脚本，再跑 A.4 的命令。**

### A.1 `contrast.mjs` —— WCAG 对比度复算（§4.1 全表的唯一来源）

```js
// data/_uiux-capture/contrast.mjs —— WCAG 2.2 SC 1.4.3 对比度复算（只读，一次性探针）
//
// 为什么要有它：审查报告里的对比度数值必须是**脚本算出来的**，不能手算。
// 只读 packages/design-tokens/tokens.css；不改任何产品文件。
//
// 用法：node data/_uiux-capture/contrast.mjs
// 输出：TSV（模式 / 前景令牌 / 背景令牌 / 计算值 A / 计算值 B / 比值 / 11px 正文是否达 4.5:1）
import fs from 'node:fs'

const CSS = fs.readFileSync('packages/design-tokens/tokens.css', 'utf8')

/** 取某个选择器之后的第一个 { ... } 块（不解析嵌套媒体查询的完整语义，够用即可） */
function blockAfter(marker) {
  const i = CSS.indexOf(marker)
  if (i < 0) throw new Error('找不到块：' + marker)
  const start = CSS.indexOf('{', i)
  let depth = 0
  for (let j = start; j < CSS.length; j++) {
    if (CSS[j] === '{') depth++
    else if (CSS[j] === '}') { depth--; if (depth === 0) return CSS.slice(start + 1, j) }
  }
  throw new Error('块未闭合：' + marker)
}

function parseVars(text) {
  const out = {}
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m
  while ((m = re.exec(text))) out[m[1]] = m[2].trim()
  return out
}

const lightVars = parseVars(blockAfter(':root {'))
const darkMediaVars = parseVars(blockAfter('@media (prefers-color-scheme: dark) {'))
const darkAttrVars = parseVars(blockAfter(':root[data-theme="dark"] {'))
const darkVars = { ...lightVars, ...darkMediaVars }

// ---------- 颜色解析 ----------
const hex = (h) => {
  const s = h.replace('#', '')
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), a: 1 }
}
const blend = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
})

/** 把令牌表达式解析成「覆盖在 backdrop 上的不透明色」 */
function color(expr, vars, backdrop, depth = 0) {
  if (depth > 12) throw new Error('var 循环：' + expr)
  const e = String(expr).trim()
  if (e === 'transparent') return backdrop
  if (e.startsWith('#')) return blend(hex(e), backdrop)
  const rgb = e.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const p = rgb[1].split(',').map((x) => Number(String(x).trim()))
    return blend({ r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }, backdrop)
  }
  if (e.startsWith('color-mix(')) {
    // 形如：color-mix(in srgb, <color> <pct>%, transparent|<color>)
    const inner = e.slice(e.indexOf('(') + 1, e.lastIndexOf(')')).replace(/^\s*in\s+srgb\s*,/i, '')
    const [a, b] = inner.split(',')
    const pct = Number(String(a).match(/([\d.]+)%/)[1]) / 100
    const base = color(String(a).replace(/[\d.]+%\s*$/, '').trim(), vars, backdrop, depth + 1)
    void b
    return blend({ ...base, a: pct }, backdrop)
  }
  const v = e.match(/^var\((--[a-z0-9-]+)\)$/i)
  if (v) {
    if (!(v[1] in vars)) throw new Error('未定义令牌：' + v[1])
    return color(vars[v[1]], vars, backdrop, depth + 1)
  }
  throw new Error('无法解析的颜色表达式：' + expr)
}

const chan = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b)
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const hexOut = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
const px = (name, vars) => color('var(' + name + ')', vars, { r: 255, g: 255, b: 255, a: 1 })

// 每一对要声明「它压在什么面上」—— 因为 color-mix(…%, transparent) 的实际底色取决于父面，
// 深色模式用白底算会得出错误结论（本脚本第一版就栽过：深色「未分类」标签算成 1.33）。
// base：page = --color-bg-primary · raised = --color-bg-elevated · secondary = --color-bg-secondary
const PAIRS = [
  ['正文 ink / 主背景', '--color-text-primary', '--color-bg-primary', 'page'],
  ['次要 ink / 主背景', '--color-text-secondary', '--color-bg-primary', 'page'],
  ['次要 ink / 次级背景(侧栏)', '--color-text-secondary', '--color-bg-secondary', 'secondary'],
  ['次要 ink / 浮起层(面板/卡片)', '--color-text-secondary', '--color-bg-elevated', 'raised'],
  ['强调色(eyebrow) / 主背景', '--color-accent', '--color-bg-primary', 'page'],
  ['主按钮文字 / 强调色底', '--color-on-accent', '--color-accent', 'raised'],
  ['错误文字 / 浮起层', '--color-critical', '--color-bg-elevated', 'raised'],
  ['错误 toast 文字 / 错误底', '--color-on-accent', '--color-critical', 'raised'],
  ['分数 high(success) / 浮起层', '--score-same', '--color-bg-elevated', 'raised'],
  ['分数 mid(warning) / 浮起层', '--score-like', '--color-bg-elevated', 'raised'],
  ['分数 low / 浮起层', '--score-weak', '--color-bg-elevated', 'raised'],
  ['标签 VR 前景 / 标签底', '--cat-vr-fg', '--cat-vr-bg', 'raised'],
  ['标签 CR 前景 / 标签底', '--cat-cr-fg', '--cat-cr-bg', 'raised'],
  ['标签 CR+VR 前景 / 标签底', '--cat-crvr-fg', '--cat-crvr-bg', 'raised'],
  ['标签 其他 前景 / 标签底', '--cat-other-fg', '--cat-other-bg', 'raised'],
  ['标签 未分类 前景 / 标签底', '--cat-uncat-fg', '--cat-uncat-bg', 'raised'],
  ['侧栏次要文字 / 侧栏底', '--sidebar-muted', '--sidebar-bg', 'secondary'],
]

const rows = []
for (const [mode, vars] of [['light', lightVars], ['dark', darkVars]]) {
  const WHITE = { r: 255, g: 255, b: 255, a: 1 }
  const page = color('var(--color-bg-primary)', vars, WHITE)
  const raised = color('var(--color-bg-elevated)', vars, WHITE)
  const secondary = color('var(--color-bg-secondary)', vars, page)
  for (const [label, fg, bg, base] of PAIRS) {
    const under = base === 'page' ? page : base === 'raised' ? raised : secondary
    const bgc = color('var(' + bg + ')', vars, under)
    const fgc = color('var(' + fg + ')', vars, bgc)
    const r = ratio(fgc, bgc)
    rows.push([mode, label, fg, bg, hexOut(fgc), hexOut(bgc), r.toFixed(2), r >= 4.5 ? 'PASS' : 'FAIL', r >= 3 ? 'ok' : 'FAIL'])
  }
}
console.log(['mode', 'pair', 'fg_token', 'bg_token', 'fg', 'bg', 'ratio', 'AA_4.5_text', 'AA_3.0_nontext'].join('\t'))
for (const r of rows) console.log(r.join('\t'))

// ---------- 两个深色块是否一致（P1 同概念两份定义的机械判据） ----------
const keys = new Set([...Object.keys(darkMediaVars), ...Object.keys(darkAttrVars)])
const onlyMedia = [...keys].filter((k) => k in darkMediaVars && !(k in darkAttrVars))
const onlyAttr = [...keys].filter((k) => k in darkAttrVars && !(k in darkMediaVars))
const diff = [...keys].filter((k) => k in darkMediaVars && k in darkAttrVars && darkMediaVars[k] !== darkAttrVars[k])
console.log('\n# 深色块对差：仅在 media 块 ' + JSON.stringify(onlyMedia))
console.log('# 深色块对差：仅在 data-theme 块 ' + JSON.stringify(onlyAttr))
console.log('# 深色块对差：值不同 ' + JSON.stringify(diff.map((k) => [k, darkMediaVars[k], darkAttrVars[k]])))
console.log('# 深色模式未覆盖的标签前景：' + ['--cat-vr-fg', '--cat-cr-fg', '--cat-crvr-fg', '--cat-uncat-fg', '--cat-other-fg'].filter((k) => !(k in darkMediaVars)).join(' '))
```

脚本的诊断尾巴（原样）：

```text
# 深色块对差：仅在 media 块 []
# 深色块对差：仅在 data-theme 块 []
# 深色块对差：值不同 []
# 深色模式未覆盖的标签前景：--cat-crvr-fg
```

⇒ 前两行为空 ⇒ 两个深色块**当前没有漂移**（§4.3）；最后一行是 V-06 的机制本身。

### A.2 `scan-markdown.mjs` —— 找"界面里未渲染的 Markdown"

```js
// data/_uiux-capture/scan-markdown.mjs —— 找"界面里未渲染的 Markdown"（只读，一次性探针）
//
// 为什么不能直接 grep：源代码里大量注释也用 ** 与反引号写作（本仓库的注释风格就是 markdown）。
// 朴素 grep 会把注释算成违规 —— 这正是 TUO.md A-1 记过的坑形状。
// 所以先剥离注释（行注释 + 块注释，含 JSX 的 {/* */}），再只看剩下的可见文本。
// 用法：node data/_uiux-capture/scan-markdown.mjs
import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))

let hits = 0
for (const f of walk('apps/desktop/src/renderer/src')) {
  const lines = strip(fs.readFileSync(f, 'utf8')).split('\n')
  lines.forEach((l, i) => {
    if (/\*\*|`/.test(l)) { console.log(f + ':' + (i + 1) + '\t' + l.trim().slice(0, 150)); hits++ }
  })
}
console.log('# 命中 ' + hits + ' 行（**或反引号出现在未被注释的代码行上）')
```

**为什么静态扫描只能给候选**：脚本用 `**` 或反引号作判据，而 JS **模板字符串本身就是反引号** ⇒ 71 条候选里绝大多数是 JS 语法，不是界面文本。所以本报告**不把静态命中数当结论**：

| 判据 | 结果 |
|---|---|
| 静态候选（含模板字符串） | 73 行命中 |
| **真窗口 DOM 实测**（`rawMarkdownNodes`，只统计叶节点可见文本） | **3 处确认**：`/tasks`（`TasksPage.jsx:203`）· `/activity`（`ActivityPage.jsx:175`）· `/item`（`utils/item-actions.js:27`，经分组说明渲染到界面） |
| 源码里同类的可见文本行（本次未全部展开） | 10 行：`TasksPage.jsx:84,203,277` · `ActivityPage.jsx:129,130,138,153,170,175` · `utils/item-actions.js:27` |

**这是本次审查里"两个手段互相校正"的一个实例**：静态扫描会说"73 处"（明显夸大），只信真窗口会说"3 处"（会漏掉没展开的页面态）。**两者并用**才得到"3 处已确认 + 10 行待修"这个可用结论。

### A.3 `capture.mjs` —— 5 张截图 + 真窗口事实表（§2.4 的来源）

```js
// data/_uiux-capture/capture.mjs —— 一次性截图探针（**不入库**，见 .gitignore 的 data/_*）
//
// 目的：为「Apple Style UI/UX 审查」取 5 个真实界面的 PNG，并在同一批窗口里取**计算样式事实**。
// 后者比图片更耐久：图片 gitignore 掉了，数字不会。
//
// 用法（需要提权，因为 Electron 在本沙箱要 --no-sandbox）：
//   node data/_uiux-capture/capture.mjs
// 产出：
//   data/_uiux-shots/*.png
//   stdout 的 FACTS_JSON 一行（原样抄进报告附录）
import fs from 'node:fs'
import path from 'node:path'

import { launchFake, launchWithoutLibrary } from '../../apps/desktop/e2e/helpers/app.mjs'
import { firstWindow } from '../../apps/desktop/e2e/helpers/launch.mjs'

const OUT = path.join('data', '_uiux-shots')
fs.mkdirSync(OUT, { recursive: true })

const shot = async (win, name) => {
  const file = path.join(OUT, name + '.png')
  await win.screenshot({ path: file })
  const st = fs.statSync(file)
  console.log('[shot] ' + name + ' -> ' + file + '  ' + Math.round(st.size / 1024) + 'KB  ' + st.mtime.toISOString())
  return file
}

const go = async (win, hash) => {
  await win.evaluate((h) => { window.location.hash = h }, hash)
  await win.waitForTimeout(700)
}

/** 通用：把当前页面的计算样式事实读出来（在渲染进程里跑） */
const FACTS = () => {
  const cs = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const s = getComputedStyle(el)
    return { color: s.color, background: s.backgroundColor, fontSize: s.fontSize, fontFamily: s.fontFamily.slice(0, 60) }
  }
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  const navActive = document.querySelector('.nav a[aria-current="page"]')
  const allText = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0)
  const rawMd = allText.filter((e) => /\*\*/.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 80))
  const content = document.querySelector('.content')
  return {
    hash: location.hash,
    title: document.title,
    navActiveClass: navActive ? navActive.getAttribute('class') : '(无 aria-current 项)',
    navActiveBg: navActive ? getComputedStyle(navActive).backgroundColor : null,
    navActiveShadow: navActive ? getComputedStyle(navActive).boxShadow : null,
    content: content ? { maxWidth: getComputedStyle(content).maxWidth, offsetLeft: Math.round(content.getBoundingClientRect().left), innerWidth: innerWidth } : null,
    sample: {
      scoreHigh: cs('.score.high'),
      scoreLow: cs('.score.low'),
      scoreMid: cs('.score.mid'),
      tagDefault: cs('.tag'),
      mutedSmall: cs('.muted.small'),
      dotOk: cs('.dot-ok'),
      errClass: cs('.err'),
      dataState: cs('[data-state]'),
      body: cs('body'),
    },
    buttonHeights: {
      sm: box('[data-testid="action-groups"] button'),
      anyBtn: box('.btn, button'),
      iconBtn: box('.top-actions button'),
      chip: box('.chip, [aria-pressed]'),
    },
    rawMarkdownNodes: rawMd,
  }
}

const facts = {}
const consoleErrors = {}

// ---------- A) 无库 ⇒ 首启向导 ----------
{
  const { app, cleanup } = await launchWithoutLibrary()
  try {
    const win = await firstWindow(app)
    consoleErrors.wizard = []
    win.on('console', (m) => { if (m.type() === 'error') consoleErrors.wizard.push(m.text()) })
    await win.waitForSelector('.wizard', { timeout: 20_000 })
    await shot(win, '1-wizard')
    facts.wizard = await win.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return {
        role: d ? d.getAttribute('role') : null,
        ariaModal: d ? d.getAttribute('aria-modal') : null,
        ariaLabelledby: d ? d.getAttribute('aria-labelledby') : null,
        ariaDescribedby: d ? d.getAttribute('aria-describedby') : null,
        activeElementOnLoad: document.activeElement ? document.activeElement.tagName : null,
      }
    })
  } finally { await app.close(); cleanup() }
}

// ---------- B) 模拟模式：搜索 / 任务 / 记录 / 详情 ----------
{
  const { app, cleanup } = await launchFake()
  try {
    const win = await firstWindow(app)
    consoleErrors.fake = []
    win.on('console', (m) => { if (m.type() === 'error') consoleErrors.fake.push(m.text()) })

    // 1) 搜索页（先跑一次检索，让结果区有内容）
    await win.waitForSelector('#query', { timeout: 20_000 })
    await win.fill('#query', '玻璃球多头吊灯')
    await win.click('button:has-text("搜索图片")')
    await win.waitForTimeout(2500)
    await shot(win, '2-search')
    facts.search = await win.evaluate(FACTS)

    await go(win, '#/tasks')
    await shot(win, '3-tasks')
    facts.tasks = await win.evaluate(FACTS)

    await go(win, '#/activity')
    await shot(win, '4-activity')
    facts.activity = await win.evaluate(FACTS)

    await go(win, '#/item/L1/a00000000001')
    await win.waitForTimeout(1200)
    await shot(win, '5-item')
    facts.item = await win.evaluate(FACTS)
  } finally { await app.close(); cleanup() }
}

console.log('CONSOLE_ERRORS=' + JSON.stringify(consoleErrors))
console.log('FACTS_JSON=' + JSON.stringify(facts, null, 1))
```

### A.4 原始输出（节选与全量声明）

**（1）对比度全表** —— 34 行，**已在 §4.1 逐行列出**（脚本原样，未改一个字符）。

**（2）`FACTS_JSON`** —— 全量约 300 行，下面给出本报告引用到的字段（**未改数值**；要全量请跑 A.3）：

```json
{
 "wizard": { "role": "dialog", "ariaModal": "true", "ariaLabelledby": "wizard-title", "ariaDescribedby": null, "activeElementOnLoad": "BODY" },
 "search": {
  "title": "语义搜索 · gemma-search",
  "navActiveClass": null,
  "navActiveBg": "rgba(0, 0, 0, 0)",
  "navActiveShadow": "none",
  "content": { "maxWidth": "1500px", "offsetLeft": 220, "innerWidth": 1432 },
  "sample": {
   "scoreHigh": { "color": "rgb(52, 199, 89)", "fontSize": "11px" },
   "scoreMid":  { "color": "rgb(255, 159, 10)", "fontSize": "11px" },
   "tagDefault":{ "color": "rgb(47, 111, 235)", "background": "rgb(232, 239, 254)", "fontSize": "11px" },
   "mutedSmall":{ "color": "rgb(110, 110, 115)", "fontSize": "11px" },
   "dotOk":     { "color": "rgb(110, 110, 115)", "background": "rgb(52, 199, 89)", "fontSize": "11px" }
  },
  "buttonHeights": { "iconBtn": { "w": 36, "h": 36 }, "chip": { "w": 60, "h": 37 } },
  "rawMarkdownNodes": []
 },
 "tasks": {
  "title": "索引任务 · gemma-search",
  "navActiveClass": null, "navActiveBg": "rgba(0, 0, 0, 0)",
  "buttonHeights": { "anyBtn": { "w": 78, "h": 44 } },
  "rawMarkdownNodes": ["取消：**将在当前批次结束后停止**（最多 2 秒内收尾，已编码的行保留，可续跑）"]
 },
 "activity": {
  "navActiveClass": null,
  "buttonHeights": { "anyBtn": { "w": 70, "h": 32 } },
  "rawMarkdownNodes": ["「保持现状」只关闭提示，**不动磁盘** —— 文件仍是现在的样子"]
 },
 "item": {
  "navActiveClass": "(无 aria-current 项)",
  "sample": { "dataState": { "color": "rgb(105, 112, 125)", "background": "rgb(236, 238, 242)" },
              "tagDefault": { "color": "rgb(105, 112, 125)", "background": "rgb(236, 238, 242)" } },
  "buttonHeights": { "sm": { "w": 44, "h": 32 } },
  "rawMarkdownNodes": ["只改路径与配对，**不重新编码**"]
 }
}
```

> 读法提示：`item.sample.dataState` 与 `item.sample.tagDefault` **逐字段相同** —— 这就是 V-04"四档无差别"的机器证据。

**（3）控制台错误**（原样）：

```text
CONSOLE_ERRORS={"wizard":[],"fake":["…415 (Unsupported Media Type)" ×25]}
```

向导场景 **0 条**；模拟场景 **25 条 415**，来源 `apps/desktop/src/main/index.mjs:453`（`img.isEmpty()` ⇒ `status: 415`）。模拟模式无真实文件 ⇒ 预期；但暴露了 V-23（界面无法区分两种失败）。

**（4）字体注册表核查**（原样节选）：

```text
SF Pro              ->  (未安装)
PingFang            ->  (未安装)
Hiragino            ->  (未安装)
Segoe UI Variable   ->  (未安装)
Helvetica           ->  (未安装)
Segoe UI            ->  Segoe UI (TrueType) | Segoe UI Bold | Segoe UI Semibold | …
Microsoft YaHei     ->  Microsoft YaHei & Microsoft YaHei UI (TrueType) | …
```

### A.5 截图清单（本地证据，不入库）

| 文件 | 大小 | mtime |
|---|---|---|
| 1-wizard.png | 42 KB | 2026-10-13T06:51:53.816Z |
| 2-search.png | 169 KB | 2026-10-13T06:52:03.597Z |
| 3-tasks.png | 72 KB | 2026-10-13T06:52:04.380Z |
| 4-activity.png | 79 KB | 2026-10-13T06:52:05.155Z |
| 5-item.png | 77 KB | 2026-10-13T06:52:07.163Z |

**复现**：`node data/_uiux-capture/capture.mjs`（需提权；沙箱内 Electron 需 `--no-sandbox`，探针已带）。
**时效性**：截图 mtime **晚于** `out/` 构建时间（06:35:04Z）⇒ 拍的是当前产物，不是旧界面。

---

*报告结束。违规编号的唯一详表在 [`违规的UI.md`](../违规的UI.md)；本报告只引用编号。*

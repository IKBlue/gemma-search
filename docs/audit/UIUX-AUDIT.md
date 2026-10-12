# UIUX-AUDIT · 宪章②「UI/UX 检查（Apple Style），对标行业最佳实践」

- 审查人：`uiux-auditor`（任务 `task-2`）
- 共同事实基准：`docs/audit/00-current-state.md`（下称**基线**）
- 判据：`docs/audit/01-acceptance-criteria.md`（下称**判据**），按 §2 G1-G7、§3 严重度、§5 U1-U10
- 仓库 HEAD：`4555c1b`；渲染层相关最后一次提交：`dcfec17`（2026-10-10 17:38:19）
- 证据附录：`docs/audit/uiux-evidence.md`（原始命令输出、脚本、逐项数值表）
- **独立复核**：`docs/audit/REVIEW-UIUX-AUDIT.md`（`review-2`，任务 `task-4`）→ `verdict: pass-with-issues`，4 条 blocker + 5 条 minor，**无一条实质性结论被推翻**；本报告的逐条处置记录见 **§16**

---

## 1. 审查范围（先分清审的是哪一层）

本仓库存在**三个不同的「界面」**，混在一起说就会得出错误结论。本报告对每条结论都标明属于哪一层：

| 层 | 对象 | 路径 | 是否随应用发布 | 本报告代号 |
|---|---|---|---|---|
| **A. 已实现** | 1 页 React 界面（对应原型「语义搜索」）+ `renderer.css` + `tokens.css` | `src/renderer/src/`（22 个 `.jsx` + 3 个 `.js` + 1 个 `.css`）、`static/prototype/tokens.css` | ✅ 是 | **【实现】** |
| **B. 原型** | 6 个原型 HTML + 总览页 + 共享 CSS/JS | `static/prototype/` | ❌ 否（原型 README 自称"设计验证文件，不是正式应用"） | **【原型】** |
| **C. 文档** | 令牌/设计/评审三份文档 | `docs/design/*.md` | — | **【文档】** |

**关键前提（引基线 §1）**：项目实际处于 **P3 的第 1/4 步**，只完成 1 页（`App.jsx:6-8` 只渲染 `<SearchPage />`），侧栏 7 项里 6 项 `disabled`。
因此本报告：
- 对 **A** 做**逐项实测 + 打分**（U2-U5、U7、U9 的主战场）；
- 对 **B** 只做**设计资产审查**（U6 的对照面、U9 的原型评级），**不假装它已实现**；
- 对**未建成部分**只判定「规格是否偏离最佳实践」，不当作缺陷计分（遵循基线 §1 结尾的纪律）。

### 1.1 真实渲染证据：只有 1 张截图对得上当前代码

| 截图 | mtime | 是否对应 HEAD 的渲染层 | 判据 |
|---|---|---|---|
| `reports/G-D-p2-electron/ui-final.png` | 2026-10-10 **17:35:57** | ✅ **是** | 构建产物 `out/` 写于 17:35:44，`dcfec17` 提交于 17:38:19，`git diff` 对 `renderer.css`/`tokens.css` 为空 → 该图是**被提交的那一版构建**的自截图 |
| `ui-tokens.png` | 17:32:53 | ❌ 否 | 早于最终构建 |
| `ui-prototype.png` | 17:30:11 | ❌ 否 | 早于最终构建；且其"全部"胶囊是**蓝描边**（旧样式），而 HEAD `renderer.css:172` 是**深色实心** |
| `ui-components.png` | 17:19:50 | ❌ 否 | 同上；该图截的是**原型 HTML**（`static/prototype/语义搜索.html`），不是应用窗口 |
| `electron-window.png` | 16:47:09 | ❌ 否 | 截的是**迁移前的 P2 骨架界面**（左栏是"分类筛选"复选框组 + "文字/以图搜图"分段控件），与当前 UI 完全不同 |

> `ui-final.png` 是 `webContents.capturePage` 应用自截（`reports/G-D-p2-electron/README.md:160`），不受窗口遮挡影响。本报告凡引用"界面上实际长什么样"，只引用这一张，并在 `docs/audit/uiux-evidence.md` §7 列出它与 HEAD 代码的逐项交叉核对。

### 1.2 必答问题（判据 §5）索引

| 必答 | 问题 | 本报告章节 |
|---|---|---|
| U1 | 对标基准指名到具体文档与条目 | **§3** |
| U2 | 令牌体系是否自洽；与 Apple 官方数值逐项对差 | **§4.1-§4.5** |
| U3 | 颜色是否与 Apple 实际值一致；深色模式是否缺失 | **§4.1** + **§4.6** |
| U4 | `-apple-system` 在 Windows 落到什么；怎么补 | **§6**（问题定性见 §5 U-06） |
| U5 | 键盘可达 / 焦点 / `aria-*` / 空态错误态载入态 / 触达尺寸 / 语义化标签 | **§7** |
| U6 | 实现（1 页 + 10 个组件）与原型（6 页）的差距清单 | **§8** |
| U7 | 动效与反馈；`prefers-reduced-motion` 是否处理 | **§10** |
| U8 | 与 `UI-REVIEW-and-migration.md` 的偏差方向判定 | **§9** |
| U9 | 逐页 Apple 风格符合度评级（禁主观形容词） | **§11** |
| U10 | 按严重度排序的可执行改进清单（改哪个文件 + 怎么验） | **§12** |
| — | 20 条具体问题的完整证据与 Score | **§5** |
| — | 未覆盖 / 无法验证（G6） | **§13** |
| — | G1-G7 自检表 | **§14** |

> 阅读顺序提示：§9 是 U8、§10 是 U7，按问题编号会看到相邻两节顺序互换（因为 §9 需要先讲文档偏差、§10 才好接动效现状）。

---

## 2. 总体结论

1. **令牌体系（tokens.css）本身是这个项目做得最好的一块**：单一来源、`color-mix()` 派生、渲染层零颜色字面量（守卫实测 23 个文件全 `[OK]`）、`prefers-reduced-motion` 双处兜底、`:focus-visible` 统一 —— 这些不是空话，都有 `tools/verify_renderer_styles.mjs` 的通过输出为证。
2. **但令牌的"着色"是 apple.com 的网页调色板，不是 Apple HIG 的系统色**。逐项对差后：`--color-success` 与 HIG **完全一致**，`--color-critical` **近似**，`--color-warning` 与 `--color-accent` 与 HIG **不一致**（详见 §4）。
3. **实现层有 1 条 Critical、5 条 High**。最严重的一条与"Apple 风格"无关，而是**信息正确性**：相关度档位阈值在仓库里存在**四套互不相同的定义**，且当前代码选的那一套会把**每一次文本检索的全部结果**标成「较弱」（有截图实证，见 §5 / U-01）。
4. **可访问性是这个实现最薄弱的一维**：全仓 `aria-pressed`/`aria-current`/`aria-selected`/`tabIndex` **实测 0 处**；键盘交互两份文档并集要求 **9 项**（UI-REVIEW 5 项 / DESIGN-app-details 7 项 + 拖放·粘贴 2 条）、实现 1 项；8 处文字对比度低于 WCAG 2.2 SC 1.4.3 的 4.5:1。判据 §3 的强制项「文档说做了、代码没做 → 至少 Medium；影响可执行操作路径 → High」直接命中三处。
5. **字体维度在唯一目标平台（Windows）上，"Apple 字体"一个都没用上**。实测本机未安装 SF Pro / PingFang / Hiragino / Helvetica / Segoe UI Variable，`--font-sans` 的前 **6** 个候选全部落空，实际落点是 **Segoe UI（西文）+ Microsoft YaHei（中文）**。这不是"不够 Apple"的形容词判断，是可测量的字体解析结果（§6 / U-06）。
6. **U8 的答案是两个方向同时成立**：`UI-REVIEW-and-migration.md` 既有**已过期的事实陈述**（§8.1 引用的守卫 `tools/verify_tokens.py` 已随 Python 退役删除；§8.2 说"三页原型的侧栏也是 `#171923`"—— 全仓 grep 不到 `#171923`），也**被实现在两个方向上同时偏离**（该文档 §5/§9 要求"固定深色侧栏 + 不做双主题"，实现给出浅色侧栏 + 完整双主题）。逐条见 §9。

---

## 3. U1 · 对标基准声明（指名到章节 + URL）

### 3.1 选的基准

| # | 基准 | 具体条目 | URL（本轮 `web_fetch` 实测 HTTP 200） | 为什么选它 |
|---|---|---|---|---|
| B1 | Apple HIG · **Layout** | 布局层级、留白、命中目标 | https://developer.apple.com/design/human-interface-guidelines/layout | 判据 U2 要求对齐"8pt 栅格 / 触控目标"；HIG Layout 是 Apple 对"元素该多大、留多少空"的唯一权威条目 |
| B2 | Apple HIG · **Typography** | 内置文本样式（built-in text styles）、字重、tracking | https://developer.apple.com/design/human-interface-guidelines/typography | 判据 U2 要求对差"SF 官方字号阶梯"；HIG Typography 是字号/字重/tracking 的出处 |
| B3 | Apple HIG · **Color** | Best practices / Inclusive color / System colors（含官方 RGB 规格表） | https://developer.apple.com/design/human-interface-guidelines/color | 判据 U3 要求逐项核对 `#f5f5f7`/`#0071e3` **是否为 Apple 实际值**；该页的 Specifications 表给出 light/dark/increased-contrast 三套官方 RGB |
| B4 | Apple HIG · **Materials** | Liquid Glass / Standard materials / 可读性 | https://developer.apple.com/design/human-interface-guidelines/materials | 实现里有 `backdrop-filter` 毛玻璃顶栏，只有一个章节能判定它用得对不对 |
| B5 | Apple HIG · **Motion** | 动效与 reduced-motion | https://developer.apple.com/design/human-interface-guidelines/motion | 判据 U7 直接问 `prefers-reduced-motion` |
| B6 | Apple HIG · **Accessibility** | 焦点、可感知性、辅助技术 | https://developer.apple.com/design/human-interface-guidelines/accessibility | 判据 U5 的键盘/焦点/aria 全部落在这里 |
| B7 | W3C **WCAG 2.2 SC 1.4.3** Contrast (Minimum), AA | 正文 4.5:1 / 大字 3:1；并含 CJK 字号等价说明 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | HIG 不给对比度数值；对比度只能引 WCAG。该页明确 "18pt / 14pt bold" ≈ **24px / 18.5px**，并单列 **CJK 字体的等价尺寸**，正好用于 11px 中文标签的判定 |
| B8 | W3C **WCAG 2.2 SC 2.5.5** Target Size (Enhanced), AAA | 44×44 CSS px | https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html | 项目自定 `--touch-min: 44px`，需要一个可引用的出处来判定它被违反 |
| B9 | W3C **WCAG 2.2 SC 2.5.8** Target Size (Minimum), AA | 24×24 CSS px（或 24px 间距例外） | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | 用来判定 32px/36px 控件**是否已达最低线**（结论：已达 AA，未达 AAA 与项目自定值） |

**HIG 原文的取用方式（诚实声明）**：Apple 的 HIG 页面是 JS 渲染的 SPA，`web_fetch` 对 B1-B6 **只返回了标题**（已用 HTTP 200 与标题确认页面存在）。因此：
- **规范性语句**（如 "Avoid hard-coding system color values in your app."）取自由第三方镜像 `raintree-technology/hig-doctor` 的 `hig-foundations/references/color.md`、`materials.md`，该文件头部自带 `source: https://developer.apple.com/design/human-interface-guidelines/...` attribution；
- **数值**（系统色 RGB、字号）取自 B3 镜像里的官方规格表；
- 凡镜像给不出数值的条目（如 HIG Layout 的具体 pt 数），**本报告不编数值**，只引 URL 并把判定挂在 WCAG 上。

### 3.2 为什么不能只写"Apple 风格"

**【文档】**`DESIGN-tokens.md:4` 自己就承认：「风格参照 Apple 的界面语言，**不是 Apple 官方规范**」。所以本报告的任务不是"指责它不像 Apple"，而是把这句话拆成可核对的项：
- 哪些值**确实等于** Apple 官方值 → 判「一致」；
- 哪些值是 **apple.com 网页调色板**（另一套公开的 Apple 配色）→ 判「近似（来源不同）」；
- 哪些值与任何 Apple 来源都对不上 → 判「不一致」。

---

## 4. U2 / U3 · 设计令牌逐项对差

### 4.1 颜色（U3 主体）

Apple HIG Color 官方规格表（light / dark / increased-contrast 四列）本轮已取到，逐项对差：

| 令牌 | 仓库值（浅 / 深） | **Apple HIG 官方值** | 判定 | 依据 |
|---|---|---|---|---|
| `--color-success` | `#34c759` / `#30d158` | Green: light **#34C759** / dark **#30D158** | ✅ **完全一致** | HIG Color Specifications |
| `--color-critical` | `#ff3b30` / `#ff453a` | Red: light **#FF383C** / dark **#FF4245** | 🟡 **近似**（Δ≈3-5/通道），是 iOS 旧版 `systemRed` 值 | 同上 |
| `--color-warning` | `#ff9f0a` / `#ff9f0a`（**深浅同值**） | Orange: light **#FF8D28** / dark **#FF9230** | ❌ **不一致**：仓库用的是 iOS 旧版 orange **dark** 值，并把它同时当作浅色值；深色档又与官方 dark 不符 | 同上 |
| `--color-accent` | `#0071e3` / `#2997ff` | Blue: light **#0088FF** / dark **#0091FF** | ❌ **不一致**：`#0071e3`/`#2997ff` 是 **apple.com 的按钮蓝/暗色链接蓝**，不是 HIG 的 `systemBlue` | 同上 |
| `--color-bg-secondary` | `#f5f5f7` | iOS `systemGray6` light = **#F2F2F7**；macOS 侧无此名 | 🟡 **近似**：`#f5f5f7` 是 apple.com 的分区底色 | 同上 |
| `--color-text-primary` | `#1d1d1f` | HIG 走语义色 `labelColor`（AppKit）/ `label`（UIKit），不给固定 RGB | 🟡 **近似**：`#1d1d1f` 是 apple.com 正文色 | HIG Color 平台表 |
| `--color-text-secondary` | `#6e6e73` | 对应 `secondaryLabelColor`（无固定 RGB） | 🟡 **近似**：apple.com 次要文字色 | 同上 |
| `--color-separator` | `#d2d2d7` | 对应 `separatorColor` / `opaqueSeparator`（无固定 RGB，官方注明数值会随版本浮动） | 🟡 **近似** | 同上 |
| `--color-bg-primary`（深） | `#000000` | 深色系统背景为纯黑 | ✅ 一致 | 同上 |

**逐项核对结论**：13 个颜色令牌里 **2 个完全一致（success 的明暗两档）、1 个近似到个位差（critical）、4 个近似但来源是 apple.com、2 个明确不一致（warning/accent）**，其余为语义色无法逐位比对。

**【文档 vs 代码】`DESIGN-tokens.md:49` 自己写「`text.secondary` 在白底约 4.9:1，`accent` 在白底约 4.7:1，均满足正文 4.5:1」—— 这两条我复算后成立（5.07:1 / 4.70:1，见附录 §3）。但同一张表的 `success #34c759`、`warning #ff9f0a` 也**被当作正文色使用**（分数徽标、状态注释），它们只有 2.22:1 / 2.06:1。`DESIGN-tokens.md:159` 还明写「浅色、深色两套都要过一遍对比度，不要只检查浅色」—— 这条自定纪律**没有执行**，见 U-03。**

**【文档 vs 代码】`UI-REVIEW-and-migration.md:271`** 声称原型套件的写死颜色已从「72 种 / 112 处」收敛到「**0 处**」，并称守卫是 `tools/verify_tokens.py`。实测：`#858aff`（靛蓝）**仍是 4 个原型页的进度条填充色**，`#8b91ff`（靛蓝系）仍是状态圆点色；7 个原型 HTML 里合计 **21 处**颜色字面量（**去重后 6 个不同值**：`#c4c7d0`×7 / `#8b91ff`×5 / `#858aff`×4 / `#a56a12`×2 / `#454b58`×2 / `#8b91a0`×1）；而 `tools/verify_tokens.py` **不存在**（`tools/` 实测 7 个 `.mjs`，无 `.py`）。见 U-13。

### 4.2 字号阶梯（`--type-*` 全部）

**【实现】**字号令牌在 `tokens.css:103-116`，共 8 档。

**HIG 侧的数值出处（B1 修正：本轮已补齐）**：下表的 Apple pt 值全部来自 **Apple HIG · Typography** 的 `Specifications` 章节，本轮经镜像全文取到并逐格核对：
- 规范页：https://developer.apple.com/design/human-interface-guidelines/typography （`web_fetch` → HTTP 200，但正文为 SPA，只返回标题）
- 镜像（含完整规格表）：`hig-doctor` 的 `skills/hig-foundations/references/typography.md`，经 `https://cdn.jsdelivr.net/gh/raintree-technology/hig-doctor@ea8e93e0cc3a877cf90d49d8f6fc55991ed29701/skills/hig-foundations/references/typography.md` 取全文（HTTP 200，头部带 `source:` attribution）
- 具体用到两张表：**`macOS built-in text styles`**（Large Title 26 / Title 1 22 / Title 2 17 / Title 3 15 / Headline 13 / **Body 13** / **Callout 12** / Subheadline 11 / Footnote 10 / Caption 1 10 / Caption 2 10）与 **`Ensuring legibility`** 的平台默认/最小字号表（**iOS 默认 17pt / 最小 11pt；macOS 默认 13pt / 最小 10pt**）。
- 其中 iOS 的 Body / Callout 值取自该镜像的 **`iOS, iPadOS Dynamic Type sizes` → `Large (default)`** 表（Body 17 / Callout 16）。

| 令牌 | 值 | 有无 Apple 阶梯依据（均据上表） | 判定 |
|---|---|---|---|
| `--type-h1: 27px` | 27px / `-0.02em` | macOS `Large Title` = **26pt** | 🟡 近似（`tokens.css:103` 自己标注"文档阶梯无此档，取自原型并登记"） |
| `--type-title2: 24px` | 24px | macOS 文本样式里无 24 这一档（最近的 Title 2 = 17） | ⚪ 阶梯外（文档自认） |
| `--type-metric: 23px` | 23px | 无 | ⚪ 阶梯外（文档自认） |
| `--type-lede: 19px` | 19px | 无 | ⚪ 阶梯外 |
| `--type-body-app: 16px` | 16px | macOS Body = **13pt**；iOS Body = **17pt** | ⚪ 阶梯外 |
| `--type-callout: 14px` | 14px | macOS Callout = **12pt**；iOS Callout = **16pt** | ⚪ 阶梯外 |
| `--type-caption: 13px` | 13px | macOS **Body = 13pt**，也是 macOS 的**默认字号** | 🟡 与 macOS Body 数值相同 |
| `--type-micro: 11px` | 11px | macOS Subheadline = **11pt**；同时等于 iOS 的**最小字号** 11pt | 🟡 近似 |

**结论**：这套阶梯的正确基准**不是** HIG 的文本样式表，而是 **apple.com 的网页字号体系**（display/title/lede/body 是网页营销页的语言）。
- 优点：阶梯**内部自洽**，字重只用 400/500/600/700（`DESIGN-tokens.md:80`），负字距只给大标题（`DESIGN-tokens.md:80`、`renderer.css:138`）——这两条**符合** HIG Typography "Minimize the number of typefaces" 与 "Adjust font weight, size, and color as needed to emphasize" 的取向。
- 缺口：**阶梯最小档 11px（`--type-micro`）在 `renderer.css` 里被用了 9 次**（实测 `grep -c`）：`.small`(:28)、`.brand-sub`(:64)、`.nav-label`(:67)、`.side-note`(:91)、`.eyebrow`(:137)、`.metric-top`(:224)、`.metric-note`(:233)、`.card-meta`(:257)、`.tag`(:262)。而 WCAG 1.4.3 对 11px **中文**文本按正文要求 4.5:1（该条明确 CJK 等价尺寸）——阶梯压得越低，色彩容错越小。见 U-03。

### 4.3 间距 vs 4pt 栅格（`--space-*` 全部）

**【实现】**`tokens.css:42-44` 定义 11 档：4/8/12/16/20/24/32/48/64/72/96，**全部是 4 的倍数** ✅。

`renderer.css` 全文 310 行的裸 px 统计（附录 §2）：守卫报告「29 处裸 px，2 处不在阶梯上」。**但守卫的"阶梯"是被放宽的白名单**（`tools/verify_renderer_styles.mjs:104` 的 `SCALE` 含 `6, 28, 36, 40, 1500`），并非 §4.1 的 4pt 阶梯。按严格"4 的倍数"复算，另有两处阶梯外值：
- `renderer.css:104` `.progress { height: 6px }`
- `renderer.css:259` `.tag { padding: 2px var(--space-2) }` 的纵向 `2px`

其余裸 px（`36px` logo、`28px` metric-icon、`32px` 卡片按钮、`1px` 描边）都在 4 的倍数上，属合规。**判定：间距阶梯本身合规，守卫的 ④ 结论表述过宽**（见 U-17）。

### 4.4 圆角 / 阴影 / 材质

- 圆角 6 档（`tokens.css:47-48`：8/10/12/16/24/999px + `50%`）。`DESIGN-tokens.md:125` 的规则「容器圆角大于其内部元素」在实现里可核对：卡片 `--radius-xl:16px` > 内部 `.btn` `--radius-sm:8px` ✅。
- 阴影：`DESIGN-tokens.md:135`「没有其他阴影」。实现里 `renderer.css` **只用了一个阴影** `--shadow-float`，且仅用于 `.toast`（`renderer.css:288`）——**符合**"少用阴影"的原则。卡片一律 1px 描边（`renderer.css:203/219/239`），对应 `shadow.outline` ✅。
- 材质：顶栏 `backdrop-filter: saturate(180%) blur(20px)` + `--color-glass`（`renderer.css:112-113`），只有顶栏一处 ✅ 符合 HIG Materials「Use materials and effects sparingly」。
  ⚠️ 但 HIG 同章还要求「Help ensure legibility by using vibrant colors on top of materials」。实现里顶栏内容是**普通文字 + 描边按钮**，不是 vibrant 前景；内容滚动到顶栏下方时的实际对比度**本轮未实测**，标为 U-19（Low，诚实挂账）。

### 4.5 触控目标：`--touch-min: 44px` 到底用没用？

判据明确要求"去 CSS 里查，不要只看定义了"。**实测结果：用了，3 处**（其中 **2 处**是直接 `var(--touch-min)`，**第 3 处**是间接经 `--control-search-height`；`grep` 输出见附录 §1.1）：

| 使用处 | 行 | 结果 |
|---|---|---|
| `.nav a { min-height: var(--touch-min) }` | `renderer.css:76` | 44px ✅ |
| `.btn { min-height: var(--touch-min) }` | `renderer.css:152` | 44px ✅ |
| `.search-box input { height: var(--control-search-height) }`，而 `--control-search-height: var(--touch-min)` | `renderer.css:194` + `tokens.css:127` | 44px ✅ |

**但同时有 3 类可点击元素明确低于 44px**，且都有代码依据：

| 控件 | 实际高度 | 行 |
|---|---|---|
| `.icon-btn`（顶栏 ↻ / ?） | 36×36 | `renderer.css:124` ← `--control-icon-btn: 36px`（`tokens.css:126`） |
| `.chip`（6 个分类胶囊） | `min-height: 32px` | `renderer.css:168` |
| `.card-acts .btn`（结果卡「定位 / 取件」） | `min-height: 32px`（覆盖了 `.btn` 的 44px） | `renderer.css:158` |

判定：三者在 WCAG 2.2 **SC 2.5.8（AA，24×24）下通过**，在 **SC 2.5.5（AAA，44×44）下不通过**，并且**违反项目自定规则** `DESIGN-tokens.md:141`「`control.touch.min` 44px（**所有可点击元素**的最小高度）」。见 U-09。

### 4.6 U3 的直接问题：深色模式是否缺失？

**答案：不缺失，但三处未覆盖 + 一处平台层固定浅色。**

`tokens.css:154-196` 完整实现了深色：`@media (prefers-color-scheme: dark)` 与 `:root[data-theme="dark"]` 两条路径，覆盖 20 个令牌。逐项查漏后发现：

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| 1 | `--cat-crvr-fg: #1a7f37` **没有深色档** | `tokens.css:76` 定义，`tokens.css:169-173` 的深色覆盖列表里**没有它** | 「CR+VR」标签在深色下是 **#1a7f37 叠在 #203627 上 = 2.55:1**，远低于 4.5:1（附录 §3 实测） |
| 2 | `html` 未声明 `color-scheme` | `renderer.css` 全文无 `color-scheme`；`src/renderer/index.html` 无 | 深色系统下 Chromium 仍渲染**浅色原生滚动条/原生控件**。`ui-final.png` 右缘可见常驻浅灰滚动条；`renderer.css` 全文无 `::-webkit-scrollbar` 规则 |
| 3 | Electron 窗口底色**硬编码浅色** | `src/main/index.mjs:290` `backgroundColor: '#f5f5f7'` | 深色系统下窗口底色与内容不一致；且这行**直接违反 HIG Color 的「Avoid hard-coding system color values in your app」** |

因此 U3 的答案不是"缺失"，而是"**存在但未过一遍**"——正对应 `DESIGN-tokens.md:159` 那句自己定的纪律。见 U-07。

---

## 5. 实现层问题清单（U-01 ~ U-20，含严重度复算）

> 严重度按判据 §3：`Score = 影响面(1-3) × 触发可能性(1-3)`，9→Critical / 6→High / 4→Medium / 1-3→Low。
> 每条都给出「改哪个文件 + 怎么验」（G5）。

### U-01 · 渲染层违反 `CONTRACT-engine-v1.md:107` 自己算阈值，并完全丢弃引擎已算好的 `band`；后果是每次文本检索的全部结果都被标成「较弱」
- **Score = 3 × 3 = 9 → Critical**
- 类别：**【文档声称】**（书面契约）被 **【代码事实】**违反 + **【代码事实】**引擎产出被丢弃
- **定性（本轮修正）**：这不是「四套阈值谁对谁错」的**选型**问题，而是**契约违反**：契约明文禁止界面自己算阈值，而 `Score.jsx` 自己算了；同时**引擎已经把答案算好并返回了 `band`，界面从未读取**。

**证据 1 · 书面契约（禁止界面自算）**

| 出处 | 原文 |
|---|---|
| `docs/spec/CONTRACT-engine-v1.md:107` | `` "band": "high" \| "mid" \| "low",       // 分数区间由共享常量定义，界面不自己算阈值 `` |
| `docs/spec/CONTRACT-engine-v1.md:114` | 「…界面**不得**把"文本查询的 0.78"与"图像查询的 0.90"排序比较。`band` 由引擎按**同一模态内**的区间给出。」 |
| `core/engine.mjs:18-20`（引擎自己的注释） | 「契约 §2.1 明确：分数不可跨模态比大小，所以**界面只能用引擎给的 band**，不许自己拿"文本 0.78"和"图像 0.90"排序。」 |

**证据 2 · 引擎照做了**

| 出处 | 内容 |
|---|---|
| `core/engine.mjs:25-28` | `export const BANDS = Object.freeze({ text: { high: 0.72, mid: 0.65 }, image: { high: 0.90, mid: 0.80 } })` |
| `core/engine.mjs:30-35` | `bandOf(score, mode)` → `'high' \| 'mid' \| 'low'`（按模态分流） |
| `core/engine.mjs:227` | `band: bandOf(r.score, mode)` —— **每个 search 结果都带了 `band`** |

**证据 3 · 界面无视它，自己算了一套不相交的档位**

| 来源 | 阈值 / 取值域 | 档位文案 |
|---|---|---|
| `src/renderer/src/ui/Score.jsx:2-7`（**当前代码**） | `≥0.97` same / `≥0.93` like / else weak；源码里 **`item.band` 0 命中** | 同款区间 / 很接近 / 较弱 |
| `core/engine.mjs:25-35` + 契约 `:107`（**被丢弃的正确来源**） | text `≥0.72` high / `≥0.65` mid；image `≥0.90` high / `≥0.80` mid | high / mid / low |
| `tools/verify_renderer_dom.mjs:78,80,83`（守卫 fixture，**为此准备**） | `0.9312`=`high` / `0.81`=`mid` / `0.5`=`low` | high / mid / low |
| `static/_archive/app-ui-mockup.html:592-603`（按 `mode` 分流的旧函数） | text `≥0.78` 很接近 / `≥0.74` 同类 / `≥0.65` 较弱；image `≥0.88` 同款区间 / `≥0.84` 接近 | 多档 |
| `docs/design/UI-REVIEW-and-migration.md:38` + `static/prototype/index.html:124` | 图→图 **≥0.88** 为同款；文本→图 **0.74~0.80** | 同款区间 / 同类区间 |

- 另：`Score.jsx` 用的 `0.97` 与 **`docs/spec/SPEC-acceptance.md:71`** 的 `0.97` 是**同一个数字但完全不同的概念**：后者是"ONNX 向量与 torch 向量的逐条余弦等价性**观察线**"（内部质量门），被误搬成了面向用户的相关度档位。
- **节位并存**：`static/prototype/tokens.css:81` 的注释登记的是「同款 / 很接近 / 较弱」（`Score.jsx` 的用词），而 `docs/design/DESIGN-app-details.md:66` 写的是「同款区间/同类区间/较弱」。
- **用户实际会看到什么**：`reports/G-D-p2-electron/ui-final.png`（对应当前代码）里，一次文本检索「玻璃球多头吊灯」返回的 4 张卡分别是 `0.8147 / 0.7985 / 0.7975 / 0.7943`，**全部显示「较弱 · 12 MB / 79 MB / 1.9 MB / 13 MB」**。按引擎自己的 `text.high = 0.72`，这 4 条**全部应判 `high`**；也就是说：**用户每一次文本检索都会被系统性地告知"所有结果都很弱"，包括真正最匹配的那张**，而分数是 `DESIGN-app-details.md:66` 认定的"唯一诚实的信号"。界面不报错、分数照显示，所以**用户无从察觉这是错的** —— 正合判据 §3 对 Critical 的定义。
- 改哪里（**方向修正**）：`src/renderer/src/ui/Score.jsx` —— **删除 `bandOf()` 与 `0.97/0.93` 两个数字**，改为消费 `item.band`：`{ high:'同款区间', mid:'很接近', low:'较弱' }` 的**文案映射表**（不含任何数值比较）；`PhotoCard.jsx:38` 把 `item.band` 一路传下去；阈值只留在引擎侧 `core/engine.mjs:25-28` 的 `BANDS` 共享常量里。**改完后 `src/renderer/src/` 下不得再出现任何相关度阈值的数值字面量。**
- 怎么验：① `tools/verify_renderer_dom.mjs` 加断言「**`score=0.80` 且 `band='high'` 时，渲染文本必须含 `high` 对应的文案且不得含『较弱』**」（现有 fixture `:78` 的 `score:0.9312, band:'high'` 正是为此准备）；② 加一条**静态**断言「`src/renderer/src/ui/Score.jsx` 源码内不出现 `0.9`/`0.8`/`0.7` 形式的阈值比较」；③ `grep -rn "item.band\|\.band" src/renderer/src` 必须 ≥1 命中；④ 重跑 `GS_CAPTURE` 截图，肉眼确认 0.79~0.81 显示「同款区间」而非「较弱」。

### U-02 · 键盘交互：UI-REVIEW 要求 5 项 / DESIGN-app-details 要求 7 项 + 2 条，实现 1 项
- **Score = 2 × 3 = 6 → High**（未取 3×3：键盘用户仍可 Tab+Enter 激活原生按钮，故非硬阻断）
- 类别：**【文档声称】** vs **【代码事实】**
- 证据（计数口径统一，B-minor m1 更正）：
  - `docs/design/UI-REVIEW-and-migration.md:211` 列 **5 项**：「`↑↓←→` 选 · `Enter` 定位 · `Ctrl+C` 复制包路径 · `Esc` 清空 · `空格` 预览」；
  - `docs/design/DESIGN-app-details.md:75-83` 的表格是 **7 行**：`Enter`、`↑↓←→`、`Enter`(网格内定位)、`Ctrl+C`、**`Ctrl+Shift+C`（取件，`:81`，在本表内、非"另加"）**、`Space`、`Esc`；`:85-86` **另有 2 条**：整窗拖放、`Ctrl+V` 粘贴。
  两份文档的并集即下表 7 行 + 2 条。
  全仓 grep `onKeyDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape|ctrlKey|metaKey`（附录 §1）**只命中 3 行**：`SearchPanel.jsx:26`（Enter 提交）、`SearchBox.jsx:6,17`（转发 onKeyDown）。
  即下表 **9 项全缺**，其中 Enter 只覆盖了「提交搜索」，未覆盖「网格内定位」：

| 文档要求 | 实现 |
|---|---|
| `↑↓←→` 在网格中移动选中项 | ❌ |
| `Enter`（输入框）执行搜索 | ✅ `SearchPanel.jsx:26` |
| `Enter`（网格内）定位该条 | ❌ |
| `Ctrl+C` 复制包路径 | ❌ |
| `Ctrl+Shift+C` 取件 | ❌ |
| `Space` 大图预览 | ❌ |
| `Esc` 清空 / 关闭 | ❌ |
| 整窗拖放 → 以图搜图 | ❌ |
| `Ctrl+V` 粘图 → 以图搜图 | ❌ |

  `onLocate` 当前只由卡片上的「定位」按钮触发（`PhotoCard.jsx:30`）。
- 改哪里：`src/renderer/src/search/Gallery.jsx`（加 `role="grid"` + 一个 roving tabindex）、`src/renderer/src/pages/SearchPage.jsx`（挂全局 keydown：Esc→`search.clear`、Ctrl+V→paste 事件）、`src/renderer/src/search/PhotoCard.jsx`（Enter→onLocate）。
- 怎么验：`tools/verify_renderer_dom.mjs` 加 4 条 jsdom 断言：`keydown ArrowRight` 后焦点容器 `data-cursor` 递增；`Escape` 后 `#gallery` 消失并回到引导块；卡片聚焦后 `Enter` 触发 `reveal`；`Ctrl+C` 触发 `clipboard.writeText(包路径)`。

### U-03 · 8 处文字对比度低于 WCAG 2.2 SC 1.4.3 的 4.5:1
- **Score = 3 × 2 = 6 → High**（影响面 3：含主信号分数徽标；触发 2：浅色模式是默认，深色档另计）
- 类别：**【代码事实】**（数值由我用 WCAG 官方公式复算，见附录 §3）
- 证据（全部 < 4.5:1，且字号 11px = 正文级）：

| 元素 | 前景 / 背景 | 实测 | 涉及行 |
|---|---|---|---|
| `.score.like`（「很接近」） | `#ff9f0a` / `#ffffff` | **2.06:1** | `renderer.css:269` ← `tokens.css:83` |
| `.score.same`（「同款区间」） | `#34c759` / `#ffffff` | **2.22:1** | `renderer.css:268` ← `tokens.css:82` |
| `.metric-note.good`（「100% · 可参与语义检索」，**截图里是绿的**） | `#34c759` / `#ffffff` | **2.22:1** | `renderer.css:234` |
| `.tag.VR` | `#2f6feb` / `#e8effe` | **3.96:1** | `renderer.css:264` ← `tokens.css:73` |
| `.tag.CR` | `#8250df` / `#f1e9fd` | **4.28:1** | `renderer.css:265` ← `tokens.css:74` |
| `.tag.other` | `#69707d` / `#eceef2` | **4.29:1** | `renderer.css:261` ← `tokens.css:77` |
| `.tag.uncat` | `#a56a12` / `#fff0d8`（`color-mix` 合成值） | **4.01:1** | `tokens.css:78-79` |
| `.tag.CRVR`（**深色模式**） | `#1a7f37` / `#203627` | **2.55:1** | `tokens.css:76`（深色档缺失） |

- 附：`.dot-ok`（success）2.22:1 与 `.dot-warn`（warning）2.06:1 同样低于 SC 1.4.11 的 3:1，但它们旁边有等价文字（`SearchSidebar.jsx:52-53` 的「索引状态正常」），构成非唯一信息通道，判为附带问题、不计分。
- **根因不是"选错颜色"，而是"把 Apple 的**填充色**当**文字色**用"**：HIG 的 `systemGreen`/`systemOrange` 是给图形与填充的语义色（HIG Color 的规格表本身按 light/dark/高对比四列给值，说明它们**只在系统控件内**保证可读），直接拿来给 11px 文字上色必然不达 4.5:1。修复方向应是「标签文字保持中性色、把颜色移到背景/圆点」，而非"把绿改深一点"。
- 改哪里：`static/prototype/tokens.css`（新增 `--score-same-fg` / `--score-like-fg` 等**文字专用**派生令牌，用 `color-mix(in srgb, <hue> 60%, var(--color-text-primary))` 压暗）、`renderer.css:234,268,269`（改引新令牌）、`tokens.css:76`（补深色档）。
- 怎么验：把附录 §3 的对比度脚本固化进 `tools/verify_renderer_styles.mjs` 作为第 ⑤ 项硬门（读 tokens.css 的 `:root` 与深色块，对 8 组「文字色/所在底色」断言 ≥4.5:1，并同时断言 `color-mix` 合成后的实际值）。

### U-04 · 载入态没有文字，且骨架对辅助技术完全隐藏；冷启动可长达 11 秒
- **Score = 3 × 2 = 6 → High**
- 类别：**【代码事实】** vs **【文档声称】**
- 证据：`Gallery.jsx:21-27` 的 loading 分支只渲染 8 个 `<SkeletonCard>`，每个 `aria-hidden="true"`（`Gallery.jsx:8`），**分支里没有任何文字节点**。
  `DESIGN-app-details.md:97` 明令：「⚠️ **绝不**把"等待模型加载"做成白屏——冷启动 11 秒是真实的，**必须有文字反馈**」。
  而 `src/renderer/src/hooks/useSearch.js:46` 确实算了 `setMeta('检索中…（首次会载入模型，约 3 秒）')`——但见 U-08，`meta` 没有任何组件消费。
- **用户实际会看到什么**：点「搜索图片 →」后，结果区变成 8 个没有任何文字的灰色占位块，持续到编码器返回；首次冷启动时该状态可维持 11 秒（文档值）。屏幕阅读器用户在此期间**听不到任何东西**。
- 改哪里：`src/renderer/src/search/Gallery.jsx`（loading 分支加一行 `role="status" aria-live="polite"` 的文字，文案取 `meta`）、`src/renderer/src/pages/SearchPage.jsx`（把 `search.meta` 传进 Gallery）。
- 怎么验：`tools/verify_renderer_dom.mjs` 加断言「search 未 resolve 时，`.gallery` 的父容器内存在可见文本且含 `检索中`」；并断言该文本节点**不带** `aria-hidden`。

### U-05 · `aria-pressed` / `aria-current` 全仓 0 处：筛选态与当前页对辅助技术不可知
- **Score = 2 × 3 = 6 → High**（WCAG 4.1.2 状态需可程序化判定，AA）
- 类别：**【代码事实】** vs **【文档声称】**
- 证据：grep `aria-pressed|aria-current|aria-selected|role="radiogroup"|tabIndex|tabindex` 扫 `src/renderer/src` **只命中 1 行，且是注释**（`ui/Chip.jsx:1`：「选中态是 `active` 而不是 aria-pressed」——代码自己记下了这个缺口）。同一 grep 扫 `static/prototype/` 同样 **0 处**。
  而 `UI-REVIEW-and-migration.md:16` 声称原型「可访问性底子 ✅ 保留。`aria-label`/`aria-pressed`/`role=status aria-live`/`:focus-visible` 都有」——**`aria-pressed` 这一项在当前磁盘上不存在**（原型与实现都没有）。
  两处具体后果：
  1. 6 个分类胶囊（`Chip.jsx:4`）的选中态**只有视觉**，读屏用户无法知道当前筛的是哪个分类；
  2. 侧栏当前项只有 `.active` class（`Sidebar.jsx:32`），**无 `aria-current="page"`**；而 6 个禁用项是 `<a href="#">` + `aria-disabled`（`Sidebar.jsx:31,34`）——`aria-disabled` 不阻止聚焦，键盘会依次停在 6 个"不可用"链接上。
- 改哪里：`src/renderer/src/ui/Chip.jsx`（加 `aria-pressed={active}`；或把 `.filter-row` 改成 `role="radiogroup"` + `aria-checked`）、`src/renderer/src/layout/Sidebar.jsx`（当前项加 `aria-current="page"`；禁用项加 `tabIndex={-1}` 并把 `href="#"` 换成 `<span>` 或 `<button disabled>`）。
- 怎么验：`tools/verify_renderer_dom.mjs` 加断言：选 VR 后 `.chip.VR` 的 `aria-pressed === 'true'` 且其余为 `'false'`；`.nav a.active` 的 `aria-current === 'page'`；`querySelectorAll('.nav a[tabindex="-1"]').length === 6`。

### U-06 · 字体：在唯一目标平台上前 6 个候选全部落空，"Apple 字体"一个都没用上
- **Score = 2 × 3 = 6 → High**
- 类别：**【代码事实】**（本机字体注册表实测）+ **【判断，非实测】**（字形落点的光学结果）
- 证据链：
  1. 字体栈 `tokens.css:36-38` 为 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei", Helvetica, Arial, sans-serif`。
  2. 目标平台：**Windows**（`package.json` 的 `build:win`；`DESIGN-tokens.md:64` 自认"目标环境是 Windows 上的 Electron"）。
  3. 本机字体注册表实测（附录 §5）：**SF Pro 未安装、PingFang 未安装、Hiragino 未安装、Helvetica 未安装、Segoe UI Variable 未安装、Menlo 未安装**；已安装：`Segoe UI`(15 项)、`Microsoft YaHei`(3 项)、`Arial`(11 项)、`Consolas`(4 项)。
  4. `-apple-system` / `BlinkMacSystemFont` 是 WebKit/Blink 在 **Apple 平台**上的系统字体别名，在 Windows 上解析不到任何字体族，属**无效候选**。
- **结论（可回答 U4 的"落到什么"）**：本机上 `--font-sans` 的**前 6 个候选全部落空**，西文实际落在 **Segoe UI**，中文因 Segoe UI 无 CJK 字形而按逐字形回退到 **Microsoft YaHei**。即：**SF Pro Text / PingFang SC / Hiragino Sans GB 三者在产品唯一目标平台上从未生效过**，`tokens.css:36` 里它们占据前 5 位中的 3 位，属无效噪音。
- 这如何解释截图：`ui-final.png` 的 h1「找到你想要的那张图。」渲染的是 **Microsoft YaHei**，而它带 `letter-spacing: -0.02em`（`renderer.css:138`）—— 该负字距是为 SF 的字面宽度标定的，套到 Microsoft YaHei 上「光学结果是否仍是设计意图」我**无法在本环境验证**，标 **【判断，非实测】**。
- 具体补法（三选一，按代价递增）：
  1. **最小改动（推荐）**：`tokens.css:36` 把 Windows 有效字体提到首位，Apple 系别名保留在 `@supports` 或直接删掉噪音，例如 `--font-sans: system-ui, -apple-system, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;`（`system-ui` 在 Chromium/Windows 上即 Segoe UI，且随系统版本自适应）。
  2. **对齐观感**：把 h1 的字距从 `-0.02em` 改为 0 或 `-0.01em`，因为负字距在 CJK 下由 `DESIGN-tokens.md:80` 自己承认"要谨慎"。
  3. **真 SF 观感**：自托管字体 —— 但 `DESIGN-tokens.md:65` 明确「SF 字体有授权限制，不要随应用分发」，所以此路**被项目自己的合规判断封死**，只能选 1 或 2。
- 怎么验：加一条 `tools/verify_renderer_styles.mjs` 断言「`--font-sans` 的第一项必须是 `system-ui` 或一个 Windows 已安装字体」；另可在 `tools/verify_renderer_dom.mjs` 里用 jsdom 无法验字体，需人工在 Windows 上截图比对（写进 U10 的验收）。

### U-07 · 深色模式覆盖不全（浅色滚动条 / CR+VR 标签 / Electron 底色固定浅色）
- **Score = 2 × 2 = 4 → Medium**
- 类别：**【代码事实】**
- 证据即 §4.6 的三行表格。补充：`DESIGN-tokens.md:159` 自定纪律「浅色、深色两套都要过一遍对比度，不要只检查浅色」；HIG Color 的规范性语句「**Make sure all your app's colors work well in light, dark, and increased contrast contexts**」与「If you define a custom color, make sure to supply light and dark variants, **and an increased contrast option** for each variant」。
- **仓库一个 increased-contrast 变体都没提供**（grep `prefers-contrast` / `increased contrast` → 0 命中）。
- 改哪里：`tokens.css:169-173`（补 `--cat-crvr-fg` 深色档）、`renderer.css`（加 `html { color-scheme: light dark }` 与 `::-webkit-scrollbar` 令牌化）、`src/main/index.mjs:290`（`backgroundColor` 改为不被观察到或跟随 `nativeTheme.shouldUseDarkColors`）。
- 怎么验：`tools/verify_renderer_styles.mjs` 加断言「`:root` 里每个在浅色块出现的 `--cat-*` 前景令牌，必须在深色块里也出现」（当前会精确报出 `--cat-crvr-fg` 缺失）。

### U-08 · `useSearch.meta` 是死状态：检索耗时从不显示
- **Score = 1 × 3 = 3 → Low**
- 类别：**【代码事实】** vs **【文档声称】**
- 证据：`src/renderer/src/hooks/useSearch.js:17,46,53,59,64,74,97` 共 7 处写 `meta`；grep `meta` 扫全部 22 个 `.jsx` **只命中 `PhotoCard.jsx` 的 `card-meta` 类名与一行注释**（附录 §1）→ `meta` **没有任何消费者**。
  而 `src/renderer/src/hooks/useSearch.js:59` 里恰好装着 `tookMs`，`UI-REVIEW-and-migration.md:40` 明确要求「底部'耗时 0.18 秒（原型展示值）'→ **保留位置，改为真实 P50**」。实测截图里结果区上方的 `搜索结果 60 套素材`（`Gallery.jsx:50`）**不含耗时**。
- 改哪里：`src/renderer/src/search/Gallery.jsx:50`（在条数后接 `{meta}`）。
- 怎么验：`tools/verify_renderer_dom.mjs` 加断言「search resolve 后页面文本匹配 `/ms\b/`」。

### U-09 · 3 类可点击元素低于项目自定的 44px
- **Score = 2 × 2 = 4 → Medium**
- 类别：**【代码事实】** vs **【文档声称】**
- 证据见 §4.5 表。判定：**达成 WCAG 2.2 SC 2.5.8（AA，24×24）**，**未达 SC 2.5.5（AAA，44×44）**，且**违反 `DESIGN-tokens.md:141` 的"所有可点击元素"**。
- 改哪里：`renderer.css:124`（`.icon-btn` 用 `--touch-min` 或把 `--control-icon-btn` 提到 44）、`renderer.css:168`（`.chip` `min-height: var(--touch-min)`）、`renderer.css:158`（删掉 `.card-acts .btn` 的 32px 覆盖，或改为「仅扩大可点区不加高视觉」的 `::after` 方案）。
- 怎么验：`tools/verify_renderer_styles.mjs` 加断言「`.chip`/`.icon-btn`/`.card-acts .btn` 最终 `min-height` 解析值 ≥44px」（需解析 `var()` 链）。

### U-10 · 结果卡动作丢掉原型的"图上遮罩"方案；`更多▾` 菜单缺失
- **Score = 2 × 2 = 4 → Medium**
- 类别：**【代码事实】**（两端都有）vs **【文档声称】**
- 证据：
  - **原型** `static/prototype/app.css:36-39`：`.card-acts` 是 `left:7px; right:7px; bottom:7px`（**整条铺满卡片下沿**），且 `.card-acts button` 有 `background: var(--scrim-media-strong)` + `color: var(--color-on-accent)` + `border: 1px solid var(--hairline-on-media)` + `backdrop-filter: blur(6px)` —— 按钮**自带暗色底**，压在任何照片上都可辨识。
  - **实现** `renderer.css:249-253`：`.card-acts` 改成 `inset: auto var(--space-2) var(--space-2) auto`（**只占右下角**），且**全文没有 `.card-acts button` 规则** → 按钮落到 `.btn` 的 `background: var(--color-bg-elevated)`（白底）+ `color: var(--color-text-primary)`。白底按钮叠在浅色照片上时，边界可辨识度依赖照片内容，而原型方案不依赖。
  - **`更多▾` 菜单缺席**：`UI-REVIEW-and-migration.md:209` 与 `DESIGN-app-details.md:71` 都要求卡片悬停出「定位 / 取件 / **更多▾**」，并列出 4 个菜单项（复制包路径 / 复制图路径 / 以此为图搜同款 / 在应用内大图查看）。实现里 `PhotoCard.jsx:29-32` 只有 2 个按钮。
- 改哪里：`renderer.css`（补回 `.card-acts button` 的 scrim 三条属性，`--scrim-media-strong`/`--hairline-on-media` 令牌已存在于 `tokens.css:95-96`，目前**未被任何实现层样式引用**）、`src/renderer/src/search/PhotoCard.jsx`（加「更多▾」）。
- 怎么验：`tools/verify_renderer_dom.mjs` 加断言「卡片内按钮数 = 3」；样式断言「`.card-acts button` 的 `background` 解析结果不是 `--color-bg-elevated`」。

### U-11 · `seq140` 硬编码在页脚，与指标卡不同源
- **Score = 2 × 2 = 4 → Medium**
- 类别：**【代码事实】**
- 证据：`src/renderer/src/pages/SearchPage.jsx:140` 的页脚文案是模板字符串里**写死的** `seq140`：
  `结果来自本机索引{lib ? `（${lib.libId} · dim ${lib.dim} · seq140）` : ''}；`
  而同一屏的指标卡 `MetricsRow.jsx:25` 是**从 `lib.compat` 动态读**的：`const seq = (compat.split('|')[4] || '').trim()`。
  后果：索引换 seq 后，指标卡会显示新值、页脚仍写 140 → **同屏两个数字互相矛盾**。另外 `MetricsRow.jsx:24-25` 用 `compat.split('|')` 的**位置下标**取 `precision`/`seq`，格式一变就静默显示 `—`，没有任何守卫断言这个契约。
- 改哪里：`SearchPage.jsx:140`（改为读 `lib.compat` 的同一解析函数）、把解析函数提到共享模块供 `MetricsRow.jsx` 与页脚共用。
- 怎么验：`tools/verify_renderer_dom.mjs` 加断言「lib.compat 设为 `a|b|fp32|c|seq280` 时，页脚文本含 `seq280` 且不含 `seq140`」。

### U-12 · 侧栏 6 个禁用项仍是可聚焦的 `href="#"` 链接
- **Score = 2 × 2 = 4 → Medium**
- 类别：**【代码事实】**
- 证据：`Sidebar.jsx:31` `href="#"`、`:34` `aria-disabled={disabled || undefined}`、`:35` `onClick` 里 `e.preventDefault()`。`aria-disabled` **不改变可聚焦性**，所以键盘 Tab 会依次经过「图片详情 / 本地图库 / 入库与增量 / 索引任务 / 操作记录 / 设置」6 个不可用项；且它们对读屏软件仍宣告为 `link`。
  备注（**良好实践，应予保留**）：这些项**不是静默失败**——`SearchSidebar.jsx:37-38` 给 `title="P3c 尚未实现"` 且点击弹 toast，符合判据 §3「死功能必须记录用户实际会看到什么」的要求。
- 改哪里：`src/renderer/src/layout/Sidebar.jsx:28-41`（禁用态渲染为 `<span className="nav-item disabled" aria-disabled="true">` 而非 `<a href="#">`，或保留 `<a>` 但加 `tabIndex={-1}`）。
- 怎么验：`tools/verify_renderer_dom.mjs` 断言「`.nav a[href="#"]` 数量为 0」且「`.nav [aria-disabled="true"]` 数量为 6」。

### U-13 · 原型 21 处硬编码色值（去重 6 个，含文档声称"已全量替换"的靛蓝残留）；原型套件已无任何令牌守卫
- **Score = 1 × 3 = 3 → Low**（影响面 1：原型是设计验证文件，不随应用发布）
- 类别：**【代码事实】** vs **【文档声称】**
- 证据：
  - `#858aff` **仍是 4 个原型页的进度条填充**（`语义搜索.html:1`、`图库与索引任务.html:1`、`操作记录与设置.html:1`、`图片详情.html:36`），`#8b91ff` 仍是状态圆点色（5 个页）。而 `UI-REVIEW-and-migration.md:262` 声称强调色已从「靛蓝 `#5b63e6`」**全量替换**为 `#0071e3`；`#858aff`/`#8b91ff` 正是靛蓝族残留。
  - 另有 `#c4c7d0`（面包屑分隔符，7 个页）、`#a56a12`（= `--cat-uncat-fg` 的**字面值**被内联写死，2 个页）、`#454b58`（2 个页）、`#8b91a0`（搜索框放大镜内联 `color`，1 个页）。
  - **合计 21 处（出现次数）· 去重后 6 个不同字面量**（口径与逐页明细见附录 §4.1；此处原写"21 个不同字面量"把出现次数当成了去重值个数，已按 B3 更正）。
  - `UI-REVIEW-and-migration.md:271` 指定的守卫 `tools/verify_tokens.py` **不存在**（`tools/` 实测 7 个 `.mjs`，无 `.py`，Python 层已按 `4555c1b` 整体退役）。现行 `tools/verify_renderer_styles.mjs:29` 的扫描根是 `path.join(ROOT,'src','renderer','src')`，**不含 `static/prototype/`**（附录 §1 grep 证实：全仓只有 `verify_renderer_styles.mjs` 引用 `static/`，且只用来读 `tokens.css` 作为令牌定义源）。
  - 这同时违反 HIG Color 的「**Avoid hard-coding system color values in your app.**」
- 改哪里：`static/prototype/*.html`（把 21 处内联色值换成 `var(--…)`，对应 6 个字面量）、`tools/verify_renderer_styles.mjs`（把扫描根扩到 `static/prototype/`，或新增第 5 个参数 `--include-prototype`）、`UI-REVIEW-and-migration.md:271`（把 `verify_tokens.py` 改成现行脚本名）。
- 怎么验：`node tools/verify_renderer_styles.mjs --include-prototype` 必须报「7 个原型文件 · 0 处颜色字面量」（判据是**出现次数归零**，去重值随之归零）。

### U-14 · `:focus-visible` 里的 `border-radius` 会改写元素自身圆角
- **Score = 1 × 3 = 3 → Low**
- 类别：**【代码事实】**
- 证据：`renderer.css:34` 与 `tokens.css:224` 都写了
  `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; border-radius: var(--radius-sm); }`
  `outline` 在现代 Chromium 中会跟随元素自身的 `border-radius`，所以**这一行不需要**；而 `border-radius` 写在 `:focus-visible` 里会**作用到元素本身**。后果：`.chip`（`border-radius: var(--radius-pill)` = 999px，`renderer.css:164`）在键盘聚焦瞬间，四角从药丸形**变成 8px**；`.icon-btn`（10px）也会跳到 8px。
- 改哪里：`renderer.css:34` 与 `tokens.css:224`（删掉 `border-radius` 那一句）。
- 怎么验：jsdom 无法验视觉；写入手工验收清单——Tab 到「全部」胶囊，其圆角在聚焦前后应一致。

### U-15 · `.brand-sub` 因 +1px 与字距在 220px 侧栏折成两行
- **Score = 1 × 3 = 3 → Low**
- 类别：**【代码事实】** + **【实测】**（截图可见）
- 证据：**实现** `renderer.css:64` `.brand-sub { font-size: var(--type-micro); /* 11px */ letter-spacing: .04em }`；**原型** `static/prototype/style.css` `.brand-sub{font-size:10px;color:var(--sidebar-muted);margin-top:2px}`（**10px、无字距**）。
  可用宽度推算：侧栏 220px（`--layout-sidebar-width`）− 左右 padding `--space-3`×2 = 196px − logo 36px − `--space-3` 间隙 12px = **148px**；`LOCAL IMAGE INTELLIGENCE` 24 字符 ×（11px + .04em）≈ 170px+ → 折行。
  **实证**：`reports/G-D-p2-electron/ui-final.png` 里品牌副标题显示为 **两行**「LOCAL IMAGE / INTELLIGENCE」。
- 改哪里：`renderer.css:64`（回到 10px 并去掉字距，或给 `.brand-sub` 加 `white-space: nowrap` + 允许溢出省略）。
- 怎么验：在 1440×920 窗口（`src/main/index.mjs:289` 的默认尺寸）截图，`.brand-sub` 的 `getClientRects().length === 1`。

### U-16 · `photo-card loading` 类没有任何样式定义
- **Score = 1 × 3 = 3 → Low**
- 类别：**【代码事实】**
- 证据：`src/renderer/src/search/Gallery.jsx:8` `className="photo-card loading"`；`renderer.css` 全文无 `.loading` 规则；`static/prototype/` 也只在 `index.html:13` 有 `.pcard`，无 `.loading`。
- 改哪里：`Gallery.jsx:8`（删掉无用类名）或 `renderer.css` 补 `.photo-card.loading`（如降低对比度/加骨架动画）。
- 怎么验：把附录 §6 的 class 覆盖脚本并入 `verify_renderer_styles.mjs`，断言「JSX 里出现的每个静态 class 都能在任何 CSS 里找到定义」。

### U-17 · 令牌守卫 ④ 的行号偏移 12 行；其"4pt 阶梯"白名单并非 4pt 阶梯
- **Score = 1 × 2 = 2 → Low**
- 类别：**【代码事实】**
- 证据：
  - 守卫输出「`src\renderer\src\renderer.css` 有 2 处不在阶梯上的 px：**291**:1100px, **294**:760px」。而 `renderer.css` 的真实行号是 **303**（`@media (max-width: 1100px)`）与 **306**（`max-width: 760px`）。差 12 = 文件开头 13 行注释块被 `stripComments`（`tools/verify_renderer_styles.mjs:54-56,108`）压掉后少算的行数 → **报告的行号不能直接拿去定位**。
  - `tools/verify_renderer_styles.mjs:104` 的 `SCALE` 白名单是 `{0,1,2,3,4,6,8,12,16,20,24,28,32,36,40,48,64,72,96,1500,44,999}` —— 含 `6/28/36/40/1500`，**不是 `DESIGN-tokens.md:84-98` 的 4pt 阶梯**（§4.1 的 11 档）。所以"只有 2 处不在阶梯上"只在被放宽的白名单下成立。
- 改哪里：`tools/verify_renderer_styles.mjs:108-116`（行号加回被剥离的注释行数；`SCALE` 改为从 `tokens.css` 的 `--space-*` 反解，而不是手写白名单）。
- 怎么验：改完后该守卫对 `renderer.css` 应报出 `303:1100px, 306:760px`，并另报 `104:6px`、`259:2px`。

### U-18 · 排序下拉保留了永不生效的「最近添加」；缺「体积」排序
- **Score = 1 × 2 = 2 → Low**
- 类别：**【代码事实】**
- 证据：`SearchPanel.jsx:8-12` 提供三项；`src/renderer/src/hooks/useSearch.js:27-28` 的逻辑是 `if (sort === 'name') … else if (sort !== 'recent') list.sort(score)` → 选「最近添加」时**不排序**（原序透传）。
  诚实性评价：`SearchPage.jsx:115` 在此选项被选中时弹 toast「「最近添加」需要索引提供 mtime，P3b 再补」——**不是静默失败**，符合判据 §3 的"死功能"纪律，故只给 Low。
  另：`UI-REVIEW-and-migration.md:208` 要求的排序项含「最近 / **体积**」，实现缺「体积」。
- 改哪里：`SearchPanel.jsx:8-12`（在引擎补 mtime 前把「最近添加」标 `disabled` 或从列表移除）、`src/renderer/src/hooks/useSearch.js:27`（补按 `archive.size` 排序）。
- 怎么验：`verify_renderer_dom.mjs` 断言「选择 recent 时结果数组顺序与引擎返回一致**且** `#sort` 中该项为 disabled」。

### U-19 · 顶栏玻璃材质的前景对比度未实测
- **Score = 1 × 2 = 2 → Low**
- 类别：**【代码事实】** + **【判断，非实测】**
- 证据：`renderer.css:109-118` 顶栏用 `--color-glass`（浅色 `rgba(255,255,255,.72)`）+ `backdrop-filter: saturate(180%) blur(20px)` + `border-bottom: 1px solid var(--color-separator-subtle)`。HIG Materials 要求「Use materials and effects sparingly」（✅ 只用一处，与 `DESIGN-tokens.md:133` 的"毛玻璃只用于吸顶导航"一致）、「Help ensure legibility by using vibrant colors on top of materials」，并要求玻璃边缘有 1px 描边（✅ 已做）。
  但 `blur(20px)` 下的实际合成色**依赖下方滚动内容**，`reports/G-D-p2-electron/ui-final.png` 是页面处于顶部、顶栏下方为空白的静止状态，**无法据此判定滚动中的对比度**。故本条只挂账，不作缺陷定性。
- 建议：把「滚动到卡片区域时截一张图，量面包屑与 ↻/? 按钮的对比度」写入 §11 的手工验收清单。

### U-20 · 35 个令牌定义了但实现层从未消费；其中 2 个让「未分类」的样式不可达
- **Score = 1 × 2 = 2 → Low**
- 类别：**【代码事实】**
- 证据（脚本：解析 `tokens.css` 的 `--*:` 定义，再在 `renderer.css` 里查 `var(--x)`）：

| 项 | 值 |
|---|---|
| `tokens.css` 定义的令牌总数 | **102** |
| `renderer.css` 从未引用的 | **35**（34%） |

其中值得单独指出的是 **8 个真死令牌**（无任何消费路径，也不是桥接）：
- `--shadow-outline`（`tokens.css:51`）**从未被引用**。`DESIGN-tokens.md:131` 把它定义为"卡片的 1px 描边，代替投影"，但实现改用 `border: 1px solid var(--color-separator-subtle)`（`renderer.css:203/219/239`）达成了同样效果 —— 效果对，令牌成了死代码。
- `--shadow-control`（`tokens.css:52`，`DESIGN-tokens.md:132` 定义为"分段控件里被选中的白色滑块"）**从未被引用** —— 因为已实现的这一页没有分段控件（`ui-components.png` 里的那版有，但那不是当前代码，见 §1.1）。
- **`--cat-uncat-bg` / `--cat-uncat-fg`（`tokens.css:78-79`）从未被引用，且不可达**：`Tag.jsx:4` 的 `const CLASS = { VR:'VR', CR:'CR', 'CR+VR':'CRVR' }` 不含 `'未分类'`，`src/renderer/src/hooks/useSearch.js:9` 的 `CHIPS` 却包含 `'未分类'`。后果：筛选「未分类」得到的结果卡，其标签落到默认 `.tag`（灰，`renderer.css:261`），**与「其他」完全同色** —— 而令牌表专门为「未分类」定义了琥珀色（`tokens.css:78-79`，注释写明"未分类用警告色"）。这是 §4.1「一个强调色/状态只表示状态」的可达性缺口，不是配色问题。
- **`--scrim` / `--scrim-media` / `--scrim-media-strong` / `--hairline-on-media`（`tokens.css:93-96`）四个一次都没被实现层引用** —— 它们正是原型 `app.css:36-39` 用来做"图上覆盖条"的那套材质。即 U-10 不是"实现忘了写样式"，而是**令牌已经备好、样式没有接**。

余下 **27 个**可按来源归为两类（计数已配平：8 + 27 = 35）：
- **旧变量桥接 16 个** —— `--bg/--panel/--text/--muted/--line/--line-strong/--accent/--accent-soft/--green/--green-soft/--amber/--amber-soft/--warning/--danger/--danger-soft/--ink-2`（`tokens.css:135-151` 明确说明是给 `style.css`/`app.css` 用的；**此处原写"13 个"，与附录 §6.4 的 16 不一致，已更正 —— B-minor m2**）。
- **结构性预留 11 个** —— `--color-bg-secondary`、`--space-12/16/18/24`（4）、`--radius-2xl`、`--type-title2` / `--type-title2-lh` / `--type-title2-ls`（3）、`--type-callout-lh`、`--control-segment-height`。这些服务于尚未实现的 5 个原型页（如 `--type-title2` 对应卡片标题档、`--control-segment-height` 对应分段控件），属"先建令牌后建页"的正常预留，**不计为缺陷**。
- **§4.5 的守卫只查一个方向**：`tools/verify_renderer_styles.mjs:98` 只断言「用到的 `var()` 都有定义」（used → defined），**不查「定义了的都被用到」**（defined → used），所以上述 8 个真死令牌永远不会被发现。
- 改哪里：`static/prototype/tokens.css`（删掉或标注保留原因）、`renderer.css:203,219,239`（改用 `box-shadow: var(--shadow-outline)` 或反过来删令牌）、`src/renderer/src/ui/Tag.jsx:4`（`CLASS` 补 `'未分类':'uncat'` 并在 `renderer.css` 补 `.tag.uncat`）。
- 怎么验：`tools/verify_renderer_styles.mjs` 加第 ⑥ 项：列出「定义但未被任何渲染层文件引用」的令牌；对 `.tag.uncat` 加断言「folder='未分类' 的卡片标签 class 含 `uncat`」。

---

## 6. U4 · 字体与平台落差（汇总答案）

已在 U-06 给出完整证据与补法。此处只压缩成可直接执行的结论：

1. **Windows 上这条栈落到什么**：`-apple-system`（Windows 无效）→ `BlinkMacSystemFont`（Windows 无效）→ `"SF Pro Text"`（未安装）→ `"PingFang SC"`（未安装）→ `"Hiragino Sans GB"`（未安装）→ `"Segoe UI Variable Text"`（**本机未安装**）→ **`"Segoe UI"`（命中，西文）** → **`"Microsoft YaHei"`（命中，中文逐字形回退）**。前 6 项全部落空。
2. **落差性质**：不是"字体不好看"，而是**字体栈的 5/11 个候选在唯一目标平台上是无效项**，且 `tokens.css:36` 把 SF/PingFang/Hiragino 放在最前 → 表达了一个**在 Windows 上永不生效**的设计意图。文档也承认这一点（`DESIGN-tokens.md:64`：「`-apple-system` 和 SF Pro 在 Windows 上都不存在」），但**只加了候选、没有把无效项挪出或删掉**。
3. **候选字体栈（可直接替换 `tokens.css:36-38`）**：
   ```css
   --font-sans: system-ui, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei",
                "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif;
   ```
   理由：`system-ui` 在 Chromium 上映射到当前平台的系统 UI 字体（Windows=Segoe UI、macOS=SF），一条候选同时满足两个平台，且不会在任一平台上落空；把 Apple 系 CJK 字体放在 Windows 字体**之后**，让它们在 macOS 上仍能命中。
4. **是否需要自带字体**：**不需要，且不应**。`DESIGN-tokens.md:65` 明确「SF 字体有授权限制，不要随应用分发」；`UI-REVIEW-and-migration.md:173` 也把「自托管字体或纯系统字体」列为二选一，并强调"别偷偷回退到联网 CDN"（当前 CSP `font-src 'self'`，`src/renderer/index.html:10`，已从策略上封死 CDN ✅）。
5. **随之要改的字距**：`renderer.css:138` 的 h1 `letter-spacing: -0.02em` 是按 SF 字面标定的；换成 Segoe UI / Microsoft YaHei 后须重新确认（`DESIGN-tokens.md:80` 自己说"中文字距收紧要谨慎"）。

---

## 7. U5 · 交互完整性（逐项）

| 子项 | 状态 | 证据 |
|---|---|---|
| **键盘可达性** | ⚠️ 部分 | 原生 `<button>`/`<a>`/`<select>`/`<input>` 保证 Tab 可达 ✅；但文档要求的 **9 项**快捷键（并集：UI-REVIEW 5 项 / DESIGN-app-details 7 项 + 拖放·粘贴 2 条）**只实现了 Enter 提交搜索**（U-02） |
| **焦点可见** | ✅ 通过 | `:focus-visible` 统一 2px accent + offset 3px（`renderer.css:34`、`tokens.css:221-225`）；鼠标点击不出环 ✅ |
| —— 附带缺陷 | ⚠️ | `:focus-visible` 里误写 `border-radius`（U-14） |
| **`aria-*` 覆盖** | ⚠️ 部分 | **有**：`aria-label`（`SearchBox.jsx:15` 输入框、`SearchPanel.jsx:58` 排序、`SearchPage.jsx:150` 文件选择、`SearchPage.jsx:86-87` 两个图标按钮）、`aria-hidden`（所有装饰图标：`Sidebar.jsx:37`、`Metric.jsx:11`、`SearchBox.jsx:9`、`SearchSidebar.jsx:52`、`Gallery.jsx:8`）、`role="status" aria-live="polite"`（`Toast.jsx:6`）、`role="progressbar"` + `aria-valuenow/min/max`（`Progress.jsx:8`）、`aria-disabled`（`Sidebar.jsx:34`）、`aria-modal aria-labelledby`（原型弹窗 `文件操作确认.html:100`）。**缺**：`aria-pressed`/`aria-current`/`aria-selected`/`tabIndex` —— 全仓 **0 处**（U-05） |
| —— 附带缺陷 | ⚠️ | `Progress.jsx:8` 的 `role="progressbar"` **无 `aria-label`**，读屏只报"50% 进度条"而不知是什么的进度（调用点 `SearchSidebar.jsx:55` 旁边有文字 "50% 已建立索引"，但那是兄弟节点，不构成 accessible name） |
| **空态** | ✅ 通过 | `Gallery.jsx:36-43` 两条文案：「没有匹配的素材」+「换个说法，或把渲染器分类切回「全部」」——给了**可操作建议**，符合 `UI-REVIEW:210` 的要求 |
| **错误态** | ✅ 通过 | `Gallery.jsx:28-35` 显示 `error.userMessage` + `error.code`（mono 显示）；`useEngine.js:36,44,52` 三个 `userMessage` 兜底；主进程事件失败也走 toast（`SearchPage.jsx:36,40`） |
| **载入态** | ❌ 不通过 | 有骨架但**无文字**且对 AT 隐藏（U-04）；骨架本身无动画（`renderer.css:279` 是静态渐变），`prefers-reduced-motion` 下与正常态无差别 |
| **触达尺寸** | ⚠️ 部分 | `--touch-min` 用在 3 处 ✅；`.chip`/`.icon-btn`/卡片按钮低于项目自定 44px（U-09） |
| **语义化标签** | ✅ 通过 | `<aside>`（`Sidebar.jsx:48`）、`<nav>`（`:24`）、`<header>`（`Topbar.jsx:4`）、`<main>`（`Main.jsx:3`）、`<article>`（`PhotoCard.jsx:16`、`Gallery.jsx:8`）、`<h1>`（`PageHead.jsx:7`，每页唯一） |

**补充一条正向证据（应保留）**：全部图标按钮都有 `title` **且** 有 `aria-label` 或 `aria-hidden`，两个都给了 —— 符合 `DESIGN-tokens.md:157` 的约定，也符合 HIG Accessibility 的取向。

---

## 8. U6 · 实现 vs 原型差距清单

### 8.1 已实现页（语义搜索）与同名原型的逐项对照

| # | 项 | 原型 | 实现 | 判定 |
|---|---|---|---|---|
| 1 | 结构（brand / nav / topbar / page-head / panel / metrics / gallery） | ✅ | ✅ 类名一一对应（`SearchPage.jsx` 的注释标了原型对应类名） | ✅ **忠实迁移** |
| 2 | 侧栏宽度 | 230px（`style.css` `.app{grid-template-columns:230px …}`） | 220px（`--layout-sidebar-width`） | ✅ 按令牌修正（`UI-REVIEW:263` 已记录） |
| 3 | 间距阶梯 | 混用 14/18/22px（`style.css`） | 全部 `var(--space-*)`，仅 2 处阶梯外 | ✅ 按令牌修正 |
| 4 | 进度条填充色 | **`#858aff`（靛蓝，硬编码）** | `var(--color-accent)`（`renderer.css:105`） | ⚠️ **实现更正确**，原型未修（U-13） |
| 5 | 状态圆点色 | **`#8b91ff`（硬编码）** | `var(--sidebar-muted)` + `.dot-ok`（`renderer.css:99-102`） | ⚠️ 同上 |
| 6 | 卡片动作视觉 | 图上整条 + 暗色 scrim + 毛玻璃（`app.css:36-39`） | 右下角 + 白底 `.btn`（`renderer.css:249-253`，无 `.card-acts button` 规则） | ❌ **实现回退**（U-10） |
| 7 | 卡片动作数量 | 「定位 / 取件」 | 「定位 / 取件」（**无「更多▾」**） | ❌ 两份文档都要求 3 个（U-10） |
| 8 | 相关度档位文案 | `0.9396 · 同款区间`（`语义搜索.html:7`） | 同分数会渲染成 `很接近`（`Score.jsx:2-7`） | ❌ **同一分数两种文案**（U-01） |
| 9 | 分数小数位 | 4 位（`0.9396`） | 4 位（`Score.jsx:27` `toFixed(4)`） | ✅ 一致，但与 `DESIGN-app-details.md:66` 的"3 位"冲突 → 该文档过期 |
| 10 | 品牌副标题 | 10px 无字距（单行） | 11px + .04em（**折两行**，截图可见） | ❌ 回归（U-15） |
| 11 | 缩略图 | `file:///G:/model/...` 直出原图 | `thumb://<lib>/<uid>@256`（`PhotoCard.jsx:25`） | ⚠️ 有意变化（安全模型），但 `DESIGN-app-details.md:65` 说"原图直出，不生成缩略图" → 该文档过期 |
| 12 | 图片长宽比 | `.photo-img{height:145px}`（固定高） | `.photo{aspect-ratio:4/3}` + `object-fit:cover`（`renderer.css:246-247`） | ⚠️ 见 §11 未验证项 |
| 13 | 侧栏深色 | 原型实际渲染**浅色**（`--sidebar-bg` 默认 `--color-bg-secondary`；全仓无 `data-sidebar="dark"` 使用） | 同为浅色 | ⚠️ 两边一致，但**都与 `UI-REVIEW` §5 的"侧栏（深色，固定）"不符**（§9） |
| 14 | 字号 | `style.css` 的 `font:14px/1.45` | 令牌阶梯（`--type-*`） | ✅ 实现更规范 |

**总结**：迁移**结构忠实、令牌纪律更好**（4/5/9/14 项实现优于原型），但在**卡片动作（6/7）**与**相关度档位（8）**两处发生了**功能与信息的回退**，另有一处视觉回归（10）。

### 8.2 未实现的 5 个原型页（不计分为缺陷，仅登记差距）

| 原型页 | `UI-REVIEW` 对应 | 界面入口现状 | 用户实际会看到什么 |
|---|---|---|---|
| `图片详情.html` | §2.6-A 流程 2 | 侧栏「图片详情」disabled + toast「P3c 尚未实现」 | 点不进去；结果卡也没有"查看详情"入口 |
| `图库与索引任务.html` | §2.2 / §2.3 流程 3 | 「本地图库」「索引任务」两项 disabled | 多库注册表、阶段条、失败项、取消/续跑全部不可见 |
| `入库与增量.html` | §六 入库与增量 | 「入库与增量」disabled | 主进程**显式拒绝**（基线 §5 D5：`src/main/index.mjs:191-195`），界面与引擎一致 |
| `文件操作确认.html` | §2.6-B 流程 4 | 侧栏无对应项（原型也未列入 WORKSPACE 组） | 7 种写操作的确认框全都不可达 |
| `操作记录与设置.html` | §2.4 / §2.5 | 「操作记录」「设置」disabled | 事务表、撤销、待处理告警、模型/精度/隐私设置全部不可见 |

**规格层判定（不计分，但需 Lead 归档）**：
- `UI-REVIEW:186-198` 的**目标信息架构是侧栏 8 项**（语义搜索 / 图片详情 / 本地图库 / **入库** / **增量** / 索引任务 / 操作记录 / 设置），并在顶栏放「`[库选择器 ▾]`」；`DESIGN-app-details.md:23` 却写成「侧栏 **7 项**（… 入库 · 增量 …）」。两份文档对同一件事给了 7 vs 8 两个数，**实现选的是 7 项且把入库/增量合并**（`SearchSidebar.jsx:8-16`）。这是**文档之间的不一致**，不是实现偏离某一方。
- 顶栏「库选择器」在实现与原型里**都不存在**（`Topbar.jsx` 只有 `crumb` + `actions`）。多库（P5）未做时它是死控件，因此**不构成当前缺陷**；但 P5 落地时必须补，否则 `DESIGN-app-details.md:547` 的「`全部库` / 具体某个库」无处可选。

---

## 9. U8 · 与 `UI-REVIEW-and-migration.md`（自称"UI 以它为准"）的偏差方向判定

**结论：两个方向同时成立。**该文档既有已被磁盘推翻的事实陈述（该改文档），也被实现在两个方向上同时偏离（该改代码或改文档），必须逐条判，不能一句"文档过期"了事。

### 9.1 文档已过期（【文档声称】被【代码事实】推翻 → 改文档）

| # | 文档原文 | 磁盘实际 | 处置 |
|---|---|---|---|
| D-1 | `UI-REVIEW:271`「写死颜色 72 种 / 112 处 → **0 处**（全部收敛到令牌）｜`tools/verify_tokens.py` 守卫」 | 原型 HTML 仍有 **21 个**颜色字面量（含已声称替换掉的靛蓝 `#858aff`）；`tools/verify_tokens.py` **不存在** | 改 `UI-REVIEW:271`：改指 `verify_renderer_styles.mjs`，并把"0 处"改成"渲染层 0 处 / 原型 21 处待清" |
| D-2 | `UI-REVIEW:276`「而你先前两次明确说过「**深色侧边栏**」，**三页原型的侧栏也是 `#171923`**」 | 全仓 grep `171923` **0 命中**；6 个原型页的侧栏实际是 `--color-bg-secondary`（浅色 `#f5f5f7`）；`data-sidebar="dark"` 只在 `tokens.css:202` 定义、**无任何页面使用** | 改 `UI-REVIEW:276`：删掉"原型侧栏是 #171923"（事实错误），保留"用户偏好深色侧栏"并把开关状态写清 |
| D-3 | `UI-REVIEW:16`「可访问性底子 ✅ 保留。`aria-label`/`aria-pressed`/…都有」 | `aria-label` ✅ 有；**`aria-pressed` 在原型与实现里都是 0 处** | 改 `UI-REVIEW:16`：`aria-pressed` 标注为待补 |
| D-4 | `UI-REVIEW:38`「图→图 ≥0.88 为同款；文本→图 0.74~0.80」；`UI-REVIEW:40`「底部耗时改为真实 P50」 | 代码用 `0.97/0.93`（`Score.jsx`）；耗时 `meta` 从未渲染 | 两条**都是代码未跟上文档**（见 9.2），不改文档 |
| D-5 | `DESIGN-app-details.md:66`「分数保留 **3 位**小数」 | 实现与原型都是 **4 位** | 改 `DESIGN-app-details.md:66` 为 4 位（或反过来改代码，二选一并统一） |
| D-6 | `DESIGN-app-details.md:65`「预览图（**原图直出，不生成缩略图**）」 | 实现走 `thumb://…@256`（`PhotoCard.jsx:25`），主进程生成 JPEG 缓存（`src/main/index.mjs:277-283`） | 改 `DESIGN-app-details.md:65`：缩略图已是实现事实，且是安全模型的组成部分 |
| D-7 | `DESIGN-app-details.md:23`「侧栏 **7** 项」vs `UI-REVIEW:186-198`「侧栏 **8** 项（入库/增量分列）」 | 实现是 7 项、入库与增量合并 | 两份文档先对齐，再决定实现是否拆 |

### 9.2 实现偏离文档（文档是对的 → 改代码）

| # | 文档要求 | 实现 | 对应本报告 |
|---|---|---|---|
| I-1 | `UI-REVIEW:211` + `DESIGN-app-details.md:75-83,85-86`：键盘 **9 项**（并集） | 只实现 Enter（且只覆盖"提交搜索"，未覆盖"网格内定位"） | U-02 |
| I-2 | `UI-REVIEW:209` + `DESIGN-app-details.md:71`：卡片「更多▾」+ 4 个菜单项 | 无 | U-10 |
| I-3 | `UI-REVIEW:40`：显示真实耗时 | `meta` 死状态 | U-08 |
| I-4 | `DESIGN-app-details.md:97`：等待模型**必须有文字反馈**，绝不白屏 | 骨架无文字且 `aria-hidden` | U-04 |
| I-5 | `DESIGN-tokens.md:141`：**所有**可点击元素 ≥44px | 3 类控件 32/36px | U-09 |
| I-6 | `DESIGN-tokens.md:159`：浅色、深色**两套**都要过对比度 | 8 处不达 4.5:1；无 increased-contrast 变体 | U-03 / U-07 |
| I-7 | `UI-REVIEW:208`：排序含「体积」 | 缺「体积」，且「最近添加」永不生效 | U-18 |
| I-8 | `UI-REVIEW:38`：档位阈值 0.88 / 0.74~0.80 | 代码用 0.97 / 0.93 | U-01 |

### 9.3 文档本身与最佳实践冲突（要改文档的设计决策）

| # | 文档要求 | 与最佳实践的冲突 | 建议 |
|---|---|---|---|
| C-1 | `UI-REVIEW:16` 把"深色侧栏"当成既定偏好；`UI-REVIEW:300` 又说「❌ **双主题同时做**——先只做'深色侧栏 + 浅色工作区'，主题切换放后续设置项」 | 实现已经**完整做了双主题**（`tokens.css:154-196`），反而**没做**深色侧栏 → 文档的"先不做"与技术现实相反。且 HIG Color 的规范性语句要求"即使只发一种外观，也要提供 light+dark"——**实现的选择比文档的规划更符合 HIG** | 改 `UI-REVIEW:300`：承认双主题已落地；把"深色侧栏"作为**待决策项**（`data-sidebar="dark"` 开关已具备）而非既定项 |
| C-2 | `UI-REVIEW:298`「卡片悬停位移/阴影动画做到极致…够了」 | 实现**完全没做**悬停位移，只做描边变色（`renderer.css:245`）——更符合 `DESIGN-tokens.md:150`「不做进入动画与悬停位移」。**文档间已自洽，无事** | 无需动作 |
| C-3 | — | `渲染`层用 `@media (max-width:760px)` 与 `(max-width:1100px)` 做了窄窗断点（`renderer.css:303,306`），而 `src/main/index.mjs:289` 设了 `minWidth: 1040` → 在 100% 缩放下 `760px` 断点不会触发（窗口最小外宽 1040px，视口 CSS 宽 ≥1040）。**注意**：浏览器缩放会改变 CSS 视口宽度，约 137% 缩放以上该断点仍会命中 | 建议在 `renderer.css:302` 注明这两个断点的意图（是"用户高缩放的兜底"还是"为将来 Web 版预留"），避免后续有人误以为它是死代码而删掉 |

---

## 10. U7 · 动效与反馈

| 项 | 状态 | 证据 |
|---|---|---|
| `prefers-reduced-motion: reduce` | ✅ **已处理，且双处兜底** | `tokens.css:228-230` 与 `renderer.css:298-300`，规则一致：`* { transition: none !important; animation: none !important; scroll-behavior: auto !important }` |
| `scroll-behavior: smooth` | ✅ 且被 reduced-motion 关闭 | `tokens.css:231` `html { scroll-behavior: smooth }` |
| 进入动画 / 悬停位移 | ✅ **符合** `DESIGN-tokens.md:150`「不做进入动画和悬停位移」 | `renderer.css` 里 `transition` 声明**只有 2 处**：`.card-acts` 的 `opacity .15s`（`:252`）与 `.toast` 的 `opacity .2s, transform .2s`（`:291`）；另有第 299 行的 reduced-motion 重置。全仓无 `@keyframes` |
| 悬停反馈 | ✅ 有（描边变色） | `.nav a:hover`（`:78`）、`.btn:hover:not(:disabled)`（`:154`）、`.chip:hover`（`:170`）、`.icon-btn:hover`（`:131`）、`.photo-card:hover`（`:245`） |
| 骨架屏 | ⚠️ **静态无动画** | `renderer.css:279` 是固定 `linear-gradient`，无 `@keyframes`；因此 reduced-motion 下与正常态无差异（好事），但正常态也**没有"正在加载"的动感**（见 U-04 的文字缺口） |
| Toast 反馈 | ✅ | `Toast.jsx:6` + `useToast.js:9-14`（2600ms 自动消失）；`tone='err'` 时 `.toast.err` 用 `--color-critical`（`renderer.css:295`）。对比度：`#ffffff` on `#ff3b30` = **3.55:1**，低于 4.5:1（错误提示是**必须读清**的正文）→ 附入 U-03 同族 |
| 长任务进度反馈 | ❌ 不可达 | 索引进度事件已接（`SearchPage.jsx:37-38`「索引中 N/M」走 toast），但 `indexStart` 被主进程拒绝（基线 D5），**用户无法真正触发** |

---

## 11. U9 · 逐页「Apple 风格符合度」评级（6 维评分，禁用主观形容词）

### 11.1 评分口径（先定标尺，再打分）

每维 0/1/2 分，**每档都有可核对的通过条件**：

| 分 | 含义 |
|---|---|
| **2** | 有代码级证据，且与 §3 引用的 HIG/WCAG 具体条款一致 |
| **1** | 部分一致，或存在已列出的具体缺口 |
| **0** | 缺失，或存在 Critical/High 级违反 |

| 维度 | 判定依据（引 §3） |
|---|---|
| L 布局 | B1 Layout：栅格一致性、留白层级、命中目标 |
| T 排版 | B2 Typography：阶梯自洽、字重档数、平台字体到位 |
| C 颜色 | B3 Color：系统色对齐、light/dark/increased-contrast 三套齐备、可读性 |
| M 材质 | B4 Materials：克制、边缘分离、前景可读 |
| Mo 动效 | B5 Motion：节制 + reduced-motion |
| A 无障碍 | B6 Accessibility + B7/B8/B9：焦点、状态可程序化判定、对比度、目标尺寸 |

### 11.2 已实现页「语义搜索」（`reports/G-D-p2-electron/ui-final.png` 为唯一对应截图）

| 维度 | 分 | 依据（数值 + 出处） |
|---|---|---|
| L 布局 | **2** | 间距令牌 11 档全为 4 的倍数（`tokens.css:42-44`）；`renderer.css` 310 行里阶梯外裸 px 仅 2 处（`104:6px`、`259:2px`）；留白层级为 侧栏 220px → content padding 24px → 卡片 gap 16px，与 `DESIGN-tokens.md:104-111` 的 `layout.*` 一致；卡片 1px 描边替代投影（`renderer.css:203/219/239`）符合 `shadow.outline` |
| T 排版 | **1** | 正：阶梯自洽、字重 4 档、负字距只用于大标题。负：目标平台上前 6 个字体候选全部落空（U-06）；h1 的 `-0.02em` 按 SF 标定却落在 Microsoft YaHei（`renderer.css:138`）；11px 档在 `renderer.css` 里承担 **9 处**语义位置（§4.2） |
| C 颜色 | **0** | 存在 8 处 <4.5:1 的文字（U-03，含主信号分数徽标 2.06/2.22），1 处深色档缺失（U-07），**0 个 increased-contrast 变体**；而 B3 明确要求三套上下文都成立。正向证据不足以抵消：`success` 明暗两档与 HIG 完全一致、主色对（accent 4.70:1、text.secondary 5.07:1）通过 |
| M 材质 | **1** | 材质只用顶栏一处（`renderer.css:112-113`），符合"克制"；`border-bottom` 的 1px 分离线已做。缺口：前景非 vibrant，滚动中对比度未实测（U-19）；原型的 scrim 材质（`--scrim-media-strong`/`--hairline-on-media`，`tokens.css:95-96`）**定义了但实现层从未引用**（U-10） |
| Mo 动效 | **2** | `prefers-reduced-motion` 双处兜底且规则一致（`tokens.css:228`、`renderer.css:298`）；无 `@keyframes`、无悬停位移，与 `DESIGN-tokens.md:150` 一致；过渡仅 2 处且都是响应操作的反馈 |
| A 无障碍 | **0** | `aria-pressed`/`aria-current`/`aria-selected`/`tabIndex` 全仓 0 处（U-05，违反 4.1.2）；键盘 **9 项**（并集）只实现 1 项（U-02）；8 处对比度不达 1.4.3（U-03）；3 类目标 <44px（U-09，达 AA 未达 AAA 与自定值）；载入态对 AT 静默（U-04）。正向：`:focus-visible` 统一、装饰图标全 `aria-hidden`、`role=status/aria-live` 已接、语义标签齐全 |

**合计 6/12 = 50%**。按维度看：**动效与布局是达标项，颜色与无障碍是主要失分项**——而这两项恰好是"Apple 风格"最容易被感知的两项。

### 11.3 原型套件 6 页 + 总览页（设计验证资产，不随应用发布）

| 维度 | 分 | 依据 |
|---|---|---|
| L 布局 | **1** | `style.css`/`app.css` 大量阶梯外值（附录 §4：`14/22/11/10/34/15/5/9/18/13/6/23/27/21/35px` 等，其中 `style.css` 侧栏 230px 与令牌 220px 冲突）。**理由不是"粗糙"，而是 `DESIGN-tokens.md:100` 明写「接入时建议就近取整到 16、20、24」——原型自己没执行，渲染层执行了** |
| T 排版 | **1** | `style.css` 的 `font: 14px/1.45 Inter, -apple-system, …` 里 **Inter 未打包**（`UI-REVIEW:143` 已自认），且 14px 既不是 §3.2 的 `body 17px` 也不是 `caption 13px`；`tokens.css` 的 `body` 规则覆盖了字体族但**不覆盖字号**，故原型正文实际是 14px |
| C 颜色 | **1** | **21 处**硬编码色值（去重 **6 个**不同字面量，U-13 / 附录 §4.1），含被文档声称已替换的靛蓝 `#858aff`/`#8b91ff`；违反 B3 的「Avoid hard-coding system color values」。正向：`app.css` 里颜色**全部**走 `var()`（实测 0 个颜色字面量） |
| M 材质 | **2** | 材质体系完整且全部令牌化：`--scrim`/`--scrim-media`/`--scrim-media-strong`/`--hairline-on-media`（`tokens.css:93-96`）、`--shadow-float`（`:92`）、`.overlay` 的 `backdrop-filter: blur(3px)`（`app.css:60`）。这正是实现层丢掉的部分（U-10） |
| Mo 动效 | **1** | `tokens.css:228` 有 reduced-motion 兜底、`app.js:54-58` 有 Esc 关弹窗。但 `app.css:36` 的 `.card-acts{transition:opacity .12s}` 与 `style.css` 的 `.switch{transition:.15s}` 存在；无 @keyframes。residual：弹窗打开时**不做焦点转移**（见 A） |
| A 无障碍 | **1** | 正向：`文件操作确认.html:100` 的 `role="dialog" aria-modal="true" aria-labelledby="cf-t"`、`app.js:54-58` 的 Esc 关闭、`:focus-visible` 统一、`switch` 输入框有 `aria-label`（`操作记录与设置.html:4`）、toast 有 `role=status aria-live`。缺口：**`aria-pressed` 0 处**（`UI-REVIEW:16` 的声称不成立）、`app.js:43-50` 的 `openDialog` **只切 class、不移动焦点、不设焦点陷阱**（`aria-modal="true"` 因此是**未被履行**的承诺）、`文件操作确认.html:227-234` 用 `innerHTML` 拼模板数据 |

**合计 8/12 = 67%**。

**两条必须随迁移传下去的风险（对实现层是红线）**：
1. `文件操作确认.html:227-234, 231-233` 用 `innerHTML` 注入 `changes`/`checks` 的数据。这些数据来自事务日志（文件名、路径）。`src/renderer/src/main.jsx:8` 已经立了规矩「引擎返回的一切按纯文本渲染；**不用 `dangerouslySetInnerHTML`**」。**迁移时若照抄原型写法就会破这条规矩**——建议在 `UI-REVIEW` §2.6-B 旁注明。
2. `app.js:43-50` 的弹窗没有焦点陷阱。`aria-modal="true"` 的语义是"模态"，必须把焦点移入并限制在其中。带进 React 时必须换成 `@radix-ui/react-alert-dialog` 或手写焦点陷阱（`UI-REVIEW:178` 已经推荐了 Radix，此处是它的用武之地）。

---

## 12. U10 · 可执行改进清单（按严重度排序）

> 每条：**改哪个文件** + **怎么验**。P0 = 阻塞发布，P1 = 发布前，P2 = 排期，P3 = 顺手。

| 优先级 | ID | 改哪里 | 怎么验 |
|---|---|---|---|
| **P0** | U-01 | `src/renderer/src/ui/Score.jsx` —— **删除 `bandOf()` 与 `0.97/0.93`，改为消费 `item.band`**（`high/mid/low` → 文案映射表，不含任何数值比较）；`PhotoCard.jsx:38` 把 `item.band` 传给 `Score`；阈值只留引擎侧 `core/engine.mjs:25-28` 的 `BANDS`（**修法已按 B2 修正：原写"界面改按 mode 分流"，仍违反 `CONTRACT-engine-v1.md:107`**） | ① `verify_renderer_dom.mjs` 断言「**`score=0.80` 且 `band='high'` 时渲染文本必须含 high 的文案且不得含『较弱』**」（现有 fixture `:78` 已给 `band`，可直接用）；② 静态断言「`Score.jsx` 源码内不出现阈值比较」；③ `grep -rn "\.band" src/renderer/src` 必须 ≥1 命中；④ 重跑 `GS_CAPTURE` 截图确认 0.79~0.81 显示「同款区间」 |
| **P1** | U-03 | `static/prototype/tokens.css`（新增 `--score-same-fg` 等**文字专用**派生令牌，用 `color-mix` 压暗；补 `--cat-crvr-fg` 深色档）＋ `renderer.css:234,268,269` | 把附录 §3 的对比度脚本并入 `verify_renderer_styles.mjs` 作第 ⑤ 项硬门：8 组「文字/底色」断言 ≥4.5:1（含 `color-mix` 合成后的实际值），同时断言深色块覆盖全部 `--cat-*-fg` |
| **P1** | U-02 | `src/renderer/src/search/Gallery.jsx`（roving tabindex + `role="grid"`）＋ `src/renderer/src/pages/SearchPage.jsx`（全局 keydown/paste）＋ `src/renderer/src/search/PhotoCard.jsx`（Enter→onLocate） | `verify_renderer_dom.mjs` 加 4 条断言：ArrowRight 移动光标、Escape 清空并回引导块、Enter 触发 `reveal`、Ctrl+C 调 `clipboard.writeText` |
| **P1** | U-05 | `src/renderer/src/ui/Chip.jsx`（`aria-pressed`）＋ `src/renderer/src/layout/Sidebar.jsx`（`aria-current="page"`；禁用项去 `href="#"`） | `verify_renderer_dom.mjs` 断言 `aria-pressed` 单选正确、`.nav a.active[aria-current="page"]` 存在、`.nav a[href="#"]` 计数为 0 |
| **P1** | U-04 | `src/renderer/src/search/Gallery.jsx`（loading 分支加 `role="status"` 文字）＋ `SearchPage.jsx`（把 `search.meta` 传给 Gallery） | `verify_renderer_dom.mjs` 断言「search 未 resolve 时结果区有可见文本且含『检索中』，且该节点不带 `aria-hidden`」 |
| **P1** | U-06 | `static/prototype/tokens.css:36-38`（`--font-sans` 改为以 `system-ui` 开头，Apple 系 CJK 字体移到 `Segoe UI`/`Microsoft YaHei` 之后） | 新增守卫断言「`--font-sans` 首项是 `system-ui` 或本机已安装字体」；在 Windows 上截图确认西文=Segoe UI、中文=Microsoft YaHei |
| **P2** | U-07 | `tokens.css:169-173`（补 `--cat-crvr-fg` 深色档）＋ `renderer.css`（`html{color-scheme:light dark}` + `::-webkit-scrollbar` 令牌化）＋ `src/main/index.mjs:290`（`backgroundColor` 跟随 `nativeTheme`） | 守卫断言「浅色块出现的每个 `--cat-*-fg` 在深色块也出现」（当前会精确报 `--cat-crvr-fg`）；系统切深色后截图，滚动条与标签底色应随动 |
| **P2** | U-09 | `renderer.css:124,158,168` | 守卫断言三个选择器的最终 `min-height` 解析值 ≥44px（需解析 `var()` 链） |
| **P2** | U-10 | `renderer.css`（补 `.card-acts button` 的 scrim 三条属性，令牌 `tokens.css:95-96` 已存在但从未被引用）＋ `PhotoCard.jsx`（加「更多▾」） | `verify_renderer_dom.mjs` 断言卡片按钮数 = 3；样式断言 `.card-acts button` 的 `background` 不是 `--color-bg-elevated` |
| **P2** | U-11 | `SearchPage.jsx:140`（改为与 `MetricsRow.jsx:24-25` 共用同一个 `compat` 解析函数） | `verify_renderer_dom.mjs` 断言：把 lib.compat 设为含 `seq280` 后页脚含 `seq280` 且不含 `seq140` |
| **P2** | U-12 | `src/renderer/src/layout/Sidebar.jsx:28-41` | 同 U-05 的断言 |
| **P3** | U-13 | `static/prototype/*.html`（21 处内联色值 → `var()`）＋ `tools/verify_renderer_styles.mjs`（扫描根扩到 `static/prototype/`）＋ `UI-REVIEW:271`（改指现行脚本名） | `node tools/verify_renderer_styles.mjs --include-prototype` 报「原型 7 个文件无颜色字面量」 |
| **P3** | U-14 | `renderer.css:34`、`tokens.css:224`（删掉 `border-radius` 一句） | 手工：Tab 到「全部」胶囊，聚焦前后圆角一致 |
| **P3** | U-15 | `renderer.css:64` | 1440×920 截图，`.brand-sub` 的 `getClientRects().length === 1` |
| **P3** | U-16 | `Gallery.jsx:8`（删无用类）或 `renderer.css` 补 `.loading` | 把附录 §6 的 class 覆盖脚本并入守卫 |
| **P3** | U-20 | `src/renderer/src/ui/Tag.jsx:4`（`CLASS` 补 `'未分类':'uncat'`）＋ `renderer.css`（补 `.tag.uncat`）＋ `tokens.css`（清理 35 个未被引用的令牌或标注保留原因） | `verify_renderer_styles.mjs` 加第 ⑥ 项列出「定义但未被引用」的令牌；`verify_renderer_dom.mjs` 断言 folder='未分类' 的标签 class 含 `uncat` |
| **P3** | U-17 | `tools/verify_renderer_styles.mjs:104,108-116` | 改完后守卫对 `renderer.css` 应报 `303:1100px, 306:760px`，并另报 `104:6px`、`259:2px` |
| **P3** | U-18 | `SearchPanel.jsx:8-12`、`src/renderer/src/hooks/useSearch.js:27` | 断言「选 recent 时顺序与引擎一致且该项 `disabled`」 |
| **P3** | U-08 | `Gallery.jsx:50`（接 `meta`） | 断言 search resolve 后页面文本匹配 `/ms\b/` |
| **P3** | C-3 | `renderer.css:302-309`（给移动端断点加注释说明它是为将来 Web 版预留，因为 `minWindow 1040` 令其永不触发） | 代码注释即可，无需断言 |
| **P3** | §11.3-1 | `docs/design/UI-REVIEW-and-migration.md` §2.6-B 旁注明「弹窗内容必须走 React 文本渲染，不得用 `innerHTML`/`dangerouslySetInnerHTML`」 | 文档评审 |
| **P3** | §11.3-2 | 同上：注明弹窗必须换 `@radix-ui/react-alert-dialog`（`aria-modal="true"` 目前是未履行的承诺） | 文档评审 |

---

## 13. 本轮未覆盖 / 无法验证（G6）

| # | 项 | 为什么没覆盖 | 影响哪些结论 |
|---|---|---|---|
| N-1 | **应用在当前代码下的实时渲染** | `ui-final.png` 是 2026-10-10 17:35:57 的**历史**自截图（对应提交 `dcfec17`，与当前工作区一致，见 §1.1）。本轮**没有**重新运行 Electron + `GS_CAPTURE`（基线 §6 已声明本环境对 Electron 实跑未全部实测；且重新构建属于写操作，超出审查者只读范围） | §11.2 的 6 维评分基于**代码 + 该截图**的交叉核对，不是"我刚看到的新截图" |
| N-2 | **字体在 Windows 上的光学落点** | 我只能实测"哪些字体已安装"（附录 §5），**无法**测量 Chromium 在 `backdrop-filter`/`letter-spacing` 组合下的实际字形宽度与光学效果 | U-06 的"落点是 Segoe UI + Microsoft YaHei"是**实测**；"负字距在 Microsoft YaHei 上不符合设计意图"是 **【判断，非实测】** |
| N-3 | **顶栏毛玻璃在滚动中的对比度** | 需要滚动状态下截图；现有截图是顶部静止状态 | U-19 只挂账，未定性 |
| N-4 | **缩略图的裁剪/留白策略** | `renderer.css:246-247` 用 `aspect-ratio: 4/3` + `object-fit: cover`，而 `thumb://` 的输入是 `@256`（`PhotoCard.jsx:25`）。正方形缩略图被 cover 进 4:3 会裁掉上下约 25%，但**裁掉的是哪部分**取决于 `src/main/index.mjs:270-283` 的生成策略，本轮只读到"生成 JPEG 缓存"这一层，未追进去验证 `resize` 的 fit 参数 | 若裁的是内容主体，会直接影响"看图选料"这一核心任务。**建议 Lead 派专人核 `src/main/index.mjs` 的 thumb 生成分支** |
| N-5 | **深色模式的实际渲染** | 本机 `prefers-color-scheme` 状态未知，未做系统切深色的截图对比 | U-07 的 3 项均基于 CSS 静态分析（`--cat-crvr-fg` 缺失、无 `color-scheme`、`#f5f5f7` 硬编码），这三条是**代码事实**，不依赖渲染 |
| N-6 | **原型 6 页在浏览器里的实际渲染** | 未启动浏览器打开原型；`ui-components.png`（17:19）虽截了原型，但早于最终构建且侧栏未出现在画面内 | §11.3 的原型评分基于 **HTML/CSS 源码**，不是渲染截图 |
| N-7 | **`G:\model` 与真实索引** | 基线 §6 已标"未核实"；`verify_renderer_dom.mjs` 用的是 jsdom + mock（`L1 3594/3594 dim=768 healthy=true`，见其输出），**不是**真实素材库 | U-01 的"全部结果被标较弱"论断有 `ui-final.png` 的真实检索截图支撑（4 张卡实测 0.7943~0.8147），但**样本量只有一次查询** |
| N-8 | **`increased contrast` / `prefers-contrast`** | 仓库 0 处实现，本报告只做"缺失"的事实陈述，未评估开启该系统设置后的实际表现 | U-07 的建议里包含补该变体，但**未给具体色值**（需要重新走一遍 B3 规格表的四列） |
| N-9 | **屏幕阅读器实测** | 本环境无法运行 NVDA/Narrator 做真人走查 | U-05 的 aria 缺失是**静态**判定（grep 0 命中 + WCAG 4.1.2 条文），不是"读屏实测" |

---

## 14. 自检表（G1-G7 逐条）

| 门 | 判据 | 自检 | 理由 |
|---|---|---|---|
| **G1** | 每个「已验证」结论都能追溯到 `文件:行号` 或命令+输出 | ✅ 通过 | 全文 20 条问题、7 项 U 答案、6 维评分**每条**都带 `文件:行号`；命令类证据（两个 `verify_*.mjs`、grep、字体注册表、对比度脚本、class 覆盖脚本、令牌使用率脚本）的**原始输出**全部落在 `docs/audit/uiux-evidence.md`。无法实测的两处已显式标 `【判断，非实测】`（U-06 的光学落点、U-19 的滚动对比度） |
| **G2** | 每条结论明确标记 代码事实 / 文档声称 / 行业做法 | ✅ 通过 | 每条问题头部都有「类别：」行，用 `【代码事实】`/`【文档声称】`/`【行业做法】`/`【判断，非实测】` 四类标注（例：U-01 标「代码事实 + 文档声称」，U-19 标「代码事实 + 判断，非实测」）。§3.1 另设「基准源自 Apple 官方 / W3C 标准 / 第三方镜像」的三分声明 |
| **G3** | 与基线零冲突 | ⚠️ **部分满足**（B4 修正） | **对齐的部分（4 处，已核实）**：① 只完成 1 页（基线 §1）→ §1 与 §8.2 采用；② `renderer.css` 只消费 `var()` 且有守卫（基线 §2）→ 与守卫实测输出一致；③ `reveal` 静默成功 D6（基线 §5）→ 本报告未重复主张，仅在其用户可见面上提及 `src/renderer/src/hooks/useSearch.js:80` 的 toast 文案；④ Electron 实跑未全部实测（基线 §6）→ 写入 N-1。**冲突的部分（1 处，已登记）**：U-01 的定级与基线 §5.1.1 的旧文字冲突 —— 详见下方「14.2 与基线的定级分歧」。**本行原写"未发现与基线冲突的结论"，属漏登记，已按 B4 更正。** |
| **G4** | 每条问题按 §3 公式给分，不得只写高/中/低 | ✅ 通过 | 20 条全部给出 `Score = 影响面 × 触发可能性` 的**两个因子与乘积**（例 U-01 = 3×3 = 9）。§11 的评分另用独立的 0/1/2 六维口径，并在 §11.1 先声明通过条件 |
| **G5** | 每条给定「改哪里 + 怎么验」 | ✅ 通过（B2 修正后） | 20 条问题每条都有「改哪里」与「怎么验」两行；§12 汇总表把「怎么验」全部落成**可执行的断言或命令**。**注**：U-01 的「改哪里」原写成"界面再自建一张 mode 档位表"，方向错误（仍违反 `CONTRACT-engine-v1.md:107`），已按 B2 改为**消费 `item.band`**；本门因此在修正前应为"部分满足" |
| **G6** | 报告末尾必须有「本轮未覆盖 / 无法验证」一节 | ✅ 通过 | §13，共 9 项（N-1 ~ N-9），每项都说明"为什么没覆盖"与"影响哪些结论" |
| **G7** | 中文 | ✅ 通过 | 全文中文（代码标识符、文件路径、CSS 变量名、HIG 原文引用保留英文原文） |

### 14.1 给 Lead 的两条回写建议（基线只有 Lead 能改）

1. **基线 §5 的 D1** 称「多出的是 `verify-doc-refs.mjs`（文档死引用守卫，全仓无一处提到它）」。本轮实测 `tools/` 有 **7 个 `.mjs`**，与基线一致；但另有一处**基线未列**的文档-工具不一致：`UI-REVIEW-and-migration.md:271` 指定的 `tools/verify_tokens.py` **已不存在**（Python 退役）。建议并入 D1 或新增 D7。
2. **基线 §5 D5** 把 `ingest/mutate/indexStart/indexCancel` 的"契约先冻结、实现显式拒绝"列为"待判定"。**UI 侧补充事实**：`SearchPage.jsx:99-100` 的「＋ 添加图库」与「↻ 更新索引」两个按钮**不 disabled**，点击后弹 toast「「添加图库（P5）」还没实现」/「「更新索引（P3d/P4）」还没实现」。即引擎拒绝 + 界面按钮可点 + 明确 toast —— 符合判据 §3「死功能必须记录用户实际会看到什么」的**正向做法**，建议在 D5 定性时记为"设计取舍（诚实降级）"而非缺陷。

### 14.2 与基线的定级分歧（B4 登记）

| 项 | 内容 |
|---|---|
| 分歧对象 | U-01（档位阈值 / 契约违反）的**等级** |
| 本报告判定 | **Critical（3 × 3 = 9）** |
| 基线旧文字 | `docs/audit/00-current-state.md:146`（§5.1.1）曾写「定级：契约违反 + 用户可感知的错误结论 ⇒ **High（Score 6）**」 |
| 基线旧文字（自相矛盾） | 同一基线 `:115`（D11 行）写的是「第②条审查独立发现同一处，判 **Critical 9**，含截图实证」 |
| 独立复核者复算 | `docs/audit/REVIEW-UIUX-AUDIT.md` §4 S-R1：独立得出 **9 / Critical**，与本报告一致 |
| **Lead 裁决（已执行）** | 基线已统一为 **Critical（3×3=9）**，`00-current-state.md:146` 原地留了更正说明（该行现含「本行曾写「High（Score 6）」，与本文 `:115` 的「Critical 9」自相矛盾 —— 由第②条审查的独立复核发现（blocker B4）。Lead 复核后统一为 Critical 9」）。理由：① 触发可能性是 **3 而非 2**（不是"特定动作下发生"，是**每次文本检索必然发生**）；② 判据 §3 对 Critical 的定义「功能静默失败且用户无感」完全命中；③ 复核者用不同路径**也**算出 9 |
| 本报告的处置 | ① 定级**保持 Critical 9**，不再改动；② 在 G3 行如实登记该分歧（原为沉默，已更正）；③ §5 的 U-01「类别」行由"【代码事实】冲突"升级为"**【文档声称】（书面契约）被【代码事实】违反 + 引擎产出被丢弃**"，与基线 §5.1.1 的契约定性对齐 |

> 处置结论：**分歧已由 Lead 裁决并已回写基线，本报告与新基线一致（4/4 复算一致）**。此处保留登记以便二次复核追溯。

---

## 15. 交付物与写入范围

| 文件 | 说明 |
|---|---|
| `UIUX-AUDIT.md` | 本文件（主交付物） |
| `docs/audit/uiux-evidence.md` | 原始证据附录：命令、输出、脚本、逐项数值表 |
| `docs/audit/notes-uiux-auditor.md` | 未使用（无需额外笔记） |
| `docs/audit/REVIEW-UIUX-AUDIT.md` | **他人产物**（复核人 `review-2`），只读引用，**未改动**；其 blocker/minor 的处置见 §16 |

**未修改任何他人 write-scope 内的文件**：`src/`、`static/`、`docs/design/`、`docs/spec/`、`tools/`、`package.json`、`core/` 均**只读**。所有脚本均以 `$code | node -` 形式从 stdin 执行，未落盘。

---

## 16. 独立复核 B1-B4 与 minor m1-m5 的处置记录

- 复核来源：`docs/audit/REVIEW-UIUX-AUDIT.md`（复核人 `review-2`，任务 `task-4`）
- 复核 `verdict`：`pass-with-issues`，4 条 blocker，5 条 minor，**无一条实质性结论被推翻**（10/10 行号命中、7/7 WCAG 复算命中、8 组 Apple 色值逐位一致、字体注册表逐项一致）
- 本节记录**本轮**（作者侧）对每条 blocker / minor 的处置。复核文件本身**只读，未改动**。

### 16.1 Blocker 处置（B1-B4）

| ID | 复核指出的问题 | 处置 | 落在哪里 |
|---|---|---|---|
| **B2** | U-01 漏掉契约层，且**修法方向本身违反 `CONTRACT-engine-v1.md:107`** | **已按"消费 `item.band`"重写**。① 定性由"四套阈值并存（选型问题）"升级为「**书面契约被违反 + 引擎产出被丢弃**」；② 新增三段式证据：**契约**（`CONTRACT-engine-v1.md:107` 与 `:114` 原文 + `core/engine.mjs:18-20` 引擎自己的注释「界面只能用引擎给的 band」）、**引擎照做**（`core/engine.mjs:25-28` `BANDS`、`:30-35` `bandOf`、`:227` `band: bandOf(r.score, mode)`）、**界面无视**（`Score.jsx:2-7` 源码 `item.band` 0 命中）；③ 「改哪里」改为**删除 `bandOf()` 与两个阈值，消费 `item.band`，阈值只留引擎侧共享常量**；④ 验收改为「`score=0.80` 且 `band='high'` 时不得渲染『较弱』」+「`Score.jsx` 源码内不得出现阈值比较」 | §5 U-01（重写）· §12 P0/U-01 行 · §14 G5 行 |
| **B1** | §4.2 的 5 个 Apple pt 值**在报告内无出处**，且附录把它描述成"没有数值表" | **三处矛盾已消除**：① §4.2 表格前新增完整出处段 —— 规范页 B2 + 镜像 M4（给出 jsDelivr 路由与 HTTP 200），并点名用到的两张表（`macOS built-in text styles`、`Ensuring legibility` 平台默认/最小字号表）及 iOS 的 Body 17 / Callout 16 取自 `Large (default)` 表；② 附录 §9 的 M4 行由"条文版（无字号数值表）"**改为如实描述**（列出该文件含 12 张 Dynamic Type 表 + macOS/tvOS/watchOS 表 + 5 组 tracking 表，并注明 §4.2 全部 pt 值取自它）；③ **删掉**附录"未取到的"里那句「本报告没有把 macOS 文本样式的具体 pt 值当作 Apple 官方数值来断言」，改为事实陈述 | §4.2（新增出处段 + 表格增补 iOS/macOS 对照）· 附录 §9 M4 行与"未取到的"段 |
| **B3** | U-13/§4.1 把"**21 次出现**"写成"**21 个不同字面量**"；且附录自证矛盾、正文枚举漏了 `#8b91a0` | **口径统一为「21 处（出现）· 去重 6 个不同字面量」**：① 附录 §4.1 的明细块改为**两行分开**（`合计 = 21 次（出现）` / `去重后不同字面量 = 6 个`），并新增"每个字面量出现的页数"块（`#c4c7d0`×7 / `#8b91ff`×5 / `#858aff`×4 / `#a56a12`×2 / `#454b58`×2 / `#8b91a0`×1），附口径更正说明与"68 处 / 37 个值属合法令牌定义、不计入"的边界声明；② §4.1 正文枚举**补上 `#8b91a0`**；③ U-13 标题与正文、§11.3、§12 四处统一为「21 处 / 去重 6 个」 | §4.1 · §5 U-13 · §11.3 · §12 · 附录 §4.1 |
| **B4** | §14 G3 自称"与基线零冲突"，但 U-01 定级与基线 `:146` 的旧文字冲突且未登记 | ① §14 **G3 行改为「⚠️ 部分满足」**，把"对齐的 4 处"与"冲突的 1 处"分开写；② 新增 **§14.2「与基线的定级分歧」**，完整登记：本报告 9/Critical ↔ 基线 `:146` 旧文字 6/High ↔ 基线 `:115` 9/Critical（基线自相矛盾）↔ 复核者独立复算 9/Critical ↔ **Lead 已裁决统一为 Critical 9 并原地留更正说明**；③ 定级**保持 Critical 9 不变** | §14 G3 行 · §14.2（新增） |

### 16.2 Minor 处置（m1-m5）

| ID | 问题 | 处置 |
|---|---|---|
| **m1** | U-02 标题「6 项」与 UI-REVIEW 的 5 项、DESIGN-app-details 的 7 行、正文自列的 7 项、§7 的"6-7 项"**四个数字互不相等** | **统一为**标题「UI-REVIEW 要求 **5** 项 / DESIGN-app-details 要求 **7** 项 + 2 条（拖放 / 粘贴）」；正文证据段改为**分文档列计数**（UI-REVIEW 5 项原文照引；DESIGN-app-details 表 7 行 + `:85-86` 另 2 条），并把原先的散文枚举换成 **9 行对照表**（逐项标 ✅/❌），消除"6/7"歧义 |
| **m2** | §5 U-20「**13 个**旧变量桥接」实为 **16**，且"其余 30 个"与其后枚举加总不上 | **改为 16**（并注明"此处原写 13，与本报告附录 §6.4 的 16 不一致，已更正"）；同时把"其余 30 个"重构为**配平式**：「8 个真死令牌 + 27 个（**16** 桥接 + **11** 结构性预留）= 35」，并逐条列出 11 个结构性预留令牌 |
| **m3** | `useSearch.js` 只写 basename，实际在 `hooks/` 而非 `search/` | **全文统一为全路径** `src/renderer/src/hooks/useSearch.js`（共 6 处：§7 U-04、§5 U-08 两处、§5 U-18 两处、§5 U-20、§12 P3/U-18） |
| **m4** | 「**全仓** grep `item.band` 0 命中」措辞过宽（`.md` 里有 4 处引用） | 已在 U-01 重写时改为「**源码里** `item.band` 0 命中」，并可由复核者的 `.md` 命中（`AUDIT-FINAL.md:77,118`、`00-current-state.md:115,142`）反证措辞已收窄 |
| **m5** | §5 U-02 说 `DESIGN-app-details.md:75-83`「**另加** `Ctrl+Shift+C` 取件」，但该键本就在 `:81` 表内 | **已去掉"另加"**：改写为「`Ctrl+Shift+C`（取件，`:81`，**在本表内、非"另加"**）」，并把整窗拖放 / `Ctrl+V` 粘贴明确归到 `:85-86` 的**额外 2 条** |

### 16.3 复核者肯定、本报告未改动的部分

以下经复核独立验证一致，**未作任何改动**（避免把已核实的结论改坏）：§1.1 截图时间线（复核者 `R5` 反向验证后"反而加强"）、U-03 全部 8 组对比度、U-05 的 aria 0 命中、U-06 字体注册表、U-13/U-17/U-20 的其余论证、§3.1 的 Apple/HIG/W3C/镜像三分披露、U9 无主观形容词（复核者搜 13 个词仅命中 3 句**主动拒绝主观化**的表述）、§13 的 9 项未覆盖登记。

### 16.4 本轮处置后的自评

| 项 | 状态 |
|---|---|
| 4 条 blocker | **全部处置**（B1 三处矛盾已消、B2 修法方向已改为消费 `item.band`、B3 口径已统一、B4 已登记并新增 §14.2） |
| 5 条 minor | **全部接受并处置** |
| 结论方向 | **无一条实质性结论被推翻或修改等级**（U-01 仍为 Critical 9；U-03/U-06/U-13 定级不变） |
| 门状态（修正后） | G1 ✅ · G2 ✅ · **G3 ⚠️→✅**（分歧已登记且 Lead 已裁决）· G4 ✅ · **G5 ⚠️→✅**（U-01 修法方向已修正）· G6 ✅ · G7 ✅ |
| 新增章节 | §14.2（基线定级分歧登记）· §16（本处置记录） |
| 未改动他人文件 | ✅ `REVIEW-UIUX-AUDIT.md`、`AUDIT-FINAL.md`、`00-current-state.md`、`STACK-AUDIT.md` 及任何源码/静态资源**均未改** |

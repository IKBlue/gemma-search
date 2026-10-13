# UI-KIT · 官方 macOS UI Kit 基线 + 应用对差

> **定位（先说清，避免变成第二份令牌来源）**：本文是**参照与对差**文档 —— 回答"Apple 官方的数值是多少、我们差多少"。
> **令牌的唯一来源仍是** `packages/design-tokens/tokens.css`（可执行）与 `docs/design/DESIGN-tokens.md`（说明）。
> 本文**不定义**任何应用令牌；下面出现的"目标值"一律是**建议**，落地要改 `tokens.css` 并跑样式断言。
>
> **与审查报告的关系**：`docs/audit/UIUX-APPLE-STYLE-AUDIT.md` §1.3 曾声明"Apple HIG 页面是 SPA、正文取不到 ⇒ HIG 参考值一律标【判断，非实测】"。
> 本文把那一列**换成实测值**，并给出可复算的生成器。报告的编号（`V-nn`）与本文的 A–E 表互为引用。

---

## 1. 这份文档是什么 / 不是什么

| | 是什么 | 不是什么 |
|---|---|---|
| 内容 | 官方 UI Kit 的**数值事实**：共享色板、文字样式、图层样式配方、控件尺寸 | **不是** HIG 条款文本（"破坏性操作必须先确认"这类规则仍要引 HIG 章节） |
| 用途 | 给"我们的值与官方差多少"提供**可回归**的基线；给实现选目标值 | **不是**设计灵感集，也不是可以直接抄的外观资产 |
| 变更 | 由生成器写入（见 §3），**不要手改生成区块** | 不承担"令牌定义"职责（那是 `tokens.css`） |
| 资产 | 只记录**数值与名称** | 不含 SF 字体、不含 Apple 图形素材（授权，见 §2） |

## 2. 数据来源与授权边界

- 来源：一份**外部解包的 Apple UI Kit**（Sketch 文件格式 v100+，实为 ZIP：`document.json` / `meta.json` / `pages/*.json` / `images/` / `fonts/`）。
  路径**不写进仓库**（`AGENTS.md` §7 禁止本机绝对路径），由 `--kit` 参数或 `MACOS_UIKIT_DIR` 环境变量传入。
- 抽取到的版本信息见下方生成区块的"数据源"行（Sketch 版本 / appVersion / build）——**引用本文数值时必须带上这一行**。
- **授权边界（硬）**：kit 内嵌的 SF 字体与图形**不得再分发**。本文与 `index.html` 只保存**数值、名称与自绘色块**，不含任何 Apple 二进制资产。
- 同理，`index.html` **不内嵌 SF 字体**：本机（Windows）没有 SF Pro，字号示例会用回退字体渲染 —— **字号是准的，字形不是**。

## 3. 怎么重新生成

```sh
# ① 从外部 kit 重新抽取数据，并重新生成 HTML 与本文的生成区块
node docs/design/ui-kit/build.mjs --kit "<Apple macOS UI Kit 目录>"

# ② 只重新生成 HTML / 生成区块（离线，用已入库的 kit-data.json）
node docs/design/ui-kit/build.mjs
```

产物与职责：

| 文件 | 进 git | 职责 |
|---|---|---|
| `docs/design/ui-kit/build.mjs` | ✅ | 生成器：抽取 + 渲染（唯一实现，别手写第二份） |
| `docs/design/ui-kit/kit-data.json` | ✅ | **抽取后的数据快照** —— 有了它，不接触外部 kit 也能重生成 |
| `docs/design/ui-kit/index.html` | ✅ | 可视化参照页（静态、零 JS、零外链，双击即开）。**含 4679 个组件的全量画廊**，约 1.2MB —— 大是刻意的：每个组件都要能单独看到 |
| 本文的生成区块 | ✅ | 与 HTML 同源同一次生成 |

> 生成器**不写时间戳**（避免每次运行都产生无意义 diff）；版本信息来自 kit 自身。

## 4. 基线数据（生成区块）

<!-- BEGIN GENERATED：由 docs/design/ui-kit/build.mjs 生成，勿手改 -->

**数据源**：Sketch v190 · appVersion 2026.2 · build 231037 · 37 页 · 70 个字体引用 · 共享色板 110 · 共享文字样式 67 · 共享图层样式 285。

### A. 系统色（官方 vs 应用）

| 色 | 应用令牌 | 官方 Light | 官方 Dark | 应用 Light | 应用 Dark | 判定 |
|---|---|---|---|---|---|---|
| Red | --color-critical | #ff383c | #ff4245 | `#ff3b30` | `#ff453a` | 不一致 |
| Orange | --color-warning | #ff8d28 | #ff9230 | `#ff9f0a` | `#ff9f0a` | 不一致 |
| Green | --color-success | #34c759 | #30d158 | `#34c759` | `#30d158` | 一致 |
| Blue | --color-accent | #0088ff | #0091ff | `#0071e3` | `#2997ff` | 不一致 |

### B. 文字阶梯（官方 8 档）

| 字号 | 行高 | 样式名 |
|---|---|---|
| 26px | 32 | 01 LargeTitle · Loose Leading · Tight Leading |
| 22px | 26 | 02 Title1 · Loose Leading · Tight Leading |
| 17px | 22 | 03 Title2 · Loose Leading · Tight Leading · Secondary Style |
| 15px | 20 | 04 Title3 · Loose Leading · Tight Leading |
| 13px | 16 | 05 Headline · 06 Body · Loose Leading · Tight Leading |
| 12px | 15 | 07 Callout · Loose Leading · Tight Leading |
| 11px | 14 | 08 Subheadline · Loose Leading · Tight Leading |
| 10px | 13 | 11 Caption2 · 10 Caption1 · 09 Footnote · Loose Leading · Tight Leading |

### C. 控件尺寸（官方实测）

| 档 | 高度（众数） | n | 取值集合 |
|---|---|---|---|
| Mn | 16px | 176 | 16 |
| Sm | 20px | 176 | 20 |
| Rg | 24px | 176 | 24 |
| Lg | 28px | 176 | 28 |
| XL | 36px | 176 | 36 |

侧栏：行高众数 40px · 面板宽众数 240px。

### D. Alerts 按钮变体

| 变体 | 尺寸 | 填充 |
|---|---|---|
| Dark / Buttons / Cancel | 228×28 | — |
| Dark / Buttons / Destructive | 228×28 | #ff4747 |
| Dark / Buttons / Preferred | 228×28 | — |
| Light / Buttons / Cancel | 228×28 | — |
| Light / Buttons / Destructive | 228×28 | #f52f32 |
| Light / Buttons / Preferred | 228×28 | — |

### E. 样式配方

| 样式 | 填充 | 描边 | 不透明度 |
|---|---|---|---|
| `Global/Focus Ring` | — | 3.5px #0088ff 1px #0088ff | 1 |
| `Content Area/Light/04 - Prominent (Default)/01 - Idle` | #0088ff #000000 | — | 1 |
| `Content Area/Light/03 - Bordered Destructive/01 - Idle` | #ff383c #000000 | — | 0.2 |


### F. 组件家族（4679 个组件 → 543 种样式）

| 外观来源 | 组件数 | 说明 |
|---|---|---|
| 形状（填充/描边/阴影） | 2280 | HTML 里可直接画出 |
| SF Symbol 字形 | 1622 | 外观是字形，本机无 SF 字体 ⇒ 无法可视化（HTML 里标为字形） |
| 无外观层 | 777 | 纯容器/嵌套符号 |

| 家族 | 组件数 | 不同样式 |
|---|---|---|
| Buttons | 880 | 116 |
| Sliders | 836 | 32 |
| Titlebars and Toolbars | 396 | 72 |
| Toggles - Radio Buttons | 300 | 11 |
| Toggles - Checkboxes | 300 | 11 |
| Segmented Controls | 294 | 21 |
| Sidebars | 220 | 52 |
| Toggles - Switches | 210 | 9 |
| Steppers | 200 | 34 |
| Progress Indicators | 192 | 9 |
| Menus | 126 | 75 |
| Pop-up and Pull-down Buttons | 120 | 30 |
| Disclosure Controls | 120 | 20 |
| Menu Bar and Dock | 114 | 16 |
| Search Fields | 76 | 40 |
| Windows | 60 | 42 |
| Text Fields | 60 | 9 |
| Combo Boxes | 40 | 10 |
| Color Wells | 34 | 6 |
| Popovers | 24 | 2 |
| Pointers | 22 | 3 |
| Alerts | 14 | 8 |
| Forms | 13 | 8 |
| Notifications | 9 | 6 |
| Kit | 7 | 5 |
| Scrollbars | 4 | 2 |
| Image Wells | 2 | 1 |
| Tooltips | 2 | 2 |
| Group Boxes | 2 | 1 |
| Dialogs | 2 | 2 |

### G. 状态与修饰词（原样保留，不归一）

| 维度 | 取值 |
|---|---|
| 外观 | Light · Dark · — |
| 表面 | — · Content Area · Over-glass |
| 尺寸档 | Mn · Sm · Rg · Lg · XL |
| 状态段（去重 197 种） | +100% · +50% · -100% · -50% · 0% · 01 - Idle · 03 - Clicked · 04 - Disabled · 1 · 1 - Clicked · 1 - Default · 1 - Idle · 1 Idle · 1 Mn · 1 Selected · 100% · 2 · 2 - Hover · 2 - Selected · 2 Hover · 2 Selected · 2 Sm · 25% · 3 · 3 - Button Clicked · 3 - Clicked · 3 - Field Clicked · 3 - Open · 3 - Selected · 3 -Open … |
| 修饰词组合（去重 17 种） | Active · Active, Checked · Active, Mixed · Active, Off · Active, On · Active, Unchecked · Down · Inactive · Inactive, Checked · Inactive, Mixed · Inactive, Off · Inactive, On · Inactive, Unchecked · Non-Visible Fill · Off · On · Up |

> **全量画廊在 HTML 里**：`docs/design/ui-kit/index.html` 的第 8 节把 **4679 个组件逐个**渲染出来（按族分组、全部展开）。

<!-- END GENERATED -->

## 5. 怎么用（三条）

1. **给审查报告换掉【判断，非实测】**：报告 §4.2 的"HIG 参考值"列、§5.1 的排版阶梯、以及 `违规的UI.md` 的 V-07/V-08/V-33/V-38，都可以直接引 A–E 表里的实测值。
2. **给实现选目标值**：例如把 V-38（控件尺寸）从"违反项目自定 44px"改成"对照官方 Mn–XL 五档，确认桌面档位"——官方 C 表给出了每档的高度众数与样本量。
3. **当回归锁**：`kit-data.json` 入库后，将来升级 kit 只要重跑一次，A–E 表的差异就是**可 diff 的变更**，不必靠人眼看设计稿。

## 6. 未取到的 / 不能声称的

| 项 | 状态 |
|---|---|
| HIG **规则类**条文（如"破坏性操作要先确认"） | ❌ kit 不含；仍须引 HIG 章节名（HIG 正文本轮取不到，见报告 §1.3） |
| 运行时**材质合成**结果 | ❌ kit 给的是设计稿的透明实色；`backdrop-filter` 的实际合成与系统设置相关 |
| 交互**时延/动效曲线** | ❌ kit 是静态设计稿，没有时长与缓动 |
| 同一档的**多取值** | ⚠️ 若某档出现多个高度，C 表会列出"取值集合"而不四舍五入；以众数为准时请同时看 n |
| 非 macOS 平台（iOS/tvOS/watchOS/visionOS） | ❌ 本 kit 是 macOS 桌面 kit，不外推到其他平台 |
| 本机字形 | ❌ 无 SF Pro ⇒ HTML 的字号示例不是 SF 的字形 |

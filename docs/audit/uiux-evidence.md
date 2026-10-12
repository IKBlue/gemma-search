# uiux-evidence · 宪章② 原始证据附录

> 配套主报告：`UIUX-AUDIT.md`。本文件只放**原始输出与复算脚本**，不做结论（结论在主报告）。
> 所有脚本均以 `$code | node -` 从 stdin 执行，**未创建任何文件**。
> 采集时间：本轮审查（2026-10-12），仓库 HEAD `4555c1b`，渲染层对应 `dcfec17`。

---

## §1 grep 原始输出（只读检索）

### 1.1 `--touch-min` 与相关控件令牌的引用点

```
$ grep -rn "touch-min|control-icon-btn|prefers-color-scheme|data-theme|nativeTheme" src/renderer
src/renderer/src/renderer.css
Line 76:   min-height: var(--touch-min);
Line 124:  width: var(--control-icon-btn); height: var(--control-icon-btn);
Line 152:  min-height: var(--touch-min);
```

→ 结论：`--touch-min` **确实被使用**（2 处直接 + 1 处经 `--control-search-height` 间接）。`prefers-color-scheme` 在 `src/renderer` 下**0 命中**（深色模式完全由 `static/prototype/tokens.css` 提供）。`nativeTheme` **0 命中**（主进程不感知系统主题）。

### 1.2 `aria-*` 状态类属性（`aria-pressed` / `aria-current` / `aria-selected` / 焦点序）

```
$ grep -rn "aria-pressed|aria-current|aria-selected|role=\"radiogroup\"|tabIndex|tabindex" src/renderer/src
src/renderer/src/ui/Chip.jsx
Line 1: // Chip —— 筛选胶囊（原型：.chip / .chip.active，选中态是 `active` 而不是 aria-pressed）
```

→ 全仓 **1 处命中，且是注释**。即实现层 `aria-pressed`/`aria-current`/`aria-selected`/`tabIndex` **均为 0 处**。

```
$ grep -rn "aria-pressed|aria-current|data-sidebar|data-theme|prefers-color-scheme|171923" static/prototype
static/prototype/app.css
Line 2:   @media (prefers-color-scheme: dark){
static/prototype/tokens.css
Line 62:      在 <html> 上加 data-sidebar="dark" 即可（见文件末）。 */
Line 154: @media (prefers-color-scheme: dark) {
Line 155:   :root:not([data-theme="light"]) {
Line 177: :root[data-theme="dark"] {
Line 200:    若希望**始终深色侧栏**，在 <html> 上加 data-sidebar="dark"。
Line 202: :root[data-sidebar="dark"] {
```

→ 原型侧同样 **0 处 `aria-pressed`**；**`171923` 0 命中**；`data-sidebar` 只出现在 `tokens.css` 的注释与规则定义里，**没有任何 HTML 使用它** → 6 个原型页渲染的都是浅色侧栏（`--sidebar-bg` 默认 = `--color-bg-secondary` = `#f5f5f7`）。

### 1.3 键盘事件处理

```
$ grep -rn "onKeyDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape|ctrlKey|metaKey" src/renderer/src
src/renderer/src/search/SearchPanel.jsx
Line 26:          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
src/renderer/src/ui/SearchBox.jsx
Line 6: const SearchBox = forwardRef(function SearchBox({ value, onChange, onKeyDown, placeholder, ariaLabel }, ref) {
Line 17:         onKeyDown={onKeyDown}
```

→ 仅 **Enter** 一项被实现。

### 1.4 `useSearch.meta` 的消费者

```
$ grep -rn "meta" src/renderer/src --include=*.jsx
src/renderer/src/search/PhotoCard.jsx
Line 1: // PhotoCard —— 结果卡（原型：.photo-card > .photo(img + .card-acts) + .card-info(.card-title + .card-meta)）
Line 36:        <div className="card-meta">
```

→ `meta` 在 `.jsx` 里**只以 `card-meta` 类名形式出现**；`useSearch` 返回的 `meta` 状态**无任何消费者**（7 处写入见 `useSearch.js:17,46,53,59,64,74,97`）。

### 1.5 分数档位 / 阈值相关的全部命中（节选）

```
$ grep -rn "0\.97|0\.93|0\.88|同款区间|同类区间|很接近" （全仓，250+ 命中，节选）
docs/design/UI-REVIEW-and-migration.md:38: | `98% 匹配` | **`0.9396` + 区间标签**（同款区间/同类区间） | …实测区间有明确语义（图→图 ≥0.88 为同款；文本→图 0.74~0.80） |
docs/design/DESIGN-app-details.md:66: | 分数 | 保留 3 位小数；**并排显示区间提示**（"同款区间"/"同类区间"/"较弱"）…
docs/spec/SPEC-acceptance.md:71: | 余弦 < 0.97 的条目 | **不参与判定**，但必须在报告里给出**数量与分位数**…观察项
static/prototype/index.html:124: …余弦 **0.74~0.94**，且分区间有意义（同款 ≥0.88 / 文本 0.74~0.80）…
static/prototype/tokens.css:81:  /* 分数区间（同款 / 很接近 / 较弱）—— 与类别色无关，独立登记 */
static/_archive/app-ui-mockup.html:594: if (score >= 0.78) return ['same','很接近'];
static/_archive/app-ui-mockup.html:600: if (score >= 0.88)  return ['same','同款区间'];
tools/verify_renderer_dom.mjs:78: { libId:'L1', uid:'022a00481875', score: 0.9312, band: 'high', … }
```

→ 四套互不相同的档位定义（详见主报告 U-01）。

```
$ grep -rn "band" tools/verify_renderer_dom.mjs
Line 78: { libId: 'L1', uid: '022a00481875', score: 0.9312, band: 'high', folder: 'VR', stem: 'ID-032109719124396',
Line 80: { libId: 'L1', uid: '022a00481876', score: 0.81, band: 'mid', folder: 'CR', stem: 'ID-11',
Line 83: { libId: 'L1', uid: '022a00481877', score: 0.5, band: 'low', folder: '其他', stem: '',
```

→ 守卫 fixture 的 `band` 取值域是 `high|mid|low`，而 `src/renderer/src/ui/Score.jsx` 的 `bandOf()` 取值域是 `same|like|weak`。**两个取值域不相交**，即该 fixture 与当前 UI 代码不同源。

### 1.6 `--type-micro`（11px）的使用点计数、`color-scheme` 与滚动条

```
$ Select-String -Path src\renderer\src\renderer.css -Pattern "type-micro"
28:  .small { font-size: var(--type-micro); }
64:  .brand-sub { font-size: var(--type-micro); color: var(--sidebar-muted); margin-top: var(--space-1); letter-spacing: .04em; }
67:  font-size: var(--type-micro); letter-spacing: .12em; color: var(--sidebar-muted);      ← .nav-label
91:  font-size: var(--type-micro);                                                          ← .side-note
137: .eyebrow { font-size: var(--type-micro); color: var(--color-accent); font-weight: 700; letter-spacing: .1em; }
224: .metric-top { … font-size: var(--type-micro); }
233: .metric-note { font-size: var(--type-micro); color: var(--color-text-secondary); }
257: .card-meta { … font-size: var(--type-micro); }
262: font-size: var(--type-micro); font-weight: 600;                                        ← .tag
count = 9
```

```
$ Select-String -Path src\renderer\src\*.css, static\prototype\*.css, src\renderer\index.html \
    -Pattern "prefers-contrast|forced-colors|color-scheme"
app.css:2:    @media (prefers-color-scheme: dark){        ← 子串命中，不是 color-scheme 声明
tokens.css:154: @media (prefers-color-scheme: dark) {      ← 同上
```

→ `color-scheme` 声明 **0 处**、`prefers-contrast` **0 处**、`forced-colors` **0 处**。即：
① Electron/Chromium 不知道文档支持深色 → 深色系统下仍渲染浅色原生滚动条与原生控件（主报告 U-07 第 2 项）；
② 仓库**一个 increased-contrast 变体都没有**（HIG Color 明确要求为每个自定义色提供它）。

```
$ Select-String -Path src\renderer\src\renderer.css, static\prototype\style.css, static\prototype\app.css, \
    static\prototype\tokens.css, src\renderer\index.html -Pattern "scrollbar"
0 命中
```

→ 滚动条完全未样式化（主报告 U-07 第 2 项的旁证；`ui-final.png` 右缘可见常驻浅灰滚动条）。

---

## §2 两个守卫脚本的原始输出

### 2.1 `node tools/verify_renderer_styles.mjs` → exit 0

```
================================================================================================
渲染层令牌纪律（docs/design/DESIGN-tokens.md §12）
  CSS 1 个 · JSX 22 个 · 令牌表 static\prototype\tokens.css

--- 1) 颜色字面量（hex / rgb / hsl）---
  [OK  ] src\renderer\src\renderer.css 无颜色字面量
  [OK  ] src\renderer\src\App.jsx 无颜色字面量
  …（其余 21 个 .jsx 全部 [OK]）…

--- 2) 内联样式（只允许数据驱动的 width）---
  [OK  ] src\renderer\src\App.jsx 无内联视觉值
  …（其余 21 个 .jsx 全部 [OK]）…

--- 3) var(--x) 是否都在令牌表里有定义 ---
  [OK  ] 67 个令牌引用全部有定义

--- 4) 裸 px 报告（对照 §4.1 的 4pt 阶梯；仅提示）---
  裸 px 共 29 处；不在 4pt 阶梯上的：
  · src\renderer\src\renderer.css 有 2 处不在阶梯上的 px：291:1100px, 294:760px
================================================================================================
渲染层令牌纪律通过（无死颜色 · 无内联视觉值 · 无悬空变量）。
另有 1 条阶梯外 px 提示（见上，不判失败）。
[exit=0]
```

**④ 的行号复算**（证明偏移 12 行）：

| 守卫报告 | 真实行号 | 真实内容 |
|---|---|---|
| `291:1100px` | **303** | `@media (max-width: 1100px) {` |
| `294:760px` | **306** | `@media (max-width: 760px) {` |

差 12 = `renderer.css` 开头 13 行注释块（第 1~13 行）被 `stripComments`（脚本第 54-56 行）整体删除后，行数组缩短的偏移量。脚本第 108 行用 `stripComments(...).split('\n')` 拿到行号、第 113 行直接输出该下标，**没有把被剥离的注释行数加回**。

**④ 的 `SCALE` 白名单**（脚本第 104 行，原文照抄）：

```js
const SCALE = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96, 1500, 44, 999]);
```

对照 `DESIGN-tokens.md:84-98` §4.1 的 11 档（4/8/12/16/20/24/32/48/64/72/96）—— 白名单多出 `0,1,2,3,6,28,36,40,44,999,1500`，其中 `6/28/36/40` **不在 §4.1 的任何一档上**。

**按严格"4 的倍数"独立复算 `renderer.css` 的裸 px**（附录脚本，见 §6.2）：

| 行 | 值 | 是否 4 的倍数 |
|---|---|---|
| `104` | `6px`（`.progress { height }`） | ❌ |
| `259` | `2px`（`.tag { padding: 2px … }` 纵向） | ❌ |
| `55` | `36px`（`.logo` 宽高） | ✅ |
| `99` | `8px`（`.dot` 宽高） | ✅ |
| `158` | `32px`（`.card-acts .btn` min-height） | ✅ |
| `226` | `28px`（`.metric-icon`） | ✅ |
| `280` | `8px`（`.line-skeleton` 高） | ✅ |
| 其余 | `1px` 描边、`8px`/`12px`/`24px` 等 | ✅ |

→ 结论：`renderer.css` 在严格 4pt 栅格下**只有 2 处阶梯外值**（`6px`、`2px`），栅格纪律实际很好；但守卫报出的那 2 处（`1100px`/`760px`）是**媒体查询断点**，本身不是间距值，且行号偏移 → 该报告的"只有 2 处"与真实情况**巧合一致但理由不同**。

### 2.2 `node tools/verify_renderer_dom.mjs` → exit 0

```
================================================================================================
React 渲染层验收（jsdom，原型版界面）
  HTML   : src\renderer\index.html
  bundle : out\renderer\assets\index-DDOHIJTY.js (673366 B)
[ui] React 已挂载 · react 19.3.0
[ui] indexStatus → L1 3594/3594 dim=768 healthy=true

--- 1) 启动路径 ---
  [OK  ] bundle 载入 + React 挂载不抛错
  [OK  ] React 真的渲染出了内容
  [OK  ] 启动时调了 indexStatus
  [OK  ] 侧栏显示图库根
  [OK  ] 侧栏显示索引百分比
  [OK  ] 指标卡显示真实条数 3,594
  [OK  ] 指标卡显示精度与 seq
--- 2) 文字检索 ---
  [OK  ] 找到检索输入框 #query
  [OK  ] 找到「搜索图片 →」按钮
  [OK  ] 点了搜索 → 调了 search
  [OK  ] 参数正确（mode/text）
  [OK  ] 「全部」时不下发分类过滤（发四个目录）
  [OK  ] 结果卡渲染出 3 张
  [OK  ] 检索后引导块消失
  [OK  ] 缩略图 URL 形状正确 — thumb://L1/022a00481875@256
  [OK  ] 分类标签正确（.tag.VR）
  [OK  ] 分数被显示（4 位） — "定位取件ID-032109719124396.rarVR0.9312 · 很接近 · 2.3 MB"
--- 3) 分类筛选（单选）---
  [OK  ] 选中 VR → 只下发 VR
--- 4) 拦截与提示 ---
  [OK  ] 空查询不去打主进程
  [OK  ] 空查询给了提示 — "请输入要查找的内容"
--- 5) 以图搜图路径 ---
  [OK  ] 找到「以图搜图」入口
  [OK  ] 页面上有文件选择器
  [OK  ] 未选参考图时不发 IPC
  [OK  ] 提示"先选参考图"
  [OK  ] 选图后 search 带上 queryImagePath
--- 6) 卡片动作 ---
  [OK  ] 有包的卡片「定位」可用
  [OK  ] 既无包也无图路径的卡片「定位」被禁用（防误操作）
  [OK  ] 点「取件」→ 调了 collect
  [OK  ] 取件结果被反馈到 toast
--- 7) 主进程事件 ---
  [OK  ] encoder.ready → 指标卡显示设备（webgpu）
================================================================================================
React 渲染层逻辑全过（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件）。
**这只排除了"渲染逻辑写错"，不等于界面好看或可用** —— CSS 生效与真实窗口
由 `reports/G-D-p2-electron/` 的自截图证据负责（GS_CAPTURE=<png>）。
[exit=0]
```

**两处值得注意的细节**（主报告 U-01/U-08 的旁证）：
1. 断言输出 `"VR0.9312 · 很接近 · 2.3 MB"` —— `0.9312` 落在 `Score.jsx` 的 `like`（≥0.93）档，渲染出「很接近」。而同一个分数在守卫 fixture 里被标为 `band:'high'`（第 78 行）。
2. 断言文本里**没有耗时**（无 `ms` 字样），印证 `meta`（含 `tookMs`）未渲染。
3. 该守卫跑的是 **jsdom + mock**（`[ui] indexStatus → L1 3594/3594 dim=768 healthy=true` 是 stub 返回值），**不是**真实素材库。

### 2.3 out/ 构建产物与守卫的对应关系

```
$ Get-ChildItem out\renderer\assets
2026/10/10 17:35:44  24916  index-BCVIX9rf.css
2026/10/10 17:35:44  673366 index-DDOHIJTY.js
$ Get-Item out\main\index.js
2026/10/10 17:35:44  47758  index.js
```

→ `verify_renderer_dom.mjs` 加载的 `index-DDOHIJTY.js`（673366 B）与 §8 的最终构建一致。

---

## §3 对比度复算（WCAG 2.2 官方公式）

### 3.1 脚本

```js
function lum(hex){const c=hex.replace('#','');const v=[0,2,4].map(i=>parseInt(c.substr(i,2),16)/255)
  .map(x=>x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4));return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
function cr(a,b){const l1=lum(a),l2=lum(b);const [hi,lo]=l1>l2?[l1,l2]:[l2,l1];return (hi+0.05)/(lo+0.05);}
function mix(fg,alpha,bg){const h=x=>[0,2,4].map(i=>parseInt(x.replace('#','').substr(i,2),16));
  const F=h(fg),B=h(bg);return '#'+F.map((c,i)=>Math.round(alpha*c+(1-alpha)*B[i]).toString(16).padStart(2,'0')).join('');}
```

> 公式与阈值出处：WCAG 2.2 SC 1.4.3 Contrast (Minimum), AA —
> https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
> 该页明确：正文 **4.5:1**；大字（≥18pt 非粗 / ≥14pt 粗，即约 **24px / 18.5px**）**3:1**；并单列 **CJK 字体的等价尺寸**。
> 本仓库被检出的元素字号为 **11px**（`--type-micro`）与 **13px**（`--type-caption`），**均属正文**。

### 3.2 `color-mix` 底色的合成值（渲染层实际生效值）

| 令牌 | 表达式 | 浅色合成结果 | 深色合成结果 |
|---|---|---|---|
| `--cat-crvr-bg` | `color-mix(in srgb, var(--color-success) 14%, transparent)` 叠在 `--color-bg-elevated` | `#e3f7e8` | `#203627` |
| `--cat-uncat-bg` | `color-mix(in srgb, var(--color-warning) 16%, transparent)` 叠在 `--color-bg-elevated` | `#fff0d8` | `#41321c` |

（`transparent` 与底色合成的等价计算：`alpha*color + (1-alpha)*background`。）

### 3.3 逐组结果

| 元素 | 前景 | 背景 | 实测比值 | 阈值 | 判定 |
|---|---|---|---|---|---|
| `.score.like`（很接近） | `#ff9f0a` | `#ffffff` | **2.06:1** | 4.5 | ❌ |
| `.score.same`（同款区间） | `#34c759` | `#ffffff` | **2.22:1** | 4.5 | ❌ |
| `.metric-note.good` | `#34c759` | `#ffffff` | **2.22:1** | 4.5 | ❌ |
| `.tag.VR` | `#2f6feb` | `#e8effe` | **3.96:1** | 4.5 | ❌ |
| `.tag.CR` | `#8250df` | `#f1e9fd` | **4.28:1** | 4.5 | ❌ |
| `.tag.other` | `#69707d` | `#eceef2` | **4.29:1** | 4.5 | ❌ |
| `.tag.uncat`（浅） | `#a56a12` | `#fff0d8` | **4.01:1** | 4.5 | ❌ |
| `.tag.CRVR`（**深色，档缺失**） | `#1a7f37` | `#203627` | **2.55:1** | 4.5 | ❌ |
| `.toast.err` | `#ffffff` | `#ff3b30` | **3.55:1** | 4.5 | ❌ |
| `.tag.CRVR`（浅） | `#1a7f37` | `#e3f7e8` | 4.53:1 | 4.5 | ✅ |
| `.tag.VR`（深） | `#9ec2ff` | `#16233a` | 8.70:1 | 4.5 | ✅ |
| `.tag.CR`（深） | `#d0b4ff` | `#241a33` | 9.17:1 | 4.5 | ✅ |
| `.tag.other`（深） | `#c3c9d1` | `#232329` | 9.37:1 | 4.5 | ✅ |
| `.tag.uncat`（深） | `#f0cf8a` | `#1d1d1f` | 11.22:1 | 4.5 | ✅ |
| `--color-text-secondary` / `--color-bg-primary` | `#6e6e73` | `#ffffff` | 5.07:1 | 4.5 | ✅（与 `DESIGN-tokens.md:49` 的"约 4.9"量级一致） |
| `--color-text-secondary` / `--color-bg-secondary` | `#6e6e73` | `#f5f5f7` | 4.66:1 | 4.5 | ✅ |
| `--color-accent` / `--color-bg-primary` | `#0071e3` | `#ffffff` | 4.70:1 | 4.5 | ✅（与 `DESIGN-tokens.md:49` 的"约 4.7"一致） |
| `--color-on-accent` on `--color-accent` | `#ffffff` | `#0071e3` | 4.70:1 | 4.5 | ✅ |
| `.chip.active` | `#ffffff` | `#1d1d1f` | 16.83:1 | 4.5 | ✅ |
| 深色 `score.like` | `#ff9f0a` | `#1d1d1f` | 8.19:1 | 4.5 | ✅ |
| 深色 `score.same` | `#30d158` | `#1d1d1f` | 8.32:1 | 4.5 | ✅ |
| 非文字：`.dot-ok` | `#34c759` | `#ffffff` | 2.22:1 | 3（SC 1.4.11） | ⚠️ 有等价文字，不计分 |
| 非文字：`.dot-warn` | `#ff9f0a` | `#ffffff` | 2.06:1 | 3 | ⚠️ 同上 |
| 非文字：`.dot-err` | `#ff3b30` | `#ffffff` | 3.55:1 | 3 | ✅ |

### 3.4 深色模式的令牌覆盖检查

```
--- 分类色深色模式覆盖检查（tokens.css 153-196 行）---
  已覆盖        --color-bg-primary
  未覆盖→       --color-warning
  已覆盖        --cat-vr-bg
  已覆盖        --cat-vr-fg
  已覆盖        --cat-cr-bg
  已覆盖        --cat-cr-fg
  未覆盖→       --cat-crvr-bg     （派生，跟随 --color-success，可接受）
  未覆盖→       --cat-crvr-fg     ← 固定 #1a7f37，深色下 2.55:1
  已覆盖        --cat-other-bg
  已覆盖        --cat-other-fg
  未覆盖→       --cat-uncat-bg    （派生，跟随 --color-warning，可接受）
  已覆盖        --cat-uncat-fg
  未覆盖→       --score-same      （派生，跟随 success，可接受）
  未覆盖→       --score-like      （派生，跟随 warning，可接受）
  未覆盖→       --score-weak      （派生，跟随 text-secondary，可接受）
```

→ 唯一**未被覆盖且未被派生覆盖**的是 `--cat-crvr-fg`（固定字面值 `#1a7f37`）。

---

## §4 原型套件的令牌纪律实测

### 4.1 原型 HTML 里的颜色字面量（`UI-REVIEW:271` 声称「0 处」）

```
=== 原型 HTML 里的硬编码颜色字面量（逐页明细）===
（7 个文件，**不含** --token: #hex 的合法定义处；原型 HTML 里没有令牌定义）
图库与索引任务.html      5 次  #8b91ff #858aff #c4c7d0 #a56a12 #454b58
操作记录与设置.html      5 次  #8b91ff #858aff #c4c7d0 #a56a12 #454b58
语义搜索.html            4 次  #8b91ff #858aff #c4c7d0 #8b91a0
图片详情.html            3 次  #8b91ff #858aff #c4c7d0
入库与增量.html          2 次  #8b91ff #c4c7d0
index.html               1 次  #c4c7d0
文件操作确认.html        1 次  #c4c7d0
----------------------------------------------
合计 = 5+5+4+3+2+1+1     = 21 次（出现）
去重后不同字面量          = 6 个

=== 每个字面量出现的页数（去重 6 个）===
#c4c7d0  ×7 页
#8b91ff  ×5 页
#858aff  ×4 页
#a56a12  ×2 页
#454b58  ×2 页
#8b91a0  ×1 页（语义搜索.html）

=== 原型 CSS 里的硬编码颜色 ===
static/prototype/style.css       #0002（2 处，box-shadow: 0 1px 3px #0002）
static/prototype/app.css         (无)
```

> **口径更正（B3）**：本行原写「合计**去重后**不同字面量： 21」——**把"出现次数"标成了"去重值个数"**。21 是**出现次数**（逐页次数之和），**去重后只有 6 个**。上表已改为两行分开列。
> 另：主报告 §4.1 原先只枚举了 5 个字面量，**漏了 `#8b91a0`**，现已补上。
> 合计口径说明：`static/prototype/` 的 **CSS** 文件里另有 `--token: #hex` 形式的定义（68 处 / 37 个值），那些是**合法的令牌定义**，不计入"硬编码"。

`#858aff` / `#8b91ff` 属靛蓝族 —— 正是 `UI-REVIEW:262` 声称已"全量替换"为 `#0071e3` 的那一族。它们的实际用途：`#858aff` = `.progress > span` 的**内联**填充色；`#8b91ff` = 侧栏状态圆点的**内联**颜色。`#c4c7d0` = 面包屑分隔符的内联 `color`；`#8b91a0` = 搜索框放大镜图标的内联 `color`；`#a56a12` = `--cat-uncat-fg` 的**字面值被内联写死**（令牌 `tokens.css:79` 有同名值）；`#454b58` 出现在 `图库与索引任务.html` / `操作记录与设置.html`。

### 4.2 原型 CSS 的阶梯外 px（严格 4 的倍数；已排除 1/2/3px 描边与 ≥1000px 容器上限）

```
static/prototype/style.css
  14px×4  230px×1  22px×3  11px×11  10px×19  34px×4  15px×6  1.4px×1  5px×3  9px×6
  18px×5  13px×10  6px×7   68px×1   30px×2   35px×2  23px×2  1.1px×1  27px×3  21px×1
  145px×1 205px×1  760px×1 62px×1   19px×1   450px×1 105px×1

static/prototype/app.css
  6px×6  10px×13 11.5px×5 10.5px×3 99px×2  5px×3  145px×2 9px×11  11px×9
  12.5px×4 540px×1 14px×4 15px×5  18px×4  13px×8 26px×1 360px×1 420px×1
  400px×1 86px×1  22px×1  760px×1
```

→ `style.css` 的阶梯外值密度极高（`11px`×11、`10px`×19、`13px`×10…），这正是 `renderer.css:6-8` 注释里"为什么不直接引原型的 style.css"的理由。`app.css`（本项目后补）情况好一些但仍混用 `9px/11.5px/12.5px/6px` 等。

---

## §5 本机字体注册表实测

```
$ (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts').PSObject.Properties

SF Pro                 未安装
SFPro                  未安装
PingFang               未安装
Hiragino               未安装
Segoe UI Variable      未安装
Segoe UI               命中 15 项：Segoe UI (TrueType) / Segoe UI Black (TrueType) / Segoe UI Black Italic (TrueType) …
Microsoft YaHei        命中 3 项：Microsoft YaHei & Microsoft YaHei UI (TrueType) / …Bold / …Light
Helvetica              未安装
Arial                  命中 11 项：Arial (TrueType) / Arial Black (TrueType) / Arial Bold (TrueType) …
Menlo                  未安装
Consolas               命中 4 项：Consolas (TrueType) / Consolas Bold (TrueType) / …
SFMono                 未安装

$ $fonts | Where-Object { $_ -match 'Segoe UI Variable' }   →   空
```

→ `--font-sans`（`tokens.css:36-38`）的 11 个候选在本机的命中情况：

| # | 候选 | 本机 | 说明 |
|---|---|---|---|
| 1 | `-apple-system` | ✗ 无效 | WebKit/Blink 的 Apple 平台别名，Windows 上解析不到 |
| 2 | `BlinkMacSystemFont` | ✗ 无效 | 同上 |
| 3 | `"SF Pro Text"` | ✗ 未安装 | |
| 4 | `"PingFang SC"` | ✗ 未安装 | |
| 5 | `"Hiragino Sans GB"` | ✗ 未安装 | |
| 6 | `"Segoe UI Variable Text"` | ✗ **未安装** | Windows 11 才带；本机没有 |
| 7 | `"Segoe UI"` | ✅ **命中** | 西文实际落点 |
| 8 | `"Microsoft YaHei"` | ✅ 命中 | CJK 逐字形回退落点 |
| 9 | `Helvetica` | ✗ 未安装 | |
| 10 | `Arial` | ✅ 命中（但不会被用到，第 7 项已命中） | |
| 11 | `sans-serif` | 通用族 | 不会被用到 |

`--font-mono`（`tokens.css:39`）：`ui-monospace`（通用关键字）→ `SFMono-Regular` ✗ → `Menlo` ✗ → `Consolas` ✅ 命中。

---

## §6 class 覆盖脚本与结果

### 6.1 脚本（stdin 执行，未落盘）

```js
const fs=require('fs'),path=require('path');
const protoCss=['static/prototype/style.css','static/prototype/app.css','static/prototype/tokens.css']
  .map(f=>fs.readFileSync(f,'utf8')).join('\n');
const protoDef=new Set([...protoCss.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m=>m[1]));
const rCss=fs.readFileSync('src/renderer/src/renderer.css','utf8');
const rDef=new Set([...rCss.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m=>m[1]));
// …walk() 收集 22 个 .jsx 的 className / cx() 字面量…
```

### 6.2 结果（节选，含正则误报说明）

```
=== A) JSX 里用到、但 renderer.css 没有定义的 class ===
${band}, loading

=== B) 原型 CSS 定义了、renderer.css 没有的 class（数量 71）===
actgroup, actrow, avatar, bad, bigbar, bigpic, c, changes, checks, circle, crumb-lite, d,
danger, danger-zone, db, detail, df, dh, dialog, done, form-grid, gh, ghost, grid, height,
hint-line, ic, icon, info, kpis, kv, lead, link-btn, m, min-card, n, neutral, nm, now, num,
ok, other, overlay, overlay-cap, ph-fallback, photo-label, pill, plain, r, role, row-warn,
search, secondary, segment, selected, size, sm, stage, stages, status, statusbar, switch, sz,
t, table-wrap, tbl, todo, toggle-row, uncat, warn, width
```

**读法说明（避免误判）**：
- A 里的 `${band}` 是 `Score.jsx:26` 的**模板字面量**（动态 class），不是缺陷。
- A 里的 **`loading`** 是真实缺口：`Gallery.jsx:8` 写了 `className="photo-card loading"`，而 `renderer.css` 与原型 CSS **都没有 `.loading` 规则**（主报告 U-16）。
- B 里的 71 个 class **绝大多数属于 5 个未实现页**（`table-wrap`/`tbl`/`switch`/`status`/`stages`/`dialog`/`overlay`/`detail`/`avatar`/`toggle-row`/`form-grid`…），**不构成实现层缺陷**；它们的存在正好量化了 §8.2 的"未实现页差距"。
- B 里 `height`/`width`/`size`/`grid`/`search`/`secondary`/`segment` 等是**正则从注释与属性名误抓**（例如 `min-height:` 里的 `height`），不计入。
- 该脚本因正则限制，**会漏抓** `className={cond ? 'a' : 'b'}` 形式的动态 class（如 `Chip.jsx:4` 的 `chip active`、`Tag.jsx:8` 的 `tag`、`Button.jsx:16` 的 `btn primary wide`），因此"未使用"清单不可靠 —— 主报告**未使用**该清单的 D 段结论。

### 6.3 `verify_renderer_styles.mjs` 的扫描范围（决定原型是否有守卫）

```
$ Select-String -Path tools\*.mjs -Pattern "static" -SimpleMatch
verify_renderer_dom.mjs:3:  // 2026-10-10 起界面按 `static/prototype/` 的设计重写（类名体系换成了原型的…
verify_renderer_styles.mjs:4: // 但原先的 tools/verify_tokens.py 只查原型套件（static/prototype），渲染层迁移到 React 后
verify_renderer_styles.mjs:30: const TOKENS = path.join(ROOT, 'static', 'prototype', 'tokens.css');
```

```
$ Get-ChildItem tools -File | Select-Object -ExpandProperty Name
check_search.mjs
smoke_app.mjs
verify-doc-refs.mjs
verify_app_build.mjs
verify_encoder_path.mjs
verify_renderer_dom.mjs
verify_renderer_styles.mjs

$ Test-Path tools\verify_tokens.py
不存在（Python 层已退役）
```

→ ① `tools/` 共 **7 个 `.mjs`**（与基线 §5 D1 的实测一致）；② **无 `verify_tokens.py`**；③ `verify_renderer_styles.mjs` 只在第 30 行"读" `static/prototype/tokens.css` 作为**令牌定义源**，其扫描根（第 29 行 `const SRC = path.join(ROOT,'src','renderer','src')`）**不含 `static/prototype/`** → **原型套件当前没有任何令牌守卫**。

### 6.4 令牌使用率（定义 vs 消费）

```js
const tok=fs.readFileSync('static/prototype/tokens.css','utf8');
const defs=[...new Set([...tok.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m=>m[1]))];
const css=fs.readFileSync('src/renderer/src/renderer.css','utf8');
const unused=defs.filter(d=>!css.includes('var('+d));
```

```
令牌总数 102 | renderer.css 未引用 35
--color-bg-secondary, --space-12, --space-16, --space-18, --space-24, --radius-2xl,
--shadow-outline, --shadow-control, --cat-uncat-bg, --cat-uncat-fg, --scrim, --scrim-media,
--scrim-media-strong, --hairline-on-media, --type-title2, --type-title2-lh, --type-title2-ls,
--type-callout-lh, --control-segment-height, --bg, --panel, --text, --muted, --line,
--line-strong, --accent, --accent-soft, --green, --green-soft, --amber, --amber-soft,
--warning, --danger, --danger-soft, --ink-2
```

其中 `--bg/--panel/--text/--muted/--line/--line-strong/--accent/--accent-soft/--green/--green-soft/--amber/--amber-soft/--warning/--danger/--danger-soft/--ink-2` 这 16 个是 `tokens.css:131-151` 明确标注的**旧变量桥接**（服务于 `style.css`/`app.css`），属已知设计，不计为问题。真正的死令牌是 `--shadow-outline`、`--shadow-control`、`--cat-uncat-bg`、`--cat-uncat-fg`、`--scrim`×3、`--hairline-on-media`（主报告 U-20）。

`tools/verify_renderer_styles.mjs:98` 的断言只覆盖 `used → defined` 一个方向：

```js
const dangling = [...used.keys()].filter((v) => !defined.has(v));
ok(dangling.length === 0, `${used.size} 个令牌引用全部有定义`, …);
```

→ **不查 `defined → used`**，所以上述死令牌永远不会被守卫发现。

---

## §7 `ui-final.png` 与 HEAD 代码的逐项交叉核对

`reports/G-D-p2-electron/ui-final.png`（1432×863，2026-10-10 17:35:57）中可观察的每一项，与 HEAD 代码的对应关系：

| # | 截图里看到的 | HEAD 代码依据 | 一致？ |
|---|---|---|---|
| 1 | 侧栏浅灰底（非深色） | `tokens.css:63` `--sidebar-bg: var(--color-bg-secondary)` = `#f5f5f7`；无 `data-sidebar="dark"` | ✅ |
| 2 | 当前项「语义搜索」浅灰底 + 左侧蓝色 inset 条 | `renderer.css:79` `box-shadow: inset 3px 0 var(--color-accent)` | ✅ |
| 3 | 「全部」胶囊是**深色实心 + 白字** | `renderer.css:172` `background: var(--color-text-primary)`；`:172` `color: var(--color-bg-elevated)` | ✅（`ui-prototype.png` 的蓝描边版本不对应 HEAD，见 §8） |
| 4 | 品牌副标题折成**两行** | `renderer.css:64` 11px + `letter-spacing:.04em`，侧栏 220px | ✅（U-15） |
| 5 | 侧栏进度条**蓝色**、100% | `renderer.css:105` `background: var(--color-accent)`；`--color-accent: #0071e3` | ✅（原型是靛蓝 `#858aff`） |
| 6 | 4 张指标卡，第 2 张注释为**绿色** | `renderer.css:234` `.metric-note.good { color: var(--color-success) }` | ✅（U-03 的 2.22:1 命中） |
| 7 | 第 3 张「索引状态 / 运行正常 / **fp32 · seq140 · webgpu**」 | `MetricsRow.jsx:25,37` 从 `compat.split('|')[4]` 取 seq；`SearchPage.jsx:32` 的 `encoder.ready` 事件填 device | ✅ |
| 8 | 结果区标题「搜索结果 **60** 套素材」 | `useSearch.js:34` `topK: 60`；`Gallery.jsx:50` `{results.length} 套素材` | ✅ |
| 9 | **4 张卡的分数全是「较弱」**（0.8147 / 0.7985 / 0.7975 / 0.7943） | `Score.jsx:2-7`：`<0.93` → `weak` → `BAND_TEXT.weak = '较弱'` | ✅（U-01 的实证） |
| 10 | 分数文字为**灰色** | `renderer.css:270` `.score.weak { color: var(--score-weak) }` ← `tokens.css:84` = `--color-text-secondary` | ✅ |
| 11 | 卡片标题是**包名**（`ID-15690457.zip` / `ID-104617637.rar`） | `PhotoCard.jsx:13` `item.archive ? item.archive.name : …` | ✅ |
| 12 | 卡片右下角**未出现**「定位 / 取件」 | `renderer.css:252` `.card-acts { opacity: 0 }`，`:254` 仅在 `:hover`/`:focus-within` 时为 1；截图无悬停 | ✅ |
| 13 | 标签 `CR` / `VR` / `CR+VR` 着色 | `renderer.css:264-266` + `tokens.css:73-79` | ✅ |
| 14 | 顶栏右侧 ↻ 与 ? 两个方形图标按钮 | `SearchPage.jsx:86-87`；`renderer.css:123-130` `.icon-btn` 36×36 | ✅（U-09 的 36px 命中） |
| 15 | 顶栏有**浅色常驻滚动条**（右缘） | `renderer.css` 无 `::-webkit-scrollbar` 规则；`index.html` 无 `color-scheme` | ✅（U-07 的命中） |
| 16 | 内容区底部**没有**状态条（与 `DESIGN-app-details.md:57` 的 ASCII 图不同） | `SearchPage.jsx:139-142` 只是一个 `<p class="muted small">`，不是 statusbar | ✅（有意改为指标卡，见 §8.1 第 1 行） |

**未能交叉核对的项**：字体族（截图分辨率下无法区分 Segoe UI 与其它无衬线体）→ 已在 §5 用字体注册表间接确定，标 **【判断，非实测】**。

---

## §8 时间线证据（决定哪些截图可用）

```
$ Get-Item reports\G-D-p2-electron\*.png, src\renderer\src\renderer.css, static\prototype\tokens.css, … |
  Select-Object LastWriteTime, Length, Name | Sort-Object LastWriteTime

2026/10/10 16:47:09   33645  electron-window.png
2026/10/10 17:19:50  302440  ui-components.png
2026/10/10 17:30:11  143524  ui-prototype.png
2026/10/10 17:32:53  252172  ui-tokens.png
2026/10/10 17:35:57  345052  ui-final.png
2026/10/10 18:03:16    6328  SearchPage.jsx
2026/10/10 18:03:16   14050  renderer.css
2026/10/10 18:03:16    1857  PhotoCard.jsx
2026/10/10 18:03:16   10866  tokens.css
```

```
$ Get-ChildItem out\renderer\assets | Select LastWriteTime, Length, Name
2026/10/10 17:35:44  24916  index-BCVIX9rf.css
2026/10/10 17:35:44 673366  index-DDOHIJTY.js

$ git log -1 --format="%H %ci %s" dcfec17
dcfec174cccb27f9da0db956a85101f535928dd8 2026-10-10 17:38:19 +0800 feat(app): Electron + Vite + React 全面迁移 —— 原型界面 / 令牌校准 / thumb 修复 / 仓库重组

$ git diff --stat -- src/renderer/src/renderer.css static/prototype/tokens.css
（空 = 与 HEAD 一致）

$ git status --short
?? AGENTS.md
?? docs/audit/
?? docs/plan/DOCS-DEPLOYMENT.md
…（仅未跟踪的新文件；无 ` M` 修改项）
```

**推理链**：
1. `renderer.css` / `tokens.css` / `SearchPage.jsx` / `PhotoCard.jsx` 的 mtime 全是 `18:03:16` 且 `git diff` 为空 → 该时间是一次**检出/提交落盘**时间，文件内容 = HEAD（`dcfec17`）。
2. 构建产物 `out/` 写于 **17:35:44**，`dcfec17` 提交于 **17:38:19** → 该构建**就是被提交的那一版**。
3. `ui-final.png` 写于 **17:35:57**，晚于构建 13 秒 → 它是**这一版构建**的自截图。README §9 记录的正是产生该文件的命令（`GS_CAPTURE=reports/G-D-p2-electron/ui-final.png` + `GS_CAPTURE_DELAY_MS=9000`）。
4. `ui-tokens.png`(17:32:53)、`ui-prototype.png`(17:30:11)、`ui-components.png`(17:19:50) 均**早于** 17:35:44 的构建 → **不是**当前代码的证据。
5. `electron-window.png`(16:47:09) 截的是迁移前的 P2 骨架界面（画面里左栏是"分类筛选"复选框组 + "文字/以图搜图"分段控件），与当前 UI 不同。

**行为学旁证**：`ui-prototype.png` 里「全部」胶囊是白底 + 蓝描边 + 蓝字（= 原型 `style.css` 的 `.chip.active{background:var(--accent-soft);border-color:var(--color-accent);color:var(--color-accent)}`），而 `ui-final.png` 里是深色实心（= HEAD `renderer.css:172`）。同一 UI 元素在两个截图里样式不同 → **两图必然来自不同代码版本**。

---

## §9 外部引用清单（含本轮取用方式）

| 编号 | 来源 | URL | 本轮取用方式 |
|---|---|---|---|
| B1 | Apple HIG · Layout | https://developer.apple.com/design/human-interface-guidelines/layout | `web_fetch` → **HTTP 200，仅返回标题**（SPA）。页面存在性已确认；**未取到页内条文的数值** |
| B2 | Apple HIG · Typography | https://developer.apple.com/design/human-interface-guidelines/typography | 同上（HTTP 200，标题 "Typography \| Apple Developer Documentation"）；条文经第三方镜像 `raintree-technology/hig-doctor` 的 `skills/hig-foundations/references/typography.md`（该文件头部自带 `source:` 指向此 URL）确认「Consider using the built-in text styles」「Minimize the number of typefaces」等语句 |
| B3 | Apple HIG · Color | https://developer.apple.com/design/human-interface-guidelines/color | HTTP 200。**官方系统色 RGB 规格表**取自镜像 `hig-doctor/…/color.md`（含 attribution）与 `…/color.md@ea8e93e`（完整版，含 Specifications 表与 Change log）。规范性语句原文取自后者 |
| B4 | Apple HIG · Materials | https://developer.apple.com/design/human-interface-guidelines/materials | HTTP 200。条文取自镜像 `hig-doctor/…/materials.md`：「Use materials and effects sparingly」「Help ensure legibility by using vibrant colors on top of materials」「Consider contrast and visual separation…」 |
| B5 | Apple HIG · Motion | https://developer.apple.com/design/human-interface-guidelines/motion | HTTP 200，仅标题。reduced-motion 判据改挂 WCAG/项目自定文档，**未凭记忆引用 HIG Motion 条文** |
| B6 | Apple HIG · Accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility | HTTP 200，仅标题 |
| B7 | W3C WCAG 2.2 SC 1.4.3 Contrast (Minimum) AA | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | HTTP 200，**全文可取**。4.5:1 / 3:1 阈值、大字定义（18pt / 14pt bold ≈ 24px / 18.5px）、CJK 等价尺寸、相对亮度公式与 0.05 常数，全部逐字取自该页 |
| B8 | W3C WCAG 2.2 SC 2.5.5 Target Size (Enhanced) AAA | https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html | HTTP 200，**全文可取**。"at least **44 by 44** CSS pixels" 逐字取自该页 |
| B9 | W3C WCAG 2.2 SC 2.5.8 Target Size (Minimum) AA | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | HTTP 200，**全文可取**。"at least **24 by 24** CSS pixels" + 间距例外逐字取自该页 |
| M1 | 镜像：hig-doctor color.md | https://raw.githubusercontent.com/raintree-technology/hig-doctor/refs/heads/main/skills/hig-foundations/references/color.md | HTTP 200，全部条文版 |
| M2 | 镜像：hig-doctor color.md（固定 commit） | https://raw.githubusercontent.com/raintree-technology/hig-doctor/ea8e93e0cc3a877cf90d49d8f6fc55991ed29701/skills/hig-foundations/references/color.md | HTTP 200，**含 Specifications 官方 RGB 表**（本报告 §4.1 的比对基准） |
| M3 | 镜像：hig-doctor materials.md | https://raw.githubusercontent.com/raintree-technology/hig-doctor/refs/heads/main/skills/hig-foundations/references/materials.md | HTTP 200，条文版 |
| M4 | 镜像：hig-doctor typography.md（固定 commit，**经 jsDelivr 路由**） | https://cdn.jsdelivr.net/gh/raintree-technology/hig-doctor@ea8e93e0cc3a877cf90d49d8f6fc55991ed29701/skills/hig-foundations/references/typography.md | HTTP 200，**全文取到，含完整规格表** —— `Ensuring legibility` 的平台默认/最小字号表、`iOS/iPadOS Dynamic Type sizes`（xSmall→xxxLarge + AX1→AX5 共 12 张表）、**`macOS built-in text styles`**、`tvOS`、`watchOS`（含 AX）、以及 **5 组 tracking 表**（SF Pro / SF Pro Rounded / New York / tvOS / SF Compact / SF Compact Rounded）。**本报告 §4.2 的全部 Apple pt 值均取自该文件**（B1 修正：原文此处曾误写为"条文版（无字号数值表）"，与 §4.2 的实际取用矛盾） |

**未取到的**：HIG Layout / Motion / Accessibility 的**页内数值条文**（SPA 渲染，`web_fetch` 只得到标题）—— HIG Typography 与 Color 的同名情况已由 M4 / M2 两张镜像补齐，故不再属于"未取到"。因此：
- 本报告**没有**引用 HIG Layout 的具体 pt 数（如命中目标的具体数值）；`--touch-min: 44px` 的判定改挂 **WCAG 2.5.5 / 2.5.8**（已取全文）；
- **HIG Typography 的字号数值已取到**（M4 镜像），§4.2 的 macOS/iOS 各档 pt 值即出自该文件，并在报告正文逐档标注了 B2 + M4 两个出处。**本行原写"没有把 macOS 文本样式的具体 pt 值当作 Apple 官方数值来断言"，与 §4.2 直接矛盾，已按事实更正（B1）。**
- HIG Motion 的条文仍未取到；§10 的 reduced-motion 判定因此**全部挂在 `tokens.css:228` / `renderer.css:298` 与 `DESIGN-tokens.md:150` 上**，未引用 HIG Motion 的任何条文（这一点报告正文 **§10 的"进入动画 / 悬停位移"行**已如实声明）。

### 9.1 Apple HIG Color 官方系统色（取自 M2，用于 §4.1 比对）

| 名称 | Default (light) | Default (dark) | Increased contrast (light) | Increased contrast (dark) |
|---|---|---|---|---|
| Red | R-255,G-56,B-60 | R-255,G-66,B-69 | R-233,G-21,B-45 | R-255,G-97,B-101 |
| Orange | R-255,G-141,B-40 | R-255,G-146,B-48 | R-197,G-83,B-0 | R-255,G-160,B-86 |
| Yellow | R-255,G-204,B-0 | R-255,G-214,B-0 | R-161,G-106,B-0 | R-254,G-223,B-67 |
| Green | R-52,G-199,B-89 | R-48,G-209,B-88 | R-0,G-137,B-50 | R-74,G-217,B-104 |
| Mint | R-0,G-200,B-179 | R-0,G-218,B-195 | R-0,G-133,B-117 | R-84,G-223,B-203 |
| Teal | R-0,G-195,B-208 | R-0,G-210,B-224 | R-0,G-129,B-152 | R-59,G-221,B-236 |
| Cyan | R-0,G-192,B-232 | R-60,G-211,B-254 | R-0,G-126,B-174 | R-109,G-217,B-255 |
| Blue | R-0,G-136,B-255 | R-0,G-145,B-255 | R-30,G-110,B-244 | R-92,G-184,B-255 |
| Indigo | R-97,G-85,B-245 | R-109,G-124,B-255 | R-86,G-74,B-222 | R-167,G-170,B-255 |
| Purple | R-203,G-48,B-224 | R-219,G-52,B-242 | R-176,G-47,B-194 | R-234,G-141,B-255 |
| Pink | R-255,G-45,B-85 | R-255,G-55,B-95 | R-231,G-18,B-77 | R-255,G-138,B-196 |
| Brown | R-172,G-127,B-94 | R-183,G-138,B-102 | R-149,G-109,B-81 | R-219,G-166,B-121 |

十六进制换算（本报告 §4.1 用值）：Red light `#FF383C` / dark `#FF4245`；Orange light `#FF8D28` / dark `#FF9230`；Green light `#34C759` / dark `#30D158`；Blue light `#0088FF` / dark `#0091FF`；Indigo light `#6155F5` / dark `#6D7CFF`；Purple light `#CB30E0` / dark `#DB34F2`；Pink light `#FF2D55` / dark `#FF375F`。

另（同页 iOS system gray 表，本报告引用其 light 值作参照）：`systemGray6` light = `#F2F2F7`。

### 9.2 与本仓库令牌的最终比对（主报告 §4.1 的数据源）

| 仓库令牌 | 仓库值 | HIG 对应项与官方值 | 差异 |
|---|---|---|---|
| `--color-success` 浅 | `#34c759` | Green light `#34C759` | **0** |
| `--color-success` 深 | `#30d158` | Green dark `#30D158` | **0** |
| `--color-critical` 浅 | `#ff3b30` | Red light `#FF383C` | ΔR=3 ΔG=5 ΔB=4 |
| `--color-critical` 深 | `#ff453a` | Red dark `#FF4245` | ΔR=3 ΔG=3 ΔB=5 |
| `--color-warning` 浅 | `#ff9f0a` | Orange light `#FF8D28` | ΔR=18 ΔG=18 ΔB=22（且等于 Apple 的 **dark** 档量级） |
| `--color-warning` 深 | `#ff9f0a` | Orange dark `#FF9230` | ΔR=31 ΔG=13 ΔB=38 |
| `--color-accent` 浅 | `#0071e3` | Blue light `#0088FF` | 与任何 HIG 蓝都对不上；属 apple.com 按钮蓝 |
| `--color-accent` 深 | `#2997ff` | Blue dark `#0091FF` | 同上；属 apple.com 暗色链接蓝 |
| `--color-bg-secondary` 浅 | `#f5f5f7` | 无同名 HIG 语义色；`systemGray6` light `#F2F2F7` | ΔR=3 ΔG=3 ΔB=0 |
| `--color-bg-primary` 深 | `#000000` | 深色系统背景纯黑 | **0** |

---

## §10 本轮未产生写操作的证明

- 全部脚本通过 `$code | node -`（stdin）执行，**未创建任何临时文件**。
- 只读的文件操作仅 `read` / `glob` / `grep` / `Get-Content` / `Get-ChildItem` / `git log` / `git diff` / `git status` / `Select-String`。
- `git status --short` 在本报告写入前后均只显示：`AGENTS.md`、`docs/audit/`、`docs/plan/DOCS-*.md`（均为**他人**未跟踪文件）。本审查者新增的文件只有 `UIUX-AUDIT.md` 与 `docs/audit/uiux-evidence.md`。

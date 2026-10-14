# 渲染层（React）· 组件分层与界面来源

> 界面**按原型套件的设计实现**（原型已归档，见下），组件按四层组织。

## 视觉唯一来源 = `tokens.css`

`main.jsx` 的引入顺序不能换：

```
packages/design-tokens/tokens.css              设计令牌（颜色/间距/圆角/材质）—— **唯一来源**
apps/desktop/src/renderer/src/renderer.css     渲染层样式（只消费 var(--token)）
```

- **令牌唯一来源是 `packages/design-tokens/tokens.css`**（正式生产资产，不再位于原型目录）。
- **原型套件已归档**到 `docs/archive/prototype/`，仅供对照设计意图，**不再是依据**；
  它的三张样式表（`style.css` / `tokens.css` / `app.css`）**不再被应用加载**。
- **不要写第二套视觉，也不要写死颜色** —— 一律 `var(--token)`，令牌只在上面那一个文件里加。
  （纪律原先由 `tools/verify_renderer_styles.mjs` 守卫 —— 该守卫已于 2026-10-13 移除。
  ✅ 同日由 `npm test` 的断言接回：`apps/desktop/tests/styles.test.mjs` 查「渲染层零色值字面量」
  「Tailwind @theme 只允许 var()」「旧类名不得复活」；**不再只能靠 code review**。）

## 组件分层

```
src/
├── main.jsx                    入口：挂载 + 按序引入 tokens.css → tailwind.css → renderer.css
├── App.jsx                     应用根：只挂 <LibraryGate />（有库 ⇒ AppShell + 路由；无库 ⇒ 首启向导）
├── renderer.css                手写层（114 条规则，逐族迁 Tailwind）
├── styles/tailwind.css         生成层入口：@theme inline 只映射令牌（不复制值，不引 preflight）
├── adapter/api.js              ★ 全应用唯一 window.api 入口（解包信封 · userMessage 恒非空 · 永不抛 · 不 import React）
├── store/                      Zustand（vanilla create ⇒ 可在纯 Node 里单测）
│   ├── search.js               检索状态 + 取件确认状态机（requestCollect / cancelCollect / confirmCollect）
│   └── tasks.js                进度事件归约 reduceEvent（纯函数）+ PHASES / progressPercent / etaText
├── router/                     路径与页面名的唯一来源
│   ├── paths.js                纯数据（PATHS / LABELS / itemPath），无 JSX ⇒ node:test 能用 matchRoutes() 真解算
│   └── index.jsx               组件映射（4 条 hash 路由）
├── hooks/                      状态与 IPC（与界面无关）
│   ├── useEngine.js                invoke / 事件订阅 / indexStatus
│   ├── useLibraryConfig.js         库从哪来 + 首启向导的 pickDir / addLibrary
│   └── useToast.js                 轻提示（错误 toast 不自动消失）
├── utils/                      领域判断（不写进 .jsx —— .jsx 在 node:test 里加载不了）
│   ├── gate.js · index-state.js · item-actions.js · format.js · useDocumentTitle.js
├── ui/                         与业务无关的原语
│   ├── Button · Chip · Tag · Score · SearchBox · Field · Progress
│   ├── Metric · Toast · ConfirmDialog（Radix AlertDialog）· cn.js（twMerge(clsx(…)) —— 唯一一份 class 合并）
├── layout/                     外壳与容器
│   ├── AppShell(.app) · Sidebar(.sidebar + Brand/Nav/NavItem/NavLabel/SideNote)
│   ├── Main(.main) · Topbar(.topbar) · PageHead(.page-head)
├── search/                     检索特性组件
│   ├── SearchPanel(.panel) · MetricsRow(.metrics) · Gallery(.gallery)
│   ├── PhotoCard(.photo-card) · SearchSidebar(侧栏内容)
└── pages/
    ├── LibraryGate.jsx         有库 / 无库 / 加载 三态（判定抽在 utils/gate.js ⇒ 可单测）
    ├── FirstRunWizard.jsx      无库时选目录（UI 只吃 props）
    ├── SearchPage.jsx          检索页（把 search/ 的组件缝成一页）
    ├── ItemPage.jsx            图片详情（P3c）
    ├── TasksPage.jsx           索引任务（P3d）
    └── ActivityPage.jsx        操作记录（P3d）
```

## 界面上**没编造数据**

四个指标卡（图库图片 / 已建立索引 / 索引状态 / 本地隐私）全部来自 `indexStatus` 与编码器事件：
条数就是索引里的真实条数、`fp32 · seq140 · webgpu` 来自 `compat` 与 `encoder.ready`。
原型里的示例值（3,594 是写死的）在这里换成了真值；取不到就显示"读取中…"，不填假数。

## 契约：这些类名与文案被守卫断言，别随手改

`tools/verify_renderer_dom.mjs`（jsdom 真跑构建产物）—— **⚠️ 该守卫已于 2026-10-13 移除**，本节仅存历史说明：

| 契约 | 谁负责 |
|---|---|
| `.sidebar` 里有图库根与「100% 已建立索引」 | SearchSidebar / SideNote / Progress |
| `.metrics` 里有真实条数、`fp32`、`seq140`、事件后的设备名 | MetricsRow / Metric |
| `#query` 输入框、文字为「搜索图片 →」的按钮 | SearchBox / SearchPanel |
| `.photo-card`（**一条结果一张**）、`img.photo-img[src^="thumb://"]`、`.tag.VR`、`.score` | PhotoCard / Tag / Score |
| `.card-acts button`：第 1 个「定位」（无包无路径时必须 disabled）、第 2 个「取件」 | PhotoCard |
| `.toast` 承载提示文字（有消息时带 `show`） | Toast |
| 「以图搜图」入口（文字含该词）→ 未选图不发 IPC、选图后带 `queryImagePath` | SearchPanel |

## 加一页新界面

1. `pages/XxxPage.jsx`：用 `AppShell` + `Sidebar/*` + `ui/*` 组合；
2. 状态写进 `hooks/`（**不要在组件里直接写 `window.api`**）；
3. 导航项从 `disabled` 改为可用（`search/SearchSidebar.jsx` 的 `NAV` 数组），并在守卫里补一条断言。

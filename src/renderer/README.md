# 渲染层（React）· 组件分层与界面来源

> 2026-10-10 起：界面**按 `static/prototype/` 的设计实现**，组件按四层组织。

## 视觉唯一来源 = 原型的三张样式表

`main.jsx` 按**原型自己的加载顺序**引入（顺序不能换）：

```
static/prototype/style.css    基础版式（.sidebar/.main/.topbar/.panel/.gallery/.photo-card…）
static/prototype/tokens.css   设计令牌（颜色/间距/圆角/材质）
static/prototype/app.css      原型补充组件
src/renderer/src/renderer.css 渲染层**追加**（只放原型没有的应用特有样式，刻意保持很小）
```

**不要再写第二套视觉**。改样式先改原型那三张表（那是设计），`renderer.css` 只兜应用特有的东西
（整窗布局、未实现导航的置灰、骨架屏、toast 错误语气…）。规则同前：**不写死颜色**，一律 `var(--token)`。

## 组件分层

```
src/
├── main.jsx                    入口：挂载 + 按序引入样式
├── App.jsx                     应用根（当前只有检索一页）
├── renderer.css                渲染层追加样式
├── hooks/                      状态与 IPC（与界面无关）
│   ├── useEngine.js                window.api 唯一入口 · indexStatus · 事件订阅
│   ├── useSearch.js                检索状态机（参数/分类/排序/IPC/错误/提示/console 证据）
│   └── useToast.js                 轻提示
├── ui/                         与业务无关的原语
│   ├── Button · Chip · Tag · Score · SearchBox · Field · Progress
│   ├── Metric · Toast · cx
├── layout/                     外壳与容器
│   ├── AppShell(.app) · Sidebar(.sidebar + Brand/Nav/NavItem/NavLabel/SideNote)
│   ├── Main(.main) · Topbar(.topbar) · PageHead(.page-head)
├── search/                     检索特性组件
│   ├── SearchPanel(.panel) · MetricsRow(.metrics) · Gallery(.gallery)
│   ├── PhotoCard(.photo-card) · SearchSidebar(侧栏内容)
└── pages/
    └── SearchPage.jsx          把上面三者缝成一页
```

## 界面上**没编造数据**

四个指标卡（图库图片 / 已建立索引 / 索引状态 / 本地隐私）全部来自 `indexStatus` 与编码器事件：
条数就是索引里的真实条数、`fp32 · seq140 · webgpu` 来自 `compat` 与 `encoder.ready`。
原型里的示例值（3,594 是写死的）在这里换成了真值；取不到就显示"读取中…"，不填假数。

## 契约：这些类名与文案被守卫断言，别随手改

`tools/verify_renderer_dom.mjs`（jsdom 真跑构建产物）：

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

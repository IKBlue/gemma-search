// router/paths.js —— 路由表的**唯一来源**（纯数据，无 JSX）
//
// 为什么单独一个纯数据模块（不是把表写在 router/index.jsx 里）：
//   `node:test` **加载不了 `.jsx`**。路由表一旦和 JSX 混在一起，"≥3 条路由可达"就只能人工看，
//   没法进 `npm test`。拆出来之后可以用 react-router 自己的 `matchRoutes()` 在纯 Node 里解算，
//   那是**真的在跑路由匹配**，不是 grep 字符串。
//
// ⚠️ 用 hash 路由而不是 history 路由：打包态是 `file://` 加载（`out/renderer/index.html`），
//    history 路由的深链会直接 404（没有服务器来 rewrite）。见 `router/index.jsx`。

/** 路由路径（改这里就改了全应用的路由；别在别处再写一遍字面量） */
export const PATHS = Object.freeze({
  search: '/',
  item: '/item/:libId/:uid',
  tasks: '/tasks',
  activity: '/activity',
})

/**
 * 页面名字的**唯一来源**。
 *
 * 它同时喂两处，所以必须只有一份（P1）：
 *   · 侧栏/面包屑上的可见文案
 *   · **窗口标题**（`document.title`）—— 由 `utils/useDocumentTitle.js` 设置
 * ⇒ 2026-10-13 之前窗口标题是**写死**的（`index.html` 与主进程各硬编码一份、且不随路由变），
 *   多页应用里那是很明显的观感缺口：切到"索引任务"，任务栏还写着"素材库语义检索"。
 */
export const LABELS = Object.freeze({
  search: '语义搜索',
  item: '图片详情',
  tasks: '索引任务',
  activity: '操作记录',
})

/**
 * 路由表。`key` 对应 `router/index.jsx` 里的组件映射 ——
 * 那里有一条**启动期断言**：表里每个 key 都必须有组件，否则应用直接起不来（而不是静默白屏）。
 */
export const ROUTES = Object.freeze([
  Object.freeze({ key: 'search', path: PATHS.search, label: LABELS.search }),
  Object.freeze({ key: 'item', path: PATHS.item, label: LABELS.item }),
  Object.freeze({ key: 'tasks', path: PATHS.tasks, label: LABELS.tasks }),
  Object.freeze({ key: 'activity', path: PATHS.activity, label: LABELS.activity }),
])

/** 应用名 —— 窗口标题的后缀，与 `index.html` / 主进程建窗时的 title 保持一致 */
export const APP_NAME = 'gemma-search'

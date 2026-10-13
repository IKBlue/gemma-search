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
})

/**
 * 路由表。`key` 对应 `router/index.jsx` 里的组件映射 ——
 * 那里有一条**启动期断言**：表里每个 key 都必须有组件，否则应用直接起不来（而不是静默白屏）。
 */
export const ROUTES = Object.freeze([
  Object.freeze({ key: 'search', path: PATHS.search, label: '语义搜索' }),
  Object.freeze({ key: 'item', path: PATHS.item, label: '图片详情' }),
  Object.freeze({ key: 'tasks', path: PATHS.tasks, label: '索引任务' }),
])

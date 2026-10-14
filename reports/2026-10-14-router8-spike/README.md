# 证据 · react-router 8.4.0 spike（T-01）

> 日期：2026-10-14 · 类型：**本轮实测** · 结论：**通过，锁定 8.4.0**
> 原始输出（同目录）：`npm-test.txt` · `typecheck.txt` · `build.txt` · `e2e-navigation.txt`

## 这一 spike 要回答什么

升级到 v8 会不会破坏我们的路由？我们只用 6 个核心 API：
`createHashRouter` · `RouterProvider` · `Navigate` · `Link` · `NavLink` · `useParams`（外加测试里的 `matchRoutes`）。

## 做法

1. `npm install react-router@8.4.0`（安装成功，`package.json` 记为 `^8.4.0`）
2. **不改任何代码** —— 先验最坏情况
3. 跑四道门禁

## 结果

| 门禁 | 结果 |
|---|---|
| `npm test` | ✅ **313 · 312 · 0 · 1**，EXIT=0（含 `router.test.mjs` 的 `matchRoutes` 真解算） |
| `npm run typecheck` | ✅ EXIT=0 |
| `npm run build` | ✅ EXIT=0，三端产物齐备（renderer 单 chunk 1168.8 → **1174.13 KB**，+5.3 KB） |
| `npm run e2e -- smoke routing` | ✅ **10 passed**（真窗口：hash 路由 / 参数捕获 / 未知 hash 回退 / 标题随路由变 / 无 a 嵌 button / preload 恰好三键） |

## 两个发现

1. **一行都不用改**：`RouterProvider` 在 v8 里**仍然从 `react-router` 根导出**（升级指南里那条「DOM API 改从 `react-router/dom` 引入」是针对**从 `react-router-dom` 迁移**的场景；我们本来就没装 `react-router-dom`）。⇒ 现在改反而多一处差异，**保持不动**；若上游将来废弃根导出，再切 `react-router/dom`。
2. 包体积增加约 **5 KB**（1168.8 → 1174.13 KB）—— 相对 1.17 MB 可忽略。

## 结论

**采用 react-router 8.4.0**。这是 T-01 的「全绿 ⇒ 锁定 8.4.0 并同步文档」分支；已同步 `AGENTS.md` 的路由版本。

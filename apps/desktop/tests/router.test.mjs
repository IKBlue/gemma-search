// apps/desktop/tests/router.test.mjs —— 路由表验证（**真的跑路由匹配**，不是 grep 字符串）
//
// 为什么能这么测：`router/paths.js` 是**纯数据**（无 JSX），react-router 的 `matchRoutes()`
// 只需要 `path`，不需要 DOM。所以"≥3 条路由可达"这句能被真跑，而不是靠人看代码。
//
// ⚠️ 这**证明不了**的（如实记账，别把它读成"导航没问题"）：
//   真实渲染、点击导航、hash 变化、返回键 —— 那些要 DOM。而覆盖渲染层的 DOM 守卫
//   已于 2026-10-13 移除 ⇒ **实际导航必须人工 `npm run dev` 看**。
//   本文件能证明的是：**路由表本身是对的**（路径、参数捕获、表与组件映射的完整性）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRoutes } from 'react-router'

import { ROUTES, PATHS } from '../src/renderer/src/router/paths.ts'

test('R1：路由表至少 3 条，且路径唯一（多页是 P3c/P3d 的前置）', () => {
  assert.ok(ROUTES.length >= 3, `至少有 3 条路由，实际 ${ROUTES.length}`)
  const paths = ROUTES.map((r) => r.path)
  assert.equal(new Set(paths).size, paths.length, '路径不能重复')
  for (const r of ROUTES) {
    assert.ok(r.key && r.path && r.label, `每条都要有 key/path/label：${JSON.stringify(r)}`)
  }
})

test('R2：每条路由都能被 matchRoutes **真的解算**出来', () => {
  // 把 path 换成实参（带 :param 的用具体值）
  const samples = {
    [PATHS.search]: '/',
    [PATHS.tasks]: '/tasks',
    [PATHS.item]: '/item/L1/0123456789ab',
    [PATHS.activity]: '/activity',
  }
  for (const r of ROUTES) {
    const probe = samples[r.path]
    assert.ok(probe, `测试没有覆盖这条路由：${r.path}（新加路由时请补进 samples）`)
    const m = matchRoutes(ROUTES, probe)
    assert.ok(m && m.length, `matchRoutes 解不出 ${probe}`)
    assert.equal(m[0].route.key, r.key, `${probe} 应该命中 ${r.key}`)
  }
})

test('R3：⭐ `/item/:libId/:uid` 的**参数真的被捕获**（P3c 靠它拿两条路径）', () => {
  const m = matchRoutes(ROUTES, '/item/L1/0123456789ab')
  assert.ok(m && m.length, '应命中')
  assert.deepEqual(m[0].params, { libId: 'L1', uid: '0123456789ab' })
  // 参数形状的正确性由契约层（`shared/ipc.ts` 的 LibId/Uid 正则）负责，路由只负责**取出来**
})

test('R4：未知路径在路由表里**不命中**（真实 router 里另有 catch-all 兜到 /）', () => {
  for (const bad of ['/nope', '/item', '/item/L1', '/tasks/extra']) {
    assert.equal(matchRoutes(ROUTES, bad), null, `${bad} 不该命中任何已登记路由`)
  }
  // 说明：`/item`（缺 uid）确实不命中 —— 所以真实 router 的 `path:'*'` 会把它送回 `/`，
  // 而不是白屏。那条 catch-all 在 `router/index.jsx`，它含 JSX ⇒ 进不了本文件。
})

test('R5：hash 路由的路径都不带协议/主机（否则 file:// 下会 404）', () => {
  for (const r of ROUTES) {
    assert.ok(r.path.startsWith('/'), `${r.path} 必须是站内绝对路径`)
    assert.ok(!/^https?:|^file:/.test(r.path), `${r.path} 不能是完整 URL`)
  }
})

# 证据 · W1-A 工具链 spike（Lead）

> 日期：2026-10-14 · 类型：**本轮实测** · 结论：**通过 —— 主进程 .ts 可以进 electron-vite 构建与类型门禁**
> 原始输出：`typecheck.txt` · `npm-test.txt` · `build.txt` · `e2e-smoke.txt`

## 这一步验的是什么

全量 TS 迁移的第一块砖：**主进程的 .ts 能不能被打包、能不能被类型门禁覆盖**。
只转了一个文件（风险最小、可回退），不是整包转换。

## 改了什么

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/main/log.mjs` | **删除**（转为 .ts） |
| `apps/desktop/src/main/log.ts` | **新增**：给 `log()` / `fmt()` / `isWorkspaceRoot()` / `detectRepoRoot()` 补精确类型；注释与"为什么"全部保留 |
| `apps/desktop/src/main/index.mjs` | 只改一行 import：`'./log.mjs'` → `'./log.ts'` |
| `tsconfig.node.json` | + `allowImportingTsExtensions: true`（Node ESM 必须写显式扩展名 ⇒ .ts 之间只能 `import './x.ts'`，否则 TS5097）；include 增加 `packages/indexer/src/**/*` |
| `tsconfig.web.json` | + `allowImportingTsExtensions: true`（渲染层那波要用） |

> `allowImportingTsExtensions` 这条是 **core-migrator（W1-B）先实测出来再上报**的阻塞，我没有擅自改 —— 根配置归 Lead。
> 他的原始复现输出会写在 `engine.txt` 里。

## 结果：四道门禁全绿

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ **EXIT=0**（此时 `log.ts` 已被严格检查；其余 main 仍是 .mjs，`checkJs:false` 不参与） |
| `npm test` | ✅ **313 · 312 · 0 · 1** |
| `npm run build` | ✅ **EXIT=0**，三端产物齐备（main 入口仍为 .mjs，图里已含 .ts 依赖） |
| `npm run e2e -- smoke.spec.mjs` | ✅ **1 passed**（真窗口出窗、preload 恰好三键、0 控制台错误） |

## 边界（这一步**没有**证明什么）

- ❌ 没有证明 preload 转 .ts 可行（还没做）。
- ❌ 没有证明剩余 7 个 main 文件在 strict 下干净 —— 那是 W2-MAIN 的事。
- ⚠️ 顺带记一条隐患：`log.ts` 里 `ENGINE_MARKER = packages/engine/src/engine.ts` —— **引擎改名不同步就会静默失效**（标记找不到）。
  当前 ROOT 仍靠 `package.json 的 workspaces` 正确解析（e2e 出窗证明），但这条要在 W1-B 落地后核对。

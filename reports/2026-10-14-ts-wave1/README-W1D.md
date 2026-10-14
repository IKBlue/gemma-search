# 证据 · W1-D 测试侧 A/B/C 适配（Lead）

> 日期：2026-10-14 · 结论：**npm test 恢复 313/312/0/1 · EXIT=0**
> 原始输出：`tests-adapt.txt`

## 为什么会有这一步

W1-C 把 Operation 层改成 .ts 后，测试侧有三类**跨范围**阻塞（renderer-migrator 侦察时逐条列出，
并自己用 scratch harness 证明「只要这两步就能全绿」）：

| 类 | 问题 | 修法 |
|---|---|---|
| A | 测试 import 的是旧 `.js` 规格（Node ESM 不做 .js→.ts 映射） | 7 个文件 8 条 import 改成 `.ts` |
| B | 按路径读源码时写死旧扩展名 | `dom-validity` 的 `router/paths.js`、`copy` 的 `hooks/useToast.js` 3 处 → `.ts` |
| C | `walk()` 只收 `.(js|jsx)` ⇒ 迁移后扫描面变窄，阈值类断言必红 | 4 处扫描面加宽到含 `.ts/.tsx`（layering · style-contract · copy · styles） |

另修一处**同源隐患**：`deps.test.mjs` 里判断"只有一份 class 合并实现"的正则是 `\.js$` ——
W2-UI 把 `ui/cn.js` 改成 `cn.ts` 之后它会认不出来；已加宽为 `\.(js|ts)$`。

## 结果

| 命令 | 结果 |
|---|---|
| `npm test` | ✅ **313 · 312 · 0 · 1**，EXIT=0（UI 层仍是 .jsx，加宽后的 walk 照样计入，所以不依赖 W2-UI） |
| `npx tsc -p tsconfig.web.json` | ✅ EXIT=0 |
| `npm run build` | ✅ EXIT=0（TEMP 指向仓库内） |

> 说明：这几处改动**只动扫描面与 import 规格，不动任何断言语义** —— 与 renderer-migrator 的 scratch harness 口径一致。

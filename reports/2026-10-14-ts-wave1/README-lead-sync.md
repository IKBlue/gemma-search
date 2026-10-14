# 证据 · W1-A/W1-C 之间的 Lead 同步（跨范围改名收口）

> 日期：2026-10-14 · 类型：**本轮实测** · 关键结论：**引擎/索引器转 .ts 后，编码路径与基线逐位一致**
> 原始输出：`guard-after-ts.txt`

## 为什么有这一批改动

W1-B（core-migrator）把 `packages/engine/src/*.mjs` 与 `packages/indexer/src/*.mjs` 改名成 `.ts` 后，
**跨范围的引用方**全都会断。这些引用方归 Lead，一次性同步：

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/main/index.mjs` | `engine.mjs` → `engine.ts` |
| `apps/desktop/src/main/encoder.mjs` | `resize_compat.mjs` / `bmp_decode.mjs` → `.ts`（静态 + 动态各一处） |
| `apps/desktop/tests/deps.test.mjs` | D-C 断言里的两个路径字符串 → `.ts` |
| `tools/check_search.mjs` | 仓库根标记与 import → `engine.ts` |
| `tools/verify_encoder_path.mjs` | 仓库根标记 → `engine.ts`；动态 import → `resize_compat.ts` / `index.ts` |
| `packages/engine/package.json` | `main` 字段 `./src/index.mjs` → `./src/index.ts` |

> ⚠️ 两个守卫的**仓库根标记**都写死了 `packages/engine/src/engine.mjs` —— 文件一改名，守卫就找不到项目根。
> 这正是 AGENTS 里反复强调的「改名不同步 = 静默失效」；本次靠 grep 全仓 `.mjs'` 才抓全。

## 顺带修掉的两个真问题（都由这次迁移暴露）

1. **`shared/ipc.ts` 用了 `Buffer.byteLength`** —— 一旦渲染层也 import 契约类型（W1-C 正在做），
   web 工程立刻报 `TS2591: Cannot find name 'Buffer'`（渲染层 lib 只有 DOM，没有 Node 全局）。
   已改为 `new TextEncoder().encode(...).length`（UTF-8 字节数等价，两边都有）；`permissions.test.mjs` 15 passed 证明载荷上限逻辑没变。
2. **`tsconfig.web.json` 不含 `apps/desktop/src/shared/**`** —— composite 工程要求被引用文件在 file list 里，
   否则 TS6307；已加进 include（这是 renderer-migrator 侦察时预判到的，他按规矩没自己改根配置）。

## 关键验证：编码路径没有因为转 TS 而改变

`node tools/verify_encoder_path.mjs --model <模型目录> --lib G:\model` → **PASS / EXIT=0**，数字与迁移前基线**逐项一致**：

| 断言 | 迁移前基线 | 转 .ts 之后 |
|---|---|---|
| 索引 | 3594 条 · dim 768 | 3594 条 · dim 768 |
| encodeImage ↔ 索引行 | cos = 1.000000 | **cos = 1.000000** |
| BMP 回退 | source=bmp-fallback · 768 维 | **同** |
| 文本 ‖v‖ / 维度 | 1.000000 / 768 | **同** |
| 「北欧吊灯」Top-5 | 0.7855 · 0.7852 · 0.7836 · 0.7756 · 0.7751 | **完全相同** |

⇒ 这就是 T-00 那条护栏的第一次实战：**改了引擎与索引器，能用同一基线证明没有静默降质**。

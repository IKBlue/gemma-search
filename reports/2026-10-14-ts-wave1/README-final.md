# 证据 · 全量 TypeScript 迁移（T-05）总集

> 日期：2026-10-14 · 类型：**本轮实测** · 结论：**完成，四道门禁全绿 + 类型门禁“能红”已实测**
> 原始输出：`tests-final.txt` · `e2e-full-final.txt` · `guard-after-encoder-fix.txt`
> 队友专项：`engine.txt` · `indexer.txt` · `main.txt` · `renderer-operation.txt` · `renderer-ui.txt`

## 规模

| 范围 | 文件 | 负责 |
|---|---|---|
| `packages/engine/src` | 13 个 `.mjs` → `.ts` | core-migrator |
| `packages/indexer/src` | 12 个 `.mjs` → `.ts` + 2 个纯类型文件 | indexer-migrator |
| `apps/desktop/src/main` + `preload` | 7 + 1 → `.ts` | main-migrator（+ Lead 的 `log.ts` / `preload/index.ts`） |
| `renderer/src` | 29 `.jsx` + 16 `.js` → `.tsx/.ts`（含 3 个新增类型文件） | renderer-migrator（Operation 层）+ ui-migrator（UI 层） |
| 根配置 | `tsconfig.node` / `tsconfig.web`（`allowImportingTsExtensions` · include 加 `shared` / `indexer`） | Lead |
| tools / tests | 两个守卫的改名同步 + 测试侧路径与扫描面适配 | Lead |

**`src` 下 `.mjs/.js` 残留 = 0**；逃逸写法（`any / as any / @ts-ignore / @ts-expect-error`）在迁移范围内 **0 命中**。

## 三条被迁移暴露出来的真问题（都已修 + 有防复发手段）

1. **编码路径接线断开**（`main/encoder.ts` 漏 `await model.forward`）—— 四道门禁全绿却**功能全废**，
   由 indexer-migrator 独立复刻护栏抓到。详见 `README-encoder-regression.md`；
   已新增 `apps/desktop/tests/encoder-call-site.test.mjs`（双向验证过：抹掉 `await` 立刻变红）。
2. **`shared/ipc.ts` 用了 `Buffer`** —— 渲染层一旦引用契约类型就 `TS2591`（渲染层没有 Node 全局）。改为 `TextEncoder`，语义等价。
3. **两个守卫把仓库根标记写死成 `engine.mjs`** —— 改名后守卫会找不到项目根（静默失效）。已同步为 `.ts`。

## 另有一条“假绿”被当场抓住

`styles.test.mjs` 的 T1/T2 只扫 `.js|.jsx`。UI 转 `.tsx` 后：T1 的自检 `files.length > 5` **变红**（好），
而 T2 的过滤只剩空集 ⇒ **恒绿的空气断言**（坏）。两处都加宽到 `.ts/.tsx` 后才既真红又真绿；
并已 grep 确认测试里再无 `.(js|jsx)` 这类会随迁移失效的过滤器。

## 最终验收（Lead 在最终树上一手跑的）

| 命令 | 结果 |
|---|---|
| `npm test` | ✅ **314 pass / 0 fail / 1 skipped · EXIT=0** |
| `npx tsc --noEmit -p tsconfig.node.json` | ✅ **EXIT=0** |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ **EXIT=0** |
| `npm run build` | ✅ EXIT=0，三端齐备 |
| `npm run e2e`（全量） | ✅ **62 passed / 0 failed（7.3 分钟）** |
| 类型门禁**能红** | ✅ 注入 `const x: number = 's'` ⇒ `TS2322` + EXIT=1；还原 ⇒ EXIT=0，且 `git diff` 为空 |
| 编码护栏 `verify_encoder_path` | ✅ **PASS / EXIT=0**，「北欧吊灯」Top-5 = 0.7855/0.7852/0.7836/0.7756/0.7751 与基线**逐位一致** |

> 说明：`npm test` 计数从 313 变 314，是因为新增了 `encoder-call-site.test.mjs` 的两条接线断言。
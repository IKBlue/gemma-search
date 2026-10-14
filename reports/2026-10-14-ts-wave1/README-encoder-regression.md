# 事故与回归证据 · 编码路径接线断开（2026-10-14）

> 类型：**本轮实测（事故 + 修复 + 复验）** · 结论：**已修复，护栏 PASS，Top-5 与基线逐位一致**
> 原始输出：`guard-after-encoder-fix.txt`（修复后护栏）· 新回归断言：`apps/desktop/tests/encoder-call-site.test.mjs`

## 事故是什么

W2-MAIN 把 `apps/desktop/src/main/encoder.mjs` 转成 `encoder.ts` 时，两处调用点**漏掉了 await model.forward(...)**：

| | 旧 .mjs（正确） | 转 .ts 后（错误） |
|---|---|---|
| encodeText | `pickEmbedding(await model.forward(inputs))` | `pickEmbedding(inputs)` |
| encodeImage | `pickEmbedding(await model.forward(inputs))` | `pickEmbedding(inputs)` |

于是喂给 `pickEmbedding` 的是**处理器输出**（`input_ids/attention_mask/pixel_values/…`）而不是模型输出 ⇒
`encodeText` / `encodeImage` **每次调用都抛**「输出里既无 sentence_embedding 也无 last_hidden_state」。

### 为什么所有门禁都没报

| 门禁 | 为什么看不出来 |
|---|---|
| `npm test` | 真实编码需要 1.7 GB 模型，**单测根本不加载 encoder** |
| `npm run build` | 只证明能打包 |
| `npm run e2e` | 跑的是**模拟模式**（`GEMMA_FAKE=1` + fixtures），**根本不编码** |

⇒ 这条路径的失败模式就是 AGENTS §4 写的那个：**静默**（不报错、不崩溃，只是全废）。它需要的是**真编码护栏**，不是单测。

### 是谁抓到的

`indexer-migrator`（task-8）在复刻护栏时发现：他把护栏脚本抄到 scratch、只把 `encoder.mjs` 换成 `encoder.ts` 重跑，
encodeImage / encodeText / BMP 回退**全部 FAIL**，而 indexer 自己那三个导出（installResizeCompat / selfTest / assert）都是 OK
⇒ 所以问题只可能在 encoder.ts。**这是"队友独立复刻验证"抓到的真回归。**

## 两个直接原因（都记在这里，避免重犯）

1. **护栏自己先炸了**：`tools/verify_encoder_path.mjs` 里写死了
   `import(... 'apps/desktop/src/main/encoder.mjs')` —— 文件改名后护栏 `ERR_MODULE_NOT_FOUND`，
   于是「改编码路径必须重跑护栏」这条纪律在**最需要它的时刻**失效。
2. **我（Lead）在提交 90b3e03 时没有重跑护栏** —— 这违反了 AGENTS §4「编码护栏（硬性）」。
   事后看，护栏当时也是坏的（第 1 条），就算想跑也跑不起来。**两条叠加才让回归活到了提交之后。**

## 修复

| 文件 | 改动 |
|---|---|
| `main/encoder.ts` | 两处恢复 `pickEmbedding(await model.forward(inputs))`；顺便删掉 indexer 补完类型后已不需要的 `as unknown as` |
| `tools/verify_encoder_path.mjs` | import 目标与注释 `encoder.mjs` → `encoder.ts`（护栏重新可用） |
| `apps/desktop/tests/encoder-call-site.test.mjs`（新增） | **接线断言**：① 必须有 ≥2 处 `pickEmbedding(await model.forward(inputs))`、且**不许**出现 `pickEmbedding(inputs)`；② 护栏引用的 encoder 文件必须**真实存在**（防止护栏再次悄悄失效） |

**这条新断言当场做了双向验证**：把 `await model.forward(...)` 抹掉后 E-1 **立刻变红**，恢复后转绿 —— 不是空断言。

## 复验

| 命令 | 结果 |
|---|---|
| `node tools/verify_encoder_path.mjs --model <模型> --lib G:\model` | ✅ **PASS / EXIT=0** |
| 「北欧吊灯」Top-5 | ✅ **0.7855 / 0.7852 / 0.7836 / 0.7756 / 0.7751**（与迁移前基线逐位一致） |
| encodeImage ↔ 索引 cos | ✅ 1.000000（native 与 BMP 回退各一条） |
| `npx tsc -p tsconfig.node.json` | ✅ EXIT=0 |
| `npm test` | ✅ **314 pass / 0 fail / 1 skipped**（新增 2 条断言全过） |

## 教训（写给未来的自己）

- **改 `packages/indexer/**` 或 `main/encoder.*` ⇒ 同一提交内必须附护栏原始输出**，且**护栏本身要先能跑**。
- 护栏脚本的 import 目标是**硬编码路径**，是这次失守的放大器：任何改名都要同步它，
  现在有 E-2 这条断言兜底（它检查的是"引用的文件真实存在"）。
- "模拟模式 E2E 全绿"**不能**代表编码路径可用 —— 这一点必须写在证据里，不许含糊。

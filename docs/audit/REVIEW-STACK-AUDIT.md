# REVIEW-STACK-AUDIT · 独立复核 ① `STACK-AUDIT.md`

> 复核者：**review-1**（不参与 `STACK-AUDIT.md` 的写作）
> 复核对象：`STACK-AUDIT.md`（作者 stack-auditor，63,470 B / 409 行）
> 判据：`docs/audit/01-acceptance-criteria.md` §7（§2 G1-G7 / §3 严重度 / §4 S1-S10）
> 共同事实基准：`docs/audit/00-current-state.md`（下称**基线**）
> 复核时间：本轮审查；复核命令全部为只读。**本次复核只写了本文件**，未改动 `STACK-AUDIT.md`、`docs/audit/stack-evidence.md` 或任何源码/配置。

---

## 0. verdict

```yaml
verdict: pass-with-issues
```

**理由摘要**：报告的四项最重结论（P1 类型门禁假绿 / P2 `reveal` 假成功 / P5 依赖零使用 / P7 守卫红灯）**全部经我独立重跑或回原文件核对，成立**；G2/G4/G5/G6/G7 达标。但复核中发现 **6 处实质性错误**（1 处「证据不支持其具体主张」+ 1 处对基线的错误描述 + 4 处数字/内部矛盾），其中 2 处会误导读者对 **S4（Tailwind 否决理由）** 与 **P7 novelty（相对基线的增量）** 的判断。这些错误都**不动摇报告的任何一条头条结论**，因此不判 `fail`；但作为「独立复核」的门槛，`blockers` 未清零前不能算 `pass`。

**未发现**：结论不成立（结论为假）、严重度严重失准、与基线相反的实质事实。

---

## 1. blockers[]（必须修正才能通过；含报告位置 + 为什么不成立）

> 说明：任务书已告知 **基线 D1「全仓无一处提到 verify-doc-refs」** 与 **D5「METHOD_NAMES 广播 11 个方法」** 两处修正已由 Lead 确认并回写基线，**本复核不重复计入**。

### B1 · §5.2-A「Tailwind 三处硬冲突」之②——证据不支持该主张（实质）

- **报告位置**：`STACK-AUDIT.md:145`（§5.2-A，Tailwind 的 ②）
- **报告原文**：「② `SPEC-security.md:310-311` 为 Tailwind 预设了 `style-src-elem 'unsafe-inline'` 的 CSP 放宽，而当前生产 CSP（`src/renderer/index.html:9`）已经足够，引入 Tailwind 等于**为样式多买一次 CSP 让步**」
- **为什么不成立**（三项磁盘事实）：
  1. `src/renderer/index.html:9` 当前生产 CSP **本来就含** `style-src 'self' 'unsafe-inline'`（本次实读，见 §2 抽查 S6），不是「已经足够、无需放宽」的状态；引进 Tailwind **买不到任何新的让步**，它已经在包里。
  2. 同一文件 `:7` 的注释自己写明：「style-src 的 'unsafe-inline' 是 Vite 注入样式所必需（**生产态样式会抽成文件**）」——即这次放宽是 **Vite dev 注入**带来的，与是否用 Tailwind 无关。
  3. 被引的 `docs/spec/SPEC-security.md:310-311` 位于 **§10.4「如果你仍要更严」**，是「把 `style-src` 拆成 elem/attr 两行以便复查」的**可选收窄建议**，该节 `:314` 自述「**这不提升安全性**」，`:266` 的最终推荐是**保留** `'unsafe-inline'`。它不是「为 Tailwind 新开的让步」。
- **影响**：S4 对 Tailwind 的否决仍站得住（理由 ①令牌纪律、③收益比仍有效），但**三条硬否决理由里有一条以其所述形式不成立**；读者若照此写文档会写错 CSP 结论。
- **修法**：删掉该理由，或改写为「本项目 CSP 已因 Vite 保留 `style-src 'unsafe-inline'`，Tailwind 不新增让步，但也**不解决**已存在的放宽；是否收窄是独立议题（`SPEC-security.md` §10.4）」。

### B2 · §11 P7 的「覆盖」栏错误描述基线（实质）

- **报告位置**：`STACK-AUDIT.md:343`（P7 行末「覆盖」列）
- **报告原文**：「覆盖：新（**D1 只记了「未文档化」，未记「已失败」**）」
- **为什么不成立**：基线**明确记录了失败**——`docs/audit/00-current-state.md:105`（D1 行）写「计数过期 + 该守卫**当前 EXIT=1**（见下）」，并在 `:164` 起单列一节「**6.1 ⚠️ 仓库自检门禁当前是红的（EXIT=1），Lead 实测**」，其中含 `:167-173` 的原始输出与「**未通过**：死引用 7 · 根目录越界 3」。
- **影响**：P7 的**技术结论**（守卫红、无 CI、`npm test` 不跑守卫）成立且我复跑确认；被夸大的只是它的 **novelty 归属**。这会连带影响 §11 末尾「新发现问题 8 条」的计数口径（P7 中「已失败」这一半不是新发现）。
- **修法**：改写为「覆盖：**部分新**（基线 D1/§6.1 已记「当前 EXIT=1 + 死引用 7」；本轮**新增**的是：无 CI、无提交钩子、`npm test`/`package.json` 完全不接线、且 EXIT=1 会随审查文件增加而恶化）」。

### B3 · §3 依赖拓扑的两处内部算术错误（实质，可复算）

- **报告位置**：`STACK-AUDIT.md:91` 与 `:93`
- **报告原文**：`:91`「真正被 import（**5+2**）：react, react-dom, zod, @huggingface/transformers, sharp*, bmp-js*」；`:93`「零 import 但声明为生产依赖（**19**）」
- **为什么不成立**：
  - 「真正被 import」清单**只有 6 个包**（react / react-dom / zod / @huggingface/transformers / sharp / bmp-js），按报告自己的 `*` 约定是 **4+2**，不是 5+2。
  - `package.json` 实测 **24 个 dependencies**（含 **12** 个 `@radix-ui/*`，见 §2 抽查 S4）；零 import 项 = 12 + zustand + @tanstack/react-virtual + lucide-react + clsx + tailwind-merge + class-variance-authority = **18**。同一报告的 `:36`（依赖治理 D）、`:194`（24−18=6）、`:233-234`（E2 结论）都写 **18**，E2 的逐个 grep 也是 18。
- **影响**：与报告自身其余章节矛盾；「24−18=6」的说明链在 19 的口径下不成立。
- **修法**：`:91` 改「（4+2）」或「共 6 个」；`:93` 改「（18）」。

### B4 · §5.2-A 的「现有 CSS 只有 24,916 B」把构建产物当成源文件（实质）

- **报告位置**：`STACK-AUDIT.md:145`（Tailwind 的 ③）
- **报告原文**：「③ 现有 CSS 只有 **24,916 B**（E4）」
- **为什么不成立**：`src/renderer/src/renderer.css` 实测 **14,050 B**；**24,916 B 是构建产物** `out/renderer/assets/index-BCVIX9rf.css`（E4 表格 `docs/audit/stack-evidence.md:325` 自己写的就是「`out/renderer/assets/index-BCVIX9rf.css` 24916 B」，见 §2 抽查 S7）。
- **影响**：结论方向不受影响（14 KB 与 25 KB 都支持「量小、复用收益低」），但「现有 CSS」的指代错误会让引用者拿构建体积去论证源码。
- **修法**：改为「源文件 `renderer.css` 14,050 B（构建产物 24,916 B）」。

### B5 · E1.4 的 `verify-doc-refs.mjs` 证据与基线冲突且不可复现；P7 单一归因（实质，链条瑕疵）

- **报告位置**：`STACK-AUDIT.md:343`（P7 引「E1.4（EXIT=1 + 原始输出）」）；证据 `docs/audit/stack-evidence.md:150-164`
- **为什么不成立/不完整**：
  - 报告引用的原始输出是「**扫描引用 50 处 · ✓ 无死引用 · 根目录越界 1**」，而**同一条命令**在基线 `00-current-state.md:167-173` 是「**扫描引用 102 处 · 死引用 7 处 · 根目录越界 3**」，我本次复跑是「**扫描引用 106 处 · 死引用 10 处 · 根目录越界 3**」（见 §2 抽查 S3）。三份快照**互不相同**，报告未说明这是不同时刻的快照，也没解释与基线的数字冲突（G3 要求附新证据）。
  - P7 把失败**单一归因**为「`AGENTS.md` 留在根目录触发根目录越界」，遗漏了当时同样存在的**死引用**（基线 7 处，其中 `review-*.md` 一类正是本报告体系自己造成的）；且该输出里根目录 `.md` 只有 4 个，**不含 `STACK-AUDIT.md` 本身**，说明它是「报告文件还不存在时」的早期快照——用它给交付时的 P7 作证是**证据与结论不同期**。
- **影响**：P7 的**结论（EXIT=1）成立且我复跑确认**，故不是 fatal；但 G1「每个已验证结论可追溯」与 G3 在这一条上只能算**部分满足**。
- **修法**：把 E1.4 该段标注「**交付前快照**（当时 50/0/1）」并补一段**同期**复跑输出（或注明「数量随审查文件增长而增长：102→106，死引用 7→10」）；P7 的原因改为「根目录越界（含 `AGENTS.md`/审查交付物）+ 死引用」。

### B6 · §6 第 7 行「删 11 个」与处置栏「移除全部 12 个」自相矛盾（表面但需处置）

- **报告位置**：`STACK-AUDIT.md:186`
- **报告原文**：判决栏「❌ **现在删 11 个，保留决策**」；处置栏「**移除全部 12 个** → 等 P3b/P3c 真写确认弹窗时只装 `@radix-ui/react-alert-dialog`」
- **为什么不成立**：`package.json` 实测 **12 个** `@radix-ui/react-*`（§2 抽查 S4）。11 与 12 不能同时为真；从处置栏看作者意图应是「12 个全删，之后按需只装 alert-dialog」，判决栏的「11」是笔误或残句。
- **修法**：判决栏改为「❌ **现在删 12 个**；`AlertDialog` 的需求**保留为决策**，等 P3b/P3c 再按需装」。

---

## 2. spot_checks[]（我自己跑的 / 我自己读的；原始输出为准）

> 抽查 12 处（任务书要求 ≥5），其中 6 处为**重跑命令**、6 处为**回原文件行号核对**。所有 pwsh 输出为 GBK 控制台直出（中文正常，无乱码）。

### S1 · P2（`reveal` 静默假成功 / Critical）——**支持**

- 结论：主进程从不注入 `shell`；引擎在缺 `shell` 时仍 `return ok({revealed:true})`；界面据此弹成功文案。
- 读 `core/engine.mjs:427-436`（原文，摘录）：

```
427:     reveal: ({ libId, uid, target = 'archive' } = {}) => envelope(async () => {
432:       const abs = resolveInLibrary(registry.get(libId).root, rel);
433:       if (!fs.existsSync(abs)) throw fail(ERR.ITEM_MISSING_ON_DISK, `文件不存在：${rel}`, { rel });
434:       if (shell && typeof shell.reveal === 'function') shell.reveal(abs);
435:       return ok({ revealed: true, path: abs });
```

- 读 `src/main/index.mjs:116-126`：`createEngine({ config, encoder, onEvent })` —— **无 `shell`**。
- 读 `src/renderer/src/hooks/useSearch.js:79-80`：

```
79:     const r = await invoke('reveal', { libId: item.libId, uid: item.uid, target: item.archive ? 'archive' : 'image' })
80:     onToast(r.ok ? '已在资源管理器中定位' : (r.error && r.error.userMessage) || '定位失败', r.ok ? 'info' : 'err')
```

- 追加核对用户可达性：`grep reveal src/renderer/src` → `SearchPage.jsx:134 onLocate={search.reveal}`（按钮确实接到这个函数）。
- 命令复核「`shell` 在 `src/main/` 的出现次数」：`grep '\bshell\b' src/main` → **No matches found**。
- **判定：完全支持报告 P2 的证据链（行号与内容逐条相符）。**

### S2 · P1（类型门禁假绿）——**支持（数字逐项吻合）**

- 命令 1（报告判据 §4 要求的原命令）：`npx tsc --noEmit -p tsconfig.web.json`

```
EXIT=0
[stderr] npm notice ...（仅 npm 版本提示，无一行 tsc 输出）
```

- 命令 2：`npx tsc --noEmit --checkJs -p tsconfig.web.json`

```
TOTAL_ERROR_LINES=126
EXIT=1
--- CODE HISTOGRAM ---
   64 TS7031
   20 TS7006
   17 TS2339
   13 TS2741
    6 TS2322
    2 TS2882
    1 TS7019
    1 TS7053
    1 TS2345
    1 TS2353
```

- 命令 3：`npx tsc --noEmit --checkJs -p tsconfig.node.json`

```
TOTAL_ERROR_LINES=230
EXIT=1
--- onnx-spike 计（错误行含 onnx-spike） --- 44
--- noImplicitAny family --- 111
```

- 追加分文件核对（澄清 42 而非 44）：

```
COUNT=44
    9 onnx-spike/bmp_decode.mjs
   33 onnx-spike/resize_compat.mjs
    2 src/main/encoder.mjs        ← 这 2 条的「错误位置」在 encoder.mjs，只是消息里提到 onnx-spike 路径
```

- **判定：支持**。报告的 126（渲染层）、230（node 侧）、`onnx-spike` **42 条**（= 9+33，指错误**位于** `onnx-spike/` 的文件，报告 E1.3 `:132` 的写法精确）、noImplicitAny 家族 node 侧 **111**、渲染层 **86**（64+20+1+1）——**全部逐项吻合**；`第一方 314 = 126 + (230−42)` 亦可复算。报告 P1 的「EXIT=0 假绿」结论成立。

### S3 · P7（`verify-doc-refs.mjs` EXIT=1）——**结论支持，引用的原始输出不支持（见 B5）**

- 命令：`node tools/verify-doc-refs.mjs; $LASTEXITCODE`

```
=== 1) 文档引用解算 ===
  扫描引用 106 处
  **死引用 10 处**：
    docs/audit/uiux-evidence.md:544  →  color.md
    docs/audit/uiux-evidence.md:545  →  color.md
    docs/audit/uiux-evidence.md:546  →  materials.md
    docs/audit/uiux-evidence.md:547  →  typography.md
    docs/plan/DOCS-DEPLOYMENT.md:86  →  ../AUDIT-FINAL.md
    docs/plan/DOCS-TESTING.md:68  →  ../AUDIT-FINAL.md
    docs/plan/PROJECT-DOC-INDEX.md:15  →  ../../AUDIT-FINAL.md
    docs/plan/PROJECT-DOC-INDEX.md:65  →  ../../AUDIT-FINAL.md
    docs/plan/PROJECT-DOC-INDEX.md:66  →  ../audit/REVIEW-STACK-AUDIT.md
    docs/plan/PROJECT-DOC-INDEX.md:67  →  ../audit/REVIEW-UIUX-AUDIT.md
=== 2) 根目录是否只剩"入口 + 治理" ===
  根目录 .md：AGENTS.md · PROJECT-GUIDE.md · README.md · STACK-AUDIT.md · TASK-PLAN.md · UIUX-AUDIT.md
  !! 3 份不该留在根目录：AGENTS.md, STACK-AUDIT.md, UIUX-AUDIT.md（正文应放 docs/）
**未通过**：死引用 10 · 根目录越界 3
EXIT=1
```

- 判定：**EXIT=1 成立**，且 `STACK-AUDIT.md`/`UIUX-AUDIT.md` 自身就在越界名单里（报告 P7 只写了 `AGENTS.md`）。与基线（102/7/3）和 E1.4（50/0/1）三方不一致 → 见 B5。
- 顺带核实报告 §13.1 提及的脚本语义：`tools/verify-doc-refs.mjs:148` `const fail = dead.length > 0 || strays.length > 0;` → 「越界」确实会让 EXIT=1，报告 P7 的因果方向正确。

### S4 · P5（18 个生产依赖零 import）——**支持（含 3 个指定抽查）**

- 命令：对 `src,core,tests,tools,onnx-spike,spike` 下 `*.js/*.jsx/*.mjs/*.ts/*.tsx` 逐个 `Select-String`（简单匹配）：

```
zustand => 0
@tanstack/react-virtual => 0
@radix-ui/react-alert-dialog => 0
@radix-ui/react-dialog => 0
lucide-react => 0
clsx => 9
tailwind-merge => 0
class-variance-authority => 0
```

- `clsx` 的 9 处**逐条定位**（这是唯一需要解释的项）：

```
src\renderer\src\ui\cx.js:1  len=33   isImport=False     ← 注释「不值得为此引 clsx」
onnx-spike\node_modules\onnxruntime-web\dist\ort.all.js:42527 ... isImport=False   （第三方 bundle，非项目代码）
… 其余 7 处同属 onnx-spike\node_modules\onnxruntime-web\dist\*.{js,mjs}
```

→ **项目自有代码里 `clsx` 只有 1 处注释、0 处 import**，与报告 `:188`/E2 `:217` 的写法（「唯一出现是 `cx.js:1` 的注释」）**完全一致**。
- 依赖计数与体积：

```
deps=24  devDeps=13  radix=12
lucide-react: files=4328 MB=34.1
node_modules 顶层包=334
onnx-spike/node_modules 顶层包=34
```

→ 报告 `:341`（18 个零使用、lucide 34.1 MB / 4328 文件）、E2.1（21,472 文件 / 1089.9 MB / 334 顶层）**逐项支持**；`24−18=6` 的减法成立（反证 B3 的「19」是错的）。
- 追加：`npm ls --depth=0` 的 extraneous 项与报告 `:192` 一致：

```
+-- @emnapi/runtime@1.11.3 extraneous
+-- @img/sharp-wasm32@0.35.5 extraneous
```

- **判定：支持。**

### S5 · P6（打包未接通）——**支持**

- `src/main/log.mjs:25`（实读）：`export const ROOT = process.env.GEMMA_ROOT || path.resolve(HERE, '..', '..');` ✔
- `src/main/log.mjs:52-53`（实读）：`if (LOG_FILE.includes('app.asar')) log('!! 注意：应用根落在 asar 内…需要改用 userData（P6）');` ✔
- `src/main/index.mjs:94-97`（实读）：`const base = path.join(config.model_cache || path.join(ROOT, '..', 'model-cache'), 'onnx', 'embeddinggemma-2');` ✔（报告写 `:96-97`，落在范围内）
- `src/main/encoder.mjs:62-63`（实读）：`env.allowLocalModels = true; env.allowRemoteModels = false;` ✔
- `electron-builder.yml`（实读全文 41 行）：`:16 - '!onnx-spike/*'`、`:21-22 asarUnpack: - resources/**`、`:5-6` 注释自认原生 `.node` 需按实测加进 `asarUnpack`、`:41 npmRebuild: false` —— **报告 §8 引用的每一处行号与内容都相符**。
- 目录实测：

```
resources 条目数 = 0        （报告「resources/ 实测为空」✔）
Test-Path config.json = False（报告 P3 的前提 ✔）
tools/*.mjs 个数 = 7        （报告 P11「文档说 6、实测 7」✔）
```

- **判定：支持。**

### S6 · S4 之 Tailwind 否决理由 ② 的「当前生产 CSP」——**不支持报告（见 B1）**

- 读 `src/renderer/index.html:7-11`（原文）：

```
 7:        style-src 的 'unsafe-inline' 是 Vite 注入样式所必需（生产态样式会抽成文件）。 -->
 8:   <meta http-equiv="Content-Security-Policy"
 9:         content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
10:                  img-src 'self' thumb: data:; font-src 'self'; connect-src 'self';
11:                  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" />
```

- 读 `docs/spec/SPEC-security.md:264-266,305-315`：`:266`「**推荐：保留 `style-src 'self' 'unsafe-inline'`**」；`:310-311` 在 §10.4「如果你仍要更严」；`:314`「**这不提升安全性**，但让"我们放开了什么"在 CSP 里一眼可见」。
- **判定：报告 `:145` 的 ② 以其所述形式不成立**（生产 CSP 早已含 `unsafe-inline`；被引章节是可选收窄建议，不是为 Tailwind 新开的让步）。

### S7 · §5.2 的「现有 CSS 只有 24,916 B」——**不支持报告（见 B4）**

- 命令：`(Get-Item src\renderer\src\renderer.css).Length` → **14050**
- 命令：`Get-ChildItem out\renderer\assets -Filter *.css` →

```
index-BCVIX9rf.css  24916
```

- **判定：24,916 B 是构建产物体积；源文件是 14,050 B。**

### S8 · ¶S4（规格承诺栈）引用的文档行号——**支持**

- `grep` `docs/spec/SPEC-app.md`：`:63` 语言 **TypeScript**；`:65` **shadcn/ui + Radix UI**（原文含「Radix 提供 `AlertDialog`/`Dialog`/`Popover`/`Toast`，正是**文件操作确认弹窗**所需的焦点管理与 `aria-*`」）；`:66` **Tailwind CSS**；`:70` **zustand**；`:71` **@tanstack/react-virtual（仅用于浏览整库）**；`:72` **vitest**；`:184` 主进程/渲染进程 TypeScript。报告 §5.1 表格的每一格**逐字相符**。
- `grep TASK-PLAN.md`：`:23`「Electron + **TypeScript** + React + Tailwind + shadcn/ui」；`:212`「**视觉值一律取自令牌，组件里不写十六进制**」。报告 §5.1/§5.2-A① 引用正确。
- 实测 `全仓 .ts/.tsx = 0`、`tailwindcss/@tailwindcss/vite` 在 devDeps 且 `electron.vite.config.mjs:69 plugins: [react(), devCspRelax()]`（实读）✔。

### S9 · P9（SPEC-security 供应链清单失真）——**支持**

- `grep docs/spec/SPEC-security.md`：

```
167: 实测体量：`node_modules` **596 MB / 16,894 文件 / 288 个顶层包**，
168: 但**生产依赖只有 21 个**
192: | `sharp` / `jimp`（缩略图） | Electron 自带 `nativeImage`，省掉一个约 30 MB 的原生依赖 |
208: **当前 `core/` 的 61 条测试跑在 `node:test` 上**
```

- 实测反证：`deps=24`（`:167-168` 的 21 错）、`node_modules 顶层包=334 / 1089.9 MB`（596 MB / 288 错）、`sharp` 确为生产依赖（`package.json` deps 列表实读含 `sharp@^0.35.5`）、测试 **68** 条（`61` 错）。
- `sharp` 使用链**三段全部实读确认**（回应任务书要求）：

```
src/main/encoder.mjs:12   import { installResizeCompat, selfTestResizeCompat, assertResizeCompatInstalled } from '../../onnx-spike/resize_compat.mjs';
onnx-spike/resize_compat.mjs:34-37   async function loadSharp() { const m = await import('sharp'); return m.default ?? m; }
package.json:55-56  "sharp 必须**显式声明**：它本是 @huggingface/transformers 的可选传递依赖，而 src/main 的编码路径（重采样兼容层）直接 import 它"
```

→ **作者对 `sharp` 的三条判断（在 dependencies / 经 `encoder.mjs:12` 进生产路径 / `resize_compat.mjs:35` 动态 import）逐条成立。**
- **判定：支持。**

### S10 · P11（守卫数量文档过期）——**支持**

- `grep README.md`：`:47`「`tools/` 里剩下的是 **6 个** Node 守卫（构建形状 / 渲染层 DOM / 样式 / 编码路径 / 冒烟 / 检索自查）」；`:94-103` 的命令清单里**没有** `verify-doc-refs.mjs`（实读确认）。
- `(Get-ChildItem tools -File -Filter *.mjs).Count` = **7**。
- **判定：支持**（且与基线 D1 的「计数过期」一致；基线关于「全仓无一处提到」的那半已由 Lead 推翻，不重复计）。

### S11 · P14（SPEC-app 命令区仍是 Python 时代）——**支持**

- `grep docs/spec/SPEC-app.md`：`:119`「pnpm test  # vitest，只跑 core/ 与 transactions/」；`:128-131` 四条 `& ..\.venv\Scripts\python.exe tools/...`。报告引用**行号与内容逐字相符**。（仓库 0 个 Python 文件由基线 §1 P7 记录。）

### S12 · §7 测试分层与 §9 索引算法的行号——**支持**

- 逐文件实测测试条数：

```
tests\engine.test.mjs => 27
tests\index.test.mjs  => 18
tests\security.test.mjs => 16
tests\uid.test.mjs    => 7      （合计 68，与报告 §7 表格逐项一致）
```

- `grep 'src/' tests` → **No matches found**（报告 P4「`tests/` 对 `src/` 引用 = 0」✔）。
- `core/engine.mjs:208-209`（实读）二重循环 `for (let i = 0; i < dim; i++) dot += vectors[off + i] * qvec[i];`、`:213`（实读）`scored.sort((a, b) => b.score - a.score);`、`core/index.mjs:30`（实读）`const buf = fs.readFileSync(file);` —— 报告 §9 的三处行号**全部相符**。
- `data/libraries/L1/index.bin` 实测 **11,042,105 B**（报告 §9 表格一致；`3594×768×4 = 11,040,768` 的算术亦对）。
- **判定：支持。**

---

## 3. severity_recheck[]（我独立判「影响面 × 触发可能性」，再与报告比）

打分口径按判据 §3：影响面 3=用户可见功能受损/安全数据边界 · 2=工程交付面 · 1=文档措辞；触发 3=现在就成立/必然发生 · 2=特定动作下发生 · 1=偶发。

| # | 报告给分 | 我的独立判分 | 是否一致 | 理由（不一致处写明） |
|---|---|---|---|---|
| **P2** `reveal` 假成功 | **9 · Critical**（3×3） | **3×3=9**，但**触发可能性存在 2 的合理读法** | **基本一致（边界争议，不判失准）** | 影响面 **3** 无异议：用户点「定位」→ 弹「已在资源管理器中定位」→ 无事发生，正命中 §3 的 Critical 定义（静默失败且用户无感）。触发可能性我不完全同意「3」：报告的 P3 自己说 `config.json` 已删 → `LIB_ROOT=''` → **库里没有库、搜索页无结果**，在此状态下用户**根本走不到**「定位」按钮（按钮在结果卡片上，`SearchPage.jsx:134 → PhotoCard`）；要走到它得先有可用库（配 `GEMMA_CONFIG` 或修好 P3）。因此严格的「现在就必然发生」不成立，判 **2**（「特定动作下发生」：库可用时 100% 复现）→ 6 · High。**但**报告的 3 也可自洽（一旦可达即必然，且 §3 的 Critical 语义是「功能静默失败」而非「当前必然可达」）。**结论：边界争议，不构成严重度失准，不列为 blocker**；建议报告补一句「可达性前提：需先有可用库（依赖 P3 修复）」。 |
| **P5** 18 个生产依赖零 import | **6 · High**（2×3） | **2×3=6** | **一致** | 影响面 **2** 正确（不进用户功能路径，属交付面：体积 38 MB/4838 文件、供应链面、`SPEC-security §7` 的「依赖最少」被自身证伪 → §3 强制项「文档说做了、代码没做 ≥ Medium」）。触发可能性 **3**（实测当下就成立）正确。若有人想降到 1（文档治理）是不成立的：lucide 单包 34.1 MB/4328 文件也要进安装包，是**现在**的事实。**6 · High 成立。** |
| **P6** 打包分发未接通 | **6 · High**（3×2） | **3×2=6** | **一致** | 就「把未来工作当缺陷」的质疑单独核过：① 判据 §4 **S7 明确要求**回答「是否达到分发到别的机器」，所以立项本身合规；② 影响面 **3** 成立——装到别的机器是**全量不可用**（无库 + `MODEL_MISSING`）；③ 触发 **2** 成立且与报告自定的口径一致（「打包」被明写进 2 的类别）；④ 报告**主动不判 Critical** 的理由（失败是**可见的错误码**，非静默、无数据损坏）符合 §3 Critical 定义，**没有抬高**。定性上更准确的措辞是「**发布前阻塞项（P6 未做）**」而非「缺陷」，但分值与等级我复算一致。**6 · High 成立。** |
| （附）**P8** 反依赖 `onnx-spike/` | 4 · Medium（2×2） | 2×2=4 | 一致 | 触发确实需要「按文档语义动 `onnx-spike/`」或走不打包路径，判 2 合理；影响面 2（工程分层）合理。 |

**复算结论**：3 条主复算与 1 条附复算**全部与报告一致**（P2 仅在「触发可能性 3 vs 2」上有可辩解的边界，分值可能落 9 或 6，**不构成严重度严重失准**）。未发现「为了显眼而抬分」的迹象：P6 主动放弃 Critical、P15 主动判「设计取舍、不是缺陷」、P1/P2/P8 均在 §14 给出复算过程。

---

## 4. gates（G1-G7 逐门）

| 门 | 结论 | 依据 / 例句 |
|---|---|---|
| **G1** 不声称未验证的能力（可追溯到 `文件:行号` 或命令+输出） | **部分满足** | 正面：抽查 12 处，`core/engine.mjs:434`、`useSearch.js:80`、`log.mjs:25/52-53`、`index.mjs:96-97,117`、`encoder.mjs:62-63`、`electron-builder.yml:16/21-22/41`、`engine.mjs:208-209,213`、`index.mjs:30`、`SPEC-app.md:63/65/66/70/71/72/119/128-131`、`SPEC-security.md:167/168/192/208`、`TASK-PLAN.md:23/212`、`README.md:47/94-103` **全部行号与内容相符**；重跑 `tsc`（0/126/230）、`verify-doc-refs`（EXIT=1）、`verify_renderer_styles`（EXIT=0）、`npm ls`、体积/计数**全部复现**。扣分：**E1.4 的 `verify-doc-refs` 原始输出与基线冲突且不可复现**（B5）；§10 行 10 的「覆盖 50 处」是同一早期快照的残留。 |
| **G2** 区分 `代码事实` / `文档声称` / `行业做法` | **满足** | 三类标记贯穿全文，且**默认规则先声明**（§14 G2：「带 `文件:行号` 的是代码事实，写『承诺/声称』的是文档声称，写『对标/行业做法』并带 URL 或项目名的是行业做法」）。实例：§3「本节结论属**行业做法对比 + 代码事实**」；§5.2-A「**行业做法 + 代码事实**」；§8「**代码事实 + 静态推断**」；外部未核实项显式标注——`librephotos`「引自 `PROJECT-GUIDE.md:202`，属**文档声称**，本轮未独立核实」、`jan`「引自 `PROJECT-GUIDE.md:197`，属文档声称」、§7「immich … 本轮未点开该页，此处按目录结构推论 → 标 **【判断，非实测】**」。 |
| **G3** 与基线零冲突 | **部分满足** | 报告 §12 主动回写两处基线描述过强（D1 附、D5 附），且**未另立事实**，方向正确；抽查未发现与基线**相反**的核心事实。扣分有两处：① **E1.4 与基线 §6.1 对同一条命令给出不相容的快照**（50/0/1 vs 102/7/3）而未说明（B5）；② **P7 的「覆盖」栏把基线说成「只记了未文档化，未记已失败」**，而基线 `:105` 与 §6.1 明确记了 `EXIT=1`（B2）。 |
| **G4** 严重度可复算（`Score=影响面×触发`，不得只写高中低） | **满足** | §11 开头**先声明统一口径**（影响面 3/2/1 与触发 3/2/1 的定义），再逐条给 `(影响面×触发)` 与等级；§14 G4 附 3 条复算（P2 3×3、P1 2×3、P8 2×2）。我另取 P2/P5/P6(/P8) 独立复算，结果一致（P2 存在 9↔6 的边界争议但不属失准）。 |
| **G5** 有可执行建议（改哪里 + 怎么验） | **满足** | §11 每条都有两段式，且**可验证到具体断言**：P1「`package.json` 加 `"typecheck": …`；**同时**把 `checkJs` 打开…**不要撒 `any`**。验：`npm run typecheck` 退出码非 0 且错误条数与 E1.3 一致」；P4「先补 `tests/ipc.test.mjs`…验：`npm test` ≥90 且全过」；P6「在**改名/移除 `D:\USERS\Desktop\Agent\model-cache`** 的机器上启动，能走到『下载模型』」。通读未见「建议优化」类空话。 |
| **G6** 诚实列未覆盖 | **满足** | §13 存在且 9 条，含**未跑**的 `npm run build` / electron-builder / dev / smoke / encoder 验证 / `npm audit`，并主动交代「`out/` 是**既有产物**…**不证明「当前源码能构建出它」**」、`electron-builder.yml` 的 `files` 通配深度未验证、S8 拐点是算术外推，以及环境限制（PowerShell 5.1 + GBK 导致的一次误判**已撤销且不作为问题列出**）。 |
| **G7** 中文 | **满足** | 全文中文（仅包名/命令/错误码/URL 保留原文），与本仓库既有文档一致。 |

---

## 5. rebuttals[]（主动反驳：报告说 A，磁盘是 B / 结论过强）

> 6 处成立（含 1 处「结论仍成立但归因/novelty 错」）；另附 2 处**尝试后未成立**的角度，如实记录。

### R1 · 成立｜S4 对 Tailwind 的硬否决理由 ②：生产 CSP **早已**含 `style-src 'unsafe-inline'` → 见 **B1**

报告说：「当前生产 CSP（`index.html:9`）已经足够，引入 Tailwind 等于**为样式多买一次 CSP 让步**」。
磁盘是：`index.html:9` **就是** `style-src 'self' 'unsafe-inline'`，`:7` 注释自述这是 **Vite 注入样式**所必需、**生产态样式会抽成文件**；`SPEC-security.md:266` 的最终推荐是**保留**该放宽，`:310-311` 只是 §10.4「如果你仍要更严」的可选**收窄**且 `:314` 明说「这不提升安全性」。
→ **没有「多买」这回事**；该理由以其所述形式不成立。

### R2 · 成立｜P7 的「覆盖」栏：基线**已经**记了 EXIT=1 → 见 **B2**

报告说：基线「D1 只记了『未文档化』，未记『已失败』」。
磁盘是：基线 `00-current-state.md:105` D1 行「计数过期 + 该守卫**当前 EXIT=1**（见下）」，并在 `:164` 起设专节「**6.1 ⚠️ 仓库自检门禁当前是红的（EXIT=1），Lead 实测**」。
→ P7 的技术结论成立，但 **novelty 归属被夸大**，并影响「新发现问题 8 条」的计数口径。

### R3 · 成立｜§5.2 的「现有 CSS 只有 24,916 B」是**构建产物**体积 → 见 **B4**

报告说：现有 CSS 24,916 B。磁盘是：源文件 `src/renderer/src/renderer.css` = **14,050 B**；24,916 B 属 `out/renderer/assets/index-BCVIX9rf.css`（E4 自己也是这么写的）。
→ 结论方向不变（都小），但引用错了对象。

### R4 · 成立｜§3 依赖拓扑与全篇数字自相矛盾（19 vs 18；5+2 vs 6）→ 见 **B3**

报告说：`:93`「零 import 但声明为生产依赖（**19**）」、`:91`「真正被 import（**5+2**）」。
磁盘是：`deps=24`、`radix=12`、零 import 项 **18**；「真正被 import」列出的恰 **6** 个（4+2）。同一报告 `:36`/`:194`/`:233` 也都写 18。
→ 报告内部无法自洽。

### R5 · 成立｜E1.4 的 `verify-doc-refs` 证据与基线冲突、且交付时不可复现；P7 单一归因 → 见 **B5**

报告说（P7）：EXIT=1 是「`AGENTS.md` 留在根目录」触发。E1.4 给的原始输出是「50 处 / ✓无死引用 / 越界 1」。
磁盘是：基线同一命令 102/7/3；我复跑 106/10/3；且当前越界 3 份含 **`STACK-AUDIT.md` 与 `UIUX-AUDIT.md` 自身**，死引用 10 处。
→ 结论对、**证据不同期、归因不完整**。

### R6 · 成立｜§6 第 7 行「删 11 个」与处置栏「移除全部 12 个」矛盾 → 见 **B6**

磁盘是 `package.json` **12** 个 `@radix-ui/react-*`。→ 11 与 12 不能同时为真。

### R7 · **未成立**（尝试反驳「sharps 判断」）——作者判断正确

我按任务书要求专门核了 `sharp`：它不是「静态 grep 漏掉」的误判对象——`package.json` deps 实读含 `sharp@^0.35.5`；`src/main/encoder.mjs:12` 静态 import `onnx-spike/resize_compat.mjs`；`onnx-spike/resize_compat.mjs:34-36` 是 `await import('sharp')` 动态 import。**三段链路全部实读成立**，作者 S5#3 与 P9 的结论无误，我**不提出**此处反驳。

### R8 · **未成立**（尝试反驳「§9 换库拐点是纯算术外推被当成结论」）——报告已充分自我限定

我核过算术：`3594×768=2,760,192` 次乘加 ✔；`10^5×768×4=307 MB`、`10^6×768×4=3.07 GB` ✔；`7 ms × (10^5/3594)≈0.19 s`、`×278≈1.95 s` ✔。而报告 §9 标题即标「**『拐点』部分为【判断，非实测】**」，§13 第 8 条再次声明「10^5/10^6 的量级是我按线性外推算的，**没有在真实数据集上测过**」，并把 7 ms@3594 标明为**仓内既有实测**（`docs/DEBT-CLEANUP.md:378`，引用而非本轮实测）。
→ 该角度**不成立**：它不是「把外推当结论」，而是**标注充分的算术+判断**。记为「已尽力反驳，未成立」。

### （其余尝试过的角度，均未形成有效反驳）

- **「S2 说 7 个守卫没有一个断言 `core/` 零依赖」**：我按 `Select-String -Path tools\*.mjs -Pattern 'core'` 复核了 E3 列出的全部命中（项目根定位 / import core 做功能校验 / `verify_encoder_path.mjs` 动态 import `core/index.mjs`），**确实没有一条检查 import 说明符** → 反驳不成立。
- **「P5 的 `clsx` 9 处命中是反例」**：定位后 8 处在 `onnx-spike/node_modules/onnxruntime-web/dist/*`（第三方 bundle），1 处是 `cx.js:1` 注释，**项目自有代码 0 import**，报告写法（「唯一出现是注释」）准确 → 反驳不成立，反而**加强了** P5。

---

## 6. 复核者独立性声明与边界

1. 本复核**只写了** `docs/audit/REVIEW-STACK-AUDIT.md`；`STACK-AUDIT.md`、`docs/audit/stack-evidence.md`、`docs/audit/00-current-state.md`、`docs/audit/01-acceptance-criteria.md` 及一切源码/配置**均未修改**（复核为只读命令 + `read`）。
2. 本次复跑产生的**唯一副作用**是把 `REVIEW-STACK-AUDIT.md` 补进仓库，从而消解 `docs/plan/PROJECT-DOC-INDEX.md:66` 的一处死引用（该守卫的计数因此会再变，属预期）。
3. 我**未**复核的边界（与作者 §13 一致）：未跑 `npm run build`、未跑 electron-builder、未跑 `npm run dev`/`smoke`、未跑 `npm audit`、未独立核实 `librephotos`/`jan`/`photoprism` 的目录结构（只有 immich 由作者 web_fetch）。这些**不构成**对报告结论的反驳依据，只说明我也没有把它们变成「已验证」。
4. blocker 处置要求：B1-B6 全部改完（或由作者给出反证据）后，`verdict` 可升为 `pass`。**B1、B2 必须改**（会误导下游 `AUDIT-FINAL.md` 的 S4 与「新发现」计数）；B3-B6 属同一批次的文字/数字勘误，建议一次提交完成。

---

# 二次复核（round 2）：B1-B6 处置核验

> 触发：Lead 转达 stack-auditor 已处置 B1-B6，新增 `STACK-AUDIT.md` §16「独立复核 B1-B6 的处置记录」。
> 本轮**只核 blocker 是否真清零 + 是否引入新错误**，不重做全篇。全部结论基于**实读改后位置**，不采信 §16 自述。
> 复核文件仍为本文（**追加**，未新建文件）；`STACK-AUDIT.md`、`docs/audit/stack-evidence.md` 及源码/配置**均未修改**（下文 R6 给出取证）。

```yaml
verdict_round2: pass
blockers_round2: []        # B1-B6 全部真清零，未发现新增 blocker
non_blocking_notes: 3      # N1-N3，均为措辞/清单完整度，不影响任何结论
```

## R1. 逐条核 B1-B6（实读改后位置，不看 §16 自述）

| Blocker | 我实读的位置 | 改后原文要点 | 我的判定 |
|---|---|---|---|
| **B1** | `STACK-AUDIT.md:146`（§5.2-A Tailwind 段） | 段首改为「**两条硬理由（+一条已更正为中立事实）**」；③ 整条重写为「**CSP 不构成理由（本轮更正）**：本项目生产 CSP **本来就含** `style-src 'self' 'unsafe-inline'`（`src/renderer/index.html:9`；`:7` 注释自述这是 **Vite 注入样式**所需、与 Tailwind 无关），而 `SPEC-security.md:310-311` 位于 §10.4「如果你仍要更严」，是**可选的收窄建议**（`:314` 自述「这不提升安全性」，`:266` 的最终推荐是**保留** `'unsafe-inline'`）—— Tailwind **不新增**任何让步，但也**不解决**已存在的放宽」 | **✅ 清零**。与我 round-1 实测的磁盘事实（`index.html:9` 含 `unsafe-inline`、`:7` 注释、`SPEC-security.md:266/310-311/314`）逐字一致；「多买一次 CSP 让步」的措辞已从全文主张中消失。理由①③保留，S4 否决结论未变 → 复核意见被正确吸收，而非「删掉了事」 |
| **B2** | `STACK-AUDIT.md:344`（P7 行「覆盖」列）+ `:355`（§11 统计段） | P7 覆盖栏：「**部分新**：基线 D1（`00-current-state.md:105`）与 §6.1（`:164` 起）**已记**「该守卫当前 EXIT=1 + 死引用 7」；本轮**新增**的是：无 CI、无提交钩子、`npm test`/`package.json` 完全不接线，且 EXIT=1 会随审查文件增加而**持续恶化**（50→102→106→109）」；统计段：「全新 **7** 条（P1/P4/P5/P6/P8/P9/P10）+ 部分新 **2** 条（P7、P14）+ 其余 **6** 条为基线 D1-D6 复核（P2=D6·P3=D2·P11=D1·P12=D3·P13=D4·P15=D5）」 | **✅ 清零**。① 基线引用正确（我 round-1 已实读 `:105`/§6.1）；② **统计算术自洽**：7+2+6=**15** = 表格 P1-P15 共 15 行；逐行核对覆盖列：新=P1/P4/P5/P6/P8/P9/P10（7）· 部分新=P7/P14（2）· 基线=P2/P3/P11/P12/P13/P15（6）——**与表格实际行数完全对得上**（这正是 Lead 要我专门核的地方）；③ D1-D6 映射不乱：D1→P11、D2→P3、D3→P12、D4→P13、D5→P15、D6→P2，六个全在 |
| **B3** | `STACK-AUDIT.md:91` 与 `:94` | `:91`「真正被 import（**共 6 个 = 4 静态 + 2 仅经 onnx-spike 动态 import**）：react, react-dom, zod, @huggingface/transformers, sharp*, bmp-js*」；`:94`「零 import 但声明为生产依赖（**18 = 24 − 6**）」 | **✅ 清零**。与我 round-1 实测（`deps=24`、`radix=12`、实际被 import 6 个、24−6=18）一致，且与同一报告 `:36`/`:194`/`:355` 的口径统一 |
| **B4** | `STACK-AUDIT.md:146`（Tailwind ②） | 「现有样式量小且高度定制：源文件 `src/renderer/src/renderer.css` **14,050 B**（构建产物 `out/renderer/assets/index-BCVIX9rf.css` 24,916 B，E4）」 | **✅ 清零**。两个数字我 round-1 均已实测（14,050 / 24,916），指代已正确区分 |
| **B5** | `docs/audit/stack-evidence.md:150-178`（E1.4）+ `STACK-AUDIT.md:344`（P7 归因）+ `:323`（§10 第 10 行） | E1.4 段首加 `⚠️ 交付前快照` 说明，并列出动态链 50/0/1 → 基线 102/7/3 → 复核者 106/10/3 → Lead 109/7/4 → 作者同期 109/7/4，附**死引用 7 处 + 越界 4 份**明细；P7 归因改为「根目录越界（含审查交付物自身）+ 死引用」；§10 第 10 行改为「计数是动态量、本身不是缺陷，缺陷是不在自动化里」 | **✅ 清零（我独立复现）**。见 R2：我本轮复跑得到 **109 / 死引用 7 / 越界 4**，且 **7 条死引用逐条与 E1.4 `:159-161` 列出的完全一致**（`AUDIT-FINAL.md:9,10` · `uiux-evidence.md:609-612` ×4 · `PROJECT-DOC-INDEX.md:67`），越界 4 份也一致。证据不同期的问题已被显式标注解决 |
| **B6** | `STACK-AUDIT.md:187`（§6 第 7 行） | 判决栏「❌ **现在删 12 个**；`AlertDialog` 的需求**保留为决策**，等 P3b/P3c 再按需装」；处置栏「移除全部 **12** 个（`package.json:26-37` 实测 12 个）」 | **✅ 清零**。我实读 `package.json:26-37` = `alert-dialog / checkbox / dialog / dropdown-menu / label / popover / select / slot / switch / tabs / toast / tooltip` **恰好 12 行**，引用精确；「11 与 12 并存」的矛盾消失 |
| 建议项 | `STACK-AUDIT.md:339`（P2 行「影响」列） | 「**可达性前提**（复核者指出、Lead 同意保留 Critical）：需先有可用库才走得到结果卡片上的「定位」按钮 —— 无库状态是 P3 的缺陷；**库可用时 100% 复现**」 | **✅ 已采纳**，且**没有借机降级**（仍 9 · Critical），与我的复算说明一致 |

## R2. 复跑 `node tools/verify-doc-refs.mjs`（与作者声称的 109/7/4 比对）

```powershell
node tools/verify-doc-refs.mjs
```

```
=== 1) 文档引用解算 ===
  扫描引用 109 处
  **死引用 7 处**：
    AUDIT-FINAL.md:9  →  ../STACK-AUDIT.md
    AUDIT-FINAL.md:10  →  ../UIUX-AUDIT.md
    docs/audit/uiux-evidence.md:609  →  color.md
    docs/audit/uiux-evidence.md:610  →  color.md
    docs/audit/uiux-evidence.md:611  →  materials.md
    docs/audit/uiux-evidence.md:612  →  typography.md
    docs/plan/PROJECT-DOC-INDEX.md:67  →  ../audit/REVIEW-UIUX-AUDIT.md

=== 2) 根目录是否只剩"入口 + 治理" ===
  根目录 .md：AGENTS.md · AUDIT-FINAL.md · PROJECT-GUIDE.md · README.md · STACK-AUDIT.md · TASK-PLAN.md · UIUX-AUDIT.md
  !! 4 份不该留在根目录：AGENTS.md, AUDIT-FINAL.md, STACK-AUDIT.md, UIUX-AUDIT.md（正文应放 docs/）

**未通过**：死引用 7 · 根目录越界 4
EXIT=1
```

- **我测到的时点值 = 109 处 / 死引用 7 / 越界 4**，与作者声称、以及 Lead 的复跑**完全一致**（EXIT=1）。
- **这确实是一个动态量**：同一命令我 round-1 测到 106/10/3，round-2 测到 109/7/4（`docs/plan/*` 与 `AUDIT-FINAL.md` 落盘、`uiux-evidence.md` 行号位移）。作者现在把它表述为「动态量、计数变化本身不是缺陷，缺陷是不在自动化里」，**这个表述经得起复跑**，比原来的静态断言更稳。
- 注意：`docs/plan/PROJECT-DOC-INDEX.md:67 → REVIEW-UIUX-AUDIT.md` 仍是死引用，属 **review-2 尚未交付**，不是本报告的错；本文件（`REVIEW-STACK-AUDIT.md`）已落盘，故 `:66` 那条已消解。

## R3. 顺手核：§16 有没有引入**新的**数字/引用错误

逐项实读 §16（`STACK-AUDIT.md:414-431`）与其牵动的 §11/§14/§10：

| 检查项 | 结论 |
|---|---|
| §16 `:416`「复核文件…`verdict: pass-with-issues`，blockers 6 条；该文件为**只读**，本轮未改动」 | ✅ 与我 round-1 产出相符；且我实测该文件 **35,181 B / LastWriteTime 2026/10/12 10:12:55 未变**（= 我写入时刻），作者**确实没有动过我的文件** |
| §16 `:425` 声称 E1.4 附了「死引用 7 处 / 越界 4 份明细」 | ✅ 实读 `stack-evidence.md:159-162` 确有，且与我复跑的 7 条**逐条对应** |
| §16 `:431`「修订后复跑 → EXIT=1（109 / 7 / 4，与 Lead 一致）；renderer.css = 14,050 B、构建产物 = 24,916 B」 | ✅ 四个数字我全部独立复现 |
| §16 `:422` 声称据此「改准 §11 统计口径」 | ✅ `:355` 确已改为 7/2/6，**且 7+2+6=15 = 表格行数**（R1 B2） |
| §16 `:429` 声称 §14 的 G1/G3 行已注明修正 | ✅ 实读 `:392`（G1 加「首轮曾被复核判『部分满足』的唯一原因（E1.4 证据不同期）已在本轮修正」）与 `:394`（G3 加两点修正说明），**与 B2/B5 的实际改动对应，无夸大** |
| §16 `:426` 声称 `package.json:26-37` 实测 12 个 | ✅ 实读该区间恰 12 行（R1 B6） |
| §16 是否有「顺着复核意见改口但结论反转」 | ✅ 无。B1 是**降级为中立事实**而非删掉异议，B6 保持「全删」主张，S4/P7 的严重度与结论均未改动 |
| 全文是否残留旧错误串（`（19）` / `（5+2）` / `删 11` / `多买一次 CSP 让步`） | ✅ 已全部从主张中消失（grep 仅在 §16 的**历史记录**里出现「多买」一词，属处置说明，非主张） |
| §11 严重度统计与表格行数是否一致 | ✅ Critical 1（P2）+ High 6（P1/P3/P4/P5/P6/P7）+ Medium 3（P8/P9/P10）+ Low 5（P11-P15）= **15** = 表格 15 行 |

**结论：未发现 §16 引入新的数字或引用错误。**

## R4. non_blocking_notes（不影响通过，建议顺手改）

- **N1**（清单完整度）：`STACK-AUDIT.md:323`（§10 第 10 行）写「越界的正是审查交付物自身（`STACK-AUDIT.md` / `UIUX-AUDIT.md` / `AGENTS.md`）」——**漏列 `AUDIT-FINAL.md`**，而同一时刻守卫实际报「越界 4 份：AGENTS.md, AUDIT-FINAL.md, STACK-AUDIT.md, UIUX-AUDIT.md」，且 §11 P7 行（`:344`）已把 4 份列全。建议 §10 补上 `AUDIT-FINAL.md` 以与 P7 行一致。
- **N2**（表述一致性）：`:323` 的动态链止于「Lead 复跑 109/7/4」，而 E1.4 与 §11 P7 都写了「Lead 109/7/4 → 作者同期复跑 109/7/4」。三处链条长度不一，建议统一（不影响准确性）。
- **N3**（分类措辞）：P14 的覆盖栏同时写「基线 §4 的连带 + **部分新**」（`:351`），而 §11 统计把它归入「部分新 2 条」。合起来读无误，但两种说法并存易被误读为三类，建议覆盖栏只保留「部分新」。

## R5. verdict_round2 判定

按 Lead 给的规则「B1-B6 全部清零且无新增 blocker ⇒ `pass`」：

- B1 ✅ / B2 ✅ / B3 ✅ / B4 ✅ / B5 ✅ / B6 ✅ —— **6/6 真清零**（均为实读改后位置 + 独立复跑复现，而非采信 §16 自述）。
- 新增 blocker：**0**（§16 未引入新的数字/引用错误；7+2+6=15 与表格行数对得上）。
- 非阻塞建议 3 条（N1-N3），均为措辞/清单完整度。

```yaml
verdict_round2: pass
```

**残留边界（不影响 pass）**：本次复核未重跑 `tsc`（避免再向仓库根落 `tsbuildinfo`；round-1 的 0 / 126 / 230 结论不受本轮影响——作者本轮只改 `STACK-AUDIT.md` 与 `stack-evidence.md`，未触碰 `tsconfig`/源码）。

## R6. 本轮写入合规取证（供 Lead 核对）

```powershell
git status --short --untracked-files=no
# （空输出：无任何 tracked 源码/配置被修改）

Get-Item docs\audit\REVIEW-STACK-AUDIT.md | Select-Object Length, LastWriteTime
# Length : 35181（追加前）   LastWriteTime : 2026/10/12 10:12:55
```

- 本轮我只**追加**了本文件（`docs/audit/REVIEW-STACK-AUDIT.md`）；未修改 `STACK-AUDIT.md`、`docs/audit/stack-evidence.md`、`00-current-state.md`、`01-acceptance-criteria.md` 或任何源码/配置。
- 追加前核到我的文件仍是 **35,181 B** 且未被他人改动，故本轮追加不会覆盖任何人的改动。
- 本轮未跑 `tsc`、未新增 `tsbuildinfo` 等副产物。

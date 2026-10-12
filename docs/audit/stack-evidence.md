# stack-evidence · ① 技术栈/框架审计原始证据

> 本文件是 `STACK-AUDIT.md` 的**证据附录**。只记录「跑了什么、看到什么」，不做结论。
> 结论一律写在 `STACK-AUDIT.md`，并在那里引用本文件的编号（E1、E2…）。
>
> - 采集时间：2026-10-12（本轮审查）
> - 采集人：stack-auditor
> - 仓库 HEAD：`4555c1b`（`git log -1 --format='%H %s %ci'` → `4555c1b77395ebac7b6076a1113a8fe32ca57e4f chore!: 旧档 Python 层整体退役 —— 仓库从此零 Python 2026-10-10 18:03:55 +0800`）
> - 采集前 `git status --short`：`?? AGENTS.md`、`?? docs/audit/`、`?? docs/plan/DOCS-*.md`（后两者是本轮 Lead 与审查自身的产物）
> - 全程只读；未修改任何源码 / 配置 / 他人文件。唯一由本轮命令**产生**的文件与清理见 E9。

---

## E0 环境事实（影响可复现性，先声明）

| 项 | 实测值 | 命令 |
|---|---|---|
| PowerShell 版本 | **5.1.19041.6456**（不是 PowerShell 7） | `$PSVersionTable.PSVersion` |
| 控制台代码页 | GBK；读 UTF-8 文件的中文会**乱码** | `Get-Content x -Raw` 输出 `鏈湴绱犳潗...` |
| 正确读法 | `Get-Content <file> -Encoding UTF8`（已验证 `data/libraries/L1/_ACCEPTED.txt` 内容正常，**不是文件损坏**） | — |
| Node / npm | 见 `npm ls` 头部；`npm notice` 提示 npm 11.9.0 → 11.21.0 | `npm ls --depth=0` |

> ⚠️ **不要**把 GBK 控制台造成的乱码当成「仓库文件编码坏了」。本轮曾据此误判 `_ACCEPTED.txt`，
> 用 `-Encoding UTF8` 复读后排除了该误判（详见 E9）。

---

## E1 门禁与构建命令的原始输出

### E1.1 `npm test`

```powershell
npm test
# > gemma-search@0.1.0 test
# > node --test --test-isolation=none "tests/*.test.mjs"
# （68 条测试逐条列出，此处省略中间行；3 条 skipped 的原始原因行如下）
# ﹣ ④ 指向库外的文件符号链接 → SYMLINK_REJECTED (1.3031ms) # 本环境无法创建文件符号链接：EPERM: operation not permitted, symlink 'C:\Users\ADMINI~1\AppData\Local\Temp\dsh-tH12zk\gs-lib-ZVuK95\secret.jpg' -> 'C:\Users\ADMINI~1\AppData\Local\Temp\dsh-tH12zk\gs-lib-4EjVZs\alias.jpg'
# ﹣ 指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性） (0.2212ms) # 缺 config.json 或 baseline-v1.json
# ﹣ uid: 整库唯一性（用真实素材库；库不存在则跳过） (0.1993ms) # 无 config.json
# ℹ tests 68
# ℹ suites 0
# ℹ pass 65
# ℹ fail 0
# ℹ cancelled 0
# ℹ skipped 3
# ℹ todo 0
# ℹ duration_ms 470.8924
```

**test 数量按文件**（`Select-String -Pattern "^\s*test\("`）：

| 文件 | `test(` 条数 |
|---|---|
| `tests/engine.test.mjs` | 27 |
| `tests/index.test.mjs` | 18 |
| `tests/security.test.mjs` | 16 |
| `tests/uid.test.mjs` | 7 |
| **合计** | **68**（与 `npm test` 的 `tests 68` 一致） |

**`tests/` 对 `src/` 的引用**：

```powershell
Select-String -Path tests\*.mjs -Pattern "src/"   # → 无任何匹配
```

四个测试文件的 import 全部指向 `../core/*.mjs`（`tests/engine.test.mjs:12-13`、`index.test.mjs:12-15`、
`security.test.mjs:11-14`、`uid.test.mjs` 无项目内 import）。

### E1.2 `npx tsc --noEmit -p tsconfig.web.json`（**命令本身**）

```powershell
npx tsc --noEmit -p tsconfig.web.json
# EXIT=0
# LINES=5   ← 全部是 npm notice 噪音，无一行 tsc 输出
# 错误码分布：（空）
# 按文件：（空）
```

原因（`tsconfig.web.json:10-11,20`）：

```jsonc
"allowJs": true,
"checkJs": false,
"include": ["src/renderer/src/**/*", "src/renderer/src/**/*.tsx", "src/preload/*.d.ts"]
```

即：`include` 匹配到的**全是 `.js/.jsx`**，而 `checkJs: false` 让它们**只被载入、不被检查**。
全仓 `.ts/.tsx` 数量实测为 **0**（`Get-ChildItem -Recurse -File -Include *.ts,*.tsx` 排除
`node_modules/out/.npm-cache` 后计数 = 0）。

### E1.3 强制 `--checkJs` 后的真实报错规模（TS 迁移代价的硬证据）

```powershell
npx tsc --noEmit -p tsconfig.web.json --checkJs --tsBuildInfoFile "$env:TEMP\gs-web.tsbuildinfo"
# EXIT=1
# TOTAL_ERROR_LINES=126
# 错误码分布（Top）：
#   64 × TS7031  （Binding element implicitly has an 'any' type）
#   20 × TS7006  （Parameter implicitly has an 'any' type）
#   17 × TS2339  （Property does not exist on type）
#   13 × TS2741  （Property is missing in type）
#    6 × TS2322  （Type is not assignable）
#    2 × TS2882 / 1 × TS7019 / 1 × TS7053 / 1 × TS2345 / 1 × TS2353
# 按文件（Top）：SearchPanel.jsx 18 · SearchPage.jsx 13 · hooks/useSearch.js 13 · MetricsRow.jsx 9 ·
#   hooks/useEngine.js 9 · Sidebar.jsx 8 · Gallery.jsx 7 · ui/SearchBox.jsx 5 · PhotoCard.jsx 5 ·
#   ui/Metric.jsx 5 · SearchSidebar.jsx 4 · ui/Score.jsx 4 · PageHead.jsx 4 · ui/Field.jsx 3 ·
#   ui/Tag.jsx 3 · ui/Button.jsx 3 · AppShell.jsx 2 · hooks/useToast.js 2 · Topbar.jsx 2 · ui/Chip.jsx 2 ·
#   main.jsx 2 · ui/cx.js 1 · ui/Toast.jsx 1 · Main.jsx 1
```

```powershell
npx tsc --noEmit -p tsconfig.node.json --checkJs --tsBuildInfoFile "$env:TEMP\gs-node.tsbuildinfo"
# EXIT=1
# ELAPSED_MS=6851
# TOTAL_ERROR_LINES=230
# 错误码分布（Top）：
#   90 × TS7006  60 × TS2339  23 × TS18046  18 × TS2683  17 × TS7005
#    5 × TS2322    5 × TS7034    3 × TS7053    2 × TS2345    2 × TS6307
#    2 × TS2769    1 × TS7019    1 × TS7016    1 × TS2741
# 「noImplicitAny 家族」（7006/7031/7005/7019/7053）合计 = 111
# 按文件（Top）：core/engine.mjs 61 · src/main/index.mjs 40 · onnx-spike/resize_compat.mjs 33 ·
#   src/main/encoder.mjs 19 · core/library.mjs 17 · core/errors.mjs 13 · core/fingerprint.mjs 10 ·
#   onnx-spike/bmp_decode.mjs 9 · core/index.mjs 9 · core/compat.mjs 6 · src/preload/index.js 5 ·
#   src/shared/ipc.mjs 4 · electron.vite.config.mjs 2 · src/main/log.mjs 2
```

**两组硬数字**：

| 口径 | 实测 |
|---|---|
| 渲染层（web 项目）真实类型错误 | **126** |
| 主进程/preload/core（node 项目）真实类型错误 | **230**（其中 `onnx-spike/` 42 条 = resize_compat 33 + bmp_decode 9） |
| 第一方文件错误合计（去掉 onnx-spike） | **314** |
| `tsc` node 项目单次耗时 | **6851 ms** |
| `package.json:59` 声称「打开 checkJs 会报 **222** 条 noImplicitAny（实测）」 | node 项目 noImplicitAny 家族实测 **111 条**；web 侧同族 7031×64+7006×20+7019×1+7053×1 = 86 → 两侧合计 **197 条** —— **该数字无法复现** |

### E1.4 四个只读守卫的原始输出（逐条）

```powershell
node tools/verify_app_build.mjs      # EXIT=0
```
要点（全文见原始输出）：三端产物存在；`main` 是 ESM；`electron`/`zod` 保持外部导入；
`bmp_decode-*.js` / `encoder-*.js` / `index.js` 里 `onnxruntime_binding`、`libvips`、`sharp-win32`、
`sharp.node` **均未被内联**；preload 用 `require("electron")`、无 ESM 语句、暴露面是 `contextBridge`、
未暴露 `ipcRenderer`；main 里 preload 指向 `../preload/index.cjs`、页面指向 `../renderer/index.html`；
CSP meta 在、无 `unsafe-eval`；产物脚本用**相对**路径 `./assets/index-DDOHIJTY.js`；
样式产物 `./assets/index-BCVIX9rf.css`；界面逻辑里仍有 `thumb://`。
末尾自述：「注意：这只证明**产物形状**正确 —— "能不能出窗"要你在自己终端跑 `npm run dev`。」

```powershell
node tools/verify-doc-refs.mjs       # EXIT=1  ← 【唯一失败的门禁】
# ⚠️ 以下输出是**交付前快照**（本报告与 UIUX-AUDIT 尚未落盘时跑的，当时 50/0/1）。
#    该守卫的三个计数是**动态量**，随 docs/ 与根目录的审查产物增加而增长，不是固定值：
#      本快照 50 处 / 死引用 0 / 越界 1
#    → 基线 00-current-state.md §6.1（:167-173）  102 处 / 死引用 7 / 越界 3
#    → 复核者 docs/audit/REVIEW-STACK-AUDIT.md S3 106 处 / 死引用 10 / 越界 3
#    → Lead 复跑                                    109 处 / 死引用 7 / 越界 4
#    → **作者本轮修订后同期复跑（2026-10-12，本文件写入后）109 处 / 死引用 7 / 越界 4**（与 Lead 完全一致）：
#        死引用 7 处：AUDIT-FINAL.md:9 → ../STACK-AUDIT.md · AUDIT-FINAL.md:10 → ../UIUX-AUDIT.md ·
#                     docs/audit/uiux-evidence.md:609-612 → color/material/typography.md ×4 ·
#                     docs/plan/PROJECT-DOC-INDEX.md:67 → ../audit/REVIEW-UIUX-AUDIT.md
#        根目录越界 4 份：AGENTS.md, AUDIT-FINAL.md, STACK-AUDIT.md, UIUX-AUDIT.md
#      → 即：**死引用与越界全部由「审查/文档交付物自身」造成**，随本轮产物落盘而增长。
#    因此 P7 的失败原因应表述为「根目录越界（含 AGENTS.md 与审查交付物 STACK-AUDIT.md / UIUX-AUDIT.md 自身）+ 死引用」，
#    而不是单一归因 AGENTS.md。
# === 1) 文档引用解算 ===
#   扫描引用 50 处
#   ✓ 无死引用
# === 2) 根目录是否只剩"入口 + 治理" ===
#   根目录 .md：AGENTS.md · PROJECT-GUIDE.md · README.md · TASK-PLAN.md
#   !! 1 份不该留在根目录：AGENTS.md（正文应放 docs/）
# === 3) docs/ 结构 ===
#   docs/  DEBT-CLEANUP.md · README.md
#   docs/plan/  PRE-KICKOFF-CHECK.md
#   docs/spec/  CONTRACT-engine-v1.md · SPEC-acceptance.md · SPEC-app.md · SPEC-identity.md · SPEC-security.md · SPEC-transactions.md
#   docs/design/  DESIGN-app-details.md · DESIGN-tokens.md · UI-REVIEW-and-migration.md
# **未通过**：死引用 0 · 根目录越界 1
```

```powershell
node tools/verify_renderer_styles.mjs   # EXIT=0
# CSS 1 个 · JSX 22 个 · 令牌表 static\prototype\tokens.css
# 1) 颜色字面量：23 个文件全部 [OK]
# 2) 内联样式：22 个文件全部 [OK]
# 3) var(--x)：67 个令牌引用全部有定义 [OK]
# 4) 裸 px：共 29 处；不在 4pt 阶梯上的 2 处 → renderer.css 291:1100px, 294:760px（仅提示，不判失败）
```

```powershell
node tools/verify_renderer_dom.mjs   # EXIT=0
# HTML: src\renderer\index.html · bundle: out\renderer\assets\index-DDOHIJTY.js (673366 B)
# [ui] React 已挂载 · react 19.3.0
# [ui] indexStatus → L1 3594/3594 dim=768 healthy=true      ← 注意：这是**桩 IPC**喂的真实引擎
# 启动 7 条断言全过；文字检索 8 条全过（含 thumb://L1/022a00481875@256、分数 4 位）；
# 分类筛选 1 条；拦截提示 2 条；以图搜图 4 条；卡片动作 4 条；主进程事件 1 条。
# 自述（该文件第 12-13 行）：「⚠️ 它**不能**证明：CSS 真的生效、thumb:// 真能取到图、真实 IPC、真实窗口。」
```

### E1.5 守卫接线情况（谁会自动跑）

```powershell
Select-String -Path package.json -Pattern 'verify|typecheck|smoke|lint'
# 仅命中 "smoke": "node tools/smoke_app.mjs"（package.json:16）
```

- `package.json:19` `test` = `node --test ... "tests/*.test.mjs"` → **只跑 tests/**，一个 tools 守卫都不跑。
- 仓库**没有** `.github/`（`Test-Path .github` → False）、无 husky / lint-staged / eslint / prettier /
  typecheck 脚本（对 package.json 全文匹配上述关键词，唯一命中是 `smoke`）。
- `tools/` 实有 **7 个 `.mjs`**：`check_search.mjs` `smoke_app.mjs` `verify-doc-refs.mjs`
  `verify_app_build.mjs` `verify_encoder_path.mjs` `verify_renderer_dom.mjs` `verify_renderer_styles.mjs`
  （`Get-ChildItem tools -File` 实测）。

---

## E2 依赖：装了 vs 真的 import

`grep` 范围：全仓 `*.{jsx,js,mjs,cjs}`（`package-lock.json` 等 JSON 已被扩展名过滤掉），
模式为各依赖的 import/require 说明符。命中结果（**逐条**）：

| 依赖 | package.json | 源码中是否 import | 证据 |
|---|---|---|---|
| `react` / `react-dom` | ✅ dependencies | ✅ 用 | `src/renderer/src/main.jsx:9-10` |
| `zod` | ✅ | ✅ 用 | `src/shared/ipc.mjs:5` `import { z } from 'zod'` |
| `@huggingface/transformers` | ✅ | ✅ 用 | `src/main/encoder.mjs:11`；`onnx-spike/*` 多处 |
| `sharp` | ✅ | ✅ 用（动态） | `onnx-spike/resize_compat.mjs:35` `const m = await import('sharp')`（被 `src/main/encoder.mjs:12` 引入主进程） |
| `bmp-js` | ✅ | ✅ 用（动态） | `onnx-spike/bmp_decode.mjs:55` `const bmpjs = (await import('bmp-js')).default`（同上被主进程引入） |
| `@radix-ui/react-*`（12 个） | ✅ 全部 | ❌ **0 处 import** | 全仓 grep `@radix-ui` 只命中 `package.json` 与 `package-lock.json` |
| `zustand` | ✅ | ❌ **0 处 import** | 同上（grep `zustand` 无源码命中） |
| `@tanstack/react-virtual` | ✅ | ❌ **0 处 import** | 同上 |
| `lucide-react` | ✅ | ❌ **0 处 import** | 同上 |
| `clsx` | ✅ | ❌ **0 处 import** | 唯一出现是 `src/renderer/src/ui/cx.js:1` 的注释：「cx —— 极小 class 合并（不值得为此引 clsx）」 |
| `tailwind-merge` | ✅ | ❌ **0 处 import** | 同上 |
| `class-variance-authority` | ✅ | ❌ **0 处 import** | 同上 |
| `tailwindcss` / `@tailwindcss/vite` | ✅ devDeps | ❌ **0 处使用** | `Select-String -Path src -Pattern tailwind` → **无匹配**；`electron.vite.config.mjs:69` 的 `renderer.plugins` 只有 `[react(), devCspRelax()]` |
| `vitest` | ✅ devDeps | ❌ **0 处使用** | 无 `vitest.config.*`；全仓（排除 node_modules/out）grep `from 'vitest'` → 无匹配；`npm test` 用 `node:test` |
| `jsdom` | ✅ devDeps | ✅ 用 | `tools/verify_renderer_dom.mjs:19` |
| `@vitejs/plugin-react` | ✅ devDeps | ✅ 用 | `electron.vite.config.mjs:20` |
| `electron-vite` / `electron-builder` / `electron` / `typescript` / `vite` | ✅ devDeps | ✅ 用（`scripts/*`、`electron.vite.config.mjs`、`build:win`） | — |

**依赖个数实测**（按行解析 package.json）：

```
dependencies = 24      （package.json:24-49）
devDependencies = 13   （package.json:62-76）
```

**未使用但声明为生产依赖的 = 18 个**：12 × Radix + zustand + @tanstack/react-virtual +
lucide-react + clsx + tailwind-merge + class-variance-authority = **18**（24 − 6 个真正 import 的 = 18）。

**`npm ls --depth=0` 的异常项**：

```
+-- @emnapi/runtime@1.11.3 extraneous
+-- @img/sharp-wasm32@0.35.5 extraneous
```

### E2.1 无用依赖的磁盘代价（会被 electron-builder 打进安装包）

```powershell
Get-ChildItem node_modules\<pkg> -Recurse -File | Measure-Object Length -Sum
```

| 包 | 文件数 | MB |
|---|---|---|
| `lucide-react` | 4328 | **34.1** |
| `@radix-ui`（12 包+传递） | 371 | 2.3 |
| `@tailwindcss`（devDep） | 24 | 3.2 |
| `tailwindcss`（devDep） | 34 | 0.7 |
| `tailwind-merge` | 36 | 1.0 |
| `@tanstack` | 32 | 0.5 |
| `zustand` | 52 | 0.1 |
| `clsx` | 10 | ~0 |
| `class-variance-authority` | 9 | ~0 |
| **生产侧无用小计**（不含两个 devDep） | **~4,838** | **~38.0** |
| `@huggingface`（**有用**） | 1467 | 10.2 |
| `sharp`（**有用**） | 47 | 0.9 |
| `bmp-js`（**有用**） | 35 | 0.6 |

根 `node_modules` 总量：**21,472 文件 / 1089.9 MB / 334 个顶层包**。

### E2.2 第二棵依赖树：`onnx-spike/`

```powershell
Get-Content onnx-spike\package.json
# {"name":"onnx-spike","private":true,"type":"module","version":"0.0.1",
#  "dependencies":{"@huggingface/transformers":"^4.3.1","bmp-js":"^0.1.0"}}
```

- `onnx-spike/node_modules` 存在：**34 个顶层包 / 3222 文件 / 473.2 MB**。
- 同名包两处并存：`onnx-spike/node_modules/@huggingface/transformers` = True，
  根 `node_modules/@huggingface/transformers` = True。

---

## E3 分层：`core/` 的零依赖声明

`core/` 实有 6 个文件 / 868 LOC。**全部顶层 import 行**（`Select-String -Pattern "^\s*(import|const .*require)"`）：

```
engine.mjs:9   import fs from 'node:fs';
engine.mjs:10  import path from 'node:path';
engine.mjs:11  import { ERR, fail, ok, envelope } from './errors.mjs';
engine.mjs:12  import { readIndexBin, readItems, readMeta, relOf } from './index.mjs';
engine.mjs:13  import { compatComplete, compatEqual, compatKey, compatReason } from './compat.mjs';
engine.mjs:14  import { LibraryRegistry, resolveInLibrary, resolveQueryImage } from './library.mjs';
engine.mjs:15  import { fingerprintV1 } from './fingerprint.mjs';
fingerprint.mjs:10-12  node:fs / node:path / node:crypto
index.mjs:12-14        node:fs / node:crypto / ./errors.mjs
library.mjs:11-13      node:fs / node:path / ./errors.mjs
core 其余文件（compat.mjs / errors.mjs）无第三方 import
```

→ 只有 `node:*` 内置 + `core/` 内部相对路径，**无任何裸包说明符**。

**有没有守卫脚本断言这一点？** `Select-String -Path tools\*.mjs -Pattern 'core'` 的全部命中都是
「用 `core/engine.mjs` 反查项目根」或「直接 import core 做功能校验」：

```
smoke_app.mjs:30 / verify-doc-refs.mjs:31 / verify_app_build.mjs:24 / verify_encoder_path.mjs:30
  → if (fs.existsSync(path.join(p, 'core', 'engine.mjs'))) return p;   （项目根定位）
check_search.mjs:7      → import { createEngine } from './core/engine.mjs';
verify_encoder_path.mjs:93 → await import(path.join(ROOT, 'core', 'index.mjs'))
```

**没有任何脚本检查 `core/` 的 import 只含 `node:` 与相对路径。**

---

## E4 构建链

| 事实 | 证据 |
|---|---|
| 三端布局 `src/main` · `src/preload` · `src/renderer` | `electron.vite.config.mjs:45-73` |
| `main` 入口 = `src/main/index.mjs`，输出 ESM | `electron.vite.config.mjs:50`；`verify_app_build.mjs` → `[OK] main 是 ESM` |
| `preload` 强制 CJS + `.cjs`（sandbox 下不加载 ESM preload） | `electron.vite.config.mjs:58-61`；`verify_app_build.mjs` → `[OK] preload 用 require("electron")` |
| `externalizeDepsPlugin()` 同时施加于 main 与 preload | `electron.vite.config.mjs:47,56` |
| `preload` 源码只 import `electron` | `src/preload/index.js:10`（其余是 `contextBridge`/`ipcRenderer`；**没有引入任何 dependencies**） |
| 渲染层插件 = `[react(), devCspRelax()]` | `electron.vite.config.mjs:69` |
| 令牌跨出 renderer root 引入，产物里确实带上了 Apple 令牌值 | `src/renderer/src/main.jsx:13` `import '../../../static/prototype/tokens.css'`；`out/renderer/assets/index-BCVIX9rf.css` 24916 B 中 `#0071e3|#f5f5f7` 命中 **5** 处 |
| `renderer.css` 无 `:root` 令牌定义（只有消费） | `Select-String -Path src\renderer\src\renderer.css -Pattern ':root'` → 无匹配；令牌定义在 `static/prototype/tokens.css:19,155,177,202` |
| 产物清单 | `out/main/index.js` 46.6 KB；`out/main/chunks/bmp_decode-CrjD8y7P.js` 1.8 KB；`out/main/chunks/encoder-DxBwY1v8.js` 7.7 KB |
| `package.json` `main` 字段 = `./out/main/index.js`，与 `type: module` 自洽 | `package.json:5,7` |

**生产源码对「实验目录」的依赖**（本条是 S1 分层评价的关键证据）：

```
src/main/encoder.mjs:12  import { installResizeCompat, selfTestResizeCompat, assertResizeCompatInstalled } from '../../onnx-spike/resize_compat.mjs';
src/main/encoder.mjs:47  const { readBmpAsRawImage } = await import('../../onnx-spike/bmp_decode.mjs');
```

---

## E5 打包与分发配置

```yaml
# electron-builder.yml:1-7（原文摘录）
#   · 图标是 electron-vite 脚手架的**默认图标**，不是本项目的 —— P6 换真图标
#   · `asarUnpack` 只列了 resources；`onnxruntime-node` / `sharp` 的原生 `.node`
#     在 asar 里加载不了，P6 必须按实测把它们加进 asarUnpack（**别照抄，要实测**）
#   · 模型（fp32 1.63 GB）与索引**不进安装器**
files:
  - '!src/*' - '!core/*' - '!onnx-spike/*' ... - '!{static,spike,tests,data,reports,reference,archive,scripts}/*'
asarUnpack: [ resources/** ]
nsis: artifactName: ${name}-${version}-setup.${ext}
npmRebuild: false
```

**`resources/` 目录实测为空**（`Get-ChildItem resources -Recurse -Force` → 无输出）。
`build/` 里只有 `icon.icns` / `icon.ico` / `icon.png` / `entitlements.mac.plist`。

**打包态的路径解析（代码事实）**：

```
src/main/log.mjs:25   export const ROOT = process.env.GEMMA_ROOT || path.resolve(HERE, '..', '..');
src/main/log.mjs:52-53  if (LOG_FILE.includes('app.asar')) log('!! 注意：应用根落在 asar 内，`data/` 无法写入 —— 打包态需要改用 userData（P6）');
src/main/index.mjs:69-72  loadConfig 候选 = [process.env.GEMMA_CONFIG, path.join(ROOT, 'config.json')]
src/main/index.mjs:88-91  const config = loadConfig(); DATA_DIR = ROOT/data; LIB_ROOT = config.library_root || ''; LIB_ID = config.lib_id || 'L1'
src/main/index.mjs:117    const libraries = LIB_ROOT ? [{libId, root, label:'主库'}] : [];
src/main/index.mjs:96-97  const base = path.join(config.model_cache || path.join(ROOT,'..','model-cache'), 'onnx','embeddinggemma-2')
src/main/encoder.mjs:62-63  env.allowLocalModels = true; env.allowRemoteModels = false;
```

**本机实测**：

```
config.json exists: False
../model-cache exists: True
  D:\USERS\Desktop\Agent\model-cache\onnx\embeddinggemma-2\daa72c51243991dfcaf9f9137d2c573d8f7790c0\fp32
data/libraries/L1/index.bin  11,042,105 B
data/libraries/L1/items.json  1,968,550 B
data/libraries/L1/meta.json   1,521 B
data/libraries/L1/_ACCEPTED.txt  159 B
G:\model exists: True
```

`meta.json` 关键字段：`count 3594` · `dim 768` · `embedding_dtype float32` · `compat` 串
`onnx-community/embeddinggemma-2-ONNX|daa72c…|fp32|2|140|768|l2|mean_soft_tokens` ·
`runtime.device webgpu` · `bmpFallbackUsed 20` · `lib_root "G:\\model"`。

**未实测**：`npm run build`、`npx electron-builder --dir/--win`（理由见 E10）。

---

## E6 索引格式与检索算法

```
core/index.mjs:3-8（文件头注释）
  [0,8)          MAGIC = 47 53 49 44 58 00 00 01
  [8,12)         u32 LE headerLen
  [12,12+hlen)   headerJSON（utf8）
  之后            float32 块（count × dim，行主序）
  末尾            u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete }
core/index.mjs:16  MAGIC = Buffer.from('4753494458000001','hex')
core/index.mjs:68  if (foot.complete !== true) throw corrupt(...)      // 没写完就当损坏
core/index.mjs:72-75 sha1 逐字节校验向量块
core/engine.mjs:102-122  load() 懒加载并 cache.set(libId, entry)       // 每个库首次搜索时读盘+校验一次
core/engine.mjs:203-213
  for (const it of items) { … let dot = 0; for (let i=0;i<dim;i++) dot += vectors[off+i]*qvec[i]; scored.push(...) }
  scored.sort((a,b)=>b.score-a.score)
core/engine.mjs:214  const top = scored.slice(0, topK);
core/engine.mjs:190  qvec = l2norm(qvec)                               // 点积=余弦
```

**算术**：文件大小 = 12 + hlen + 3594×768×4 + 4 + flen = 11,040,768 + ~1.3 KB ≈ 11,042,105 B ✔（与实测字节数一致）。
单次查询乘加 = 3594 × 768 = **2,760,192 次**（≈ 5.5 MFLOP）。
索引内存占用 = 11.0 MB。

**仓内既有实测**：`docs/DEBT-CLEANUP.md:378` 记「真模型编码中文查询 → 引擎 **7 ms 返回 5 条**」；
本轮 `verify_renderer_dom.mjs` 的桩 IPC 记 `search text → 3 条 · 42ms`（含 UI 渲染）。

---

## E7 文档声称 vs 磁盘实测（逐条对照）

### E7.1 基线 §5 的 D1-D6 复核

| # | 基线说法 | 本轮独立复核 | 结论 |
|---|---|---|---|
| D1 | 文档说 `tools/` 6 个守卫，实测 7；多出的 `verify-doc-refs.mjs` **「全仓无一处提到它」** | `tools/` 7 个 `.mjs` 实测✔；`README.md:47`「6 个 Node 守卫」✔、`README.md:94-103` 命令清单也确实只有 6 条；`PROJECT-GUIDE.md:70,98`「6 个」✔。**但**：`docs/README.md:92` 明确写了 `node tools\verify-doc-refs.mjs  # 全仓引用解算 + 根目录越界检查（只读）`（该文件在 HEAD 提交 `dc0ceb2` 中已入库：`git log -1 -- docs/README.md` → `dc0ceb2 2026-10-10 18:02:52 refactor(docs): 正文文档从仓库根收进 docs/`） | 主结论成立；**「全仓无一处提到」不成立** |
| D2 | `loadConfig()` 读已退役删除的 `config.json` → `LIB_ROOT=''` → 界面永远 `LIB_NOT_FOUND` | `src/main/index.mjs:68-86` 逐行确认；`Test-Path config.json` → False；`index.mjs:117` libraries=[]。**补充**：模型目录有 `ROOT/../model-cache` 兜底且本机存在 → **模型能找到、库永远是空**（比基线更精确） | 成立（附精确化） |
| D3 | `PROJECT-GUIDE.md:157` 说新规格/设计文档放仓库根，而实际在 `docs/` | `PROJECT-GUIDE.md:157`「新的规格 / 设计文档 → **仓库根**（`SPEC-*.md` / `DESIGN-*.md`）」✔；实际 `docs/spec/` 6 个、`docs/design/` 3 个（`Get-ChildItem docs -Recurse -File -Filter *.md` 实测）；HEAD 提交 `dc0ceb2` 标题即「正文文档从仓库根收进 docs/」 | 成立 |
| D4 | 文档说仓库根 24 个文件 / 13 份根目录权威文档 | 根目录**文件 14 个**（`.gitattributes .gitignore AGENTS.md electron-builder.yml electron.vite.config.mjs LICENSE package-lock.json package.json PROJECT-GUIDE.md README.md TASK-PLAN.md tsconfig{,.node,.web}.json`）、条目 33；13 份权威文档全部在 `docs/`（`PROJECT-GUIDE.md:186`「从 40 个文件降到 24 个」、`:213`「仓库根为什么只有 24 个文件」） | 成立 |
| D5 | 「`METHOD_NAMES` 会广播这 11 个方法」 | `src/shared/ipc.mjs:73` 定义 `METHOD_NAMES`；全仓引用它的**唯一**位置是 `src/main/index.mjs:26`（import）与 `:205`（`log('IPC 已注册 · 允许的方法：', …)`）。**没有任何地方把它发给渲染进程**；preload 只暴露 `invoke/onEvent/platform`（`src/preload/index.js:15-28`） | 前半成立；**「广播」不成立** |
| D6 | `reveal` 未注入 `shell` 却 `return ok({revealed:true})` | `core/engine.mjs:434` `if (shell && typeof shell.reveal === 'function') shell.reveal(abs);` → `:435` 无条件 `return ok({revealed:true, path:abs})`；全仓 grep `\bshell\b` 在 `src/main/` 下 **0 命中**（只在 `core/engine.mjs:90,434`、`tests/engine.test.mjs:314,317`、`archive/app-shell-20261010/main/index.mjs:20`）；`src/main/index.mjs:120-126` 的 `createEngine({...})` 只传 `config`/`encoder`/`onEvent`。**用户可见后果链**：`src/renderer/src/hooks/useSearch.js:80` `onToast(r.ok ? '已在资源管理器中定位' : …)` → 必弹**成功**提示、资源管理器不打开 | 成立，且可补齐用户可见后果 |

### E7.2 本轮新增的数字对照（文档声称 vs 实测）

| 项 | 文档声称 | 出处 | 实测 | 证据 |
|---|---|---|---|---|
| 生产依赖个数 | **21 个**（"会进安装包"） | `docs/spec/SPEC-security.md:168-170` | **24** | `package.json:24-49` 逐行计数 |
| `node_modules` 体量 | 596 MB / 16,894 文件 / **288** 个顶层包 | `docs/spec/SPEC-security.md:167` | **1089.9 MB / 21,472 文件 / 334 个顶层包** | E2.1 |
| `sharp` | 「**刻意不引入**（缩略图）」 | `docs/spec/SPEC-security.md:192` | 在 `dependencies`（`package.json:45`），且被生产编码路径经 `src/main/encoder.mjs:12 → onnx-spike/resize_compat.mjs:35` 动态 import | E2 |
| 单测框架 | 「**单测 vitest**」 | `docs/spec/SPEC-app.md:72` | `node:test`（`package.json:19`）；`vitest` 装了 0 使用 | E2 |
| core 测试条数 | 「当前 `core/` 的 **61 条**测试」 | `docs/spec/SPEC-security.md:208` | **68**（`npm test` → tests 68） | E1.1 |
| 引擎能力 | `SPEC-app.md:119` 仍写 `pnpm test  # vitest`、`:128-131` 仍写 `& ..\.venv\Scripts\python.exe tools/preflight_p05.py` | `docs/spec/SPEC-app.md` | 仓库 0 个 Python 文件、无 vitest | E1.1 / E2 |
| `package.json` 注释「打开 checkJs 会报 222 条 noImplicitAny（实测）」 | 222 | `package.json:59` | node 项目 noImplicitAny 家族 **111**；两侧合计 **197** | E1.3 |
| `PROJECT-GUIDE.md:186,213` 「仓库根 24 个文件」 | 24 | `PROJECT-GUIDE.md` | 14（含 `AGENTS.md`） | E7.1-D4 |

### E7.3 规格承诺栈 vs 实际栈（S4 的事实面）

**规格承诺**（逐行）：

```
TASK-PLAN.md:23       | **形态** | Electron + TypeScript + React + Tailwind + shadcn/ui（详见 docs/spec/SPEC-app.md §3） |
docs/spec/SPEC-app.md:63  | 语言 | **TypeScript** |
docs/spec/SPEC-app.md:65  | 组件库 | **shadcn/ui + Radix UI** | … Radix 提供 AlertDialog/Dialog/Popover/Toast …
docs/spec/SPEC-app.md:66  | 样式 | **Tailwind CSS** |
docs/spec/SPEC-app.md:67  | 图标 | **Lucide** |
docs/spec/SPEC-app.md:70  | 状态 | **zustand**（+ IPC 事件流） |
docs/spec/SPEC-app.md:71  | 长列表 | **@tanstack/react-virtual** |
docs/spec/SPEC-app.md:184 - 主进程 / 渲染进程：TypeScript。
docs/design/DESIGN-tokens.md:234 ## 11. 映射到 Tailwind + shadcn/ui
docs/design/UI-REVIEW-and-migration.md:238 P3a 设计系统落地（Tailwind + shadcn/ui 基础组件 …）
```

**实际**：

```
全仓 .ts/.tsx = 0（E1.2）；渲染层 31 个 .js/.jsx 文件；样式为手写 src/renderer/src/renderer.css（只消费 var(--*)）；
组件为自研 src/renderer/src/ui/ 共 10 个（Button Chip Field Metric Progress Score SearchBox Tag Toast + cx.js）；
Tailwind 插件未装进 renderer.plugins（electron.vite.config.mjs:69）；Radix/zustand/react-virtual 0 import（E2）。
```

**迁移代价实测**：126（渲染层）+ 230（node 侧，含 spike 42）= **356 条真实类型错误**；
其中 `noImplicitAny` 家族 **86**（web：7031×64 + 7006×20 + 7019×1 + 7053×1）与 **111**（node）= **197 条**；`tsc` node 项目单次 6.85 s。
第一方待转文件：`src/` 31 个（1313 LOC）+ `core/` 6 个（868 LOC）。

---

## E8 S9 门禁覆盖清单（盲区取证）

| 盲区 | 证据 |
|---|---|
| 无 CI | `Test-Path .github` → False；无 `.gitlab-ci.yml` 等其他 CI 文件 |
| 无提交钩子 / 无 lint / 无格式化 | package.json 全文匹配 `husky|lint-staged|eslint|prettier` → 0 命中 |
| 无 typecheck 门禁 | 无 `typecheck` 脚本；`package.json:58-60` 自述「**刻意没有 typecheck 脚本**」 |
| 只读守卫全部手动 | E1.5 |
| 唯一自动化的是 `tools/smoke_app.mjs`（`npm run smoke`），需真实 GUI，本环境未跑 | package.json:16；`tools/smoke_app.mjs:12-18` 的用法与退出码表 |
| 主进程 / preload / IPC / thumb:// 无单测 | E1.1 的 `tests/` → `src/` 引用为 0 |
| `core/` 零依赖无守卫 | E3 |
| 无打包产物验证（asar 内容 / 原生解包 / 首启） | 无任何脚本引用 `asarUnpack` 或 `dist/`；`verify_app_build.mjs` 只查 `out/` 形状 |
| 无依赖安全审计 | 无 `npm audit` 接线（`docs/spec/SPEC-security.md:195` 明确拒绝 `npm audit fix --force`，但未说明是否保留只读审计） |

---

## E9 本轮由命令产生/修改的文件与清理

| 文件 | 来源 | 处置 |
|---|---|---|
| `tsconfig.web.tsbuildinfo`（仓库根，10,148 B，mtime 2026-10-12 09:59:15） | **本轮按任务要求执行 `npx tsc --noEmit -p tsconfig.web.json` 时由 `composite: true` 自动写出** | 已删除，恢复到命令执行前的状态（`Test-Path` → False）。后续两次测量改用 `--tsBuildInfoFile "$env:TEMP\…"` 避免再落到仓库 |
| `tsconfig.web.tsbuildinfo`（32,115 B）与 `tsconfig.node.tsbuildinfo`（284,621 B），mtime **2026-10-12 10:08:36/37** | **不是本轮作者产生**：该时刻在作者首次交付（10:07:11）之后、`REVIEW-STACK-AUDIT.md`（10:12:55）之前，与独立复核 §2 抽查 S2 所跑的两条 `npx tsc --noEmit … -p tsconfig.{web,node}.json`（未加 `--tsBuildInfoFile`）在时间与命令上吻合 → 判为**复核者复跑 tsc 的副产物** | **未处置**（不属作者 write-scope，且属他人命令产物）；两者均被 `.gitignore:99` 忽略，不影响 `git status`。**提示 Lead**：交付前可删除以保持工作区整洁 |
| 本文件、`STACK-AUDIT.md` | 本任务交付物 | 保留（在 write-scope 内） |

`git status --short` 在采集期间的输出只有 `?? AGENTS.md`、`?? docs/audit/`、`?? docs/plan/DOCS-*.md`
（`tsbuildinfo` 被 `.gitignore:99` 忽略，故不显示）。

---

## E10 本轮未做 / 无法验证（与正文 §12 一致）

1. **未跑 `npm run build`**：`out/` 是既有产物（本轮未重建），`verify_app_build.mjs` 校验的是**上一轮**的产物。
2. **未跑 `npx electron-builder --dir` / `--win`**：会下载 winCodeSign 等外部资源并写入 `dist/`，超出只读审查范围 → S7 的「分发可用性」是**静态推断 + 代码自述**，不是打包实测。
3. **未跑 `npm run dev` / `npm start` / `tools/smoke_app.mjs`**：需要真实 GUI 会话。
4. **未跑 `tools/verify_encoder_path.mjs` / `check_search.mjs`**：需要模型目录/查询向量参数；且它们会做真实 GPU 推理。
5. **未实测** 打包态窗口行为、冷启动耗时、真实 `thumb://` 取图（与 `README.md:179` 的既有声明一致）。
6. **未审计** 传递依赖的已知漏洞（无 `npm audit` 运行）。
7. `G:\model` 实测 `Test-Path` = True，但**未比对 3594 条索引与库文件的一一对应**。

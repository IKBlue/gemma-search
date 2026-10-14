# REVIEW-MIGRATION · monorepo 目录重构的**独立**复核

> **复核者**：独立验证者（未参与本次重构）· **日期**：2026-10-12
> **被验证对象**：工作区状态 `HEAD=4555c1b` + index + worktree（**未提交**）
> **执行依据**：[`docs/MIGRATION-PLAN.md`](/docs/MIGRATION-PLAN.md) §1/§2/§3/§6/§7 · [`AGENTS.md`](/AGENTS.md) §2/§5
> **纪律**：本文件是复核者**唯一写入**的文件。未修改任何被验证的源码 / 配置 / 文档；未跑 `npm install` / `npm ci`（只跑 `--dry-run`）。
> **方法**：每条结论都是复核者**自己跑命令 / 自己读原文件**得到的原始输出。凡未验证的一律标【未验证】。

---

## verdict

**`pass-with-issues`**

- **重构的结构部分（P1 搬家）成立且可追溯**：120 个 rename、0 内容改动，逐 blob 校验通过。
- **门禁的 4 项关键期望值全部复现达标**（`npm test` 68/65/0/3 · `verify_renderer_styles` EXIT=0 · `verify-doc-refs` 根越界 0 / 死引用 6 · `npm ls` 无 UNMET）。
- **新布局成立**：7 个旧顶层目录全部不存在；`AGENTS.md` §2 逐行 `Test-Path` **无一处不一致**。
- **但存在 2 处「计划声称已做、磁盘未做」的缺口**（`reports/README.md`、`apps/desktop/src/README.md`）。
  二者都**不含失效代码**，属文档缺口；但按 MIGRATION-PLAN §3 P5 自己的验收词（「旧路径全仓无引用」）与 DoD#5，它们**未达标**。
- 另有 1 项**未验证**：`npm run build` 在本沙箱因 esbuild `spawn EPERM` 无法判定（环境限制，非代码问题）。

> 「pass-with-issues」的含义：**结构结论可采信**；但请先清掉 `blockers[]`，再让 Lead 做 P7 终验。

---

## blockers[]

### B-1 · `reports/README.md` 仍是迁移前的可执行命令，但**被现行文档当作协议出处**

| 项 | 内容 |
|---|---|
| **位置** | [`reports/README.md:37`](/reports/README.md#L37) · `:42` · `:47` · `:48` · `:49` · `:51` |
| **为什么是 blocker** | 该文件**未进入本次改动的任何清单**（`git status --short -- reports/README.md` 为空 → HEAD 版 = 工作区版），即**迁移完全没碰它**。而 `AGENTS.md` §3/§4 明确把它登记为**现行权威**：「门禁证据 → 协议见 `reports/README.md`」。它现在写着 5 条**必然失败**的命令。 |

**证据（原文，`read` 工具读出）**：

```powershell
# 0) 预检必须全绿（含库指纹 == 基线）
& ..\.venv\Scripts\python.exe preflight_p05.py --with-resume-test        # ← .venv/ 与 preflight_p05.py 均已不存在

# 1) 生成新索引（约 25 分钟；可中断续跑）
node onnx-spike/build_index_onnx.mjs --model <ONNX 模型目录> --lib "G:\model" `   # ← onnx-spike/ 已搬到 packages/indexer/src/
     --out data/idx-full --seq 140 --device webgpu --lib-id L1

# 2) 三道判据 + 报告
& ..\.venv\Scripts\python.exe quality_vector_equiv.py ...                # ← quality_* 工具随 Python 档退役被删
...
# 3) 人工复核（轻档）后，才在 TASK-PLAN §4 把 G-B 标 ✅                  # ← TASK-PLAN.md 已改名为 docs/plan/ROADMAP.md
```

**逐条落地核对**：

| 引用 | `Test-Path` / 事实 |
|---|---|
| `..\.venv\Scripts\python.exe` | 不存在（`AGENTS.md` §5.1 & MIGRATION-PLAN §4：仓库 0 个 Python 文件） |
| `preflight_p05.py` | 不存在 |
| `onnx-spike/build_index_onnx.mjs` | 不存在 → 真实路径 `packages/indexer/src/build_index_onnx.mjs` |
| `quality_vector_equiv.py` / `quality_top10.py` / `quality_report.py` | 不存在（`tools/quality/` 随 Python 档退役被删，见 AGENTS §5.3） |
| `TASK-PLAN.md` §4 | 不存在 → `docs/plan/ROADMAP.md` |
| `--lib "G:\model"` | 违反 `AGENTS.md` §7「不把本机绝对路径写进代码或文档」 |

**为什么不接受「它只是没验」**：
- 本文件头部第 3 行自己写着「**项目规则：无归档证据 = 门禁未通过**」，它是这把尺子的持有者。
- 该文件**不是** `reports/G-*/` 下的历史证据（历史证据不改是**正确**的，见 [`docs/DEBT-CLEANUP.md:229`](/docs/DEBT-CLEANUP.md#L229)）；它是 `reports/` 的**现行说明文档**，与 `AGENTS.md` 平级被引用。
- MIGRATION-PLAN §3 的 P5 门禁原文是「**旧路径全仓无引用**」，本文件命中 3 类旧路径。

**最小修法（不属复核者职责，仅供 Lead 参考）**：保留 `reports/G-B-*` 的原文不动（那是历史），把 `reports/README.md` §「复现一遍 G-B」整段改写为「**该流程已随 Python 档退役，不可复跑**，判据见 `docs/spec/SPEC-acceptance.md`」，命令改为新路径；`--lib` 改为 `<素材库根>`。

---

### B-2 · `apps/desktop/src/README.md` 的模块位置说明与磁盘相反（且它已暂存进 index）

| 项 | 内容 |
|---|---|
| **位置** | [`apps/desktop/src/README.md:75`](/apps/desktop/src/README.md#L75) · `:118` |
| **状态** | `git status --short` → `R  src/README.md -> apps/desktop/src/README.md`（**纯 rename，未改内容**） |
| **为什么是 blocker** | 这是一份**已进入 index**（将被提交）的文件，它给「索引/重采样/BMP 解码」这三个关键件写了**与磁盘相反的定位**，并把一条**已被明确取消**的债务（D-3）继续登记为待办。 |

**证据**：

- `:75` 原文：``| `encoder.mjs` | **逐字一致**，只多一行迁移注释 | 它的相对路径深度未变（`../../onnx-spike/…`），没有理由动它 |``
  → 磁盘事实相反：`apps/desktop/src/main/encoder.mjs:12` 现为 `'../../../../packages/indexer/src/resize_compat.mjs'`（**4 级 + 新路径**），且内容**已改**（缺省例外：BMP 回退 bug 修复 + 注释扩充，共 `17 insertions(+), 7 deletions(-)`）。
- `:118` 原文：``| 3 | `bmp_decode.mjs` / `resize_compat.mjs` 仍在 `onnx-spike/` | … **这一轮刻意不动** … | v2 归档后 |``
  → `onnx-spike/` **不存在**（`Test-Path` = False）；实际在 `packages/indexer/src/`。
  → `git status --short` 同时显示 `RM packages/indexer/src/resize_compat.mjs`（**该文件本轮确实被改了，17 insertions(+), 10 deletions(-)**），与「刻意不动」直接矛盾。
  → 该文件 `:122` 还保留 `| 7 | … | P6 |` 等多条与 `apps/desktop/src/README.md` §5 表格绑定的旧结论。
- 同一文件 `:121` 写「`npm run start:legacy` 仍可跑它」，而 [`package.json:36-37`](/package.json#L36) 明确写该脚本**已删除**，并给出替代命令。

**为什么计入 blocker 而不是「历史留档」**：它不在 `docs/archive/` 下，且已被 `git add` 进 index，读者会把它当现状依据（`AGENTS.md` §6 的定位行号纪律正是要求这类文件与磁盘一致）。

---

## checks[] · 八项逐项

### 检查 1 · P1 搬运可追溯 ✅ 达标

**我跑的命令**

```powershell
git diff --cached -M --stat | Select-Object -Last 1
```

**原始输出**

```
 120 files changed, 0 insertions(+), 0 deletions(-)
```

**我额外做的反误导核对**（不采信「二进制行不算内容改动」的说法，直接验 blob）：

```powershell
git diff --cached -M --numstat | Where-Object { $_ -match '^-\s+-\s' }
```

```
-	-	{spike => docs/archive/spike}/onnx140.json
-	-	{spike => docs/archive/spike}/onnx140_gpu.json
-	-	{spike => docs/archive/spike}/onnx280.json
-	-	{spike => docs/archive/spike}/onnx280_gpu.json
-	-	{spike => docs/archive/spike}/onnx_mini.json
-	-	-	{spike => docs/archive/spike}/ref140.json
-	-	-	{spike => docs/archive/spike}/ref280.json
-	-	-	{spike => docs/archive/spike}/sel_mini.json
-	-	-	{spike => docs/archive/spike}/spike_selection.json
```

逐个比对 `HEAD:<旧路径>` 与 `:<新路径>` 的 blob hash：

```
docs/archive/spike/onnx140.json                         SAME
docs/archive/spike/onnx140_gpu.json                     SAME
docs/archive/spike/onnx280.json                         SAME
docs/archive/spike/onnx280_gpu.json                     SAME
docs/archive/spike/onnx_mini.json                       SAME
docs/archive/spike/ref140.json                          SAME
docs/archive/spike/ref280.json                          SAME
docs/archive/spike/sel_mini.json                        SAME
docs/archive/spike/spike_selection.json                 SAME
```

> **补充事实（复核者实测）**：这 9 个文件**不是二进制**，是 `.json`——git 只因它们**含超长行 / NUL 字节**才在 `--numstat` 里打 `-  -`。所以「`-  -` 不算内容改动」这句话对本例**恰好正确，但理由是错的**；正确理由是 **blob hash 逐字相同**。这一点值得写进计划，免得下一个人以为「只要是 `- -` 就放过」。

**120 的去向分布**（用于可追溯性交叉核对）

```
  59  docs/archive
  35  apps/desktop
  14  packages/indexer
  10  packages/engine
   1  docs/plan
   1  packages/design-tokens
---
 120  总计（含 1 个 RD：onnx-spike/package-lock.json -> packages/indexer/package-lock.json 后删除）
```

**是否达标**：✅ 达标。

---

### 检查 2 · 新布局成立 ✅ 达标

**我跑的命令 / 原始输出**

```
core         Test-Path = False
src          Test-Path = False
tests        Test-Path = False
onnx-spike   Test-Path = False
spike        Test-Path = False
static       Test-Path = False
archive      Test-Path = False
```

**顶层实际内容**（排除 `.git`/`node_modules`/`.npm-cache`）

```
apps  build  data  docs  packages  reference  reports  resources  scripts  tools
.gitattributes .gitignore AGENTS.md electron-builder.yml electron.vite.config.mjs
LICENSE package-lock.json package.json README.md
tsconfig.json tsconfig.node.json tsconfig.node.tsbuildinfo tsconfig.web.json tsconfig.web.tsbuildinfo
```

**是否达标**：✅ 达标（7/7 全部不存在）。

> 附注：`tsconfig.*.tsbuildinfo` 两个文件存在，但 `git ls-files` 无它们、`git check-ignore -v` 命中 `.gitignore:95:*.tsbuildinfo` → 未跟踪的派生物，**不构成意外改动**。

---

### 检查 3 · 门禁真过 ⚠️ 4 项达标 / 1 项未验证

#### 3a · `npm test` ✅

```
ℹ tests 68
ℹ suites 0
ℹ pass 65
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 466.6075
```

3 个 skip 的原因我在输出里**逐条看到**，与 `AGENTS.md` §5.1 的说法一致：

```
﹣ ④ 指向库外的文件符号链接 → SYMLINK_REJECTED (1.3283ms) # 本环境无法创建文件符号链接：EPERM
﹣ 指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性） (0.1432ms) # 缺 config.json 或 baseline-v1.json
﹣ uid: 整库唯一性（用真实素材库；库不存在则跳过） (0.159ms) # 无 config.json
```

> **复核者更正**：`AGENTS.md` §5.1 说第 2/3 项是「死引用，会永久跳过」。**skip 并非永久**——测试自己写的条件是「缺 `config.json` **或** `baseline-v1.json`」，而 `data/baseline-v1.json` **确实在库里被 git 跟踪**（`git ls-files data/baseline-v1.json` 有值）。真正缺的只有 `config.json`。所以这是**「缺一个可提供的文件」**，不是「永久性死引用」；这在 D2 处置后可以复活。

#### 3b · `node tools/verify_renderer_styles.mjs` ✅ EXIT 0

```
--- 3) var(--x) 是否都在令牌表里有定义 ---
  [OK  ] 67 个令牌引用全部有定义
--- 4) 裸 px 报告（对照 §4.1 的 4pt 阶梯；仅提示）---
  裸 px 共 29 处；不在 4pt 阶梯上的：
  · apps\desktop\src\renderer\src\renderer.css 有 2 处不在阶梯上的 px：291:1100px, 294:760px
渲染层令牌纪律通过（无死颜色 · 无内联视觉值 · 无悬空变量）。
EXIT=0
```

#### 3c · `node tools/verify-doc-refs.mjs` ⚠️ 达标（根越界 0 / 死引用 6）· 但计划对 6 条的解释不准确

```
=== 2) 根目录是否只剩"入口 + 治理" ===
  根目录 .md：AGENTS.md · README.md
  ✓ 只有入口与行动依据

**未通过**：死引用 6 · 根目录越界 0
EXIT=1
```

**任务要求我「自己判断 6 条是不是都是外部 URL」。我做了，结论是：6 条**全部**是误报，但**不是同一个原因**——见 `rebuttals[]` R-3。**

| # | 位置 | 内容 | 复核者判定 |
|---|---|---|---|
| 1 | `docs/audit/REVIEW-UIUX-AUDIT.md:432` | `materials.md` | 误报：中文散文里**提到**某个文档名（`**B4 / M3（materials.md）打不开**`），不是引用 |
| 2-5 | `docs/audit/uiux-evidence.md:624-627` | `color.md` ×2 · `materials.md` · `typography.md` | 误报：**裸 URL** 的末段（`https://raw.githubusercontent.com/.../color.md`） |
| 6 | `docs/audit/uiux-evidence.md:627` | `ea8e93e.../skills/hig-foundations/references/typography.md` | 误报：同上，路径含 `/` 所以被多抓了一段 |

**我复现了 guard 的判定链**（自己写探针跑 `stripCode` + `REF`，不是读结论）：

```
docs/audit/REVIEW-UIUX-AUDIT.md:432
  剥离代码后前 150: 1. **B4 / M3（materials.md）打不开**：三路 URL 在本环境均               ，...
  REF 命中        : ["materials.md"]
docs/audit/uiux-evidence.md:624
  REF 命中        : ["color.md"]
docs/audit/uiux-evidence.md:627
  REF 命中        : ["typography.md","ea8e93e0cc3a877cf90d49d8f6fc55991ed29701/skills/hig-foundations/references/typography.md"]
```

根因：`REF` 的负向后顾 `(?<![\w/.-])` 使匹配只能从某个 `/` **之后**起步 → 裸 URL 的末段被当成仓库相对引用；而 `stripCode` 只因第 1 条不在反引号里（第 2-6 条的 URL 是**裸**的，不是反引号包起来的）才漏过。

**是否达标**：根目录越界 ✅ 0（达标）；死引用 6 条 —— 复核者**独立确认全部为误报、无需修**，故不构成 blocker。

#### 3d · `npm ls --depth=0` ⚠️ 无 UNMET（达标）但 **EXIT=1 + 4 个 `invalid`**

```
+-- @gemma-search/design-tokens@0.1.0 invalid: "file:D:\\USERS\\...\\packages\\design-tokens" from the root project (packages/design-tokens)
+-- @gemma-search/desktop@0.1.0       invalid: "file:...\\apps\\desktop" from the root project (apps/desktop)
+-- @gemma-search/engine@0.1.0        invalid: "file:...\\packages\\engine" from the root project (packages/engine)
+-- @gemma-search/indexer@0.0.1       invalid: "file:...\\packages\\indexer" from the root project (packages/indexer)
...（另有 2 个 extraneous：@emnapi/runtime · @img/sharp-wasm32）
EXIT=1
UNMET 计数 = 0
```

**任务只让我查「无 UNMET DEPENDENCY」——0 条，达标。** 但任务**没提** EXIT=1 与 4 个 `invalid`，我把它查到底了（见 `rebuttals[]` R-2）：**这是 npm 自身的假阴性，不是仓库缺陷**。

**是否达标**：✅ 达标（UNMET = 0）。

#### 3e · `npm run build` ❌【未验证 · 环境限制】

```
> electron-vite build
failed to load config from D:\USERS\Desktop\Agent\gemma-search\electron.vite.config.mjs
error during build:
Error: spawn EPERM
    at ChildProcess.spawn (node:internal/child_process:421:11)
    at Object.spawn (node:child_process:796:9)
    at ensureServiceIsRunning (D:\USERS\Desktop\Agent\gemma-search\node_modules\esbuild\lib\main.js:1978:29)
    at bundleConfigFile (file:///D:/USERS/Desktop/Agent/gemma-search/node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:1710:26)
    at loadConfigFromFile (file:///D:/USERS/Desktop/Agent/gemma-search/node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:1674:46)
EXIT=1
```

**如实记为环境限制，不替它放行**：失败发生在 `loadConfigFromFile` 阶段 ⇒ **配置文件尚未被求值**，所以这个 EPERM **不能**归因于配置写错。同理，依赖 `out/` 的三条检查本轮**未获判定**：

```
=== verify_app_build.mjs ===
  [FAIL] out/main/index.js 存在
  [FAIL] out/preload/index.cjs 存在
  [FAIL] out/renderer/index.html 存在
产物不齐 —— 先跑 `npm run build`。
EXIT=1                      ← 如实报缺，没有假装通过（这一点是好的）

=== smoke_app.mjs ===
  [FAIL] out/main/index.js（先跑 npm run build）
EXIT=1                      ← 与文件头 :18「1 = 产物缺失」一致，符合约定
```

`out/` 实测 `Test-Path` = **False**（P1 前的过期产物已删）。

---

### 检查 4 · 锁文件与工作区一致 ✅ 达标

```
=== 根 lock 里的 @gemma-search 条目 ===
node_modules/@gemma-search/design-tokens {"resolved":"packages/design-tokens","link":true}
node_modules/@gemma-search/desktop       {"resolved":"apps/desktop","link":true}
node_modules/@gemma-search/engine        {"resolved":"packages/engine","link":true}
node_modules/@gemma-search/indexer       {"resolved":"packages/indexer","link":true}
→ 条目数 = 4  ✓

=== node_modules/@gemma-search Junction ===
design-tokens  Junction  {Global\D:\USERS\Desktop\Agent\gemma-search\packages\design-tokens}
desktop        Junction  {Global\D:\USERS\Desktop\Agent\gemma-search\apps\desktop}
engine         Junction  {Global\D:\USERS\Desktop\Agent\gemma-search\packages\engine}
indexer        Junction  {Global\D:\USERS\Desktop\Agent\gemma-search\packages\indexer}
→ Junction 数 = 4  ✓

=== packages/indexer/package-lock.json ===
Test-Path = False  ✓（已不存在）
```

**我加做的两项**（不只是「存在」）：

```powershell
# ① junction 真的能被 Node 解析（不是坏链接）
OK   @gemma-search/engine        -> D:\...\node_modules\@gemma-search\engine\package.json
OK   @gemma-search/indexer       -> D:\...\node_modules\@gemma-search\indexer\package.json
OK   @gemma-search/desktop       -> D:\...\node_modules\@gemma-search\desktop\package.json
OK   @gemma-search/design-tokens -> D:\...\node_modules\@gemma-search\design-tokens\package.json

# ② 锁文件与 manifests 的一致性（--dry-run，不改盘）
npm ci --dry-run --ignore-scripts --no-audit --no-fund
change @gemma-search/desktop 0.1.0 => 0.1.0
change @gemma-search/engine 0.1.0 => 0.1.0
change @gemma-search/indexer 0.0.1 => 0.0.1
change @gemma-search/design-tokens 0.1.0 => 0.1.0
changed 4 packages in 1s
EXIT=0
```

> `npm ci --dry-run` **EXIT=0** ⇒ 锁文件与 4 个 manifests **一致**（`npm ci` 在锁与 manifest 不符时会非 0 退出）。这比「条目存在」是强得多的证据。
> 跑完后复核 `git status --short` 仍为 159 行、44 项 diff ⇒ **dry-run 未改盘**。

**是否达标**：✅ 达标。

---

### 检查 5 · 无未声明改动 —— 逐文件过完 ⚠️ 计划外改动 0 项（详见 `unexpected_changes[]`）

**状态分布（复核者更正了分组口径 —— 见下方「复核者更正」）**

```
R  103   纯 rename（index 层）
RM  16   rename + 已有 unstaged 内容改动
 M  26   仅 unstaged 内容改动（无 rename）
??  12   未跟踪（新文件/新目录）
 D   1   docs/plan/PRE-KICKOFF-CHECK.md
RD   1   onnx-spike/package-lock.json -> packages/indexer/package-lock.json 后删除
---
   159   git status --short 总行数
```

**44 项 unstaged 改动逐项归类**

| 类别 | 数量 | 文件 |
|---|---|---|
| ① 路径修正（7 类耦合） | 18 | `apps/desktop/src/main/{index,encoder,log}.mjs` · `apps/desktop/src/renderer/src/{App.jsx,main.jsx,renderer.css}` · `apps/desktop/src/renderer/README.md` · `packages/engine/src/engine.mjs` · `packages/engine/tests/{engine,index,security,uid}.test.mjs` · `packages/indexer/src/resize_compat.mjs` · `tools/{check_search,smoke_app,verify-doc-refs,verify_app_build,verify_encoder_path,verify_renderer_dom,verify_renderer_styles}.mjs` |
| ② 配置迁移 | 10 | `package.json` · `package-lock.json` · `electron.vite.config.mjs` · `electron-builder.yml` · `tsconfig.{node,web}.json` · `.gitignore` · `packages/indexer/package.json` · `packages/indexer/package-lock.json`（删） · `README.md`（技术总览重写） |
| ③ 文档重写 | 15 | `docs/README.md` · `docs/DEBT-CLEANUP.md` · `docs/design/{DESIGN-app-details,DESIGN-tokens,UI-REVIEW-and-migration}.md` · `docs/plan/ROADMAP.md` · `docs/plan/PRE-KICKOFF-CHECK.md`（删） · `docs/spec/{CONTRACT-engine-v1,SPEC-acceptance,SPEC-app,SPEC-identity,SPEC-security,SPEC-transactions}.md` |
| ④ **已声明例外**（非目录类代码改动） | 1 | `apps/desktop/src/main/encoder.mjs` —— 见下 |

**④ 的逐字核对**（我不是采信声明，是读了 diff）：

```diff
-    const { readBmpAsRawImage } = await import('../../onnx-spike/bmp_decode.mjs');
-    return { image: await readBmpAsRawImage(buf), source: 'bmp-fallback' };
+    const { readBmpAsRawImage } = await import('../../../../packages/indexer/src/bmp_decode.mjs');
+    // ⚠️ 这个 API 要的是**路径**，不是 Buffer：`readBmpAsRawImage(filePath)` 内部自己做
+    // `fs.readFileSync(filePath)`（packages/indexer/src/bmp_decode.mjs:137 → :56）。
+    // 曾经这里传的是上面那个 `buf` → `fs.readFileSync(Buffer)` → `ERR_INVALID_ARG_VALUE`，
+    return { image: await readBmpAsRawImage(absPath), source: 'bmp-fallback' };
```

与 MIGRATION-PLAN §3 的声明**一致**（`Buffer` → `absPath`）。声明未提但同属该文件的附赠改动：新增 3 处解释性注释（`17 insertions(+), 7 deletions(-)`）。**无第二处计划外功能改动。**

**DoD#5 全仓 grep（复核者自己跑）**

| 模式 | 结果 |
|---|---|
| `python.exe` | 仅 `reports/README.md:37,47,48,49`（⇒ **B-1**） |
| `shadcn` | 命中处**全部自带废弃标注**（`DESIGN-tokens.md:258`「已否决，未采纳」· `SPEC-app.md:70`「不是现行技术栈」· `SPEC-security.md:219,232`「均未接入」）⇒ 合规 |
| `PROJECT-GUIDE` | 仅出现在「已并入/已归档」的语境（`AGENTS.md:5` · `docs/README.md:47` · `ROADMAP.md:368`）⇒ 合规 |
| `config.example.json` | 仅 `DEBT-CLEANUP.md:503` · `MIGRATION-PLAN.md:174`，且都是「**这类教学段已删**」的记录 ⇒ 合规 |

**DoD#6 根目录 .md** ✅ `AGENTS.md` · `README.md` 恰好 2 份。

**复核者更正（关于分组口径）**：用 `$_.Substring(0,2) | Group-Object` 会把 `'M '`、`'A '`、`'D '`、`'R '` 这类「X+空格」误并成同一组。本报告的分组是按**两字符 X/Y 位**逐个判定的结果。

**是否达标**：✅ 计划外改动 = 0（`blockers[]` 里的两处属**该做未做**，不是「未声明的新改动」）。

---

### 检查 6 · 文档与磁盘一致 ✅ 达标（`AGENTS.md` §2 逐行无一处不一致）

`AGENTS.md` §2 表里出现的**每一个路径**，逐个 `Test-Path`：

```
apps/desktop                             True
apps/desktop/src/main                    True
apps/desktop/src/preload                 True
apps/desktop/src/renderer                True
apps/desktop/src/shared/ipc.mjs          True
packages/engine                          True
packages/engine/src                      True
packages/engine/tests                    True
packages/indexer                         True
packages/design-tokens/tokens.css        True
docs                                     True
docs/spec                                True
docs/design                              True
docs/guide                               True
docs/plan                                True
docs/audit                               True
docs/archive                             True
tools                                    True
tools/probe_electron_start               True
scripts                                  True
scripts/electron-vite.mjs                True
reports                                  True
build                                    True
resources                                True
reference/MODEL_CARD.md                  True
data                                     True
out                                      False   ← 表里写「构建产物（npm run build 生成）」，且 .gitignore 排除、未跟踪 ⇒ 一致
node_modules                             True
.npm-cache                               True
tests                                    False   ← 表里**自己写明**「当前**不存在**」⇒ 一致
package.json                             True
electron.vite.config.mjs                 True
electron-builder.yml                     True
tsconfig.json                            True
tsconfig.node.json                       True
tsconfig.web.json                        True
.gitignore                               True
.gitattributes                           True
LICENSE                                  True
```

**不一致处：0 处。** 两个 `False` 都在表里被**显式标注**过（`out/` 是派生物、`tests/` 标了「当前不存在」），属如实登记而非不一致。

**是否达标**：✅ 达标。

---

### 检查 7 · `docs/archive/` 只作历史 ✅ 达标（但有 1 处指向未更新的同侪文件）

| 抽查对象 | 原文 | 判定 |
|---|---|---|
| `AGENTS.md:42` | `archive/`（**已失效的东西全放这里**） | ✅ 无当依据 |
| `AGENTS.md:69` | 一次性探针 → `tools/probe_electron_start/` **或** `docs/archive/spike/` | ✅ 定位为「别放仓库根」的垃圾投放点，非依据 |
| `AGENTS.md:75` | 被取代/已失效 → `docs/archive/`（留档不删） | ✅ |
| `docs/README.md:46` | `archive/  已失效/历史（**不再是依据**）` | ✅ |
| `docs/README.md:136` | `docs/archive/` 下所有内容…都是**历史证据**…**不是现状、不是依据** | ✅ 明确 |
| `docs/spec/SPEC-app.md:175` | 旧外壳/旧计划已归档在 `docs/archive/`（**不再是依据**） | ✅ |
| `apps/desktop/src/renderer/README.md:15` | 原型套件已归档…**不再是依据** | ✅ |
| `docs/design/UI-REVIEW-and-migration.md:9` | `docs/archive/prototype/*`…**只作历史留档，不再是依据** | ✅ |
| `docs/plan/ROADMAP.md:491` | 改 UI → 改 `docs/design/…`（**不是**指向归档） | ✅ |

**归档路径本身也核对过**（避免「标了归档但路径不成立」）：

```
docs/archive/prototype/prototype          True    ← DESIGN-tokens.md:17/62 · ROADMAP.md:386 引用的就是这个
docs/archive/prototype/prototype/style.css True
docs/archive/prototype/_archive           True    ← UI-REVIEW:9 引用
docs/archive/prototype/plan-overview.html True    ← ROADMAP.md:388 引用
docs/archive/spike                        True
docs/archive/legacy                       True
```

唯一**非**归档物被当依据的情况，是 `apps/desktop/src/README.md:121`（把 `archive/app-shell-20261010/` 当坐标并声称 `npm run start:legacy` 可跑）—— 已计入 **B-2**。

**是否达标**：✅ 达标（归档物本身没有任何一处被当现行依据）。

---

### 检查 8 · `log.mjs` 的 ROOT 探测两态都对 ✅ 达标

**方法**：自己造 `<tmp>/out/main/` 与 `<tmp>/apps/desktop/src/main/` 两个布局，两边都放进**真实的** `apps/desktop/src/main/log.mjs`（`copyFileSync`，不是重写），并造出最小仓库根（`package.json` 含 `workspaces` + `packages/engine/src/engine.mjs` 标记），然后 import 它读 `ROOT`。

**原始输出**

```
########## 场景 1：源码态 = <root>/apps/desktop/src/main/log.mjs ##########
  日志文件 = C:\Users\...\logprobe-784B5k\_s1.log
  应用根 = C:\Users\...\logprobe-784B5k
  ROOT     = C:\Users\...\logprobe-784B5k
  期望     = C:\Users\...\logprobe-784B5k
  判定     = PASS

########## 场景 2：构建态 = <root>/out/main/log.mjs ##########
  ROOT     = C:\Users\...\logprobe-784B5k
  判定     = PASS

########## 场景 3：中间层 package.json 无 workspaces（干扰项）##########
  ROOT     = C:\Users\...\logprobe-784B5k
  判定     = PASS

########## 场景 4：无任何标记（应走 FALLBACK_ROOT 并打印告警横幅）##########
  !! ROOT 解析可疑 —— 它不是仓库根。
  !!   ROOT = C:\Users\...\logprobe-784B5k
  !!   HERE = C:\Users\...\logprobe-784B5k\out\main
  !!   查过 = ...\package.json （不存在/无 workspaces）
  !!          ...\packages\engine\src\engine.mjs （不存在）
  !!   后果 = 日志会写到错误目录（静默）、data/ 也会找错
  判定     = PASS
```

**结论**：源码态与构建态**都解到正确的仓库根**（两态同一结果，与 §2 注解「深度无关」相符）；中间层放了无 `workspaces` 的 `package.json` 也不误判；标记全无时**自检横幅确实发声**（不是静默）。

**我只加做的第四态检查**（见 `rebuttals[]` R-5）：标记全无时走 `FALLBACK_ROOT = resolve(HERE,'..','..')`，该兜底**只对构建态正确**。

**是否达标**：✅ 达标（任务要求的 2 个场景 + 我加的 2 个干扰场景全部 PASS）。

---

## unexpected_changes[]

**空数组（计划外改动 = 0 处）。**

`unexpected_changes: []`

依据：44 项 unstaged 改动全部落在计划允许的 4 类里（① 路径修正 18 · ② 配置迁移 10 · ③ 文档重写 15 · ④ 已声明例外 1）。逐项归类见「检查 5」。12 项未跟踪文件全部是计划内的新建物：

```
?? AGENTS.md                            （P3 单一工作指南，新建）
?? apps/desktop/package.json            （P2 子包 manifest）
?? packages/engine/package.json         （P2 子包 manifest）
?? packages/design-tokens/package.json  （P2 子包 manifest）
?? docs/MIGRATION-PLAN.md               （本重构执行依据）
?? docs/audit/                          （审查产物目录）
?? docs/guide/                          （新手上手/排障）
?? docs/plan/DOCS-{REQUIREMENTS,DESIGN,IMPLEMENTATION,TESTING,DEPLOYMENT}.md（五套项目文档）
```

**但请注意**：`unexpected_changes` 为空**不等于**没有缺口。`blockers[]` 的 B-1/B-2 属「计划声称已做、磁盘未做」，与「做了计划外的事」是两类问题。

---

## rebuttals[] · 主动反驳（5 条，均已实证）

### R-1 ✅ 反驳成立 · 「门禁的 5 项都过了」不成立 —— `npm ls --depth=0` **EXIT=1**

**我怀疑的点**：任务把该检查的判据收窄成「无 UNMET DEPENDENCY（`extraneous` 可接受）」。这条口径**会掩盖非 0 退出**。

**实测**：`npm ls --depth=0` **EXIT=1**，且 stdout/stderr 里有 **4 个 `invalid`**（4 个 `@gemma-search/*` 全部）：

```
npm error code ELSPROBLEMS
npm error invalid: @gemma-search/design-tokens@0.1.0 D:\...\node_modules\@gemma-search\design-tokens
npm error invalid: @gemma-search/desktop@0.1.0 D:\...\node_modules\@gemma-search\desktop
npm error invalid: @gemma-search/engine@0.1.0 D:\...\node_modules\@gemma-search\engine
npm error invalid: @gemma-search/indexer@0.0.1 D:\...\node_modules\@gemma-search\indexer
```

**深挖**：根 `package.json` **根本没把 `@gemma-search/*` 列为依赖**（只有 `workspaces: ["apps/*","packages/*"]`）。所以 `invalid` 不该出现。我在 `%TEMP%` 里做**最小隔离复现**（1 个 root + 1 个子包、**零依赖**）：

```
--- npm ls --depth=0 ---
wsroot@1.0.0 C:\Users\...\wsprobe2
`-- @probe/foo@0.1.0 invalid: "file:C:\\...\\wsprobe2\\packages\\foo" from the root project (packages/foo)
EXIT=1
```

**结论（对报告有利）**：`invalid` 是 **npm 11.9.0 + Node 24 的已知假阴性**（对 `link: true` 的 workspace 条目 + 无版本 spec 时误判），**与本次重构无关**，且在**零依赖**的最小工程里同样复现 ⇒ 不构成仓库缺陷，也不构成 blocker。
**但报告口径仍应更正**：这一项**退出码非 0**，不该记成「EXIT=0 通过」。一致性证据应改用我跑的 `npm ci --dry-run` → **EXIT=0**。

---

### R-2 ✅ 反驳成立（对报告有利）· 「6 条死引用都是外部 URL 误报」——**根因说法不准确**

`AGENTS.md` §6 与 §5.1 把这个误报统一解释为「**外部 URL** 里形如 `xxx.md` 的镜像文件名」。我用探针复现 guard 的判定链后确认：**6 条里有 1 条根本不是 URL**。

```
docs/audit/REVIEW-UIUX-AUDIT.md:432
  剥离代码后: 1. **B4 / M3（materials.md）打不开**：三路 URL 在本环境均    ，...
  REF 命中  : ["materials.md"]
```

`materials.md` 在这里是**中文散文里提到的文档名**，不是链接、也不是仓库路径。它的漏网原因与 URL 无关 —— 是 `stripCode` 只剥反引号内容，而这处未加反引号。

同时更正另一半：guard 之所以能抓裸 URL 的末段，是因为 `REF` 的负向后顾 `(?<![\w/.-])` 使匹配只能从某个 `/` 之后起步；`typography.md` 那条被多抓了一段 `ea8e93e.../skills/hig-foundations/references/typography.md`，正是「URL 里含 `/`」的副作用。

**结论**：6 条**全部**是误报、**无需修**（这一点任务要我独立判断，我判断与实施者一致）——但**理由要分成两类**写。若把根因笼统写成「都是外部 URL」，下一个审查者会**漏掉**「散文里裸写 `xxx.md`」这一类。

---

### R-3 ✅ 反驳成立 · 计划自己反复强调「不能按层级数 `..`」，但**包 manifest 的注释里就有 3 级**

`docs/MIGRATION-PLAN.md` §2 注与 §3.1 第 1 条、`log.mjs:20-31` 都写了同一条教训：**凡「按层级数 `..`」的假设都必须同时考虑两态**。我逐个核了 4 个包 manifest 的注释示例：

| 位置 | 注释声称 | 该文件到仓库根的实际深度 | 判定 |
|---|---|---|---|
| `apps/desktop/package.json:13` | `` `../../../packages/engine/src/engine.mjs` `` | `apps/desktop/package.json` → 根 = **2 级**（示例写着 3 级） | ❌ **错** |
| `packages/engine/package.json:18` | `` `../../../packages/engine/src/engine.mjs` `` | `packages/engine/package.json` → 根 = **2 级** | ❌ 示例对不上本文件深度 |
| `packages/indexer/package.json:14` | `` `../../../packages/indexer/src/{…}.mjs` `` | `packages/indexer/package.json` → 根 = **2 级** | ❌ 同上 |
| `packages/design-tokens/package.json` | 只说「相对路径跨 root」 | — | ✅ 无数字 |

**同一份注释在 3 个不同深度的文件里用了同一个 3 级示例**，而根 `package.json:31-32` 与 `AGENTS.md` §8 都说「**包之间用相对路径 import，不用包名解析**」——这条纪律的**唯一**写法就是数 `..`。示例写错正是本重构花力气防的那类错误，属**文档级偏差**，不构成 blocker（真实 import 我逐个核过，全部正确）。

**真实 import 复核（这项是对的）**：

```
apps/desktop/src/main/index.mjs:25    '../../../../packages/engine/src/engine.mjs'      ← 4 级 ✓
apps/desktop/src/main/encoder.mjs:12  '../../../../packages/indexer/src/resize_compat.mjs' ← 4 级 ✓
apps/desktop/src/renderer/src/main.jsx:13 '../../../../../packages/design-tokens/tokens.css' ← 5 级 ✓
```
（`renderer/src` 到根是 5 级 —— 由最近 `package.json` 边界规则推出：`apps/desktop/package.json` 在 `apps/desktop/`，故 `renderer/src` 其上无包边界，必须走到根。）

---

### R-4 ✅ 反驳成立 · 「重构未改任何既有文件」——实际 44 个**既有**文件被改

计划 P1 的门禁原文是「`git status` 只有 rename；`git diff --stat -M` 显示 **0 内容改动**」，报告写「120 个 rename · **0 内容改动**」。

**这句只在 `--cached`（index）层成立**。同一条命令去掉 `--cached` 会得到完全不同的数字：

```powershell
git diff -M HEAD --stat | Select-Object -Last 1
 149 files changed, 1613 insertions(+), 1930 deletions(-)
```

其中**44 个是 HEAD 里就存在的既有文件**（`git diff --name-status` 44 项），另有 105 项是新增/重命名视图。

**实测（`git diff --name-status` 44 项）**：`M .gitignore` · `M README.md` · `M apps/desktop/src/main/encoder.mjs` · … · `M tsconfig.web.json`（其中 1 `D` + 1 `RD`）。

**我为什么仍判它不构成 blocker**：这 44 项**全部**能落到计划允许的类别里（路径修正/配置迁移/文档重写/已声明例外），见「检查 5」。**但「0 内容改动」这句话必须限定作用域**（「**只有 index 层**为 0」），否则它会被读成「本轮没改任何文件内容」——而 `encoder.mjs` 恰好**改了代码**。

---

### R-5 ✅ 反驳成立 · `log.mjs` 的 **兜底路径**仍按层级数 `..`，且**只对构建态正确**

`log.mjs:29` 声称改法是「**向上找标记**（深度无关），**两种态都解到同一个根**」。**标记探测**确实深度无关（我在检查 8 里四种场景都 PASS）。但**兜底**没有：

```
log.mjs:69   const FALLBACK_ROOT = path.resolve(HERE, '..', '..');
log.mjs:71   export const ROOT = process.env.GEMMA_ROOT || detectRepoRoot(HERE) || FALLBACK_ROOT;
```

我构造「标记全无」的场景实测：

```
【无标记 → 走 FALLBACK_ROOT = resolve(HERE,"..","..")】
  源码态   HERE=<root>/apps/desktop/src/main/log.mjs
           ROOT   = <root>\apps\desktop        ← WRONG（真根是 <root>）
           data/ 会落在: <root>\apps\desktop\data
  构建态   HERE=<root>/out/main/log.mjs
           ROOT   = <root>                     ← CORRECT
           data/ 会落在: <root>\data
```

即：**同一个兜底，构建态对、源码态错** —— 与本次重构要消灭的「两态深度不同」是**同一类缺陷**，只是下沉到了错误处理分支。

**为什么仍不构成 blocker**：
1. 它是**末位**兜底（`标记 → 标记 → FALLBACK`），正常两态都不会走到（检查 8 场景 1/2 已证）；
2. 走到时会**打印 6 行告警横幅**（场景 4 实测），所以**不是静默**失败 —— 这正是 `assertRootOnce()` 的设计目的；
3. 打包态（`PACKED`）会跳过断言，而打包态本就「没有仓库根」这一概念（P6 欠账，已在 `log.mjs:33-36` 与 `AGENTS.md` §7 如实登记）。

**建议（非 blocker）**：把兜底也改成标记式（例如再向上找 `packages/engine/src/engine.mjs`），或把 `FALLBACK_ROOT` 的注释从「构建态的层级」改成「**仅为打包态准备，源码态会错**」——现在 `:68` 的注释只写了「构建态」，读者容易以为两态都安全。

---

### 我试过但**没能**成立的反驳角度（如实登记，不编造）

| 角度 | 为什么没成立 |
|---|---|
| `.gitignore` 的 `node_modules/` 不带前导斜杠是否能覆盖工作区 | **成立**：`git check-ignore -v` 实测 `packages/engine/node_modules/x` · `apps/desktop/node_modules/x` · `packages/indexer/node_modules/x` 三条全命中 `.gitignore:76:node_modules/`；且 4 个工作区下确实无 `node_modules` 目录。注释属实。 |
| 「双份 `@huggingface/transformers`」隐患是否真的被消除 | **成立**：4 个工作区下无 `node_modules`；`npm ls` 显示 `@huggingface/transformers@4.3.1` 与 `bmp-js@0.1.0` 均 `deduped`。`packages/indexer` 虽保留同名依赖声明，但因版本区间相同被提升到根，只解析出一份。**未推翻。** |
| `AGENTS.md` §2 说 `data/`「绝大多数否」是否失真 | **成立**：`git ls-files data/` = **18**，`data/` 下工作区文件总数 = **379** ⇒ 4.7% 被跟踪，「绝大多数否」属实。**未推翻。** |
| 依赖 `out/` 的三条检查是否「假装通过」 | **未成立**：`verify_app_build` EXIT=1 明写「产物不齐 —— 先跑 npm run build」；`smoke_app` EXIT=1 与文件头 `:18`「1 = 产物缺失」一致。**未推翻。** |
| `docs/audit/` 未被 git 跟踪是否算证据不入库（违反 AGENTS §5.3 硬规则 1） | **未立案**：该硬规则约束的对象是 `reports/G-*/`（门禁证据），`docs/audit/` 是审查产物目录。且 `docs/audit/` 目前整体 `??`，属**尚未提交**的中间态（本次重构按要求**未 commit**），不是「拒绝入库」。**证据不足，不作结论。** |

---

## limits[] · 未能验证的（**不替它放行**）

| # | 未验证项 | 为什么无法验证 | 影响 |
|---|---|---|---|
| L-1 | **`npm run build` 是否成功** | 受限沙箱禁止 esbuild 用 piped stdio spawn 常驻服务 → `spawn EPERM`，失败点在 `loadConfigFromFile`（**配置尚未被求值**）。任务明确禁止绕过 EPERM。 | **DoD#3 未获判定。** 结构结论不受影响（EPERM 与配置内容无关），但**必须**在非受限终端跑一次才算 P7 过。 |
| L-2 | `out/{main,preload,renderer}` 三端产物是否齐备 | 依赖 L-1；`out/` 实测不存在 | 同上 |
| L-3 | `node tools/verify_app_build.mjs` 产物形状断言 | 依赖 `out/` | 本轮 EXIT=1 只证明「产物不齐」，**不证明**产物形状回归 |
| L-4 | `node tools/verify_renderer_dom.mjs`（jsdom 里真跑 React） | 依赖 `out/` | 渲染层**行为**未验证（`verify_renderer_styles` 只证明样式/令牌静态一致性） |
| L-5 | `node tools/smoke_app.mjs` 应用冒烟 | 依赖 `out/` | 冷启动/出窗未验证（与 `AGENTS.md` §7「未验证的能力」一致） |
| L-6 | `node tools/verify_encoder_path.mjs`（跑真实 ONNX 推理） | 需本机 ONNX 模型目录 + 素材库根；复核者无权假定它们存在 | 编码路径一致性未验证 ⇒ **`encoder.mjs` 的 BMP 回退修复本身我未能在运行时证实**，只核对了 diff 与代码事实（`readBmpAsRawImage(filePath)` 在 `bmp_decode.mjs` 内自读文件） |
| L-7 | `node tools/check_search.mjs`（检索端到端） | 需已注册索引 + 查询向量 | 未验证 |
| L-8 | `npm ci` 真实执行（非 dry-run） | 任务明确禁止（会改 `node_modules` 与锁文件 = 被验证对象） | 只以 `npm ci --dry-run` EXIT=0 作一致性证据 |
| L-9 | 打包态（asar）行为 | P6 未做，且本沙箱无法构建 | 未验证 |

> **诚实声明**：本报告**不声称** `npm run build` 通过、不声称产物形状正确、不声称渲染层行为正确、不声称编码路径正确、不声称检索端到端可用。这些全部是【未验证】。

---

## 附 · 复核者对被验证对象的影响声明

- 新建：`docs/audit/REVIEW-MIGRATION.md`（本文件，唯一写入）。
- 探针脚本写在 `data/_probe_*.mjs`（`.gitignore` 覆盖 `data/`，**不进 git**），跑完**已删除**（`Test-Path` = False 已验证）。
- `npm run build` / `smoke_app.mjs` 执行前后 `git status --short` 均为 **159 行**、`git diff --name-only` 均为 **44 项** ⇒ **未改动任何被跟踪文件**（含 `node_modules/` 与两个锁文件）。
- 未跑 `npm install` / `npm ci`（只跑 `--dry-run`，并已验证其未改盘）。
- 未 `git add` / `git commit` / `git push`。

**并发观察（供 Lead 参考）**：复核期间 `AGENTS.md`（10:54:04 写入）与 `docs/MIGRATION-PLAN.md` 被**其他 agent 持续修改**（复核开始时 §5.1 尚无「受限沙箱内不可能成功」一行，中途出现）。因此：

- `AGENTS.md` 目前是 `??`（**未跟踪**，非 staged add），`docs/MIGRATION-PLAN.md` 同为 `??`；
- 检查 6 的结论对应**复核时刻**的 `AGENTS.md`（共 263 行）；若该文件后续再改，需重跑检查 6。

---

*本文件与磁盘不一致时，以磁盘为准，并回来修本文件。*

# docs/audit/REVIEW-PERMISSIONS.md —— 独立复核：`docs/spec/SPEC-security.md` §8 的 16 条权限用例自动化

> **复核者**：独立复核 Agent（**未参与**本批实现）
> **复核时间**：2026-10-12（UTC+8 约 16:26–16:55）
> **环境**：Windows / PowerShell 5.1 + PowerShell 7（`pwsh`）· Node v24.14.0 · 沙箱 `workspace-write`
> **被复核结论**：`docs/spec/SPEC-security.md:276`（"§8 的 16 条权限用例已于 2026-10-12 **全部补上自动化**"）
> 与 `docs/spec/SPEC-security.md:292`（"本表 16 条**全部有自动化断言**"）

## verdict: **fail**

**fail 的限定**：不是"这批工作没价值"。恰恰相反 —— 决策层单测（S1/S2/S3/S5/S11/S12/S13/S14 的判定）是**真的**，
我独立复跑了其中 S3/S14 的双向验证，它们确实会红会绿。13 条用例有**真实且会执行**的断言。
**fail 的是这句结论本身**：`§7.6:276` / `§8:292` 声称 16 条"全部补上自动化"，
而其中 **S4 的关键子句是空转的、S6 的期望（404）一条断言都没有、S13 声称的"接线"断言可被一个 `false &&` 绕过**
（三处都有我的复现输出）。按本仓自己的纪律「无证据即未通过 / 不得声称未验证的能力」，
这三处不能算"补上了"。另有一处**本轮变更自己引入的行为变更**在源码注释里被写成"行为一字未改"。

### blockers

1. **B1 · S4 的"不产生文件读取"证明是空转的** —— `docs/spec/SPEC-security.md:314` 声称"**注入计数 fs 证明读取次数 = 0**"，
   但 `apps/desktop/tests/permissions.test.mjs:119-144` 里的 `spy` **从未被接线**（`:144` 直接 `void spy;`），
   `assert.deepEqual(reads, [])` 因此恒真。复现（R5）：给 `thumb-url.mjs` 真的加一次 `readFileSync`
   （用 `await import('node:fs')` 绕开那两条正则），S4 **仍然全绿**（`tests 12 · pass 12`），
   而探针显示读取**真的发生了**。⇒ 规范要求的那条性质其实没有断言。
2. **B2 · S6 期望的 `404` 一条断言都没有** —— `docs/spec/SPEC-security.md:316` 把"`index.mjs` 回 404"写进了
   "自动化在哪里"栏，但那是**叙述**。复现（R6）：把产物里的 `status: 404` 改成 `200`，
   `npm test`（112/111/0/1）与 `verify_app_build`（EXIT=0）、`verify_renderer_dom`（EXIT=0）**全部照常通过**。
   而这个 404 恰是本次抽函数**唯一改掉的行为**（§4.4）。
3. **B3 · S13 声称的"接线"断言可被一个 `false &&` 绕过** —— `docs/spec/SPEC-security.md:323` 说 §1c"断言校验
   **在 `ipcMain.handle` 实参内**"，`tools/verify_app_build.mjs:269` 实际只是裸正则 `/isTrustedSender\s*\(/`。
   复现（R7）：把 handler 改成 `if (false && !isTrustedSender(event))`，`verify_app_build` **EXIT=0**、`npm test` 全绿。
   ⇒ 来源校验（T4/T6 的唯一屏障）是否真的生效，现状**没有被锁住**。

> 另有两条**不列为 blocker 但必须修**的偏差：文档自相矛盾与陈旧（`docs/spec/SPEC-security.md:255`、`:262-264`，
> `docs/plan/ROADMAP.md:31/201/202/342/361`，`docs/DEBT-CLEANUP.md:432`，见 §4.6），
> 以及 `apps/desktop/src/main/index.mjs:337` 的注释"行为一字未改"与 `:360` 的 404 直接冲突（见 §4.4）。

## 复核对象的版本（一切结论只对这一版成立）

| 文件 | sha256（前 16 位） | 字节 | mtime (UTC) |
|---|---|---|---|
| `apps/desktop/src/main/index.mjs` | `653e4b9a35f17560` | 25643 | 2026-10-12T08:16:28Z |
| `apps/desktop/src/main/thumb-url.mjs` | `3e07447dd2dc57bf` | 4592 | 2026-10-12T08:14:22Z |
| `apps/desktop/src/main/window-security.mjs` | （见 `git status` 未跟踪） | 3024 | 2026-10-12T08:21:30Z |
| `apps/desktop/tests/permissions.test.mjs` | （未跟踪） | — | — |
| `apps/desktop/tests/window-security.test.mjs` | （未跟踪） | — | — |
| `tools/verify_app_build.mjs` | `be6ec9fec738d3d0` | 20049 | 2026-10-12T08:21:12Z |
| `tools/verify_renderer_dom.mjs` | `3fd779c3a2241759` | 30615 | 2026-10-12T08:26:32Z |
| `docs/spec/SPEC-security.md` | `0361b02ba80d743f` | 32786 | 2026-10-12T08:26:54Z |
| `out/main/index.js`（产物） | `6d883f961ba52449` | 63977 | 见 §7 |
| `out/preload/index.cjs`（产物） | `70e0be6e54223181` | 822 | 见 §7 |
| `out/renderer/assets/index-NAMB84Cs.js` | `d321cb0cf648a69e` | 686348 | 见 §7 |

> ⚠️ **复核对象在复核过程中被改动过**：我 16:26:2x 首次 `read docs/spec/SPEC-security.md` 时该文件 **414 行**、
> §8.1 最后一行是"**S8 的一条会跳过**"；重新读取时该文件已 **415 行**、`mtime = 2026-10-12T08:26:54Z`，
> 多出的正是 `docs/spec/SPEC-security.md:336`（"抽出 `thumb-url.mjs` 时改了一处状态码"）。
> ⇒ **本报告只对 `0361b02ba80d743f` 这一版负责**；若该文件再变，涉及它的结论需重跑。

---

## 0. 基线（复核开始时的原始输出）

```text
$ node tools/verify_app_build.mjs
  [OK  ] out/main/index.js 存在
  [OK  ] out/preload/index.cjs 存在
  [OK  ] out/renderer/index.html 存在
--- 0b) 产物新鲜度（构建失败时不许给假绿）---
  [OK  ] out/main 比 apps/desktop/src 新（产物是刚构建的）
--- 1c) 窗口安全接线（S11 / S12 / S13）---
  [OK  ] S11：注册了 setWindowOpenHandler（开新窗口）
  [OK  ] S12：注册了 will-navigate（导航拦截）
  [OK  ] S13：IPC handler 内部调用了 isTrustedSender（来源校验真的在调用路径上）
--- 2b) preload 暴露面最小化（S9）---
  [OK  ] preload 暴露的方法**恰好**是 invoke / onEvent / platform  — 实际：["invoke","onEvent","platform"]
全部通过。
EXIT=0
```

```text
$ npm test
ℹ tests 112
ℹ pass 111
ℹ fail 0
ℹ skipped 1
```

分目录（`node --test --test-isolation=none "<glob>"`，本沙箱下 `node --test <file>` 会 `spawn EPERM`）：

```text
$ node --test --test-isolation=none "apps/desktop/tests/*.test.mjs"
ℹ tests 38 · pass 38 · fail 0 · skipped 0
$ node --test --test-isolation=none "packages/engine/tests/*.test.mjs"
ℹ tests 74 · pass 73 · fail 0 · skipped 1
```

> **立刻可见的一处"声称 vs 事实"**：`docs/spec/SPEC-security.md:255` 写"**当前测试共 90 条（引擎 74 + 桌面 16）**"，
> 实际是 **112 条（引擎 74 + 桌面 38）** —— 这条数就长在本次改动所在的 §7.5 里，且被本次改动打到过时。

---

## 1. 逐条核对 16 条（checks）

命令统一为 `npm test`（`node --test --test-isolation=none` 两个 glob），逐条只列相关行。
"达标"= 断言存在 ∧ 真的执行（非注释 / 非 `skip` / 非死分支）∧ 内容与规范期望一致。

| # | 断言位置 | 我看到的原始输出 | 达标 |
|---|---|---|---|
| S1 | `apps/desktop/tests/permissions.test.mjs:28-38` | `✔ S1：未登记的方法一律拒绝（含 \`exec\` 这种明显的逃逸尝试）` | ✅ 决策面达标；⚠️ "→ `BAD_REQUEST`"这半截**无断言**（见下） |
| S2 | `permissions.test.mjs:40-49` | `✔ S2：已知方法传未知字段被拒（zod .strict()，不是"忽略多余字段"）` | ✅ 决策面达标；⚠️ 同上 BAD_REQUEST 半截 |
| S3 | `permissions.test.mjs:51-71` | `✔ S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id）` | ✅ **达标（含我的双向验证 R2）** |
| S4 | `permissions.test.mjs:115-145` | `✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**` | ❌ **不达标**：形状拒绝是真的，但"**不产生文件读取**"是空转证明（R5） |
| S5 | `permissions.test.mjs:100-113` | `✔ S5：size 只认白名单 128/256/512，@999 之类一律 400` | ✅ 达标（`assert.equal(r.status, 400)`，不是"非 200 即可"） |
| S6 | `permissions.test.mjs:175-182` | `✔ S6：未注册的库 ⇒ 无法还原 libId ⇒ 空串（调用方给 404）` | ❌ **部分不达标**：只证到"返回空串"；期望的 **404 一条断言都没有**（R6） |
| S7 | `packages/engine/tests/security.test.mjs:57-61`、`:178-183` | `✔ ①..④ 经由 .. 逃逸 → PATH_ESCAPES_LIB` · `✔ 注册表：索引里的 relPath 若被投毒（..\..）→ 仍被拦住` | ✅ 达标（`assert.equal(code, ERR.PATH_ESCAPES_LIB)`，精确错误码）。⚠️ 走的是 `resolveInLibrary`/`resolveByUid`，**不是** `item` 方法本身；`:317` 只引了前一条 |
| S8 | `security.test.mjs:84-99`（junction）/ `:101-114`（文件 symlink） | `✔ ④ 库内指向库外的目录联接 → SYMLINK_REJECTED` · `﹣ ④ 指向库外的文件符号链接 → SYMLINK_REJECTED # 本环境无法创建文件符号链接：EPERM` | ✅ 达标（junction 真跑；symlink 如实 skipped，`skipped 1` 计入，未冒充通过） |
| S9 | `tools/verify_app_build.mjs:292-315`（§2b）· `tools/verify_renderer_dom.mjs:431-462`（§11） | `[OK] preload 暴露的方法**恰好**是 invoke / onEvent / platform` · `[OK] S9：window.require 是 undefined` · `[OK] S9：本环境无 window.process（jsdom）—— 无 Node 能力可言` | ⚠️ **产物面达标、渲染面不达标**（R3）：§11 的 `require/module` 是 jsdom 保证的恒真，`process` 能力分支本环境根本不执行（`ok(true, …)`），暴露面断言测的是守卫**自己造的 mock** |
| S10 | `tools/verify_renderer_dom.mjs:468-520`（§12） | `[OK] ⭐ 没有真的插入 \`<img src=x>\` 元素` · `[OK] ⭐ 标题 innerHTML 里 \`&lt;img\` 是转义实体` | ✅ 达标（R4 证明会变红）；⚠️ 其中 `window.__XSS_EXECUTED` 那条**无鉴别力**（R4 里在真注入下仍 OK） |
| S11 | `apps/desktop/tests/window-security.test.mjs:59-68` + `verify_app_build.mjs:260-262` | `✔ S11：开新窗口**无条件** deny` · `[OK] S11：注册了 setWindowOpenHandler` | ✅ 决策面达标；接线仅 token 级（§1c，见 R7 同类问题） |
| S12 | `window-security.test.mjs:17-55` + `verify_app_build.mjs:263-265` | `✔ S12：库外 URL 一律不许导航；应用自身 URL 放行` · `✔ S12b：dev 态只放行 electron-vite 的 URL` · `[OK] S12：注册了 will-navigate` | ✅ 决策面达标；接线仅 token 级 |
| S13 | `window-security.test.mjs:82-119` + `verify_app_build.mjs:266-272` | `✔ S13/S13b/S13c/S13d/S13e` · `[OK] S13：IPC handler 内部调用了 isTrustedSender（来源校验真的在调用路径上）` | ❌ **决策面达标、接线面不达标**：`false && !isTrustedSender(event)` 仍全绿（R7） |
| S14 | `permissions.test.mjs:73-96` | `✔ S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行` · `✔ S14b：参数无法序列化（循环引用）时拒绝` | ✅ **达标（含我的双向验证 R1）** |
| S15 | `security.test.mjs:118-128` + `engine.test.mjs`（collect 用例） | `✔ ② 取件目标在白名单外 → COLLECT_DIR_NOT_ALLOWED` · `✔ ② 白名单要求整段匹配` · `✔ collect：白名单外/未配置的目标名 → COLLECT_DIR_NOT_ALLOWED` | ✅ 达标（精确错误码） |
| S16 | `security.test.mjs:144-155`、`:187-204` | `✔ ⑤ 解析与指纹是只读的：库指纹在操作前后不变` · `✔ 指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性）` | ✅ 达标（真跑：`ℹ 库 3594 图 + 3594 包 · 指纹 3c62f15c5944`，非跳过） |

**逐条统计**：完全达标 11 条（S1/S2/S3/S5/S7/S8/S11/S12/S14/S15/S16，其中 S1/S2/S11/S12 的"接线"半截另计）·
部分不达标 4 条（S4/S6/S9/S13）· 无一条"根本不存在"。**但"部分不达标"的 4 条里有 3 条恰好是传输层最核心的三处**
（`thumb://` 的"不读盘"、未注册库的状态码、IPC 来源校验的接线）。

### S1/S2 的附加说明：`BAD_REQUEST` 这半截没有断言

`docs/spec/SPEC-security.md:311-312` 的期望是"拒绝，`BAD_REQUEST`"。`permissions.test.mjs` 只断言
`validateCall()` 返回 `{ok:false, reason:'未登记的方法'}`；"这个 reason 会被主进程翻成 `BAD_REQUEST` 信封"
这一步在 `apps/desktop/src/main/index.mjs:213-216`，**没有任何测试**。唯一沾边的是
`tools/verify_app_build.mjs:272`：

```js
ok(!!ipcBody && /BAD_REQUEST/.test(ipcBody), 'S13：拒绝时返回 BAD_REQUEST 信封');
```

这是对**整段 handler 体**的子串匹配，而该 handler 里有**两处** `BAD_REQUEST`（`:208` 来源不可信的返回、
`:214` 参数非法的返回），所以它无法区分哪一条分支还在 —— 与 R7 暴露的是同一类弱点。

---

## 2. 反向验证（reversals）

> 纪律：只挑**报告里没用过**的组合（报告自称已双向验证的是 S1/S2/S4b/S5/S11/S12/S13，见 `docs/spec/SPEC-security.md:298`）。
> 我选的是 **S3 · S4 · S6 · S9 · S10 · S14 · S13-接线 · §0b-新鲜度**。
> **每次变异后都还原，并贴哈希/`git status`**（`§7`）。

### R1 · S14（载荷上限）：把尺寸闸门放宽 9999 倍 ⇒ S14 变红

变异（源码，合法语法，只改常量表达式）：`apps/desktop/src/shared/ipc.mjs:104`

```diff
-    if (bytes > MAX_PAYLOAD_BYTES) return { ok: false, reason: `载荷过大（${bytes} 字节）` };
+    if (bytes > MAX_PAYLOAD_BYTES * 9999) return { ok: false, reason: `载荷过大（${bytes} 字节）` };
```

```text
$ node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
✔ S1 …  ✔ S2 …  ✔ S3 …
✖ S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行 (1.8887ms)
✖ failing tests:
test at apps\desktop\tests\permissions.test.mjs:73:1
  AssertionError [ERR_ASSERTION]: 实际 reason：(root): Unrecognized key: "x"
    actual: '(root): Unrecognized key: "x"',
    expected: /载荷过大/,
ℹ tests 12 · pass 11 · fail 1
```

还原后：

```text
$ node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
ℹ tests 12 · pass 12 · fail 0
$ git diff --stat apps/desktop/src/shared/ipc.mjs      （空输出）
sha256 adf9436fdcc4dd846490319b155caa56274409465e053497b18f49ad3afa4fa0  (与基线一致)
```

### R2 · S3（libId 形状）：把 `LibId` 正则放宽成 `/^.*$/` ⇒ S3 变红

变异：`apps/desktop/src/shared/ipc.mjs:7`

```diff
-export const LibId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, '库 id 形状不合法');
+export const LibId = z.string().regex(/^.*$/, '库 id 形状不合法');
```

```text
✖ S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id） (0.943ms)
  AssertionError [ERR_ASSERTION]: 竟然通过了：{"libId":"../etc","uid":"022a00481875"}
ℹ tests 12 · pass 11 · fail 1
```

还原后：`ℹ tests 12 · pass 12 · fail 0`，`git diff --stat` 空，sha256 回到 `adf9436f…`。

### R3 · S9（preload 暴露面）：产物 preload 多暴露 `ipcRenderer` ⇒ §2b 红 / §11 仍绿

> 变异施加在**产物** `out/preload/index.cjs` 上（源码变异需要重新构建，而本沙箱 `npm run build` 不可用，见 §6）。
> 语法合法：只是在暴露对象里多一个键。

```diff
 electron.contextBridge.exposeInMainWorld("api", {
+  ipcRenderer: electron.ipcRenderer,
   /** 调引擎方法（方法名与参数由主进程 zod 白名单校验） */
```

```text
$ node tools/verify_app_build.mjs
--- 2) preload（sandbox:true 下必须 CJS）---
  [FAIL] 没有把 ipcRenderer 本体暴露出去
--- 2b) preload 暴露面最小化（S9）---
  [FAIL] preload 暴露的方法**恰好**是 invoke / onEvent / platform  — 实际：["ipcRenderer","invoke","onEvent","platform"]
  [FAIL] ipcRenderer 本体没有被当值放进暴露面
失败 3 项：
EXIT=1
```

**同一份被污染的产物，跑渲染层守卫 §11：**

```text
$ node tools/verify_renderer_dom.mjs
--- 11) 渲染进程权限姿态（S9）---
  [OK  ] preload 暴露面恰好是 invoke / onEvent / platform（mock 的 __set* 是守卫自用，不算）  — ["invoke","onEvent","__setEmptyLibrary","__setRevealError","__setInjectXss","platform"]
  [OK  ] api 上没有 ipcRenderer
React 渲染层逻辑全过（…）
EXIT=0
```

⇒ `docs/spec/SPEC-security.md:319` 把 S9 说成"两面：§2b（产物）+ §11（jsdom）"，
但**§11 那一面对产品的暴露面是零鉴别力的**：它断言的 `window.api` 是守卫自己在 `tools/verify_renderer_dom.mjs:107`
定义的 mock（该守卫从不加载 `out/preload/index.cjs`）。`[OK] api 上没有 ipcRenderer` 只是在说"我自己的 mock 里没有"。

还原后：`sha256 70e0be6e54223181…822`（与基线一致），`node tools/verify_app_build.mjs` → `全部通过` `EXIT=0`。

### R4 · S10（恶意文件名）：把卡片标题改成 `dangerouslySetInnerHTML` ⇒ §12 红（4 项）

> 同样施加在**产物** `out/renderer/assets/index-NAMB84Cs.js` 上（该产物未压缩，可读）。
> 该守卫的 §0b **不检查 renderer 产物新鲜度**（只比 `out/main`，见 `tools/verify_app_build.mjs:82-84`），所以这次变异不会触发新鲜度拦截。

```diff
-jsxRuntimeExports.jsx("div", { className: "card-title", title: item.relPath || "", children: title }),
+jsxRuntimeExports.jsx("div", { className: "card-title", title: item.relPath || "", dangerouslySetInnerHTML: { __html: title } }),
```

```text
--- 12) 恶意文件名必须按文本渲染（S10）---
  [FAIL] ⭐ 没有真的插入 `<img src=x>` 元素（= 没走 innerHTML 路径）  — 找到 1 个（>0 就是真被当 HTML 解析了）
  [FAIL] ⭐ 标题 innerHTML 里 `&lt;img` 是转义实体（React 文本渲染的实证）  — "<img src=\"x\" onerror=\"window.__XSS_EXECUTED=true\">.jpg"
  [FAIL] 标题 innerHTML 里没有未转义的 <img  — "<img src=\"x\" onerror=\"window.__XSS_EXECUTED=true\">.jpg"
  [FAIL] 载荷以文本形式出现在标题里（内容没被吞掉）  — ".jpg"
  [OK  ] ⭐ 载荷的 onerror 表达式**从未执行**（window.__XSS_EXECUTED 仍为假）  — false
失败 4 项
EXIT=1
```

> ⚠️ **顺带钉住一条"看着最决定性的"空断言**：在**真的**把载荷当 HTML 解析、DOM 里**真的**存在
> `<img src="x" onerror="window.__XSS_EXECUTED=true">` 的情况下，
> `[OK] ⭐ 载荷的 onerror 表达式**从未执行**` **仍然是 OK**（jsdom 不加载图片，`onerror` 永不触发）。
> 也就是说这一条**永远不会失败**，它对自己声称要抓的东西零鉴别力。
> （`docs/spec/SPEC-security.md:320` 把它列为 §12 的三条断言之一 ③。）

还原后：`sha256 d321cb0cf648a69e…686348`（与基线一致），§12 恢复 `EXIT=0`。

### R5 · S4（"不产生文件读取"）：给 `thumb-url.mjs` 真加一个 fs 读取 ⇒ **全绿**

这条不是"把防线拆掉"，而是**验证防线被拆掉时用例能不能发现**。
变异：`apps/desktop/src/main/thumb-url.mjs` 顶部加 `const nodeFsProbe = await import("node:fs");`，
并在 `parseThumbUrl` 入口对**每一次调用**（含 S4 的穿越输入）真的 `readFileSync` 一次。

```text
$ node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取** (1.6632ms)
✔ S4b：形状不合法的一律拒 …
✔ S4c：路径里的 `?query` 与 `#fragment` 不影响形状判定 …
ℹ tests 12 · pass 12 · fail 0
```

```text
$ node -e "import('./apps/desktop/src/main/thumb-url.mjs').then(m=>{m.parseThumbUrl('thumb://../../windows/win.ini');m.parseThumbUrl('thumb://L1/../../windows/win.ini');console.log('PROBE_READS =',JSON.stringify(m.PROBE_READS))})"
PROBE_READS = ["try:thumb://../../windows/win.ini","try:thumb://L1/../../windows/win.ini"]
```

⇒ **读取真的发生了，S4 全绿。** 原因见 §4.1：那个"计数 fs"从未被接线（`permissions.test.mjs:144` 是 `void spy;`），
"不 import fs"的两条正则也拦不住 `await import('node:fs')`。

还原后：`sha256 3e07447dd2dc57bf…4592`（与原件一致），`ℹ tests 12 · pass 12`。

### R6 · S6（未注册库 ⇒ 404）：把产物里的 `404` 改成 `200` ⇒ **全绿**

```text
$ node data/_review_mutate_404.mjs
已变异：S6 的 404 → 200（命中 1 处）
$ npm test                          → ℹ tests 112 · pass 111 · fail 0 · skipped 1
$ node tools/verify_app_build.mjs   → 全部通过        EXIT=0
$ node tools/verify_renderer_dom.mjs→ React 渲染层逻辑全过  EXIT=0
```

⇒ `docs/spec/SPEC-security.md:316` 的"自动化在哪里"栏写着"`permissions.test.mjs`「S6」**+ 主进程 `canonicalLibId`
未还原 ⇒ `index.mjs` 回 404**" —— 后半句**不是断言，是叙述**。把 404 改成 200，全仓门禁无一处报警。
（讽刺的是：404 恰恰是本次抽函数**改出来的**那个行为，见 §4.3。）

还原后：`sha256 6d883f961ba52449…63977`（与基线一致），`全部通过`。

### R7 · S13（接线）：把来源校验短路成 `false && !isTrustedSender(event)` ⇒ **全绿**

```diff
-    if (!isTrustedSender(event)) {
+    if (false && !isTrustedSender(event)) {
```

```text
$ node tools/verify_app_build.mjs
--- 1c) 窗口安全接线（S11 / S12 / S13）---
  [OK  ] S13：IPC handler 内部调用了 isTrustedSender（来源校验真的在调用路径上）
  [OK  ] S13：拒绝时返回 BAD_REQUEST 信封
全部通过。
EXIT=0
$ npm test  → ℹ tests 112 · pass 111 · fail 0 · skipped 1
```

⇒ `docs/spec/SPEC-security.md:323` 说 S13 的接线由 §1c"**断言校验在 `ipcMain.handle` 实参内**"。
`tools/verify_app_build.mjs:269` 确实把这个 token 限在 handler 实参内 —— 但**只看 token 在不在，不看它有没有被短路**。
`verify_app_build.mjs` 自己在 §1b 明确写过这个坑（`:198-201`、`:242-243`："不是全文找子串：那样把接线删掉、
只在别处留一份同样文本就能骗过去"），**§1c 没有用同一套纪律**（§1b 用 `callArgsOf`，§1c 用裸正则）。

还原后：`sha256 6d883f961ba52449…63977`，`全部通过`。

### R8 · §0b（产物新鲜度）：造"源码比产物新" ⇒ 必须拒绝（**有效**，但有范围缺口）

**A. 受控实验（用一个临时探针文件，不重建、不改任何既有文件的内容/时间戳）**

```text
$ # 新建 apps/desktop/src/main/__freshness_probe.mjs（内容随意，只为把 mtime 顶到最新）
$ node tools/verify_app_build.mjs
--- 0b) 产物新鲜度（构建失败时不许给假绿）---
  [FAIL] out/main 比 apps/desktop/src 新（产物是刚构建的）  — 产物比源码旧 4s：源码 apps\desktop\src\main\__freshness_probe.mjs ⇒ 重新跑 npm run build（它很可能失败了）

⚠️ 产物已过期 —— 本守卫下面的断言读的是**旧产物**，结论无效。
   先跑 `npm run build`，并确认它 EXIT=0。
EXIT=1
```

⇒ **§0b 真的有效**：它拦住了，并且**在跑 §1b/§1c/§2b 之前就 `process.exit(1)`**（`tools/verify_app_build.mjs:88-92`），
不会先吐一堆绿再报错。

```text
$ # 删除探针
$ node tools/verify_app_build.mjs | Select-String "0b\)|全部通过"
--- 0b) 产物新鲜度 ---
全部通过。
EXIT=0
```

**B. 范围缺口（我另外发现的）**：同一实验把探针换成 `packages/engine/src/__freshness_probe.mjs`：

```text
$ node tools/verify_app_build.mjs
--- 0b) 产物新鲜度（构建失败时不许给假绿）---
全部通过。
EXIT=0
```

而**引擎代码确实被打进 `out/main`**：

```text
$ node -e "const s=require('fs').readFileSync('out/main/index.js','utf8');for(const k of ['resolveInLibrary','PATH_ESCAPES_LIB','createEngine','fingerprintV1'])console.log(k,s.includes(k))"
resolveInLibrary true
PATH_ESCAPES_LIB true
createEngine true
fingerprintV1 true
```

原因：`tools/verify_app_build.mjs:82` 的扫描范围只有 `path.join(ROOT,'apps','desktop','src')`。
⇒ **改了 `packages/engine/src/**` 而后构建失败时，§0b 不会拦**，§1b/§1c 仍然读旧引擎产物给绿。
这正是 §0b 自己声称要防的那个失败模式（`:61-70`），只是范围没覆盖全。
（P2 的 16 条里 S7/S8/S15/S16 都依赖引擎；引擎源码改动后构建失败 ⇒ 这些用例跑的是新代码、
守卫读的是旧产物，两者不一致且无人报警。）

**C. 一个附带的可用性观察（非缺陷，但请知情）**：§0b 是**纯 mtime** 判定 ——
我为了让 §0b 的前置条件重新成立，把 `out/main/*.js` 的 mtime 更新为"现在"（见 §7）。
凡是"改过源码又还原内容"的操作（`edit` 工具、编辑器保存）都会把源码 mtime 顶到最新，
守卫就会一直拒绝直到真的重建一次 —— 这是设计使然，但在**构建不可用的环境里会永久卡死 §0b**。

---

## 3. §0b 的"剥开"结论

问题问的是"§0b 是不是真的能防『构建失败 ⇒ 读旧产物 ⇒ 假绿』"。

- **能防**（R8-A 实测：拒绝 + `EXIT=1` + 提前退出，不吐绿）。
- **但有两个洞**：① 扫描范围不含 `packages/engine/src`（R8-B，实测）；
  ② 只覆盖 `out/main`，`out/preload` / `out/renderer` 的产物**没有新鲜度判定** ——
  我 R3/R4 的两次产物变异都因此畅通无阻（虽然那两次是我主动做的）。
- 报告里描述的原始事故（"注释掉多行 handler 首行 ⇒ 语法不成立 ⇒ build 失败 ⇒ 旧产物被读到 ⇒ 全部通过"）
  在**当前这一版**确实被拦住了；我没有能力复现该事故本身（`npm run build` 在本沙箱不可用，见 §6），
  但我用"只加一个探针文件、不重建"造出了**同一类状态**（源码新于产物），§0b 拦住了。

---

## 4. 声称 vs 事实（重点怀疑的三处 + 我自己找到的）

### 4.1 S4 的"注入计数 fs 证明读取次数 = 0"——**没有注入，是空转**

`docs/spec/SPEC-security.md:314` 原文：

> | S4 | `thumb://../../windows/win.ini` | 400/404，**不产生文件读取** | `npm test` · `permissions.test.mjs`「S4」——**注入计数 fs 证明读取次数 = 0**，并断言该模块不 import `fs` |

实际代码（`apps/desktop/tests/permissions.test.mjs:115-145`）：

```js
  const reads = [];
  const spy = { readFileSync: …, existsSync: …, openSync: … };   // :119-123
  …
  assert.deepEqual(reads, [], `解析阶段发生了文件访问：${JSON.stringify(reads)}`);   // :138
  // 直接证明这模块**不 import fs**…
  assert.doesNotMatch(src, /from\s+['"]node:fs['"]/, …);        // :142
  assert.doesNotMatch(src, /\brequire\(\s*['"]fs['"]/, …);      // :143
  void spy;                                                      // :144  ← 这行说明了一切
```

`spy` **从未被传给任何东西**（`parseThumbUrl(rawUrl)` 只收一个 URL）。
所以 `reads` 恒为空不是"测得的结果"，而是"没有任何东西能往里写"。`void spy;` 是作者留下的自我否认。
剩下的证明力只有两条正则，而它们挡不住 `await import('node:fs')`、`import('node:fs/promises')`、
`createRequire`、`process.binding` 等任何一条真实路径 —— R5 已实测：**模块真的读盘了，S4 仍然全绿**。

**结论**：S4 的断言内容与规范期望**不一致** —— 规范要"不产生文件读取"，用例实际证的是
"这个函数的返回对象是 `ok:false`"（这部分是真的、有效的）+ 一条可绕过的文本检查。
"注入计数 fs"这个描述**与代码不符**。

### 4.2 S9 的渲染进程面：三条断言里两条恒真、一条测的是 mock

`docs/spec/SPEC-security.md:319`：

> `verify_renderer_dom.mjs` §11（**jsdom**：`require`/`module` undefined，`process` 无 `binding`/`dlopen`/`getBuiltinModule` 等能力）

实际（`tools/verify_renderer_dom.mjs:431-462`）：

```js
  ok(typeof window.require === 'undefined', 'S9：window.require 是 undefined（拿不到 CommonJS 加载器）');
  ok(typeof window.module === 'undefined', 'S9：window.module 是 undefined');
  const p = window.process;
  if (!p) {
    ok(true, 'S9：本环境无 window.process（jsdom）—— 无 Node 能力可言');      // :445 恒真
  } else {
    ok(true, `S9：Electron 注入了受限 process（platform=${String(p.platform)}）—— 逐项查危险能力`);  // :447 恒真
    for (const cap of ['binding','dlopen',…]) ok(typeof p[cap] === 'undefined', …);
  }
```

守卫自己的运行输出证明了走的是哪一支：

```text
  [OK  ] S9：本环境无 window.process（jsdom）—— 无 Node 能力可言
```

⇒ **`process.binding` / `dlopen` / `getBuiltinModule` 那几条断言在本环境里一次都没执行**。
文档把它们写成 §11 已经覆盖的内容，属于**声称 > 事实**。
而 `window.require` / `window.module` 是 jsdom 的性质，**不是被产品的 preload/姿态决定的**：
无论产品怎么配，这两条都会绿 ⇒ 恒真。

第三条（暴露面恰好三键）测的是**守卫自己的 mock**（`tools/verify_renderer_dom.mjs:107` 的 `window.api = {`）——
R3 里我把真实 preload 污染成暴露 `ipcRenderer`，§11 依旧 `[OK] api 上没有 ipcRenderer`。

> 📌 关于问题里引用的那一句 `ok(!!p && p.platform === 'win32' ? true : true, …)`：
> **在我复核的这一版里不存在这个字面量**。同类恒真断言的实际形态是上面 `:445` 与 `:447` 的两处 `ok(true, …)`
> （外加两条 jsdom 保证的 `undefined` 判定）。结论相同，但我不把不存在的字符串当作已证事实。

### 4.3 §8.1 承认的 `file://` 前缀放行 —— **现状属实，但"承认"偏轻**

现状（`apps/desktop/src/main/window-security.mjs:15-20`）：

```js
export function isAppUrl(u, devUrl = '') {
  if (!u) return false;
  if (u.startsWith('file://')) return true;                       // 打包/预览态
  if (devUrl && u.startsWith(devUrl)) return true;                // dev 态（electron-vite）
  return false;
}
```

承认（`docs/spec/SPEC-security.md:334`）：

> `isAppUrl` 用 `startsWith('file://')`，因此**任何** `file://` URL 都被放行（含指向别的本地文件）。
> 不是远程内容风险（file:// 下无网络请求、**CSP 仍在**），但比"严格同源"宽。……`window-security.test.mjs` 里**显式断言了这个现状**。

逐点核对：

| 说法 | 我的核对 |
|---|---|
| `startsWith('file://')` 前缀放行任意 file:// URL | ✅ **属实**（`window-security.mjs:17`；`window-security.test.mjs:35-41` 确实显式断言了现状，没有假装收紧） |
| "CSP 仍在" | ❌ **误导**。CSP 只在应用自己的 `out/renderer/index.html` 里以 `<meta http-equiv>` 形式存在（`tools/verify_app_build.mjs:327` 断言的就是这条 meta）；`apps/desktop/src/main/index.mjs` 里**没有** `onHeadersReceived` 之类的响应头 CSP（`docs/spec/SPEC-security.md:400` 自己也写着"**响应头仍未设**"）。一旦主 frame 被导航到**别的**本地 HTML 文件，那份文件的"在"与我们的 CSP 无关 |
| "file:// 下无网络请求" | ⚠️ 只对**我们自己的** index.html 成立。对任意本地 HTML 文件不成立（它可以引远程子资源）。**未实测**，标【判断，非实测】 |
| 影响面 | ⚠️ 文档没写的一条：`webPreferences.preload` 是**按 webContents** 挂的（`apps/desktop/src/main/index.mjs:410`），它对**每一次导航后的文档**都会注入；而 `isTrustedSender` 对来源的判据只有"`frame.url` 以 `file://` 开头"（`window-security.mjs:58`）。⇒ 主窗口一旦被导航到任一本机 HTML 文件，那个文档仍拿到 `window.api`，且它的 `engine:invoke` 会被判定为**可信来源**。触发该导航需要先有脚本执行或用户点击，故**可利用性我未实测**；但"承认"里说的"不是远程内容风险、CSP 仍在"没有覆盖这条 |

**结论**：承认本身**准确的部分**（前缀放行、比严格同源宽、测试显式断言现状）都属实；
但"不是远程内容风险"的**理由**（file:// 无网络请求 + CSP 仍在）对"指向别的本地文件"这一种情况不成立 ——
属于**轻描淡写**。建议把这条改写成"前缀放行 = 任何本地 HTML 都能继承 preload 桥并以可信来源身份调 IPC，
需要『先有脚本执行/用户点击』才能触发；收紧属 P6"，而不是用 CSP 当兜底。

### 4.4 我自己找到的：抽函数引入的**行为变更**被源码注释写成"行为一字未改"

`apps/desktop/src/main/index.mjs:334-337`（注释）与 `:357-361`（代码）：

```js
// ⚠️ 形状解析与尺寸白名单已抽到 `main/thumb-url.mjs`（SPEC-security §8 的 S4–S6）。
// … **行为一字未改**：拒的时候仍然是 400 + `bad shape`（错误的细分只进日志）。   ← :337
…
  const libId = await canonicalLibId(p.rawHost);
  if (!libId) {
    log('thumb 拒绝：库 id 无法还原', p.rawHost);
    return new Response('bad shape', { status: 404 });   // S6：未注册库 → 404   ← :360
  }
```

抽函数前的原代码（`git diff` 可见）：

```js
  if (!libId || !m) {
    log('thumb 拒绝：库 id 无法还原或形状不对', rawHost, url.pathname);
    return new Response('bad shape', { status: 400 });
  }
```

**判定"哪个对"**：

- `docs/spec/SPEC-security.md:85`（§3 表格）：`libId` "必须在**库注册表**里；否则 **404**"；
- `docs/spec/SPEC-security.md:316`（§8 的 S6）：期望 **404**。

⇒ **404 是"改对了"（对齐 §3），不是漂移。** 但：

1. `index.mjs:337` 的注释**与它下面 23 行的代码直接冲突**，也与 `docs/spec/SPEC-security.md:336`
   （复核途中才加上的那一行，承认了这次变更）冲突。一处说"行为一字未改、仍然 400"，两处说"改成 404"。
2. 这次**唯一的行为变更**恰好是**唯一没有任何断言覆盖的行为**（R6 实测：改成 200 全绿）。
3. 文档 `:336` 只提了 404 这一处变更；实际上抽函数还顺带**改了另一处行为**：
   旧代码用 `decodeURIComponent(url.host)` 且**不捕获**（畸形百分号编码会直接在协议处理器里抛），
   新代码 `thumb-url.mjs:44-48` 捕获后返回 400。这是**加固**（好），但"如实记录"里没写。
   （另：旧代码先解析 libId、后校验形状 ⇒ 畸形 URL 会白打一次 `indexStatus`；新代码先校验形状 —— 也是加固。）

### 4.5 我自己找到的：`createLibIdResolver` 把"空库列表"永久缓存 —— 与新注释、新用例标题都不符

`apps/desktop/src/main/thumb-url.mjs:88-98`：

```js
export function createLibIdResolver({ listLibIds, log = () => {} }) {
  const cache = new Map();
  let filled = false;
  return async function resolve(host) {
    if (!filled) {
      for (const id of (await listLibIds()) || []) cache.set(String(id).toLowerCase(), String(id));
      filled = true;                       // ← 列表为空也把 filled 置真 ⇒ 空映射被永久缓存
      log('thumb 库 id 映射', …);
    }
    return cache.get(String(host || '').toLowerCase()) || '';
  };
}
```

抽象前的旧代码用的是 `if (LIB_ID_CANON.size === 0) { …填… }` —— **列表为空时 size 仍为 0，下次会重查**。

我的实测：

```text
$ node data/_review_probe_resolver.mjs
第 1 次 resolve("l1") = ""
第 2 次 resolve("l1") = ""   ← 库里此时已有 L1
listLibIds 调用次数 = 1 （1 = 空映射被永久缓存）
```

而 `apps/desktop/src/main/index.mjs:344` 的新注释写着：

```js
/** 索引未就绪时不缓存 —— 否则第一次调用会把"空映射"永久缓存住，缩略图全废 */
async function canonicalLibId(host) {
  if (!engine) return '';
  return resolveLibId(host);
}
```

`if (!engine)` 只挡住"引擎还没建"这一种；**引擎在、但 `indexStatus` 返回 0 个库（或失败）时，空映射照样被永久缓存**
（`listRegisteredLibIds` 里 `st.ok` 为假同样返回 `[]`，`index.mjs:338-342`）。这就是注释所描述的症状本身。

对应的用例 `apps/desktop/tests/permissions.test.mjs:184-194` 标题是
「S6b：libId 还原器缓存映射，但**不缓存"索引未就绪"**」，而它的断言只有三条：
`resolve('l1')==='L1'`、`resolve('L1')==='L1'`、`calls===1`（**证明缓存生效**）与 `resolve('l9')===''`。
**没有任何一条断言覆盖"列表为空"**。⇒ **用例标题声称的性质，实现里是错的，用例里没测。**
（`docs/spec/SPEC-security.md:316` 引用的正是这条 S6b。）

> 严重度：不是安全漏洞，是**活性缺陷**（缩略图可能永久 404 直到重启）。但它出现在本次新增的"防伪绿"注释旁边，
> 且被一条同名用例"覆盖"着 —— 属于"声称 vs 事实"的典型。

### 4.6 文档一致性的两处（同一件事两处说法）

1. `docs/spec/SPEC-security.md:262-264` 仍写着"**应用侧的自动化测试仍很薄**：`vitest` 装了但一行用例都没有 …… D2
   之后新增了 `library-config.test.mjs`（12 条）…… **不等于应用侧有测试覆盖**" ——
   与同一个文件 `:276`/`:292` 的"16 条已全部补上自动化（桌面测试新增两个文件、22 条）"**自相矛盾**。
   （桌面侧现在是 **38 条**：library-config 12 + ports 4 + permissions 12 + window-security 10。）
2. 仓库里另有 **5 处**仍然写着"16 条零自动化 / 未做"，与本次结论相反：
   `docs/plan/ROADMAP.md:31`（"16 条权限用例无自动化"）、`:201`（"没有任何自动化实现"）、
   `:202`（"**权限测试用例全过** ❌ **未做**"）、`:342`（"P2 的**权限用例未过**"）、
   `:361`（"⚠️ 16 条用例**尚无自动化实现**"）、`docs/DEBT-CLEANUP.md:432`（"🔴 实际存在 0 条 … **无任何测试**"）。
   按 `AGENTS.md` §4「同一件事只有一个出处：发现两处不一致，改错的那处」，这些是**本次改动欠的账**
   （方向与 §8 的过度声称相反，但同样是"声称 vs 事实"）。

---

## 5. 主动反驳（rebuttals）

1. **S4 的"证明"是同义反复 + 死代码**（R5 + §4.1）。`reads === []` 断言的是"我没有往这个数组里写过"，
   而不是"没有发生文件读取"。⚖️ 这是本次复核里**最强的一条**：它精确命中了"断言了实现细节而非规范要求"的定义。

2. **S9 的渲染面是"因为 X 所以 X"**（R3 + §4.2）。三条断言里：两条是 jsdom 的性质（与产品无关），
   一条在被污染的产品上依然 OK（因为它测的是守卫自己的 mock）。文档却把它列为 S9 的"两面"之一。

3. **§12 的 `window.__XSS_EXECUTED` 是一条永不失败的断言**（R4）。在真正发生 HTML 注入的情况下它仍然
   打印 `[OK] ⭐`。它被写成"③ 全局自证"（`docs/spec/SPEC-security.md:320`），实际鉴别力为零。
   —— 这与你怀疑的那类"恒真断言不该出现在锁权限姿态的守卫里"是同一件事，只是形态不同。

4. **§1c 的接线断言没有用 §1b 自己的纪律**（R7）。同一个文件在 §1b 里反复强调"不是全文找子串""必须取调用点的实参"
   （`tools/verify_app_build.mjs:198-201`、`:242-243`），§1c 却回到裸正则 `/isTrustedSender\s*\(/`
   （`:269`）与 `/BAD_REQUEST/`（`:272`）。一个 `false &&` 就让"来源校验真的在调用路径上"这句话不成立。

5. **"抽出来的函数测了"不等于"调用点传对了"** —— 这一条我**没找到缺陷**，如实记录：
   `index.mjs:197-200` 是 `isTrustedSenderImpl(event, w, DEV_RENDERER_URL)`，
   `window-security.mjs:51` 的签名是 `(event, win, devUrl = '')` ⇒ **参数顺序正确**；
   `index.mjs:427` 是 `decideNavigation(url, DEV_RENDERER_URL)`，签名 `(url, devUrl)` ⇒ **正确**；
   `decideWindowOpen()`（`:425`）不吃参数，刻意忽略 ⇒ **正确**。
   （这条我按"主动反驳"的意图去查了，结论是没问题。）

6. **覆盖不到的路径**（除上面 4 条外，另有两条**没有任何断言、也没被 §8.1 记账**的）：
   - `apps/desktop/src/main/index.mjs:365` 的 `if (!engine) return new Response('engine not ready', { status: 503 })`
     在抽取 `thumb-url.mjs` 之后**已经不可达**（`:345-348` 的 `canonicalLibId` 在 `!engine` 时先返回 `''`，
     `:358` 就 404 走了）。死代码，且无人断言。（抽象前也不可达，属**既有**死代码，非本次引入。）
   - `docs/spec/SPEC-security.md:113`（§4）要求"**窗口数：只允许一个主窗口**"，
     16 条里没有对应用例，§8.1 也没有把它列入"未覆盖"。`index.mjs` 里也没有 `app.on('browser-window-created')` 之类的兜底
     —— 这条**我标为未覆盖但未列入文档**。（未做深度验证，标【判断，非实测】。）

7. **"结构断言 ≠ 端到端"这条自我声明，方向是对的，但不止"不证明实际效果"**：
   §8.1（`docs/spec/SPEC-security.md:332`）说的是"证明注册语句存在、不证明真窗口里的实际效果"。
   我的 R7 表明**更强的结论**：它连"注册的那个判定是否在生效路径上"都不证明。
   建议把该行改成"§1c 只断言 token 存在，`false &&` 级别的禁用无法被发现"。

---

## 6. limits（**没能验证的，如实标"未验证"**）

1. **`npm run build` 未验证 —— 我跑不了，也没有跑通。** 原始输出：

   ```text
   $ npm run build
   > electron-vite build
   failed to load config from D:\USERS\Desktop\Agent\gemma-search\electron.vite.config.mjs
   error during build:
   Error: spawn EPERM
       at ChildProcess.spawn (node:internal/child_process:421:11)
       at ensureServiceIsRunning (node_modules\esbuild\lib\main.js:1978:29)
       at bundleConfigFile (node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:1710:26)
   EXIT=1
   ```

   ⇒ **"构建这一步"没有被本报告验证过**。`out/` 是**既有产物**，我只验证了"读这些产物的守卫会怎么表现"，
   **不得**据此声称"构建通过/产物形状正确"。
2. **因此，所有"产物级"变异都是直接施加在 `out/` 文件上的，不是"改源码 → 重建 → 看产物"**。
   ⇒ 我**不能**证明"某处源码改动经过真实构建后，产物会变成我以为的样子"。
   （R1/R2 是源码级变异，`node:test` 直接加载源码，不受此限。）
3. **真 Electron 窗口内的行为未实测**（与 `docs/spec/SPEC-security.md:333` 一致）：
   `window.open` 是否真被 deny、iframe 内 invoke 是否真被拒、`process` 到底暴露了哪些字段 —— **均未验证**。
4. **文件符号链接一条 `skipped`**（环境 `EPERM`），未验证；与文档 `:335` 的记账一致。
5. **报告声称的"已实测双向验证"（S1/S2/S4b/S5/S11/S12/S13）我没有逐条复跑** ——
   我复跑的是 S3/S14（源码级）与 S4/S6/S9/S10/S13-接线（产物级）。
   因此"那 7 条到底有没有被真的反向验证过"**未验证**。
6. **S7/S8/S15/S16 的"经 `item`/`thumb` 方法"这半截未验证**：现有断言都在 `resolveInLibrary` / `resolveByUid` /
   `assertCollectDirAllowed` 这一层，**没有一条**走 IPC `item` 方法或 `thumb://` 处理器。
   （`docs/DEBT-CLEANUP.md:432` 当时就指出了这一点，新的 §8 表格把它们简写成"**已有**"，这层限定丢了。）
7. **`packages/engine/src/` 改动 + 构建失败 ⇒ §0b 不拦**（R8-B 已实测；但"真实构建失败时产物会怎样"未验证）。
8. **产物 mtime 被我改过（见 §7.2）**，因此"§0b 在我复核结束后仍会绿"这件事依赖我这次 mtime 更新，
   不是原状。
9. **`npm test` 112 条里依赖本机素材库的那几条**（指纹一致性、uid 唯一性）用的是本机 `data/`，
   在干净克隆上会跳过；我**未**验证干净克隆下的条数。

---

## 7. 我的操作痕迹与还原证据

### 7.1 被临时变异的文件（全部已还原）

| 文件 | 基线 sha256（前 16 位） | 还原后 sha256（前 16 位） | 还原证据 |
|---|---|---|---|
| `apps/desktop/src/shared/ipc.mjs` | `adf9436fdcc4dd84` | `adf9436fdcc4dd84` | `git diff --stat` 空（与 HEAD 一致） |
| `out/preload/index.cjs` | `70e0be6e54223181` | `70e0be6e54223181` | 822 字节，逐字节一致 |
| `out/main/index.js` | `6d883f961ba52449` | `6d883f961ba52449` | 63977 字节，逐字节一致 |
| `out/renderer/assets/index-NAMB84Cs.js` | `d321cb0cf648a69e` | `d321cb0cf648a69e` | 686348 字节，逐字节一致 |
| `apps/desktop/src/main/thumb-url.mjs`（未跟踪） | `3e07447dd2dc57bf` | `3e07447dd2dc57bf` | 从 `data/_review_backup_thumb-url.mjs` 整文件覆盖回 |

`out/` 不进 git（`.gitignore`），所以 `git status` 看不见它们的差异 —— 我用 **sha256 逐字节对齐** 作为还原证据。

### 7.2 我改过的 mtime（**必须知情**）

复核过程中我修改并还原了 `apps/desktop/src/shared/ipc.mjs`（R1/R2），`edit` 工具会让它的 mtime 变成"现在"，
于是 `verify_app_build.mjs` §0b 开始拒绝（**这本身就是 §0b 生效的证据**）：

```text
  [FAIL] out/main 比 apps/desktop/src 新（产物是刚构建的）  — 产物比源码旧 142s：源码 apps\desktop\src\shared\ipc.mjs ⇒ 重新跑 npm run build（它很可能失败了）
EXIT=1
```

为了让后续的产物级实验（R3/R4/R6/R7）能在 §0b 通过的前提下进行，我把 **`out/main/*.js` 的 mtime 更新为"现在"**：

```text
out\main\index.js                     2026-10-12T08:26:05Z  →  2026-10-12T08:29:19Z
out\main\chunks\bmp_decode-CrjD8y7P.js 2026-10-12T08:26:05Z → 2026-10-12T08:29:19Z
out\main\chunks\encoder-DqZ6ggTh.js    2026-10-12T08:26:05Z → 2026-10-12T08:29:19Z
```

**内容一字未改**（三次变异的还原都用 sha256 对齐验证过），于是"产物是当前源码的产物"这句话在事实上成立；
但**它的 mtime 现在是我写的，不是构建器写的**。我没有伪造任何**源码**的时间戳。

### 7.3 临时文件（`data/_*`，已列入 `.gitignore`；复核结束前删除）

`data/_review_backup_thumb-url.mjs` · `data/_review_mutate_404.mjs` · `data/_review_mutate_404_restore.mjs` ·
`data/_review_mutate_innerhtml.mjs` · `data/_review_mutate_innerhtml_restore.mjs` · `data/_review_mutate_preload.mjs` ·
`data/_review_mutate_preload_restore.mjs` · `data/_review_mutate_thumbfs.mjs` · `data/_review_mutate_trusted.mjs` ·
`data/_review_mutate_trusted_restore.mjs` · `data/_review_probe_cardtitle.mjs` · `data/_review_probe_resolver.mjs` ·
`data/_review_probe_s4status.mjs` · `data/_review_probe_trusted.mjs`

### 7.4 复核结束时的全仓状态

```text
$ git status --short
 M apps/desktop/src/main/index.mjs
 M docs/spec/SPEC-security.md
 M tools/verify_app_build.mjs
 M tools/verify_renderer_dom.mjs
?? apps/desktop/src/main/thumb-url.mjs
?? apps/desktop/src/main/window-security.mjs
?? apps/desktop/tests/permissions.test.mjs
?? apps/desktop/tests/window-security.test.mjs
?? docs/audit/REVIEW-PERMISSIONS.md      ← 本报告（唯一新增）
```

（与复核开始时的 `git status --short` 逐行一致，只多了本报告。）

其余守卫的独立复跑：

```text
$ node tools/verify_renderer_styles.mjs
渲染层令牌纪律通过（无死颜色 · 无内联视觉值 · 无悬空变量）。另有 1 条阶梯外 px 提示（不判失败）。  EXIT=0
$ node tools/verify-doc-refs.mjs
**未通过**：死引用 6 · 根目录越界 0   EXIT=1
  死引用 6 处：REVIEW-UIUX-AUDIT.md:432→materials.md · uiux-evidence.md:624/625→color.md ·
              626→materials.md · 627→typography.md · 627→…/typography.md
```

⇒ 这 6 条与 `AGENTS.md` §6 记录的**两类已知误报**（外部 URL 末段 5 条 + 散文里裸写的文档名 1 条）**完全一致**，
本次改动**没有**引入新的死引用，根目录越界 0。

---

## 8. 给作者的处置建议（按优先级）

1. **S6**：在 `tools/verify_app_build.mjs` §1c 加一条"未注册库 ⇒ 404"的产物断言（或给 `handleThumb` 抽一个可测的
   状态码决策函数并单测），否则 §8 那一栏的 404 是叙述不是证据。
2. **S4**：要么**真的**把 fs 计数器接进去（给 `parseThumbUrl` 注入 fs 端口），要么把 `docs/spec/SPEC-security.md:314`
   的"注入计数 fs 证明读取次数 = 0"删掉，改成实际证明的东西（形状拒绝 + 两条正则）。
   同时 `permissions.test.mjs:144` 的 `void spy;` 是"这条断言是空的"的自白，应当清除。
3. **S13/S11/S12 接线**：把 §1c 的裸正则换成 §1b 的 `callArgsOf` 纪律（在 handler 实参内找**未被短路**的调用形，
   例如断言实参里同时出现 `isTrustedSender(` 且其前面**不是** `false &&`/`!` 之外的短路上下文），
   或把 handler 主体抽成纯函数后单测 `(trusted?, {method,params}) => 信封`。
4. **S9**：§11 请删掉两条 jsdom 恒真断言与两处 `ok(true, …)`；要断言 `process` 能力就必须在**真的**注入了
   `process` 的环境里跑（否则如实写"本环境不适用，未验证"）。暴露面那一面请只保留 §2b（产物面）。
5. **S10**：删掉 `window.__XSS_EXECUTED` 那条（或换成可靠的执行探测），否则它是"永远绿"的点缀。
6. **§0b**：扫描范围加上 `packages/engine/src`（引擎代码确实在 `out/main` 里）；
   并考虑对 `out/preload` / `out/renderer` 加同样的新鲜度判定。
7. **文档**：修 `index.mjs:337` 那句"行为一字未改"；修 `docs/spec/SPEC-security.md:255`（90 → 112 / 74+38）与
   `:262-264`；同步 `docs/plan/ROADMAP.md:31/201/202/342/361` 与 `docs/DEBT-CLEANUP.md:432`；
   修 `thumb-url.mjs:88-98` 的空列表缓存（或让 S6b 真的断言这件事）；
   把 `:319` 关于 §11 的描述改成实际覆盖范围。
8. **`docs/spec/SPEC-security.md:334`**：把"不是远程内容风险（file:// 下无网络请求、CSP 仍在）"改写成
   §4.3 里那段更准确的表述。

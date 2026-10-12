# 独立复核：B-1 / B-2 / R-1 / R-3 的修复本身

> **复核者**：独立复核 Agent（**未参与**本轮任何一处实现）
> **时间**：2026-10-12 · 工作目录 `D:\USERS\Desktop\Agent\gemma-search` · Node v24.14.0 / Windows / PowerShell
> **被复核的上游**：`docs/audit/REVIEW-F01-F02.md` 给出的 `pass-with-issues` 及其中 4 条问题
> **唯一写入的文件**：本文件。被验证文件全程只读，例外是**明确要求的临时变异**，已全部还原（见 §附）

---

## verdict

**`pass-with-issues`**

四项修复**方向都对，且各自被点名的那条回归都真的被锁住了**（4 组反向测试全部由绿转红，见 §checks）。
但 B-1 新增的守卫**比它自称的弱**：我**实测出两条可复现的假绿**（注释掉的接线 + 死代码里的同样文本，守卫仍报 `[OK]` / EXIT=0），
根因是它自写的 `stripComments` **不认识正则字面量**。另有 4 处次要缺口（正例锚空转、`.js` 不在扫描范围、阈值正则可被 `.97` 绕过、R-3 的 `bandOf` 对 `Object.prototype` 继承键会**编造档位**）。

这些都**不是**"修复无效"，而是"修复的**边界**比声称的窄"。故不判 `fail`，也不放过。

---

## blockers

`[]`（空）

**为什么空**（这是判断，不是实测）：四项修复**各自被点名的那条回归**都通过了真·反向验证——

| 回归 | 反向手段 | 结果 |
|---|---|---|
| B-1 接线被注释掉 | `out/main/index.js:1265` 改成 `// shell: createRevealPort(shell),` | **EXIT=1** ✅ |
| B-2 阈值回到渲染层 | `ui/Score.jsx` 放回 `s>=0.97/0.93` | **EXIT=1** ✅ |
| B-2 正例锚是否空转 | `Score.jsx` 完全不用 `band` | **EXIT=1** ✅（锚是实的） |
| R-1 成功文案过度声称 | 改回「已在资源管理器中定位」 | **EXIT=1** ✅ |

⇒ 上一轮指出的 4 条问题**在"会不会再犯同一个错"这个意义上确实被修好了**，不存在"声称修好但其实没修"的阻塞项。
**但**如果项目要的是"守卫**不可绕过**"（而不仅是"覆盖今天这一个写法"），则 §rebuttals R-1/R-2 那两条必须修 —— 我把它们记为 issue 而非 blocker，理由写在每一条里。

---

## issues（按严重度降序）

| # | 严重度 | 问题 | 证据 |
|---|---|---|---|
| I-1 | **高** | `stripComments` 不识别正则字面量：一个含引号的正则（如 `/["']/g`）会让它误入"字符串模式"，把**其后所有文本原样保留**，于是**被注释掉的接线重新变得可匹配** ⇒ 假绿 | §rebuttals R-1（含 bundle 级实证） |
| I-2 | **高** | §1b 是**纯文本**断言：把真接线删掉、只在**永不调用的函数**里留一份同样文本，守卫仍 `[OK]` ⇒ 假绿 | §rebuttals R-2 |
| I-3 | 中 | `verify_app_build.mjs:120` 的"剥注释锚"是**恒真式**：`EXPERIMENT-OFF` 只存在于守卫自己的源码里，源码与产物都没有 ⇒ 这一行**永远不可能失败**，不是声称的"验证剥离是真的" | §checks B-1-3b |
| I-4 | 中 | `verify_renderer_styles.mjs` §5 只扫 `.jsx`/`.css`（`:58-59`），**不扫 `.js`**；渲染层有 5 个 `.js`（含 `hooks/useSearch.js`、`hooks/useEngine.js`）。把阈值写进 `.js` ⇒ 守卫 EXIT=0 | §rebuttals R-4 |
| I-5 | 中 | `bandOf` 用真值判断（`if (!b)`）而非 `Object.hasOwn`：`bandOf(0.85,'toString')` / `'constructor'` / `'valueOf'` / `'__proto__'` 返回 **`'low'`** —— 又替不认识的模态编了个档位，与 R-3 要修的根因同类 | §checks R-3-11b |
| I-6 | 低 | §5 的阈值正则 `\b0\.[789]\d*\b`：真阈值 `0.97/0.93/0.9` 能抓，但 **`.97`（省略前导 0，JS 里很常见）/ `95/100` / `97e-2` 全部放行**；同时 `opacity: 0.8` 会被误报 | §rebuttals R-3 |
| I-7 | 低 | `verify_renderer_dom.mjs:367` 的 `/已请求|定位/` 太弱：`已在资源管理器中定位` 也含「定位」⇒ 该行在**过度声称的文案**上照样通过（真正拦住它的是 `:365`） | §checks R-1-10 |
| I-8 | 低 | §5 报违规时用 `line.match()`（首个匹配）⇒ 同一行的 `0.97` 与 `0.93` 只报 1 处（实测"发现 1 处"），计数偏小 | §checks B-2-6 |

---

## checks（13 项逐项）

> 约定：**达标 = 声称的行为被我复现**；**未验证 = 我跑不了，如实标注，不伪造**。
> ⚠️ 贯穿全篇的环境事实：**`npm run build` 在本沙箱以 `spawn EPERM` 失败**（见 §limits L-1）。
> 因此凡"必须重新 build"的步骤，我改用**产物级等价变异**，保真性论证见 §limits L-2。

### B-1

#### ① B-1-1 正常态 `verify_app_build.mjs` → EXIT=0　**达标**

```powershell
node tools/verify_app_build.mjs
```

§1b 原始输出：

```
--- 1b) 引擎能力端口已注入（F-01 接线）---
  [OK  ] 剥注释生效（产物里确实有注释被剥掉）  — 原 57993 → 剥后 56120
  [OK  ] 剥注释能去掉「被注释掉的代码」（防"注释掉就算接上"）
  [OK  ] main 里有 createEngine( 调用
  [OK  ] createEngine 收到 shell 端口（shell: createRevealPort(...)）—— 否则 reveal 会返回 PORT_MISSING
  [OK  ] 端口构造函数 createRevealPort 在产物里（未被摇掉）
  [OK  ] main 仍导入 electron（shell 的来源）
...
全部通过。
=== EXIT=0 ===
```

**⚠️ 但"build 后"这个前提我未能亲自复现**：`npm run build` → `spawn EPERM`（§limits L-1）。
我跑的是**已存在的 `out/`**（`out/main/index.js`，57993 B，mtime 2026/10/12 15:57:06）。
为判断这份产物是否与当前源码一致，做了 6 项交叉探针，**全部命中**：

```
OK  main 含 library-config 的独有串(registryPath)      ← library-config.mjs
OK  main 含 ports.mjs 的 createRevealPort             ← ports.mjs
OK  renderer 含首启向导文案                              ← FirstRunWizard.jsx
OK  renderer 含 LibraryGate 的 libraryConfig 调用       ← LibraryGate.jsx
OK  renderer 含 R-1 新成功文案                           ← useSearch.js:85
OK  renderer 含 Score 的 BAND_TEXT                     ← Score.jsx:21
```

⇒ 产物**就本次被审的 4 项而言**与当前源码一致 ⇒ 下面的结论成立。**但"我亲手 build 过"这件事：未验证。**

#### ② B-1-2 ⭐ 反向：注释掉接线 → 守卫必须 EXIT≠0　**达标（产物级，非重建）**

**未能按原方案"重新 build"**（§limits L-1）。改为在产物上做等价变异：
`out/main/index.js:1265` 的 `    shell: createRevealPort(shell)` → `    // shell: createRevealPort(shell),`

```powershell
node tools/verify_app_build.mjs
```

```
--- 1b) 引擎能力端口已注入（F-01 接线）---
  [OK  ] 剥注释生效（产物里确实有注释被剥掉）  — 原 57997 → 剥后 56090
  [OK  ] 剥注释能去掉「被注释掉的代码」（防"注释掉就算接上"）
  [OK  ] main 里有 createEngine( 调用
  [FAIL] createEngine 收到 shell 端口（shell: createRevealPort(...)）—— 否则 reveal 会返回 PORT_MISSING  — 剥掉注释后仍找不到 `shell:createRevealPort(`：接线掉了、被注释掉了、或改名了
  [OK  ] 端口构造函数 createRevealPort 在产物里（未被摇掉）
失败 1 项：
  · createEngine 收到 shell 端口（shell: createRevealPort(...)）—— 否则 reveal 会返回 PORT_MISSING
=== EXIT=1 ===
```

**保真性**：这不是"手改产物糊弄守卫"，而是对重建结果的**忠实替换**，依据是产物**确实逐字保留源码行注释**：

| 源码 | 产物 |
|---|---|
| `apps/desktop/src/main/index.mjs:150-152`（三行 `//` 注释） | `out/main/index.js:1262-1264`（**逐字相同**） |
| `apps/desktop/src/main/index.mjs:153` `shell: createRevealPort(shell),` | `out/main/index.js:1265` `shell: createRevealPort(shell)` |

⇒ 注释掉源码那一行后重建，产物该处**必然**是 `// shell: createRevealPort(shell),`。这正是我构造的输入。

#### ③ B-1-3 ⭐ 剥注释是否真的在起作用　**达标（`//` 与 `/* */`）；但发现正则陷阱 ⇒ 见 I-1**

我没有重打一份 `stripComments`，而是**从守卫里抽出真源码**再执行（避免"测的是我抄的版本"）：

```js
const guard = fs.readFileSync('tools/verify_app_build.mjs','utf8');
const src = guard.slice(guard.indexOf('const stripComments'),
                        guard.indexOf('\n};', guard.indexOf('const stripComments')) + 3);
const stripComments = new Function(src + '\nreturn stripComments;')();
```

```
已抽取 stripComments 源码长度 = 808 （证明测的是守卫里那一份，不是重打的）
真实 bundle: 原 57993 → 剥后 56120   与守卫报告 57993→56120 一致? true
```

**① 核心：注释掉的接线不再被匹配** — 达标

| 用例 | 剥后 | 含 `shell:createRevealPort(`? | 期望 | 结论 |
|---|---|---|---|---|
| `createEngine({\n  shell: createRevealPort(shell),\n});` | 原样保留 | **true** | true | ✅ |
| `createEngine({\n  // shell: createRevealPort(shell),\n});` | `createEngine({\n  \n});` | **false** | false | ✅ |
| `createEngine({\n  /* shell: createRevealPort(shell), */\n});` | `createEngine({\n  \n});` | **false** | false | ✅ |

**② 不误伤字符串里的 `//`** — 达标

| 用例 | 剥后含真接线? | 期望 | 结论 |
|---|---|---|---|
| `const u='http://x';` + 真接线 | true | true | ✅ |
| ``const u=`a//b`;`` + 真接线 | true | true | ✅ |

**③ ⭐ 正则字面量 —— 陷阱成立 ⇒ I-1（见 §rebuttals R-1）**

```
[⭐ 正则含引号 /["']/g  + 注释掉的接线（假绿？）]  *** 不符预期 ***
  输入   : "const r=/[\"']/g;\ncreateEngine({\n  // shell: createRevealPort(shell),\n});"
  剥后   : "const r=/[\"']/g;\ncreateEngine({\n  // shell: createRevealPort(shell),\n});"
  含 shell:createRevealPort( ? true   期望 false
```

**④ 真实 bundle 的语法体检（查"剥过头"）** — 通过

```powershell
node --check data/_review_tmp/stripped_bundle.mjs
node --check EXIT=0
```

⇒ 当前这份产物上，`stripComments` **没有**把代码剥坏到语法不通。（但它对 `/https?:\/\//` 这类正则确实会删掉行尾代码，见 §rebuttals R-1 ④。）

#### ③b B-1-3b 附带发现：`EXPERIMENT-OFF` 锚是恒真式　**不达标（I-3）**

```powershell
node -e "bundle.includes('EXPERIMENT-OFF') → false ; src.includes('EXPERIMENT-OFF') → false"
```

```
bundle contains EXPERIMENT-OFF : false
source contains EXPERIMENT-OFF : false
```

全仓 `grep EXPERIMENT-OFF` 唯一命中就是守卫自己：

```
tools\verify_app_build.mjs
Line 120: ok(!mainCode.includes('EXPERIMENT-OFF'), '剥注释能去掉「被注释掉的代码」…');
```

守卫 `:119` 的注释写着「拿一个**只在注释里出现**的串验证剥离是真的」，但**源码里根本没有这个串** ⇒ 该断言恒真，**这一行不可能失败**，它并不验证剥离。真正在起作用的只有 `:117` 的 `mainCode.length < main.length`。

#### ④ B-1-4 还原 + 证据　**达标**

见 §附「还原证据」：6 个我临时动过的文件 SHA256 **全部与动手前一致**，`out/` 逐文件与备份 **0 差异**，`git status --short` 条目数 **39 = 会话开始时**，`data/_review_tmp` 已删除。

### B-2

#### ⑤ B-2-5 正常态 `verify_renderer_styles.mjs` → EXIT=0　**达标**

```
--- 5) 渲染层不得自算分数阈值（F-02）---
  [OK  ] 渲染层没有 0.7x/0.8x/0.9x 比值常量（档位只能来自引擎的 band）
  [OK  ] Score.jsx 仍以 band 为档位来源（不是把功能删了来通过上一条）
...
=== EXIT=0 ===
```

（此守卫只读**源码** `apps/desktop/src/renderer/src`，与 `out/` 无关 ⇒ 本项**完全不受 build 限制**，是货真价实的实测。）

#### ⑥ B-2-6 ⭐ 反向：阈值放回 Score.jsx → 必须 EXIT≠0　**达标**

把 `ui/Score.jsx` 的 `({ score, band, size })` 改回 `({ score, size })` 并加回本地阈值：

```js
const s = Number(score)
const band = s >= 0.97 ? 'high' : s >= 0.93 ? 'mid' : 'low'
```

```
--- 5) 渲染层不得自算分数阈值（F-02）---
  [FAIL] 渲染层没有 0.7x/0.8x/0.9x 比值常量（档位只能来自引擎的 band）  — 发现 1 处（若确为透明度，请改用设计令牌）：
      apps\desktop\src\renderer\src\ui\Score.jsx:38  0.97  ← const band = s >= 0.97 ? 'high' : s >= 0.93 ? 'mid' : 'low
  [OK  ] Score.jsx 仍以 band 为档位来源（不是把功能删了来通过上一条）
失败 1 项：
  · 渲染层没有 0.7x/0.8x/0.9x 比值常量（档位只能来自引擎的 band）
=== EXIT=1 ===
```

还原后复跑 → `EXIT=0`，SHA256 回到 `BD0B8C76…`。
⚠️ 注意"发现 **1** 处"：同一行有两个阈值却只报一个（I-8）。

#### ⑦ B-2-7 ⭐ 正例锚是否有效　**达标（锚是实的）**

把 Score.jsx 改成完全不使用 `band`（删掉 `BAND_TEXT` 常量，返回固定 `<span>0</span>`），
**并刻意保留注释里所有 `band` 字样**（`:6/:8/:11/:35`）以检验锚读的是代码还是注释：

```
--- 5) 渲染层不得自算分数阈值（F-02）---
  [FAIL] Score.jsx 仍以 band 为档位来源（不是把功能删了来通过上一条）
=== EXIT=1 ===
```

⇒ ① 锚**不是空的**，删掉 band 用法会红；② 注释里的 `band` 被正确剥离、**没有**让锚假通过 —— 这一条反过来印证了该守卫的 `stripComments`（`:55-57`）对 `//` 与 `/* */` 是有效的。

### R-1

#### ⑧ R-1-8 成功文案不再写「已在资源管理器中定位」　**达标**

`apps/desktop/src/renderer/src/hooks/useSearch.js:78-87`：

- **`:80-84`**（注释，说清了能力边界）：
  「⚠️ 成功文案**不能写成「已在资源管理器中定位」**（F-01 独立复核的 R-1）。`r.ok` 只等价于「文件在盘上 + shell 端口被调用过」—— Electron 的 `shell.showItemInFolder` **返回 void、不报告失败**…」
- **`:85`**（真文案）：
  ```js
  onToast(r.ok ? '已请求在资源管理器中定位（系统未回报结果）' : (r.error && r.error.userMessage) || '定位失败',
          r.ok ? 'info' : 'err')
  ```

全仓 grep：渲染层产物里 `"已在资源管理器中定位"` → **false**，`"已请求在资源管理器中定位"` → **true**。**达标。**

#### ⑨ R-1-9 成功路径确有断言（不只是失败路径）　**达标**

`tools/verify_renderer_dom.mjs:353-367`（在 §9 内，紧接失败路径之后）：

| 行 | 断言 |
|---|---|
| `:364` | `ok(!/不可用\|系统接口/.test(okToast), '成功时不再显示上一轮的失败文案（说明成功路径真的写了反馈）', okToast)` |
| **`:365`** | `ok(!/已在资源管理器中定位/.test(okToast), '⭐ 成功文案**不得**写成「已在资源管理器中定位」（我们并不知道资源管理器做了什么）', okToast)` |
| `:367` | `ok(/已请求\|定位/.test(okToast), '成功文案说清楚"已请求"而不是断言结果', okToast)` |

`:356-357` 的注释解释了"靠文案内容不同来区分上一轮失败文案"这一手法。基线运行显示这三条**真的被执行且通过**：

```
  [OK  ] 成功时不再显示上一轮的失败文案（说明成功路径真的写了反馈）  — 已请求在资源管理器中定位（系统未回报结果）
  [OK  ] ⭐ 成功文案**不得**写成「已在资源管理器中定位」（我们并不知道资源管理器做了什么）  — 已请求在资源管理器中定位（系统未回报结果）
  [OK  ] 成功文案说清楚"已请求"而不是断言结果  — 已请求在资源管理器中定位（系统未回报结果）
```

⇒ 上一轮"成功路径文案全仓无断言"**已修**。

#### ⑩ R-1-10 ⭐ 反向：成功文案改回过度声称 → 必须变红　**达标（产物级，非重建）**

R-1 的断言跑在**渲染层产物**上，所以本项同样撞上 build 限制。改产物里的字符串字面量：

`out/renderer/assets/index-NAMB84Cs.js`（该 bundle **保留源码格式**，字面量可逐字定位）：

```
index = 655519
context = " uid: item.uid, target: item.archive ? \"archive\" : \"image\" });\n    onToast(\n      r.ok ? \"已请求在资源管理器中定位（系统未回报结果）\" : r.error && r.error.userMessage || \"定位失败\",\n      r.ok ? \"info\" : \""
```

替换为 `"已在资源管理器中定位"` 后：

```
  [OK  ] 成功时不再显示上一轮的失败文案（说明成功路径真的写了反馈）  — 已在资源管理器中定位
  [FAIL] ⭐ 成功文案**不得**写成「已在资源管理器中定位」（我们并不知道资源管理器做了什么）  — 已在资源管理器中定位
  [OK  ] 成功文案说清楚"已请求"而不是断言结果  — 已在资源管理器中定位
失败 1 项：
  · ⭐ 成功文案**不得**写成「已在资源管理器中定位」（我们并不知道资源管理器做了什么）
=== EXIT=1 ===
```

⇒ `:365` 是真正起作用的断言。**同时暴露 I-7**：第 3 条 `:367`（`/已请求|定位/`）在**过度声称**的文案下**依然 [OK]** —— 因为「已在资源管理器中定位」也含「定位」。该行提供的保护接近于零。

还原后 → `EXIT=0`，产物 hash 与备份一致。

### R-3

#### ⑪ R-3-11 `bandOf` 六用例　**达标**（另附 11b 反例，见 I-5）

```powershell
node --input-type=module -e "import { bandOf } from './packages/engine/src/engine.mjs'; ..."
```

原始输出：

```
BANDS = {"text":{"high":0.72,"mid":0.65},"image":{"high":0.9,"mid":0.8}}

--- 任务指定的 6 个用例 ---
bandOf(0.85, "vector") = "unknown"
bandOf(0.99, "hybrid") = "unknown"
bandOf(0.85, null) = "unknown"
bandOf(0.85, undefined) = "unknown"
bandOf(0.85, "text") = "high"
bandOf(0.85, "image") = "mid"
```

**6/6 全部符合要求**：不认识的模态 → `'unknown'`；认识的模态照常。**达标。**

##### ⑪b 反例（I-5）：`Object.prototype` 继承键会**编造档位**

```
--- 主动反驳：Object.prototype 继承键 ---
bandOf(0.85, "toString") = "low"    BANDS[m] typeof = function
bandOf(0.85, "constructor") = "low"    BANDS[m] typeof = function
bandOf(0.85, "valueOf") = "low"    BANDS[m] typeof = function
bandOf(0.85, "hasOwnProperty") = "low"    BANDS[m] typeof = function
bandOf(0.85, "__proto__") = "low"    BANDS[m] typeof = object
```

根因：`packages/engine/src/engine.mjs:43-44`

```js
const b = BANDS[mode];
if (!b) return 'unknown';              // 不认识的模态：宁可不说，也不猜
```

`BANDS` 是对象字面量（`:25`），`BANDS['toString']` 从 `Object.prototype` 取到函数 ⇒ **truthy** ⇒ 跳过 `return 'unknown'` ⇒ `score >= b.high`（`b.high` 为 `undefined`）为 false ⇒ 落到 `return 'low'`。
**这正是 R-3 要修的那类错误**（不懂模态却替分数下结论），只是换了入口。修法一行：`if (!Object.hasOwn(BANDS, mode)) return 'unknown';`

**可达性（如实说明，不夸大）**：从应用链路**不可达** —— `apps/desktop/src/shared/ipc.mjs:22` 的 zod 白名单是 `z.enum(['text','image','vector'])`，引擎 `doSearch` 对未知 mode 直接抛 `BAD_REQUEST`（`:195-196`）。所以这是 **exported 引擎函数自身的健壮性缺陷**，不是当前可被用户触发的 bug。
配套测试也没覆盖它：`packages/engine/tests/engine.test.mjs:420` 的用例集是 `['vector','hybrid','',null,undefined]` —— **恰好绕开了全部原型键**。

#### ⑫ R-3-12 `ui/Score.jsx` 对 `'unknown'` 的降级 = 只显示分数　**达标**

`apps/desktop/src/renderer/src/ui/Score.jsx`：

- **`:21`** `const BAND_TEXT = { high: '同款区间', mid: '很接近', low: '较弱' }` —— **没有 `unknown` 这个键**（这是降级能成立的前提）。
- **`:43`** `const known = !!band && Object.prototype.hasOwnProperty.call(BAND_TEXT, band)`
  → `band === 'unknown'` 时 `hasOwnProperty` 为 **false** ⇒ `known = false`。**注意这里用的是 `hasOwnProperty`，正是 `bandOf` 缺的那一手**（I-5 的对照）。
- **`:44`** `const cls = known ? `score ${band}` : 'score'` → 不加档位类。
- **`:45`** `const tail = [known ? BAND_TEXT[band] : '', humanSize(size)].filter(Boolean).join(' · ')` → 档位文案为空串，被 `filter(Boolean)` 去掉。
- **`:47-48`** `<span className={cls} data-band={known ? band : undefined}>{Number(score).toFixed(4)}{tail ? ' · ' + tail : ''}</span>`
  → 最终只剩 `0.8100`（外加包体积，如果有）。

⇒ **「自然只显示分数」成立，且未见任何本地阈值兜底**。**达标。**

补充：渲染层守卫 §10（`tools/verify_renderer_dom.mjs:397-411`）端到端验了这条降级路径，但它传的是 **`{ score: 0.81 }`（band 缺失）**，不是字面量 `'unknown'`：

```
  [OK  ] ⭐ 缺 band 时只显示分数，**不猜档位**（诚实降级）  — 0.8100
  [OK  ] 缺 band 时分数本身仍显示  — 0.8100
```

两条路径在 `:43` 汇合（`known` 都为 false），**行为等价**，故不构成缺口；但"字面量 `'unknown'` 是否被 e2e 覆盖"的答案是**否**（§limits L-5）。

#### ⑬ R-3-13 改动有没有破坏既有调用　**不达标（断言的前提本身为假）**

```powershell
grep -n 'bandOf(' packages/engine/src/*.mjs
```

```
packages/engine/src\engine.mjs
Line 34:  * 原来的写法是 `BANDS[mode] || BANDS.text` …（注释）
Line 42: export function bandOf(score, mode) {
Line 240:           band: bandOf(r.score, mode),
```

⇒ **引擎内部只有一个调用点**：`engine.mjs:240`，传的是 `doSearch` 的 `mode`。

**但「传的 mode 一定是 text/image」是错的。** `mode` 的取值域是 **三值**：

| 出处 | 内容 |
|---|---|
| `packages/engine/src/engine.mjs:164` | `const mode = req.mode \|\| 'text'` |
| `packages/engine/src/engine.mjs:192-194` | `} else if (mode === 'vector') { if (!req.vector) … }` ← **`vector` 是正式分支** |
| `apps/desktop/src/shared/ipc.mjs:22` | `mode: z.enum(['text', 'image', 'vector'])` ← **IPC 白名单放行 `vector`** |
| `tools/check_search.mjs:125` | `engine.search({ mode: 'vector', vector: q.vector, topK: 5 })` ← **真有调用者** |

⇒ `mode:'vector'` 的检索，其**每一条结果** `band` 都是 `'unknown'`（`engine.mjs:240`）。`check_search.mjs` 走的就是这条路径。

**这是缺陷吗？不是 —— 它是契约明文规定的行为**：

| 契约 | 内容 |
|---|---|
| `docs/spec/CONTRACT-engine-v1.md:111` | `{ "mode": "text" \| "image" \| "vector",` ← **`vector` 是契约列出的请求 mode** |
| `:125-126` | `"band": "high" \| "mid" \| "low" \| "unknown", … "unknown" = 模态不在 BANDS 里 ⇒ 引擎**拒绝**定档` |
| `:134-137` | 「引擎只认 `BANDS` 里定义的模态（当前 `text` / `image`）…**界面义务**：收到 `"unknown"` 时**只显示分数**」 |

⇒ **行为合规、且是设计意图**（"mode ≠ modality"：`vector` 是一种**传入方式**，不是一种**分数区间**）。
因此本项结论是：**调用点没有被破坏**，但**"内部调用点传的 mode 一定是 text/image"这个断言是假的** —— 验证清单里这一条的措辞需改为「`vector` 也会到达该调用点，其结果档位按契约降级为 `unknown`，这是预期行为」。

---

## rebuttals（主动反驳）

我**找到 4 处**（超过要求的 2 处），其中 **2 处是可复现的假绿**。全部为实测，无编造。

### R-1 ⭐ `stripComments` 不认识正则字面量 —— 两个方向都错（**I-1**，实测假绿）

`tools/verify_app_build.mjs:87-112` 的 `stripComments` 是一个**字符扫描器**，它认得 `//`、`/* */`、`'`、`"`、`` ` ``，**但不认得正则字面量 `/…/`**。

**方向 A（假绿，严重）**：正则里出现引号 ⇒ 扫描器误入"字符串模式" ⇒ 其后文本被**原样保留**（`:103 out += src[i]`），**注释不再被剥掉**。

实测（用例 + **bundle 级端到端**）：

```
[⭐ 正则含引号 /["']/g  + 注释掉的接线（假绿？）]  *** 不符预期 ***
  输入   : "const r=/[\"']/g;\ncreateEngine({\n  // shell: createRevealPort(shell),\n});"
  剥后   : "const r=/[\"']/g;\ncreateEngine({\n  // shell: createRevealPort(shell),\n});"
  含 shell:createRevealPort( ? true   期望 false
```

把它落到**真实产物**上（注释掉接线 + 在 `createRevealPort` 定义前插一个 `const __probe = /["']/g;`）：

```
mode=comment+payload
  真接线行仍在(未注释)? false
  被注释的接线行存在?  true
  注入的含引号正则存在? true
--- 1b) 引擎能力端口已注入（F-01 接线）---
  [OK  ] createEngine 收到 shell 端口（shell: createRevealPort(...)）—— 否则 reveal 会返回 PORT_MISSING
全部通过。
=== EXIT=0 ===
```

而该产物里 `createRevealPort` 的全部出现（证明接线**确实死了**）：

```
1158: function createRevealPort(shell2) {
1266: // shell: createRevealPort(shell),
```

⇒ **接线已断，守卫报 `[OK]` / EXIT=0。这是可复现的假绿。**

**方向 B（误删代码 ⇒ 假红）**：正则里的 `\/\/` 会被当成行注释起点，**吃掉行尾真代码**。

```
[正则 /https?:\/\//  + 真接线]
  输入   : "const r=/https?:\\/\\//;\ncreateEngine({ shell: createRevealPort(shell) });"
  剥后   : "const r=/https?:\\/\\\ncreateEngine({ shell: createRevealPort(shell) });"
```

注意剥后 `const r=/https?:\/\/` 后面的 `;` **被删掉了** —— 那是**真代码**被删除。本例侥幸仍匹配（真接线在下一行），但若真接线与这种正则同处一行，守卫就会**假红**。

**严重度校准（不夸大）**：我查了**当前** bundle 图里所有正则，**没有一个含引号**：

```
  bundle 含 "/[\"']/" ? false
  bundle 含 "/['\"]/" ? false
  bundle 含 "/\"/" ? false
  bundle 含 "/'/" ? false
```

源码侧也只有 `/^\uFEFF/`、`/^\/([0-9a-f]{12})@(\d+)$/`（`apps/desktop/src/main/index.mjs:361`）、`/^[A-Za-z0-9_-]{1,32}$/`（`library-config.mjs:38`），且 `node --check` 在剥离后的真实 bundle 上 EXIT=0。
⇒ **今天这次的绿是真的，不是撞运气；但守卫对"以后有人加一个 `/["']/`"这种事毫无抵抗力**。而这恰好是本守卫**唯一的职责**。
建议：别再手写词法分析器 —— 用 esbuild（已在 `node_modules`，`:5.1` 的构建链本就依赖它）或任一真 tokenizer 剥注释；最低成本修法是**只剥行注释且要求 `/` 前是行首或非 `=`/`(`/`,`/`:` 的字符**，或直接改成"删掉注释后必须**同时**仍匹配，且注释版本必须**不**匹配"的双向断言。

### R-2 ⭐ §1b 是文本断言，不是语义断言 —— 死代码即可骗过（**I-2**，实测假绿）

`tools/verify_app_build.mjs:123` 只问"`mainCode` 里**有没有**这个子串"。于是：**把真接线整行删掉**，只在**永不调用**的函数里留一份同样文本：

```js
function __deadNeverCalled(shell) { return { shell: createRevealPort(shell) }; }
```

实测：

```
真接线行仍在?           false
死代码里的同样文本在?    true
__deadNeverCalled 被调用过? 1 次（定义 1 次 ⇒ 0 次调用）
--- 1b) 引擎能力端口已注入（F-01 接线）---
  [OK  ] createEngine 收到 shell 端口（shell: createRevealPort(...)）—— 否则 reveal 会返回 PORT_MISSING
全部通过。
=== EXIT=0 ===
```

`buildEngine` 实际收到的参数（`out/main/index.js`，`shell` 项**已消失**）：

```
"eImage(p);\n      }\n    },\n    onEvent: emit,\n    // ⚠️ **必须注入**（F-01）…\n    // 引擎不 import electron…
```

⇒ **又一条可复现的假绿。**

**关于任务里问的"等价但不同形式（例如 `shell: revealPort`）会不会假绿"**：我的实测答案是**相反方向的问题** —— 那种写法会让守卫**假红**而不是假绿：

```js
const revealPort = createRevealPort(shell);   // createRevealPort 仍在 ⇒ :127 通过
... shell: revealPort,                        // 但 :123 的 `shell: createRevealPort(` 不再匹配 ⇒ :124 FAIL
```

即守卫锁的是**语法形状**，不是**能力**。这比"锁定不足"更麻烦：它同时**漏**（死代码、正则）又**误伤**（等价重构）。**结论：算"锁定不足"，且是双向的。**
根治方向：断言"`buildEngine` 的实参对象里存在 `shell` 键且取值来自 `createRevealPort`"这种**语义**性质，靠真解析（AST）而非子串；退一步至少要求该子串出现在 `onEvent:` 与 `});` 之间。

### R-3 `0\.[789]\d*` 的误报与漏报 —— 我的判断：**是缺陷，不是纯粹的设计取舍**

`tools/verify_renderer_styles.mjs:118` `const SCORE_THRESHOLD_RE = /\b0\.[789]\d*\b/`。

实测：

```
判为违规  opacity: 0.8   (合法透明度)          match="0.8"
判为违规  opacity: 0.75  (合法透明度)          match="0.75"
判为违规  threshold 0.97 (真阈值)            match="0.97"
判为违规  threshold 0.93 (真阈值)            match="0.93"
放行      threshold .97  (省略前导0)          match=null
放行      threshold 95/100                match=null
判为违规  threshold 0.9  (真阈值)            match="0.9"
放行      threshold 97e-2                 match=null
放行      padding 0.8rem (非透明度)           match=null
```

**① 误报（`opacity: 0.8`）—— 我认为这是可接受的设计取舍**，理由有三：
(a) 守卫 `:115-116` **自己写明了**这个代价与出路（"提成设计令牌，而不是在这里开白名单"）；
(b) 渲染层**目前**没有任何 0.7–0.99 的比值（守卫绿），代价尚未兑现；
(c) 令牌是唯一出处，这条纪律本身站得住。
**但**它的代价是真实的：任何一次无关的透明度微调都会**挡住构建**，而报错文案要求去改令牌表。

**② 漏报（`.97` / `95/100` / `97e-2`）—— 我认为这是缺陷**，而且是**致命的那一半**：
- `.97` 是 JS 里**极常见**的写法（省前导 0），改一个字符就绕过；
- 该守卫的**全部价值**就在于"把自算阈值变成无法悄悄发生的事"，而 F-02 的原始缺陷恰恰就是 `0.97/0.93` —— 它现在抓的是**历史那个写法**，不是**那件事**；
- 一个能被单字符绕过的守卫，在 `docs/audit/` 里却被记为"**实际执行**"的回归锁定（`AGENTS.md` §7 F-02 行），**这是文档声称 > 代码事实**，按 AGENTS.md §0 的纪律必须点出来。
建议：断言改为"渲染层不得出现**任何**小于 1 的小数比值"，或反向断言"`Score.jsx` 的档位文案只能来自 `BAND_TEXT`，且 `BAND_TEXT` 只被 `band` 索引"，或引入真正的结构检查（禁止 `.jsx` 里出现 `>=` 与浮点字面量的组合）。

### R-4 ⭐ §5 根本没扫 `.js` 文件（**I-4**，实测缺口）

`tools/verify_renderer_styles.mjs:58-59`：

```js
const cssFiles = walk(SRC, ['.css']);
const jsxFiles = walk(SRC, ['.jsx']);
```

§5 的扫描集是 `[...jsxFiles, ...cssFiles]`（`:120`）——**不含 `.js`**。而渲染层 src 下有 5 个 `.js`：

```
apps\desktop\src\renderer\src\hooks\useEngine.js
apps\desktop\src\renderer\src\hooks\useLibraryConfig.js
apps\desktop\src\renderer\src\hooks\useSearch.js
apps\desktop\src\renderer\src\hooks\useToast.js
apps\desktop\src\renderer\src\ui\cx.js
```

实测：把阈值放进一个 `.js` 文件

```js
// apps/desktop/src/renderer/src/ui/__probe_threshold.js
export const band = (s) => (s >= 0.97 ? 'high' : s >= 0.93 ? 'mid' : 'low')
```

```
--- 5) 渲染层不得自算分数阈值（F-02）---
  [OK  ] Score.jsx 仍以 band 为档位来源（不是把功能删了来通过上一条）
styles guard EXIT=0  （0 = 没发现 .js 里的阈值 ⇒ 缺口成立）
```

（探针文件已删除，`Test-Path` → `False`。）
⇒ **"渲染层不得自算分数阈值"这条规则，只覆盖 `.jsx`/`.css`**。把阈值搬进 `hooks/*.js`（最自然的重构方向）就完全逃逸。
（同一缺陷也影响 §1 颜色字面量、§3 悬空变量 —— 它们同样只看 `.jsx`/`.css`。）
**为什么这不是 blocker**：F-02 的原始形态就在 `ui/Score.jsx`（`.jsx`），历史回归被覆盖了。**为什么必须记 issue**：声称的是"渲染层"不得自算，实际是"渲染层的 `.jsx`/`.css`"。

### R-1（R-1 项）新文案本身是否仍过度声称？

**判断：不再过度声称，但"（系统未回报结果）"这个括注是把双刃剑 —— 【判断，非实测】**

- 引擎的 `ok` 只保证：① 文件在盘上（先确认再调端口）② `createRevealPort` 被调用过（`apps/desktop/src/main/ports.mjs:13-17` 明写"`showItemInFolder` **返回 void、不报告失败**，所以这里**没有**'成功了没'这个概念"）。
- 「已请求在资源管理器中定位（系统未回报结果）」逐字对得上这两条：`已请求` = 端口被调用；`系统未回报结果` = 后半条事实。**没有暗示资源管理器一定弹出了窗口。**
- 唯一可挑剔处：用户读到的**主句**仍是"已请求在资源管理器中定位"，括号是补充。若求极致，写成「已请求系统定位该文件（是否弹出窗口无法确认）」更不易被误读。**这是措辞偏好，不是过度声称** —— 我不把它算作发现。

---

## limits（未能验证的，如实标注）

| # | 未验证的事 | 原因 / 我改用了什么 |
|---|---|---|
| L-1 | **`npm run build`——完全未验证** | 本沙箱实测失败，**失败点在加载配置之前**：<br>`failed to load config from electron.vite.config.mjs` / `error during build: Error: spawn EPERM at ensureServiceIsRunning (node_modules/esbuild/lib/main.js:1978:29)` / `=== EXIT=1 ===`<br>根因是 esbuild 用 **piped stdio** 拉起常驻服务进程，受限沙箱不允许。这是**环境限制**，非配置/代码问题。我的权限在会话开始时固定、审批已禁用，**无法提权**，故不重试其它绕法。**AGENTS.md §5.1 记录的正是这条边界。** |
| L-2 | **"注释掉源码那行后重新 build"这一动作本身未验证** | 因 L-1，改为**产物级等价变异**。保真性依据（实测）：产物**逐字保留源码行注释**（`out/main/index.js:1262-1264` == `apps/desktop/src/main/index.mjs:150-152`），且保留字符串字面量（渲染层 bundle 里可逐字定位 `"已请求在资源管理器中定位（系统未回报结果）"`）。⇒ 变异的输入与"重建后应有的产物"一致。**但"esbuild 重建后恰好产生这个字节序列"我没有亲手跑过。** |
| L-3 | **我跑的三条守卫用的是已存在的 `out/`，不是我自己刚 build 的** | 该 `out/` mtime 为 2026/10/12 15:57:06（我开工前 ~30s）。我做了 6 项交叉探针确认它与当前源码在**本次被审的各方面**一致（见 §checks B-1-1）。**注意**：那次失败的 `npm run build` **没有**破坏 `out/`（失败发生在打包前；事后逐文件 SHA256 与备份 0 差异）。 |
| L-4 | **真启动 Electron 出窗 / 打包态 / 冷启动 / 真实 `thumb://` 取图** | 完全未验证，不在本次范围，也**不得**据本报告声称可用（AGENTS.md §7）。 |
| L-5 | **字面量 `band:'unknown'` 的端到端渲染** | 未单独验证。§10（`verify_renderer_dom.mjs:401`）传的是 `{score:0.81}`（band 缺失），不是 `'unknown'`。二者在 `Score.jsx:43` 的 `known` 判定上**汇合为同一取值**（false），故我判断行为等价；但"我亲眼看到 `unknown` 被渲染"这一点**未验证**。 |
| L-6 | **`out/` 与源码之间是否还有本次被审 4 项之外的漂移** | 未验证。我只交叉核对了这 4 项相关的 6 个串。 |
| L-7 | **`verify_encoder_path.mjs` / `smoke_app.mjs` / `check_search.mjs`** | 未运行（前者需 ONNX 模型目录，后两者需真 Electron / 真检索环境）。与本次 4 项无关。 |
| L-8 | **`packages/indexer/`、多库注册表（P5）、打包** | 未触及。 |
| L-9 | `npm test` **已跑**，结果 `tests 90 · pass 89 · fail 0 · skipped 1`（EXIT=0），与 AGENTS.md §5.1 期望一致 | ——（此项**已验证**，列此仅为对照：测试全绿**并不能**证明接线，这正是 B-1 的由来。） |

---

## 附：还原证据

我**临时动过** 6 个文件（其中 3 个只是被读到、未写入，为稳妥也一并核对）。全部逐字节还原：

```powershell
=== 我临时动过的文件 vs 原始 SHA256 ===
一致  tools\verify_renderer_dom.mjs
一致  apps\desktop\src\main\index.mjs
一致  tools\verify_app_build.mjs
一致  apps\desktop\src\renderer\src\hooks\useSearch.js
一致  apps\desktop\src\renderer\src\ui\Score.jsx
一致  tools\verify_renderer_styles.mjs
不一致数 = 0
```

实际写入过的只有 `apps/desktop/src/renderer/src/ui/Score.jsx`（B-2 的两组变异 + 还原）与**产物** `out/`（B-1/R-1 的产物级变异 + 还原）。

**产物还原**（逐文件 SHA256 与动手前的备份比对）：

```
=== 全部产物 vs 基线（逐文件 SHA256）===
产物差异数 = 0

=== 三条守卫复跑 ===
verify_app_build      EXIT=0
verify_renderer_dom   EXIT=0
verify_renderer_styles EXIT=0
```

**工作区状态**（与会话开始时一致，条目数 39；无我遗留的临时文件）：

```
=== git status --short ===
（31 个 M + 8 个 ??，与开工时完全相同；未 commit / 未 push）

=== 临时目录 ===
临时目录已删除，存在? False      # data/_review_tmp
探针已删除，存在?   False      # apps/desktop/src/renderer/src/ui/__probe_threshold.js
```

**未做**：`git commit` / `git push` / 任何对素材库的写入。

---

## 一句话总结

四项修复**各自被点名的那条回归都真的锁住了**（4/4 反向测试由绿转红），R-1 修得最干净（文案 + 断言 + 反例全实）；
但 B-1 的新守卫**比它自称的弱**——我实测出**两条可复现的假绿**（`stripComments` 不认正则字面量；文本断言被死代码满足），
外加一条**恒真的假锚**（`EXPERIMENT-OFF`）、一条**只扫 `.jsx`/`.css`** 的范围缺口、以及 `bandOf` 对 `Object.prototype` 继承键**仍会编造档位**（`'low'`）。
⇒ **`pass-with-issues`**：方向对、命名的那条修好了，但"回归锁定"的强度**被高估了**，上面 8 条 issue 应逐条修。

# docs/audit/REVIEW-PERMISSIONS-R2.md —— 独立复核（第二轮）：`docs/spec/SPEC-security.md` §8 权限用例自动化

- 复核者：独立 Agent（**未参与本批实现**；上一轮的 `docs/audit/REVIEW-PERMISSIONS.md` 也不是我写的，只作为对照读了它的 R5/R6/R7）
- 时间：2026-10-12（Asia/Shanghai）· 工作目录 `D:\USERS\Desktop\Agent\gemma-search` · Node v24.14.0 · npm 11.9.0
- 纪律：被验证文件**只读**；所有临时变异**逐个还原并复核 sha256**（见 §reversals 与 §操作痕迹）；`docs/audit/REVIEW-PERMISSIONS-R2.md` 是本轮我**唯一**写入的文件；未做任何 `git commit` / `push`。

---

## verdict: **fail**

一句话结论：

- **B1**（S4「零文件读取」空转）→ ✅ **真的修好了**：把真实读取接到 `io` 上，S4 立刻变红；还原后复绿。但"零读取"的**证明力仍不完备**（本轮新发现 N-2：一条不经过 `io` 的真实读取可以全绿）。
- **B2**（S6 的 404 零断言）→ ❌ **没修好，原样复现**。抽出的纯函数 `thumbFailureStatus` 有单测了，但**没有任何断言/守卫绑住真正的调用点 `handleThumb`**：我把产物 `out/main/index.js` 里的 `404` 改成 `200`，`npm test`（113/112/0/1）+ `verify_app_build` + `verify_renderer_dom` **依旧全绿**。这正是上一轮 blocker 的原文。
- **B3**（S13 裸子串可被 `false &&` 绕过）→ ⚠️ **只堵住了上报的那一个变异**：`if (false && !isTrustedSender(event))` 现在会让 §1c 变红；但 `if ((0) && !isTrustedSender(event))`（**加一对括号**）或 `false == 1 &&` 依旧全绿 —— 闸门死了、守卫全绿。守卫注释里"已能挡住…短路掉…"属**过度声称**。
- 另外找到 **3 条同类的、能继续拿绿的假断言**（N-1 / N-4 / N-5），其中 **N-1 危害等同 blocker**：`verify_app_build.mjs` §1c 里 S11/S12 那两条"handler 走的是 `decideWindowOpen()` / `decideNavigation()`"是**由函数定义满足的**，把产物里的新窗口策略改成 `allow`、导航拦截改成 `if (false)`，守卫照样 EXIT=0。

---

## 复核对象的版本（一切结论只对这一版成立）

| 文件 | sha256（前 16 位） | 备注 |
|---|---|---|
| `apps/desktop/src/main/thumb-url.mjs` | `d498861ab4086aac` | |
| `apps/desktop/tests/permissions.test.mjs` | `84c123de0db5c801` | |
| `apps/desktop/tests/window-security.test.mjs` | `28b76f121677e7d1` | |
| `apps/desktop/src/main/window-security.mjs` | `ec4a9c9c7e75e13c` | |
| `apps/desktop/src/main/index.mjs` | `234f9bd7bf6533aa` | |
| `tools/verify_app_build.mjs` | **`c172355a9a3956e3`** | ⚠️ 见下 |
| `tools/verify_renderer_dom.mjs` | `0f420501f9c5245a` | |
| `out/main/index.js` | `9ce9810f19266e9c` | 产物（未重建） |
| `out/preload/index.cjs` | `70e0be6e54223181` | 产物（未重建） |
| `docs/spec/SPEC-security.md` | `3ca93e20aa2c42e2` | |

> ⚠️ **审查期间发生了一次并发改动，必须知情**：`tools/verify_app_build.mjs` 在我**读完它之后**被改过。
> 我 16:52:4x 用 `read` 拿到的是 **391 行版**（当时 sha256 `591504be9fdb40f0…`），16:53:08 它变成 **401 行版**（`c172355a9a3956e3…`，改动集中在 §2b：删掉了 `for (const banned of ['require','process',…])` 那个循环、换成 `nodeUses`/`illegal`）。
> **本报告的全部结论只对应 `c172355a…`。** 请在下一次复核前先冻结树（或至少标明版本），否则"复核结论"会指着一个已经不存在的文件。
> 除它之外，其余被验证文件的 sha256 自始至终一致（见 §操作痕迹）。

---

## 0. 基线（复核开始时的原始输出，与任务书给的基线一致）

```text
$ npm test
ℹ tests 113   ℹ pass 112   ℹ fail 0   ℹ skipped 1        EXIT=0

$ node tools/verify_app_build.mjs      → 全部通过          EXIT=0
$ node tools/verify_renderer_dom.mjs   → React 渲染层逻辑全过  EXIT=0
$ node tools/verify_renderer_styles.mjs→ 渲染层令牌纪律通过    EXIT=0
$ node tools/verify-doc-refs.mjs       → 死引用 6 · 根目录越界 0   EXIT=1   （6 条均为任务书列明的已知误报）
```

---

## blockers（**逐条回答 B1 / B2 / B3**）

### B1 · S4「注入计数 fs 证明零文件读取」—— ✅ **已修**（断言真的接线了）

声称的修法：`parseThumbUrl(rawUrl, io = null)` 依赖注入（`apps/desktop/src/main/thumb-url.mjs:42`、`:44` 的 `void io;`），测试把计数 io 传进去（`apps/desktop/tests/permissions.test.mjs:122-128`、`:139`），断言 `assert.deepEqual(reads, [])`（`:145`）。

**我自己的手法（与上一轮 R5 的 `await import` 手法不同）**：在解析路径里加一次**经过 `io`** 的真实文件系统访问（单行插入，括号结构不动）：

```text
变异（单行、语法合法）：
  void io;   →   void io; if (io && io.existsSync) io.existsSync("/etc/passwd");

$ node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
✖ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明）
  AssertionError [ERR_ASSERTION]: 解析阶段发生了文件访问：[["existsSync","/etc/passwd"], …×7]
ℹ tests 13 · pass 12 · fail 1                                   EXIT_TEST=1
```

还原后：

```text
RESTORED_HASH=d498861ab4086aac  MATCH_ORIGINAL=True
✔ S4 … / ✔ S4b … / ✔ S4c …      ℹ tests 13 · pass 13 · fail 0    EXIT_TEST=0
```

⇒ **这条断言不再是恒真的**：读取一旦发生（且走的是注入的 io），它必然变红。**B1 的病因（spy 从未接线、末尾只有 `void io;`）已消除。**
（附带记录：traversal 的状态码断言从 `400 || 404` 收紧成精确 `400`，见 `permissions.test.mjs:143` —— 我实测 7 个穿越输入在 `parseThumbUrl` 层确实全是 400，收紧是对的。）

**但它的证明力仍不完备 —— 见 new_issue N-2。**

### B2 · S6 期望的 404 —— ❌ **未修，原样复现（这是本轮最严重的一条）**

声称的修法：新增纯函数 `thumbFailureStatus(shapeStatus, libId)`（`thumb-url.mjs:87-89`，库无法还原 ⇒ 404），`handleThumb` 用它（`apps/desktop/src/main/index.mjs:356`），并新增单测 `permissions.test.mjs:152-167`。文件注释 `thumb-url.mjs:80` 写着"**把 404 改成 200 会直接让测试变红**"。

**双向验证 1（源码层，函数本体）**：

```text
变异：  return libId ? shapeStatus : 404;   →   return libId ? shapeStatus : 200;
✖ S6：失败状态码映射 —— 形状/尺寸错 ⇒ 400；库无法还原 ⇒ 404（可执行契约）
  AssertionError: 库无法还原 ⇒ 404（§3：libId 不在注册表 ⇒ 404）   expected: 404
ℹ tests 13 · pass 12 · fail 1                                  EXIT_TEST=1
还原：RESTORED_HASH=d498861ab4086aac  MATCH_ORIGINAL=True
```

**双向验证 2（产物层，真实调用点 —— 这才是 B2 的原文）**：

```text
变异：out/main/index.js  return libId ? shapeStatus : 404;  →  … : 200;
      （单行、值改动，未动任何括号；out/ 的变异按任务书允许，已还原）
检查：out/main/index.js 9ce9810f19266e9c → e85e2430a2479f5e → 还原 9ce9810f19266e9c ✔

$ npm test                          → ℹ tests 113 · pass 112 · fail 0 · skipped 1   EXIT=0
$ node tools/verify_app_build.mjs   → 全部通过                                       EXIT=0
$ node tools/verify_renderer_dom.mjs→ React 渲染层逻辑全过                            EXIT=0
```

⇒ **上一轮 blocker B2 的判定条件一字不差地成立**：产物里"未注册库 ⇒ 404"被改成 200，全仓门禁无一处报警。

**结构性原因（不是"再补一条测试"就完了）**：

```text
$ node -e "…统计各文件里 thumbFailureStatus / handleThumb 的出现次数…"
tools/verify_app_build.mjs          -> thumbFailureStatus: 0 | handleThumb: 0
tools/verify_renderer_dom.mjs       -> thumbFailureStatus: 0 | handleThumb: 0
apps/desktop/tests/permissions.test.mjs -> thumbFailureStatus: 6 | handleThumb: 1   ← 那 1 次是注释（:155）
```

即：**没有任何地方读 `handleThumb` 的返回值**。抽函数把"映射规则"变成了可测对象，但**规则与被测对象之间没有断言**——判断"接线/调用点有没有按规则来"的仍然只有 `read` 源码的人眼。修法方向：要么让 `handleThumb` 可注入（把 `new Response` 的构造抽成可单测的纯函数并**在测试里调用它**），要么在 `verify_app_build.mjs` 里对产物断言"thumb 拒绝分支返回 404 而不是别的数字"。

**附带发现（同一处代码的第二个问题，见 new_issue N-6）**：`thumbFailureStatus` 的 `400` 分支在**唯一的调用点永远走不到**，所以 `docs/spec/SPEC-security.md:320`（S5 行）写的"400"在产品里实际是 **404**。

### B2c · `createLibIdResolver` 不缓存"空列表" —— ✅ **已修**（断言盯的是调用次数，真的会响）

声称的修法：只在 `ids.length > 0` 时填缓存（`thumb-url.mjs:127-134`），断言盯调用次数 `seq` 1→2（`permissions.test.mjs:227-236`）。

```text
N1（等价变异，验证注释里那句"改成 if (true) 也照样全绿"是否属实）：
  if (ids.length > 0) {  →  if (true) {
  ✔ S6b …   ℹ tests 13 · pass 13 · fail 0    EXIT_TEST=0    ← 属实：这是语义等价变异(no-op)，不该红
  RESTORED_MATCH=True

N2（复刻旧缺陷：空结果也标记"已完成"）：
  if (!cache.has(key)) → if (!filled)  +  const cache = new Map(); let filled = false;
  + 在取到 ids 之后立刻 filled = true（无论空不空）
  ✖ S6b：libId 还原器缓存映射，但**绝不缓存"索引未就绪"（空列表）**
    AssertionError: 第二次应该能还原出来（库已就绪）
  ℹ tests 13 · pass 12 · fail 1               EXIT_TEST=1
  RESTORED_MATCH=True
```

⇒ 断言**确实**能区分"重查"与"空结果被永久缓存"。诚实补一句：N2 里**先失败的是返回值那条**（`got === 'L1'`），`seq === 2` 是第二道网；两者都在，判据不虚。

### B3 · S13 的"接线"断言 —— ⚠️ **上报的变异已堵住，同一类的一行伪装仍能绕过**

```text
B3-a（上一轮 R7 的原文变异）：
  out/main/index.js:  if (!isTrustedSender(event)) {  →  if (false && !isTrustedSender(event)) {
  [FAIL] S13：闸门前面没有 `false &&` / `0 &&` / `true ||` 之类的短路禁用
         — 闸门前 24 字符："now();\n    if (false && "
  失败 1 项 ⇒ EXIT_BUILD=1                                        ← ✅ 该变异现在会被拦
  RESTORED_MATCH=True

B3-b（我造的伪装，只多一对括号）：
  →  if ((0) && !isTrustedSender(event)) {
  [OK  ] S13：来源校验被**取反后当作闸门**（形如 `!isTrustedSender(event)`）
  [OK  ] S13：闸门前面没有 `false &&` / `0 &&` / `true ||` 之类的短路禁用
         — 闸门前 24 字符："e.now();\n    if ((0) && "
  [OK  ] S13：闸门命中时返回 BAD_REQUEST 信封（拒绝语义）
  → 全部通过  EXIT_BUILD=0   （闸门恒假、来源校验已死）        ← ❌ 绕过

B3-c：  →  if (false == 1 && !isTrustedSender(event)) {
  → 全部通过  EXIT_BUILD=0                                        ← ❌ 绕过
```

⇒ 判据是**文本启发式**（`false &&` / `0 &&` / `true ||` 紧邻闸门），任何等价写法都逃得掉；
`verify_app_build.mjs:288` 那句"已能挡住'注释掉/短路掉/搬出 handler'这三类"**对"短路掉"不成立**（见 N-3）。
要点：B3 上报的那个**具体**变异确实被堵住了，所以我不把它算"未修"；但它没解决"这条断言能不能证明闸门是真闸门"这个问题。

---

## new_issues（B 项：本轮新找到的同类问题）

### N-1（**等同 blocker**）· §1c 的 S11/S12"handler 走的是 `decideXxx()`"是**由函数定义满足**的假断言

- 位置：`tools/verify_app_build.mjs:271-276`
  ```js
  ok(/setWindowOpenHandler\s*\(/.test(mainCode), 'S11：注册了 setWindowOpenHandler（开新窗口）');
  ok(/decideWindowOpen\s*\(/.test(mainCode), 'S11：handler 走的是 decideWindowOpen()（判定已单测）');
  ok(/will-navigate/.test(mainCode), 'S12：注册了 will-navigate（导航拦截）');
  ok(/decideNavigation\s*\(/.test(mainCode), 'S12：handler 走的是 decideNavigation()（判定已单测）');
  ```
  后两条是**对整个 bundle 的裸正则**，而 bundle 里存在**函数定义** `function decideWindowOpen() {` / `function decideNavigation(url, devUrl = "") {` ⇒ 这两条断言**只要函数还被定义、被 import，就永远为真**，与"handler 是否调用它"无关。
- **变异（单行值改动 / 条件改动，未动括号结构）**：
  ```text
  win.webContents.setWindowOpenHandler(() => decideWindowOpen());
    → win.webContents.setWindowOpenHandler(() => ({ action: "allow" }));      // 新窗口策略 = 允许
  if (!decideNavigation(url, DEV_RENDERER_URL)) {
    → if (false) {                                                            // 导航拦截 = 死
  ```
- **原始输出**：
  ```text
  变异后 decideWindowOpen( 出现次数 = 1 ；decideNavigation( 出现次数 = 1（都只剩函数定义本身）
  [OK  ] S11：注册了 setWindowOpenHandler（开新窗口）
  [OK  ] S11：handler 走的是 decideWindowOpen()（判定已单测）
  [OK  ] S12：注册了 will-navigate（导航拦截）
  [OK  ] S12：handler 走的是 decideNavigation()（判定已单测）
  EXIT_BUILD=0     EXIT_TEST=0（npm test 113/112/0/1）     EXIT_DOM=0
  ```
- **为什么这是本轮最重要的一条**：它正是 `verify_app_build.mjs:253-254` 自己写的那个坑——
  "**不是全文找子串：那样把接线删掉、只在别处留一份同样文本就能骗过去（独立复核 I-2 实测过）**"。
  §1b 为此专门实现了 `callArgsOf`（取**调用点**实参）、§1c 的 S13 也用了 `callArgsOf` 取 `ipcMain.handle` 实参，
  **只有 S11/S12 这四条还停在裸正则**，而它们恰恰是"接线在不在"的证据。
- 修法方向：对 `setWindowOpenHandler` 取其实参区间、断言里面有 `decideWindowOpen()`；对 `will-navigate` 取 `.on("will-navigate", …)` 的回调区间、断言里面有 `decideNavigation(`（复用现成的 `callArgsOf`/括号配平即可）。

### N-2 · B1 的 `io` 参数是**装饰性**的：一条不经过 `io` 的真实读取全绿

- 位置：`apps/desktop/src/main/thumb-url.mjs:28-34`（注释声称"如果将来有人在解析路径里加了读取，它**必须经过这个参数**才可能'干净'，而一旦经过，`reads` 就会非空 ⇒ 断言变红"）+ `permissions.test.mjs:147-149` 的两条"不 import fs"结构断言。
- **变异（真实读取，完全绕开 `io`）**：
  ```text
  parseThumbUrl 里：void io;  →  void io; { const _fs = process.getBuiltinModule("node:fs");
                                            _fs.readFileSync(process.cwd() + "/package.json"); }
  ```
- **原始输出**：
  ```text
  ✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明）
  ℹ tests 13 · pass 13 · fail 0            EXIT_TEST=0      ← 读取真的发生了，断言全绿
  RESTORED_MATCH=True
  ```
- 原因：两条结构断言只认 `from 'node:fs'` 与 `require('fs')`（`permissions.test.mjs:148-149`）——
  `process.getBuiltinModule("node:fs")` 两者都不匹配；**静态阅读**同样可见：`createRequire(import.meta.url)("node:fs")` 也不匹配（那两条正则只认裸 `fs`，不认 `node:fs`，也不认 `require(` 的变量形式）。
- 影响：S4 现在的行为证明只有"**没有经过注入的 io**"，而文档/注释把它写成了"**没有文件读取**"。
  这条**不足以推翻 B1 的修复**（B1 的病因是"断言恒真"，现已消除），但"注入计数 fs ⇒ 零读取"这个论证链仍是**未闭合**的。
- 修法方向：把 S4 的行为证明换成"进程级可观测"的手段（例如临时打桩 `process.getBuiltinModule`/`Module._load`，或在**子进程**里跑一次带 `--experimental-permission`/`fs` 打桩的解析并检查计数），或者老实把该断言的措辞收敛成"未使用注入的 io"，同时把结构断言扩到 `node:fs` / `createRequire` / `getBuiltinModule`。

### N-3 · B3 的短路判据可被"加一对括号"绕过（见 B3-b/B3-c 的原始输出）

- 位置：`tools/verify_app_build.mjs:293-297`（`/false\s*&&\s*$|0\s*&&\s*$|true\s*\|\|\s*$/` 只匹 24 字符紧邻窗口）。
- 结论：判据仍是文本启发式；`(0) &&`、`false == 1 &&` 这类**语义等价**的短路前缀可原样保留闸门文本、让守卫全绿。
- 影响：§1c 中 S13 那半边的"接线"证据强度 = "闸门文本还在，且没写三种最朴素的短路"，**不等于**"闸门在调用路径上生效"。
  （`docs/spec/SPEC-security.md:328` 的 S13 行把它写成"断言校验**在 `ipcMain.handle` 实参内**"，字面没错，但读者会以为更强的结论。）

### N-4 · §2b 唯一的"整对象外泄"检查在**审查期间被删掉**了，`platform: process` 现在全绿

- 位置：`tools/verify_app_build.mjs:337-340` 的注释（新写的）：
  "初版这里还挂了一个 `for (const banned of […])` 的循环，但本文件里根本不含这些标识符 ⇒ 每轮 `leaksObject` 都是假 ⇒ **空转**。…这里直接删掉空转"，
  替换为 `:352-355` 的 `nodeUses`/`illegal`（只匹配 `process.<名>` 与 `require(`）。
- **变异（产物 `out/preload/index.cjs`，单行值改动）**：
  ```text
  platform: process.platform   →   platform: process
  ```
- **原始输出**：
  ```text
  [OK  ] preload 暴露的方法**恰好**是 invoke / onEvent / platform  — 实际：["invoke","onEvent","platform"]
  [OK  ] S9：preload 暴露面片段确实被取到（不是空串导致上面那条误判）  — apiBlock 长度 519
  [OK  ] S9：暴露面里除了 process.platform 没有别的 Node 接触面
  → 全部通过   EXIT_BUILD=0        ← 把整个 process 对象交给渲染层，无一处报警
  RESTORED_MATCH=True
  ```
- 被删掉的那条检查**不是空转**（我用旧正则对同一份代码做了真值核对）：
  ```text
  old-check ([:=]\s*process\b(?!\.)) on "  platform: process"          -> true    ← 会拦住上面这个泄漏
  old-check                          on "  platform: process.platform" -> false   ← 对现状零误报
  old-check                          on "  p = process"                -> true
  old-check                          on "  p = process.env"            -> false
  ```
- 这正是本轮的病灶同构体：**"它在当前代码上不响"被当成"它永远不可能响"** ⇒ 删掉一条真防线。
  （同一个盲区的镜像：恒真的断言 = 在当前代码上永远响。两者都不是判据，一个是永不拒绝、一个是永远拒绝。）
- 对照：同一节里我另做的"嵌套塞能力"变异（`platform: { os: …, read: process.getBuiltinModule("node:fs").readFileSync }`）**会被 `nodeUses` 抓住**：
  ```text
  [FAIL] S9：暴露面里除了 process.platform 没有别的 Node 接触面  — getBuiltinModule   EXIT_BUILD=1
  ```
  ⇒ 新加的 `nodeUses` 有效，但它补不上"整对象外泄"这个洞。

### N-5 · §1b 可被**对象字面量重复键**绕过：`shell: createRevealPort(shell), shell: null`

- 位置：`tools/verify_app_build.mjs:255-261`（`engineArgs` 实参区间内 `/shell\s*:\s*createRevealPort\s*\(/`）。
- **变异（产物，单行值改动）**：
  ```text
  shell: createRevealPort(shell)   →   shell: createRevealPort(shell), shell: null
  ```
- **原始输出**：
  ```text
  JS 重复键语义 (shell:1, shell:null).shell = null          ← JS 对象字面量后者覆盖前者（实测）
  [OK  ] createEngine 调用点的实参里含 shell: createRevealPort(...) —— 否则 reveal 会返回 PORT_MISSING
  [OK  ] 端口构造函数在调用点实参里（未被摇掉）
  → EXIT_BUILD=0     EXIT_TEST=0(npm test 113/112/0/1)     RESTORED_MATCH=True
  ```
  ⇒ 端口在**语义上**是 `null`（F-01 的静默假成功会原样回来），而 §1b 的判据是"文本在不在实参里"。与 N-1 同源：**"存在文本" ≠ "有效配置"**。

### N-6 · `thumbFailureStatus` 的 `400` 分支在唯一调用点上**永远走不到**（死分支 + 文档 400 与产品 404 不符）

- 位置：`apps/desktop/src/main/index.mjs:353-358`
  ```js
  const p = parseThumbUrl(request.url);
  const libId = p.ok ? await canonicalLibId(p.rawHost) : '';      // ← !p.ok 时 libId 恒为 ''
  if (!p.ok || !libId) {
    const status = thumbFailureStatus(p.ok ? 400 : p.status, libId);   // ← 此分支内 libId 必为假 ⇒ 必回 404
  ```
- **忠实复刻该判定链（不启动 Electron）的原始输出**：
  ```text
  thumb://L1/022a00481875@999        parse.ok=false parse.status=400 libId=""  -> 实际返回 404
  thumb://../../windows/win.ini      parse.ok=false parse.status=400 libId=""  -> 实际返回 404
  thumb://L9/022a00481875@256        parse.ok=true  parse.status=undefined libId="" -> 实际返回 404

  可达状态枚举（进入 if (!p.ok || !libId) 的 (p.ok, libId) 组合）：
    ok=false libId=""    -> thumbFailureStatus(p.status, "") = 404
    ok=true  libId=""    -> thumbFailureStatus(400, "")      = 404
    ok=true  libId="L1"  -> 不进入该分支（走正常路径）
  ```
  ⇒ 生产里**唯一**能到达的映射是"⇒ 404"；`permissions.test.mjs:157`（`thumbFailureStatus(400,'L1') === 400`）测的是一个**该调用链产生不出来的状态**（`!p.ok` 时 `libId` 被强制成 `''`）。
- 影响：① `docs/spec/SPEC-security.md:320`（S5）写的期望 **400** 与产品不符（产品是 404）；
  ② `docs/spec/SPEC-security.md:343` 把这次行为变更描述成"把'库无法还原'与'形状不对'**拆开**为 404"——暗示形状错仍是 400，与实测不符（实际**没有拆**，全是 404）。
  ③ 安全上无害（对渲染层两者都是"无预览"），但它是"**测试测的是不可达分支**"的又一例，且它让 B2 的修复看起来比实际更完整。

### N-7 · §0b 的产物新鲜度**只比 `out/main`**，且**不覆盖 `packages/design-tokens/tokens.css`**

- 位置：`tools/verify_app_build.mjs:89-95`（`srcRoots = apps/desktop/src + packages/*/src`；`newestMtime([path.join(OUT,'main')])`）。
- **只读复刻脚本的原始输出**：
  ```text
  §0b 扫描的源码根:
      apps\desktop\src (存在)
      packages\design-tokens\src (不存在)
      packages\engine\src (存在)
      packages\indexer\src (存在)
  tokens.css 是否落在任一扫描根内: false
  guard 里 newestMtime 的调用: newestMtime([path.join(OUT, 'main')]   ← 只比 out/main
  ```
- 影响：`packages/design-tokens/tokens.css` 是渲染层样式的**唯一来源**（`apps/desktop/src/renderer/src/main.jsx` 直接 import），改它 + 构建失败时：源码环里最新 mtime 不动 ⇒ 新鲜度判定**照样通过** ⇒ 守卫继续读**旧的** `out/renderer`（`out/preload`、`out/renderer` 也从不参与新鲜度比较）。
  本次要防的是"读旧产物给假绿"，洞虽窄，但性质与 §0b 自己的立意一致。修法：把 `packages/*/` 下的非 `src` 参与构建资源纳入扫描（至少 `packages/design-tokens/tokens.css`），并把 `out/renderer`/`out/preload` 一起比较。

### N-8（轻度）· §11 里两条 `ok(true, …)` 是恒真项，把"打印一行说明"计成了"通过"

- 位置：`tools/verify_renderer_dom.mjs:447` 与 `:449`
  ```js
  if (!p) { ok(true, 'S9(harness)：无 window.process —— 无 Node 能力可言'); }
  else    { ok(true, `S9(harness)：存在受限 process（platform=…），逐项查危险能力`); … }
  ```
- 实测走的正是 `:447`（基线输出：`[OK] S9(harness)：无 window.process`）—— 即**无论分支真假都各有一条 OK**。这两条不是证据（它们只是"分支被走到了"的日志），却计入 OK 计数、在读者眼里是"两条通过"。
  同节的其余断言是**诚实的**：`:434-441` 明确写了"`window.require === undefined` 主要是 jsdom 的性质"、"`window.api` 是守卫自己造的 mock，本守卫从不加载 `out/preload/index.cjs`"——**声称与事实一致，本轮不再把它算作问题**（上一轮的 §4.2 已被这条注释正面回应）。

### N-9（文档一致性，C 项）

1. `docs/spec/SPEC-security.md:325`（S10 行）仍写"断言 ①…②…**③ `window.__XSS_EXECUTED` 仍为假**"。
   实测：`tools/verify_renderer_dom.mjs` 里 `__XSS_EXECUTED` 只出现 **1 次**（`:101` 的载荷字符串本身），**零断言** —— 该断言已在 `:510-519` 的说明里被主动删除。**文档这一行没跟着改**（且它列举的两条现存证据 ①② 是真的）。
2. `docs/spec/SPEC-security.md:320`（S5 ⇒ 400）与 `:343`（"拆开为 404"）与产品的实际行为不符 —— 见 N-6。
3. `docs/spec/SPEC-security.md:297`"本表 16 条**全部**有自动化断言"+ `:321`（S6 行把"`index.mjs` **回 404**"写进"自动化在哪里"栏）：
   经 §B2 实测，这半句**不是断言**——把 404 改成 200 全仓无一报警。
4. §8.1（`:333-343`）的"未验证"清单**少写了一条**：所有产物级断言（§1b/§1c/§2b/§11/§12）都以"**先有一次成功的 `npm run build`、`out/` 是新鲜的**"为前提；本环境 `npm run build` 在受限沙箱里会 `spawn EPERM`（见 limits），`out/` 只是**恰好已存在**。§8.1 写了"真窗口未实测""`file://` 前缀放行"（这两条都**在**，我核对过 `:338`、`:339-340`），但没有这一条。
5. （更轻）`apps/desktop/tests/ports.test.mjs:9` 把"主进程真的把端口传给了 `createEngine`"的证据归给 `verify_renderer_dom.mjs`；但该守卫**从不加载 main**，真正证明这句话的是 `verify_app_build.mjs` §1b（`createEngine` 调用点实参）。归因写错了对象。

**没找到的问题（如实说明查过哪里）**：`apps/desktop/tests/permissions.test.mjs`（13 条）与 `apps/desktop/tests/window-security.test.mjs`（10 条）里
**没有** `.skip` / `only` / `todo` / `ok(true)` / `if (X) assert(…)` 形式的恒真或永假分支（`grep` 全文件确认）；
每条"全拒"型用例都配了**反例锚**（`:36`、`:48`、`:69-70`、`:203`、`:212`）；
`S14` 的尺寸闸门与"边界不误判"是**互锚**的一对（一条证明 `/载荷过大/` 真会出现，另一条才断言它没出现，`permissions.test.mjs:78-87`），并且我核对了 `apps/desktop/src/shared/ipc.mjs:102-107` 的顺序（尺寸检查确实在 zod 之前）；
`window-security.test.mjs` 的**决策网是真的** —— 拆掉两处判定后对应用例立刻红：
```text
变异 window-security.mjs：if (event.sender !== win.webContents) return false; → if (false) …
                          if (frame.parent !== null) return false;            → if (false) …
✖ S13：iframe 内调用 ⇒ 拒绝（frame.parent 不为 null）
✖ S13b：来源不是主窗口的 webContents ⇒ 拒绝
ℹ tests 10 · pass 8 · fail 2          EXIT_TEST=1      RESTORED_MATCH=True
```
`§12` 的 `uid` 定位（`verify_renderer_dom.mjs:488-491`）也不会因分页找不到卡片：渲染层 `apps/desktop/src/renderer/src/search/Gallery.jsx:55` 是 `results.map(...)`，**无分页/top-N**（`grep slice(|pageSize|limit|topN` 在 `renderer/src` 无命中）。风险只在"将来加了分页"时**报错信息会误导**（会先说"卡片没渲染出来"而不是"界面改了"）——`§12:482-485` 已经把这个坑写进注释了。

---

## reversals（我的双向验证 + 还原证据）

所有变异都是**值/条件级**的单行改动（**未动任何括号结构**，避免"构建失败 ⇒ 守卫读旧产物 ⇒ 假绿"）。
`out/` 上的变异按任务书允许，全部还原；**没有跑过 `npm run build`**（本环境跑不了，见 limits），因此 §0b 新鲜度判定的前提是"`out/main` 比源码新"——产物被我这几次变异改成了**更新**，判定不会因此变红（这也意味着我的产物级变异**没有**被新鲜度检查干扰）。

| # | 变异（目标 → 改动） | 期望 | 实测 | 还原 |
|---|---|---|---|---|
| R1 | `thumb-url.mjs:44` `void io;` → 追加 `if (io && io.existsSync) io.existsSync("/etc/passwd");` | 断言必须变红 | ✖ S4 红，`AssertionError: 解析阶段发生了文件访问：[["existsSync","/etc/passwd"],…×7]`，13/12/1，EXIT=1 | ✔ `d498861ab4086aac` |
| R2 | 同上，改成 `process.getBuiltinModule("node:fs").readFileSync(…)`（**不经过 io**） | 洞 ⇒ 绿 | 13/13 全绿，EXIT=0（**读取真的发生了**）→ N-2 | ✔ 同上 |
| R3 | `thumb-url.mjs:88` `: 404` → `: 200` | S6 必须变红 | ✖ `S6：失败状态码映射…` 红，13/12/1，EXIT=1 | ✔ 同上 |
| R4 | `out/main/index.js` 同位置 `: 404` → `: 200` | **B2 复现点** | `npm test` 113/112/0/1 EXIT=0；§app_build EXIT=0；§dom EXIT=0 ⇒ **全绿** | ✔ `9ce9810f19266e9c` |
| R5 | `thumb-url.mjs:130` `if (ids.length > 0) {` → `if (true) {` | 等价变异 ⇒ 绿（对照） | 13/13 绿，EXIT=0（与代码注释的自我说明一致） | ✔ 同上 |
| R6 | `createLibIdResolver` 复刻旧缺陷（`filled` 标志 + 空结果也置位） | S6b 必须变红 | ✖ `S6b…` 红：`第二次应该能还原出来（库已就绪）`，13/12/1，EXIT=1 | ✔ 同上 |
| R7 | `out/main/index.js` `if (!isTrustedSender(event))` → `if (false && …)` | §1c 必须变红 | ✖ `[FAIL] S13：闸门前面没有 false && …`，EXIT=1 | ✔ 同上 |
| R8 | 同上 → `if ((0) && …)` | 洞 ⇒ 绿 | 全部通过 EXIT=0（闸门恒假）→ N-3 | ✔ 同上 |
| R9 | 同上 → `if (false == 1 && …)` | 洞 ⇒ 绿 | 全部通过 EXIT=0 → N-3 | ✔ 同上 |
| R10 | `out/main/index.js`：`setWindowOpenHandler(() => decideWindowOpen())` → `(() => ({action:"allow"}))` **且** `if (!decideNavigation(url, DEV_RENDERER_URL))` → `if (false)` | §1c 必须变红 | 四条 S11/S12 全 `[OK]`，EXIT=0；`npm test` EXIT=0；§dom EXIT=0 → **N-1** | ✔ 同上 |
| R11 | `out/preload/index.cjs` `platform: process.platform` → `platform: process` | §2b 必须变红 | 全部通过 EXIT=0 → **N-4** | ✔ `70e0be6e54223181` |
| R12 | 同上 → `platform: { os: …, read: process.getBuiltinModule("node:fs").readFileSync }` | 应被拦 | ✖ `[FAIL] S9：暴露面里除了 process.platform 没有别的 Node 接触面 — getBuiltinModule`，EXIT=1 | ✔ 同上 |
| R13 | `out/main/index.js` `shell: createRevealPort(shell)` → `…, shell: null` | §1b 必须变红 | 全部通过 EXIT=0（JS 后键覆盖前键，实测 `.shell===null`）→ **N-5** | ✔ 同上 |
| R14 | `window-security.mjs` 拆掉 `event.sender !== win.webContents` 与 `frame.parent !== null` 两道判定 | 决策用例必须变红 | ✖ S13 / S13b 红，10/8/2，EXIT=1（**决策网有效**） | ✔ `ec4a9c9c7e75e13c` |
| R15 | 忠实复刻 `index.mjs:353-358` 判定链（只读，无变异） | 查明可达状态 | 形状错/穿越/未注册库 **全部实际 404**；`400` 分支不可达 → **N-6** | 无需还原 |
| R16 | 只读复刻 §0b 的扫描根集合 | 查明覆盖范围 | `tokens.css` **不在**扫描根内；只比 `out/main` → **N-7** | 无需还原 |

**mtime 提醒（必须知情）**：R1–R6 在 `thumb-url.mjs`、R14 在 `window-security.mjs`、R4/R7–R10/R13 在 `out/main/index.js`、R11/R12 在 `out/preload/index.cjs` 上做的是"写入变异 → 反向写回"，**内容已逐字节还原（上表 sha256 已复核）**，但这些文件的 **mtime 被我更新过**。`out/` 本来就不进 git；源码文件的 mtime 变化会让下一次 §0b 新鲜度检查看到"源码比产物新"⇒ 它**会**要求重新 `npm run build`（这是正确保守的行为，不是损坏）。

**复核结束时的一致性核对（原始输出）**：

```text
OK     d498861ab4086aac  apps/desktop/src/main/thumb-url.mjs
OK     84c123de0db5c801  apps/desktop/tests/permissions.test.mjs
OK     28b76f121677e7d1  apps/desktop/tests/window-security.test.mjs
OK     596819afdeb3d305  apps/desktop/tests/ports.test.mjs
OK     3326d90b09193cbe  apps/desktop/tests/library-config.test.mjs
OK     0f420501f9c5245a  tools/verify_renderer_dom.mjs
OK     dd12dc8bb5e784be  tools/verify_renderer_styles.mjs
OK     ec4a9c9c7e75e13c  apps/desktop/src/main/window-security.mjs
OK     234f9bd7bf6533aa  apps/desktop/src/main/index.mjs
OK     9ce9810f19266e9c  out/main/index.js
OK     70e0be6e54223181  out/preload/index.cjs
OK     3ca93e20aa2c42e2  docs/spec/SPEC-security.md
OK     adf9436fdcc4dd84  apps/desktop/src/shared/ipc.mjs
OK     c172355a9a3956e3  tools/verify_app_build.mjs   （审查期间的并发改动，非本轮所为）
>>> 无遗留变异
```

`git status --porcelain`（只读，未提交）：`M apps/desktop/src/main/index.mjs` / `M docs/DEBT-CLEANUP.md` / `M docs/plan/ROADMAP.md` / `M docs/spec/SPEC-security.md` / `M tools/verify_app_build.mjs` / `M tools/verify_renderer_dom.mjs` + 4 个未跟踪的新文件 + `?? docs/audit/REVIEW-PERMISSIONS.md`（上一轮的报告）+ 本文件。**与我复核开始前的状态一致**（本批改动整体尚未提交）。

---

## limits（未能验证的，如实标"未验证"）

1. **`npm run build` 未验证，本轮也没尝试重建。** 任务书已说明本沙箱会 `spawn EPERM`（esbuild 要起常驻服务进程），我也就没有把它当"可以试一下"的事。因此：
   - 产物级结论（§1b/§1c/§2b/§11/§12、以及 B2 的产物复现）**全部是对现存 `out/` 的结论**，不是对"现在这份源码构建出来的产物"的结论。
     依据：`out/*` 的 mtime 是 2026-10-12 16:52:19，`apps/desktop/src` 与 `packages/*/src` 的最新源码 mtime 都不晚于它（§0b 本次实测通过）。
   - **不得**把"§app_build EXIT=0"读成"构建通过了"。构建这一步本轮**未验证**。
2. **真 Electron 窗口行为未验证**（`window.open` 真被 deny？iframe 内 invoke 真被拒？`process` 在真沙箱 preload 里到底暴露了什么？）—— 需要 `smoke_app.mjs` 级别的真启动，本轮没有跑（本环境起不来 Electron）。
3. **`packages/indexer/` 与 `packages/engine/` 的用例本轮未审查**（不在任务范围；S7/S8/S15/S16 沿用上一轮结论，我未重跑它们的反向验证）。
4. `apps/desktop/tests/library-config.test.mjs`（12 条）与 `ports.test.mjs`（4 条）只做了**通读 + 恒真模式扫描**，**未做逐分支变异**。`ports.test.mjs` 通读未发现恒真断言（`assert.throws`/`deepEqual(seen,…)` 都是真断言）。
5. 我**没有**去验证 `parseThumbUrl` 返回的 `status: 400` 是否还有其他消费方（本轮只在 `handleThumb` 这一处查了调用链）。
6. **N-2 / N-5 / N-7 的修法建议只是方向**，我没有实现、也没验证修法有效（本轮不改任何被验证文件）。

---

## 处置建议（按优先级；给作者，不代表我已验证修法）

1. **B2 必须真正闭合**：给 `handleThumb` 的拒绝分支加**可执行**的断言（把 `new Response(…,{status})` 那一步抽成纯函数并在测试里调用它），或在 `verify_app_build.mjs` 里断言产物的 thumb 拒绝状态码。当前状态 = 文案上"已修"、行为上"和上一轮一模一样"。
2. **N-1**：§1c 的 S11/S12 改用 `callArgsOf`/括号配平取**调用点/回调体**，别再对全文裸正则（§1b 的纪律要贯彻到 §1c）。
3. **N-4**：恢复"整对象外泄"判据（`[:=]\s*process\b(?!\.)` 一族），并给 `nodeUses` 补上 `createRequire` / `getBuiltinModule` / `node:fs` 形式。
4. **N-2**：要么把 S4 的措辞收敛为"未使用注入的 io"，要么换成进程级可观测的零读取证明。
5. **N-3**：把"闸门是不是真闸门"从文本启发式升级为**求值**（例如把 handler 抽出来，用假 electron 注入后调用它，断言不可信来源被拒）。
6. **N-5 / N-7**：对象字面量按"有效值"判定（拒绝重复键或取最后一个键的值）；新鲜度扫描补 `packages/design-tokens/tokens.css` 与 `out/renderer`/`out/preload`。
7. **N-6 / N-9**：修文档（S5 的 400、§8.1 关于状态码的那一行、S10 行的 ③、S6 行的"index.mjs 回 404"、§8.1 补"产物断言依赖一次成功 build"），或在代码里让形状错真的回 400（若那才是想要的契约）。
8. **流程**：复核开始前**冻结树**。本轮 `tools/verify_app_build.mjs` 在我审查途中被改（16:53:08），任何"复核已通过"的结论都必须绑定哈希。

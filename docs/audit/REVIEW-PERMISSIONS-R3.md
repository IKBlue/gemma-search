# docs/audit/REVIEW-PERMISSIONS-R3.md —— 独立复核（第三轮）：`docs/spec/SPEC-security.md` §8 权限用例自动化 + 新守卫 `tools/verify_main_wiring.mjs`

- 复核者：独立 Agent（**未参与本批实现**；前两轮的 `REVIEW-PERMISSIONS.md` / `REVIEW-PERMISSIONS-R2.md` 也不是我写的，只作为对照读过）
- 时间：2026-10-12 17:35–17:47（Asia/Shanghai）· 工作目录 `D:\USERS\Desktop\Agent\gemma-search` · Node v24.14.0
- 纪律：被验证文件**只读**；`docs/audit/REVIEW-PERMISSIONS-R3.md` 是本轮我**唯一**写入的文件；所有临时变异**逐个还原并复核 sha256**（见 §reversals）；未做任何 `git commit` / `push`。临时脚本全部放在 `data/_r3/`（已 gitignore；`data/_` 开头按 `AGENTS.md` §2 可删）。

---

## verdict: **fail**

一句话结论：

- **新守卫的方向是对的，而且真的能挡住前两轮那几种绕过**：我复现了 B2（`404→200`、调用点换常量）、B3（`if (false)` 恒假闸门）、N-1（`setWindowOpenHandler` 改成 allow）、N-5（重复对象键 `shell: null`）——**四种全部把守卫打红**（`EXIT=1`，见 §reversals）。这一点必须明确记账：它不是"看起来强"，是真的执行了行为。
- **但它给的是"拒绝面"证据，没有"接受面"证据**，于是出现了一个和前两轮**完全同构**的新假绿：
  `thumb://L1/022a00481875@256`（合法尺寸 + 已注册库）**返回 404**（库映射被打断）时，守卫**全程绿、EXIT=0**（G11，§reversals）。根因是守卫的 thumb 段只断言"坏输入 ⇒ 400/404"，从不要求"好输入不被拒"——而 S4/S5/S6 三条**全部**只测坏输入。
- 同型问题还有三处，都在新守卫自己身上：`reveal` 断言（`code !== 'PORT_MISSING'`）在**端口存在但形状坏**时给假绿（probe2 实测）；`setWindowOpenHandler` 的回调**只要有 `action` 字段**就算过（返回值 `{action:"allow"}` 与 `{}` 一律红——与 S11 真正要的 `deny` 无关，G2）；main_wiring **完全不看 `webPreferences`**（`devTools` 可改、`preload` 可注释掉，G7/G8 全绿）。
- 另外，`tools/verify_main_wiring.mjs` **在 git 里不存在（untracked）**，且它的最终写入时间（17:36:18）**比我这次复核只早 9 秒**——"它抓到过 6 种绕过"这个**说法无法复现**（进程历史不可回溯），只能验证它**现在**能抓到哪几种（下详）。

⇒ 结论：**16 条里"接线/行为"这一层确实从文本升级成了行为（这是实质进步），但行为断言本身仍存在恒绿/覆盖缺口，且缺口就在本轮声称已闭合的 B2 附近。给 `fail`，blockers 记 1 条（P-1），其余按 issue 记账。**

---

## 复核对象的版本（一切结论只对这一版成立）

| 文件 | sha256（前 16 位） | 备注 |
|---|---|---|
| `apps/desktop/src/main/index.mjs` | `a8f38b5aa3157f8b` | 26042 B |
| `apps/desktop/src/main/thumb-url.mjs` | `696e95a3a548d259` | 7464 B |
| `apps/desktop/src/main/window-security.mjs` | `ec4a9c9c7e75e13c` | 与前轮 R2 相同 |
| `apps/desktop/tests/permissions.test.mjs` | `e35abec19019c3ca` | 15163 B |
| `tools/verify_main_wiring.mjs` | **`b84eb68de89a28f3`** | **untracked**（`git ls-files` 不认）；mtime 17:36:18 |
| `tools/verify_app_build.mjs` | `be6a5a02bc9531f6` | mtime 17:27:45 |
| `tools/verify_renderer_dom.mjs` | `0f420501f9c5245a` | 与 R2 相同 |
| `docs/spec/SPEC-security.md` | `5fd1fc507577d663` | mtime 17:30:41 |
| `out/main/index.js` | `ca5a14f14d92efd5` | 产物（未重建） |
| `out/preload/index.cjs` | `70e0be6e54223181` | 产物（未重建） |

> ⚠️ **并发改动提醒（与 R2 同一类风险）**：`tools/verify_main_wiring.mjs` 的 mtime 是 **17:36:18**，我的复核从 17:35:56 开始——**它在我审查开始前 9 秒刚被写过**，而这个文件**没有进 git**，所以我**无法**用历史比对"作者版本"和"我读到的版本"是否一致。本报告的全部结论只对应 `b84eb68de89a28f3`。**下一轮复核前请先冻结树。**
> 好消息：本轮我复核期间**没有**再发生一次写入（该文件 sha256 在 17:35–17:47 之间始终是 `b84eb68de89a28f3`）。

---

## 0. 基线（复核开始时的原始输出；与任务书给的基线一致）

```text
$ npm test
ℹ tests 113   ℹ pass 112   ℹ fail 0   ℹ skipped 1        EXIT=0

$ node tools/verify_main_wiring.mjs     → 全过（20 条 ok()）  EXIT=0
$ node tools/verify_app_build.mjs       → 全部通过（45 条 ok()）  EXIT=0
$ node tools/verify_renderer_dom.mjs    → React 渲染层逻辑全过（71 条 ok()，含 2 条 ok(true)）  EXIT=0
$ node tools/verify_renderer_styles.mjs → 渲染层令牌纪律通过（6 条 ok()）  EXIT=0
```

`verify_main_wiring.mjs` 正常态输出（节选，原始）：

```text
--- 0) 从产物里抓到的接线 ---
  [OK  ] 抓到了 engine:invoke 的 handler
  [OK  ] setWindowOpenHandler 注册了 1 次  — 实际 1 次
  [OK  ] 注册了 will-navigate
  [OK  ] protocol.handle("thumb") 已注册
--- 1) S13 · IPC 来源校验（去调用时的行为）---
  [OK  ] iframe 内的调用被拒（BAD_REQUEST）  — 实际："BAD_REQUEST"
  [OK  ] 非主窗口 webContents 的调用被拒  — 实际：{"ok":false,...,"message":"untrusted sender",...}
  [OK  ] 远程地址来源的调用被拒
  [OK  ] 缺 senderFrame 的调用被拒（fail closed）
  [OK  ] 反例锚：可信来源没有被来源校验拦下（区别于上面的 untrusted sender）  — 实际 code=ok
--- 2) S11 / 3) S12 / 4) thumb / 5) reveal 全 OK
主进程接线行为全过（来源校验 / 开新窗口 / 导航拦截 / thumb 状态码 / reveal 端口）。
```

### 0.1 我另写的独立探针（`data/_r3/probe.mjs`，只读，用同构假 `electron`）

与守卫**同一套桩写法**，但断言由我自己写，用来交叉核对"守卫会不会看错对象"：

```text
=== A) 真实 handler 的存在与名字 ===
A1 registered ipc channels = ["engine:invoke"]
A2 protocol schemes = ["thumb"]
A3 winOpen count = 1 | nav events = ["will-navigate","render-process-gone","did-finish-load","did-fail-load","console-message","before-input-event"]
A4 windows = 1

=== B) thumb 状态码（含正向：合法 size / 合法库）===
B thumb://L1/022a00481875@999            {"status":400,"text":"bad shape"}
B thumb://L1/022a00481875@256            {"status":415,"text":"decode failed"}     ← 正向：形状/库都合法才走到解码
B thumb://L1/022a00481875@128            {"status":415,"text":"decode failed"}
B thumb://L1/not-a-uid@256               {"status":400,"text":"bad shape"}
B thumb://../../windows/win.ini          {"status":400,"text":"bad shape"}
B thumb://L9/022a00481875@256            {"status":404,"text":"bad shape"}
B thumb://L1/022a00481875@256?x=1        {"status":415,"text":"decode failed"}
B thumb://R3/                            {"status":400,"text":"bad shape"}          ← 见 §issue P-2
B thumb://L1/                            {"status":400,"text":"bad shape"}
B thumb://                               {"status":400,"text":"bad shape"}
B thumb://L1/022a00481875@1024           {"status":400,"text":"bad shape"}

=== D) reveal ===
D1 reveal 返回 = {"ok":true,"data":{"revealed":true,"path":"G:\\model\\CR\\ID-032109719124396.rar"},"warnings":[]}
D2 shell.showItemInFolder 收到的实参 = ["G:\\model\\CR\\ID-032109719124396.rar"]

=== E) 导航边界 ===
E2 will-navigate ALLOW   file:///C:/Windows/System32/drivers/etc/hosts
E2 will-navigate ALLOW   file:///D:/other/app/index.html
E2 will-navigate BLOCKED javascript:alert(1)
E2 will-navigate BLOCKED data:text/html,<h1>x
```

**这份探针的输出本身就是两条关键证据**：① `@256` 走的是 415（=正向路径确实活着，**但守卫不测它**）；② `file://` 前缀放行是真的（`file:///D:/other/app/index.html` 被放行），与 §8.1 自己记的边界一致。

---

## blockers

### P-1（**新守卫的同型假绿，性质等同前两轮的 B2**）· thumb 段只有"拒绝面"，没有"接受面"——把库映射打断（所有已注册库都 404）守卫全绿

- 位置：`tools/verify_main_wiring.mjs:178-196`（第 4 段 thumb）。三条断言的对象分别是 `@999`、`not-a-uid`、`../../windows/win.ini`、`L9`——**全是坏输入**；正向输入（`@256`/`@512` + 已注册库）**一条都没有**。
- 变异（产物级、单行条件改动，括号结构不动）：
  ```text
  out/main/index.js:
    async function canonicalLibId(host) {\n  if (!engine) return "";
    →  async function canonicalLibId(host) {\n  if (true) return "";
  ```
  即：**任何 `thumb://` 请求都还原不出库 ⇒ 已注册库也一律 404**（界面全是"无预览"，不报错）。
- 原始输出：
  ```text
  ### G11-libid-always-empty  锚点 1 次  orig=ca5a14f14d92efd5
  ### [G11-libid-always-empty] EXIT=0   还原=True  (ca5a14f14d92efd5)
  ### FAIL 行:            ← 空：一条都没红
  主进程接线行为全过（来源校验 / 开新窗口 / 导航拦截 / thumb 状态码 / reveal 端口）。
  ```
- **为什么它恰好从 B2 的修复边上漏过去**：`verify_main_wiring.mjs:194-196` 的断言是
  `unregistered.status === 404`。它证明的是"**某个东西**返回了 404"，**不是**"登记过的库不被拒、未登记的库才被拒"。所以只要"全 404"，这条就恒真——这与 B2 的病因（"断言看起来强，实际测错对象"）**逐字同构**，只是这次被测对象从"文本"换成了"行为"。
- 同型的第三个洞（同一段）：**该段没有 fs 观测**。`tools/verify_main_wiring.mjs:192-193` 的"路径穿越 ⇒ 400"只断言状态码，`permissions.test.mjs` 的计数 fs 在**单测层**——若有人在 `parseThumbUrl` 里"为了排障"读一次盘，产品行为不变、守卫全绿（这条我**没有**构造变异，标注【判断，非实测】）。
- 修法方向（给作者，我不代实现）：① 加**正向锚**——用探针里那条已注册 uid（本机实测 415/200，代表"通过了库映射与形状两道闸门"）断言"已注册库 + 白名单尺寸**不被 400/404 拦**"，并在库不存在时**显式 skip 并打印**（不能静默计入通过）；② 把 `L9 ⇒ 404` 改成**成对断言**（`L1 ⇒ 非 404` 与 `L9 ⇒ 404` 同段），这样"全 404"立刻变红。

---

## previous_blockers（B1/B2/B3/N-1/N-4/N-5/N-6/N-7/N-8/N-9 逐条）

### B1 · S4「零文件读取」—— ✅ 仍修好（R2 已判修好，本轮未发现回退）

`permissions.test.mjs:115-150`（`reads` 与 `assert.deepEqual(reads, [], …)`）与 `thumb-url.mjs:42-44` 的 `parseThumbUrl(rawUrl, io = null)` 接线仍在。本轮我**没有**重跑 R2 的 R1/R2 变异（不是本轮的必做项），如实标：**未重验**，仅核对了文件哈希与断言仍在（`e35abec19019c3ca` / `696e95a3a548d259`）。R2 的 N-2（`process.getBuiltinModule` 绕开 io）**我没看到修复痕迹**——`permissions.test.mjs:147-149` 的两条结构断言仍是 `from 'node:fs'` / `require('fs')` 两种形式。

### B2 · S6「期望的 404」的**调用点**断言 —— ✅ **真的修好了**（本轮复现并双向验证）

- 调用点断言确实存在：`tools/verify_main_wiring.mjs:194-196`
  ```js
  const unregistered = await callThumb(`thumb://L9/${uid}@256`);
  ok(unregistered.status === 404, 'S6：未注册库 ⇒ 404（**这一条就是 B2 缺的调用点断言**）', JSON.stringify(unregistered));
  ```
- **它真的是行为断言**，我做了两次反向验证（都在产物上，单行值改动）：
  ```text
  V1（thumbFailureStatus 的 400→200）：out/main/index.js  if (!shapeOk) return 400; → return 200;
     [FAIL] S5：@999 ⇒ 400  — {"status":200,"text":"bad shape"}
     [FAIL] S5/S4：uid 形状错 ⇒ 400  — {"status":200,"text":"bad shape"}
     [FAIL] S4：路径穿越 ⇒ 400  — {"status":200,"text":"bad shape"}
     EXIT=1

  V2（把**调用点**换成常量）：const status = thumbFailureStatus({ shapeOk: p.ok, libId });  →  const status = 404;
     [FAIL] S5：@999 ⇒ 400  — {"status":404,...} ×3
     EXIT=1
  ```
  ⇒ 上一轮 R2 的复现条件（"产物里 404 改 200，全仓无一处报警"）**不再成立**。
- ⚠️ 但 B2 的**病因没有断根**——见 **P-1**：这条断言可被"全 404"满足。

### B3 · S13 的"接线"断言（文本启发式）—— ✅ **关键部分已由行为取代**（并且 R2 的绕过手法现在会红）

R2 的病症是 `verify_app_build.mjs:307-321` 那组**文本**判据（`!isTrustedSender(event)` + 闸门前 24 字符窗口）可被 `(0) &&` 绕过。现在：

```text
V7（恒假闸门，产物级）：if (!isTrustedSender(event)) {  →  if (false) {
     [FAIL] iframe 内的调用被拒（BAD_REQUEST）  — 实际：{"ok":true,...}
     [FAIL] 非主窗口 webContents 的调用被拒
     [FAIL] 远程地址来源的调用被拒
     [FAIL] 缺 senderFrame 的调用被拒（fail closed）
     EXIT=1
```
⇒ **不再依赖文本**：闸门死了，行为断言四条全红。（旧文本判据 `verify_app_build.mjs:313` 仍在，但它已**不是唯一证据**；R2 的 N-3 降级为"文本判据本身可被等价写法绕过，但它现在是辅助面"。）

另测：把拒绝信封的 `code` 从 `BAD_REQUEST` 改成 `INTERNAL`（G6）也会红（`[FAIL] iframe 内的调用被拒（BAD_REQUEST）  — 实际："INTERNAL"`）。

### N-1 · §1c 的 S11/S12「handler 走的是 `decideXxx()`」由**函数定义**满足 —— ✅ **行为面已修好**（文本面还在，但已不是唯一证据）

```text
V5（产物级）：setWindowOpenHandler(() => decideWindowOpen())  →  setWindowOpenHandler(() => ({ action: "allow" }))
     [FAIL] window.open(https://example.com) ⇒ deny  — {"action":"allow"}
     [FAIL] window.open(file:///x) ⇒ deny  — {"action":"allow"}
     [FAIL] window.open(about:blank) ⇒ deny  — {"action":"allow"}
     EXIT=1

V5b（更绕：false && … || {allow}）：同样 3 条红，EXIT=1

V6b（导航拦截死掉）：if (!decideNavigation(url, DEV_RENDERER_URL)) {  →  if (false) {
     [FAIL] 库外 URL 被 preventDefault / 别的 http 也被拦 / javascript: 被拦    EXIT=1

V6c（反向：全拦）：→ if (true) {
     [FAIL] 反例锚：应用自身 file:// 不被拦（否则"全拦"也能骗过上面三条）    EXIT=1
```
⇒ R2 的 N-1 复现条件（改 allow + `if (false)` 仍全绿）**不成立**。**且 S12 的反例锚是真的**（全拦会红）——这一点我特别验证过，因为它决定了"全拦也能过"这个反驳是否成立：**不成立**。
（`verify_app_build.mjs:289-294` 的 `decideWindowOpen(` / `decideNavigation(` 裸正则**仍在**，仍是 N-1 的文本形态；只是它不再独自承担"接线在不在"的举证责任。）

### N-4 · §2b 被误删的"整对象外泄"检查 —— ✅ **恢复了，而且我复现了它确实抓得住**

- 位置：`tools/verify_app_build.mjs:368-377`（`leakRe = /[:=]\s*(process|require|ipcRenderer|electron)\b(?!\s*[.\w])/g`；注释 `:369-372` 明说"我一度删掉过…实测它有真实作用"）。
- 变异（产物 `out/preload/index.cjs`，单行值改动）：
  ```text
  platform: process.platform  →  platform: process
  [FAIL] S9：暴露面的值里没有把 process / require / ipcRenderer / electron 整个对象交出去  — 发现：: process
  失败 1 项  EXIT=1     还原=True (70e0be6e54223181)
  ```
  ⇒ R2 的 N-4 复现条件不再成立。**但 R2 的补充意见没被采纳**：`leakRe` 仍不认 `createRequire` / `getBuiltinModule` / `node:fs` 形式（`nodeUses` 那条只匹配 `process.<名>` 与裸 `require(`）——即 R2 的"嵌套塞能力"半条仍依赖 `process.` 前缀。标注【判断，非实测】（我这轮只变异了 `platform: process` 这一种）。

### N-5 · §1b 被重复对象键 `shell: createRevealPort(shell), shell: null` 绕过 —— ✅ **行为面已修好**

```text
V9b（产物级）：shell: createRevealPort(shell)  →  shell: createRevealPort(shell), shell: null
```
（JS 语义：后键覆盖前键 ⇒ 引擎收到 `shell = null` ⇒ `reveal` 必须 `PORT_MISSING`。）
`tools/verify_main_wiring.mjs:199-211` 的 `reveal` 段断言 `code !== 'PORT_MISSING'`，因此该变异**会让守卫红**。
本轮我另做了**更强**的一步（V15，见 §guard_strength 的 F-3）：把端口换成 `createRevealPort(undefined)`——**端口存在但形状坏**——守卫**全绿**。所以 N-5 的**上报形态**被堵住了，但同一段断言的证明力边界比它声称的窄。

### N-6 · `thumbFailureStatus` 的 `400` 分支在调用点永远走不到（产品实际回 404）—— ✅ **已修（实现了 400），但文档没跟上**

- 代码证据：`apps/desktop/src/main/index.mjs:351-362`
  ```js
  const p = parseThumbUrl(request.url);
  const libId = p.ok ? await canonicalLibId(p.rawHost) : '';
  const status = thumbFailureStatus({ shapeOk: p.ok, libId });   // ← 新签名：两个"事实"
  ```
  `apps/desktop/src/main/thumb-url.mjs:91-95`
  ```js
  export function thumbFailureStatus({ shapeOk, libId } = {}) {
    if (!shapeOk) return 400;      // 形状/尺寸不对 —— 与"库在不在"无关
    if (!libId) return 404;
    return null;
  }
  ```
  旧签名（`p.ok ? 400 : p.status` 把 `libId` 恒置空）已不存在 ⇒ **400 分支现在可达**。
- **实测（我的探针，直接调用产物里的 `thumb` handler）**：
  ```text
  thumb://L1/022a00481875@999   {"status":400,"text":"bad shape"}
  thumb://L1/022a00481875@1024  {"status":400,...}
  thumb://L9/022a00481875@256   {"status":404,...}
  ```
  ⇒ 题面问的"`thumb://L1/<uid>@999` 现在实际返回 400 吗"：**是**。
- ❌ **但文档没变**：`docs/spec/SPEC-security.md:343` 仍写
  > 「原 `handleThumb` 把"库 id 无法还原"与"形状不对"合并成 **400**；按 §3 的表（`libId` 不在注册表 ⇒ **404**）已拆开为 **404**。」

  这句话与新实现**方向相反**（现在"形状不对 ⇒ 400"，那一版是"形状不对 ⇒ 404"）。它描述的是**上一版**行为。见 §issue P-2。

### N-7 · §0b 产物新鲜度 —— ⚠️ **部分修好**（三端 + tokens.css 都进了；仍有未覆盖的构建输入，且仍有假绿路径）

- 代码证据（`tools/verify_app_build.mjs`）：`srcRoots` 现在含 `apps/desktop/src` + 每个 `packages/*/src`（`:89-93`），`tokens.css` 用 `extraSrcFiles` 单独并入（`:95-102`），并**三端分别比较**（`:105-113`：`out/main`、`out/preload`、`out/renderer`）。
- 我**只读复刻**了同一段逻辑（`node -e …`），原始输出：
  ```text
  srcRoots:
      apps\desktop\src (存在)
      packages\design-tokens\src (不存在)
      packages\engine\src (存在)
      packages\indexer\src (存在)
  最新源码 = apps\desktop\src\main\index.mjs 2026-10-12T09:27:29.134Z
  out/main       最新 = 2026-10-12T09:40:46.655Z out\main\index.js          | 比源码新? true
  out/preload    最新 = 2026-10-12T09:35:25.898Z out\preload\index.cjs       | 比源码新? true
  out/renderer   最新 = 2026-10-12T09:35:26.582Z out\renderer\assets\index-NAMB84Cs.js | 比源码新? true
  §0b 判定 fresh = true
  ```
  ⇒ R2 的 N-7（只比 out/main、不扫 tokens.css）**已修**：三端都参与比较，`tokens.css` 也在扫描集里（`packages/design-tokens` 没有 `src/` 子目录，因此走的是 `extraSrcFiles` 这条路，是**对的**）。
- ⚠️ **仍存在的假绿路径（题面问的第 5 点）**：
  1. **未纳入扫描的构建输入**：`electron.vite.config.mjs`、`package.json`、`tsconfig*.json`、`packages/design-tokens/package.json`、`electron-builder.yml` 都**不在** `srcRoots` 里（原始输出里逐个列了"存在"）。改动它们 + 构建失败 ⇒ 新鲜度照样通过。
  2. **`newestMtime` 在"某端产物为空"时返回 0**：`0 < src.newest` ⇒ `stale` ⇒ **判红**（不是假绿，是**假红**/保守失败）。但 `:53-55` 的三端存在性只在**文件级**（`out/main/index.js` 等四个具体路径）检查，**不检查 `out/renderer/assets/*` 是否为空**——若 bundler 产出 0 个 asset，`outRenderer.newest = 0` 会把它判成过期（同样偏红）。
  3. **真正的窄假绿**：**mtime 相等**时 `t < src.newest` 为假 ⇒ 判"新鲜"。构建失败而产物与源码 mtime **恰好相同**（同秒级文件系统 + 极快失败）时会漏。这是**理论窗口**，我没有构造出来【判断，非实测】。

### N-8 · §11 两条 `ok(true, …)` 恒真项 —— ❌ **未修，原样存在**

```text
tools/verify_renderer_dom.mjs:447:    ok(true, 'S9(harness)：无 window.process —— 无 Node 能力可言');
tools/verify_renderer_dom.mjs:449:    ok(true, `S9(harness)：存在受限 process（platform=${String(p.platform)}），逐项查危险能力`);
```
基线输出走的是 `:447`：
```text
  [OK  ] S9(harness)：无 window.process —— 无 Node 能力可言
```
⇒ 两个分支**各有一条 OK**，与真假无关；它把"打印一行说明"计入了通过数。（本轮统计：`verify_renderer_dom.mjs` 共 71 条 `ok()`，其中 `ok(true` **2 条**；`verify_main_wiring.mjs` 共 20 条 `ok()`，`ok(true` **1 条**，在 `:204` 的 reveal 成功分支；`verify_app_build.mjs` 45 条，`ok(true` **0 条**。）

### N-9 · 文档一致性 —— ⚠️ **一半修了，一半没修**

1. **`__XSS_EXECUTED`：✅ 已修。**
   ```text
   docs/spec/SPEC-security.md 里 '__XSS_EXECUTED' 命中 0 次
   tools/verify_renderer_dom.mjs:101  const XSS_PAYLOAD = '<img src=x onerror="window.__XSS_EXECUTED=true">.jpg';   （载荷本体，非断言）
   ```
   `SPEC-security.md:325`（S10 行）现在写的是"①无 `<img src=x>` 元素 ②`innerHTML` 里是 `&lt;img` 实体" + "那条断言已删"——与代码一致。
2. **S5 的 400 / `:343` 的"拆开为 404"：❌ 未修**（见 N-6 与 P-2）。`:320` 的 S5 期望 400 现在**与产品一致**了；但 `:343` 的**行为变更叙述**与新实现矛盾。
3. **`SPEC-security.md:297` 仍写**「✅ 现状（2026-10-12）：本表 16 条全部有自动化断言」+ `:281`「§8 的 16 条权限用例已于 2026-10-12 全部补上自动化」：**在 P-1 面前这句话过强**（至少 S4/S5/S6 的"自动化"只覆盖拒绝面；S9 全程没有一次真实执行 preload）。
4. **§8.1 的"未验证"清单仍缺一条**：R2 的 N-9.4 建议补"产物级断言都以**一次成功的 `npm run build`** 为前提"。我复核了 `:333-344`，**没有**这一条。而且这条本轮**更该写**：`verify_main_wiring.mjs` **自己不做新鲜度检查**（它不像 `verify_app_build.mjs` §0b 那样比对 mtime），所以单独跑它时"读到的可能是旧产物"。
5. `apps/desktop/tests/ports.test.mjs:9` 的归因错误（把"主进程真的把端口传给了 `createEngine`"归给 `verify_renderer_dom.mjs`，而该守卫**从不加载 main**）——本轮未核（不在必做项），保持 R2 的结论。

---

## guard_strength（新守卫**能证明什么 / 不能证明什么** —— 我自己的判断）

### 能证明（本轮的**实测**支撑）

| # | 能力 | 证据 |
|---|---|---|
| S-1 | **thumb 拒绝分支的状态码是真的在决定响应** | V1（400→200）红 3 条；V2（调用点换常量 404）红 3 条 |
| S-2 | **S11 的新窗口策略是真的在决定行为**（含 `false &&` 这种伪装） | V5 / V5b 各红 3 条 |
| S-3 | **S12 的导航拦截是真的在决定行为，而且是双向的** | V6b（拦截死）红 3 条；V6c（全拦）红反例锚 1 条 |
| S-4 | **S13 的来源校验位于调用路径上**（闸门恒假即红） | V7 红 4 条；V4（取反）红 4 条；G6（改错误码）红 1 条 |
| S-5 | **`setWindowOpenHandler` / `will-navigate` / `protocol.handle('thumb')` 确实被注册了**（前提检查不是装饰） | G5（`ipcMain.handle` 被截断）红 `抓到了 engine:invoke 的 handler` 并 `exit 1`；G3（多注册一次）红 `setWindowOpenHandler 注册了 1 次 — 实际 2 次` |
| S-6 | **不会"空跑全绿"** | 我把 `globalThis.__REC` 赋值去掉（G1/G4）后，守卫**崩溃退出**（`TypeError: Cannot read properties of undefined (reading 'handlers')`、`node.exe` 无输出即异常终止），**没有**给出绿 |
| S-7 | **可信来源确实走到了引擎**（不是"只要不抛就算过"） | 基线输出 `invoke indexStatus 25ms → ok` + 探针 C5 拿到真实 `libs` 数据（`G:\model`，`indexed:3594`）；V4/V7 下这条会失效（但见 F-6） |

### 不能证明（含**具体举例**）

| # | 不能证明的事 | 具体例子（本轮实测） |
|---|---|---|
| **F-1** | **不能证明"合法的 thumb 请求会被接受"** | **G11**：`canonicalLibId` 恒返回 `''` ⇒ **已注册库也 404**，守卫 `EXIT=0` 全绿。守卫的 L1 正向路径**从未被断言**。 |
| **F-2** | **不能证明"404 是因为库没登记"** | 同 G11：`unregistered.status === 404` 被任何 404 满足。 |
| **F-3** | **不能证明 reveal 端口"形状对"** | `data/_r3/probe2.mjs` 把 `electron.shell.showItemInFolder` 置为 `undefined`：<br>对照组（有方法）→ `{"ok":true,...,"revealed":true}`；<br>变异组 → `{"ok":false,"error":{"code":"INTERNAL","message":"shell2.showItemInFolder is not a function",...}}`。<br>守卫的判据 `code !== 'PORT_MISSING'`（`:208`）**两组都判 PASS**。⇒ 端口"在"但坏的组合，守卫给假绿。 |
| **F-4** | **不覆盖 `webPreferences` 姿态** | G8：把 `preload: path.join(HERE, "..", "preload", "index.cjs"),` 整行注释掉 ⇒ 守卫 `EXIT=0`（渲染层拿不到 `window.api`，界面全死，无人报警）。`verify_app_build.mjs` §1c 只查 `nodeIntegration/contextIsolation/sandbox` 三项，**也不查 preload**；`devTools` 两处都不查（我的 `devTools: true → false` 变异**锚点没命中**，因为我先猜错了缩进——`out/main/index.js` 里是 **6 空格**，如实记录，该变异**未验证**）。 |
| **F-5** | **只覆盖 happy path 的一半** | 守卫对 `engine:invoke` 只测"坏来源 ⇒ `BAD_REQUEST`"与"好来源 ⇒ 不是同一个 error.message"。它**没有**断言：好来源的返回里 `data` 是什么、`indexStatus` 的字段形状、`libraryConfig` / `libraryPickDir` / `libraryAdd` 三条主进程方法的任何行为、`ingest/mutate/indexStart/indexCancel` 被显式拒绝（`index.mjs:227-231`）。 |
| **F-6** | **可信来源那条锚容易被"同文案"骗过** | `:152-156` 的判据是 `trustedCall.error.message !== untrustedFrame.error.message`。若把**非可信**分支的 `message` 改成别的字符串，这条锚会误报；反之一个"恒拒但文案不同"的实现（例如 `isTrustedSender` 换成 `() => false` 且拒绝信封改成 `message:"nope"`）能同时满足四条拒绝断言**和**这条锚。我**没有**构造这个变异【判断，非实测】，但判据本身的形状（比字符串）足以说明它在"过严/过松"两个方向上都只有很弱的判别力。 |
| **F-7** | **假 `electron` 与真 Electron 的差异会让部分断言在真环境无意义** | 三个具体例子：<br>① 桩 `FakeWC.getURL()` **硬编码** `file:///D:/app/out/renderer/index.html`，而守卫用的 `APP_URL`（`:126`）是**同一个编造路径**——两者都不是真实安装路径。因为 `isAppUrl` 是 `file://` **前缀放行**（探针 E2 实测 `file:///D:/other/app/index.html` 也 ALLOW），所以"应用自身 URL 不被拦"这个反例锚**在任何 `file://` 输入下都成立**，它**测不出**"应用根比对"是否实现。**不能外推的结论**：不能说"应用自身 URL 的识别逻辑被验证了"。<br>② 桩 `BrowserWindow` 的 `webContents` 是普通对象：**没有** `frameParent` 语义、**没有**真实 `senderFrame` 生命周期。所以"iframe 内的调用被拒"验证的是**我们传进去的假 event 形状**，不是 Chromium 的帧归属。**不能外推**：§8.1 已老实记着这条（`真窗口行为未实测`）——保持。<br>③ `nativeImage` 桩**恒 `isEmpty() = true`** ⇒ thumb 的**成功路径**在守卫里永远走不到（探针实测真机上是 415），所以守卫**天然**只能测拒绝面——这是 F-1 的结构性原因。**不能外推**：不能说"缩略图生成成功路径被覆盖"。<br>④ 桩 `shell.showItemInFolder` 是**noop**（`verify_main_wiring.mjs:87`）⇒ 守卫**无法**验证"引擎真的把绝对路径交给了壳"；我自己的探针记了 `revealCalls`（D2 有实参）——**守卫没有这一条**。 |
| **F-8** | **不做法师等级的自洽性检查** | 守卫**不检查产物新鲜度**（对照 `verify_app_build.mjs` §0b）。单独跑 `node tools/verify_main_wiring.mjs` 时，如果 `out/` 是旧的，它会对**旧产物**给出"行为全过"。本轮不存在这个问题（§0b 实测 `fresh=true`，见 N-7），但**结论依赖这一点**。 |

### 桩/清理/副作用（题面点名的三处）

| 问题 | 我的核查结果 |
|---|---|
| **假 electron 抓不到 handler 会不会"空跑全绿"？** | **不会。** `:112-123` 有前提检查，抓不到就 `exit 1`；我实测 G5（截断 `ipcMain.handle`）→ `[FAIL] 抓到了 engine:invoke 的 handler` + `前提不成立…` + `EXIT=1`。若连 `globalThis.__REC` 都没建起来（G1/G4），守卫**崩溃**（异常终止、无绿输出）。⇒ "空跑全绿"这条反驳**不成立**。 |
| **反例锚是否真的防住"全拒/全拦也能过"？** | **S12 那条是真的**（V6c 全拦 ⇒ 红）。**S13 那条是弱的**（F-6：比错误文案）。**thumb 段没有反例锚**（P-1）。 |
| **只覆盖 happy path？`engine:invoke` 可信调用断言了什么？会不会"只要不抛就算过"？** | 断言了"返回 `ok` 且**不是**那个拒绝信封"。实测它真的打到了引擎（`invoke indexStatus 25ms → ok`，返回真实 `libs`）。所以**不是**"不抛就算过"；但它**对返回内容的形状零断言**（F-5）。 |
| **清理临时目录了吗（`data/_verify_main_wiring`）？会不会污染 `data/` 或真实 `userData`？** | **清理了**：`:214` 收尾 `fs.rmSync(TMP,…)`，前提失败路径 `:121` 也清了。实测：跑完守卫后 `Test-Path data/_verify_main_wiring` = **False**（G4 的"不写桩"路径下也是 False）。`userData` 被桩指向 `TMP/userData`（`:53`、`:67`），**不会**碰真实用户目录；`libraryAdd` 才写注册表，守卫从不调用它。⚠️ **有一个既有副作用**：产物里的 `log.mjs` 会写 `data/_app.log`（我 17:40 那次守卫运行把它更新到 2047 B）——这是应用本身的设计（`AGENTS.md` §7），不是守卫新增的污染，但它确实是"跑守卫会动 `data/`"。 |
| **`delete process.env.ELECTRON_RUN_AS_NODE` 会不会影响同一进程里别的断言？守卫失败时会不会留垃圾？** | 守卫是**独立进程**，该赋值只影响它自己 ⇒ 不影响别的守卫。在**本进程内**它的作用是必要的（否则产物 `index.mjs:52-72` 会 `spawn` 一个自身再 `exit(0)`，守卫就什么也抓不到）。**副作用**：它同时让 `data/_app.log` 里永远看到 `ELECTRON_RUN_AS_NODE = null`（日志基线漂移），并且产物会在守卫跑完后再去**载 ONNX 模型**（`index.mjs:522` 的 `setTimeout(…,1500)` + 动态 import `encoder.mjs`）——我的输出里每次都能看到：<br>`[09:36:07.751] 载入完成 2.7s · device=webgpu`<br>这**延长了守卫进程的存活时间**（守卫本体 09:36:03→05 已打印完结论，进程到 07.7 才退出），也**必然加载一次模型**。不是垃圾，但是"跑守卫要 2–3 秒、且会预热 GPU"的真实代价。**失败时**：`exit(1)` 发生在 `:214` 的清理**之后**，所以不留临时目录。 |
| **`thumbFailureStatus({})` 返回 400：设计还是巧合？** | **是设计**（并且单测把它钉住了）。`thumb-url.mjs:91` 的 `= {}` 默认参数 + `:92` 的 `if (!shapeOk) return 400` ⇒ 空对象落到"形状不合法 ⇒ 400"；`permissions.test.mjs:161` 显式断言 `thumbFailureStatus({}) === 400`，注释写"空对象按'形状不合法'处理（fail closed）"。**但语义上我保留意见**（非 blocker）：`{}` 更像"调用方写错了参数"（应为 `INTERNAL`），现在被归成"形状错"，是**恰好**fail-closed。真实调用点 `index.mjs:358` 恒传 `shapeOk: p.ok`（布尔），所以生产上无所谓；风险在**将来**有人用 `thumbFailureStatus(otherObject)`。 |
| **`verify_app_build` 有没有"只有 reject 面"的同型问题？** | **有**（但比 `verify_main_wiring` 轻）：§0b 的 `newestMtime` 空目录返回 `0` 是**偏红**（保守）；真正偏绿的是"配置类构建输入不在扫描集"（N-7.1）。 |

---

## 16 条逐条判定（**不接受表格措辞，我自己的分类**）

分类口径：**行为** = 真的执行被测代码并断言输入→输出；**结构/文本** = 只看产物文本或符号存在；**纯单测** = 在隔离模块上执行（我会标明"单测行为"或"单测恒真风险"）。

| # | 载体（命令 + 位置） | 我的判定 | 依据 / 缺口 |
|---|---|---|---|
| S1 | `npm test` · `permissions.test.mjs:28-38` | ✅ 单测行为 | `validateCall` 真被调用，含反例锚（`:36`）。与"接线"无关，但 S1 的期望本来就是参数层。 |
| S2 | `npm test` · `permissions.test.mjs:40-49` | ✅ 单测行为 | 同上。 |
| S3 | `npm test` · `permissions.test.mjs:51-71` | ✅ 单测行为 | 10 坏形状 + 2 反例锚。 |
| S4 | ①`npm test` S4(S4b/S4c)：解析层 + 计数 io；②`verify_main_wiring.mjs:192-193`：**行为**但只测状态码 | ⚠️ **混合；行为面缺 fs 观测** | 单测的"零读取"有 R2 的 N-2 未闭合（`getBuiltinModule` 绕开 io）；产物层只断言 400，**没有**任何读取计数。 |
| S5 | ①`npm test` S5（9 坏 size + 3 白名单值）；②`verify_main_wiring.mjs:188-189` | ✅ 行为（**只 reject 面**） | `@999 ⇒ 400` 实测成立（探针 B）。缺"白名单值 @256 不被 400 拒"的断言 ⇒ 见 **P-1**。 |
| S6 | ①`npm test` S6/S6b；②`verify_main_wiring.mjs:194-196`：**真调用 handler** | ✅ 行为（**B2 的调用点断言，真的成立**） | V1/V2 红；但 404 语义可被"全 404"满足 ⇒ **P-1**。 |
| S7 | `npm test` · `engine/tests/security.test.mjs` | ✅ 单测行为（**本轮未重验**） | 沿用 R2；不在本轮范围。 |
| S8 | 同 S7（junction 真跑；文件 symlink 跳过） | ✅ 单测行为 + 1 条如实跳过 | `npm test` 基线 `skipped 1` 与之一致。 |
| S9 | ①`verify_app_build.mjs` §2b（**结构**）：暴露面恰好三键 + 值位置整对象外泄；②`verify_renderer_dom.mjs` §11（**jsdom**）：`require`/`module` undefined + `process` 无危险能力 | ❌ **全程没有一次真实执行 preload** | 我核对了四个守卫：**没有任何一个 `require`/`import` `out/preload/index.cjs`**（`verify_app_build.mjs` 只是 `readFileSync` 成文本）。`verify_renderer_dom.mjs` 自己也在 `:437` 写明"`window.api` 是**守卫自己造的 mock**"。⇒ S9 的期望（`typeof window.require === 'undefined'`）在本仓库**没有被真正测过**。 |
| S10 | `verify_renderer_dom.mjs` §12（jsdom，**真渲染**） | ⚠️ **行为（DOM 层）**，另一半个案已知不可证 | `:494-508` 的 4 条断言是真的（uid 定位 + `innerHTML` 实体）。"无脚本执行"**已主动删除并写明**（`:510-519`）⇒ 诚实。 |
| S11 | ①`npm test` · `window-security.test.mjs`；②`verify_main_wiring.mjs:160-163`（**真调用回调**） | ✅ **行为（本轮最强的一条）** | V5/V5b 红。 |
| S12 | ①`npm test`；②`verify_main_wiring.mjs:167-176`（**真调用 + 双向锚**） | ✅ **行为（且反例锚有效，V6c 红）** | 唯一保留：`file://` 前缀放行（探针 E2 实测），文档已在 §8.1 记明。 |
| S13 | ①`npm test` · `window-security.test.mjs`（决策）；②`verify_main_wiring.mjs:135-156`（**真调用 handler**） | ✅ 行为（reject 面强；accept 锚弱） | V7/V4/G6 红。但 F-6：可信锚只比 `error.message`。 |
| S14 | `npm test` · `permissions.test.mjs:73-96` | ✅ 单测行为 | 尺寸闸门 + 边界不误判是互锚的一对（`:81` vs `:87`）。 |
| S15 | `npm test` · 引擎测试 | ✅ 单测行为（**本轮未重验**） | 沿用 R2。 |
| S16 | `npm test` · 指纹/只读 | ✅ 单测行为（**本轮未重验**） | 基线输出里指纹测试真跑（`271ms`，`3c62f15c5944`）。 |

**统计（我的口径）**：真·**行为**覆盖 = **S4（半）/ S5（半）/ S6（半）/ S10 / S11 / S12 / S13**；**纯单测** = S1/S2/S3/S7/S8/S14/S15/S16；**没有一次真实执行 = S9**。
⇒ `SPEC-security.md:297` 的「本表 16 条**全部**有自动化断言」在**字面**上勉强成立（每条都挂了某个检查），但在**举证力**上不成立：**S9 完全没测过它所声称的对象，S4/S5/S6 的产物层只有 reject 面，而 P-1 说明这个缺口是可被利用的**。

---

## 主动反驳（≥2 处；尽量找**新的**同类问题）

1. **P-1（新）**：thumb 段只有 reject 面 ⇒ "全 404"全绿（G11）。**这是本轮最重要的新发现**，性质与 B2 同构。
2. **P-2（新，文档/规格与产品不一致 —— N-6 的镜像）**：`docs/spec/SPEC-security.md:343` 仍写"已拆开为 **404**"，而现实现是"形状错 ⇒ **400**、库没登记 ⇒ 404"。更麻烦的是 **§3 的规则表有歧义**：`:85`（libId 不在注册表 ⇒ 404）与 `:86`（uid 形状错 ⇒ 400）对 `thumb://L9/not-a-uid@256` 这类**同时违反两条**的请求**没有优先级**，而实现把"形状"放在第一位。实测：
   ```text
   thumb://R3/          → 400   （R3 未注册 + 路径形状空 ⇒ 实现取 400）
   thumb://L9/<合法uid>@256 → 404
   ```
   ⇒ 这不是安全缺陷，但**契约有两处说法**（`AGENTS.md` §4 的头号纪律）。建议：在 §3 表加一行"**优先级：形状/尺寸先于库登记；同时违反时返回 400**"，并修正 `:343`。
3. **P-3（新）**：**`SPEC-security.md:112` 的"页面来源"描述与代码不符**。规格写
   > `senderFrame.url` 必须是应用自身：开发态 `http://localhost:<port>`，生产态 `app://…` 或 `file://…` 的**应用根**

   而 `window-security.mjs` 的 `isAppUrl` 是 `startsWith('file://')` **前缀**放行（§8.1 自己承认），`app://` 在本仓库**根本没有出现**（`main/index.mjs:411、488-489` 用的是 `out/renderer/index.html` 的 `file://`）。探针实测 `file:///D:/other/app/index.html` 与 `file:///C:/Windows/.../hosts` 都 ALLOW。而 `verify_main_wiring.mjs` 的"应用自身 URL"反例锚（`:126`、`:176`）用的正是**编造路径** `file:///D:/app/out/renderer/index.html`——因为前缀放行，这条锚**在任何 `file://` 下都成立**（F-7①）。⇒ 规格第 4 节需要写清"当前实现是 scheme 前缀放行"，不能只在 §8.1 里补记。
4. **P-4（新，轻）**：`tools/verify_main_wiring.mjs` **untracked**（`git ls-files` 不认）且 mtime 比我的复核只早 9 秒。"它抓到过 6 种绕过"这句**无法独立验证**：① 该文件无版本历史；② 注释（`:6-10`）只列了 **4** 种（N-5 / B3 / N-1 / B2），不是 6 种。我这轮独立构造了 **16 个产物级变异 + 5 个守卫自变异**，能确认的是"**它现在**能抓到 B2/B3/N-1/N-5 四种以及另外 8 种"，**不能确认**"历史上抓到过 6 种"。建议把该说法改成"本轮可复现的抓取清单"，并把守卫纳入版本控制。

---

## reversals（我的变异 + 还原证据）

所有产物级变异都是**单行值/条件改动**（**未动任何括号结构**），`out/` 上的变异按任务书允许并**全部还原**（下表逐个给哈希）。

| # | 层次 | 变异（目标 → 改动） | 期望 | 实测 | 还原 |
|---|---|---|---|---|---|
| V1 | 产物 `out/main/index.js` | `thumbFailureStatus`：`if (!shapeOk) return 400;` → `200` | 必须红 | ✖ 红 3 条（S5 / S5-S4 / S4），`EXIT=1` | ✔ `ca5a14f14d92efd5` |
| V2 | 产物 | 调用点：`const status = thumbFailureStatus({…});` → `const status = 404;` | 必须红 | ✖ 红 3 条，`EXIT=1` | ✔ 同上 |
| V3 | 产物 | `ALLOWED_SIZE = new Set([128,256,512])` → `new Set([999])` | 必须红 | ✖ 红 2 条（`@999` 变 415、`L9@256` 变 400），`EXIT=1` | ✔ 同上 |
| V4 | 产物 | `if (!isTrustedSender(event))` → **取反** | 必须红 | ✖ 红 4 条（四条拒绝全变 `ok:true`，**可信锚仍 OK**），`EXIT=1` | ✔ 同上 |
| V5 | 产物 | `setWindowOpenHandler(() => decideWindowOpen())` → `({ action: "allow" })` | 必须红 | ✖ 红 3 条，`EXIT=1` | ✔ 同上 |
| V5b | 产物 | 同上 → `(false && decideWindowOpen()) \|\| { action: "allow" }` | 必须红 | ✖ 红 3 条，`EXIT=1` | ✔ 同上 |
| V6b | 产物 | `if (!decideNavigation(url, DEV_RENDERER_URL))` → `if (false)` | 必须红 | ✖ 红 3 条，`EXIT=1` | ✔ 同上 |
| V6c | 产物 | 同上 → `if (true)`（**全拦**） | **必须红（反例锚）** | ✖ 红 **反例锚 1 条**，`EXIT=1` | ✔ 同上 |
| V7 | 产物 | `if (!isTrustedSender(event))` → `if (false)` | 必须红 | ✖ 红 4 条，`EXIT=1` | ✔ 同上 |
| V9b | 产物 | `shell: createRevealPort(shell)` → `…, shell: null` | 必须红 | ✖（`PORT_MISSING`）见 §previous_blockers N-5 | ✔ 同上 |
| V15 | 产物 | 同上 → `shell: createRevealPort(undefined)` | 应红（端口坏） | ⚠️ **绿 `EXIT=0`** ⇒ F-3 | ✔ 同上 |
| V16 | 产物 | `handleThumb` 开头强制 `return new Response("blocked",{status:404})` | 必须红 | ✖ 红 3 条，`EXIT=1` | ✔ 同上 |
| G2 | 产物 | `setWindowOpenHandler(() => decideWindowOpen())` → `({ action: "deny" })`（**形状错**） | 应红 | ⚠️ **绿 `EXIT=0`** ⇒ 守卫 `action === 'deny'` 的 OBSERVED 不敏感 | ✔ 同上 |
| G3 | 产物 | 额外再注册一次 `setWindowOpenHandler(allow)` | 应红 | ✖ 红（`注册了 1 次 — 实际 2 次`），`EXIT=1` | ✔ 同上 |
| G5 | 产物 | `registerIpc()` 开头 `return;` | 应红 | ✖ 红（抓不到 `engine:invoke`）+ `前提不成立`，`EXIT=1` | ✔ 同上 |
| G6 | 产物 | 拒绝信封 `code: "BAD_REQUEST"` → `"INTERNAL"` | 应红 | ✖ 红 1 条，`EXIT=1` | ✔ 同上 |
| G8 | 产物 | 注释掉 `preload: path.join(HERE,…)` 整行 | 应红 | ⚠️ **绿 `EXIT=0`** ⇒ F-4 | ✔ 同上 |
| G10 | 产物 | 端口内 `shell2.showItemInFolder(absPath);` → `void absPath;` | 应红 | ⚠️ **绿 `EXIT=0`** ⇒ F-7④ | ✔ 同上 |
| **G11** | 产物 | `canonicalLibId`：`if (!engine)` → `if (true) return ""` | 应红（全 404） | ❌ **绿 `EXIT=0` 全绿** ⇒ **P-1** | ✔ 同上 |
| G1/G4 | 守卫自变异（跑 `tools/_r3_guard_dup.mjs` 副本） | 去掉 `globalThis.__REC` 赋值 / 不写 electron 桩 | 必须红 | ✖ **崩溃**（`TypeError: Cannot read properties of undefined (reading 'handlers')`；`node.exe` 异常终止）⇒ S-6 | ✔ 副本已删；原守卫 `b84eb68de89a28f3` |
| N4 | 产物 `out/preload/index.cjs` | `platform: process.platform` → `platform: process` | 必须红 | ✖ 红 1 条（`S9：暴露面的值里没有把 process…整个对象交出去`），`EXIT=1` | ✔ `70e0be6e54223181` |
| — | 只读探针 | `data/_r3/probe.mjs`（真调用 handler，自写断言） | 交叉核对 | 见 §0.1 | 无变异；`data/_r3/probe_tmp` 已清 |
| — | 只读探针 | `data/_r3/probe2.mjs`（`shell.showItemInFolder` 缺失 vs 存在） | 证伪 reveal 断言 | 变异组 `INTERNAL`，守卫判据仍 PASS ⇒ **F-3** | 无变异；`probe2_tmp` 已清 |
| — | 只读复刻 | `verify_app_build.mjs` §0b 的扫描集与 mtime 比较 | 核对 N-7 | `fresh=true`；三端 + tokens.css 都进了；配置类输入未进 | 无变异 |
| — | G7（devTools） | 尝试 `devTools: true,` → `false` | 应红 | ⚠️ **锚点 0 次，未验证**（我猜错了缩进：产物里是 6 空格） | 无变异 |
| — | G9（CH_EVENT） | 试图"删掉事件通道" | 无意义 | 探针 A1 实测：`ipcMain.handle` **只注册了 `engine:invoke`**（事件通道本来就是 `send`，不是 `handle`）⇒ **该变异不成立**，如实记为"锚点无意义" | 无变异 |

**还原证据（复核结束时逐个核对，原始输出）**：

```text
ca5a14f14d92efd5  out/main/index.js                 （= 复核开始时的值）
70e0be6e54223181  out/preload/index.cjs
b84eb68de89a28f3  tools/verify_main_wiring.mjs      （复核期间从未变过）
a8f38b5aa3157f8b  apps/desktop/src/main/index.mjs   （未被本轮改动）
696e95a3a548d259  apps/desktop/src/main/thumb-url.mjs
be6a5a02bc9531f6  tools/verify_app_build.mjs
```

**还原后复跑（确认树是干净的）**：

```text
verify_main_wiring EXIT=0
verify_app_build  EXIT=0
verify_renderer_dom EXIT=0
```

**残留核对**：`tools/_r3_guard_dup*.mjs` 已删（`Get-ChildItem tools -Filter '_r3*'` 空）；`data/_verify_main_wiring`、`data/_r3/probe_tmp`、`data/_r3/probe2_tmp` 均不存在。
**mtime 提醒**：`out/main/index.js` 的 mtime 被我的一轮轮"写→还原"推到了 17:40（内容逐字节相同）。`out/` 不进 git；§0b 的新鲜度判定仍为 `fresh=true`（产物比源码新），**不受影响**。

`git status --porcelain`（复核结束时，与开始时**逐行一致**）：

```text
 M AGENTS.md
 M apps/desktop/src/main/index.mjs
 M docs/DEBT-CLEANUP.md
 M docs/plan/ROADMAP.md
 M docs/spec/SPEC-security.md
 M tools/verify_app_build.mjs
 M tools/verify_renderer_dom.mjs
?? apps/desktop/src/main/thumb-url.mjs
?? apps/desktop/src/main/window-security.mjs
?? apps/desktop/tests/permissions.test.mjs
?? apps/desktop/tests/window-security.test.mjs
?? docs/audit/REVIEW-PERMISSIONS-R2.md
?? docs/audit/REVIEW-PERMISSIONS.md
?? tools/verify_main_wiring.mjs
```

---

## limits（未验证的，如实标）

1. **源码级变异 + `npm run build` 未验证（本轮实测：跑不了）。** 原始输出：
   ```text
   $ npm run build
   > electron-vite build
   failed to load config from D:\USERS\Desktop\Agent\gemma-search\electron.vite.config.mjs
   error during build:
   Error: spawn EPERM
       at ensureServiceIsRunning (node_modules\esbuild\lib\main.js:1978:29)
       at bundleConfigFile (node_modules\electron-vite\dist\chunks\lib-q6ns0vZr.js:1710:26)
   EXIT_BUILD=1
   ```
   失败点在**加载配置之前**（esbuild 要起常驻服务进程）⇒ **不是配置/代码问题**。`out/main/index.js` 的哈希在前后**完全一致**（`ca5a14f14d92efd5`）。
   ⇒ 因此：**题面要求的"源码级变异（改源码 → build → 跑守卫）本轮无法完成，如实标"源码级未验证"**。全部变异都在**产物级**（`out/`）或**守卫副本**上完成。
   附带发现（供作者注意）：**主进程产物已经把引擎内联进来了**（`out/main/index.js` 里 `function createEngine` 出现 1 次、`packages/engine` 字符串 1 处，且 `import` 列表里**没有** `packages/engine/...`）——所以"改引擎源码但没重建"**不会**影响守卫读到的行为；能影响它的是 `out/main/index.js` 本身。
2. **真 Electron 窗口行为仍未验证**（`window.open` 真被 deny？iframe 内 invoke 真被拒？真沙箱里的 preload 暴露了什么？）——本环境起不了 Electron，没有跑 `smoke_app.mjs`。所有"行为"结论都局限在**假 electron + 假 webContents** 的世界里（见 F-7）。
3. **S7/S8/S15/S16（引擎侧）本轮未重验**，沿用 R2 结论。B1 也未重跑 R2 的 R1/R2 变异。
4. **F-6 的"恒拒但换文案"变异我没有构造**（标注【判断，非实测】）；**G7（devTools）锚点没命中**（缩进猜错），**"+20 观察：我不确定 `devTools: false` 会不会被任何守卫抓到"——标为未验证**。
5. **`data/_r3/probe2.mjs` 的"端口形状坏"是桩级证据**：它证明的是"当 `shell.showItemInFolder` 缺失时，引擎回 `INTERNAL`，而守卫的判据照样 PASS"。我**没有**在真实产品里制造"端口存在但坏"的场景（那正是 `createRevealPort(undefined)` 的 V15，已在产物级跑过 ⇒ 结论一致）。
6. **"它抓到过 6 种绕过"无法验证**（该文件 untracked，无历史）。我只能给出**本轮可复现**的清单。

---

## 处置建议（按优先级；给作者，不代表我已验证修法）

1. **P-1 必须闭合**：给 thumb 段加**正向锚**（已注册库 + 白名单尺寸 ⇒ 不得 400/404；库不在本机时**显式 skip 并打印**），并把 `L9 ⇒ 404` 与 `L1 ⇒ 非 404` 配成一对。没有正向锚的"拒绝面断言"就是本轮 B2 的翻版。
2. **P-2/P-3**：修 `SPEC-security.md:343` 的行为叙述；在 §3 表补"形状优先于库登记"的优先级；把 §4 的"页面来源"改成与 `isAppUrl` 实际一致（`file://` 前缀放行），别只写在 §8.1。
3. **F-3**：把 reveal 断言从 `code !== 'PORT_MISSING'` 改成**看实参**——守卫应记录 `shell.showItemInFolder` 收到的路径（我的 `data/_r3/probe.mjs` 已经这么做了：`revealCalls`），并断言它与引擎返回的 `data.path` 一致。
4. **F-4**：`verify_main_wiring.mjs` 补 `webPreferences` 姿态断言（至少 `preload` 指向的文件存在且非空、`nodeIntegration/contextIsolation/sandbox/devTools` 与 §5/§9 决定一致）；`verify_app_build.mjs` §1c 也补 `preload`。
5. **N-8**：把 `verify_renderer_dom.mjs:447/449` 的两条 `ok(true, …)` 改成 `console.log`（说明性输出不该计入通过数）。
6. **流程**：`tools/verify_main_wiring.mjs` **入 git**；复核前**冻结树**（本轮该文件在我开始前 9 秒被写过，且无历史可比）。
7. **N-7 收尾**：把 `electron.vite.config.mjs` / `package.json` / `tsconfig*.json` 也纳入 §0b 的扫描集（它们同样是"会被打进产物"的输入）。

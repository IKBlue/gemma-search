# G-D · 断言的**双向验证**记录 —— 2026-10-13

> 判据：**把防线拆掉，断言必须变红。** 只写断言不做这一步，就无法区分"防住了"与"根本没测到"。
> 本文件里每一例都是：`注入 → 跑 → 变红`、`还原 → 跑 → 变绿`，输出为命令**直接落盘**的原文。

## 注入器（复现方式）

本文件的 5 例由 `data/_bidir-all.mjs`（**一次性工具，未入库**）驱动。
它的每个 case 都显式写出 old→new 两段文本，见下表；照着改文件等价。

- 采集时刻：2026-10-13 15:07:51 +08:00

| 例 | 文件 | 注入（把 good 换成 bad） |
|---|---|---|
| IA1 | `apps/desktop/src/renderer/src/utils/index-state.js` | 把 `changed→stale` 提到 `exists→removed` **之前** |
| T2 | `apps/desktop/src/renderer/src/store/tasks.js` | `Math.max(state.done, evt.done)` → `evt.done` |
| S13/S14/S16 | `apps/desktop/tests/helpers/source-scan.mjs` | 插值处理完后 `continue` → `i = j; break`（复现旧缺陷：回主循环） |
| S15 | `apps/desktop/src/shared/ipc.ts` | `uid: Uid.optional()` → `uid: Uid`（改回必填） |
| E10-f | `apps/desktop/src/renderer/src/pages/TasksPage.jsx` | 空态提示改回抄引擎原文「这个功能还没做好」 |


## IA1 · 索引状态四档：removed 必须优先于 stale

### ① 注入防线（期望**变红**）

```text
  已注入：apps/desktop/src/renderer/src/utils/index-state.js
node --test --test-isolation=none apps/desktop/tests/item-actions.test.mjs
# EXIT=1   ← 期望非 0
✖ IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale` (1.5529ms)
✔ IA1b 四档的文案与提示都在唯一的定义处（不许散落到组件里） (0.251ms)
✔ IA1c `needsScanToDecide`：能当场判定的不该说"要扫"；盘上没了的也不必扫 (0.1437ms)
✔ IA2 ⭐ 四分区**永远都在**，且分区名与规格逐字一致（UI-REVIEW:236） (0.7105ms)
✔ IA2b ⭐ 规格要求「把是否需重编码标在按钮上」—— 每个动作都带这个标志与角标 (0.2882ms)
✔ IA2c `disabled` 为真时 `reason` 必须非空（不能有"点不动又不说为什么"的按钮） (0.1703ms)
✔ IA2d 「重新编码」：**需要与否**与**能否点**是两件事（我第一版混为一谈） (0.2346ms)
✔ IA2e 盘上没了的条目：取件/改 ID/移出库都不可点（理由都是"文件不在盘上"） (0.1428ms)
✔ IA3 ⭐⭐ 界面上的"有没有后端"必须与 `ipc.ts` 的白名单**逐条对上**（防漂移） (1.791ms)
✔ IA3b 反过来：`mutate` 白名单里的每个 op，界面上都要有对应的动作（或有据不显示） (0.7957ms)
ℹ tests 10
ℹ suites 0
ℹ pass 9
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23.7671

✖ failing tests:

test at apps\desktop\tests\item-actions.test.mjs:31:1
✖ IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale` (1.5529ms)
  AssertionError [ERR_ASSERTION]: removed 必须优先于 stale —— 判定顺序是有意的
  
  'stale' !== 'removed'
  
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/item-actions.test.mjs:41:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.start (node:internal/test_runner/test:1015:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:358:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'stale',
    expected: 'removed',
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### ② 还原防线（期望**变绿**）

```text
  已还原：apps/desktop/src/renderer/src/utils/index-state.js
node --test --test-isolation=none apps/desktop/tests/item-actions.test.mjs
# EXIT=0   ← 期望 0
ℹ tests 10 | ℹ pass 10 | ℹ fail 0
```

## T2 · 进度 done 单调不减

### ① 注入防线（期望**变红**）

```text
  已注入：apps/desktop/src/renderer/src/store/tasks.js
node --test --test-isolation=none apps/desktop/tests/task-store.test.mjs
# EXIT=1   ← 期望非 0
✔ T1 进度事件把 done/total/条每秒/ETA/阶段都写进状态 (0.9962ms)
✖ T2 ⭐ `done` **单调不减** —— 迟到/乱序的进度不许把进度条往回拨（契约 §3） (0.713ms)
✔ T3 ⭐ GPU 回退**必须留住并显示**（契约 §3「不静默」） (0.7502ms)
✔ T3b 续跑说明同样要留住（引擎只在第一条事件里说明复用多少） (0.1999ms)
✔ T4 ⭐ 失败清单**不静默**：非空 ⇒ `ok:false`，每项可解释（契约 §3） (0.6452ms)
✔ T4b 取消收尾：`cancelled` 要留痕，且 done 停在取消时的值 (0.1265ms)
✔ T4c `index.failed` 收尾：留下错误信封，且 userMessage 非空（界面要显示它） (0.1071ms)
✔ T5 ⭐ 认不出的**阶段**原样显示、不崩（契约只举了 3 个阶段，规格要 5 个） (0.1392ms)
✔ T5b 认不出的**事件类型**不崩、也不假装处理过（只记进日志） (0.1402ms)
✔ T5c `total` 未知时百分比返回 **null**（显示不确定进度），不编一个数 (0.1909ms)
✔ T5d `etaSec` 缺失写 "—"，**不本地估算**（ETA 是引擎算的，契约 §3） (0.1323ms)
✔ T6 `begin` 把状态清干净并标记已发起（避免上一次的失败项残留） (0.1322ms)
✔ T7 日志有上限（长任务跑几千条进度也不能无限涨内存） (0.8732ms)
ℹ tests 13
ℹ suites 0
ℹ pass 12
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 30.9731

✖ failing tests:

test at apps\desktop\tests\task-store.test.mjs:36:1
✖ T2 ⭐ `done` **单调不减** —— 迟到/乱序的进度不许把进度条往回拨（契约 §3） (0.713ms)
  AssertionError [ERR_ASSERTION]: 迟到的较低 done 必须被忽略 —— 否则进度条会被往回拨
  
  25 !== 40
  
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/task-store.test.mjs:44:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 25,
    expected: 40,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### ② 还原防线（期望**变绿**）

```text
  已还原：apps/desktop/src/renderer/src/store/tasks.js
node --test --test-isolation=none apps/desktop/tests/task-store.test.mjs
# EXIT=0   ← 期望 0
ℹ tests 13 | ℹ pass 13 | ℹ fail 0
```

## S13/S14/S16 · 扫描器：模板插值之后不得失步

### ① 注入防线（期望**变红**）

```text
  已注入：apps/desktop/tests/helpers/source-scan.mjs
node --test --test-isolation=none apps/desktop/tests/source-scan.test.mjs
# EXIT=1   ← 期望非 0
✔ S1：注释里的 `window.api` **不算**（行注释 / 块注释 / 多行块注释） (1.028ms)
✔ S2：⭐ 被**注释掉**的接线不算（反向陷阱：注释掉一行是禁用接线的常见手法） (0.1293ms)
✔ S3：字符串 / 模板字面量里的不算；但**模板插值里的算** (0.1534ms)
✔ S4：⭐ 含引号的正则字面量之后仍能正确识别（当年栽过的那条） (0.2575ms)
✔ S5：除法不被误判成正则起始 (0.1146ms)
✔ S6：行号准确（多行块注释不能把行号带偏） (0.1024ms)
✔ S7：maskNonCode 与原串**等长同结构**（否则行号与列号会全错） (0.1214ms)
✔ S8：真正的代码**必须**被找到（否则检查会静默通过 —— 这是最危险的方向） (0.1147ms)
✔ S9：⭐ 字符串里的色值 maskComments **能找到**、而 maskNonCode **找不到** (0.2623ms)
✔ S10：maskComments 仍然正确跳过注释（两类注释都要） (0.2019ms)
✔ S11：maskComments 不会把字符串里的 `//` 当成行注释（URL 用例） (0.1092ms)
✔ S12：maskComments 与原串**等长同结构**（行号才不会错） (0.785ms)
✖ S13 ⭐⭐ maskNonCode：模板插值**之后**的代码仍被识别（旧版从此整段失明） (0.6974ms)
✖ S14 ⭐⭐ maskNonCode：注释里的**反引号**不得漏出来（旧版会漏 ⇒ 假阳性） (0.4548ms)
✔ S15 插值里的**字符串**按 maskStrings 走：maskNonCode 抹、maskComments 保留 (0.1732ms)
✖ S16 插值里含嵌套花括号/字符串/切片时，配平仍然正确 (0.1546ms)
✔ S16b 未闭合的模板不会把文件"吞掉"到越界（健壮性） (0.0721ms)
ℹ tests 17
ℹ suites 0
ℹ pass 14
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24.8316

✖ failing tests:

test at apps\desktop\tests\source-scan.test.mjs:115:1
✖ S13 ⭐⭐ maskNonCode：模板插值**之后**的代码仍被识别（旧版从此整段失明） (0.6974ms)
  AssertionError [ERR_ASSERTION]: 模板之后的**代码骨架**必须保留 —— 丢了就说明扫描器失步了
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/source-scan.test.mjs:123:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'const s = ` ${x}b`\n                   \n',
    expected: /const c =/,
    operator: 'match',
    diff: 'simple'
  }

test at apps\desktop\tests\source-scan.test.mjs:134:1
✖ S14 ⭐⭐ maskNonCode：注释里的**反引号**不得漏出来（旧版会漏 ⇒ 假阳性） (0.4548ms)
  AssertionError [ERR_ASSERTION]: 模板之后那行注释里的内容同样不许漏出来
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/source-scan.test.mjs:149:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at apps\desktop\tests\source-scan.test.mjs:163:1
✖ S16 插值里含嵌套花括号/字符串/切片时，配平仍然正确 (0.1546ms)
  AssertionError [ERR_ASSERTION]: 插值里的 "}" 不该提前结束插值，后面的代码仍要可见
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/source-scan.test.mjs:166:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'const s = ` ${ {k: " "} }b`\n           \n',
    expected: /const c = 1/,
    operator: 'match',
    diff: 'simple'
  }
```

### ② 还原防线（期望**变绿**）

```text
  已还原：apps/desktop/tests/helpers/source-scan.mjs
node --test --test-isolation=none apps/desktop/tests/source-scan.test.mjs
# EXIT=0   ← 期望 0
ℹ tests 17 | ℹ pass 17 | ℹ fail 0
```

## S15 · mutate 的 uid：undo 可选、其余必填

### ① 注入防线（期望**变红**）

```text
  已注入：apps/desktop/src/shared/ipc.ts
node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
# EXIT=1   ← 期望非 0
✔ S1：未登记的方法一律拒绝（含 `exec` 这种明显的逃逸尝试） (2.8526ms)
✔ S2：已知方法传未知字段被拒（zod .strict()，不是"忽略多余字段"） (1.8003ms)
✔ S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id） (0.7838ms)
✔ S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行 (1.5864ms)
✔ S14b：参数无法序列化（循环引用）时拒绝，而不是抛异常给调用方 (0.185ms)
✔ S5：size 只认白名单 128/256/512，@999 之类一律 400 (0.8705ms)
✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明） (0.4633ms)
✔ S6：失败状态码映射 —— 形状/尺寸错 ⇒ 400；库无法还原 ⇒ 404（可执行契约） (0.2525ms)
✔ S4b：形状不合法的一律拒（uid 不是 12 位 hex、缺 @、多段路径、host 为空、非法 URL） (0.1697ms)
✔ S4c：路径里的 `?query` 与 `#fragment` 不影响形状判定（不构成绕过） (0.1655ms)
✔ S6：未注册的库 ⇒ 无法还原 libId ⇒ 空串（调用方给 404） (0.1488ms)
✔ S6b：libId 还原器缓存映射，但**绝不缓存"索引未就绪"（空列表）** (0.2298ms)
✔ thumb:// 的合法形状能正常解出三要素（防止"全拒"骗过上面所有用例） (0.0834ms)
✖ S15 ⭐ `mutate`：`undo` **不需要** uid，其余 op **必须**带 —— 两头都要断言 (1.2908ms)
✔ S16 ⭐ `transactions` 已登记进白名单，且 `txId`/`limit` 有边界（契约 §2.11） (0.6752ms)
ℹ tests 15
ℹ suites 0
ℹ pass 14
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 126.4037

✖ failing tests:

test at apps\desktop\tests\permissions.test.mjs:259:1
✖ S15 ⭐ `mutate`：`undo` **不需要** uid，其余 op **必须**带 —— 两头都要断言 (1.2908ms)
  AssertionError [ERR_ASSERTION]: undo 不该要求 uid：uid: Invalid input: expected string, received undefined
  
  false !== true
  
      at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/permissions.test.mjs:266:10)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### ② 还原防线（期望**变绿**）

```text
  已还原：apps/desktop/src/shared/ipc.ts
node --test --test-isolation=none apps/desktop/tests/permissions.test.mjs
# EXIT=0   ← 期望 0
ℹ tests 15 | ℹ pass 15 | ℹ fail 0
```

## E10-f · 界面文案不得抄引擎原文（靶子必须唯一）

> 背景：这条断言原先写 `getByText(/这个功能还没做好/)`，而空态提示里**也**有同一句话 ⇒
> 负载高时报 strict mode violation、负载低时只命中提示而**假绿**。
> 修法：靶子改成唯一的 `#toast`，并加一条回归断言禁止界面抄那句话。
> 注意：**必须整套 E2E 才复现**（单独跑该用例一直是绿的）—— 所以这里注入后只跑 E10-f 即可看到回归断言变红。

### ① 注入（界面抄回引擎原文，期望**变红**）

```text
  已注入：apps/desktop/src/renderer/src/pages/TasksPage.jsx
npm run build   # 需先构建，E2E 跑的是 out/ 产物
npx playwright test -c apps/desktop/e2e/playwright.config.mjs tasks.spec.mjs -g "E10-f" --reporter=list
# EXIT=1   ← 期望非 0
  x  1 apps\desktop\e2e\tasks.spec.mjs:148:1 › E10-f ⭐ 真实模式点「开始索引」⇒ **如实报"还没做好"**，不假装在跑 (11.8s)
    Error: expect(locator).not.toContainText(expected) failed
    Expected substring: not "这个功能还没做好"
    Received string: "还没有跑过任务。点「开始索引」；真实模式下引擎会如实回答「这个功能还没做好」 —— 点一下就知道当前是什么状态。想在本地看完整流程（阶段条 / 进度 / 失败项 / 取消 / GPU 回退）， 用模拟模式：GEMMA_FAKE=1 npm run dev。"
  1 failed
```

### ② 还原（期望**变绿**）

```text
  已还原：apps/desktop/src/renderer/src/pages/TasksPage.jsx
npm run build
npx playwright test … -g "E10-f"
# EXIT=0   ← 期望 0
  ok 1 apps\desktop\e2e\tasks.spec.mjs:148:1 › E10-f ⭐ 真实模式点「开始索引」⇒ **如实报"还没做好"**，不假装在跑 (2.3s)
  1 passed (2.8s)
```

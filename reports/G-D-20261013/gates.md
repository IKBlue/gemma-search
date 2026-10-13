# G-D · P3（P3a–P3d）门禁原始输出 —— 2026-10-13

> 本文件由命令**直接落盘**（不是誊写）。每一节都带执行时刻与完整命令。
> 复现：在仓库根依次执行各节标题里的命令。

- 采集时刻：2026-10-13 15:04:47 +08:00
- Node：v24.14.0
- npm：11.9.0


## 1. `npm test`

```powershell
# npm test
```

```text

> gemma-search@0.1.0 test
> node --test --test-isolation=none "packages/engine/tests/*.test.mjs" "apps/desktop/tests/*.test.mjs"

node.exe : [adapter] 事件回调异常 Error: handler 炸了
所在位置 行:1 字符: 1
+ & "D:\Program Files\nodejs/node.exe" "D:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([adapter] 事件回调异常 Error: handler 炸了:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
    at file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/adapter.test.mjs:135:62
    at Array.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/adapter/api.js:115:
7)
    at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/adapter.test.mjs:136:15)
    at Test.runInAsyncScope (node:async_hooks:228:14)
    at Test.run (node:internal/test_runner/test:1118:25)
    at async Test.processPendingSubtests (node:internal/test_runner/test:787:7)
[ui] search text → 0 条 · 1ms
[ui] search text → 0 条 · 1ms
[ui] search text → 2 条 · 42ms
[ui] search 失败 {"code":"LIB_NOT_FOUND","message":"m","userMessage":"找不到这个库。"}
[ui] search text → 0 条 · 1ms
[ui] search text → 0 条 · 1ms
✔ A1：成功信封 ⇒ 取出 data，并把 warnings 归一成数组 (3.9812ms)
✔ A2：方法名与参数**原样**传给 bridge（Adapter 不篡改契约） (0.3333ms)
✔ A3：失败信封 ⇒ 保留主进程的 userMessage（界面不许自编文案） (0.4127ms)
✔ A4：失败信封**缺 userMessage** ⇒ 用兜底文案，且原文进 message（不丢诊断信息） (0.2384ms)
✔ A5：⭐ invoke 抛异常 ⇒ 收进信封，**不向调用点传播** (0.2841ms)
✔ A6：⭐ 非信封返回值**不许当成功**（静默假成功是本仓库栽过的坑） (0.3166ms)
✔ A7：bridge 不存在（preload 没加载）⇒ NO_BRIDGE，仍然不抛 (0.1913ms)
✔ A8：onEvent 转发事件，且返回**可用的取消订阅** (0.2473ms)
✔ A9：handler 抛异常不影响订阅通道（后续事件仍能到达） (0.7649ms)
✔ A10：bridge 不可用时 onEvent 返回空函数（而不是 undefined） (0.2017ms)
✔ A11：normalizeError 对任意垃圾输入都给出可显示的 userMessage (0.2233ms)
✔ D-A ⭐ 每个声明的依赖：要么有真实 import，要么在白名单里且写了理由 (2149.5753ms)
✔ D-B 白名单不许变成垃圾场：里面每个包都必须**仍然被声明** (0.2283ms)
✔ D-C ⭐⭐ 断言本身有效：能看见**动态** `import()`（差点因此删错依赖） (320.6512ms)
✔ D-D ⭐ class 合并**只有一份实现**（`cn()`）—— `cx.js` 不得复活（A-4 的收口） (6.7088ms)
✔ D-E `cn()` 真的用了 clsx + tailwind-merge（不是自己手拼字符串） (0.3051ms)
✔ D-F ⭐ Chip 用的是 `aria-pressed` 语义，不只是 class（T4 补的无障碍缺口） (0.2281ms)
✔ D-G 确认弹窗真的用 Radix 的**可访问原语**（不是手写 overlay 冒充） (0.2685ms)
✔ D-H 破坏性操作走"请求 → 确认"，不再直接执行（取件会写文件） (0.2655ms)
✔ V1 ⭐ 不许把 `<Link>`（即 `<a>`）嵌在 `<Button>`（即 `<button>`）里 (4.5087ms)
✔ V2 更一般地：`<button>`（含原生）里不许直接嵌 `<a>` (4.4473ms)
✔ V3 `Button` 真的实现了 `asChild`（否则 V1 的修法无处可依） (0.3229ms)
✔ V4 窗口标题有单一来源：应用名与页面名都来自 `router/paths.js` (0.6038ms)
✔ G1：还没问出来 ⇒ loading（留白，不要闪一下向导又消失） (0.1803ms)
✔ G2：读不到配置 ⇒ error（如实报 + 给重试，不要假装没库） (0.1298ms)
✔ G3：⭐ 一个库都没有 ⇒ wizard（D2 的核心：不能把用户丢进必然报错的检索页） (0.1277ms)
✔ G4：有库 ⇒ app（交给路由） (0.1196ms)
✔ G5：垃圾输入不抛异常，且一律落到 wizard（宁可见向导，也不白屏） (0.2765ms)
✔ G6：判定与「data 存不存在」无关，只看 libraries 的**长度** (0.1863ms)
✔ IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale` (0.2513ms)
✔ IA1b 四档的文案与提示都在唯一的定义处（不许散落到组件里） (0.1968ms)
✔ IA1c `needsScanToDecide`：能当场判定的不该说"要扫"；盘上没了的也不必扫 (0.1558ms)
✔ IA2 ⭐ 四分区**永远都在**，且分区名与规格逐字一致（UI-REVIEW:236） (0.371ms)
✔ IA2b ⭐ 规格要求「把是否需重编码标在按钮上」—— 每个动作都带这个标志与角标 (0.3762ms)
✔ IA2c `disabled` 为真时 `reason` 必须非空（不能有"点不动又不说为什么"的按钮） (0.2637ms)
✔ IA2d 「重新编码」：**需要与否**与**能否点**是两件事（我第一版混为一谈） (0.3317ms)
✔ IA2e 盘上没了的条目：取件/改 ID/移出库都不可点（理由都是"文件不在盘上"） (0.2033ms)
✔ IA3 ⭐⭐ 界面上的"有没有后端"必须与 `ipc.ts` 的白名单**逐条对上**（防漂移） (1.246ms)
✔ IA3b 反过来：`mutate` 白名单里的每个 op，界面上都要有对应的动作（或有据不显示） (0.8088ms)
✔ L1 ⭐ `window.api` 只允许出现在 `adapter/` 里（全应用唯一接触点） (12.6253ms)
✔ L2 ⭐ UI 层（pages/layout/ui/search）零 `window.api` (6.9076ms)
✔ L3 ⭐ UI 层不得直接 import Adapter（协议细节归 Operation 层） (5.9134ms)
✔ L4 Operation 层（hooks/store/utils）零 `window.api` (2.773ms)
✔ L5 Adapter 不 import React（纯传输层，这样才能被 node:test 直接加载） (0.4966ms)
✔ L6 ⭐ 用户文案兜底只允许在 Adapter 里出现一次（P2 的机械判据） (7.5494ms)
✔ L6b ⭐⭐ 判据本身要准：真兜底抓到、同行无关的 `||` 放过（否则会逼人不写注释） (0.242ms)
✔ L7 ⭐ 检查**能红**：给 UI 层喂一行 window.api，L1/L2 必须报出来 (0.1803ms)
✔ ① 索引自举：有 meta.json 就能推出库（本机零配置可用的关键） (2.5429ms)
✔ ② 索引里没 meta.json / 没 lib_root / 解析失败 → 都不抛，只是没有库 (17.4342ms)
✔ ③ 优先级：环境变量压过一切 (2.2692ms)
✔ ④ 优先级：注册表压过 config 与索引自举 (2.5314ms)
✔ ⑤ 优先级：config 压过索引自举（无注册表时） (1.2867ms)
✔ ⑥ 注册表损坏 → 不抛，退到下一优先级并留下 warning (3.6767ms)
✔ ⑦ F-04：取件白名单不再为空，且默认值来自规格 (0.5519ms)
✔ ⑧ 取件白名单：环境变量 > 注册表 > config > 规格兜底 (2.8869ms)
✔ ⑧b ⭐ parseCollectDirsEnv 解析不出东西时返回 null，**绝不返回空对象** (0.2604ms)
✔ ⑧c ⭐ 垃圾环境变量**不能**把白名单弄空（F-04 回归防线） (0.5203ms)
✔ ⑨ 库根不存在 → 如实报 warning，但仍把库交出去（不在这里判失败） (1.5415ms)
✔ ⑩ normalizeLibraries：非法条目被丢弃并给出原因，不静默改造 (0.3466ms)
✔ ⑪ meta 目录名与 meta.lib_id 不一致 → 以 meta 为准并说明 (6.2089ms)
✔ ⑫ 解析是纯读：调用 resolveLibraries 不产生任何文件 (2.44ms)
✔ S1：未登记的方法一律拒绝（含 `exec` 这种明显的逃逸尝试） (1.2014ms)
✔ S2：已知方法传未知字段被拒（zod .strict()，不是"忽略多余字段"） (1.8553ms)
✔ S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id） (0.8216ms)
✔ S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行 (1.6392ms)
✔ S14b：参数无法序列化（循环引用）时拒绝，而不是抛异常给调用方 (0.2214ms)
✔ S5：size 只认白名单 128/256/512，@999 之类一律 400 (0.4919ms)
✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明） (0.478ms)
✔ S6：失败状态码映射 —— 形状/尺寸错 ⇒ 400；库无法还原 ⇒ 404（可执行契约） (0.2583ms)
✔ S4b：形状不合法的一律拒（uid 不是 12 位 hex、缺 @、多段路径、host 为空、非法 URL） (0.1995ms)
✔ S4c：路径里的 `?query` 与 `#fragment` 不影响形状判定（不构成绕过） (0.2554ms)
✔ S6：未注册的库 ⇒ 无法还原 libId ⇒ 空串（调用方给 404） (0.1822ms)
✔ S6b：libId 还原器缓存映射，但**绝不缓存"索引未就绪"（空列表）** (0.2648ms)
✔ thumb:// 的合法形状能正常解出三要素（防止"全拒"骗过上面所有用例） (0.1394ms)
✔ S15 ⭐ `mutate`：`undo` **不需要** uid，其余 op **必须**带 —— 两头都要断言 (1.0995ms)
✔ S16 ⭐ `transactions` 已登记进白名单，且 `txId`/`limit` 有边界（契约 §2.11） (0.7257ms)
✔ 端口形状：恰好只有 reveal 一个成员（端口最小化） (0.1496ms)
✔ 端口把参数**原样**转发给 showItemInFolder，不做路径加工 (0.147ms)
✔ 端口不吞异常：showItemInFolder 抛错必须冒泡出去 (0.3256ms)
✔ 端口每次调用都真的转发（不是只成功一次） (0.1847ms)
✔ R1：路由表至少 3 条，且路径唯一（多页是 P3c/P3d 的前置） (0.1531ms)
✔ R2：每条路由都能被 matchRoutes **真的解算**出来 (1.7117ms)
✔ R3：⭐ `/item/:libId/:uid` 的**参数真的被捕获**（P3c 靠它拿两条路径） (0.3122ms)
✔ R4：未知路径在路由表里**不命中**（真实 router 里另有 catch-all 兜到 /） (0.2866ms)
✔ R5：hash 路由的路径都不带协议/主机（否则 file:// 下会 404） (0.1764ms)
✔ Z1：⭐ 状态切换真的生效（不是只注册了 store） (0.2177ms)
✔ Z2：clear 只清本次检索，不动 mode/imagePath（用户的选择不该被清掉） (0.1975ms)
✔ Z3：sortResults —— score 降序 / name 升序 / recent 原序 / null 原样返回 (6.8301ms)
✔ Z4：FOLDERS / CHIPS 是同一份定义（P1：别处不许再抄一遍） (0.1855ms)
✔ Z5：⭐ run() 的筛选参数：「全部」发四个目录，单选发一个 (0.5522ms)
✔ Z6：run() 成功 ⇒ 存结果与耗时、busy 归 false (0.2211ms)
✔ Z7：⭐ run() 失败 ⇒ error 是**已归一化的信封**、rawResults 变 []（而不是留着旧结果） (0.2659ms)
✔ Z8：⭐ 空查询 / 缺参考图 **不发 IPC**（白跑一次引擎是有代价的） (0.1923ms)
✔ Z9：busy 时重复调用被挡住（不会并发发两次检索） (0.2383ms)
✔ Z10：⭐ reveal 成功文案**不许**写成「已定位」（F-01 复核的 R-1） (0.2364ms)
✔ Z11：reveal 失败 / collect 成败 的文案都来自 userMessage (0.3076ms)
✔ Z12：没给 onToast 也不该抛（状态层不依赖界面） (0.3439ms)
✔ Z13：⭐ requestCollect **只记下来、不发任何 IPC**（确认框弹出前不许动文件） (0.1523ms)
✔ Z14：⭐ cancelCollect ⇒ 动作**未执行**（一个 IPC 都没发，待确认项被丢弃） (0.1434ms)
✔ Z15：⭐ confirmCollect 真的执行；且**先清状态再执行** ⇒ 连点两次只发一次 IPC (0.2294ms)
✔ Z16：没有待确认项时 confirmCollect 是**空操作**（防误调） (0.1325ms)
✔ Z17：确认框的内容来自真实结果项（标题不是编的） (0.1568ms)
✔ S1：注释里的 `window.api` **不算**（行注释 / 块注释 / 多行块注释） (0.4662ms)
✔ S2：⭐ 被**注释掉**的接线不算（反向陷阱：注释掉一行是禁用接线的常见手法） (0.1493ms)
✔ S3：字符串 / 模板字面量里的不算；但**模板插值里的算** (0.1337ms)
✔ S4：⭐ 含引号的正则字面量之后仍能正确识别（当年栽过的那条） (0.1571ms)
✔ S5：除法不被误判成正则起始 (0.1882ms)
✔ S6：行号准确（多行块注释不能把行号带偏） (0.1572ms)
✔ S7：maskNonCode 与原串**等长同结构**（否则行号与列号会全错） (0.1406ms)
✔ S8：真正的代码**必须**被找到（否则检查会静默通过 —— 这是最危险的方向） (0.138ms)
✔ S9：⭐ 字符串里的色值 maskComments **能找到**、而 maskNonCode **找不到** (0.2595ms)
✔ S10：maskComments 仍然正确跳过注释（两类注释都要） (0.4132ms)
✔ S11：maskComments 不会把字符串里的 `//` 当成行注释（URL 用例） (0.1248ms)
✔ S12：maskComments 与原串**等长同结构**（行号才不会错） (0.1359ms)
✔ S13 ⭐⭐ maskNonCode：模板插值**之后**的代码仍被识别（旧版从此整段失明） (0.1293ms)
✔ S14 ⭐⭐ maskNonCode：注释里的**反引号**不得漏出来（旧版会漏 ⇒ 假阳性） (0.1503ms)
✔ S15 插值里的**字符串**按 maskStrings 走：maskNonCode 抹、maskComments 保留 (0.2234ms)
✔ S16 插值里含嵌套花括号/字符串/切片时，配平仍然正确 (0.2269ms)
✔ S16b 未闭合的模板不会把文件"吞掉"到越界（健壮性） (0.12ms)
✔ T1 ⭐ 渲染层**零**色值字面量：所有颜色都必须经 var(--…) 引用令牌 (8.8194ms)
✔ T1b 唯一定义处是 `packages/design-tokens/tokens.css`，且它**确实**定义了色值 (0.5473ms)
✔ T1c ⭐ Tailwind 的 `@theme` 映射**只允许** `var(--…)`，不许出现字面值 (0.6451ms)
✔ T2 ⭐ F-02：渲染层不得出现分数阈值常量（0.6~0.99）—— 档位只能来自引擎的 band (7.1087ms)
✔ T2b F-02 的正向面：`ui/Score.jsx` 确实消费 `band`，且缺失时不猜 (0.2928ms)
✔ T3 ⭐ 已迁到 Tailwind 的旧类名不得复活（`.btn` / `.icon-btn` / `.chip`） (6.3527ms)
✔ T4 构建配置接了 `@tailwindcss/vite`，且入口在 renderer.css **之前**被 import (0.5119ms)
✔ T5 ⭐ 自定义字号不会被 `cn()` 当颜色吃掉（T4 踩过的坑） (4.2888ms)
✔ T5b `TEXT_SIZES` 与 `@theme` 的 `--text-*` 一一对应（加档位时别只改一边） (0.5804ms)
✔ T6 `tailwind-merge` 真的在消解同组冲突（这是它存在的唯一理由） (0.2509ms)
✔ T1 进度事件把 done/total/条每秒/ETA/阶段都写进状态 (0.3148ms)
✔ T2 ⭐ `done` **单调不减** —— 迟到/乱序的进度不许把进度条往回拨（契约 §3） (0.1878ms)
✔ T3 ⭐ GPU 回退**必须留住并显示**（契约 §3「不静默」） (0.1685ms)
✔ T3b 续跑说明同样要留住（引擎只在第一条事件里说明复用多少） (0.1793ms)
✔ T4 ⭐ 失败清单**不静默**：非空 ⇒ `ok:false`，每项可解释（契约 §3） (0.2312ms)
✔ T4b 取消收尾：`cancelled` 要留痕，且 done 停在取消时的值 (0.1729ms)
✔ T4c `index.failed` 收尾：留下错误信封，且 userMessage 非空（界面要显示它） (0.18ms)
✔ T5 ⭐ 认不出的**阶段**原样显示、不崩（契约只举了 3 个阶段，规格要 5 个） (0.1657ms)
✔ T5b 认不出的**事件类型**不崩、也不假装处理过（只记进日志） (0.1301ms)
✔ T5c `total` 未知时百分比返回 **null**（显示不确定进度），不编一个数 (0.1265ms)
✔ T5d `etaSec` 缺失写 "—"，**不本地估算**（ETA 是引擎算的，契约 §3） (0.1397ms)
✔ T6 `begin` 把状态清干净并标记已发起（避免上一次的失败项残留） (0.1682ms)
✔ T7 日志有上限（长任务跑几千条进度也不能无限涨内存） (0.6076ms)
✔ S12：库外 URL 一律不许导航；应用自身 URL 放行 (0.2236ms)
✔ S12b：dev 态只放行 electron-vite 的 URL，不放行任意 http (0.1227ms)
✔ S11：开新窗口**无条件** deny —— 不搞"判断后大多 deny" (0.1425ms)
✔ S13：顶层 frame 且来自主窗口 ⇒ 可信 (0.1816ms)
✔ S13：iframe 内调用 ⇒ 拒绝（frame.parent 不为 null） (0.1171ms)
✔ S13b：来源不是主窗口的 webContents ⇒ 拒绝 (0.1381ms)
✔ S13c：地址不属于应用自身 ⇒ 拒绝（即使是最外层 frame） (0.1169ms)
✔ S13d：缺 senderFrame / 窗口已销毁 / 窗口不存在 ⇒ 一律拒绝（fail closed） (0.1486ms)
✔ S13e：dev 态下 127.0.0.1 的来源可信、别的 http 不可信 (0.1315ms)
✔ isAppUrl 只认 file:// 与 dev URL，其余一律 false (0.1198ms)
✔ indexStatus：返回每个库的 indexed/encoded/compat/healthy (12.0975ms)
✔ indexStatus：库根不存在时 rootExists=false 且不抛异常 (8.9183ms)
✔ indexStatus：索引损坏 → problems 里带 INDEX_CORRUPT，且**不**抛给调用方 (9.1065ms)
✔ search(text)：命中同向条目，band 由引擎给（界面不自己算） (10.6289ms)
✔ search：结果带 libsSkipped 口径（无跳过时为 []） (11.3147ms)
✔ search：filters 生效（按 folder / ext 过滤） (9.258ms)
✔ search：空文本 → BAD_REQUEST（信封，不抛） (7.3944ms)
✔ search：未知 mode → BAD_REQUEST (12.8599ms)
✔ search：未注入编码器 → MODEL_MISSING (7.7037ms)
✔ search(image)：queryImagePath 是唯一允许的库外输入，且扩展名受限 (8.8475ms)
✔ search(image)：库内 imageRef 走 uid → 路径解析（不接受客户端路径） (22.6485ms)
✔ 多库：compat 相等 → 一起检索，结果带 libId (10.2137ms)
✔ 多库：compat 不等 → 该库进 libsSkipped 并给**结构化原因**（契约 §6） (11.6298ms)
✔ 多库：device 不同**不**导致跳过（否则 CPU 回退会拒绝自己的索引） (11.0659ms)
✔ scan：新增 / 消失 / 变化 都能报出（只读） (11.3285ms)
✔ item：返回索引条目 + 磁盘实况；文件没了要如实说 (28.2972ms)
✔ reveal：走注入的 shell 端口；不经传输层也能测 (22.405ms)
✔ reveal：文件不在磁盘上 → ITEM_MISSING_ON_DISK (9.8589ms)
✔ reveal：未注入 shell 端口 → PORT_MISSING，且 ok 不为 true（不许假成功） (9.6135ms)
✔ reveal：shell 形状不对（缺 reveal / reveal 不是函数）→ 同样 PORT_MISSING (12.226ms)
✔ reveal：端口存在但目标文件不存在 → ITEM_MISSING_ON_DISK，且端口**一次都没被调用** (9.618ms)
✔ reveal：端口抛错 → 归为 INTERNAL 信封，不把异常漏给调用方 (8.5019ms)
✔ PORT_MISSING 的用户文案存在，且不含任何绝对路径 (0.24ms)
✔ search：编码器忘了归一化时，引擎自行归一 → 排序与 band 仍正确 (9.5172ms)
✔ band：阈值随模态不同（分数不可跨模态比较） (0.2395ms)
✔ band：不认识的模态 → unknown，**不拿文本阈值猜**（R-3） (0.1605ms)
✔ collect：复制到已配置目录，库侧零变化 (10.9106ms)
✔ collect：无同名包时自动取图（auto 语义） (9.3216ms)
✔ collect：目标已存在 → skipped（**不覆盖**） (9.895ms)
✔ collect：白名单外/未配置的目标名 → COLLECT_DIR_NOT_ALLOWED (7.992ms)
✔ collect：部分成功必须如实呈现（成功/失败/跳过三分） (10.386ms)
✔ collect：target=archive 但该素材无包 → failed 且说明原因 (8.217ms)
✔ collect：uids 为空或超量 → BAD_REQUEST (8.8164ms)
✔ F1 契约 §8：模拟模式**绝不触碰真实文件系统** —— 判据是"库根根本不存在" (2.1751ms)
✔ F2 `search` 固定排序且可复现（同参数两次调用逐字段一致） (0.5495ms)
✔ F2b `__empty__` 触发「无结果」分支；compat 不符与索引损坏的库进 `libsSkipped` (0.4426ms)
✔ F3 `item` **不**返回绝对路径；`itemPaths` 才是要路径的地方（所有者决定） (0.433ms)
✔ F3b 样例索引覆盖「待重编码 / 已从索引移除」两档（界面必须能演示） (0.4018ms)
✔ F12 ⭐⭐ fake 的 `item` 与**真实引擎**的 `item` **逐字同形**（防"模拟能跑、真库崩"） (0.4774ms)
✔ F4 `indexStart` 发进度事件：`done` 单调不减，收尾发 `index.done` (0.5167ms)
✔ F5 失败项非空 ⇒ `index.done.ok === false`，且每项可解释（哪条/哪个阶段/为什么） (0.4996ms)
✔ F6 ⭐ 取消**在边界生效**：cancel 后立刻收尾，且已处理数停在中间值 (0.4871ms)
✔ F6b `indexResume` 复用已编码行，并在事件里说明复用多少（契约 §3） (0.5633ms)
✔ F7 `RECOVERY_NEEDED` 那条路可演示：有未收尾事务时写操作被拒且带可恢复信息 (0.6966ms)
✔ F8 ⭐ `fake:false`（真实模式）下 `indexStart`/`mutate` 如实返回 `INTERNAL`，**不假装成功** (0.3647ms)
✔ F9 ⭐ fake 用到的**每个错误码**都在冻结的错误码表里（我曾造过一个 ENCODE_FAILED） (0.9013ms)
✔ F10 `fixtures/sample-index.json` 存在、条数达标、且覆盖契约 §8 要求的展示分支 (0.5995ms)
✔ F13 ⭐⭐ fake 的 `indexStatus.compat` 与真实引擎**同形**：8 段、顺序一致 (0.4832ms)
✔ F14 ⭐ `transactions`（契约 §2.11）：列出事务、可按 txId 查、并报告 `blocked` (0.505ms)
✔ F15 ⭐ 撤销一条待处理事务：状态、canUndo 与 blocked 都要跟着变 (0.3436ms)
✔ F15b ⭐ 不可撤销的事务**如实拒绝**（`UNDO_EXPIRED`），不假装成功 (0.3514ms)
✔ F15c 写操作会**记进台账**（界面据此显示"最近发生了什么"） (0.4282ms)
✔ F16 ⭐ 真实模式 `transactions` 如实返回 `INTERNAL`（不返回空数组假装"没有事务"） (0.155ms)
✔ F17 ⭐⭐ `UNIMPLEMENTED_METHODS` 与假套件**逐一对得上**，且真实模式全部 INTERNAL (0.8027ms)
✔ F11 `createFakeKit` 必须注入 `bandOf` —— 不许在本模块里重算档位阈值 (0.2951ms)
✔ index: 合法索引可读回，且向量与写入一致 (1.5711ms)
✔ index: MAGIC 不对 → INDEX_CORRUPT（不是"读到了半个文件"） (1.991ms)
✔ index: 截断文件 → 拒绝（footer 校验起作用） (16.86ms)
✔ index: footer.complete 不是 true → 拒绝（写入未完成的判定） (1.5128ms)
✔ index: 向量块被改一个字节 → sha1 不符 → 拒绝 (2.601ms)
✔ index: 文件不存在 → INDEX_MISSING（与"损坏"区分开） (0.501ms)
✔ index: readItems / readMeta 对坏 JSON 抛 INDEX_CORRUPT (1.9028ms)
✔ index: relOf 同时认新格式 relPath 与旧档 rel_path (0.147ms)
✔ compat: 8 个成员，顺序固定 (0.1294ms)
✔ compat: device / gpu 型号**不参与**（否则 CPU 回退会拒绝自己的索引） (0.1657ms)
✔ compat: seq 不同 → 不等，并给出逐字段差异 (0.1782ms)
✔ compat: 权重精度不同 → 不等（fp32 vs q4f16） (0.1208ms)
✔ compat: 字段不齐 → 视为不完整，不参与相等判定 (0.1108ms)
✔ compat: compatReason 结构化原因含"哪一项不符 + 期望 + 实际"（契约 §6） (0.2381ms)
✔ compat: 真实索引用例（data/idx-full 存在时读其 header 并自比） (1.1657ms)
✔ errors: 信封形状（成功/失败） (0.2447ms)
✔ errors: 每个错误码都有用户可见文案（且不含绝对路径） (0.2294ms)
✔ errors: envelope 永不抛异常给调用方 (0.205ms)
✔ ① 绝对路径一律拒绝（盘符 / UNC / 前导斜杠） (0.1467ms)
✔ ① 含 .. 的相对路径拒绝 (0.118ms)
✔ ① 正常相对路径接受 (0.1702ms)
✔ ①..④ 经由 .. 逃逸 → PATH_ESCAPES_LIB (0.3616ms)
✔ ③ 解析后的真实路径必须仍在库根内 (0.9267ms)
✔ ③ 与之同前缀的兄弟目录不能蒙混过关（前缀比较要带分隔符） (0.4563ms)
✔ ④ 库内指向库外的目录联接 → SYMLINK_REJECTED (1.1226ms)
﹣ ④ 指向库外的文件符号链接 → SYMLINK_REJECTED (0.7298ms) # 本环境无法创建文件符号链接：EPERM: operation not permitted, symlink 'D:\USERS\Desktop\Agent\gemma-search\data\_esbuild-tmp\gs-lib-CrQP8a\secret.jpg' -> 'D:\USERS\Desktop\Agent\gemma-search\data\_esbuild-tmp\gs-lib-H8ytdx\alias.jpg'
✔ ② 取件目标在白名单外 → COLLECT_DIR_NOT_ALLOWED (0.3194ms)
✔ ② 白名单要求整段匹配（E:\素材待用-x 不算命中） (0.1345ms)
✔ 查询图：扩展名白名单 + 必须是已存在的文件 (0.8793ms)
✔ ⑤ 解析与指纹是只读的：库指纹在操作前后不变 (29.3779ms)
✔ 注册表：未注册的库 → LIB_NOT_FOUND；根不存在 → LIB_ROOT_MISSING (0.6252ms)
✔ 注册表：uid → 路径解析走索引里的 relPath（不接受客户端路径） (1.1268ms)
✔ 注册表：索引里的 relPath 若被投毒（..\..）→ 仍被拦住 (0.3712ms)
✔ 指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性） (256.2954ms)
ℹ 库 3594 图 + 3594 包 · 指纹 3c62f15c5944 · 库根来自 index-meta
✔ uid: 形状是 12 位小写 hex (0.3043ms)
✔ uid: 确定性（同输入同输出） (0.1261ms)
✔ uid: 目录参与种子（同主干不同目录 → 不同 uid） (0.1067ms)
✔ uid: lib_id 参与种子（跨库不撞） (0.0951ms)
✔ uid: 根目录下的素材 rel_dir 为空串（不是 "."） (0.0996ms)
✔ uid: 黄金向量（锁住当前行为，改动即报警） (0.104ms)
✔ uid: 整库唯一性（用真实素材库；库不存在则跳过） (24.4158ms)
ℹ 扫描 3594 张图 · 库根来自 index-meta（G:\model）
ℹ 整库 3594 张 · uid 唯一 · 样例 022a00481875 → CR\ID-032109719124396.png
ℹ tests 248
ℹ suites 0
ℹ pass 247
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 3550.1418
```

## 2. `npm run typecheck`

```powershell
# npm run typecheck
```

```text

> gemma-search@0.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json

# EXIT=0
```

## 3. `npm run build`

```powershell
# npm run build
```

```text

> gemma-search@0.1.0 build
> electron-vite build

vite v7.3.7 building ssr environment for production...
transforming...
✓ 17 modules transformed.
rendering chunks...
out/main/chunks/bmp_decode-CrjD8y7P.js   1.83 kB
out/main/chunks/encoder-DqZ6ggTh.js      7.93 kB
out/main/index.js                       93.86 kB
✓ built in 324ms
vite v7.3.7 building ssr environment for production...
transforming...
✓ 1 modules transformed.
rendering chunks...
out/preload/index.cjs  0.82 kB
✓ built in 11ms
vite v7.3.7 building client environment for production...
transforming...
✓ 144 modules transformed.
node.exe : [plugin vite:reporter] 
所在位置 行:1 字符: 1
+ & "D:\Program Files\nodejs/node.exe" "D:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([plugin vite:reporter] :String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Button.jsx is dynamically imported by D:/USERS
/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Age
nt/gemma-search/apps/desktop/src/renderer/src/pages/ActivityPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/
src/renderer/src/pages/FirstRunWizard.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/Item
Page.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/LibraryGate.jsx, D:/USERS/Desktop/Age
nt/gemma-search/apps/desktop/src/renderer/src/pages/SearchPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/sr
c/renderer/src/pages/TasksPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/search/Gallery.js
x, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/search/PhotoCard.jsx, D:/USERS/Desktop/Agent/gemma
-search/apps/desktop/src/renderer/src/search/SearchPanel.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/rend
erer/src/ui/ConfirmDialog.jsx, dynamic import will not move module into another chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/FirstRunWizard.jsx is dynamically imported 
by D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/
Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/LibraryGate.jsx, dynamic import will not move module int
o another chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Toast.jsx is dynamically imported by D:/USERS/
Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Agen
t/gemma-search/apps/desktop/src/renderer/src/pages/ActivityPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/s
rc/renderer/src/pages/ItemPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/SearchPage.
jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/TasksPage.jsx, dynamic import will not mov
e module into another chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/ConfirmDialog.jsx is dynamically imported by D
:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desk
top/Agent/gemma-search/apps/desktop/src/renderer/src/pages/ItemPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/deskt
op/src/renderer/src/pages/SearchPage.jsx, dynamic import will not move module into another chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Score.jsx is dynamically imported by D:/USERS/
Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Agen
t/gemma-search/apps/desktop/src/renderer/src/search/PhotoCard.jsx, dynamic import will not move module into another chu
nk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Tag.jsx is dynamically imported by D:/USERS/De
sktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Agent/
gemma-search/apps/desktop/src/renderer/src/search/PhotoCard.jsx, dynamic import will not move module into another chunk
.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Metric.jsx is dynamically imported by D:/USERS
/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Age
nt/gemma-search/apps/desktop/src/renderer/src/search/MetricsRow.jsx, dynamic import will not move module into another c
hunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Chip.jsx is dynamically imported by D:/USERS/D
esktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Agent
/gemma-search/apps/desktop/src/renderer/src/search/SearchPanel.jsx, dynamic import will not move module into another ch
unk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Field.jsx is dynamically imported by D:/USERS/
Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/Agen
t/gemma-search/apps/desktop/src/renderer/src/pages/TasksPage.jsx, D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/
renderer/src/search/SearchPanel.jsx, dynamic import will not move module into another chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/SearchBox.jsx is dynamically imported by D:/US
ERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/
Agent/gemma-search/apps/desktop/src/renderer/src/search/SearchPanel.jsx, dynamic import will not move module into anoth
er chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/ui/Progress.jsx is dynamically imported by D:/USE
RS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desktop/A
gent/gemma-search/apps/desktop/src/renderer/src/search/SearchSidebar.jsx, dynamic import will not move module into anot
her chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/SearchPage.jsx is dynamically imported by D
:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Desk
top/Agent/gemma-search/apps/desktop/src/renderer/src/router/index.jsx, dynamic import will not move module into another
 chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/ItemPage.jsx is dynamically imported by D:/
USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Deskto
p/Agent/gemma-search/apps/desktop/src/renderer/src/router/index.jsx, dynamic import will not move module into another c
hunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/TasksPage.jsx is dynamically imported by D:
/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Deskt
op/Agent/gemma-search/apps/desktop/src/renderer/src/router/index.jsx, dynamic import will not move module into another 
chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/ActivityPage.jsx is dynamically imported by
 D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/De
sktop/Agent/gemma-search/apps/desktop/src/renderer/src/router/index.jsx, dynamic import will not move module into anoth
er chunk.

[plugin vite:reporter] 
(!) D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/pages/LibraryGate.jsx is dynamically imported by 
D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/main.jsx but also statically imported by D:/USERS/Des
ktop/Agent/gemma-search/apps/desktop/src/renderer/src/App.jsx, dynamic import will not move module into another chunk.

rendering chunks...
../../../../out/renderer/index.html                     1.15 kB
../../../../out/renderer/assets/index-DUgFX7rS.css     41.31 kB
../../../../out/renderer/assets/index-Do-UYeUf.js   1,195.36 kB
✓ built in 1.79s

# EXIT=0
```

## 4. `npm run e2e`

```powershell
# npm run e2e
```

```text

> gemma-search@0.1.0 e2e
> playwright test -c apps/desktop/e2e/playwright.config.mjs


Running 56 tests using 1 worker

node.exe : (node:18612) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
所在位置 行:1 字符: 1
+ & "D:\Program Files\nodejs/node.exe" "D:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:18612) Wa... env being set.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
(Use `node --trace-warnings ...` to show where the warning was created)
  ok  1 apps\desktop\e2e\a11y.spec.mjs:18:1 › E5-a ⭐ Chip 暴露 `aria-pressed`，且点击后真的翻转（不是只改 class） (2.1s)
  ok  2 apps\desktop\e2e\a11y.spec.mjs:41:1 › E5-b ⭐ 侧栏导航暴露 `aria-current="page"`，且跟着路由走 (2.0s)
  ok  3 apps\desktop\e2e\a11y.spec.mjs:63:1 › E5-c 空闲时**不渲染**确认弹窗（破坏性操作的确认框不该常驻） (1.7s)
  ok  4 apps\desktop\e2e\a11y.spec.mjs:77:1 › E5-d 图标按钮有可读名字（无障碍名字不是只有图标） (1.6s)
  ok  5 apps\desktop\e2e\activity.spec.mjs:20:1 › E11-a ⭐ 侧栏「操作记录」现在能点（不再是 disabled 占位） (1.9s)
  ok  6 apps\desktop\e2e\activity.spec.mjs:37:1 › E11-b ⭐ 事务表列出记录，每条都带**撤销状态**（UI-REVIEW:76 的安全底线） (2.2s)
  ok  7 apps\desktop\e2e\activity.spec.mjs:63:1 › E11-c ⭐ 待处理项给**三条路**，且「保持现状」明说它不动磁盘 (1.7s)
  ok  8 apps\desktop\e2e\activity.spec.mjs:87:1 › E11-d ⭐ 回退真的改状态：待处理消失、事务变「已撤销」、`blocked` 不再提示 (1.7s)
  ok  9 apps\desktop\e2e\activity.spec.mjs:110:1 › E11-e ⭐ 真实模式：如实报「还没做好」，**不返回空表假装"没有事务"** (2.1s)
  ok 10 apps\desktop\e2e\activity.spec.mjs:125:1 › E11-f 不可撤销的事务：状态如实显示「不可以」，回退按钮禁用并说明原因 (1.9s)
  ok 11 apps\desktop\e2e\confirm-dialog.spec.mjs:104:1 › E7-a ⭐ 「取件」先弹确认框：不能点一下就把文件搬走 (2.1s)
  [E7-b] 打开后焦点落在: BUTTON "取消"
  [E7-b] 连按 6 次 Tab，焦点始终在弹窗内 ✅
  ok 12 apps\desktop\e2e\confirm-dialog.spec.mjs:127:1 › E7-b ⭐ 焦点被**捕获在弹窗内**，且 Tab 不会跑到背后的页面（焦点陷阱） (2.6s)
  ok 13 apps\desktop\e2e\confirm-dialog.spec.mjs:163:1 › E7-c ⭐ ESC 关闭弹窗，且**动作未执行**（collect 一个都没发） (2.1s)
  [E7-d] 关闭后焦点归还给: BUTTON "取件"
  ok 14 apps\desktop\e2e\confirm-dialog.spec.mjs:182:1 › E7-d ⭐ 点「取消」同样不执行；且焦点**归还**给触发它的那个按钮 (2.1s)
  ok 15 apps\desktop\e2e\confirm-dialog.spec.mjs:208:1 › E7-e ⭐ 确认才执行：collect 恰好一次，且参数是那一项 (2.2s)
  ok 16 apps\desktop\e2e\confirm-dialog.spec.mjs:228:1 › E7-f 连点两次确认只发一次 collect（先清状态再执行） (2.1s)
  ok 17 apps\desktop\e2e\fake-mode.spec.mjs:16:1 › E8-a ⭐ `GEMMA_FAKE=1` 能起来，且界面显示的是**样例库**（不是真库） (1.7s)
  ok 18 apps\desktop\e2e\fake-mode.spec.mjs:31:1 › E8-b ⭐ 模拟模式能搜出结果（P3c/P3d 需要"有结果"这个状态） (1.9s)
  ok 19 apps\desktop\e2e\fake-mode.spec.mjs:51:1 › E8-c `indexStatus` 在模拟模式下报 3 个库，且含"索引损坏"那个（状态演示用） (2.0s)
  ok 20 apps\desktop\e2e\fake-mode.spec.mjs:68:1 › E8-d ⭐ 写方法在模拟模式下**不再被主进程拒绝**（契约 §8 的那条路通了） (1.8s)
  ok 21 apps\desktop\e2e\fake-mode.spec.mjs:84:1 › E8-e `itemPaths` 在真窗口里返回两条绝对路径（P3c 的数据源） (2.0s)
  ok 22 apps\desktop\e2e\fake-mode.spec.mjs:101:1 › E8-f ⭐ 真实模式（不设 GEMMA_FAKE）**仍然拒绝**写方法 —— 模拟不许渗进生产 (3.8s)
  ok 23 apps\desktop\e2e\gate.spec.mjs:15:1 › E1-a ⭐ 一个库都没有 ⇒ 显示首启向导，且**不显示**检索界面 (2.1s)
  ok 24 apps\desktop\e2e\gate.spec.mjs:44:1 › E1-b 有库 ⇒ 进检索界面，且**不显示**向导 (2.1s)
  [E1-c] 侧栏库根 = D:\USERS\Desktop\Agent\gemma-search\apps\desktop\e2e\fixtures\lib-mini · 期望含 D:\USERS\Desktop\Agent\gemma-search\apps\desktop\e2e\fixtures\lib-mini
  ok 25 apps\desktop\e2e\gate.spec.mjs:57:1 › E1-c 界面上有真实的库来源证据（侧栏显示库根，不是"未配置"） (1.8s)
  ok 26 apps\desktop\e2e\item-detail.spec.mjs:24:1 › E9-a ⭐ 显示大图 + 元数据 + **两条绝对路径**（P3c 的核心验收） (2.0s)
  ok 27 apps\desktop\e2e\item-detail.spec.mjs:60:1 › E9-b ⭐ 索引状态：正常条目「已编码」；盘上没了的是「已从索引移除」 (2.6s)
  ok 28 apps\desktop\e2e\item-detail.spec.mjs:83:1 › E9-c ⭐ 动作四分区**都在**，且每个按钮都带「需重编码 / 不重编码」角标（UI-REVIEW:236-237） (2.0s)
  ok 29 apps\desktop\e2e\item-detail.spec.mjs:113:1 › E9-d ⭐ 没有后端的动作**禁用且写明原因**（不许静默点不动） (1.7s)
  ok 30 apps\desktop\e2e\item-detail.spec.mjs:137:1 › E9-e ⭐ 「检查变更」跑一次 scan ⇒ 被外部改过的条目变成「待重编码」 (1.9s)
  ok 31 apps\desktop\e2e\item-detail.spec.mjs:157:1 › E9-f 未知 uid ⇒ 如实报错，不白屏（错误码要露出来） (2.0s)
  ok 32 apps\desktop\e2e\routing.spec.mjs:15:1 › E2-a 默认落在搜索页（hash 为空即 `/`） (1.8s)
  ok 33 apps\desktop\e2e\routing.spec.mjs:29:1 › E2-b ⭐ 侧栏点「索引任务」⇒ 真的导航，hash 与界面都变 (2.1s)
  ok 34 apps\desktop\e2e\routing.spec.mjs:47:1 › E2-c ⭐ `/item/:libId/:uid` 的参数**在真界面里**取到了（P3c 靠它拿两条路径） (1.9s)
  ok 35 apps\desktop\e2e\routing.spec.mjs:70:1 › E2-c2 `/item` 用错的 uid ⇒ 如实报错（参数**真的**被送到了引擎，不是被忽略） (2.0s)
  ok 36 apps\desktop\e2e\routing.spec.mjs:83:1 › E2-d 未知 hash ⇒ 回搜索页（不白屏） (2.0s)
  ok 37 apps\desktop\e2e\routing.spec.mjs:99:1 › E2-e 返回搜索页（从任务页导航回去） (2.2s)
  ok 38 apps\desktop\e2e\routing.spec.mjs:124:1 › E6-a ⭐ 真窗口 DOM 里没有 `<a>` 嵌在 `<button>` 里（T2 修的那 4 处） (1.8s)
  ok 39 apps\desktop\e2e\routing.spec.mjs:145:1 › E6-b ⭐ 返回控件是**链接**（语义正确 + 只有一个可聚焦元素） (2.3s)
  ok 40 apps\desktop\e2e\routing.spec.mjs:165:1 › E6-c ⭐ 窗口标题随路由变（修前：三条路由共用一个标题） (2.1s)
  [E0] window.api = object · keys = ["invoke","onEvent","platform"]
  [E0] typeof window.require/module/process = undefined / undefined / undefined
  [E0] body.innerHTML 长度 = 6166 · 控制台错误 = 0
  ok 41 apps\desktop\e2e\smoke.spec.mjs:14:1 › E0 探针：Electron 出窗，且 preload 暴露面恰好三键 (6.9s)
  [E4-a] 计算样式 = {"bg":"rgb(255, 255, 255)","color":"rgb(29, 29, 31)","radius":"8px","minH":"44px","padTop":"8px","padRight":"12px","fontSize":"13px","fontWeight":"600","borderWidth":"1px","borderColor":"rgb(229, 229, 234)","width":"94.625px","height":"44px"}
  [E4-a] 令牌     = {"--radius-sm":"8px","--touch-min":"44px","--space-2":"8px","--space-3":"12px","--type-caption":"13px","--color-bg-elevated":"#ffffff","--color-text-primary":"#1d1d1f","--color-separator-subtle":"#e5e5ea"}
  ok 42 apps\desktop\e2e\styles.spec.mjs:35:1 › E4-a ⭐ 迁移后 Button(default) 的每个视觉值都仍落在**设计令牌**上 (2.2s)
  [E4-b] primary = rgb(0, 113, 227) / rgb(255, 255, 255) · 令牌 = {"--color-accent":"#0071e3","--color-on-accent":"#ffffff"}
  ok 43 apps\desktop\e2e\styles.spec.mjs:69:1 › E4-b ⭐ Button(primary) 仍是强调色填充 + 反白文字（--color-accent / --color-on-accent） (1.8s)
  [E4-c] icon = 36px × 36px · radius = 10px · 令牌 = {"--control-icon-btn":"36px","--radius-md":"10px","--color-text-secondary":"#6e6e73"}
  ok 44 apps\desktop\e2e\styles.spec.mjs:89:1 › E4-c ⭐ Button(icon) 仍是 36×36 方形（--control-icon-btn / --radius-md） (2.0s)
  [E4-d] chip = {"bg":"rgb(255, 255, 255)","color":"rgb(110, 110, 115)","radius":"999px","minH":"32px","padTop":"8px","padRight":"16px","fontSize":"13px","fontWeight":"400","borderWidth":"1px","borderColor":"rgb(229, 229, 234)","width":"52.0625px","height":"33px"} · 令牌 = {"--radius-pill":"999px","--type-caption":"13px","--color-text-secondary":"#6e6e73"}
  ok 45 apps\desktop\e2e\styles.spec.mjs:110:1 › E4-d ⭐ Chip 仍是胶囊（--radius-pill / --control-chip-padding / 32px 高） (1.9s)
  [E4-e] 点击前 = rgb(255, 255, 255) rgb(110, 110, 115) → 点击后 = rgb(29, 29, 31) rgb(255, 255, 255)
  ok 46 apps\desktop\e2e\styles.spec.mjs:134:1 › E4-e ⭐ Chip 选中态：底色变主文字色、文字反白（迁移前 .chip.active 的等价物） (2.0s)
  ok 47 apps\desktop\e2e\tasks.spec.mjs:18:1 › E10-a 未跑过时是**诚实的空态**（不编进度、不假装在跑） (2.1s)
  ok 48 apps\desktop\e2e\tasks.spec.mjs:41:1 › E10-b ⭐ 开始索引 ⇒ 进度真的推进（阶段条 + 计数 + 条/秒） (7.2s)
  ok 49 apps\desktop\e2e\tasks.spec.mjs:73:1 › E10-c ⭐ 失败项**可展开**，且每条能说清「哪条 / 哪个阶段 / 为什么」（UI-REVIEW:243） (7.0s)
  ok 50 apps\desktop\e2e\tasks.spec.mjs:99:1 › E10-d ⭐ 取消：按钮标注了"当前批次结束后停止"，点完 done **停住**且结果标为已取消 (4.8s)
  ok 51 apps\desktop\e2e\tasks.spec.mjs:132:1 › E10-e ⭐ GPU 回退**显示在界面上**（契约 §3「不静默」） (5.3s)
  ok 52 apps\desktop\e2e\tasks.spec.mjs:148:1 › E10-f ⭐ 真实模式点「开始索引」⇒ **如实报"还没做好"**，不假装在跑 (2.1s)
  ok 53 apps\desktop\e2e\window-security.spec.mjs:14:1 › E3-a ⭐ S11：`window.open` 被 deny —— 不产生新窗口 (2.2s)
  ok 54 apps\desktop\e2e\window-security.spec.mjs:35:1 › E3-b ⭐ S12：外部导航被拦 —— URL 不变、渲染层仍活着 (2.3s)
  ok 55 apps\desktop\e2e\window-security.spec.mjs:68:1 › E3-c 导航到未知 hash 不产生控制台错误（渲染层没被路由变化打崩） (5.0s)
  [E3-d] before = file:///D:/USERS/Desktop/Agent/gemma-search/out/renderer/index.html
  [E3-d] after  = chrome-error://chromewebdata/
  ok 56 apps\desktop\e2e\window-security.spec.mjs:93:1 › E3-d 边界：`file://` 导航是**前缀放行**（SPEC-security §8.1 已记录，此处钉住现状） (2.2s)

  56 passed (2.3m)

# EXIT=0
```

## 5. 改完文档后的**复跑**（验收要求：改完 npm test 与 npm run e2e 各一次）

- 复跑时刻：2026-10-13 15:14:40 +08:00
- 改动内容：**仅文档**（`docs/plan/ROADMAP.md` §4/§8.3、`reports/README.md` 去重）+ 本目录新增文件；**未改任何源码**。
- 因此期望与首轮一致；不一致就说明我改坏了东西。

### 5.1 `npm test`

```text
# npm test      EXIT=0

> gemma-search@0.1.0 test
> node --test --test-isolation=none "packages/engine/tests/*.test.mjs" "apps/desktop/tests/*.test.mjs"

node.exe : [adapter] 事件回调异常 Error: handler 炸了
所在位置 行:1 字符: 1
+ & "D:\Program Files\nodejs/node.exe" "D:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([adapter] 事件回调异常 Error: handler 炸了:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
    at file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/adapter.test.mjs:135:62
    at Array.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/src/renderer/src/adapter/api.js:115:
7)
    at TestContext.<anonymous> (file:///D:/USERS/Desktop/Agent/gemma-search/apps/desktop/tests/adapter.test.mjs:136:15)
    at Test.runInAsyncScope (node:async_hooks:228:14)
    at Test.run (node:internal/test_runner/test:1118:25)
    at async Test.processPendingSubtests (node:internal/test_runner/test:787:7)
[ui] search text → 0 条 · 1ms
[ui] search text → 0 条 · 1ms
[ui] search text → 2 条 · 42ms
[ui] search 失败 {"code":"LIB_NOT_FOUND","message":"m","userMessage":"找不到这个库。"}
[ui] search text → 0 条 · 1ms
[ui] search text → 0 条 · 1ms
✔ A1：成功信封 ⇒ 取出 data，并把 warnings 归一成数组 (5.5746ms)
✔ A2：方法名与参数**原样**传给 bridge（Adapter 不篡改契约） (0.4037ms)
✔ A3：失败信封 ⇒ 保留主进程的 userMessage（界面不许自编文案） (0.3347ms)
✔ A4：失败信封**缺 userMessage** ⇒ 用兜底文案，且原文进 message（不丢诊断信息） (0.1915ms)
✔ A5：⭐ invoke 抛异常 ⇒ 收进信封，**不向调用点传播** (0.3413ms)
✔ A6：⭐ 非信封返回值**不许当成功**（静默假成功是本仓库栽过的坑） (0.3109ms)
✔ A7：bridge 不存在（preload 没加载）⇒ NO_BRIDGE，仍然不抛 (0.194ms)
✔ A8：onEvent 转发事件，且返回**可用的取消订阅** (0.317ms)
✔ A9：handler 抛异常不影响订阅通道（后续事件仍能到达） (0.7819ms)
✔ A10：bridge 不可用时 onEvent 返回空函数（而不是 undefined） (0.2243ms)
✔ A11：normalizeError 对任意垃圾输入都给出可显示的 userMessage (0.2021ms)
✔ D-A ⭐ 每个声明的依赖：要么有真实 import，要么在白名单里且写了理由 (2252.6585ms)
✔ D-B 白名单不许变成垃圾场：里面每个包都必须**仍然被声明** (0.4374ms)
✔ D-C ⭐⭐ 断言本身有效：能看见**动态** `import()`（差点因此删错依赖） (447.7402ms)
✔ D-D ⭐ class 合并**只有一份实现**（`cn()`）—— `cx.js` 不得复活（A-4 的收口） (7.4404ms)
✔ D-E `cn()` 真的用了 clsx + tailwind-merge（不是自己手拼字符串） (0.3383ms)
✔ D-F ⭐ Chip 用的是 `aria-pressed` 语义，不只是 class（T4 补的无障碍缺口） (0.2414ms)
✔ D-G 确认弹窗真的用 Radix 的**可访问原语**（不是手写 overlay 冒充） (0.297ms)
✔ D-H 破坏性操作走"请求 → 确认"，不再直接执行（取件会写文件） (0.299ms)
✔ V1 ⭐ 不许把 `<Link>`（即 `<a>`）嵌在 `<Button>`（即 `<button>`）里 (6.2984ms)
✔ V2 更一般地：`<button>`（含原生）里不许直接嵌 `<a>` (5.6271ms)
✔ V3 `Button` 真的实现了 `asChild`（否则 V1 的修法无处可依） (0.3651ms)
✔ V4 窗口标题有单一来源：应用名与页面名都来自 `router/paths.js` (1.0866ms)
✔ G1：还没问出来 ⇒ loading（留白，不要闪一下向导又消失） (0.2047ms)
✔ G2：读不到配置 ⇒ error（如实报 + 给重试，不要假装没库） (0.1392ms)
✔ G3：⭐ 一个库都没有 ⇒ wizard（D2 的核心：不能把用户丢进必然报错的检索页） (0.1292ms)
✔ G4：有库 ⇒ app（交给路由） (0.1338ms)
✔ G5：垃圾输入不抛异常，且一律落到 wizard（宁可见向导，也不白屏） (0.2868ms)
✔ G6：判定与「data 存不存在」无关，只看 libraries 的**长度** (0.2031ms)
✔ IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale` (0.243ms)
✔ IA1b 四档的文案与提示都在唯一的定义处（不许散落到组件里） (0.1791ms)
✔ IA1c `needsScanToDecide`：能当场判定的不该说"要扫"；盘上没了的也不必扫 (0.1358ms)
✔ IA2 ⭐ 四分区**永远都在**，且分区名与规格逐字一致（UI-REVIEW:236） (0.307ms)
✔ IA2b ⭐ 规格要求「把是否需重编码标在按钮上」—— 每个动作都带这个标志与角标 (0.2928ms)
✔ IA2c `disabled` 为真时 `reason` 必须非空（不能有"点不动又不说为什么"的按钮） (0.2395ms)
✔ IA2d 「重新编码」：**需要与否**与**能否点**是两件事（我第一版混为一谈） (0.2697ms)
✔ IA2e 盘上没了的条目：取件/改 ID/移出库都不可点（理由都是"文件不在盘上"） (0.196ms)
✔ IA3 ⭐⭐ 界面上的"有没有后端"必须与 `ipc.ts` 的白名单**逐条对上**（防漂移） (1.0974ms)
✔ IA3b 反过来：`mutate` 白名单里的每个 op，界面上都要有对应的动作（或有据不显示） (1.0442ms)
✔ L1 ⭐ `window.api` 只允许出现在 `adapter/` 里（全应用唯一接触点） (13.4552ms)
✔ L2 ⭐ UI 层（pages/layout/ui/search）零 `window.api` (10.1851ms)
✔ L3 ⭐ UI 层不得直接 import Adapter（协议细节归 Operation 层） (6.7229ms)
✔ L4 Operation 层（hooks/store/utils）零 `window.api` (3.5241ms)
✔ L5 Adapter 不 import React（纯传输层，这样才能被 node:test 直接加载） (0.9106ms)
✔ L6 ⭐ 用户文案兜底只允许在 Adapter 里出现一次（P2 的机械判据） (8.5525ms)
✔ L6b ⭐⭐ 判据本身要准：真兜底抓到、同行无关的 `||` 放过（否则会逼人不写注释） (0.2673ms)
✔ L7 ⭐ 检查**能红**：给 UI 层喂一行 window.api，L1/L2 必须报出来 (0.2149ms)
✔ ① 索引自举：有 meta.json 就能推出库（本机零配置可用的关键） (3.3039ms)
✔ ② 索引里没 meta.json / 没 lib_root / 解析失败 → 都不抛，只是没有库 (30.8937ms)
✔ ③ 优先级：环境变量压过一切 (2.7102ms)
✔ ④ 优先级：注册表压过 config 与索引自举 (4.1066ms)
✔ ⑤ 优先级：config 压过索引自举（无注册表时） (1.6952ms)
✔ ⑥ 注册表损坏 → 不抛，退到下一优先级并留下 warning (2.8517ms)
✔ ⑦ F-04：取件白名单不再为空，且默认值来自规格 (0.5412ms)
✔ ⑧ 取件白名单：环境变量 > 注册表 > config > 规格兜底 (2.984ms)
✔ ⑧b ⭐ parseCollectDirsEnv 解析不出东西时返回 null，**绝不返回空对象** (0.2441ms)
✔ ⑧c ⭐ 垃圾环境变量**不能**把白名单弄空（F-04 回归防线） (0.5212ms)
✔ ⑨ 库根不存在 → 如实报 warning，但仍把库交出去（不在这里判失败） (1.4666ms)
✔ ⑩ normalizeLibraries：非法条目被丢弃并给出原因，不静默改造 (0.3209ms)
✔ ⑪ meta 目录名与 meta.lib_id 不一致 → 以 meta 为准并说明 (4.3292ms)
✔ ⑫ 解析是纯读：调用 resolveLibraries 不产生任何文件 (2.6451ms)
✔ S1：未登记的方法一律拒绝（含 `exec` 这种明显的逃逸尝试） (1.3135ms)
✔ S2：已知方法传未知字段被拒（zod .strict()，不是"忽略多余字段"） (1.8994ms)
✔ S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id） (0.8334ms)
✔ S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行 (1.6571ms)
✔ S14b：参数无法序列化（循环引用）时拒绝，而不是抛异常给调用方 (0.192ms)
✔ S5：size 只认白名单 128/256/512，@999 之类一律 400 (0.5084ms)
✔ S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明） (0.5224ms)
✔ S6：失败状态码映射 —— 形状/尺寸错 ⇒ 400；库无法还原 ⇒ 404（可执行契约） (0.2574ms)
✔ S4b：形状不合法的一律拒（uid 不是 12 位 hex、缺 @、多段路径、host 为空、非法 URL） (0.2041ms)
✔ S4c：路径里的 `?query` 与 `#fragment` 不影响形状判定（不构成绕过） (0.1431ms)
✔ S6：未注册的库 ⇒ 无法还原 libId ⇒ 空串（调用方给 404） (0.3036ms)
✔ S6b：libId 还原器缓存映射，但**绝不缓存"索引未就绪"（空列表）** (0.2926ms)
✔ thumb:// 的合法形状能正常解出三要素（防止"全拒"骗过上面所有用例） (0.1716ms)
✔ S15 ⭐ `mutate`：`undo` **不需要** uid，其余 op **必须**带 —— 两头都要断言 (1.2232ms)
✔ S16 ⭐ `transactions` 已登记进白名单，且 `txId`/`limit` 有边界（契约 §2.11） (0.735ms)
✔ 端口形状：恰好只有 reveal 一个成员（端口最小化） (0.1972ms)
✔ 端口把参数**原样**转发给 showItemInFolder，不做路径加工 (0.1784ms)
✔ 端口不吞异常：showItemInFolder 抛错必须冒泡出去 (0.3543ms)
✔ 端口每次调用都真的转发（不是只成功一次） (0.1924ms)
✔ R1：路由表至少 3 条，且路径唯一（多页是 P3c/P3d 的前置） (0.1937ms)
✔ R2：每条路由都能被 matchRoutes **真的解算**出来 (1.6767ms)
✔ R3：⭐ `/item/:libId/:uid` 的**参数真的被捕获**（P3c 靠它拿两条路径） (0.3121ms)
✔ R4：未知路径在路由表里**不命中**（真实 router 里另有 catch-all 兜到 /） (0.32ms)
✔ R5：hash 路由的路径都不带协议/主机（否则 file:// 下会 404） (0.1848ms)
✔ Z1：⭐ 状态切换真的生效（不是只注册了 store） (0.2232ms)
✔ Z2：clear 只清本次检索，不动 mode/imagePath（用户的选择不该被清掉） (0.1867ms)
✔ Z3：sortResults —— score 降序 / name 升序 / recent 原序 / null 原样返回 (6.7168ms)
✔ Z4：FOLDERS / CHIPS 是同一份定义（P1：别处不许再抄一遍） (0.1726ms)
✔ Z5：⭐ run() 的筛选参数：「全部」发四个目录，单选发一个 (0.6149ms)
✔ Z6：run() 成功 ⇒ 存结果与耗时、busy 归 false (0.2613ms)
✔ Z7：⭐ run() 失败 ⇒ error 是**已归一化的信封**、rawResults 变 []（而不是留着旧结果） (0.2991ms)
✔ Z8：⭐ 空查询 / 缺参考图 **不发 IPC**（白跑一次引擎是有代价的） (0.1838ms)
✔ Z9：busy 时重复调用被挡住（不会并发发两次检索） (0.236ms)
✔ Z10：⭐ reveal 成功文案**不许**写成「已定位」（F-01 复核的 R-1） (0.2593ms)
✔ Z11：reveal 失败 / collect 成败 的文案都来自 userMessage (0.3096ms)
✔ Z12：没给 onToast 也不该抛（状态层不依赖界面） (0.3744ms)
✔ Z13：⭐ requestCollect **只记下来、不发任何 IPC**（确认框弹出前不许动文件） (0.1489ms)
✔ Z14：⭐ cancelCollect ⇒ 动作**未执行**（一个 IPC 都没发，待确认项被丢弃） (0.1419ms)
✔ Z15：⭐ confirmCollect 真的执行；且**先清状态再执行** ⇒ 连点两次只发一次 IPC (0.2686ms)
✔ Z16：没有待确认项时 confirmCollect 是**空操作**（防误调） (0.1248ms)
✔ Z17：确认框的内容来自真实结果项（标题不是编的） (0.1624ms)
✔ S1：注释里的 `window.api` **不算**（行注释 / 块注释 / 多行块注释） (0.4476ms)
✔ S2：⭐ 被**注释掉**的接线不算（反向陷阱：注释掉一行是禁用接线的常见手法） (0.5891ms)
✔ S3：字符串 / 模板字面量里的不算；但**模板插值里的算** (0.1853ms)
✔ S4：⭐ 含引号的正则字面量之后仍能正确识别（当年栽过的那条） (0.1407ms)
✔ S5：除法不被误判成正则起始 (0.1546ms)
✔ S6：行号准确（多行块注释不能把行号带偏） (0.131ms)
✔ S7：maskNonCode 与原串**等长同结构**（否则行号与列号会全错） (0.1532ms)
✔ S8：真正的代码**必须**被找到（否则检查会静默通过 —— 这是最危险的方向） (0.1313ms)
✔ S9：⭐ 字符串里的色值 maskComments **能找到**、而 maskNonCode **找不到** (0.2717ms)
✔ S10：maskComments 仍然正确跳过注释（两类注释都要） (0.3771ms)
✔ S11：maskComments 不会把字符串里的 `//` 当成行注释（URL 用例） (0.4077ms)
✔ S12：maskComments 与原串**等长同结构**（行号才不会错） (0.1474ms)
✔ S13 ⭐⭐ maskNonCode：模板插值**之后**的代码仍被识别（旧版从此整段失明） (0.1687ms)
✔ S14 ⭐⭐ maskNonCode：注释里的**反引号**不得漏出来（旧版会漏 ⇒ 假阳性） (0.1551ms)
✔ S15 插值里的**字符串**按 maskStrings 走：maskNonCode 抹、maskComments 保留 (0.1584ms)
✔ S16 插值里含嵌套花括号/字符串/切片时，配平仍然正确 (0.1568ms)
✔ S16b 未闭合的模板不会把文件"吞掉"到越界（健壮性） (0.1618ms)
✔ T1 ⭐ 渲染层**零**色值字面量：所有颜色都必须经 var(--…) 引用令牌 (10.0831ms)
✔ T1b 唯一定义处是 `packages/design-tokens/tokens.css`，且它**确实**定义了色值 (0.5661ms)
✔ T1c ⭐ Tailwind 的 `@theme` 映射**只允许** `var(--…)`，不许出现字面值 (0.7062ms)
✔ T2 ⭐ F-02：渲染层不得出现分数阈值常量（0.6~0.99）—— 档位只能来自引擎的 band (7.9746ms)
✔ T2b F-02 的正向面：`ui/Score.jsx` 确实消费 `band`，且缺失时不猜 (0.3164ms)
✔ T3 ⭐ 已迁到 Tailwind 的旧类名不得复活（`.btn` / `.icon-btn` / `.chip`） (6.8422ms)
✔ T4 构建配置接了 `@tailwindcss/vite`，且入口在 renderer.css **之前**被 import (0.5399ms)
✔ T5 ⭐ 自定义字号不会被 `cn()` 当颜色吃掉（T4 踩过的坑） (4.8608ms)
✔ T5b `TEXT_SIZES` 与 `@theme` 的 `--text-*` 一一对应（加档位时别只改一边） (0.6403ms)
✔ T6 `tailwind-merge` 真的在消解同组冲突（这是它存在的唯一理由） (0.2619ms)
✔ T1 进度事件把 done/total/条每秒/ETA/阶段都写进状态 (0.3284ms)
✔ T2 ⭐ `done` **单调不减** —— 迟到/乱序的进度不许把进度条往回拨（契约 §3） (0.1996ms)
✔ T3 ⭐ GPU 回退**必须留住并显示**（契约 §3「不静默」） (0.1598ms)
✔ T3b 续跑说明同样要留住（引擎只在第一条事件里说明复用多少） (0.1987ms)
✔ T4 ⭐ 失败清单**不静默**：非空 ⇒ `ok:false`，每项可解释（契约 §3） (0.238ms)
✔ T4b 取消收尾：`cancelled` 要留痕，且 done 停在取消时的值 (0.18ms)
✔ T4c `index.failed` 收尾：留下错误信封，且 userMessage 非空（界面要显示它） (0.1689ms)
✔ T5 ⭐ 认不出的**阶段**原样显示、不崩（契约只举了 3 个阶段，规格要 5 个） (0.1763ms)
✔ T5b 认不出的**事件类型**不崩、也不假装处理过（只记进日志） (0.1368ms)
✔ T5c `total` 未知时百分比返回 **null**（显示不确定进度），不编一个数 (0.1341ms)
✔ T5d `etaSec` 缺失写 "—"，**不本地估算**（ETA 是引擎算的，契约 §3） (0.177ms)
✔ T6 `begin` 把状态清干净并标记已发起（避免上一次的失败项残留） (0.1976ms)
✔ T7 日志有上限（长任务跑几千条进度也不能无限涨内存） (0.7194ms)
✔ S12：库外 URL 一律不许导航；应用自身 URL 放行 (0.1802ms)
✔ S12b：dev 态只放行 electron-vite 的 URL，不放行任意 http (0.1102ms)
✔ S11：开新窗口**无条件** deny —— 不搞"判断后大多 deny" (0.1373ms)
✔ S13：顶层 frame 且来自主窗口 ⇒ 可信 (0.1764ms)
✔ S13：iframe 内调用 ⇒ 拒绝（frame.parent 不为 null） (0.1145ms)
✔ S13b：来源不是主窗口的 webContents ⇒ 拒绝 (0.1214ms)
✔ S13c：地址不属于应用自身 ⇒ 拒绝（即使是最外层 frame） (0.134ms)
✔ S13d：缺 senderFrame / 窗口已销毁 / 窗口不存在 ⇒ 一律拒绝（fail closed） (0.1303ms)
✔ S13e：dev 态下 127.0.0.1 的来源可信、别的 http 不可信 (0.1138ms)
✔ isAppUrl 只认 file:// 与 dev URL，其余一律 false (0.1172ms)
✔ indexStatus：返回每个库的 indexed/encoded/compat/healthy (12.875ms)
✔ indexStatus：库根不存在时 rootExists=false 且不抛异常 (9.5632ms)
✔ indexStatus：索引损坏 → problems 里带 INDEX_CORRUPT，且**不**抛给调用方 (8.8597ms)
✔ search(text)：命中同向条目，band 由引擎给（界面不自己算） (9.6163ms)
✔ search：结果带 libsSkipped 口径（无跳过时为 []） (8.9334ms)
✔ search：filters 生效（按 folder / ext 过滤） (9.2955ms)
✔ search：空文本 → BAD_REQUEST（信封，不抛） (8.2368ms)
✔ search：未知 mode → BAD_REQUEST (11.704ms)
✔ search：未注入编码器 → MODEL_MISSING (8.8885ms)
✔ search(image)：queryImagePath 是唯一允许的库外输入，且扩展名受限 (9.2383ms)
✔ search(image)：库内 imageRef 走 uid → 路径解析（不接受客户端路径） (9.5861ms)
✔ 多库：compat 相等 → 一起检索，结果带 libId (16.6972ms)
✔ 多库：compat 不等 → 该库进 libsSkipped 并给**结构化原因**（契约 §6） (12.2626ms)
✔ 多库：device 不同**不**导致跳过（否则 CPU 回退会拒绝自己的索引） (10.7935ms)
✔ scan：新增 / 消失 / 变化 都能报出（只读） (11.6129ms)
✔ item：返回索引条目 + 磁盘实况；文件没了要如实说 (11.5615ms)
✔ reveal：走注入的 shell 端口；不经传输层也能测 (34.0742ms)
✔ reveal：文件不在磁盘上 → ITEM_MISSING_ON_DISK (9.3259ms)
✔ reveal：未注入 shell 端口 → PORT_MISSING，且 ok 不为 true（不许假成功） (9.1589ms)
✔ reveal：shell 形状不对（缺 reveal / reveal 不是函数）→ 同样 PORT_MISSING (12.2864ms)
✔ reveal：端口存在但目标文件不存在 → ITEM_MISSING_ON_DISK，且端口**一次都没被调用** (8.9116ms)
✔ reveal：端口抛错 → 归为 INTERNAL 信封，不把异常漏给调用方 (9.5289ms)
✔ PORT_MISSING 的用户文案存在，且不含任何绝对路径 (0.1804ms)
✔ search：编码器忘了归一化时，引擎自行归一 → 排序与 band 仍正确 (8.0211ms)
✔ band：阈值随模态不同（分数不可跨模态比较） (0.1929ms)
✔ band：不认识的模态 → unknown，**不拿文本阈值猜**（R-3） (0.1489ms)
✔ collect：复制到已配置目录，库侧零变化 (9.8743ms)
✔ collect：无同名包时自动取图（auto 语义） (10.1114ms)
✔ collect：目标已存在 → skipped（**不覆盖**） (9.7363ms)
✔ collect：白名单外/未配置的目标名 → COLLECT_DIR_NOT_ALLOWED (9.0127ms)
✔ collect：部分成功必须如实呈现（成功/失败/跳过三分） (9.6589ms)
✔ collect：target=archive 但该素材无包 → failed 且说明原因 (9.1161ms)
✔ collect：uids 为空或超量 → BAD_REQUEST (8.4484ms)
✔ F1 契约 §8：模拟模式**绝不触碰真实文件系统** —— 判据是"库根根本不存在" (2.8919ms)
✔ F2 `search` 固定排序且可复现（同参数两次调用逐字段一致） (1.0234ms)
✔ F2b `__empty__` 触发「无结果」分支；compat 不符与索引损坏的库进 `libsSkipped` (0.5526ms)
✔ F3 `item` **不**返回绝对路径；`itemPaths` 才是要路径的地方（所有者决定） (0.4385ms)
✔ F3b 样例索引覆盖「待重编码 / 已从索引移除」两档（界面必须能演示） (0.4906ms)
✔ F12 ⭐⭐ fake 的 `item` 与**真实引擎**的 `item` **逐字同形**（防"模拟能跑、真库崩"） (0.5025ms)
✔ F4 `indexStart` 发进度事件：`done` 单调不减，收尾发 `index.done` (0.5663ms)
✔ F5 失败项非空 ⇒ `index.done.ok === false`，且每项可解释（哪条/哪个阶段/为什么） (0.4206ms)
✔ F6 ⭐ 取消**在边界生效**：cancel 后立刻收尾，且已处理数停在中间值 (0.4452ms)
✔ F6b `indexResume` 复用已编码行，并在事件里说明复用多少（契约 §3） (0.532ms)
✔ F7 `RECOVERY_NEEDED` 那条路可演示：有未收尾事务时写操作被拒且带可恢复信息 (0.598ms)
✔ F8 ⭐ `fake:false`（真实模式）下 `indexStart`/`mutate` 如实返回 `INTERNAL`，**不假装成功** (0.2412ms)
✔ F9 ⭐ fake 用到的**每个错误码**都在冻结的错误码表里（我曾造过一个 ENCODE_FAILED） (0.6089ms)
✔ F10 `fixtures/sample-index.json` 存在、条数达标、且覆盖契约 §8 要求的展示分支 (0.4872ms)
✔ F13 ⭐⭐ fake 的 `indexStatus.compat` 与真实引擎**同形**：8 段、顺序一致 (0.4439ms)
✔ F14 ⭐ `transactions`（契约 §2.11）：列出事务、可按 txId 查、并报告 `blocked` (0.5833ms)
✔ F15 ⭐ 撤销一条待处理事务：状态、canUndo 与 blocked 都要跟着变 (0.3518ms)
✔ F15b ⭐ 不可撤销的事务**如实拒绝**（`UNDO_EXPIRED`），不假装成功 (0.3849ms)
✔ F15c 写操作会**记进台账**（界面据此显示"最近发生了什么"） (0.3715ms)
✔ F16 ⭐ 真实模式 `transactions` 如实返回 `INTERNAL`（不返回空数组假装"没有事务"） (0.1529ms)
✔ F17 ⭐⭐ `UNIMPLEMENTED_METHODS` 与假套件**逐一对得上**，且真实模式全部 INTERNAL (0.814ms)
✔ F11 `createFakeKit` 必须注入 `bandOf` —— 不许在本模块里重算档位阈值 (0.3068ms)
✔ index: 合法索引可读回，且向量与写入一致 (1.6103ms)
✔ index: MAGIC 不对 → INDEX_CORRUPT（不是"读到了半个文件"） (2.0696ms)
✔ index: 截断文件 → 拒绝（footer 校验起作用） (1.7186ms)
✔ index: footer.complete 不是 true → 拒绝（写入未完成的判定） (15.6641ms)
✔ index: 向量块被改一个字节 → sha1 不符 → 拒绝 (2.7198ms)
✔ index: 文件不存在 → INDEX_MISSING（与"损坏"区分开） (0.4229ms)
✔ index: readItems / readMeta 对坏 JSON 抛 INDEX_CORRUPT (1.949ms)
✔ index: relOf 同时认新格式 relPath 与旧档 rel_path (0.1318ms)
✔ compat: 8 个成员，顺序固定 (0.1124ms)
✔ compat: device / gpu 型号**不参与**（否则 CPU 回退会拒绝自己的索引） (0.1565ms)
✔ compat: seq 不同 → 不等，并给出逐字段差异 (0.1351ms)
✔ compat: 权重精度不同 → 不等（fp32 vs q4f16） (0.1201ms)
✔ compat: 字段不齐 → 视为不完整，不参与相等判定 (0.1131ms)
✔ compat: compatReason 结构化原因含"哪一项不符 + 期望 + 实际"（契约 §6） (0.2063ms)
✔ compat: 真实索引用例（data/idx-full 存在时读其 header 并自比） (0.7192ms)
✔ errors: 信封形状（成功/失败） (0.1312ms)
✔ errors: 每个错误码都有用户可见文案（且不含绝对路径） (0.1932ms)
✔ errors: envelope 永不抛异常给调用方 (0.2206ms)
✔ ① 绝对路径一律拒绝（盘符 / UNC / 前导斜杠） (0.1305ms)
✔ ① 含 .. 的相对路径拒绝 (0.1168ms)
✔ ① 正常相对路径接受 (0.1654ms)
✔ ①..④ 经由 .. 逃逸 → PATH_ESCAPES_LIB (0.345ms)
✔ ③ 解析后的真实路径必须仍在库根内 (0.8384ms)
✔ ③ 与之同前缀的兄弟目录不能蒙混过关（前缀比较要带分隔符） (0.4901ms)
✔ ④ 库内指向库外的目录联接 → SYMLINK_REJECTED (1.2082ms)
﹣ ④ 指向库外的文件符号链接 → SYMLINK_REJECTED (21.3698ms) # 本环境无法创建文件符号链接：EPERM: operation not permitted, symlink 'D:\USERS\Desktop\Agent\gemma-search\data\_esbuild-tmp\gs-lib-aGEtRc\secret.jpg' -> 'D:\USERS\Desktop\Agent\gemma-search\data\_esbuild-tmp\gs-lib-ml1TWD\alias.jpg'
✔ ② 取件目标在白名单外 → COLLECT_DIR_NOT_ALLOWED (0.3547ms)
✔ ② 白名单要求整段匹配（E:\素材待用-x 不算命中） (0.1882ms)
✔ 查询图：扩展名白名单 + 必须是已存在的文件 (1.4532ms)
✔ ⑤ 解析与指纹是只读的：库指纹在操作前后不变 (2.2737ms)
✔ 注册表：未注册的库 → LIB_NOT_FOUND；根不存在 → LIB_ROOT_MISSING (0.6299ms)
✔ 注册表：uid → 路径解析走索引里的 relPath（不接受客户端路径） (1.2248ms)
✔ 注册表：索引里的 relPath 若被投毒（..\..）→ 仍被拦住 (0.3947ms)
✔ 指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性） (262.0239ms)
ℹ 库 3594 图 + 3594 包 · 指纹 3c62f15c5944 · 库根来自 index-meta
✔ uid: 形状是 12 位小写 hex (0.2187ms)
✔ uid: 确定性（同输入同输出） (0.1417ms)
✔ uid: 目录参与种子（同主干不同目录 → 不同 uid） (0.1251ms)
✔ uid: lib_id 参与种子（跨库不撞） (0.1049ms)
✔ uid: 根目录下的素材 rel_dir 为空串（不是 "."） (0.1091ms)
✔ uid: 黄金向量（锁住当前行为，改动即报警） (0.1171ms)
✔ uid: 整库唯一性（用真实素材库；库不存在则跳过） (25.2279ms)
ℹ 扫描 3594 张图 · 库根来自 index-meta（G:\model）
ℹ 整库 3594 张 · uid 唯一 · 样例 022a00481875 → CR\ID-032109719124396.png
ℹ tests 248
ℹ suites 0
ℹ pass 247
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 3797.2766
```

### 5.2 `npm run e2e`

```text
# npm run e2e   EXIT=0
    + FullyQualifiedErrorId : NativeCommandError
  ok  1 apps\desktop\e2e\a11y.spec.mjs:18:1 › E5-a ⭐ Chip 暴露 `aria-pressed`，且点击后真的翻转（不是只改 class） (2.3s)
  ok  2 apps\desktop\e2e\a11y.spec.mjs:41:1 › E5-b ⭐ 侧栏导航暴露 `aria-current="page"`，且跟着路由走 (2.1s)
  ok  3 apps\desktop\e2e\a11y.spec.mjs:63:1 › E5-c 空闲时**不渲染**确认弹窗（破坏性操作的确认框不该常驻） (3.0s)
  ok  4 apps\desktop\e2e\a11y.spec.mjs:77:1 › E5-d 图标按钮有可读名字（无障碍名字不是只有图标） (1.7s)
  ok  5 apps\desktop\e2e\activity.spec.mjs:20:1 › E11-a ⭐ 侧栏「操作记录」现在能点（不再是 disabled 占位） (2.3s)
  ok  6 apps\desktop\e2e\activity.spec.mjs:37:1 › E11-b ⭐ 事务表列出记录，每条都带**撤销状态**（UI-REVIEW:76 的安全底线） (1.9s)
  ok  7 apps\desktop\e2e\activity.spec.mjs:63:1 › E11-c ⭐ 待处理项给**三条路**，且「保持现状」明说它不动磁盘 (1.8s)
```

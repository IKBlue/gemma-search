# REVIEW-F01-F02 · 独立复核（证伪向）

- 复核者：独立 Agent（未参与 F-01 / F-02 的任何修复）
- 时间：2026-10-12 15:48–16:05（Asia/Shanghai）
- 工作区：`D:\USERS\Desktop\Agent\gemma-search`（Node v24.14.0 / Windows）
- 唯一写入的文件：本文件。被验证文件全程只读，例外是第 6/8 项要求的**临时**改动，已还原并附证据（见 §临时改动与还原）。
- 本文件所有输出均为**我自己跑出来的**原始输出；凡未实测的一律标【判断，非实测】或进 `limits[]`。

## verdict

**pass-with-issues**

- F-01、F-02 的**行为断言全部达标**（10 项检查里 8 项达标，2 项因环境限制无法完成完整闭环，见 `limits[]`）。
- 但复核中发现 **3 处上层声称不成立 / 过度声称**，其中 1 处直接推翻 AGENTS.md 里的「回归锁定」口径（见 `blockers[]` / `rebuttals[]`）。
- `blockers[]` 中的条目是**声称级**（claim-level）失实，**不影响修复本身的正确性**；功能行为经我独立复现为真。

## blockers

### B-1（声称级，最重要）「F-01 的接线有回归锁定」不成立

- **位置**：`AGENTS.md:253`（F-01 行末：「回归锁定：引擎 +5 条 · 外壳 +4 条（`apps/desktop/tests/ports.test.mjs`）· **守卫 §9**」）；`apps/desktop/tests/ports.test.mjs:8-10`（「这里测不到"主进程真的把端口传给了 createEngine"…那一层的证据是 `tools/verify_renderer_dom.mjs` 的端到端断言 + 代码审查」）
- **为什么不成立**：`tools/verify_renderer_dom.mjs` **从不加载 `apps/desktop/src/main/index.mjs`**，它只加载渲染层构建产物：
  - `tools/verify_renderer_dom.mjs:32` `const OUT_R = path.join(ROOT, 'out', 'renderer');`
  - `tools/verify_renderer_dom.mjs:133-147` 只 `import(pathToFileURL(out/renderer/assets/*.js))`
  - 该文件里 `engine.mjs` 只出现在「向上找仓库根」的 `fs.existsSync` 判断里（:25、:27），**没有 import 引擎，也没有 import 主进程**。
  - 而 `electron.vite.config.mjs:61-66`（main 入口）与 `:82-85`（renderer 入口）是**三个独立 bundle**，主进程代码不会进入 `out/renderer`。
  - `ports.test.mjs` 的 4 条只测 `ports.mjs` 里 `createRevealPort` 的转发/异常，**没有一条碰过「main 有没有调用它」**；全仓 `createRevealPort` 的引用只有 `main/index.mjs:28,153`、`ports.mjs:22`、`ports.test.mjs`、以及两份 docs。
- **实测反证**（见 check 6）：把 `main/index.mjs:153` 的注入行注释掉后，守卫仍然 **EXIT=0**。也就是说：**把 F-01 的接线删掉，所有自动化检查依旧全绿**——这条回归目前**零自动化覆盖**，只有代码审查兜着。

### B-2（声称级）「Score.jsx 的阈值在守卫里一眼可见」不成立（无任何静态检查）

- **位置**：`apps/desktop/src/renderer/src/ui/Score.jsx:16-18`：「`grep -nE '0\.[789][0-9]'` 对本文件恒为空 —— 让"又有人开始自算阈值"这件事**在守卫里一眼可见**」
- **为什么不成立**：那次 grep 只是**手工一行命令**，仓库里**没有任何守卫/测试执行它**：
  - `Get-ChildItem tools,apps\desktop\tests,packages\engine\tests -Recurse -File | Select-String 'Score\.jsx|0\\\.\(7|BAND_TEXT'` 的命中只有 `verify_renderer_dom.mjs` 的 §10 运行期断言（:354/:357/:385/:387），**没有阈值 grep**。
  - `tools/verify_renderer_styles.mjs` 只管颜色字面量与内联样式（:9-10、:59、:68、:80），不管分数阈值。
- **后果**：F-02 的回归锁定**只在一次成功 `npm run build` 之后**才生效（守卫读的是 bundle）。「在守卫里一眼可见」应改为「用 grep 可一眼看见，但没有守卫执行它」。

## checks（10 项逐项）

### check 1 · 不传 shell → PORT_MISSING，且 `ok !== true` ✅ 达标

我自己写的脚本（**不 import 仓库测试**）：`C:\Users\ADMINI~1\AppData\Local\Temp\gs-audit\f01.mjs`（自造临时库 + 自造最小合法索引 `index.bin/items.json/meta.json`，手法参照 `packages/engine/tests/engine.test.mjs` 的 `setup()`，代码是自己写的）。

```powershell
node "C:\Users\ADMINI~1\AppData\Local\Temp\gs-audit\f01.mjs"
```

原始输出（节选，① 段完整）：

```json
### ① 不传 shell
{
  "ok": false,
  "error": {
    "code": "PORT_MISSING",
    "message": "未注入 shell 端口（reveal 需要外壳提供 { reveal(absPath) }；当前 未提供）",
    "userMessage": "这个功能在当前环境里不可用（缺少所需的系统接口）。",
    "details": { "port": "shell", "got": "none" }
  }
}
   ok === true ? false | code = PORT_MISSING
```

### check 2 · 坏形状 `{}` 与 `{reveal:'x'}` → 同为 PORT_MISSING ✅ 达标

原始输出：

```text
### ② 坏形状 {}
{ "ok": false, "error": { "code": "PORT_MISSING", "message": "未注入 shell 端口（reveal 需要外壳提供 { reveal(absPath) }；当前 形状不对）", ... "details": { "port": "shell", "got": "object" } } }
   ok === true ? false | code = PORT_MISSING

### ② 坏形状 {reveal:'x'}
{ "ok": false, "error": { "code": "PORT_MISSING", ... "got": "object" } }
   ok === true ? false | code = PORT_MISSING
```

（与 `packages/engine/src/engine.mjs:443-447` 的实现一致：`!shell || typeof shell.reveal !== 'function'`。）

### check 3 · 注入计数 shell + 文件存在 → `ok:true` 且端口恰调 1 次 ✅ 达标

原始输出：

```text
### ③ 注入计数 shell（文件存在）
{ "ok": true, "data": { "revealed": true, "path": "...\\audit-f01-YJwT8s\\lib\\VR\\a.rar" }, "warnings": [] }
   ok === true ? true | 端口调用次数 = 1 | 传入 = [ '...\\audit-f01-YJwT8s\\lib\\VR\\a.rar' ]
```

- 调用次数**恰为 1**（自己计的数，不是读测试）。
- 传入的是**包文件**（`target:'archive'`），不是图片——契约 §2.4 的语义正确。

### check 4 · 目标文件不在盘上 → ITEM_MISSING_ON_DISK 且端口 0 次调用 ✅ 达标

原始输出（先 `fs.rmSync` 删掉 `VR\a.rar`）：

```text
### ④ 目标文件不在盘上
{ "ok": false, "error": { "code": "ITEM_MISSING_ON_DISK", "message": "文件不存在：VR\\a.rar", "userMessage": "素材文件找不到了，可能被移动或删除。", "details": { "rel": "VR\\a.rar" } } }
   ok === true ? false | code = ITEM_MISSING_ON_DISK | 端口调用次数 = 0
```

- 顺序正确：`engine.mjs:433` 的 `existsSync` 在 `:451` 调端口之前，所以"文件早没了"不会先弹目录。

### check 5 · `main/index.mjs` 里确实有 `shell:` 注入 ✅ 达标

`read` 工具读出的原文（`apps/desktop/src/main/index.mjs:152-153`）：

```js
152:     // 端口本身只负责调用；成功/失败的判定在引擎里（见 ports.mjs 的注释）。
153:     shell: createRevealPort(shell),
```

`grep -n 'shell'`（用 `Select-String`，UTF-8）佐证：

```text
31:const { app, BrowserWindow, ipcMain, protocol, nativeImage, dialog, shell } = electron;
153:    shell: createRevealPort(shell),
```

（`import { createRevealPort } from './ports.mjs';` 在 `:28`；`createEngine({` 从 `:142` 开始。）

### check 6 · 反向验证：注释掉注入行 ⇒ 守卫**没有**变红 ❌ 未达标（且原因是结构性的）

- 我做的：把 `main/index.mjs:153` 临时注释成 `// [独立复核临时改动 · 待还原] shell: createRevealPort(shell),`，再跑守卫。
- `npm run build` 在本沙箱**无法执行**（见 `limits[]` L-1），所以**没有重建**。但这不影响本项结论：守卫只读 `out/renderer/assets/*.js`（`:32`、`:133-147`），**根本不加载主进程**，重建与否都不改变结果——`out/main/index.js` 不在它的输入里。

原始输出：

```text
28:import { createRevealPort } from './ports.mjs';
153:    // [独立复核临时改动 · 待还原] shell: createRevealPort(shell),
（守卫尾部）
  [OK  ] ⭐ 缺 band 时只显示分数，**不猜档位**（诚实降级）  — 0.8100
================================================================================================
React 渲染层逻辑全过（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件）。
GUARD_EXIT=0
```

⇒ **任务书里"必须变红"的预期被证伪**：这个守卫**在设计上**就不可能抓到"注入行被删"这类回归（见 `blockers[]` B-1）。这是本次复核最重要的一条。

- 还原证据见 §临时改动与还原。

### check 7 · `Score.jsx` 里的 `0.(7|8|9)x` 阈值 ✅ 达标（0 命中）

```powershell
Select-String -Path apps\desktop\src\renderer\src\ui\Score.jsx -Pattern '0\.(7|8|9)[0-9]' -Encoding UTF8
→ 命中数 = 0
```

顺带扫了整个渲染层源码目录（更严）：

```powershell
Get-ChildItem apps\desktop\src\renderer\src -Recurse -Include *.jsx,*.js | Select-String -Pattern '0\.(7|8|9)[0-9]'
→ （无输出）
```

⇒ 渲染层**没有任何** `0.7x/0.8x/0.9x` 字面量（不止 Score.jsx 干净）。

### check 8 · 反向验证：把本地阈值放回 `Score.jsx` ⇒ 守卫**没有**变红 ❌ 未完成完整闭环

- 我做的（临时改动，`Score.jsx:43-45` 换成阈值驱动）：

```text
44:const b2 = Number(score) >= 0.97 ? 'high' : Number(score) >= 0.93 ? 'mid' : 'low'
```

- 因为 `npm run build` 跑不了（`spawn EPERM`），守卫读的仍是 15:47:48 的旧 bundle，结果：

```text
--- 10) 档位来自引擎（F-02：界面不得自算阈值）---
  [OK  ] band='mid' → 文案「很接近」  — 0.8100 · 很接近 · 1.1 MB
GUARD_EXIT=0
```

⇒ 这一跑只证明了**守卫的判定对象是构建产物，不是当前源码**（源码里已经有阈值，守卫照样绿）。**"重建后必红"这一步未验证**——原因见 `limits[]` L-1，不假装做过。

- **替代证据（已实测）**：对**当前构建产物**做对抗性输入探针（我自己写的 jsdom 探针 `f02-probe.mjs`，直接喂 `__DSH_RENDER('ui/Score.jsx', …)`）：

```text
分数 0.99 · 无 band（若界面自算阈值，这里必出档位文案）
  → text="0.9900" class="score" data-band=null
分数 0.10 · band=high（band 必须压过分数）
  → text="0.1000 · 同款区间" class="score high" data-band="high"
分数 0.99 · band=low
  → text="0.9900 · 较弱" class="score low" data-band="low"
未知 band=weird
  → text="0.8800" class="score" data-band=null
band=null / band=undefined
  → text="0.8800" class="score" data-band=null
```

- 产物自查：`out/renderer/assets/index-DcqHAbdb.js` 里 `'同款区间'/'很接近'/'较弱'` 各 1 处，`'0.97'` 与 `'0.93'` **0 处** ⇒ 该产物确实由**修复后的源码**构建，其上所有绿灯可归因于修复版源码。
- 【判断，非实测】按 `tools/verify_renderer_dom.mjs:373-378` 的断言，若重建后 Score 用 0.97/0.93，则 0.81 会被标成「较弱」⇒ `:375` 的 `!/较弱/` 会 FAIL，**理论上会变红**；但我没有跑通 build，故不把它算作已验证。

### check 9 · `Score.jsx` 只用传入的 `band`，缺失/未知时不出现任何档位文案 ✅ 达标

`apps/desktop/src/renderer/src/ui/Score.jsx:20-21, 40-50`（`read` 工具读出的真实行号）：

```jsx
20: /** 引擎 band → 中文文案。集中在这里，避免同一个概念散落多处。 */
21: const BAND_TEXT = { high: '同款区间', mid: '很接近', low: '较弱' }
...
40: export default function Score({ score, band, size }) {
43:   const known = !!band && Object.prototype.hasOwnProperty.call(BAND_TEXT, band)
44:   const cls = known ? `score ${band}` : 'score'
45:   const tail = [known ? BAND_TEXT[band] : '', humanSize(size)].filter(Boolean).join(' · ')
47:     <span className={cls} data-band={known ? band : undefined}>
48:       {Number(score).toFixed(4)}{tail ? ` · ${tail}` : ''}
```

- 档位的**唯一来源**是 `props.band`；函数体内**没有任何分数比较**（`Number(score)` 只用于 `toFixed(4)` 显示，:48）。
- `band` 缺失/未知 ⇒ `known=false` ⇒ 无档位文案、无 `data-band`，只显示分数（诚实降级）—— 由 check 8 的对抗探针实测覆盖（`0.99/0.60/weird/null/undefined` 五种输入均无档位文案）。
- 上游接线正确：`apps/desktop/src/renderer/src/search/PhotoCard.jsx:39` `<Score score={item.score} band={item.band} …>`，`band` 一路来自引擎 `packages/engine/src/engine.mjs:227` `band: bandOf(r.score, mode)`；渲染层没有第二处换算（`Get-ChildItem apps\desktop\src\renderer\src -Recurse | Select-String 'band'` 只命中 `Score.jsx` / `PhotoCard.jsx` / `renderer.css:269`）。

### check 10 · 档位命名三处同源 ✅ 达标

| 出处 | 值 |
|---|---|
| `packages/engine/src/engine.mjs:25-28` `BANDS` | `{ text: { high: 0.72, mid: 0.65 }, image: { high: 0.90, mid: 0.80 } }` |
| `packages/engine/src/engine.mjs:30-35` `bandOf` 返回 | `'high'` / `'mid'` / `'low'` |
| `apps/desktop/src/renderer/src/ui/Score.jsx:21` `BAND_TEXT` 键 | `high` / `mid` / `low` |
| `apps/desktop/src/renderer/src/renderer.css:268-272` 选择器 | `.score` / `.score.high` / `.score.mid` / `.score.low` |
| `docs/spec/CONTRACT-engine-v1.md:125` 契约 | `"band": "high" \| "mid" \| "low"` |

我跑出来的原始输出：

```text
BANDS = {"text":{"high":0.72,"mid":0.65},"image":{"high":0.9,"mid":0.8}}
  bandOf(0.85, "text")  = high
  bandOf(0.85, "image") = mid
268: .score { font-weight: 600; font-variant-numeric: tabular-nums; }
270: .score.high { color: var(--score-same); }
271: .score.mid  { color: var(--score-like); }
272: .score.low  { color: var(--score-weak); }
21: const BAND_TEXT = { high: '同款区间', mid: '很接近', low: '较弱' }
--score-same: var(--color-success);   （packages/design-tokens/tokens.css:88）
--score-like: var(--color-warning);   （:89）
--score-weak: var(--color-text-secondary);（:90）
```

三处键名完全一致，**且 CSS 用到的 3 个令牌都已定义**（不会出现"类名对但颜色丢"）。**无 blocker。**

### 附加（不属于 10 项）· `npm test` 门禁 ✅

```text
ℹ tests 89
ℹ pass 88
ℹ fail 0
ℹ skipped 1
ℹ duration_ms 844.9404
(exit code: 0)
```

与 `AGENTS.md` §5.1 声称的 `tests 89 · pass 88 · fail 0 · skipped 1` **逐字吻合**。

## rebuttals（主动反驳）

### R-1（找到，重要）「文档不声称、UI 却照旧过度声称」：成功提示仍然是假承诺

- **说 A**：`packages/engine/src/main`… 准确地说，引擎与端口两侧的注释**明确否认**更强的保证：
  - `packages/engine/src/engine.mjs:448-450`：「Electron 的 `shell.showItemInFolder` **返回 void、不报告失败**，所以这里**不能**断言"资源管理器一定弹出来了"。我们只保证：端口被调用了，且目标文件确实在盘上…这个边界必须如实写在契约里，**不得声称更强的保证**。」
  - `apps/desktop/src/main/ports.mjs:13-16`：「这里**没有**"成功了没"这个概念」
  - `docs/spec/CONTRACT-engine-v1.md:184`：`showItemInFolder` **返回 void，不报告失败**
  - `AGENTS.md:253`：「**不保证**"资源管理器真的弹到前面"」
- **磁盘是 B**：用户可见文案依旧是断言式的成功：

```text
apps\desktop\src\renderer\src\hooks\useSearch.js:80:
  onToast(r.ok ? '已在资源管理器中定位' : (r.error && r.error.userMessage) || '定位失败', r.ok ? 'info' : 'err')
```

  `ok` 只等价于「文件存在 + 端口被调了一次」。用户看到的却是「已在资源管理器中定位」——这正是本次修复要根除的那类**静默失实反馈**，只是把条件从"永远"收窄为"文件在盘上"。**没有任何检查断言成功路径的文案**：`tools/verify_renderer_dom.mjs:347` 只在**失败**时断言该字符串不出现（`__setRevealError` 由守卫自己伪造，:324-329），成功态文案全仓无断言。
- **建议**：成功文案降级为不含结果性断言的表述（如「已请求定位」/「已在资源管理器中打开所在文件夹」），或在引擎 `ok.data` 里给出 `guarantee: 'port-invoked'` 让界面照实说话。**这一条是本次复核最实在的功能性发现。**

### R-2（找到）「修好了但只在一半覆盖上修好」：接线层零自动化覆盖

见 `blockers[]` B-1。补充口径：**F-01 的引擎侧**（PORT_MISSING / 顺序 / 0 次调用）有 5 条引擎测试 + 我的独立脚本，扎得住；**外壳侧**只有 `ports.test.mjs` 测 `createRevealPort` 本体，**"main 有没有把它接上去" 零覆盖**，而两份文档都把它记在守卫 §9 名下。⇒ 声称的回归锁定只覆盖了 F-01 的一半。

### R-3（找到，潜在）`bandOf` 对 `vector` 模态**静默回退文本阈值**——F-02 同类错误仍在

- 我跑出来的原始输出：

```text
BANDS = {"text":{"high":0.72,"mid":0.65},"image":{"high":0.9,"mid":0.8}}
  bandOf(0.85, "vector") = high      ← 用了文本阈值；图像阈值下应是 mid
  bandOf(0.85, "VECTOR") = high
  bandOf(0.85, "typo")   = high
```

- `packages/engine/src/engine.mjs:30-35` 的 `BANDS[mode] || BANDS.text` 对**未知模态**一律回退文本；而 `apps/desktop/src/shared/ipc.mjs:22` `mode: z.enum(['text','image','vector'])` **允许** `vector` 进入。
- 现状是否可触发：`apps/desktop/src/renderer/src/hooks/useSearch.js:12` 只有 `'text' | 'image'`，界面**当前不会**发 `vector`；`tools/check_search.mjs`（文档 §5.2 描述为"向量模式，走引擎真实检索路径"）会走这条路径，但它只做端到端自查，不看 band。⇒ **潜在、非当前线上可见**，属"修好了但只按当下模态修好"。若将来放开向量检索，分数会按文本阈值分档，正是 F-02 的原始病灶。
- **【判断，非实测】**：严重度我判 low（当前界面不可达），但它是同一个根因的残留分支。

### R-4（找到，低）`createRevealPort(undefined)` 会让引擎的"形状校验"失效

- 我跑出来的原始输出：

```text
createRevealPort(undefined): {@keys} = ["reveal"] | typeof reveal = function
  调用抛出: TypeError - Cannot read properties of undefined (reading 'showItemInFolder')
```

- 引擎的判据是 `typeof shell.reveal === 'function'`（`engine.mjs:443`），而该端口**形状永远合法**，故障被推迟到调用时 ⇒ 得到的是 `INTERNAL` 而不是语义正确的 `PORT_MISSING`。当前 `main/index.mjs:31` 一定拿得到 `shell`，所以**不是现行缺陷**；但"端口缺失要显式失败"这条守卫在**端口内部依赖缺失**时不成立。
- 建议 `createRevealPort(shell)` 在一开始就校验 `typeof shell?.showItemInFolder === 'function'`，否则直接抛带 `PORT_MISSING` 语义的错误。

### R-5（找到，文档级，低）契约描述与磁盘实现不一致

- `docs/spec/CONTRACT-engine-v1.md:179` 写：「`apps/desktop/src/main/index.mjs` 的 `buildEngine()` 注入 `{ reveal: (abs) => shell.showItemInFolder(abs) }`」
- 磁盘实际是 `apps/desktop/src/main/index.mjs:153` `shell: createRevealPort(shell),`（端口工厂在 `apps/desktop/src/main/ports.mjs:22`）。**行为等价**，但按 `AGENTS.md` §4「每件事只有一个出处」，契约这一格已经与实现漂移（`ports.mjs` 在契约里未被提及）。不构成 blocker。

### R-6（找不到更多，已试过的角度）

已主动查过、**未发现问题**的角度，列出来供下一位复核者省力：

- **守卫断言是否同义反复**：`tools/verify_renderer_dom.mjs:373-378` 断言的是**界面显示的中文文案**与 `data-band`，不是"band 是 mid"；:391 断言的是"缺 band 时一个档位词都不出现"。**不是同义反复。** 唯一弱点是 §9 的失败信封由守卫自己伪造（:324-329），因此 §9 只锁界面、不锁引擎（已计入 B-1）。
- **界面是否仍间接依赖本地阈值**：见 check 7 全目录 grep（0 命中）与 check 8 的产物 grep（`0.97/0.93` 0 命中）；`renderer.css` 只按类名上色，不做数值判断。
- **CSS 类名与档位是否错位**：check 10 三处键名一致，3 个令牌均已定义。
- **只有成功路径假、或只有失败路径对**：两条路径都被我自己跑过（check 3 成功 / check 1、2、4 失败），不是单边修复——**但成功路径的"反馈语义"仍过度声称**（R-1）。
- **`target` 选择是否会把包错当图**：`useSearch.js:79` 以 `item.archive ? 'archive' : 'image'` 决定，引擎 `engine.mjs:431` 一致；`target:'archive'` 无包时回退图片路径（`relOf`）——两者配合无错位。
- **引擎是否 import 了 electron/http**（传输无关判据）：`packages/engine/src/engine.mjs` 只需要注入端口，`grep` 未见 electron/http；`npm test` 绿。
- **NaN 边界**：对抗探针显示 `{score: NaN, band:'mid'}` → `"NaN · 很接近"`（`Score.jsx:48` 对非数字不做处理）。引擎分数来自点积，实操不会 NaN ⇒ 仅为 nit，未计为 issue。

## limits（没能验证的，如实标"未验证"）

| # | 未验证项 | 具体边界 |
|---|---|---|
| L-1 | **`npm run build` 本沙箱无法执行** ⇒ check 6 / check 8 的"重新 build 后跑守卫"闭环**未验证** | 实测：`npm run build` → `error during build: Error: spawn EPERM at ensureServiceIsRunning (.../esbuild/lib/main.js:1978:29)`，EXIT=1。根因我自己复现并定位到"**管道 stdio 的 spawn 被禁**"：`node -e "execSync('cmd /c echo hi')"` → `EPERM`；而 `spawnSync(node, …, {stdio:'inherit'})` → `status 0`。这与 `AGENTS.md` §5.1 记录的环境限制一致。**我没有提权，也没有伪造 build 结果。** |
| L-2 | check 6 的"必须变红" | 严格说我只做了"注释掉注入行 + 跑守卫（未重建）"。**但结论不依赖重建**：守卫只读 `out/renderer/assets/*.js`（`tools/verify_renderer_dom.mjs:32,133-147`），主进程是独立 bundle（`apps/desktop/vite 配置` `electron.vite.config.mjs:61-66` vs `:82-85`），因此重建与否 `out/main` 都不会进入守卫输入。**若有人能重建，请补跑一次确认。** |
| L-3 | check 8 的"重建后必红" | 未验证（L-1）。我用**对抗性输入探针**（高分无 band / 低分 band=high / 未知 band / null / NaN，共 8 例）在**当前产物**上替代验证了"界面不自算阈值"这一**行为**；但"守卫能抓到阈值回归"只是【判断，非实测】。 |
| L-4 | `tools/verify_app_build.mjs` / `tools/smoke_app.mjs` | **未跑**：前者依赖 `out/`（且我无重建能力，跑旧产物只证明旧产物形状），后者需真启动 Electron。它们对本任务的 10 项检查不构成证据。 |
| L-5 | **真机行为**：`shell.showItemInFolder` 是否真的让资源管理器弹到前台 | 未验证，且按 `AGENTS.md:253` 与 `docs/spec/CONTRACT-engine-v1.md:184` 该项**本就不在保证范围内**（返回 void）。我的证据只到"端口被调用 1 次"，`ports.test.mjs` 也只到"参数原样转发"。 |
| L-6 | 我只在**自造 fixture** 上验证引擎（临时库 + 最小索引，8 维向量）；未在真实 3594 图索引上跑 `reveal` | `npm test` 里的真实库用例（指纹/uid 唯一性）只覆盖身份与库根解析，不覆盖 reveal。 |
| L-7 | `out/` 是**别人的**构建产物（mtime 2026-10-12 15:47:47-48，早于本会话 15:48），非我构建 | 我未写入 `out/`。产物内容自查（`'同款区间'` 在、`'0.97'` 不在）用于证明它与修复后源码一致。 |

## 临时改动与还原（纪律证据）

| 项 | 改动 | 还原证据 |
|---|---|---|
| check 6 | `apps/desktop/src/main/index.mjs:153` 临时注释 | 该行现为 `    shell: createRevealPort(shell),`；全仓 grep `独立复核临时改动` **命中数 = 0**；`git diff -U0 apps/desktop/src/main/index.mjs \| Select-String 'shell'` 输出 `+    shell: createRevealPort(shell),` 与 `+const { … shell } = electron;`（相对 HEAD 的新增，正是修复内容本身）；`git status --short` 该文件仍为 ` M`（与我进场时相同） |
| check 8 | `apps/desktop/src/renderer/src/ui/Score.jsx:43-45` 临时改为本地阈值 | 该三行现为 `known = !!band && hasOwnProperty(BAND_TEXT, band)` / `cls = known ? \`score ${band}\` : 'score'` / `tail = …BAND_TEXT[band]…`；`grep '独立复核临时改动\|b2'` **命中数 = 0**；阈值 grep 再次 **0 命中**；守卫复跑 **EXIT=0** |

- 全程**未** `git commit` / `git push`；**未**改 `out/`；**未**改任何被测文件（上述两处已还原）；除本文件外无任何写入。

## 一句话结论

**两处修复的代码行为，我用自己的脚本与对抗探针全部复现为真（F-01：`PORT_MISSING`/`ITEM_MISSING_ON_DISK`/成功恰调 1 次；F-02：档位只认 `band`、缺则闭嘴、三处命名同源）；但 F-01 的"接线层回归锁定"名不副实——把注入行删掉，守卫照样 EXIT=0，全仓没有任何自动化检查会红；且成功提示 `已在资源管理器中定位`（`useSearch.js:80`）仍在声称一个引擎与契约都明确不保证的结果。**

# docs/spec/SPEC-security.md —— 应用层安全规格（**P2 前置门禁**）

> **状态**：待批准。`TASK-PLAN.md` §P2 把本文件列为**前置门禁**：
> 「安全设计不允许留到编码过程中临时决定」。
> **权威**：引擎层的 5 条安全不变量在 `docs/spec/CONTRACT-engine-v1.md` §7（已实现并测过）；
> 本文件管**传输与外壳**层（IPC、自定义协议、渲染进程姿态、来源验证）。
>
> **为什么现在才写**：P0/P1 阶段引擎不接触网络也不接触外来源，安全面很小。
> P2 引入 Electron 后，攻击面从"本机 API"变成"渲染进程 ↔ 主进程 ↔ 文件系统"，
> 必须先把边界写清楚。

---

## 1. 威胁模型（明确边界，避免"什么都防"）

| # | 威胁 | 现实程度 | 对策 |
|---|---|---|---|
| T1 | **素材库里的文件名是恶意构造的**（含 HTML/JS/控制字符/超长/`..`） | **高** —— 素材来自互联网，文件名不受控 | 渲染进程**一律按纯文本处理**（§6 不变量 4）；服务端解析时校验 |
| T2 | 索引被外部篡改，`relPath` 被投毒成 `..\..\windows\...` | 中 | 引擎已拦（`resolveInLibrary`，P1 已测） |
| T3 | 库内被放入指向库外的**符号链接/联接点** | 中 | 引擎已拦（`realpath` 包含校验，P1 已测） |
| T4 | 渲染进程被注入脚本后调用 IPC 读任意文件 | 中 | 通道白名单 + zod + **仅按 `lib_id+uid` 解析**（不接受路径入参） |
| T5 | `thumb://` 被构造为路径穿越（`thumb://../..///etc/passwd`） | 中 | 协议处理器**只认 `libId/uid@size` 形状**，路径由注册表+索引反查 |
| T6 | 子窗口 / iframe / 被导航到外部页面后调用 IPC | 中 | **来源校验**：只接受已知窗口主 frame 的调用（§4） |
| T7 | 取件写出到任意目录（覆盖系统文件） | 中 | 取件目录**白名单**（P1 已测）+ 目标已存在则跳过不覆盖 |
| T8 | 界面里 `innerHTML` 渲染文件名造成 XSS | **高**（配合 T1） | 禁用 `innerHTML`/`dangerouslySetInnerHTML` 于任何来自引擎的字符串 |
| T9 | 打包后 asar 内被替换代码 | 低 | 签名（P6 再议；当前明确记为**未做**） |
| T10 | 供应链（npm 依赖被投毒） | 低-中 | 依赖数量刻意最小；`package-lock.json` 入库（§7） |

**明确不防**（写出来是为了不让规格显得比实际更强）：
- 本机管理员级别的攻击者
- 物理接触、内存转储、调试器附加
- 已签名的 Electron 自身漏洞（只能靠升级）
- **联网**：本应用**不联网**（除首次下载模型，且那是显式用户动作），所以不做 CSRF/DNS-rebinding 防护 —— 这也正是**不引入 REST/HTTP 端口**的原因之一（`docs/design/DESIGN-app-details.md` §8）

---

## 2. 传输层：单通道 + 白名单

**不用多个 `ipcMain.on` 散落各处**，只开两个通道，方法名在参数里：

| 通道 | 方向 | 载荷 |
|---|---|---|
| `engine:invoke` | 渲染 → 主（`invoke`/`handle`） | `{ method: string, params: object }` |
| `engine:event` | 主 → 渲染（`webContents.send`） | 契约 §3 的事件对象 |

### 2.1 白名单与参数校验（**唯一来源：`src/shared/ipc.mjs`**）

```js
// src/shared/ipc.mjs —— zod schema 定义一次，同时导出 TS 类型与运行时校验
export const METHODS = {
  search:        z.object({ mode: z.enum(['text','image','vector']), text: z.string().max(200).optional(),
                            imageRef: z.object({ libId: LibId, uid: Uid }).optional(),
                            queryImagePath: z.string().max(4096).optional(),
                            vector: z.array(z.number()).max(4096).optional(),
                            libIds: z.array(LibId).max(32).optional(),
                            topK: z.number().int().min(1).max(200).optional(),
                            filters: z.object({ folders: z.array(z.string().max(64)).max(32).optional(),
                                                exts: z.array(z.string().max(16)).max(32).optional() }).optional() }),
  item:          z.object({ libId: LibId, uid: Uid }),
  indexStatus:   z.object({}),
  scan:          z.object({ libId: LibId }),
  reveal:        z.object({ libId: LibId, uid: Uid, target: z.enum(['image','archive']).optional() }),
  // collect / ingest / mutate / indexStart / indexCancel / indexResume 同此登记
};
```

**强制约定**
1. **未登记的方法名一律拒绝**（`BAD_REQUEST`），不落到 `default:` 分支不管
2. `params` 先过 zod（`strict()`，**未知字段即报错**）；失败返回 `BAD_REQUEST`，**不回显原始 params**（可能含敏感路径）
3. `LibId` = `/^[A-Za-z0-9_-]{1,32}$/`；`Uid` = `/^[0-9a-f]{12}$/`
4. **没有任何方法接受"绝对路径"入参** —— 唯一例外是 `search` 的 `queryImagePath`
   （用户临时选的库外查询图），它只用于**只读解码**，且扩展名白名单在引擎里（P1 已测）
5. 载荷大小上限：单次 `engine:invoke` 的 JSON ≤ 1 MB（超限直接拒绝，防内存放大）

---

## 3. `thumb://` 自定义协议加固

**形状（唯一允许）**：`thumb://<libId>/<uid>@<size>`

| 段 | 校验 |
|---|---|
| `libId` | 必须在**库注册表**里；否则 404 |
| `uid` | `/^[0-9a-f]{12}$/`；否则 400 |
| `size` | 仅允许 `128` / `256` / `512`；否则 400 |

**处理器实现要求**
1. **绝不把 URL 当路径用**：路径由 `注册表.root + 索引里的 relPath` 反查，再经
   `resolveInLibrary()`（含词法包含 + `realpath` 包含 + 符号链接拒绝）
2. 命中缩略图缓存（应用数据目录）则直接返回；未命中才生成，**生成只写应用数据目录**
3. 返回前设 `Content-Type: image/jpeg`，并**只读**文件（不落库）
4. 失败一律返回**空图 + 适当状态码**，不泄漏路径与堆栈
5. 必须在 `protocol.registerSchemesAsPrivileged` 里声明为
   `{ standard: true, secure: true, supportFetchAPI: true, stream: true }`
   —— 否则会被当成可被网页加载的不安全 scheme

> **为什么不用 `file://` 直接给渲染进程**：那等于把整个文件系统交给它（T4）。
> `thumb://` 把能力收窄成"只能取某个库的某条素材的某档缩略图"。

---

## 4. 调用来源验证

`engine:invoke` 的处理器**第一步**就做来源校验，任一不符即拒绝并记录：

| 检查 | 条件 |
|---|---|
| 顶层 frame | `event.senderFrame.parent === null`（拒绝 iframe） |
| 已知窗口 | `event.sender` 必须是主窗口的 `webContents`（拒绝任何 `webContents.fromId` 未知对象） |
| 页面来源 | `senderFrame.url` 必须是应用自身：开发态 `http://localhost:<port>`，生产态 `app://…` 或 `file://…` 的**应用根**；**不接受** `http(s)://` 外部来源 |
| 窗口数 | 只允许**一个**主窗口；`setWindowOpenHandler` 一律 `deny` |
| 导航 | `will-navigate` → 除应用自身以外**一律 `preventDefault()`** |

---

## 5. 渲染进程姿态（BrowserWindow 硬要求）

```js
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,          // 必须
    contextIsolation: true,          // 必须
    sandbox: true,                   // 渲染进程也进沙箱
    webSecurity: true,               // 必须
    allowRunningInsecureContent: false,
    preload: <absolute path>,        // preload 只暴露白名单方法
    spellcheck: false,
    webviewTag: false,               // 禁用 <webview>
  },
});
```

- **preload 只暴露**：`invoke(method, params)`、`onEvent(cb)`、`offEvent(cb)`。**不暴露** `ipcRenderer` 本体、不暴露 `require`、不暴露任何 `fs`/`path`。
- **CSP**（通过响应头或 `meta`，两者都设）：
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' thumb: data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```
  - 生产态**不得**出现 `'unsafe-eval'`；开发态若 HMR 需要，必须是**仅开发**且以构建常量区分
  - **离线要求**：`connect-src 'self'` 即隐含"不得连任何远程源"（与 `SPEC-app` §6「禁止 CDN」一致）
- **`webPreferences.devTools`**：**生产态也保留**（2026-10-10 决定，见 §9 决定 3）。
  理由：这是**本机自用工具**，此处主要威胁（物理接触、管理员权限）本就在 §1「明确不防」里；
  排障收益更大。代价是"任何能操作这台机器的人都能打开 DevTools" —— 已知并接受。

---

## 6. 四条渲染层不变量（可执行）

| # | 不变量 | 判据 |
|---|---|---|
| 1 | 引擎返回的**任何字符串**都按纯文本渲染 | 代码里 `dangerouslySetInnerHTML` **零使用**（grep 检查）；文件名含 `<img onerror=…>` 时只显示文字 |
| 2 | 渲染进程拿不到任意路径读取能力 | preload 暴露面只有三个函数；`window.require`/`window.process` 为 `undefined` |
| 3 | 路径只出现在 `details` 里，不出现在 `userMessage` | 引擎已保证（P1 测试断言 userMessage 无绝对路径）；界面默认不展示 `details` |
| 4 | 只读操作不写库 | 跑完浏览/搜索/预览后，库指纹不变（P1 已测：`fingerprintV1` 前后一致） |

> **不变量 1 不是形式主义**：素材文件名来自互联网，`<` `>` `&` 完全可能出现，
> 而"图库"这类界面最容易顺手用 `innerHTML` 拼卡片。

---

## 7. 依赖与供应链

### 7.1 为什么要逐个交代

安全规格里写"依赖最少"是空话 —— 必须说清**每个依赖换来什么、不装它要付什么代价**，
否则"最少"无人可审。实测体量：`node_modules` **596 MB / 16,894 文件 / 288 个顶层包**，
但**生产依赖只有 21 个**（其余是构建工具，不进安装包）。

### 7.2 运行时依赖（21 个，会进安装包）

| 依赖 | 换来什么 | 不装它要付什么 |
|---|---|---|
| `react` + `react-dom` 19.3 | 结果网格 / 筛选面板 / 任务状态这类复杂交互的组件模型；也是 shadcn 生态的前提 | 手写 DOM 同步；虚拟列表与弹窗焦点管理都要自己来 |
| `zustand` 5.0 | 小状态仓库；**IPC 事件流直接灌进 store**（索引进度是推送，不是轮询） | 自建发布订阅；或引入 TanStack Query —— 但本项目**没有 HTTP 层**，那是错配 |
| `@tanstack/react-virtual` | **仅**用于浏览整库 3594 条时的窗口化 | 3594 个 DOM 节点；搜索 Top-K ≤100 不需要它 |
| `lucide-react` 1.55 | 图标（**本地包，满足离线要求**，替掉原型里的 Unicode 字符） | 自绘 SVG 或字体图标；CDN 图标违反离线约束 |
| `zod` 4.6 | **IPC 契约的唯一来源**：一份 schema 同时导出运行时校验与 TS 类型 | 手写校验散落各处 —— 而"IPC 参数白名单"正是要靠它才不是空话 |
| `clsx` + `tailwind-merge` + `class-variance-authority` | shadcn 三件套：条件类名 / 冲突合并 / 变体定义 | 手写类名拼接，冲突类（`p-2 p-4`）会随机生效 |
| 12 × `@radix-ui/*` | **无障碍原语**：Dialog / AlertDialog（**文件操作确认弹窗**）/ Popover / Select / Tooltip / Switch / Checkbox / DropdownMenu / Toast / Slot / Tabs / Label | 手写焦点陷阱与 `aria-*` —— a11y bug 的集中地，且确认弹窗是**不可逆操作**的最后一道确认 |

### 7.3 刻意**不引入**的（同样是设计决定）

| 不引入 | 理由 |
|---|---|
| 数据请求库（TanStack Query / SWR） | 没有 HTTP 层。传输是 IPC + 事件流 |
| 表单库（react-hook-form / formik） | 表单极少（设置页）。zod 已能校验 |
| 组件库（MUI / AntD / Chakra） | 会与 `docs/design/DESIGN-tokens.md` 的视觉体系打架；shadcn 是**拷进来的代码**，我们拥有它 |
| CSS-in-JS 运行时（styled-components / emotion） | Tailwind + `tokens.css` 已足够；运行时样式既慢又与 CSP 关系复杂 |
| 状态机库（xstate） | 事务状态机很小，且必须住在 `core/` 里被无头测试覆盖 —— 引入库反而增加耦合 |
| 图形库 / 图表库 | 明确不做（`docs/design/UI-REVIEW-and-migration.md` §8） |
| `sharp` / `jimp`（缩略图） | Electron 自带 `nativeImage`，省掉一个约 30 MB 的原生依赖 |
| 数据库（better-sqlite3 等） | 索引是单文件、注册表是 JSON。引入 DB 只增加迁移与打包负担 |
| `electron-updater` | 不做自动更新（未决策）；它会新增一条**联网**通路 |
| 自动修复类工具（`npm audit fix --force`） | 会静默做大版本变更，破坏"可复现" |

### 7.4 构建工具链（devDependencies，**不进安装包**）

`electron` 44.7（含 371 MB 平台二进制）· `electron-vite` 5.0（三端构建一体）·
`vite` 7.3 · `electron-builder` 26.15（NSIS 打包，P6 用）· `typescript` 7.0.2 ·
`tailwindcss` 4.3 + `@tailwindcss/vite` · `vitest` 5.0.3 · `@types/*`

> `electron-winstaller`（30.7 MB）是 electron-builder 的 Squirrel 依赖，我们用 NSIS，
> 属**开发期冗余**；清不掉（上游依赖），记录在此以免将来被误认为"我们选了 Squirrel"。

### 7.5 测试运行器的现状（如实记录一处规格偏离）

`SPEC-app` §7 写的是 vitest。**当前 `core/` 的 61 条测试跑在 `node:test` 上** ——
起因是当时受限沙箱下 `npm install` 会 EPERM，于是 P1 引擎刻意做成**零依赖**
（这也让"`core/` 传输无关"变成最强的形式：它连测试框架都拉不进来）。

现在依赖已可用，处置如下（**推荐**，待你在 §9 确认）：
- **`core/` 继续用 `node:test`** —— 零依赖是引擎的一项特性，不是权宜
- **`app/` 与 `src/shared/` 用 vitest** —— 那里是 TS + React，确实需要 jsdom 与 TS 转换
- 若你要求全仓统一到 vitest，`core/` 的 4 个测试文件可机械迁移（约半小时）

### 7.6 流水线与约束

- **`package-lock.json` 必须入库**（锁定完整依赖树）
- 新增依赖要过 `SPEC-app` §8 的 "Ask first"
- 安全升级单独提交并跑全测试；**不启用** `npm audit fix --force` 这类自动大版本变更
- Electron/Chromium 安全更新列入 P6 发布检查：**升级 Electron 必须重跑 §8 的权限测试用例**

---

## 8. 权限测试用例（**P2 验收必须全过**）

自动化（写进 `tests/`，可在无窗口下尽量覆盖）：

| # | 用例 | 期望 |
|---|---|---|
| S1 | 调未登记方法 `engine:invoke {method:'exec'}` | 拒绝，`BAD_REQUEST` |
| S2 | `search` 传未知字段（`zod.strict`） | 拒绝，`BAD_REQUEST` |
| S3 | `libId` 传 `../etc`、`uid` 传 `../../../x` | 拒绝（格式不符） |
| S4 | `thumb://../../windows/win.ini` | 400/404，**不产生文件读取** |
| S5 | `thumb://L1/<合法 uid>@999` | 400（size 不在白名单） |
| S6 | `thumb://L9/<合法 uid>@256`（未注册库） | 404 |
| S7 | 索引里投毒 `relPath = ..\..\windows\system32\x.dll` 后 `item` | `PATH_ESCAPES_LIB` |
| S8 | 库内放指向库外的 junction 后 `item`/`thumb` | `SYMLINK_REJECTED` |
| S9 | 渲染进程 `typeof window.require` / `window.process` | `undefined` |
| S10 | 文件名设为 `<img src=x onerror=alert(1)>.jpg`，在结果网格显示 | 页面无脚本执行；DOM 里是文本节点 |
| S11 | `setWindowOpenHandler` 尝试开新窗口（`window.open('https://example.com')`） | 被 deny，无新窗口 |
| S12 | 主窗口内 `location.href='https://example.com'` | `will-navigate` 阻止 |
| S13 | iframe 内调用 `engine:invoke` | 拒绝（来源校验） |
| S14 | `engine:invoke` 载荷 > 1 MB | 拒绝 |
| S15 | 取件到白名单外目录 | `COLLECT_DIR_NOT_ALLOWED` |
| S16 | 只读流程跑完，库指纹比对 | 不变 |

人工（无法自动化，单列）：DevTools 里确认无远程请求；断网全流程可用。

---

## 9. 决定记录（2026-10-10）

| # | 事项 | 你的决定 | 处置 |
|---|---|---|---|
| 1 | **本文件是否批准** | **暂批** | 可作为 P2 编码依据；实质性问题出现时再回头修订，不阻塞开工 |
| 2 | 依赖最小集 | **要求详细交代** | 已按 §7.1–§7.4 逐个说明"换来什么 / 不装要付什么"，含**刻意不引入**清单与实测体量 |
| 3 | 生产态 DevTools | **不关闭** | 生产态**保留** DevTools（`webPreferences.devTools: true`）。理由成立：这是**本机自用工具**，主要风险是本机物理接触与管理员 —— 已在 §1「明确不防」里列明。排障收益大于此处的边际风险 |
| 4 | CSP 的 `style-src 'unsafe-inline'` | **要最终推荐** | 见 §10 |

---

## 10. 关于 CSP `style-src 'unsafe-inline'` 的最终推荐

**推荐：保留 `style-src 'self' 'unsafe-inline'`，不为了"更严"去做 nonce/hash 改造。**

### 10.1 先看清这条风险到底是什么

`'unsafe-inline'` 加在 **`style-src`** 上（不是 `script-src`），它允许的是
**内联样式**（`<style>` 块与 `style="…"` 属性）。它能造成的后果限于：

- 视觉欺骗 / UI 重排（在**我们自己的窗口内**）
- 通过 CSS 选择器侧信道做**极有限的**信息推断（本地应用、无远程内容，价值极低）

**它不能**执行脚本。而本项目同时具备三重压制：
`script-src 'self'`（无内联脚本、无 eval）· **不变量 1**（引擎返回的字符串一律按纯文本渲染，
`dangerouslySetInnerHTML` 零使用）· 不加载任何远程内容。
换言之：**要利用样式注入，攻击者得先有脚本执行权，而这三条正是堵脚本执行的。**

### 10.2 为什么"更严"在技术上做不到，做了也是安全剧场

`style-src` 的 nonce/hash 只能覆盖 **`<style>` 元素**，**覆盖不了 `style="…"` 属性**。
而 Radix 的定位组件（Popover / Select / Tooltip / DropdownMenu）在运行时会往
`style` 属性写 `transform`/`top`/`left` —— 这些值**随交互动态变化，无法预先算 hash**。

因此要真做到 `style-src 'self'`，只有三条路：
1. 放弃 Radix 的定位组件，自己实现弹出层定位（**重新引入 a11y 与定位 bug**，与 §7.2 选 Radix 的理由直接冲突）
2. 加 `'unsafe-hashes'` 或 `style-src-attr 'unsafe-inline'` —— **等于把限制加回来**
3. 给动态样式值做 nonce 注入 —— 对属性无效，做不到

即：**严格的版本在本项目里不可达**；强行写上去只会让规格看起来更安全，实际一改就破。

### 10.3 真正该花力气的地方（已做/将做）

| 控制 | 状态 |
|---|---|
| `script-src 'self'`（无内联、无 eval） | 规格要求；生产态明确禁止 `'unsafe-eval'` |
| 引擎返回字符串**一律纯文本渲染**（不变量 1） | 已写进 §6；P2 用 grep 检查 `dangerouslySetInnerHTML` 零使用 |
| `object-src 'none'` · `base-uri 'none'` · `form-action 'none'` · `frame-ancestors 'none'` | 规格要求 |
| `connect-src 'self'`（**无外联即无外泄**） | 规格要求，与"离线可用"一致 |
| 不加载远程内容 + 拒绝导航 + 拒绝新窗口 | §4 来源验证 |
| 只读操作不写库、路径只能由 lib_id+uid 解析 | 引擎层已实现并测试（`docs/spec/CONTRACT-engine-v1.md` §7） |

### 10.4 如果你仍要更严

可接受的**增量**（成本低、收益明确）是把 `style-src` 拆细，明示我们只放开了属性那一半：

```
style-src-elem 'self' 'unsafe-inline';   /* Tailwind 产出的 <style> */
style-src-attr 'unsafe-inline';          /* Radix 的运行时定位属性 */
```

这不提升安全性，但让"我们放开了什么"在 CSP 里一眼可见，便于将来复查。
**要不要加，你一句话即可**；不加也不影响开工。

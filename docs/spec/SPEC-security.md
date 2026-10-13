# docs/spec/SPEC-security.md —— 应用层安全规格

> **状态**：现行（§9 决定 1「暂批」）· **最后核对**：2026-10-12
> **权威范围**：传输与外壳层安全 —— IPC 白名单与参数校验、`thumb://` 协议加固、渲染进程姿态、
> 调用来源验证、依赖与供应链、权限测试用例。
> 引擎层的 5 条安全不变量以 `docs/spec/CONTRACT-engine-v1.md` §7 为准（已实现并有单测）；
> 本文件只管**传输与外壳**层。
>
> 本文件是 **P2 的前置门禁**：安全设计不允许留到编码过程中临时决定。
> P0/P1 阶段引擎不接触网络也不接触外来源，安全面很小；P2 引入 Electron 后，
> 攻击面从"本机 API"变成"渲染进程 ↔ 主进程 ↔ 文件系统"，所以边界必须先写清楚。

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

### 2.1 白名单与参数校验（**唯一来源：`apps/desktop/src/shared/ipc.ts`**）

```js
// apps/desktop/src/shared/ipc.ts —— zod schema 定义一次，同时给出方法白名单与运行时校验
// （注意：本文件是 .mjs，**不导出 TS 类型**；"一份定义两处受益"目前只体现在运行时侧）
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
| `libId` | 必须在**库注册表**里；否则 404（⚠️ **形状优先**：`uid`/`size` 也不合法时按 400 处理，见下） |
| `uid` | `/^[0-9a-f]{12}$/`；否则 400 |
| `size` | 仅允许 `128` / `256` / `512`；否则 400 |

> **判定顺序（2026-10-12 明确，实测钉住）**：**先形状、后库登记**。
> 一个请求同时违反两条（例如 `thumb://R3/`）时返回 **400**（实测）。
> 行为断言在 `tools/verify_main_wiring.mjs` §4：`@999`⇒400、`not-a-uid`⇒400、穿越⇒400、未注册库（形状合法）⇒404。

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
| 页面来源 | `senderFrame.url` 必须是应用自身：开发态 `http://localhost:<port>`，生产态 `file://…`（⚠️ 实现是 **`startsWith('file://')` 前缀放行**，不是"应用根"精确比对；本仓库也没有 `app://`。影响与收紧方向见 §8.1）；**不接受** `http(s)://` 外部来源 |
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

- **preload 只暴露三个成员**：`invoke(method, params)`、`onEvent(cb)`（**返回退订闭包**，没有独立的 `offEvent`）、`platform`。
  **不暴露** `ipcRenderer` 本体、不暴露 `require`、不暴露任何 `fs`/`path`。
  （实现：`apps/desktop/src/preload/index.js`；源码是 ESM，但构建产物必须是 **CJS**，因为 `sandbox: true` 不加载 ESM preload。）
- **CSP**（通过响应头或 `meta`，两者都设）：
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' thumb: data:; font-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```
  - 生产态**不得**出现 `'unsafe-eval'`；开发态若 HMR 需要，必须是**仅开发**且以构建常量区分
  - **离线要求**：`connect-src 'self'` 即隐含"不得连任何远程源"（与 `docs/spec/SPEC-app.md` §6「禁止 CDN」一致）
- **`webPreferences.devTools`**：**生产态也保留**（2026-10-10 决定，见 §9 决定 3）。
  理由：这是**本机自用工具**，此处主要威胁（物理接触、管理员权限）本就在 §1「明确不防」里；
  排障收益更大。代价是"任何能操作这台机器的人都能打开 DevTools" —— 已知并接受。

---

## 6. 四条渲染层不变量（可执行）

| # | 不变量 | 判据 |
|---|---|---|
| 1 | 引擎返回的**任何字符串**都按纯文本渲染 | 代码里 `dangerouslySetInnerHTML` **零使用**（grep 检查）；文件名含 `<img onerror=…>` 时只显示文字 |
| 2 | 渲染进程拿不到任意路径读取能力 | preload 暴露面只有三个成员（`invoke` / `onEvent` / `platform`）；`window.require`/`window.process` 为 `undefined` |
| 3 | 路径只出现在 `details` 里，不出现在 `userMessage` | 引擎已保证（P1 测试断言 userMessage 无绝对路径）；界面默认不展示 `details` |
| 4 | 只读操作不写库 | 跑完浏览/搜索/预览后，库指纹不变（P1 已测：`fingerprintV1` 前后一致） |

> **不变量 1 不是形式主义**：素材文件名来自互联网，`<` `>` `&` 完全可能出现，
> 而"图库"这类界面最容易顺手用 `innerHTML` 拼卡片。

---

## 7. 依赖与供应链

### 7.1 为什么要逐个交代

安全规格里写"依赖最少"是空话 —— 必须说清**每个依赖换来什么、不装它要付什么代价**，
否则"最少"无人可审。

**实测体量**（2026-10-12）：

| 项 | 实测值 | 可复现命令 |
|---|---|---|
| **依赖树规模（唯一权威口径）** | **662 条** | `node -e "console.log(Object.keys(require('./package-lock.json').packages).length - 1)"` |
| `node_modules` 体积 | **1089.9 MB** | `[math]::Round((Get-ChildItem node_modules -Recurse -File \| Measure-Object Length -Sum).Sum/1MB,1)` |
| `package.json` `dependencies`（会进安装包） | **24 个** | `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"` |

> **依赖规模为什么以锁文件为准**：`package-lock.json` 由 npm **确定性生成**，条目数精确可复现
> （实测连测三次均为 **662**；其中 4 条是本仓库 workspace 自链接 `@gemma-search/*`）。
> `node_modules` 目录结构则是**安装的派生结果**，会随安装漂移 —— 见下方警告。

> ⚠️ **不要**用 `node_modules` 目录计数作为依赖规模指标。2026-10-12 三次独立复算分别得到
> **449 / 453 / 445**（口径不同、且随安装漂移：`-Force` 计数会把非包的 `.bin`/`.vite` 算进去，
> 整个 `@scope/` 又只算 1 个，而 workspace 自链接还会随时增减）。**早期文档里的 288 / 334 即因此出错** ——
> 换成任何"更准的目录数"都会重演同一个错误。要可复现的数字，请用上表的**锁文件条目数**命令。

> ⚠️ **必须区分"声明了"与"用到了"。** `dependencies` 会被 `electron-builder` **全部收进安装包**
> （`electron.vite.config.mjs` 的 `externalizeDepsPlugin()` 把它们全列为 external，打包时按 `dependencies` 收），
> 所以"声明了却没人用"直接等于安装包变胖。
>
> ✅ **2026-10-13（T4）已实测重数并清账**：清理前 **25** 个生产依赖里 **19 个零 import**、
> 开发依赖里另有 **9 个零 import**；清理后生产依赖 **12 个，全部有用**（或落在 §7.3 的隐式白名单里）。
> **本轮实测命令与逐条判定见 §7.3**（旧数字 18 是当时的快照，已作废）。

### 7.2 运行时依赖：实际被用到的（2026-10-13 T4 实测 **12** 项）

| 依赖 | 谁 import（`文件:行号`） | 换来什么 | 不装它要付什么 |
|---|---|---|---|
| `react` + `react-dom` | `apps/desktop/src/renderer/src/main.jsx`（`react`、`react-dom/client`）与各 `.jsx` | 结果网格 / 筛选面板 / 任务状态的组件模型 | 手写 DOM 同步；弹窗焦点管理都要自己来 |
| `zod` | `apps/desktop/src/shared/ipc.ts:5` | **IPC 契约的唯一来源**：一份 schema 同时给出方法名白名单与运行时参数校验 | 手写校验散落各处 —— 而"IPC 参数白名单"正是要靠它才不是空话 |
| `@huggingface/transformers` | `apps/desktop/src/main/encoder.mjs:11` · `packages/indexer/src/*.mjs` | ONNX + WebGPU 的文/图编码器；索引与查询两侧共用 | 没有编码路径，索引与检索都不成立 |
| **`sharp`** | `packages/indexer/src/resize_compat.mjs:35` 的 **`await import('sharp')`**（**动态** import），经 `apps/desktop/src/main/encoder.mjs:12` 进入生产路径；`packages/indexer/src/bmp_decode.mjs:139` 亦用 | 重采样兼容层 `resize_compat(pil-like)` —— 把 Node 侧 resize 钉成与参考实现同源；`preprocessing_version` 2 的一致性依据 | 索引侧与查询侧的重采样不同源 → 检索结果**静默变差**（本项目最危险的失败模式） |
| `bmp-js` | `packages/indexer/src/bmp_decode.mjs:55`（动态 import） | 纯 JS 的 24 位 `BI_RGB` BMP 解码 + 合成图布局自检；救回 20 张"文件名 `.jpg` 实为 BMP"的预览图 | 可编码条目 3594 → **3574**，那 20 张永远搜不到 |
| `electron` | `apps/desktop/src/main/index.mjs`（`devDependencies`，但外壳本体） | 主进程 / preload / 渲染进程外壳 | 没有外壳 |

> **`sharp` 曾被本文件错列为"刻意不引入"（已更正，见 `docs/audit/00-current-state.md` §5 D9）。**
> 它从 v1 起就在 `package.json` 的 `dependencies` 里，且被生产路径使用 —— 只是**动态 import**，
> 静态 grep 会漏。`package.json` 的注释也写明「本是传递依赖，靠传递依赖迟早会断」，
> 所以**显式声明是刻意的**。详见 `docs/audit/STACK-AUDIT.md` §6（P9）与 §11 问题表。

### 7.3 「声明了但零 import」—— **2026-10-13（T4）已清账**

> **测量方法（可复跑）**：`npm test` 的 **`apps/desktop/tests/deps.test.mjs` D-A** ——
> 它读 `package.json`、对每个声明的包在 `apps/` `packages/` `scripts/` `*.config.mjs` 里找
> **静态 / 动态 / `require` / 子路径**四种引用形态，零 import 且不在白名单里就**让 `npm test` 红**。
> ⚠️ **这个断言必须先看动态 `import()`** —— 静态 grep 漏掉了 `sharp`（`packages/indexer/src/bmp_decode.mjs:139`
> 的 `await import('sharp')`）与 `bmp-js`（`:55`），差一点把编码路径的依赖删了（D-C 就是钉这条的）。

| | 清理前（2026-10-13 实测） | 清理后 |
|---|---|---|
| 生产 `dependencies` | **25** | **12** |
| 其中零 import | **19** | **0** |
| 开发 `devDependencies` | 14（零 import **9**） | **12**（零 import 的都在白名单里） |

**删掉的（逐条已确认零引用）**：11 × `@radix-ui/react-{checkbox,dialog,dropdown-menu,label,popover,select,slot,switch,tabs,toast,tooltip}` ·
`@tanstack/react-virtual` · `lucide-react` · 以及开发依赖 `vitest`（本仓库测试用 `node:test`，从没用过它）与 `jsdom`（原 DOM 守卫的依赖，守卫已移除）。

**接上的（从"零 import"变成真用）**：

| 包 | 现在谁用 | 换来什么 |
|---|---|---|
| `@radix-ui/react-alert-dialog` | `apps/desktop/src/renderer/src/ui/ConfirmDialog.jsx` | **破坏性操作的确认弹窗**：`role="alertdialog"` + 焦点陷阱 + ESC 关闭 + 焦点归还 + 点遮罩不误关 —— 这几件是手写 overlay 最难自己实现的 |
| `class-variance-authority` | `apps/desktop/src/renderer/src/ui/Button.jsx` | 变体声明式化（`variant`/`size`/`block` 一处定义） |
| `clsx` + `tailwind-merge` | `apps/desktop/src/renderer/src/ui/cn.js`（**全应用唯一** class 合并实现） | `tailwind-merge` 按冲突组消解、后者胜 ⇒ 消除"两个同组工具类同时留下、谁赢取决于 CSS 顺序"这一类静默 bug（T3 迁移时真栽过） |
| ⚠️ 上面这条的**配置前提** | `cn.js` 里还用了 `extendTailwindMerge` 把 8 个自定义字号（`--text-*`）登记进 `font-size` 组 | 否则 `tailwind-merge` 把 `text-caption` 当成**颜色**，与 `text-ink` 判为冲突而**丢掉字号** —— T4 实测踩到（构建通过、只有真窗口量计算样式才发现）。回归锁：`styles.test.mjs` 的 T5/T5b |

**零 import 但必须留的（白名单，每条都有理由 —— 写在 `deps.test.mjs` 的 `IMPLICIT` 里）**：
`typescript`（`tsc` 跑 typecheck）· `vite`（electron-vite 的 peer + 实际打包器）·
`tailwindcss`（`@tailwindcss/vite` 的 peer，且是 CSS 引擎本身）· `electron-builder`（打包脚本的 CLI）·
`@types/node` `@types/react` `@types/react-dom`（由 tsconfig 的 `types` 解析，代码里不出现 import）。

**代价与边界（如实）**：
- 安装包体积的**实测对比本轮没做**（要 `electron-builder --dir` 打包，属 P6/G-E1 的范围）。
  【判断，非实测】按 `docs/audit/STACK-AUDIT.md` §E2 的口径，`lucide-react`（34.1 MB）单独占大头 ⇒ 删它一个就拿下大部分。
- 本文件**只记录事实与测量方法**；`package.json` 的改动在 `task-20`（T4）里做的，证据见 `TODO.md` 的 T4 完成记录。

### 7.3.1 刻意**不引入**的（同样是设计决定）

| 不引入 | 理由 |
|---|---|
| 数据请求库（TanStack Query / SWR） | 没有 HTTP 层。传输是 IPC + 事件流 |
| 表单库（react-hook-form / formik） | 表单极少（设置页）。zod 已能校验 |
| 组件库（MUI / AntD / Chakra） | 会与 `docs/design/DESIGN-tokens.md` 的视觉体系打架；当前界面是**自研 `ui/`**，没有第三方组件层要接管 |
| CSS-in-JS 运行时（styled-components / emotion） | 手写 CSS + `packages/design-tokens/tokens.css` 已足够；运行时样式既慢又与 CSP 关系复杂 |
| Tailwind / shadcn/ui | **已试装未接入**（见 §7.3）：`tailwindcss` 与 `@tailwindcss/vite` 在 devDependencies，但构建里没有插件；shadcn/ui 从未落地 —— 本节不再把它当作方案 |
| 状态机库（xstate） | 事务状态机很小，且必须住在 `packages/engine/src/` 里被无头测试覆盖 —— 引入库反而增加耦合 |
| 图形库 / 图表库 | 明确不做（`docs/design/UI-REVIEW-and-migration.md` §9） |
| `jimp`（缩略图） | Electron 自带 `nativeImage`，省掉一个约 30 MB 的原生依赖（**`sharp` 不在此列** —— 它是生产依赖，见 §7.2） |
| 数据库（better-sqlite3 等） | 索引是单文件、注册表是 JSON。引入 DB 只增加迁移与打包负担 |
| `electron-updater` | 不做自动更新（未决策）；它会新增一条**联网**通路 |
| 自动修复类工具（`npm audit fix --force`） | 会静默做大版本变更，破坏"可复现" |

### 7.4 构建工具链（devDependencies，**不进安装包**）

`electron` 44.7（含 371 MB 平台二进制）· `electron-vite` 5.0（三端构建一体）·
`vite` 7.3 · `@vitejs/plugin-react` ^5（v6 要求 Vite 8，与本工程冲突）· `electron-builder` 26.15（NSIS 打包，P6 用）·
`jsdom` 29.1（渲染层 DOM 守卫用）· `typescript` 7.0.2 · `@types/*`

**已装未用（待处置，见 §7.3）**：`tailwindcss` 4.3 + `@tailwindcss/vite` · `vitest` 5.0.3。

> `electron-winstaller`（30.7 MB）是 electron-builder 的 Squirrel 依赖，我们用 NSIS，
> 属**开发期冗余**；清不掉（上游依赖），记录在此以免将来被误认为"我们选了 Squirrel"。
> `typescript` 装了但**没有 typecheck 门禁**（`tsconfig*.json` 的 `checkJs: false`，`npm run` 里没有 `typecheck`）——
> 这不是"用 TS 写的"，JS 迁移仍在计划中。

### 7.5 测试运行器的现状（如实记录一处规格偏离）

`docs/spec/SPEC-app.md` §7 曾写 vitest。**当前测试共 113 条（引擎 74 + 桌面 39）跑在 `node:test` 上**
（`packages/engine/tests/*.test.mjs` 与 `apps/desktop/tests/*.test.mjs`）—— 起因是当时受限沙箱下
`npm install` 会 EPERM，于是引擎刻意做成**零依赖**（这也让"引擎传输无关"变成最强的形式：
它连测试框架都拉不进来）。

现状与处置：

- **引擎继续用 `node:test`** —— 零依赖是引擎的一项特性，不是权宜
- **应用侧的自动化测试已不再"很薄"（2026-10-12 更新）**：`apps/desktop/tests/` 现有 **39 条**，
  分布在 `library-config.test.mjs`（12，库配置解析）· `ports.test.mjs`（4，reveal 端口）·
  `permissions.test.mjs`（13，IPC 参数校验与 `thumb://` 形状 —— §8 的 S1/S2/S3/S4/S5/S6/S14）·
  `window-security.test.mjs`（10，窗口与来源判定 —— §8 的 S11/S12/S13）。
  ⚠️ **仍要分清**：这些测的是**能被隔离出来的纯逻辑**；`main/index.mjs` 里的**接线**
  由 `tools/verify_app_build.mjs` 在**构建产物**上做结构断言，**真 Electron 窗口**里的行为仍未实测（§8.1）。
  `vitest` 依旧 0 使用 —— 要么接线，要么删除（未变）。
- ✅ **跳过数 3 → 1**（2026-10-12）：另两条当时跳过是因为测试自己读已删除的 `config.json`，现改用与生产同序的库根解析后真跑（见 §7.6 末）

### 7.6 流水线与约束

- **`package-lock.json` 必须入库**（锁定完整依赖树）
- 新增依赖要过 `docs/spec/SPEC-app.md` §8 的 "Ask first"
- 安全升级单独提交并跑全测试；**不启用** `npm audit fix --force` 这类自动大版本变更
- Electron/Chromium 安全更新列入 P6 发布检查：**升级 Electron 必须重跑 §8 的权限测试用例**
- ✅ **原先登记的「未修上游缺口」已修（D2，2026-10-12）**：库不再只从 `config.json` 读，而是四路解析
  （`GEMMA_LIB_ROOT` > `userData/library-registry.json` > `config.json` > **索引自举**）；
  取件白名单 `collect.dirs` 也不再为空（F-04 同时解决）。实现 `apps/desktop/src/main/library-config.mjs`。
  ⚠️ **§8 的 16 条权限用例已于 2026-10-12 全部补上自动化**（此前零覆盖，P2 验收未通过）。
  根因是传输层（主进程 IPC 分发、preload 暴露面、`thumb://` 处理器）**测不了** ——
  `main/index.mjs` import 了 `electron`，`node:test` 加载不了。修法是**把纯逻辑抽出来**
  （先例：`main/ports.mjs`、`main/library-config.mjs`）：
  `main/thumb-url.mjs`（`thumb://` 形状 + 尺寸白名单）与 `main/window-security.mjs`
  （`isAppUrl` / `decideWindowOpen` / `decideNavigation` / `isTrustedSender`）。
  逐条覆盖与**仍未验证的边界**见 §8 与 §8.1。
  另：`libraryPickDir` 会**弹出系统目录选择框**，它是渲染层唯一能让用户"主动指一个路径"的入口，
  **必须有人复核它的滥用面**（当前设计：它只把结果交回主进程，不把路径能力授予渲染层）——
  这一条**仍未有专门的对抗用例**，如实记账。
- **仍未修**：`P5` 的真·多库注册表 CRUD（`LibraryRegistry` 仍是纯内存派生，无持久化）

---

> ⚠️ **2026-10-13：本文档里凡引用 `verify_app_build` / `verify_main_wiring` / `verify_renderer_dom` /
> `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` 的地方，那些守卫**已按所有者指令移除**
> （原件备份在 `data/_removed-guards-backup/`）。文中的"有自动化/由它断言"一律**不再成立**；
> 现存守卫只剩 `verify_encoder_path` 与 `check_search`，且两者都需要模型与已注册索引（沙箱跑不动）。
> 详见 [`AGENTS.md`](../AGENTS.md) §5.2 的"移除的代价"。

## 8. 权限测试用例（**P2 验收必须全过**）

> ⚠️ **现状（2026-10-13，已降级 —— 必须如实引用）**：
> 本表 16 条**曾在 2026-10-12 全部接到自动化上**；但承载**行为级 / 产物级**证据的 4 个守卫
> （`verify_main_wiring` · `verify_app_build` · `verify_renderer_dom` · `verify_renderer_styles`）
> **已于 2026-10-13 按所有者指令移除**。
>
> ⇒ **现在只剩纯逻辑单测**：`apps/desktop/tests/permissions.test.mjs`（13 条）· `window-security.test.mjs`（10 条）· 引擎安全单测。
> ⇒ **「接线接上了没有」这一层不再有任何自动化**。这是移除守卫生成的**已知代价**（`TODO.md` B-4）。
> **不要把"单测通过"读成"应用真的接上了"** —— F-01 那种"引擎能力对、应用没接"的坑，正是这一层要抓的。
> ⚠️ （历史）凡读**构建产物**的断言（`verify_app_build` / `verify_main_wiring` / `verify_renderer_dom`）都**依赖一次成功的 `npm run build`**（见 `AGENTS.md` §5.1 的环境限制）—— **这三条已移除**。
>
> 覆盖**现在只剩两处**（另加引擎单测）：
> - `apps/desktop/tests/permissions.test.mjs` —— 纯函数边界（IPC 参数校验、`thumb://` 形状）
> - `apps/desktop/tests/window-security.test.mjs` —— 窗口/来源判定的**决策**
>
> ~~`tools/verify_main_wiring.mjs`（行为级）~~ 与 ~~`verify_app_build.mjs` / `verify_renderer_dom.mjs`（产物/渲染级）~~
> **均已移除** ⇒ 下表中凡只剩单测的条目，**举证力弱于 2026-10-12 的状态**。
>
> ⚠️ **必须分清两件事 —— 而其中一件现在已经没人管了**：
> ① **决策对不对** —— 由单测证明（把防线临时拆掉，对应用例会变红；S1/S2/S4b/S5/S11/S12/S13 已实测双向验证）✅ **仍有效**；
> ② **接线接没接上** —— 原由 `verify_app_build` 在构建产物上做结构断言（如"`ipcMain.handle` 实参里调用了 `isTrustedSender`"）。
> ❌ **这一层已随守卫移除而消失** ⇒ **"端到端已过"现在完全不成立**，任何文档/报告都不得这样写。
>
> 仍然是**未覆盖**的两处（如实记账，不要当已通过）：
> - `libraryPickDir` 的**滥用面**没有独立复核（它是渲染层唯一能让用户主动指路径的入口）。当前设计上它只把结果交回主进程、不把路径能力授予渲染层；但"渲染层能否靠它做目录探测"这类问题**没有专门的对抗用例**。
> - 本表原先的**根因**（传输层零单测）已消除，但**真 Electron 窗口内**的 iframe/新窗口行为仍未实测 —— 见 §8.1 的"未验证"一栏。

自动化（写进 `packages/engine/tests/`——纯函数部分）或 `apps/desktop/` 的组件/E2E 测试；
可在无窗口下覆盖的尽量覆盖：

| # | 用例 | 期望 | 自动化在哪里（命令 + 位置） |
|---|---|---|---|
| S1 | 调未登记方法 `engine:invoke {method:'exec'}` | 拒绝，`BAD_REQUEST` | `npm test` · `permissions.test.mjs`「S1」——含 `exec`/`__proto__`/`toString` 等原型键 |
| S2 | `search` 传未知字段（`zod.strict`） | 拒绝，`BAD_REQUEST` | `npm test` · `permissions.test.mjs`「S2」（顶层与嵌套 `filters` 各一） |
| S3 | `libId` 传 `../etc`、`uid` 传 `../../../x` | 拒绝（格式不符） | `npm test` · `permissions.test.mjs`「S3」（10 种坏形状 + 2 种反例锚） |
| S4 | `thumb://../../windows/win.ini` | 400/404，**不产生文件读取** | `npm test` · `permissions.test.mjs`「S4」——**注入计数 fs 证明读取次数 = 0**，并断言该模块不 import `fs` |
| S5 | `thumb://L1/<合法 uid>@999` | 400（size 不在白名单） | `npm test` · `permissions.test.mjs`「S5」（9 种坏 size + 3 种白名单值） |
| S6 | `thumb://L9/<合法 uid>@256`（未注册库） | 404 | `npm test` · `permissions.test.mjs`「S6」（映射规则）⚠️ **调用点那一层已失效**：原由 `verify_main_wiring.mjs` **真的调用**产物里的 `thumb` handler（未注册库 ⇒ 404、形状/尺寸错 ⇒ 400），**该守卫已于 2026-10-13 移除** |
| S7 | 索引里投毒 `relPath = ..\..\windows\system32\x.dll` 后 `item` | `PATH_ESCAPES_LIB` | `npm test` · `engine/tests/security.test.mjs`（**已有**：①..④ 逃逸） |
| S8 | 库内放指向库外的 junction 后 `item`/`thumb` | `SYMLINK_REJECTED` | `npm test` · `engine/tests/security.test.mjs`（**已有**：junction + 文件 symlink。本环境建不了文件 symlink 的那条会**如实跳过**） |
| S9 | 渲染进程 `typeof window.require` / `window.process` | `undefined` | ❌ **原本两面都有，现在两面都没了**：原由 `verify_app_build.mjs` §2b（产物：暴露面恰好三键）+ `verify_renderer_dom.mjs` §11（jsdom：`require`/`module` undefined），**两守卫均已于 2026-10-13 移除** ⇒ **本条现在没有自动化**。preload 暴露面的**静态事实**仍可在 `apps/desktop/src/preload/` 源码里人工核对 |
| S10 | 文件名设为 `<img src=x onerror=alert(1)>.jpg`，在结果网格显示 | 页面无脚本执行；DOM 里是文本节点 | ❌ **原由 `verify_renderer_dom.mjs` §12 覆盖，该守卫已于 2026-10-13 移除** ⇒ **本条现在没有自动化**。原断言是：注入载荷后 ①无 `<img src=x>` 元素 ②`innerHTML` 里是 `&lt;img` 实体。⚠️ 且**"脚本没执行"这一半当时就证明不了**（实测那套 jsdom 连显式插入的 `<script>` 都不执行，故该断言当时已被删） |
| S11 | `setWindowOpenHandler` 尝试开新窗口（`window.open('https://example.com')`） | 被 deny，无新窗口 | **判定**：`npm test` · `window-security.test.mjs`「S11」✅ · ❌ **接线 + 行为面已失效**（原由 `verify_main_wiring.mjs` 真调用回调断言 `action === "deny"`、结构面 `verify_app_build.mjs` §1c）—— **两守卫已于 2026-10-13 移除** |
| S12 | 主窗口内 `location.href='https://example.com'` | `will-navigate` 阻止 | **判定**：`npm test` · `window-security.test.mjs`「S12/S12b」✅ · ❌ **接线 + 行为面已失效**（原由 `verify_main_wiring.mjs` 真调用 `will-navigate` 回调、结构面 `verify_app_build.mjs` §1c）—— **两守卫已于 2026-10-13 移除**。⚠️ 已知边界：`file://` 是**前缀放行**，见下 |
| S13 | iframe 内调用 `engine:invoke` | 拒绝（来源校验） | **判定**：`npm test` · `window-security.test.mjs`「S13/S13b–e」✅ · ❌ **接线 + 行为面已失效**（原由 `verify_main_wiring.mjs` 真调 handler：iframe / 异 webContents / 远程 URL / 缺 frame ⇒ `BAD_REQUEST`）—— **该守卫已于 2026-10-13 移除** |
| S14 | `engine:invoke` 载荷 > 1 MB | 拒绝 | `npm test` · `permissions.test.mjs`「S14」（超限拒 + 边界不误判 + 循环引用不抛异常） |
| S15 | 取件到白名单外目录 | `COLLECT_DIR_NOT_ALLOWED` | `npm test` · `engine/tests/security.test.mjs`（**已有**：② 白名单外两例）+ `engine.test.mjs`「collect：白名单外/未配置」 |
| S16 | 只读流程跑完，库指纹比对 | 不变 | `npm test` · `engine/tests/security.test.mjs`（**已有**：⑤ 解析与指纹只读 + 跨语言指纹一致性） |

### 8.1 自动化的边界（**要如实引用，不要含糊**）

| 项 | 事实 |
|---|---|
| **结构断言 ≠ 端到端** | S9/S11/S12/S13 的"接线在不在"是在**构建产物**上做文本/结构断言。它证明"注册语句存在且形如预期"，**不证明**真 Electron 窗口里那些 handler 被调用时的实际效果。 |
| **真窗口行为未实测** | 在**真 Electron 窗口**里：`window.open` 是否真被 deny、iframe 内 `invoke` 是否真被拒、`process` 到底暴露了哪些字段 —— **均未实测**（本项目一向如此记录）。要做需要 `smoke_app.mjs` 级别的真启动，属 P6 收尾。 |
| **S12 的 `file://` 前缀放行** | ✅ **2026-10-13 已在真窗口里实测证实可触发**（Playwright E2E `window-security.spec.mjs` E3-d）：
把 `location.href` 指向同属 `file://` 的**另一个路径** ⇒ `will-navigate` **不拦**，页面真的被导航走，
URL 变成 `chrome-error://chromewebdata/`（因为那个文件不存在）⇒ **应用界面丢失**。这不是理论风险，是可复现行为。
`isAppUrl` 用 `startsWith('file://')`，因此**任何** `file://` URL 都被放行（含指向**别的本地文件**的）。`window-security.test.mjs` 里**显式断言了这个现状**，不假装已收紧。 |
| ⚠️ **上面这条的真实影响比"无网络请求"更大**（2026-10-12 复核实测 + 判断） | 初版这里写的是"不是远程内容风险（file:// 下无请求、CSP 仍在）"—— **那个理由不成立**：CSP 只是**我们自己 index.html 的 meta**（§10 自己写着响应头未设），导航到**别的**本地 HTML 后，那份文件的"在不在"与我们的 CSP 无关。而 `webPreferences.preload` 是**按 webContents 挂**的、`isTrustedSender` 只要求 `frame.url` 以 `file://` 开头 ⇒ **主窗口一旦被导航到本机任意 HTML，那个文档仍拿得到 `window.api`，且它的 IPC 会被判为可信来源**。<br>**可利用性【判断，非实测】**：需要先有脚本执行或用户主动导航。收紧方向是"比对完整路径前缀白名单"（而非 scheme 前缀），属 P6 打包期项。 |
| **"只允许一个主窗口"没有对应用例** | §4 的约束在 §8 的 16 条里**没有**对应条目，本表也没把它列为未覆盖 —— 如实补记在此：`isTrustedSender` 只比对 `winRef.win` 那**一个** webContents，所以"会不会存在第二个窗口"靠的是`createWindow` 只被调用一次的代码事实，**不是**一条断言。 |
| **S8 的一条会跳过** | 本环境无法创建**文件**符号链接（EPERM，仅 junction 可以）。跳过时 `node:test` 会标 skipped，**不算通过**。 |
| **抽出 `thumb-url.mjs` 时改了**一处**状态码** | 原 `handleThumb` 把"库 id 无法还原"与"形状不对"合并成 **400**；按 §3 的表拆成**两条**：**形状/尺寸错 ⇒ 400（先判）**、**库无法还原 ⇒ 404（后判）**。这是**对齐 §3**，不是漂移 —— 但确实是本节工作顺带的行为变更，如实记录。渲染层不区分二者（都渲染成"无预览"），所以无下游影响。 |


人工（无法自动化，单列）：DevTools 里确认无远程请求；断网全流程可用。

---

## 9. 决定记录

| # | 事项 | 决定 | 处置 |
|---|---|---|---|
| 1 | **本文件是否批准** | **暂批**（2026-10-10） | 可作为 P2 编码依据；实质性问题出现时再回头修订，不阻塞开工 |
| 2 | 依赖最小集 | **要求详细交代**（2026-10-10） | 已按 §7.1–§7.6 逐个说明"换来什么 / 不装要付什么"，含**刻意不引入**清单与实测体量。**2026-10-12 更正**：生产依赖 21→**24**、`node_modules` 596 MB→**1089.9 MB**；**依赖规模改用锁文件条目数（662）作为唯一口径**——早期的 288 / 334 以及中途试过的 450 都是 `node_modules` 目录计数，会随安装漂移（见 §7.1 警告）；并把 `sharp` 移入 §7.2（D9） |
| 3 | 生产态 DevTools | **不关闭**（2026-10-10） | 生产态**保留** DevTools（`webPreferences.devTools: true`）。理由成立：这是**本机自用工具**，主要风险是本机物理接触与管理员 —— 已在 §1「明确不防」里列明。排障收益大于此处的边际风险 |
| 4 | CSP 的 `style-src 'unsafe-inline'` | **要最终推荐**（2026-10-10） | 见 §10 |

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
而本仓库**现在就有**动态内联样式属性：

- `apps/desktop/src/renderer/src/ui/Progress.jsx:9` —— `style={{ width: \`${pct}%\` }}`（进度条宽度随进度变化）
- 将来接入任何弹出层定位组件（Popover / Select / Tooltip / DropdownMenu）还会写 `transform`/`top`/`left`，
  这些值**随交互动态变化，无法预先算 hash**
- 生产态样式由 Vite 抽成文件，但 dev 态由 Vite 注入 `<style>`（`apps/desktop/src/renderer/index.html` 的注释自己写明这一点）

因此要真做到 `style-src 'self'`，只有三条路：

1. 把动态内联样式全改成非内联（例如给进度条预置有限档位的 class）——可行但收益仅"形式更严"，
   且将来任何定位组件都会把它破掉
2. 加 `'unsafe-hashes'` 或 `style-src-attr 'unsafe-inline'` —— **等于把限制加回来**
3. 给动态样式值做 nonce 注入 —— 对属性无效，做不到

即：**严格的版本在本项目里不可达**；强行写上去只会让规格看起来更安全，实际一改就破。

> ⚠️ **一处需要更正的旧论据**：本文件 v1 把这条论证挂在"Radix 的定位组件"上。
> 实测 **12 个 `@radix-ui/react-*` 全部零 import**（§7.3）—— 该论据当时**不成立于现状**，
> 现在成立的是上面那条（`Progress.jsx` 的既有内联属性）。结论（保留 `'unsafe-inline'`）不变。

### 10.3 真正该花力气的地方（已做/将做）

| 控制 | 状态 |
|---|---|
| `script-src 'self'`（无内联、无 eval） | 已设（`apps/desktop/src/renderer/index.html`）；生产态明确禁止 `'unsafe-eval'` |
| 引擎返回字符串**一律纯文本渲染**（不变量 1） | 已写进 §6；**实测 `dangerouslySetInnerHTML` 与 `innerHTML` 在渲染层零使用**（唯一命中是 `main.jsx:8` 的注释） |
| `object-src 'none'` · `base-uri 'none'` · `form-action 'none'` · `frame-ancestors 'none'` | 已设（`meta` 内；**响应头仍未设**，见 `docs/DEBT-CLEANUP.md`） |
| `connect-src 'self'`（**无外联即无外泄**） | 已设，与"离线可用"一致 |
| 不加载远程内容 + 拒绝导航 + 拒绝新窗口 | §4 来源验证 |
| 只读操作不写库、路径只能由 lib_id+uid 解析 | 引擎层已实现并测试（`docs/spec/CONTRACT-engine-v1.md` §7） |

### 10.4 如果你仍要更严

可接受的**增量**（成本低、收益明确）是把 `style-src` 拆细，明示我们只放开了属性那一半：

```
style-src-elem 'self' 'unsafe-inline';   /* Vite 注入 / 抽出的 <style> */
style-src-attr 'unsafe-inline';          /* Progress 等组件的运行时内联样式属性 */
```

这不提升安全性，但让"我们放开了什么"在 CSP 里一眼可见，便于将来复查。
**要不要加，你一句话即可**；不加也不影响开工。

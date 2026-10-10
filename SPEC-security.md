# SPEC-security.md —— 应用层安全规格（**P2 前置门禁**）

> **状态**：待批准。`TASK-PLAN.md` §P2 把本文件列为**前置门禁**：
> 「安全设计不允许留到编码过程中临时决定」。
> **权威**：引擎层的 5 条安全不变量在 `CONTRACT-engine-v1.md` §7（已实现并测过）；
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
- **联网**：本应用**不联网**（除首次下载模型，且那是显式用户动作），所以不做 CSRF/DNS-rebinding 防护 —— 这也正是**不引入 REST/HTTP 端口**的原因之一（`DESIGN-app-details.md` §8）

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
- **`webPreferences.devTools`**：开发态开，生产态关（`--devtools` 可覆盖，供排障）

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

- 依赖刻意最少：运行时 = React + Radix(按需) + Tailwind + zustand + lucide + zod + clsx/tailwind-merge；**不引入**数据请求库、表单库、图表库
- **`package-lock.json` 必须入库**（锁定完整依赖树）
- 新增依赖要过"Ask first"（`SPEC-app` §8）
- **不启用** `npm audit fix --force` 之类的自动大版本变更；安全升级单独提交并跑全测试
- Electron/Chromium 的安全更新：列入 P6 的发布检查（升级 Electron 需重跑权限测试用例）

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

## 9. 待批准项

1. **本文件是否批准**（P2 编码前）
2. **依赖最小集**是否接受（§7；当前选了 React+Radix+Tailwind+zustand+lucide+zod，未引入其它）
3. **生产态关闭 DevTools**（保留 `--devtools` 逃生口）是否可接受
4. **CSP 里 `style-src 'unsafe-inline'`**：Tailwind 与 Radix 的运行时内联样式需要它。
   若你要求更严（`style-src 'self'`），需要额外改造（nonce/hash），成本与收益需权衡

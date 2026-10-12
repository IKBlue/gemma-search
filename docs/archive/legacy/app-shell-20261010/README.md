# 运行应用（**⚠️ 已被 `src/` 取代**）

> **2026-10-10：本目录已被 `src/` 取代。** 应用换了 electron-vite 工程主体
> （`src/main` · `src/preload` · `src/renderer`），入口与命令都变了：
> `npm run dev` / `npm run build` / `npm start`，详见 **`src/README.md`**。
>
> 这里的内容**保留为可回退档**（`npm run start:legacy` = `electron archive/app-shell-20261010/main/bootstrap.cjs`），
> 不是当前形态；两边会随时间漂移，别再往这里加新东西。
> 旧档本应在 P2 迁移时删除 —— 没删的理由只有一个：**新版还从没在你终端里跑起来过**，
> 在拿到你的首次运行日志之前，删掉它等于把"唯一已知能启动的形态"也去掉。

---

# （以下为迁移前的原文）运行应用（P2 骨架，已可运行）

> 这一节 2026-10-10 加入。应用本体（`app/` + `src/shared/`）此前**一个文件都没有** ——
> 一直在建引擎 `core/`。现在补齐了。

## 启动

```powershell
cd D:\USERS\Desktop\Agent\gemma-search
$env:ELECTRON_RUN_AS_NODE = $null      # ⚠️ 见下，必须清除
npm start                              # = electron .
```

## ⚠️ 一个会让人白白排障半小时的坑

若环境里设置了 **`ELECTRON_RUN_AS_NODE=1`**，Electron 会以**纯 Node** 运行。
表现极具误导性：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@huggingface/transformers'   ← 其实是假象
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
Object.keys(electron) → 75 个键、API 全 undefined   ← 那其实是 75 字符的字符串（electron.exe 路径）
```

**真因**：`electron` 被解析到 npm 包装包，而不是运行时 API。
`app/main/index.mjs` 现在会**先检测这种情况并打印可操作的提示**再退出（退出码 3），
不再让人对着 `protocol is undefined` 猜。

## 目前已连起来的东西

| 层 | 文件 | 说明 |
|---|---|---|
| 主进程 | `app/main/index.mjs` | 组装引擎、注册 IPC、`thumb://` 协议、窗口姿态 |
| 编码器端口 | `app/main/encoder.mjs` | ONNX + WebGPU；含 BMP 回退（库里有 20 张 `.jpg` 实为 BMP） |
| preload | `app/preload/index.cjs` | **CJS**（`sandbox:true` 下不加载 ESM），只暴露 `invoke`/`onEvent`/`platform` |
| 共享契约 | `src/shared/ipc.mjs` | zod 方法白名单 —— IPC 校验的唯一来源（安全规格 §2） |
| 渲染进程 | `app/renderer/{index.html,app.css,renderer.js}` | 深色侧栏 + 浅色工作区；颜色取自设计令牌 |
| 引擎 | `core/*.mjs` | 传输无关、零依赖（68 条测试覆盖） |

界面能力：文字检索 · 以图搜图 · 分类筛选 · 缩略图（`thumb://` 现生成并缓存）· 定位 · 取件。

## 尚未验证的（如实列出）

我（受限沙箱）**无法启动 Electron**：进程以 `0xC0000003` 静默退出、无任何输出。
原因是 Electron 的多进程 IPC 在 Windows 上依赖命名管道，而沙箱禁止。
所以下面这些**只能由你在自己的终端里首次运行来验证**：

- [ ] 窗口能否打开、冷启动是否 ≤5s
- [ ] **WebGPU 在 Electron 内能否起来**（P1.5 的核心问题；失败会回退 CPU，日志会写明）
- [ ] `thumb://` 缩略图是否正常显示
- [ ] 索引能否读到（侧栏应显示 3594 / 3594 条已编码、dim 768、失败 0）
- [ ] 中文检索是否有结果

> 把启动日志（终端输出）发我，我据此修。**在它跑起来之前，我不声称应用可用。**

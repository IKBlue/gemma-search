# 最小 Electron 探针

## 本机实测补充（2026-10-10）—— 「起不来」已定性

| 观察 | 含义 |
|---|---|
| `electron.exe --version` → `0x80000003`，无任何输出 | **Chromium 进程沙箱初始化失败**。排除法：二进制完好（版本 44.7.0 / 246 MB / dist 齐全）、`ELECTRON_RUN_AS_NODE` 已清 |
| 同一条命令加 `--no-sandbox` → `exit=0` 并打印 `v44.7.0` | 卡住的就是**沙箱初始化** |
| `electron --no-sandbox out\main\index.js` | **应用正常出窗**：React 渲染、IPC 通、WebGPU 载入 2.4 s（证据 `reports/G-D-p2-electron/`） |
| 同一会话里记事本能出窗；`LOCALAPPDATA` 可写 | 排除"没有图形会话 / 权限不足" |

> 结论：本环境下「Electron 起不来」= **Chromium 沙箱与本承载环境不兼容**，与项目代码无关。
> 用户自己的终端**不需要** `--no-sandbox`；不要把它固化进产品配置。

用来回答一个问题：**"Electron 起不来"是环境问题还是我的代码问题？**

```powershell
# 从项目根跑（注意要清掉 ELECTRON_RUN_AS_NODE，否则见下面的对照 B）
$env:ELECTRON_RUN_AS_NODE = $null
.\node_modules\electron\dist\electron.exe tools\probe_electron_start
type tools\probe_electron_start\probe.log
```

它只做三件事，全部写进 `probe.log`（Windows 上 Electron 是 GUI 子系统程序，stdout 不连终端）：
拿到 `app.whenReady()` → 建一个隐藏窗口 → 加载一行 HTML → 打印"窗口加载完成 ✓"。

**怎么判读**：

| 现象 | 含义 |
|---|---|
| `probe.log` 里出现 `--- probe end (ok) ---` | Electron 在本机可用 —— 那应用起不来就是**我们的代码**问题 |
| `probe.log` 根本没生成、进程 `exit=3`（=0xC0000003） | Electron 的**浏览器进程**起不来（受限沙箱常见）。这时加 `ELECTRON_RUN_AS_NODE=1` 再跑一次：若能打出 `node-mode ok`，说明二进制没问题，是 GUI/多进程这条路径被禁 |
| `exit=9` | 拿到了 Electron 但 API 是 undefined → 多半是 `ELECTRON_RUN_AS_NODE` 没清 |

2026-10-10 在项目沙箱里实测：最小应用 `exit=3`、`probe.log` 不生成；同一 exe 加
`ELECTRON_RUN_AS_NODE=1` → `exit=0 · electron=44.7.0 · node=24.21.0`。结论：环境所致。

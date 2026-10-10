# G-D · P2（Electron + Vite + React）实跑证据 —— 2026-10-10

> 这一份回答的是**本项目悬了很久的问题**：根目录的 Electron 应用到底能不能出窗口、
> WebGPU 能不能在 Electron 里起来。此前所有实测都来自纯 Node 脚本或浏览器预览。

## 1. 结论（一句话）

**能跑。** 根目录 Electron 应用在 1440×920 窗口里渲染 React 界面，IPC 打通
（`invoke indexStatus → ok`），编码器在 **Electron 内以 WebGPU 载入成功（2.4 s）**。

## 2. 环境与命令

| 项 | 值 |
|---|---|
| 命令 | `electron --no-sandbox out/main/index.js`（先 `npm run build`） |
| Electron / Chrome / Node | 44.7.0 / 152.0.7977.130 / 24.21.0 |
| 构建 | main 45.44 kB · preload 0.82 kB · renderer 656.64 kB（29 模块） |
| 关键环境限制 | **本环境必须 `--no-sandbox`**，否则 Chromium 进程沙箱初始化失败、Electron 以 `0x80000003` 秒退（判据见 `tools/probe_electron_start/README.md`） |

## 3. 证据

| 证据 | 文件 | 内容 |
|---|---|---|
| 窗口截图 | `electron-window.png`（1440×920） | 原生标题栏「gemma-search · 素材库语义检索」；侧栏「主库 / G:\model」；底部「模型就绪 · webgpu · 2.6s」 |
| 应用日志 | `_app.log` | 启动链路 + 渲染进程 Console 转发（见下） |
| 窗口标题 | 本次实测 | `Get-Process electron \| MainWindowTitle` = `gemma-search · 素材库语义检索` |
| 进程 | 本次实测 | 主进程 1 + 渲染/GPU 子进程，关窗后无残留 |

日志关键行（原文照抄）：

```
[08:45:57.888] 配置来源 D:\USERS\Desktop\Agent\gemma-search\config.json
[08:45:57.963] app ready
[08:45:57.999] thumb:// 已注册
[08:45:58.039] IPC 已注册 · 允许的方法：search, item, indexStatus, scan, reveal, collect, ingest, mutate, indexStart, indexCancel
[08:45:58.073] 引擎就绪 · 库 L1=G:\model
[08:45:58.161] 窗口已创建 → ...\out\renderer\index.html
[08:45:58.440] [renderer] info [ui] React 已挂载 · react 19.3.0
[08:45:58.462] 渲染页加载完成
[08:45:58.506] invoke indexStatus 2ms → ok
[08:45:58.708] [renderer] info [ui] indexStatus → L1 0/0 dim=null healthy=false
[08:45:59.870] 重采样兼容层已安装并自检通过（kernel=pil-like）
[08:45:59.885] 载入模型 dtype=fp32 seq=140 device=webgpu
[08:46:02.283] 载入完成 2.4s · device=webgpu
```

**这一份同时是 P1.5 的答案**：Electron 内 WebGPU 可用（此前只有纯 Node 脚本的证据）。

## 4. 这次**没有**证明的（别当已通过 G-D）

| 项 | 状态 |
|---|---|
| 冷启动 ≤ 5 s（成功标准 #1） | ❌ 未计时（只记录到窗口创建时间点） |
| 中文检索出结果 / 缩略图零 404 | ❌ **当前不可能通过**：引擎报 `INDEX_MISSING`（`encoded 0 / indexed 0 · dim null`）—— 应用的数据目录里还没有被登记的索引，属 P0.5-c「接受索引」那一步 |
| 打包态（asar）内 WebGPU | ❌ 未测（P6） |
| 关窗无残留进程 | ⚠️ 实测关窗即退出；但**由外部 shell 拉起时父进程结束会连带回收子进程**，属承载环境行为，不作结论 |
| `--no-sandbox` 是否要进产品 | ❌ **不要**。它关闭的是 Chromium 的 OS 级沙箱，只在**本受限环境**为了出窗而加；用户自己的终端不需要它 |

## 5. 复现

```powershell
npm run build
# 本受限环境（Chromium 沙箱起不来）：
.\node_modules\electron\dist\electron.exe --no-sandbox out\main\index.js
# 普通终端（推荐，不需要那个开关）：
npm run dev        # 或 npm start（跑构建产物）
```

日志落在 `data\_app.log`（主进程 + 渲染进程 console 都转发到这里）。

## 6. 追加：一条命令的复跑冒烟（2026-10-10 晚）

`tools/smoke_app.mjs` 现在是**可复跑的一条命令**，直接给判定：

```powershell
npm run build
node tools/smoke_app.mjs --no-sandbox --wait 30
# exit 0 = 起来了；1 = 产物缺失；2 = 主进程没跑到 JS；3 = 跑到 JS 但没出窗；4 = 起来了但有报错
```

本次实测 `exit=0`，判定四条全中：**窗口已创建 · 渲染页加载完成 · thumb:// 已注册 · 引擎就绪**，
日志里另有 `[ui] React 已挂载 · react 19.3.0` 与 `invoke indexStatus 2ms → ok`。

### 6.1 过程中踩到并已修掉的两个环境坑（都写进了工具里的注释）

| # | 现象 | 结论与处置 |
|---|---|---|
| 1 | `electron.exe . --no-sandbox`（**目录形式**）秒退：主进程以 `0xC0000005`（访问冲突）崩在 `app.whenReady()` 之前；`electron.exe --no-sandbox out\main\index.js`（**主脚本路径形式**）正常出窗 | 冒烟脚本改成传主脚本路径。**对照实验**：同一二进制、同一开关、同一 cwd，只差这一个参数 |
| 2 | 用 `stdio: 'pipe'` 接子进程输出时也观察到同一崩溃 | 冒烟脚本改为不使用管道（Windows 上 Electron 是 GUI 子系统程序，主进程 stdout 本来也不连终端，日志来源始终是 `GEMMA_APP_LOG`） |

> 这两条都不是应用代码的问题，但**下一次谁再写"启动应用并判定"的脚本都会踩**，所以留在工具注释里。

## 7. 追加：受限环境下的**可用命令**（2026-10-10 晚，实测）

```powershell
npm run dev:restricted      # = dev --noSandbox --entry out/main/index.js
```

实测：dev server 起在 5173、Electron 出窗、`[ui] React 已挂载 · react 19.3.0`、`invoke indexStatus → ok`、**WebGPU 载入 2.5 s**。界面上点「搜索」会走到引擎并**如实报错**：

```
invoke search 728ms → INDEX_MISSING
details.skipped[0].detail = 索引不存在：...\data\libraries\L1\index.bin
```

**这就是检索还不可用的全部原因**：引擎按 `<data_dir>/libraries/<libId>/` 找索引，而 v2 索引在 `data/idx-full-v2/`，尚未走 P0.5-c 的"接受"。

两个开关各自的必要性（同一台机器上的对照）：

| 命令 | 结果 |
|---|---|
| `electron .` | 秒退，日志一行都没有（沙箱断言 `0x80000003`） |
| `electron . --no-sandbox` | 进到 JS、写 7 行日志，然后 `0xC0000005` 崩在 ready 前（目录形式） |
| `electron out\main\index.js --no-sandbox` | **正常出窗** |
| `npm run dev -- --noSandbox --entry out/main/index.js` | **正常出窗（dev + HMR）** |

## 8. 追加：裸 `npm run dev` 现已可用（2026-10-10 晚，实测）

```
> npm run dev
[run] 检测到 ELECTRON_RUN_AS_NODE —— 已为本次子进程摘掉
[run] 探测：本机 Chromium 的进程沙箱不可用（`--version` 退出码 0x80000003，加 --no-sandbox 正常 → v44.7.0）
[run] 探测：本次附加 --noSandbox --entry out/main/index.js（**仅本次**，不写进配置）
...
[09:02:00.644] 窗口已创建 → http://localhost:5173 (dev server)
[09:02:00.870] [renderer] debug [vite] connected.
[09:02:00.901] [renderer] info [ui] React 已挂载 · react 19.3.0
[09:02:00.964] invoke indexStatus 3ms → ok
[09:02:04.749] 载入完成 2.5s · device=webgpu
```

即：**探测 → 只为本次附加两个开关 → 出窗 → React 挂载 → HMR 连上 → IPC 通 → WebGPU 就绪**。

### 8.1 探测写错了一次（记录在案）

第一版探测把 `electron --version` 的退出码当判据，但**没给探测传清理后的环境**：
本机 `ELECTRON_RUN_AS_NODE=1` 时，`electron.exe --version` 是以**纯 Node** 跑的，
打印的是 **Node 的版本**（`v24.21.0`）且退出码 0 —— 于是得到"沙箱可用"的错误结论，
`npm run dev` 仍然秒退（只是多了一行静态提示）。

修法两条，一起上：

1. 探测显式传清理后的 `env`（现在 `--version` 退出码 `0x80000003`，`--no-sandbox` 下是 `v44.7.0`）；
2. **兜底**：第一次启动若以 `0x80000003`/`0xC0000005`/`3` 退出，就带参**重试一次**并打印原因 ——
   任何探测判断不了的情况都不会再变成"窗口没出来却什么都不说"。

> 教训与 `tools/verify_syntax.py` 那次同类：**判据本身也要有否定对照**。
> 一个"永远成功"的探测比没有探测更危险。

## 9. 关于截图：本机产物，不入库

本目录里的 `electron-window.png` / `ui-final.png` 等**不在 git 里** ——
证据协议（`reports/README.md`）按体积排除了重媒体（`*.png/*.jpg/*.mp4`）。
因此本文件里的日志摘录与结论才是**随仓库分发**的证据部分。

复跑截图（应用自截，不受窗口遮挡影响）：

```powershell
npm run build
$env:GS_CAPTURE='reports/G-D-p2-electron/ui-final.png'   # 应用自己截自己（webContents.capturePage）
$env:GS_CAPTURE_QUERY='玻璃球多头吊灯'                     # 可选：截图前先跑一次真实检索
$env:GS_CAPTURE_DELAY_MS='9000'
.\node_modules\electron\dist\electron.exe --no-sandbox out\main\index.js
```

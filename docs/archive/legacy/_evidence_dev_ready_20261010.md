
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

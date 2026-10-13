# GETTING-STARTED · 从克隆到跑起来

> 面向**第一次拿到这个仓库**的人。每一步都写清"该看到什么"；看不到就是有问题，去 [`TROUBLESHOOTING.md`](docs/guide/TROUBLESHOOTING.md)。
> 改动代码/文档前请先读 [`AGENTS.md`](AGENTS.md)（目录职责与纪律）。

最后核对：2026-10-12 · 环境：Windows / PowerShell / Node ≥ 20

---

## 0. 先知道"现在能跑到哪一步"（省得白折腾）

| 你想做的事 | 现在能吗 |
|---|---|
| 跑引擎单测、构建三端、跑守卫 | ✅ 能 |
| 打开应用窗口、看到界面骨架 | ✅ 能（有实跑证据 `reports/G-D-p2-electron/`） |
| **用中文检索出结果** | ✅ **本机可以**：库按四路解析，其中**已有索引自举**（`data/libraries/*/meta.json` 的 `lib_root`）让本机**零配置即用**（D2 已修 2026-10-12）。干净机器上则显示**首启向导**让你选库文件夹 |
| 首次建索引（干净机器） | ⚠️ 目前要手工跑 `packages/indexer/src/build_index_onnx.mjs` —— 界面里的「建索引」是 P3d，尚未做（`indexStart` 被显式拒绝） |
| 入库 / 增量 / 多库管理 | ❌ 未实现（P4/P5） |
| 打包分发给别的机器 | ❌ 未做（P6） |

**所以第一次跑的目标是**：单测绿、构建过、窗口出得来、守卫通过；**本机还能直接检索**（库从索引自举）。

---

## 1. 依赖

```powershell
git clone https://github.com/IKBlue/gemma-search.git
cd gemma-search
npm install
```

`npm install` 只装 Node/Electron 依赖。**本仓库没有 Python**，也没有 `requirements*`。

### 习惯性的本机设置（一次性，不随仓库分发）

```powershell
git config core.quotepath false     # 中文文件名不显示成八进制转义
git config core.autocrlf false      # 行尾交给 .gitattributes 统一控制，关掉自动转换
```

### ⚠️ Electron 二进制下载坑（最常见的卡点）

npm 包会装上，但**平台二进制不随包一起来**。症状：报 `fetch failed`，且 `%LOCALAPPDATA%\electron\Cache` 是空的。

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

实测：直连 GitHub 的 releases **页面** HEAD 返回 200，但**资产下载**会失败；换 npmmirror 镜像后正常（`electron.exe` 246 MB 左右）。

> 刻意**不**把镜像写进仓库的 `.npmrc` —— 那是本机网络环境的权宜，钉死会连累网络正常的机器。

---

## 2. 跑起来

```powershell
npm run dev      # dev server + HMR（改渲染层即时生效）
npm run build    # 产出 out/main · out/preload · out/renderer
npm start        # 跑刚 build 出来的产物（接近打包态）
```

**受限环境**（Chromium 进程沙箱起不来 → Electron 秒退、日志一行都不生成）：

```powershell
npm run dev:restricted      # = dev --noSandbox
npm run start:restricted
```

这两个脚本经 `scripts/electron-vite.mjs` 转发：它会先摘掉 `ELECTRON_RUN_AS_NODE`（该变量会让 Electron 以**纯 Node** 运行，报错极具误导性），再探测本机沙箱是否可用，**只为这一次启动**附加 `--no-sandbox`，并把判断依据打印出来。**普通终端不需要它，也不要把它固化进产品。**

### 看日志，不要看终端

Windows 上 Electron 是 GUI 子系统程序，**stdout 不连终端**，`console.log` 一条都看不到。
主进程与渲染进程的诊断都写 **`data\_app.log`** —— 排查任何"窗口没出来"的问题都先看它。

---

## 3. 验收：确认你的环境是对的

```powershell
npm test                                  # 期望：tests 113 · pass 112 · fail 0 · skipped 1
npm run build                             # 期望：out/{main,preload,renderer} 三端齐备

```

**只有 1 项跳过**，原因是环境限制（详见 [`AGENTS.md`](AGENTS.md) §5.1）：

1. 本环境无法创建**文件**符号链接（`EPERM`）→ 那条「库内指向库外的符号链接必须被拒」跳过（目录联接能建，文件符号链接不能）。在能建链接的机器上会真跑。

> ✅ 原先还有**两条永久跳过**（它们在测试里自己直读已删除的 `config.json`）。D2 修复后它们改用**与生产同序**的库根解析（`packages/engine/tests/lib-root.mjs`），于是**都真跑起来了**：
> 指纹与 Python 侧**逐字节一致**、整库 **0 处 UID 碰撞**。跳过 3 → 1。

需要模型的守卫（`verify_encoder_path.mjs`）与需要查询向量的自查（`check_search.mjs`）不是第一天的必跑项。

---

## 4. 索引：它不在仓库里

索引**不进 git**：它含素材的绝对路径，且可以重建。已接受的索引在 `data/libraries/L1/`（3594 条 · dim 768）。

重建（唯一可用路径）：

```powershell

> 已按所有者指令移除**（原件备份在 `data/_removed-guards-backup/`）。上面只列现存的两个 —— 这两个都需要
> 模型目录与已注册索引，**在 agent 沙箱里跑不动**；移除的代价见 [`AGENTS.md`](../AGENTS.md) §5.2。
node packages/indexer/src/build_index_onnx.mjs --model <ONNX 模型目录> --lib <素材库根> `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1
```

- `seq`（70/140/280）是唯一的提速杠杆，**换档必须全量重建**；
- **不要边建边查**：两者争 GPU，实测速率减半；
- 素材库换了位置 → 索引里的绝对路径失效 → 必须重建。

---

## 5. 接下来读什么

| 目的 | 文档 |
|---|---|
| 目录职责 / 新东西放哪儿 / 门禁 / 写作纪律 | [`AGENTS.md`](AGENTS.md) |
| 有什么文档、哪件事以谁为准 | [`docs/README.md`](docs/README.md) |
| 做到哪一步、下一步做什么 | [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) |
| 应用规格与技术栈 | [`docs/spec/SPEC-app.md`](docs/spec/SPEC-app.md) |
| 引擎接口契约 | [`docs/spec/CONTRACT-engine-v1.md`](docs/spec/CONTRACT-engine-v1.md) |
| 验收阈值与门禁口径 | [`docs/spec/SPEC-acceptance.md`](docs/spec/SPEC-acceptance.md) |
| 出问题了 | [`TROUBLESHOOTING.md`](docs/guide/TROUBLESHOOTING.md) |

# 债务清理账本

> 本轮动作：**建（把 HTML 页面包并入项目）+ 补充（补齐缺失流程）+ 清理债务**。
> 每条都注明处置与证据；**没做的也列出来**，不假装干净。

---

## 一、本轮建立与补充

### 1.1 建立

你给的 `gemma-search-html-pages.zip`（16.6 KB，3 页，48.6 KB）已并入项目：

```
static/prototype/
├── style.css                 9,150 B   ← 从三页内联 CSS 抽出（三份**逐字节相同**，sha1 543944ecb496）
├── app.css                   9,584 B   ← 我们补的组件（基础里没有表格/弹窗/危险色/真实缩略图）
├── app.js                    2,804 B   ← 修 bug：toast/data-demo/弹窗开关
├── 语义搜索.html             9,897 B   ← 你的页面（+ 领域修正）
├── 图库与索引任务.html        8,747 B   ← 你的页面（+ 领域修正待办）
├── 操作记录与设置.html        8,993 B   ← 你的页面（+ 领域修正待办）
├── 图片详情.html             9,264 B   ← **补充**（原套缺失的关键流程）
├── 入库与增量.html           14,373 B  ← **补充**（原套完全未覆盖）
├── 文件操作确认.html         13,510 B  ← **补充**（7 种写操作的确认框）
└── index.html               10,203 B  ← **补充**（入口 + 来源标注 + 领域差异清单）
```

三页文件体积从 16.2/14.9/14.7 KB 降到 9.9/8.7/9.0 KB —— 内联 CSS（每页 9,146 字符）已移出为共享文件。

### 1.2 补充时**发现并修掉一个真实缺陷**

你给的三页共写了 **21 个 `data-demo` 按钮**与 **14 处 `onclick="toast(...)"`**，
但 **没有任何一页定义 `toast()`，也没有 `data-demo` 处理器** —— 点这些按钮会抛
`ReferenceError`，表现出来就是"没反应"（静默失败，最容易漏掉）。

处置：抽出共享 `app.js`（toast + data-demo + 弹窗开关 + Esc + 复制），三页一次修好。
验证：三页现在都引用 `app.js`，`node --check app.js` 通过。

### 1.3 一处**我自己的**判断错误（记录在案）

我补丁脚本最初按 **8 张卡片**写，实测该页只有 **4 张**（8 张是另一份单文件原型的数量，我记混了）。
更糟的是我的配对用了 `reversed(arts)` 配 `reversed(CARDS)`，8 对 4 会**静默取到错误的子集**。
处置：先 dry-run 核对命中数 → 发现 4≠8 → 改为按实际数量截取，并加一条"超过预备数据就报错退出"。

---

## 二、清掉的债务

| # | 债务 | 处置 | 回收 |
|---|---|---|---|
| **a** | **`items.json` 的 `vectorSource` 永远是 `native`** —— 编码分支 `rows.push` 漏字段，`persist()` 用 `\|\| 'native'` 兜底（`meta.bmpFallbackUsed=20` 而 3594 条全是 native）→ SPEC §2.2 的"派生副本单独分组"豁免**永不触发** | 已修（带上 `vectorSource`）；夹具实测已能写出 `bmp-fallback` | 字段静默失真 |
| **b** | **重采样实现与参考实现不同**：transformers.js `sharp.affine(bicubic)`（无抗锯齿）vs PIL `resize(BICUBIC)`（降采样时展宽核支撑）→ 全量 135 条 < 硬底线、min 0.9153 | 已修：`onnx-spike/resize_compat.mjs`（`pil-like`）+ `preprocessing_version` 1→2；像素差 4.93 → **0.176/255**；最差 48 张 min 0.9153 → **0.995969** | 全量 v2 待确认 |
| **c** | **`tools/quality/quality_vector_equiv.py` 把 <0.99 清单截断成 30 条**（1615 条里 1585 条无清单）→ SPEC §2.2 的 ④ 人工复核名存实亡 | 已修（`--below-list-limit` 默认全量 + `--below-csv` + `--all-csv` + 分位数输出） | 复核能力 |
| 1 | `spike\_inline.js`、`spike\_v3.js` | 删除（我核对时的抽取残留） | 32,146 B |
| 2 | `__pycache__\`（13 个 .pyc） | 删除 | 172,746 B |
| 3 | `data\idx-pilot\`、`data\idx-scan\` | 删除（一次性验证构建；构建器可重跑） | 365,702 B |
| 4 | 三页各自内联 9,146 字符 CSS | 抽成共享 `style.css` | 去重 27 KB（逻辑重复） |
| 5 | 7 个 `probe_*.py` 混在项目根 | 移入 `spike\probes\` | 归类 |
| 6 | `spike_torch.py` / `spike_compare.py` / `spike_selection.json` 混在根 | 移入 `spike\` | 归类 |
| 7 | 两份被取代的原型 | **归档**（不删）到 `static\_archive\` | 99,935 B 移出主目录 |
| 8 | 21 个死按钮 / 14 处未定义调用 | 共享 `app.js` 修好 | 功能债 |
| 9 | README 目录树与 2 条命令指向已移动的文件 | 已更新 | 文档债 |

**归档而非删除的理由**：`app-ui-mockup.html`（浅色靛蓝单文件）与 `app-ui-v3-dark.html`（暗色深红）
代表两条被否掉的视觉方向。留着可追溯"为什么最终选了这一套"，但不该混在现行原型里。
见 `static\_archive\README.md`。

---

## 三、**仍未清**的债务（诚实列出）

| # | 债务 | 为什么还没动 | 何时处理 |
|---|---|---|---|
| 1 | `图库与索引任务.html` / `操作记录与设置.html` **尚未按领域改写** | 它们的版式是定制的（多列卡片、表单栅格），半改比不改更糟；已插入「领域修正待办」块说明要改什么 | 迁移到 React 时（P5 / P3d） |
| 2 | `spike\*` 里 8 个 409 KB 的 JSON | 是**后端路线决策的证据**（torch vs ONNX 逐项对照），不是垃圾 | 保留；若要省空间可压缩 |
| 3 | `probe_*.py` 仍在（已归类） | 含"本机 GPU/CUDA 不可用"的实测依据，删了以后无法复现结论 | 保留在 `spike\probes\` |
| 4 | 旧 HTTP 档（`server.py` + `static\index.html`）与新应用**并存** | 新应用尚未建成；现在删会留下"两边都不能用"的空窗 | **P7**（与 MCP 档一起退役） |
| 5 | `mcp_server.py` / `register_mcp.py` / `verify_mcp.py` + DSH `cordis.patch.yml` 注册 | 同上：必须等新应用验收通过 | **P7**，且先备份配置文件并做字节校验 |
| 6 | 文档数量偏多（4 份 SPEC + DESIGN + plan + UI-REVIEW + 本账本） | 已建索引（见 README 顶部），但交叉引用仍有漂移风险 | 持续；每次改动同步索引 |
| 7 | **105 张预览图扩展名与内容不符** | 数据债，不是代码债；**不能当坏文件删** | 健康面板呈现 + 入库时回退解码（已实现） |
| 8 | ~~**P0.5 全量索引重建未跑**~~ | **已跑**：全量 v1 判 FAIL（min 0.9153）→ 六步诊断定位到**重采样实现** → 已修（预处理 v2）→ 全量 v2 重建中 | ✅ 推进中 |
| 10 | **阈值 ①（min ≥ 0.970）的推导方法不严谨**：依据是 `spike_selection.json` 的 **20 张**样本（0.9798/0.9929）。n=20 的最小值不能当 3594 条的硬下限（实测阈值落在约 p3.5–p4） | 本次修完编码器后全量 min 已落在 0.99+，**暂时不影响结论**；但下次换运行时/精度档前必须改成**按总体分位数**定阈值 | 下次换运行时前 |
| 11 | **20 条文本查询至今没有相关集标注**（`labels-v1.json`） | 因此 G-B 只能说"与旧索引等价、未退化"，**不能**说"检索质量达到某水平"。补标注需你出 20–30 分钟 | G-B 之后、P6 分发前 |
| 12 | **受限沙箱里跑构建器必须把 `TEMP`/`TMP` 指到工作区内** | `selfTestIndexBin()` 与 `selfTestBmpLayout()` 用 `os.tmpdir()`；沙箱拒绝写 `%TEMP%` → `EPERM`。不是产品 bug（用户终端不受限），但写下来以免重复踩 | 已记入本节 |
| 13 | `data/idx-full/`（v1，已判 FAIL）与 `data/idx-full-v2/` 并存 | v1 是判定证据的**来源**，不能删（报告引用了它）；双份索引约 22 MB | G-B v2 归档后决定 |
| 14 | **仓里有两份 `@huggingface/transformers`**（根 `node_modules` 与 `onnx-spike/node_modules`，同版本 4.3.1、**不同的类对象**；实测 `根.RawImage === onnx-spike.RawImage` → **false**） | 危害**静默**：`app/main/encoder.mjs` 从 `onnx-spike/` 引模块时，那份模块里的 `RawImage` 与 encoder 自己用的不是同一个类 → shim 不生效，且可能初始化两套运行时。已缓解：`installResizeCompat({ RawImage })` 改**依赖注入** + `assertResizeCompatInstalled()` 断言（不通过即中止）。**2026-10-10 迁移后补充**：应用改走 bundle，`encoder.mjs` 与 `resize_compat.mjs` 对 `@huggingface/transformers` 的引用是**同一个 external 说明符** → 运行时只有一份、不再有两份类对象（构建产物已核对）；**仍未根治**的是源文件位置（在 `onnx-spike/`）与**不打包的校验路径**（`tools/verify_encoder_path.mjs` 直接 import 源文件时仍是两份） | 从「P2 内」改到 **v2 重建归档后**：打包路径已不再受它影响，而挪文件要重跑跨语言金标 `tools/verify_resize.py` |
| 9 | `onnx-spike\` 的 node_modules 与根目录 `spike\` 分在两处 | `.mjs` 脚本靠目录向上查找 `node_modules`，移走会断 | 保留；在 `spike\README.md` 里写明 |

---

## 六、立项前把关（P0.5 预检）发现的三个问题

新增 `tools/preflight_p05.py`（把 `TASK-PLAN` §P0.5-a 的 8 项清单做成**可执行**检查）后，
第一次运行就抓出三个问题 —— **其中一个是产品 bug，而非检查脚本的问题**：

| # | 问题 | 性质 | 处置 |
|---|---|---|---|
| 1 | 我的检查漏了模型路径里的 `onnx/` 一层（实际是 `<rev>/fp32/onnx/model.onnx`） | 检查脚本错 | 已修；`SPEC-identity` §6.2 的 `model_files` 本来是对的 |
| 2 | **`MAGIC` 只有 7 字节，读端却按 8 字节比较 + 按 8/12 取偏移** → `readIndexBin` 永远返回 `null` → **"可续跑"从未生效**（文档却写着它可用） | ⚠️ **产品 bug** | 已修：显式 8 字节 hex + 偏移由 `MAGIC.length` 推导 + **往返自检**（含"截断文件必须被拒绝"的反例） |
| 3 | 检查用 `%TEMP%` 作临时目录（**沙箱拒绝子进程写工作区外**），且失败时把子进程 stderr 丢掉 | 检查脚本错 | 已修：临时目录移到 `data/` 下；失败时打印子进程输出尾部 |

**教训（值得记下来）**：
- 这两个脚本级错误，都是"**我假设了一个路径/布局，没有实测**"；
- 第 2 条尤其危险：它**不报错**，只是安静地每次都重编码 3594 张 —— 属于本项目反复强调的"最危险的失败模式"；
- 把清单做成**脚本**而不是文档，是发现它们的前提（人工看 12 项数字必漏）。

**验证**：修复后预检 **12/12 全绿**；续跑实测 `复用 30`（修复前 `复用 0`）。

---

## 七、我用的处置规则（便于复查）

1. **证据不删**：任何支撑过决策的测量数据（`spike\*.json`、`baseline-v1.json`、`_backup-old-index-*`）一律保留。
2. **被取代的成果归档、不删除**：移入 `_archive\` 并写明被谁取代、为什么。
3. **一次性产物删除**：可重跑生成的中间物（索引试点、`.pyc`、抽取残留）。
4. **移动前先 grep 引用**：确认没有文档/脚本指向旧路径，有就同步更新。
5. **删除前核对绝对路径**：确认目标在项目内且是预期目标，再动手。
6. **改别人的文件要可核对**：用带 dry-run 的补丁脚本，每处替换都报"期望命中数 vs 实际命中数"，不静默放过。
7. **残留债务必须写下来**：宁可账本上有 9 条欠账，也不假装干净。

---

## 五、本轮验证

| 项 | 结果 |
|---|---|
| 三页外链共享文件、无内联样式 | ✅ 全部 `style.css=1 app.css=1 app.js=1`，无 `<style>` |
| 语义搜索领域修正 | ✅ `data-folder=10`；通用内容清零（`2,486=0`、`人物=0`、`3840=0`）；真实素材字段到位 |
| 另两页待办块 | ✅ 各 1 处 |
| `app.js` 语法 | ✅ `node --check` = 0 |
| 项目根目录 | ✅ 只剩生产文件与文档（探针/spike 已归类） |
| `data\` 保留项 | ✅ 旧索引备份 12.7 MB · baseline-v1.json · previews · queries · 测量 JSON |

---

## 八、P2 迁移（electron-vite 工程主体）的债务处置 —— 2026-10-10

**这一轮做的事**：把应用从手搓外壳 `app/` 迁到 electron-vite 三端主体 `src/`
（`src/main` · `src/preload` · `src/renderer`），并提出可复跑的产物形状核对。
逐条改动与理由见 **`src/README.md` §5**（含"哪些行为一字未改"）。

### 8.1 本轮清掉的债

| # | 债务 | 处置 | 回收 |
|---|---|---|---|
| a | **`.gitignore` 忽略了 `build/`**，但 electron-vite / electron-builder 里它是 **buildResources**（图标、entitlements）—— 照搬常见模板留下的错 | 从产物段移除该规则，并在原位写明理由 | 打包资源不再会被静默漏提交 |
| b | **`sharp` 只作为传递依赖存在**（`@huggingface/transformers` 的可选依赖），而产品编码路径**直接** import 它 | 在 `package.json` dependencies 里显式声明 `sharp ^0.35.5`（本机已有该版本，无需联网） | 靠传递依赖迟早断 |
| c | **dev 态 IPC 来源校验会把所有调用拒掉**：原实现只认 `file://`，而 dev 页面来自 `http://localhost:5173` | `isAppUrl()` 增加 dev server 地址分支（只认 `ELECTRON_RENDERER_URL` 注入的地址，不拼接） | 避免"窗口开了但点什么都没反应"这类最难查的假故障 |
| d | **编码器静态 import**：transformers / 原生 onnxruntime 载入失败时，进程在**模块实例化**阶段就死，日志一行都没有，报错还是误导性的（找不到 transformers） | 改成 `await import('./encoder.mjs')`，失败可捕获并落日志 + 推给界面；顺带让冷启动不载模型 | 最危险的失败模式（静默死亡） |
| e | **渲染进程的报错只在 DevTools 里**，首次验收要求用户回传日志 = 让他多跑一趟 | 主进程把渲染进程 console / 加载失败 / 崩溃都写进 `data/_app.log` | 一次回传够用 |
| f | **`data/thumbs/`（thumb:// 缓存）没被忽略** | 加规则 | 派生数据不入库 |
| g | preload 的 **CJS 约束靠注释与约定**（"sandbox 下不加载 ESM"） | 改由构建固定：`output.format='cjs'` + `entryFileNames='[name].cjs'`，并在 `src/README.md` §3 给出可核对的产物形状 | 约定 → 可执行核对 |

### 8.2 **故意没做**的（连同理由）

| # | 事项 | 为什么不做 | 何时 |
|---|---|---|---|
| 1 | `checkJs` / `npm run typecheck` 门禁 | 实测打开后 222 条 `noImplicitAny`；在 JS 里撒 `any` 只是把红灯涂绿。**宁可没有这个脚本，也不要假绿**（本仓已有"打印了假成功"的前科） | P3a 转 TS |
| 2 | 把 `bmp_decode.mjs` / `resize_compat.mjs` 搬进产品树 | 它们是索引构建 / 查询 / 应用三条路径共用的关键件；`data/idx-full-v2` 正是一次**进行中**的全量重建（`meta.json` 里 `phase: midbuild`）；搬它要重跑跨语言金标。且应用走 bundle 后运行时已只有一份 transformers（见 §三 债务 14） | v2 归档后 |
| 3 | 重写界面为 React + Tailwind | 迁移这一轮的目标是"换工程化、行为一字不改"。混在一起改，一旦首次运行出问题就分不清是迁移还是重写引入的 | P3a |
| 4 | 删除 `app/`（旧外壳） | **新版还从未在 Electron 里跑起来过**（见 §8.3）。删了就没有已知可启动的形态可回退 | 你验证 `npm run dev` 通过后 |
| 5 | 打包（asar / 原生 `.node` / 真图标 / `data/` 落点） | P6 的活。现在只保证配置形状正确，并在 `log.mjs` 里对"`data/` 落在 asar 内"**打印警告**而不是假装没事 | P6 |
| 6 | CSP 响应头（SPEC-security §5 要求 meta + 头两处都设） | 打包态是 `file://`，`onHeadersReceived` 根本不触发；只在 dev 加上等于做了个假动作 | P6 定方案 |

### 8.3 **未验证**的部分（不声称可用）

我在受限沙箱里**起不了 Electron**：`electron.exe` 启动后以 `0xC0000003`（bash 里表现为 `exit=3`）
静默退出，`data/_app.log` 一行都不生成 —— 正是 `app/README.md` 记过的那个限制
（Windows 上 Electron 的多进程 IPC 依赖命名管道，沙箱禁止）。

所以本轮**只**验证了这些（都是可复跑的）：

| 验证 | 手段 | 结果 |
|---|---|---|
| 三端构建成功 | `npx electron-vite build` | ✅ out/main · out/preload · out/renderer 全部产出 |
| 产物形状符合规格 | `node tools/verify_app_build.mjs`（本轮新增，可复跑） | ✅ main=ESM；preload=CJS 且零 ESM 语句；依赖（zod / transformers / sharp）保持 external，原生模块未进 bundle；renderer 用相对路径引 asset |
| 引擎未受影响 | `npm test` | ✅ 67 过 / 0 败 / 1 跳过（跳过的是需要真实素材库的那条） |
| 主进程代码路径 | 沙箱内**无法**验证 | ⏳ 需你在终端跑 `npm run dev` 并回传 `data/_app.log` |

---

## 九、仓库重组 + 债务清理（"全新项目"）—— 2026-10-10 第二次

**这一轮做的事**：把"一路攒出来的仓库"整理成"新项目该有的样子"，并把过程中**发现**的债一并还掉。

### 9.1 重组（移动 + 归档，都是 git 可追溯的移动，不删）

| 从 | 到 | 内容 |
|---|---|---|
| 根目录散落的 26 个脚本 | `tools/` · `tools/quality/` · `spike/probes/` | 门禁与校验 / 质量判定 / 一次性探针 —— 按**角色**分，不按语言分 |
| 根目录 `app/` | `archive/app-shell-20261010/` | 手搓旧外壳。`npm run start:legacy` 仍可跑它（路径已改） |
| `patch_prototype_pages.py` | `archive/` | 一次性原型补丁脚本，原型已定型 |

**移动的硬要求**：这些脚本原先都假设"`__file__` 所在目录 = 项目根"（`sys.path.insert(0, HERE)`、
`HERE/"data"`、`HERE/"onnx-spike"`…）。直接搬会让它们**静默**用错根。
所以逐文件改写成**向上找 `core/engine.mjs`**，找不到就大声报错：

```python
ROOT = _gs_root(HERE)          # 向上找含 core/engine.mjs 的那一级
for _p in (ROOT, HERE, os.path.dirname(HERE)):   # ROOT: 导入 gemma_lib/index_bin；HERE 与父级: 同级模块
    if _p not in sys.path:
        sys.path.insert(0, _p)
```

- 改写脚本：`archive/_migrate_layout_20261010.py`（**带 dry-run，逐文件报命中数**，命中数不符即中止）
- 文档同步脚本：`archive/_fix_doc_paths_20261010.py`（44 处命令路径，同样先 dry-run 核对）
- `reports/` 与 `archive/` 里的旧路径**刻意不改** —— 它们记录的是当时的运行，改了就成篡改证据

### 9.2 还掉的债（这一轮最有价值的发现）

| # | 债务 | 怎么发现的 | 处置 |
|---|---|---|---|
| **a** | **3 个 Python 文件在提交里就是语法错误**：`baseline_report.py`（G-A 基线工具）· `preflight_p05.py`（P0.5 预检）· `make_quality_set.py`（夹具生成） | 全仓 `py_compile` 扫一遍。三份都是**同一处**被某次编辑吞掉了换行：注释把 `, ext))` 吃进去 → `(` 永不闭合 | 已修（把逗号从注释里挪回代码位置）。**语义未变**：那行写进指纹文件的内容仍是 `rel \t size \t mtime_ms \t ext`（改了会让指纹对不上 `baseline-v1.json`） | 
| b | **没有"能不能解析"的守卫** —— 上面 3 个文件坏了没人知道：它们不参与任何自动测试，只有"真要跑那一项"时才炸，而那正是最需要它的时候 | 同 a | 新增 `tools/verify_syntax.py`：全仓 `.py` 编译 + `node --check` 所有 JS。**51 个 .py / 41 个 JS 全绿**。已加入守卫清单 |
| c | 2 处 `SyntaxWarning: invalid escape sequence`（文档字符串里写 Windows 路径 `G:\model`、`.dsh\skills`） | 语法体检顺手报出来 | 已修（改成 raw 字符串；**已用 `ast.literal_eval` 逐字比对** `register_mcp.py` 的 `BLOCK` 常量前后一致 —— 它是要写进配置文件的，不能变） | 
| d | `__pycache__/`（含 `archive/`、`data/diag/`、`spike/probes/` 下四处） | 全仓扫 | 已删（`.pyc` 可再生） |
| e | `.gitignore` 忽略 `build/`（其实是 electron-builder 的 buildResources，图标会被静默漏提交） | 上一轮 P2 迁移时发现 | 已修（见 §8.1 a） |
| f | 补丁脚本的**转义陷阱**：`tools\verify_docs.py` 这类文本经过 Python 字符串时，`\v` `\b` `\f` 会被当转义序列，把 `v`/`b`/`f` 吃掉，终端里几乎看不出来 | 本轮重组时**真踩到**（README 里 8 处：`tools␋erify_syntax.py`…） | 已全部修回；并写了个全仓控制字符扫描确认**归零**（0x00–0x08 / 0x0B / 0x0C / 0x0E–0x1F 任何一处都算事故） |
| **g** | **`baseline_report.py` 修好语法后，第一次跑就崩**：`UnicodeEncodeError: 'gbk' codec can't encode character '\u26a0'` —— 它打印 `⚠`，但没有本项目其它脚本都有的 `sys.stdout.reconfigure(utf-8)` 兜底 | 真跑一次 G-A 工具（这正是 `verify_syntax.py` 想推动的事：**跑起来才算验过**） | 已给 5 个当前路径的脚本补上兜底：`tools/baseline_report.py` · `spike/probes/{inspect_20,probe_encode,verify_bmp_pil}.py` · `spike/spike_compare.py`（脚本留存：`archive/_fix_console_enc_20261010.py`） |
| h | **这类编码隐患没有守卫**（改完脚本谁会记得在任何 console 下试一遍？） | 同 g | `tools/verify_syntax.py` 增加第三节：扫“有 `print` + 含 GBK 编不出的字符 + 无 reconfigure 兜底”。当前路径（`tools/`·`src/`·`core/`·`spike/probes/`…）算 **FAIL**，旧档只提醒 —— 现有 6 条提醒：`build_index.py` · `gemma_lib.py` · `server.py` · `verify_app.py`（P7 批，按规矩不动）+ 归档版原型补丁脚本 + `data/diag/resize_cmp.py` |
| i | 冗余备份：重跑 baseline 又生成了 12 MB 的 `data/_backup-old-index-20261010-161919`，而同一份旧索引已有 13:07 的副本 | 同上 | 已删冗余副本；`data/baseline-v1.json` 也已 `git checkout` 还原（重跑结果与 13:07 那次**逐字段一致**，只差 `generated_at` 与备份目录时间戳 —— 见 §9.5） |
| **j** | **`data/diag/`（78 MB）没被 `.gitignore` 忽略**，而它里面大部分是 `.raw` 像素转储（44 MB）、库图片副本（31 MB）、小批量试点索引 —— `git add -A` 会把它们全部收进仓库 | `git status` 里它一直是 `?? data/diag/`；污染扫描也把它算成 36 个大文件 | 先**另存证据副本**到 `reports/G-B-20261010-v2/evidence/`（14 个 csv/json，~800 KB，含逐条 `cos-all.csv` 与跨语言金标，带 README 说明），再把 `data/diag/` 整体忽略。原件未删（本机路径仍有效），只是不再入库 |

### 9.3 **故意没做**的

| # | 事项 | 为什么 |
|---|---|---|
| 1 | 删除旧 Python 检索档（`gemma_lib.py` / `mcp_server.py` / `server.py` / … 12 个文件 + `static/index.html`） | 它是**当前唯一在用的检索服务**，DSH 的 MCP 注册就指向它。SPEC-app §5 写的是"P7 = 应用验收通过后退役"；**新应用还没在你机器上跑起来过**，现在删就是留下"两边都不能用"的空窗。要提前退役，一句话即可 |
| 2 | 动 `onnx-spike/{bmp_decode,resize_compat}.mjs`（搬进产品树 `src/imaging/`） | **全量 v2 重建正在跑**（`build_index_onnx.mjs` 进程仍在写 `data/idx-full-v2`，`meta.json` 里 `phase: midbuild`）。它们是构建/查询/应用三条路径共用的关键件，搬完必须重跑跨语言金标 `verify_resize.py`。等 v2 归档后再做 |
| 3 | 把 14 份文档收进 `docs/` | 它们被交叉引用了几百处（`SPEC-app.md §3`…），且 `tools/verify_docs.py` 就是按"根目录的 .md 清单"做索引覆盖检查的。半改比不改更糟 |
| 4 | 删除 `data/_probe-*.bin` / `data/_pv-*` / `data/_resize-*.raw`（约 18 MB） | 它们是重采样诊断**证据链**的原始数据（`reports/G-B-20261010-v2/DIAGNOSIS-resample.md` 引用），且不入库 —— 删了就真没了 |

### 9.4 验证

| 项 | 手段 | 结果 |
|---|---|---|
| 语法 | `tools/verify_syntax.py` | ✅ Python **52** 个 · JS 41 个全部可解析（**修前 3 个 .py 失败**）；控制台编码：当前路径 0 失败 / 6 条旧档提醒 |
| 文档 | `tools/verify_docs.py` | ✅ 死引用 3（archive 里的旧名，属正常）· 检查项未通过 **0** |
| 令牌 | `tools/verify_tokens.py` | ✅ 违规 0 |
| 产物形状 | `tools/verify_app_build.mjs` | ✅ 全过 |
| 引擎 | `npm test` | ✅ 67 过 / 0 败 / 1 跳过 |
| 控制字符 | 全仓扫描（一次性） | ✅ 0 处 |
| G-A 门禁 | `tools/baseline_report.py`（**修好后第一次真跑**） | ✅ **5/5 OK**：库指纹已算 · 旧索引有可恢复副本 · 配对已核对 · 无零向量/越界 · 索引条目数 = 磁盘图数。指纹 `3c62f15c5944…` 与 `tests/engine.test.mjs` 的期望值一致 |
| 移动后的脚本能跑 | 11 个 argparse 脚本 `--help` + 3 个只读守卫实跑 | ✅ exit=0（证明“向上找项目根”的改写真的生效，不是只改了文本） |

### 9.5 一句话教训

本轮揪出的真债（3 个语法错误的脚本、1 个一跑就崩的编码 bug）都有同一个特征：
**它们不属于任何自动测试，只有真要跑那一刻才暴露** —— 而那一刻往往就是“最需要它给出结论”的时候。
所以把“能不能解析”和“打印会不会在 GBK 下崩”这两类**静态**问题做成了守卫；
但“逻辑对不对”仍然只能靠各自的测试与真实运行 —— **不要拿静态守卫冒充后者**。

---

## 十、`npm run dev` 实测结果 —— 2026-10-10

**一句话：沙箱里 Electron 的浏览器进程根本起不来（环境问题，不是代码问题），有对照实验定性。**

### 10.1 对照实验（决定性）

| 实验 | 命令 | 结果 |
|---|---|---|
| **A 最小 Electron 应用**（3 行脚本，**不含我们的任何代码**） | `electron.exe tools/probe_electron_start` | `exit=3`（=0xC0000003），`probe.log` **根本没生成** → JS 一行没跑 |
| **B 同一个 exe 走 Node 模式** | `ELECTRON_RUN_AS_NODE=1 electron.exe -e "…"` | `exit=0` · `node-mode ok · electron=44.7.0 · node=24.21.0` → **二进制本身没问题** |
| C 裸 `--version` | `electron.exe --version` | `exit=3`（连版本号都打不出来） |
| D 常见绕过开关 | `--no-sandbox` / `--disable-gpu` / `--in-process-gpu` / `--disable-features=NetworkService` | 3 / 3 / 3；其中 `--no-sandbox` 直接 **Segmentation fault (139)** |
| E `npm run dev` | 见 §10.2 | 主进程 ✓ preload ✓ dev server ✓ → `starting electron app...` → `exit=3` |

A ↔ B 的对照足以定性：**同一个二进制，Node 模式完好，浏览器进程模式必死** ——
与 `app/README.md` 早就记下的限制一致（Windows 上 Electron 的多进程 IPC 依赖命名管道，沙箱禁止）。
探针已留成可复跑的工具：`tools/probe_electron_start/`（附判读表）。

### 10.2 `npm run dev` 在沙箱里**真正跑通**的部分（都验到了）

```
✓ vite building ssr environment (main)     12 modules → out/main/index.js 45.44 kB
✓ electron main process built successfully
✓ out/preload/index.cjs 0.82 kB（CJS）
✓ dev server running at http://localhost:5173/
✓ HTTP 200：/ · /src/main.js · /src/app.css · @fs/…/static/prototype/tokens.css（跨 root 的 CSS 也能取到）
✗ starting electron app... → exit=3（环境所致，非代码）
```

### 10.3 主进程的两个分支：用真进程验过了

`ELECTRON_RUN_AS_NODE=1` 恰好能**造出**你环境里那个坑，于是两个分支都能实测：

| 分支 | 做法 | 结果 |
|---|---|---|
| 非 dev 态自愈 | `ELECTRON_RUN_AS_NODE=1 electron.exe out/main/index.js` | `exit=0`；`data/_app.log` 里依次是：版本头 → 配置/根目录 → 识别到该变量 → **已拉起新进程 pid=5208** |
| dev 态拒绝自愈 | 再加 `ELECTRON_RENDERER_URL=…` | `exit=3`；日志给出可操作提示：用 `npm run dev`（脚本会先摘掉该变量）或 `$env:ELECTRON_RUN_AS_NODE=$null` |

顺带证明：**日志文件这条路是通的**（Windows 上 GUI 子系统没有 stdout，全靠它）。

### 10.4 因此新增的守卫：`tools/verify_renderer_dom.mjs`

既然真实窗口验不了，就把**渲染进程逻辑**在一个最小 DOM 桩里真跑一遍（从真实 HTML 抽 id /
`data-folder` / `data-mode` 建元素表，mock `window.api`，加载**构建产物**里的 bundle）：

- **启动路径**：`boot()` 不抛错 · HTML 里有渲染进程请求的**全部** id（手抄 `index.html` 最容易错在这）· 侧栏被真实填上（库名/路径/3594 已编码）· 输入框自动聚焦
- **搜索路径**：点搜索 → 校验传给主进程的参数（mode/text/filters.folders 取自 HTML 勾选）· 结果卡片张数 · `thumb://` URL 形状 · 分数与分类徽标 · meta 条数与耗时
- **交互路径**：空查询**不发 IPC** 只提示 · 未选参考图不发 IPC · 模式切换高亮与显隐 ·「定位」在"既无包也无图路径"时禁用 ·「取件」真的调 `collect` 并把结果反馈到 toast · `encoder.ready` 事件被订阅并显示

**25 项断言全过**（首轮 1 项失败是**我测试写错了期望**：把"无包"当成了"禁用"，
而源码规则是 `!(archive || relPath)` —— 已改夹具按真实规则测，不是改代码迁就测试）。

> ⚠️ 它**不能**证明应用可用：真实布局、`thumb://` 真取图、真实 IPC、WebGPU 都仍要你在自己终端跑
> `npm run dev` 才算数。**静态守卫与 DOM 桩都不能冒充"跑过了"。**

### 10.5 你那次 `npm run dev`（16:23:58）的追查

现象：跑完"什么都没发生"。查到的：

| 证据 | 结果 | 含义 |
|---|---|---|
| `data/_app.log` 时间戳 | 停在 **16:21:55**（我那次实验），你那次没被写 | 主进程**一行代码都没执行** |
| `out/main/index.js` / `out/preload/index.cjs` | mtime 16:23:58（main+preload 被重建） | 说明 `npm run dev` 走到了"构建完成"这步，然后倒在拉起 electron |
| WER 事件日志 | 只有 **16:21:42** 一条 `electron.exe 44.7.0.0 APPCRASH ex=c0000005`（我的运行） | electron 死在**自身启动期**（访问冲突） |
| `%APPDATA%\gemma-search` | **不存在** | 连 userData 目录都没建起来 → 死在很早期 |
| 同一 exe 加 `ELECTRON_RUN_AS_NODE=1` | `exit=0 · node-mode ok` | 二进制完好，是 **GUI/多进程** 这条路径起不来 |
| PowerShell 历史 | 你 15:16 那次是 `$env:ELECTRON_RUN_AS_NODE = $null` + `npm start` | ⚠️ 那次崩在 `app/main/index.mjs:166`（`protocol` undefined）**恰恰是"以纯 Node 运行"的症状** —— 所以它**不能**证明"GUI Electron 在你机器上能起来" |

**因此新增 `npm run smoke`**（`tools/smoke_app.mjs`）：绕开 dev server 直接跑构建产物，
把日志指到独立文件、接回子进程 stdout/stderr，**并自动做三组对照**：

- 对照 A：同一 exe 走 Node 模式（`ELECTRON_RUN_AS_NODE=1`）→ 二进制好不好
- 对照 B：近 5 分钟的 Windows 错误报告事件（异常码 + 偏移）
- 对照 C：`%APPDATA%\gemma-search` 是否被创建（判断死在多早）

最后按日志内容给出判定与**退出码**（0 起来了 / 1 产物缺失 / 2 没跑到 JS / 3 跑到但没窗口 / 4 起来了但有报错）。
这样"窗口没出来"和"主进程压根没启动"不再长得一模一样。

---

## 十、Electron + Vite + React 实跑与环境边界 —— 2026-10-10 第三次

### 10.1 这一轮做成的

| 项 | 结果 |
|---|---|
| 渲染层迁移 | `src/renderer/src/main.js`（手写 DOM）→ `main.jsx` + `App.jsx`（React）。`app.css` 与 `static/prototype/tokens.css` **一字未改**，令牌仍是唯一来源 |
| 构建 | `@vitejs/plugin-react@^5`（v6 要求 Vite 8，与本工程 electron-vite 5 + Vite 7 ERESOLVE，实测） |
| 实跑 | Electron 出窗 + React 挂载 + `indexStatus ok` + **WebGPU 载入 2.4 s**（证据 `reports/G-D-p2-electron/`） |
| 守卫 | `tools/verify_renderer_dom.mjs` 重写为 **jsdom 真跑 React 产物**（原实现从 HTML 抽 id 建桩，React 下不成立） |
| 文件整理 | 删 `web/`（浏览器预览 + 24 包 node_modules + 令牌副本），全仓只剩**一个** Electron + Vite + React 工程 |

### 10.2 记在账上的

| # | 债务 | 说明 | 何时 |
|---|---|---|---|
| 1 | 本环境必须 `--no-sandbox` | Chromium 进程沙箱初始化失败（`0x80000003` 秒退）。**不进产品**，只影响受限环境自测；判据已补进 `tools/probe_electron_start/README.md` | 环境问题 |
| 2 | `web/` 先建后删 | 上一轮为验证 Vite 工具链建了浏览器预览；按"禁止相互污染"删除，避免两套依赖 + 两份令牌漂移 | ✅ 已清 |
| 3 | 引擎报 `INDEX_MISSING` | 应用数据目录里没有登记索引 → 检索不可用。**不是 bug**，是 P0.5-c「接受索引」还没做 | P0.5-c |
| 4 | GPU 磁盘缓存报错 | `Unable to create cache (0x5)`（Chromium userData 缓存目录）。只噪声，不影响功能 | 观察 |
| 5 | `frame-ancestors` 在 meta 里被忽略 | 浏览器警告；SPEC-security §5 要求 meta + 响应头两处都设 | P6 |
| 6 | 渲染 bundle 656 kB | 未做体积优化（React 19 + 应用），P6 打包时一起看 | P6 |
| 7 | jsdom 成为新的守卫依赖 | `tools/verify_renderer_dom.mjs` 需要 jsdom（devDependency）；它**不能**证明 CSS 生效与 `thumb://` 取图 | 持续 |

| 8 | `electron .`（**目录形式**）在本环境秒退 | 主进程以 `0xC0000005` 崩在 `app.whenReady()` 之前；改用主脚本路径 `out\main\index.js` 即正常出窗（同二进制/同开关/同 cwd 的对照实验）。`tools/smoke_app.mjs` 已改并写进注释 | 已修（工具内） |
| 9 | 冒烟脚本原用管道接子进程 stdio | 同样观察到 `0xC0000005`；已改为不使用管道（GUI 子系统本来也没有 stdout，日志走 `GEMMA_APP_LOG`） | ✅ 已修 |
| 10 | `data/_smoke-*.log` 每次冒烟新增一个 | 已 gitignore（`*.log`），但会堆积；要清理时手动删 `data\_smoke-*.log` | 观察 |

| 11 | electron-vite 的 dev 默认把入口传成 `.`（目录形式） | 本机实测该形式会以 `0xC0000005` 崩在 `app.whenReady()` 之前；`scripts/electron-vite.mjs` 探测到受限环境时会自动补 `--entry out/main/index.js` | 已修（工具内） |
| 12 | 官方开关一直存在但没人用 | electron-vite 自带 `--noSandbox`（`cli.js` → `NO_SANDBOX=1` → 给 Electron 加 `--no-sandbox`）与全局 `--entry`。此前 README 只写了"沙箱里起不了 Electron"，**没写"那怎么起"** | ✅ 已写进 README 与脚本 |

| 13 | 沙箱探测第一版**误判**（把 `ELECTRON_RUN_AS_NODE=1` 下的 `electron --version`——其实是 **Node 的版本**、退出码 0——当成"沙箱可用"） | 与 `verify_syntax` 那次同类：**判据本身缺否定对照**。已修：探测显式传清理后的环境 + 首次失败带参重试兜底 | ✅ 已修（工具内） |
| 14 | GPU 磁盘缓存写不进去（`AppData\Roaming\Electron\GPUPersistentCache … 拒绝访问 (0x5)`） | 只输出噪声、不影响功能（窗口/渲染/WebGPU 都正常）。要根治得把 userData 指到可写目录 | 观察（P6 打包时一并处理） |

| 15 | 判据 ① 的最小值门槛 **0.970 → 0.700**（项目所有者 2026-10-10 决定） | 旧值来自 n=20 样本（债务 10 已指出推导不严谨）；v2 实测 min=0.967894 差 0.0021 未达。**代价**：该门槛不再能拦"尾部退化"，质量信号移到中位数 / Top-10 重合率 / 分位数观察项；0.970 保留为报告里的观察线 | ✅ 已记入 `SPEC-acceptance.md` §2.2 |

### 10.3 索引接受与检索打通（2026-10-10）

| 项 | 结果 |
|---|---|
| G-B 自动判定 | **PASS**（判据 ① 门槛由所有者下调为 0.700 后）· 证据 `reports/G-B-20261010-v2/` |
| 接受（P0.5-c） | 复制 `data/idx-full-v2/{index.bin,items.json,meta.json}` → **`data/libraries/L1/`**（引擎约定的落点）；**不覆盖** `data/*.npy`，旧 Python 档照常可用 |
| 应用侧 | `indexStatus → L1 3594/3594 · dim=768 · healthy=true`（冒烟实跑） |
| 检索 | 真模型编码中文查询 → 引擎 **7 ms 返回 5 条**（全 VR、均带 .rar）；可复跑：`node tools/check_search.mjs`（需先有查询向量） |

| # | 债务 | 何时 |
|---|---|---|
| 16 | **④ 人工复核（轻档）尚未完成**：`reports/G-B-20261010-v2/human-review.md` 10 项 | 所有者确认 |
| 17 | 判据 ① 的最小值门槛已降到 0.700 → **尾部退化不再被拦住** | 由中位数 / 重合率 / 分位数观察项承担；见 `SPEC-acceptance.md` §2.2 |
| 18 | 400×300 一档（411 张）是全库最大组且是当前尾部集中处 | 下次换运行时/精度档时作为第一批回归样本（`reports/G-B-20261010-v2/TAIL-400x300.md`） |

| 19 | **④ 人工复核本轮不执行**（项目所有者 2026-10-10 决定） | ④ 在 §2.2 里本就不是门槛（通过 = ①∧②∧③），只是"异常项可解释吗"的交代。**代价**：G-B 的结论止于"与旧索引未退化 + 尾部已定位"，**不能**声称检索质量达标（20 条查询仍无相关集标注） | ✅ 已记入 `SPEC-acceptance.md` §2.2 与 `human-review.md` 头部 |
| 20 | **缩略图失败过去完全静默** | 缺陷本身已修（`thumb://` 的 URL host 被小写化 → libId `L1`→`l1` → `LIB_NOT_FOUND` → 界面全部"无预览"，无任何日志）。**已补日志**（请求/缓存命中/取路径失败/生成成功），这类问题今后一眼可见 | ✅ 已修 + 已补日志 |

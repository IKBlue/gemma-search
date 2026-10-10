# 立项前检查（Pre-Kickoff Checklist）

> 检查日期：2026-10-10 · 仓库：`https://github.com/IKBlue/gemma-search.git`
> 结论：**可以立项 / 可以推**。下面每条都给出了**本机实测**的依据，不是"应该没问题"。

---

## 一、结论速览

| 维度 | 状态 | 依据 |
|---|---|---|
| 机密泄露 | ✅ **0** | 扫描 token / 密钥 / 私钥 / Bearer —— 无命中 |
| 代码与本机解耦 | ✅ 已解耦 | 代码里**行为性**的绝对路径 0 处（余下是文档示例与被忽略的派生数据） |
| 提交体积 | ✅ **4.08 MB / 98 文件** | `git ls-files` 实测；其中证据 JSON 2.6 MB |
| 该忽略的都忽略了 | ✅ | 索引 / 备份 / node_modules / 模型缓存 / 本机 config 全部 `!!` 状态 |
| 形态与决策 | ✅ 已锁定 | 12 条决策 + 4 条补充决策，见 `TASK-PLAN.md` §2/§8 |
| 门禁进度 | 🔶 G-A 通过；G-B/C/D/E1/E2 待做 | `TASK-PLAN.md` §4 |
| 阻塞项 | ✅ **无** | 三项决策已定；BMP 解码器已修（105/105） |
| **待你确认** | ⚠️ **1 项** | `LICENSE` 目前填 **MIT**（见 §六） |

---

## 二、污染清理（本轮做了什么）

| 项 | 处置 | 结果 |
|---|---|---|
| **本机绝对路径（代码）** | `gemma_lib.py` 改为「环境变量 > `config.json` > 可移植默认」；本机配置放进**被忽略**的 `config.json` | 现有功能**行为不变**（路径逐项一致） |
| | `download_model.py`：HF 缓存改从 `gemma_lib.MODEL_CACHE` 取 | 不再写死 `D:\USERS\...` |
| | `test_mismatch.mjs`：模型目录改 `--model` / `GEMMA_ONNX_MODEL`，缺参数**明确报错** | 不再写死 |
| | `probe_identity_facts.py`：库根与**扩展名集合**都从 `gemma_lib` 取 | 顺带消除"两边各写一份扩展名"的老坑（曾漏 `.7z` 误判 76 条） |
| | `register_mcp.py`：用 `expanduser("~")` + 环境变量 | 不再出现 `Administrator` 与工作区路径 |
| **证据里的绝对路径** | `data/quality/extension-mismatch.json` 移除 `abs_path` ×105 | 只留相对路径，16.6 KB |
| **字节码** | 删除重新生成的 `__pycache__/`，并加入 `.gitignore` | — |
| **一次性脚本** | 删 `decouple_paths.py` / `fix_remaining_coupling.py` / `audit_palette.py` 等 | 只保留可复用的守卫脚本 |

### 保留的"看起来像污染"的东西（**是有意的**）

| 项 | 为什么保留 |
|---|---|
| `config.example.json` 里的 `G:\model` | 是**模板占位**，不是耦合 |
| `build_index.py` / `cli.py` / `build_index_onnx.mjs` 里的路径 | 是**用法示例**（docstring 与注释），不影响行为 |
| `patch_prototype_pages.py` 里的路径 | 是**写进原型演示文案**的内容（"定位到 G:\model\..."） |
| `data/baseline-v1.json` 的 `library_root` | 证据要记录"测的是哪个库"；`G:\model` 在 README 里本就公开 |
| `scan_repo_pollution.py` 自身 | 它就是检测这些模式的工具 |
| `data/items.json` / `_backup-*` / `spike/*.json` | 前两者**已被忽略**（派生数据）；`spike/*.json` 是**后端选型的证据**，入库 |

---

## 三、仓库脚手架

| 文件 | 作用 |
|---|---|
| `.gitignore` | 8 组规则，**每条都注明"为什么"**（防止以后误删规则把 24 MB 索引提交上去） |
| `.gitattributes` | `* text=auto eol=lf`；`.cmd/.bat/.ps1` 强制 CRLF；图片/`npy`/`onnx`/压缩包标 binary；`spike/*.json` 标记 `-diff` |
| `LICENSE` | MIT（**待你确认**，见 §六）+ 第三方组件与模型的授权说明 |
| `config.json` | **本机配置，已被忽略**（`G:\model` 等） |
| `config.example.json` | 入库的模板 |
| `check_staged.py` | **提交前守卫**：读暂存区报告规模 + 违规（node_modules / `.npy` / `config.json` / `>512 KB`） |
| `scan_repo_pollution.py` | 机密 + 本机耦合 + 大文件扫描（区分代码与文档） |
| `verify_docs.py` | 文档完整性（死引用 / 索引覆盖 / 审查要求落点） |
| `verify_tokens.py` | 设计令牌纪律（写死颜色 / 悬空 `var()` / 加载顺序） |

### 仓库本机一次性设置（**不随仓库分发**）

```powershell
git config core.quotepath false     # 中文文件名不显示成八进制转义（本仓库已设）
git config core.autocrlf false      # 由 .gitattributes 统一控制行尾，关掉自动转换
```

---

## 四、提交内容（实测：98 文件 / 4.08 MB）

| 顶层 | 文件数 | 大小 | 说明 |
|---|---|---|---|
| `spike/` | 24 | 2.60 MB | 后端选型证据（8 个向量转储 + 探针 + README） |
| `data/` | 11 | 0.84 MB | 3 张参考图 + 质量证据 JSON（索引与备份**已忽略**） |
| 根目录 | 35 | 0.33 MB | 源码 + 12 份文档 + 4 个守卫脚本 + LICENSE/.gitignore |
| `static/` | 16 | 0.26 MB | 原型套件（6 页 + tokens/style/app.css/app.js + 归档） |
| `onnx-spike/` | 8 | 72 KB | ONNX 脚本 + `package-lock.json`（`node_modules` **已忽略**） |
| `archive/` `reference/` | 4 | 53 KB | 被取代的旧计划 + 官方模型卡 |

**被忽略的关键项**（`git status --ignored` 实测）：
`config.json` · `data/embeddings.npy`(10.5 MB) · `data/items.json`(1.6 MB) · `data/meta.json` ·
`data/_backup-old-index-*/`(12.7 MB) · `data/previews/` · `*.log` · `onnx-spike/node_modules/`(496 MB)

### 可选瘦身（不阻塞）

`spike/*.json` 占 2.6 MB（仓库的 64%）。它们是可复现的证据，**建议保留**；
若要瘦身，可选：转 `.json.gz`（约省 60%）或只保留 `spike/README.md` 的结论表。
**我不擅自处理** —— 删证据与本项目的"证据优于断言"原则冲突。

---

## 五、项目准备度（对照 `TASK-PLAN.md`）

| 项 | 状态 |
|---|---|
| 规格 / 设计 / 验收口径 / 视觉令牌 | ✅ 全部成文（12 份文档，含索引与权威关系） |
| 决策 | ✅ 12 条锁定 + 4 条补充（含侧栏深浅） |
| **G-A 基线门禁** | ✅ **5/5 通过**（基线可复现 + 旧索引可恢复副本） |
| 索引构建器 | ✅ 跑通；**BMP 解码器已加**（105/105 可编码，含合成图布局自检） |
| UI 原型 | ✅ 6 页，离线可开；**已接入设计令牌**（0 处写死颜色、0 悬空 `var()`） |
| `SPEC-security.md` | ⏳ 待写（**G-C 前**，属 P1 前置交付物） |
| 接口契约 | ⏳ P1 冻结（`CONTRACT-engine-v1.md`） |
| **G-B** 索引质量 | ⏳ 待跑全量重建（约 25 分钟）+ 三份报告 |
| 阻塞项 | ✅ **无** |

---

## 六、⚠️ 需要你确认的 1 项

**`LICENSE` 目前填的是 MIT**（版权人按仓库地址推断为 `IKBlue`，年份 2026）。
如果这不是你想要的（例如想用 Apache-2.0、或暂时不授权、或 `All rights reserved`），
**说一声我改**。注意：`google/embeddinggemma-2` 模型权重是 **Apache-2.0**（Google 发布），
与本项目代码的授权相互独立 —— 这一点已在 `LICENSE` 末尾写明。

---

## 七、推送前最后一次把关（三条命令）

```powershell
cd D:\USERS\Desktop\Agent\gemma-search

# 1) 看"到底会提交什么"（读暂存区，不猜）
python ..\.venv\Scripts\python.exe check_staged.py     # 或 & ..\.venv\Scripts\python.exe check_staged.py

# 2) 再扫一遍污染（机密 / 耦合 / 大文件）
& ..\.venv\Scripts\python.exe scan_repo_pollution.py

# 3) 确认无误后提交并推送
git add -A
git commit -m "chore: 立项前清理与仓库准备"
git remote add origin https://github.com/IKBlue/gemma-search.git
git push -u origin main
```

> **推送到 GitHub 我没有做** —— 那需要你的凭据，且属于对外发布动作，
> 应当由你确认 `LICENSE` 与提交内容后自己执行。

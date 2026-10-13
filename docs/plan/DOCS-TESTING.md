# 项目测试说明（Testing）

> **状态**：现行 · **最后核对**：2026-10-12
> **权威范围**：测试体系的**实际形态**、覆盖与缺口、每条验证命令"能证明什么 / 不能证明什么"。
> 阈值口径以 `docs/spec/SPEC-acceptance.md` 为准。事实基准：`docs/audit/00-current-state.md`。
>
> **本文定位**：说明**本项目的测试体系实际长什么样**、覆盖了什么、**漏了什么**，
> 以及每条验证命令**能证明什么 / 不能证明什么**（本仓库自己立了这条规矩，本文严格遵守）。
> 路径按 monorepo 新布局书写；`npm test` 的 glob 已改为 `packages/engine/tests/*.test.mjs`（P2 适配）。

---

## 1. 四层验证体系

| 层 | 工具 | 需要什么 | 能证明 | **不能证明** | 现状 |
|---|---|---|---|---|---|
| **L1 引擎/桌面单测** | `node:test` | 只要 Node | 引擎逻辑、安全不变量、索引格式、compat、uid、IPC 参数校验、窗口判定**决策** | 传输层接线、界面渲染、真实模型 | ✅ **唯一可跑的门禁**（113 条） |
| ~~L2 构建守卫~~ | ~~`tools/verify_app_build.mjs`~~ | 先 `npm run build` | 产物形状（ESM/CJS/external/相对路径/原生模块未内联） | 运行时行为 | ❌ **2026-10-13 移除** |
| ~~L3 渲染层守卫~~ | ~~`tools/verify_renderer_dom.mjs`（jsdom）+ `verify_renderer_styles.mjs`~~ | 先 build | React 真跑（启动/搜索/交互/事件）+ 令牌纪律 | **CSS 真的生效、`thumb://` 真能取图、真实 IPC、真实窗口** | ❌ **2026-10-13 移除** |
| ~~L4 应用实跑~~ | ~~`tools/smoke_app.mjs` + `reports/G-D-p2-electron/`~~ | Electron 二进制、可出窗环境 | 真窗口 + 真渲染 + WebGPU 编码器载入 | 打包后行为、干净机器行为 | ❌ **2026-10-13 移除** |

**关键纪律（原写在 `verify_renderer_dom.mjs:12-13`，该守卫已于 2026-10-13 移除，纪律本身仍成立）**：
> ⚠️ 它**不能**证明：CSS 真的生效、`thumb://` 真能取到图、真实 IPC、真实窗口。

这条自限是本项目测试体系最值得肯定的地方——但**也是最大的结构问题**（见 §6），
而且**移除守卫把这个问题放大了**：现在连"它能证明的那部分"也没了。

---

> ⚠️ **2026-10-13：本文档里凡引用 `verify_app_build` / `verify_main_wiring` / `verify_renderer_dom` /
> `verify_renderer_styles` / `smoke_app` / `verify-doc-refs` 的地方，那些守卫**已按所有者指令移除**
> （原件备份在 `data/_removed-guards-backup/`）。文中的"有自动化/由它断言"一律**不再成立**；
> 现存守卫只剩 `verify_encoder_path` 与 `check_search`，且两者都需要模型与已注册索引（沙箱跑不动）。
> 详见 [`AGENTS.md`](../AGENTS.md) §5.2 的"移除的代价"。

## 2. 测试逐项清点（引擎 68 条 + 桌面配置 12 条 = 80 条）

**命令**：`npm test`（脚本 glob = `node --test --test-isolation=none "packages/engine/tests/*.test.mjs"`）
**实测结果**：`tests 90 · pass 89 · fail 0 · skipped 1`（`duration_ms` 随机器浮动，单次实测 508–530 ms 量级；**唯一稳定的判据是 68/65/0/3**）

### 2.1 四个测试文件与分布

| 文件 | 主题 |
|---|---|
| `packages/engine/tests/engine.test.mjs` | 引擎主体：`indexStatus` / `search` / 多库 compat / `scan` / `item` / `reveal` / `collect` / band / 编码器容错 |
| `packages/engine/tests/index.test.mjs` | `index.bin` 读取与六道校验 + `readItems`/`readMeta`/`relOf` |
| `packages/engine/tests/security.test.mjs` | 五条安全不变量 + 库注册表 + 指纹只读性 |
| `packages/engine/tests/uid.test.mjs` | uid 形状 / 确定性 / 种子 / 黄金向量 / 整库唯一性 |

### 2.2 覆盖到的内容（按能力归类）

| 能力 | 代表测试 | 强度 |
|---|---|---|
| 检索正确性 | `search(text)：命中同向条目，band 由引擎给（界面不自己算）` | ✅ 假编码器 + 同向向量 |
| **编码器容错** | `search：编码器忘了归一化时，引擎自行归一 → 排序与 band 仍正确` | ✅ 防御性设计被验证 |
| 分数不可跨模态比 | `band：阈值随模态不同` | ✅ 锁住口径 |
| 多库合并与跳过 | `多库：compat 不等 → 该库进 libsSkipped 并给结构化原因` | ✅ 结构化原因 |
| **设备不参与 compat** | `多库：device 不同不导致跳过（否则 CPU 回退会拒绝自己的索引）` | ✅ 有理由的边界 |
| 索引损坏检测 | MAGIC / 截断 / `footer.complete` / sha1 改一个字节 / 文件不存在 | ✅ **6 道校验逐个有测** |
| 安全①路径 | 绝对路径 / `..` / 逃逸 / 前缀兄弟目录 | ✅ |
| 安全②白名单 | 白名单外 → 报错；`E:\素材待用-x` 不算命中 | ✅ 段匹配 |
| 安全③④链接 | 目录联接越界 → `SYMLINK_REJECTED` | ⚠️ 文件符号链接那条**跳过** |
| 安全⑤只读 | 解析与指纹操作前后**库指纹不变** | ✅ |
| 取件语义 | 已配置目录 / auto 取包 / 已存在跳过 / 空间预检 / 部分成功三分 | ✅ 覆盖充分 |
| 错误信封 | 每个错误码都有用户文案**且不含绝对路径** | ✅ 这条很关键 |

### 2.3 唯一的跳过项（**已核实原因**）

| 跳过的测试 | 原始原因 | 性质 |
|---|---|---|
| `④ 指向库外的文件符号链接 → SYMLINK_REJECTED` | `本环境无法创建文件符号链接：EPERM: operation not permitted` | **环境限制**（Windows 需要特权/开发者模式），合理。目录联接（junction）能建，所以 ③ 那条会真跑 |

> ✅ **原先有 3 项跳过，D2 修复后只剩 1 项（2026-10-12）**。
> 另两项（`指纹 v1` 与 `uid: 整库唯一性`）当时跳过是因为**它们在测试里自己直读 `config.json`** 拿库根，
> 而那个文件早已随 Python 档退役删除 —— 也就是**测试在检一个生产已不再使用的主机制**。
> 现在它们改用**与生产同序**的解析（`packages/engine/tests/lib-root.mjs`：`GEMMA_LIB_ROOT` → `config.json` → **索引自举**），
> 于是**都真的跑起来了**：
> - `指纹 v1：与 baseline-v1.json 记录的值一致` —— JS 与 Python 的指纹**逐字节一致**（真实跑）
> - `uid: 整库唯一性` —— 扫过真实库全部图片，**0 处 UID 碰撞**
>
> ⚠️ **这不是"把测试改绿"**：库根来自索引元数据（生产的实际来源），**断言内容一个字没放松**。

### 2.4 覆盖面（缺口）

| 未覆盖 | 风险 |
|---|---|
| **IPC 分发层**（`apps/desktop/src/main/index.mjs` 的 `ipcMain.handle`） | 来源校验 / 载荷上限 / zod→引擎的接线顺序无测试。**新增的 3 个库配置方法也只有契约层校验测试**（`library-config.test.mjs` 测的是解析逻辑本身，不走 IPC） |
| **preload 暴露面** | 「只暴露 3 个成员、不暴露 `ipcRenderer`」无自动化断言（靠人看 28 行） |
| **`thumb://` 协议处理器** | 形状校验 / 库 id 大小写还原 / 尺寸白名单 / 缓存 —— **全部无测试** |
| **`encoder.mjs`** | 需要真模型；`tools/verify_encoder_path.mjs` 是替代，但要手动给模型目录 |
| **渲染层 hooks** | `useSearch` 的筛选/排序/错误分支由 L3 部分覆盖；`useLibraryConfig`（D2 新增）未单测 |
| **`resolveQueryImage` 的 `.bmp`** | 库内 20 个「文件名 `.jpg` 实际是 BMP」走解码回退，回退路径本身未单测（`verify_encoder_path.mjs` 的 2b 段覆盖了它，但那是守卫不是单测） |
| ~~`config.json` 缺失路径~~ | ✅ **已覆盖**：`apps/desktop/tests/library-config.test.mjs` 12 条专测「库从哪来」的四种来源、损坏注册表降级、无库时的行为 |

---

## 3. L2/L3/L4 命令清单（含「能/不能证明」）

| 命令 | 前置 | 能证明 | 不能证明 |
|---|---|---|---|
| `npm test` | — | §2 清单 | 见 §2.4 |
| `npm run build` | — | 三端能构建 | 构建产物能跑 |
| ~~`node tools/verify_app_build.mjs`~~ | ~~build~~ | ❌ **2026-10-13 移除**：产物形状合规 | 运行时行为 |
| ~~`node tools/verify_renderer_dom.mjs`~~ | ~~build~~ | ❌ **2026-10-13 移除**：React 在 jsdom 真跑 | CSS 生效、真实 IPC、真实窗口 |
| ~~`node tools/verify_renderer_styles.mjs`~~ | ~~—~~ | ❌ **2026-10-13 移除**：令牌纪律。取代它的是 `npm test` 里的样式断言（`apps/desktop/tests/styles.test.mjs`，2026-10-13 T3 已落地） | 视觉是否符合 Apple 规范（→ 宪章②）；"定义了却没人用"的令牌 |
| `node tools/verify_encoder_path.mjs --model <dir>` | 模型目录 | 真实推理路径一致性 | 全量索引质量 |
| ~~`node tools/verify-doc-refs.mjs`~~ | ~~—~~ | ❌ **2026-10-13 移除**：全仓引用解算 + 根目录越界 | 文档内容是否正确 |
| ~~`node tools/smoke_app.mjs`~~ | ~~build + Electron~~ | ❌ **2026-10-13 移除**：真启动构建产物并给判定（退出码 0/1/2/3/4 分级） | 打包后行为 |
| `node tools/check_search.mjs` | 已有查询向量 | 检索端到端自查 | 索引质量 |

### 3.1 ⚠️ 历史存档：原 `verify_renderer_dom.mjs` 的五组断言（**该守卫已于 2026-10-13 移除**）

1. **启动**：`indexStatus` 被调用；侧栏读到库根；指标卡显示真实条数与精度/设备
2. **文字检索**：参数正确（含「全部 = 四个目录」与单选某一类）
3. **以图搜图**：选文件后 `search` 带上 `queryImagePath`；未选时被拦下且**不发 IPC**
4. **结果卡**：缩略图走 `thumb://`、分类标签、分数、动作按钮接线与禁用规则
5. **事件**：`encoder.ready` → 指标卡出现设备名（webgpu）

> 第 4 条「缩略图走 `thumb://`」只断言**字符串形态**，不断言真能取到图 —— 与文件顶部自限一致。

### 3.2 ⚠️ 历史存档：原 `smoke_app.mjs` 的退出码分级（**该工具已于 2026-10-13 移除**）

| 退出码 | 含义 |
|---|---|
| 0 | 判定为「起来了」 |
| 1 | 产物缺失 |
| 2 | 主进程没跑到 JS |
| 3 | 跑到 JS 但没出窗 |
| 4 | 起来了但有报错 |

设计动机（原文）：Windows 上 Electron 是 GUI 子系统程序、**stdout 不连终端**，
所以「窗口没出来」与「主进程压根没启动」在终端上长得一模一样 —— 这条命令把两者区分开。

---

## 4. 质量门禁与验收门禁（两套，不要混）

### 4.1 索引质量门禁 G-B（**判据已不可复跑**）

| 项 | 阈值 | v1 实测 | v2 实测 | 判定 |
|---|---|---|---|---|
| 逐条余弦**最小值** | ≥ **0.700**（2026-10-10 由 0.970 下调） | 0.9153 | **0.967894** | v1 ❌ / v2 ✅ |
| 逐条余弦**中位数** | ≥ 0.990 | — | **0.999263** | ✅ |
| Top-10 平均重合率 | ≥ 80% | 0.740 | — | v1 ❌ |
| 30 项任一查询重合率 | ≥ 50% | — | — | — |

⚠️ **两件必须知道的事**：

1. **最小值门槛被下调过（0.970 → 0.700）**，且 `docs/spec/SPEC-acceptance.md` §2.2 自己写明了代价：
   > 「这条门槛从此几乎不再拦得住『尾部明显变差』的情况。质量信号改由中位数、Top-10 重合率与分位数观察项承担。」
   这是**如实登记的阈值放松**，不是隐藏的。
2. **判据已不可复跑**：`tools/quality/`（10 个 Python 判据脚本）随 Python 档退役被删
   （`docs/DEBT-CLEANUP.md` §十二）。⇒ `reports/G-B-*` 里的证据从此是**存档**，**不能独立重算**。
   `docs/README.md` 已如实声明。

### 4.2 阶段门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| G-A 基线复核 | ✅ 5/5 | `data/baseline-v1.json` |
| G-B v1 / v2 | ❌ FAIL / ✅ PASS | `reports/G-B-20261010/` · `reports/G-B-20261010-v2/` |
| G-C 契约冻结 | 已成文 | `docs/spec/CONTRACT-engine-v1.md` |
| G-D P2 应用实跑 | ✅ | `reports/G-D-p2-electron/` |
| **G-E 应用验收** | ❌ 未做 | 需 P3–P6 |

---

## 5. 可复现性

| 项 | 状态 |
|---|---|
| 单测 | ✅ 纯 Node，无外部依赖，任意机器可跑 |
| 构建守卫 | ✅ 同上 |
| 渲染层守卫 | ✅ 需 `jsdom`（已在 devDependencies） |
| 编码路径校验 | ⚠️ 需**模型目录**（本环境无） |
| 应用冒烟 | ⚠️ 需 Electron 二进制 + 可出窗环境（受限沙箱需 `--no-sandbox`） |
| **索引质量（G-B）** | ❌ **判据脚本已删，不可复跑** |
| 索引重建 | ⚠️ 需模型 + GPU；`packages/indexer/src/build_index_onnx.mjs` 是唯一构建器 |

---

## 6. 测试体系的**结构性问题**（结论）

| # | 问题 | 后果 |
|---|---|---|
| T1 | **单测只覆盖 `packages/engine/src/`**，传输层（主进程 IPC / preload / `thumb://`）**零单测** | 缺陷 I2（配置中断）与 I3（取件必失败）都发生在**接线层**，测试体系**结构上看不见** |
| T2 | **单测自注入端口 ⇒ 掩盖接线缺失** | `reveal` 单测注入 `shell`（`packages/engine/tests/engine.test.mjs`），而应用从不注入 ⇒ 测试绿、功能死（缺陷 I1） |
| T3 | **2/3 的跳过是测试自身死引用** | 跨语言指纹一致性从「被验证」退化为「永远不验证」 |
| T4 | **没有「配置缺失」路径的测试** | I2/R2 能长期存活 |
| T5 | **没有端到端应用验收**（G-E 未做） | 9 条成功标准中 0 条已完整验收 |
| T6 | **门禁不可复跑** | `reports/` 的证据是存档，违反「无归档证据 = 门禁未通过」精神（有证据但不可复算） |

> **T1 + T2 是本项目测试体系最值得投入的两处**：
> 前者导致接线缺陷不可见，后者导致接线缺陷**看起来像已通过**。

---

## 7. 本文未覆盖

- `packages/indexer/src/` 的 12 个探针脚本各自的验证目的（部分为一次性调查）
- `tools/probe_electron_start/` 的最小 Electron 探针（有独立 README）
- 逐条成功标准的性能实测（本环境无 GPU + 无模型）
- 边界性能：3594×768 暴力余弦的实测耗时（`search` 返回 `tookMs`，但无基准测试）

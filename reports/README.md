# 门禁证据（reports/）

> 项目规则：**无归档证据 = 门禁未通过**。
> 所以这个目录**要入库** —— `.gitignore` 只排除大体积重媒体（`*.png`/`*.jpg`/`*.mp4`），
> `md` / `json` / `csv` 都要提交。

> ## ⚠️ 状态：**已归档的证据 + 现行协议，但「复现方式」已失效**
>
> 状态：现行（协议）/ 历史（复现方式） · 最后核对：2026-10-12
>
> - **协议部分仍然有效**：命名规则、G-B 五件证据的构成、判据出处与阈值 —— 照旧。
> - **「复现一遍 G-B」一节已整体作废**：它写的每个命令**都不可执行**了，因为
>   ① 那批 Python 判据脚本（`quality_*.py` / `preflight_p05.py`）**已随 Python 档退役被删除**；
>   ② 代码路径已从 `onnx-spike/` 搬到 `packages/indexer/src/`（monorepo 重构，见 `docs/MIGRATION-PLAN.md`）；
>   ③ `TASK-PLAN.md` 已改名为 `docs/plan/ROADMAP.md`。
>   **⇒ `reports/G-B-20261010-v2/` 里的判定结论不能被独立重算**，只能作为**存档**引用
>   （`docs/README.md` 与 `AGENTS.md` §5.3 都写明了这一点）。
> - 要**重建索引**（不是复现旧判据）用现行构建器：`packages/indexer/src/build_index_onnx.mjs`，
>   用法见 [`../AGENTS.md`](../AGENTS.md) §3 与 [`../docs/plan/ROADMAP.md`](../docs/plan/ROADMAP.md)。

## 命名

```
reports/G-A-<日期>/      基线复核
reports/G-B-<日期>/      索引质量（P0.5 验收）
reports/G-C-<日期>/      规格与安全评审
reports/G-D-<日期>/      逐阶段验收
reports/G-E1-<日期>/     打包与离线验收
reports/G-E2-<日期>/     退役就绪（回滚已演练）
```
日期用 `YYYYMMDD`。

## G-B 的五件证据

| 文件 | 内容 | 原产出者（**已删除**） |
|---|---|---|
| `A-completeness.md` | 数量 / 维度 / 范数 / UID 唯一性 / `failed[]` 归因 | `quality_report.py` |
| `B-pairing.md` | 配对正确性 —— **独立按磁盘重算**，不采信索引自述 | `quality_report.py` |
| `C-quality.md` | ① 向量等价性 ② Top-10 重合率 ③ 相关性补充 + **已知标注缺口声明** | `quality_report.py` |
| `top10-diff.csv` | 逐名次对照（便于人工复核） | `quality_top10.py --out …/top10.json` |
| `human-review.md` | 阈值触发的人工复核清单（轻档）——**2026-10-10 起本轮不执行**（所有者决定；④ 非门槛） | `quality_report.py` |

另附 `VERDICT.txt`（自动判定结论）与两份原始 JSON（`vector-equiv.json` / `top10.json`）。

## 复现一遍 G-B —— ❌ **已作废，命令不可执行**

> **保留此节只为说明「为什么这批证据不可复算」**，不要照抄执行。
> 下列命令依赖的脚本与路径**都已不存在**；它们在退役前的原样如下：

```powershell
# ❌ 以下全部不可执行（脚本已删 / 路径已搬），仅作历史记录
# 0) 预检（Python 脚本已随 Python 档退役删除）
& ..\.venv\Scripts\python.exe preflight_p05.py --with-resume-test

# 1) 生成新索引 —— 构建器仍在，但路径已变（现为 packages/indexer/src/build_index_onnx.mjs）
node onnx-spike/build_index_onnx.mjs --model <ONNX 模型目录> --lib <素材库根> `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1

# 2) 三道判据 + 报告（quality_*.py 全部已删除 ⇒ 判据无法复跑）
& ..\.venv\Scripts\python.exe quality_vector_equiv.py --new-index data/idx-full --out "$d/vector-equiv.json"
& ..\.venv\Scripts\python.exe quality_top10.py --model <ONNX 模型目录> --new-index data/idx-full --out "$d/top10.json"
& ..\.venv\Scripts\python.exe quality_report.py --new-index data/idx-full

# 3) 人工复核后，在 docs/plan/ROADMAP.md §4 把 G-B 标 ✅（原写 TASK-PLAN §4，已改名）
```

**要重建索引**（不是复现旧判据）：用 `packages/indexer/src/build_index_onnx.mjs`，
并把 `--lib` 指向**你自己的**素材库根（**不要**在文档里写死 `G:\model` 这类本机路径 —— `AGENTS.md` §7 明令禁止）。

## 判据出处

阈值不在这里发明 —— 全部来自 `docs/spec/SPEC-acceptance.md`：

| 判据 | 阈值 |
|---|---|
| ① 逐条余弦最小值 | ≥ **0.700**（2026-10-10 起；原 0.970，见 `docs/spec/SPEC-acceptance.md` §2.2 变更记录） |
| ① 逐条余弦中位数 | ≥ **0.990** |
| ① 余弦 < 0.99 | 列出清单并逐条说明 |
| ② Top-10 平均重合率 | ≥ **80%** |
| ② 任一查询重合率 | ≥ **50%**（低于必须逐条说明） |
| ③ `self` 5 张 | Top-1 且余弦 ≥ 0.999（必须全中） |
| ③ `hard` 2 组 | 同内容的那份进 Top-3 |
| ③ `user` 3 张 | **不参与自动判定**（目标不可知），只在 ④ 目视复核 |

**禁止的措辞**：不得用「接近阈值」「旧索引也这样」解释未达标项；
不得用「bit-exact」当验收标准（用容差：min ≥0.700 / median ≥0.990）。

阈值不在这里发明 —— 全部来自 `docs/spec/SPEC-acceptance.md`：

| 判据 | 阈值 |
|---|---|
| ① 逐条余弦最小值 | ≥ **0.700**（2026-10-10 起；原 0.970，见 `docs/spec/SPEC-acceptance.md` §2.2 变更记录） |
| ① 逐条余弦中位数 | ≥ **0.990** |
| ① 余弦 < 0.99 | 列出清单并逐条说明 |
| ② Top-10 平均重合率 | ≥ **80%** |
| ② 任一查询重合率 | ≥ **50%**（低于必须逐条说明） |
| ③ `self` 5 张 | Top-1 且余弦 ≥ 0.999（必须全中） |
| ③ `hard` 2 组 | 同内容的那份进 Top-3 |
| ③ `user` 3 张 | **不参与自动判定**（目标不可知），只在 ④ 目视复核 |

**禁止的措辞**：不得用「接近阈值」「旧索引也这样」解释未达标项；
不得用「bit-exact」当验收标准（用容差：min ≥0.700 / median ≥0.990）。

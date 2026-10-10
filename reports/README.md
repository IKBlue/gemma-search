# 门禁证据（reports/）

> 项目规则：**无归档证据 = 门禁未通过**。
> 所以这个目录**要入库** —— `.gitignore` 只排除大体积重媒体（`*.png`/`*.jpg`/`*.mp4`），
> `md` / `json` / `csv` 都要提交。

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

| 文件 | 内容 | 产出者 |
|---|---|---|
| `A-completeness.md` | 数量 / 维度 / 范数 / UID 唯一性 / `failed[]` 归因 | `quality_report.py` |
| `B-pairing.md` | 配对正确性 —— **独立按磁盘重算**，不采信索引自述 | `quality_report.py` |
| `C-quality.md` | ① 向量等价性 ② Top-10 重合率 ③ 相关性补充 + **已知标注缺口声明** | `quality_report.py` |
| `top10-diff.csv` | 逐名次对照（便于人工复核） | `quality_top10.py --out …/top10.json` |
| `human-review.md` | 阈值触发的人工复核清单（轻档） | `quality_report.py` |

另附 `VERDICT.txt`（自动判定结论）与两份原始 JSON（`vector-equiv.json` / `top10.json`）。

## 复现一遍 G-B

```powershell
cd D:\USERS\Desktop\Agent\gemma-search

# 0) 预检必须全绿（含库指纹 == 基线）
& ..\.venv\Scripts\python.exe preflight_p05.py --with-resume-test

# 1) 生成新索引（约 25 分钟；可中断续跑）
$env:GEMMA_GPU_MODEL  = (nvidia-smi --query-gpu=name --format=csv,noheader | Select-Object -First 1).Trim()
$env:GEMMA_GPU_DRIVER = (nvidia-smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim()
node onnx-spike/build_index_onnx.mjs --model <ONNX 模型目录> --lib "G:\model" `
     --out data/idx-full --seq 140 --device webgpu --lib-id L1

# 2) 三道判据 + 报告（--out 指到报告目录，使证据自包含）
$d = "reports/G-B-$(Get-Date -Format yyyyMMdd)"
& ..\.venv\Scripts\python.exe quality_vector_equiv.py --new-index data/idx-full --out "$d/vector-equiv.json"
& ..\.venv\Scripts\python.exe quality_top10.py --model <ONNX 模型目录> --new-index data/idx-full --out "$d/top10.json"
& ..\.venv\Scripts\python.exe quality_report.py --new-index data/idx-full

# 3) 人工复核（轻档）后，才在 TASK-PLAN §4 把 G-B 标 ✅
```

## 判据出处

阈值不在这里发明 —— 全部来自 `SPEC-acceptance.md`：

| 判据 | 阈值 |
|---|---|
| ① 逐条余弦最小值 | ≥ **0.970** |
| ① 逐条余弦中位数 | ≥ **0.990** |
| ① 余弦 < 0.99 | 列出清单并逐条说明 |
| ② Top-10 平均重合率 | ≥ **80%** |
| ② 任一查询重合率 | ≥ **50%**（低于必须逐条说明） |
| ③ `self` 5 张 | Top-1 且余弦 ≥ 0.999（必须全中） |
| ③ `hard` 2 组 | 同内容的那份进 Top-3 |
| ③ `user` 3 张 | **不参与自动判定**（目标不可知），只在 ④ 目视复核 |

**禁止的措辞**：不得用「接近阈值」「旧索引也这样」解释未达标项；
不得用「bit-exact」当验收标准（用容差：min ≥0.970 / median ≥0.990）。

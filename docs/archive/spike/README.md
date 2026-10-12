# spike / 证据与探针（历史存档）

**这些文件不是运行应用所需要的。** 它们是"后端路线该怎么选"这个决策的**证据**，
以及当时用的一次性探针。保留的理由是：结论以后会被质疑，届时必须能复现。

## 结论（这些文件支撑的判断）

**Node + ONNX + WebGPU 胜出**，取代原先的 Python + torch/CUDA：

| 指标 | torch（CUDA/Python） | ONNX CPU | **ONNX WebGPU** |
|---|---|---|---|
| 模型载入 | 3.70 s | 2.11 s | 2.57 s |
| 图像 seq140 | 0.16 s/张 | 1.32 s/张 | **0.42 s/张** |
| 图像 seq280 | 0.34 s/张 | 3.42 s/张 | 0.80 s/张 |
| 文本 | ~50 ms | ~36 ms | **~21 ms** |
| 向量 vs torch（文本） | 基准 | **1.000000** | 1.000000（**bit-exact**） |
| 向量 vs torch（图像） | 基准 | 中位 0.9957 | 与 CPU **逐位一致** |

排除的两条路（都有实测报错原文，见 `probes\probe_nonpython_runtime.py` 的输出记录）：
- **DirectML**：`Reshape node_view_1 … DmlExecutionProvider … E_INVALIDARG`（结构性，与精度无关）
- **CUDA**：`Unsupported device: "cuda". Should be one of: dml, webgpu, cpu`

## 文件说明

| 文件 | 是什么 |
|---|---|
| `ref140.json` / `ref280.json` | **基准**：torch 在 seq140 / seq280 下对 20 张库内图的向量 |
| `onnx140.json` / `onnx280.json` | ONNX **CPU** 在两个 seq 下的向量 |
| `onnx140_gpu.json` / `onnx280_gpu.json` | ONNX **WebGPU** 在两个 seq 下的向量（用于证明与 CPU 一致） |
| `onnx_mini.json` / `sel_mini.json` | 早期小样本试跑 |
| `spike_torch.py` | 产出 `ref*.json`（torch 侧） |
| `spike_compare.py` | 逐项比对、算余弦、出结论表 |
| `spike_selection.json` | 当年选中的 20 张图的清单（保证可比复现） |
| `probes/` | 7 个一次性探针（见下） |

### `probes/` 里的探针

| 脚本 | 回答的问题 |
|---|---|
| `probe_encode.py` | 图像调用形态（processor 参数怎么传才对） |
| `probe_speed.py` | CPU 下不同 seq 档位的速度 |
| `probe_gpu.py` | 本机 GPU 与 CUDA 轮子是否可用 |
| `probe_gpu_speed.py` | GPU 精度对照 + 同进程 CPU/GPU 向量一致性 |
| `probe_nonpython_runtime.py` | 非 Python 运行时（transformers.js / onnxruntime-node）可行性 |
| `probe_onnx_sizes.py` | 各精度档的 ONNX 体积（q4f16 / fp16 / fp32） |
| `probe_identity_facts.py` | 库的身份事实（配对、重复内容、包体积）→ 支撑 `SPEC-identity` |

## ⚠️ 分在两处的原因

ONNX 侧的脚本在 **`..\onnx-spike\`**（`spike_onnx.mjs`、`spike_device.mjs`、`build_index_onnx.mjs`），
**不要移动它们**：Node 按目录向上查找 `node_modules`，移出 `onnx-spike\` 就会找不到依赖而失效。

其中 **`build_index_onnx.mjs` 不是历史存档，是未来资产** —— 它是应用索引器的原型，
已实测跑通 100 张（0 失败、2.41 条/秒）。P1 会把它重写为 `core/engine` 的一部分。

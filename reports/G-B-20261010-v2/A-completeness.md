# A · 编码完整性

| 检查 | 结果 | 详情 |
|---|---|---|
| 条目数 == 期望值 3594 | ✅ | 3594 vs 3594 |
| dim == 768 | ✅ | 768 |
| 所有行范数 ∈ [0.99,1.01] | ✅ | 1.000000 ~ 1.000000 |
| UID 无重复 | ✅ | 无 |
| failed[] 为空或每条有归因 | ✅ | 0 条失败 |
| vectorRow 连续且无越界 | ✅ | max=3593 |

- 索引条目：**3594**
- 维度：**768**
- compat：`onnx-community/embeddinggemma-2-ONNX|daa72c51243991dfcaf9f9137d2c573d8f7790c0|fp32|2|140|768|l2|mean_soft_tokens`

## 失败项归因

- `failed[]` 为空：**0 条失败**

## 环境记录

- 模型 repo/revision/权重：`onnx-community/embeddinggemma-2-ONNX` / `daa72c51243991dfcaf9f9137d2c573d8f7790c0` / `fp32`
- 预处理实测：`{"image_seq_length": 140, "max_soft_tokens": 140, "config_image_seq_length": 140, "patch_size": 16, "pooling_kernel_size": 3, "resample": 3, "rescale": 0.00392156862745098, "do_normalize": false, "do_convert_rgb": true, "color": "RGB", "resample_impl": "resize_compat(pil-like)"}`
- 运行时：`{"transformers.js": "4.3.1", "onnxruntime-node": "1.30.0", "device": "webgpu", "ort_provider": "webgpu", "gpu_model": "NVIDIA GeForce RTX 2060", "gpu_driver": "591.44", "gpu_source": "env"}`
- 库指纹（见 `data/quality/env-v1.json`）
- 本报告由 `quality_report.py` 生成；原始数据见 `data/quality/*.json`

# 证据 · 编码路径基线（T-00 第一段）

> 日期：2026-10-14 · 类型：**本轮实测** · 工具：`tools/verify_encoder_path.mjs`（现存 2 个只读守卫之一）

## 命令（原始输出见同目录 `encoder-path-guard.txt`）

```powershell
node tools/verify_encoder_path.mjs \
  --model model-cache/onnx/embeddinggemma-2/daa72c51243991dfcaf9f9137d2c573d8f7790c0/fp32 \
  --lib G:\model
```

（索引取工具默认值 `data/idx-full-v2`）

## 结果：**PASS · EXIT=0**

| 断言 | 实测 |
|---|---|
| 编码器初始化 | ✅ device=**webgpu** · 载入 **2.5 s** · dtype=fp32 · seq=140 |
| 重采样兼容层 | ✅ 已安装并自检通过（kernel=**pil-like**） |
| 索引↔查询一致性（native 图） | ✅ `VR\ID-15602395.jpg` **cos = 1.000000** |
| 索引↔查询一致性（BMP 回退图） | ✅ `VR\ID-12089794.jpg` **cos = 1.000000** · src=bmp-fallback |
| BMP 回退向量维度 | ✅ 768 vs 768 |
| 文本向量 | ✅ L2 归一 ‖v‖=1.000000 · dim 768 |
| 分数有区分度 | ✅ Top-1 0.7855 > 第 11 名 0.7734 |
| 索引 compat | `onnx-community/embeddinggemma-2-ONNX|daa72c5…|fp32|2|140|768|l2|mean_soft_tokens` · 3594 条 · dim 768 |

## 文本查询基线（「北欧吊灯」Top-5）

| # | 分数 | 条目 |
|---|---|---|
| 1 | 0.7855 | CR\ID-633419997.jpg |
| 2 | 0.7852 | VR\ID-15588806.jpg |
| 3 | 0.7836 | VR\ID-723604.jpeg |
| 4 | 0.7756 | VR\ID-115822915.jpg |
| 5 | 0.7751 | VR\ID-1112089406.jpg |

## 模型位置（本机事实）

```
model-cache/onnx/embeddinggemma-2/daa72c51243991dfcaf9f9137d2c573d8f7790c0/fp32/
├── config.json · preprocessor_config.json · processor_config.json · tokenizer.json(30.68 MB)
└── onnx/  model.onnx(0.40 MB) · model.onnx_data(1033.95 MB)
          vision_encoder.onnx(0.12 MB) · vision_encoder.onnx_data(639.94 MB)
```

与索引 `meta.json` 记录的 `model_revision` 与 4 个 `model_files` **完全对上**。

## 这证明了什么 / 没证明什么

- ✅ 证明：这台机器上「应用编码器 → 与索引同一预处理 → 同一条目向量逐位一致（cos=1.0）」，文本塔与 BMP 回退都活着。
- ❌ 未证明：Electron 内（渲染进程 / asar / GPU 设备）可跑；全库 min/中位余弦（本段只核了 2 条 + 1 条文本查询）。
- ⚠️ 因此 **T-00 只完成了第一段**：还需要「抽样 N 张图重新编码 + 比对」与「若干查询 top10 对照」才能当护栏用。


---

# 第二段 · 抽样重编码基线（T-00 完整版）

> 2026-10-14 · 脚本：`data/_encoder-baseline.mjs`（一次性脚本，放在 gitignore 的 scratch 目录，**不新增守卫**）
> 索引用的是**已接受的那一份** `data/libraries/L1`（3594 × 768）。

## 命令

`~powershell
node data/_encoder-baseline.mjs "<模型目录>" "G:\model"
`~

## 结果：**EXIT=0**

| 断言 | 实测 |
|---|---|
| 索引读取 | 3594 条 · dim 768 · 条目表 3594（五道校验全过） |
| 图像重编码样本 | **47 条**（28 条等距抽样 + **全部 20 条 BMP 回退**） |
| **余弦一致性** | **min / 中位 / max = 1.000000 / 1.000000 / 1.000000** |
| 模型载入 | 2.4 s · device=webgpu · kernel=pil-like |

⇒ **重建后的索引与现役索引在这 47 条上完全一致**，且 BMP 回退那条路径也被覆盖。

## 文本查询基线（Top-3，完整 Top-10 见 `baseline.json`）

| 查询 | 1 | 2 | 3 |
|---|---|---|---|
| 北欧吊灯 | 0.7855 CR\ID-633419997.jpg | 0.7852 VR\ID-15588806.jpg | 0.7836 VR\ID-723604.jpeg |
| 线性灯 安装 | 0.7650 VR\ID-670523.jpeg | 0.7595 CR\ID-113989370.jpg | 0.7566 VR\ID-2579409.jpg |
| 现代客厅 落地灯 | 0.7882 CR\ID-15587404.jpg | 0.7784 其他\ID-15224609.jpg | 0.7756 VR\ID-343911.jpg |

## 这两段合起来意味着什么

- ✅ **T-00 完成**：现在有了一份可复现的基线，**任何改动编码/重采样/索引路径的提交都必须重跑它并附对比**。
- ✅ 覆盖：native 图 · BMP 回退图 · 文本塔 · L2 归一 · 与索引的逐位一致 · 三条真实中文查询的排序。
- ❌ 仍未覆盖：**Electron 内**（渲染进程 / asar / GPU 设备）的运行；换机器/换显卡后的表现。

# SPEC: 身份、配对、指纹与索引元数据

> 回应审核 P0-2 与 P0-3。**其中 P0-3 是我文档里的真矛盾，本规范予以消除。**

---

## 0. 结论先讲：UID 只由图像内容决定是错的

原设计：`uid = sha1(图像字节)`。审核指出"相同图像字节不代表同一条素材"。

**这不是假设——本库实测就存在 5 组内容完全相同的预览图，而它们是不同的素材：**

| 内容哈希 | 出现在 |
|---|---|
| `c033d21552…` | `CR\ID-689938.jpeg` · `VR\ID-461212.jpeg` |
| `9b49a25a17…` | `CR+VR\ID-15515142.jpg` · `VR\ID-502271891.jpg` |
| `58d5e2f08a…` | `VR\ID-1141703070.jpg` · `VR\ID-14257437.jpg`（**同一目录**） |
| `b8aa997f17…` | `VR\ID-125229472.jpg` · `其他\125229472.jpg` |
| `b25cf04979…` | `VR\ID-13047663.jpeg` · `VR\ID-1411886.jpg` |

**若用内容哈希作 UID，这 5 组会直接撞成一条，丢掉 5 条素材。**

而它们多半是**同款素材的 VR / CR 双版本**（正是本库的目录约定）——**应当被识别为"相关"，而不是被合并**。

---

## 1. 三种身份必须分开

| 名称 | 是什么 | 用途 | 是否可变 |
|---|---|---|---|
| **`uid`** | **素材实体**的逻辑身份（一条配对记录） | 索引主键、审计与撤销的引用、跨库移动 | **永不变**（首次登记后冻结） |
| **文件身份** | 每个物理文件：`rel_path + size + mtime + sha1` | 检测外部改名/替换/丢失；判断能否复用向量 | 随文件变化 |
| **内容哈希** | 图像 `sha1`；压缩包 `sha1`（**按需**计算） | 查重、疑似移动识别、深度校验 | 内容变才变 |

---

## 2. UID 的生成与冻结

**种子**（仅在"首次登记"或"从零重建"时算一次）：

```
uid = sha1( lib_id + "|" + rel_dir + "|" + stem ).slice(0, 12)
```

- 用 `(目录, 主干)` 作种子：库里这两者唯一 → **不可能碰撞**（内容重复也不影响）
- 含 `lib_id` → 不同库即使目录结构相同也不会撞
- **算完即持久化到 `items.json`，此后永不重算** → 改名、改目录、换库都不变（这正是 UID 存在的意义）
- 种子依赖路径**是可以接受的**：它只是"首次登记那一刻的种子"，不是身份的持续定义
- 若将来导入外部索引导致 `uid` 与本地既有冲突 → 冲突方加 `-2`/`-3` 后缀并记审计，**绝不静默覆盖**

> 为什么不直接用 `(目录,主干)` 当主键：那样改名就等于换了身份，历史、备注、审计全断。
> UID 的价值就在"改名后仍是同一条素材"。

---

## 3. 配对规则（含实测依据）

### 3.1 规范情形（本库实测 3594:3594 完全 1:1）

- **同目录 + 同主干** 配对，**不跨目录**
- 图扩展名 `.jpg/.jpeg/.png`（实测 2644 / 742 / 208）
- 包扩展名 `.rar/.zip/.7z`（实测 2329 / 1189 / 76）
  > ⚠️ 曾漏 `.7z` 导致 76 条被误判"图无包"。**扩展名集合必须是两侧共享的常量。**

### 3.2 防御性规则（今天 0 处，但必须写明，否则将来默默丢数据）

| 情形 | 规则 |
|---|---|
| 同主干**多个包**（实测 0） | **全部记入 `archives[]`**，按 `.rar > .zip > .7z` 选 `primary`；健康面板标「多包」，**不静默丢** |
| 同主干**多张图**（实测 0） | **全部记入 `images[]`**，按 `.jpg > .jpeg > .png` 选 `primary`；其余列为附加预览图，标「多图」 |
| **内容重复**（实测 5 组） | **不合并**。建立「疑似同款」关系（同内容哈希），在界面上互相提示，由人决定是否处理 |
| 同名主干跨目录 | **允许**（本库即有多例）。「按 ID 精确查」必须**列出全部命中并标明目录**，不取其一 |
| 图无包 / 包无图 | 都允许存在，进健康面板；**不删、不补** |

### 3.3 配对是"记录"而不是"猜测"

配对结果**写入 `items.json` 并作为事实**；扫描只做**差分**（新增/消失/变化），
**不重新猜配对**。这样即使将来规则调整，也不会让既有素材悄悄换配对。

---

## 4. 索引与磁盘的一致性

每个条目除路径外，还记录文件身份：

```jsonc
{
  "uid": "9f3c1a2b4d5e",
  "images":  [{ "relPath": "...", "ext": ".jpg", "size": 41233, "mtime": 1760000000000, "sha1": "…", "primary": true }],
  "archives":[{ "relPath": "...", "ext": ".rar", "size": 8911028, "mtime": 1760000000000, "sha1": null, "primary": true }],
  "vectorRow": 1234,
  "fileState": "ok"          // ok | changed | missing | suspected-move
}
```

**加载/扫描时的判定**：

| 磁盘情况 | 判定 | 动作 |
|---|---|---|
| 路径在、size+mtime 与记录一致 | `ok` | 复用向量 |
| size 或 mtime 变了 | `changed` | 标「待重编码」；**在用户确认或增量提交前，检索仍用旧向量**并提示该条可能过时 |
| 路径不在 | `missing` | 标「消失」；**只从索引移除，绝不删任何东西** |
| 路径不在，但**别的路径出现同 `sha1` 的图** | `suspected-move` | 增量视图显示「疑似移动（内容相同）」+ 一键「确认重链接」；**确认后复用原向量**，绝不静默改路径 |
| 同一 uid 的图与包一个在、一个不在 | `partial` | 健康面板「半条素材」；不自动修 |

> **绝不静默使用旧向量**：以上任何非 `ok` 状态都会进入「增量」视图，由人确认。

### 4.1 `vector_source`：编码用的图不一定是库里那张图

**为什么需要这个字段**（实测发现，见 `data/quality/mismatch-test-result.json`）：

本库有 **20 张扩展名 `.jpg` 实际是 24 位 BI_RGB BMP** 的预览图。
**旧 Python 管线（PIL）能解码，新 Node 管线不能**：
transformers.js 的 `RawImage` **不支持 BMP**，且本机 `sharp`/libvips **没有 BMP 加载器**
（`Input file contains unsupported image format`）。其余 85 张不符文件（`png→jpeg` 68、`jpg→png` 17）**原生解码全部通过**。

若不处理：**A 项"数量 = 3594"只能得到 3574**，且这 20 张永远搜不到。

**因此索引条目必须区分两个路径**：

| 字段 | 含义 | 用途 |
|---|---|---|
| `images[].relPath` | **库里那张图** | 显示、定位、取件、外部变更检测 |
| `images[].vectorSource` | **实际被编码的那份数据** | 仅用于重建向量；**可以不是库内文件** |

规则：

- `vectorSource` **缺省等于** `relPath`（绝大多数条目如此）
- 当原生解码失败时，允许存在一份**派生副本**（如 PIL 转出的 PNG），存放在**应用数据目录**
  （`%APPDATA%\gemma-search\derived\<lib_id>\<uid>.png`），**绝不写进素材库**
- 派生副本必须记录 `derivedFrom`（源文件 sha1）+ `derivedBy`（转换工具与版本），
  源文件变化时**派生副本必须失效并重转**
- 派生副本**不参与**库指纹（它在库外），但参与索引一致性检查

> **方案选择（已定：A）** —— 决策 1：**给 Node 管线加纯 JS BMP 解码器**（`bmp-js@0.1.0`，约 10 KB，无原生依赖），
> **保持「索引 ↔ 库」一一对应**（不引入派生副本）；`vectorSource` 仍写进格式，作为将来兜底。
>
> **实测结论（`data/quality/mismatch-test-result.json`）**：
> 105 张不符文件 → **105 可编码 · 0 失败**（85 原生 + **20 走 BMP 回退**）。
> 修复前是 85/105，A 项只能拿到 3574。
>
> ⚠️ **一个必须写下来的坑**：`bmp-js` 的 `decode()` 输出**既不是文档假设的 RGBA，也不是 BGRA**。
> 暴力枚举 12 种解释后，**唯一与 PIL 逐像素一致**的是：
>
> ```
> 每像素 4 字节，取 [1][2][3] 三个字节解释为 B, G, R；行序自上而下（不翻转）
> 即  R = data[4i+3] · G = data[4i+2] · B = data[4i+1]
> ```
>
> **若按 RGBA/BGRA 直接用，20 张图的向量会全部是错的、且不报任何错。**
> 因此代码里不"相信"布局，而是**用合成 BMP 自检把布局钉死**
> （自造像素值已知的 24 位 BMP，解码后断言一致）；`bmp-js` 升级后行为若变，
> **自检会大声失败**而不是静默算错向量。构建器启动时**必须**先过这个自检。
>
> 只支持**已验证的** 24 位 `BI_RGB`；遇到 32 位/压缩/RLE 的 BMP **明确报错**，不予猜测。

---

## 5. 库指纹（定义补全）

原总览只说"文件数 + 抽样 mtime"，**不足**。定义如下：

```
fingerprint_v1 = sha1(
    "v1\n" +
    join("\n", sorted(
        f"{rel_path}\t{size}\t{mtime_ms}\t{ext}"   for 每个文件（图与包）
    ))
)
```

| 项 | 规定 |
|---|---|
| 输入字段 | `rel_path`（相对库根，**统一小写盘符与 `\` 分隔**）、`size`、`mtime_ms`、`ext` |
| 排序 | 按 `rel_path` 字节序升序（保证确定性） |
| 版本 | 算法带 `v1` 前缀；**算法一改就升版**，旧版指纹不参与比较 |
| 随附信息 | `count_files`、`count_images`、`count_archives`、`total_bytes`、`computed_at` |
| 计算时机 | ① 每次扫描前后各算一次（比对，检测意外写入）② 库注册/重新指向时 ③ 入库事务成功后更新 |
| **深度校验** | 另一档 `deep` = 对**预览图**逐个算 sha1（3594 张小文件，实测约 3 秒）；**不含压缩包**（206 GB，约 23.5 分钟，只在用户显式要求时做） |

### ⚠️ 指纹的边界（审核强调，我完全同意）

> **指纹不是备份。** 它能检测"变了"，**不能恢复**"被删了"。
> 重要素材需要**独立备份**——这不是本应用能替代的职责，界面里要把这句话写明，避免给出虚假的安全感。

---

## 6. ⚠️ 索引元数据：拆开那个含混的 `precision`（消除 P0-3 矛盾）

### 6.1 原文档的矛盾

三处说法互相冲突：决策写 `fp32`、技术栈写"默认下载 **q4f16**"、一致性校验写按 `precision` 比较。
根因是**一个词混指了两件不同的事**：

| 概念 | 含义 | 影响 |
|---|---|---|
| **权重精度** `model_weights_dtype` | 加载哪一套 ONNX 权重（fp32 / fp16 / q4f16） | **直接改变向量** → 与索引必须一致 |
| **向量存储精度** `embedding_dtype` | 索引里 float32 还是别的 | 影响存储与数值，**与权重精度无关** |

**两者绝不是一回事**：即使向量都存 float32，权重用不同量化也会产出不同检索结果。

### 6.2 新字段（取代含混的 `precision`）

```jsonc
{
  "format_version": 1,                    // index.bin 布局版本
  "compat_key_version": 1,                // 兼容性判定规则的版本

  "model_repo": "onnx-community/embeddinggemma-2-ONNX",
  "model_revision": "daa72c51243991dfcaf9f9137d2c573d8f7790c0",   // 钉住的 commit
  "model_weights_dtype": "fp32",          // ← 权重精度（决定向量）
  "model_files": ["onnx/model.onnx", "onnx/model.onnx_data",
                  "onnx/vision_encoder.onnx", "onnx/vision_encoder.onnx_data"],
  "audio_disabled": true,                 // config.audio_config = null

  "preprocessing_version": 1,             // 我方预处理配置的版本号（改动即升版）
  "preprocessing": { "image_seq_length": 140, "resample": 3, "rescale": 0.00392156862745098,
                     "do_normalize": false, "patch_size": 16, "pooling_kernel_size": 3,
                     "color": "RGB" },

  "seq_length": 140,
  "dim": 768,
  "embedding_dtype": "float32",           // ← 向量存储精度
  "normalization": "l2",
  "pooling": "mean_soft_tokens",          // 由 ONNX 图内 sentence_embedding 输出

  "query_prefix": "task: search result | query: ",
  "document_prefix": "title: none | text: ",

  "runtime": { "transformers.js": "4.3.1", "onnxruntime-node": "1.30.0",
               "device": "webgpu",                    // 诊断用，**不参与 compat**
               "gpu_model": "NVIDIA GeForce RTX 2060", "gpu_driver": "591.44",
               "ort_provider": "webgpu" },
  "built_at": "…", "count": 3594, "lib_id": "L1", "lib_root": "G:\\model"
}
```

### 6.3 兼容性判定键（跨库 / 复用旧向量的唯一依据）

```
compat = ( model_repo, model_revision, model_weights_dtype,
           preprocessing_version, seq_length, dim, normalization, pooling )
```

| 场景 | 规则 |
|---|---|
| 跨库合并检索 | `compat` 全等才合并；否则**标灰 + 写明哪一项不同** |
| 跨库移动素材 | `compat` 全等才**随迁向量**；否则目标库需重编码该条 |
| 加载索引 | `compat` 与本机当前配置不符 → **拒绝检索**并提示重建（**不降级、不猜测**） |
| `device`（webgpu/cpu） | **必须不参与** `compat`。两条理由：① 实测两者向量小数第 6 位相同，可互换；② **若把执行后端写进 `compat`，CPU 回退的那一刻就会被自己拒绝检索** —— 这是审查指出的矛盾点，务必不要写进去 |
| `ort_provider` / `gpu_model` / `gpu_driver` | **不参与** `compat`，**只记录**。用途：将来向量出现差异时能回答"是不是换了 ORT 版本/驱动" |

> ⚠️ **不要把"逐位一致 / bit-exact"写成验收标准。**
> 跨 GPU/CPU、跨 ORT 版本的 fp32 逐位相等**本来就难保证**；写成逐位相等会导致
> **升级 ORT 或驱动就误报失败**。正确做法是**实测容差**：
> 本机实测中位余弦 **0.9929**、最小 **0.9798** → 验收用 **≥0.970**（`SPEC-acceptance.md` §2.2）。
> "文本塔 bit-exact"这句话只作为**当时那次实测的结论**，不作为长期判据。
| `embedding_dtype` | 参与存储布局校验，但**不参与** `compat`（同权重同预处理下不影响语义） |

### 6.4 正式构建器**实际加载的是什么**（明确回答审核的疑问）

当前 `build_index_onnx.mjs` 实际加载：

| 项 | 值 |
|---|---|
| 权重 | **`fp32`**：`onnx/model.onnx`(+`_data`) + `onnx/vision_encoder.onnx`(+`_data`) |
| transformers.js `dtype` | `'fp32'` |
| 向量存储 | `float32` |
| 预处理 | `image_seq_length = 140`（`processor.image_seq_length` 与 `image_processor.max_soft_tokens` 同时设置） |
| 模型 revision | `daa72c51243991dfcaf9f9137d2c573d8f7790c0` |
| 设备 | `webgpu`（回落 `cpu`） |

**因此本次全量重建 = 权重 fp32 + 预处理 v1 + seq140 + 向量 float32。**

> **`q4f16` 是"将来应用可选的下载档"，不是当前构建设置。**
> 选它 **必须重建索引**（向量会变）——原文档把这两件事写在一处，是造成矛盾的根源。已分开表述。

---

## 7. index.bin 格式（补全校验与损坏恢复）

```
偏移                内容
0                   MAGIC（**恰好 8 字节**）：hex 47 53 49 44 58 00 00 01（字面量 "GSIDX" + 0x00 0x00 0x01）
MAGIC.length (=8)   u32 LE headerLen
MAGIC.length+4 (=12) headerJSON（utf8，含 §6.2 全部字段）
之后                float32 块（count × dim，行主序）
末尾                 FOOTER: u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete: true }
```

> ⚠️ **踩过的坑（真实产品 bug，已修）**：MAGIC 最初写成 `Buffer.from('GSIDX\x00\x01','latin1')` ——
> 那是 **7** 字节，而读端用 `subarray(0,8).equals(MAGIC)` 比较、并按 8/12 取偏移。
> 后果：**比较永远 false → `readIndexBin` 永远返回 null → "可续跑"从未真正生效**（而文档里写着它可用）。
> 修法不是把 8 改成 7 了事，而是：
> **① MAGIC 用显式 hex 定义并在启动时断言长度 = 8；② 读写两端的偏移一律写成 `MAGIC.length` 的表达式；**
> **③ 增加"写→读→断言一致"的往返自检，并额外断言"截断文件必须被拒绝"。**
> 这三条一起，才能让同类错误不再静默复发（与 `bmp_decode.mjs` 的布局自检同一思路）。

| 校验 | 时机 | 失败处理 |
|---|---|---|
| MAGIC 匹配 | 每次加载 | 视为损坏 |
| `headerLen` 与文件长度自洽 | 每次加载 | 视为损坏 |
| `count × dim × 4 + 偏移 == 向量块长度` | 每次加载 | 视为损坏 |
| `footer.complete === true` | 每次加载 | **视为写入未完成** → 不加载 |
| `sha1(vector_block)` 与 footer 一致 | 每次加载（11 MB，约 20 ms） | 视为损坏 |
| 每行范数 ∈ [0.99, 1.01] | 加载后抽查 | 越界即报，拒绝检索 |

**损坏后的恢复路径**：不存在"修复"，只有**重建**。
- `items.json` 与 `meta.json` 若仍可读 → 保留 uid 与元数据，**只重算向量**（比全量重建快得多时才有意义）
- 否则 → 全量重建
- 无论哪种，**都不删除损坏文件**，改名为 `index.bin.corrupt-<时间>` 留证

**写入方式**：`index.bin.tmp` → `fsync` → 校验自身 → `rename` 覆盖。
配合 footer 的 `complete` 标记，**任何时刻断电都不会让半个文件被当成好的**。

---

## 8. 跨库迁移的前置条件

移动素材到另一个库，**必须**逐项核对：

1. `compat` 全等（§6.3）→ 否则目标库需重编码该条
2. 目标库**已注册且已建索引**（否则先建）
3. 目标库的 `uid` 空间内无冲突（按 §2 规则处理）
4. 目标库所在卷**空间充足**（按 SPEC-transactions §6）
5. 迁移走**跨卷事务流程**（staging 落在目标卷），并在两个库各写一条审计

**迁移后**：源库条目 `missing`（文件已不在）→ 增量视图提示；目标库新增条目复用同一 `uid` 与原向量。

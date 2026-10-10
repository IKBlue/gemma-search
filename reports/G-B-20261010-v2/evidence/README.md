# G-B v2 的证据副本（2026-10-10）

> ## ⚠️ 2026-10-10 修复记录（结构审查发现，务必先读）
>
> 本目录原先的 `cos-all.csv` / `below-0.99.csv` **是从 `data/diag/` 复制来的 v1（修前）数据**，
> 不是 v2 判定所依据的数据 —— 而下表当时把它写成「本次判定的核心证据」。
>
> **后果**：任何按本 README 复现的人，会算出 **min 0.915311 / <0.97 = 135 / <0.99 = 1615**，
> 也就是 **G-B v1 的 FAIL 结论**，与本目录外层的 v2 **PASS**（min 0.967894）直接矛盾。
> 「验收通过」的证据包里装着「验收失败」的数据 —— 这是**证据链断裂**，不是笔误。
>
> **根因**：v1 与 v2 两次判定的中间物都落在 `data/diag/`，v2 复制时没有核对来源。
>
> **已修复**：两份 csv 改从 `data/quality/cos-all-v2.csv` / `data/quality/below-0.99.csv`
> 复制（这两份**已入库**，SHA256 可校验）。现本目录复算结果：
> `n=3594 · min=0.967894 · median=0.999264 · <0.97=3 · <0.99=155` —— 与 `VERDICT.txt` 一致。
>
> **v1 数据未丢失**，仍在 `data/diag/cos-all.csv`（`DIAGNOSIS-resample.md` 引用的正是它）。
> 引用 v1 时**必须显式标注「v1 / 修前」**，不得再简称「核心证据」。

这里是从 `data/diag/` **另存**过来的小体积证据（~800 KB，csv/json），
因为 `data/diag/` 整体被 `.gitignore` 忽略（78 MB：44 MB `.raw` 像素转储 + 31 MB 库图片副本
+ 小批量试点索引，全是可重跑生成的中间物）。

> ⚠️ **复制来源必须逐个核对版本**：`data/diag/` 同时存在 v1 与 v2 的中间物，
> 按文件名盲抄就会把 FAIL 的数据抄进 PASS 的报告里（本项目真发生过，见上方修复记录）。
> 优先从 `data/quality/`（已入库、带 `-v2` 后缀）取；从 `data/diag/` 取时必须确认版本。

| 文件 | 是什么 | 版本 | 谁引用 |
|---|---|---|---|
| `cos-all.csv` | **全部 3594 条的逐条余弦**（新索引 vs torch 旧索引）—— 本次判定的核心证据。来源 `data/quality/cos-all-v2.csv` | **v2（修后）** | `tools/verify_resize.py` 默认 `--cos-csv`、`tools/quality/quality_tail_attrib.py`、`DIAGNOSIS-resample.md` |
| `below-0.99.csv` | 低于 0.99 的清单（v2 修后 **155** 条）。来源 `data/quality/below-0.99.csv` | **v2（修后）** | `DIAGNOSIS-resample.md` |
| `data/diag/cos-all.csv`（不在本目录） | v1 修前的同一量（min 0.915311 · <0.99 = **1615** 条） | **v1（修前）** | `DIAGNOSIS-resample.md` 的「修前 vs 修后」对照 |
| `tail-attrib.json` | 尾部（最差那批）归因：尺寸分布、降采样倍率 | 同上 |
| `resize-golden*.json` / `resize-golden-manifest.json` | 跨语言重采样金标（Python PIL vs Node 两条路径的像素差 / 余弦 / 灵敏度） | `tools/verify_resize.py`、`tools/verify_syntax.py` 管不到的那类"数值断言" |
| `resize-variants.json` / `resize-sample.json` | 各重采样核的对照与样本 | `DIAGNOSIS-resample.md` |
| `anchor.json` | 锚点核对（新索引 vs 决策时那 20 张的基准） | `tools/quality/quality_anchor.py` |
| `image-dims.json` | 全库图像尺寸（尾部全是 2 MP 级大图，这是根因线索之一） | `DIAGNOSIS-resample.md` |
| `vector-equiv-full.json` | 与旧索引的全量等价性判定结果 | `tools/quality/quality_vector_equiv.py` |
| `fixture-eval-*.json` | 夹具库快评（smallest / worst 两组） | `tools/quality/quality_fixture_eval.py` |

**没搬过来的**：`*.raw`（像素转储）、`lib-worst-48/`（库图片副本）、`idx-*/`（小批量试点索引）、
`resize-golden/*.raw` —— 它们要么可从库里重取，要么重跑一次探针就能再生；
真要复现，命令写在 `DIAGNOSIS-resample.md` 里。

**注意**：`data/diag/` 里的原件仍在（未删），所以文档里 `data/diag/cos-all.csv` 这类路径
在**本机仍然有效**；这里的副本是为了让"克隆仓库的人也能看到证据"。

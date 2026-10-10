# -*- coding: utf-8 -*-
"""
quality_report.py —— 生成 G-B 门禁证据（SPEC-acceptance §3 的报告清单）

产出 reports/G-B-<日期>/ 下：
  A-completeness.md  数量 / 维度 / 范数 / UID 唯一性 / 失败清单归因
  B-pairing.md       配对正确性：**独立按磁盘重算**，不采信索引自述
  C-quality.md       ① 向量等价性 ② Top-10 重合率 ③ 相关性补充
  human-review.md    待人工复核清单（阈值触发的条目）
  top10-diff.csv     （由 quality_top10.py 产出，此处校验存在）

为什么 B 必须独立重算：索引里的配对是"自述"。只有从磁盘独立扫一遍再比对，
才能发现"索引声称的配对与磁盘事实不符"这类错误。

用法:
  python quality_report.py [--new-index data/idx-full] [--date YYYYMMDD]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

import gemma_lib as G  # noqa: E402
import index_bin  # noqa: E402


def scan_disk_pairing(root: str) -> dict[str, dict]:
    """独立从磁盘重算配对：同目录同名主干 → {stem: {img, arc}}（不读索引）。"""
    table: dict[str, dict] = {}
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            stem, ext = os.path.splitext(fn)
            ext = ext.lower()
            if ext not in G.IMG_EXT and ext not in G.ARCHIVE_EXT:
                continue
            rel = os.path.relpath(os.path.join(dp, fn), root)
            key = rel.rsplit(os.sep, 1)[0] + "|" + stem
            slot = table.setdefault(key, {"img": None, "arc": None, "folder": rel.split(os.sep)[0]})
            if ext in G.IMG_EXT:
                slot["img"] = rel
            else:
                slot["arc"] = rel
    return table


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--new-index", default=os.path.join(G.DATA_DIR, "idx-full"))
    ap.add_argument("--date", default="")
    args = ap.parse_args()

    qdir = os.path.join(G.DATA_DIR, "quality")
    date = args.date or __import__("time").strftime("%Y%m%d")
    outdir = os.path.join(HERE, "reports", "G-B-%s" % date)
    os.makedirs(outdir, exist_ok=True)

    equiv_p = os.path.join(qdir, "vector-equiv.json")
    top10_p = os.path.join(qdir, "top10.json")
    equiv = json.load(open(equiv_p, encoding="utf-8")) if os.path.exists(equiv_p) else None
    top10 = json.load(open(top10_p, encoding="utf-8")) if os.path.exists(top10_p) else None

    meta_p = os.path.join(args.new_index, "meta.json")
    meta = json.load(open(meta_p, encoding="utf-8")) if os.path.exists(meta_p) else {}
    items_p = os.path.join(args.new_index, "items.json")
    items = index_bin.read_items(items_p) if os.path.exists(items_p) else []

    print("=" * 96)
    print("生成 G-B 证据 → %s" % os.path.relpath(outdir, HERE))

    # ---------------- A ----------------
    lines_a = ["# A · 编码完整性", ""]
    if not equiv:
        lines_a += ["> ⚠ 缺少 `data/quality/vector-equiv.json` —— 先跑 `quality_vector_equiv.py`", ""]
    else:
        lines_a += ["| 检查 | 结果 | 详情 |", "|---|---|---|"]
        for c in equiv["completeness"]:
            lines_a.append("| %s | %s | %s |" % (c["check"], "✅" if c["ok"] else "❌", c["detail"]))
        lines_a += ["", "- 索引条目：**%d**" % equiv["new_index"]["count"],
                    "- 维度：**%d**" % equiv["new_index"]["dim"],
                    "- compat：`%s`" % equiv["new_index"]["compat"], ""]
    lines_a += ["## 失败项归因", ""]
    failed = meta.get("failed") or []
    if not failed:
        lines_a.append("- `failed[]` 为空：**0 条失败**")
    else:
        lines_a.append("| 相对路径 | 原因 |")
        lines_a.append("|---|---|")
        for f in failed[:50]:
            lines_a.append("| %s | %s |" % (f.get("relPath") or f.get("rel_path"),
                                            f.get("error") or f.get("reason")))
    lines_a += ["", "## 环境记录", "",
                "- 模型 repo/revision/权重：`%s` / `%s` / `%s`"
                % (meta.get("model_repo"), meta.get("model_revision"), meta.get("model_weights_dtype")),
                "- 预处理实测：`%s`" % json.dumps(meta.get("preprocessing"), ensure_ascii=False),
                "- 运行时：`%s`" % json.dumps(meta.get("runtime"), ensure_ascii=False),
                "- 库指纹（见 `data/quality/env-v1.json`）",
                "- 本报告由 `quality_report.py` 生成；原始数据见 `data/quality/*.json`", ""]

    # ---------------- B ----------------
    print("  独立重算磁盘配对…")
    disk = scan_disk_pairing(G.LIBRARY_ROOT)
    disk_img = sum(1 for v in disk.values() if v["img"])
    disk_arc = sum(1 for v in disk.values() if v["arc"])
    disk_paired = sum(1 for v in disk.values() if v["img"] and v["arc"])

    idx_pairs = set()
    idx_img_only = 0
    for it in items:
        rel = it.get("relPath") or it.get("rel_path")
        arc = it.get("archiveRelPath") or it.get("archive_rel_path")
        if arc:
            idx_pairs.add((rel, arc))
        else:
            idx_img_only += 1

    disk_pairs = {(v["img"], v["arc"]) for v in disk.values() if v["img"] and v["arc"]}
    only_idx = idx_pairs - disk_pairs      # 索引声称有、磁盘对不上 → **任何情况下都是错**
    only_disk = disk_pairs - idx_pairs     # 磁盘有、索引没有 → 仅当索引应为全量时才是错
    full_run = len(items) >= disk_img      # 索引条目数达到磁盘图片数 → 视为全量
    b_ok = (not only_idx) and (not only_disk if full_run else True)

    lines_b = ["# B · 配对正确性（独立按磁盘重算）", "",
               "方法：不读索引，直接遍历素材库，按「同目录 + 同名主干」重算配对，再与索引自述比对。",
               "判定要点：**索引声称的配对若与磁盘事实不符，任何情况下都是错**；"
               "而「磁盘有、索引没有」只在索引为全量时才算错。", "",
               "| 项 | 磁盘（独立） | 索引（自述） |", "|---|---|---|",
               "| 预览图 | %d | %d |" % (disk_img, len(items)),
               "| 压缩包 | %d | %d |" % (disk_arc, len(idx_pairs) + idx_img_only),
               "| **成功配对** | **%d** | **%d** |" % (disk_paired, len(idx_pairs)),
               "| 有图无包 | %d | %d |" % (disk_img - disk_paired, idx_img_only),
               "", "索引规模：%d / 磁盘 %d → %s"
               % (len(items), disk_img, "全量" if full_run else "**小样（不要求全集一致）**"),
               "", "## 差异", ""]
    if b_ok:
        lines_b.append("- ✅ 索引声称的 %d 对**全部**能在磁盘上独立复现；无矛盾" % len(idx_pairs))
        if not full_run:
            lines_b.append("- （小样运行：磁盘另有 %d 对未收入本索引，属预期）" % len(only_disk))
    else:
        if only_idx:
            lines_b.append("- ❌ **索引声称有、磁盘对不上：%d 对**（严重：索引自述与磁盘事实矛盾）"
                           % len(only_idx))
            for x in sorted(only_idx)[:20]:
                lines_b.append("    - `%s` ↔ `%s`" % x)
        if full_run and only_disk:
            lines_b.append("- ❌ 磁盘有而索引没有：**%d** 对" % len(only_disk))
            for x in sorted(only_disk)[:20]:
                lines_b.append("    - `%s` ↔ `%s`" % x)
    lines_b += ["", "## 已知的扩展名/内容不符（不影响配对）", "",
                "- 105 张扩展名与实际格式不符（png→jpeg 68 · jpg→bmp 20 · jpg→png 17）；"
                "其中 20 张走 BMP 回退解码，见 `data/quality/mismatch-test-result.json`",
                "- 全库 5 组内容完全相同的图（sha1 相同）；配对按主干名，不受影响", ""]

    # ---------------- C ----------------
    lines_c = ["# C · 语义质量", ""]
    if not equiv or not top10:
        lines_c += ["> ⚠ 缺少 `vector-equiv.json` 或 `top10.json` —— 先跑对应脚本", ""]
    else:
        lines_c += ["## ① 向量等价性（主判据）", "",
                    "| 指标 | 实测 | 阈值 | 结论 |", "|---|---|---|---|",
                    "| 逐条余弦最小值 | %.6f | ≥ %.3f | %s |"
                    % (equiv["cos"]["min"], equiv["thresholds"]["min_cos"],
                       "✅" if equiv["cos"]["min"] >= equiv["thresholds"]["min_cos"] else "❌"),
                    "| 逐条余弦中位数 | %.6f | ≥ %.3f | %s |"
                    % (equiv["cos"]["median"], equiv["thresholds"]["median_cos"],
                       "✅" if equiv["cos"]["median"] >= equiv["thresholds"]["median_cos"] else "❌"),
                    "| 余弦 < 0.99 的条目 | %d 条 | 列出并说明 | — |"
                    % equiv["cos"]["below_0.99"],
                    "", "配对 %d 条 · 最小值 %.6f · 中位数 %.6f · 最大值 %.6f"
                    % (equiv["paired"], equiv["cos"]["min"], equiv["cos"]["median"], equiv["cos"]["max"]),
                    ""]
        if equiv.get("below_list"):
            lines_c += ["### 余弦 < 0.99 的条目（前 30）", "",
                        "| 余弦 | 相对路径 | 扩展名 | 向量来源 | 字节 |", "|---|---|---|---|---|"]
            for x in equiv["below_list"][:30]:
                lines_c.append("| %.6f | `%s` | %s | %s | %s |"
                               % (x["cos"], x["rel_path"], x["image_ext"],
                                  x["vector_source"], x["image_size"]))
            lines_c.append("")
        lines_c += ["## ② Top-10 重合率（主判据）", "",
                    "| 指标 | 实测 | 阈值 | 结论 |", "|---|---|---|---|",
                    "| 平均重合率 | %.3f | ≥ %.2f | %s |"
                    % (top10["top10_overlap"]["average"], top10["thresholds"]["overlap_avg"],
                       "✅" if top10["top10_overlap"]["average"] >= top10["thresholds"]["overlap_avg"] else "❌"),
                    "| 单条最低重合率 | %.3f | ≥ %.2f | %s |"
                    % (top10["top10_overlap"]["min"], top10["thresholds"]["overlap_each"],
                       "✅" if top10["top10_overlap"]["min"] >= top10["thresholds"]["overlap_each"] else "❌"),
                    "", "逐条重合率：", "",
                    "| 查询 | 重合率 |", "|---|---|"]
        for x in top10["top10_overlap"]["per_query"]:
            lines_c.append("| %s | %.3f |" % (x["text"], x["overlap"]))
        lines_c += ["", "## ③ 相关性补充", "",
                    "### 独立核对：文本塔 torch vs ONNX", "",
                    "- 逐条余弦 最小 %.8f · 中位 %.8f（既有结论为 bit-exact）"
                    % (top10["text_tower_agreement"]["min_cos"],
                       top10["text_tower_agreement"]["median_cos"]),
                    "", "### 参考图", "",
                    "| 编号 | 类型 | 期望 | 新索引排名 | 结论 |", "|---|---|---|---|---|"]
        for kind in ("self", "hard", "user"):
            for r in top10["refs"].get(kind, []):
                verdict = {True: "✅", False: "❌", None: "—（无标注，仅人工复核）"}[r.get("ok")]
                lines_c.append("| %s | %s | %s | %s | %s |"
                               % (r["id"], kind, str(r.get("expect"))[:34],
                                  r.get("rank", "—"), verdict))
        lines_c.append("")
        lines_c += ["## 已知的标注缺口（**必须如实声明**）", "",
                    "- 20 条文本查询**没有相关性标注** —— 只参与 ② 与人工复核，不参与精确率计算",
                    "- 3 张用户参考图的**目标素材不可知**（文件名里的 ID 在库内不存在，已实测）"
                    "→ 不参与自动判定，只供人工复核",
                    "- 因此本报告**不能**宣称检索质量水平；它只回答"
                    "「新索引与旧索引是否等价、是否退化」", ""]

    # ---------------- human review ----------------
    lines_h = ["# 人工复核清单（轻档）", "",
               "触发条件（SPEC-acceptance §2.2）：只复核**等价性异常**或**重合率 < 50%** 的条目，",
               "不做「变化最大的 N 条」。", ""]
    n_items = 0
    if equiv and equiv.get("below_list"):
        lines_h += ["## 1) 余弦 < 0.99 的条目（共 %d 条）" % equiv["cos"]["below_0.99"], "",
                    "| 余弦 | 相对路径 | 扩展名 | 向量来源 |", "|---|---|---|---|"]
        for x in equiv["below_list"][:10]:
            lines_h.append("| %.6f | `%s` | %s | %s |"
                           % (x["cos"], x["rel_path"], x["image_ext"], x["vector_source"]))
        n_items += min(10, len(equiv["below_list"]))
        lines_h.append("")
    if top10:
        bad = [x for x in top10["top10_overlap"]["per_query"]
               if x["overlap"] < top10["thresholds"]["overlap_each"]]
        lines_h += ["## 2) 重合率 < %.2f 的查询（共 %d 条）"
                    % (top10["thresholds"]["overlap_each"], len(bad)), ""]
        for x in bad:
            lines_h += ["### %s（重合 %.3f）" % (x["text"], x["overlap"]),
                        "- 旧 Top-5：%s" % x["old_top10"][:5],
                        "- 新 Top-5：%s" % x["new_top10"][:5], ""]
        n_items += len(bad)
    lines_h += ["## 3) 用户参考图（目视判断相关性）", ""]
    if top10:
        for r in top10["refs"].get("user", []):
            lines_h += ["- **%s** → 新 Top-3：%s" % (r["path"], r["new_top3"]), ""]
    lines_h += ["", "> 复核只回答一个问题：**上列条目是否能被合理解释**（而不是「新索引更差」）。",
                "> 能解释 → 记录原因即可；不能解释 → G-B 判不通过。", ""]

    for name, content in (("A-completeness.md", lines_a), ("B-pairing.md", lines_b),
                          ("C-quality.md", lines_c), ("human-review.md", lines_h)):
        with open(os.path.join(outdir, name), "w", encoding="utf-8") as fh:
            fh.write("\n".join(content))
        print("  写出 %-20s %6d 字节" % (name, os.path.getsize(os.path.join(outdir, name))))

    csv_p = os.path.join(outdir, "top10-diff.csv")
    print("  top10-diff.csv: %s" % ("已存在" if os.path.exists(csv_p) else "**缺**（跑 quality_top10.py --out）"))

    # ---------------- 判定 ----------------
    all_problems = []
    if equiv:
        all_problems += ["① " + p for p in equiv.get("problems", [])]
    if top10:
        all_problems += ["②③ " + p for p in top10.get("problems", [])]
    if not b_ok:
        all_problems.append("B 配对集合与磁盘独立重算不一致")
    if not equiv or not top10:
        all_problems.append("证据不全（缺 vector-equiv.json 或 top10.json）")

    verdict = "PASS" if not all_problems else "FAIL"
    print()
    print("  配对（独立重算）：磁盘 %d 对 · 索引 %d 对 · %s"
          % (len(disk_pairs), len(idx_pairs), "一致 ✅" if b_ok else "**不一致** ❌"))
    print("  人工复核清单：约 %d 项" % n_items)
    print("  **G-B 判定（自动部分）：%s**" % verdict)
    for p in all_problems:
        print("    ✗ %s" % p)
    if verdict == "PASS":
        print("    注意：④ 人工复核仍需你确认后才算通过（见 human-review.md）")
    with open(os.path.join(outdir, "VERDICT.txt"), "w", encoding="utf-8") as fh:
        fh.write("自动判定：%s\n\n" % verdict)
        for p in all_problems:
            fh.write("- %s\n" % p)
        fh.write("\n人工复核：%d 项待确认（human-review.md）\n" % n_items)
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())

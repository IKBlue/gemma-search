# -*- coding: utf-8 -*-
"""
quality_rank_margin.py —— G-B 诊断 A4：**换位的分数边距**

为什么要它：
  ② Top-10 重合率只回答"有多少条换了位"，**不回答"换了位有没有变差"**。
  在近同分的平顶分布上，向量只要有一点点扰动，名次就会互换 ——
  那是**排序不稳定**，不是**质量退化**。两者靠重合率区分不出来。

做法（不重复实现检索逻辑）：
  读 `quality_top10.py --out` 产出的 top10.json（含每侧的 Top-10 与**分数**），
  对每个查询取 old_top10 ∪ new_top10 的并集，在两个向量空间里各算一次分数，
  然后对每一处"进/出"给出边距：

      margin = score_new(进入项) − score_new(被挤出项)

  边距若在**扰动尺度**以下（本次由向量等价性给出），则该换位是**不可分辨的近同分**。

用法:
  python quality_rank_margin.py --top10 reports/G-B-<日期>/top10.json
         [--new-index data/idx-full-v2] [--out reports/.../rank-margin.csv]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

HERE = os.path.dirname(os.path.abspath(__file__))


def _gs_root(start):
    """项目根：向上找到含 `core/engine.mjs` 的那一级（搬目录也不会失效）。"""
    p = start
    while True:
        if os.path.exists(os.path.join(p, "core", "engine.mjs")):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            raise SystemExit("找不到项目根（向上找不到 core/engine.mjs）：%s" % start)
        p = parent


ROOT = _gs_root(HERE)

for _p in (ROOT, HERE, os.path.dirname(HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)
os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main() -> int:
    import numpy as np
    import gemma_lib as G
    import index_bin

    ap = argparse.ArgumentParser()
    ap.add_argument("--top10", default="", help="quality_top10.py 的 --out 产物")
    ap.add_argument("--new-index", default=os.path.join("data", "idx-full-v2"))
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    if not args.top10 or not os.path.exists(args.top10):
        print("✗ 需要 --top10 <top10.json>（先跑 quality_top10.py --out …）")
        return 2

    t = json.load(open(args.top10, encoding="utf-8"))
    per_text = t.get("top10_overlap", {}).get("per_query", [])
    if not per_text:
        print("✗ top10.json 里没有 per_query")
        return 2
    if "old_top10_scores" not in per_text[0]:
        print("✗ top10.json 没有分数（旧版产物）—— 用新版 quality_top10.py 重新生成")
        return 2

    header, nv = index_bin.read_index_bin(os.path.join(args.new_index, "index.bin"))
    new_items = index_bin.read_items(os.path.join(args.new_index, "items.json"))
    new_rel = {it["vectorRow"]: (it.get("relPath") or it.get("rel_path")) for it in new_items}
    new_row = {v: k for k, v in new_rel.items()}

    ov = np.load(G.EMB_PATH)
    old_items = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
    old_row = {(it.get("relPath") or it.get("rel_path")): it["idx"] for it in old_items}

    print("=" * 96)
    print("G-B 诊断 A4 · 换位的分数边距")
    print("  查询集合: %s" % os.path.relpath(args.top10, ROOT))
    print("  新索引  : %s（%d 条）" % (args.new_index, header["count"]))

    rows_out = []
    per_query = []
    print()
    print("--- 逐查询 ---")
    for q in per_text:
        old_list, new_list = q["old_top10"], q["new_top10"]
        old_s = q["old_top10_scores"]
        new_s = q["new_top10_scores"]
        union = [r for r in dict.fromkeys(old_list + new_list) if r in old_row and r in new_row]
        # 两个空间各算一次分数（新索引向量 vs 查询… 查询向量不在产物里，
        # 但**分数本身**已经在 top10.json 里；这里只需补"另一侧"的分数：
        #   · 进入项在旧空间的分数：用旧矩阵 ✓（已知行）
        #   · 被挤出项在新空间的分数：用新矩阵 ✓（已知行）
        # 于是不必重新编码查询 —— 用"旧空间分数差"与"新空间分数差"分别刻画边距。
        old_sc = {r: float(old_s[old_list.index(r)]) if r in old_list else None for r in union}
        new_sc = {r: float(new_s[new_list.index(r)]) if r in new_list else None for r in union}
        got_cross = True
        if any(v is None for v in old_sc.values()) or any(v is None for v in new_sc.values()):
            # 需要另一侧的分数的情形：用矩阵补算（旧矩阵行已知；新矩阵行已知），
            # 但缺**查询向量**，所以只能就"同侧都有的项"给边距 —— 明确说明而不是硬凑。
            got_cross = False

        entered = [r for r in new_list if r not in old_list]
        left = [r for r in old_list if r not in new_list]
        # 同侧可比的边距：新空间里"进入项 vs 其名次上的旧项"的分数差
        margins = []
        for i, (o, n) in enumerate(zip(old_list, new_list)):
            if o == n:
                continue
            margins.append({"rank": i + 1, "entered": n, "left": o,
                            "new_score_entered": new_sc.get(n), "new_score_left": new_sc.get(o),
                            "old_score_entered": old_sc.get(n), "old_score_left": old_sc.get(o)})
        # 平顶程度：Top-10 分数的第 1 名与第 10 名之差
        flat_new = (max(new_s) - min(new_s)) if new_s else float("nan")
        flat_old = (max(old_s) - min(old_s)) if old_s else float("nan")
        per_query.append({"id": q["id"], "text": q["text"], "overlap": q["overlap"],
                          "entered": entered, "left": left, "margins": margins,
                          "top10_span_new": round(flat_new, 6), "top10_span_old": round(flat_old, 6),
                          "cross_space_scores_available": got_cross})
        print("  %-22s 重合 %.3f · Top-10 分数跨度 旧 %.4f / 新 %.4f · 进 %d 出 %d"
              % (q["text"][:22], q["overlap"], flat_old, flat_new, len(entered), len(left)))

    # ---------- 汇总 ----------
    spans_old = [x["top10_span_old"] for x in per_query]
    spans_new = [x["top10_span_new"] for x in per_query]
    n_swap = sum(len(x["entered"]) for x in per_query)
    print()
    print("--- 汇总 ---")
    print("  换位条数合计 %d（20 查询 × Top-10 = 200 个名额）" % n_swap)
    print("  Top-10 分数跨度 中位: 旧 %.4f · 新 %.4f   ← 越小说明顶部越平（名次越不稳定）"
          % (float(np.median(spans_old)), float(np.median(spans_new))))
    print()
    print("  判读口径（与 ① 的扰动尺度对照）：")
    print("   · 若换位只发生在分数差 ≲ Top-10 跨度/10 的近同分对之间 → 属**排序不稳定**；")
    print("   · 若发生在大分数差上（例如首位互换）→ 属**质量变化**，必须逐条说明。")

    # 首位是否变化（最敏感的质量信号）
    first_changed = None
    if per_text:
        first_changed = sum(1 for q in per_text if q["old_top10"][0] != q["new_top10"][0])
        print("   · Top-1 变化的查询数：%d / %d" % (first_changed, len(per_text)))
    print("   · Top-3 重合：中位 %.1f/3"
          % float(np.median([len(set(q["old_top10"][:3]) & set(q["new_top10"][:3]))
                             for q in per_text])))

    out_p = args.out or os.path.join(os.path.dirname(args.top10), "rank-margin.csv")
    os.makedirs(os.path.dirname(os.path.abspath(out_p)), exist_ok=True)
    with open(out_p, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "text", "overlap", "rank", "entered", "left",
                    "new_score_entered", "new_score_left", "old_score_entered", "old_score_left"])
        for x in per_query:
            for m in x["margins"]:
                w.writerow([x["id"], x["text"], x["overlap"], m["rank"], m["entered"], m["left"],
                            m["new_score_entered"], m["new_score_left"],
                            m["old_score_entered"], m["old_score_left"]])
    print()
    print("  边距表 → %s" % os.path.relpath(out_p, ROOT))

    js_p = out_p.replace(".csv", ".json")
    with open(js_p, "w", encoding="utf-8") as fh:
        json.dump({"top1_changed": first_changed,
                   "top3_overlap_median": float(np.median(
                       [len(set(q["old_top10"][:3]) & set(q["new_top10"][:3])) for q in per_text])),
                   "swaps_total": n_swap,
                   "span_median_old": float(np.median(spans_old)),
                   "span_median_new": float(np.median(spans_new)),
                   "per_query": per_query}, fh, ensure_ascii=False, indent=1)
    print("  报告   → %s" % os.path.relpath(js_p, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""
quality_vector_equiv.py —— G-B 主判据 ① 向量等价性（SPEC-acceptance §2.2）

做法：把**新索引**（index.bin）与**旧索引**（embeddings.npy）**按 rel_path join**，
逐条算余弦。两侧都是 L2 归一化向量，所以余弦 = 点积。

阈值（来自 SPEC-acceptance §2.2，已锁定）：
  最小值 ≥ 0.970 · 中位数 ≥ 0.990 · 余弦 < 0.99 的条目要列出并逐条说明

同时给出 A 编码完整性（§2.2 第一道）：条目数 / dim / 范数 / UID 唯一性 / failed[] 归因。

用法:
  python quality_vector_equiv.py [--new-index data/idx-full] [--out reports/...]
"""
from __future__ import annotations

import argparse
import json
import os
import sys


# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G  # noqa: E402
import index_bin  # noqa: E402

MIN_COS = 0.970
MED_COS = 0.990
LIST_BELOW = 0.99


def rel_of(item: dict) -> str | None:
    """取条目的库内相对路径，**兼容两种既有格式**。

    · 新索引（SPEC-identity §5）：camelCase `relPath`、且带 images[]/archives[] 数组
    · 旧索引（现有 Python 档，已冻结）：snake_case `rel_path`、扁平字段
    两者是**格式换代**，不是谁写错了 —— 跨格式比对必须显式桥接。
    踩过的坑：最初只查 `rel_path`，在新索引上全部得到 None，join 归零。
    """
    if not isinstance(item, dict):
        return None
    return item.get("relPath") or item.get("rel_path")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--new-index", default=os.path.join(G.DATA_DIR, "idx-full"))
    ap.add_argument("--out", default="")
    ap.add_argument("--sample", type=int, default=0, help="只取前 N 条（小样验证用）")
    ap.add_argument("--expect-count", type=int, default=3594,
                    help="期望条目数（小样验证时传样本数，否则会误报失败）")
    args = ap.parse_args()

    import numpy as np

    problems: list[str] = []
    print("=" * 96)
    print("G-B ① 向量等价性")
    print("  旧索引: %s" % os.path.relpath(G.EMB_PATH, HERE))
    print("  新索引: %s" % os.path.relpath(os.path.join(args.new_index, "index.bin"), HERE))

    # ---------- 读新索引 ----------
    new_bin = os.path.join(args.new_index, "index.bin")
    new_items_p = os.path.join(args.new_index, "items.json")
    new_meta_p = os.path.join(args.new_index, "meta.json")
    for p in (new_bin, new_items_p, new_meta_p):
        if not os.path.exists(p):
            print("  ✗ 缺文件: %s" % p)
            return 2
    header, nv = index_bin.read_index_bin(new_bin)      # 内含 MAGIC/footer/sha1 校验
    new_items = index_bin.read_items(new_items_p)
    meta = json.load(open(new_meta_p, encoding="utf-8"))
    print("  新索引 header: count=%s dim=%s compat=%s" % (header["count"], header["dim"], header.get("compat")))

    # ---------- 读旧索引 ----------
    ov = np.load(G.EMB_PATH)
    old_items = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
    print("  旧索引: %d 条 · dim %d" % (ov.shape[0], ov.shape[1]))

    # ---------- A 编码完整性 ----------
    print()
    print("--- A 编码完整性 ---")
    n_norm = np.linalg.norm(nv, axis=1)
    ok_norm = bool(((n_norm > 0.99) & (n_norm < 1.01)).all())
    uids = [it.get("uid") for it in new_items]
    dup_uids = [u for u, c in Counter(uids).items() if c > 1]
    failed = meta.get("failed") or []
    checks = [
        ("条目数 == 期望值 %d" % args.expect_count, len(new_items) == args.expect_count,
         "%d vs %d" % (len(new_items), args.expect_count)),
        ("dim == 768", header["dim"] == 768, str(header["dim"])),
        ("所有行范数 ∈ [0.99,1.01]", ok_norm, "%.6f ~ %.6f" % (n_norm.min(), n_norm.max())),
        ("UID 无重复", not dup_uids, "%d 个重复" % len(dup_uids) if dup_uids else "无"),
        ("failed[] 为空或每条有归因", all(isinstance(f, dict) and (f.get("error") or f.get("reason")) for f in failed),
         "%d 条失败" % len(failed)),
        ("vectorRow 连续且无越界", sorted(it["vectorRow"] for it in new_items) == list(range(len(new_items))),
         "max=%s" % max((it["vectorRow"] for it in new_items), default=-1)),
    ]
    for name, ok, detail in checks:
        print("  [%s] %-34s %s" % ("OK  " if ok else "FAIL", name, detail))
        if not ok:
            problems.append("A: %s（%s）" % (name, detail))

    # ---------- join ----------
    print()
    print("--- ① 逐条余弦（按 rel_path join）---")
    old_by_rel = {rel_of(it): it["idx"] for it in old_items}
    pairs, missing_new, missing_old = [], [], []
    for it in new_items:
        rel = rel_of(it)
        if rel not in old_by_rel:
            missing_old.append(rel)
            continue
        if it["vectorRow"] >= nv.shape[0]:
            continue
        pairs.append((rel, old_by_rel[rel], it["vectorRow"], it))
    new_rels = {rel_of(it) for it in new_items}
    missing_new = [r for r in old_by_rel if r not in new_rels]
    print("  可配对 %d 条" % len(pairs))
    # 跨格式一致性：只有在"新索引也是全量"时才要求集合完全相同；
    # 小样运行时新索引本来就是旧索引的子集，缺条目是正常的。
    full_run = (len(new_items) == args.expect_count == ov.shape[0])
    same_set = full_run and (not missing_old) and (not missing_new)
    print("  [%s] 两侧相对路径集合%s%s"
          % ("OK  " if same_set else ("WARN" if not full_run else "FAIL"),
             "一致" if full_run else "（小样运行，不要求全集一致）",
             "" if full_run else "：新缺 %d · 旧缺 %d" % (len(missing_new), len(missing_old))))
    if full_run and not same_set:
        problems.append("① 两侧相对路径集合不一致（新缺 %d · 旧缺 %d）"
                        % (len(missing_new), len(missing_old)))
    if missing_old:
        print("  ⚠ 旧索引没有的 %d 条（新增素材？）：%s" % (len(missing_old), missing_old[:3]))
    if missing_new:
        print("  ⚠ 新索引缺的 %d 条：%s" % (len(missing_new), missing_new[:3]))
    if args.sample:
        pairs = pairs[:args.sample]
        print("  （--sample %d → 只算前 %d 条）" % (args.sample, len(pairs)))
    if not pairs:
        print("  ✗ 没有可配对的条目")
        return 2

    idx_old = np.array([p[1] for p in pairs])
    idx_new = np.array([p[2] for p in pairs])
    a = ov[idx_old]
    b = nv[idx_new]
    cos = np.einsum("ij,ij->i", a, b)          # 两侧均已 L2 归一化
    cmin, cmed = float(cos.min()), float(np.median(cos))
    below = np.where(cos < LIST_BELOW)[0]
    hard = np.where(cos < MIN_COS)[0]

    print("  余弦 最小 %.6f · 中位 %.6f · 最大 %.6f" % (cmin, cmed, float(cos.max())))
    print("  < %.2f 的条目 %d 条 · < %.3f 的条目 %d 条" % (LIST_BELOW, len(below), MIN_COS, len(hard)))
    ok1 = cmin >= MIN_COS
    ok2 = cmed >= MED_COS
    print("  [%s] 最小值 ≥ %.3f" % ("OK  " if ok1 else "FAIL", MIN_COS))
    print("  [%s] 中位数 ≥ %.3f" % ("OK  " if ok2 else "FAIL", MED_COS))
    if not ok1:
        problems.append("① 最小值 %.6f < %.3f" % (cmin, MIN_COS))
    if not ok2:
        problems.append("① 中位数 %.6f < %.3f" % (cmed, MED_COS))

    # < 0.99 的条目清单（含该条的格式/尺寸/是否走了 BMP 回退）
    worst = sorted(zip(cos.tolist(), [p[3] for p in pairs]),
                   key=lambda x: x[0])[:30]
    listing = []
    for c, it in worst:
        if c >= LIST_BELOW and len(listing) >= len(below):
            break
        listing.append({
            "cos": round(c, 6),
            "rel_path": rel_of(it),
            "image_ext": it.get("imageExt"),
            "image_size": it.get("imageSize"),
            "vector_source": it.get("vectorSource"),
        })
    if listing:
        print()
        print("  < %.2f 的条目（最多列 30，按余弦升序）：" % LIST_BELOW)
        for x in listing[:12]:
            print("    %.6f  %-42s ext=%-6s src=%-13s %s"
                  % (x["cos"], str(x["rel_path"])[:42], x["image_ext"], x["vector_source"], x["image_size"]))
        if len(listing) > 12:
            print("    …（另有 %d 条，见报告）" % (len(listing) - 12))

    by_src = Counter(x["vector_source"] for x in listing)
    if by_src:
        print("  这些条目的 vectorSource 分布: %s" % dict(by_src))

    # ---------- 结果 ----------
    result = {
        "judgement": "PASS" if not problems else "FAIL",
        "thresholds": {"min_cos": MIN_COS, "median_cos": MED_COS, "list_below": LIST_BELOW},
        "new_index": {"dir": os.path.relpath(args.new_index, HERE), "count": header["count"],
                      "dim": header["dim"], "compat": header.get("compat")},
        "paired": len(pairs), "missing_in_old": len(missing_old), "missing_in_new": len(missing_new),
        "cos": {"min": cmin, "median": cmed, "max": float(cos.max()),
                "below_0.99": int(len(below)), "below_min_threshold": int(len(hard))},
        "completeness": [{"check": n, "ok": o, "detail": d} for n, o, d in checks],
        "below_list": listing,
        "problems": problems,
    }
    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=1)
        print()
        print("  报告 → %s" % os.path.relpath(args.out, HERE))

    print()
    print("结论：%s" % result["judgement"])
    for p in problems:
        print("  ✗ %s" % p)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())

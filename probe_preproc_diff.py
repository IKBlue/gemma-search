# -*- coding: utf-8 -*-
"""
probe_preproc_diff.py —— A 阶段：定位新旧预处理差异的来源

思路：先看**属性**，再谈实现。若失败项共享某个属性（EXIF 方向 / 色彩模式 / 超大尺寸），
那多半是可修的一处差异；若属性分布与好项无异，那就是 resize 实现的固有差异。

对照组：余弦 > 0.9999 的（几乎逐位一致的）条目。
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import gemma_lib as G  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402
import numpy as np  # noqa: E402
import index_bin  # noqa: E402

eff = json.load(open(os.path.join(G.DATA_DIR, "quality", "vector-equiv.json"), encoding="utf-8"))
below = [x["rel_path"] for x in eff.get("below_list", [])]

# 对照组：从好项里挑（用同一份 header/items 重算一遍余弦，挑 > 0.9999 的）
h, nv = index_bin.read_index_bin(os.path.join(G.DATA_DIR, "idx-full", "index.bin"))
items = index_bin.read_items(os.path.join(G.DATA_DIR, "idx-full", "items.json"))
old_v = np.load(G.EMB_PATH)
old_i = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
old_by = {x["rel_path"]: x["idx"] for x in old_i}

good = []
for it in items:
    rel = it.get("relPath") or it.get("rel_path")
    if rel not in old_by or rel in below:
        continue
    c = float(old_v[old_by[rel]] @ nv[it["vectorRow"]])
    if c > 0.9999:
        good.append(rel)
    if len(good) >= 30:
        break

print("失败组 %d 条 · 对照组 %d 条" % (len(below), len(good)))


def props(rel):
    p = os.path.join(G.LIBRARY_ROOT, rel)
    out = {"rel": rel, "bytes": os.path.getsize(p)}
    with Image.open(p) as im:
        out["w"], out["h"] = im.size
        out["mode"] = im.mode
        out["format"] = im.format
        # EXIF 方向（274）
        try:
            ex = im.getexif()
            out["orientation"] = ex.get(274, None)
            out["exif_keys"] = len(ex)
        except Exception:
            out["orientation"] = None
            out["exif_keys"] = -1
        # EXIF 转正后尺寸是否变化（= 是否需要旋转）
        try:
            fixed = ImageOps.exif_transpose(im)
            out["needs_rotate"] = (fixed.size != im.size)
        except Exception:
            out["needs_rotate"] = None
        out["megapixels"] = round(im.size[0] * im.size[1] / 1e6, 2)
    return out


rows_bad = [props(r) for r in below]
rows_good = [props(r) for r in good]


def summarize(label, rows):
    print()
    print("=== %s ===" % label)
    print("  尺寸中位: %s x %s · 百万像素中位 %.2f"
          % (int(np.median([r["w"] for r in rows])), int(np.median([r["h"] for r in rows])),
             float(np.median([r["megapixels"] for r in rows]))))
    print("  mode: %s" % dict(Counter(r["mode"] for r in rows)))
    print("  format: %s" % dict(Counter(r["format"] for r in rows)))
    print("  orientation: %s" % dict(Counter(str(r["orientation"]) for r in rows)))
    print("  需要 EXIF 转正: %s" % dict(Counter(str(r["needs_rotate"]) for r in rows)))
    print("  有 EXIF: %s" % dict(Counter("有" if r["exif_keys"] > 0 else "无" for r in rows)))


summarize("失败组（余弦 < 0.99）", rows_bad)
summarize("对照组（余弦 > 0.9999）", rows_good)

print()
print("=== 失败组逐条（前 12）===")
for r in rows_bad[:12]:
    print("  %-42s %4dx%-5d %-5s orient=%-5s rotate=%-5s %.2fMP"
          % (r["rel"][:42], r["w"], r["h"], r["mode"], r["orientation"],
             r["needs_rotate"], r["megapixels"]))

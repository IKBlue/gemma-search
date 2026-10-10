# -*- coding: utf-8 -*-
"""
verify_bmp_pil.py —— 用 PIL 解同一批 BMP，与 bmp-js 的结果逐像素比对。

为什么要这步：仅"bmp-js 能跑通"不能证明解码正确（可能通道序反、可能上下颠倒）。
PIL 是旧管线用过的解码器、且这批文件来自旧管线，所以拿它当基准：
**sha1 完全一致才说明 bmp-js 解出的像素与 PIL 相同。**
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import gemma_lib as G  # noqa: E402

from PIL import Image  # noqa: E402

node_path = os.path.join(G.DATA_DIR, "quality", "bmp-decode-node.json")
if not os.path.exists(node_path):
    print("  缺少 node 侧结果，先跑 verify_bmp.mjs")
    sys.exit(2)
node = json.load(open(node_path, encoding="utf-8"))

lib = G.LIBRARY_ROOT
match_rgba = match_bgra = mismatch = 0
details = []
for f in node["files"]:
    if not f.get("ok"):
        details.append((f["rel_path"], "node 解码失败", ""))
        mismatch += 1
        continue
    full = os.path.join(lib, f["rel_path"])
    with Image.open(full) as im:
        rgb = im.convert("RGB")
        w, h = rgb.size
        pil_sha = hashlib.sha1(rgb.tobytes()).hexdigest()
    same_r = (pil_sha == f["sha1_rgba"])
    same_b = (pil_sha == f["sha1_bgra"])
    if same_r:
        match_rgba += 1
    elif same_b:
        match_bgra += 1
    else:
        mismatch += 1
        details.append((f["rel_path"], "sha1 不一致", "%s vs %s" % (pil_sha[:12], f["sha1_rgba"][:12])))
    if (w, h) != (f["width"], f["height"]):
        details.append((f["rel_path"], "尺寸不一致", "%sx%s vs %sx%s" % (w, h, f["width"], f["height"])))

total = len(node["files"])
print("  PIL 基准比对：共 %d 张" % total)
print("    与 RGBA 通道序一致: %d" % match_rgba)
print("    与 BGRA 通道序一致: %d" % match_bgra)
print("    不一致/失败:        %d" % mismatch)
if details:
    print("    明细（前 8）:")
    for d in details[:8]:
        print("      %s  %s  %s" % d)

verdict = "RGBA" if match_rgba == total else ("BGRA" if match_bgra == total else "MIXED/FAIL")
print()
print("  结论：bmp-js 的通道序 = %s" % verdict)
print("  %s" % ("✓ 逐像素与 PIL 一致，解码正确" if verdict in ("RGBA", "BGRA")
                else "✗ 存在不一致，不能直接用"))

out = {
    "total": total, "match_rgba": match_rgba, "match_bgra": match_bgra,
    "mismatch": mismatch, "channel_order": verdict, "details": details,
    "verdict": "pass" if mismatch == 0 else "fail",
}
with open(os.path.join(G.DATA_DIR, "quality", "bmp-decode-verify.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
print("  → data/quality/bmp-decode-verify.json")
sys.exit(0 if mismatch == 0 else 1)

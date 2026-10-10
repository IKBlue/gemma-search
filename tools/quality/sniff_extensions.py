# -*- coding: utf-8 -*-
"""
sniff_extensions.py —— 找出"扩展名与实际内容不符"的预览图，产出清单。

为什么需要：审查指出 —— 试点 100 条 0 失败**不能证明回退解码生效**，
因为不确定试点是否覆盖了这类文件；全量时若这些图失败，A 项"数量=3594"可能直接少 105。

产出 data/quality/extension-mismatch.json：
  { "generated_at":…, "total_images":3594, "mismatch_count":105,
    "by_pair": {"png→jpeg":68,…}, "items":[{rel_path, ext, actual, size, reason}] }
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

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
import gemma_lib as G  # noqa: E402

ROOT = G.LIBRARY_ROOT
IMG_EXT = {".jpg", ".jpeg", ".png"}


def sniff(head: bytes) -> str:
    """按魔数判断真实格式（只看前 32 字节）。"""
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:2] == b"BM":
        return "bmp"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[:4] == b"II*\x00" or head[:4] == b"MM\x00*":
        return "tiff"
    if head[:2] == b"\xff\xd8":
        return "jpeg"
    return "unknown"


def main() -> int:
    items = []
    total = 0
    ext_count = Counter()
    for dp, _dn, fns in os.walk(ROOT):
        for fn in fns:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in IMG_EXT:
                continue
            total += 1
            full = os.path.join(dp, fn)
            with open(full, "rb") as fh:
                head = fh.read(32)
            actual = sniff(head)
            ext_count[ext] += 1
            # 只有同族不算不符：.jpg/.jpeg 都属 jpeg
            same = ((ext in (".jpg", ".jpeg") and actual == "jpeg") or
                    (ext == ".png" and actual == "png"))
            if not same:
                items.append({
                    "rel_path": os.path.relpath(full, ROOT),
                    "abs_path": full,
                    "ext": ext,
                    "actual": actual,
                    "size": os.path.getsize(full),
                    "reason": "扩展名与实际格式不符",
                })

    pairs = Counter("%s→%s" % (i["ext"].lstrip("."), i["actual"]) for i in items)
    out = {
        "generated_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        "library_root": ROOT,
        "total_images": total,
        "ext_count": dict(ext_count),
        "mismatch_count": len(items),
        "by_pair": dict(pairs.most_common()),
        "items": items,
    }
    d = os.path.join(G.DATA_DIR, "quality")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "extension-mismatch.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)

    print("  预览图总数 %d" % total)
    print("  扩展名分布 %s" % dict(ext_count))
    print("  不符 %d 条" % len(items))
    for k, v in pairs.most_common():
        print("      %-14s %d" % (k, v))
    print("  → %s" % p)
    return 0


if __name__ == "__main__":
    sys.exit(main())

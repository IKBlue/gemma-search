# -*- coding: utf-8 -*-
"""
probe_proc_shape.py —— 两套处理器对同一张图产出的张量形状是否一致

这是"先看形状再谈数值"的一步：
  · 形状不同 → 是**可修的配置/实现差异**（甚至可能是 bug），比数值调参好办得多
  · 形状相同 → 差异在 resize 的**数值实现**里（滤波/抗锯齿），基本不可跨语言收敛

顺带把 PIL 解码后的 RGB 像素存成原始文件，供 JS 侧做"同像素输入"对照。
"""
from __future__ import annotations

import json
import os
import sys

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
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import gemma_lib as G  # noqa: E402
from PIL import Image  # noqa: E402
import numpy as np  # noqa: E402

REL = sys.argv[1] if len(sys.argv) > 1 else r"VR\ID-1109393506.jpeg"
SEQ = 140
OUT_PIX = os.path.join(G.DATA_DIR, "_probe-pixels.bin")
OUT_META = os.path.join(G.DATA_DIR, "_probe-pixels.json")

path = os.path.join(G.LIBRARY_ROOT, REL)
with Image.open(path) as im:
    im = im.convert("RGB")
    print("  原图: %s  size=%s mode=%s" % (REL, im.size, im.mode))
    px = np.asarray(im, dtype=np.uint8)
    print("  解码后像素: shape=%s dtype=%s 均值=%.2f" % (px.shape, px.dtype, px.mean()))

    # 老路径：Python transformers 处理器 + PIL 图
    from transformers import AutoProcessor
    proc = AutoProcessor.from_pretrained("google/embeddinggemma-2", local_files_only=True)
    if hasattr(proc, "image_seq_length"):
        proc.image_seq_length = SEQ
    ip = getattr(proc, "image_processor", None)
    if ip is not None:
        if hasattr(ip, "max_soft_tokens"):
            ip.max_soft_tokens = SEQ
        if hasattr(ip, "image_seq_length"):
            ip.image_seq_length = SEQ
        if getattr(ip, "config", None) is not None:
            try:
                ip.config.image_seq_length = SEQ
            except Exception:
                pass

    out = proc(images=im)
    print()
    print("=== Python 处理器输出 ===")
    for k, v in out.items():
        shp = getattr(v, "shape", None)
        print("  %-22s %s  dtype=%s" % (k, shp, getattr(v, "dtype", "?")))

    # 也试一下"显式指定尺寸"的路径，看它默认怎么缩
    print()
    print("  image_processor 关键配置:")
    for k in ("patch_size", "max_soft_tokens", "image_seq_length", "pooling_kernel_size",
              "resample", "rescale_factor", "do_normalize", "do_resize", "size"):
        for obj, nm in ((ip, "ip"), (getattr(ip, "config", None), "ip.config")):
            if obj is not None and k in getattr(obj, "__dict__", {}):
                print("    %s.%s = %s" % (nm, k, getattr(obj, k)))
            elif obj is not None and hasattr(obj, k):
                print("    %s.%s = %s" % (nm, k, getattr(obj, k)))

    # 存原始像素给 JS 对照
    px.tofile(OUT_PIX)
    with open(OUT_META, "w", encoding="utf-8") as fh:
        json.dump({"rel": REL, "h": int(px.shape[0]), "w": int(px.shape[1]),
                   "channels": int(px.shape[2]), "bytes": int(px.size),
                   "pixel_values_shape": list(out["pixel_values"].shape)
                   if "pixel_values" in out else None}, fh)
    print()
    print("  已存原始像素 → %s（%d 字节）" % (os.path.basename(OUT_PIX), px.size))

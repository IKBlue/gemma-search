# -*- coding: utf-8 -*-
"""速度对照实验：线程 / 批大小 / image_seq_length 三维度，结果同时写文件便于读取。"""
import itertools
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np                                        # noqa: E402
import torch                                              # noqa: E402
import gemma_lib as G                                     # noqa: E402

OUT = os.path.join(G.DATA_DIR, "speed_probe.json")
os.makedirs(G.DATA_DIR, exist_ok=True)

enc = G.Encoder()
m = enc.model
proc = getattr(m, "processor", None)

items = G.find_items()[:12]
paths = [it.abs_path for it in items]
print("cores={} torch_threads={} samples={}".format(
    os.cpu_count(), torch.get_num_threads(), len(paths)), flush=True)


def set_seq_len(v):
    """image_seq_length 是 processor 上的旋钮（默认 280）。"""
    if proc is None:
        return False
    if hasattr(proc, "image_seq_length"):
        proc.image_seq_length = v
        ip = getattr(proc, "image_processor", None)
        if ip is not None and hasattr(ip, "max_soft_tokens"):
            ip.max_soft_tokens = v
        return True
    return False


def bench(threads, batch, seq):
    torch.set_num_threads(threads)
    ok = set_seq_len(seq)
    t = time.time()
    n = 0
    try:
        for i in range(0, len(paths), batch):
            part = paths[i:i + batch]
            v = m.encode([{"image": p} for p in part], normalize_embeddings=True,
                         convert_to_numpy=True, show_progress_bar=False)
            n += len(np.atleast_2d(v))
        el = time.time() - t
        return {"threads": threads, "batch": batch, "seq": seq, "applied": ok,
                "seconds": round(el, 2), "per_image": round(el / max(n, 1), 3),
                "nan": bool(np.isnan(np.atleast_2d(v)).any())}
    except Exception as e:                                # noqa: BLE001
        return {"threads": threads, "batch": batch, "seq": seq, "applied": ok,
                "error": "{}: {}".format(type(e).__name__, str(e)[:90])}


rows = []
combos = [
    (8, 4, 280),      # 基线
    (16, 4, 280),
    (16, 8, 280),
    (16, 8, 140),
    (16, 8, 70),
    (16, 16, 140),
]
for th, b, s in combos:
    r = bench(th, b, s)
    rows.append(r)
    print(json.dumps(r, ensure_ascii=False), flush=True)

json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("\nWROTE " + OUT)

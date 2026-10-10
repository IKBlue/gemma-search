# -*- coding: utf-8 -*-
"""
spike_torch.py —— 用现有 torch/sentence-transformers 通路编码一批固定样本（spike 基准）。

与 spike_onnx.mjs 输出**同构**的 JSON，便于逐条算余弦。

用法:
    python spike_torch.py --seq 280 --out ref280.json
    python spike_torch.py --seq 140 --out ref140.json --selection sel.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import gemma_lib as G                                        # noqa: E402
from gemma_lib import Encoder                                # noqa: E402

TEXTS = [
    "现代简约布艺沙发",
    "北欧吊灯",
    "中古风木质吸顶灯",
    "玻璃球多头吊灯",
    "花卉图案装饰画",
]


def select_items(n: int) -> list[dict]:
    """确定性抽样：在全部素材上均匀取 n 个，并逐个验证可解码。"""
    from PIL import Image
    items = G.find_items()
    total = len(items)
    picks = sorted({round(i * (total - 1) / (n - 1)) for i in range(n)})
    out = []
    for idx in picks:
        it = items[idx]
        try:
            with Image.open(it.abs_path) as im:
                im.convert("RGB").load()
        except Exception as e:                               # noqa: BLE001
            print("  [跳过] %s 无法解码: %s" % (it.rel_path, e), file=sys.stderr)
            continue
        out.append({"id": idx, "rel_path": it.rel_path, "abs_path": it.abs_path,
                    "name": it.name})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seq", type=int, default=280)
    ap.add_argument("--out", required=True)
    ap.add_argument("--selection", default=os.path.join(HERE, "spike_selection.json"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--batch", type=int, default=4)
    args = ap.parse_args()

    if os.path.exists(args.selection):
        with open(args.selection, encoding="utf-8") as fh:
            sel = json.load(fh)
        print("复用选择: %s (%d 张)" % (args.selection, len(sel)))
    else:
        sel = select_items(args.n)
        with open(args.selection, "w", encoding="utf-8") as fh:
            json.dump(sel, fh, ensure_ascii=False, indent=1)
        print("新建选择: %s (%d 张)" % (args.selection, len(sel)))

    paths = [s["abs_path"] for s in sel]
    enc = Encoder(image_seq_length=args.seq)
    _ = enc.model                    # 触发惰性载入（property），载入时已按 seq 设置处理器

    t0 = time.time()
    iv = enc.encode_images(paths, batch=args.batch)
    t_img = time.time() - t0

    t0 = time.time()
    tv = enc.encode_text(TEXTS, is_query=True)
    t_txt = time.time() - t0

    import numpy as np
    def norms(a):
        return [float(x) for x in np.linalg.norm(np.asarray(a, dtype=np.float32), axis=1)]

    result = {
        "runtime": "torch",
        "model_id": G.MODEL_ID,
        "seq": args.seq,
        "dim": int(iv.shape[1]),
        "count": int(iv.shape[0]),
        "image_seconds": round(t_img, 2),
        "image_seconds_per_item": round(t_img / max(1, iv.shape[0]), 3),
        "text_seconds": round(t_txt, 3),
        "image_norms": norms(iv)[:5],
        "text_norms": norms(tv)[:5],
        "query_prefix": "task: search result | query: ",
        "images": [{"rel_path": sel[i]["rel_path"],
                    "vector": [float(x) for x in iv[i]]} for i in range(iv.shape[0])],
        "texts": [{"text": TEXTS[i], "vector": [float(x) for x in tv[i]]}
                  for i in range(tv.shape[0])],
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)
    print("已写 %s  (seq=%d, %d 张图 %.1fs = %.2f s/张, 文本 %.2fs)"
          % (args.out, args.seq, iv.shape[0], t_img, t_img / max(1, iv.shape[0]), t_txt))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""
probe_gpu_speed.py —— 实测 GPU 编码速度与精度选择。

背景：模型卡的规则是 `dtype = torch.bfloat16 if torch.cuda.is_bf16_supported()
else torch.float32`。本机 RTX 2060 是 Turing(sm_75)，**没有原生 bf16 张量核心**，
但 `is_bf16_supported()` 却返回 True。所以必须实测：
  · bf16 在这张卡上是否真能跑、是否更慢、是否出 NaN
  · fp32 作为对照
  · 顺带量一下 GPU 向量与既有 CPU 向量的余弦差（判断索引混建的风险）

用法：python probe_gpu_speed.py [--n 8]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, "model-cache", "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(WORKSPACE, "model-cache", "hf", "hub"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np                                        # noqa: E402
import torch                                              # noqa: E402
from sentence_transformers import SentenceTransformer     # noqa: E402

import gemma_lib as G                                     # noqa: E402

MODEL_ID = G.MODEL_ID
SEQ = 140


def load(dtype, device="cuda"):
    m = SentenceTransformer(
        MODEL_ID, device=device,
        model_kwargs={"torch_dtype": dtype},
        config_kwargs={"audio_config": None})
    m.eval()
    proc = getattr(m, "processor", None)
    if proc is not None and hasattr(proc, "image_seq_length"):
        proc.image_seq_length = SEQ
    return m


def cross(args) -> int:
    """同一进程内分别用 CPU 与 GPU 编码同一批图，直接比余弦。

    这是判断"能否把 GPU 向量与既有 CPU 向量混在一个索引里"的唯一可靠办法：
    若两者几乎一致，混建无害；若差异明显，必须统一重建。
    """
    items = G.find_items()[:args.n]
    paths = [it.abs_path for it in items]
    print("=" * 84)
    print("同进程 CPU vs GPU（fp32，seq={}，{} 张）".format(SEQ, len(paths)))
    print("=" * 84)

    out = {}
    for dev in ("cpu", "cuda"):
        m = load(torch.float32, dev)
        t0 = time.time()
        v = m.encode([{"image": p} for p in paths], normalize_embeddings=True,
                     convert_to_numpy=True, show_progress_bar=False)
        el = time.time() - t0
        out[dev] = np.atleast_2d(np.asarray(v, dtype=np.float32))
        print("  {:<5} {:.2f}s = {:.3f} s/张 | L2={:.4f} | NaN={}".format(
            dev, el, el / len(paths),
            float(np.linalg.norm(out[dev][0])), bool(np.isnan(out[dev]).any())))
        del m
        if dev == "cuda":
            torch.cuda.empty_cache()

    cos = [float(np.dot(out["cpu"][i], out["cuda"][i])) for i in range(len(paths))]
    print("\n  逐张余弦: " + " ".join("{:.4f}".format(c) for c in cos))
    print("  min={:.4f} 均值={:.4f} max={:.4f}".format(min(cos), sum(cos) / len(cos), max(cos)))
    print("  结论: " + ("两设备一致，混建无害" if min(cos) > 0.999
                        else "两设备差异明显 —— 索引必须用单一设备统一重建"))
    return 0


def bench(m, paths, batch, dtype_name):
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    out = []
    for i in range(0, len(paths), batch):
        v = m.encode([{"image": p} for p in paths[i:i + batch]],
                     normalize_embeddings=True, convert_to_numpy=True,
                     show_progress_bar=False)
        out.append(np.atleast_2d(np.asarray(v, dtype=np.float32)))
    el = time.time() - t0
    arr = np.vstack(out)
    peak = torch.cuda.max_memory_allocated() / 1024 ** 3
    return {
        "dtype": dtype_name, "images": len(paths), "seconds": round(el, 2),
        "per_image": round(el / len(paths), 3),
        "nan": bool(np.isnan(arr).any()),
        "norm_ok": bool(np.allclose(np.linalg.norm(arr, axis=1), 1.0, atol=1e-3)),
        "peak_vram_gb": round(peak, 2),
        "vec": arr,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--cross", action="store_true",
                    help="同进程内对比 CPU 与 GPU 对同一批图的向量（排查混建风险）")
    args = ap.parse_args()

    if args.cross:
        return cross(args)

    print("=" * 84)
    print("设备")
    print("=" * 84)
    p = torch.cuda.get_device_properties(0)
    print("  {} | sm_{}{} | {:.1f} GB | bf16_supported={}".format(
        p.name, p.major, p.minor, p.total_memory / 1024 ** 3,
        torch.cuda.is_bf16_supported()))

    items = G.find_items()[:args.n]
    paths = [it.abs_path for it in items]
    print("  样本 {} 张 / batch={} / image_seq_length={}".format(len(paths), args.batch, SEQ))

    results = {}
    for name, dt in (("bfloat16", torch.bfloat16), ("float32", torch.float32)):
        print("\n" + "=" * 84)
        print("测试 {}（加载模型）".format(name))
        print("=" * 84)
        try:
            t0 = time.time()
            m = load(dt)
            print("  载入 {:.1f}s".format(time.time() - t0))
            r = bench(m, paths, args.batch, name)
            print("  {} 张 / {:.1f}s = {:.3f} s/张 | NaN={} | L2正常={} | 峰值显存 {:.2f} GB".format(
                r["images"], r["seconds"], r["per_image"], r["nan"],
                r["norm_ok"], r["peak_vram_gb"]))
            results[name] = r
            del m
            torch.cuda.empty_cache()
        except Exception as e:                              # noqa: BLE001
            print("  失败 {}: {}".format(type(e).__name__, str(e)[:160]))

    # ---- 与既有 CPU 向量比较（判断索引混建风险）----
    if "float32" in results and os.path.isfile(G.EMB_PATH):
        print("\n" + "=" * 84)
        print("GPU 向量 vs 既有 CPU 向量")
        print("=" * 84)
        embs = np.load(G.EMB_PATH)
        items_all = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
        idx = {it["rel_path"]: i for i, it in enumerate(items_all)}
        cos = []
        for it, gv in zip(items, results["float32"]["vec"]):
            j = idx.get(it.rel_path)
            if j is None:
                continue
            cv = embs[j]
            if float(np.linalg.norm(cv)) == 0.0:
                continue                       # 该条在 CPU 索引里还没编
            cos.append(float(np.dot(gv, cv)))
        if cos:
            print("  可比对 {} 张：余弦 min={:.6f} 均值={:.6f} max={:.6f}".format(
                len(cos), min(cos), sum(cos) / len(cos), max(cos)))
            print("  → 差异极小则混建无害；差异大则必须统一重建")
        else:
            print("  这些样本在 CPU 索引里都还没编，无法比对")

    json.dump({k: {kk: vv for kk, vv in v.items() if kk != "vec"}
               for k, v in results.items()},
              open(os.path.join(HERE, "data", "gpu_speed.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("\n已写 data\\gpu_speed.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())

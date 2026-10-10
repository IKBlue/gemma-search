# -*- coding: utf-8 -*-
"""
quality_resize_variants.py —— G-B 诊断 A3b：**换重采样核对等价性的影响**

A3 已把差异定位到重采样实现（不是解码）。本脚本回答工程问题：
**换一个重采样核，能不能显著更接近 torch（旧索引）？**

做法：取尾部最差的 N 张（默认 48，来自 `data/diag/below-0.99.csv`），
对每种核各编码一遍（`onnx-spike/diagnose_resize_kernel.mjs`），
再与**旧索引 `data/embeddings.npy` 的对应行**逐条算余弦（旧索引就是 torch 的产物，
所以不需要再跑 torch —— 3594 条基准一直在盘上）。

判读：若某个核把 min 从 ~0.915 抬到 ≥0.970、中位抬到 ≥0.995，
那就是**一处便宜的修复**，优先于"修改验收判据"。

用法:
  python quality_resize_variants.py [--model <ONNX 模型目录>] [--n 48]
                                    [--kernels baseline,cubic,mitchell,lanczos3]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
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


def cos(a, b):
    import numpy as np
    a = np.asarray(a, dtype="float64")
    b = np.asarray(b, dtype="float64")
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def main() -> int:
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GEMMA_ONNX_MODEL", ""))
    ap.add_argument("--n", type=int, default=48)
    ap.add_argument("--kernels", default="baseline,cubic,mitchell,lanczos3")
    ap.add_argument("--device", default="webgpu")
    ap.add_argument("--cos-csv", default=os.path.join("data", "diag", "below-0.99.csv"))
    ap.add_argument("--out", default=os.path.join("data", "diag", "resize-variants.json"))
    args = ap.parse_args()

    if not args.model or not os.path.isdir(args.model):
        print("✗ 需要 --model <ONNX 模型目录>")
        return 2

    import gemma_lib as G

    diag = os.path.join(ROOT, "data", "diag")
    sample_p = os.path.join(diag, "resize-sample.json")
    out_p = os.path.join(ROOT, args.out)

    rows = list(csv.DictReader(open(os.path.join(ROOT, args.cos_csv), encoding="utf-8-sig")))
    rows = [r for r in rows if (r.get("vector_source") or "native") == "native"]
    rows.sort(key=lambda r: float(r["cos"]))
    sample = rows[:args.n]
    print("=" * 96)
    print("G-B 诊断 A3b · 重采样核 vs torch（旧索引）")
    print("  样本: 尾部最差 %d 张（来自 %s）" % (len(sample), args.cos_csv))
    print("  余弦区间: %.6f ~ %.6f" % (float(sample[0]["cos"]), float(sample[-1]["cos"])))

    with open(sample_p, "w", encoding="utf-8") as fh:
        json.dump([{"rel_path": r["rel_path"],
                    "abs_path": os.path.join(G.LIBRARY_ROOT, r["rel_path"])} for r in sample],
                  fh, ensure_ascii=False, indent=1)

    print()
    print("--- 逐核编码（模型只载入一次）---")
    cmd = ["node", "diagnose_resize_kernel.mjs", "--model", args.model, "--in", sample_p,
           "--out", out_p, "--seq", "140", "--device", args.device, "--kernels", args.kernels]
    r = subprocess.run(cmd, cwd=os.path.join(ROOT, "onnx-spike"), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    for line in (r.stdout or "").strip().splitlines()[-12:]:
        print("  " + line)
    if r.returncode != 0:
        print("  ✗ 失败（退出码 %s）" % r.returncode)
        print((r.stderr or "")[-1500:])
        return 2

    data = json.load(open(out_p, encoding="utf-8"))

    # 旧索引 = torch 基准
    ov = np.load(G.EMB_PATH)
    old_items = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
    old_row = {(it.get("relPath") or it.get("rel_path")): it["idx"] for it in old_items}

    print()
    print("--- 与旧索引（torch）逐条余弦 ---")
    summary = {}
    per_item = {}
    for k in data["kernels"]:
        vecs = data["vectors"].get(k) or {}
        pairs = []
        for rel, v in vecs.items():
            if rel not in old_row:
                continue
            pairs.append((rel, cos(v, ov[old_row[rel]])))
        if not pairs:
            summary[k] = {"n": 0}
            continue
        vals = np.array([c for _, c in pairs])
        summary[k] = {"n": len(pairs), "min": float(vals.min()), "median": float(np.median(vals)),
                      "mean": float(vals.mean()), "below_0.97": int((vals < 0.97).sum())}
        per_item[k] = {rel: c for rel, c in pairs}
        print("  %-10s n=%-3d min=%.6f 中位=%.6f 均值=%.6f  (<0.97 的 %d 条)"
              % (k, len(pairs), vals.min(), float(np.median(vals)), vals.mean(), int((vals < 0.97).sum())))

    # 判读
    print()
    print("--- 判读 ---")
    base = summary.get("baseline") or {}
    verdicts = []
    if base.get("n"):
        best = None
        for k, v in summary.items():
            if not v.get("n") or k == "baseline":
                continue
            gain = v["min"] - base["min"]
            gain_med = v["median"] - base["median"]
            print("  %-10s 相对 baseline: min %+.6f · 中位 %+.6f" % (k, gain, gain_med))
            if v["min"] >= 0.97 and v["median"] >= 0.995:
                verdicts.append("%s 达线（min ≥0.97 且中位 ≥0.995）→ **这是一处便宜的修复**" % k)
            if best is None or v["min"] > best[1]["min"]:
                best = (k, v)
        if best and best[1]["min"] < 0.97:
            verdicts.append("最好的核（%s）min=%.6f 仍 < 0.970 → 换核**不足以**达标，"
                            "要么移植 PIL 的 bicubic（另一件事），要么按总体尾部修订判据"
                            % (best[0], best[1]["min"]))
    for v in verdicts:
        print("  · %s" % v)

    out = {"sample_size": len(sample), "kernels": data["kernels"], "summary": summary,
           "per_item": per_item, "verdicts": verdicts,
           "resize_calls_sample": data.get("resize_calls_sample")}
    os.makedirs(os.path.dirname(os.path.abspath(out_p)), exist_ok=True)
    with open(out_p, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print()
    print("  报告 → %s" % os.path.relpath(out_p, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

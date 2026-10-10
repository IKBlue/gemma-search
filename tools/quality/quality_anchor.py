# -*- coding: utf-8 -*-
"""
quality_anchor.py —— G-B 诊断 A1：**复现性锚定**

要回答的问题（G-B v1 FAIL 之后的第一问）：

    `SPEC-acceptance.md` §2.2 的阈值 ①（最小余弦 ≥ 0.970）依据是
    `spike/ref140.json` vs `spike/onnx140.json` —— **20 张**样本（min 0.9798）。
    全量 3594 张实测 min 0.9153。

    那么 0.9153 是
      (a) **样本组成的必然结果**（n=20 的最小值不能当 3594 的总体下限），还是
      (b) **构建器在 spike 之后发生了回归**（真 bug）？

方法：造一个**只含那 20 张**的夹具库，用**当前**构建器重编，做 4 路比对：

  P1  当前构建器   vs  存盘的 spike ONNX 向量（onnx140_gpu.json）
  P2  当前构建器   vs  存盘的 torch 基准（ref140.json）
  P3  现跑的 spike vs  存盘的 spike ONNX 向量   ← 环境/运行时是否漂移
  P4  现跑的 spike vs  存盘的 torch 基准        ← 能否复现 0.9798 这个数

判读：
  · P3 接近 1.0 → 环境没变，后面几路的差异就不能赖环境
  · P1 明显低于 P3 → **构建器与 spike 的编码路径不同**（可定位、可修）
  · P2 复现 ≈0.9798 → 阈值推导无误，0.9153 属总体尾部 → 判据需按总体重定
  · P2 明显低于 0.9798 → 我们自己的路径退化，先修再谈判据

全程**只读**素材库，只写 `data/diag/`；不触碰 `data/*.npy` 与 `data/idx-full`。

用法:
  python quality_anchor.py [--model <ONNX 模型目录>] [--out data/diag/anchor.json]
                           [--device webgpu] [--seq 140] [--rebuild] [--skip-fixture-build]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
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
import index_bin  # noqa: E402


def run(cmd: list[str], cwd: str, label: str) -> None:
    """跑子进程；失败时把尾部输出打出来（不要吞掉 stderr，这是本项目踩过的坑）。"""
    print("  $ %s" % " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    for line in (r.stdout or "").strip().splitlines()[-6:]:
        print("      %s" % line)
    if r.returncode != 0:
        print("  ✗ %s 失败（退出码 %s）" % (label, r.returncode))
        print((r.stderr or "")[-1500:])
        raise SystemExit(2)


def cosine(a, b):
    import numpy as np
    a = np.asarray(a, dtype="float64")
    b = np.asarray(b, dtype="float64")
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return float("nan")
    return float(a @ b / (na * nb))


def summarize(name: str, pairs: list[tuple[str, float]]) -> dict:
    import numpy as np
    vals = np.array([c for _, c in pairs], dtype="float64")
    out = {"n": len(vals), "min": float(vals.min()), "median": float(np.median(vals)),
           "max": float(vals.max()), "mean": float(vals.mean())}
    print("  %-34s n=%-3d  min=%.6f  中位=%.6f  max=%.6f"
          % (name, out["n"], out["min"], out["median"], out["max"]))
    for rel, c in sorted(pairs, key=lambda kv: kv[1])[:3]:
        print("        最差: %-40s %.6f" % (rel[:40], c))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GEMMA_ONNX_MODEL", ""))
    ap.add_argument("--out", default=os.path.join("data", "diag", "anchor.json"))
    ap.add_argument("--device", default="webgpu")
    ap.add_argument("--seq", type=int, default=140)
    ap.add_argument("--rebuild", action="store_true", help="夹具库索引强制重编（默认也重编，保证干净）")
    ap.add_argument("--skip-fixture-build", action="store_true", help="复用已有夹具索引，不重跑构建器")
    args = ap.parse_args()

    if not args.model or not os.path.isdir(args.model):
        print("✗ 需要 --model <ONNX 模型目录>（内含 onnx/model.onnx）")
        return 2

    sel_path = os.path.join(ROOT, "spike", "spike_selection.json")
    ref_torch = os.path.join(ROOT, "spike", "ref140.json")
    ref_spike_gpu = os.path.join(ROOT, "spike", "onnx140_gpu.json")
    ref_spike_cpu = os.path.join(ROOT, "spike", "onnx140.json")
    for p in (sel_path, ref_torch, ref_spike_gpu):
        if not os.path.exists(p):
            print("✗ 缺基准文件: %s" % p)
            return 2

    diag = os.path.join(ROOT, "data", "diag")
    fixture = os.path.join(diag, "lib-spike20")
    fixture_idx = os.path.join(diag, "idx-spike20")
    spike_now = os.path.join(diag, "spike20-now.json")
    os.makedirs(diag, exist_ok=True)

    sel = json.load(open(sel_path, encoding="utf-8"))
    print("=" * 96)
    print("G-B 诊断 A1 · 复现性锚定")
    print("  样本: %s（%d 张）" % (os.path.relpath(sel_path, ROOT), len(sel)))
    print("  模型: %s" % args.model)
    print("  设备: %s · seq=%d" % (args.device, args.seq))

    # ---------- 1) 夹具库：只含这 20 张（保持原相对路径），包用占位 .zip ----------
    print()
    print("--- 1) 夹具库 %s ---" % os.path.relpath(fixture, ROOT))
    n_img = 0
    for s in sel:
        rel = s["rel_path"]
        dst = os.path.join(fixture, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            shutil.copy2(s["abs_path"], dst)
        stem = os.path.splitext(os.path.basename(rel))[0]
        arc = os.path.join(os.path.dirname(dst), stem + ".zip")
        if not os.path.exists(arc):
            open(arc, "wb").close()          # 配对只需要存在；构建器不解析包内容
        n_img += 1
    print("  %d 张已就位（含同名占位包；构建器不解析包内容）" % n_img)

    # ---------- 2) 当前构建器：只编这 20 条 ----------
    if not args.skip_fixture_build:
        print()
        print("--- 2) 当前构建器 build_index_onnx.mjs ---")
        run(["node", "build_index_onnx.mjs", "--model", args.model, "--lib", fixture,
             "--out", fixture_idx, "--seq", str(args.seq), "--device", args.device,
             "--lib-id", "L1", "--rebuild"],
            cwd=os.path.join(ROOT, "onnx-spike"), label="build_index_onnx.mjs")

    header, vecs = index_bin.read_index_bin(os.path.join(fixture_idx, "index.bin"))
    items = index_bin.read_items(os.path.join(fixture_idx, "items.json"))
    print("  夹具索引: count=%d dim=%d" % (header["count"], header["dim"]))
    now_by_rel = {}
    for it in items:
        rel = it.get("relPath") or it.get("rel_path")
        now_by_rel[rel] = vecs[it["vectorRow"]]

    # ---------- 3) 现跑 spike（.mjs 原样，不改）----------
    print()
    print("--- 3) spike_onnx.mjs（现跑，检验环境是否漂移）---")
    run(["node", "spike_onnx.mjs", args.model, str(args.seq), spike_now,
         sel_path, args.device],
        cwd=os.path.join(ROOT, "onnx-spike"), label="spike_onnx.mjs")
    spike_now_data = json.load(open(spike_now, encoding="utf-8"))
    spike_now_by_rel = {x["rel_path"]: x["vector"] for x in spike_now_data["images"]}

    # ---------- 4) 四路比对 ----------
    print()
    print("--- 4) 逐条余弦 ---")
    torch = {x["rel_path"]: x["vector"] for x in json.load(open(ref_torch, encoding="utf-8"))["images"]}
    spike_gpu = {x["rel_path"]: x["vector"] for x in json.load(open(ref_spike_gpu, encoding="utf-8"))["images"]}
    spike_cpu = {x["rel_path"]: x["vector"] for x in json.load(open(ref_spike_cpu, encoding="utf-8"))["images"]}

    rels = [s["rel_path"] for s in sel]
    missing = [r for r in rels if r not in now_by_rel]
    if missing:
        print("  ⚠ 夹具索引缺 %d 条: %s" % (len(missing), missing[:3]))

    p1 = [(r, cosine(now_by_rel[r], spike_gpu[r])) for r in rels if r in now_by_rel]
    p2 = [(r, cosine(now_by_rel[r], torch[r])) for r in rels if r in now_by_rel]
    p3 = [(r, cosine(spike_now_by_rel[r], spike_gpu[r])) for r in rels if r in spike_now_by_rel]
    p4 = [(r, cosine(spike_now_by_rel[r], torch[r])) for r in rels if r in spike_now_by_rel]
    p5 = [(r, cosine(spike_gpu[r], spike_cpu[r])) for r in rels if r in spike_gpu and r in spike_cpu]

    res = {
        "P1_builder_now_vs_spike_gpu": summarize("P1 当前构建器 vs spike(GPU)", p1),
        "P2_builder_now_vs_torch": summarize("P2 当前构建器 vs torch", p2),
        "P3_spike_now_vs_spike_gpu": summarize("P3 现跑 spike vs 存盘 spike(GPU)", p3),
        "P4_spike_now_vs_torch": summarize("P4 现跑 spike vs torch", p4),
        "P5_spike_gpu_vs_spike_cpu": summarize("P5 spike(GPU) vs spike(CPU)", p5),
    }

    # ---------- 5) 判读 ----------
    print()
    print("--- 5) 判读 ---")
    tol = 1e-6
    if res["P3_spike_now_vs_spike_gpu"]["min"] > 1.0 - tol:
        print("  · P3 ≈ 1.0 → 环境与依赖未变（现跑与存盘逐位一致）")
    else:
        print("  · ⚠ P3 min=%.6f < 1.0 → 环境/依赖已漂移，P1/P2 的解释要打折扣"
              % res["P3_spike_now_vs_spike_gpu"]["min"])
    d_builder_vs_spike = res["P3_spike_now_vs_spike_gpu"]["median"] - res["P1_builder_now_vs_spike_gpu"]["median"]
    print("  · 构建器相对 spike 的额外偏离（中位差）= %.6f" % d_builder_vs_spike)
    if abs(d_builder_vs_spike) < 1e-4:
        print("    → 构建器与 spike 的编码路径**等价**：没有回归")
    else:
        print("    → 构建器与 spike **不等价**：编码路径有差异，可定位（见 P1 最差条目）")
    m2 = res["P2_builder_now_vs_torch"]["min"]
    print("  · SPEC 阈值依据 min=0.9798（spike 20 张 vs torch）；本次同 20 张实测 min=%.6f" % m2)
    if m2 >= 0.9798 - 0.002:
        print("    → **复现成功**：0.9798 无误，全量的 0.9153 属总体尾部（n=20 推不出总体下限）")
    else:
        print("    → **未复现**：我们的路径比 spike 时更远离 torch，先修编码器再谈判据")

    out_p = os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out_p), exist_ok=True)
    with open(out_p, "w", encoding="utf-8") as fh:
        json.dump({"sample_size": len(sel), "device": args.device, "seq": args.seq,
                   "model_dir": args.model, "fixture": os.path.relpath(fixture, ROOT),
                   "summary": res,
                   "per_item": {"rel_paths": rels,
                                "P1": [c for _, c in p1], "P2": [c for _, c in p2],
                                "P3": [c for _, c in p3], "P4": [c for _, c in p4],
                                "P5": [c for _, c in p5]},
                   "spike_now_meta": {k: spike_now_data.get(k) for k in
                                      ("runtime", "device", "package_version", "image_seconds_per_item")},
                   "fixture_header": {"count": header["count"], "dim": header["dim"],
                                      "compat": header.get("compat")}},
                  fh, ensure_ascii=False, indent=1)
    print()
    print("  报告 → %s" % os.path.relpath(out_p, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())

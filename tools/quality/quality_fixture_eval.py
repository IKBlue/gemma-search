# -*- coding: utf-8 -*-
r"""
quality_fixture_eval.py —— 用**真实构建器**跑一个小夹具库，快速判定等价性

为什么需要它（而不是跑全量 25 分钟）：
  改动预处理后要先有一个**分钟级**的回归检查。本脚本把选出的 N 张素材复制成夹具库
  （同目录同名主干 + 占位包），用**构建器本体**（含 resize_compat、BMP 回退、UID 规则）
  编一遍，再与旧索引 `data/embeddings.npy`（torch 基准）逐条比余弦。

  · 覆盖的是**整条写入路径**，不是"某一段逻辑"——诊断脚本（diagnose_resize_kernel.mjs）
    只覆盖重采样那一点，不能替代这个。
  · 夹具体积小（每张 ~0.5 MB）、可重复、不碰 `G:\model`、不碰 `data/idx-full`。

选择方式（--select）：
  worst     尾部最差（默认，来自 data/diag/below-0.99.csv）—— 回归最容易暴露的地方
  smallest  像素数最小的一批（走**放大**方向，验证 pil-like 的另一半）
  largest   像素数最大的一批
  random    固定种子的随机抽样（代表性）

用法:
  python quality_fixture_eval.py --model <ONNX 模型目录> [--select worst] [--n 48]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import shutil
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

MIN_COS = 0.700          # 与 SPEC-acceptance §2.2 保持一致（2026-10-10 由 0.970 下调）
MED_COS = 0.990


def load_dims(lib_root: str, rels: list[str], cache_p: str) -> dict:
    """像素尺寸缓存（扫全库一次约 1 分钟，之后复用）。"""
    cache = {}
    if os.path.exists(cache_p):
        cache = json.load(open(cache_p, encoding="utf-8"))
    missing = [r for r in rels if r not in cache]
    if missing:
        from PIL import Image
        print("  扫描尺寸（%d 条，首次较慢）…" % len(missing))
        for i, r in enumerate(missing, 1):
            try:
                with Image.open(os.path.join(lib_root, r)) as im:
                    cache[r] = [im.size[0], im.size[1]]
            except Exception:  # noqa: BLE001
                cache[r] = None
            if i % 500 == 0:
                print("    %d/%d" % (i, len(missing)))
        os.makedirs(os.path.dirname(cache_p), exist_ok=True)
        with open(cache_p, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
    return cache


def main() -> int:
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GEMMA_ONNX_MODEL", ""))
    ap.add_argument("--n", type=int, default=48)
    ap.add_argument("--select", default="worst", choices=["worst", "smallest", "largest", "random"])
    ap.add_argument("--device", default="webgpu")
    ap.add_argument("--keep-fixture", action="store_true", help="保留夹具库（默认保留，见下）")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    if not args.model or not os.path.isdir(args.model):
        print("✗ 需要 --model <ONNX 模型目录>")
        return 2

    import gemma_lib as G

    diag = os.path.join(ROOT, "data", "diag")
    cos_csv = os.path.join(diag, "cos-all.csv")
    if not os.path.exists(cos_csv):
        print("✗ 缺 %s —— 先跑 quality_vector_equiv.py --all-csv" % cos_csv)
        return 2

    rows = [r for r in csv.DictReader(open(cos_csv, encoding="utf-8-sig"))
            if (r.get("vector_source") or "native") == "native"]
    print("=" * 96)
    print("夹具库等价性快速评估（真实构建器 · 与旧索引=torth 基准比）")
    print("  候选池 %d 条 · 选择方式 %s · n=%d" % (len(rows), args.select, args.n))

    if args.select == "worst":
        rows.sort(key=lambda r: float(r["cos"]))
        sample = rows[:args.n]
        desc = "余弦 %.6f ~ %.6f" % (float(sample[0]["cos"]), float(sample[-1]["cos"]))
    else:
        dims = load_dims(G.LIBRARY_ROOT, [r["rel_path"] for r in rows],
                         os.path.join(diag, "image-dims.json"))
        have = [r for r in rows if dims.get(r["rel_path"])]
        for r in have:
            w, h = dims[r["rel_path"]]
            r["mp"] = w * h / 1e6
        if args.select == "smallest":
            have.sort(key=lambda r: r["mp"])
        elif args.select == "largest":
            have.sort(key=lambda r: -r["mp"])
        else:
            random.Random(20261010).shuffle(have)
        sample = have[:args.n]
        desc = "百万像素 %.3f ~ %.3f" % (sample[0]["mp"], sample[-1]["mp"])
    print("  样本: %s" % desc)

    fixture = os.path.join(diag, "lib-%s-%d" % (args.select, args.n))
    fixture_idx = os.path.join(diag, "idx-%s-%d" % (args.select, args.n))
    if os.path.isdir(fixture):
        shutil.rmtree(fixture)
    n_img = 0
    for r in sample:
        rel = r["rel_path"]
        dst = os.path.join(fixture, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(G.LIBRARY_ROOT, rel), dst)
        stem = os.path.splitext(os.path.basename(rel))[0]
        open(os.path.join(os.path.dirname(dst), stem + ".zip"), "wb").close()
        n_img += 1
    print("  夹具库 %s（%d 张 + 占位包）" % (os.path.relpath(fixture, ROOT), n_img))

    print()
    print("--- 构建器 ---")
    env = dict(os.environ)
    if os.environ.get("GEMMA_GPU_MODEL"):
        env["GEMMA_GPU_MODEL"] = os.environ["GEMMA_GPU_MODEL"]
    cmd = ["node", "build_index_onnx.mjs", "--model", args.model, "--lib", fixture,
           "--out", fixture_idx, "--seq", "140", "--device", args.device,
           "--lib-id", "L1", "--rebuild"]
    p = subprocess.run(cmd, cwd=os.path.join(ROOT, "onnx-spike"), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    for line in (p.stdout or "").strip().splitlines():
        print("  " + line)
    if p.returncode != 0:
        print("  ✗ 构建失败（%s）" % p.returncode)
        print((p.stderr or "")[-2000:])
        return 2

    import index_bin
    header, vecs = index_bin.read_index_bin(os.path.join(fixture_idx, "index.bin"))
    items = index_bin.read_items(os.path.join(fixture_idx, "items.json"))
    meta = json.load(open(os.path.join(fixture_idx, "meta.json"), encoding="utf-8"))

    ov = np.load(G.EMB_PATH)
    old_items = json.load(open(G.ITEMS_PATH, encoding="utf-8"))
    old_row = {(it.get("relPath") or it.get("rel_path")): it["idx"] for it in old_items}

    pairs = []
    for it in items:
        rel = it.get("relPath") or it.get("rel_path")
        if rel in old_row:
            a = vecs[it["vectorRow"]]
            b = ov[old_row[rel]]
            pairs.append((rel, float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))))
    v = np.array([c for _, c in pairs])
    print()
    print("--- 与旧索引（torch）逐条余弦 ---")
    print("  n=%d  min=%.6f  中位=%.6f  均值=%.6f  (<0.97 的 %d 条 · <0.99 的 %d 条)"
          % (len(v), v.min(), float(np.median(v)), v.mean(),
             int((v < 0.97).sum()), int((v < 0.99).sum())))
    for rel, c in sorted(pairs, key=lambda kv: kv[1])[:5]:
        print("    最差: %-40s %.6f" % (rel[:40], c))

    ok = bool(v.min() >= MIN_COS and float(np.median(v)) >= MED_COS)
    print()
    print("  判据: min ≥ %.3f 且 中位 ≥ %.3f  →  %s" % (MIN_COS, MED_COS, "PASS" if ok else "FAIL"))
    print("  compat: %s" % header.get("compat"))
    print("  preprocessing: %s" % json.dumps(meta.get("preprocessing"), ensure_ascii=False))
    print("  bmpFallbackUsed=%s · vectorSource 分布=%s"
          % (meta.get("bmpFallbackUsed"),
             {s: sum(1 for i in items if i.get("vectorSource") == s)
              for s in set(i.get("vectorSource") for i in items)}))

    out_p = args.out or os.path.join(diag, "fixture-eval-%s.json" % args.select)
    with open(out_p, "w", encoding="utf-8") as fh:
        json.dump({"select": args.select, "n": len(pairs), "min": float(v.min()),
                   "median": float(np.median(v)), "mean": float(v.mean()),
                   "below_0.97": int((v < 0.97).sum()), "below_0.99": int((v < 0.99).sum()),
                   "pass": ok, "compat": header.get("compat"),
                   "preprocessing": meta.get("preprocessing"),
                   "items": [{"rel_path": r, "cos": c} for r, c in pairs]},
                  fh, ensure_ascii=False, indent=1)
    print("  报告 → %s" % os.path.relpath(out_p, ROOT))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

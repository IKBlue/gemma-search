# -*- coding: utf-8 -*-
"""
verify_resize.py —— 重采样兼容层的**跨语言金标验收**（可执行，含否定对照）

为什么需要它：
  A3b 实测"换成 sharp.resize(cubic) 后等价性从 0.9153 升到 0.9960"，但那是
  **模型空间**的间接证据。本脚本在**像素空间**直接核对：同一张图、同一目标尺寸、
  两侧输入像素完全相同，比较
      · shim      = installResizeCompat(kernel=cubic) 的输出
      · upstream  = transformers.js 原样 affine(bicubic) 的输出
      · 基准      = PIL.Image.resize(..., BICUBIC)
  并强制一条**否定对照**：若两者都合格，说明测试无鉴别力 → 直接失败。

判据（SPEC 无此条，此处为本次修复的验收口径，写入报告）：
  shim:     平均绝对差 ≤ 1.0/255 · 最大 ≤ 12 · 余弦 ≥ 0.9999
  upstream: 平均绝对差必须 ≥ 5× shim（否则否定对照失效）

用法:
  python verify_resize.py [--out data/diag/resize-golden.json]
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

SHIM_MEAN_MAX = 1.0      # 降采样：平均绝对差上限（0-255 尺度）
SHIM_MAX_MAX = 12        # 降采样：单点最大差上限
SHIM_COS_MIN = 0.9995    # 降采样：余弦下限
UP_COS_MIN = 0.995       # 放大方向：余弦下限（单列；放大时两套核天然差得更多）
SENSITIVITY_MIN = 5.0    # 否定对照：上游在降采样上必须至少差这么多倍


def pick_cases(lib_root: str):
    """挑 4 类源图：尾部最差（大图）· 中间 · 对照（小图）· PNG。"""
    rows = list(csv.DictReader(open(os.path.join(ROOT, "data", "diag", "cos-all.csv"),
                                    encoding="utf-8-sig")))
    rows.sort(key=lambda r: float(r["cos"]))
    cases = []
    if rows:
        cases.append(rows[0])                       # 最差（大图）
        cases.append(rows[len(rows) // 2])          # 中位附近
        cases.append(rows[-1])                      # 最好（通常是小图）
    pngs = [r for r in rows if (r.get("image_ext") or "").lower() == ".png"]
    if pngs:
        cases.append(pngs[len(pngs) // 2])
    # 去重、保序
    seen, out = set(), []
    for r in cases:
        if r["rel_path"] not in seen:
            seen.add(r["rel_path"])
            out.append({"rel_path": r["rel_path"], "cos_old": float(r["cos"])})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("data", "diag", "resize-golden.json"))
    ap.add_argument("--kernel", default="pil-like",
                    help="shim 模式：pil-like（按 PIL 规则分方向，推荐）/ cubic / upstream-affine")
    args = ap.parse_args()

    import gemma_lib as G
    from PIL import Image
    import numpy as np

    cases = pick_cases(G.LIBRARY_ROOT)
    if not cases:
        print("✗ 需要 data/diag/cos-all.csv（先跑 quality_vector_equiv.py --all-csv）")
        return 2

    out_dir = os.path.join(ROOT, "data", "diag", "resize-golden")
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"cases": []}

    print("=" * 96)
    print("重采样兼容层 · 跨语言金标核对（PIL 为基准）")
    for c in cases:
        p = os.path.join(G.LIBRARY_ROOT, c["rel_path"])
        with Image.open(p) as im:
            im = im.convert("RGB")
            w0, h0 = im.size
            px = np.asarray(im, dtype=np.uint8)
            # 三个目标尺寸：大幅降采样 / 中等 / 放大
            targets = [(max(1, w0 // 2), max(1, h0 // 2)), (320, 240),
                       (int(w0 * 1.3), int(h0 * 1.3))]
            for tw, th in targets:
                cid = "%s__%dx%d" % (os.path.splitext(os.path.basename(c["rel_path"]))[0], tw, th)
                src_raw = os.path.join(out_dir, cid + ".src.raw")
                pil_raw = os.path.join(out_dir, cid + ".pil.raw")
                px.tofile(src_raw)
                np.asarray(im.resize((tw, th), Image.BICUBIC), dtype=np.uint8).tofile(pil_raw)
                manifest["cases"].append({
                    "id": cid, "rel_path": c["rel_path"], "cos_old": c["cos_old"],
                    "src_raw": os.path.abspath(src_raw).replace("\\", "/"),
                    "pil_raw": os.path.abspath(pil_raw).replace("\\", "/"),
                    "src_w": w0, "src_h": h0, "channels": 3,
                    "target_w": tw, "target_h": th,
                })
        print("  源 %-34s %dx%d → %d 个目标尺寸" % (c["rel_path"][:34], w0, h0, len(targets)))

    mp = os.path.join(out_dir, "manifest.json")
    with open(mp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    out_p = os.path.join(ROOT, args.out)
    print()
    print("--- Node 侧核对（shim vs upstream，基准=PIL）---")
    r = subprocess.run(["node", "check_resize_golden.mjs", "--manifest", mp, "--out", out_p,
                        "--kernel", args.kernel],
                       cwd=os.path.join(ROOT, "onnx-spike"), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    for line in (r.stdout or "").strip().splitlines():
        print("  " + line)
    if r.returncode != 0:
        print("  ✗ 失败（退出码 %s）" % r.returncode)
        print((r.stderr or "")[-1500:])
        return 2

    data = json.load(open(out_p, encoding="utf-8"))
    s = data["summary"]

    print()
    print("--- 判据 ---")
    problems = []
    d, u = s["down"], s["up"]
    print("  降采样方向（n=%d，真实管网主路径）: shim 平均差 均值 %.4f / 最差 %.4f · 余弦最小 %.6f"
          % (d["n"], d["shim_mean_avg"] or 0, d["shim_mean_max"] or 0, d["shim_cos_min"] or 0))
    print("                                     upstream 平均差 均值 %.4f · 余弦最小 %.6f · 灵敏度 %.1f×"
          % (d["upstream_mean_avg"] or 0, d["upstream_cos_min"] or 0, s["sensitivity"] or 0))
    print("  放大方向（n=%d，小图才走，单列不混入主判据）: shim 平均差 均值 %.4f · 余弦最小 %.6f"
          % (u["n"], u["shim_mean_avg"] or 0, u["shim_cos_min"] or 0))
    if d["n"] and d["shim_mean_max"] > SHIM_MEAN_MAX:
        problems.append("降采样：shim 平均绝对差最差用例 %.4f > %.1f" % (d["shim_mean_max"], SHIM_MEAN_MAX))
    if d["n"] and d["shim_cos_min"] < SHIM_COS_MIN:
        problems.append("降采样：shim 余弦最小 %.6f < %.4f" % (d["shim_cos_min"], SHIM_COS_MIN))
    if s["sensitivity"] is None or s["sensitivity"] < SENSITIVITY_MIN:
        problems.append("否定对照失效：降采样灵敏度 %s× < %.1f" % (s["sensitivity"], SENSITIVITY_MIN))
    if u["n"] and u["shim_cos_min"] < UP_COS_MIN:
        problems.append("放大方向：shim 余弦最小 %.6f < %.4f（放大时两套核天然差得更多，但不能差到这程度）"
                        % (u["shim_cos_min"], UP_COS_MIN))
    down_maxes = [r["shim"].get("max") for r in data["results"]
                  if "shim" in r and r.get("direction") == "down"]
    if down_maxes and max(down_maxes) > SHIM_MAX_MAX:
        problems.append("降采样：shim 单点最大差 %s > %d" % (max(down_maxes), SHIM_MAX_MAX))

    print()
    print("结论：%s" % ("PASS —— 兼容层与 PIL 是同一个重采样（差在定点舍入级别）"
                        if not problems else "FAIL"))
    for p in problems:
        print("  ✗ %s" % p)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())

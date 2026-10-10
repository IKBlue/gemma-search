# -*- coding: utf-8 -*-
"""
quality_tail_attrib.py —— G-B 诊断 A2：**尾部属性归因**

契约来源：`SPEC-acceptance.md` §2.2
    「余弦 < 0.99 的条目：**列出清单**并逐条说明（含该条的图像格式、尺寸、是否属异常文件）」

A1 已证明：当前构建器与 spike 编码路径**逐位等价**、环境未漂移、阈值依据（20 张 min 0.9798）
可逐位复现。所以 0.9153 只能是**总体尾部**。本脚本回答"尾部是什么"：

  组 T（tail）  cos < 0.97        —— SPEC 的"硬底线以下"
  组 M（mid）   0.97 ≤ cos < 0.99
  组 C（ctrl）  cos ≥ 0.999       —— 几乎逐位一致的对照组
  组 B（bmp）   vectorSource ≠ native —— SPEC §2.2 豁免条款要求**单独分组给数**

对每组统计：尺寸/百万像素、格式、色彩模式、EXIF 方向（是否需转正）、JPEG 采样方式，
以及一个**高频度代理**（灰度相邻像素平均绝对差，按缩略后尺寸归一）——
用来检验"大尺寸/高细节图在两种重采样实现下差异更大"这一假设。

只读素材库；输出 `data/diag/tail-attrib.json` + `.md`。

用法:
  python quality_tail_attrib.py [--cos-csv data/diag/cos-all.csv] [--out data/diag/tail-attrib.json]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from collections import Counter

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


def med(xs):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    n = len(xs)
    return float(xs[n // 2]) if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2.0


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    i = min(len(xs) - 1, max(0, int(round(q / 100.0 * (len(xs) - 1)))))
    return float(xs[i])


def hf_score(path: str) -> float:
    """高频度代理：缩到 256 宽后，灰度相邻像素平均绝对差（0-255 尺度）。
    不用原分辨率 —— 否则量的是尺寸而不是细节密度。"""
    import numpy as np
    from PIL import Image
    with Image.open(path) as im:
        g = im.convert("L")
        g = g.resize((256, 256), Image.BILINEAR)
        a = np.asarray(g, dtype="float32")
    dx = np.abs(np.diff(a, axis=1)).mean()
    dy = np.abs(np.diff(a, axis=0)).mean()
    return float((dx + dy) / 2.0)


def props(path: str, want_hf: bool) -> dict:
    from PIL import Image, ImageOps
    out = {"ok": False}
    try:
        with Image.open(path) as im:
            out["w"], out["h"] = im.size
            out["mode"] = im.mode
            out["format"] = im.format
            out["megapixels"] = round(im.size[0] * im.size[1] / 1e6, 3)
            out["aspect"] = round(max(im.size) / max(1, min(im.size)), 3)
            out["bytes"] = os.path.getsize(path)
            try:
                ex = im.getexif()
                out["orientation"] = ex.get(274, 1)
                out["has_exif"] = len(ex) > 0
            except Exception:  # noqa: BLE001
                out["orientation"], out["has_exif"] = 1, False
            try:
                out["needs_rotate"] = ImageOps.exif_transpose(im).size != im.size
            except Exception:  # noqa: BLE001
                out["needs_rotate"] = None
            try:
                from PIL import JpegImagePlugin
                out["jpeg_sampling"] = JpegImagePlugin.get_sampling(im) if im.format == "JPEG" else None
            except Exception:  # noqa: BLE001
                out["jpeg_sampling"] = None
            out["progressive"] = bool(im.info.get("progressive"))
        if want_hf:
            out["hf"] = round(hf_score(path), 3)
        out["ok"] = True
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)
    return out


def summarize(name: str, rows: list[dict]) -> dict:
    ok = [r for r in rows if r.get("ok")]
    if not ok:
        return {"n": 0}
    mp = [r["megapixels"] for r in ok]
    hfs = [r["hf"] for r in ok if "hf" in r]
    d = {
        "n": len(ok),
        "megapixels": {"median": round(med(mp), 3), "p90": round(pct(mp, 90), 3), "max": round(max(mp), 3)},
        "share_gt_1mp": round(sum(1 for x in mp if x > 1.0) / len(mp), 3),
        "share_gt_3mp": round(sum(1 for x in mp if x > 3.0) / len(mp), 3),
        "bytes_median": int(med([r["bytes"] for r in ok])),
        "format": dict(Counter(r["format"] for r in ok).most_common()),
        "mode": dict(Counter(r["mode"] for r in ok).most_common()),
        "needs_rotate": dict(Counter(str(r["needs_rotate"]) for r in ok).most_common()),
        "orientation": dict(Counter(str(r["orientation"]) for r in ok).most_common()),
        "aspect_median": round(med([r["aspect"] for r in ok]), 3),
        "aspect_max": round(max(r["aspect"] for r in ok), 3),
        "jpeg_sampling": dict(Counter(str(r["jpeg_sampling"]) for r in ok).most_common()),
        "progressive_share": round(sum(1 for r in ok if r["progressive"]) / len(ok), 3),
    }
    if hfs:
        d["hf"] = {"median": round(med(hfs), 3), "p90": round(pct(hfs, 90), 3), "max": round(max(hfs), 3)}
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cos-csv", default=os.path.join(ROOT, "data", "diag", "cos-all.csv"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "diag", "tail-attrib.json"))
    ap.add_argument("--lib", default="")
    ap.add_argument("--ctrl-n", type=int, default=200, help="对照组抽样条数（>0.999）")
    ap.add_argument("--tl", type=int, default=30, help="尾部逐条打印条数")
    args = ap.parse_args()

    if not os.path.exists(args.cos_csv):
        print("✗ 缺 %s —— 先跑 quality_vector_equiv.py --all-csv" % args.cos_csv)
        print("  （本项目不允许各脚本自己写第二份 index↔旧索引的 join 逻辑）")
        return 2

    if args.lib:
        lib = args.lib
    else:
        import gemma_lib as G
        lib = G.LIBRARY_ROOT

    rows = list(csv.DictReader(open(args.cos_csv, encoding="utf-8-sig")))
    for r in rows:
        r["cos"] = float(r["cos"])
    rows.sort(key=lambda r: r["cos"])
    print("=" * 96)
    print("G-B 诊断 A2 · 尾部属性归因")
    print("  素材库: %s" % lib)
    print("  逐条余弦: %s（%d 条）" % (os.path.relpath(args.cos_csv, ROOT), len(rows)))

    tail = [r for r in rows if r["cos"] < 0.97]
    mid = [r for r in rows if 0.97 <= r["cos"] < 0.99]
    bmp = [r for r in rows if (r.get("vector_source") or "native") != "native"]
    ctrl_all = [r for r in rows if r["cos"] >= 0.999]
    step = max(1, len(ctrl_all) // max(1, args.ctrl_n))
    ctrl = ctrl_all[::step][:args.ctrl_n]
    print("  组 T cos<0.97: %d · 组 M 0.97~0.99: %d · 组 C cos≥0.999: %d（抽 %d）· 组 B bmp回退: %d"
          % (len(tail), len(mid), len(ctrl_all), len(ctrl), len(bmp)))

    def collect(group, want_hf):
        out = []
        for r in group:
            p = os.path.join(lib, r["rel_path"])
            pr = props(p, want_hf)
            pr["cos"] = r["cos"]
            pr["rel_path"] = r["rel_path"]
            out.append(pr)
        return out

    print()
    print("--- 取属性（组 T/C 含高频度代理）---")
    g_t = collect(tail, True)
    g_c = collect(ctrl, True)
    g_m = collect(mid, False)
    g_b = collect(bmp, True)

    summ = {
        "T_tail_cos_lt_0.97": summarize("T tail", g_t),
        "M_mid_0.97_0.99": summarize("M mid", g_m),
        "C_control_cos_ge_0.999": summarize("C ctrl", g_c),
        "B_bmp_fallback": summarize("B bmp", g_b),
    }

    print()
    for k, v in summ.items():
        print("=== %s (n=%d) ===" % (k, v.get("n", 0)))
        if not v.get("n"):
            continue
        print("  百万像素: 中位 %.2f · p90 %.2f · max %.2f  （>1MP %.0f%% · >3MP %.0f%%）"
              % (v["megapixels"]["median"], v["megapixels"]["p90"], v["megapixels"]["max"],
                 100 * v["share_gt_1mp"], 100 * v["share_gt_3mp"]))
        print("  字节中位 %s · 长宽比 中位 %.2f max %.2f" % (v["bytes_median"], v["aspect_median"], v["aspect_max"]))
        print("  格式 %s" % v["format"])
        print("  模式 %s · JPEG 采样 %s · 渐进式 %.0f%%" % (v["mode"], v["jpeg_sampling"], 100 * v["progressive_share"]))
        print("  EXIF 方向 %s · 需转正 %s" % (v["orientation"], v["needs_rotate"]))
        if "hf" in v:
            print("  高频度代理: 中位 %.2f · p90 %.2f · max %.2f" % (v["hf"]["median"], v["hf"]["p90"], v["hf"]["max"]))

    # ---------- 判读 ----------
    print()
    print("--- 判读 ---")
    t, c = summ["T_tail_cos_lt_0.97"], summ["C_control_cos_ge_0.999"]
    verdicts = []
    if t.get("n") and c.get("n"):
        rt = t["megapixels"]["median"] / max(1e-9, c["megapixels"]["median"])
        rh = (t.get("hf", {}).get("median", float("nan")) / max(1e-9, c.get("hf", {}).get("median", float("nan"))))
        print("  尾部/对照组 百万像素中位比 = %.2f×；高频度中位比 = %.2f×" % (rt, rh))
        if rt > 1.3:
            verdicts.append("尾部集中在**更大的图**上（%.2f×）→ 差异与重采样比例相关" % rt)
        if rh > 1.05:
            verdicts.append("尾部**细节密度更高**（%.2f×）→ 与重采样滤波器的差异一致" % rh)
        rot_t = t["needs_rotate"].get("True", 0)
        if rot_t:
            verdicts.append("尾部有 %d 张需要 EXIF 转正 → **可修的属性**，优先查" % rot_t)
        else:
            verdicts.append("尾部**没有**需要 EXIF 转正的条目 → 排除\"未转正\"这一假设")
        if t["format"].get("JPEG") == t.get("n"):
            verdicts.append("尾部**全是 JPEG** → 与 JPEG 解码器差异（IDCT/色度上采样）一致")
        if t["jpeg_sampling"]:
            top = max(t["jpeg_sampling"].items(), key=lambda kv: kv[1])
            verdicts.append("尾部 JPEG 采样以 %s 为主" % top[0])
    if g_b:
        bc = [r["cos"] for r in g_b if r.get("ok")]
        if bc:
            verdicts.append("bmp 回退组（%d 条）余弦 min=%.6f 中位=%.6f → SPEC §2.2 的 ≥0.95 放宽**甚至不必要**"
                            % (len(bc), min(bc), med(bc)))
    for v in verdicts:
        print("  · %s" % v)

    out = {"cos_csv": os.path.relpath(args.cos_csv, ROOT), "library": lib,
           "groups": summ, "verdicts": verdicts,
           "tail_items": [{k: r.get(k) for k in ("rel_path", "cos", "megapixels", "format", "mode",
                                                 "needs_rotate", "hf", "jpeg_sampling")}
                          for r in g_t[:args.tl]]}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print()
    print("  报告 → %s" % os.path.relpath(args.out, ROOT))

    print()
    print("--- 尾部逐条（前 %d）---" % args.tl)
    for r in g_t[:args.tl]:
        print("  %.6f  %-38s %4dx%-5d %-5s orient=%-3s rot=%-5s %.2fMP hf=%.2f"
              % (r["cos"], r["rel_path"][:38], r.get("w", 0), r.get("h", 0), r.get("mode", "?"),
                 r.get("orientation", "?"), r.get("needs_rotate", "?"),
                 r.get("megapixels", 0), r.get("hf", float("nan"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

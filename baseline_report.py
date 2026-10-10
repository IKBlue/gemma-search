# -*- coding: utf-8 -*-
"""
baseline_report.py —— 做出可复现的基线报告，并为旧索引留可恢复副本。

对应 SPEC-acceptance 门禁 G-A：
  · 基线报告可复现
  · 旧索引已复制出可恢复副本

产出：
  data/baseline-v1.json                      报告（含全部数字与指纹）
  data/_backup-old-index-<时间>/              旧索引副本（embeddings.npy / items.json / meta.json）
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G                                        # noqa: E402

ROOT = G.LIBRARY_ROOT
# 本脚本**故意自带**一份扩展名集合：基线核对要与实现独立。
# 但两侧集合一旦分歧就会造成误判（.7z 那次就是），所以下面会显式比对并报警。
IMG_EXT = {".jpg", ".jpeg", ".png"}
ARC_EXT = {".rar", ".zip", ".7z"}


def ext_set_divergence() -> list[str]:
    """比对"本脚本"与"实现（gemma_lib）"的扩展名集合，有分歧就报出来。"""
    warn = []
    li, la = set(G.IMG_EXT), set(G.ARCHIVE_EXT)
    if li != IMG_EXT:
        warn.append("图扩展名分歧：实现=%s 基线=%s（实现多出 %s，基线多出 %s）"
                    % (sorted(li), sorted(IMG_EXT), sorted(li - IMG_EXT), sorted(IMG_EXT - li)))
    if la != ARC_EXT:
        warn.append("包扩展名分歧：实现=%s 基线=%s（实现多出 %s，基线多出 %s）"
                    % (sorted(la), sorted(ARC_EXT), sorted(la - ARC_EXT), sorted(ARC_EXT - la)))
    return warn


def sha1_of(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_disk():
    """独立于索引，直接按磁盘统计与配对。"""
    ext_counter = Counter()
    stems = defaultdict(lambda: {"img": [], "arc": []})
    lines = []
    total_bytes = 0
    n_files = 0
    for dp, dn, fns in os.walk(ROOT):
        for fn in fns:
            stem, ext = os.path.splitext(fn)
            ext = ext.lower()
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, ROOT)
            st = os.stat(full)
            ext_counter[ext] += 1
            n_files += 1
            total_bytes += st.st_size
            lines.append("%s\t%d\t%d\t%s" % (rel, st.st_size, int(st.st_mtime * 1000), ext))
            if ext in IMG_EXT:
                stems[(dp, stem)]["img"].append(rel)
            elif ext in ARC_EXT:
                stems[(dp, stem)]["arc"].append(rel)

    no_arc = [v["img"][0] for v in stems.values() if v["img"] and not v["arc"]]
    no_img = [v["arc"][0] for v in stems.values() if v["arc"] and not v["img"]]
    multi_arc = {("%s|%s" % (k[0], k[1])): v["arc"] for k, v in stems.items() if len(v["arc"]) > 1}
    multi_img = {("%s|%s" % (k[0], k[1])): v["img"] for k, v in stems.items() if len(v["img"]) > 1}

    # 库指纹 v1：sha1("v1\n" + 排序后的行)
    fp = hashlib.sha1()
    fp.update(b"v1\n")
    for ln in sorted(lines):
        fp.update(ln.encode("utf-8"))
        fp.update(b"\n")

    return {
        "library_root": ROOT,
        "files_total": n_files,
        "files_total_bytes": total_bytes,
        "by_ext": dict(ext_counter.most_common()),
        "images": sum(c for e, c in ext_counter.items() if e in IMG_EXT),
        "archives": sum(c for e, c in ext_counter.items() if e in ARC_EXT),
        "unpaired_images": len(no_arc),
        "unpaired_archives": len(no_img),
        "unpaired_image_samples": no_arc[:10],
        "unpaired_archive_samples": no_img[:10],
        "multi_archive_stems": len(multi_arc),
        "multi_image_stems": len(multi_img),
        "fingerprint_v1": fp.hexdigest(),
    }


def index_health():
    """旧索引健康度（只读）。"""
    import numpy as np
    out = {}
    if os.path.exists(G.EMB_PATH):
        v = np.load(G.EMB_PATH)
        norms = np.linalg.norm(v, axis=1)
        out = {
            "path": G.EMB_PATH,
            "count": int(v.shape[0]),
            "dim": int(v.shape[1]),
            "dtype": str(v.dtype),
            "norm_min": float(norms.min()),
            "norm_max": float(norms.max()),
            "norm_mean": float(norms.mean()),
            "zero_rows": int((norms < 1e-6).sum()),
            "out_of_range_rows": int(((norms < 0.99) | (norms > 1.01)).sum()),
            "sha1": sha1_of(G.EMB_PATH),
        }
    if os.path.exists(G.ITEMS_PATH):
        out["items_sha1"] = sha1_of(G.ITEMS_PATH)
        with open(G.ITEMS_PATH, encoding="utf-8") as fh:
            out["items_count"] = len(json.load(fh))
    if os.path.exists(G.META_PATH):
        out["meta_sha1"] = sha1_of(G.META_PATH)
        with open(G.META_PATH, encoding="utf-8") as fh:
            m = json.load(fh)
        out["meta"] = {k: m.get(k) for k in
                       ("model_id", "dim", "count", "encoded", "missing",
                        "paired_archives", "image_seq_length", "built_at", "store")}
    return out


def main() -> int:
    t0 = time.time()
    print("=== 0) 扩展名集合一致性（实现 vs 基线）===")
    divs = ext_set_divergence()
    if divs:
        for d in divs:
            print("  ⚠ " + d)
    else:
        print("  一致 ✓  图 %s · 包 %s" % (sorted(IMG_EXT), sorted(ARC_EXT)))

    print()
    print("=== 1) 独立按磁盘扫描（不采信索引自述）===")
    disk = scan_disk()
    print("  文件总数 %d · 总字节 %.1f GB" % (disk["files_total"], disk["files_total_bytes"] / 1024 ** 3))
    print("  预览图 %d · 压缩包 %d" % (disk["images"], disk["archives"]))
    print("  扩展名: %s" % disk["by_ext"])
    print("  图无包 %d · 包无图 %d · 多包主干 %d · 多图主干 %d"
          % (disk["unpaired_images"], disk["unpaired_archives"],
             disk["multi_archive_stems"], disk["multi_image_stems"]))
    print("  库指纹 v1: %s" % disk["fingerprint_v1"])

    print()
    print("=== 2) 旧索引健康度（只读）===")
    idx = index_health()
    if idx:
        print("  count=%s dim=%s dtype=%s" % (idx.get("count"), idx.get("dim"), idx.get("dtype")))
        print("  范数 min=%.6f max=%.6f mean=%.6f · 零向量 %d · 越界 %d"
              % (idx["norm_min"], idx["norm_max"], idx["norm_mean"],
                 idx["zero_rows"], idx["out_of_range_rows"]))
        print("  meta 自述: %s" % idx.get("meta"))
    else:
        print("  未找到旧索引")

    print()
    print("=== 3) 备份旧索引（可恢复副本）===")
    ts = time.strftime("%Y%m%d-%H%M%S")
    bdir = os.path.join(G.DATA_DIR, "_backup-old-index-%s" % ts)
    os.makedirs(bdir, exist_ok=True)
    copied = []
    for p in (G.EMB_PATH, G.ITEMS_PATH, G.META_PATH):
        if os.path.exists(p):
            dst = os.path.join(bdir, os.path.basename(p))
            shutil.copy2(p, dst)
            copied.append({"src": p, "dst": dst, "bytes": os.path.getsize(dst),
                           "sha1": sha1_of(dst)})
            print("  已备份 %-20s %10d 字节" % (os.path.basename(p), os.path.getsize(dst)))
    print("  备份目录: %s" % bdir)

    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "spec_version": "baseline-v1",
        "disk": disk,
        "ext_set_divergence": divs,
        "old_index": idx,
        "backup": {"dir": bdir, "files": copied},
        "elapsed_seconds": round(time.time() - t0, 1),
        "note": "磁盘统计独立于索引自述；库指纹算法见 SPEC-identity §5（v1）",
    }
    out = os.path.join(G.DATA_DIR, "baseline-v1.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print()
    print("=== 4) 报告已写 %s（用时 %.1fs）===" % (out, time.time() - t0))

    # G-A 判据自检
    print()
    print("=== G-A 门禁自检 ===")
    checks = [
        ("库指纹已计算", bool(disk["fingerprint_v1"])),
        ("旧索引有可恢复副本", len(copied) >= 3),
        ("配对已独立核对", disk["images"] > 0 and disk["archives"] > 0),
        ("无零向量/越界向量", idx.get("zero_rows", 1) == 0 and idx.get("out_of_range_rows", 1) == 0),
        ("索引条目数 = 磁盘预览图数", idx.get("count") == disk["images"]),
    ]
    for name, ok in checks:
        print("  [%s] %s" % ("OK  " if ok else "FAIL", name))
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())

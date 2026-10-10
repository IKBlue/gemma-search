# -*- coding: utf-8 -*-
"""
spike_compare.py —— 逐条比较两个运行时的向量（余弦），给出结论。

用法:
    python spike_compare.py <基准.json> <对比.json> [...更多对比.json]
"""
from __future__ import annotations

import json
import sys

# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError 中断脚本。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

import numpy as np

PASS = 0.999       # 向量等价
REBUILD = 0.95     # 需重编码索引
# < REBUILD 即判定不可用


def load(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def cos(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return float("nan")
    return float(np.dot(a, b) / (na * nb))


def summarize(name, pairs):
    vals = np.array([c for _, c in pairs], dtype=np.float64)
    print("  %-46s n=%-3d min=%.6f  中位=%.6f  max=%.6f"
          % (name, len(vals), vals.min(), float(np.median(vals)), vals.max()))
    worst = sorted(pairs, key=lambda kv: kv[1])[:3]
    for label, c in worst:
        print("        最差: %-40s %.6f" % (label[:40], c))
    return vals


def verdict(vals):
    mn = float(vals.min())
    if mn >= PASS:
        return ("等价", "向量与基准等价（min ≥ %.3f）→ 可直接复用现有索引，Python 可退役" % PASS)
    if mn >= REBUILD:
        return ("需重编码", "存在可感知差异（min=%.4f）→ 可用同一运行时重编码索引后继续" % mn)
    return ("不可用", "差异过大（min=%.4f）→ 两个运行时不在同一向量空间，ONNX 路线不可行" % mn)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base_path = sys.argv[1]
    base = load(base_path)
    print("基准: %s" % base_path)
    print("  runtime=%s seq=%s dim=%s count=%s  %s s/张"
          % (base.get("runtime"), base.get("seq"), base.get("dim"), base.get("count"),
             base.get("image_seconds_per_item")))
    print()

    for other_path in sys.argv[2:]:
        other = load(other_path)
        print("=" * 100)
        print("对比: %s" % other_path)
        print("  runtime=%s seq=%s dim=%s count=%s  %s s/张 (载入 %ss)"
              % (other.get("runtime"), other.get("seq"), other.get("dim"), other.get("count"),
                 other.get("image_seconds_per_item"), other.get("load_seconds")))
        if base.get("dim") != other.get("dim"):
            print("  !! 维度不同 %s vs %s，无法比较" % (base.get("dim"), other.get("dim")))
            continue
        if base.get("seq") != other.get("seq"):
            print("  ⚠ seq 不同（%s vs %s）—— 差异里混入了预处理变量，结论仅作参考"
                  % (base.get("seq"), other.get("seq")))

        bmap = {x["rel_path"]: x["vector"] for x in base["images"]}
        pairs = []
        for x in other["images"]:
            if x["rel_path"] in bmap:
                pairs.append((x["rel_path"], cos(bmap[x["rel_path"]], x["vector"])))
        print("\n  — 图像 (%d 条) —" % len(pairs))
        iv = summarize("cos(基准, 对比)", pairs)

        bt = {x["text"]: x["vector"] for x in base["texts"]}
        tpairs = []
        for x in other["texts"]:
            if x["text"] in bt:
                tpairs.append((x["text"], cos(bt[x["text"]], x["vector"])))
        print("\n  — 文本 (%d 条) —" % len(tpairs))
        tv = summarize("cos(基准, 对比)", tpairs)

        print("\n  — 范数（应为 1.0，若明显偏离说明归一化没生效）—")
        print("     基准 image_norms: %s" % base.get("image_norms"))
        print("     对比 image_norms: %s" % other.get("image_norms"))

        v = verdict(np.concatenate([iv, tv]) if len(tv) else iv)
        print("\n  ▶ 结论: 【%s】%s" % v)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

# _tail_check.py —— 只看 G-B v2 的尾部（只读分析，不改任何产物）
import csv
import json
import os
import statistics

ROOT = os.path.dirname(os.path.abspath(__file__))
cos = list(csv.DictReader(open(os.path.join(ROOT, "data/quality/cos-all-v2.csv"), encoding="utf-8-sig")))
dims = json.load(open(os.path.join(ROOT, "data/diag/image-dims.json"), encoding="utf-8"))
for r in cos:
    r["c"] = float(r["cos"])
cos.sort(key=lambda r: r["c"])

# 预处理把图送到 320x240（seq=140 → 14x10 patch × 16px）：
# 大于它就是降采样，小于它就是升采样 —— 而升采样那条支路目前沿用 upstream affine(bicubic)
def wxh(r):
    return dims.get(r["rel_path"], [0, 0])

def direction(r):
    w, h = wxh(r)
    return "UP" if (w <= 320 and h <= 240) else "DOWN"

print("n =", len(cos))
print("\n--- 最差 15 条 ---")
for i, r in enumerate(cos[:15], 1):
    w, h = wxh(r)
    print(f"{i:2d} cos={r['c']:.6f}  {r['rel_path']:<34} {w}x{h:<5} {w*h/1e6:.2f}MP  {direction(r):<4} {r['image_ext']:<6} {r['vector_source']}")

below97 = [r for r in cos if r["c"] < 0.970]
print(f"\n--- cos < 0.970：{len(below97)} 条 ---")
for r in below97:
    w, h = wxh(r)
    print(f"    cos={r['c']:.6f}  {r['rel_path']:<34} {w}x{h:<5} {direction(r):<4} {r['vector_source']}")

below99 = [r for r in cos if r["c"] < 0.990]
print(f"\n--- 分方向统计 ---")
for b in ("UP", "DOWN"):
    xs = [r["c"] for r in cos if direction(r) == b]
    if xs:
        print(f"  {b:<4} n={len(xs):<5} min={min(xs):.6f} p1={sorted(xs)[max(0, int(len(xs)*0.01)-1)]:.6f} median={statistics.median(xs):.6f}")

print(f"\n--- cos < 0.990：{len(below99)} 条（其中升采样方向 {sum(1 for r in below99 if direction(r) == 'UP')} 条）---")
from collections import Counter
print("  按 vectorSource：", dict(Counter(r["vector_source"] for r in below99)))
print("  按扩展名：", dict(Counter(r["image_ext"] for r in below99)))
print("  最差 10 条方向：", [direction(r) for r in cos[:10]])

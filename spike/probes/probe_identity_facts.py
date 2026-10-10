# -*- coding: utf-8 -*-
"""
probe_identity_facts.py —— 为 SPEC-identity.md 提供实测依据。

要回答：
  1. 同一个主干名下出现多个压缩包吗？（决定"一图多包"规则）
  2. 同一个主干名下出现多张预览图吗？（决定"一素材多图"规则）
  3. 存在完全相同的预览图内容（sha1 相同）吗？（决定 UID 能否只用内容哈希）
  4. 库内压缩包总体积（决定"要不要算包哈希"的成本）
"""
from __future__ import annotations

import hashlib
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import gemma_lib as _G

ROOT = _G.LIBRARY_ROOT      # 从 config.json / 环境变量来，不写死
IMG = _G.IMG_EXT            # **共用同一份扩展名集合**（曾因各写一份漏 .7z 误判 76 条）
ARC = _G.ARCHIVE_EXT

stems = defaultdict(lambda: {"img": [], "arc": []})   # (dir, stem) -> files
img_sha = defaultdict(list)                            # sha1 -> [(relpath)]
arc_total = 0
arc_count = 0
img_count = 0

for dp, dn, fns in os.walk(ROOT):
    for fn in fns:
        stem, ext = os.path.splitext(fn)
        ext = ext.lower()
        full = os.path.join(dp, fn)
        rel = os.path.relpath(full, ROOT)
        key = (dp, stem)
        if ext in IMG:
            stems[key]["img"].append(rel)
            img_count += 1
        elif ext in ARC:
            stems[key]["arc"].append(rel)
            arc_count += 1
            arc_total += os.path.getsize(full)

print("=== 0) 总量 ===")
print("  预览图 %d · 压缩包 %d · 包总体积 %.1f GB"
      % (img_count, arc_count, arc_total / 1024 / 1024 / 1024))

print()
print("=== 1) 同主干多个压缩包 ===")
multi_arc = {k: v for k, v in stems.items() if len(v["arc"]) > 1}
print("  出现 %d 处" % len(multi_arc))
for (dp, stem), v in list(multi_arc.items())[:8]:
    print("    %-28s -> %s" % (stem, [os.path.basename(x) for x in v["arc"]]))

print()
print("=== 2) 同主干多张预览图 ===")
multi_img = {k: v for k, v in stems.items() if len(v["img"]) > 1}
print("  出现 %d 处" % len(multi_img))
for (dp, stem), v in list(multi_img.items())[:8]:
    print("    %-28s -> %s" % (stem, [os.path.basename(x) for x in v["img"]]))

print()
print("=== 3) 预览图内容重复（sha1 相同）===")
for dp, dn, fns in os.walk(ROOT):
    for fn in fns:
        if os.path.splitext(fn)[1].lower() in IMG:
            full = os.path.join(dp, fn)
            with open(full, "rb") as fh:
                h = hashlib.sha1(fh.read()).hexdigest()
            img_sha[h].append(os.path.relpath(full, ROOT))
dupes = {h: v for h, v in img_sha.items() if len(v) > 1}
print("  不同内容 %d 种 · 内容重复的组 %d 组" % (len(img_sha), len(dupes)))
for h, v in list(dupes.items())[:6]:
    print("    %s… -> %s" % (h[:10], v))

print()
print("=== 4) 包哈希成本估算 ===")
print("  包总体积 %.1f GB；按 150 MB/s 顺序读算，全量 sha1 约 %.1f 分钟"
      % (arc_total / 1024 ** 3, arc_total / 1024 ** 3 * 1024 / 150 / 60))

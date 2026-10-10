# -*- coding: utf-8 -*-
"""
inspect_20.py —— 查清 jpg→bmp 那 20 个文件到底是什么格式。

背景：RawImage（transformers.js）与 sharp（libvips）都无法解码它们，
但旧索引（Python + PIL）曾把 3594 张全部编码成功。所以要先看清：
  文件头到底是什么？PIL 能读吗？尺寸是多少？
"""
from __future__ import annotations

import json
import os
import struct
import sys

# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError 中断脚本。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G  # noqa: E402

p = os.path.join(G.DATA_DIR, "quality", "extension-mismatch.json")
data = json.load(open(p, encoding="utf-8"))
bmp_items = [i for i in data["items"] if i["actual"] == "bmp"]
print("jpg→bmp 共 %d 条" % len(bmp_items))
print()

try:
    from PIL import Image
    have_pil = True
except Exception as e:  # noqa: BLE001
    have_pil = False
    print("PIL 不可用:", e)

for i, it in enumerate(bmp_items[:6]):
    full = it["abs_path"]
    with open(full, "rb") as fh:
        head = fh.read(64)
    print("--- %s" % it["rel_path"])
    print("    大小      %d B" % it["size"])
    print("    前 16 字节 hex: %s" % head[:16].hex(" "))
    print("    前 16 字节 ascii: %r" % head[:16])
    # BMP 头解析（BITMAPFILEHEADER 14 字节 + BITMAPINFOHEADER 40 字节）
    if head[:2] == b"BM":
        fsize, res1, res2, offbits = struct.unpack_from("<IHHI", head, 2)
        hdrsize, w, h, planes, bpp, comp = struct.unpack_from("<IiiHHI", head, 14)
        print("    BMP: 声明大小=%d(实际 %d) 像素数据偏移=%d 头大小=%d 宽=%d 高=%d 位深=%d 压缩=%d"
              % (fsize, it["size"], offbits, hdrsize, w, h, bpp, comp))
        comp_name = {0: "BI_RGB", 1: "BI_RLE8", 2: "BI_RLE4", 3: "BI_BITFIELDS",
                     4: "BI_JPEG", 5: "BI_PNG"}.get(comp, "?")
        print("    压缩方式  %s" % comp_name)
        print("    → 常见不支持原因：BI_BITFIELDS / RLE / OS2 头 / 位深非 24/32")
    if have_pil:
        try:
            with Image.open(full) as im:
                print("    PIL: 可读 ✓  format=%s mode=%s size=%s" % (im.format, im.mode, im.size))
        except Exception as e:  # noqa: BLE001
            print("    PIL: 失败 ✗  %s" % e)
    print()

# 统计位深与压缩方式分布
if have_pil:
    ok = bad = 0
    modes = {}
    for it in bmp_items:
        try:
            with Image.open(it["abs_path"]) as im:
                ok += 1
                modes[im.mode] = modes.get(im.mode, 0) + 1
        except Exception:  # noqa: BLE001
            bad += 1
    print("PIL 汇总：可读 %d · 不可读 %d · 模式分布 %s" % (ok, bad, modes))

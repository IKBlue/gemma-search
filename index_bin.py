# -*- coding: utf-8 -*-
"""
index_bin.py —— index.bin 的**读取与校验**（Python 侧）

为什么单独成模块：`quality_vector_equiv.py` 与 `quality_top10.py` 都要读它。
两边各写一份读取逻辑正是本项目反复踩过的坑（扩展名集合、MAGIC 长度都因此出过错）。

布局（与 SPEC-identity §7、build_index_onnx.mjs 一致）：
  [0,8)          MAGIC = 47 53 49 44 58 00 00 01（"GSIDX" + 0x00 0x00 0x01）
  [8,12)         u32 LE headerLen
  [12,12+hlen)   headerJSON（utf8）
  之后            float32 块（count × dim，行主序）
  末尾            u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete }
"""
from __future__ import annotations

import sys


# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出。**必须先 import sys** —— 否则 except 会把 NameError
# 一起吞掉，看起来改了、实际没生效（这个坑真的踩过）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


import hashlib
import json
import struct

MAGIC = bytes.fromhex("4753494458000001")
LEN_OFF = len(MAGIC)          # 8
HEAD_OFF = len(MAGIC) + 4     # 12


class IndexCorrupt(RuntimeError):
    pass


def read_index_bin(path: str) -> tuple[dict, "list"]:
    """读回 index.bin；**任何校验不过都抛 IndexCorrupt**（不返回半可信数据）。

    返回 (header, vectors)，vectors 是 numpy 数组 (count, dim) float32。
    """
    import numpy as np

    with open(path, "rb") as fh:
        buf = fh.read()
    if len(buf) < HEAD_OFF:
        raise IndexCorrupt("文件太短：%d 字节" % len(buf))
    if buf[:len(MAGIC)] != MAGIC:
        raise IndexCorrupt("MAGIC 不符：实际 %s，期望 %s" % (buf[:8].hex(), MAGIC.hex()))

    (header_len,) = struct.unpack_from("<I", buf, LEN_OFF)
    if HEAD_OFF + header_len > len(buf):
        raise IndexCorrupt("headerLen 超出文件：%d" % header_len)
    try:
        header = json.loads(buf[HEAD_OFF:HEAD_OFF + header_len].decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise IndexCorrupt("headerJSON 解析失败：%s" % e) from e

    count = int(header.get("count") or 0)
    dim = int(header.get("dim") or 0)
    if count <= 0 or dim <= 0:
        raise IndexCorrupt("header.count/dim 无效：%s/%s" % (count, dim))

    start = HEAD_OFF + header_len
    block_bytes = count * dim * 4
    if start + block_bytes + 4 > len(buf):
        raise IndexCorrupt("向量块超出文件：需要 %d 字节" % block_bytes)
    body = buf[start:start + block_bytes]
    vectors = np.frombuffer(body, dtype="<f4").reshape(count, dim)

    # footer：没有"写完了"标记就当写入未完成
    (foot_len,) = struct.unpack_from("<I", buf, start + block_bytes)
    try:
        foot = json.loads(buf[start + block_bytes + 4:start + block_bytes + 4 + foot_len].decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise IndexCorrupt("footer 解析失败：%s" % e) from e
    if foot.get("complete") is not True:
        raise IndexCorrupt("footer.complete 不是 true → 视为写入未完成")
    if foot.get("count") != count or foot.get("dim") != dim:
        raise IndexCorrupt("footer 与 header 不一致：%s/%s vs %s/%s"
                           % (foot.get("count"), foot.get("dim"), count, dim))
    sha = hashlib.sha1(body).hexdigest()
    if foot.get("sha1_of_vector_block") != sha:
        raise IndexCorrupt("向量块 sha1 不符：footer=%s 实际=%s"
                           % (foot.get("sha1_of_vector_block"), sha))
    return header, vectors


def read_items(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)

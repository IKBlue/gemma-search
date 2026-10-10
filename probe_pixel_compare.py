# -*- coding: utf-8 -*-
"""
probe_pixel_compare.py —— 把两套处理器的 pixel_values 落盘并逐元素比较

要回答：差异发生在**解码**（PIL vs RawImage）还是**处理器**（Python vs JS 的 resize）。

方法：
  1) Python：PIL 解码 → processor → 存 pixel_values（float32 原始）
  2) JS   ：RawImage.read → processor → 存 pixel_values（float32 原始）
  3) 逐元素比较：均值、平均绝对差、相关性、以及差异的空间分布
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import gemma_lib as G  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

REL = sys.argv[1] if len(sys.argv) > 1 else r"VR\ID-1109393506.jpeg"
MODEL = sys.argv[2] if len(sys.argv) > 2 else None
SEQ = 140
PY_NPY = os.path.join(G.DATA_DIR, "_pv-python.npy")
JS_BIN = os.path.join(G.DATA_DIR, "_pv-js.bin")
JS_META = os.path.join(G.DATA_DIR, "_pv-js.json")

path = os.path.join(G.LIBRARY_ROOT, REL)

# ---------- 1) Python 侧 ----------
from transformers import AutoProcessor  # noqa: E402
proc = AutoProcessor.from_pretrained("google/embeddinggemma-2", local_files_only=True)
if hasattr(proc, "image_seq_length"):
    proc.image_seq_length = SEQ
ip = getattr(proc, "image_processor", None)
if ip is not None:
    for obj in (ip, getattr(ip, "config", None)):
        if obj is None:
            continue
        for k in ("max_soft_tokens", "image_seq_length"):
            if hasattr(obj, k):
                try:
                    setattr(obj, k, SEQ)
                except Exception:
                    pass

with Image.open(path) as im:
    im = im.convert("RGB")
    px_native = np.asarray(im, dtype=np.uint8)
    out = proc(images=im)
pv_py = out["pixel_values"]
pv_py = pv_py.numpy() if hasattr(pv_py, "numpy") else np.asarray(pv_py)
pv_py = np.asarray(pv_py, dtype=np.float32)
np.save(PY_NPY, pv_py)
print("  Python: PIL 原生像素 shape=%s 均值(0-255)=%.3f" % (px_native.shape, px_native.mean()))
print("  Python: pixel_values shape=%s 均值=%.6f 范围=[%.4f, %.4f]"
      % (pv_py.shape, pv_py.mean(), pv_py.min(), pv_py.max()))

# ---------- 2) JS 侧 ----------
dump_mjs = os.path.join(HERE, "_pv-dump.mjs")
with open(dump_mjs, "w", encoding="utf-8") as fh:
    fh.write("""import fs from 'node:fs';
import { AutoConfig, AutoProcessor, RawImage, env } from './onnx-spike/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
env.allowLocalModels = true; env.allowRemoteModels = false;
const [model, imgPath, outBin, outMeta, seqStr] = process.argv.slice(2);
const SEQ = parseInt(seqStr, 10);
const cfg = await AutoConfig.from_pretrained(model); cfg.audio_config = null;
const proc = await AutoProcessor.from_pretrained(model, { config: cfg });
proc.image_seq_length = SEQ;
if (proc.image_processor) { proc.image_processor.max_soft_tokens = SEQ; proc.image_processor.image_seq_length = SEQ;
  if (proc.image_processor.config) proc.image_processor.config.image_seq_length = SEQ; }
const img = await RawImage.read(imgPath);
const inputs = await proc(null, [img]);
const pv = inputs.pixel_values;
fs.writeFileSync(outBin, Buffer.from(pv.data.buffer, pv.data.byteOffset, pv.data.byteLength));
fs.writeFileSync(outMeta, JSON.stringify({ dims: pv.dims, type: pv.type,
  imgW: img.width, imgH: img.height, mean: (() => { let s=0; for (const x of pv.data) s+=x; return s/pv.data.length; })() }));
console.log('[js] dims', JSON.stringify(pv.dims), 'imgW', img.width, 'imgH', img.height);
""")
r = subprocess.run(["node", dump_mjs, MODEL, path, JS_BIN, JS_META, str(SEQ)],
                   cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace")
if r.returncode != 0:
    print("  JS 侧失败：", (r.stderr or "")[-800:])
    sys.exit(1)
meta = json.load(open(JS_META, encoding="utf-8"))
pv_js = np.fromfile(JS_BIN, dtype=np.float32).reshape(meta["dims"])
print("  JS    : RawImage 尺寸=%dx%d" % (meta["imgW"], meta["imgH"]))
print("  JS    : pixel_values shape=%s 均值=%.6f 范围=[%.4f, %.4f]"
      % (pv_js.shape, pv_js.mean(), pv_js.min(), pv_js.max()))

# ---------- 3) 比较 ----------
print()
print("=== 逐元素比较 ===")
if pv_py.shape != pv_js.shape:
    print("  ⚠ 形状不同：%s vs %s" % (pv_py.shape, pv_js.shape))
else:
    d = pv_js - pv_py
    print("  形状一致 %s" % (pv_py.shape,))
    print("  均值差        %+.6f   （Python %.6f · JS %.6f）" % (pv_js.mean() - pv_py.mean(), pv_py.mean(), pv_js.mean()))
    print("  平均绝对差    %.6f    （相对满量程 %.3f%%）" % (np.abs(d).mean(), 100 * np.abs(d).mean()))
    print("  最大绝对差    %.6f" % np.abs(d).max())
    a = pv_py.ravel(); b = pv_js.ravel()
    print("  相关系数      %.6f" % float(np.corrcoef(a, b)[0, 1]))
    print("  余弦相似度    %.6f" % float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b))))
    # 差异是否集中在某些 patch（例如边缘/暗区）
    per_patch = np.abs(d).reshape(pv_py.shape[0] * pv_py.shape[1], -1).mean(axis=1)
    print("  patch 级平均绝对差：中位 %.6f · 最大 %.6f（最大/中位 = %.1f×）"
          % (np.median(per_patch), per_patch.max(), per_patch.max() / max(np.median(per_patch), 1e-9)))
    # 仅用 Python 的像素(0-255)估一下：JS 的均值换算回去
    print("  折算到 0-255：Python 等效 %.2f · JS 等效 %.2f" % (pv_py.mean() * 255, pv_js.mean() * 255))

for f in (dump_mjs,):
    try:
        os.remove(f)
    except OSError:
        pass

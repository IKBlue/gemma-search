# -*- coding: utf-8 -*-
"""
probe_nonpython_runtime.py —— 查 EmbeddingGemma 2 有没有**非 Python**的推理路径。

要回答的问题：
  1. HF 上有没有 embeddinggemma 的 ONNX 构建（transformers.js / onnxruntime 可用）？
  2. 有没有 GGUF 构建（llama.cpp 可用）？若有，是否**含视觉塔**（决定还能不能以图搜图）？
  3. 这些构建是否覆盖"多模态"（text+image 统一空间），还是只有文本？

只用标准库，避免额外依赖。
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error

UA = {"User-Agent": "gemma-search-probe/1.0"}


def get(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def head(url, timeout=15):
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return "ERR:" + type(e).__name__


print("=" * 92)
print("1) HF 上搜索 embeddinggemma 相关仓库")
print("=" * 92)
try:
    models = get("https://huggingface.co/api/models?search=embeddinggemma&limit=100")
except Exception as e:
    print("  查询失败:", type(e).__name__, e)
    models = []

print("  共 %d 个仓库" % len(models))
onnx, gguf, other = [], [], []
for m in models:
    mid = m.get("modelId") or m.get("id") or "?"
    tags = [t.lower() for t in (m.get("tags") or [])]
    if "onnx" in tags or "onnx" in mid.lower():
        onnx.append((mid, tags))
    elif "gguf" in tags or "gguf" in mid.lower():
        gguf.append((mid, tags))
    else:
        other.append(mid)

print("\n  --- 带 ONNX 的 (%d) ---" % len(onnx))
for mid, tags in onnx:
    print("   ", mid)
    t = [x for x in tags if x in ("onnx", "transformers.js", "image-text-to-text",
                                  "feature-extraction", "multimodal", "text-embedding",
                                  "image-feature-extraction", "sentence-similarity")]
    if t:
        print("        标签:", ", ".join(t))

print("\n  --- 带 GGUF 的 (%d) ---" % len(gguf))
for mid, tags in gguf:
    print("   ", mid)

print("\n  --- 其余（前 25）---")
for mid in other[:25]:
    print("   ", mid)

print()
print("=" * 92)
print("2) 已知候选仓库的文件清单（看有没有 vision / 图像处理器）")
print("=" * 92)
cands = [mid for mid, _ in onnx][:4]
cands += ["google/embeddinggemma-2", "onnx-community/embeddinggemma-2-ONNX"]
seen = set()
for mid in cands:
    if mid in seen:
        continue
    seen.add(mid)
    try:
        info = get("https://huggingface.co/api/models/%s" % mid)
    except Exception as e:
        print("  [%s] 取不到: %s" % (mid, type(e).__name__))
        continue
    files = [s.get("rfilename", "") for s in (info.get("siblings") or [])]
    onnx_files = [f for f in files if f.endswith(".onnx")]
    gguf_files = [f for f in files if f.endswith(".gguf")]
    vision = [f for f in files if any(k in f.lower() for k in
              ("vision", "image", "siglip", "processor", "preprocessor"))]
    print("\n  [%s]" % mid)
    print("     仓库文件数: %d | .onnx: %d | .gguf: %d" % (len(files), len(onnx_files), len(gguf_files)))
    if onnx_files:
        for f in onnx_files[:6]:
            print("        onnx:", f)
    if gguf_files:
        for f in gguf_files[:6]:
            print("        gguf:", f)
    if vision:
        print("     视觉/处理器相关:", ", ".join(vision[:8]))
    else:
        print("     视觉/处理器相关: **无**  <-- 若为纯文本构建，则无法以图搜图")

# -*- coding: utf-8 -*-
"""
probe_onnx_sizes.py —— 量 ONNX 构建的体积，并确认 Node 侧运行时的存在。

决定两件事：
  1. 若走 ONNX 路线，模型文件多大（fp32 与量化各多少）→ 决定能否打进应用
  2. npm 上 @huggingface/transformers 的可用版本 → 决定实现可行性
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error

UA = {"User-Agent": "gemma-search-probe/1.0"}
REPO = "onnx-community/embeddinggemma-2-ONNX"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def size_of(path, timeout=25):
    """HF 的 resolve 会 302 到 CDN，跟随重定向取 Content-Length。"""
    url = "https://huggingface.co/%s/resolve/main/%s" % (REPO, path)
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return int(r.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as e:
        return "HTTP%d" % e.code
    except Exception as e:
        return "ERR:" + type(e).__name__


def mb(n):
    return "%.1f MB" % (n / 1024 / 1024) if isinstance(n, int) else str(n)


print("=" * 92)
print("1) %s 的文件与体积" % REPO)
print("=" * 92)
try:
    info = get("https://huggingface.co/api/models/%s" % REPO)
except Exception as e:
    print("  取不到:", type(e).__name__, e)
    raise SystemExit(1)

files = [s.get("rfilename", "") for s in (info.get("siblings") or [])]
print("  仓库文件数: %d" % len(files))

groups = {}
for f in sorted(files):
    if not f.endswith((".onnx", ".onnx_data", ".json", ".txt")):
        continue
    s = size_of(f)
    groups[f] = s
    print("   %-58s %s" % (f, mb(s)))

print()
print("  --- 分档合计（只看 .onnx 与 .onnx_data）---")
for label, pred in (
    ("fp32 (model.onnx + vision_encoder.onnx + audio_encoder.onnx)", lambda f: f.endswith(".onnx") and "_fp16" not in f and "_q4" not in f and "_q8" not in f and "_quantized" not in f and "_int8" not in f),
    ("fp16", lambda f: "_fp16" in f),
    ("q4f16 (最小量化)", lambda f: "_q4f16" in f),
):
    tot = sum(v for f, v in groups.items() if pred(f) and isinstance(v, int))
    names = [f for f in groups if pred(f)]
    print("   %-62s %s  (%d 个文件)" % (label, mb(tot), len(names)))

print()
print("=" * 92)
print("2) npm 上 @huggingface/transformers 的可用版本")
print("=" * 92)
for pkg in ("@huggingface/transformers", "onnxruntime-node"):
    try:
        meta = get("https://registry.npmjs.org/%s" % urllib.parse.quote(pkg, safe=""))
        latest = meta.get("dist-tags", {}).get("latest", "?")
        vs = list(meta.get("versions", {}).keys())
        print("  %-30s latest=%s  共 %d 个版本" % (pkg, latest, len(vs)))
        # 该版本声明的依赖里有没有 onnxruntime
        vinfo = meta.get("versions", {}).get(latest, {})
        deps = vinfo.get("dependencies") or {}
        orts = {k: v for k, v in deps.items() if "onnxruntime" in k}
        if orts:
            print("        依赖:", orts)
    except Exception as e:
        print("  %-30s 查询失败: %s %s" % (pkg, type(e).__name__, e))

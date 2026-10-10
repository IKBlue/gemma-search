# -*- coding: utf-8 -*-
"""
fetch_onnx_model.py —— 下载 ONNX 版 EmbeddingGemma 2 的**文本塔 + 视觉塔**（跳过音频塔）。

为什么自己下而不用 transformers.js 的自动下载：
  1. 精确跳过 onnx/audio_encoder*（占该仓库 40% 体积，本应用不需要音频）
  2. HTTP Range 断点续传，中断可续
  3. 钉住 commit revision，避免重下时静默换权重
  4. 记录 size + sha256，便于完整性校验

用法:
    python fetch_onnx_model.py --precision fp32 [--precision fp16 ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPO = "onnx-community/embeddinggemma-2-ONNX"
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

CACHE_ROOT = os.path.join(os.path.dirname(ROOT), "model-cache", "onnx")
UA = {"User-Agent": "gemma-search-fetch/1.0"}

# 必下的非权重文件
COMMON = [
    "config.json",
    "config_sentence_transformers.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "processor_config.json",
    "preprocessor_config.json",
]

# 每档的权重文件（文本塔 + 视觉塔；**不含音频塔**）
WEIGHTS = {
    "fp32": ["onnx/model.onnx", "onnx/model.onnx_data",
             "onnx/vision_encoder.onnx", "onnx/vision_encoder.onnx_data"],
    "fp16": ["onnx/model_fp16.onnx", "onnx/model_fp16.onnx_data",
             "onnx/vision_encoder_fp16.onnx", "onnx/vision_encoder_fp16.onnx_data"],
    "q4f16": ["onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data",
              "onnx/vision_encoder_q4f16.onnx", "onnx/vision_encoder_q4f16.onnx_data"],
}


def log(*a):
    print(*a, file=sys.stderr, flush=True) if False else print(*a, flush=True)


def api(path):
    req = urllib.request.Request("https://huggingface.co/api/models/%s" % path, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def head_size(url):
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as r:
        return int(r.headers.get("Content-Length") or 0)


def download(url, dst, expected_size, label):
    """Range 断点续传。返回 (实际字节数, sha256 或 None)。"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    have = os.path.getsize(dst) if os.path.exists(dst) else 0
    if expected_size and have == expected_size:
        log("    [跳过] %-46s 已完整 (%s)" % (label, human(have)))
        return have, None
    if expected_size and have > expected_size:
        log("    [重下] %-46s 本地比预期大" % label)
        have = 0
        if os.path.exists(dst):
            os.remove(dst)

    headers = dict(UA)
    mode = "wb"
    if have:
        headers["Range"] = "bytes=%d-" % have
        mode = "ab"
        log("    [续传] %-46s 从 %s 起" % (label, human(have)))
    else:
        log("    [开始] %-46s 目标 %s" % (label, human(expected_size) if expected_size else "?"))

    req = urllib.request.Request(url, headers=headers)
    t0 = time.time()
    got = have
    with urllib.request.urlopen(req, timeout=60) as r, open(dst, mode) as fh:
        while True:
            chunk = r.read(1024 * 512)
            if not chunk:
                break
            fh.write(chunk)
            got += len(chunk)
            if expected_size and got % (16 * 1024 * 1024) < 1024 * 512:
                pct = 100.0 * got / expected_size
                sp = got / max(0.001, time.time() - t0)
                log("           %-46s %5.1f%%  (%s / %s)  %s/s"
                    % (label, pct, human(got), human(expected_size), human(int(sp))))
    dt = time.time() - t0
    log("    [完成] %-46s %s 用时 %.1fs" % (label, human(got), dt))
    return got, None


def human(n):
    if n is None:
        return "?"
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return "%.1f %s" % (n, u) if u != "B" else "%d B" % n
        n /= 1024.0


def sha256_of(path, limit_mb=None):
    h = hashlib.sha256()
    read = 0
    with open(path, "rb") as fh:
        while True:
            b = fh.read(1024 * 1024)
            if not b:
                break
            h.update(b)
            read += len(b)
            if limit_mb and read > limit_mb * 1024 * 1024:
                return None
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--precision", action="append", default=None,
                    choices=sorted(WEIGHTS), help="可多次指定；缺省 fp32")
    ap.add_argument("--hash", action="store_true", help="下载后计算 sha256（较慢）")
    args = ap.parse_args()
    precisions = args.precision or ["fp32"]

    info = api(REPO)
    rev = info.get("sha") or "main"
    log("仓库: %s" % REPO)
    log("revision: %s" % rev)
    log("精度档: %s" % ", ".join(precisions))
    log("")

    sizes = {s.get("rfilename"): s.get("size") for s in (info.get("siblings") or [])}
    # API 的 size 可能为 None（LFS），逐个 HEAD 补
    def size_of(path):
        s = sizes.get(path)
        if s:
            return int(s)
        return head_size("https://huggingface.co/%s/resolve/%s/%s" % (REPO, rev, path))

    grand = 0
    for prec in precisions:
        outdir = os.path.join(CACHE_ROOT, "embeddinggemma-2", rev, prec)
        log("=== %s -> %s" % (prec, outdir))
        files = COMMON + WEIGHTS[prec]
        manifest = {"repo": REPO, "revision": rev, "precision": prec,
                    "downloaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "files": []}
        total = 0
        for rel in files:
            url = "https://huggingface.co/%s/resolve/%s/%s" % (REPO, rev, rel)
            dst = os.path.join(outdir, rel.replace("/", os.sep))
            exp = size_of(rel)
            got, _ = download(url, dst, exp, rel)
            h = sha256_of(dst) if args.hash else None
            manifest["files"].append({"path": rel, "size": got, "sha256": h})
            total += got
        manifest["total_bytes"] = total
        with open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
        grand += total
        log("  本档合计: %s" % human(total))
        log("")

    log("全部完成，合计 %s" % human(grand))
    log("下载根: %s" % CACHE_ROOT)

    # 明确报告跳过了什么
    skipped = [f for f in sizes if "audio" in f.lower()]
    log("已跳过音频相关文件 %d 个（不需要音频模态）" % len(skipped))


if __name__ == "__main__":
    main()

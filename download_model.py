# -*- coding: utf-8 -*-
"""下载 google/embeddinggemma-2 到工作区内的缓存目录，并核对文件完整性。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemma_lib as _G          # 路径来自 config.json / 环境变量，代码里不写死

os.environ.setdefault("HF_HOME", os.path.join(_G.MODEL_CACHE, "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(_G.MODEL_CACHE, "hf", "hub"))

from huggingface_hub import snapshot_download

t0 = time.time()
print("HF_HOME      :", os.environ["HF_HOME"])
print("HF_HUB_CACHE :", os.environ["HF_HUB_CACHE"])
print("开始下载 google/embeddinggemma-2 ...", flush=True)

path = snapshot_download(
    repo_id="google/embeddinggemma-2",
    allow_patterns=["*.json", "*.safetensors", "*.model", "*.jinja", "*.txt"],
    max_workers=4,
)
print("\n下载完成，用时 {:.0f} 秒".format(time.time() - t0))
print("本地路径:", path)

total = 0
print("\n文件清单:")
for root, _d, files in os.walk(path):
    for f in sorted(files):
        p = os.path.join(root, f)
        sz = os.path.getsize(p)
        total += sz
        print("   {:>13,} B  {}".format(sz, os.path.relpath(p, path)))
print("\n合计 {:.2f} GB".format(total / 1024 ** 3))

# 关键文件存在性
need = ["config.json", "model.safetensors", "processor_config.json",
        "tokenizer.json", "modules.json", "sentence_bert_config.json"]
print("\n关键文件核对:")
for n in need:
    p = os.path.join(path, n)
    print("   {:<28} {}".format(n, "有" if os.path.isfile(p) else "缺！"))

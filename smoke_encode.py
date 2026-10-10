# -*- coding: utf-8 -*-
"""
smoke_encode.py —— 编码器小样验证 + **与索引的交叉核对**

交叉核对的目的：`encode_queries.mjs` 与 `build_index_onnx.mjs` 各有一份 `pickEmbedding`
（是副本，不是共享模块）。两份实现若漂移，查询向量与索引向量就不同源，
Top-10 重合率会给出错误结论。所以这里**可执行地**断言：
用编码器编一张索引里已有的图，应与索引中同一张的向量几乎相同（余弦 ≈ 1.0）。

用法:
  python smoke_encode.py <模型目录> [索引目录]      # 给了索引目录就做交叉核对
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G  # noqa: E402

SPIKE = os.path.join(HERE, "onnx-spike")
model = sys.argv[1]
index_dir = sys.argv[2] if len(sys.argv) > 2 else None
inp = os.path.join(G.DATA_DIR, "_enc-in.json")
outp = os.path.join(G.DATA_DIR, "_enc-out.json")

check_rel = None
if index_dir:
    import index_bin
    items = index_bin.read_items(os.path.join(index_dir, "items.json"))
    check_rel = items[0].get("relPath") or items[0].get("rel_path")
    print("  交叉核对样本（索引第 0 条）: %s" % check_rel)

queries = [
    {"id": "t1", "kind": "text", "value": "北欧吊灯"},
    {"id": "t2", "kind": "text", "value": "现代简约布艺沙发"},
    {"id": "i1", "kind": "image", "value": os.path.join(G.LIBRARY_ROOT, "VR", "ID-030518714422364.jpg")},
]
if check_rel:
    queries.append({"id": "chk", "kind": "image", "value": os.path.join(G.LIBRARY_ROOT, check_rel)})

with open(inp, "w", encoding="utf-8") as fh:      # 无 BOM（PS 的 Set-Content 会加，Node 会拒绝）
    json.dump(queries, fh, ensure_ascii=False)
print("  输入 %d 条" % len(queries))

r = subprocess.run(["node", "encode_queries.mjs", "--model", model, "--in", inp,
                    "--out", outp, "--seq", "140", "--device", "webgpu"],
                   cwd=SPIKE, capture_output=True, text=True, encoding="utf-8", errors="replace")
for ln in (r.stdout or "").strip().splitlines():
    print("  " + ln)
if r.returncode != 0:
    print("  退出码 %s" % r.returncode)
    print("  stderr:", (r.stderr or "")[:600])
    sys.exit(1)

d = json.load(open(outp, encoding="utf-8"))
print("  → 条数 %d · dim %d · embedding=%s" % (d["count"], d["dim"], d["embedding_how"]))
for q in d["queries"]:
    print("     %-8s %-6s dim=%d norm=%.6f" % (q["id"], q["kind"], q["dim"], q["norm"]))

rc = 0
if check_rel:
    import numpy as np
    import index_bin
    _header, nv = index_bin.read_index_bin(os.path.join(index_dir, "index.bin"))
    items = index_bin.read_items(os.path.join(index_dir, "items.json"))
    row = next(it["vectorRow"] for it in items
               if (it.get("relPath") or it.get("rel_path")) == check_rel)
    v = np.array(next(q["vector"] for q in d["queries"] if q["id"] == "chk"), dtype="<f4")
    cos = float(np.dot(v, nv[row]) / (np.linalg.norm(v) * np.linalg.norm(nv[row])))
    ok = cos >= 0.9999
    print()
    print("  [%s] 编码器 ↔ 索引 同源核对：余弦 %.8f（应为 1.0）"
          % ("OK  " if ok else "FAIL", cos))
    if not ok:
        print("     → encode_queries.mjs 与 build_index_onnx.mjs 的 pickEmbedding 已漂移；"
              "Top-10 结果不可信，必须先统一实现")
        rc = 1

os.remove(inp)
os.remove(outp)
print()
print("  %s" % ("✅ 编码器可用且与索引同源" if rc == 0 else "⛔ 检查未通过"))
sys.exit(rc)

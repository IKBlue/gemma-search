# -*- coding: utf-8 -*-
"""
quality_top10.py —— G-B 主判据 ② Top-10 重合率 与 ③ 相关性补充（SPEC-acceptance §2.2）

两侧各自用自己的运行时编码查询（这是公平的前提）：
  · 旧索引（torch）：search.SearchEngine.encode_text / encode_image → 自己的向量空间
  · 新索引（ONNX）：onnx-spike/encode_queries.mjs → index.bin 的行空间
搜索则都在 Python 侧做（index.bin 可被 numpy 直接读），使排序口径一致、可逐行核对。

顺带产出两个**独立核对**：
  · 文本塔 torch vs ONNX 的逐条余弦（既验证"bit-exact"这一既有结论，也在真实查询集上复现）
  · self 参考图：ONNX 查询向量 vs 新索引中同一张图的行向量 —— 同时充当
    "encode_queries.mjs 与 build_index_onnx.mjs 同源"的可执行断言

用法:
  python quality_top10.py --model <ONNX 模型目录> [--new-index data/idx-full] [--out reports/.../]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# 必须在 import gemma_lib（进而 import sentence_transformers）**之前**设：
# 否则它会联网做更新探测，进而在 HF 缓存目录里建临时目录并 chmod —— 在受限沙箱下
# 既慢又会以 PermissionError 收场。这是项目里既有的做法（见 register_mcp.py 的注释）。
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import gemma_lib as G  # noqa: E402
import index_bin  # noqa: E402

SPIKE = os.path.join(HERE, "onnx-spike")
TOP_K = 10
OVL_AVG_MIN = 0.80          # ② 平均重合率
OVL_EACH_MIN = 0.50         # ② 单条重合率
SELF_MIN_COS = 0.999        # ③ 自检索余弦
HARD_MAX_RANK = 3           # ③ 难例：目标须在 Top-3


def onnx_encode(model: str, items: list[dict]) -> dict:
    """调 encode_queries.mjs 得到查询向量（返回 {id: np.ndarray}）。"""
    inp = os.path.join(G.DATA_DIR, "_q-in.json")
    outp = os.path.join(G.DATA_DIR, "_q-out.json")
    with open(inp, "w", encoding="utf-8") as fh:      # 无 BOM（PS 的 Set-Content 会加）
        json.dump(items, fh, ensure_ascii=False)
    r = subprocess.run(["node", "encode_queries.mjs", "--model", model, "--in", inp,
                        "--out", outp, "--seq", "140", "--device", "webgpu"],
                       cwd=SPIKE, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("  ✗ encode_queries.mjs 失败（%s）" % r.returncode)
        print((r.stderr or "")[-1500:])
        raise SystemExit(2)
    d = json.load(open(outp, encoding="utf-8"))
    os.remove(inp)
    os.remove(outp)
    import numpy as np
    vecs = {q["id"]: np.asarray(q["vector"], dtype="<f4") for q in d["queries"]}
    print("  ONNX 编码 %d 条 · dim=%d · embedding=%s"
          % (len(vecs), d["dim"], d["embedding_how"]))
    return vecs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GEMMA_ONNX_MODEL", ""))
    ap.add_argument("--new-index", default=os.path.join(G.DATA_DIR, "idx-full"))
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if not args.model:
        print("需要 --model <ONNX 模型目录> 或 GEMMA_ONNX_MODEL")
        return 2
    if not os.path.isdir(args.new_index):
        print("新索引目录不存在：%s（先跑 build_index_onnx.mjs）" % args.new_index)
        return 2

    import numpy as np

    Q = json.load(open(os.path.join(G.DATA_DIR, "quality", "queries-v1.json"), encoding="utf-8"))
    R = json.load(open(os.path.join(G.DATA_DIR, "quality", "refs-v1.json"), encoding="utf-8"))
    problems: list[str] = []

    # ---------- 1) 组装查询并编码 ----------
    enc_in = [{"id": q["id"], "kind": "text", "value": q["text"]} for q in Q["queries"]]
    enc_in += [{"id": r["id"], "kind": "image", "value": r["path"]} for r in R["refs"]]
    print("=" * 96)
    print("G-B ② Top-10 重合率 · ③ 相关性补充")
    print("  查询 %d 文本 + %d 参考图" % (len(Q["queries"]), len(R["refs"])))
    print("ONNX 侧编码（新索引用）:")
    onnx_vecs = onnx_encode(args.model, enc_in)

    # ---------- 2) 新索引：numpy 直接算 Top-K ----------
    header, nv = index_bin.read_index_bin(os.path.join(args.new_index, "index.bin"))
    new_items = index_bin.read_items(os.path.join(args.new_index, "items.json"))
    row_to_rel = {it["vectorRow"]: (it.get("relPath") or it.get("rel_path")) for it in new_items}
    print("  新索引 %d 条 · dim %d" % (nv.shape[0], nv.shape[1]))

    def new_topk(qvec, k=TOP_K):
        cos = nv @ qvec
        order = np.argsort(-cos)[:k]
        return [{"rank": i + 1, "rel_path": row_to_rel.get(int(j)), "score": float(cos[j])}
                for i, j in enumerate(order)]

    # ---------- 3) 旧索引：SearchEngine（torch） ----------
    print("torch 侧编码 + 检索（旧索引用）…")
    import search as search_mod
    eng = search_mod.SearchEngine()
    eng.require_index()
    old_vecs: dict[str, np.ndarray] = {}
    old_top: dict[str, list[dict]] = {}
    for q in Q["queries"]:
        v = eng.encode_text(q["text"])
        old_vecs[q["id"]] = v
        old_top[q["id"]] = eng.search_vector(v, TOP_K)
    for r in R["refs"]:
        v = eng.encode_image(r["path"])
        old_vecs[r["id"]] = v
        old_top[r["id"]] = eng.search_vector(v, TOP_K)
    print("  完成：%d 条查询" % len(old_vecs))

    def rels(hits):
        return [h["rel_path"] for h in hits]

    # ---------- 4) ② Top-10 重合率 ----------
    print()
    print("--- ② Top-10 重合率（文本查询）---")
    per_text = []
    for q in Q["queries"]:
        qid = q["id"]
        a, b = rels(old_top[qid]), [x["rel_path"] for x in new_topk(onnx_vecs[qid])]
        inter = len(set(a) & set(b))
        ov = inter / TOP_K
        per_text.append({"id": qid, "text": q["text"], "overlap": round(ov, 3),
                         "old_top10": a, "new_top10": b})
    ovs = [x["overlap"] for x in per_text]
    avg, lo = sum(ovs) / len(ovs), min(ovs)
    print("  平均重合率 %.3f（阈值 ≥ %.2f）· 最低 %.3f（阈值 ≥ %.2f）"
          % (avg, OVL_AVG_MIN, lo, OVL_EACH_MIN))
    ok_avg, ok_each = avg >= OVL_AVG_MIN, lo >= OVL_EACH_MIN
    print("  [%s] 平均 ≥ %.2f    [%s] 单条 ≥ %.2f"
          % ("OK  " if ok_avg else "FAIL", OVL_AVG_MIN, "OK  " if ok_each else "FAIL", OVL_EACH_MIN))
    if not ok_avg:
        problems.append("② 平均重合率 %.3f < %.2f" % (avg, OVL_AVG_MIN))
    if not ok_each:
        problems.append("② 单条最低重合率 %.3f < %.2f" % (lo, OVL_EACH_MIN))
    for x in sorted(per_text, key=lambda y: y["overlap"])[:5]:
        print("    %.3f  %s" % (x["overlap"], x["text"]))
    if not ok_each:
        print("  ⚠ 低于阈值的查询（须逐条说明）：")
        for x in per_text:
            if x["overlap"] < OVL_EACH_MIN:
                print("    %-22s 重合 %.3f" % (x["text"], x["overlap"]))
                print("      旧: %s" % x["old_top10"][:5])
                print("      新: %s" % x["new_top10"][:5])

    # ---------- 5) 文本塔一致性（独立核对） ----------
    print()
    print("--- 独立核对：文本塔 torch vs ONNX ---")
    tcos = [float(np.dot(old_vecs[q["id"]], onnx_vecs[q["id"]])) for q in Q["queries"]]
    print("  逐条余弦 最小 %.8f · 中位 %.8f（既有结论是 bit-exact）"
          % (min(tcos), float(np.median(tcos))))
    if min(tcos) < 0.9999:
        print("  ⚠ 文本塔两侧出现差异，跨运行时比较查询向量的前提需要重新审视")

    # ---------- 6) ③ 相关性补充 ----------
    print()
    print("--- ③ 相关性补充 ---")
    refs_out = {"self": [], "hard": [], "user": []}
    for r in R["refs"]:
        accept = [r.get("expect_target")] + (r.get("also_acceptable") or [])
        accept = [a for a in accept if a]
        new_hits = new_topk(onnx_vecs[r["id"]])
        old_hits = old_top[r["id"]]
        entry = {"id": r["id"], "kind": r["kind"], "path": os.path.basename(r["path"]),
                 "expect": r.get("expect_target"), "accept": accept,
                 "old_top3": rels(old_hits)[:3], "new_top3": [x["rel_path"] for x in new_hits[:3]]}
        # 该参考图是否在新索引里（小样运行时可能不在 —— 显式处理，不用 next() 抛异常）
        in_index = any((it.get("relPath") or it.get("rel_path")) == r.get("rel_path")
                       for it in new_items)
        if not in_index:
            entry["ok"] = False
            entry["note"] = "该图不在新索引中（小样运行正常，全量运行则为问题）"
            # user 参考图本来就不在库里（没有 rel_path），用文件名报错才有意义
            label = r.get("rel_path") or os.path.basename(r["path"])
            problems.append("③ 参考图不在新索引中：%s" % label)
            print("  [n/a] %-34s 不在新索引中（跳过判定）" % entry["path"][:34])
            refs_out[r["kind"]].append(entry)
            continue
        if r["kind"] == "self":
            rank = next((i + 1 for i, x in enumerate(new_hits) if x["rel_path"] in accept), None)
            top1_cos = new_hits[0]["score"]
            self_cos = next((x["score"] for x in new_hits if x["rel_path"] in accept), 0.0)
            # 同源核对：ONNX 查询向量 vs 新索引里同一张图的行向量
            row = next(it["vectorRow"] for it in new_items
                       if (it.get("relPath") or it.get("rel_path")) == r.get("rel_path"))
            same = float(np.dot(onnx_vecs[r["id"]], nv[row]))
            entry.update({"rank": rank, "cos": round(float(self_cos), 6),
                          "top1_cos": round(float(top1_cos), 6),
                          "encoder_index_same_source_cos": round(same, 8)})
            ok = (rank == 1) and (self_cos >= SELF_MIN_COS)
            entry["ok"] = ok
            if not ok:
                problems.append("③ 自检索未达标：%s（排名 %s · 余弦 %.6f）"
                                % (entry["path"], rank, self_cos))
            print("  [%s] 自检索 %-34s 排名 %s · 余弦 %.6f · 同源 %.8f"
                  % ("OK  " if ok else "FAIL", entry["path"][:34], rank, self_cos, same))
        elif r["kind"] == "hard":
            rank = next((i + 1 for i, x in enumerate(new_hits) if x["rel_path"] in accept), None)
            entry["rank"] = rank
            ok = rank is not None and rank <= HARD_MAX_RANK
            entry["ok"] = ok
            if not ok:
                problems.append("③ 难例未达标：%s（排名 %s）" % (entry["path"], rank))
            print("  [%s] 难例   %-34s 目标排名 %s" % ("OK  " if ok else "FAIL", entry["path"][:34], rank))
        else:
            entry["ok"] = None      # user 参考图无标注 → 只输出供人工复核
            print("  [n/a] 用户参考图 %-30s 新 Top-3: %s"
                  % (entry["path"][:30], [os.path.basename(str(x))[:22] for x in entry["new_top3"]]))
        refs_out[r["kind"]].append(entry)

    # ---------- 7) 输出 ----------
    result = {
        "judgement": "PASS" if not problems else "FAIL",
        "thresholds": {"overlap_avg": OVL_AVG_MIN, "overlap_each": OVL_EACH_MIN,
                       "self_min_cos": SELF_MIN_COS, "hard_max_rank": HARD_MAX_RANK},
        "new_index": os.path.relpath(args.new_index, HERE),
        "top10_overlap": {"average": round(avg, 4), "min": round(lo, 4), "per_query": per_text},
        "text_tower_agreement": {"min_cos": min(tcos), "median_cos": float(np.median(tcos))},
        "refs": refs_out,
        "problems": problems,
    }
    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=1)
        # 也给出一份便于人工复核的 Top-10 差异表
        csv = os.path.join(os.path.dirname(args.out), "top10-diff.csv")
        with open(csv, "w", encoding="utf-8") as fh:
            fh.write("id,text,overlap,rank,old,new,in_both\n")
            for x in per_text:
                for i in range(TOP_K):
                    o = x["old_top10"][i] if i < len(x["old_top10"]) else ""
                    n = x["new_top10"][i] if i < len(x["new_top10"]) else ""
                    fh.write("%s,%s,%.3f,%d,%s,%s,%s\n"
                             % (x["id"], x["text"], x["overlap"], i + 1, o, n,
                                "1" if (o and o in x["new_top10"]) else "0"))
        print()
        print("  报告 → %s" % os.path.relpath(args.out, HERE))
        print("  差异表 → %s" % os.path.relpath(csv, HERE))

    print()
    print("结论：%s" % result["judgement"])
    for p in problems:
        print("  ✗ %s" % p)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())

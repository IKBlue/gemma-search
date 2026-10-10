# -*- coding: utf-8 -*-
"""
verify_app.py —— 索引与服务的独立验证（不复用 build/serve 的推理路径）。

三项检查：
  A. 自检索正确性：拿库里某张图当查询，top-1 必须是它自己（否则索引与向量错位）
  B. 文本→图像跨模态：跑一组已知语义的查询，打印 top-5 供人工判断 + 分数分布
  C. 服务端接口：/api/stats、/api/search、/api/search_image、/api/thumb 的实测
"""
from __future__ import annotations

import json
import os
import random
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import numpy as np                                        # noqa: E402
import gemma_lib as G                                     # noqa: E402

BASE = "http://127.0.0.1:{}".format(os.environ.get("GEMMA_PORT", "8760"))
OK = FAIL = 0


def check(cond, label, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  ✓ {}".format(label))
    else:
        FAIL += 1
        print("  ✗ {}  {}".format(label, detail))


def api(path, data=None, method=None):
    req = urllib.request.Request(BASE + path, data=data,
                                 method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def main() -> int:
    embs, items, meta = G.load_index()
    if embs is None:
        print("索引不存在"); return 2
    norms = np.linalg.norm(embs, axis=1)
    enc = int((norms > 0).sum())
    print("=" * 90)
    print("索引：{} 行 / 已编码 {} / {} 维 / 模型 {}".format(
        len(items), enc, embs.shape[1], meta.get("model_id")))
    print("=" * 90)
    if enc < len(items):
        print("⚠ 索引未完成（{:.1f}%），自检索只抽样已编码部分\n".format(100 * enc / len(items)))

    valid_idx = np.where(norms > 0)[0]

    # ---------- A. 自检索 ----------
    print("A) 自检索正确性（以图搜图，top-1 应为自身）")
    enc_model = G.Encoder()
    random.seed(20261009)
    sample = random.sample(list(valid_idx), min(12, len(valid_idx)))
    hits = 0
    for i in sample:
        it = items[i]
        v = enc_model.encode_images([it["abs_path"]], batch=1)[0]
        sims = embs @ v
        best = int(np.argmax(sims))
        hit = (best == i)
        hits += hit
        print("     {:<30} top1={:<30} {}{}".format(
            it["name"][:28], items[best]["name"][:28],
            "✓" if hit else "✗", "" if hit else " score={:.4f}".format(sims[best])))
    check(hits >= len(sample) - 1, "自检索命中 {}/{}（允许 1 例并列误差）".format(hits, len(sample)))

    # ---------- B. 文本→图像 ----------
    print("\nB) 文本→图像（分数分布 + top-3，供语义合理性判断）")
    queries = ["现代简约布艺沙发", "北欧吊灯", "地毯", "餐椅", "绿植盆栽",
               "床头柜", "卫生间", "厨房橱柜", "窗帘", "装饰画"]
    for q in queries:
        qv = enc_model.encode_text([q], is_query=True)[0]
        sims = np.where(norms > 0, embs @ qv, -1)
        top = np.argsort(-sims)[:3]
        line = " | ".join("{}({:.3f})".format(items[i]["name"][:20], sims[i]) for i in top)
        print("     「{:<10}」 {}".format(q, line))
    print("     说明：分数为余弦相似度，跨模态典型区间约 0.55~0.80，仅作相对排序。")

    # ---------- C. 服务端 ----------
    print("\nC) 服务端接口")
    try:
        s = api("/api/stats")
        check(s.get("indexed") == len(items), "stats.indexed 与本地一致")
        check(s.get("encoded") == enc, "stats.encoded 反映真实已编码数（{} vs {}）".format(
            s.get("encoded"), enc))
        check(s.get("dim") == 768, "stats.dim = 768")
        print("     stats: indexed={} encoded={} partial={} progress={}%".format(
            s.get("indexed"), s.get("encoded"), s.get("partial"), s.get("progress_pct")))

        r = api("/api/search?q=" + urllib.parse.quote("现代简约沙发") + "&k=5")
        check(len(r.get("results", [])) == 5, "文本检索返回 5 条")
        check(all("thumb" in x for x in r["results"]), "结果含缩略图地址")
        print("     文本检索耗时 {}ms".format(r.get("elapsed_ms")))

        r2 = api("/api/search?q=" + urllib.parse.quote("沙发") + "&k=5&folder=VR")
        check(all(x["folder"] == "VR" for x in r2["results"]), "folder 过滤生效（全部为 VR）")

        with open(items[sample[0]]["abs_path"], "rb") as fh:
            raw = fh.read()
        r3 = api("/api/search_image?k=5", data=raw)
        check(r3["results"][0]["name"] == items[sample[0]]["name"],
              "以图搜图 top-1 为该图自身", "得到 " + r3["results"][0]["name"])
        print("     以图搜图耗时 {}ms".format(r3.get("elapsed_ms")))

        req = urllib.request.Request(BASE + "/api/thumb?id={}".format(sample[0]))
        with urllib.request.urlopen(req, timeout=60) as resp:
            check(resp.status == 200 and int(resp.headers["Content-Length"]) > 1000,
                  "缩略图返回有效图片（{} 字节）".format(resp.headers["Content-Length"]))

        it = api("/api/item?id={}".format(sample[0]))
        check(it.get("archive") is not None, "详情能给出同名模型包")
        check(it.get("archive_exists") is True, "模型包在磁盘上存在")
    except Exception as e:                                # noqa: BLE001
        check(False, "服务端接口调用", "{}: {}".format(type(e).__name__, e))

    print("\n" + "=" * 90)
    print("结果：通过 {} / 失败 {}".format(OK, FAIL))
    print("=" * 90)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())

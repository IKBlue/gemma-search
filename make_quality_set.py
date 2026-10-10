# -*- coding: utf-8 -*-
"""
make_quality_set.py —— 生成 G-B 的质量测试集（SPEC-acceptance §2 的输入）

产出四个文件到 data/quality/：
  queries-v1.json   20 条中文查询（六类分布；含 spike 已测过的 5 条，保持连续性）
  refs-v1.json      10 张参考图：user 3 + self 5 + hard 2
  labels-v1.json    标注（**必须独立于两个索引**，否则是循环论证）
  env-v1.json       两侧运行环境与库指纹

规则都是确定性的（同一库+同一代码 → 同一输出），且对每条引用的路径做存在性断言。

⚠ 已知的标注缺口（不粉饰）：3 张 user 参考图**无法推出目标素材** ——
   文件名里的 339007616 / 595812826 / CR12 在库内都不存在（已实测）。
   所以它们的 expect 记为 null、用途标为 human-review-only，
   **不参与自动判定的通过/失败**。
"""
from __future__ import annotations

import hashlib
import json
import os
import sys


# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G  # noqa: E402

OUT = os.path.join(G.DATA_DIR, "quality")

# ---------------- 1) 20 条查询（六类）----------------
# reused_from_spike：与 spike/spike_torch.py 的 TEXTS 一致，保证与既有测量连续
QUERIES = [
    # 常见家具 4
    ("现代简约布艺沙发", "furniture", True),
    ("北欧实木餐椅", "furniture", False),
    ("意式极简茶几", "furniture", False),
    ("现代双人床", "furniture", False),
    # 灯具 6（其中 3 条与 spike 一致；吊灯/吸顶灯构成易混对）
    ("北欧吊灯", "lamp", True),
    ("中古风木质吸顶灯", "lamp", True),
    ("玻璃球多头吊灯", "lamp", True),
    ("现代落地灯", "lamp", False),
    ("简约吸顶灯", "lamp", False),
    ("中古风壁灯", "lamp", False),
    # 软装饰品 4
    ("花卉图案装饰画", "decor", True),
    ("抽象几何挂画", "decor", False),
    ("陶瓷花瓶摆件", "decor", False),
    ("金属质感摆件", "decor", False),
    # 材质 / 风格 3
    ("原木色北欧风格", "material", False),
    ("黄铜金属质感", "material", False),
    ("大理石纹理", "material", False),
    # 低频 / 罕见 3
    ("中古风藤编单椅", "rare", False),
    ("复古黄铜壁灯", "rare", False),
    ("侘寂风陶罐", "rare", False),
]

# 易混对：**必须保持可区分**（吊灯 vs 吸顶灯是实测能区分的难点）
CONFUSABLE = [("q05", "q06"), ("q07", "q09")]

# ---------------- 2) 已核实的"内容重复"组（probe_identity_facts.py 实测）----------------
# 来源：spike/probes/probe_identity_facts.py 输出「内容重复的组 5 组」（全库只有这 5 组）。
# ALL_DUP_GROUPS 用于**判定孪生**：自检索案例若恰好是重复图之一，命中孪生也算对
#   （两者 sha1 相同 → 余弦都是 1.0，Top-1 取哪个都不算错）。
ALL_DUP_GROUPS = [
    ["CR\\ID-689938.jpeg", "VR\\ID-461212.jpeg"],
    ["CR+VR\\ID-15515142.jpg", "VR\\ID-502271891.jpg"],
    ["VR\\ID-1141703070.jpg", "VR\\ID-14257437.jpg"],
    ["VR\\ID-125229472.jpg", "其他\\125229472.jpg"],
    ["VR\\ID-13047663.jpeg", "VR\\ID-1411886.jpg"],
]
# 取其中 2 组作"难例"参考图：优先跨文件夹的组（同内容跨分类，最能暴露按文件夹的偏置）
DUP_GROUPS = [ALL_DUP_GROUPS[0], ALL_DUP_GROUPS[3]]



def fingerprint(root: str) -> tuple[str, int]:
    """与 SPEC-identity §5 v1 同算法（只读）。"""
    lines, n = [], 0
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            full = os.path.join(dp, fn)
            st = os.stat(full)
            rel = os.path.relpath(full, root)
            lines.append("%s\t%d\t%d\t%s" % (rel, st.st_size, int(st.st_mtime * 1000),
                                             os.path.splitext(fn)[1].lower()))
            n += 1
    h = hashlib.sha1()
    h.update(b"v1\n")
    for ln in sorted(lines):
        h.update(ln.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest(), n


def pick_distinct(items: list[str], k: int) -> list[str]:
    """从小列表里取 k 个**互不相同**的项（等比展开）。

    踩过的坑：最初用 min(499,n-1)/min(1499,n-1)，在小文件夹（CR+VR 只有 78 个）
    上会塌成同一个索引 → 同一路径重复出现，自检索案例就废了。
    """
    n = len(items)
    if n == 0:
        return []
    if n <= k:
        return items[:]
    idx = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)}) if k > 1 else [0]
    return [items[i] for i in idx]


def read_pkg_version(name: str) -> str | None:
    p = os.path.join(HERE, "onnx-spike", "node_modules", name, "package.json")
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh).get("version")
    except OSError:
        return None


def main() -> int:
    problems: list[str] = []
    os.makedirs(OUT, exist_ok=True)

    # ---------- 库清单 ----------
    by_folder: dict[str, list[str]] = {}
    all_imgs: set[str] = set()
    for dp, _dn, fns in os.walk(G.LIBRARY_ROOT):
        for fn in fns:
            if os.path.splitext(fn)[1].lower() not in G.IMG_EXT:
                continue
            rel = os.path.relpath(os.path.join(dp, fn), G.LIBRARY_ROOT)
            by_folder.setdefault(rel.split(os.sep)[0], []).append(rel)
            all_imgs.add(rel)
    for v in by_folder.values():
        v.sort()

    # ---------- queries-v1.json ----------
    qs = []
    for i, (text, cat, reused) in enumerate(QUERIES, 1):
        qid = "q%02d" % i
        conf = [b for a, b in CONFUSABLE if a == qid] + [a for a, b in CONFUSABLE if b == qid]
        qs.append({"id": qid, "text": text, "category": cat,
                   "reused_from_spike": reused, "confusable_with": conf})
    queries = {
        "_note": "20 条中文查询，六类分布。**候选规模，不是已验证的充分统计样本**"
                 "（见 SPEC-acceptance §2.1）。带 reused_from_spike 的 5 条与 spike/spike_torch.py 一致。",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "library_root": G.LIBRARY_ROOT,
        "count": len(qs),
        "queries": qs,
    }

    # ---------- refs-v1.json ----------
    refs = []
    qdir = os.path.join(G.DATA_DIR, "queries")
    for f in sorted(os.listdir(qdir)):
        p = os.path.join(qdir, f)
        refs.append({
            "id": "r-user-%s" % os.path.splitext(f)[0],
            "kind": "user",
            "path": p,
            "expect_target": None,
            "use": "human-review-only",
            "note": "文件名里的数字在库内不存在（已实测），无法推出目标素材 → 不参与自动判定",
        })

    self_picks = []
    for folder, k in (("VR", 3), ("CR", 1), ("CR+VR", 1)):
        self_picks += pick_distinct(by_folder.get(folder, []), k)
    # 同内容孪生图：自检索案例若恰好是重复图之一，命中孪生也算对
    # （两者 sha1 相同 → 余弦都是 1.0，Top-1 取哪个都不算错）
    twin_of: dict[str, list[str]] = {}
    for group in ALL_DUP_GROUPS:
        for a in group:
            twin_of[a] = [b for b in group if b != a]
    for rel in self_picks:
        refs.append({
            "id": "r-self-" + rel.replace("\\", "/").replace("/", "_"),
            "kind": "self",
            "path": os.path.join(G.LIBRARY_ROOT, rel),
            "rel_path": rel,
            "expect_target": rel,
            "also_acceptable": twin_of.get(rel, []),
            "use": "Top-1 自检索，且余弦 ≥ 0.999",
            "note": "库内自检索：查询图就是库内素材，必须命中自己"
                    + ("（该图有内容相同的孪生，命中孪生同样算对）" if rel in twin_of else ""),
        })

    for gi, group in enumerate(DUP_GROUPS, 1):
        q, t = group[0], group[1]
        refs.append({
            "id": "r-hard-dup%d" % gi,
            "kind": "hard",
            "path": os.path.join(G.LIBRARY_ROOT, q),
            "rel_path": q,
            "expect_target": t,
            "also_acceptable": [q],       # 查询图自身也在库内，命中自己同样说明"找到了同款"
            "use": "目标（同内容另一份）在 Top-3",
            "note": "内容 sha1 相同的跨文件夹重复图；同内容理应为 Top-1（余弦≈1.0）",
        })

    refs_json = {
        "_note": "10 张参考图：user 3（无标注，仅人工复核）+ self 5（库内自检索）+ hard 2（内容重复对）。"
                 "重复组来自 spike/probes/probe_identity_facts.py 的实测结果。",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(refs),
        "refs": refs,
    }

    # ---------- labels-v1.json ----------
    labels = {
        "_note": "标注**独立于两个索引**（不从旧索引 Top-N 反推，避免循环论证）。"
                 "文本查询无标注 —— 它们只参与 ②Top-10 重合率 与 ④人工复核。"
                 "user 参考图无标注（目标不可知）。",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "coverage": {
            "text_queries_total": len(qs),
            "text_queries_labeled": 0,
            "refs_total": len(refs),
            "refs_labeled": sum(1 for r in refs if r["expect_target"]),
        },
        "labels": [
            {"id": r["id"], "kind": r["kind"],
             "expect_target": r["expect_target"],
             "also_acceptable": r.get("also_acceptable", []),
             "criterion": r["use"]}
            for r in refs
        ],
    }

    # ---------- env-v1.json ----------
    fp, nfiles = fingerprint(G.LIBRARY_ROOT)
    model_dir = None
    pf = os.path.join(OUT, "preflight-p05.json")
    if os.path.exists(pf):
        try:
            with open(pf, encoding="utf-8") as fh:
                model_dir = json.load(fh).get("model_dir")
        except OSError:
            pass
    revision = None
    if model_dir:
        revision = next((s for s in model_dir.replace("/", os.sep).split(os.sep)
                         if len(s) == 40 and all(c in "0123456789abcdef" for c in s)), None)
    env = {
        "_note": "两侧（旧 torch 档 / 新 ONNX 档）的运行环境与库指纹。"
                 "G-B 报告必须与本文件一起归档。",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "library": {"root": G.LIBRARY_ROOT, "fingerprint_v1": fp, "files_total": nfiles,
                    "by_folder": {k: len(v) for k, v in sorted(by_folder.items())}},
        "old_index": {"runtime": "torch (sentence-transformers, Python)",
                      "data_dir": G.DATA_DIR,
                      "embeddings": os.path.relpath(G.EMB_PATH, HERE),
                      "seq_length": 140, "dim": 768, "embedding_dtype": "float32"},
        "new_index": {"runtime": "ONNX Runtime (transformers.js, Node)",
                      "model_dir": model_dir, "model_revision": revision,
                      "weights_dtype": "fp32", "seq_length": 140, "dim": 768,
                      "preprocessing_version": 1, "device": "webgpu"},
        "runtime_versions": {
            "transformers.js": read_pkg_version("@huggingface/transformers"),
            "onnxruntime-node": read_pkg_version("onnxruntime-node"),
            "bmp-js": read_pkg_version("bmp-js"),
        },
    }

    # ---------- 存在性断言 ----------
    for r in refs:
        if not os.path.exists(r["path"]):
            problems.append("参考图不存在: %s" % r["path"])
        t = r.get("expect_target")
        if t and t not in all_imgs:
            problems.append("期望目标不在库内: %s（来自 %s）" % (t, r["id"]))
    if len(QUERIES) != 20:
        problems.append("查询数不是 20：%d" % len(QUERIES))
    if len({q["text"] for q in qs}) != len(qs):
        problems.append("查询文本有重复")
    if len(refs) != 10:
        problems.append("参考图数不是 10：%d" % len(refs))

    # ---------- 写盘 ----------
    for name, obj in (("queries-v1.json", queries), ("refs-v1.json", refs_json),
                      ("labels-v1.json", labels), ("env-v1.json", env)):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=1)
        print("  写出 %-18s %6d 字节" % (name, os.path.getsize(os.path.join(OUT, name))))

    print()
    print("  查询 %d 条（类别 %s）" % (len(qs), {c: sum(1 for q in qs if q["category"] == c)
                                             for c in sorted({q["category"] for q in qs})}))
    print("  参考图 %d 张（%s）" % (len(refs), {k: sum(1 for r in refs if r["kind"] == k)
                                             for k in ("user", "self", "hard")}))
    print("  已标注 %d / %d（文本查询无标注：%d）"
          % (labels["coverage"]["refs_labeled"], len(refs), len(qs)))
    print("  库指纹 %s（%d 文件）" % (fp[:12], nfiles))
    print()
    if problems:
        print("  ⛔ 断言失败 %d 项：" % len(problems))
        for p in problems:
            print("     - %s" % p)
        return 1
    print("  ✅ 全部断言通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

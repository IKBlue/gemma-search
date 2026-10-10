# -*- coding: utf-8 -*-
"""
探针：验证 EmbeddingGemma 2 能加载，并确定【图像】的正确调用方式。

README 只给了文本的显式例子（prompt_name="SearchQuery"），
图像的调用形态需实测确定并在 build_index 前固定下来。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np                                        # noqa: E402
import gemma_lib as G                                     # noqa: E402


def main() -> int:
    print("=" * 88)
    print("0) 载入模型")
    print("=" * 88)
    enc = G.Encoder()
    t0 = time.time()
    m = enc.model
    print("   载入用时 {:.1f}s".format(time.time() - t0))
    print("   最大序列长度:", getattr(m, "max_seq_length", "?"))
    try:
        print("   输出维度    :", m.get_sentence_embedding_dimension())
    except Exception as e:                                # noqa: BLE001
        print("   输出维度查询失败:", e)

    print("\n" + "=" * 88)
    print("1) 文本编码（官方用法）")
    print("=" * 88)
    v = enc.encode_text(["客厅沙发 现代简约"], is_query=True)
    print("   shape={} dtype={} L2={:.6f}".format(v.shape, v.dtype, float(np.linalg.norm(v[0]))))
    if np.isnan(v).any():
        print("   ✗ 出现 NaN —— dtype 或加载方式有问题！")
    v2 = enc.encode_text(["北欧风格布艺沙发茶几组合"], is_query=False)
    print("   查询/文档 余弦 = {:.4f}".format(float(v[0] @ v2[0])))

    print("\n" + "=" * 88)
    print("2) 图像编码 —— 三种形态逐一实测")
    print("=" * 88)
    items = G.find_items()[:3]
    if not items:
        print("   素材库没扫到图，跳过")
        return 1
    for it in items:
        print("   样本: {} ({})".format(it.name, it.folder))

    paths = [it.abs_path for it in items]
    forms = {
        "dict(单条)": lambda p: m.encode({"image": p}, normalize_embeddings=True,
                                         convert_to_numpy=True),
        "dict(批量)": lambda p: m.encode([{"image": x} for x in p],
                                         normalize_embeddings=True, convert_to_numpy=True),
    }
    for label, fn in forms.items():
        try:
            t = time.time()
            out = fn(paths[0] if "单条" in label else paths)
            arr = np.atleast_2d(np.asarray(out, dtype=np.float32))
            print("   {:<12} OK  shape={} L2={:.4f} 用时 {:.2f}s".format(
                label, arr.shape, float(np.linalg.norm(arr[0])), time.time() - t))
        except Exception as e:                            # noqa: BLE001
            print("   {:<12} 失败 {}: {}".format(label, type(e).__name__, str(e)[:110]))

    print("\n" + "=" * 88)
    print("3) 跨模态检索合理性抽查（文本查询 → 应命中语义相近的图）")
    print("=" * 88)
    try:
        t = time.time()
        iv = enc.encode_images(paths, batch=3)
        print("   图像向量 shape={} 用时 {:.1f}s ({:.2f}s/张)".format(
            iv.shape, time.time() - t, (time.time() - t) / len(paths)))
        tests = [("客厅 沙发 茶几", 0), ("吊灯 灯具", 1), ("植物 绿植", 2)]
        for q, expect in tests:
            qv = enc.encode_text([q], is_query=True)[0]
            sims = iv @ qv
            best = int(np.argmax(sims))
            print("   查询「{:<12}」 -> 最相似: {} (score={:.4f})  期望第 {} 张 {}".format(
                q, items[best].name[:24], sims[best], expect + 1,
                "✓" if best == expect else "(不必然，仅供参考)"))
    except Exception as e:                                # noqa: BLE001
        print("   图像编码失败:", type(e).__name__, str(e)[:200])
        return 1

    print("\n   最终采用的图像编码方式: Encoder._mode =", G.Encoder._mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())

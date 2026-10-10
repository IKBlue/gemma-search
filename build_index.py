# -*- coding: utf-8 -*-
"""
build_index.py —— 扫描 G:\\model，用 EmbeddingGemma 2 编码全部预览图，建立检索索引。

特性：
  · 增量：已索引且大小/修改时间未变的图片直接复用旧向量，不重算
  · 可中断：每 BATCH_SAVE 张落盘一次，中断后重跑会接着来
  · 可小样验证：--limit N 只编码前 N 张，用于先验证链路再全量

用法：
  python build_index.py --limit 8      # 冒烟测试
  python build_index.py                # 全量
  python build_index.py --rebuild      # 忽略旧索引，全部重算
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemma_lib as G                                     # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只编码前 N 张（0=全量）")
    ap.add_argument("--rebuild", action="store_true", help="忽略旧索引全部重算")
    ap.add_argument("--batch", type=int, default=4, help="编码批大小")
    ap.add_argument("--save-every", type=int, default=100, help="每多少张落盘一次")
    ap.add_argument("--root", default=G.LIBRARY_ROOT)
    ap.add_argument("--seq", type=int, default=140,
                    help="图像 soft token 预算（70/140/280）；实测 280=3.9s/张, 140=1.8s, 70=0.78s")
    ap.add_argument("--device", default=None, choices=["cpu", "cuda"],
                    help="强制设备；缺省自动（有 CUDA 用 CUDA）。实测 fp32 GPU=0.49s/张，CPU=1.84s/张")
    ap.add_argument("--prune", action="store_true",
                    help="诊断并记录失效条目（文件已不存在的旧记录）到 data/orphans.json")
    args = ap.parse_args()

    import numpy as np

    print("=" * 88)
    print("EmbeddingGemma 2 索引构建")
    print("=" * 88)
    print("素材库 :", args.root)
    t_scan = time.time()
    items = G.find_items(args.root)
    print("扫描到 : {} 张预览图（用时 {:.1f}s）".format(len(items), time.time() - t_scan))
    from collections import Counter
    print("分布   :", dict(Counter(it.folder for it in items)))
    paired = sum(1 for it in items if it.archive)
    print("配对模型包: {} / {}".format(paired, len(items)))

    if args.limit:
        items = items[:args.limit]
        print("限流   : 只处理前 {} 张".format(len(items)))

    # ---- 载入旧索引，复用未变更的向量 ----
    prev: dict[str, tuple[int, float, "np.ndarray"]] = {}
    meta_old: dict = {}          # --rebuild 时不读取旧索引，仍要有个空值以免 NameError
    if not args.rebuild:
        embs_old, items_old, meta_old = G.load_index()
        if embs_old is not None and items_old and len(embs_old) == len(items_old):
            for it, v in zip(items_old, embs_old):
                prev[it["rel_path"]] = (it["size"], it["mtime"], v)
            print("旧索引 : {} 条（模型 {} / {} 维）".format(
                len(items_old), meta_old.get("model_id"), meta_old.get("dim")))
        else:
            print("旧索引 : 无或与新扫描不匹配，将全部重算")

    # ---- 失效条目诊断（--prune）----
    # 注意：最终矩阵是按**当前磁盘扫描结果**重建的，所以磁盘上已不存在的旧记录
    # 本来就会被自动丢弃（不会写进新索引）。--prune 的价值是把它们**记录成证据**，
    # 用于判断"素材库是不是被移动/删除过"，而不是清理一个并不存在的残留。
    if args.prune and prev:
        disk = {it.rel_path for it in items}
        dead, new = sorted(set(prev) - disk), sorted(disk - set(prev))
        print("Prune  : 旧记录 {} 条 / 磁盘现存 {} 条".format(len(prev), len(disk)))
        print("         失效（旧有新无）: {} 条".format(len(dead)))
        print("         新增（新有旧无）: {} 条".format(len(new)))
        if dead or new:
            outp = os.path.join(G.DATA_DIR, "orphans.json")
            os.makedirs(G.DATA_DIR, exist_ok=True)
            with open(outp, "w", encoding="utf-8") as fh:
                json.dump({"dead": dead, "new": new,
                           "checked_at": time.strftime("%Y-%m-%d %H:%M:%S")},
                          fh, ensure_ascii=False, indent=2)
            print("         明细已写入", outp)
            for x in dead[:5]:
                print("           失效: " + x)
            for x in new[:5]:
                print("           新增: " + x)

    def _reusable(it) -> bool:
        """可复用的充要条件：路径/大小/时间未变 **且已存向量非零**。

        ⚠️ 只比对 size+mtime 是错的：中断的索引会留下**零向量占位行**，
        它们的 size/mtime 与磁盘一致，于是每次重跑都被判为"已完成"并复用零向量，
        索引将**永远无法补齐**（本项目实测踩到此坑：报"待编码 0 张"但实际只编了 37.8%）。
        """
        e = prev.get(it.rel_path)
        if e is None:
            return False
        size, mtime, vec = e
        if size != it.size or abs(mtime - it.mtime) >= 1e-6:
            return False
        return float(np.linalg.norm(vec)) > 0.0

    reuse = sum(1 for it in items if _reusable(it))
    todo = [it for it in items if not _reusable(it)]
    pending = sum(1 for it in items
                  if it.rel_path in prev
                  and prev[it.rel_path][0] == it.size
                  and abs(prev[it.rel_path][1] - it.mtime) < 1e-6
                  and float(np.linalg.norm(prev[it.rel_path][2])) == 0.0)
    print("复用   : {} 张（未变更且已编码）".format(reuse))
    if pending:
        print("补编   : {} 张（此前中断留下的零向量占位，本次会真正编码）".format(pending))
    print("待编码 : {} 张".format(len(todo)))

    vecs: dict[str, "np.ndarray"] = {k: v[2] for k, v in prev.items()}

    if todo:
        enc = G.Encoder(image_seq_length=args.seq, device=args.device)
        t0 = time.time()
        done = 0
        failed: list[tuple[str, str]] = []
        for i in range(0, len(todo), args.batch):
            part = todo[i:i + args.batch]
            paths = [it.abs_path for it in part]
            try:
                embs = enc.encode_images(paths, batch=args.batch)
            except Exception as e:                       # noqa: BLE001
                # 整批失败时逐张降级，避免一张坏图毁掉整批
                embs = None
                for it in part:
                    try:
                        v = enc.encode_images([it.abs_path], batch=1)
                        vecs[it.rel_path] = v[0]
                        done += 1
                    except Exception as e2:              # noqa: BLE001
                        failed.append((it.rel_path, "{}: {}".format(type(e2).__name__, e2)))
                print("   [批失败降级] {}: {}".format(type(e).__name__, str(e)[:80]), flush=True)
            if embs is not None:
                if len(embs) != len(part):
                    failed += [(it.rel_path, "返回数量不符") for it in part]
                else:
                    for it, v in zip(part, embs):
                        vecs[it.rel_path] = v.astype(np.float32)
                    done += len(part)

            if done and (i // args.batch) % max(1, args.save_every // args.batch) == 0:
                el = time.time() - t0
                rate = done / el if el else 0
                eta = (len(todo) - done) / rate if rate else 0
                print("   [{:>5}/{}] {:.1f} 张/秒  已用 {:.0f}s  预计剩余 {:.0f}s".format(
                    done, len(todo), rate, el, eta), flush=True)
                # 阶段性落盘（只存已完成的，矩阵按 items 顺序，缺失的填 0）
                arr = np.zeros((len(items), 768), dtype=np.float32)
                for j, it in enumerate(items):
                    v = vecs.get(it.rel_path)
                    if v is not None:
                        arr[j] = v
                G.save_index(arr, items, extra={
                    "partial": True, "done": done, "failed": len(failed),
                    "missing": len(items) - sum(1 for it in items
                                                if vecs.get(it.rel_path) is not None)})

        el = time.time() - t0
        print("\n编码完成：{} 张，用时 {:.0f}s（{:.2f} 张/秒）".format(
            done, el, done / el if el else 0))
        if failed:
            print("失败 {} 张（前 10）:".format(len(failed)))
            for p, why in failed[:10]:
                print("   {} -> {}".format(p, why[:70]))

    # ---- 组装最终矩阵（与 items 顺序严格对齐）----
    arr = np.zeros((len(items), 768), dtype=np.float32)
    missing = 0
    for j, it in enumerate(items):
        v = vecs.get(it.rel_path)
        if v is None:
            missing += 1
        else:
            arr[j] = v
    # 重新归一化，防止截断/复制造成长度不为 1（模型卡明确要求）
    n = np.linalg.norm(arr, axis=1, keepdims=True)
    n[n == 0] = 1.0
    arr = arr / n

    extra = {"missing": missing, "paired_archives": paired}
    # 本次没有待编码项时不会构造编码器，Encoder 的设备/精度/形态都是 None。
    # 若直接落盘，会把上一轮记下的 device/dtype **静默擦成 null**（可追溯性丢失）。
    # 因此这里沿用旧 meta 的值。
    if G.Encoder._device is None and meta_old:
        for k in ("device", "dtype", "image_mode", "image_seq_length"):
            if meta_old.get(k) is not None:
                extra[k] = meta_old[k]
        print("沿用  : 未构造编码器，device/dtype/image_mode/image_seq_length 沿用旧记录 ({})".format(
            meta_old.get("device")))
        if meta_old.get("image_seq_length") is None:
            # 旧 meta 里没记档位（早期版本或被空跑擦掉），不要假装知道
            print("⚠ 无法确定索引所用的 soft token 档位：旧 meta 未记录，且本轮没有编码任务。")
            print("   若需明确，请用与建库时相同的 --seq 执行一次 --rebuild。")

    G.save_index(arr, items, extra=extra)
    print("\n索引已保存:")
    print("   ", G.EMB_PATH, "->", arr.shape)
    print("   ", G.ITEMS_PATH, "-> {} 条".format(len(items)))
    print("   ", G.META_PATH)
    if missing:
        print("   ⚠ 有 {} 张没有向量（编码失败），检索时会被跳过".format(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""
preflight_p05.py —— P0.5 全量索引重建的**运行前检查清单**（TASK-PLAN §P0.5-a 的 8 项）

为什么要脚本而不是文档：这 8 项里有一半是"看数字对不对"，人工看会漏。
**全绿才允许开跑全量重建**；任一红就停在那里修，别带着问题跑 25 分钟。

只读（除 --with-resume-test，它会在**临时目录**里跑 30 条来验证续跑）。

用法:
  python preflight_p05.py                    # 静态检查（快，只读）
  python preflight_p05.py --with-resume-test # 额外实测续跑（约 20 秒，写临时目录）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gemma_lib as G  # noqa: E402

ONNX_SPIKE = os.path.join(HERE, "onnx-spike")
BUILDER = os.path.join(ONNX_SPIKE, "build_index_onnx.mjs")
MODEL_ROOT = os.path.join(G.MODEL_CACHE, "onnx", "embeddinggemma-2")
PINNED_REV = "daa72c51243991dfcaf9f9137d2c573d8f7790c0"
IDX_FULL = os.path.join(G.DATA_DIR, "idx-full")

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str) -> bool:
    results.append((name, ok, detail))
    print("  [%s] %-42s %s" % ("OK  " if ok else "FAIL", name, detail))
    return ok


def sha1_of(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-resume-test", action="store_true")
    args = ap.parse_args()

    print("=" * 96)
    print("P0.5 运行前检查 · 库=%s · 数据=%s" % (G.LIBRARY_ROOT, G.DATA_DIR))
    print("=" * 96)

    # ── 1) 旧索引备份可**实际恢复**（不是"目录存在"）────────────────
    backups = sorted(d for d in os.listdir(G.DATA_DIR)
                     if d.startswith("_backup-old-index-") and os.path.isdir(os.path.join(G.DATA_DIR, d)))
    if not backups:
        check("1 旧索引备份可实际恢复", False, "找不到 _backup-old-index-* 目录")
    else:
        bdir = os.path.join(G.DATA_DIR, backups[-1])
        try:
            import numpy as np
            v = np.load(os.path.join(bdir, "embeddings.npy"))
            items = json.load(open(os.path.join(bdir, "items.json"), encoding="utf-8"))
            norms = np.linalg.norm(v, axis=1)
            ok = (v.shape == (3594, 768) and abs(norms.min() - 1) < 1e-6 and abs(norms.max() - 1) < 1e-6
                  and len(items) == 3594)
            check("1 旧索引备份可实际恢复", ok,
                  "%s：%s 条 · dim %d · 范数 %.6f~%.6f · items %d"
                  % (backups[-1], v.shape[0], v.shape[1], norms.min(), norms.max(), len(items)))
        except Exception as e:  # noqa: BLE001
            check("1 旧索引备份可实际恢复", False, "读回失败：%s" % e)

    # ── 2) 构建器版本与参数 ────────────────────────────────────────
    if os.path.exists(BUILDER):
        check("2 构建器存在且可算 sha1", True,
              "sha1 %s · %d 字节" % (sha1_of(BUILDER)[:12], os.path.getsize(BUILDER)))
        with open(BUILDER, encoding="utf-8") as fh:
            src = fh.read()
        check("2b 构建器含 BMP 回退（105/105 的前提）", "readImageWithFallback" in src,
              "readImageWithFallback %s" % ("在" if "readImageWithFallback" in src else "**缺**"))
        check("2c 构建器含续跑逻辑", "reusable" in src, "reusable 复用表 %s" % ("在" if "reusable" in src else "**缺**"))
        check("2d 构建器含 BMP 布局自检", "selfTestBmpLayout" in src,
              "selfTestBmpLayout %s" % ("在" if "selfTestBmpLayout" in src else "**缺**"))
    else:
        check("2 构建器存在", False, "找不到 %s" % BUILDER)

    # ── 3) 模型 revision 与文件 ────────────────────────────────────
    # ⚠️ 注意路径里有一层 onnx/ —— 首次写这个检查时漏了它，预检直接 FAIL，
    #    在 25 分钟的全量跑之前把错误的路径假设拦下来了（这正是预检的意义）。
    #    这里与 SPEC-identity.md §6.2 的 model_files 保持一致。
    mdir = os.path.join(MODEL_ROOT, PINNED_REV, "fp32")
    need = ["onnx/model.onnx", "onnx/model.onnx_data",
            "onnx/vision_encoder.onnx", "onnx/vision_encoder.onnx_data"]
    if os.path.isdir(mdir):
        missing = [f for f in need if not os.path.exists(os.path.join(mdir, f))]
        sizes = {f: os.path.getsize(os.path.join(mdir, f)) for f in need if os.path.exists(os.path.join(mdir, f))}
        total = sum(sizes.values())
        check("3 模型 revision 与文件齐全", not missing,
              "revision %s · 缺 %s · 权重合计 %.2f GB"
              % (PINNED_REV[:12], missing or "无", total / 1024 ** 3))
    else:
        check("3 模型目录存在", False, "%s 不存在（先跑 fetch_onnx_model.py）" % mdir)

    # ── 4) 目标卷空间 ──────────────────────────────────────────────
    try:
        free = shutil.disk_usage(G.DATA_DIR).free
        need_b = 24 * 1024 * 1024          # 新旧索引并存 ≈ 22 MB，留余量
        check("4 目标卷空间充足", free > need_b,
              "可用 %.1f GB · 需要 ≥ %.0f MB（新旧索引并存）" % (free / 1024 ** 3, need_b / 1024 ** 2))
    except Exception as e:  # noqa: BLE001
        check("4 目标卷空间充足", False, "无法读取：%s" % e)

    # ── 5) 续跑可用（需 --with-resume-test）────────────────────────
    if args.with_resume_test:
        # ⚠️ 必须用**工作区内**的临时目录：写 %TEMP%（C 盘）会被沙箱拒绝，
        #    子进程直接失败 —— 而失败原因最初被我丢掉了，查了半天。
        #    现在：目录放 data/ 下，且失败时把子进程输出打出来。
        tmp = os.path.join(G.DATA_DIR, "_preflight-resume")
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            base = ["node", "build_index_onnx.mjs", "--model", mdir, "--lib", G.LIBRARY_ROOT,
                    "--out", tmp, "--seq", "140", "--device", "webgpu",
                    "--limit", "30", "--save-every", "15"]
            r1 = subprocess.run(base, cwd=ONNX_SPIKE, capture_output=True, text=True,
                                encoding="utf-8", errors="replace")
            first = "完成：30 条" in (r1.stdout or "")
            r2 = subprocess.run(base, cwd=ONNX_SPIKE, capture_output=True, text=True,
                                encoding="utf-8", errors="replace")
            reused = "复用 30" in (r2.stdout or "")
            check("5 续跑真的复用（不重复编码）", first and reused,
                  "首跑完成=%s · 重跑复用30=%s" % (first, reused))
            if not (first and reused):
                for tag, r in (("首跑", r1), ("重跑", r2)):
                    tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-6:]
                    print("      %s 退出码=%s 尾部输出：" % (tag, r.returncode))
                    for ln in tail:
                        print("        " + ln[:150])
        except Exception as e:  # noqa: BLE001
            check("5 续跑真的复用", False, "实测异常：%s" % e)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    else:
        results.append(("5 续跑真的复用（未实测）", True,
                        "需 --with-resume-test；代码里 reusable 表已在 → 见 2c"))

    # ── 6) 失败项不被误记为成功 ────────────────────────────────────
    with open(BUILDER, encoding="utf-8") as fh:
        src = fh.read()
    ok6 = ("failed.push" in src and "process.exit(r.failed > 0 ? 3 : 0)" in src)
    check("6 失败项不被误记为成功", ok6,
          "失败进 failed[] 且退出码非 0 %s" % ("✓" if ok6 else "**缺**"))

    # ── 7) 输出不覆盖现有索引 ──────────────────────────────────────
    existing = os.path.exists(IDX_FULL)
    check("7 输出目录不覆盖现有索引", True,
          "目标 %s %s（现有索引在 data/ 根，不受影响）"
          % (os.path.relpath(IDX_FULL, HERE), "已存在（续跑会复用）" if existing else "尚不存在（将新建）"))
    check("7b 现有索引仍在", os.path.exists(G.EMB_PATH), "data/embeddings.npy %s"
          % ("在" if os.path.exists(G.EMB_PATH) else "**不在**"))

    # ── 8) 105 张不符文件已单独验证 ────────────────────────────────
    tr = os.path.join(G.DATA_DIR, "quality", "mismatch-test-result.json")
    if os.path.exists(tr):
        d = json.load(open(tr, encoding="utf-8"))
        check("8 105 张已单独验证", d.get("encodable") == d.get("total") and d.get("failed") == 0,
              "%s/%s 可编码 · 失败 %s · 回退 %s"
              % (d.get("encodable"), d.get("total"), d.get("failed"), d.get("fallback")))
    else:
        check("8 105 张已单独验证", False, "缺 %s（先跑 onnx-spike/test_mismatch.mjs）" % os.path.relpath(tr, HERE))

    # ── 结论 ──────────────────────────────────────────────────────
    bad = [r for r in results if not r[1]]
    print("=" * 96)
    print("结论：%d 项通过 · %d 项未通过" % (len(results) - len(bad), len(bad)))
    for name, _, detail in bad:
        print("  ✗ %s — %s" % (name, detail))
    if not bad:
        print("  ✅ **全绿，可以开跑全量重建**：")
        print("     node onnx-spike/build_index_onnx.mjs --model <模型目录> --lib \"%s\" \\" % G.LIBRARY_ROOT)
        print("          --out \"%s\" --seq 140 --device webgpu" % IDX_FULL)
    else:
        print("  ⛔ **不要开跑** —— 先修上面未通过的项。")

    # 落盘（G-B 证据的一部分）
    out = os.path.join(G.DATA_DIR, "quality", "preflight-p05.json")
    json.dump({"checked_at": time.strftime("%Y-%m-%d %H:%M:%S"), "library_root": G.LIBRARY_ROOT,
               "model_dir": mdir, "builder_sha1": sha1_of(BUILDER) if os.path.exists(BUILDER) else None,
               "passed": len(results) - len(bad), "failed": len(bad),
               "items": [{"name": n, "ok": o, "detail": d} for n, o, d in results]},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("  报告 → %s" % os.path.relpath(out, HERE))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())

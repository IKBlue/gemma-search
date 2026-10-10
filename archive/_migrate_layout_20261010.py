# -*- coding: utf-8 -*-
"""data/_migrate_layout.py —— 根目录脚本归类（一次性；带 dry-run）

规则（每个文件都必须命中，命中数不符就报错退出，不静默放过）：
  1) `HERE = os.path.dirname(os.path.abspath(__file__))`
     → HERE + _gs_root()（向上找含 core/engine.mjs 的那一级）+ ROOT = _gs_root(HERE)
     为什么不写死 `dirname(HERE)`：tools/ 与 tools/quality/ 深度不同，
     而且将来再挪一次也不会错 —— 找不到根就**大声失败**（宁可报错，不要静默用错根）。
  2) `sys.path.insert(0, HERE)` → 插入 ROOT 与 HERE、HERE 的父级
     （前者为了 `import gemma_lib`，后两者为了同级模块如 `import index_bin`）
  3) 其余所有 `HERE` → `ROOT`（`HERE` 在原始代码里就等于项目根）
  4) .mjs 同理：加 ROOT 常量并替换用法
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PY_HEADER = '''HERE = os.path.dirname(os.path.abspath(__file__))


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
'''

PY_SYSPATH_OLD = "sys.path.insert(0, HERE)"
PY_SYSPATH_NEW = """for _p in (ROOT, HERE, os.path.dirname(HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)"""

JS_HEADER = '''const HERE = path.dirname(fileURLToPath(import.meta.url));

// 项目根：向上找到含 core/engine.mjs 的那一级（搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'core', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 core/engine.mjs）');
    p = up;
  }
})();
'''

# 这些文件**刻意不改写**（没有"本文件所在目录 = 项目根"的假设）
NO_PATCH = {"index_bin.py"}

MOVES = {
    # 门禁与校验 → tools/
    "check_staged.py": "tools/check_staged.py",
    "scan_repo_pollution.py": "tools/scan_repo_pollution.py",
    "verify_docs.py": "tools/verify_docs.py",
    "verify_tokens.py": "tools/verify_tokens.py",
    "verify_resize.py": "tools/verify_resize.py",
    "verify_app_build.mjs": "tools/verify_app_build.mjs",
    "verify_encoder_path.mjs": "tools/verify_encoder_path.mjs",
    "preflight_p05.py": "tools/preflight_p05.py",
    "index_bin.py": "tools/index_bin.py",
    "baseline_report.py": "tools/baseline_report.py",
    "fetch_onnx_model.py": "tools/fetch_onnx_model.py",
    # 质量判定 → tools/quality/
    "quality_report.py": "tools/quality/quality_report.py",
    "quality_top10.py": "tools/quality/quality_top10.py",
    "quality_vector_equiv.py": "tools/quality/quality_vector_equiv.py",
    "quality_anchor.py": "tools/quality/quality_anchor.py",
    "quality_fixture_eval.py": "tools/quality/quality_fixture_eval.py",
    "quality_rank_margin.py": "tools/quality/quality_rank_margin.py",
    "quality_resize_variants.py": "tools/quality/quality_resize_variants.py",
    "quality_tail_attrib.py": "tools/quality/quality_tail_attrib.py",
    "make_quality_set.py": "tools/quality/make_quality_set.py",
    "sniff_extensions.py": "tools/quality/sniff_extensions.py",
    # 一次性调查 → spike/probes/（与已有 7 个探针同处）
    "probe_pixel_compare.py": "spike/probes/probe_pixel_compare.py",
    "probe_preproc_diff.py": "spike/probes/probe_preproc_diff.py",
    "probe_proc_shape.py": "spike/probes/probe_proc_shape.py",
    "smoke_encode.py": "spike/probes/smoke_encode.py",
    # 已被取代的一次性补丁脚本 → archive/
    "patch_prototype_pages.py": "archive/patch_prototype_pages.py",
    # 旧外壳 → archive/
    "app": "archive/app-shell-20261010",
}


def patch_py(text: str, name: str = "") -> tuple[str, dict]:
    if name in NO_PATCH:
        return text, {"（无需改写：纯模块，没有 HERE 假设）": 0}
    hits = {}
    # 1) HERE 定义 → 新头部
    n = text.count("HERE = os.path.dirname(os.path.abspath(__file__))")
    hits["HERE 定义"] = n
    if n != 1:
        raise SystemExit("HERE 定义命中 %d 次（期望 1）" % n)
    text = text.replace("HERE = os.path.dirname(os.path.abspath(__file__))", "@@HEADER@@")

    # 2) sys.path.insert(0, HERE)
    hits["sys.path"] = text.count(PY_SYSPATH_OLD)
    if hits["sys.path"] > 1:
        raise SystemExit("sys.path 命中 %d 次（期望 0 或 1）" % hits["sys.path"])
    text = text.replace(PY_SYSPATH_OLD, "@@SYSPATH@@")

    # 3) 其余 HERE → ROOT
    rest = len(re.findall(r"\bHERE\b", text))
    hits["HERE→ROOT"] = rest
    text = re.sub(r"\bHERE\b", "ROOT", text)

    text = text.replace("@@HEADER@@", PY_HEADER)
    if "@@SYSPATH@@" in text:
        text = text.replace("@@SYSPATH@@", PY_SYSPATH_NEW)
    return text, hits


def patch_mjs(text: str) -> tuple[str, dict]:
    hits = {}
    hits = {}
    old = "const HERE = path.dirname(fileURLToPath(import.meta.url));"
    n = text.count(old)
    hits["HERE 定义"] = n
    if n != 1:
        raise SystemExit("HERE 定义命中 %d 次（期望 1）" % n)
    text = text.replace(old, "@@HEADER@@")
    rest = len(re.findall(r"\bHERE\b", text))
    hits["HERE→ROOT"] = rest
    text = re.sub(r"\bHERE\b", "ROOT", text)
    text = text.replace("@@HEADER@@", JS_HEADER)
    return text, hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的移动与改写（默认 dry-run）")
    args = ap.parse_args()

    print("=== 归类计划（%d 项）===" % len(MOVES))
    problems = []
    for src, dst in MOVES.items():
        s = os.path.join(ROOT, src)
        if not os.path.exists(s):
            problems.append("源不存在：%s" % src)
            continue
        if os.path.exists(os.path.join(ROOT, dst)):
            problems.append("目标已存在：%s" % dst)
        if os.path.isdir(s):
            n = sum(len(f) for _, _, f in os.walk(s))
            print("  %-34s → %-38s [目录 %d 文件]" % (src, dst, n))
            continue
        text = open(s, encoding="utf-8").read()
        try:
            if src.endswith(".py"):
                _, hits = patch_py(text, src)
            elif src.endswith(".mjs"):
                _, hits = patch_mjs(text)
            else:
                hits = {"（无需改写）": 0}
        except SystemExit as e:
            problems.append("%s: %s" % (src, e))
            continue
        print("  %-34s → %-38s %s" % (src, dst, hits))

    if problems:
        print("\n!! 有 %d 项问题，未做任何改动：" % len(problems))
        for p in problems:
            print("   · " + p)
        return 1

    if not args.apply:
        print("\n（dry-run：未改动。加 --apply 执行）")
        return 0

    print("\n=== 执行 ===")
    for src, dst in MOVES.items():
        s = os.path.join(ROOT, src)
        d = os.path.join(ROOT, dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.move(s, d)
        print("  移动 %s → %s" % (src, dst))
        if os.path.isfile(d) and src.endswith((".py", ".mjs")):
            text = open(d, encoding="utf-8").read()
            text, _ = patch_py(text, src) if src.endswith(".py") else patch_mjs(text)
            open(d, "w", encoding="utf-8", newline="\n").write(text)
    print("\n改写完成。**接着必须**：跑 tools/verify_docs.py 等守卫，并同步文档里的命令路径。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

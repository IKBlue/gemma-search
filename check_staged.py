# -*- coding: utf-8 -*-
"""
check_staged.py —— 报告"这次提交到底包含什么"（避免 PowerShell 处理中文路径出错）。

用途：**提交前/推送前的守卫**。它读 git 的暂存区（不是文件系统），
所以看到的就是真正要提交的东西。
"""
from __future__ import annotations

import os
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))


def git(*args: str) -> str:
    r = subprocess.run(["git"] + list(args), cwd=HERE, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.stdout


def main() -> int:
    files = [f for f in git("ls-files").split("\n") if f]
    if not files:
        print("  暂存区为空 —— 先 git add")
        return 0

    total = 0
    by_ext: Counter = Counter()
    by_ext_bytes: Counter = Counter()
    rows = []
    for f in files:
        p = os.path.join(HERE, f)
        try:
            s = os.path.getsize(p)
        except OSError:
            s = 0
        ext = os.path.splitext(f)[1].lower() or "(无)"
        by_ext[ext] += 1
        by_ext_bytes[ext] += s
        total += s
        rows.append((f, s))

    print("=== 待提交概览 ===")
    print("  文件 %d 个 · 合计 %.2f MB" % (len(files), total / 1024 / 1024))
    print()
    print("=== 按类型 ===")
    for ext, s in by_ext_bytes.most_common(14):
        print("  %-12s %3d 个 %9.1f KB" % (ext, by_ext[ext], s / 1024))
    print()
    print("=== 最大的 12 个 ===")
    for f, s in sorted(rows, key=lambda x: -x[1])[:12]:
        print("  %9.1f KB  %s" % (s / 1024, f))

    # 目录分布
    print()
    print("=== 顶层目录分布 ===")
    top: Counter = Counter()
    topsz: Counter = Counter()
    for f, s in rows:
        t = f.split("/")[0] if "/" in f else "(根目录)"
        top[t] += 1
        topsz[t] += s
    for t, s in topsz.most_common():
        print("  %-22s %3d 个 %9.1f KB" % (t, top[t], s / 1024))

    # 违规检查
    print()
    print("=== 违规检查 ===")
    problems = []
    for f, s in rows:
        low = f.lower()
        if "node_modules" in low:
            problems.append(("node_modules 不该入库", f))
        if low.endswith((".npy", ".onnx", ".onnx_data", ".pyc")):
            problems.append(("派生/二进制不该入库", f))
        if low.endswith("config.json"):
            problems.append(("本机配置不该入库", f))
        if "/_backup-" in low or low.startswith("data/_backup"):
            problems.append(("索引备份不该入库", f))
        if s > 512 * 1024:
            problems.append(("单文件 >512 KB（确认是否有意）", "%s (%.0f KB)" % (f, s / 1024)))
    if problems:
        seen = set()
        for why, f in problems:
            if (why, f) in seen:
                continue
            seen.add((why, f))
            print("  ⚠ %-28s %s" % (why, f))
    else:
        print("  ✓ 没有明显不该入库的文件")

    return 0


if __name__ == "__main__":
    sys.exit(main())

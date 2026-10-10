# -*- coding: utf-8 -*-
"""
fix_stdio_encoding.py —— 让脚本在 GBK 控制台下也不崩

问题：中文 Windows 的 Python 默认用 GBK 编码 stdout，脚本里打印 ✓/✗/⚠/✅ 会抛
  UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'
这不是"我这边环境特殊"—— 用户在自己的 PowerShell 里直接跑同一个脚本也会崩。
（实测：check_staged.py 在未设 PYTHONIOENCODING=utf-8 时崩在这一行。）

修法：在每个脚本的 import 之后加一段强制 UTF-8 输出（失败也不致命）。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

TARGETS = [
    "check_staged.py", "scan_repo_pollution.py", "verify_docs.py", "verify_tokens.py",
    "preflight_p05.py", "make_quality_set.py", "quality_vector_equiv.py", "quality_top10.py",
    "smoke_encode.py", "index_bin.py",
]

SNIPPET = '''

# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass
'''

MARK = 'try:\n    sys.stdout.reconfigure(encoding="utf-8", errors="replace")'


def main() -> int:
    done = skipped = missing = 0
    for name in TARGETS:
        p = os.path.join(HERE, name)
        if not os.path.exists(p):
            print("  缺失: %s" % name)
            missing += 1
            continue
        with open(p, encoding="utf-8") as fh:
            src = fh.read()
        if MARK in src:
            print("  [已有] %s" % name)
            skipped += 1
            continue
        # 插到 `import sys` 那一行所属的 import 块之后；否则插到 from __future__ 之后
        lines = src.split("\n")
        idx = None
        for i, ln in enumerate(lines):
            if ln.startswith("import sys") or ln.startswith("import os, sys"):
                idx = i
                break
        if idx is None:
            for i, ln in enumerate(lines):
                if ln.startswith("from __future__"):
                    idx = i
                    break
        if idx is None:
            print("  [跳过] %s（找不到插入点）" % name)
            missing += 1
            continue
        lines.insert(idx + 1, SNIPPET)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        print("  [已改] %s（第 %d 行后）" % (name, idx + 1))
        done += 1
    print()
    print("  改 %d · 已有 %d · 未处理 %d" % (done, skipped, missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())

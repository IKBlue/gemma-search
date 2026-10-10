# -*- coding: utf-8 -*-
"""一次性：给缺 UTF-8 兜底的脚本补上 stdout/stderr reconfigure（带 dry-run）。

只处理**当前路径**下、且真的会往控制台打印 GBK 编不出的字符的脚本。
旧 Python 检索档（gemma_lib/server/verify_app/build_index）**不动** —— P7 之前"只调用、不改行为"。
"""
import argparse
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = [
    "tools/baseline_report.py",
    "spike/probes/inspect_20.py",
    "spike/probes/probe_encode.py",
    "spike/probes/verify_bmp_pil.py",
    "spike/spike_compare.py",
]

BLOCK = '''
# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError 中断脚本。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    for rel in TARGETS:
        p = os.path.join(ROOT, rel)
        src = open(p, encoding="utf-8").read()
        if "reconfigure" in src:
            print("  %-40s 已有兜底，跳过" % rel)
            continue
        anchor = None
        for cand in ("import sys\n", "import sys\r\n"):
            if cand in src:
                anchor = cand
                break
        if anchor is None:
            print("  %-40s ✗ 找不到 `import sys`，需手工处理" % rel)
            continue
        new = src.replace(anchor, anchor + BLOCK, 1)
        print("  %-40s 在 `import sys` 之后插入兜底（%d → %d 字节）" % (rel, len(src), len(new)))
        if args.apply:
            open(p, "w", encoding="utf-8", newline="\n").write(new)
    if not args.apply:
        print("（dry-run：未写入）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

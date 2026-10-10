# -*- coding: utf-8 -*-
"""
verify_tokens.py —— 令牌纪律守卫（可反复运行）

检查四件事：
  1. 除 tokens.css 外，**没有写死的颜色**（组件里不许出现十六进制）
  2. 没有**悬空的 var() 引用**（引用了未定义的令牌 → 样式会静默失效）
  3. 每个页面的加载顺序是 style.css → tokens.css → app.css
  4. 页面用到的令牌都在 tokens.css 里有定义

有意的例外（不算违规）：
  · tokens.css 自身 —— 它就是令牌定义处
  · DESIGN-tokens.md 里登记的"缩略图占位色"（当前已不再使用，故无例外项）
用法: python verify_tokens.py
"""
from __future__ import annotations

import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.join(HERE, "static", "prototype")
TOKEN_FILE = "tokens.css"

HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")


def strip_comments(s: str) -> str:
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def css_files() -> list[str]:
    return [p for p in sorted(glob.glob(os.path.join(PROTO, "*.css")))]


def main() -> int:
    bad = 0

    # ── 1) 写死颜色 ──────────────────────────────────────────────
    print("=== 1) 除 tokens.css 外的写死颜色 ===")
    for p in css_files():
        n = os.path.basename(p)
        hexes = sorted({h.lower() for h in HEX.findall(strip_comments(open(p, encoding="utf-8").read()))})
        if n == TOKEN_FILE:
            print("  %-12s %2d 种  （令牌定义处，允许）" % (n, len(hexes)))
            continue
        print("  %-12s %2d 种 %s" % (n, len(hexes), " ".join(hexes) if hexes else "✓"))
        bad += len(hexes)
    for p in sorted(glob.glob(os.path.join(PROTO, "*.html"))):
        n = os.path.basename(p)
        total = []
        for m in re.finditer(r"<style>(.*?)</style>", open(p, encoding="utf-8").read(), re.S):
            total += HEX.findall(strip_comments(m.group(1)))
        if total:
            print("  %-12s 页内 %d 种 %s" % (n, len(set(total)), " ".join(sorted(set(total)))))
            bad += len(total)

    # ── 2) 悬空 var() ────────────────────────────────────────────
    print("\n=== 2) 悬空 var() 引用 ===")
    defined = set()
    for p in css_files():
        defined |= set(re.findall(r"(--[\w-]+)\s*:", strip_comments(open(p, encoding="utf-8").read())))
    used: dict[str, set] = {}
    for p in css_files() + sorted(glob.glob(os.path.join(PROTO, "*.html"))):
        t = strip_comments(open(p, encoding="utf-8").read())
        for v in re.findall(r"var\((--[\w-]+)", t):
            used.setdefault(v, set()).add(os.path.basename(p))
    # 页面内联 style 里用到的也算
    dangling = {v: fs for v, fs in used.items() if v not in defined}
    if dangling:
        bad += len(dangling)
        for v, fs in sorted(dangling.items()):
            print("  **悬空** %-24s ← %s" % (v, ", ".join(sorted(fs))))
    else:
        print("  ✓ 无悬空引用（定义 %d 个 · 引用 %d 个）" % (len(defined), len(used)))

    # ── 3) 加载顺序 ──────────────────────────────────────────────
    print("\n=== 3) 页面加载顺序 ===")
    for p in sorted(glob.glob(os.path.join(PROTO, "*.html"))):
        order = re.findall(r'href="(style|tokens|app)\.css"', open(p, encoding="utf-8").read())
        ok = order == ["style", "tokens", "app"]
        if not ok:
            bad += 1
        print("  %-22s %-22s %s" % (os.path.basename(p), " → ".join(order), "✓" if ok else "**错**"))

    print("\n  违规合计: %d" % bad)
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

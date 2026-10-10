# -*- coding: utf-8 -*-
"""tools/verify_syntax.py —— 全仓语法体检（不需要跑任何真实负载）

为什么需要（这不是空想，是**已发生**的事）：
  2026-10-10 清理时发现 **3 个 Python 文件在提交里就是语法错误**：
  `baseline_report.py` / `preflight_p05.py` / `make_quality_set.py` ——
  同一行被某次编辑"吞掉"了换行，注释把后面的 `, ext))` 吃进去了，
  于是 `(` 永不闭合。三份都是**门禁/质量判定工具**，坏了没人知道：
  · 它们不参与任何自动测试（`npm test` 只跑 core/）
  · 只有"真要跑那一项检查"的时候才会炸 —— 而那时正是最需要它的时候
  这正是本项目反复强调的最危险失败模式：**静默**。

所以把"能不能解析"做成一条可执行的守卫：改完任何脚本都跑它（约 3 秒）。

用法：
    & .\\.venv\\Scripts\\python.exe tools\\verify_syntax.py
退出码 0 = 全部可解析；1 = 有文件解析失败（逐条列出文件与原因）。
"""
from __future__ import annotations

import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))


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

SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", "out", "dist", ".git", ".cache",
             ".uv-cache", ".npm-cache"}

# 当前路径：控制台编码问题在这里算**失败**；其它位置（旧档 / 一次性探针 / 归档）只提醒
STRICT_PREFIXES = ("tools", "tools/quality", "src", "scripts", "core", "tests", "spike/probes")


def walk(exts: tuple[str, ...]):
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            if fn.endswith(exts):
                yield os.path.join(dirpath, fn)


def main() -> int:
    print("=" * 96)
    print("全仓语法体检 · 根 = %s" % ROOT)
    fails: list[tuple[str, str]] = []

    py_files = list(walk((".py",)))
    print("\n--- Python（%d 个）---" % len(py_files))
    for p in py_files:
        try:
            with open(p, encoding="utf-8") as fh:
                src = fh.read()
            compile(src, p, "exec")
        except SyntaxError as e:
            fails.append((os.path.relpath(p, ROOT), "第 %s 行：%s" % (e.lineno, e.msg)))
            print("  [FAIL] %-52s 第 %s 行：%s" % (os.path.relpath(p, ROOT), e.lineno, e.msg))
        except UnicodeDecodeError as e:
            fails.append((os.path.relpath(p, ROOT), "不是 UTF-8：%s" % e))
            print("  [FAIL] %-52s 不是 UTF-8：%s" % (os.path.relpath(p, ROOT), e))

    js_files = list(walk((".mjs", ".cjs", ".js")))
    print("\n--- JS（node --check，%d 个）---" % len(js_files))
    for p in js_files:
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        if r.returncode != 0:
            tail = (r.stderr or "").strip().splitlines()
            msg = tail[0] if tail else "node --check 失败"
            for ln in tail:
                if "SyntaxError" in ln:
                    msg = ln.strip()
            fails.append((os.path.relpath(p, ROOT), msg))
            print("  [FAIL] %-52s %s" % (os.path.relpath(p, ROOT), msg))

    # ---------- 3) 控制台编码隐患 ----------
    # 中文 Windows 的控制台默认 GBK：`print("⚠ …")` 会抛 UnicodeEncodeError 直接中断脚本。
    # 本项目已踩过：`baseline_report.py` 因为一处语法错误一直没跑过，修好语法后**第一次跑就崩在打印 ⚠**。
    print("\n--- 控制台编码（GBK 下会崩的打印） ---")
    cenc_fail, cenc_warn = [], []
    for p in py_files:
        rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
        try:
            src = open(p, encoding="utf-8").read()
        except OSError:
            continue
        if "print(" not in src or "reconfigure" in src:
            continue
        bad = set()
        for ch in src:
            if ord(ch) < 128:
                continue
            try:
                ch.encode("gbk")
            except UnicodeEncodeError:
                bad.add(ch)
        if not bad:
            continue
        item = (rel, "".join(sorted(bad)))
        if rel.startswith(STRICT_PREFIXES):
            cenc_fail.append(item)
        else:
            cenc_warn.append(item)
    for rel, chars in cenc_fail:
        print("  [FAIL] %-52s 含 %s 且无 stdout reconfigure 兜底" % (rel, chars))
        fails.append((rel, "控制台编码：打印 GBK 编不出的字符 %s 且无兜底" % chars))
    for rel, chars in cenc_warn:
        print("  [warn] %-52s 含 %s（旧档/一次性脚本，暂不动）" % (rel, chars))
    if not cenc_fail and not cenc_warn:
        print("  全部有 UTF-8 兜底 ✓")

    print("\n" + "=" * 96)
    if fails:
        print("语法失败 %d 个（**这类损坏不会自己暴露** —— 只有真要跑那一项时才炸）：" % len(fails))
        for f, why in fails:
            print("  · %s —— %s" % (f, why))
        return 1
    print("全部可解析：Python %d 个 · JS %d 个。"
          "（这只证明**能解析**，不代表逻辑对；逻辑靠各自的测试与守卫）" % (len(py_files), len(js_files)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

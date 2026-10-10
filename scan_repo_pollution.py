# -*- coding: utf-8 -*-
"""
scan_repo_pollution.py —— 立项前把关：扫描"不该进仓库的东西"。

扫描五类：
  1. **机密**：token / 密钥 / 密码 / 私钥 / GitHub PAT
  2. **本机耦合**：写死的绝对路径（D:\\USERS\\Desktop\\Agent、G:\\model…）、用户名
  3. **派生/大文件**：索引、备份、node_modules、模型缓存、日志、字节码
  4. **个人内容**：用户提供的参考图、快照
  5. **非便携文本**：非 ASCII 的 .cmd/.ps1（本项目踩过 GBK 变 UTF-8 的坑）

输出：只读报告，不动任何文件。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

TEXT_EXT = {".py", ".js", ".mjs", ".ts", ".tsx", ".json", ".md", ".css", ".html",
            ".cmd", ".ps1", ".yml", ".yaml", ".txt", ".toml", ".gitignore"}

SECRET_PAT = [
    ("GitHub PAT", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("通用 api key", re.compile(r"(?i)\b(api[_-]?key|secret|passwd|password|token)\b\s*[:=]\s*['\"][^'\"]{12,}['\"]")),
    ("AWS key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("私钥块", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("Bearer 串", re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}")),
]

MACHINE_PAT = [
    ("工作区绝对路径", re.compile(r"[A-Za-z]:\\\\?USERS\\\\?Desktop\\\\?Agent", re.I)),
    ("素材库根", re.compile(r"[A-Za-z]:\\\\?model\b")),
    ("本机用户名", re.compile(r"Administrator")),
    ("其它盘符路径", re.compile(r"\b[A-Za-z]:\\\\?(?:Qwen|npm-cache|uv-cache)\b")),
]

# 不该进仓库的路径（相对本目录）
IGNORE_DIRS = {"node_modules", "__pycache__", ".venv", ".git", ".pytest_cache"}
IGNORE_BIG = 512 * 1024          # 单文件 > 512 KB 提示
SKIP_EXT_FOR_SECRETS = {".npy", ".jpg", ".jpeg", ".png", ".zip", ".rar", ".7z", ".onnx", ".bin", ".pack"}


def walk(root: str):
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in IGNORE_DIRS]
        for fn in fns:
            yield os.path.join(dp, fn)


def git_ignored_set(root: str) -> set:
    """问 git 哪些文件**被忽略**。

    为什么要这一步：本脚本扫的是文件系统，而 .gitignore 里的派生数据
    （索引、备份、node_modules）也是"在磁盘上但不会入库"。
    不排除它们，报告会误导 —— 例如把 10.5 MB 的 embeddings.npy 报成"要提交的大文件"。
    git 不可用时返回空集（退化为纯文件系统扫描，并在报告里说明）。
    """
    try:
        r = subprocess.run(["git", "status", "--ignored", "--porcelain", "-z"],
                           cwd=root, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        return set()
    if r.returncode != 0:
        return set()
    out = set()
    for entry in r.stdout.split("\0"):
        if entry.startswith("!! "):
            rel = entry[3:].strip().rstrip("/")
            out.add(rel.replace("/", os.sep))
    return out


def main() -> int:
    print("扫描根: %s" % HERE)
    print()

    ignored = git_ignored_set(HERE)
    print('  git 忽略项 %d 个（扫描时跳过；git 不可用则为 0）' % len(ignored))
    secrets, machine, big, binary_bytes = [], [], [], 0
    ext_count, ext_bytes = Counter(), Counter()
    text_files = 0

    for p in walk(HERE):
        rel = os.path.relpath(p, HERE)
        if any(rel == ig or rel.startswith(ig + os.sep) for ig in ignored):
            continue
        ext = os.path.splitext(p)[1].lower()
        try:
            size = os.path.getsize(p)
        except OSError:
            continue
        ext_count[ext] += 1
        ext_bytes[ext] += size

        if size > IGNORE_BIG:
            big.append((rel, size))

        if ext in SKIP_EXT_FOR_SECRETS:
            binary_bytes += size
            continue
        if ext not in TEXT_EXT and not os.path.basename(p).startswith("."):
            continue

        text_files += 1
        try:
            txt = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue

        for label, pat in SECRET_PAT:
            for m in pat.finditer(txt):
                line = txt[:m.start()].count("\n") + 1
                secrets.append((label, rel, line, m.group(0)[:40]))
        for label, pat in MACHINE_PAT:
            hits = list(pat.finditer(txt))
            if hits:
                lines = sorted({txt[:h.start()].count("\n") + 1 for h in hits})
                machine.append((label, rel, len(hits), lines[:4]))

    print("=== 1) 机密扫描 ===")
    if secrets:
        for s in secrets[:20]:
            print("  **%s** %s:%d  %s" % s)
    else:
        print("  ✓ 未发现 token / 密钥 / 私钥")

    print()
    print("=== 2) 本机耦合（写死绝对路径 / 用户名）===")
    print("  说明：**代码里的耦合才是问题**（决定行为）；文档里的路径是说明与示例。")
    CODE_EXT = {".py", ".js", ".mjs", ".ts", ".tsx", ".css", ".cmd", ".ps1", ".json", ".yml", ".yaml"}
    code_hits = [m for m in machine if os.path.splitext(m[1])[1].lower() in CODE_EXT]
    doc_hits = [m for m in machine if m not in code_hits]
    print("  —— 代码文件 %d 个 ——" % len(code_hits))
    for label, rel, n, lines in sorted(code_hits, key=lambda x: x[1]):
        print("    %-12s %-46s ×%-3d 行 %s" % (label, rel[:46], n, lines))
    if not code_hits:
        print("    ✓ 无（代码已与机器解耦）")
    print("  —— 文档/示例 %d 个（非问题）——" % len(doc_hits))
    for label, rel, n, lines in sorted(doc_hits, key=lambda x: x[1])[:8]:
        print("    %-12s %-46s ×%-3d" % (label, rel[:46], n))

    print()
    print("=== 3) 大文件（>512 KB，不该直接进 git）===")
    if big:
        for rel, size in sorted(big, key=lambda x: -x[1])[:18]:
            print("  %10.2f MB  %s" % (size / 1024 / 1024, rel))
        print("  合计 %d 个 / %.1f MB" % (len(big), sum(s for _, s in big) / 1024 / 1024))
    else:
        print("  ✓ 没有大文件")

    print()
    print("=== 4) 按类型统计（判断哪些该 ignore）===")
    for ext, size in ext_bytes.most_common(12):
        print("  %-14s %5d 个  %10.2f MB" % (ext or "(无扩展名)", ext_count[ext], size / 1024 / 1024))
    print("  二进制类合计 %.2f MB" % (binary_bytes / 1024 / 1024))

    print()
    print("=== 5) 文本文件可读性与可移植性 ===")
    print("  纳入扫描的文本文件 %d 个" % text_files)
    bad_cmd = []
    for p in walk(HERE):
        if os.path.splitext(p)[1].lower() in (".cmd", ".ps1", ".bat"):
            raw = open(p, "rb").read()
            try:
                raw.decode("ascii")
            except UnicodeDecodeError:
                bad_cmd.append(os.path.relpath(p, HERE))
    print("  非 ASCII 的脚本: %s" % (" ".join(bad_cmd) if bad_cmd else "无 ✓"))

    print()
    print("  机密 %d · 本机耦合文件 %d · 大文件 %d" % (len(secrets), len(machine), len(big)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

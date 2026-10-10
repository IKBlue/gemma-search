# -*- coding: utf-8 -*-
"""data/_fix_doc_paths.py —— 归类后同步文档里的命令/路径（一次性；带 dry-run）

只改**现行**文档（README / SPEC-* / TASK-PLAN / PRE-KICKOFF / UI-REVIEW / src/README）。
`reports/` 与 `archive/` **刻意不改** —— 它们记录的是当时的运行，改了就成篡改证据。
"""
from __future__ import annotations

import argparse
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DOCS = ["README.md", "TASK-PLAN.md", "PRE-KICKOFF-CHECK.md", "UI-REVIEW-and-migration.md",
        "SPEC-app.md", "SPEC-security.md", "SPEC-acceptance.md", "SPEC-identity.md",
        "DESIGN-app-details.md", "DEBT-CLEANUP.md", "src/README.md"]

TOOLS = ["check_staged.py", "scan_repo_pollution.py", "verify_docs.py", "verify_tokens.py",
         "verify_resize.py", "preflight_p05.py", "baseline_report.py", "fetch_onnx_model.py",
         "index_bin.py"]
TOOLS_MJS = ["verify_app_build.mjs", "verify_encoder_path.mjs"]
QUALITY = ["quality_report.py", "quality_top10.py", "quality_vector_equiv.py", "quality_anchor.py",
           "quality_fixture_eval.py", "quality_rank_margin.py", "quality_resize_variants.py",
           "quality_tail_attrib.py", "make_quality_set.py", "sniff_extensions.py"]
PROBES = ["probe_pixel_compare.py", "probe_preproc_diff.py", "probe_proc_shape.py", "smoke_encode.py"]

RULES = [(n, "tools/" + n) for n in TOOLS + TOOLS_MJS] \
    + [(n, "tools/quality/" + n) for n in QUALITY] \
    + [(n, "spike/probes/" + n) for n in PROBES] \
    + [("patch_prototype_pages.py", "archive/patch_prototype_pages.py")]

# 前缀已经在位就不要再加一层
PREFIXES = ["tools/quality/", "tools/", "spike/probes/", "archive/", "reports/", "data/"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    total = 0
    changed: list[tuple[str, str, list[str]]] = []
    for doc in DOCS:
        p = os.path.join(ROOT, doc)
        if not os.path.exists(p):
            continue
        text = open(p, encoding="utf-8").read()
        new = text
        notes = []
        for name, dst in RULES:
            pat = re.compile(r"(?<![\w/.\-])" + re.escape(name) + r"(?![\w])")
            hits = list(pat.finditer(new))
            keep = []
            for m in hits:
                before = new[:m.start()]
                if any(before.endswith(k) for k in PREFIXES):
                    continue           # 已有前缀（可能上一次已改过）
                keep.append(m)
            for m in reversed(keep):
                new = new[:m.start()] + dst + new[m.end():]
            if keep:
                notes.append("%s → %s ×%d" % (name, dst, len(keep)))
                total += len(keep)
        if new != text:
            changed.append((doc, new, notes))

    for doc, _, notes in changed:
        print("--- %s" % doc)
        for n in notes:
            print("     " + n)
    print("\n合计 %d 处；涉及 %d 个文件" % (total, len(changed)))

    if not args.apply:
        print("（dry-run：未写入）")
        return 0
    for doc, new, _ in changed:
        open(os.path.join(ROOT, doc), "w", encoding="utf-8", newline="\n").write(new)
        print("  写入 %s" % doc)
    return 0


if __name__ == "__main__":
    sys.exit(main())

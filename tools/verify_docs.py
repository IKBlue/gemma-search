# -*- coding: utf-8 -*-
"""verify_docs.py —— 文档清理后的最终核对：死引用、权威关系、清单完整性。"""
from __future__ import annotations

import sys

# 中文 Windows 的控制台默认是 GBK，直接打印 ✓/✗/⚠ 会抛 UnicodeEncodeError。
# 这里强制 UTF-8 输出（失败不致命：某些环境不支持 reconfigure）。
# ⚠️ 必须先 import sys —— 否则这个 try 会静默跳过，脚本照旧在 GBK 下崩。
#    （本文件真踩过：插入点落在 from __future__ 之后，而文件里没有 import sys。）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


import glob
import os
import re

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


DEAD = {
    "根 plan.md（已归档）": r"(?<!archive/)(?<!archive\\)plan\.md",
    "tasks/plan.md（已删）": r"tasks[/\\]plan\.md",
    "根 MODEL_CARD.md（已移动）": r"(?<!reference/)(?<!reference\\)MODEL_CARD\.md",
    "已归档原型": r"app-ui-mockup\.html|app-ui-v3-dark\.html",
    "已删索引试点": r"idx-(pilot|scan)",
}


def main() -> int:
    print("=== 1) 死引用扫描（DEBT/archive 里提旧名是**故意**的，已排除）===")
    allowed = {"DEBT-CLEANUP.md", "README.md"}   # README 里的旧名出现在 archive 说明段
    files = (glob.glob(os.path.join(ROOT, "*.md"))
             + glob.glob(os.path.join(ROOT, "archive", "*.md"))
             + glob.glob(os.path.join(ROOT, "reference", "*.md"))
             + glob.glob(os.path.join(ROOT, "static", "*.html")))
    total = 0
    for label, pat in DEAD.items():
        hits = []
        for p in files:
            n = os.path.relpath(p, ROOT)
            if n in ("DEBT-CLEANUP.md", "plan-agent-skill.md", "plan-electron-draft.md"):
                continue
            h = open(p, encoding="utf-8").read()
            for m in re.finditer(pat, h):
                ctx = h[max(0, m.start() - 40):m.end() + 20].replace("\n", " ")
                if "archive/" in ctx or "archive\\" in ctx or "reference/" in ctx or "reference\\" in ctx:
                    continue
                hits.append("%s:%d" % (n.replace(os.sep, "/"), h[:m.start()].count("\n") + 1))
        total += len(hits)
        print("  %-26s %s" % (label, "; ".join(hits[:6]) if hits else "无死引用 ✓"))

    print()
    print("=== 2) 文档清单 ===")
    for p in sorted(glob.glob(os.path.join(ROOT, "*.md"))):
        print("  %-34s %6d B" % (os.path.basename(p), os.path.getsize(p)))
    print("  --- 子目录 ---")
    for sub in ("archive", "reference"):
        for p in sorted(glob.glob(os.path.join(ROOT, sub, "*.md"))):
            print("  %-34s %6d B" % (sub + "/" + os.path.basename(p), os.path.getsize(p)))

    print()
    print("=== 3) README 的索引是否覆盖全部现行文档 ===")
    readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    for p in sorted(glob.glob(os.path.join(ROOT, "*.md"))):
        n = os.path.basename(p)
        if n == "README.md":
            continue
        print("  %-34s %s" % (n, "已索引 ✓" if n in readme else "**未索引**"))

    print()
    print("=== 4) 计划书与验收规范是否覆盖审查要求 ===")
    tp = open(os.path.join(ROOT, "TASK-PLAN.md"), encoding="utf-8").read()
    acc = open(os.path.join(ROOT, "SPEC-acceptance.md"), encoding="utf-8").read()
    checks = {
        "阶段 P0–P7 齐全":         all(("### P" + s) in tp for s in ("0 ", "0.5", "1 ", "2 ", "3 ", "4 ", "5 ", "6 ", "7 ")),
        "门禁 G-A..G-E2 齐全":      all(("**G-" + s + "**") in tp for s in ("A", "B", "C", "D", "E1", "E2")),
        "四个关键流程提到":         all(k in tp for k in ("流程 1", "流程 2", "流程 3", "流程 4")),
        "指向四份 SPEC":           all(("SPEC-" + s) in tp for s in ("app", "transactions", "identity", "acceptance")),
        "P0.5 运行前检查清单":      "运行前检查清单" in tp and "续跑真的可用" in tp,
        "生成/接受拆成两动作":       "P0.5-b" in tp and "P0.5-c" in tp,
        "UID 唯一性纳入校验":       "UID 唯一性" in tp,
        "安全规范定为前置交付物":     "前置交付物" in tp,
        "接口契约冻结":            "CONTRACT-engine-v1.md" in tp,
        "执行表（工期/依赖/证据）":   "执行表" in tp and "不是承诺工期" in tp and "完成定义" in tp,
        "证据归档位置":            "reports/" in tp,
        "G-E 拆分理由写明":         "不合并" in tp,
        "有变更控制节":            "变更控制" in tp,
        "G-B 三道判据":            "绝对下限" in acc and "相对不退化" in acc and "人工复核" in acc,
        "承认样本规模局限":         "候选规模" in acc and "充分统计样本" in acc,
        "豁免条件预先写清":         "豁免条件" in acc,
        "性能样本量与预热规定":      "30 次采样" in acc and "预热" in acc and "测试环境" in acc,
        "CPU 回退承诺边界":         "取消的性能承诺" in acc,
        "离线干净环境三条件":        "干净用户配置" in acc and "无模型缓存" in acc,
    }
    bad = 0
    for k, v in checks.items():
        print("  %-26s %s" % (k, "OK" if v else "**缺失**"))
        if not v:
            bad += 1

    print()
    print("  死引用 %d（archive 里的旧路径提及属正常）· 检查项未通过 %d" % (total, bad))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

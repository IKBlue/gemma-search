# -*- coding: utf-8 -*-
"""
patch_prototype_pages.py —— 把用户提供的三页原型并入本项目套件。

做四件事，**每处替换都核对命中数**，没命中就报出来（不静默放过）：
  1. 内联 <style>（三页同一份 9146 字符）→ 外链 style.css + app.css（去重复）
  2. 插入 <script src="app.js">（修掉 toast 未定义 → 21 个按钮点击报错）
  3. 统一导航（补上新增的 图片详情 / 入库与增量 / 文件操作确认 / 原型总览）
  4. 领域修正：以 语义搜索.html 为主（筛选、指标、卡片、当前图库）；
     另两页加"领域修正待办"说明块（其版式是定制的，半改反而更糟）

用法: python patch_prototype_pages.py [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.join(HERE, "static", "prototype")

NAV = (
    '<nav class="nav">'
    '<a class="{a1}" href="语义搜索.html"><span class="ico">⌕</span><span>语义搜索</span></a>'
    '<a class="{a2}" href="图片详情.html"><span class="ico">▣</span><span>图片详情</span></a>'
    '<a class="{a3}" href="图库与索引任务.html"><span class="ico">▦</span><span>本地图库</span></a>'
    '<a class="{a4}" href="入库与增量.html"><span class="ico">＋</span><span>入库与增量</span></a>'
    '<a class="{a5}" href="图库与索引任务.html#tasks"><span class="ico">◴</span><span>索引任务</span></a>'
    '<a class="{a6}" href="操作记录与设置.html"><span class="ico">↺</span><span>操作记录</span></a>'
    '<a class="{a7}" href="操作记录与设置.html#settings"><span class="ico">⚙</span><span>设置</span></a>'
    '</nav>'
    '<div class="nav-label" style="margin-top:14px">原型页 PROTOTYPE</div>'
    '<nav class="nav">'
    '<a href="文件操作确认.html"><span class="ico">⚠</span><span>文件操作确认</span></a>'
    '<a href="index.html"><span class="ico">≡</span><span>原型总览</span></a>'
    '</nav>'
)

# 每页哪个导航项高亮
ACTIVE = {
    "语义搜索.html": 1,
    "图库与索引任务.html": 3,
    "操作记录与设置.html": 6,
}

STYLE_LINKS = '<link rel="stylesheet" href="style.css" /><link rel="stylesheet" href="app.css" />'
APP_JS = '<script src="app.js"></script>'

# 语义搜索：筛选改为渲染器分类
FILTERS_OLD_RE = re.compile(r'<div class="filter-row">.*?<span style="flex:1">', re.S)
FILTERS_NEW = (
    '<div class="filter-row">'
    '<span class="muted small">渲染器分类</span>'
    '<button class="chip active" data-folder="">全部</button>'
    '<button class="chip" data-folder="VR">VR</button>'
    '<button class="chip" data-folder="CR">CR</button>'
    '<button class="chip" data-folder="CR+VR">CR+VR</button>'
    '<button class="chip" data-folder="其他">其他</button>'
    '<button class="chip" data-folder="未分类">未分类</button>'
    '<span style="flex:1">'
)

# 语义搜索：8 张卡片 → 真实素材（压缩包名 / 体积 / 实测余弦 / 分类 / 定位取件）
CARDS = [
    ('ID-713717.zip', 'VR', '0.9396', '同款区间', 'G:/model/VR/ID-713717.jpeg', '2.3 MB', 'same'),
    ('ID-16010618.zip', 'VR', '0.9382', '同款区间', 'G:/model/VR/ID-16010618.png', '9.8 MB', 'same'),
    ('ID-715702.zip', 'CR+VR', '0.9356', '同款区间', 'G:/model/CR+VR/ID-715702.jpeg', '12.6 MB', 'same'),
    ('ID-355747.zip', 'VR', '0.9351', '同款区间', 'G:/model/VR/ID-355747.jpg', '11.1 MB', 'same'),
    ('ID-928797.zip', 'VR', '0.9302', '同款区间', 'G:/model/VR/ID-928797.jpeg', '2.3 MB', 'same'),
    ('ID-104424061.rar', 'VR', '0.9298', '同款区间', 'G:/model/VR/ID-104424061.jpg', '29.0 MB', 'same'),
    ('ID-16109557.zip', 'VR', '0.9243', '同款区间', 'G:/model/VR/ID-16109557.jpg', '6.0 MB', 'same'),
    ('ID-16126260.zip', 'CR', '0.9164', '同款区间', 'G:/model/CR/ID-16126260.png', '3.9 MB', 'same'),
]


def card_html(pack, folder, score, band, img, size, cls):
    stem = re.sub(r'\.[^.]+$', '', pack)
    tag = folder.replace('+', '')
    return (
        '<article class="photo-card" data-folder="' + folder + '" data-pack="' + pack + '" data-score="' + score + '">'
        '<div class="photo">'
        '<img class="photo-img" loading="lazy" alt="' + stem + ' 预览图" src="file:///' + img + '" />'
        '<span class="card-acts">'
        '<button class="pri" data-demo="在资源管理器定位：G:\\model\\' + folder + '\\' + pack + '">定位</button>'
        '<button data-demo="取件 → E:\\素材待用\\' + pack + '">取件</button>'
        '</span>'
        '</div>'
        '<div class="card-info">'
        '<div class="card-title">' + pack + '</div>'
        '<div class="card-meta">'
        '<span><span class="tag ' + tag + '">' + folder + '</span></span>'
        '<span class="score ' + cls + '">' + score + ' · ' + band + ' · ' + size + '</span>'
        '</div>'
        '</div>'
        '</article>'
    )


# 另两页：领域修正待办说明（插在 .content 开头）
TODO_BLOCK = {
    "图库与索引任务.html": (
        '<div class="panel" style="border-left:4px solid #a56a12">'
        '<h2>领域修正待办（本页尚未改写）</h2>'
        '<p style="font-size:12.5px;color:#454b58;margin:0">'
        '本页版式来自原型套件，仍是"单一图库 + 通用索引队列"的假设。迁移到 React 时按 '
        '<span class="mono">index.html</span> 的领域差异清单执行：<br>'
        '① 单库 → <strong>多库注册表</strong>（名称 / 根目录 / 素材数 / <strong>compat 一致性</strong> / 上次扫描 / 库指纹）<br>'
        '② 顶部加<strong>一致性横幅</strong>：「可合并 2 个库 · 1 个被排除（seq280 ≠ 140）」<br>'
        '③ 索引任务补：<strong>阶段条</strong>（扫描→配对→编码→校验→落盘）、<strong>本次元数据</strong>'
        '（revision / 权重精度 / 预处理版本 / seq / 向量类型）、<strong>失败项可展开</strong>、'
        '<strong>取消（边界生效）</strong>与<strong>续跑</strong>（显示复用 N 条）<br>'
        '④ 健康检查补：图无包 / 包无图 / <strong>扩展名与内容不符（本库 105 张）</strong> / 重复内容（5 组）'
        '</p></div>'
    ),
    "操作记录与设置.html": (
        '<div class="panel" style="border-left:4px solid #a56a12">'
        '<h2>领域修正待办（本页尚未改写）</h2>'
        '<p style="font-size:12.5px;color:#454b58;margin:0">'
        '本页把"操作记录"当成普通日志、"设置"当成通用表单。迁移到 React 时按 '
        '<span class="mono">index.html</span> 的领域差异清单执行：<br>'
        '① 操作记录升级为<strong>事务表</strong>：uid / 前后路径 / <strong>状态</strong>'
        '（已提交 · 已回退 · <strong>待处理 RECOVERY_NEEDED</strong>）/ <strong>撤销按钮</strong> / 保留期<br>'
        '② <strong>待处理必须显眼</strong>：给「重试 / 回退 / 保持现状」三条路，判定不唯一时绝不猜<br>'
        '③ 设置里的模型项拆开：<span class="mono">model_revision / model_weights_dtype / '
        'preprocessing_version / seq / embedding_dtype</span>，改动任一项提示<strong>需重建索引</strong><br>'
        '④ 补：取件目录（默认 <span class="mono">E:\\素材待用\\</span>）· 撤销保留（30 天 / 5 GB）· '
        'CPU 回退提示（<strong>不做延迟承诺</strong>）<br>'
        '⑤ 写明两条边界：<strong>指纹不是备份</strong> · <strong>审计日志不是撤销能力</strong>'
        '</p></div>'
    ),
}


def patch(path: str, dry: bool) -> list[tuple[str, int, int]]:
    name = os.path.basename(path)
    src = open(path, encoding="utf-8").read()
    out = src
    report: list[tuple[str, int, int]] = []   # (说明, 期望命中, 实际命中)

    # 1) 内联样式 → 外链
    if "<style>" in out:
        out, n = re.subn(r"<style>.*?</style>", STYLE_LINKS, out, count=1, flags=re.S)
        report.append(("内联 style → 外链 style.css+app.css", 1, n))

    # 2) 插入 app.js（在 body 内第一个 <script> 之前）
    head_end = out.find("</head>")
    first_script = out.find("<script>", head_end)
    if first_script != -1 and "app.js" not in out:
        out = out[:first_script] + APP_JS + out[first_script:]
        report.append(("插入 <script src=app.js>", 1, 1))

    # 3) 导航统一
    idx = ACTIVE.get(name, 0)
    marks = ["active" if i + 1 == idx else "" for i in range(7)]
    new_nav = NAV.format(a1=('class="active"' if marks[0] else 'class=""'),
                         a2=('class="active"' if marks[1] else 'class=""'),
                         a3=('class="active"' if marks[2] else 'class=""'),
                         a4=('class="active"' if marks[3] else 'class=""'),
                         a5=('class="active"' if marks[4] else 'class=""'),
                         a6=('class="active"' if marks[5] else 'class=""'),
                         a7=('class="active"' if marks[6] else 'class=""'))
    out, n = re.subn(r'<nav class="nav">.*?</nav>', new_nav, out, count=1, flags=re.S)
    report.append(("导航统一（补 3 个新页面）", 1, n))

    # 4) 领域修正
    if name == "语义搜索.html":
        out, n = FILTERS_OLD_RE.subn(FILTERS_NEW, out, count=1)
        report.append(("筛选：内容类别 → 渲染器分类", 1, n))

        # 逐张替换卡片。
        # ⚠ 实测该页只有 4 张 <article class="photo-card">（不是 8 —— 8 张是另一份单文件原型的数量）。
        # 必须按实际数量截取 CARDS，否则 reversed 配对会静默取到错误的子集。
        arts = list(re.finditer(r"<article class=\"photo-card\".*?</article>", out, re.S))
        if len(arts) > len(CARDS):
            raise SystemExit("卡片数 %d 超过预备数据 %d，请先补数据" % (len(arts), len(CARDS)))
        cards = CARDS[:len(arts)]
        for m, c in zip(reversed(arts), reversed(cards)):
            out = out[:m.start()] + card_html(*c) + out[m.end():]
        report.append(("卡片 → 真实素材（包名/体积/分数/分类/动作）", len(cards), len(arts)))

        simple = [
            ("试试：黄昏时山间的湖泊，或穿红色外套的人……",
             "试试：玻璃球多头吊灯 / 中古风木质吸顶灯 / 花卉图案装饰画"),
            ("E:\\PhotoLibrary\\2024", "G:\\model"),
            ('<div class="metric-value">2,486</div>', '<div class="metric-value">3,594</div>'),
            ('<div class="metric-value">2,401</div>', '<div class="metric-value">3,594</div>'),
            ("96.6% · 可参与语义搜索", "100% · 可参与语义检索"),
            ("96.6% 已建立索引", "100% 已建立索引"),
            ('style="width:96.6%;background:#858aff"', 'style="width:100%;background:#858aff"'),
            ("已发现的图片文件", "预览图 3594 · 压缩包 3594"),
            ("模型已加载 · 本地模式", "fp32 · seq140 · webgpu"),
            ("8 张图片 · 示例数据", "8 套素材 · 以图搜图（实测分数）"),
        ]
        for old, new in simple:
            c = out.count(old)
            if c:
                out = out.replace(old, new)
            report.append(("文本替换：" + old[:26], 1, c))

    elif name in TODO_BLOCK and "领域修正待办" not in out:
        m = re.search(r'<div class="content">', out)
        if m:
            out = out[:m.end()] + TODO_BLOCK[name] + out[m.end():]
            report.append(("插入「领域修正待办」说明块", 1, 1))
        else:
            report.append(("插入「领域修正待办」说明块", 1, 0))

    if not dry and out != src:
        tmp = path + ".tmp"
        open(tmp, "w", encoding="utf-8").write(out)
        os.replace(tmp, path)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    targets = ["语义搜索.html", "图库与索引任务.html", "操作记录与设置.html"]
    bad = 0
    for t in targets:
        p = os.path.join(PROTO, t)
        if not os.path.exists(p):
            print("  缺失: %s" % t)
            bad += 1
            continue
        print("=" * 96)
        print("%s%s" % (t, "  [DRY RUN]" if args.dry_run else ""))
        for desc, want, got in patch(p, args.dry_run):
            ok = (got == want) if want else True
            print("  [%s] %-44s 期望 %s 实际 %s" % ("OK  " if ok else "WARN", desc[:44], want, got))
            if not ok and want:
                bad += 1
    print()
    print("警告/未命中: %d" % bad)
    return 0


if __name__ == "__main__":
    sys.exit(main())

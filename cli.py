# -*- coding: utf-8 -*-
"""
cli.py —— gemma-search 的命令行入口。

三重作用：
  1. 技能在 MCP 未注册时的**回退档**（SKILL.md 的第二档）
  2. 索引构建的唯一入口（刻意不做成 MCP 工具：一次约 1 小时，会阻塞协议调用）
  3. 打印可直接粘贴的 MCP 注册片段（`mcp-config`）

能力实现与错误信封都在 tools.py，与 MCP 入口共用同一份。

用法：
    python cli.py stats
    python cli.py search-text "现代简约布艺沙发" --top-k 5
    python cli.py search-image "G:\\model\\VR\\ID-xxx.jpg" --top-k 5
    python cli.py item --id 0
    python cli.py warmup
    python cli.py build --seq 140             # 续跑（默认）
    python cli.py build --seq 140 --rebuild   # 全量重算
    python cli.py build --prune               # 顺带清理失效条目
    python cli.py mcp-config                  # 打印 MCP 注册片段
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import gemma_lib as G                                    # noqa: E402
import tools                                             # noqa: E402


def emit(obj: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(obj, ensure_ascii=False, indent=2))
        return
    if not obj.get("ok"):
        print("失败 [{}]: {}".format(obj.get("kind"), obj.get("error")))
        if obj.get("hint"):
            print("提示: " + obj["hint"])
        return
    if "results" in obj:
        print("命中 {} 条（{} 查询，{} ms）".format(
            obj.get("count"), obj.get("mode"), obj.get("elapsed_ms")))
        for x in obj["results"]:
            print("  [{:>4}] {:<34} {:<7} {:.4f}".format(
                x["id"], x["name"][:34], x["folder"], x["score"]))
            print("         图: {}".format(x["image_path"]))
            if x.get("archive_path"):
                print("         包: {}{}  ({}, {:.2f} MB)".format(
                    x["archive_path"],
                    "" if x["archive_exists"] else "   <-- 不存在！",
                    (x.get("archive_ext") or "?").lstrip("."),
                    (x.get("archive_size") or 0) / 1024 / 1024))
            else:
                print("         包: （无同名压缩包）")
        return
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def mcp_config() -> str:
    """可直接粘贴进 DSH MCP 配置的片段（环境变量必须随注册项下发）。"""
    py = os.path.join(WORKSPACE, ".venv", "Scripts", "python.exe")
    hf = os.path.join(WORKSPACE, "model-cache", "hf")
    return json.dumps({
        "gemma-search": {
            "command": py,
            "args": [os.path.join(HERE, "mcp_server.py")],
            "env": {
                "HF_HOME": hf,
                "HF_HUB_CACHE": os.path.join(hf, "hub"),
                "HF_HUB_OFFLINE": "1",
                "PYTHONIOENCODING": "utf-8",
            },
        }
    }, ensure_ascii=False, indent=2)


def make_preview(item_id: int, out_dir: str | None = None) -> dict:
    """把某条结果的预览图转成**扩展名与内容一致**的副本。

    为什么需要：全库实测有 **105/3594** 张预览图的扩展名与真实格式不符
    （`.png` 实为 JPEG 68 张、`.jpg` 实为 BMP 20 张、`.jpg` 实为 PNG 17 张）。
    DSH 对话会拒收这类图，所以它们在结果里**无法直接显示**。
    本命令把内容重存为与真实格式相符的副本（BMP 等一律转 PNG），
    只写工作区、**不触碰素材库**。
    """
    from PIL import Image
    eng = tools.engine()
    it = eng.get_item(item_id)                 # 越界会抛 IndexError -> 结构化错误
    src = it["abs_path"]
    out_dir = out_dir or os.path.join(HERE, "data", "previews")
    os.makedirs(out_dir, exist_ok=True)
    with Image.open(src) as im:
        fmt = (im.format or "?").upper()
        ext = {"JPEG": ".jpg", "PNG": ".png"}.get(fmt, ".png")   # BMP/其他一律转 PNG
        base = os.path.splitext(it["name"])[0]
        dst = os.path.join(out_dir, base + ext)
        if ext == ".jpg":
            im.convert("RGB").save(dst, "JPEG", quality=95)
        else:
            im.save(dst, "PNG")
    declared = os.path.splitext(it["name"])[1].lower()
    return {
        "ok": True,
        "id": item_id,
        "source": src,
        "declared_ext": declared,
        "actual_format": fmt,
        "mismatched": ext != declared,
        "display_path": dst,
        "display_bytes": os.path.getsize(dst),
    }


def main() -> int:
    ap = argparse.ArgumentParser(prog="cli.py", description="gemma-search 命令行")
    ap.add_argument("--json", action="store_true", help="输出原始 JSON")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats", help="索引与运行环境状态")
    sub.add_parser("warmup", help="预载模型")
    sub.add_parser("mcp-config", help="打印 MCP 注册片段")

    p = sub.add_parser("search-text", help="文本 → 图像")
    p.add_argument("query")
    p.add_argument("--top-k", type=int, default=10)
    p.add_argument("--folder", default=None, choices=G.FOLDERS)

    p = sub.add_parser("search-image", help="图像 → 图像")
    p.add_argument("image_path")
    p.add_argument("--top-k", type=int, default=10)
    p.add_argument("--folder", default=None, choices=G.FOLDERS)

    p = sub.add_parser("item", help="按 id 取详情")
    p.add_argument("--id", type=int, required=True)

    p = sub.add_parser("preview",
                       help="把某条结果的预览图转成可显示副本（应对扩展名与内容不符）")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--out", default=None, help="输出目录，缺省 data\\previews")

    p = sub.add_parser("build", help="构建/续跑索引（唯一入口）")
    p.add_argument("--seq", type=int, default=140)
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--prune", action="store_true")
    p.add_argument("--limit", type=int, default=0)

    args = ap.parse_args()
    c = args.cmd

    if c == "build":
        cmd = [sys.executable, os.path.join(HERE, "build_index.py"), "--seq", str(args.seq)]
        if args.rebuild:
            cmd.append("--rebuild")
        if args.prune:
            cmd.append("--prune")
        if args.limit:
            cmd += ["--limit", str(args.limit)]
        return subprocess.call(cmd)
    if c == "mcp-config":
        print(mcp_config())
        return 0
    if c == "stats":
        emit(tools.tool_get_index_stats(), args.json)
    elif c == "warmup":
        emit(tools.tool_warmup(), args.json)
    elif c == "search-text":
        emit(tools.tool_search_by_text(args.query, args.top_k, args.folder), args.json)
    elif c == "search-image":
        emit(tools.tool_search_by_image(args.image_path, args.top_k, args.folder), args.json)
    elif c == "item":
        emit(tools.tool_get_item(args.id), args.json)
    elif c == "preview":
        try:
            emit(make_preview(args.id, args.out), args.json)
        except IndexError as e:
            print("失败 [id_out_of_range]: {}".format(e))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

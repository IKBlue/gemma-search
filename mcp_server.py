# -*- coding: utf-8 -*-
"""
mcp_server.py —— gemma-search 的 MCP Server（stdio）。

本文件只做两件事：把 tools.py 的 5 个能力包成 MCP 工具；自检。
能力实现、错误信封、日志规范都在 tools.py / search.py 里，CLI 共用同一份。

⚠️ **stdout 是协议通道**：本文件绝不向 stdout 打印任何东西，
   一切日志经 tools.log() 走 stderr。这是 stdio MCP 最常见的翻车点。

环境变量（注册项里下发，见 `cli.py mcp-config`）：
    HF_HOME / HF_HUB_CACHE / HF_HUB_OFFLINE=1 / PYTHONIOENCODING=utf-8

用法：
    python mcp_server.py              # stdio（供 MCP 客户端拉起）
    python mcp_server.py --selftest   # 逐个工具跑一遍（含错误路径）
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)

os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, "model-cache", "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(WORKSPACE, "model-cache", "hf", "hub"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import gemma_lib as G                                    # noqa: E402
import tools                                             # noqa: E402

log = tools.log
SERVER_NAME = "gemma-search"


def build_mcp():
    """构造 MCP 服务实例；SDK 缺失时给出明确指引而不是堆栈。

    兼容三种 SDK 形态（实测本机装的是 mcp 2.3.0）：
      · mcp ≥ 2.0 : `from mcp.server.mcpserver import MCPServer`（FastMCP 已改名）
      · mcp  1.x  : `from mcp.server.fastmcp import FastMCP`
      · 独立包    : `from fastmcp import FastMCP`
    三者的 `@server.tool(name=...)` 与 `server.run(transport="stdio")` 用法一致。
    """
    ServerCls = None
    for modpath, clsname in (("mcp.server.mcpserver", "MCPServer"),
                             ("mcp.server.fastmcp", "FastMCP"),
                             ("fastmcp", "FastMCP")):
        try:
            mod = __import__(modpath, fromlist=[clsname])
            ServerCls = getattr(mod, clsname)
            log("[gemma-search] MCP SDK: {} ({})".format(modpath, clsname))
            break
        except (ImportError, AttributeError):
            continue
    if ServerCls is None:
        log("[fatal] 未找到 MCP SDK。安装：")
        log('        uv pip install --python .venv\\Scripts\\python.exe mcp')
        return None

    mcp = ServerCls(SERVER_NAME)

    @mcp.tool(name="search_by_image")
    def search_by_image(image_path: str, top_k: int = 10,
                        folder: str | None = None) -> dict:
        """在素材库中查找与给定图片相似的素材。

        Args:
            image_path: 查询图片的绝对路径
            top_k: 返回条数，默认 10
            folder: 限定分类：VR / CR / CR+VR / 其他；留空为全部
        """
        return tools.tool_search_by_image(image_path, top_k, folder)

    @mcp.tool(name="search_by_text")
    def search_by_text(query: str, top_k: int = 10,
                       folder: str | None = None) -> dict:
        """用一句自然语言（支持中文）描述要找的素材。

        Args:
            query: 描述文本，例如「现代简约布艺沙发 客厅 茶几」
            top_k: 返回条数，默认 10
            folder: 限定分类：VR / CR / CR+VR / 其他；留空为全部
        """
        return tools.tool_search_by_text(query, top_k, folder)

    @mcp.tool(name="get_item")
    def get_item(item_id: int) -> dict:
        """按 id 取单条素材的完整信息（含同名模型包路径与是否存在）。

        Args:
            item_id: 检索结果里的 id
        """
        return tools.tool_get_item(item_id)

    @mcp.tool(name="get_index_stats")
    def get_index_stats() -> dict:
        """索引与运行环境状态（条数、已编码比例、维度、模型、设备、分类分布）。"""
        return tools.tool_get_index_stats()

    @mcp.tool(name="warmup")
    def warmup() -> dict:
        """预载模型，消除首次检索的额外延迟。"""
        return tools.tool_warmup()

    return mcp


def selftest() -> int:
    ok = bad = 0

    def show(label, r):
        nonlocal ok, bad
        good = isinstance(r, dict) and r.get("ok") is True
        ok, bad = (ok + 1, bad) if good else (ok, bad + 1)
        log("  [{}] {}".format("OK  " if good else "FAIL", label))
        if good and "results" in r:
            log("       命中 {} 条".format(r["count"]))
            for x in r["results"][:3]:
                log("         [{:>4}] {:<28} {:<7} {:.4f} {}".format(
                    x["id"], x["name"][:28], x["folder"], x["score"],
                    "有包" if x["archive_exists"] else "无包"))
        elif good and "stats" in r:
            log("       " + str({k: r["stats"].get(k) for k in
                                 ("indexed", "encoded", "partial", "progress_pct",
                                  "dim", "device", "dtype", "model_id")}))
        elif good:
            log("       " + str({k: v for k, v in r.items()
                                 if k in ("warmed_up", "seconds", "device", "dtype")}))
        else:
            log("       {} | {}".format(r.get("kind"), str(r.get("error"))[:140]))

    def show_err(label, r, expect_kind=None):
        """错误路径：**期望** ok=false 且带 kind 的结构化错误，且进程仍存活。"""
        nonlocal ok, bad
        good = (isinstance(r, dict) and r.get("ok") is False and bool(r.get("kind"))
                and (expect_kind is None or r.get("kind") == expect_kind))
        ok, bad = (ok + 1, bad) if good else (ok, bad + 1)
        log("  [{}] {} -> kind={}".format("OK  " if good else "FAIL", label, r.get("kind")))
        if not good:
            log("       " + str(r)[:180])

    log("== gemma-search 工具自检 ==")
    show("get_index_stats", tools.tool_get_index_stats())
    show("search_by_text", tools.tool_search_by_text("现代简约沙发", 3))
    eng = tools.engine()
    if eng.items:
        show("search_by_image", tools.tool_search_by_image(eng.items[0]["abs_path"], 3))
        show("get_item", tools.tool_get_item(0))
    show("warmup", tools.tool_warmup())
    log("-- 错误路径（应返回结构化错误、进程存活）--")
    show_err("不存在的图片", tools.tool_search_by_image(os.path.join(HERE, "no_such.jpg")),
             "file_not_found")
    show_err("越界 id", tools.tool_get_item(10 ** 9), "id_out_of_range")
    show_err("空文本", tools.tool_search_by_text("   "), "invalid_argument")
    show_err("非图片扩展名", tools.tool_search_by_image(os.path.join(HERE, "cli.py")),
             "invalid_argument")
    log("== 通过 {} / 失败 {} ==".format(ok, bad))
    return 0 if bad == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    mcp = build_mcp()
    if mcp is None:
        return 2
    log("[gemma-search] MCP stdio 启动（素材库 {}）".format(G.LIBRARY_ROOT))
    mcp.run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())

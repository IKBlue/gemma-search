# -*- coding: utf-8 -*-
"""
tools.py —— 工具层：5 个能力的**唯一实现**，MCP 与 CLI 共用。

刻意不依赖 MCP SDK：
  · mcp_server.py 只做一层薄薄的 MCP 包装
  · cli.py 直接调用（MCP 未注册时的回退档）
  · 两者返回**同一份信封结构**，因此验收可以逐字段比对（计划里的"三入口一致"）

信封结构：
    成功  {"ok": true, "elapsed_ms": N, ...业务字段}
    失败  {"ok": false, "error": "...", "kind": "index_missing|file_not_found|
           invalid_argument|id_out_of_range|internal", "hint": "..."}
异常永不外泄到协议层。
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)

os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, "model-cache", "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(WORKSPACE, "model-cache", "hf", "hub"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import search as search_mod                              # noqa: E402

# 输出编码：本 harness 通过管道捕获 stdout 并按 UTF-8 解码，而 Windows 上 Python
# 默认按控制台代码页（936）输出，中文会变乱码。显式改为 UTF-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:                                       # noqa: BLE001
    pass

ENGINE: search_mod.SearchEngine | None = None


def log(*a) -> None:
    """日志一律走 stderr —— stdout 可能属于 MCP 协议。"""
    print(*a, file=sys.stderr, flush=True)


def engine() -> search_mod.SearchEngine:
    global ENGINE
    if ENGINE is None:
        ENGINE = search_mod.SearchEngine()
    return ENGINE


def reset_engine() -> None:
    """测试用：丢弃已缓存的引擎（下次调用重新读盘）。"""
    global ENGINE
    ENGINE = None


def envelope(fn):
    def wrapper(*a, **kw):
        t0 = time.time()
        try:
            data = fn(*a, **kw)
            if isinstance(data, dict) and "ok" in data:
                data.setdefault("elapsed_ms", round((time.time() - t0) * 1000))
                return data
            return {"ok": True, "elapsed_ms": round((time.time() - t0) * 1000), "data": data}
        except search_mod.IndexMissing as e:
            return {"ok": False, "error": str(e), "kind": "index_missing",
                    "hint": "运行: .venv\\Scripts\\python.exe cli.py build --seq 140"}
        except FileNotFoundError as e:
            return {"ok": False, "error": str(e), "kind": "file_not_found"}
        except ValueError as e:
            return {"ok": False, "error": str(e), "kind": "invalid_argument"}
        except IndexError as e:
            return {"ok": False, "error": str(e), "kind": "id_out_of_range"}
        except Exception as e:                              # noqa: BLE001
            log("[error] {}: {}".format(type(e).__name__, e))
            return {"ok": False, "error": "{}: {}".format(type(e).__name__, e),
                    "kind": "internal"}
    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


@envelope
def tool_search_by_image(image_path: str, top_k: int = 10,
                         folder: str | None = None) -> dict:
    """在素材库中查找与给定图片相似的素材。"""
    res = engine().search_by_image(image_path, top_k=top_k, folder=folder)
    return {"ok": True, "mode": "image", "query": image_path,
            "count": len(res), "results": res}


@envelope
def tool_search_by_text(query: str, top_k: int = 10,
                        folder: str | None = None) -> dict:
    """用一句自然语言（支持中文）描述要找的素材。"""
    res = engine().search_by_text(query, top_k=top_k, folder=folder)
    return {"ok": True, "mode": "text", "query": query,
            "count": len(res), "results": res}


@envelope
def tool_get_item(item_id: int) -> dict:
    """按 id 取单条素材的完整信息。"""
    return {"ok": True, "item": engine().get_item(item_id)}


@envelope
def tool_get_index_stats() -> dict:
    """索引与运行环境状态。"""
    st = engine().stats()
    st["model_load_note"] = "模型惰性载入；首次检索会额外耗时，可先调用 warmup"
    st["search_modes"] = ["image", "text"]
    return {"ok": True, "stats": st}


@envelope
def tool_warmup() -> dict:
    """预载模型，消除首次检索的额外延迟。"""
    eng = engine()
    if not eng.available:
        raise search_mod.IndexMissing("索引不存在，无法预热")
    secs = eng.warmup()
    return {"ok": True, "warmed_up": True, "seconds": round(secs, 2),
            "device": eng.encoder._device, "dtype": eng.encoder._dtype}


# 名称 → (函数, 说明)。mcp_server.py 与文档都从这里取，避免两处漂移。
TOOLS = {
    "search_by_image": (tool_search_by_image,
                        "在素材库中查找与给定图片相似的素材；返回预览图与同名模型包路径"),
    "search_by_text": (tool_search_by_text,
                       "用一句自然语言（支持中文）描述要找的东西，在素材库中查找"),
    "get_item": (tool_get_item, "按 id 取单条素材详情（含模型包路径与是否存在）"),
    "get_index_stats": (tool_get_index_stats, "索引与运行环境状态"),
    "warmup": (tool_warmup, "预载模型，消除首次检索延迟"),
}

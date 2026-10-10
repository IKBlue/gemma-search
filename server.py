# -*- coding: utf-8 -*-
"""
server.py —— 人用的 HTTP 界面（可选；Agent 走 MCP/CLI）。

检索实现全部来自 search.py（与 MCP/CLI 同一份），本文件只管 HTTP。
接口与 static/index.html 的契约保持不变：

    GET  /                       前端页面
    GET  /api/stats              索引统计
    GET  /api/search?q=&k=&folder=      文本 → 图像
    POST /api/search_image?k=&folder=   图像 → 图像（请求体为图片原始字节）
    GET  /api/thumb?id=N         预览图
    GET  /api/item?id=N          单条详情
    POST /api/open?id=N          在资源管理器中定位模型包

启动顺序（修掉早期缺陷）：**先绑定端口，再在后台线程预热模型**。
早期版本先预热后绑定，导致启动后约 40 秒页面打不开（实测端口尚未监听）。

用法：
    python server.py [--port 8760] [--no-warmup]
"""
from __future__ import annotations

import argparse
import io
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)

os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, "model-cache", "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(WORKSPACE, "model-cache", "hf", "hub"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import search as search_mod                              # noqa: E402

STATIC_DIR = os.path.join(HERE, "static")
ENGINE: search_mod.SearchEngine | None = None
WARM: dict = {"state": "pending", "seconds": None, "error": None}


def engine() -> search_mod.SearchEngine:
    global ENGINE
    if ENGINE is None:
        ENGINE = search_mod.SearchEngine()
    return ENGINE


def to_ui(r: dict) -> dict:
    """把检索内核的结果映射成前端契约（前端还要 thumb 与 archive 名称）。"""
    items = engine().items
    it = items[r["id"]] if 0 <= r["id"] < len(items) else {}
    return {
        "id": r["id"],
        "name": r["name"],
        "folder": r["folder"],
        "rel_path": r["rel_path"],
        "archive": it.get("archive"),
        "score": r["score"],
        "thumb": "/api/thumb?id={}".format(r["id"]),
        "image_path": r["image_path"],
        "archive_path": r["archive_path"],
        "archive_exists": r["archive_exists"],
    }


def warmup_bg() -> None:
    """后台预热：不阻塞端口绑定。"""
    WARM["state"] = "running"
    try:
        t0 = time.time()
        engine().warmup()
        WARM.update(state="done", seconds=round(time.time() - t0, 2))
        print("[server] 预热完成，用时 {}s".format(WARM["seconds"]), flush=True)
    except Exception as e:                                # noqa: BLE001
        WARM.update(state="failed", error="{}: {}".format(type(e).__name__, e))
        print("[server] 预热失败:", WARM["error"], flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "GemmaSearch/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("GEMMA_VERBOSE"):
            sys.stderr.write("  %s\n" % (fmt % args))

    # ---------- 工具 ----------
    def _cors(self):
        """允许 DSH 客户端（GUI 在 :19387）跨源调用本服务（:8760）。

        桌面右栏面板与网页界面都要从这里取检索结果，两者与本站点不同源。
        """
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, obj, code: int = 200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, data: bytes, ctype: str, code: int = 200, cache: bool = True):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        """CORS 预检。"""
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _err(self, msg: str, code: int = 400, kind: str = "invalid_argument"):
        self._json({"ok": False, "error": msg, "kind": kind}, code)

    def _file(self, p: str, cache: bool = False):
        if not os.path.isfile(p):
            return self._err("文件不存在: " + p, 404, "file_not_found")
        ctype = mimetypes.guess_type(p)[0] or "application/octet-stream"
        if p.endswith(".html"):
            ctype = "text/html; charset=utf-8"
        with open(p, "rb") as fh:
            return self._bytes(fh.read(), ctype, cache=cache)

    def _int(self, qs, key, default):
        try:
            return int((qs.get(key) or [str(default)])[0])
        except ValueError:
            return default

    # ---------- GET ----------
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        path = u.path

        if path in ("/", "/index.html"):
            return self._file(os.path.join(STATIC_DIR, "index.html"))

        if path.startswith("/static/"):
            rel = os.path.normpath(path[len("/static/"):]).replace("\\", "/")
            if rel.startswith("..") or os.path.isabs(rel):
                return self._err("非法路径", 403)
            return self._file(os.path.join(STATIC_DIR, rel))

        if path == "/api/stats":
            eng = engine()
            if not eng.available:
                # 索引缺失时也要能回答，前端才能给出可执行的提示
                return self._json({
                    "available": False, "indexed": 0, "encoded": 0, "partial": True,
                    "progress_pct": 0.0, "dim": None, "model_id": None,
                    "built_at": None, "image_mode": None, "library_root": None,
                    "folders": {}, "paired": 0, "warmup": WARM,
                    "load_error": "索引不存在：{}。请先运行 build_index.py --seq 140".format(
                        getattr(eng.store, "emb_path", "")),
                })
            st = eng.stats()
            st["paired"] = sum(1 for it in eng.items if it.get("archive"))
            st["image_mode"] = eng.meta.get("image_mode")
            st["warmup"] = WARM
            st["load_error"] = None
            return self._json(st)

        if path == "/api/search":
            q = (qs.get("q") or [""])[0].strip()
            if not q:
                return self._err("缺少 q 参数")
            k = self._int(qs, "k", 24)
            folder = (qs.get("folder") or [""])[0] or None
            t0 = time.time()
            try:
                res = engine().search_by_text(q, top_k=k, folder=folder)
            except Exception as e:                        # noqa: BLE001
                return self._err("{}: {}".format(type(e).__name__, e), 503, "internal")
            return self._json({"query": q, "mode": "text", "count": len(res),
                               "elapsed_ms": round((time.time() - t0) * 1000),
                               "results": [to_ui(x) for x in res]})

        if path == "/api/thumb":
            i = self._int(qs, "id", -1)
            items = engine().items
            if not (0 <= i < len(items)):
                return self._err("id 越界", 404, "id_out_of_range")
            p = items[i]["abs_path"]
            if not os.path.isfile(p):
                return self._err("文件不存在（可能已移动）", 404, "file_not_found")
            return self._file(p, cache=True)

        if path == "/api/item":
            i = self._int(qs, "id", -1)
            try:
                it = engine().get_item(i)
            except IndexError as e:
                return self._err(str(e), 404, "id_out_of_range")
            it["id"] = i
            return self._json(it)

        return self._err("未知路径 " + path, 404, "not_found")

    # ---------- POST ----------
    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        qs = urllib.parse.parse_qs(u.query)

        if u.path == "/api/search_image":
            if n <= 0:
                return self._err("请求体为空")
            raw = self.rfile.read(n)
            k = self._int(qs, "k", 24)
            folder = (qs.get("folder") or [""])[0] or None
            import tempfile
            from PIL import Image
            t0 = time.time()
            try:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
            except Exception as e:                        # noqa: BLE001
                return self._err("无法解析为图片: {}".format(e))
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False,
                                              dir=os.path.join(HERE, "data"))
            try:
                img.save(tmp.name)
                tmp.close()
                res = engine().search_by_image(tmp.name, top_k=k, folder=folder)
            except Exception as e:                        # noqa: BLE001
                return self._err("{}: {}".format(type(e).__name__, e), 503, "internal")
            finally:
                try:
                    os.remove(tmp.name)
                except OSError:
                    pass
            return self._json({"mode": "image", "count": len(res),
                               "elapsed_ms": round((time.time() - t0) * 1000),
                               "results": [to_ui(x) for x in res]})

        if u.path == "/api/open":
            i = self._int(qs, "id", -1)
            items = engine().items
            if not (0 <= i < len(items)):
                return self._err("id 越界", 404, "id_out_of_range")
            it = items[i]
            ap = it.get("archive_abs_path") or it["abs_path"]
            if not os.path.isfile(ap):
                return self._err("目标不存在: " + ap, 404, "file_not_found")
            try:
                subprocess.Popen(["explorer", "/select,", os.path.normpath(ap)])
            except Exception as e:                        # noqa: BLE001
                return self._err("打开失败: {}".format(e), 500, "internal")
            return self._json({"ok": True, "opened": ap})

        return self._err("未知路径 " + u.path, 404, "not_found")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8760)
    ap.add_argument("--no-warmup", action="store_true", help="不预热")
    args = ap.parse_args()

    eng = engine()
    if eng.available:
        print("[server] 索引已载入: {} 条 / 已编码 {} / {} 维 / 模型 {} / 设备 {}".format(
            len(eng.items), eng.encoded, eng.embs.shape[1],
            eng.meta.get("model_id"), eng.meta.get("device")))
    else:
        print("[server] ⚠ 索引不存在，页面能打开但检索会报错")

    # 先绑定端口：早期版本先预热后绑定，启动后约 40 秒页面打不开
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("\n" + "=" * 72)
    print("  EmbeddingGemma 2 素材库检索")
    print("  打开: http://{}:{}/".format(args.host, args.port))
    print("  素材库: {}".format(eng.meta.get("library_root") or "(未载入)"))
    print("  预热: {}".format("跳过" if args.no_warmup else "后台进行（页面立即可用）"))
    print("=" * 72, flush=True)

    if not args.no_warmup:
        threading.Thread(target=warmup_bg, daemon=True).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

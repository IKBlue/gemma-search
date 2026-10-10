# -*- coding: utf-8 -*-
"""
verify_mcp.py —— gemma-search 的协议级与一致性验收。

四项（对应计划的验收标准）：
  A. **stdout 纯净**：以真实 MCP 握手驱动子进程，断言 stdout 每一行都是合法 JSON-RPC，
     且不含任何杂散文本（stdio MCP 最常见的翻车方式）。
  B. **MCP/CLI 一致**：固定查询下，进程内工具结果与 CLI 子进程结果逐字段相同。
  C. **确定性**：同一查询连跑两次，结果完全一致。
  D. **无 NaN**：索引与查询向量都不得含 NaN（float16 会静默产生）。

用法：python verify_mcp.py
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)

os.environ.setdefault("HF_HOME", os.path.join(WORKSPACE, "model-cache", "hf"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

PY = os.path.join(WORKSPACE, ".venv", "Scripts", "python.exe")
OK = FAIL = 0


def check(cond, label, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  [OK  ] {}".format(label))
    else:
        FAIL += 1
        print("  [FAIL] {}  {}".format(label, detail))


def mcp_payload(resp):
    """从 tools/call 响应里取出并解析内层 JSON。

    MCP 把工具返回值放在 `result.content[].text` 里，是个**被转义的字符串**，
    所以不能直接在外层 JSON 文本里搜字段名（引号已转义，必然搜不到）。
    """
    try:
        content = (resp.get("result") or {}).get("content") or []
        for c in content:
            if c.get("type") == "text":
                return json.loads(c["text"])
            if "text" in c:
                return json.loads(c["text"])
    except (ValueError, TypeError, KeyError):
        return None
    return None


# ---------------------------------------------------------------- A
def test_stdout_purity(timeout=180):
    print("\nA) stdout 纯净性 + 真实 MCP 握手")
    proc = subprocess.Popen(
        [PY, os.path.join(HERE, "mcp_server.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1)

    lines: queue.Queue = queue.Queue()

    def reader():
        for ln in proc.stdout:
            lines.put(ln)

    th = threading.Thread(target=reader, daemon=True)
    th.start()

    def send(obj):
        proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    def wait_id(want, deadline):
        """读 stdout 直到出现 id==want 的响应；顺带校验每一行都是 JSON。"""
        while time.time() < deadline:
            try:
                ln = lines.get(timeout=1.0)
            except queue.Empty:
                continue
            s = ln.strip()
            if not s:
                continue
            try:
                obj = json.loads(s)
            except ValueError:
                check(False, "stdout 出现非 JSON 内容", repr(s[:120]))
                return None
            if not (isinstance(obj, dict) and obj.get("jsonrpc") == "2.0"):
                check(False, "stdout 出现非 JSON-RPC 消息", repr(s[:120]))
                return None
            if obj.get("id") == want:
                return obj
        return None

    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
              "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                         "clientInfo": {"name": "verify_mcp", "version": "1.0"}}})
        r = wait_id(1, time.time() + timeout)
        check(r is not None, "initialize 有响应",
              "(超时；stderr 末尾: {})".format(
                  (proc.stderr.read() or "")[-200:] if proc.poll() is not None else ""))
        if r:
            si = (r.get("result") or {}).get("serverInfo") or {}
            print("       serverInfo: {}".format(json.dumps(si, ensure_ascii=False)[:120]))

        send({"jsonrpc": "2.0", "method": "notifications/initialized"})

        send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        r = wait_id(2, time.time() + 60)
        names = []
        if r:
            names = [t.get("name") for t in (r.get("result") or {}).get("tools", [])]
        check(set(names) >= {"search_by_image", "search_by_text", "get_item",
                             "get_index_stats", "warmup"},
              "tools/list 暴露全部 5 个工具", "得到 {}".format(names))

        send({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
              "params": {"name": "get_index_stats", "arguments": {}}})
        r = wait_id(3, time.time() + timeout)
        pay = mcp_payload(r) if r else None
        check(isinstance(pay, dict) and pay.get("ok") and
              (pay.get("stats") or {}).get("encoded", 0) > 0,
              "tools/call get_index_stats 返回可解析结果",
              "payload={}".format(str(pay)[:120]))

        send({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
              "params": {"name": "search_by_text",
                         "arguments": {"query": "现代简约沙发", "top_k": 3}}})
        r = wait_id(4, time.time() + timeout)
        pay = mcp_payload(r) if r else None
        check(isinstance(pay, dict) and pay.get("ok") and len(pay.get("results", [])) == 3,
              "tools/call search_by_text 返回 3 条结果",
              "payload={}".format(str(pay)[:160]))

        # 经由协议拿到的结果，必须与进程内直接调用**逐字段一致**
        import tools
        tools.reset_engine()
        direct = tools.tool_search_by_text("现代简约沙发", 3)
        a = [(x["id"], round(x["score"], 6)) for x in direct["results"]]
        b = [(x["id"], round(x["score"], 6)) for x in (pay or {}).get("results", [])]
        check(a == b, "MCP 协议结果与进程内直调一致", "MCP={} direct={}".format(b, a))
        if pay:
            print("       协议返回: " + json.dumps(
                [{k: x[k] for k in ("id", "name", "folder", "score", "archive_exists")}
                 for x in pay.get("results", [])], ensure_ascii=False))
    finally:
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


# ---------------------------------------------------------------- B
def test_cli_parity():
    print("\nB) MCP 工具 vs CLI 一致性（逐字段）")
    import tools
    tools.reset_engine()
    queries = [("text", "现代简约布艺沙发"), ("text", "北欧吊灯"), ("text", "地毯")]
    for kind, q in queries:
        direct = tools.tool_search_by_text(q, 5)
        cp = subprocess.run(
            [PY, os.path.join(HERE, "cli.py"), "--json", "search-text", q, "--top-k", "5"],
            capture_output=True, text=True, encoding="utf-8")
        if cp.returncode != 0:
            check(False, "CLI 文本检索「{}」".format(q), cp.stderr[-160:])
            continue
        try:
            cli = json.loads(cp.stdout)
        except ValueError:
            check(False, "CLI 输出非 JSON「{}」".format(q), cp.stdout[:160])
            continue
        a = [(x["id"], round(x["score"], 6)) for x in direct["results"]]
        b = [(x["id"], round(x["score"], 6)) for x in cli["results"]]
        check(a == b, "文本「{}」MCP 与 CLI 结果一致".format(q),
              "MCP={} CLI={}".format(a[:3], b[:3]))

    # 图像查询一致性（用库里第一张图）
    import gemma_lib as G
    items = G.find_items()
    if items:
        p = items[0].abs_path
        direct = tools.tool_search_by_image(p, 5)
        cp = subprocess.run(
            [PY, os.path.join(HERE, "cli.py"), "--json", "search-image", p, "--top-k", "5"],
            capture_output=True, text=True, encoding="utf-8")
        try:
            cli = json.loads(cp.stdout)
            a = [(x["id"], round(x["score"], 6)) for x in direct["results"]]
            b = [(x["id"], round(x["score"], 6)) for x in cli["results"]]
            check(a == b, "图像查询 MCP 与 CLI 结果一致")
            check(a and a[0][0] == 0, "以图搜图 top-1 为该图自身（id=0）", str(a[:1]))
        except ValueError:
            check(False, "CLI 图像检索输出非 JSON", cp.stdout[:160])


# ---------------------------------------------------------------- C / D
def test_determinism_and_nan():
    print("\nC) 确定性（同查询两次结果一致）")
    import tools
    tools.reset_engine()
    r1 = tools.tool_search_by_text("现代简约沙发", 10)
    r2 = tools.tool_search_by_text("现代简约沙发", 10)
    a = [(x["id"], x["score"]) for x in r1["results"]]
    b = [(x["id"], x["score"]) for x in r2["results"]]
    check(a == b, "两次查询完全一致")

    print("\nD) 无 NaN（索引 + 查询向量）")
    import numpy as np
    import gemma_lib as G
    import store as store_mod
    st = store_mod.get_store("numpy")
    embs, items, meta = st.load()
    check(not bool(np.isnan(embs).any()), "索引矩阵无 NaN")
    check(bool(np.allclose(np.linalg.norm(embs, axis=1), 1.0, atol=1e-3)),
          "索引向量均为单位长度")
    check(meta.get("dtype") == "float32", "meta 记录 dtype=float32（未用 fp16）",
          str(meta.get("dtype")))
    check(meta.get("image_seq_length") == 140, "meta 记录 seq=140",
          str(meta.get("image_seq_length")))
    eng = tools.engine()
    qv = eng.encode_text("测试")
    check(not bool(np.isnan(qv).any()), "文本查询向量无 NaN")
    qv2 = eng.encode_image(items[0]["abs_path"])
    check(not bool(np.isnan(qv2).any()), "图像查询向量无 NaN")


def main() -> int:
    print("=" * 88)
    print("gemma-search 验收")
    print("=" * 88)
    test_stdout_purity()
    test_cli_parity()
    test_determinism_and_nan()
    print("\n" + "=" * 88)
    print("结果：通过 {} / 失败 {}".format(OK, FAIL))
    print("=" * 88)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""
register_mcp.py —— 把 gemma-search 注册进 DSH 桌面 profile。

目标文件：`~/.dsh/profiles/desktop/cordis.patch.yml`
（不写死用户名 —— 用 `os.path.expanduser("~")` 或环境变量 `DSH_PROFILE_CONFIG`）
该文件是 DSH 的「用户补丁层」，被 Electron 桌面端与 `dsh --profile desktop` 读取。
结构是**一个顶层 YAML 序列**，元素形如 `{insert: [...]}` 或 `{id, name, config}`。

遵守该文件里既有的两条约定：
  1. **改动前先备份**（同目录已有多个 .bak-*，沿用同一命名）
  2. **每个 MCP 服务独占自己的 `- id:` 行** —— 文件头部注释记录了踩过的坑：
     曾经只注释掉某条目的 `- id:` 行，YAML 把 name/config 折进上一条，
     结果 mcp-illustrator 实际启动了 autocad-mcp.exe，真正的 illustrator 从未注册。

幂等：已注册则跳过。写回后立即用 PyYAML 解析校验，不合法就自动回滚。

用法：
    python register_mcp.py            # 注册（幂等）
    python register_mcp.py --check     # 只检查当前状态，不改动
    python register_mcp.py --uninstall # 移除本脚本添加的块
"""
from __future__ import annotations

import argparse
import datetime
import os

HERE = os.path.dirname(os.path.abspath(__file__))
import shutil
import sys

# 不写死用户名：用 ~ 展开；可用环境变量覆盖
CONFIG = os.environ.get("DSH_PROFILE_CONFIG") or os.path.join(
    os.path.expanduser("~"), ".dsh", "profiles", "desktop", "cordis.patch.yml")
SERVER_ID = "mcp-gemma-search"
SERVER_NAME = "gemma-search"
# 工作区默认取项目根的上一级；可用环境变量覆盖
WORKSPACE = os.environ.get("GEMMA_WORKSPACE") or os.path.dirname(HERE)

# 输出编码：本 harness 通过管道捕获 stdout 并按 UTF-8 解码，而 Windows 上 Python
# 默认按控制台代码页（936）输出，中文会变乱码。显式改为 UTF-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:                                       # noqa: BLE001
    pass

MARKER = "# gemma-search — 素材库语义检索"

BLOCK = r"""
# gemma-search — 素材库语义检索（EmbeddingGemma 2，MCP Server + SKILL.md）
# 项目根见 GEMMA_WORKSPACE（或本脚本所在目录的上一级）；技能 .dsh\skills\gemma-search\SKILL.md
# 环境变量必须随注册项下发：HF_HOME 指向工作区内（工作区外会被沙箱拒绝写），
# HF_HUB_OFFLINE=1 避免每次启动做符号链接探测（本机不支持符号链接）。
# 首次工具调用约 11 秒（载模型 + CUDA 初始化），之后每次约 37 毫秒，故超时给 180 秒。
- insert:
    - id: {sid}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: {sname}
        transport: stdio
        command: '{py}'
        args:
          - '{server}'
        cwd: '{cwd}'
        toolCallTimeoutMs: 180000
        failOnStartupError: false
        env:
          HF_HOME: '{hf}'
          HF_HUB_CACHE: '{hfhub}'
          HF_HUB_OFFLINE: '1'
          PYTHONIOENCODING: 'utf-8'
          NO_COLOR: '1'
""".format(
    sid=SERVER_ID, sname=SERVER_NAME,
    py=os.path.join(WORKSPACE, ".venv", "Scripts", "python.exe"),
    server=os.path.join(WORKSPACE, "gemma-search", "mcp_server.py"),
    cwd=os.path.join(WORKSPACE, "gemma-search"),
    hf=os.path.join(WORKSPACE, "model-cache", "hf"),
    hfhub=os.path.join(WORKSPACE, "model-cache", "hf", "hub"),
)


def load_yaml(path):
    import yaml
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def find_entry(doc):
    """在顶层序列里找出本服务的 insert 条目。"""
    for i, item in enumerate(doc or []):
        if not isinstance(item, dict):
            continue
        for ins in (item.get("insert") or []):
            if isinstance(ins, dict) and ins.get("id") == SERVER_ID:
                return i, ins
    return None, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--uninstall", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(CONFIG):
        print("找不到配置文件:", CONFIG)
        return 2

    print("配置:", CONFIG)
    try:
        doc = load_yaml(CONFIG)
    except Exception as e:                                  # noqa: BLE001
        print("现有文件 YAML 解析失败（先解决它再改）:", type(e).__name__, e)
        return 2
    print("顶层序列元素数:", len(doc or []))

    idx, entry = find_entry(doc)
    if args.check:
        if entry:
            print("已注册 [OK]")
            print("  serverName:", entry.get("config", {}).get("serverName"))
            print("  command   :", entry.get("config", {}).get("command"))
        else:
            print("未注册")
        return 0

    if args.uninstall:
        if not entry:
            print("未注册，无需移除")
            return 0
        bak = CONFIG + ".bak-gemma-search-uninstall-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(CONFIG, bak)
        # 刻意**按标记文本切除**而不是 yaml.safe_dump 重写整份文件：
        # 重写会丢掉文件里所有注释，包括头部那段记录 YAML 折叠坑的教训。
        src = open(CONFIG, encoding="utf-8").read()
        marker = MARKER
        pos = src.find(marker)
        if pos < 0:
            print("[FAIL] 找不到本块的起始标记，为安全起见不自动删除。")
            print("  请手动删除备份与当前文件之间的 gemma-search 块。")
            return 1
        new = src[:pos].rstrip("\n") + "\n"
        with open(CONFIG, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new)
        try:
            doc2 = load_yaml(CONFIG)
            assert find_entry(doc2)[1] is None, "移除后仍能找到条目"
            print("已移除并校验通过 [OK]  顶层元素数 {} -> {}".format(
                len(doc or []), len(doc2 or [])))
        except Exception as e:                              # noqa: BLE001
            shutil.copy2(bak, CONFIG)
            print("[FAIL] 校验失败，已回滚:", type(e).__name__, e)
            return 1
        print("备份:", bak)
        return 0

    if entry:
        print("已注册，跳过（幂等）")
        return 0

    bak = CONFIG + ".bak-gemma-search-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(CONFIG, bak)
    print("已备份:", bak)

    src = open(CONFIG, encoding="utf-8").read()
    if not src.endswith("\n"):
        src += "\n"
    new = src + BLOCK
    with open(CONFIG, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(new)

    # 写回后立刻校验：YAML 不合法会破坏整个 profile，必须能自动回滚
    try:
        doc2 = load_yaml(CONFIG)
        idx2, entry2 = find_entry(doc2)
        assert entry2 is not None, "写入后找不到条目"
        assert entry2["config"]["serverName"] == SERVER_NAME
        print("写入并校验通过 [OK]  顶层元素数 {} -> {}".format(len(doc or []), len(doc2 or [])))
    except Exception as e:                                  # noqa: BLE001
        shutil.copy2(bak, CONFIG)
        print("[FAIL] 校验失败，已回滚:", type(e).__name__, e)
        return 1

    print("\n注册内容:")
    cfg = entry2["config"]
    for k in ("serverName", "transport", "command", "args", "cwd",
              "toolCallTimeoutMs", "failOnStartupError"):
        print("   {:<20} {}".format(k, cfg.get(k)))
    print("   {:<20} {}".format("env", cfg.get("env")))
    print("\n回滚命令（如需）:")
    print("   python register_mcp.py --uninstall")
    print("   或直接还原备份:", bak)
    print("\n⚠ 需重启 DSH 桌面端（或重载 desktop profile）后生效。")
    return 0



if __name__ == "__main__":
    sys.exit(main())

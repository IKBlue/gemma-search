# -*- coding: utf-8 -*-
"""
probe_gpu.py —— 报告本机 GPU 与 EmbeddingGemma 2 的加速可行性。

依据模型卡（MODEL_CARD.md 第 189–200 行）：
    Run inference in bfloat16 or float32. Do not use float16.
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
float16 会让该模型的激活超出动态范围，**静默返回 NaN 或退化向量**，不报错。

用法：python probe_gpu.py
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

socket.setdefaulttimeout(25)


def main() -> int:
    print("=" * 84)
    print("1) 硬件")
    print("=" * 84)
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version,compute_cap",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=20)
        for line in (out.stdout or "").strip().splitlines():
            print("   " + line)
        if not (out.stdout or "").strip():
            print("   nvidia-smi 无输出")
    except FileNotFoundError:
        print("   未找到 nvidia-smi —— 可能没有 NVIDIA GPU")
    except Exception as e:                                  # noqa: BLE001
        print("   nvidia-smi 失败:", type(e).__name__, str(e)[:80])

    print("\n" + "=" * 84)
    print("2) 当前 venv 的 torch 能力")
    print("=" * 84)
    import torch
    print("   torch           :", torch.__version__)
    print("   cuda 可用       :", torch.cuda.is_available())
    print("   torch.version.cuda:", torch.version.cuda)
    if torch.cuda.is_available():
        print("   设备            :", torch.cuda.get_device_name(0))
        print("   显存            : {:.1f} GB".format(
            torch.cuda.get_device_properties(0).total_memory / 1024 ** 3))
        print("   bf16 原生支持   :", torch.cuda.is_bf16_supported())
    else:
        print("   → 当前是 CPU 版 torch，需要装 CUDA 版才能用 GPU")

    print("\n" + "=" * 84)
    print("3) 按模型卡推导的精度选择")
    print("=" * 84)
    if torch.cuda.is_available() and torch.cuda.is_bf16_supported():
        print("   → bfloat16（原生支持，显存减半，模型卡推荐）")
    elif torch.cuda.is_available():
        print("   → float32（该卡不支持 bfloat16，且模型卡禁用 float16）")
    else:
        print("   → float32（CPU）")

    print("\n" + "=" * 84)
    print("4) PyTorch CUDA 索引可用性（cp312 / win_amd64）")
    print("=" * 84)
    cur = torch.__version__.split("+")[0]
    for cu in ("cu126", "cu128", "cu129", "cu130", "cu131"):
        url = "https://download.pytorch.org/whl/" + cu + "/torch/"
        try:
            with urllib.request.urlopen(url) as r:
                html = r.read().decode("utf-8", "replace")
        except Exception as e:                              # noqa: BLE001
            print("   {:<6} 不可达 ({})".format(cu, type(e).__name__))
            continue
        # 匹配 torch-<ver>%2B<cu>-cp312-cp312-win_amd64.whl
        pat = r"torch-([0-9][^-]*?)%2B" + cu + r"-cp312-cp312-win_amd64\.whl"
        vers = sorted(set(re.findall(pat, html)))
        if not vers:
            print("   {:<6} 无 cp312/win_amd64 轮子".format(cu))
            continue
        ok = "  <-- 与当前 torch 同版" if cur in vers else ""
        print("   {:<6} 最高 {:<10} 共 {:>3} 版{}".format(cu, vers[-1], len(vers), ok))

    print("\n安装示例（与当前版本一致，替换 <cuXXX>）:")
    print("   uv pip install --python .venv\\Scripts\\python.exe \\")
    print("       --index-url https://download.pytorch.org/whl/<cuXXX> \\")
    print("       torch=={}+<cuXXX> torchvision".format(cur))
    return 0


if __name__ == "__main__":
    sys.exit(main())

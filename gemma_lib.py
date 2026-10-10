# -*- coding: utf-8 -*-
"""
gemma_lib —— EmbeddingGemma 2 素材库检索的共享库。

职责：
  1. 配置（素材库根目录、索引入口、模型 id、维度）
  2. 编码器封装（文本 / 图像 → 768 维 L2 归一化向量）
  3. 索引的读写（embeddings.npy + items.json + meta.json）

依据模型卡（google/embeddinggemma-2 README）的关键约束：
  · 统一 768 维空间；MRL 可截断到 512/256/128，**截断后必须重新归一化**
  · CPU 用 float32，**绝不能用 float16**（会静默返回 NaN）
  · 任务前缀只作用于文本；图像/视频/音频不加前缀
  · 检索场景：查询用 prompt_name="SearchQuery"，图像作为文档直接编码
  · 不需要音频时可 config_kwargs={"audio_config": None} 省内存（440M 而非 740M）
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from typing import Iterable

# ---------------------------------------------------------------- 配置
#
# 取值优先级：**环境变量 > config.json（不入库） > 可移植默认**
#
# 为什么这样设计：仓库里不该出现某台机器的绝对路径。
# 换台机器时**不用改代码**，只要写一个 config.json（见 config.example.json）或设环境变量。
#
#   GEMMA_WORKSPACE      工作区根（默认取本项目的上一级）
#   GEMMA_DATA_DIR       索引产物目录（默认 <项目根>/data）
#   GEMMA_LIBRARY_ROOT   素材库根目录（**必填**，默认 <工作区>/model）
#   GEMMA_MODEL_CACHE    模型缓存根（默认 <工作区>/model-cache）
#   GEMMA_MODEL_ID       模型 id（默认 google/embeddinggemma-2）

APP_DIR = os.path.dirname(os.path.abspath(__file__))    # 本文件所在目录 = 项目根（可移植）
WORKSPACE = os.path.dirname(APP_DIR)


def _load_user_config() -> dict:
    """读 config.json（不入库）。缺失或损坏都不致命 —— 退回默认值并提示。"""
    p = os.environ.get("GEMMA_CONFIG") or os.path.join(APP_DIR, "config.json")
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as fh:
            cfg = json.load(fh)
        return cfg if isinstance(cfg, dict) else {}
    except Exception as e:  # noqa: BLE001
        print("[gemma_lib] config.json 读取失败，改用默认值：%s" % e, file=sys.stderr)
        return {}


_USER = _load_user_config()


def _cfg(key: str, env: str, default: str) -> str:
    """环境变量 > config.json > 默认。"""
    return os.environ.get(env) or _USER.get(key) or default


WORKSPACE = _cfg("workspace", "GEMMA_WORKSPACE", WORKSPACE)
DATA_DIR = _cfg("data_dir", "GEMMA_DATA_DIR", os.path.join(APP_DIR, "data"))
LIBRARY_ROOT = _cfg("library_root", "GEMMA_LIBRARY_ROOT", os.path.join(WORKSPACE, "model"))
MODEL_CACHE = _cfg("model_cache", "GEMMA_MODEL_CACHE", os.path.join(WORKSPACE, "model-cache"))
MODEL_ID = _cfg("model_id", "GEMMA_MODEL_ID", "google/embeddinggemma-2")

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ARCHIVE_EXT = {".rar", ".zip", ".7z"}
FOLDERS = ["VR", "CR", "CR+VR", "其他"]

EMB_PATH = os.path.join(DATA_DIR, "embeddings.npy")
ITEMS_PATH = os.path.join(DATA_DIR, "items.json")
META_PATH = os.path.join(DATA_DIR, "meta.json")

# HF 缓存落在模型缓存目录下（沙箱只允许写工作区；换机器可用 GEMMA_MODEL_CACHE 指定）
os.environ.setdefault("HF_HOME", os.path.join(MODEL_CACHE, "hf"))
os.environ.setdefault("HF_HUB_CACHE", os.path.join(MODEL_CACHE, "hf", "hub"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def config_summary() -> str:
    """一行摘要，便于排查"到底用的哪个库/哪个索引"。"""
    return ("workspace=%s · library_root=%s · data_dir=%s · model_cache=%s · 源=%s"
            % (WORKSPACE, LIBRARY_ROOT, DATA_DIR, MODEL_CACHE,
               "config.json" if _USER else "默认"))


def warn_if_library_missing() -> bool:
    """素材库不存在时给出**可操作**的提示，而不是后面静默扫到 0 张。"""
    if os.path.isdir(LIBRARY_ROOT):
        return True
    print("[gemma_lib] ⚠ 素材库目录不存在：%s" % LIBRARY_ROOT, file=sys.stderr)
    print("[gemma_lib]   请在 config.json 里设置 library_root，或设环境变量 GEMMA_LIBRARY_ROOT。",
          file=sys.stderr)
    print("[gemma_lib]   参考 config.example.json。当前配置：%s" % config_summary(), file=sys.stderr)
    return False


# ---------------------------------------------------------------- 日志

def _log(*a, **kw) -> None:
    """诊断信息一律走 stderr。

    gemma_lib 也被 MCP stdio 服务使用；**stdout 属于 JSON-RPC 协议通道**，
    任何 print 到 stdout 的内容都会破坏协议流（CLI 的 --json 输出同理会被污染）。
    接受并透传关键字参数（调用点带 flush=True），缺省 file=stderr、flush=True。
    """
    kw.setdefault("file", sys.stderr)
    kw.setdefault("flush", True)
    print(*a, **kw)


# ---------------------------------------------------------------- 素材扫描

@dataclass
class Item:
    idx: int
    name: str           # 预览图文件名
    folder: str         # VR / CR / CR+VR / 其他
    rel_path: str       # 相对素材库根的路径
    abs_path: str
    size: int
    mtime: float
    archive: str | None            # 同名模型包（同主干、同目录），仅文件名
    # --- 以下为显式化的包信息（plan.md 要求 archive_path 明确；不影响向量，可独立重扫填充）---
    image_ext: str = ""
    archive_rel_path: str | None = None
    archive_abs_path: str | None = None
    archive_ext: str | None = None
    archive_size: int | None = None
    archive_mtime: float | None = None


def find_items(root: str = LIBRARY_ROOT) -> list[Item]:
    """递归扫描素材库，**逐目录**配对同名模型包。

    注意：配对必须在同一目录内进行。素材库顶层是 4 个分类子文件夹
    （VR / CR / CR+VR / 其他），不同子目录下的同干细胞属于不同素材。
    """
    out: list[Item] = []
    for dirpath, _dirs, files in os.walk(root):
        present = {f.lower(): f for f in files}
        for f in sorted(files):
            ext = os.path.splitext(f)[1].lower()
            if ext not in IMG_EXT:
                continue
            stem = os.path.splitext(f)[0]
            arch = None
            for aext in sorted(ARCHIVE_EXT):
                cand = (stem + aext).lower()
                if cand in present:
                    arch = present[cand]
                    break
            p = os.path.join(dirpath, f)
            st = os.stat(p)
            rel = os.path.relpath(p, root)
            folder = rel.split(os.sep)[0]
            ap = os.path.join(dirpath, arch) if arch else None
            ast = os.stat(ap) if ap else None
            out.append(Item(
                idx=len(out), name=f,
                folder=folder if folder in FOLDERS else "(根)",
                rel_path=rel, abs_path=p, size=st.st_size, mtime=st.st_mtime,
                archive=arch,
                image_ext=ext,
                archive_rel_path=(os.path.relpath(ap, root) if ap else None),
                archive_abs_path=ap,
                archive_ext=(os.path.splitext(arch)[1].lower() if arch else None),
                archive_size=(ast.st_size if ast else None),
                archive_mtime=(ast.st_mtime if ast else None),
            ))
    # 按相对路径排序，保证 idx 与顺序稳定可复现（os.walk 顺序不保证）
    out.sort(key=lambda it: it.rel_path.lower())
    for i, it in enumerate(out):
        it.idx = i
    return out


# ---------------------------------------------------------------- 编码器

class Encoder:
    """EmbeddingGemma 2 的惰性单例封装。

    实测（16 逻辑核 CPU，12 张样本）：
        image_seq_length=280 -> 3.90 s/张（~4.3 小时 / 3594 张）
        image_seq_length=140 -> 1.84 s/张（~1.8 小时）
        image_seq_length= 70 -> 0.78 s/张（~47 分钟）
    线程数无用（16 线程反而更慢），批大小影响可忽略。
    """

    _model = None
    _mode = None          # 图像编码成功的方式，运行期探测一次后固定
    _seq = None           # 已应用的 image_seq_length
    _device = None        # 实际使用的设备
    _dtype = None         # 实际使用的精度

    def __init__(self, dim: int = 768, load_audio: bool = False,
                 image_seq_length: int | None = 140, device: str | None = None):
        self.dim = dim
        self.load_audio = load_audio
        self.image_seq_length = image_seq_length
        self.device = device           # None = 自动（有 CUDA 用 CUDA，否则 CPU）

    @staticmethod
    def resolve_device_dtype(prefer: str | None = None):
        """按模型卡推导设备与精度，**并用实测修正其决策规则**。

        模型卡（第 189–200 行）：
            "Run inference in bfloat16 or float32. Do not use float16."
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32

        ⚠️ 实测发现该规则在本机会选错：RTX 2060 是 Turing(sm_75)，**没有原生 bf16**，
        但 `torch.cuda.is_bf16_supported()` 在本机返回 **True**（misleading）。
        按它选 bf16 的实测后果（8 张样本）：
            bf16 : 5.573 s/张，**L2 归一化失效（范数≠1）**，峰值显存 6.57 GB（超 6 GB 上限）
            fp32 : 0.485 s/张，L2 正常，峰值显存 2.69 GB
        bf16 比 fp32 **慢 11 倍**且输出已退化，因此改为按**计算能力**判断：
        bf16 仅在 sm_80（Ampere）及以上使用，等价于模型卡"有原生支持才用 bf16"的本意。
        float16 一律禁用（激活范围超出其动态范围，会静默返回 NaN 或退化向量）。

        另经同进程实测：CPU 与 GPU 的 fp32 向量逐张余弦 **1.0000**，故索引可跨设备混建。
        """
        import torch
        dev = prefer
        if dev is None:
            dev = "cuda" if torch.cuda.is_available() else "cpu"
        if dev.startswith("cuda") and torch.cuda.is_available():
            major = torch.cuda.get_device_properties(0).major
            if major >= 8 and torch.cuda.is_bf16_supported():
                return "cuda", torch.bfloat16
            return "cuda", torch.float32
        return "cpu", torch.float32

    @property
    def model(self):
        if Encoder._model is None:
            from sentence_transformers import SentenceTransformer
            cfg = {} if self.load_audio else {"audio_config": None}
            dev, dtype = self.resolve_device_dtype(self.device)
            _log("[encoder] 加载 {} (device={}, dtype={}, config_kwargs={}) ...".format(
                MODEL_ID, dev, dtype, cfg), flush=True)
            t0 = time.time()
            Encoder._model = SentenceTransformer(
                MODEL_ID, device=dev, model_kwargs={"torch_dtype": dtype},
                config_kwargs=cfg)
            Encoder._model.eval()
            Encoder._device, Encoder._dtype = dev, str(dtype).replace("torch.", "")
            _log("[encoder] 加载完成，用时 {:.1f}s（device={} dtype={}）".format(
                time.time() - t0, Encoder._device, Encoder._dtype), flush=True)
        self.apply_seq(self.image_seq_length)
        return Encoder._model

    def apply_seq(self, seq: int | None) -> None:
        """设置图像 soft token 预算（processor.image_seq_length，默认 280）。"""
        if not seq or Encoder._model is None or Encoder._seq == seq:
            return
        proc = getattr(Encoder._model, "processor", None)
        if proc is None:
            return
        done = False
        if hasattr(proc, "image_seq_length"):
            proc.image_seq_length = seq
            done = True
        ip = getattr(proc, "image_processor", None)
        if ip is not None:
            for k in ("max_soft_tokens", "image_seq_length"):
                if hasattr(ip, k):
                    setattr(ip, k, seq)
                    done = True
        Encoder._seq = seq
        _log("[encoder] image_seq_length = {}{}".format(
            seq, "" if done else " （未找到旋钮，可能不生效）"), flush=True)

    # ---------- 文本 ----------
    def encode_text(self, texts: Iterable[str], is_query: bool = True,
                    dim: int | None = None) -> "object":
        import numpy as np
        kw = dict(normalize_embeddings=True, convert_to_numpy=True,
                  show_progress_bar=False)
        if dim:
            kw["truncate_dim"] = dim
        if is_query:
            kw["prompt_name"] = "SearchQuery"
        else:
            kw["prompt_name"] = "Document"
        v = self.model.encode(list(texts) if not isinstance(texts, str) else texts, **kw)
        return np.atleast_2d(np.asarray(v, dtype=np.float32))

    # ---------- 图像 ----------
    def encode_images(self, paths: list[str], batch: int = 4,
                      dim: int | None = None) -> "object":
        """图像不加任务前缀（模型卡明确要求）。

        两种传入形态，优先 `dict`：
          · `[{"image": 路径}]` —— 官方多模态形态，走 torchvision 解码
          · PIL 图像对象           —— 回退形态，PIL 解码器对异常 JPEG 更宽容
        实测：库里有少量 JPEG 会让 torchvision 的 `decode_image` 抛
        `RuntimeError: decode_image`，而 PIL 能正常读出，因此**逐批回退**是必需的。
        """
        import numpy as np
        kw = dict(normalize_embeddings=True, convert_to_numpy=True,
                  show_progress_bar=False)
        if dim:
            kw["truncate_dim"] = dim
        chunks = []
        self.pil_fallbacks = getattr(self, "pil_fallbacks", 0)
        for i in range(0, len(paths), batch):
            part = paths[i:i + batch]
            embs = None
            if Encoder._mode != "pil":
                try:
                    embs = self.model.encode([{"image": p} for p in part], **kw)
                    if Encoder._mode is None:
                        Encoder._mode = "dict"
                except Exception as e:                  # noqa: BLE001
                    # 本批改用 PIL 回退；**不要**因为"上次成功过"就把整批判死
                    embs = None
                    self.pil_fallbacks += 1
                    if Encoder._mode is None:
                        _log("[encoder] dict 形态不可用，改走 PIL: {}".format(
                            type(e).__name__), flush=True)
            if embs is None:
                from PIL import Image
                imgs = []
                for p in part:
                    with Image.open(p) as im:
                        imgs.append(im.convert("RGB"))
                embs = self.model.encode(imgs, **kw)
                if Encoder._mode is None:
                    Encoder._mode = "pil"
            chunks.append(np.atleast_2d(np.asarray(embs, dtype=np.float32)))
        return np.vstack(chunks) if chunks else np.zeros((0, self.dim), np.float32)


# ---------------------------------------------------------------- 索引读写

def save_index(embs, items: list[Item], extra: dict | None = None) -> None:
    import numpy as np
    os.makedirs(DATA_DIR, exist_ok=True)
    np.save(EMB_PATH, np.asarray(embs, dtype=np.float32))
    with open(ITEMS_PATH, "w", encoding="utf-8") as fh:
        json.dump([asdict(it) for it in items], fh, ensure_ascii=False, indent=1)
    meta = {
        "model_id": MODEL_ID,
        "dim": int(embs.shape[1]) if len(embs) else 0,
        "count": int(len(items)),
        "library_root": LIBRARY_ROOT,
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "image_mode": Encoder._mode,
        # 存储后端标识：上层经 store.get_store() 读取，将来换 Zvec 不必改调用方
        "store": "numpy",
        # 记录构建所用的图像 soft token 档位：换档位必须重建（不同档位向量不可混用）
        "image_seq_length": Encoder._seq,
        # 记录构建设备与精度：便于分辨索引是否为 CPU/GPU 混建（可追溯性）
        "device": Encoder._device,
        "dtype": Encoder._dtype,
        # 说明 image_mode 的作用域，避免误读：它只反映**最后一次构建**所用的形态。
        # 本库有 20 个"名叫 .jpg、实为 BMP"的文件必须走 PIL 回退（见 README §9）。
        "image_mode_note": "仅指最后一次构建所用的传入形态",
    }
    if extra:
        meta.update(extra)
    with open(META_PATH, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)


def load_index():
    import numpy as np
    if not (os.path.isfile(EMB_PATH) and os.path.isfile(ITEMS_PATH)):
        return None, None, None
    embs = np.load(EMB_PATH)
    with open(ITEMS_PATH, encoding="utf-8") as fh:
        items = json.load(fh)
    meta = {}
    if os.path.isfile(META_PATH):
        with open(META_PATH, encoding="utf-8") as fh:
            meta = json.load(fh)
    return embs, items, meta

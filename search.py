# -*- coding: utf-8 -*-
"""
search.py —— 检索内核。MCP Server / CLI / HTTP 三个入口共用这一份实现。

契约（三入口必须一致，验收项之一）：
  · 图像查询：**不加任何任务前缀**（模型卡：前缀只作用于文本）
  · 文本查询：prompt_name="SearchQuery"
  · 分数：余弦相似度（向量均已 L2 归一化）
  · 结果项字段见 SearchEngine._as_result()

线程安全：编码器不是线程安全的，所有编码调用串行化在一把锁里
（HTTP 服务是多线程的，MCP 也可能是）。
"""
from __future__ import annotations

import os
import threading
import time

import numpy as np

import gemma_lib as G
import store as store_mod

_LOCK = threading.Lock()


class IndexMissing(RuntimeError):
    """索引不存在。"""


class SearchEngine:
    """载入索引 + 惰性编码器 + 检索。"""

    def __init__(self, data_dir: str | None = None, store_name: str | None = None,
                 device: str | None = None, image_seq_length: int | None = 140):
        self.store = store_mod.get_store(store_name, data_dir)
        self.device = device
        self.image_seq_length = image_seq_length
        self.embs = None
        self.items: list[dict] = []
        self.meta: dict = {}
        self.valid: np.ndarray | None = None
        self._encoder: G.Encoder | None = None
        self.loaded_at = 0.0
        self.reload()

    # ------------------------------------------------------------ 索引
    def reload(self) -> None:
        embs, items, meta = self.store.load()
        self.embs, self.items, self.meta = embs, (items or []), (meta or {})
        if embs is not None and len(self.items):
            self.valid = self.store.valid_mask(embs)
        else:
            self.valid = None
        self.loaded_at = time.time()

    @property
    def available(self) -> bool:
        return self.embs is not None and bool(self.items)

    @property
    def encoded(self) -> int:
        return int(self.valid.sum()) if self.valid is not None else 0

    def require_index(self) -> None:
        if not self.available:
            raise IndexMissing(
                "索引不存在：{}。请先运行 build_index.py --seq 140".format(
                    getattr(self.store, "emb_path", G.EMB_PATH)))

    # ------------------------------------------------------------ 编码
    @property
    def encoder(self) -> G.Encoder:
        if self._encoder is None:
            self._encoder = G.Encoder(image_seq_length=self.image_seq_length,
                                      device=self.device)
        return self._encoder

    def warmup(self) -> float:
        """预载模型并跑一次文本编码，返回耗时秒数。"""
        t0 = time.time()
        with _LOCK:
            self.encoder.encode_text(["warmup"], is_query=True)
        return time.time() - t0

    def encode_image(self, path: str) -> np.ndarray:
        if not os.path.isfile(path):
            raise FileNotFoundError("查询图片不存在: " + path)
        if os.path.splitext(path)[1].lower() not in G.IMG_EXT:
            raise ValueError("不支持的图片格式 {}；支持: {}".format(
                os.path.splitext(path)[1] or "(无扩展名)", ", ".join(sorted(G.IMG_EXT))))
        with _LOCK:
            return self.encoder.encode_images([path], batch=1)[0]

    def encode_text(self, query: str) -> np.ndarray:
        q = (query or "").strip()
        if not q:
            raise ValueError("查询文本为空")
        with _LOCK:
            return self.encoder.encode_text([q], is_query=True)[0]

    # ------------------------------------------------------------ 检索
    def _as_result(self, idx: int, score: float) -> dict:
        it = self.items[idx]
        ap = it.get("archive_abs_path") or (
            os.path.join(os.path.dirname(it["abs_path"]), it["archive"])
            if it.get("archive") else None)
        img = it["abs_path"]
        return {
            "id": int(idx),
            "name": it.get("name"),
            "folder": it.get("folder"),
            "score": round(float(score), 6),
            "rel_path": it.get("rel_path"),
            "image_path": img,
            "image_exists": os.path.isfile(img),
            "archive_path": ap,
            "archive_ext": it.get("archive_ext"),
            "archive_size": it.get("archive_size"),
            "archive_exists": bool(ap and os.path.isfile(ap)),
        }

    def search_vector(self, qvec: np.ndarray, top_k: int = 10,
                      folder: str | None = None) -> list[dict]:
        self.require_index()
        hits = self.store.search(qvec, top_k, folder,
                                 embs=self.embs, items=self.items, valid=self.valid)
        return [self._as_result(i, s) for i, s in hits]

    def search_by_image(self, image_path: str, top_k: int = 10,
                        folder: str | None = None) -> list[dict]:
        return self.search_vector(self.encode_image(image_path), top_k, folder)

    def search_by_text(self, query: str, top_k: int = 10,
                       folder: str | None = None) -> list[dict]:
        return self.search_vector(self.encode_text(query), top_k, folder)

    # ------------------------------------------------------------ 元信息
    def stats(self) -> dict:
        from collections import Counter
        total = len(self.items)
        enc = self.encoded
        return {
            "available": self.available,
            "indexed": total,
            "encoded": enc,
            "missing": total - enc,
            "partial": enc < total,
            "progress_pct": round(100.0 * enc / total, 2) if total else 0.0,
            "dim": self.meta.get("dim") or (int(self.embs.shape[1]) if self.available else None),
            "model_id": self.meta.get("model_id"),
            "store": self.meta.get("store", "numpy"),
            "device": self.meta.get("device"),
            "dtype": self.meta.get("dtype"),
            "image_seq_length": self.meta.get("image_seq_length"),
            "built_at": self.meta.get("built_at"),
            "library_root": self.meta.get("library_root"),
            "folders": dict(Counter(it.get("folder") for it in self.items)),
        }

    def get_item(self, idx: int) -> dict:
        self.require_index()
        if not (0 <= int(idx) < len(self.items)):
            raise IndexError("id 越界: {}（有效范围 0~{}）".format(idx, len(self.items) - 1))
        it = dict(self.items[int(idx)])
        # 该条是否为已编码（未编码的条目检索不到，必须如实告知）
        it["encoded"] = bool(self.valid[int(idx)]) if self.valid is not None else False
        ap = it.get("archive_abs_path")
        it["archive_exists"] = bool(ap and os.path.isfile(ap))
        it["image_exists"] = os.path.isfile(it.get("abs_path", ""))
        return it

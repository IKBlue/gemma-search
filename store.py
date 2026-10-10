# -*- coding: utf-8 -*-
"""
store.py —— 向量存储层（可替换后端）。

设计意图（用户裁决：先 numpy，规模过 5 万再换 Zvec）：
  · 上层（search.py / mcp_server.py / cli.py / server.py）只依赖 VectorStore 接口
  · 换后端只实现一个类并在 get_store() 里注册，调用方零改动
  · meta.json 里的 "store" 字段记录当前后端

为什么现在用 numpy：
  3594×768 float32 的暴力余弦实测约 0.3 毫秒，比引入原生扩展更简单。
  经验阈值：约 5 万条以内（约 150 MB）暴力检索仍足够快（单次点积 5~15 ms）；
  超过后再换成 Zvec（`pip install zvec`，阿里开源，C++ 后端）。
"""
from __future__ import annotations

import json
import os
from typing import Protocol, runtime_checkable

import numpy as np

import gemma_lib as G


@runtime_checkable
class VectorStore(Protocol):
    """向量存储后端契约。"""

    name: str

    def load(self) -> tuple[np.ndarray, list[dict], dict]:
        """返回 (向量矩阵 N×D、条目列表、meta)。索引不存在时返回 (None, None, None)。"""
        ...

    def search(self, qvec: np.ndarray, k: int, folder: str | None) -> list[tuple[int, float]]:
        """返回 [(条目下标, 余弦分数)]，按分数降序。只考虑已编码（非零向量）的条目。"""
        ...

    def save(self, embs: np.ndarray, items: list[dict], meta: dict) -> None:
        ...


class NumpyStore:
    """numpy 暴力检索后端（当前默认）。

    索引文件沿用既有布局：data/embeddings.npy + items.json + meta.json。
    载入时预算一次有效掩码，避免每次查询重算范数。
    """

    name = "numpy"

    def __init__(self, data_dir: str | None = None):
        self.data_dir = data_dir or G.DATA_DIR
        self.emb_path = os.path.join(self.data_dir, "embeddings.npy")
        self.items_path = os.path.join(self.data_dir, "items.json")
        self.meta_path = os.path.join(self.data_dir, "meta.json")

    # ---------- 读 ----------
    def load(self):
        if not (os.path.isfile(self.emb_path) and os.path.isfile(self.items_path)):
            return None, None, None
        embs = np.load(self.emb_path)
        with open(self.items_path, encoding="utf-8") as fh:
            items = json.load(fh)
        meta: dict = {}
        if os.path.isfile(self.meta_path):
            with open(self.meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
        return embs, items, meta

    # ---------- 检索 ----------
    def search(self, qvec: np.ndarray, k: int, folder: str | None = None,
               embs: np.ndarray | None = None, items: list[dict] | None = None,
               valid: np.ndarray | None = None) -> list[tuple[int, float]]:
        """余弦检索。向量均已 L2 归一化，故点积即余弦。

        允许由调用方传入已载入的矩阵/条目/掩码，避免重复读盘。
        """
        if embs is None or items is None:
            embs, items, _meta = self.load()
            if embs is None or not len(items):
                return []
        if valid is None:
            valid = self.valid_mask(embs)
        q = np.asarray(qvec, dtype=np.float32).reshape(-1)
        if q.shape[0] != embs.shape[1]:
            raise ValueError(
                "查询向量维度 {} 与索引维度 {} 不一致（换过 MRL 截断档位？"
                "查询与库必须同维）".format(q.shape[0], embs.shape[1]))

        sims = embs @ q
        sims = np.where(valid, sims, -np.inf)
        if folder and folder != "全部":
            mask = np.array([it.get("folder") == folder for it in items])
            sims = np.where(mask, sims, -np.inf)

        k = max(1, min(int(k), len(items)))
        # argpartition 取前 k 个候选，再对这 k 个排序（O(N) 而非 O(N log N)）
        cand = np.argpartition(-sims, k - 1)[:k]
        cand = cand[np.argsort(-sims[cand], kind="stable")]
        return [(int(i), float(sims[i])) for i in cand if np.isfinite(sims[i])]

    @staticmethod
    def valid_mask(embs: np.ndarray) -> np.ndarray:
        """已编码 = 非零向量。构建中的索引会留零向量，必须排除。"""
        return np.linalg.norm(embs, axis=1) > 0

    # ---------- 写 ----------
    def save(self, embs, items, meta: dict | None = None) -> None:
        os.makedirs(self.data_dir, exist_ok=True)
        np.save(self.emb_path, np.asarray(embs, dtype=np.float32))
        with open(self.items_path, "w", encoding="utf-8") as fh:
            json.dump(list(items), fh, ensure_ascii=False, indent=1)
        if meta is not None:
            with open(self.meta_path, "w", encoding="utf-8") as fh:
                json.dump(meta, fh, ensure_ascii=False, indent=2)


class ZvecStore:
    """Zvec 后端占位（规模超过约 5 万条时实现）。

    刻意不实现：本项目当前 3594 条，numpy 暴力检索约 0.3 毫秒，引入原生依赖无收益。
    真要启用时：`uv pip install zvec`，然后实现 load/search/save 三个方法，
    并把本类注册进 _REGISTRY、把 meta.json 的 "store" 改成 "zvec" 即可。
    """

    name = "zvec"

    def __init__(self, *a, **kw):
        raise NotImplementedError(
            "Zvec 后端尚未实现。当前规模（<5 万条）用 numpy 更快更简单；"
            "需要时按 store.py 顶部说明补齐 load/search/save。")

    def load(self):                                        # pragma: no cover
        raise NotImplementedError

    def search(self, qvec, k, folder=None):                # pragma: no cover
        raise NotImplementedError

    def save(self, embs, items, meta=None):                # pragma: no cover
        raise NotImplementedError


_REGISTRY: dict[str, type] = {"numpy": NumpyStore, "zvec": ZvecStore}


def get_store(name: str | None = None, data_dir: str | None = None) -> VectorStore:
    """按 meta.json 的 "store" 字段取后端，缺省 numpy。"""
    if name is None:
        meta_path = os.path.join(data_dir or G.DATA_DIR, "meta.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, encoding="utf-8") as fh:
                    name = json.load(fh).get("store")
            except (OSError, ValueError):
                name = None
    name = name or "numpy"
    cls = _REGISTRY.get(name)
    if cls is None:
        raise ValueError("未知的存储后端 {!r}；可用: {}".format(
            name, ", ".join(sorted(_REGISTRY))))
    return cls(data_dir)

好的。根据你补充的信息——**素材库根目录下，图像与压缩包同名**——我现在对目标有了足够清晰的认知。以下是我理解到的完整需求画像，以及一份可执行的计划书。

---

## 需求认知确认

在写计划书之前，我先把对你的目标理解完整列出来，你确认无误后我们再推进：

| 维度 | 你的需求 |
|---|---|
| **核心功能** | 以图搜图：用户上传一张图片，在本地素材库中找到相似的图片素材 |
| **返回内容** | 返回匹配的图片，以及该图片对应的**压缩包**（含 3D 模型等素材） |
| **映射方式** | 素材库根目录下，**图像文件名与压缩包文件名一致**，靠文件名建立映射 |
| **元数据** | 目前没有 JSON，需要设计字段并自动生成 |
| **3D 模型处理** | 不解析 3D 模型内容，仅记录压缩包路径和名称 |
| **交互形式** | 作为 Agent Skill，一问一答。用户发图片并说“查找这个素材”，Agent 执行检索 |
| **输出动作** | 将匹配的**图像和压缩包复制到工作区专属文件夹**下，不需要额外操作 |
| **工作区** | 每个项目一个工作区（如 `~/projects/项目A/`），Agent 自动复制到当前项目文件夹 |
| **运行环境** | 通用型本地电脑，素材库由用户指定并记录 |
| **素材规模** | 当前约 1 万张图片 |


## 计划书：本地以图搜图 Agent Skill

### 1. 整体架构

```text
用户上传图片 + "查找这个素材"
        ↓
┌─────────────────────────────────┐
│         Agent Skill 层           │
│  (MCP Server / Skill 定义)       │
│  职责：接收图片 → 调用检索 →     │
│        复制文件到工作区 → 返回   │
└─────────────────────────────────┘
        ↓
┌─────────────────────────────────┐
│        检索引擎层                │
│  EmbeddingGemma 2 (图像编码)    │
│  + 向量数据库 (相似度搜索)       │
└─────────────────────────────────┘
        ↓
┌─────────────────────────────────┐
│        元数据层                  │
│  JSON 索引文件                   │
│  图片路径 ↔ 压缩包路径映射       │
└─────────────────────────────────┘
        ↓
┌─────────────────────────────────┐
│        素材库 (文件系统)          │
│  图像文件 + 同名压缩包           │
└─────────────────────────────────┘
```

**设计原则**：索引只做一次，检索只做编码和相似度计算，不重复扫描磁盘。


### 2. 技术选型

#### 2.1 嵌入模型：EmbeddingGemma 2

| 项目 | 说明 |
|---|---|
| **模型** | `google/embeddinggemma-2`（Apache 2.0 许可，可商用） |
| **参数量** | 740M，加载视觉编码器后约 440M 参数参与图像任务 |
| **输出维度** | 768 维，支持 MRL 截断至 512/256/128 维 |
| **图像编码速度** | MacBook M5 Pro GPU 上约 **37.3 毫秒/张** |
| **内存占用** | 文本+图像模式约 300-400MB，1 万张图片的向量存储约 **29.3 MB**（768 维 float32） |
| **精度要求** | 必须使用 **bfloat16 或 float32**，不可用 float16 |

**为什么选它**：它是目前唯一将图像、文本统一到同一向量空间、且可在本地电脑流畅运行的开源嵌入模型。你的场景（1 万张图片、本地电脑）完全在其舒适区内。

#### 2.2 向量数据库：Zvec

| 项目 | 说明 |
|---|---|
| **定位** | 阿里开源的轻量级嵌入式向量数据库，“向量数据库界的 SQLite” |
| **安装** | `pip install zvec`，零配置，无需启动独立服务 |
| **能力** | 语义向量检索、标量过滤、多路召回、融合排序 |
| **适用规模** | 支持万级到十亿级向量，1 万张图片绰绰有余 |
| **已有集成** | 已有开源项目用 Zvec 做本地多模态素材检索（图片+文本混合检索） |

**为什么不用 Faiss / Chroma**：Zvec 的嵌入式特性更适合你的“本地电脑 + 通用型”需求，无需额外部署服务进程。

#### 2.3 Agent Skill 框架：MCP Server

| 项目 | 说明 |
|---|---|
| **技术形态** | **MCP Server**（Model Context Protocol），这是目前最通用的 Agent Skill 形式 |
| **兼容客户端** | Claude Desktop、Claude Code、Cursor、Cline 等主流 Agent 工具 |
| **Skill 定义** | 标准的 `SKILL.md`（YAML frontmatter + Markdown 正文） |
| **已有先例** | `muser` 技能：Local-first 语义图片搜索，索引文件夹，用自然语言描述搜索，完全离线 |
| **实现语言** | Python（与 EmbeddingGemma 2、Zvec 生态一致） |

**为什么选 MCP**：你提到“技术形态我不清楚哪个更好”。MCP 是目前 Agent 生态中最通用的标准，做成 MCP Server 后，Claude、Cursor 等工具都能直接调用，未来不需要重写。


### 3. 元数据设计

#### 3.1 文件命名规则

你的素材库根目录下，图像和压缩包**同名**。例如：

```text
素材库/
  木质纹理01.jpg
  木质纹理01.zip
  金属材质02.png
  金属材质02.rar
  科幻场景03.jpg
  科幻场景03.zip
```

**映射规则**：图像文件名（去扩展名）= 压缩包文件名（去扩展名）。

#### 3.2 JSON 索引文件设计

在素材库根目录下生成一个 `_index.json`：

```json
{
  "library_path": "/Users/你的用户名/素材库",
  "created_at": "2026-10-08T12:00:00",
  "total_items": 10000,
  "items": [
    {
      "id": "001",
      "image_name": "木质纹理01",
      "image_path": "木质纹理01.jpg",
      "archive_name": "木质纹理01",
      "archive_path": "木质纹理01.zip",
      "archive_ext": "zip",
      "image_size_bytes": 245760,
      "archive_size_bytes": 10485760,
      "vector_index": 0,
      "added_at": "2026-10-08T12:00:00"
    }
  ]
}
```

**字段说明**：

| 字段 | 用途 |
|---|---|
| `id` | 唯一标识，用于向量数据库关联 |
| `image_name` | 图像文件名（不含扩展名），用于同名匹配 |
| `image_path` | 图像文件的绝对/相对路径 |
| `archive_name` | 压缩包文件名（不含扩展名） |
| `archive_path` | 压缩包的绝对/相对路径 |
| `archive_ext` | 压缩包格式（zip/rar/7z） |
| `vector_index` | 对应向量在数据库中的索引位置 |

#### 3.3 索引生成流程

```python
import os, json
from pathlib import Path

def build_index(library_path):
    library = Path(library_path)
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    archive_exts = {".zip", ".rar", ".7z", ".tar.gz"}
    
    # 扫描所有文件
    images = {}
    archives = {}
    
    for f in library.iterdir():
        if f.suffix.lower() in image_exts:
            images[f.stem] = f
        elif f.suffix.lower() in archive_exts:
            archives[f.stem] = f
    
    # 按同名匹配
    items = []
    for stem, img_path in images.items():
        if stem in archives:
            items.append({
                "id": str(len(items) + 1).zfill(4),
                "image_name": stem,
                "image_path": str(img_path.relative_to(library)),
                "archive_name": stem,
                "archive_path": str(archives[stem].relative_to(library)),
                "archive_ext": archives[stem].suffix,
            })
        else:
            # 只有图片没有压缩包，记录为孤立项
            items.append({
                "id": str(len(items) + 1).zfill(4),
                "image_name": stem,
                "image_path": str(img_path.relative_to(library)),
                "archive_name": None,
                "archive_path": None,
                "archive_ext": None,
            })
    
    index = {
        "library_path": str(library),
        "created_at": "2026-10-08T12:00:00",
        "total_items": len(items),
        "items": items,
    }
    
    with open(library / "_index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    
    return index
```


### 4. 核心实现流程

#### 4.1 首次索引（一次性）

```python
# 伪代码：索引构建流程
def build_library_index(library_path):
    # 1. 扫描目录，生成 _index.json
    index = build_index(library_path)
    
    # 2. 加载 EmbeddingGemma 2（仅视觉编码器）
    model = SentenceTransformer("google/embeddinggemma-2")
    
    # 3. 初始化 Zvec 向量数据库
    db = zvec.open(str(library_path / "_vector_db"))
    
    # 4. 逐张编码图像并入库
    for item in index["items"]:
        img = Image.open(library_path / item["image_path"])
        vec = model.encode(
            img,
            prompt_name="document",      # 图像库使用 document 前缀
            normalize_embeddings=True
        )
        db.insert(
            id=item["id"],
            vector=vec.tolist(),
            metadata={
                "image_name": item["image_name"],
                "archive_name": item["archive_name"],
            }
        )
    
    db.commit()
    print(f"索引完成：{len(index['items'])} 个素材")
```

**编码速度**：1 万张图片，按 37.3 毫秒/张计算，约 **6.2 分钟**完成。这是一次性操作。

#### 4.2 查询流程（每次检索）

```python
def search_and_copy(query_image_path, workspace_path, top_k=3):
    # 1. 加载模型和数据库
    model = SentenceTransformer("google/embeddinggemma-2")
    db = zvec.open(str(library_path / "_vector_db"))
    
    # 2. 编码查询图片
    query_img = Image.open(query_image_path)
    query_vec = model.encode(
        query_img,
        prompt_name="SearchQuery",      # 查询使用 SearchQuery 前缀
        normalize_embeddings=True
    )
    
    # 3. 检索 Top-K
    results = db.query(vector=query_vec.tolist(), top_k=top_k)
    
    # 4. 复制文件到工作区
    for r in results:
        meta = r.metadata
        # 复制图像
        shutil.copy2(
            library_path / meta["image_name"] + ".jpg",
            workspace_path / f"{meta['image_name']}.jpg"
        )
        # 复制压缩包（如有）
        if meta["archive_name"]:
            shutil.copy2(
                library_path / meta["archive_path"],
                workspace_path / meta["archive_path"]
            )
    
    return results
```

**查询速度**：编码 1 张图片约 **37 毫秒**，1 万条向量的暴力检索约 **10 毫秒以内**，总响应时间 < **100 毫秒**。


### 5. Agent Skill 设计

#### 5.1 MCP Server 工具定义

```python
# mcp_server.py
from mcp.server import Server, Tool

server = Server("material-retrieval")

@server.tool()
async def search_similar_material(
    query_image_path: str,
    workspace_path: str,
    top_k: int = 3
) -> list:
    """
    在素材库中搜索与查询图片相似的素材。
    
    Args:
        query_image_path: 查询图片的本地路径
        workspace_path: 结果复制到的工作区文件夹路径
        top_k: 返回的相似素材数量，默认 3
    
    Returns:
        匹配的素材列表，包含图像路径、压缩包路径和相似度分数
    """
    results = search_and_copy(query_image_path, workspace_path, top_k)
    return [
        {
            "image_name": r.metadata["image_name"],
            "archive_name": r.metadata["archive_name"],
            "similarity": r.score,
            "copied_to": workspace_path,
        }
        for r in results
    ]
```

#### 5.2 SKILL.md 定义

```markdown
---
name: material-retrieval
description: 在本地素材库中搜索相似图片素材，返回匹配的图片和压缩包
---

# 素材检索 Skill

## 触发条件
用户上传图片并说"查找这个素材"、"搜索相似图片"、"找这个素材"时调用。

## 工作区规则
- 每个项目一个工作区：`~/projects/{项目名}/`
- 检索结果复制到 `{工作区}/_retrieved_materials/` 下
- 如果工作区不存在，提示用户先创建或指定

## 输出格式
检索完成后，向用户展示：
1. 匹配的素材名称
2. 相似度分数
3. 已复制到工作区的路径
```

#### 5.3 一问一答交互流程

```text
用户： [上传图片] 查找这个素材

Agent： 好的，我来在素材库中查找相似素材。
        当前工作区：~/projects/项目A
        我将把匹配结果复制到该工作区下。

        [调用 search_similar_material]

Agent： 找到了 3 个相似素材：
        1. 木质纹理01（相似度 0.92）
        2. 木质纹理02（相似度 0.87）
        3. 木纹材质03（相似度 0.81）

        已复制到：~/projects/项目A/_retrieved_materials/
        - 木质纹理01.jpg + 木质纹理01.zip
        - 木质纹理02.jpg + 木质纹理02.zip
        - 木纹材质03.jpg + 木纹材质03.zip
```


### 6. 实施步骤

| 阶段 | 任务 | 预估工时 |
|---|---|---|
| **第 1 步** | 搭建 Python 环境，安装 `sentence-transformers[image]`、`zvec`、`mcp` | 30 分钟 |
| **第 2 步** | 编写 `build_index.py`：扫描素材库、生成 `_index.json` | 1 小时 |
| **第 3 步** | 编写 `build_vector_db.py`：编码图像、写入 Zvec | 1 小时 |
| **第 4 步** | 运行首次索引（1 万张图片，约 6-10 分钟） | 10 分钟 |
| **第 5 步** | 编写 `search.py`：查询编码、相似度搜索、文件复制 | 2 小时 |
| **第 6 步** | 封装为 MCP Server，编写 `SKILL.md` | 2 小时 |
| **第 7 步** | 在 Claude Desktop / Cursor 中注册 MCP Server，端到端测试 | 1 小时 |
| **第 8 步** | 处理边界情况：孤立图片、压缩包格式兼容、工作区不存在 | 1 小时 |

**总预估**：约 **1.5 天**完成可运行版本。


### 7. 边界情况处理

| 场景 | 处理方式 |
|---|---|
| **图片无对应压缩包** | 索引中 `archive_name` 为 `null`，检索时只复制图像，提示用户“该素材无压缩包” |
| **压缩包无对应图片** | 不纳入索引，或记录为“孤立压缩包”，不参与检索 |
| **一个压缩包对应多张图片** | 目前命名规则假设一对一。如需一对多，需调整 JSON 设计，在 `items` 中用数组关联 |
| **工作区不存在** | Agent 提示用户“工作区不存在，请先创建或指定路径” |
| **查询图片格式不支持** | 返回错误，提示支持的格式（jpg/png/webp/bmp） |
| **同名但扩展名不同** | 以图像扩展名去匹配，压缩包扩展名不限（zip/rar/7z） |
| **未来素材库更新** | 重新运行索引脚本，增量更新或全量重建 |


### 8. 关键风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| **EmbeddingGemma 2 对任务前缀敏感** | 前缀用错会导致检索质量大幅下降 | 图像库用 `document`，查询用 `SearchQuery`，代码中硬编码确保一致 |
| **float16 精度问题** | 会产生 NaN 或质量下降 | 强制使用 bfloat16 或 float32 |
| **素材库路径变更** | 索引失效 | `_index.json` 记录 `library_path`，检索时校验路径是否一致 |
| **Zvec 在部分平台兼容性** | 可能无法安装 | Zvec 已支持 Windows/macOS/Linux |
| **1 万张图片编码耗时** | 首次索引需等待 | 可分批编码，支持断点续传 |

---

**下一步**：如果你确认以上方案无误，我可以直接开始写代码。你也可以告诉我是否有需要调整的地方，比如工作区的具体路径规则、返回的素材数量（Top-K）、是否需要支持文本搜图等。
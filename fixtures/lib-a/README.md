# fixtures/lib-a —— 写操作与故障注入的夹具库

> 依据 `docs/spec/SPEC-transactions.md` 与 `docs/plan/ROADMAP.md` P4：
> 「入库/移出/故障注入**绝不对真实素材库跑**。用 `fixtures/lib-a/`（几十个文件的夹具库）」。

## 这是什么

32 个文件、6 个目录，覆盖配对的**全部分支**：

| 分支 | 位置 |
|---|---|
| 图 + 包（配对） | `VR/VR-101.*` · `CR/CR-201.*` · `CR+VR/CX-301.*` · `其他/OT-401.*` · `未分类/UN-501.*` |
| **只有图** | `VR/VR-102.jpg` |
| **只有包**（孤儿包） | `CR/CR-203.rar` |
| 包扩展名不同 | `.rar` / `.7z` / `.zip` |
| **同名多个包 ⇒ 配对歧义** | `ambiguous/AMB-multiPkg.*`（1 图 + 2 包） |
| **同名多张图 ⇒ 配对歧义** | `ambiguous/AMB-multiImg.*`（2 图 + 1 包） |

## ⚠️ 这不是真图片

内容是**确定性合成的 ASCII 字节**（配方见下），**不是** JPEG/PNG/BMP。
事务与配对逻辑**只看字节与扩展名**，不解码图像 —— 所以对它们完全够用。
**不要**拿这个夹具库去测缩略图/解码/编码路径（那要真图，属于 `packages/indexer` 的范围）。

## 怎么复现（逐字节）

对第 `n` 个文件（`n` 从 1 开始，按本 README 表格的行优先顺序，即 `manifest.json` 里 `files` 的次序）：

```text
head    = "lib-a|" + relPath + "|" + n + "\n"     # relPath 用 / 作分隔符
len     = 200 + (n * 37) % 3800
content = head + "x" * (len - head.length)        # UTF-8
```

每个文件的 `sha1` 记在 `manifest.json` 里 —— 夹具被改动会被测试发现。

## 纪律

- **只对这个目录做写操作。** 任何测试都不得把 `lib-a` 之外的路径当作写目标。
- 测试自己负责在用例之间复制/清理（不要依赖 git 恢复）。

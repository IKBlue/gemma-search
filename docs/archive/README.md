# `docs/archive/` 是什么（**不是依据**）

**v2 重写之前**（2026-10-10 前后）的历史归档：旧文档体系、旧原型 HTML、以及当时用过的一次性 `_patch_*.mjs` 脚本。v2 已整体废弃旧文档体系（现行只有仓库根四份 md），这里**不参与构建、不参与打包、不参与格式化**。

| 现状 | 说明 |
|---|---|
| **不打包** | `electron-builder.yml` 里 `'!docs/*'` 已排除 |
| **不格式化** | `.prettierignore` 排除 `docs/archive/`（其中 3 个单行压缩 HTML 连 Prettier 都解析不了，会 EXIT=2）|
| **不 lint** | `eslint.config.mjs` 忽略 `docs/archive/**` |
| **不是依据** | `packages/design-tokens/tokens.css` 顶部已注明「原型套件其余部分已归档到 `docs/archive/prototype/`，**不再是依据**」 |

## 里面有什么（按类别）
· `prototype/` —— 旧界面原型 HTML（含单行压缩件）
· `legacy/` —— 当时的一次性补丁/迁移脚本 `_patch_*.mjs`、`_migrate_docs_*.mjs`
· 其余 `.css/.js/.json` —— 旧文档站点与探针的残留

⇒ **要查现行事实，请去四份根文档与 `reports/`**；本目录只回答「以前长什么样」。

（补这份 README 的目的：让归档**自述**，后来人不必猜它是不是还有用。）

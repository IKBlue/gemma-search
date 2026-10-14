// packages/engine/src/storage-ports.ts —— 存储端口（T-16a：**接口 + 纯类型**，实现在 main 侧）
//
// 为什么要端口：新布局把向量索引与元数据放到**库根**（`<库根>/.gs-index.bin` · `<库根>/.gs.db` ·
//   `<库根>/.gs-journal/`，SPEC §3），而 SQLite 与落点解析都属**主进程**。引擎是数据层核心但
//   **零第三方依赖、传输无关**（AGENTS §1）⇒ 引擎只声明「我需要什么形状」，由 main 注入实现（T-16b 接线）。
//
// ⚠️ 三条纪律：
//   ① 端口**全部同步**：引擎的 load()/indexStatus/scan 都是同步路径，改成异步会牵动整个调用面
//      （而 node:sqlite 与 fs 读本来就是同步的）。要异步化是**另一个显式决定**，不是顺手改。
//   ② 本文件只 import **引擎自己的**类型：不许出现 sqlite / electron / 任何第三方类型（AGENTS §1）。
//   ③ **传了哪个端口就走哪条路**；没传的回落到旧布局
//      （`<dataDir>/libraries/<libId>/{index.bin,items.json,meta.json}`）⇒ 不注入时行为与改造前逐字一致。
import type { IndexBin, IndexItem } from './index.ts';
// ⚠️ 类型专用 import（被擦除 ⇒ 运行期无环）：EngineRegistry 是引擎既有的『库从哪来』形状
import type { EngineRegistry } from './engine.ts';

// ⚠️ **端口抛错怎么保 code**（两条路不一样，实测确认）：
//   · `indexStatus` 用 `codeOf()` 读**任何**对象的 `code` ⇒ 抛带 code 的普通 Error 也能如实报出；
//   · 但走**信封**的方法（search/scan/item/…）只在错误是引擎的 `EngineError` 时保留 code，
//     其余按契约 §1.1 归为 `INTERNAL`。
//   ⇒ 实现方**应当**抛引擎错误：`fail(ERR.INDEX_MISSING, '...')`（main 复用引擎的 readIndexBin 时天然如此）。
//     抛普通 Error 不会崩，只是信封里的 code 变成 INTERNAL —— 这一点由 tests/storage-ports.test.mjs 钉住。

/** ① 条目读取端口（实现：main 侧；数据来自 `.gs.db`（T-11）或 items.json） */
export interface ItemStorePort {
  /** 按 (libId, uid) 取一条；**找不到返回 null**（由引擎转成 UID_NOT_FOUND 信封） */
  getItem(libId: string, uid: string): IndexItem | null;
  /** 某库的全部条目（顺序不保证：引擎自己按 relPath 建索引）。库不存在/读不动 ⇒ 抛错（引擎转信封） */
  listItems(libId: string): IndexItem[];
}

/**
 * ② 向量索引读取端口：读 `<库根>/.gs-index.bin` 并**走引擎的五道校验**。
 * ⚠️ 实现应当直接复用引擎的 `readIndexBin()`（AGENTS P1：不实现第二份解析/校验）。
 */
export interface VectorIndexPort {
  /** 读不到/损坏 ⇒ 抛带 `code` 的错误（INDEX_MISSING / INDEX_CORRUPT），引擎原样转成信封 */
  readIndex(libId: string): IndexBin;
}

/** `.gs-*` 的落点（SPEC §3：索引 / 元数据 / 事务日志都在**库根**下） */
export interface LibraryStorageLayout {
  /** 库根（`.gs-*` 与素材都在它下面） */
  root: string;
  /** `<库根>/.gs-index.bin` */
  indexPath: string;
  /** `<库根>/.gs.db` */
  dbPath: string;
  /** `<库根>/.gs-journal/`（可选：老库可能还没建这个目录） */
  journalPath?: string;
}

/**
 * ③ 库解析端口：有哪些库 · 库根在哪 · `.gs-*` 落在哪。
 * 形状 = 引擎既有的 `EngineRegistry`（list/has/get/requireExistingRoot）+ 新布局的落点。
 * ⇒ 复用既有概念，不新造第二套『库从哪来』的说法（P1）。
 */
export interface LibraryResolverPort extends EngineRegistry {
  storageOf(libId: string): LibraryStorageLayout;
}

/**
 * 端口包。**每一项都可选**：传了就接管对应那一路，没传就走旧布局。
 * 这样 T-16b 可以分步接线（例如先接 items + index，库解析仍用 config.json）。
 */
export interface StoragePorts {
  items?: ItemStorePort;
  index?: VectorIndexPort;
  libraries?: LibraryResolverPort;
}

// apps/desktop/src/main/storage-ports.ts —— 引擎存储端口的**主进程实现**（T-16b）
//
// 引擎（packages/engine）只声明"我需要什么形状"（storage-ports.ts），实现在这里：
//   ① ItemStorePort       ← .gs.db 的 items 表（T-11）；**没有 db 时回落到 items.json，且必须明说**
//   ② VectorIndexPort     ← <库根>/.gs-index.bin（走 index-file.readIndexBinAt ⇒ 校验仍只有引擎那一份）
//   ③ LibraryResolverPort ← 既有库清单（library-config 的解析结果）+ T-04 的 .gs-* 落点解析
//
// ⚠️ **端口抛错必须是引擎的 EngineError**（fail(ERR.X, ...)）。
//    T-16a 已把这个差异钉成明文契约：走信封的方法（search/scan/item/collect）只有 EngineError 保 code，
//    普通 Error 会被归成 INTERNAL。本模块用 asEngineError() 统一转换：
//    已经是 EngineError 的原样抛出（保住 code）；其余按映射表给码（见 engineCodeOf）。
//
// ⚠️ **回落要"明说"**：没有 .gs.db 时读 items.json 是既有行为，但不能静默——
//    调用方可能以为自己在读新布局。onFallback 默认 console.warn，测试里注入以便断言。
//
// 本模块不 import electron；路径全部来自注入的库解析端口。

import fs from 'node:fs';
import path from 'node:path';

import { EngineError, ERR, fail } from '../../../../packages/engine/src/errors.ts';
import type { ErrorCode } from '../../../../packages/engine/src/errors.ts';
import { readItems } from '../../../../packages/engine/src/index.ts';
import type { IndexBin, IndexItem } from '../../../../packages/engine/src/index.ts';
import type {
  ItemStorePort,
  LibraryResolverPort,
  LibraryStorageLayout,
  StoragePorts,
  VectorIndexPort,
} from '../../../../packages/engine/src/storage-ports.ts';

import type { ItemRecord } from './db/row-types.ts';
import { codeOf, messageOf } from './errors.ts';
import { resolveIndexLocation } from '../../../../packages/engine/src/index-layout.ts';
import { GS_DB_NAME, GS_INDEX_NAME, resolveLibraryStorage } from './storage-roots.ts';
import type { LibraryStorage, LibraryRootInput, StorageFs } from './storage-roots.ts';
import { ASSET_ITEM_SELECT_ALL_SQL, ASSET_ITEM_SELECT_ONE_SQL, joinedRowToItemRecord } from './db/row-types.ts';
import { openGsDb } from './db/open.ts';
import type { SqlDatabase } from './db/sqlite-adapter.ts';
import { readIndexBinAt } from './index-file.ts';

// ---------------------------------------------------------------- 错误转换（端口契约）

/** 引擎契约码集合（唯一来源 = 引擎的 ERR；与 library-ipc.ts 的 ENGINE_CODES 同一判据） */
const ENGINE_CODES: ReadonlySet<string> = new Set<string>(Object.values(ERR));

/**
 * .gs.db 层的错误码 → 引擎错误码。
 *
 * ⚠️ **顺序不能反**（与 library-ipc.ts 的 normalizeCode 同一顺序，T-45）：
 *   ① **已经是引擎契约码的原样透出** —— 导入族 IMPORT_* 自 T-45 起就在引擎码表里（SPEC §5，27 码）。
 *      改动前它们在 default 分支被归成 INDEX_CORRUPT ⇒ **假因果**：用户看到「索引文件已损坏」，
 *      而同一时刻体检说索引是好的（T-15b / T-42 实测；SPEC §5 明写这一族"不得归成 INDEX_CORRUPT"）。
 *   ② **其余** main 私有码才走下面的映射表。
 *
 */
function engineCodeOf(e: unknown): ErrorCode {
  const code = codeOf(e);
  if (ENGINE_CODES.has(code)) return code as ErrorCode;
  switch (code) {
    case 'DB_PATH_REQUIRED':
      // 没有落点 = 这个库没有元数据可读（与"还没有索引"同一处置：先建一次）
      return ERR.INDEX_MISSING;
    // ⚠️ S7b：DB_OPEN_FAILED 已进引擎码空间（SPEC §5.2 的 28 码）⇒ 上面第 ① 步就原样透出了，
    //    这里**不再**把它改名成 INDEX_CORRUPT（"库坏 ≠ 索引坏"，两者文案与处置都不同）。
    case 'META_ROW_MISSING':
    case 'SCHEMA_TOO_NEW':
    case 'MIGRATION_FAILED':
    case 'MIGRATION_LIST_INVALID':
    case 'UNEXPECTED_SQL_VALUE':
      return ERR.INDEX_CORRUPT;
    default:
      // 既不是引擎契约码、也不在映射表里 ⇒ INTERNAL（不猜）
      return ERR.INTERNAL;
  }
}

/**
 * 任意错误 → 引擎错误。
 * 已经是 EngineError 的**原样返回**：端口实现常常只是转发引擎自己的 readIndexBin/readItems 错误，
 * 那些错误的 code（INDEX_MISSING / INDEX_CORRUPT）就是契约要的，不该被重新映射一遍。
 */
export function asEngineError(e: unknown, what: string): EngineError {
  if (e instanceof EngineError) return e;
  return fail(engineCodeOf(e), what + '：' + messageOf(e), { cause: codeOf(e) });
}

// ---------------------------------------------------------------- ③ LibraryResolverPort

export interface LibraryResolverPortOptions {
  /** 已登记的库（来自 library-config.resolveLibraries().libraries 或注册表） */
  libraries: Array<{ libId: string; root: string; label?: string }>;
  /** app.getPath('userData')；缺省则不回退 */
  userDataDir?: string | null;
  /**
   * .gs-* 落点解析时是否做**写探测**。默认 **false**：
   * 端口在每次 storageOf 时都会被调用，写探测会在库根反复写删 .gs-write-probe-* 文件 ——
   * 那是 T-04 启动路径的职责，不是读端口的。代价：ACL 拒绝的库根会被当成"存在即可用"。
   */
  probeWrites?: boolean;
  fs?: StorageFs;
  /**
   * 旧布局的 libraries 根（`<dataDir>/libraries`）。给了 ⇒ 索引查找会**回退到旧布局**
   * （`<该目录>/<libId>/index.bin`）。判定唯一来源 = 引擎的 `resolveIndexLocation`（T-44）。
   */
  legacyLibrariesDir?: string | null;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 库解析端口：包装"已登记的库清单 + T-04 的落点解析"。
 *
 * storageOf().root 是**声明库根**（素材所在地，scan/collect 用的是它）；
 * .gs-* 的路径可能落在 userData 回退目录（T-04 的裁定）—— 两者故意不混为一谈：
 * 素材从不搬家，只有派生数据会回退。
 */
export function createLibraryResolverPort(opts: LibraryResolverPortOptions): LibraryResolverPort {
  const entries = new Map<string, { libId: string; root: string; label: string }>();
  for (const l of opts.libraries) {
    entries.set(l.libId, { libId: l.libId, root: l.root, label: l.label ?? l.libId });
  }
  const storageCache = new Map<string, LibraryStorage>();

  function requireEntry(libId: string): { libId: string; root: string; label: string } {
    const e = entries.get(libId);
    if (!e) {
      throw fail(ERR.LIB_NOT_FOUND, '未登记的库：' + (libId || '(空)'), { libId: libId || null });
    }
    return e;
  }

  function storageFor(libId: string): LibraryStorage {
    const cached = storageCache.get(libId);
    if (cached) return cached;
    const entry = requireEntry(libId);
    const input: LibraryRootInput = { libId: entry.libId, root: entry.root };
    const resolved = resolveLibraryStorage(input, {
      userDataDir: opts.userDataDir ?? null,
      probeWrites: opts.probeWrites === true,
      fs: opts.fs,
    });
    storageCache.set(libId, resolved);
    return resolved;
  }

  return {
    list: () => [...entries.values()].map((e) => ({ libId: e.libId, label: e.label, root: e.root })),
    has: (libId: string): boolean => entries.has(libId),
    get: (libId: string) => {
      const e = requireEntry(libId);
      return { libId: e.libId, label: e.label, root: e.root };
    },
    requireExistingRoot: (libId: string): void => {
      const e = requireEntry(libId);
      if (!isDir(e.root)) {
        throw fail(ERR.LIB_ROOT_MISSING, '库根不存在或不是目录：' + e.root, { libId: e.libId, root: e.root });
      }
    },
    storageOf: (libId: string): LibraryStorageLayout => {
      const e = requireEntry(libId);
      const s = storageFor(libId);
      if (s.root === null) {
        throw fail(ERR.LIB_ROOT_MISSING, '这个库没有可用的 .gs-* 落点：' + s.reason, { libId: e.libId });
      }
      // 索引落点：**唯一判据**在引擎（index-layout.ts）—— 新布局优先、旧布局回退。
      // ⚠️ 体检也用同一个函数 ⇒ 「引擎能跑、体检查不到」这类口径分裂不会再出现（T-44）。
      const loc = resolveIndexLocation({
        libId,
        libraryRoot: s.root,
        legacyLibrariesDir: opts.legacyLibrariesDir ?? null,
      });
      return {
        root: e.root, // 素材在**声明库根**
        indexPath: loc.indexPath ?? s.index ?? path.join(s.root, GS_INDEX_NAME),
        dbPath: s.db ?? path.join(s.root, GS_DB_NAME),
        journalPath: s.journal ?? undefined,
        layout: loc.layout,
      };
    },
  };
}

// ---------------------------------------------------------------- ② VectorIndexPort

export interface VectorIndexPortOptions {
  libraries: LibraryResolverPort;
  /** 读取实现的注入面（默认 index-file.readIndexBinAt ⇒ 引擎五道校验） */
  readIndexBin?: (indexPath: string) => IndexBin;
}

/**
 * 向量索引端口：读 <库根>/.gs-index.bin。
 *
 * 校验**只有一份**：默认实现转发到 index-file.readIndexBinAt → 引擎的 readIndexBin（五道）。
 * 本模块不碰字节、不做第二份解析（AGENTS P1）。失败时引擎的 INDEX_MISSING / INDEX_CORRUPT 原样抛出。
 */
export function createVectorIndexPort(opts: VectorIndexPortOptions): VectorIndexPort {
  const read = opts.readIndexBin ?? readIndexBinAt;
  return {
    readIndex: (libId: string): IndexBin => {
      const layout = opts.libraries.storageOf(libId);
      try {
        return read(layout.indexPath);
      } catch (e) {
        // 引擎错误原样透传；别的（IO 异常）翻成带码的引擎错误
        throw asEngineError(e, '读索引失败：' + layout.indexPath);
      }
    },
  };
}

// ---------------------------------------------------------------- ① ItemStorePort

/** 条目端口用到的 fs 面（测试可注入） */
export interface ItemStoreFs {
  existsSync(p: string): boolean;
  /** 拿不到（不存在/无权限）返回 -1 —— 用来给 items.json 回落做 mtime 缓存守卫 */
  mtimeMsOf(p: string): number;
}

export const NODE_ITEM_STORE_FS: ItemStoreFs = {
  existsSync: (p: string): boolean => fs.existsSync(p),
  mtimeMsOf: (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return -1;
    }
  },
};

export interface ItemStorePortOptions {
  libraries: LibraryResolverPort;
  /** items.json 回落路径；缺省 = <声明库根>/items.json（SPEC §2 的"元数据在库根"布局） */
  itemsJsonPathOf?: (libId: string) => string;
  /** 回落时的通知；默认 console.warn。**回落必须明说**，不许静默换数据源 */
  onFallback?: (message: string) => void;
  fs?: ItemStoreFs;
}

/**
 * ItemRecord（.gs.db 的行）→ 引擎的 IndexItem。
 *
 * ⚠️ 两边只有一处**可空性**差异：`.gs.db` 里 vector_row / vector_source 可以是真的 NULL
 *    （刚登记、还没入索引的条目），而引擎的 IndexItem 把它们声明成 `?: number` / `?: string`
 *    （**可缺省、不可为 null**）。⇒ 这里把 null 落成"键不存在"——
 *    语义相同（引擎用的是 `it.vectorRow == null`，两种都命中），但类型对得上。
 *    其余字段两边一致（archive* 在引擎里本来就允许 null）。
 */
function toIndexItem(rec: ItemRecord): IndexItem {
  const item: IndexItem = {
    uid: rec.uid,
    relPath: rec.relPath,
    folder: rec.folder,
    stem: rec.stem,
    imageExt: rec.imageExt,
    imageSize: rec.imageSize,
    imageMtime: rec.imageMtime,
    archiveRelPath: rec.archiveRelPath,
    archiveExt: rec.archiveExt,
    archiveSize: rec.archiveSize,
    archiveMtime: rec.archiveMtime,
  };
  if (rec.vectorRow !== null) item.vectorRow = rec.vectorRow;
  if (rec.vectorSource !== null) item.vectorSource = rec.vectorSource;
  // 引擎不认识的字段照样带上（IndexItem 有索引签名；上层展示/取件要用）
  item.libId = rec.libId;
  item.name = rec.name;
  item.absPath = rec.absPath;
  item.archiveName = rec.archiveName;
  item.archiveAbsPath = rec.archiveAbsPath;
  return item;
}

/**
 * 从 .gs.db 读条目（读不出来 → 带码的引擎错误）。
 *
 * ⚠️ S2：绿地口径下条目**分散在三张表**（asset / asset_file / asset_index_state）⇒
 *    SQL 负责连接（见 createItemStorePort 里的 SELECT_COLUMNS + FROM_JOINS），
 *    行 → ItemRecord 的合成在 row-types.joinedRowToItemRecord（与写路径同一套字段判据）。
 *    `root` 是**合成绝对路径**用的库根（新 schema 只存相对路径，设计基线 §1.2）。
 */
function readItemsFromDb(
  dbPath: string,
  libId: string,
  root: string,
  sql: string,
  params: Array<string | number>,
): IndexItem[] {
  let db: SqlDatabase;
  try {
    db = openGsDb({ dbPath, readOnly: true }).db;
  } catch (e) {
    throw asEngineError(e, '打开 .gs.db 失败：' + dbPath);
  }
  try {
    const rows = db.prepare(sql).all(...params);
    return rows.map((row, i) => {
      try {
        return toIndexItem(joinedRowToItemRecord(row, root, '.gs.db ' + libId + ' asset[' + String(i) + ']'));
      } catch (e) {
        // 列被改过 / 库损坏：读路径也要响亮（不能让错值溜进检索结果）
        throw asEngineError(e, '读 asset 行失败：' + dbPath);
      }
    });
  } catch (e) {
    throw asEngineError(e, '查 asset 表失败：' + dbPath);
  } finally {
    try {
      db.close();
    } catch {
      // 关不掉不影响结论
    }
  }
}

/**
 * 条目端口：.gs.db 优先，**没有 .gs.db 才回落 items.json**（并按契约"明说"）。
 *
 * 两条路的读法都复用既有实现，不重写：
 *   · .gs.db → db/open.openGsDb（只读）+ row-types.sqlRowToItemRecord（列↔字段的唯一映射）
 *   · items.json → 引擎的 readItems（格式归引擎；它抛的 INDEX_MISSING/INDEX_CORRUPT 直接透传）
 *
 * items.json 回落带 **mtime 守卫缓存**：引擎会对同一库反复调 getItem（取件循环最多 200 次），
 * 每次重读 2 MB JSON 是浪费；缓存只在 mtime 变化时失效（改了文件立刻能读到新内容）。
 */
export function createItemStorePort(opts: ItemStorePortOptions): ItemStorePort {
  const libraries = opts.libraries;
  const fsImpl = opts.fs ?? NODE_ITEM_STORE_FS;
  const say = opts.onFallback ?? ((m: string) => console.warn(m));
  // 绿地 6 张表口径（DESIGN-6tables §1.2）：
  //   · 条目在 asset；文件角色在 asset_file（preview / archive 各一行；**缺包 ⇒ archive 那行不存在**）；
  //   · 索引状态（含 vector_row）在 asset_index_state（未编码 ⇒ LEFT JOIN 出 null）；
  //   · 三张 LEFT JOIN 成"旧宽表"的形状，再交给 joinedRowToItemRecord 合成 ItemRecord。
  // ⚠️ SQL 本体**只写一份**、在 row-types.ts 里（ASSET_ITEM_SELECT_ALL_SQL / _ONE_SQL）：
  //    端口与测试共用同一条 SELECT，免得测试去验证一个"已经不存在"的查询（P1）。
  const selectAll = ASSET_ITEM_SELECT_ALL_SQL;
  const selectOne = ASSET_ITEM_SELECT_ONE_SQL;

  let jsonCache: { path: string; mtimeMs: number; items: IndexItem[] } | null = null;

  function itemsJsonPath(libId: string): string {
    if (opts.itemsJsonPathOf) return opts.itemsJsonPathOf(libId);
    return path.join(libraries.get(libId).root, 'items.json');
  }

  function readFromJson(libId: string, why: string): IndexItem[] {
    const p = itemsJsonPath(libId);
    say('[ItemStore] ' + libId + '：' + why + ' ⇒ **回落到 items.json**：' + p);
    const mtimeMs = fsImpl.mtimeMsOf(p);
    if (jsonCache && jsonCache.path === p && jsonCache.mtimeMs === mtimeMs) return jsonCache.items;
    const items = readItems(p); // 引擎：不存在抛 INDEX_MISSING、格式不对抛 INDEX_CORRUPT
    jsonCache = { path: p, mtimeMs, items };
    return items;
  }

  return {
    listItems: (libId: string): IndexItem[] => {
      const layout = libraries.storageOf(libId);
      if (fsImpl.existsSync(layout.dbPath)) return readItemsFromDb(layout.dbPath, libId, libraries.get(libId).root, selectAll, [libId]);
      return readFromJson(libId, '没有 .gs.db（' + layout.dbPath + '）');
    },
    getItem: (libId: string, uid: string): IndexItem | null => {
      const layout = libraries.storageOf(libId);
      if (fsImpl.existsSync(layout.dbPath)) {
        const rows = readItemsFromDb(layout.dbPath, libId, libraries.get(libId).root, selectOne, [libId, uid]);
        return rows.length ? rows[0] : null;
      }
      const items = readFromJson(libId, '没有 .gs.db（' + layout.dbPath + '）');
      return items.find((i) => i.uid === uid) ?? null;
    },
  };
}

// ---------------------------------------------------------------- 一组端口

export interface MainStoragePortsOptions {
  /** ③ 库解析（必给：另两个端口要靠它定位落点） */
  libraries: LibraryResolverPort;
  itemsJsonPathOf?: (libId: string) => string;
  onFallback?: (message: string) => void;
  itemFs?: ItemStoreFs;
  /** ② 索引读取的注入面（默认 index-file.readIndexBinAt） */
  readIndexBin?: (indexPath: string) => IndexBin;
}

/** 组装三个端口（可直接喂 createEngine({ storage })）。要只接一部分就单独调对应的工厂。 */
export function createStoragePorts(opts: MainStoragePortsOptions): StoragePorts {
  return {
    items: createItemStorePort({
      libraries: opts.libraries,
      itemsJsonPathOf: opts.itemsJsonPathOf,
      onFallback: opts.onFallback,
      fs: opts.itemFs,
    }),
    index: createVectorIndexPort({ libraries: opts.libraries, readIndexBin: opts.readIndexBin }),
    libraries: opts.libraries,
  };
}

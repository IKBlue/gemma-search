// apps/desktop/src/main/index-file.ts —— 向量索引的**落点 + 原子写入 + 校验后读取**（T-12a）
//
// 为什么单独一个模块：
//   `.gs-index.bin` 属于**库根**（SPEC §2「拷贝库即带走索引」）。它的写入是本项目里
//   **唯一一处"覆盖一个已经有内容的文件"**的路径 —— 写坏了就等于把 3594 条向量全毁掉，
//   而且没有任何报错（读的时候才发现）。所以三件事必须绑在一起、只有一处实现：
//     ① 落点：<库根>/.gs-index.bin（文件名**复用** storage-roots.ts 的 GS_INDEX_NAME，不另写一遍，P1）
//     ② 写入：库根内临时名 → fsync → rename 覆盖（rename 是原子的；半截文件永远不会出现在目标名上）
//     ③ 读取：**复用引擎的 readIndexBin**（五道校验：MAGIC / footer 解析 / complete / count-dim 一致 / sha1）
//             本模块**不实现第二份 GSIDX 解析**（AGENTS P1；引擎那一份是唯一权威）
//
// 写入侧的两条硬约束：
//   · **绝不动素材**：只允许写库根下的 `.gs-*` 名字（assertWritableGsPath 机械拦住；
//     目标必须是库根的**直接子项**，所以 `../` 与子目录都被拒）
//   · **不建库根**：库根不存在就报错，不顺手 mkdir（Lead 裁定 U6：静默建出一个空库根 = 幽灵库。
//     库根可写性与回退判断在 T-04 的 storage-roots.ts，调用方负责）
//
// 本模块不 import electron；fs 走可注入端口（IndexFs），所以 node --test 能直接跑，
// 也能确定性地造出"rename 失败 / unlink 也失败"这类真机上不好复现的分支。

import fs from 'node:fs';
import path from 'node:path';

import { readIndexBin } from '../../../../packages/engine/src/index.ts';
import type { IndexBin, IndexHeader } from '../../../../packages/engine/src/index.ts';
import { isReservedLibraryName } from './gs-names.ts';
import { GS_INDEX_NAME } from './storage-roots.ts';

/** 索引文件名（**唯一来源**是 storage-roots.ts 的 GS_INDEX_NAME —— 这里只是接过来用） */
export { GS_INDEX_NAME } from './storage-roots.ts';

/** 临时名前缀：`<库根>/.gs-index.bin.tmp-<pid>-<seq>`（点前缀同样落在 .gs- 命名空间里，扫描器会跳过） */
export const INDEX_TEMP_PREFIX: string = GS_INDEX_NAME + '.tmp-';

// ---------------------------------------------------------------- 错误

export type IndexFileErrorCode =
  /** libraryRoot 为空 */
  | 'INDEX_ROOT_REQUIRED'
  /** 要写的字节不是非空 Uint8Array（拒绝用 0 字节覆盖一份好索引） */
  | 'INDEX_BYTES_REQUIRED'
  /** 目标路径不在库根的 .gs-* 命名空间里（含路径穿越与子目录） */
  | 'INDEX_PATH_OUTSIDE_GS'
  /** 写 / 校验 / rename 失败（消息里带临时文件是否已清理的留痕） */
  | 'INDEX_WRITE_FAILED';

export class IndexFileError extends Error {
  readonly code: IndexFileErrorCode;
  constructor(code: IndexFileErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IndexFileError';
    this.code = code;
  }
}

// 一行格式化。**故意本地**：storage-roots.ts 与 db/errors.ts 各有一份同形的私有实现，
// 但那个 db 层模块与本模块是并列的落点模块，为一个单行惯用法把 index 模块绑到 db 层不划算。
function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- fs 端口（可注入）

/**
 * 本模块用到的**最小** fs 能力。
 * ⚠️ `writeFileSyncedSync` 的契约里**包含 fsync**：rename 之前数据必须真的落盘，
 *    否则掉电会留下一个"名字对、内容是半截"的索引 —— 那正是原子写入要防的东西。
 */
export interface IndexFs {
  existsSync(p: string): boolean;
  sizeOfSync(p: string): number;
  writeFileSyncedSync(p: string, data: Uint8Array): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
}

/** 真实文件系统（生产默认） */
export const NODE_INDEX_FS: IndexFs = {
  existsSync: (p: string): boolean => fs.existsSync(p),
  sizeOfSync: (p: string): number => {
    const st = fs.statSync(p);
    return st.size;
  },
  writeFileSyncedSync: (p: string, data: Uint8Array): void => {
    const fd = fs.openSync(p, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
  renameSync: (from: string, to: string): void => {
    fs.renameSync(from, to);
  },
  unlinkSync: (p: string): void => {
    fs.unlinkSync(p);
  },
};

// ---------------------------------------------------------------- 落点与命名约束

function requireRoot(libraryRoot: unknown): string {
  const raw = typeof libraryRoot === 'string' ? libraryRoot.trim() : '';
  if (!raw) {
    throw new IndexFileError(
      'INDEX_ROOT_REQUIRED',
      'indexPathFor 需要非空的库根 —— 库根由调用方（T-04 storage-roots.resolveLibraryStorage）解析后传入',
    );
  }
  return path.resolve(raw);
}

/** `<库根>/.gs-index.bin`（库根会被 resolve 成绝对路径；文件名来自 GS_INDEX_NAME） */
export function indexPathFor(libraryRoot: string): string {
  return path.join(requireRoot(libraryRoot), GS_INDEX_NAME);
}

/**
 * `.gs-*` 名字的机械判据：点前缀 + 至少一个字符 + **不含路径分隔符**。
 * 不含分隔符这一条把 `sub/.gs-x` 与 `..\\ .gs-x` 这类形状直接挡在命名约束里（第二道防线在 assertWritableGsPath）。
 */
export function isGsWriteName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (!name.startsWith('.gs-')) return false;
  if (name.length <= '.gs-'.length) return false;
  return !name.includes('/') && !name.includes('\\');
}

/**
 * 断言"这个路径是库根的**直接子项**，且名字在**保留命名空间**里"，返回 resolve 后的路径。
 *
 * 为什么要有它（而不是靠调用方自觉）：SPEC §2.1 的写入不变式是
 * "除 `.gs-*` 与 staging 外，素材目录一律只读"。这条不变式在这里是可机械检查的 ——
 * 那就别留给纪律。任何走本模块的写入都必须先过这一关。
 *
 * ⚠️ "保留命名空间"用 gs-names.ts 的 isReservedLibraryName 判定，**不是**简单的 `.gs-` 前缀：
 *    `.gs.db` 不以 `.gs-` 开头（第 4 个字符是 `.`）。见那个模块的注释。
 */
export function assertWritableGsPath(libraryRoot: string, target: string): string {
  const root = requireRoot(libraryRoot);
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== root) {
    throw new IndexFileError(
      'INDEX_PATH_OUTSIDE_GS',
      '只允许写库根的**直接子项**：' + resolved + ' 的父目录不是 ' + root + '（子目录与 ../ 穿越都会被拒）',
    );
  }
  const name = path.basename(resolved);
  // ⚠️ 判据是**库根的保留命名空间**（.gs-* / .gs.db+边车 / staging），不是"以 .gs- 开头" ——
  //    .gs.db 的第 4 个字符是 '.' 不是 '-'，只按前缀判断会把它误判成素材（2026-10-15 实测踩到）。
  if (!isReservedLibraryName(name)) {
    throw new IndexFileError(
      'INDEX_PATH_OUTSIDE_GS',
      '只允许写库根的保留命名空间（.gs-* / .gs.db(+边车) / staging；SPEC §2.1：素材目录除此以外只读），实际是 ' +
        JSON.stringify(name),
    );
  }
  return resolved;
}

// ---------------------------------------------------------------- 写入（原子）

/** 校验一个索引文件；失败即抛（默认实现 = 引擎的 readIndexBin，五道校验） */
export interface IndexValidation {
  count: number;
  dim: number;
}
export type IndexValidator = (file: string) => IndexValidation;

/** 默认校验器：引擎的 readIndexBin（**唯一**的 GSIDX 解析实现） */
const ENGINE_INDEX_VALIDATOR: IndexValidator = (file: string): IndexValidation => {
  const bin: IndexBin = readIndexBin(file);
  return { count: bin.count, dim: bin.dim };
};

export interface WriteIndexOptions {
  fs?: IndexFs;
  /** rename 之前是否先验临时文件（默认 true；验不过就**不覆盖**原索引） */
  validateBeforeRename?: boolean;
  /** 校验器（默认引擎）；测试可注入 */
  validate?: IndexValidator;
  /** 临时名里的序号（默认进程内自增；测试可固定以获得确定的名字） */
  seq?: number;
}

export interface IndexWriteReport {
  path: string;
  tempPath: string;
  bytes: number;
  validated: boolean;
  /** 校验通过时顺手带出的 header.count / dim（没校验就是 null） */
  count: number | null;
  dim: number | null;
  /** 人读理由（成功路径也非空，日志/证据直接用） */
  reason: string;
}

/** 进程内自增序号：同名进程里两次写入不会撞同一个临时名 */
let tempSeq = 0;

/** 清理临时文件并返回**留痕**（成功清理与清理失败都要说清楚） */
function cleanupTemp(fsImpl: IndexFs, temp: string): string {
  try {
    if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp);
    return '已清理临时文件 ' + temp;
  } catch (e) {
    return (
      '⚠️ 临时文件未能删除：' + temp + '（' + reasonOf(e) + '）—— 库根里会残留一个 .gs-* 名字的文件；' +
      '扫描器会跳过它（SPEC §2.1），但它需要人看一眼'
    );
  }
}

/**
 * 原子写入索引：库根内临时名 → fsync → （可选）五道校验 → rename 覆盖。
 *
 * 为什么"先校验再 rename"（默认开启）：
 *   rename 是本模块**唯一不可逆**的一步。在它之前拿引擎的五道校验把临时文件验一遍，
 *   就能做到"宁可不写，也不用一份坏 buffer 覆盖掉好索引" —— 坏 buffer 的后果是静默的
 *   （读的时候才发现，且旧索引已经没了）。代价是多读一遍 11 MB，相对一次索引构建可忽略。
 *
 * @throws IndexFileError(INDEX_ROOT_REQUIRED | INDEX_BYTES_REQUIRED | INDEX_PATH_OUTSIDE_GS | INDEX_WRITE_FAILED)
 */
export function writeIndexAtomically(
  libraryRoot: string,
  bytes: Uint8Array,
  opts: WriteIndexOptions = {},
): IndexWriteReport {
  const fsImpl = opts.fs ?? NODE_INDEX_FS;
  const root = requireRoot(libraryRoot);
  const target = assertWritableGsPath(root, indexPathFor(root));
  const temp = assertWritableGsPath(
    root,
    path.join(root, INDEX_TEMP_PREFIX + String(process.pid) + '-' + String(opts.seq ?? ++tempSeq)),
  );

  if (!(bytes instanceof Uint8Array)) {
    throw new IndexFileError(
      'INDEX_BYTES_REQUIRED',
      '索引字节必须是 Uint8Array（收到 ' + (bytes === null ? 'null' : typeof bytes) + '）',
    );
  }
  if (bytes.length === 0) {
    // 0 字节的文件必然过不了五道校验；在写之前就拒掉，别让它有机会盖掉一份好索引
    throw new IndexFileError('INDEX_BYTES_REQUIRED', '拒绝写 0 字节索引：那会把一份好索引变成一个必然损坏的文件');
  }

  try {
    fsImpl.writeFileSyncedSync(temp, bytes);
  } catch (e) {
    throw new IndexFileError(
      'INDEX_WRITE_FAILED',
      '写临时索引失败：' + temp + '（' + reasonOf(e) + '）。' + cleanupTemp(fsImpl, temp),
      { cause: e },
    );
  }

  let validation: IndexValidation | null = null;
  const validateBeforeRename = opts.validateBeforeRename !== false;
  if (validateBeforeRename) {
    const validate = opts.validate ?? ENGINE_INDEX_VALIDATOR;
    try {
      validation = validate(temp);
    } catch (e) {
      throw new IndexFileError(
        'INDEX_WRITE_FAILED',
        '写出的索引没通过五道校验 ⇒ **放弃覆盖原索引**（原索引原样保留）：' + reasonOf(e) +
          '。' + cleanupTemp(fsImpl, temp),
        { cause: e },
      );
    }
  }

  try {
    fsImpl.renameSync(temp, target);
  } catch (e) {
    throw new IndexFileError(
      'INDEX_WRITE_FAILED',
      'rename 覆盖失败：' + target + '（' + reasonOf(e) + '）。' + cleanupTemp(fsImpl, temp),
      { cause: e },
    );
  }

  const validatedPart =
    validation === null
      ? '（未校验：validateBeforeRename=false）'
      : '（五道校验通过：count=' + String(validation.count) + ' dim=' + String(validation.dim) + '）';
  return {
    path: target,
    tempPath: temp,
    bytes: bytes.length,
    validated: validation !== null,
    count: validation === null ? null : validation.count,
    dim: validation === null ? null : validation.dim,
    reason:
      '索引已原子写入 ' + target + '：' + String(bytes.length) + ' 字节' + validatedPart +
      '；临时文件 ' + temp + ' 已 rename 过去（目标名上不会出现半截文件）',
  };
}

// ---------------------------------------------------------------- 读取（校验归引擎）

export interface IndexReadReport {
  path: string;
  count: number;
  dim: number;
  /** 文件字节数（**不是**向量块字节数） */
  bytes: number;
  header: IndexHeader;
}

/**
 * 读回并校验库根里的索引。
 *
 * ⚠️ 校验**完全交给引擎**的 readIndexBin（五道：MAGIC / footer 解析 / footer.complete /
 *    footer 与 header 的 count-dim 一致 / 向量块 sha1）。本模块不碰字节格式，也不做"轻量版校验"——
 *    第二份解析就是 P1，而且轻量版会让"损坏"悄悄退化成"看起来还行"。
 *
 * ⚠️ 失败时抛的是**引擎的类型化错误**（EngineError：INDEX_MISSING / INDEX_CORRUPT），原样透传：
 *    界面文案（USER_MESSAGE）与 code 都归引擎契约，这里包一层只会逼调用方再映射回去。
 *
 * @throws EngineError(INDEX_MISSING | INDEX_CORRUPT)
 */
export function readIndexFile(libraryRoot: string): IndexReadReport {
  return readIndexSummaryAt(indexPathFor(libraryRoot));
}

/**
 * 读回并校验**给定路径**的索引，只回摘要 —— T-44：索引落点可能不在库根（旧布局回退），
 * 路径由唯一的落点判据（引擎的 resolveIndexLocation）给，这里只负责「读 + 摘要」。
 *
 * ⚠️ 校验仍然只有引擎那一份（readIndexBinAt → readIndexBin 五道）；
 *    readIndexFile 就是本函数的薄包装 ⇒ 不会长出第二份读索引的代码。
 *
 * @throws EngineError(INDEX_MISSING | INDEX_CORRUPT)
 */
export function readIndexSummaryAt(indexPath: string): IndexReadReport {
  const file = indexPath;
  const bin = readIndexBinAt(file);
  return {
    path: file,
    count: bin.count,
    dim: bin.dim,
    bytes: NODE_INDEX_FS.sizeOfSync(file),
    header: bin.header,
  };
}

/**
 * 按**给定路径**读回完整索引（含向量块）—— T-16b 的 VectorIndexPort 用这个。
 *
 * 为什么单独一个入口而不是让调用方直接调引擎的 readIndexBin：
 *   ① main 侧"读索引"只有这一个模块（路径构造 indexPathFor 也在这里）；
 *   ② 五道校验**仍然只有引擎那一份实现**，本函数只是把路径交过去；
 *   ③ readIndexFile 只回摘要（不搬 11 MB 向量块），端口要向量 ⇒ 用这个，别把摘要接口撑大。
 *
 * @throws EngineError(INDEX_MISSING | INDEX_CORRUPT)
 */
export function readIndexBinAt(indexPath: string): IndexBin {
  return readIndexBin(indexPath);
}

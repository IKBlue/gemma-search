// apps/desktop/src/main/atomic-write.ts —— **原子写文件**的单一实现（DF-4 / DF-8）
//
// 为什么必须有这一层：本项目已经**踩过**这个坑 —— 进程中途被杀 / 掉电时，
//   "直接写目标名"会留下一个**名字对、内容是半截**的文件，而且**没有任何报错**：
//     · 索引：半截 .gs-index.bin 过不了五道校验（还好，会被查出来）；
//     · 缩略图缓存：半截 JPEG 会被 readCachedThumb **当成命中**，界面拿到一张永远坏掉的图，
//       而且缓存**从不失效** ⇒ 除非手动删目录，否则永远修不好（DF-4 就是这条）。
//
// 范式（四处缺一不可）：
//   ① 临时名与目标**同目录**（同卷才能 rename 原子；跨卷 rename 会退化成拷贝）；
//   ② 写完 **fsync**（不 fsync 的话"rename 成功"只保证目录项，数据可能还在页缓存里）；
//   ③ 校验（可选，但**校验的是临时文件**）—— 不通过就**放弃覆盖**，原文件原样保留；
//   ④ rename 覆盖（在同一卷上是原子的）。
// 任何一步失败都要**清掉临时文件**，不留垃圾（库根/数据目录里出现神秘 tmp 是二次污染）。
//
// ⚠️ 调用方的差异**只允许出现在接缝上**，不许各写一套编排（P1）。接缝一共四条：
//   · `tempPath`：调用方需要**先断言临时路径合法**时由它给（索引写库根 ⇒ 必须过 assertWritableGsPath）；
//   · `cleanup`：调用方要**自己的留痕文案**时接管清理（索引的报错里必须有"已清理/未能删除"留痕）；
//   · `validate(tempPath)`：校验**落盘的那份**（索引用引擎五道校验，缩略图用 JPEG SOI/EOI 判据）；
//   · `mkdirSync` **可选**：库根**不许顺手创建**（U6：静默建空库根 = 幽灵库）⇒ 不给就不建。

import fs from 'node:fs';
import path from 'node:path';

/** 本模块用到的最小 fs 能力（可注入 ⇒ 失败路径能被单测真跑，而不是靠想象） */
export interface AtomicFs {
  /** **可选**：给了才建父目录。库根这类「必须已存在、不许顺手创建」的落点**不要给** */
  mkdirSync?(p: string, options: { recursive: true }): void;
  /** 契约：**写完必须 fsync**（只有 rename 前的 fsync 才能让「名字对」等于「内容也在盘上」） */
  writeFileSyncedSync(p: string, data: Uint8Array): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
  existsSync(p: string): boolean;
}

/** 一次性把数据写到 fd 并 fsync —— 全仓唯一的「同步落盘写」 */
export function writeFileSynced(p: string, data: Uint8Array): void {
  const fd = fs.openSync(p, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** 真实文件系统（生产默认） */
export const NODE_ATOMIC_FS: AtomicFs = Object.freeze({
  mkdirSync: (p: string, options: { recursive: true }): void => { fs.mkdirSync(p, options); },
  writeFileSyncedSync: (p: string, data: Uint8Array): void => { writeFileSynced(p, data); },
  renameSync: (from: string, to: string): void => { fs.renameSync(from, to); },
  unlinkSync: (p: string): void => { fs.unlinkSync(p); },
  existsSync: (p: string): boolean => fs.existsSync(p),
});

/**
 * 原子写失败的**唯一**错误类型；调用方各自映射成自己的错误码/返回值。
 * `reason` = 底层原因（不含本模块拼的路径与清理留痕）—— 调用方要自己组文案时用它。
 */
export class AtomicWriteError extends Error {
  readonly code: string;
  readonly reason: string;
  readonly tempPath: string | null;
  constructor(code: string, message: string, reason = '', tempPath: string | null = null) {
    super(message);
    this.name = 'AtomicWriteError';
    this.code = code;
    this.reason = reason;
    this.tempPath = tempPath;
  }
}

let tempSeq = 0;

export interface AtomicWriteOptions {
  fs?: AtomicFs;
  /** 临时名里的序号（默认模块内自增；测试可固定它） */
  seq?: number;
  /** 临时名前缀（默认 '.<目标文件名>.tmp-'；点前缀 ⇒ 同目录的扫描器会跳过） */
  tempPrefix?: string;
  /**
   * 由**调用方**给定的临时路径（必须与目标同目录）。
   * 用于「临时路径本身要先过命名/落点断言」的调用方（索引：库根内 + .gs- 命名空间 + 直接子项）。
   */
  tempPath?: string;
  /**
   * 校验**临时文件**（不是内存里的 bytes —— 要验的是真落盘的东西）。
   * 抛 ⇒ 视为不通过：**放弃覆盖**，原文件保留。
   */
  validate?: (tempPath: string) => void;
  /**
   * 接管失败时的清理（调用方要自己的留痕文案时用）。
   * 给了它 ⇒ 本模块**不再**自己清理，也不在 message 里拼清理留痕。
   */
  cleanup?: (tempPath: string) => void;
}

export interface AtomicWriteReport {
  target: string;
  tempPath: string;
  bytes: number;
}

/**
 * 原子写：临时名 → 同步落盘 → （可选）校验 → rename 覆盖。
 * **失败抛 `AtomicWriteError`**（不吞错）：调用方要么转成返回值，要么让它冒泡。
 */
export function writeFileAtomicSync(
  target: string,
  bytes: Uint8Array,
  opts: AtomicWriteOptions = {},
): AtomicWriteReport {
  const fsImpl = opts.fs ?? NODE_ATOMIC_FS;
  if (!(bytes instanceof Uint8Array)) {
    throw new AtomicWriteError('ATOMIC_BYTES_REQUIRED', '原子写要求 Uint8Array，实得 ' + typeof bytes);
  }
  if (bytes.length === 0) {
    // 0 字节 = 必然损坏的文件；写下去只会把一份好文件（若有）换成坏的
    throw new AtomicWriteError('ATOMIC_BYTES_REQUIRED', '拒绝原子写 0 字节：那会把好文件换成必然损坏的文件');
  }
  const dir = path.dirname(target);
  const base = path.basename(target);
  const prefix = opts.tempPrefix ?? '.' + base + '.tmp-';
  const seq = opts.seq ?? (tempSeq += 1);
  const temp = opts.tempPath ?? path.join(dir, prefix + String(process.pid) + '-' + String(seq));
  if (path.dirname(path.resolve(temp)) !== path.resolve(dir)) {
    // 跨目录临时名会让 rename 退化（甚至 EXDEV）⇒ 直接拒，不给「看起来原子」的机会
    throw new AtomicWriteError(
      'ATOMIC_TEMP_OUTSIDE_DIR',
      '临时文件必须与目标同目录（同卷 rename 才原子）：' + temp + ' vs ' + target,
      '', temp,
    );
  }

  /** 清理 + 留痕：给了 `cleanup` 就交给调用方（它自己会留痕），否则自己清、自己留痕 */
  const cleanupNote = (): string => {
    if (opts.cleanup) {
      opts.cleanup(temp);
      return '';
    }
    try {
      if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp);
      return '';
    } catch (e) {
      return '（临时文件清理失败：' + reasonOf(e) + '，请手工删除 ' + temp + '）';
    }
  };

  if (fsImpl.mkdirSync) {
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw new AtomicWriteError('ATOMIC_MKDIR_FAILED', '建目录失败：' + dir + '（' + reasonOf(e) + '）', reasonOf(e), temp);
    }
  }

  try {
    fsImpl.writeFileSyncedSync(temp, bytes);
  } catch (e) {
    throw new AtomicWriteError(
      'ATOMIC_WRITE_FAILED',
      '写临时文件失败：' + temp + '（' + reasonOf(e) + '）' + cleanupNote(),
      reasonOf(e), temp,
    );
  }

  if (opts.validate) {
    try {
      opts.validate(temp);
    } catch (e) {
      throw new AtomicWriteError(
        'ATOMIC_VALIDATE_FAILED',
        '落盘内容没通过校验 ⇒ **放弃覆盖原文件**（原文件原样保留）：' + reasonOf(e) + cleanupNote(),
        reasonOf(e), temp,
      );
    }
  }

  try {
    fsImpl.renameSync(temp, target);
  } catch (e) {
    throw new AtomicWriteError(
      'ATOMIC_RENAME_FAILED',
      'rename 覆盖失败：' + target + '（' + reasonOf(e) + '）' + cleanupNote(),
      reasonOf(e), temp,
    );
  }
  return { target, tempPath: temp, bytes: bytes.length };
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

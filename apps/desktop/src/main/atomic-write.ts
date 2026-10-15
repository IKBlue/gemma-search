// apps/desktop/src/main/atomic-write.ts —— **原子写文件**的单一实现（DF-4）
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
// ⚠️ 与 index-file.ts 的关系（P1，如实写清）：index-file.ts 里有一段**同概念**的实现
//   （临时名 → writeFileSyncedSync → 校验 → rename → 清理），它额外带着
//   ".gs- 命名空间断言 + IndexFileError 错误码 + 五道校验报告"这些**它自己的**关注点。
//   本次只把它用到的 **fsync 写入原语**收敛到本模块的 `writeFileSynced`（一行委托，行为不变）；
//   完整的编排合并（把它的 temp/rename/cleanup 也搬过来）需要动它的错误码与报告结构，
//   已在 DF-4 证据里记成"待办 + 迁移草图"，不在这张卡的射程内。

import fs from 'node:fs';
import path from 'node:path';

/** 本模块用到的最小 fs 能力（可注入 ⇒ 失败路径能被单测真跑，而不是靠想象） */
export interface AtomicFs {
  mkdirSync(p: string, options: { recursive: true }): void;
  /** 契约：**写完必须 fsync**（只有 rename 前的 fsync 才能让"名字对"等于"内容也在盘上"） */
  writeFileSyncedSync(p: string, data: Uint8Array): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
  existsSync(p: string): boolean;
}

/** 一次性把数据写到 fd 并 fsync —— 全仓唯一的"同步落盘写" */
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

/** 原子写失败的**唯一**错误类型；调用方各自映射成自己的错误码/返回值 */
export class AtomicWriteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AtomicWriteError';
    this.code = code;
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
   * 校验**临时文件**（不是内存里的 bytes —— 要验的是"真落盘的东西"）。
   * 返回 false 或抛 ⇒ 视为不通过：**放弃覆盖**，原文件保留。
   */
  validate?: (tempPath: string) => void;
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
  const temp = path.join(dir, prefix + String(process.pid) + '-' + String(seq));

  const cleanup = (): string => {
    try {
      if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp);
      return '';
    } catch (e) {
      return '（临时文件清理失败：' + (e instanceof Error ? e.message : String(e)) + '，请手工删除 ' + temp + '）';
    }
  };

  try {
    fsImpl.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new AtomicWriteError('ATOMIC_MKDIR_FAILED', '建目录失败：' + dir + '（' + reasonOf(e) + '）');
  }

  try {
    fsImpl.writeFileSyncedSync(temp, bytes);
  } catch (e) {
    throw new AtomicWriteError('ATOMIC_WRITE_FAILED', '写临时文件失败：' + temp + '（' + reasonOf(e) + '）' + cleanup());
  }

  if (opts.validate) {
    try {
      opts.validate(temp);
    } catch (e) {
      throw new AtomicWriteError(
        'ATOMIC_VALIDATE_FAILED',
        '落盘内容没通过校验 ⇒ **放弃覆盖原文件**（原文件原样保留）：' + reasonOf(e) + cleanup(),
      );
    }
  }

  try {
    fsImpl.renameSync(temp, target);
  } catch (e) {
    throw new AtomicWriteError('ATOMIC_RENAME_FAILED', 'rename 覆盖失败：' + target + '（' + reasonOf(e) + '）' + cleanup());
  }
  return { target, tempPath: temp, bytes: bytes.length };
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

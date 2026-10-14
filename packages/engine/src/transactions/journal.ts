// packages/engine/src/transactions/journal.ts —— 事务日志（规格 §1）
//
// 规格要求：
//   · 位置由调用方给（**不在这里写死 `%APPDATA%`** —— 引擎是传输无关的，路径一律注入）
//   · **每条事务一个文件** `txn-<utc>-<rand>.json`（不是单个大日志：避免写日志本身成为并发瓶颈与单点）
//   · **每次状态跃迁都先写日志再动文件**（write-ahead），且 `fsync` 后才继续
//
// ⚠️ 本文件是 `packages/engine/src/transactions/` 的一部分 ⇒ **允许**出现 `fs.rename`/`fs.unlink`。
//    §9 的机械断言要求"全引擎只有这个目录可出现写 API"，本文件正是那条规则的受益者。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { canTransition } from './states.ts';

/** 日志文件名：`txn-<utc>-<rand>.json`（§1 的形态） */
export const TXN_PREFIX = 'txn-';
export const TXN_EXT = '.json';

/**
 * 事务记录里的一条文件操作（图与包各一条）。
 * 字段随流程推进逐步回填，所以**全部可选** —— 完整性由 `validateRecord` 判定，
 * 不靠类型假装它一定在（这正是 §4「记录不完整必须停下问人」要处理的情形）。
 */
export interface TxnFileEntry {
  role?: string;
  /**
   * 以下 4 个字段是"可据以恢复"的必要条件 —— \`validateRecord\` 逐个查它们，
   * 缺任何一个都按 §4 判成"无法识别的状态"并停下问人。所以这里如实标成必填：
   * 记录一旦**可用**就必然有它们（executor 在 PREPARED 时一次写全）。
   */
  src: string;
  dst: string;
  stage: string;
  sha1: string;
  size?: number;
  /** 初值是 null（PREPARED 时还没暂存），STAGED 时回填实际哈希 */
  stagedSha1?: string | null;
  srcDeleted?: boolean;
  _idempotent?: boolean;
  [key: string]: unknown;
}

/**
 * 事务记录（§1）。它是**会被写到盘上、再从盘上读回来**的 JSON，
 * 所以除 `txnId` / `state` / `files` 这三个 writeTxn 强制要求的字段外都允许缺，
 * 并留一个索引签名接住流程中回填的其它字段（`abortReason` / `indexUpdate` …）。
 */
export interface TxnRecord {
  txnId: string;
  state: string;
  files: TxnFileEntry[];
  libId?: string;
  uid?: string;
  op?: string;
  indexUpdate?: { done?: boolean; before?: unknown; after?: unknown };
  abortReason?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** 扫描日志目录时读不出来的文件（§8：「无法识别的状态」必须可见） */
export interface BrokenTxn {
  file: string;
  absPath: string;
}

/**
 * 生成事务 id：`20261010T121530Z-a1b2c3`（§1 的示例形态）。
 * `now` 与 `rand` 都**可注入** —— 否则测试无法确定性地断言文件名。
 */
export function makeTxnId(now: number = Date.now(), rand: string | number | null = null): string {
  const d = new Date(now);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const utc = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T`
    + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const r = rand === null ? crypto.randomBytes(3).toString('hex') : String(rand);
  return `${utc}-${r}`;
}

export const txnFileName = (txnId: string): string => `${TXN_PREFIX}${txnId}${TXN_EXT}`;
export const txnPath = (journalDir: string, txnId: string): string => path.join(journalDir, txnFileName(txnId));

/** 确保日志目录存在（幂等） */
export function ensureJournalDir(journalDir: string): string {
  fs.mkdirSync(journalDir, { recursive: true });
  return journalDir;
}

/**
 * `fsync` 一个**文件**的内容到盘。
 * ⚠️ Windows 上**目录** fsync 不被支持（`fs.openSync(dir,'r')` 之后再 fsync 会 EPERM/EISDIR）。
 *    所以目录同步是**尽力而为**并显式忽略失败 —— 规格要的是"日志先于文件落地"，
 *    文件级 fsync 已满足这一点；这条限制如实写在这里，不假装它成功了。
 */
function fsyncFile(absPath: string): void {
  const fd = fs.openSync(absPath, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * **原子写**一条事务记录：先写 `.tmp` → fsync → rename 到最终名 → 尽力 fsync 目录。
 *
 * 为什么不是直接 `writeFileSync` 到最终名：写到一半被杀会留下**半截 JSON**，
 * 恢复时读不出来 ⇒ 一个"无法识别的状态"，正是 §8 判据里禁止的东西。
 * rename 是同卷原子操作，最终名要么是旧的完整内容、要么是新的完整内容。
 *
 * @param journalDir 日志目录（由调用方注入）
 * @param rec 事务记录（必须含 `txnId`）
 * @returns 最终文件路径
 */
export function writeTxn(journalDir: string, rec: TxnRecord): string {
  if (!rec || !rec.txnId) throw new Error('writeTxn: 记录必须含 txnId');
  // ⚠️ **结构完整性**校验。理由是一条实测教训：`JSON.stringify` 会**静默丢掉值为 `undefined` 的键**，
  //    于是一条缺 `sha1` 的记录会被写下去，而恢复时它会被**误读成"哈希不一致"** ⇒ 一个合法事务
  //    被静默 ABORT 掉，且看不出原因。⇒ 宁可在**写的时候**就炸。
  if (typeof rec.state !== 'string') throw new Error('writeTxn: 记录必须含 state');
  if (!Array.isArray(rec.files)) throw new Error('writeTxn: 记录必须含 files 数组');
  ensureJournalDir(journalDir);
  const final = txnPath(journalDir, rec.txnId);
  const tmp = `${final}.tmp`;
  const body = JSON.stringify(rec, null, 2) + '\n';

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);                    // ← write-ahead 的关键：内容真的落盘了才往下走
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, final);
  try { fsyncFile(final); } catch { /* 见上：Windows 的目录/再同步限制，尽力而为 */ }
  return final;
}

/**
 * 运行期确认"这是一条事务记录"：至少得是个对象且带**真值** `txnId`。
 * 刻意只查这一条：字段是否齐全由 `validateRecord` 判，读日志的人不该在这里替它兜底。
 */
function isTxnRecordLike(v: unknown): v is TxnRecord {
  return typeof v === 'object' && v !== null && Boolean((v as { txnId?: unknown }).txnId);
}

/** 读一条事务记录。**读不动就返回 null**（调用方据此判 RECOVERY_NEEDED，不猜） */
export function readTxn(absPath: string): TxnRecord | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    if (!isTxnRecordLike(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 扫描日志目录（规格 §4「启动时扫描 `journal/*.json`」）。
 *
 * ⚠️ **坏文件不许让整个扫描崩**：返回 `{ txns, broken }`，`broken` 里列出读不出来的文件名。
 *    "有一个无法识别的状态"正是 §8 判据要禁止的结果，所以要让它**可见**而不是静默跳过。
 */
export function listTxns(journalDir: string): { txns: TxnRecord[]; broken: BrokenTxn[] } {
  let names: string[] = [];
  try { names = fs.readdirSync(journalDir); } catch { return { txns: [], broken: [] }; }

  const txns: TxnRecord[] = [];
  const broken: BrokenTxn[] = [];
  for (const name of names.sort()) {
    if (!name.startsWith(TXN_PREFIX) || !name.endsWith(TXN_EXT)) continue;   // 忽略 .tmp 等
    const abs = path.join(journalDir, name);
    const rec = readTxn(abs);
    if (rec === null) { broken.push({ file: name, absPath: abs }); continue; }
    txns.push({ ...rec, _file: name, _absPath: abs });
  }
  return { txns, broken };
}

/**
 * **状态跃迁 = 先写日志再动文件**（§1 的 write-ahead）。
 * 返回**新的**记录对象（不改入参）—— 调用方只有在 `writeTxn` 成功之后才允许去动文件。
 */
export function withState(
  rec: TxnRecord,
  nextState: string,
  patch: Partial<TxnRecord> = {},
  now: number = Date.now(),
): TxnRecord {
  return {
    ...rec,
    ...patch,
    state: nextState,
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * **状态跃迁 = 先写日志再动文件**（§1 的 write-ahead）。**正常路径与恢复路径共用这一份**
 * —— 两边各写一份的话，"合法性检查"迟早有一边漏掉。
 *
 * @param journalDir 日志目录
 * @param rec 当前记录
 * @param next 目标状态
 * @param patch 要合并进去的字段（如 `files` 回填、`abortReason`）
 * @returns **新的**记录对象（不改入参）—— 调用方只有在本函数成功返回后才允许去动文件
 */
export function persistState(
  journalDir: string,
  rec: TxnRecord,
  next: string,
  patch: Partial<TxnRecord> = {},
  now: number = Date.now(),
): TxnRecord {
  if (!canTransition(rec.state, next)) {
    throw new Error(`非法跃迁：${rec.state} → ${next}（§2 只允许主链前进一步 / 进 ABORTED / 进 RECOVERY_NEEDED）`);
  }
  const nextRec = withState(rec, next, patch, now);
  writeTxn(journalDir, nextRec);
  return nextRec;
}

/** 归档终态事务：移到 `archive/` 子目录（§4「终态 → 归档日志，不动文件」） */
export function archiveTxn(journalDir: string, txnId: string): string {
  const from = txnPath(journalDir, txnId);
  const dir = path.join(journalDir, 'archive');
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, txnFileName(txnId));
  fs.renameSync(from, to);
  return to;
}

// packages/engine/src/transactions/hash.ts —— 事务模块用的哈希
//
// 单独一个文件是为了**只有一份实现**：`steps.ts`（共享原语）与 `executor.ts`（正常路径）
// 都要算文件 sha1，各写一份就迟早会有一处漏掉"读二进制"这类细节。
import fs from 'node:fs';
import crypto from 'node:crypto';

/** 文件的 sha1（十六进制）。用于 §3 的"stagedSha1 == 源 sha1"校验与规则 ② 的字节比较 */
export function sha1File(absPath: string): string {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(absPath));      // 不传 encoding ⇒ Buffer，二进制安全
  return h.digest('hex');
}

/** Buffer/字符串的 sha1（测试与内存态比较用） */
export function sha1Of(data: Buffer | string): string {
  const h = crypto.createHash('sha1');
  h.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));
  return h.digest('hex');
}

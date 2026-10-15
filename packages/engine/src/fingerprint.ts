// core/fingerprint.ts —— 库指纹 v1（SPEC-identity §5）
//
//   fingerprint_v1 = sha1( "v1\n" + join("\n", sorted(rel\tsize\tmtime_ms\text)) )
//
// 为什么必须与 Python 侧逐字节一致：指纹是"库有没有被动过"的唯一判据，
// 而它跨两个运行时（P1 引擎 JS / 门禁工具 Python）。两边算不出同一个值，
// 就等于没有指纹。tests 里用一个**已被记录的基线值**做交叉验证。
//
// 指纹不是备份：它能检测"变了"，不能恢复"被删了"。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ⚠️ 「什么算素材」的判据**只有一份**：engine/src/gs-names.ts 的 isMaterialEntryName。
//    它排除保留命名空间（`.gs-*` / `.gs.db`(+边车) / staging）**与隐藏项**（SPEC §1）——
//    与扫描器、main/library-rebuild 的 materialDigest 同一口径（DF-3；此前本文件只跳保留名，
//    于是一个 `.DS_Store` 就能让"库指纹"变，而扫描 diff 什么都不显示）。
//    另：`.gs.db` 的第 4 个字符是 `.` 不是 `-` ⇒ 自己写 `.gs-` 前缀判断还会漏（U11）。
import { isMaterialEntryName } from './gs-names.ts';

export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
export const ARCHIVE_EXT = new Set(['.rar', '.zip', '.7z']);

/** 按扩展名分类的计数（指纹结果的一部分，供体检面板显示） */
export interface FingerprintCounts {
  files: number;
  images: number;
  archives: number;
  other: number;
}

/** fingerprintLines() 的返回：规范化行 + 统计 */
export interface FingerprintLines {
  lines: string[];
  counts: FingerprintCounts;
  totalBytes: number;
}

/** fingerprintV1() 的返回 */
export interface FingerprintResult {
  fingerprint: string;
  counts: FingerprintCounts;
  totalBytes: number;
  computedAt: string;
}

/**
 * 遍历库内所有文件（图与包），返回规范化的行数组。
 * 只做 stat，不读内容 —— 所以很快（7188 文件约 30–60 ms）。
 *
 * ⚠️ `mtime_ms` 的定义必须**逐位钉死**，否则 JS 与 Python 会算出不同指纹
 *    （= 等于没有指纹）。实测过的不一致：
 *      同一文件 mtimeNs = 1761119146225999900
 *        Node `st.mtimeMs`        → 1761119146226   （**四舍五入**）
 *        Python `ns // 1_000_000` → 1761119146225   （**截断**）
 *      已记录的基线 `3c62f15c…` 对应的是**截断**。
 *    所以这里显式用 BigInt 纳秒截断，**不用 `mtimeMs`**（它自带未文档化的舍入）。
 *    定义：mtime_ms = floor(mtime_ns / 1e6)
 */
export function fingerprintLines(root: string): FingerprintLines {
  const lines: string[] = [];
  const counts: FingerprintCounts = { files: 0, images: 0, archives: 0, other: 0 };
  let totalBytes = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // ⚠️ 保留命名空间**不是素材**（U11 类问题的第三次复发就在这儿）：`.gs-index.bin` / `.gs.db`(+边车) /
      //    `.gs-journal` / `.gs-staging` 都是**我们自己的派生数据**。用 gs-names.ts 的唯一判据，不另写一份
      //    （P1）。必须放在 `isDirectory()` **之前** —— `.gs-journal` / `.gs-staging` 是目录，漏判会走进去。
      //    不改的后果（实测）：索引一重建，`doScan()` 的库指纹就跟着变 ⇒ 被算成「库被改过」；
      //    而同一件事在 main/library-rebuild.ts 的 materialDigest 里有跳过 ⇒ 两套口径。
      if (!isMaterialEntryName(e.name)) continue; // 保留命名空间 + 隐藏项都**不是素材**（唯一判据）
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile()) continue; // 跳过符号链接等（不跟随）
      const ext = path.extname(e.name).toLowerCase();
      // bigint: true 才能拿到精确的 mtimeNs（用 mtimeMs 会带入舍入，与 Python 对不上）
      const st = fs.statSync(full, { bigint: true });
      const rel = path.relative(root, full);
      const mtimeMs = st.mtimeNs / 1_000_000n; // BigInt 除法 = 截断
      lines.push(`${rel}\t${st.size}\t${mtimeMs}\t${ext}`);
      counts.files++;
      totalBytes += Number(st.size);
      if (IMG_EXT.has(ext)) counts.images++;
      else if (ARCHIVE_EXT.has(ext)) counts.archives++;
      else counts.other++;
    }
  };
  walk(root);

  lines.sort(); // 按行（= rel_path 前缀）字节序升序
  return { lines, counts, totalBytes };
}

/**
 * 算 v1 指纹。
 */
export function fingerprintV1(root: string): FingerprintResult {
  if (!fs.existsSync(root)) {
    // ⚠️ 这里**故意抛普通 Error + code**，不是 EngineError：调用方按 `e.code` 判定，
    //    而 security.test 用 `e instanceof EngineError` 分流 —— 换成 EngineError 会改变那个结果。
    const e: Error & { code?: string } = new Error(`素材库目录不存在：${root}`);
    e.code = 'LIB_ROOT_MISSING';
    throw e;
  }
  const { lines, counts, totalBytes } = fingerprintLines(root);
  const h = crypto.createHash('sha1');
  h.update('v1\n', 'utf8');
  for (const ln of lines) {
    h.update(ln, 'utf8');
    h.update('\n', 'utf8');
  }
  return {
    fingerprint: h.digest('hex'),
    counts,
    totalBytes,
    computedAt: new Date().toISOString(),
  };
}

/** deepHashImages() 的进度回调（每 200 张一次） */
export interface DeepHashOptions {
  onProgress?: (n: number) => void;
}

/**
 * 深度校验（另一档）：对**预览图**逐个算 sha1。**不含压缩包**（206 GB）。
 * 供"库健康面板"按需触发。
 */
export function deepHashImages(
  root: string,
  { onProgress }: DeepHashOptions = {},
): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!IMG_EXT.has(ext)) continue;
      const rel = path.relative(root, full);
      out.set(rel, crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'));
      n++;
      if (onProgress && n % 200 === 0) onProgress(n);
    }
  };
  walk(root);
  return out;
}

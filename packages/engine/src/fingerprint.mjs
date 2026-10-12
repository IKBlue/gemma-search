// core/fingerprint.mjs —— 库指纹 v1（SPEC-identity §5）
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

export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
export const ARCHIVE_EXT = new Set(['.rar', '.zip', '.7z']);

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
export function fingerprintLines(root) {
  const lines = [];
  const counts = { files: 0, images: 0, archives: 0, other: 0 };
  let totalBytes = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;                       // 跳过符号链接等（不跟随）
      const ext = path.extname(e.name).toLowerCase();
      // bigint: true 才能拿到精确的 mtimeNs（用 mtimeMs 会带入舍入，与 Python 对不上）
      const st = fs.statSync(full, { bigint: true });
      const rel = path.relative(root, full);
      const mtimeMs = st.mtimeNs / 1_000_000n;         // BigInt 除法 = 截断
      lines.push(`${rel}\t${st.size}\t${mtimeMs}\t${ext}`);
      counts.files++;
      totalBytes += Number(st.size);
      if (IMG_EXT.has(ext)) counts.images++;
      else if (ARCHIVE_EXT.has(ext)) counts.archives++;
      else counts.other++;
    }
  };
  walk(root);

  lines.sort();                                        // 按行（= rel_path 前缀）字节序升序
  return { lines, counts, totalBytes };
}

/**
 * 算 v1 指纹。
 * @returns {{ fingerprint:string, counts:object, totalBytes:number, computedAt:string }}
 */
export function fingerprintV1(root) {
  if (!fs.existsSync(root)) {
    const e = new Error(`素材库目录不存在：${root}`);
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

/**
 * 深度校验（另一档）：对**预览图**逐个算 sha1。**不含压缩包**（206 GB）。
 * 供"库健康面板"按需触发。
 */
export function deepHashImages(root, { onProgress } = {}) {
  const out = new Map();
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
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

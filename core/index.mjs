// core/index.mjs —— index.bin 的读取与强校验（docs/spec/CONTRACT-engine-v1.md §0；SPEC-identity §7）
//
// 布局：
//   [0,8)          MAGIC = 47 53 49 44 58 00 00 01
//   [8,12)         u32 LE headerLen
//   [12,12+hlen)   headerJSON（utf8）
//   之后            float32 块（count × dim，行主序）
//   末尾            u32 LE footerLen + footerJSON { count, dim, sha1_of_vector_block, complete }
//
// **任何校验不过都抛 INDEX_CORRUPT，绝不返回半可信数据**：
// 索引静默损坏是本项目最危险的失败模式（旧实现就因 MAGIC 长度 7 vs 8 而静默失效过）。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ERR, fail } from './errors.mjs';

export const MAGIC = Buffer.from('4753494458000001', 'hex'); // "GSIDX" + 0x00 0x00 0x01
if (MAGIC.length !== 8) throw new Error('MAGIC 必须是 8 字节');
export const LEN_OFF = MAGIC.length;        // 8
export const HEAD_OFF = MAGIC.length + 4;   // 12

const corrupt = (why, details = {}) => fail(ERR.INDEX_CORRUPT, why, details);

/**
 * 读回并校验索引。
 * @returns {{ header: object, vectors: Float32Array, count: number, dim: number }}
 * @throws EngineError(INDEX_MISSING | INDEX_CORRUPT)
 */
export function readIndexBin(file) {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `索引不存在：${file}`, { file });
  const buf = fs.readFileSync(file);

  if (buf.length < HEAD_OFF) throw corrupt(`文件太短：${buf.length} 字节`, { file, bytes: buf.length });
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw corrupt(`MAGIC 不符：实际 ${buf.subarray(0, 8).toString('hex')}，期望 ${MAGIC.toString('hex')}`,
      { file, actual: buf.subarray(0, 8).toString('hex') });
  }

  const headerLen = buf.readUInt32LE(LEN_OFF);
  if (HEAD_OFF + headerLen > buf.length) throw corrupt(`headerLen 超出文件：${headerLen}`, { file, headerLen });

  let header;
  try {
    header = JSON.parse(buf.subarray(HEAD_OFF, HEAD_OFF + headerLen).toString('utf8'));
  } catch (e) {
    throw corrupt(`headerJSON 解析失败：${e.message}`, { file });
  }

  const count = Number(header.count) || 0;
  const dim = Number(header.dim) || 0;
  if (count <= 0 || dim <= 0) throw corrupt(`header.count/dim 无效：${count}/${dim}`, { file, count, dim });

  const start = HEAD_OFF + headerLen;
  const blockBytes = count * dim * 4;
  if (start + blockBytes + 4 > buf.length) {
    throw corrupt(`向量块超出文件：需要 ${blockBytes} 字节，实际剩 ${buf.length - start}`,
      { file, count, dim, need: blockBytes, have: buf.length - start });
  }
  const body = buf.subarray(start, start + blockBytes);

  // footer：没有"写完了"标记就当写入未完成
  const footLen = buf.readUInt32LE(start + blockBytes);
  let foot;
  try {
    foot = JSON.parse(buf.subarray(start + blockBytes + 4, start + blockBytes + 4 + footLen).toString('utf8'));
  } catch (e) {
    throw corrupt(`footer 解析失败：${e.message}`, { file });
  }
  if (foot.complete !== true) throw corrupt('footer.complete 不是 true → 视为写入未完成', { file, foot });
  if (foot.count !== count || foot.dim !== dim) {
    throw corrupt(`footer 与 header 不一致：${foot.count}/${foot.dim} vs ${count}/${dim}`, { file });
  }
  const sha = crypto.createHash('sha1').update(body).digest('hex');
  if (foot.sha1_of_vector_block !== sha) {
    throw corrupt(`向量块 sha1 不符：footer=${foot.sha1_of_vector_block} 实际=${sha}`,
      { file, expected: foot.sha1_of_vector_block, actual: sha });
  }

  // Float32Array 需要 4 字节对齐的 offset；用拷贝保证对齐且避免与 Buffer 共享生命周期
  const ab = new ArrayBuffer(blockBytes);
  Buffer.from(ab).set(body);
  return { header, vectors: new Float32Array(ab), count, dim };
}

/** 读 items.json（条目表）。格式见 SPEC-identity §5。 */
export function readItems(file) {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `条目表不存在：${file}`, { file });
  const raw = fs.readFileSync(file, 'utf8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    throw corrupt(`items.json 解析失败：${e.message}`, { file });
  }
  if (!Array.isArray(items) || items.length === 0) throw corrupt('items.json 不是非空数组', { file });
  return items;
}

/** 读 meta.json（header + 运行时信息）。 */
export function readMeta(file) {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `元数据不存在：${file}`, { file });
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw corrupt(`meta.json 解析失败：${e.message}`, { file });
  }
}

/** 库内相对路径：兼容新格式 `relPath` 与旧 Python 档的 `rel_path`（格式换代，需显式桥接）。 */
export function relOf(item) {
  return (item && (item.relPath || item.rel_path)) || null;
}

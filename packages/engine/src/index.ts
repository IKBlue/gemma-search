// core/index.ts —— index.bin 的读取与强校验（SPEC.md §2.2 `.gs-index.bin` 格式）
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
import { ERR, fail, messageOf } from './errors.ts';
import type { ErrorDetails } from './errors.ts';

export const MAGIC = Buffer.from('4753494458000001', 'hex'); // "GSIDX" + 0x00 0x00 0x01
if (MAGIC.length !== 8) throw new Error('MAGIC 必须是 8 字节');
export const LEN_OFF = MAGIC.length; // 8
export const HEAD_OFF = MAGIC.length + 4; // 12

/**
 * 索引 header / meta.json。**外部 JSON**：除了 count/dim（下面显式取出来校验），
 * 其余字段原样交给调用方 —— 读函数不假装知道它们各自的类型。
 */
export type IndexHeader = Record<string, unknown>;

/**
 * items.json 里的一行（SPEC-identity §5）。
 *
 * 字段**全部可选**：这是外部 JSON，缺字段是"数据不完整"，该由调用方按契约判定并报错，
 * 不该由读函数替它兜底。这里把实际用到过的字段列出来，是为了让访问它们的地方有类型；
 * 没列出的字段仍然可以读（索引签名 = unknown），**不会丢字段**。
 */
export interface IndexItem {
  uid?: string;
  relPath?: string;
  rel_path?: string;
  folder?: string;
  stem?: string;
  imageExt?: string;
  imageSize?: number;
  imageMtime?: number;
  vectorRow?: number;
  vectorSource?: string;
  // ⚠️ 这四个**允许 null**：fixtures 与真实 items.json 里"无同名包"就是写 null（不是缺字段）——
  //    收紧成 string 会把合法数据判成类型错误，也会逼调用方到处断言。
  archiveRelPath?: string | null;
  archiveExt?: string | null;
  archiveSize?: number | null;
  archiveMtime?: number | null;
  [key: string]: unknown;
}

/** readIndexBin() 的返回：header + 已对齐的向量块 */
export interface IndexBin {
  header: IndexHeader;
  vectors: Float32Array;
  count: number;
  dim: number;
}

/**
 * 引擎缓存里的一条索引条目。
 * **真实模式**从盘上读回来（\`readIndexBin\` + \`readItems\` + \`readMeta\`）；
 * **模拟模式**由 \`fake.ts\` 从样例索引造 —— 两边共用这一份声明，形状就不会各说各话。
 *
 * \`vectors\` 刻意是 unknown：真实是 \`Float32Array\`，模拟是占位数组（\`{row}\`）。
 * 打分路径会显式 \`instanceof Float32Array\` 校验后再用（见 engine.ts）。
 */
export interface EngineEntry {
  libId: string;
  dir: string;
  header: IndexHeader;
  vectors: unknown;
  count: number;
  dim: number;
  items: IndexItem[];
  meta: IndexHeader;
  byUid: Map<string, IndexItem>;
  rowToRel: Map<number, unknown>;
}

const corrupt = (why: string, details: ErrorDetails = {}): Error =>
  fail(ERR.INDEX_CORRUPT, why, details);

/**
 * 读回并校验索引。
 * @throws EngineError(INDEX_MISSING | INDEX_CORRUPT)
 */
export function readIndexBin(file: string): IndexBin {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `索引不存在：${file}`, { file });
  const buf = fs.readFileSync(file);

  if (buf.length < HEAD_OFF)
    throw corrupt(`文件太短：${buf.length} 字节`, { file, bytes: buf.length });
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw corrupt(
      `MAGIC 不符：实际 ${buf.subarray(0, 8).toString('hex')}，期望 ${MAGIC.toString('hex')}`,
      { file, actual: buf.subarray(0, 8).toString('hex') },
    );
  }

  const headerLen = buf.readUInt32LE(LEN_OFF);
  if (HEAD_OFF + headerLen > buf.length)
    throw corrupt(`headerLen 超出文件：${headerLen}`, { file, headerLen });

  let header: IndexHeader;
  try {
    header = JSON.parse(buf.subarray(HEAD_OFF, HEAD_OFF + headerLen).toString('utf8'));
  } catch (e) {
    throw corrupt(`headerJSON 解析失败：${messageOf(e)}`, { file });
  }

  const count = Number(header.count) || 0;
  const dim = Number(header.dim) || 0;
  if (count <= 0 || dim <= 0)
    throw corrupt(`header.count/dim 无效：${count}/${dim}`, { file, count, dim });

  const start = HEAD_OFF + headerLen;
  const blockBytes = count * dim * 4;
  if (start + blockBytes + 4 > buf.length) {
    throw corrupt(`向量块超出文件：需要 ${blockBytes} 字节，实际剩 ${buf.length - start}`, {
      file,
      count,
      dim,
      need: blockBytes,
      have: buf.length - start,
    });
  }
  const body = buf.subarray(start, start + blockBytes);

  // footer：没有"写完了"标记就当写入未完成
  const footLen = buf.readUInt32LE(start + blockBytes);
  // ⚠️ DF-7 D1：先**显式校验长度**再解析。原实现直接 subarray（会自动截到 EOF）⇒
  //    一个 4GB 的 footLen 会走到 JSON.parse 才炸，报「footer 解析失败」——把「长度非法」说成「解析失败」，
  //    排障时误导。上界是**格式不变量**（footer 是我们自己写的小段元数据 JSON，实测 ~200 字节），
  //    取 1 MiB（≈5000×）既挡住荒谬值、又不会误伤将来加字段。
  const FOOT_LEN_MAX = 1 << 20;
  const footAt = start + blockBytes + 4;
  const footHave = buf.length - footAt;
  if (footLen === 0 || footLen > FOOT_LEN_MAX || footLen > footHave) {
    throw corrupt(
      `footer 长度非法：footLen=${footLen}（上限 ${FOOT_LEN_MAX}，文件剩 ${footHave} 字节）`,
      { file, footLen, limit: FOOT_LEN_MAX, have: footHave },
    );
  }
  let foot: Record<string, unknown>;
  try {
    foot = JSON.parse(buf.subarray(footAt, footAt + footLen).toString('utf8'));
  } catch (e) {
    throw corrupt(`footer 解析失败：${messageOf(e)}`, { file });
  }
  if (foot.complete !== true)
    throw corrupt('footer.complete 不是 true → 视为写入未完成', { file, foot });
  if (foot.count !== count || foot.dim !== dim) {
    throw corrupt(
      `footer 与 header 不一致：${String(foot.count)}/${String(foot.dim)} vs ${count}/${dim}`,
      { file },
    );
  }
  const sha = crypto.createHash('sha1').update(body).digest('hex');
  if (foot.sha1_of_vector_block !== sha) {
    throw corrupt(`向量块 sha1 不符：footer=${String(foot.sha1_of_vector_block)} 实际=${sha}`, {
      file,
      expected: foot.sha1_of_vector_block,
      actual: sha,
    });
  }

  // Float32Array 需要 4 字节对齐的 offset；用拷贝保证对齐且避免与 Buffer 共享生命周期
  const ab = new ArrayBuffer(blockBytes);
  Buffer.from(ab).set(body);
  return { header, vectors: new Float32Array(ab), count, dim };
}

/**
 * 运行期确认"这是一行条目"：条目表的每一行都必须是对象
 * （数组 / 字符串 / 数字都不是合法条目 —— SPEC-identity §5）。
 * 全字段可选 ⇒ 对象天然满足 IndexItem，这个谓词是诚实的、不是把断言伪装成检查。
 */
function isIndexItem(v: unknown): v is IndexItem {
  return typeof v === 'object' && v !== null;
}

/** 读 items.json（条目表）。格式见 SPEC-identity §5。 */
export function readItems(file: string): IndexItem[] {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `条目表不存在：${file}`, { file });
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw corrupt(`items.json 解析失败：${messageOf(e)}`, { file });
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw corrupt('items.json 不是非空数组', { file });
  // 原样返回条目对象（**不重建**：条目表是外部 JSON，重建=丢字段=静默改变检索结果）。
  // 非对象行不是合法条目，直接丢掉（原 JS 会把它塞进数组，下游一读字段就崩）。
  return (parsed as unknown[]).filter(isIndexItem);
}

/** 读 meta.json（header + 运行时信息）。 */
export function readMeta(file: string): IndexHeader {
  if (!fs.existsSync(file)) throw fail(ERR.INDEX_MISSING, `元数据不存在：${file}`, { file });
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw corrupt(`meta.json 解析失败：${messageOf(e)}`, { file });
  }
}

/** 库内相对路径：兼容新格式 `relPath` 与旧 Python 档的 `rel_path`（格式换代，需显式桥接）。 */
export function relOf(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const rec = item as { relPath?: unknown; rel_path?: unknown };
  const v = rec.relPath || rec.rel_path; // ⚠️ 用 ||（空串要落到 rel_path），不是 ??
  return typeof v === 'string' ? v : null;
}

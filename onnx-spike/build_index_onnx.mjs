// build_index_onnx.mjs —— 用 ONNX/WebGPU 构建索引（新格式 index.bin，含稳定 UID）
//
// 用法:
//   node build_index_onnx.mjs --model <目录> --lib G:\model --out <目录>
//        [--seq 140] [--device webgpu] [--limit N] [--save-every 200] [--rebuild]
//
// 设计要点（对齐 DESIGN-app-details.md）：
//   · 配对：**同目录 + 同名主干**（不跨目录），图 .jpg/.jpeg/.png，包 .zip/.rar
//   · UID：sha1(图像字节) 前 12 位 —— **不依赖路径**，改名/改目录后仍稳定；
//          首次登记后持久化，之后不再重算
//   · 格式：index.bin = MAGIC + u32 headerLen + headerJSON + float32 块（count × dim）
//   · 可续跑：参数一致时复用已有向量，只编码缺的
//   · 原子落盘：写 .tmp → rename；每 N 条落一次盘
//   · 单张失败不停整个构建（记录到 meta.failed）

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { readImageWithFallback, selfTestBmpLayout, isBmp } from './bmp_decode.mjs';

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes('--' + name);

const MODEL_DIR = arg('model');
const LIB_ROOT = arg('lib');
const OUT_DIR = arg('out');
const SEQ = parseInt(arg('seq', '140'), 10);
const DEVICE = arg('device', 'webgpu');
const LIMIT = parseInt(arg('limit', '0'), 10);
const SAVE_EVERY = parseInt(arg('save-every', '200'), 10);
const REBUILD = has('rebuild');
const LIB_ID = arg('lib-id', 'default');

if (!MODEL_DIR || !LIB_ROOT || !OUT_DIR) {
  console.error('用法: node build_index_onnx.mjs --model <目录> --lib <库根> --out <目录> [--seq 140] [--device webgpu] [--limit N]');
  process.exit(2);
}

const log = (...a) => { console.log(`[build]`, ...a); };
const now = () => Number(process.hrtime.bigint()) / 1e6;

// 只从本地读模型：allowLocalModels + 关掉远程，否则它会把本地路径当成 HF 仓库 ID 去联网找文件
env.allowLocalModels = true;
env.allowRemoteModels = false;
const INDEX_BIN = path.join(OUT_DIR, 'index.bin');
const ITEMS_JSON = path.join(OUT_DIR, 'items.json');
const META_JSON = path.join(OUT_DIR, 'meta.json');
// ⚠️ MAGIC 必须**恰好 8 字节**，且读写两端的偏移一律从 MAGIC.length 推导。
// 踩过的坑：曾写成 Buffer.from('GSIDX\x00\x01','latin1') —— 那是 **7** 字节，
// 而读端用 subarray(0,8) 比较 + 按 8/12 取偏移，于是
//   · 比较永远 false → readIndexBin 永远返回 null → **续跑静默失效**
//   · 即使比较过了，读端偏移(8/12)与写端(7/11)也不一致
// 现在：MAGIC 用显式 hex 定义并在启动时断言长度；读写偏移都写成 MAGIC.length 的表达式。
const MAGIC = Buffer.from('4753494458000001', 'hex');   // 字面量 "GSIDX" + 0x00 0x00 0x01
if (MAGIC.length !== 8) throw new Error('MAGIC 必须是 8 字节，实际 ' + MAGIC.length);
const LEN_OFF = MAGIC.length;                 // u32 headerLen 的位置
const HEAD_OFF = MAGIC.length + 4;            // headerJSON 的起始位置
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png']);
// 三种压缩包都要认：实测库中 .rar 2329 · .zip 1189 · .7z 76（共 3594）
// ⚠ 最初只写了 .zip/.rar，导致 76 条 .7z 被误判为"图无包"——旧实现是对的
const ARC_EXT = new Set(['.rar', '.zip', '.7z']);

// ---------------- 扫描：同目录同名主干配对 ----------------
function scanLibrary(root) {
  const items = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { log('  跳过不可读目录', dir, e.code); continue; }

    const byStem = new Map();
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      const ext = path.extname(ent.name).toLowerCase();
      if (!IMG_EXT.has(ext) && !ARC_EXT.has(ext)) continue;
      const stem = ent.name.slice(0, ent.name.length - ext.length);
      if (!byStem.has(stem)) byStem.set(stem, {});
      const slot = byStem.get(stem);
      if (IMG_EXT.has(ext) && !slot.img) slot.img = { name: ent.name, ext, full };
      else if (ARC_EXT.has(ext) && !slot.arc) slot.arc = { name: ent.name, ext, full };
    }
    const relDir = path.relative(root, dir);
    const folder = relDir === '' ? '' : relDir.split(path.sep)[0];
    for (const [stem, slot] of byStem) {
      if (!slot.img) continue;                       // 只有包、没有图 → 无法编码（健康面板会列）
      const st = fs.statSync(slot.img.full);
      const ast = slot.arc ? fs.statSync(slot.arc.full) : null;
      items.push({
        folder, stem,
        name: slot.img.name, relPath: path.relative(root, slot.img.full),
        absPath: slot.img.full, imageExt: slot.img.ext,
        imageSize: st.size, imageMtime: Math.floor(st.mtimeMs),
        archiveName: slot.arc ? slot.arc.name : null,
        archiveRelPath: slot.arc ? path.relative(root, slot.arc.full) : null,
        archiveAbsPath: slot.arc ? slot.arc.full : null,
        archiveExt: slot.arc ? slot.arc.ext : null,
        archiveSize: ast ? ast.size : null,
        archiveMtime: ast ? Math.floor(ast.mtimeMs) : null,
      });
    }
  }
  items.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return items;
}

// ---------------- index.bin 读写 ----------------
//
// 布局（与 SPEC-identity.md §7 对齐；偏移全部由 MAGIC.length 推导，不再硬编码 8/12）：
//   [0, MAGIC.length)          MAGIC（8 字节）
//   [LEN_OFF, +4)              u32 LE headerLen
//   [HEAD_OFF, +headerLen)     headerJSON（utf8）
//   紧跟其后                    float32 块（count × dim，行主序）
//   末尾                        footer: u32 LE footerLen + footerJSON
//                              { count, dim, sha1_of_vector_block, complete:true }
//
// footer 的作用：把"写完了"变成**可判定的事实**。没有它，断电留下的半个文件
// 与完整文件在读取时无法区分 —— 而索引静默损坏是本项目最危险的失败模式。

function buildFooter(count, dim, body) {
  const json = Buffer.from(JSON.stringify({
    count, dim,
    sha1_of_vector_block: crypto.createHash('sha1').update(body).digest('hex'),
    complete: true,
  }), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

function writeIndexBin(file, header, vectors, count, dim) {
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerJson.length, 0);
  const body = Buffer.alloc(count * dim * 4);
  for (let i = 0; i < count * dim; i++) body.writeFloatLE(vectors[i], i * 4);
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, MAGIC);
  fs.writeSync(fd, lenBuf);
  fs.writeSync(fd, headerJson);
  fs.writeSync(fd, body);
  fs.writeSync(fd, buildFooter(count, dim, body));
  fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, file);                        // 原子替换
}

/** 读回并**校验**：MAGIC / 长度自洽 / footer 完整标记 / 向量块 sha1。任一不符返回 null。 */
function readIndexBin(file) {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length < HEAD_OFF || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const headerLen = buf.readUInt32LE(LEN_OFF);
  if (HEAD_OFF + headerLen > buf.length) return null;
  let header;
  try { header = JSON.parse(buf.subarray(HEAD_OFF, HEAD_OFF + headerLen).toString('utf8')); }
  catch { return null; }

  const start = HEAD_OFF + headerLen;
  const n = (header.count || 0) * (header.dim || 0);
  const blockEnd = start + n * 4;
  if (n <= 0 || blockEnd + 4 > buf.length) return null;
  const body = buf.subarray(start, blockEnd);

  // footer 校验：没有"写完了"标记就当写入未完成 → 不加载
  let footOk = false;
  try {
    const fLen = buf.readUInt32LE(blockEnd);
    const foot = JSON.parse(buf.subarray(blockEnd + 4, blockEnd + 4 + fLen).toString('utf8'));
    const sha = crypto.createHash('sha1').update(body).digest('hex');
    footOk = foot.complete === true && foot.count === header.count && foot.dim === header.dim
             && foot.sha1_of_vector_block === sha;
  } catch { footOk = false; }
  if (!footOk) return null;

  const vectors = new Float32Array(n);
  for (let i = 0; i < n; i++) vectors[i] = buf.readFloatLE(start + i * 4);
  return { header, vectors };
}

/** 往返自检：写一份小索引 → 读回 → 断言内容一致。
 *  与 BMP 布局自检同理：**不靠"应该没问题"，靠可执行的断言**。
 *  这一步能拦住"写读偏移不一致"这类静默错误（本文件就出过一次）。 */
function selfTestIndexBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-idxselftest-'));
  const f = path.join(dir, 'index.bin');
  try {
    const dim = 4, count = 3;
    const src = [0.1, 0.2, 0.3, 0.4, -0.5, 0.6, 0.7, 0.8, 0, 0, 0, 1];
    const header = { version: 1, dim, count, modelId: 'selftest', precision: 'fp32', seq: 140, dtype: 'float32' };
    writeIndexBin(f, header, src, count, dim);
    const back = readIndexBin(f);
    if (!back) throw new Error('读回返回 null');
    if (back.header.count !== count || back.header.dim !== dim) throw new Error('header 不一致');
    for (let i = 0; i < src.length; i++) {
      if (Math.abs(back.vectors[i] - src[i]) > 1e-6) throw new Error(`向量第 ${i} 位不一致: ${back.vectors[i]} vs ${src[i]}`);
    }
    // 反例：截断文件（模拟写入未完成）必须被拒绝
    const buf = fs.readFileSync(f);
    fs.writeFileSync(f, buf.subarray(0, buf.length - 10));
    if (readIndexBin(f) !== null) throw new Error('截断文件竟被当成有效索引 —— footer 校验没起作用');
    return { ok: true, checked: src.length };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

// ---------------- 主流程 ----------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  log(`扫描库: ${LIB_ROOT}`);
  let items = scanLibrary(LIB_ROOT);
  const scanned = items.length;
  const withArchive = items.filter((i) => i.archiveAbsPath).length;
  const noArchive = scanned - withArchive;
  log(`  条目 ${scanned}（有包 ${withArchive} · 无包 ${noArchive}）`);
  if (LIMIT > 0) { items = items.slice(0, LIMIT); log(`  --limit ${LIMIT} → 本次只处理 ${items.length} 条`); }

  // 计算 UID（sha1 图像字节前 12 位）
  log('计算 UID（sha1 图像字节，与路径无关）…');
  const t0 = now();
  for (const it of items) {
    const h = crypto.createHash('sha1');
    h.update(fs.readFileSync(it.absPath));
    it.uid = h.digest('hex').slice(0, 12);
  }
  log(`  完成，用时 ${((now() - t0) / 1000).toFixed(1)}s`);

  // 续跑：参数一致则复用已有向量
  // 索引往返自检：**必须在续跑判定之前**跑 —— 续跑依赖 readIndexBin，
  // 而这个读写对曾因 MAGIC 长度不一致（7 vs 8）静默失效过。
  log('index.bin 往返自检…');
  const ist = selfTestIndexBin();
  log(`  通过：校验 ${ist.checked} 个浮点 · 并确认"截断文件会被拒绝"`);

  const old = REBUILD ? null : readIndexBin(INDEX_BIN);
  let oldMeta = null;
  try { oldMeta = JSON.parse(fs.readFileSync(META_JSON, 'utf8')); } catch { /* 无 */ }
  const reusable = new Map();
  const paramKey = (h) => [h.modelId, h.precision, h.seq, h.dtype, h.dim].join('|');
  const wantKey = [MODEL_DIR, 'fp32', SEQ, 'float32', 768].join('|');
  if (old && oldMeta && paramKey(oldMeta) === wantKey) {
    let oldItems = [];
    try { oldItems = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8')); } catch { /* 无 */ }
    for (const oi of oldItems) {
      if (oi.vectorRow == null || oi.vectorRow >= old.header.count) continue;
      const off = oi.vectorRow * old.header.dim;
      const v = old.vectors.subarray(off, off + old.header.dim);
      let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
      if (Math.sqrt(n) > 0.5) reusable.set(oi.uid, Array.from(v));   // 只复用非零向量
    }
    log(`  续跑：已有 ${reusable.size} 条可用向量（跳过重复编码）`);
  }

  // BMP 解码布局自检：**必须在编码前**跑，失败即中止（绝不用错的布局算向量）
  log('BMP 解码布局自检…');
  const st = await selfTestBmpLayout();
  log(`  通过：校验 ${st.checked} 个像素（${st.size}）`);

  // 载入模型
  log(`载入模型（dtype=fp32, seq=${SEQ}, device=${DEVICE}）…`);
  const tLoad = now();
  const config = await AutoConfig.from_pretrained(MODEL_DIR);
  config.audio_config = null;                                    // 不需要音频塔
  const processor = await AutoProcessor.from_pretrained(MODEL_DIR, { config });
  processor.image_seq_length = SEQ;
  if (processor.image_processor) {
    processor.image_processor.max_soft_tokens = SEQ;
    processor.image_processor.image_seq_length = SEQ;
  }
  const model = await AutoModel.from_pretrained(MODEL_DIR, { config, dtype: 'fp32', device: DEVICE });
  log(`  载入完成 ${((now() - tLoad) / 1000).toFixed(1)}s`);

  // 编码
  const vectors = [];          // 扁平数组，行序与 items 一致
  const rows = [];             // {uid, vectorRow}
  const failed = [];
  let dim = 0;
  let reused = 0;
  let fallbackUsed = 0;   // 走 BMP 回退的条数（应为 20）
  // header 必须在编码循环**之前**声明：中途落盘（save-every）会用到它
  const header = {
    version: 1, dim: 0, count: 0, modelId: MODEL_DIR, precision: 'fp32',
    seq: SEQ, dtype: 'float32', device: DEVICE, libId: LIB_ID, libRoot: LIB_ROOT,
    prefixQuery: 'task: search result | query: ',
    prefixDocument: 'title: none | text: ',
    builtAt: new Date().toISOString(),
  };

  const tEnc = now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const hit = reusable.get(it.uid);
    if (hit) {
      dim = dim || hit.length;
      rows.push({ uid: it.uid, vectorRow: vectors.length / dim, vectorSource: it.vectorSource || 'native' });
      vectors.push(...hit);
      reused++;
    } else {
      try {
        // 原生优先；BMP 走 bmp-js 回退（本库有 20 张 .jpg 实际是 BMP）
        const { image: img, vectorSourceKind, error } = await readImageWithFallback(it.absPath);
        if (!img) throw new Error(error || '解码失败');
        it.vectorSource = vectorSourceKind;
        if (vectorSourceKind !== 'native') fallbackUsed++;
        const inputs = await processor(null, [img]);
        const out = await model.forward(inputs);
        const emb = out.sentence_embedding ?? out.text_embeds;
        if (!emb) throw new Error('输出无 sentence_embedding');
        dim = emb.dims[emb.dims.length - 1];
        rows.push({ uid: it.uid, vectorRow: vectors.length / dim });
        vectors.push(...Array.from(emb.data));
      } catch (e) {
        failed.push({ uid: it.uid, relPath: it.relPath, error: (e && e.message) || String(e) });
      }
    }
    if ((i + 1) % 25 === 0 || i + 1 === items.length) {
      const done = i + 1;
      const secs = (now() - tEnc) / 1000;
      const rate = done / secs;
      const eta = rate > 0 ? (items.length - done) / rate : 0;
      log(`  ${done}/${items.length}  已编码 ${done - reused} · 复用 ${reused} · 失败 ${failed.length}` +
          `  ${rate.toFixed(2)} 条/秒  已用 ${(secs / 60).toFixed(1)} 分  预计剩余 ${(eta / 60).toFixed(1)} 分`);
    }
    if (SAVE_EVERY > 0 && (i + 1) % SAVE_EVERY === 0) {
      persist(items, rows, vectors, dim, failed, 'midbuild');
    }
  }

  if (!dim) { log('没有编码出任何向量，终止'); process.exit(1); }
  const ok = rows.length;
  header.dim = dim;
  header.count = ok;
  persist(items, rows, vectors, dim, failed, 'final');
  log(`完成：${ok} 条 · dim=${dim} · 失败 ${failed.length} · 复用 ${reused} · BMP回退 ${fallbackUsed}`);
  log(`  ${INDEX_BIN}`);
  log(`  ${ITEMS_JSON}`);
  log(`  ${META_JSON}`);
  if (failed.length) log(`  失败清单已写入 meta.json 的 failed[]（前 5：${failed.slice(0, 5).map((f) => f.relPath).join(', ')}）`);
  return { ok, dim, failed: failed.length, reused };

  function persist(allItems, allRows, vecs, d, fails, phase) {
    const rowByUid = new Map(allRows.map((r) => [r.uid, r.vectorRow]));
    const srcByUid = new Map(allRows.map((r) => [r.uid, r.vectorSource || 'native']));
    const outItems = allItems
      .filter((it) => rowByUid.has(it.uid))
      .map((it) => ({
        uid: it.uid, libId: LIB_ID, folder: it.folder, stem: it.stem,
        name: it.name, relPath: it.relPath, absPath: it.absPath,
        imageExt: it.imageExt, imageSize: it.imageSize, imageMtime: it.imageMtime,
        archiveName: it.archiveName, archiveRelPath: it.archiveRelPath,
        archiveAbsPath: it.archiveAbsPath, archiveExt: it.archiveExt,
        archiveSize: it.archiveSize, archiveMtime: it.archiveMtime,
        vectorRow: rowByUid.get(it.uid),
        vectorSource: srcByUid.get(it.uid) || 'native',   // 'native' | 'bmp-fallback'
      }));
    writeIndexBin(INDEX_BIN, { ...header, count: allRows.length }, vecs, allRows.length, d);
    fs.writeFileSync(ITEMS_JSON + '.tmp', JSON.stringify(outItems, null, 1), 'utf8');
    fs.renameSync(ITEMS_JSON + '.tmp', ITEMS_JSON);
    fs.writeFileSync(META_JSON + '.tmp', JSON.stringify({
      ...header, count: allRows.length, phase,
      scanned: scanned, failed: fails, bmpFallbackUsed: fallbackUsed,
    }, null, 2), 'utf8');
    fs.renameSync(META_JSON + '.tmp', META_JSON);
  }
}

main().then((r) => {
  console.log('RESULT ' + JSON.stringify(r));
  process.exit(r.failed > 0 ? 3 : 0);
}).catch((e) => {
  console.error('[build] 致命错误:', e);
  process.exit(1);
});

// build_index_onnx.mjs —— 用 ONNX/WebGPU 构建索引（新格式 index.bin，含稳定 UID）
//
// 用法:
//   node build_index_onnx.mjs --model <目录> --lib G:\model --out <目录>
//        [--seq 140] [--device webgpu] [--limit N] [--save-every 200] [--rebuild]
//
// 设计要点（对齐 docs/design/DESIGN-app-details.md）：
//   · 配对：**同目录 + 同名主干**（不跨目录），图 .jpg/.jpeg/.png，包 .zip/.rar
//   · UID：`sha1(lib_id|目录|主干)[:12]`（SPEC-identity §2 冻结公式）
//          不依赖图像字节 —— 内容相同的两张图仍是两条素材（本库有 5 组这种）
//   · 重采样：安装 `resize_compat.mjs`，把 Node 侧钉成与 PIL 等价的那一套（preprocessing v2）
//   · 格式：index.bin = MAGIC + u32 headerLen + headerJSON + float32 块（count × dim）
//   · 可续跑：参数一致时复用已有向量，只编码缺的
//   · 原子落盘：写 .tmp → rename；每 N 条落一次盘
//   · 单张失败不停整个构建（记录到 meta.failed）

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AutoConfig, AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { readImageWithFallback, selfTestBmpLayout, isBmp } from './bmp_decode.mjs';
import { installResizeCompat, selfTestResizeCompat, resizeCompatState, assertResizeCompatInstalled } from './resize_compat.mjs';

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
const LIB_ID = arg('lib-id', 'L1');
// 权重精度：决定向量，进 compat（SPEC-identity §6.3）
const WEIGHTS_DTYPE = arg('weights-dtype', 'fp32');
const MODEL_REPO = arg('model-repo', 'onnx-community/embeddinggemma-2-ONNX');

if (!MODEL_DIR || !LIB_ROOT || !OUT_DIR) {
  console.error('用法: node build_index_onnx.mjs --model <目录> --lib <库根> --out <目录>'
    + ' [--seq 140] [--device webgpu] [--limit N] [--lib-id L1] [--weights-dtype fp32]');
  process.exit(2);
}

// SPEC-identity §6.2 / §6.3 的版本号与常量
const FORMAT_VERSION = 1;          // index.bin 布局版本
const COMPAT_KEY_VERSION = 1;      // 兼容性判定规则版本
// v2（2026-10-10）：重采样实现改用 `resize_compat`（按 PIL 规则分方向）——
//   起因：G-B v1 实测 min 余弦 0.9153（135 条 < 硬底线 0.970）。定位到
//   transformers.js 用 `sharp.affine(bicubic)`（无抗锯齿）而 Python 用 `PIL.resize(BICUBIC)`
//   （降采样时按 1/scale 展宽核支撑 = 抗锯齿）。换实现后与 PIL 的像素差从 4.93/255 降到 0.18/255。
//   **改了预处理就必须升版**：否则 v1 的索引会被当成可复用（compat 不含实现细节时会静默混用）。
const PREPROCESSING_VERSION = 2;   // 我方预处理配置版本（改动即升版）
const DIM = 768;                   // EmbeddingGemma 2 统一 768 维
const ONNX_SPIKE_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

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

// ---------------- 元数据辅助（SPEC-identity §6.2）----------------

/** 从模型路径里取出钉住的 40 位 revision。取不到就返回 null —— 调用方必须报错，不许猜。 */
function parseRevisionFromPath(p) {
  const seg = path.normalize(p).split(path.sep).find((s) => /^[0-9a-f]{40}$/.test(s));
  return seg || null;
}

/** 读 node_modules 里某个包的实际版本（用于把 runtime 版本写进索引） */
function readPkgVersion(name) {
  try {
    const p = path.join(ONNX_SPIKE_DIR, 'node_modules', name, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || null;
  } catch {
    return null;
  }
}

/**
 * GPU 型号与驱动。
 *
 * 这两个字段**不参与 compat**，缺失允许为 null。
 *
 * 为什么优先读环境变量：在受限沙箱里 `execFileSync('nvidia-smi')` 会以 **EPERM** 失败
 * （沙箱禁止子进程通过管道取输出）。实测三种调用形式（裸名 / 带 .exe / 绝对路径）
 * 全部 EPERM —— 所以这不是路径问题，不该靠"换个写法"绕。
 * 正确做法：**由调用方把值传进来**（调用方是自己 shell 里的脚本，能跑 nvidia-smi），
 * 这里的 spawn 只作尽力而为的回退，失败就老实写 null。
 */
function gpuInfo() {
  const envModel = process.env.GEMMA_GPU_MODEL || null;
  const envDriver = process.env.GEMMA_GPU_DRIVER || null;
  if (envModel) {
    return { gpu_model: envModel, gpu_driver: envDriver, gpu_source: 'env' };
  }
  try {
    const out = execFileSync('nvidia-smi',
      ['--query-gpu=name,driver_version', '--format=csv,noheader'],
      { encoding: 'utf8', timeout: 5000 });
    const [name, drv] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
    return { gpu_model: name || null, gpu_driver: drv || null, gpu_source: 'nvidia-smi' };
  } catch (e) {
    return { gpu_model: null, gpu_driver: null, gpu_source: `unavailable(${e.code || 'error'})` };
  }
}

/**
 * 读回**实际生效**的预处理参数。
 *
 * 为什么不直接写常量：实测这三个位置的默认值都是 **280**，构建器必须显式设成 SEQ；
 * 而且 `image_processor.config.image_seq_length` 与实例属性是两处。若将来
 * transformers.js 改从 config 读，实际 effective seq 会悄悄变成 280 ——
 * 那时向量与索引不匹配、检索质量静默下降（本项目最危险的失败模式）。
 * 所以：**三处都设 + 回读断言 + 把两个值都记进元数据**。
 */
function readEffectivePreprocessing(processor, seq, resampleImpl) {
  const ip = processor.image_processor || {};
  const ipc = ip.config || {};
  const read = (obj, k) => (obj && k in obj ? obj[k] : null);
  const meta = {
    image_seq_length: read(processor, 'image_seq_length'),
    max_soft_tokens: read(ip, 'max_soft_tokens'),
    config_image_seq_length: read(ipc, 'image_seq_length'),   // 诊断用：与上面不一致时能看出来
    patch_size: read(ip, 'patch_size') ?? read(ipc, 'patch_size'),
    pooling_kernel_size: read(ip, 'pooling_kernel_size') ?? read(ipc, 'pooling_kernel_size'),
    resample: read(ip, 'resample') ?? read(ipc, 'resample'),
    rescale: read(ip, 'rescale_factor') ?? read(ip, 'rescale_factor'),
    do_normalize: read(ipc, 'do_normalize') ?? read(ip, 'do_normalize'),
    do_convert_rgb: read(ip, 'do_convert_rgb') ?? read(ipc, 'do_convert_rgb'),
    color: (read(ip, 'do_convert_rgb') ?? read(ipc, 'do_convert_rgb')) ? 'RGB' : null,
    // 重采样**实现**（不是配置里的 resample 代号）。进 metadata 供日后追差异；
    // 真正的兼容性开关是 preprocessing_version。
    resample_impl: resampleImpl,
  };
  // 硬断言：生效值必须等于请求值
  if (meta.image_seq_length !== seq) {
    throw new Error(`预处理 seq 未生效：请求 ${seq}，实际 processor.image_seq_length=${meta.image_seq_length}`);
  }
  if (meta.max_soft_tokens !== seq) {
    throw new Error(`预处理 seq 未生效：请求 ${seq}，实际 image_processor.max_soft_tokens=${meta.max_soft_tokens}`);
  }
  return meta;
}

/** SPEC-identity §6.3 的兼容性判定键 —— 一个字符串，便于比对与写进索引 */
function compatKey(h) {
  return [
    h.model_repo, h.model_revision, h.model_weights_dtype,
    h.preprocessing_version, h.seq_length, h.dim, h.normalization, h.pooling,
  ].join('|');
}
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
// 布局（与 docs/spec/SPEC-identity.md §7 对齐；偏移全部由 MAGIC.length 推导，不再硬编码 8/12）：
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

  // 计算 UID —— **必须**用 SPEC-identity §2 冻结的公式：
  //     uid = sha1( lib_id + "|" + rel_dir + "|" + stem ).slice(0, 12)
  //
  // ⚠️ 这里曾经写成 sha1(图像字节)：那正是 SPEC-identity §1 **明确否决**的原设计
  //    （"相同图像字节不代表同一条素材"）。后果不是"不够好"而是**真出错**：
  //    实测库里有 5 组内容完全相同的图（sha1 相同），内容哈希会给出**相同 uid**，
  //    于是 rowByUid 把两组折叠成一行 → 一条向量行被孤立、条目数与行数不等，
  //    A 项"条目数 = 3594"必然失败。
  //    用 (目录, 主干) 作种子则天然唯一，内容重复也不影响。
  log('计算 UID（sha1(lib_id|rel_dir|stem) 前 12 位，SPEC-identity §2）…');
  const t0 = now();
  const uidSeen = new Map();
  for (const it of items) {
    const relDir = path.dirname(it.relPath);
    const dir = relDir === '.' ? '' : relDir;
    it.uid = crypto.createHash('sha1')
      .update(`${LIB_ID}|${dir}|${it.stem}`, 'utf8')
      .digest('hex').slice(0, 12);
    if (uidSeen.has(it.uid)) {
      throw new Error(`UID 碰撞：${it.uid} 同时属于 "${uidSeen.get(it.uid)}" 与 "${it.relPath}"
（种子是 (lib_id, 目录, 主干)，理论上唯一；出现碰撞说明公式或输入有问题，不能继续）`);
    }
    uidSeen.set(it.uid, it.relPath);
  }
  log(`  完成，用时 ${((now() - t0) / 1000).toFixed(1)}s · ${uidSeen.size} 个 uid 无重复`);

  // 索引往返自检：**必须在任何 readIndexBin 之前**跑 —— 续跑依赖它，
  // 而这个读写对曾因 MAGIC 长度不一致（7 vs 8）静默失效过。
  log('index.bin 往返自检…');
  const ist = selfTestIndexBin();
  log(`  通过：校验 ${ist.checked} 个浮点 · 并确认"截断文件会被拒绝"`);

  // 注意：续跑判定（按 compat）在**模型载入之后**，因为它要比较预处理实测值。
  //       不要在模型载入前再放一份续跑逻辑 —— 曾因此留过两份重复判定。

  // 预处理兼容层：**必须在任何 processor 调用之前安装**
  // 踩过的坑：不装也能跑，只是图像向量与参考实现差 ~1.9%（像素尺度）→
  // 全量 min 余弦 0.9153、135 条低于硬底线；而且**不报错**。
  log('安装重采样兼容层（resize_compat · pil-like）…');
  installResizeCompat({ kernel: 'pil-like', RawImage, logger: log });
  assertResizeCompatInstalled(RawImage);
  const rst = await selfTestResizeCompat();
  log(`  自检通过（kernel=${rst.kernel} · 断言 ${rst.calls} 次 resize）`);

  // BMP 解码布局自检：**必须在编码前**跑，失败即中止（绝不用错的布局算向量）
  log('BMP 解码布局自检…');
  const st = await selfTestBmpLayout();
  log(`  通过：校验 ${st.checked} 个像素（${st.size}）`);

  // 载入模型
  log(`载入模型（dtype=${WEIGHTS_DTYPE}, seq=${SEQ}, device=${DEVICE}）…`);
  const tLoad = now();
  const config = await AutoConfig.from_pretrained(MODEL_DIR);
  config.audio_config = null;                                    // 不需要音频塔
  const processor = await AutoProcessor.from_pretrained(MODEL_DIR, { config });
  // ⚠️ 三个位置都要设：实测它们的默认值都是 280。只设其中一两个，
  //    将来上游改读另一处就会让 effective seq 悄悄变成 280（向量与索引静默不匹配）。
  processor.image_seq_length = SEQ;
  if (processor.image_processor) {
    processor.image_processor.max_soft_tokens = SEQ;
    processor.image_processor.image_seq_length = SEQ;
    if (processor.image_processor.config) {
      processor.image_processor.config.image_seq_length = SEQ;    // 第三处：config 副本
    }
  }
  const model = await AutoModel.from_pretrained(MODEL_DIR, { config, dtype: 'float32', device: DEVICE });
  log(`  载入完成 ${((now() - tLoad) / 1000).toFixed(1)}s`);

  // ---------- 元数据（SPEC-identity §6.2）：必须在续跑判定之前建好 ----------
  const revision = parseRevisionFromPath(MODEL_DIR);
  if (!revision) {
    throw new Error(`无法从 --model 路径解析出 40 位 model revision：${MODEL_DIR}
（不要用猜的：revision 进 compat，猜错会让不同权重的索引被误判为可互换）`);
  }
  const pre = readEffectivePreprocessing(processor, SEQ, `resize_compat(${resizeCompatState().kernel})`);
  log(`  预处理实测：seq=${pre.image_seq_length} · max_soft_tokens=${pre.max_soft_tokens}`
    + ` · config 副本=${pre.config_image_seq_length} · patch=${pre.patch_size}`
    + ` · pool=${pre.pooling_kernel_size} · resample=${pre.resample} · normalize=${pre.do_normalize}`
    + ` · impl=${pre.resample_impl}`);

  const header = {
    format_version: FORMAT_VERSION,
    compat_key_version: COMPAT_KEY_VERSION,

    model_repo: MODEL_REPO,
    model_revision: revision,
    model_weights_dtype: WEIGHTS_DTYPE,
    model_files: ['onnx/model.onnx', 'onnx/model.onnx_data',
                  'onnx/vision_encoder.onnx', 'onnx/vision_encoder.onnx_data'],
    audio_disabled: true,

    preprocessing_version: PREPROCESSING_VERSION,
    preprocessing: pre,

    seq_length: SEQ,
    dim: DIM,
    embedding_dtype: 'float32',          // 向量存储精度（与权重精度是两件事）
    normalization: 'l2',
    pooling: 'mean_soft_tokens',

    query_prefix: 'task: search result | query: ',
    document_prefix: 'title: none | text: ',

    runtime: {
      'transformers.js': readPkgVersion('@huggingface/transformers'),
      'onnxruntime-node': readPkgVersion('onnxruntime-node'),
      device: DEVICE,                    // 诊断用，**不参与 compat**
      ort_provider: DEVICE,
      ...gpuInfo(),
    },

    count: 0,
    lib_id: LIB_ID,
    lib_root: LIB_ROOT,
    built_at: new Date().toISOString(),
  };
  header.compat = compatKey(header);
  log(`  compat = ${header.compat}`);

  // ---------- 续跑：**按 compat 串判定**（fail-closed）----------
  // 上面那轮 bug 的教训：字段名一漂移，判定就静默失效。收敛成一个字符串能减少漂移面；
  // 且 meta 缺 compat（旧格式）一律判为不可复用 —— 宁可重编码，也不混用不同配置的向量。
  //
  // 复用表**按 relPath 作键**，不按 uid：uid 的算法改动（本次就从内容哈希改成
  // SPEC-identity §2 的 (lib_id,目录,主干)）会让所有旧 uid 失效，从而白白丢掉
  // 已经编码好的行。relPath 是同一次扫描里的稳定键，与 uid 方案无关。
  const old = REBUILD ? null : readIndexBin(INDEX_BIN);
  let oldMeta = null;
  try { oldMeta = JSON.parse(fs.readFileSync(META_JSON, 'utf8')); } catch { /* 无 */ }
  const reusable = new Map();
  if (old && oldMeta && oldMeta.compat && oldMeta.compat === header.compat) {
    let oldItems = [];
    try { oldItems = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8')); } catch { /* 无 */ }
    for (const oi of oldItems) {
      const key = oi.relPath || oi.rel_path;
      if (!key) continue;
      if (oi.vectorRow == null || oi.vectorRow >= old.header.count) continue;
      const off = oi.vectorRow * old.header.dim;
      const v = old.vectors.subarray(off, off + old.header.dim);
      let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
      if (Math.sqrt(n) > 0.5) reusable.set(key, Array.from(v));   // 只复用非零向量
    }
    log(`  续跑：已有 ${reusable.size} 条可用向量（跳过重复编码）`);
  } else if (old && oldMeta) {
    log(`  续跑：不复用（compat 不符或旧 meta 无 compat）：旧=${oldMeta.compat || '(无)'}`);
  }

  // 编码
  const vectors = [];          // 扁平数组，行序与 items 一致
  const rows = [];             // {uid, vectorRow}
  const failed = [];
  let dim = 0;
  let reused = 0;
  let fallbackUsed = 0;   // 走 BMP 回退的条数（应为 20）

  const tEnc = now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const hit = reusable.get(it.relPath);   // 复用表按 relPath 作键（与 uid 方案无关）
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
        // ⚠️ 这里**必须**带上 vectorSource：漏了的话 persist() 里 srcByUid 取不到值，
        //    全部回落成 'native' —— 实测 meta.bmpFallbackUsed=20 而 items.json 里 3594 条
        //    全是 'native'（字段静默失真，SPEC-acceptance §2.2 的豁免分组就永远不触发）。
        rows.push({ uid: it.uid, vectorRow: vectors.length / dim, vectorSource: vectorSourceKind });
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
  // dim 是 compat 的成员之一：实测值必须等于规格固定的 768，否则 compat 已经算错
  if (dim !== DIM) {
    throw new Error(`实测维度 ${dim} ≠ 规格固定值 ${DIM} —— compat 已按 ${DIM} 计算，不能继续`);
  }
  const ok = rows.length;
  header.dim = dim;
  header.count = ok;
  persist(items, rows, vectors, dim, failed, 'final');
  log(`完成：${ok} 条 · dim=${dim} · 失败 ${failed.length} · 复用 ${reused} · BMP回退 ${fallbackUsed}`);
  log(`  compat = ${header.compat}`);
  log(`  ${INDEX_BIN}`);
  log(`  ${ITEMS_JSON}`);
  log(`  ${META_JSON}`);
  if (failed.length) log(`  失败清单已写入 meta.json 的 failed[]（前 5：${failed.slice(0, 5).map((f) => f.relPath).join(', ')}）`);
  return { ok, dim, failed: failed.length, reused, compat: header.compat };

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

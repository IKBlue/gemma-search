// packages/engine/tests/helpers/lib-fixture.mjs —— 临时素材库 + 最小合法索引的**唯一**夹具构造器
//
// 为什么独立成模块：engine.test.mjs 与 storage-ports.test.mjs 都要造**同一份库**。
// 各写一份夹具，两份迟早漂移（P1）—— 而「同一份库、两种接线」正是 T-16a 等价性判据的前提。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { uidOf } from '../../src/uid.ts';
// ⚠️ MAGIC 的唯一定义在 src/index.ts（不在这里再抄一份 8 字节常量）
import { MAGIC } from '../../src/index.ts';

/** 造一个临时素材库：VR/CR 两个文件夹，各 2 图 + 1 包。 */
export function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-lib-'));
  const rows = [
    ['VR', 'ID-1', '.jpg', 'a.rar'],
    ['VR', 'ID-2', '.png', null],
    ['CR', 'ID-3', '.jpeg', 'c.zip'],
    ['CR', 'ID-4', '.jpg', 'd.7z'],
  ];
  const items = [];
  for (const [folder, stem, ext, arc] of rows) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, stem + ext), 'img-' + stem);
    if (arc) fs.writeFileSync(path.join(root, folder, arc), 'arc-' + stem);
    items.push({ folder, stem, ext, arc });
  }
  return { root, rows: items };
}

/** 写一份最小合法索引（含 header/footer，向量用可预测值）。
 *  imageSize/imageMtime **取自真实文件** —— 否则 scan 的"变化"检测没有意义。 */
export function writeIndexFixture(
  dir,
  libId,
  items,
  { libRoot, seq = 140, dim = 8, suffix = '' } = {},
) {
  fs.mkdirSync(dir, { recursive: true });
  const vecs = [];
  const outItems = [];
  items.forEach((it, i) => {
    // 向量必须是 **L2 归一化** 的 —— 真实索引就是这样（`SPEC.md` §2.2（GSIDX 格式） normalization:"l2"），
    // 引擎用点积当余弦。用未归一化的 fixture 会让"余弦=1"这类断言失真，
    // 也会掩盖归一化相关的真 bug。
    const raw = new Float32Array(dim);
    for (let d = 0; d < dim; d++) raw[d] = (((i + 1) * (d + 1)) % 7) / 7;
    let n = 0;
    for (let d = 0; d < dim; d++) n += raw[d] * raw[d];
    n = Math.sqrt(n) || 1;
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = raw[d] / n;
    vecs.push(...v);
    const imgAbs = path.join(libRoot, it.folder, it.stem + it.ext);
    const st = fs.statSync(imgAbs, { bigint: true });
    const arcAbs = it.arc ? path.join(libRoot, it.folder, it.arc) : null;
    outItems.push({
      uid: uidOf(libId, it.folder, it.stem),
      libId,
      folder: it.folder,
      stem: it.stem,
      relPath: `${it.folder}\\${it.stem}${it.ext}`,
      imageExt: it.ext,
      imageSize: Number(st.size),
      imageMtime: Number(st.mtimeNs / 1_000_000n),
      archiveRelPath: it.arc ? `${it.folder}\\${it.arc}` : null,
      archiveExt: it.arc ? path.extname(it.arc) : null,
      archiveSize: arcAbs ? Number(fs.statSync(arcAbs, { bigint: true }).size) : null,
      vectorRow: i,
      vectorSource: 'native',
    });
  });

  const header = {
    format_version: 1,
    compat_key_version: 1,
    model_repo: 'test/repo' + suffix,
    model_revision: 'a'.repeat(40),
    model_weights_dtype: 'fp32',
    preprocessing_version: 1,
    seq_length: seq,
    dim,
    normalization: 'l2',
    pooling: 'mean_soft_tokens',
    count: outItems.length,
    lib_id: libId,
  };
  header.compat = [
    header.model_repo,
    header.model_revision,
    header.model_weights_dtype,
    header.preprocessing_version,
    header.seq_length,
    header.dim,
    header.normalization,
    header.pooling,
  ].join('|');
  const body = Buffer.alloc(outItems.length * dim * 4);
  vecs.forEach((x, i) => body.writeFloatLE(x, i * 4));
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerJson.length, 0);
  const foot = Buffer.from(
    JSON.stringify({
      count: outItems.length,
      dim,
      sha1_of_vector_block: crypto.createHash('sha1').update(body).digest('hex'),
      complete: true,
    }),
    'utf8',
  );
  const footLen = Buffer.alloc(4);
  footLen.writeUInt32LE(foot.length, 0);
  const indexBuffer = Buffer.concat([MAGIC, lenBuf, headerJson, body, footLen, foot]);
  fs.writeFileSync(path.join(dir, 'index.bin'), indexBuffer);
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(outItems));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...header, failed: [] }));
  return { header, items: outItems, indexBuffer };
}

/** 假编码器：把文本/图像映射到与 fixture 同构的向量（不加载模型）。 */
export function fakeEncoder(mode = 'first', { normalize = true } = {}) {
  // 与 fixture 的生成规则一致（同一个 raw 序列），保证"同向"是可断言的
  const raw = new Float32Array(8);
  const k = mode === 'first' ? 1 : 2;
  for (let d = 0; d < 8; d++) raw[d] = ((k * (d + 1)) % 7) / 7;
  if (!normalize)
    return {
      async encodeText() {
        return raw;
      },
      async encodeImage() {
        return raw;
      },
    };
  let n = 0;
  for (let d = 0; d < 8; d++) n += raw[d] * raw[d];
  n = Math.sqrt(n) || 1;
  const v = new Float32Array(8);
  for (let d = 0; d < 8; d++) v[d] = raw[d] / n;
  return {
    async encodeText() {
      return v;
    },
    async encodeImage() {
      return v;
    },
  };
}

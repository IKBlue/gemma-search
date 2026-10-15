// reports/2026-10-15-wave3/s3-verify.mjs —— S3：100×768 索引 + asset_index_state 编码态 的**可复跑复核**
//
// 为什么在 reports/ 下：原来的 data/_schema100/s3.mjs 落在 gitignore 的 `data/_*` 里 ⇒ 结论「对账漂移 = 0」
// 在别的机器上**不可复跑**。移到受版本管理的位置后，任何人都能重跑同一套判定（S3b / task-63）。
//
// 用法（在**仓库根**执行）：
//   node reports/2026-10-15-wave3/s3-verify.mjs state                 # out/index.bin → 库根 .gs-index.bin + 写编码态 + 对账
//   node reports/2026-10-15-wave3/s3-verify.mjs verify                # 五道校验逐道破坏 + 对账（不改产品夹具）
//   node reports/2026-10-15-wave3/s3-verify.mjs query --model <fp32>   # 100 条库上的真查询 + 抽样「重编该条 vs 索引行」余弦
//   node reports/2026-10-15-wave3/s3-verify.mjs sabotage vector-row|mtime|disk-mtime   （能红用；会改夹具）
//   node reports/2026-10-15-wave3/s3-verify.mjs restore  vector-row|mtime|disk-mtime   （还原）
//
// 纪律：
//   · 索引**只经产品写入口** writeIndexAtomically（临时名→fsync→引擎五道校验→rename）
//   · 校验**只有引擎那一份**（readIndexFile → readIndexBin），本脚本不实现第二份 GSIDX 解析/校验（AGENTS P1）
//   · 对账判定**只有一份**：./s3-reconcile.mjs（与 apps/desktop/tests/s3-index-state.test.mjs 共用）
//   · 破坏只发生在 data/_schema100/_tmp 的**副本**上（verify 本身只读）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGsDb } from '../../apps/desktop/src/main/db/index.ts';
import { readIndexFile, writeIndexAtomically } from '../../apps/desktop/src/main/index-file.ts';
import { readIndexBin } from '../../packages/engine/src/index.ts';
import { reconcile, summarize, sep, statMtimeMs } from './s3-reconcile.mjs';

// 仓库根：向上找含 packages/engine/src/engine.ts 的那一级（搬目录也不会失效，与 tools/*.mjs 同一写法）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let p = HERE;
  for (;;) { if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p; const up = path.dirname(p); if (up === p) throw new Error('找不到仓库根'); p = up; }
})();
const BASE = process.env.GEMMA_S3_BASE ? path.resolve(process.env.GEMMA_S3_BASE) : path.join(ROOT, 'data', '_schema100');
const LIB = path.join(BASE, 'lib');
const OUT_DIR = path.join(BASE, 'out');
const TMP = path.join(BASE, '_tmp');
const INDEX = path.join(LIB, '.gs-index.bin');
const DB_PATH = path.join(LIB, '.gs.db');
const say = (s) => console.log(s);
const metaOf = () => JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'meta.json'), 'utf8'));
const outItems = () => JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'items.json'), 'utf8'));
const openDb = (opts = {}) => openGsDb({ dbPath: DB_PATH, ...opts }).db;

function printRec(rec, meta) { for (const l of summarize(rec, meta)) say('  ' + l); }

// ---------------------------------------------------------------- 五道校验的夹具（只造字节，判定归产品）

function layoutOf(buf) {
  const magicLen = 8;
  const headerLen = buf.readUInt32LE(magicLen);
  const headerStart = magicLen + 4;
  const header = JSON.parse(buf.subarray(headerStart, headerStart + headerLen).toString('utf8'));
  const blockBytes = header.count * header.dim * 4;
  const footLenOff = headerStart + headerLen + blockBytes;
  const footLen = buf.readUInt32LE(footLenOff);
  const footStart = footLenOff + 4;
  return { header, headerLen, blockBytes, footLenOff, footStart, footText: buf.subarray(footStart, footStart + footLen).toString('utf8') };
}
function bumpFooterNumber(out, l, key, delta) {
  const m = new RegExp('"' + key + '"\\s*:\\s*(\\d+)').exec(l.footText);
  if (!m) throw new Error('夹具前提：footer 缺 ' + key);
  const bumped = String(Number(m[1]) + delta);
  if (bumped.length !== m[1].length) throw new Error('夹具前提：' + key + ' 位数会变');
  out.write(l.footText.slice(0, m.index) + m[0].replace(m[1], bumped) + l.footText.slice(m.index + m[0].length), l.footStart, 'utf8');
}
function mutate(bytes, kind, l) {
  const out = Buffer.from(bytes);
  if (kind === 'magic') { out[0] = out[0] ^ 0xff; return out; }
  if (kind === 'footer-json') { out.write('{{{{', l.footStart, 'utf8'); return out; }
  if (kind === 'not-complete') {
    const m = /"complete"\s*:\s*true/.exec(l.footText);
    if (!m) throw new Error('夹具前提：footer 缺 "complete":true');
    out.write(l.footText.slice(0, m.index) + m[0].replace('true', 'null') + l.footText.slice(m.index + m[0].length), l.footStart, 'utf8');
    return out;
  }
  if (kind === 'footer-count') { bumpFooterNumber(out, l, 'count', 1); return out; }
  if (kind === 'footer-dim') { bumpFooterNumber(out, l, 'dim', 1); return out; }
  if (kind === 'vector-byte') { out[l.footLenOff - 1] = out[l.footLenOff - 1] ^ 0xff; return out; }
  throw new Error('unknown kind ' + kind);
}

// ---------------------------------------------------------------- 子命令

function cmdState() {
  const meta = metaOf(); const items = outItems();
  if (Number(meta.count) !== items.length) throw new Error('meta.count ' + meta.count + ' != items ' + items.length);
  if (items.some((it) => it.vectorRow === undefined || it.vectorRow === null)) throw new Error('out/items.json 缺 vectorRow');
  const bytes = fs.readFileSync(path.join(OUT_DIR, 'index.bin'));
  const rep = writeIndexAtomically(LIB, bytes);
  say('[1] 索引落盘（产品原子写入口）：' + rep.reason);
  const db = openDb();
  try {
    const known = new Set(db.prepare('SELECT uid FROM asset').all().map((r) => r.uid));
    const unknown = items.filter((it) => !known.has(it.uid));
    if (unknown.length) throw new Error('索引里有 asset 不认识的 uid：' + JSON.stringify(unknown.slice(0, 3).map((i) => i.uid)));
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE asset_index_state SET encoded_at_ms = NULL, encoded_mtime_ms = NULL, compat_key = NULL, vector_row = NULL').run();
      const upd = db.prepare('UPDATE asset_index_state SET encoded_at_ms = ?, encoded_mtime_ms = ?, compat_key = ?, vector_row = ? WHERE uid = ?');
      const mtimeOf = db.prepare("SELECT mtime_ms FROM asset_file WHERE uid = ? AND role = 'preview'");
      for (const it of items) {
        const row = mtimeOf.get(it.uid);
        if (!row) throw new Error('asset_file 缺 preview 行：' + it.uid);
        upd.run(now, Number(row.mtime_ms), meta.compat, Number(it.vectorRow), it.uid);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    say('[2] 编码态已写入 ' + items.length + ' 行（encoded_at_ms=' + now + '）');
    const rec = reconcile(db, meta, LIB);
    printRec(rec, meta);
    if (rec.problems.length) process.exit(1);
  } finally { db.close(); }
}

function cmdVerify() {
  const meta = metaOf(); const problems = [];
  const rep = readIndexFile(LIB);
  say('[1] 产品路径读回（引擎五道校验）：count=' + rep.count + ' dim=' + rep.dim + ' bytes=' + rep.bytes);
  if (rep.count !== 100 || rep.dim !== 768) problems.push('索引应为 100×768，实得 ' + rep.count + '×' + rep.dim);
  const bytes = fs.readFileSync(INDEX);
  const l = layoutOf(bytes);
  say('[2] 五道校验逐道破坏（副本；判定全部由产品 readIndexFile 做）');
  const kinds = [['magic', /MAGIC 不符/], ['footer-json', /footer 解析失败/], ['not-complete', /complete 不是 true|写入未完成/], ['footer-count', /footer 与 header 不一致/], ['footer-dim', /footer 与 header 不一致/], ['vector-byte', /sha1 不符/]];
  for (const [kind, pattern] of kinds) {
    const dir = path.join(TMP, kind);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gs-index.bin'), bytes);
    const before = readIndexFile(dir);
    fs.writeFileSync(path.join(dir, '.gs-index.bin'), mutate(bytes, kind, l));
    let err = null; try { readIndexFile(dir); } catch (e) { err = e; }
    const ok = !!err && err.code === 'INDEX_CORRUPT' && pattern.test(err.message);
    say('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + kind + '：破坏前 count=' + before.count + '/' + before.dim + ' · 破坏后 code=' + (err ? err.code : '(无错)') + ' · ' + (err ? err.message.slice(0, 80) : '-'));
    if (!ok) problems.push('五道校验未生效：' + kind);
  }
  const db = openDb({ readOnly: true });
  try {
    say('[3] 对账（索引 ↔ asset_index_state；判定 = ./s3-reconcile.mjs）');
    const rec = reconcile(db, meta, LIB);
    printRec(rec, meta);
    problems.push(...rec.problems);
  } finally { db.close(); }
  say(problems.length ? '结论：FAIL — ' + JSON.stringify(problems) : '结论：PASS（五道校验可生效 · 对账漂移 0）');
  process.exit(problems.length ? 1 : 0);
}

function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); }

async function cmdQuery(modelDir) {
  const { createEngine } = await import('../../packages/engine/src/engine.ts');
  const { createLibraryResolverPort, createStoragePorts } = await import('../../apps/desktop/src/main/storage-ports.ts');
  const { createEncoder } = await import('../../apps/desktop/src/main/encoder.ts');
  const libs = [{ libId: 'L1', root: LIB, label: 'S3 一百条' }];
  const encoder = await createEncoder({ modelDir, seq: 140, device: 'cpu', log: (m) => say('    [enc] ' + m) });
  const engine = createEngine({
    config: { data_dir: path.join(BASE, 'data'), libraries: libs },
    encoder,
    storage: createStoragePorts({ libraries: createLibraryResolverPort({ libraries: libs }) }),
  });
  const r = await engine.search({ mode: 'text', text: '北欧吊灯', topK: 5 });
  say('[1] 真查询（文本「北欧吊灯」）：ok=' + r.ok + (r.ok ? ' · results=' + r.data.results.length + ' · libsUsed=' + JSON.stringify(r.data.libsUsed) : ' · error=' + JSON.stringify(r.error)));
  if (r.ok) for (const x of r.data.results) say('    ' + Number(x.score).toFixed(4) + '  ' + x.uid + '  ' + (x.relPath || ''));
  const db = openDb({ readOnly: true });
  const picks = db.prepare("SELECT s.uid, s.vector_row, f.rel_path FROM asset_index_state s JOIN asset_file f ON f.uid = s.uid AND f.role = 'preview' WHERE s.vector_row IN (0, 50, 99) ORDER BY s.vector_row").all();
  db.close();
  const bin = readIndexBin(INDEX);
  say('[2] 抽样 uid↔row 的向量级核验（重编该条 vs 索引第 vector_row 行）');
  let bad = 0;
  for (const p of picks) {
    const abs = path.join(LIB, ...sep(p.rel_path));
    const v = await encoder.encodeImage(abs);
    const off = Number(p.vector_row) * bin.dim;
    const cos = cosine(v, bin.vectors.subarray(off, off + bin.dim));
    const ok = cos >= 0.999;
    if (!ok) bad++;
    say('    [' + (ok ? 'OK  ' : 'FAIL') + '] row ' + p.vector_row + ' · uid=' + p.uid + ' · cos=' + cos.toFixed(6) + '  ' + p.rel_path);
  }
  process.exit(r.ok && r.data.results.length > 0 && bad === 0 ? 0 : 1);
}

function cmdSabotage(kind) {
  const db = openDb();
  try {
    if (kind === 'vector-row') {
      const r = db.prepare('SELECT uid FROM asset_index_state WHERE vector_row = 0').get();
      if (!r) throw new Error('没有 vector_row = 0 的行');
      db.prepare('UPDATE asset_index_state SET vector_row = 999 WHERE uid = ?').run(r.uid);
      say('已破坏 vector_row：uid=' + r.uid + ' 0 -> 999（对账应报范围/非空不符）');
    } else if (kind === 'mtime') {
      const r = db.prepare("SELECT uid, mtime_ms FROM asset_file WHERE role = 'preview' ORDER BY rel_path LIMIT 1").get();
      db.prepare('UPDATE asset_file SET mtime_ms = ? WHERE uid = ? AND role = \'preview\'').run(Number(r.mtime_ms) + 3600000, r.uid);
      say('已破坏 mtime：uid=' + r.uid + ' 的 asset_file.mtime_ms +1h（needs_reencode 应 = 1）');
    } else if (kind === 'disk-mtime') {
      const r = db.prepare("SELECT uid, rel_path FROM asset_file WHERE role = 'preview' ORDER BY rel_path LIMIT 1").get();
      const p = path.join(LIB, ...sep(r.rel_path));
      const st = fs.statSync(p);
      fs.utimesSync(p, st.atime, new Date(st.mtimeMs + 3600000));
      say('已破坏磁盘 mtime：' + r.rel_path + ' +1h（不动 DB ⇒ stat 漂移应 = 1）');
    } else throw new Error('unknown sabotage kind ' + kind);
  } finally { db.close(); }
}

function cmdRestore(kind) {
  const db = openDb();
  try {
    if (kind === 'vector-row') {
      const n = db.prepare('UPDATE asset_index_state SET vector_row = 0 WHERE vector_row = 999').run().changes;
      say('已还原 vector_row：' + Number(n) + ' 行 999 -> 0');
    } else if (kind === 'mtime') {
      const rows = db.prepare("SELECT uid, rel_path FROM asset_file WHERE role = 'preview'").all();
      const upd = db.prepare('UPDATE asset_file SET mtime_ms = ? WHERE uid = ? AND role = \'preview\'');
      for (const r of rows) upd.run(statMtimeMs(path.join(LIB, ...sep(r.rel_path))), r.uid);
      say('已还原 mtime：' + rows.length + ' 行重置为磁盘口径');
    } else if (kind === 'disk-mtime') {
      const rows = db.prepare("SELECT uid, rel_path, mtime_ms FROM asset_file WHERE role = 'preview'").all();
      let fixed = 0;
      for (const r of rows) {
        const p = path.join(LIB, ...sep(r.rel_path));
        if (statMtimeMs(p) !== Number(r.mtime_ms)) { fs.utimesSync(p, new Date(), new Date(Number(r.mtime_ms))); fixed++; }
      }
      say('已还原磁盘 mtime：' + fixed + ' 个文件对齐到 asset_file.mtime_ms');
    } else throw new Error('unknown restore kind ' + kind);
  } finally { db.close(); }
}

const ARGV = process.argv.slice(2);
const [cmd, arg1] = ARGV;
const modelArg = (() => { const i = ARGV.indexOf('--model'); return i >= 0 ? ARGV[i + 1] : (process.env.GEMMA_ONNX_MODEL || null); })();
fs.mkdirSync(TMP, { recursive: true });
if (cmd === 'state') cmdState();
else if (cmd === 'verify') cmdVerify();
else if (cmd === 'query') { if (!modelArg) { console.error('query 需要 --model <fp32 目录> 或 GEMMA_ONNX_MODEL'); process.exit(2); } await cmdQuery(modelArg); }
else if (cmd === 'sabotage') cmdSabotage(arg1);
else if (cmd === 'restore') cmdRestore(arg1);
else { console.error('用法：node reports/2026-10-15-wave3/s3-verify.mjs state|verify|query|sabotage|restore'); process.exit(2); }

// reports/2026-10-15-wave3/s3-reconcile.mjs —— S3「索引 ↔ asset_index_state」对账的**唯一实现**
//
// 为什么单独一个文件：同一份判定被两处用 —— 可复跑的复核脚本（s3-verify.mjs）与进 npm test 的单测
// （apps/desktop/tests/s3-index-state.test.mjs）。两份 SQL = AGENTS P1（同一概念两份定义），
// 而"两边各自演化"正是对账类检查最典型的失效方式。
//
// 判定口径（全部**算出来**，不物化 —— 设计基线 §1.2：跨表比较物化成列既不能索引又要对账）：
//   · 索引行数 == asset_index_state 行数 == vector_row 非空行数
//   · vector_row ∈ [0, count-1] 且无重复（GSIDX 是**稠密矩阵**：行号就是条目的位置）
//   · needs_reencode = asset_file.mtime_ms ≠ encoded_mtime_ms 或 compat_key ≠ 库 compat
//   · 与磁盘「重新 stat」对账：encoded_mtime_ms == BigInt(mtimeNs)/1e6（与 asset_file 同口径）
//   · 未参与索引的条目 vector_row 必须 NULL（NULL 不是 0）
//
// ⚠️ 本模块只**读**库；破坏性注入是调用方在**副本**上的事（产品夹具不许被测试改）。
import fs from 'node:fs';
import path from 'node:path';

export const MTIME_UNIT = 1_000_000n;
export const sep = (p) => String(p).split(/[\\/]+/);
export const statMtimeMs = (p) => Number(fs.statSync(p, { bigint: true }).mtimeNs / MTIME_UNIT);

/**
 * 对账：db = 已打开的 .gs.db（只读即可）· meta = 索引 header（build_index_onnx 的 meta.json）· libRoot = 库根
 * @returns {{ indexRows:number, total:number, nonNull:number, nullRows:number, dups:unknown[], mm:{mn:unknown,mx:unknown},
 *             pending:number, statDrift:number, statSamples:unknown[], sample:unknown[], last:unknown[], problems:string[] }}
 */
export function reconcile(db, meta, libRoot) {
  const one = (sql, ...p) => Number(db.prepare(sql).get(...p).n);
  const indexRows = Number(meta.count);
  const total = one('SELECT COUNT(*) n FROM asset_index_state');
  const nonNull = one('SELECT COUNT(*) n FROM asset_index_state WHERE vector_row IS NOT NULL');
  const nullRows = one('SELECT COUNT(*) n FROM asset_index_state WHERE vector_row IS NULL');
  const dups = db.prepare('SELECT vector_row, COUNT(*) c FROM asset_index_state WHERE vector_row IS NOT NULL GROUP BY vector_row HAVING c > 1').all();
  const mm = db.prepare('SELECT MIN(vector_row) mn, MAX(vector_row) mx FROM asset_index_state WHERE vector_row IS NOT NULL').get();
  // 待重编码 = **跨表比较**（asset_file.mtime_ms ≠ encoded_mtime_ms 或 compat_key 不同）—— 算出来，不物化
  const pending = one(
    "SELECT COUNT(*) n FROM asset_index_state s JOIN asset_file f ON f.uid = s.uid AND f.role = 'preview'" +
      ' WHERE s.encoded_at_ms IS NULL OR s.encoded_mtime_ms IS NULL OR s.compat_key IS NULL' +
      ' OR f.mtime_ms != s.encoded_mtime_ms OR s.compat_key != ?', meta.compat);
  // 与「重新 stat 文件」对账（同一口径：BigInt mtimeNs/1e6 截断）
  const pv = db.prepare("SELECT s.uid, s.encoded_mtime_ms, f.rel_path FROM asset_index_state s JOIN asset_file f ON f.uid = s.uid AND f.role = 'preview' ORDER BY f.rel_path").all();
  let statDrift = 0; const statSamples = [];
  for (const r of pv) {
    const p = path.join(libRoot, ...sep(r.rel_path));
    if (!fs.existsSync(p)) { statDrift++; if (statSamples.length < 3) statSamples.push({ uid: r.uid, why: '文件不在盘上', rel: r.rel_path }); continue; }
    const disk = statMtimeMs(p);
    if (Number(r.encoded_mtime_ms) !== disk) { statDrift++; if (statSamples.length < 3) statSamples.push({ uid: r.uid, db: Number(r.encoded_mtime_ms), disk }); }
  }
  const sample = db.prepare("SELECT s.uid, s.vector_row, f.rel_path FROM asset_index_state s JOIN asset_file f ON f.uid = s.uid AND f.role = 'preview' WHERE s.vector_row IS NOT NULL ORDER BY s.vector_row LIMIT 5").all();
  const last = db.prepare("SELECT s.uid, s.vector_row, f.rel_path FROM asset_index_state s JOIN asset_file f ON f.uid = s.uid AND f.role = 'preview' WHERE s.vector_row IS NOT NULL ORDER BY s.vector_row DESC LIMIT 1").all();
  const problems = [];
  if (total !== indexRows) problems.push('state 行数 ' + total + ' != 索引行数 ' + indexRows);
  if (nonNull !== indexRows) problems.push('vector_row 非空 ' + nonNull + ' != 索引行数 ' + indexRows);
  if (dups.length) problems.push('vector_row 有重复：' + JSON.stringify(dups.slice(0, 3)));
  if (indexRows && (Number(mm.mn) !== 0 || Number(mm.mx) !== indexRows - 1)) problems.push('vector_row 范围 ' + mm.mn + '..' + mm.mx + ' != 0..' + (indexRows - 1));
  if (pending !== 0) problems.push('needs_reencode(派生) = ' + pending + '（应 0）');
  if (statDrift !== 0) problems.push('与磁盘 stat 漂移 = ' + statDrift + '（应 0）');
  return { indexRows, total, nonNull, nullRows, dups, mm, pending, statDrift, statSamples, sample, last, problems };
}

/** 人读摘要（脚本与单测共用一份文案，避免"两边各写一套说法"） */
export function summarize(rec, meta) {
  const lines = [];
  lines.push('索引行数 = ' + rec.indexRows + ' · dim = ' + meta.dim + ' · compat = ' + meta.compat);
  lines.push('state 行数 = ' + rec.total + ' · vector_row 非空 = ' + rec.nonNull + ' · NULL = ' + rec.nullRows);
  lines.push('vector_row 范围 = ' + rec.mm.mn + '..' + rec.mm.mx + ' · 重复行 = ' + rec.dups.length);
  lines.push('needs_reencode(派生，跨表比较) = ' + rec.pending + ' · 与磁盘 stat 漂移 = ' + rec.statDrift);
  for (const s of rec.sample) lines.push('  row ' + s.vector_row + '  <-  ' + s.uid + '  ' + s.rel_path);
  for (const s of rec.last) lines.push('  row ' + s.vector_row + '  <-  ' + s.uid + '  ' + s.rel_path + '（末行）');
  if (rec.statSamples.length) lines.push('漂移样例 = ' + JSON.stringify(rec.statSamples));
  lines.push(rec.problems.length ? '✗ 对账问题：' + JSON.stringify(rec.problems) : '✓ 对账漂移 = 0');
  return lines;
}

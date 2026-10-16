// reports/2026-10-15-wave3/idx1-api.mjs —— IDX-1 的**端到端**证据脚本（真模型 + 小夹具，不落库）
//
// 为什么要单独一个脚本：`build-index-api.test.mjs` 里跑不起真模型（门禁不能依赖 GPU/模型），
// 所以那组只钉「可 import / 格式 / 取消 / 进度」；**注入写者**与**真编码循环里的取消**必须真跑一次。
// 用法: node reports/2026-10-15-wave3/idx1-api.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildIndex, writeIndexBinFile } from '../../packages/indexer/src/build_index_onnx.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MODEL =
  process.env.GEMMA_IDX1_MODEL ||
  path.join(
    ROOT,
    'model-cache/onnx/embeddinggemma-2/daa72c51243991dfcaf9f9137d2c573d8f7790c0/fp32',
  );
const LIB = path.join(ROOT, 'data/_idx1/lib');
const OUT = path.join(ROOT, 'data/_idx1/out-api');
const OUT2 = path.join(ROOT, 'data/_idx1/out-cancel');
/** 与「改前 CLI 产物」同一时间戳 ⇒ index.bin 应当逐字节可对照 */
const BUILT_AT = '2026-10-16T05:21:12.682Z';

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').toUpperCase();

// ---------------- ① 注入写者 + 进度 ----------------
const events = [];
const written = [];
const writeIndex = (input) => {
  written.push(input);
  // 注入的写者自己决定怎么落盘（这里仍用默认实现，只是**证明了注入点真的被调用**）
  writeIndexBinFile(input);
};
fs.rmSync(OUT, { recursive: true, force: true });
const summary = await buildIndex({
  modelDir: MODEL,
  libRoot: LIB,
  outDir: OUT,
  builtAt: BUILT_AT,
  saveEvery: 3,
  onProgress: (p) => events.push(p),
  writeIndex,
  log: () => {},
});
console.log('PHASES ' + [...new Set(events.map((e) => e.phase))].join(' → '));
console.log('EVENTS ' + events.length);
console.log('ENCODE_LAST ' + JSON.stringify(events.filter((e) => e.phase === 'encode').pop()));
console.log('WRITER_CALLS ' + written.length + ' counts=' + written.map((w) => w.count + '/' + w.dim).join(' '));
if (written.length === 0) {
  console.error('INJECTION_NOT_USED：注入了 writeIndex 却没被调用 —— 注入点没接上（IDX-1 的硬断言）');
  process.exit(1);
}
console.log('INDEX_SHA256 ' + sha256(path.join(OUT, 'index.bin')));
console.log('ITEMS_SHA256 ' + sha256(path.join(OUT, 'items.json')));
console.log('META_SHA256  ' + sha256(path.join(OUT, 'meta.json')));
console.log('SUMMARY ' + JSON.stringify({ ok: summary.ok, dim: summary.dim, failed: summary.failed, reused: summary.reused, scanned: summary.scanned }));

// ---------------- ② 取消（真模型、真编码循环）----------------
/**
 * `opts.abortOnPhase`：该阶段的事件一到就 abort（下一次 checkAbort 立刻抛）；
 * `opts.timerMs`：纯定时中断（结果只作参考，不判死）。
 */
async function cancelRun(label, opts) {
  fs.rmSync(OUT2, { recursive: true, force: true });
  const ac = new AbortController();
  if (opts.timerMs) setTimeout(() => ac.abort(), opts.timerMs);
  const seen = [];
  let err = null;
  try {
    await buildIndex({
      modelDir: MODEL,
      libRoot: LIB,
      outDir: OUT2,
      builtAt: BUILT_AT,
      saveEvery: 0,
      signal: ac.signal,
      onProgress: (p) => {
        seen.push(p);
        if (opts.abortOnPhase && p.phase === opts.abortOnPhase) ac.abort();
      },
      log: () => {},
    });
  } catch (e) {
    err = e;
  }
  const left = ['index.bin', 'items.json', 'meta.json'].filter((n) => fs.existsSync(path.join(OUT2, n)));
  const last = seen[seen.length - 1];
  console.log(
    label +
      ' name=' + (err ? err.name : '(no error)') +
      ' errPhase=' + (err && err.phase ? err.phase : '(n/a)') +
      ' lastEvent=' + (last ? last.phase + ' ' + last.done + '/' + last.total : '(none)') +
      ' artifacts=' + (left.length ? left.join(',') : '(none)'),
  );
}
await cancelRun('CANCEL_AT_MODEL（模型阶段事件里立刻置位）', { abortOnPhase: 'model' });
await cancelRun('CANCEL_AT_ENCODE（编码阶段事件里立刻置位）', { abortOnPhase: 'encode' });
await cancelRun('CANCEL_BY_TIMER(1200ms)（纯定时，仅供参考）', { timerMs: 1200 });
console.log('DONE');

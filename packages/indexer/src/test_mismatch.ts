// test_mismatch.mjs —— 单独验证"扩展名与实际格式不符"的 105 张能否编码
//
// 审查指出：试点 100 条 0 失败**不能证明回退解码生效**，因为试点未必覆盖这类文件。
// 本脚本直接拿这 105 张逐张编码，回答三个问题：
//   1. transformers.js 的 RawImage 能否原生读（按魔数自动识别格式）？
//   2. 不能的话，sharp（libvips，支持 BMP）转 PNG 的回退能否救回来？
//   3. 有没有救不回来的？（若有，A 项"数量=3594"就会直接少这些）
//
// 用法: node test_mismatch.mjs [--device webgpu] [--limit N]

import fs from 'node:fs';
import path from 'node:path';
import { AutoConfig, AutoProcessor, AutoModel, env } from '@huggingface/transformers';
import type { ModelDevice } from './third_party_types.ts';
import { readImageWithFallback, selfTestBmpLayout } from './bmp_decode.ts';

interface EncodedRecord { rel_path: string; pair: string; norm: number }
interface FailedRecord { rel_path: string; pair: string; error: string | null }
interface MismatchResults { native: EncodedRecord[]; fallback: EncodedRecord[]; failed: FailedRecord[] }
interface PairCount { native: number; fallback: number; failed: number }

const argv = process.argv.slice(2);
const arg = (n: string, d?: string): string => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : (d as string); };
const DEVICE = arg('device', 'webgpu');
const LIMIT = parseInt(arg('limit', '0'), 10);
// 模型目录：优先 --model，其次环境变量 GEMMA_ONNX_MODEL；**不在代码里写死本机路径**
const MODEL_DIR = arg('model', process.env.GEMMA_ONNX_MODEL || '');
if (!MODEL_DIR) {
  console.error('需要 --model <ONNX 模型目录>，或设环境变量 GEMMA_ONNX_MODEL');
  console.error('例如: node test_mismatch.mjs --model <config.json 里 model_cache>/onnx/embeddinggemma-2/<revision>/fp32');
  process.exit(2);
}
const LIST = path.join('..', 'data', 'quality', 'extension-mismatch.json');

env.allowLocalModels = true;
env.allowRemoteModels = false;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const log = (...a: unknown[]) => console.log('[test]', ...a);

async function main() {
  if (!fs.existsSync(LIST)) { console.error('缺少清单:', LIST); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  let items = data.items;
  if (LIMIT > 0) items = items.slice(0, LIMIT);
  log(`清单: ${data.mismatch_count} 条（本次 ${items.length} 条）· 分布 ${JSON.stringify(data.by_pair)}`);

  // sharp 作为回退解码器（libvips 支持 BMP）
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch { /* 不再需要，BMP 走 bmp-js */ }

  // 与构建器一致：先跑布局自检
  const st = await selfTestBmpLayout();
  log(`BMP 布局自检通过：校验 ${st.checked} 个像素（${st.size}）`);

  log(`载入模型（device=${DEVICE}, seq=140, fp32）…`);
  const t0 = now();
  const config = await AutoConfig.from_pretrained(MODEL_DIR);
  config.audio_config = null;
  const processor = await AutoProcessor.from_pretrained(MODEL_DIR, { config });
  processor.image_seq_length = 140;
  if (processor.image_processor) {
    processor.image_processor.max_soft_tokens = 140;
    processor.image_processor.image_seq_length = 140;
  }
  const model = await AutoModel.from_pretrained(MODEL_DIR, { config, dtype: 'fp32', device: DEVICE as ModelDevice });
  log(`载入完成 ${((now() - t0) / 1000).toFixed(1)}s`);

  const results: MismatchResults = { native: [], fallback: [], failed: [] };
  const tEnc = now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tag = `${it.ext.slice(1)}→${it.actual}`;
    let img = null, how = 'native', err = null;

    const r = await readImageWithFallback(it.abs_path);
    img = r.image;
    how = r.vectorSourceKind || 'native';
    err = r.error;

    if (!img) {
      results.failed.push({ rel_path: it.rel_path, pair: tag, error: err });
    } else {
      try {
        const inputs = await processor(null, [img]);
        const out = await model.forward(inputs);
        const emb = out.sentence_embedding;
        let norm = 0; for (const v of emb.data) norm += v * v;
        norm = Math.sqrt(norm);
        const rec = { rel_path: it.rel_path, pair: tag, norm: Number(norm.toFixed(6)) };
        (how === 'native' ? results.native : results.fallback).push(rec);
      } catch (e) {
        results.failed.push({ rel_path: it.rel_path, pair: tag, error: 'encode: ' + (e instanceof Error ? e.message : String(e)) });
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === items.length) {
      const secs = (now() - tEnc) / 1000;
      log(`  ${i + 1}/${items.length}  原生 ${results.native.length} · 回退 ${results.fallback.length} · 失败 ${results.failed.length}  (${(secs).toFixed(1)}s)`);
    }
  }

  const ok = results.native.length + results.fallback.length;
  const normBad = [...results.native, ...results.fallback].filter((r) => Math.abs(r.norm - 1) > 0.01);

  log('');
  log('================ 结果 ================');
  log(`  可编码        ${ok} / ${items.length}`);
  log(`    原生解码     ${results.native.length}`);
  log(`    需回退解码   ${results.fallback.length}`);
  log(`  失败          ${results.failed.length}`);
  log(`  范数异常(±0.01 外) ${normBad.length}`);
  if (results.failed.length) {
    log('  失败明细（前 10）:');
    for (const f of results.failed.slice(0, 10)) log(`    ${f.pair}  ${f.rel_path}  ← ${f.error}`);
  }
  const byPair: Record<string, PairCount> = {};
  const slot = (k: string): PairCount => { byPair[k] = byPair[k] || { native: 0, fallback: 0, failed: 0 }; return byPair[k]; };
  for (const r of results.native) slot(r.pair).native++;
  for (const r of results.fallback) slot(r.pair).fallback++;
  for (const r of results.failed) slot(r.pair).failed++;
  log('  按类型:');
  for (const [k, v] of Object.entries(byPair)) log(`    ${k.padEnd(12)} 原生 ${v.native} · 回退 ${v.fallback} · 失败 ${v.failed}`);

  const outPath = path.join('..', 'data', 'quality', 'mismatch-test-result.json');
  fs.writeFileSync(outPath, JSON.stringify({
    tested_at: new Date().toISOString(), device: DEVICE, total: items.length,
    encodable: ok, native: results.native.length, fallback: results.fallback.length,
    failed: results.failed.length, by_pair: byPair,
    norm_out_of_range: normBad.length,
    details: results,
  }, null, 2), 'utf8');
  log(`  → ${outPath}`);
  log('RESULT ' + JSON.stringify({ total: items.length, encodable: ok, native: results.native.length, fallback: results.fallback.length, failed: results.failed.length }));
  process.exit(results.failed.length ? 3 : 0);
}

main().catch((e) => { console.error('[test] 致命:', e); process.exit(1); });

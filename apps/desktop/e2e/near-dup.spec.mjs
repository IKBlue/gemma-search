// apps/desktop/e2e/near-dup.spec.mjs —— U39（PHASH-1b 呈现 · 口径 B）：结果卡「近重复」角标的**真窗口**验证
//
// 为什么需要真窗口：`nearDuplicate` 是**主进程**在检索成功后算出来的（查询图 phash × 结果 .gs.db 里的 phash，
// k=10），渲染层只显示。单测（near-dup.test.mjs）钉判定边界，这里钉"接线 + 显示"：
//   1. 用真实库的索引/条目建一个临时库（同 m0-real 的做法），并**真的编码一次以图搜图**；
//   2. 为了让"近重复"是**确定**的：先启动应用，用主进程的 nativeImage 算出查询图的 dHash，
//      再把**同一个值**写进该 uid 的 `asset_file.phash` ⇒ 距离必然 0 ⇒ 角标必然出现；
//   3. 通过 UX-1c 的粘贴入口（图片文件）触发以图搜，不必点文件选择框。
//
// ⚠️ 依赖真实库（`G:\model` 或 meta.lib_root）+ 模型；缺失时**跳过**（与 m0-real 同一约定）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow } from './helpers/launch.mjs';
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';
import { bgraToGray, dHashHex } from '../src/main/phash.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');
const MODEL_DIR = path.join(
  ROOT,
  'model-cache',
  'onnx',
  'embeddinggemma-2',
  'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  'fp32',
);

/** 在渲染层派发一次带文件的 paste（与 image-intake.spec.mjs 同法：File.path 用 defineProperty 注入） */
async function pasteFile(win, absPath) {
  return win.evaluate(
    ({ absPath, name }) => {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
        type: 'image/jpeg',
      });
      Object.defineProperty(file, 'path', { value: absPath, configurable: true });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
      window.dispatchEvent(ev);
      return dt.files.length;
    },
    { absPath, name: path.basename(absPath) },
  );
}

test('U39 ⭐⭐ 以图搜图 ⇒ 与查询图同源的条目带「近重复」角标（主进程按 k=10 判定）', async () => {
  test.setTimeout(300_000);

  const meta = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'meta.json'), 'utf8'));
  const realRoot = process.env.EVAL_LIB_ROOT || meta.lib_root;
  const missing = [
    ['真实库 items.json', path.join(REAL_LIB, 'items.json')],
    ['真实库 index.bin', path.join(REAL_LIB, 'index.bin')],
    ['模型 onnx/model.onnx', path.join(MODEL_DIR, 'onnx', 'model.onnx')],
  ]
    .filter(([, p]) => !fs.existsSync(p))
    .map(([n]) => n);
  test.skip(missing.length > 0, '缺真实库/模型：' + missing.join(' / '));
  const items = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'items.json'), 'utf8'));
  // 选一条**真实文件存在**的条目：查询图就用它自己的原图（画面一致 ⇒ dHash 必然相同）
  const pick = items.find(
    (it) => it.relPath && fs.existsSync(path.join(realRoot, ...it.relPath.split('\\'))),
  );
  test.skip(!pick, '真实素材文件都不可用：无法构造确定性的"近重复"查询');

  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_neardup-'));
  const libDir = path.join(work, 'lib');
  const userData = path.join(work, 'ud');
  const dataDir = path.join(work, 'data');
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(path.join(REAL_LIB, 'items.json'), path.join(libDir, 'items.json'));
  fs.copyFileSync(path.join(REAL_LIB, 'meta.json'), path.join(libDir, 'meta.json'));
  fs.copyFileSync(path.join(REAL_LIB, 'index.bin'), path.join(libDir, '.gs-index.bin'));
  const dbPath = path.join(libDir, '.gs.db');
  {
    const opened = openGsDb({ dbPath });
    try {
      importItemsFromJson({
        db: opened.db,
        library: { libId: meta.lib_id, root: libDir },
        itemsJsonPath: path.join(libDir, 'items.json'),
        expectedCount: meta.count,
      });
    } finally {
      opened.db.close();
    }
  }
  const cfgPath = path.join(work, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      data_dir: dataDir,
      onnx_model_dir: MODEL_DIR,
      device: 'cpu', // 确定性：不赌 GPU
    }),
    'utf8',
  );

  const app = await launchApp({
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: libDir,
      GEMMA_COLLECT_DIRS: '',
      GEMMA_FAKE: '',
    },
    extraArgs: ['--user-data-dir=' + userData],
  });

  try {
    const win = await firstWindow(app, 60_000);
    const queryAbs = path.join(realRoot, ...pick.relPath.split('\\'));

    // ① 用主进程的 nativeImage 算查询图的 dHash（= 生产解码，与被测路径同一把尺子）
    await expect
      .poll(
        async () => {
          const raw = await app.evaluate(async ({ nativeImage }, p) => {
            const img = nativeImage.createFromPath(p);
            if (img.isEmpty()) return null;
            const small = img.resize({ width: 9, height: 8, quality: 'good' });
            return Array.from(small.toBitmap());
          }, queryAbs);
          return raw ? raw.length : 0;
        },
        { timeout: 30_000, message: '主进程必须能解码查询图（nativeImage 9×8 BGRA）' },
      )
      .toBe(9 * 8 * 4);
    const raw = await app.evaluate(async ({ nativeImage }, p) => {
      const img = nativeImage.createFromPath(p);
      const small = img.resize({ width: 9, height: 8, quality: 'good' });
      return Array.from(small.toBitmap());
    }, queryAbs);
    const queryPhash = dHashHex(bgraToGray(Uint8Array.from(raw)));

    // ② 等启动回填那一趟结束（它只挑 phash IS NULL 的行走；避免与下面的写入互相踩），
    //    再把**同一个哈希**写给这条 uid ⇒ 距离 0（确定性）
    const logPath = path.join(dataDir, '_app.log');
    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(logPath, 'utf8');
          } catch {
            return '';
          }
        },
        { timeout: 60_000, message: '启动回填必须有一趟完成记录（否则 phash 写入可能被回填覆盖）' },
      )
      .toMatch(/\[phash\] 回填完成/);
    {
      const opened = openGsDb({ dbPath });
      try {
        opened.db
          .prepare("UPDATE asset_file SET phash = ? WHERE uid = ? AND role = 'preview'")
          .run(queryPhash, pick.uid);
      } finally {
        opened.db.close();
      }
    }

    // ③ 粘贴这条图片文件 ⇒ 以图搜（UX-1c 的接线）⇒ 主进程标注
    const input = win.locator('#query');
    await expect(input).toBeVisible({ timeout: 30_000 });
    const n = await pasteFile(win, queryAbs);
    expect(n).toBe(1);
    await expect(win.getByText(/搜索结果/)).toBeVisible({ timeout: 120_000 });

    // ④ 同源那条的卡片必须带「近重复」角标；距离放在 title 里（界面不重算阈值）
    const card = win.locator(
      `article.photo-card:has(a[data-testid="card-detail-link"][href*="${pick.uid}"])`,
    );
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    const badge = card.getByTestId('near-dup');
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await expect(badge).toHaveText('近重复');
    // 距离 0（同一个哈希）：这是"确定性"的直接证据
    expect(await badge.getAttribute('data-distance')).toBe('0');
  } finally {
    await app.close();
    for (const d of [work]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    }
  }
});

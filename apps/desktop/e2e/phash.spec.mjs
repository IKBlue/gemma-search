// apps/desktop/e2e/phash.spec.mjs —— PHASH-1a 落地：**真窗口 + 真 nativeImage 解码**的回填
//
// 为什么这条必须是 e2e（不能只靠单测）：
//   · dHash 算法、BGRA→灰度、回填幂等/断点都在 node:test 里（phash.test.mjs P1–P5）；
//   · 但**生产解码器**是 Electron 的 `nativeImage`（Chromium 编解码）—— 单测验不到它。
//     "算法绿、真解码全错"是真实可能的形状（文件头也写着这条边界）。
//
// 本文件钉住四件事（卡面「未落地」清单逐条）：
//   ① 生产解码真的接上了：真实 PNG 回填后 `phash` 非 NULL（16 位小写 hex）；
//   ② 同一张图的**两个尺寸**（64 与 400）dHash 汉明 ≤2（对重采样稳健，而不是"每张图一个随机值"）；
//   ③ 坏图/坏文件 ⇒ **NULL**（**绝不写 0 哈希** —— 0 会让坏图和所有图都像）；
//   ④ 回填由**启动后的后台排程**触发（不是测试手动调），且日志里能看见"完成/坏图计数"（不静默）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import sharp from 'sharp';

import { launchApp, firstWindow } from './helpers/launch.mjs';
// e2e 里 import 主进程 .ts 是可行的（Playwright 转译；m0-real.spec.mjs 已有先例）
import { openGsDb } from '../src/main/db/index.ts';
import { hammingHex } from '../src/main/phash.ts';
// 合成 BMP：`nativeImage` 不支持 BMP（实测），PHASH 解码必须走应用唯一回退解码器
import { makeSyntheticBmp } from '../../../packages/indexer/src/bmp_decode.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const T0 = 1700000000000;

/** 造一张**有方向性图案**的 PNG（纯色图 dHash 恒为 0，测不出"同图两尺寸"）；按比例绘制 ⇒ 缩放后仍同构 */
async function patternPng(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="#1c1c1e"/>
    <rect x="0" y="0" width="${Math.round(size * 0.3)}" height="100%" fill="#f5f5f7"/>
    <circle cx="${Math.round(size * 0.66)}" cy="${Math.round(size * 0.38)}" r="${Math.round(size * 0.2)}" fill="#8e8e93"/>
    <rect x="0" y="${Math.round(size * 0.72)}" width="100%" height="${Math.round(size * 0.18)}" fill="#d1d1d6"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 建一个含 3 条预览行的临时库：两张同图不同尺寸 + 一个坏文件 */
async function buildLib() {
  const root = fs.mkdtempSync(path.join(ROOT, 'data', '_phash-e2e-'));
  fs.mkdirSync(path.join(root, 'VR'), { recursive: true });
  const files = {
    small: path.join(root, 'VR', 'pattern-64.png'),
    large: path.join(root, 'VR', 'pattern-400.png'),
    broken: path.join(root, 'VR', 'broken.png'),
    // 24 位 BI_RGB BMP：nativeImage 解不了 ⇒ 必须走 bmp_decode 回退（真实库里有 20 条这种「.jpg 实为 BMP」）
    bmp: path.join(root, 'VR', 'pattern-synth.bmp'),
  };
  fs.writeFileSync(files.small, await patternPng(64));
  fs.writeFileSync(files.large, await patternPng(400));
  fs.writeFileSync(files.broken, Buffer.from('这不是图片：nativeImage 必须解不出来', 'utf8'));
  fs.writeFileSync(files.bmp, makeSyntheticBmp().buf);

  const dbPath = path.join(root, '.gs.db');
  const opened = openGsDb({ dbPath });
  try {
    const rows = [
      ['aa0000000001', 'VR\\pattern-64.png', files.small, '.png'],
      ['aa0000000002', 'VR\\pattern-400.png', files.large, '.png'],
      ['aa0000000003', 'VR\\broken.png', files.broken, '.png'],
      ['aa0000000004', 'VR\\pattern-synth.bmp', files.bmp, '.bmp'],
    ];
    for (const [uid, rel, abs, ext] of rows) {
      const st = fs.statSync(abs);
      opened.db
        .prepare(
          'INSERT INTO asset (uid, lib_id, folder, stem, display_name, rel_dir, rel_path, discovered_at_ms) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(uid, 'L1', 'VR', path.basename(rel, ext), path.basename(rel), 'VR', rel, T0);
      opened.db
        .prepare(
          "INSERT INTO asset_file (uid, role, rel_path, ext, size_bytes, mtime_ms) VALUES (?, 'preview', ?, ?, ?, ?)",
        )
        .run(uid, rel, ext, st.size, T0);
    }
  } finally {
    opened.db.close();
  }
  return { root, dbPath, files };
}

/** 只读读回预览行的 phash（真窗口那边在写 ⇒ 用 WAL 读者，不抢写锁） */
function readPhash(dbPath) {
  const opened = openGsDb({ dbPath, readOnly: true });
  try {
    const rows = opened.db
      .prepare("SELECT uid, phash FROM asset_file WHERE role = 'preview' ORDER BY uid")
      .all();
    return Object.fromEntries(
      rows.map((r) => [String(r.uid), r.phash === null ? null : String(r.phash)]),
    );
  } finally {
    opened.db.close();
  }
}

test('PHASH-1a 落地 ⭐⭐ 真解码回填：两尺寸同图汉明 ≤2 · BMP 走回退 · 坏图 NULL · 日志不静默', async () => {
  test.setTimeout(180_000);
  const lib = await buildLib();
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_phash-ud-'));
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const cfgPath = path.join(userData, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ data_dir: dataDir }), 'utf8');

  const app = await launchApp({
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: lib.root,
      GEMMA_COLLECT_DIRS: '',
      GEMMA_FAKE: '', // 真实模式：生产解码器才会被用上
    },
    extraArgs: ['--user-data-dir=' + userData],
  });

  try {
    await firstWindow(app); // 窗口起来 ⇒ 渲染层的 IPC 会触发 buildEngine ⇒ 排一次回填

    // ③ 先等**好图**被填上（回填是启动后 1.2 s 排程、逐条处理；坏图会被写成 NULL）
    //    三行"好图" = 两张 PNG + 一张 BMP（BMP 走回退解码器 ⇒ 证明 20 条「.jpg 实为 BMP」也能有 phash）
    await expect
      .poll(
        () => {
          const rows = readPhash(lib.dbPath);
          return ['aa0000000001', 'aa0000000002', 'aa0000000004'].filter(
            (uid) => typeof rows[uid] === 'string' && /^[0-9a-f]{16}$/.test(rows[uid]),
          ).length;
        },
        {
          timeout: 90_000,
          message: '两行 PNG + 一行 BMP 的 phash 必须被回填成 16 位 hex（生产解码 + BMP 回退）',
        },
      )
      .toBe(3);

    const rows = readPhash(lib.dbPath);
    const small = rows['aa0000000001'];
    const large = rows['aa0000000002'];

    // ② 同一张图两个尺寸 ⇒ 汉明距离必须小（≤2）；不同图才会远大于它
    const d = hammingHex(small, large);
    expect(d, '两行都是有效 hex ⇒ 汉明距离不该是未知').not.toBeNull();
    expect(
      d,
      '同一张图 64px 与 400px 的 dHash 汉明距离必须 ≤2（实得 ' + String(d) + '）',
    ).toBeLessThanOrEqual(2);

    // ②b BMP 行：nativeImage 解不了 ⇒ 必须由**唯一回退解码器**补上（否则近重复通道对 20 条形同虚设）
    const bmpHash = rows['aa0000000004'];
    expect(bmpHash, 'BMP 行必须有 phash（走 bmp_decode 回退）').toMatch(/^[0-9a-f]{16}$/);
    expect(bmpHash, 'BMP 的 phash 不许是 0 哈希（0 会让它和所有图都像）').not.toBe(
      '0000000000000000',
    );

    // ④ 回填必须**不静默**：日志里要能看见"完成 + 坏图计数"（nulled=1）
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
        { timeout: 30_000, message: '应用日志里必须出现回填完成记录' },
      )
      .toMatch(/\[phash\] 回填完成/);

    const logText = fs.readFileSync(logPath, 'utf8');
    expect(logText, '好图必须计入 done（3 = 2 PNG + 1 BMP 回退）').toMatch(
      /\[phash\] 回填完成 .*done=3/,
    );
    expect(logText, '坏图必须计入 nulled（不是 failed、更不是被写成 0 哈希）').toMatch(
      /\[phash\] 回填完成 .*nulled=1/,
    );

    // ③ 坏图/坏文件 ⇒ **NULL**，且**绝不是** 0 哈希（0 会让它和所有图都像）
    const broken = rows['aa0000000003'];
    expect(broken, '坏图必须留 NULL（三态：坏图/缺图/未算）').toBeNull();
    expect(broken).not.toBe('0000000000000000');
  } finally {
    await app.close();
    for (const d of [userData, lib.root]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    }
  }
});

// apps/desktop/e2e/m0-real.spec.mjs —— M0 **真窗口**端到端（PLAN 的 M0 判据：启动 → 找到 → 取件）
//
// 与 T-16b 那条"脚本直调引擎"的 M0 实测的区别（这一点很重要，别混）：
//   · T-16b 证明的是**引擎 + 端口调用面**能跑通（node 直调 createEngine）；
//   · 本文件证明的是**整条真窗口链路**：真 Electron 窗口 → 真 preload(contextBridge) → 真 IPC →
//     真 adapter 解包 → 真 store → 真结果区/详情页 → 真 ConfirmDialog → 真主进程 → 真 fs 复制。
//
// 夹具为什么放在**仓库内**（data/_m0-*）：
//   本会话沙箱把 **electron.exe** 的写限制在仓库工作目录内（G:\model / AppData 一律 EPERM，TASKS §5），
//   而 M0 要求"目标目录真的出现文件" ⇒ 只能落在仓库内。**这是环境限制，不是产品落点**：
//   真实用户那里，库根与取件目录都由 T-04 的 storage-roots 解析（GEMMA_LIB_ROOT / 注册表 / config / 自举）。
//
// 素材：按**搜索结果**现落（而不是预先落 3594 条）—— 先搜索、读出结果的 uid，再按 items.json 的 relPath
//   写一份**真 JPEG**（1×1，103 字节）与该条的同名包。真 JPEG 是刻意的：假字节会让 thumb:// 解码失败(415)，
//   那会让"结果区看起来是坏的"，而问题其实在夹具。
//   ⚠️ 没落的那些条目缩略图仍会 415（沙箱里没有它们）—— 这是**夹具现象**，不是产品缺陷；
//     所以本文件只硬断言"没有 pageerror（真的 JS 异常）"，控制台错误原样打印出来当证据。
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow, collectConsoleErrors } from './helpers/launch.mjs';
// ⚠️ e2e 里 import 主进程 .ts 是可行的（Playwright 会转译；实测通过），而且**必须**这么写：
//    .gs.db 要用 **T-11b 的生产导入代码**建，不能在测试里手写 SQL / 造第二份形状。
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');
/** 真模型：T-00 基线用的那一份（meta.json 里的 model_revision） */
const MODEL_DIR = path.join(
  ROOT,
  'model-cache',
  'onnx',
  'embeddinggemma-2',
  'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  'fp32',
);

/** 1×1 白色 JPEG（真图，103 字节）—— 见文件头：假字节会让 thumb:// 415 */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const splitRel = (rel) => String(rel).split('\\');

test('M0 ⭐⭐ 真窗口端到端：启动 → 库就绪 → 检索 → 详情 → 取件（确认框）→ 文件真的出现', async () => {
  test.setTimeout(300_000);

  const missing = [
    ['真实库 items.json', path.join(REAL_LIB, 'items.json')],
    ['真实库 index.bin', path.join(REAL_LIB, 'index.bin')],
    ['真实库 meta.json', path.join(REAL_LIB, 'meta.json')],
    ['模型 onnx/model.onnx', path.join(MODEL_DIR, 'onnx', 'model.onnx')],
  ]
    .filter(([, p]) => !fs.existsSync(p))
    .map(([n]) => n);
  test.skip(missing.length > 0, '缺真实库/模型：' + missing.join(' / ') + ' —— 真窗口 M0 无法执行');

  // ── 夹具：仓库内的库根副本 + .gs.db（生产导入路径）
  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_m0-'));
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_m0-userdata-'));
  const libDir = path.join(work, 'lib');
  const outDir = path.join(work, 'out');
  fs.mkdirSync(libDir, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'meta.json'), 'utf8'));
  const itemsJsonPath = path.join(libDir, 'items.json');
  fs.copyFileSync(path.join(REAL_LIB, 'items.json'), itemsJsonPath);
  fs.copyFileSync(path.join(REAL_LIB, 'meta.json'), path.join(libDir, 'meta.json'));
  fs.copyFileSync(path.join(REAL_LIB, 'index.bin'), path.join(libDir, '.gs-index.bin'));
  const items = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'));
  {
    const opened = openGsDb({ dbPath: path.join(libDir, '.gs.db') });
    try {
      const rep = importItemsFromJson({
        db: opened.db,
        library: { libId: meta.lib_id, root: libDir },
        itemsJsonPath,
        expectedCount: meta.count,
      });
      expect(rep.dbCount, '.gs.db 应当装下全部 ' + String(meta.count) + ' 条').toBe(3594);
    } finally {
      opened.db.close();
    }
  }

  const cfgPath = path.join(work, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      data_dir: path.join(work, 'data'),
      onnx_model_dir: MODEL_DIR,
      device: 'cpu', // 确定性：不赌 GPU 在沙箱里可用
    }),
    'utf8',
  );

  const app = await launchApp({
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: libDir,
      GEMMA_COLLECT_DIRS: 'm0=' + outDir,
      GEMMA_FAKE: '', // 显式置空：父进程若设了 GEMMA_FAKE=1，这条会静默变成模拟模式
    },
    extraArgs: ['--user-data-dir=' + userData],
  });

  try {
    const win = await firstWindow(app, 60_000);
    const consoleErrors = collectConsoleErrors(win);

    // ① 启动 → 主界面（不是首启向导）
    const input = win.locator('#query');
    await expect(input).toBeVisible({ timeout: 30_000 });

    // ② 库就绪 → 检索（真编码器：首次调用才载模型）
    await input.fill('坦克 装甲车');
    await input.press('Enter');
    const cards = win.locator('article.photo-card');
    await expect(win.getByRole('button', { name: '取件' }).first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(win.getByText(/搜索结果/)).toBeVisible();
    const cardCount = await cards.count();
    expect(cardCount, '真库 + 真索引 ⇒ 应当出结果').toBeGreaterThan(0);

    // 从结果卡片的**详情链接 href** 里读 uid（形状 '#/item/<libId>/<uid>'）。
    // ⚠️ 不要读缩略图 src：素材是**读完 uid 之后**才落的，所以此刻缩略图必然加载失败、
    //    PhotoCard 会把 img 换成兜底 div ⇒ 按 img 取 uid 会拿到 0 条（第一版就是这么红的）。
    const uids = await cards.evaluateAll((els) =>
      els
        .slice(0, 5)
        .map((el) => {
          const a = el.querySelector('[data-testid="card-detail-link"]');
          const href = a ? a.getAttribute('href') : null;
          const m = href ? /\/item\/[^/]+\/([^/?#]+)/.exec(href) : null;
          return m ? m[1] : '';
        })
        .filter(Boolean),
    );
    expect(uids.length, '应当能从卡片上读出 uid').toBeGreaterThan(0);

    // 按 items.json 的 relPath 落素材（真 JPEG + 同名包）
    const byUid = new Map(items.map((i) => [i.uid, i]));
    let materialized = 0;
    for (const uid of uids) {
      const it = byUid.get(uid);
      if (!it) continue;
      const img = path.join(libDir, ...splitRel(it.relPath));
      fs.mkdirSync(path.dirname(img), { recursive: true });
      fs.writeFileSync(img, TINY_JPEG);
      materialized += 1;
      if (it.archiveRelPath) {
        const arc = path.join(libDir, ...splitRel(it.archiveRelPath));
        fs.mkdirSync(path.dirname(arc), { recursive: true });
        fs.writeFileSync(arc, Buffer.from('M0-ARCHIVE-' + uid));
      }
    }
    expect(materialized, '至少要落一条素材，取件才有东西可复制').toBeGreaterThan(0);

    // ③ 进详情（点卡片里的详情链接 = 真路由跳转）
    const topUid = uids[0];
    await cards.first().getByTestId('card-detail-link').click();
    await expect
      .poll(() => win.evaluate(() => window.location.hash), { timeout: 10_000 })
      .toContain('/item/');
    expect(await win.evaluate(() => window.location.hash), '详情页必须就是刚点的那一条').toContain(
      topUid,
    );
    await expect(win.locator('img[src*="' + topUid + '@512"]')).toBeVisible({ timeout: 20_000 });

    // ④ 回结果区 → 取件 → 确认框 → 确认
    await win.evaluate(() => window.history.back());
    const collectBtn = win.getByRole('button', { name: '取件' }).first();
    await expect(collectBtn).toBeVisible({ timeout: 20_000 });
    await collectBtn.click();
    const dialog = win.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('把这套素材取件？');
    await dialog.getByRole('button', { name: '取件' }).click();

    // ⑤ 目标目录真的出现文件，且**字节与源一致**（M0 判据②）
    const it = byUid.get(topUid);
    const srcRel = it.archiveRelPath || it.relPath;
    const srcAbs = path.join(libDir, ...splitRel(srcRel));
    const destAbs = path.join(outDir, path.basename(srcAbs));
    await expect.poll(() => fs.existsSync(destAbs), { timeout: 20_000 }).toBe(true);
    const srcSha = sha1(fs.readFileSync(srcAbs));
    const destSha = sha1(fs.readFileSync(destAbs));
    expect(destSha, '取出的字节必须与源一致').toBe(srcSha);

    console.log('[M0] 结果条数 =', cardCount, '· 命中 uid =', topUid, '· relPath =', it.relPath);
    console.log(
      '[M0] 取件落点 =',
      destAbs,
      '· 字节 =',
      fs.statSync(destAbs).size,
      '· sha1 =',
      destSha,
    );
    console.log('[M0] 目标目录内容 =', JSON.stringify(fs.readdirSync(outDir)));
    console.log('[M0] 库根内容 =', JSON.stringify(fs.readdirSync(libDir).sort()));
    console.log(
      '[M0] 控制台错误（未落素材的那些缩略图 415 属夹具现象）=',
      JSON.stringify(consoleErrors),
    );
    expect(
      consoleErrors.filter((e) => e.startsWith('pageerror')),
      '不许有真的 JS 异常',
    ).toEqual([]);
  } finally {
    await app.close();
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

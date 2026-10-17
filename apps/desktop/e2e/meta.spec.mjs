// apps/desktop/e2e/meta.spec.mjs —— WIRE-C 第 2 段：**真窗口持久化**（评分/备注/收藏）
//
// 要证的是**持久化**（不是只改内存）：打分 → 重开详情页仍在；取消收藏 → 再开仍取消；
//  **空备注再保存后仍是空串**（不是 null，M3 在真窗口的对应物）。
// 另证 **DB_MISSING 分支**：把 .gs.db 删掉后，界面显示「标注不可用」且**不渲染成"未评分/未收藏"**。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow } from './helpers/launch.mjs';
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');

test('WIRE-C ⭐⭐ 真窗口：评分/收藏/空备注**持久化**（重开详情页仍在）+ 缺库显示"标注不可用"', async () => {
  test.setTimeout(180_000);
  const missing = ['items.json', 'meta.json'].filter((f) => !fs.existsSync(path.join(REAL_LIB, f)));
  test.skip(missing.length > 0, '缺真实库夹具：' + missing.join('/'));

  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_wirec-'));
  const userData = fs.mkdtempSync(path.join(ROOT, 'data', '_wirec-userdata-'));
  const libDir = path.join(work, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'meta.json'), 'utf8'));
  const itemsJsonPath = path.join(libDir, 'items.json');
  fs.copyFileSync(path.join(REAL_LIB, 'items.json'), itemsJsonPath);
  fs.copyFileSync(path.join(REAL_LIB, 'meta.json'), path.join(libDir, 'meta.json'));
  // 详情页要能取到条目（item 走引擎索引）⇒ 旧布局 index.bin 补成 .gs-index.bin（与 health E13-d 同一做法）
  const legacyIndex = path.join(REAL_LIB, 'index.bin');
  if (fs.existsSync(legacyIndex)) fs.copyFileSync(legacyIndex, path.join(libDir, '.gs-index.bin'));
  const items = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'));
  const first = (Array.isArray(items) ? items : items.items)[0];
  const uid = String(first.uid);
  const dbPath = path.join(libDir, '.gs.db');
  {
    const opened = openGsDb({ dbPath });
    try {
      importItemsFromJson({
        db: opened.db,
        library: { libId: meta.lib_id, root: libDir },
        itemsJsonPath,
        expectedCount: meta.count,
      });
    } finally {
      opened.db.close();
    }
  }
  const cfgPath = path.join(work, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ data_dir: path.join(work, 'data'), device: 'cpu' }),
    'utf8',
  );
  const app = await launchApp({
    env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: libDir, GEMMA_FAKE: '', GEMMA_FAKE_INDEX: '' },
    extraArgs: ['--user-data-dir=' + userData],
  });
  try {
    const win = await firstWindow(app, 60_000);
    const openDetail = async () => {
      await win.evaluate(
        (h) => {
          window.location.hash = h;
        },
        '#/item/' + meta.lib_id + '/' + uid,
      );
      await expect(win.getByTestId('meta-block')).toBeVisible({ timeout: 30_000 });
    };
    await expect(win.getByTestId('search-sidebar').or(win.locator('body'))).toBeVisible({
      timeout: 20_000,
    });
    await openDetail();

    // ① 评分：点 4 星 ⇒ 显示 4/5；**重开详情页**（reload + 重新导航）仍在
    await win.getByTestId('meta-rate-4').click();
    await expect(win.getByTestId('meta-rating-text')).toHaveText('4 / 5', { timeout: 20_000 });
    await win.reload();
    await openDetail();
    await expect(win.getByTestId('meta-rate-4')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20_000,
    });

    // ② 收藏：点收藏 ⇒ 已收藏；重开仍在；再点取消 ⇒ 未收藏；再重开仍取消
    await win.getByTestId('meta-favorite').click();
    await expect(win.getByTestId('meta-favorite')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20_000,
    });
    await win.reload();
    await openDetail();
    await expect(win.getByTestId('meta-favorite')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20_000,
    });
    await win.getByTestId('meta-favorite').click();
    await expect(win.getByTestId('meta-favorite')).toHaveAttribute('aria-pressed', 'false', {
      timeout: 20_000,
    });
    await win.reload();
    await openDetail();
    await expect(win.getByTestId('meta-favorite')).toHaveAttribute('aria-pressed', 'false', {
      timeout: 20_000,
    });

    // ③ 备注：先写一段再**清空保存** ⇒ 重开后仍是**空串**（不是 null ⇒ 标签显示"已清空"）
    await win.getByTestId('meta-note').fill('写一段备注');
    await win.getByTestId('meta-note-save').click();
    await expect(win.getByTestId('meta-note')).toHaveValue('写一段备注', { timeout: 20_000 });
    await win.getByTestId('meta-note').fill('');
    await win.getByTestId('meta-note-save').click();
    await win.reload();
    await openDetail();
    await expect(win.getByTestId('meta-note')).toHaveValue('', { timeout: 20_000 });
    await expect(win.getByTestId('meta-note-row')).toContainText('已清空', { timeout: 20_000 });

    // ④ DB_MISSING 分支：**必须先关掉应用**（Windows 上应用占着 .gs.db，删不掉 ⇒ EBUSY），
    //    删库后**再开一次**真窗口 ⇒ 界面必须显示「标注不可用」，且不渲染评分/收藏控件。
    await app.close();
    for (const f of fs.readdirSync(libDir)) {
      if (f === '.gs.db' || f.startsWith('.gs.db-'))
        fs.rmSync(path.join(libDir, f), { force: true });
    }
    const app2 = await launchApp({
      env: { GEMMA_CONFIG: cfgPath, GEMMA_LIB_ROOT: libDir, GEMMA_FAKE: '', GEMMA_FAKE_INDEX: '' },
      extraArgs: ['--user-data-dir=' + userData],
    });
    try {
      const win2 = await firstWindow(app2, 60_000);
      await win2.evaluate(
        (h) => {
          window.location.hash = h;
        },
        '#/item/' + meta.lib_id + '/' + uid,
      );
      await expect(win2.getByTestId('meta-unavailable')).toBeVisible({ timeout: 30_000 });
      await expect(win2.getByTestId('meta-rate-4')).toHaveCount(0, { timeout: 10_000 });
      await expect(win2.getByTestId('meta-favorite')).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await app2.close();
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

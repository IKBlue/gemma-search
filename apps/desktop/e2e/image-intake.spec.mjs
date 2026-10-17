// apps/desktop/e2e/image-intake.spec.mjs —— UX-1c：拖拽 / 粘贴入窗 ⇒ 以图搜（真窗口，模拟模式）
//
// 为什么这组必须存在：拖拽与粘贴是**事件接线**（window 级监听 + File.path + 立即检索），
// 单测只能覆盖判定纯函数（image-intake.test.mjs U1–U6）；"事件真的挂上了没有"只能真窗口验。
//
// 判定之外的三个验收点（卡面）：
//   ① 图片文件被收下 ⇒ 切到以图搜、显示文件名、**立刻发起检索**；
//   ② 非图片 ⇒ 明确拒绝 + 可行动理由（不是静默无反应）；
//   ③ 剪贴板位图（是图片但没有文件路径）⇒ 如实拒绝并告诉用户"先保存成文件"（这类输入需要新 IPC，未获批）。
//
// ⚠️ 事件里的 `File.path` 是 Electron 在生产里**由 OS 提供**的；本 spec 用 `Object.defineProperty`
//    注入它来复现"从资源管理器拖/复制文件"的形状（浏览器沙箱里造不出真的 OS 拖拽）。
//    这是对**渲染层接线**的验证；OS→Chromium 的 File.path 本身由既有"以图搜图"选文件路径长期覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { launchFake } from './helpers/app.mjs';
import { firstWindow } from './helpers/launch.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * 在渲染层派发一次带文件的 drop / paste 事件。
 * @param files `[{name, type, path?}]` —— 没有 `path` 就模拟"剪贴板位图"（File 没有真实路径）
 */
async function dispatchFiles(win, eventName, files) {
  return win.evaluate(
    ({ eventName, files }) => {
      const ev = new Event(eventName, { bubbles: true, cancelable: true });
      const dt = new DataTransfer();
      for (const f of files) {
        const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], f.name, {
          type: f.type,
        });
        if (typeof f.path === 'string') {
          Object.defineProperty(file, 'path', { value: f.path, configurable: true });
        }
        dt.items.add(file);
      }
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
      window.dispatchEvent(ev);
      return { types: Array.from(dt.types), count: dt.files.length };
    },
    { eventName, files },
  );
}

/** 造一个真实存在的临时图片文件（只用于给事件一个"真实绝对路径"） */
function makeTempImage(name) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'data', '_ux1c-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { path: p, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const query = (win) => win.locator('#query');
const toast = (win) => win.locator('#toast');

test('CI-1 ⭐⭐ 粘贴**图片文件** ⇒ 切到以图搜 + 显示文件名 + 立刻出结果', async () => {
  const { app, cleanup } = await launchFake();
  const img = makeTempImage('intake-e2e.png');
  try {
    const win = await firstWindow(app);
    await expect(query(win)).toBeVisible({ timeout: 20_000 });

    const meta = await dispatchFiles(win, 'paste', [
      { name: 'intake-e2e.png', type: 'image/png', path: img.path },
    ]);
    expect(meta.count, '事件里必须真的带上一个 File').toBe(1);
    expect(meta.types).toContain('Files');

    // 以图搜模式：占位符变成"已选参考图：<文件名>"
    await expect(query(win)).toHaveAttribute('placeholder', /已选参考图：intake-e2e\.png/);
    // 立刻检索：模拟模式固定出结果
    await expect(win.getByText('搜索结果')).toBeVisible({ timeout: 20_000 });
    await expect(win.locator('article.photo-card').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
    cleanup();
    img.cleanup();
  }
});

test('CI-2 ⭐⭐ 拖拽**图片文件**（drop 事件）⇒ 同一条接线生效并立刻检索', async () => {
  const { app, cleanup } = await launchFake();
  const img = makeTempImage('dropped.png');
  try {
    const win = await firstWindow(app);
    await expect(query(win)).toBeVisible({ timeout: 20_000 });

    await dispatchFiles(win, 'drop', [{ name: 'dropped.png', type: 'image/png', path: img.path }]);
    await expect(query(win)).toHaveAttribute('placeholder', /已选参考图：dropped\.png/);
    await expect(win.getByText('搜索结果')).toBeVisible({ timeout: 20_000 });
  } finally {
    await app.close();
    cleanup();
    img.cleanup();
  }
});

test('CI-3 ⭐ 非图片 ⇒ 明确拒绝（alert 提示，含支持的类型与被拒文件名），且不进入以图搜', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await expect(query(win)).toBeVisible({ timeout: 20_000 });

    await dispatchFiles(win, 'paste', [
      { name: 'notes.txt', type: 'text/plain', path: 'X:\\tmp\\notes.txt' },
    ]);
    await expect(toast(win)).toHaveClass(/err/);
    await expect(toast(win)).toContainText('不是图片');
    await expect(toast(win)).toContainText('jpg');
    await expect(toast(win)).toContainText('notes.txt');
    // 没有切到以图搜：占位符仍是文字检索的提示
    await expect(query(win)).toHaveAttribute('placeholder', /试试：/);
  } finally {
    await app.close();
    cleanup();
  }
});

test('CI-4 ⭐⭐ 剪贴板位图（图片但**没有文件路径**）⇒ 如实拒绝 + 告诉用户先保存成文件', async () => {
  const { app, cleanup } = await launchFake();
  try {
    const win = await firstWindow(app);
    await expect(query(win)).toBeVisible({ timeout: 20_000 });

    await dispatchFiles(win, 'paste', [{ name: 'clipboard.png', type: 'image/png' }]);
    await expect(toast(win)).toHaveClass(/err/);
    await expect(toast(win)).toContainText('保存成文件');
    await expect(toast(win)).toContainText('不是文件');
    // 仍然没有进入以图搜（没有可用的 queryImagePath，不许假装能搜）
    await expect(query(win)).toHaveAttribute('placeholder', /试试：/);
  } finally {
    await app.close();
    cleanup();
  }
});

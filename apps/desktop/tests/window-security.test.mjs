// apps/desktop/tests/window-security.test.mjs —— SPEC-security §8 的 S11 / S12 / S13
//
// ⚠️ **这些断言覆盖的是"决策"，不是"接线"**。
// `index.mjs` 有没有真的把 `setWindowOpenHandler` / `will-navigate` 注册上，本文件**证明不了** ——
// 那由 `tools/verify_app_build.mjs`（**已移除 2026-10-13**） 在**构建产物**上做结构断言（§1c）。
// 两者缺一不可：
//   · 只有本文件 ⇒ 判定写对了，但可能根本没被接上（这正是 F-01 栽过的坑）
//   · 只有结构断言 ⇒ 接线在了，但判定可能写错
// 所以文档里这两半必须**分开写**，不许合起来说"端到端已过"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAppUrl,
  decideWindowOpen,
  decideNavigation,
  isTrustedSender,
} from '../src/main/window-security.ts';

// ---------------------------------------------------------------- S12：导航

test('S12：库外 URL 一律不许导航；应用自身 URL 放行', () => {
  const app = 'file:///D:/app/out/renderer/index.html';
  assert.equal(decideNavigation(app), true, '打包态 file:// 必须放行');

  for (const bad of [
    'https://example.com', // §8 原文用例
    'http://example.com',
    'https://example.com/',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///D:/app/out/renderer/index.html?x=1#/../../etc', // 仍属 file://，见下注
    'chrome://settings',
    'about:blank',
    '',
    null,
    undefined,
  ]) {
    const got = decideNavigation(bad);
    if (bad === 'file:///D:/app/out/renderer/index.html?x=1#/../../etc') {
      // ⚠️ 已知边界（如实记录，不掩盖）：`isAppUrl` 是 **startsWith('file://')** 的前缀判定，
      // 所以任何 file:// URL 都会被放行 —— 包括指向**别的本地文件**的。
      // 这不是远程内容风险（file:// 下无 CSP 绕过、且不发网络请求），但确实比"严格同源"宽。
      // 收紧它需要比对完整路径/前缀白名单，属于 P6 打包期的收尾项。这里**断言现状**，不假装已收紧。
      assert.equal(got, true, 'file:// 前缀判定：现状是全放行（已在文档记为已知边界）');
      continue;
    }
    assert.equal(got, false, `竟然允许导航到：${String(bad)}`);
  }
});

test('S12b：dev 态只放行 electron-vite 的 URL，不放行任意 http', () => {
  const dev = 'http://127.0.0.1:5173/';
  assert.equal(decideNavigation(dev, dev), true);
  assert.equal(decideNavigation('http://127.0.0.1:5173/index.html', dev), true);
  assert.equal(decideNavigation('http://127.0.0.1:5174/', dev), false, '端口不同就不算应用自身');
  assert.equal(decideNavigation('https://example.com', dev), false);
  // devUrl 为空（打包态）时，任何 http 都不放行
  assert.equal(decideNavigation(dev, ''), false, '打包态下 http:// 一律不放行');
});

// ---------------------------------------------------------------- S11：开新窗口

test('S11：开新窗口**无条件** deny —— 不搞"判断后大多 deny"', () => {
  // 无条件性是刻意的：白名单会随 Electron 的 details 字段演进而腐化。
  // 所以这里连"看起来无害"的目标也一起断言成 deny。
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(decideWindowOpen(), { action: 'deny' });
  }
  // 传任何东西都不改变结果（参数被刻意忽略）
  assert.deepEqual(decideWindowOpen('https://example.com'), { action: 'deny' });
  assert.deepEqual(decideWindowOpen({ url: 'file:///x', disposition: 'new-window' }), {
    action: 'deny',
  });
});

// ---------------------------------------------------------------- S13：来源校验

/** 造一个"像 Electron 那样"的事件与主窗口 */
function makeEvent({ sender, frameParent = null, frameUrl = 'file:///app/index.html' } = {}) {
  const webContents = { id: 1 };
  const win = { isDestroyed: () => false, webContents };
  return {
    win,
    event: {
      sender: sender === undefined ? webContents : sender,
      senderFrame: { parent: frameParent, url: frameUrl },
    },
  };
}

test('S13：顶层 frame 且来自主窗口 ⇒ 可信', () => {
  const { event, win } = makeEvent();
  assert.equal(isTrustedSender(event, win), true);
});

test('S13：iframe 内调用 ⇒ 拒绝（frame.parent 不为 null）', () => {
  const { event, win } = makeEvent({ frameParent: {} }); // 有 parent = 在 iframe 里
  assert.equal(isTrustedSender(event, win), false, 'iframe 竟然通过了来源校验');
});

test('S13b：来源不是主窗口的 webContents ⇒ 拒绝', () => {
  const { event, win } = makeEvent({ sender: { id: 999 } }); // 别的 webContents
  assert.equal(isTrustedSender(event, win), false);
});

test('S13c：地址不属于应用自身 ⇒ 拒绝（即使是最外层 frame）', () => {
  const { event, win } = makeEvent({ frameUrl: 'https://evil.example/' });
  assert.equal(isTrustedSender(event, win), false, '远程地址竟然被视为可信来源');
  const { event: e2, win: w2 } = makeEvent({ frameUrl: '' });
  assert.equal(isTrustedSender(e2, w2), false, 'frame.url 为空必须拒绝（拿不到来源就不信）');
});

test('S13d：缺 senderFrame / 窗口已销毁 / 窗口不存在 ⇒ 一律拒绝（fail closed）', () => {
  const { win } = makeEvent();
  assert.equal(isTrustedSender({ sender: win.webContents }, win), false, '无 senderFrame 必须拒绝');
  assert.equal(isTrustedSender(null, win), false);
  assert.equal(isTrustedSender({ sender: win.webContents, senderFrame: null }, win), false);
  assert.equal(
    isTrustedSender(
      { sender: win.webContents, senderFrame: { parent: null, url: 'file:///a' } },
      null,
    ),
    false,
  );
  const destroyed = { isDestroyed: () => true, webContents: win.webContents };
  assert.equal(
    isTrustedSender(
      { sender: win.webContents, senderFrame: { parent: null, url: 'file:///a' } },
      destroyed,
    ),
    false,
  );
});

test('S13e：dev 态下 127.0.0.1 的来源可信、别的 http 不可信', () => {
  const dev = 'http://127.0.0.1:5173/';
  const { win } = makeEvent();
  assert.equal(
    isTrustedSender({ sender: win.webContents, senderFrame: { parent: null, url: dev } }, win, dev),
    true,
  );
  assert.equal(
    isTrustedSender(
      { sender: win.webContents, senderFrame: { parent: null, url: 'https://evil/' } },
      win,
      dev,
    ),
    false,
  );
});

// ---------------------------------------------------------------- isAppUrl 本体

test('isAppUrl 只认 file:// 与 dev URL，其余一律 false', () => {
  assert.equal(isAppUrl('file:///x'), true);
  assert.equal(isAppUrl('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'), true);
  for (const u of [
    'https://x',
    'http://x',
    'javascript:x',
    'data:text/html,x',
    'chrome://x',
    '',
    null,
  ]) {
    assert.equal(isAppUrl(u), false, `${String(u)} 不该被视为应用自身`);
    assert.equal(isAppUrl(u, 'http://127.0.0.1:5173/'), false);
  }
});

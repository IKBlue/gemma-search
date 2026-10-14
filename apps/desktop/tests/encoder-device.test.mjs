// apps/desktop/tests/encoder-device.test.mjs —— T-31：设备语义（请求 / 实际 / 已验证 EP）的逐条钉死
//
// 为什么这些用例值钱：U2 核查（reports/2026-10-15-wave3/u2.txt）证明过"device 字段被两义使用"
// 与"日志文案看起来像证据其实不是"。这里的每一条都对应那个坑的一种情形。
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDevice, UNPROBED } from '../src/main/encoder-device.ts';

const WEBGPU_OK = { available: true, detail: 'requestAdapter 返回了适配器' };
const WEBGPU_NO = { available: false, detail: 'requestAdapter 返回 null（没有可用适配器）' };
const UNKNOWN = { available: null, detail: '探测超时' };

test('D1 请求 cpu ⇒ 一定 cpu；**探测结果不影响它**（三种探测都一样）', () => {
  for (const probe of [UNPROBED, WEBGPU_OK, WEBGPU_NO, UNKNOWN]) {
    const d = decideDevice('cpu', probe);
    assert.equal(d.device, 'cpu');
    assert.equal(d.fallback, null, '请求 cpu 不产生"回退"');
    assert.equal(d.effectiveProvider, 'cpu', 'cpu -> "cpu" 是映射表事实 + u2 实测');
  }
});

test('D2 ⭐ 请求 webgpu + 探测明确说不可用 ⇒ 直接用 cpu 并记回退（不报 webgpu）', () => {
  const d = decideDevice('webgpu', WEBGPU_NO);
  assert.equal(d.device, 'cpu');
  assert.equal(d.fallback.from, 'webgpu');
  assert.equal(d.fallback.to, 'cpu');
  assert.match(d.fallback.reason, /本机 GPU 不可用/);
  assert.equal(d.effectiveProvider, 'cpu');
  assert.match(d.note, /不把 cpu 说成 webgpu/);
});

test('D3 请求 webgpu + 探测到适配器 ⇒ webgpu，且 EP 标为已验证', () => {
  const d = decideDevice('webgpu', WEBGPU_OK);
  assert.equal(d.device, 'webgpu');
  assert.equal(d.fallback, null);
  assert.equal(d.effectiveProvider, 'webgpu');
});

test('D4 ⭐⭐ 请求 webgpu + 探测**没结论** ⇒ effectiveProvider 必须是 null（不许猜）', () => {
  for (const probe of [UNPROBED, UNKNOWN]) {
    const d = decideDevice('webgpu', probe);
    assert.equal(d.device, 'webgpu', '没结论时保留请求值，行为不变');
    assert.equal(d.fallback, null);
    assert.equal(d.effectiveProvider, null, '**拿不到就 null** —— 这是本任务的核心断言');
    assert.match(d.note, /未验证/);
  }
});

test('D5 护栏路径：不传 probe（= UNPROBED）与 available=null 同形 ⇒ 行为与改动前一致', () => {
  const a = decideDevice('webgpu');
  const b = decideDevice('webgpu', UNPROBED);
  assert.deepEqual(a, b);
  assert.equal(a.device, 'webgpu');
  assert.equal(a.effectiveProvider, null);
});

test('D6 UNPROBED 是冻结的单例，且 available 就是 null', () => {
  assert.equal(UNPROBED.available, null);
  assert.ok(Object.isFrozen(UNPROBED));
});

test('D7 回退理由必须**原样带上**探测给的话（不许吞掉"为什么"）', () => {
  const d = decideDevice('webgpu', { available: false, detail: '渲染进程里没有 navigator.gpu' });
  assert.match(d.fallback.reason, /渲染进程里没有 navigator\.gpu/);
});

test('D8 契约外的设备值 ⇒ 原样透传，绝不悄悄改成 webgpu', () => {
  const d = decideDevice('cuda', WEBGPU_OK);
  assert.equal(d.device, 'cuda');
  assert.equal(d.fallback, null);
  assert.equal(d.effectiveProvider, null, '不知道它的 EP ⇒ null');
  assert.match(d.note, /契约外/);
});

test('D9 requested 永远原样保留（界面靠它区分"请求"与"实际"）', () => {
  for (const req of ['cpu', 'webgpu']) {
    assert.equal(decideDevice(req, WEBGPU_NO).requested, req);
    assert.equal(decideDevice(req, WEBGPU_OK).requested, req);
  }
});

test('D10 ⭐ 只有"探测明确 false"才会把 webgpu 变成 cpu；null 不会', () => {
  assert.equal(decideDevice('webgpu', { available: false, detail: 'x' }).device, 'cpu');
  assert.equal(decideDevice('webgpu', { available: null, detail: 'x' }).device, 'webgpu');
  assert.equal(decideDevice('webgpu', { available: true, detail: 'x' }).device, 'webgpu');
});

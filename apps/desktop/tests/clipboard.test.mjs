// apps/desktop/tests/clipboard.test.mjs —— UX-1b：复制到剪贴板的唯一实现（Operation 层，纯 Node 可测）
//
// 为什么能这么测：`utils/clipboard.ts` 的两条能力都是**注入**的（writeText / legacyCopy），
// 所以「成功 / 权限被拒后走降级 / 两条都失败」都能在 node:test 里逐条钉住 —— 不需要 jsdom、不需要假浏览器。
//
// 这一组要钉住的是**判据本身**，尤其是四件容易做错的事：
//   C1 成功时传进去的文本必须**逐字相同**（路径被截断/改写就等于复制错了东西）；
//   C2 现代路径被拒 ⇒ **必须**试降级路径（很多环境里 clipboard 权限被拒而 execCommand 仍可用）；
//   C3 两条都失败 ⇒ **ok:false + reason 非空**（不许静默假装成功 —— P6）；
//   C4 空串/非字符串 ⇒ 直接拒绝，且**一次都不调用**剪贴板（"复制了空内容"对用户毫无意义）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copyText, resolveCopyDeps } from '../src/renderer/src/utils/clipboard.ts';

/** 记录调用次数的假 writeText */
function spyWriteText(impl = async () => {}) {
  const calls = [];
  return {
    calls,
    writeText: (text) => {
      calls.push(text);
      return impl(text);
    },
  };
}

test('C1 ⭐ 成功：写进剪贴板的文本与传入**逐字相同**，且只说成功', async () => {
  const w = spyWriteText();
  const r = await copyText('Z:\\lib\\VR\\VR-101.jpg', { writeText: w.writeText });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(w.calls, ['Z:\\lib\\VR\\VR-101.jpg'], '复制的必须就是原文本（不许截断/改写）');
});

test('C2 ⭐ 现代路径被拒 ⇒ 走降级路径，且降级拿到的是**同一段文本**', async () => {
  const w = spyWriteText(async () => {
    throw new Error('NotAllowedError: clipboard 权限被拒');
  });
  const legacyCalls = [];
  const r = await copyText('Z:\\lib\\CR\\CR-9.rar', {
    writeText: w.writeText,
    legacyCopy: (text) => {
      legacyCalls.push(text);
      return true;
    },
  });
  assert.deepEqual(r, { ok: true }, '降级成功 ⇒ 整体算成功');
  assert.equal(w.calls.length, 1, '现代路径先试过一次');
  assert.deepEqual(legacyCalls, ['Z:\\lib\\CR\\CR-9.rar'], '降级路径必须是同一段文本');
});

test('C3 ⭐ 两条路径都失败 ⇒ ok:false + reason 非空（不许静默假装成功）', async () => {
  const r1 = await copyText('x', {
    writeText: async () => {
      throw new Error('权限被拒');
    },
    legacyCopy: () => false,
  });
  assert.equal(r1.ok, false);
  // 降级明确返回 false ⇒ 说"浏览器拒绝"，而不是把现代路径的原因张冠李戴
  assert.match(r1.reason, /拒绝/);
  assert.ok(r1.reason.length > 0);

  const r2 = await copyText('x', {
    writeText: async () => {
      throw new Error('权限被拒');
    },
  });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /权限被拒/, '没有降级路径时，原因要说出现代路径的失败原因');
});

test('C4 ⭐⭐ 空串/非字符串 ⇒ 直接拒绝，且**一次都不调用**剪贴板', async () => {
  const w = spyWriteText();
  for (const bad of ['', undefined, null, 42, {}]) {
    const r = await copyText(bad, { writeText: w.writeText });
    assert.equal(r.ok, false, `in=${JSON.stringify(bad)} 必须拒绝`);
    assert.ok(r.reason.length > 0);
  }
  assert.equal(
    w.calls.length,
    0,
    '没有内容时不许去碰剪贴板（"复制成功但什么都没进去"是最坏的一种假成功）',
  );
});

test('C5 降级路径抛错 ⇒ ok:false + reason 非空（异常不许漏给调用方）', async () => {
  const r = await copyText('x', {
    writeText: async () => {
      throw new Error('也失败了');
    },
    legacyCopy: () => {
      throw new Error('execCommand 炸了');
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /execCommand 炸了/);
});

test('C6 纯 Node（无 navigator.clipboard / document）⇒ 默认依赖下**如实失败**，不抛', () => {
  const deps = resolveCopyDeps();
  // 断言"环境里有什么"这一步必须存在：否则这条测试在带 DOM 的环境里会变成空断言
  assert.equal(typeof deps.legacyCopy, 'undefined', '纯 Node 没有 document ⇒ 不许伪造降级能力');
  assert.equal(
    typeof deps.writeText,
    'undefined',
    '纯 Node 没有 navigator.clipboard ⇒ 不许伪造现代能力',
  );
  // 不 await 一个可能抛的 promise：本函数约定永不抛
  const p = copyText('x', {});
  assert.equal(typeof p.then, 'function');
  return p.then((r) => {
    assert.equal(r.ok, false);
    assert.match(r.reason, /剪贴板|可复制/);
  });
});

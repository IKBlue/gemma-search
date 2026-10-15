// apps/desktop/tests/ipc-contract-s6.test.mjs —— S6：契约**重列**的精确清单（2026-10-15 设计基线 §2.2）
//
// 为什么单独一条：permissions 的 S15/S16 逐条测「删掉的被拒 / 新增的能用」，
// 这里再钉住**整份白名单的集合本身** —— 少一个、多一个都红。绿地重列最容易发生的事就是
// "删了方法但别名还挂着"或"顺手多留一个桩"，集合断言是唯一能在一次运行里抓住它的形式。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { METHOD_NAMES, Methods, validateCall } from '../src/shared/ipc.ts';

test('C1 ⭐⭐ 白名单 = 基线 §2.2 的 20 个方法（集合相等，多一个少一个都红）', () => {
  const expected = [
    // 保留（/改造）
    'search', 'item', 'itemPaths', 'indexStatus', 'scan', 'reveal', 'collect',
    'libraryPickDir', 'libraryAdd',
    // 2026-10-15 所有者批准保留（体检/重建：只读 .gs-index.bin/.gs.db，不依赖未建的表）
    'libraryHealth', 'libraryRebuild',
    // 新增（基线 §2.2）
    'libraryList', 'librarySetEnabled', 'libraryReorder', 'libraryRemove',
    'collectDirs', 'collectDirAdd', 'collectDirRemove', 'collectDirSetDefault', 'appMeta',
  ].sort();
  assert.deepEqual([...METHOD_NAMES].sort(), expected,
    '白名单与基线 §2.2 不一致（当前：' + [...METHOD_NAMES].sort().join(',') + '）');
});

test('C2 已删除的 7 个名字（6 桩 + libraryConfig）**一个都不在**白名单里', () => {
  for (const gone of ['ingest', 'mutate', 'transactions', 'indexStart', 'indexCancel', 'indexResume', 'libraryConfig']) {
    assert.ok(!METHOD_NAMES.includes(gone), gone + ' 不该还在白名单里');
    assert.equal(Object.prototype.hasOwnProperty.call(Methods, gone), false, gone + ' 不该还有 schema');
  }
});

test('C3 白名单是**唯一闸门**：未登记名字（含已删除的）一律拒绝，且理由一致', () => {
  for (const name of ['ingest', 'mutate', 'transactions', 'indexStart', 'indexCancel', 'indexResume', 'libraryConfig', 'exec', '__proto__', 'constructor']) {
    const r = validateCall(name, {});
    assert.equal(r.ok, false, name + ' 必须被拒');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, name + ' 的拒绝理由不能为空');
  }
  // 保留的方法必须能过（对照：证明拒绝来自白名单，而不是"整个校验坏了"）
  assert.equal(validateCall('libraryList', {}).ok, true);
});

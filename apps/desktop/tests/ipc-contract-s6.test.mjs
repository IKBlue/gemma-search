// apps/desktop/tests/ipc-contract-s6.test.mjs —— S6：契约**重列**的精确清单（2026-10-15 设计基线 §2.2）
//
// 为什么单独一条：permissions 的 S15/S16 逐条测「删掉的被拒 / 新增的能用」，
// 这里再钉住**整份白名单的集合本身** —— 少一个、多一个都红。绿地重列最容易发生的事就是
// "删了方法但别名还挂着"或"顺手多留一个桩"，集合断言是唯一能在一次运行里抓住它的形式。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { METHOD_NAMES, Methods, validateCall } from '../src/shared/ipc.ts';

test('C1 ⭐⭐ 白名单集合相等（U35 + WIRE-C + HIST-1 ⇒ 30 个，多一个少一个都红）', () => {
  // ── 翻转表（照 idx2a.txt §1 的格式；历史保留）────────────────────────────────
  // | 阶段 | 集合大小 | 变化 |
  // | 基线 §2.2 + S8 items + U27 appHealth          | 22 | —— |
  // | U35（所有者「批」）恢复索引三方法                | 25 | +indexStart +indexCancel +indexResume |
  // | **WIRE-C（本卡 · 所有者已批）新增标注读写**      | **27** | **+metaGet +metaSet** |
  // | **HIST-1（只读）新增三条读路径**                 | **30** | **+recentQueries +activityList +exportList** |
  // 为什么不是放宽：仍然**集合相等**（多一个少一个都红）；新增的两项是**契约变更**，已由 Lead 报所有者批准，
  //   且各自有行为/字段断言（metaGet/metaSet 的语义在 user-meta.test.mjs 里钉住），不是"顺手多留一个桩"。
  const expected = [
    // 保留（/改造）
    'search',
    'item',
    'itemPaths',
    'indexStatus',
    'scan',
    'reveal',
    'collect',
    'libraryPickDir',
    'libraryAdd',
    // 2026-10-15 · S8 新增：只读列表（SPEC §5.1）—— 「新增 = 兼容」
    'items',
    // 2026-10-15 所有者批准保留（体检/重建：只读 .gs-index.bin/.gs.db，不依赖未建的表）
    'libraryHealth',
    'libraryRebuild',
    // 新增（基线 §2.2）
    'libraryList',
    'librarySetEnabled',
    'libraryReorder',
    'libraryRemove',
    'collectDirs',
    'collectDirAdd',
    'collectDirRemove',
    'collectDirSetDefault',
    'appMeta',
    // 2026-10-16 · U27 新增：应用自身健康（只读；SPEC §6 第 22 个方法）
    'appHealth',
    // 2026-10-17 · U35 恢复（所有者「批」）：索引任务三方法回到契约
    'indexStart',
    'indexCancel',
    'indexResume',
    // 2026-10-17 · WIRE-C（所有者已批，与 U35 同批契约变更）：条目标注读写
    'metaGet',
    'metaSet',
    // 2026-10-17 · HIST-1（只读）：三张只写不读的表的读路径
    'recentQueries',
    'activityList',
    'exportList',
  ].sort();
  assert.deepEqual(
    [...METHOD_NAMES].sort(),
    expected,
    '白名单与基线 §2.2 不一致（当前：' + [...METHOD_NAMES].sort().join(',') + '）',
  );
});

test('C2 已删除的名字（3 个写操作桩 + libraryConfig）**一个都不在**白名单里', () => {
  // ⚠️ 2026-10-17 · U35 翻转：原断言列了 7 个（6 桩 + libraryConfig），其中 indexStart/Cancel/Resume
  //    已由所有者批准**恢复登记** ⇒ 从本清单移除（不是放宽：它们现在由 C2b 正向钉住）。
  for (const gone of ['ingest', 'mutate', 'transactions', 'libraryConfig']) {
    assert.ok(!METHOD_NAMES.includes(gone), gone + ' 不该还在白名单里');
    assert.equal(
      Object.prototype.hasOwnProperty.call(Methods, gone),
      false,
      gone + ' 不该还有 schema',
    );
  }
});

test('C2b ⭐ U35 恢复的三个方法**真的回到白名单**：有 schema、能过 validateCall（正向对照）', () => {
  const payloads = {
    indexStart: { libId: 'L1', device: 'cpu', seq: 3, rebuild: false },
    indexCancel: { jobId: 'j-1' },
    // ⚠️ 2026-10-17 · IDX-2b：libId 是**可选**新增（跨重启续跑要用）；这里带上它证形状接受
    indexResume: { jobId: 'j-1', libId: 'L1' },
  };
  for (const [name, payload] of Object.entries(payloads)) {
    assert.ok(METHOD_NAMES.includes(name), name + ' 必须回到白名单（U35）');
    assert.equal(
      Object.prototype.hasOwnProperty.call(Methods, name),
      true,
      name + ' 必须有 zod 形状',
    );
    const r = validateCall(name, payload);
    assert.equal(r.ok, true, name + ' 的合法载荷必须能过校验：' + JSON.stringify(r));
  }
  // 形状是 strict 的：多塞字段要被拒（证明不是"登记了个空壳"）
  assert.equal(validateCall('indexStart', { libId: 'L1', bogus: 1 }).ok, false);
  // libId 是**可选**的：不带也得过（不破坏既有调用），带了也必须过（跨重启续跑）
  assert.equal(validateCall('indexResume', { jobId: 'j-1' }).ok, true);
  assert.equal(validateCall('indexResume', { jobId: 'j-1', libId: 'L1' }).ok, true);
  assert.equal(
    validateCall('indexResume', { libId: 'L1' }).ok,
    true,
    'libId 单独给也应允许（jobId 也可省）',
  );
  assert.equal(validateCall('indexResume', { jobId: 'j-1', bogus: 1 }).ok, false);
});

test('C3 白名单是**唯一闸门**：未登记名字（含已删除的）一律拒绝，且理由一致', () => {
  // ⚠️ 2026-10-17 · U35 翻转：indexStart/Cancel/Resume 已恢复 ⇒ 从此清单移除（它们的正向断言在 C2b）。
  for (const name of [
    'ingest',
    'mutate',
    'transactions',
    'libraryConfig',
    'exec',
    '__proto__',
    'constructor',
  ]) {
    const r = validateCall(name, {});
    assert.equal(r.ok, false, name + ' 必须被拒');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, name + ' 的拒绝理由不能为空');
  }
  // 保留的方法必须能过（对照：证明拒绝来自白名单，而不是"整个校验坏了"）
  assert.equal(validateCall('libraryList', {}).ok, true);
});

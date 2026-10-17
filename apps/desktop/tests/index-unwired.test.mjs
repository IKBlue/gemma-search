// apps/desktop/tests/index-unwired.test.mjs —— E2E-RED-1：**IDX-2a 的"未接线"语义没被破坏**（引擎级）
//
// 为什么要有这条：IDX-2b2 给引擎注入了 indexing 端口后，真实模式从「未接线 ⇒ INTERNAL（含 IDX-2b）」变成
//   「接线了 ⇒ 真的起任务 / 环境不满足 ⇒ 明确错误码」。e2e 里那条老断言（INTERNAL）因此过时 ——
//   但**旧语义本身不能丢**：**不注入端口**时必须仍如实报 INTERNAL（P6：绝不假装成功）。
//   （"注入后真的起任务"是 IDX-2b 引擎侧的范围与测试，不在本卡重复。）
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEngine } from '../../../packages/engine/src/engine.ts';

test('E2E-RED-1 ⭐⭐ 未注入 indexing ⇒ indexStart 仍如实 INTERNAL（IDX-2a 语义没被破坏）', async () => {
  const eng = createEngine({
    config: {
      libraries: [{ libId: 'L1', root: 'D:/__none__', label: 'L1' }],
      data_dir: 'D:/__none__',
    },
  });
  const res = await eng.indexStart({ libId: 'L1' });
  assert.equal(res.ok, false, '未接线时**不许**假装成功（P6）');
  assert.equal(res.error.code, 'INTERNAL');
  assert.match(String(res.error.message), /IDX-2b/, 'message 要说清还没接线（IDX-2b）');
});

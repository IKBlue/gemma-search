// apps/desktop/tests/ports.test.mjs —— F-01 的"接线"验收
//
// 为什么必须有这个文件：F-01 之所以能长期存活，是因为**引擎单测自己注入了 shell**
// （`packages/engine/tests/engine.test.mjs:314`）—— 它测的是"引擎能力"，
// 而**没有任何测试碰过应用侧到底有没有把端口接上**。
// 本文件就是把那一层钉住：端口的形状、转发、异常行为。
//
// 兜底说明：这里测不到"主进程真的把端口传给了 createEngine"（那需要跑 Electron）。
// 那一层的证据是 `tools/verify_renderer_dom.mjs`（**已移除 2026-10-13**） 的端到端断言 + 代码审查。
// **不得**因为本文件绿了就声称"接线已端到端验证"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRevealPort } from '../src/main/ports.mjs';

test('端口形状：恰好只有 reveal 一个成员（端口最小化）', () => {
  const port = createRevealPort({ showItemInFolder() {} });
  assert.deepEqual(Object.keys(port), ['reveal']);
  assert.equal(typeof port.reveal, 'function');
});

test('端口把参数**原样**转发给 showItemInFolder，不做路径加工', () => {
  const seen = [];
  const port = createRevealPort({ showItemInFolder: (p) => seen.push(p) });
  const target = 'G:\\model\\VR\\ID-1.rar';
  port.reveal(target);
  assert.deepEqual(seen, [target]);
  // 反例：传进来的东西不该被"清洗"成别的形状（上游已经做过库根包含校验）
  const odd = 'D:\\a b\\c.rar';
  port.reveal(odd);
  assert.equal(seen[1], odd, '带空格的路径必须原样传下去');
});

test('端口不吞异常：showItemInFolder 抛错必须冒泡出去', () => {
  const port = createRevealPort({
    showItemInFolder() { throw new Error('explorer 挂了'); },
  });
  // 静默 catch 会把"调用炸了"变成另一种静默假成功 —— 引擎的 envelope() 会把它归成 INTERNAL
  assert.throws(() => port.reveal('G:\\x.rar'), /explorer 挂了/);
});

test('端口每次调用都真的转发（不是只成功一次）', () => {
  let n = 0;
  const port = createRevealPort({ showItemInFolder() { n += 1; } });
  port.reveal('a');
  port.reveal('b');
  port.reveal('c');
  assert.equal(n, 3);
});

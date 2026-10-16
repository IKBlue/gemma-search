// apps/desktop/tests/nav.test.mjs —— IA-1：侧栏导航表（含「文档」门控项）· 2026-10-16
//
// 为什么这一组存在：`SPEC §4` 的信息架构里侧栏**含「文档」**，而界面此前**连入口都没有**。
//   补上之后必须钉住三件事，否则「补了」很快又会漂回去：
//     IA1  **文档项存在**（规格说有的东西，界面上就得能找到）；
//     IA2  它是**门控项**（不可达）—— 不许为了「看起来完整」给它一个空页面；
//     IA3  **说明里含进入条件**（`TASKS.md` 🔒 口径：先拿到 10–30 份真实文档 + 确认格式分布），
//          且**不是空承诺**（「即将上线 / 敬请期待」这类没有可判定完成条件的说法一律不许）；
//     IA4  **不许静默**：门控项必须写原因（`assertNavItems` 在模块加载时机械保证），
//          可达项与门控项**互斥**（给了 to 就不能再给 reason，反之亦然）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAV,
  isReachable,
  navAccessibleName,
  assertNavItems,
} from '../src/renderer/src/utils/nav.ts';

const doc = NAV.find((x) => x.key === 'docs');

test('IA1 ⭐ SPEC §4 说侧栏有「文档」⇒ 导航表里必须真的有这一项', () => {
  assert.ok(doc, '侧栏缺「文档」入口：' + NAV.map((x) => x.key).join(','));
  assert.equal(doc.label, '文档');
});

test('IA2 ⭐⭐ 「文档」是**门控项**（不可达）：不许给它一个空页面假装已实现', () => {
  assert.ok(doc, '（前提）文档项存在');
  assert.equal(isReachable(doc), false, '文档页还不存在 ⇒ 不许有路由');
  assert.equal(doc.to, undefined, '门控项不许给 to');
});

test('IA3 ⭐⭐ 说明里必须写**进入条件**，且**不是空承诺**（TASKS 🔒 口径）', () => {
  assert.ok(doc, '（前提）文档项存在');
  const reason = String(doc.reason ?? '');
  assert.ok(reason.length > 0, '门控项必须写原因');
  // ① 进入条件：真实文档份数 + 格式分布（抄 TASKS.md 的 T-34 🔒 条目）
  assert.match(reason, /10–30|10-30/, '要写清需要多少份真实文档：' + reason);
  assert.match(reason, /文档/, '要写清「文档」这件事本身：' + reason);
  assert.match(reason, /格式/, '要写清还要确认「格式分布」：' + reason);
  // ② 空承诺黑名单：这些说法**没有可判定的完成条件**，等于把「永远不做」伪装成「快好了」
  for (const empty of ['即将上线', '敬请期待', '稍后', 'coming soon', '即将支持']) {
    assert.equal(
      reason.includes(empty),
      false,
      `门控说明里不许出现空承诺「${empty}」（要写进入条件）：${reason}`,
    );
  }
});

test('IA4 ⭐⭐ 不许静默：门控项缺原因 ⇒ assertNavItems 必须抛；可达项与门控项互斥', () => {
  // 反例 1：门控项没写原因
  assert.throws(
    () => assertNavItems([{ key: 'x', icon: '?', label: 'X' }]),
    /进入条件/,
    '门控项缺原因必须抛（否则界面上就是「点不动又不说为什么」）',
  );
  // 反例 2：key 重复
  assert.throws(
    () =>
      assertNavItems([
        { key: 'dup', icon: '?', label: 'A', to: '/a' },
        { key: 'dup', icon: '?', label: 'B', reason: 'R' },
      ]),
    /重复/,
  );
  // 正例：真实表必须过（它就是模块加载时跑的那一条）
  assert.doesNotThrow(() => assertNavItems(NAV));
  // 全表逐条：要么有 to，要么有 reason（没有第三种状态）
  for (const item of NAV) {
    const reachable = isReachable(item);
    const hasReason = typeof item.reason === 'string' && item.reason.trim().length > 0;
    assert.ok(reachable || hasReason, `项 ${item.key} 既不可达又没原因 ⇒ 静默`);
  }
});

test('IA5：门控项的可访问名带上原因（屏幕阅读器也念得到「为什么点不动」）', () => {
  const name = navAccessibleName(doc);
  assert.match(name, /^文档（/, '可访问名形如「文档（原因）」：' + name);
  assert.match(name, /10–30|10-30/, '原因要出现在可访问名里');
  // 可达项的可访问名就是标签本身（不带括号说明）
  const search = NAV.find((x) => x.key === 'search');
  assert.equal(navAccessibleName(search), '语义搜索');
});

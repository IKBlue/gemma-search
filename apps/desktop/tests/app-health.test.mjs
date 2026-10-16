// apps/desktop/tests/app-health.test.mjs —— U27：`appHealth` 的**只读方法**单测（2026-10-16）
//
// 这一组要钉住的是**口径本身**，尤其是四条容易做错的地方：
//   AH1  **恒成功**：查不到事实也是一条事实 ⇒ 不许把「没出过事」变成 error；
//   AH3  **不含路径/用户名/堆栈正文**：界面要能看到「大概是什么事」，但不能把用户目录印在屏幕上；
//   AH4  **健康时 reason/firstAt 必须是 null**（不是空串）—— 空串会被界面画成「有原因但内容为空」；
//   AH6  **同源**：数据只来自 crash-policy 的同一份进程内状态（不产生第二份真相）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { queryAppHealth, summarizeReason, REASON_MAX } from '../src/main/app-health.ts';
import { createCrashPolicy, crashUnhealthyState } from '../src/main/crash-policy.ts';

const HEALTHY_STATE = { unhealthy: false, reason: null, count: 0, firstAt: null };

// ============================================================ AH1 恒成功

test('AH1 ⭐ 恒成功：健康 / 不健康 / 数据缺失都返回 ok:true（查不到事实本身就是事实）', () => {
  for (const s of [
    HEALTHY_STATE,
    { unhealthy: true, reason: 'boom', count: 1, firstAt: '2026-10-16T01:00:00.000Z' },
    { unhealthy: true, reason: null, count: 3, firstAt: null },
    { unhealthy: false, reason: 'x', count: 9, firstAt: 'y' },
  ]) {
    const r = queryAppHealth(s);
    assert.equal(r.ok, true, 'appHealth 不许返回 ok:false：' + JSON.stringify(s));
  }
});

test('AH2：载荷形状就是契约写的那四个键（多一个都不给 —— 尤其不能偷偷带上 sessionExit/路径）', () => {
  const r = queryAppHealth({ unhealthy: true, reason: 'boom', count: 1, firstAt: 'T' });
  assert.deepEqual(Object.keys(r.data).sort(), ['count', 'firstAt', 'reason', 'unhealthy']);
});

// ============================================================ AH3 摘要清洗（不含路径）

test('AH3 ⭐⭐ 摘要**只留第一行**且抹掉路径分隔符：不许把用户目录/堆栈正文搬到界面上', () => {
  const raw = [
    'Error: 读取失败',
    '    at open (D:\\USERS\\Desktop\\Agent\\gemma-search\\out\\main\\index.js:4110:14)',
    '    at withAppDb (D:\\USERS\\Desktop\\Agent\\gemma-search\\out\\main\\index.js:4491:18)',
  ].join('\n');
  const out = summarizeReason(raw);
  assert.equal(out, 'Error: 读取失败', '只保留第一行');
  assert.equal(out.includes('D:'), false, '不许留下盘符');
  assert.equal(out.includes('Agent'), false, '不许留下目录名');
  assert.equal(out.includes('at open'), false, '不许留下堆栈正文');
});

test('AH3b：单行里也带路径 ⇒ 分隔符被抹掉（路径不再是路径），且长度有上限', () => {
  const out = summarizeReason('ENOENT: no such file or directory, open D:/Users/someone/lib/x.db');
  assert.equal(out.includes('/'), false);
  assert.equal(out.includes('\\'), false);
  assert.match(String(out), /ENOENT/);
  assert.ok(String(out).length <= REASON_MAX, '长度上限 ' + String(REASON_MAX));
});

test('AH3c：超长摘要被截断（不会把一整段堆栈塞进界面）', () => {
  const out = summarizeReason('x'.repeat(500));

  assert.equal(String(out).length, REASON_MAX, '截断到上限（含省略号）');
  assert.ok(String(out).endsWith('…'), '要能看出被截断');
});

test('AH3d ⭐⭐ 能红：注入含**绝对路径 + 用户名**的原因 ⇒「输出里不含它」这两条断言必须真能抓到（证明清洗是被验证过的，不是被声称的）', () => {
  const user = 'zhangsan-9f2c';
  const absPath = 'D:/Users/' + user + '/AppData/Roaming/gemma-search/app.db';
  const raw = 'Error: 数据库打不开：' + absPath;
  const out = String(summarizeReason(raw));
  // ① 清洗后的输出里**不许**出现用户名或那段路径
  assert.equal(out.includes(user), false, '摘要里出现了用户名 ⇒ 清洗失效');
  assert.equal(out.includes('AppData'), false, '摘要里出现了目录名 ⇒ 清洗失效');
  assert.equal(out.includes('/'), false, '摘要里还留着路径分隔符 ⇒ 路径仍是路径');
  // ② 但**要**留下「什么事」（清洗不许把有用信息也一起删了）
  assert.match(out, /数据库打不开/, '摘要要把「什么事」留下');
  // ③ ⭐ 能红：同一段**未清洗**的原串必然含敏感信息 ⇒ 拿它跑同一条断言必须抛（说明断言不是恒真）
  assert.throws(
    () => assert.equal(raw.includes(user), false, '（自检）未清洗的原串必然含用户名'),
    /未清洗的原串必然含用户名/,
    '这条自检没抛 ⇒ 上面那两条断言是恒真的，清洗根本没被验证',
  );
});

// ============================================================ AH4 健康时的 null 语义

test('AH4 ⭐ 健康时 reason / firstAt 必须是 null（不是空串），且 count 不虚报', () => {
  const r = queryAppHealth({ unhealthy: false, reason: '残留的原因', count: 7, firstAt: 'T' });
  assert.equal(r.data.reason, null, '健康时不许带原因（哪怕状态里残留着）');
  assert.equal(r.data.firstAt, null, '健康时不许带时间');
  assert.equal(
    r.data.count,
    7,
    '健康时 count 是「历史上出过几次」，状态给几就是几（不在这里清零）',
  );
  // 不健康但缺 reason/firstAt ⇒ 也必须是 null（不许编）
  const r2 = queryAppHealth({ unhealthy: true, reason: null, count: 2, firstAt: null });
  assert.equal(r2.data.reason, null);
  assert.equal(r2.data.firstAt, null);
  assert.equal(r2.data.count, 2, '次数要如实给');
});

test('AH4b：非法 count（负数/NaN/非数字）不许变成假的次数', () => {
  for (const bad of [-3, Number.NaN, 'x']) {
    const r = queryAppHealth({ unhealthy: true, reason: 'boom', count: bad, firstAt: 'T' });
    assert.equal(r.data.count, 0, '非法 count 归 0，而不是原样透出：' + String(bad));
  }
});

// ============================================================ AH6 同源（crash-policy 唯一真相）

test('AH6 ⭐⭐ 与 crash-policy 同源：未处理 rejection 之后，queryAppHealth 读到的是**同一份**状态', () => {
  const handlers = { uncaughtException: [], unhandledRejection: [] };
  const target = {
    on(ev, fn) {
      handlers[ev].push(fn);
      return target;
    },
    removeListener(ev, fn) {
      handlers[ev] = handlers[ev].filter((f) => f !== fn);
      return target;
    },
  };
  const fixedTime = '2026-10-16T02:30:00.000Z';
  const policy = createCrashPolicy({
    log: () => {},
    exit: () => {},
    isPackaged: false,
    target,
    now: () => fixedTime,
  });
  policy.install();
  try {
    const before = queryAppHealth(policy.snapshot());
    assert.equal(before.data.unhealthy, false);
    assert.equal(before.data.firstAt, null);

    // 注入一次未处理 rejection（**不退出**）
    handlers.unhandledRejection[0](new Error('injected-boom'));
    const after = queryAppHealth(policy.snapshot());
    assert.equal(after.data.unhealthy, true);
    assert.equal(after.data.count, 1);
    assert.match(String(after.data.reason), /injected-boom/);
    assert.equal(after.data.firstAt, fixedTime, '时刻来自注入的时钟（同一次 mark 记下）');

    // 第二条原因不覆盖第一条（根因优先），但 count 要涨
    handlers.unhandledRejection[0](new Error('second-noise'));
    const after2 = queryAppHealth(policy.snapshot());
    assert.equal(after2.data.count, 2);
    assert.match(String(after2.data.reason), /injected-boom/, '根因优先：第二条不许覆盖第一条');
    assert.equal(after2.data.firstAt, fixedTime, 'firstAt 是**第一条**的时刻，不随后续变化');
  } finally {
    policy.dispose();
  }
});

test('AH6b：没安装过策略时，模块读口给的是「健康」而不是编一个假的不健康', () => {
  // ⚠️ 该断言假设本文件在 installCrashPolicy 之前跑（本文件不安装模块级策略）
  const s = crashUnhealthyState();
  assert.equal(s.unhealthy, false);
  assert.equal(s.count, 0);
  assert.equal(s.firstAt, null, '未安装 ⇒ firstAt 也必须是 null（形状完整）');
});

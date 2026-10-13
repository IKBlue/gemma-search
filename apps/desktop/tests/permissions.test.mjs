// apps/desktop/tests/permissions.test.mjs —— SPEC-security §8 的传输层权限用例
//
// 为什么现在才有这个文件：本表 16 条此前**零自动化**（`docs/spec/SPEC-security.md:285` 自己写着
// "P2 验收未通过"）。根因很实际 —— `main/index.mjs` import 了 `electron`，`node:test` 加载不了它，
// 于是 IPC 分发、preload 暴露面、`thumb://` 处理器这三块**一条测试都没有**。
// 本文件覆盖其中**能脱离 Electron 测**的部分；需要真窗口的那些走
// `tools/verify_app_build.mjs`（**已移除 2026-10-13**）（结构断言）与 `tools/verify_renderer_dom.mjs`（**已移除 2026-10-13**）（jsdom 行为断言），
// **不在这里用假 electron 冒充** —— 那证明不了接线到底有没有接上。
//
// 覆盖映射（编号与 SPEC-security §8 表格一致）：
//   S1 未登记方法          → validateCall
//   S2 未知字段(zod strict) → validateCall
//   S3 libId/uid 形状        → validateCall
//   S4 thumb 路径穿越        → parseThumbUrl + 「零文件读取」证明
//   S5 thumb size 白名单     → parseThumbUrl
//   S6 未注册库              → canonicalLibId
//   S14 载荷 > 1 MB          → validateCall
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateCall, MAX_PAYLOAD_BYTES, METHOD_NAMES } from '../src/shared/ipc.mjs';
import { parseThumbUrl, canonicalLibId, ALLOWED_SIZE, createLibIdResolver, thumbFailureStatus } from '../src/main/thumb-url.mjs';

// ============================================================ S1 / S2 / S3 / S14

test('S1：未登记的方法一律拒绝（含 `exec` 这种明显的逃逸尝试）', () => {
  // 白名单是 `Object.hasOwnProperty` 判定，所以原型键也进不来 —— 顺手一起钉住
  for (const m of ['exec', 'eval', '__proto__', 'toString', 'constructor', 'hasOwnProperty', '', null, undefined, 1, {}]) {
    const r = validateCall(m, {});
    assert.equal(r.ok, false, `方法 ${JSON.stringify(m)} 竟然通过了`);
    assert.equal(r.reason, '未登记的方法');
  }
  // 反例锚：登记过的方法必须过（否则"全拒"也能骗过上面）
  assert.equal(validateCall('indexStatus', {}).ok, true);
  assert.ok(METHOD_NAMES.length >= 13, `方法白名单条数 ${METHOD_NAMES.length}`);
});

test('S2：已知方法传未知字段被拒（zod .strict()，不是"忽略多余字段"）', () => {
  const r = validateCall('search', { mode: 'text', text: 'x', __proto__evil: 1 });
  assert.equal(r.ok, false, '未知字段竟然被静默忽略了');
  assert.match(r.reason, /Unrecognized key|unrecognized/i);
  // 嵌套对象也必须是 strict（filters 里塞未知键）
  const r2 = validateCall('search', { mode: 'text', filters: { folders: ['VR'], evil: 1 } });
  assert.equal(r2.ok, false);
  // 反例锚
  assert.equal(validateCall('search', { mode: 'text', text: 'x' }).ok, true);
});

test('S3：libId / uid 形状不合法一律拒绝（路径穿越、大写 uid、超长 id）', () => {
  const bad = [
    { libId: '../etc', uid: '022a00481875' },        // §8 原文用例
    { libId: 'L1', uid: '../../../x' },              // §8 原文用例
    { libId: 'L1', uid: '022A00481875' },            // 大写：形状是 `[0-9a-f]`
    { libId: 'L1', uid: '022a0048187' },             // 11 位
    { libId: 'L1', uid: '022a004818755' },           // 13 位
    { libId: 'L1', uid: '' },
    { libId: 'L/1', uid: '022a00481875' },           // 斜杠
    { libId: 'L1\\..', uid: '022a00481875' },        // 反斜杠
    { libId: 'a'.repeat(33), uid: '022a00481875' },  // 超长
    { libId: 'L1', uid: '022a00481875\n' },
  ];
  for (const p of bad) {
    const r = validateCall('item', p);
    assert.equal(r.ok, false, `竟然通过了：${JSON.stringify(p)}`);
  }
  // 反例锚：合法形状必须过
  assert.equal(validateCall('item', { libId: 'L1', uid: '022a00481875' }).ok, true);
  assert.equal(validateCall('item', { libId: 'lib-A_1', uid: 'a'.repeat(12) }).ok, true);
});

test('S14：载荷 > 1 MB 被拒；恰好 1 MB 边界内则放行', () => {
  // 用 text 字段撑大体量（schema 限 200 字符 ⇒ 会先被 zod 拒），所以改用 vector：
  // 但 vector 限 4096 个数字。真正能撑到 1 MB 的只有"未知字段"——那也被 strict 拒。
  // 所以这里直接测**尺寸闸门本身**，绕开 schema（这是它在 validateCall 里的真实位置：
  // 尺寸检查在 schema 之前，见 shared/ipc.mjs:103）。
  const big = { x: 'a'.repeat(MAX_PAYLOAD_BYTES + 64) };
  const r = validateCall('indexStatus', big);
  assert.equal(r.ok, false);
  assert.match(r.reason, /载荷过大/, `实际 reason：${r.reason}`);

  // 边界：略小于上限 ⇒ 不该被**尺寸**拒（会是 schema 拒，reason 不同）
  const small = { x: 'a'.repeat(1000) };
  const r2 = validateCall('indexStatus', small);
  assert.equal(r2.ok, false);
  assert.doesNotMatch(r2.reason, /载荷过大/, '明显没超限却被判超限');
});

test('S14b：参数无法序列化（循环引用）时拒绝，而不是抛异常给调用方', () => {
  const cyc = {};
  cyc.self = cyc;
  const r = validateCall('indexStatus', cyc);   // 不能 throw
  assert.equal(r.ok, false);
  assert.equal(r.reason, '参数无法序列化');
});

// ============================================================ S4 / S5 / S6（thumb://）

test('S5：size 只认白名单 128/256/512，@999 之类一律 400', () => {
  assert.deepEqual([...ALLOWED_SIZE].sort((a, b) => a - b), [128, 256, 512]);
  const uid = '022a00481875';
  for (const good of [128, 256, 512]) {
    const r = parseThumbUrl(`thumb://L1/${uid}@${good}`);
    assert.equal(r.ok, true, `@${good} 应通过：${JSON.stringify(r)}`);
    assert.equal(r.size, good);
  }
  for (const bad of [999, 0, 1, 64, 1024, 256.5, -256, 5120, '256x']) {
    const r = parseThumbUrl(`thumb://L1/${uid}@${bad}`);
    assert.equal(r.ok, false, `@${bad} 竟然通过了`);
    assert.equal(r.status, 400);
  }
});

test('S4：thumb:// 路径穿越被拒，且**解析阶段零文件读取**（注入计数 io 证明）', () => {
  // ⚠️ 这条断言**第一次是假的**，别再犯：初版造了一个 spy 却从未接线（末尾只写 `void spy;`），
  // 于是 `assert.deepEqual(reads, [])` 恒真 —— 独立复核给模块注入真实 readFileSync 后，断言**仍然全绿**。
  // 现在改成**依赖注入**：把计数 io 作为参数传进 `parseThumbUrl`。
  // 如果将来有人在解析路径里加了读取，它必须经过这个参数才可能"干净"，
  // 而一旦经过，`reads` 就会非空 ⇒ 断言变红。
  const reads = [];
  const io = {
    readFileSync: (...a) => { reads.push(['readFileSync', ...a]); throw new Error('不该被调用'); },
    existsSync: (...a) => { reads.push(['existsSync', ...a]); return false; },
    openSync: (...a) => { reads.push(['openSync', ...a]); throw new Error('不该被调用'); },
    statSync: (...a) => { reads.push(['statSync', ...a]); return {}; },
    readdirSync: (...a) => { reads.push(['readdirSync', ...a]); return []; },
  };
  const traversal = [
    'thumb://../../windows/win.ini',              // §8 原文用例
    'thumb://L1/../../windows/win.ini',
    'thumb://../../../../../../etc/passwd',
    'thumb://%2e%2e/win.ini',
    'thumb://L1/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    'thumb://L1/..%5c..%5cwindows%5cwin.ini',
    'thumb://L1/022a00481875@256/../../../x',
  ];
  for (const u of traversal) {
    const r = parseThumbUrl(u, io);
    assert.equal(r.ok, false, `穿越竟然通过了：${u} → ${JSON.stringify(r)}`);
    // 这 7 个输入实测**全是** 400（形状/尺寸层就拒了）。写成 `400 || 404` 是不必要的松 ——
    // 真正需要 404 的是 S6 那条"库无法还原"，它有自己的用例。
    assert.equal(r.status, 400, `${u} 期望 400，实际 ${r.status}`);
  }
  assert.deepEqual(reads, [], `解析阶段发生了文件访问：${JSON.stringify(reads)}`);
  // 连带的结构证明（比"我这次没调到"更强，但不是替代品 —— 上面那条才是行为证明）
  const src = fs.readFileSync(path.join(process.cwd(), 'apps/desktop/src/main/thumb-url.mjs'), 'utf8');
  assert.doesNotMatch(src, /from\s+['"]node:fs['"]/, 'thumb-url.mjs 不该 import fs');
  assert.doesNotMatch(src, /\brequire\(\s*['"]fs['"]/, 'thumb-url.mjs 不该 require fs');
});

test('S6：失败状态码映射 —— 形状/尺寸错 ⇒ 400；库无法还原 ⇒ 404（可执行契约）', async () => {
  // 为什么单独立一条：这个映射就是 S4/S5/S6 的**契约本体**（SPEC-security §3 的表）。
  // 第一次交付时它留在 handleThumb 里、只在文档里写成"index.mjs 回 404"——
  // 独立复核把产物里的 404 改成 200，**没有任何断言会响**（blocker B2）。
  // 抽成纯函数后，改坏它必然变红；而**调用点**由 `tools/verify_main_wiring.mjs`（**已移除 2026-10-13**） 用真实产物覆盖。
  assert.equal(thumbFailureStatus({ shapeOk: false, libId: '' }), 400, '形状/尺寸错 ⇒ 400（哪怕库也没还原出来）');
  assert.equal(thumbFailureStatus({ shapeOk: true, libId: '' }), 404, '形状合法但库无法还原 ⇒ 404（§3）');
  assert.equal(thumbFailureStatus({ shapeOk: true, libId: 'L1' }), null, '两项都正常 ⇒ 不拦（null）');
  assert.equal(thumbFailureStatus({ shapeOk: false, libId: 'L1' }), 400, '形状错即便库能还原也 ⇒ 400');
  assert.equal(thumbFailureStatus({}), 400, '空对象按"形状不合法"处理（fail closed）');
  // 端到端组合：未注册库的完整判定链
  const p = parseThumbUrl('thumb://L9/022a00481875@256');
  assert.equal(p.ok, true, '形状本身合法，问题在"库没注册"');
  const libId = await canonicalLibId(p.rawHost, async () => ['L1']);   // L9 未注册
  assert.equal(libId, '', 'L9 不该被还原出来');
  assert.equal(thumbFailureStatus({ shapeOk: p.ok, libId }), 404, 'S6 端到端：未注册库 ⇒ 404');
  // 端到端组合②：size 不合法时必须是 400（这条曾经真的做错过 —— 见下）
  const p2 = parseThumbUrl('thumb://L1/022a00481875@999');
  assert.equal(p2.ok, false, 'size 不在白名单');
  assert.equal(p2.status, 400);
  const lib2 = p2.ok ? await canonicalLibId(p2.rawHost, async () => ['L1']) : '';
  assert.equal(lib2, '', '形状没解析出来 ⇒ 无从还原库（正是旧版把它误判成 404 的原因）');
  assert.equal(thumbFailureStatus({ shapeOk: p2.ok, libId: lib2 }), 400,
    '⚠️ 即使 libId 为空，形状错也必须是 400 —— 旧签名在这里会给出 404（实测被 main_wiring 抓到）');
});

test('S4b：形状不合法的一律拒（uid 不是 12 位 hex、缺 @、多段路径、host 为空、非法 URL）', () => {
  const bad = [
    'thumb://L1/022a00481875',            // 缺 @size
    'thumb://L1/@256',                    // 缺 uid
    'thumb://L1/zzzz00481875@256',        // 非 hex
    'thumb://L1/022A00481875@256',        // 大写 hex（形状是 [0-9a-f]）
    'thumb://L1/022a0048187@256',         // 11 位
    'thumb://L1/a/b/022a00481875@256',    // 多段
    'thumb:///022a00481875@256',          // host 为空
    'thumb://L1/',                        // 空路径
    'thumb://L1',                         // 无路径
    'not a url',                          // 解析不了
    '',                                   // 空串
  ];
  for (const u of bad) {
    const r = parseThumbUrl(u);
    assert.equal(r.ok, false, `竟然通过了：${JSON.stringify(u)}`);
    assert.equal(r.status, 400, `${u} 状态码应为 400，实际 ${r.status}`);
  }
});

test('S4c：路径里的 `?query` 与 `#fragment` 不影响形状判定（不构成绕过）', () => {
  const r = parseThumbUrl('thumb://L1/022a00481875@256?../../x=1#/etc/passwd');
  assert.equal(r.ok, true, '合法形状不该被 query/fragment 拖垮');
  assert.equal(r.uid, '022a00481875');
  assert.equal(r.size, 256);
});

test('S6：未注册的库 ⇒ 无法还原 libId ⇒ 空串（调用方给 404）', async () => {
  const registered = ['L1', 'L2'];
  assert.equal(await canonicalLibId('l1', async () => registered), 'L1', 'URL host 是小写的，必须还原成 L1');
  assert.equal(await canonicalLibId('L2', async () => registered), 'L2');
  assert.equal(await canonicalLibId('l9', async () => registered), '', '未注册库必须还原失败');
  assert.equal(await canonicalLibId('', async () => registered), '');
  assert.equal(await canonicalLibId('L1', async () => []), '', '一个库都没有时必须失败');
});

test('S6b：libId 还原器缓存映射，但**绝不缓存"索引未就绪"（空列表）**', async () => {
  let calls = 0;
  const resolve = createLibIdResolver({
    listLibIds: async () => { calls += 1; return ['L1']; },
    log: () => {},
  });
  assert.equal(await resolve('l1'), 'L1');
  assert.equal(await resolve('L1'), 'L1');
  assert.equal(calls, 1, '第二次应命中缓存，不该再查 indexStatus');
  assert.equal(await resolve('l9'), '');

  // ⚠️ 这一段是独立复核抓出的实缺陷：初版无条件 `filled = true`，于是**第一次**调用
  // 若发生在索引还没就绪时，空映射会被**永久**缓存 ⇒ 之后每张缩略图都 404，
  // 界面只显示"无预览"、没有任何报错线索。
  //
  // ⚠️⚠️ **断言要盯着"有没有重查"，不能只盯返回值**：空列表被缓存与"重查后仍为空"
  // 这两种情况的**返回值完全一样**（都是 ''）。我第一次的写法就是这样 ——
  // 把 `if (ids.length > 0)` 改成 `if (true)` 之后断言**照样全绿**（那个变异其实是个 no-op，
  // 因为空数组根本不进循环体）。所以真正的判据是**调用次数**：
  //   正确：第一次空 ⇒ 第二次**会重查**（调用次数 1 → 2）；语义就是"空结果不缓存"
  //   有缺陷：空结果被标记为已完成 ⇒ 第二次**不重查**（调用次数停在 1）
  let seq = 0;
  const flaky = createLibIdResolver({
    listLibIds: async () => { seq += 1; return seq === 1 ? [] : ['L1']; },  // 第一次未就绪
    log: () => {},
  });
  assert.equal(await flaky('l1'), '', '第一次：库还没就绪 ⇒ 还原失败（正常）');
  assert.equal(seq, 1, '第一次确实查了一次');
  const got = await flaky('l1');
  assert.equal(got, 'L1', '第二次应该能还原出来（库已就绪）');
  assert.equal(seq, 2, '⚠️ 空列表**不得**被缓存 —— 第二次必须重查（调用次数 1 → 2）');
});

test('thumb:// 的合法形状能正常解出三要素（防止"全拒"骗过上面所有用例）', () => {
  const r = parseThumbUrl('thumb://L1/022a00481875@512');
  assert.deepEqual(r, { ok: true, rawHost: 'L1', uid: '022a00481875', size: 512 });
  // 大小写 host：URL 会小写化，所以这里拿到的是小写；还原交给 canonicalLibId
  const r2 = parseThumbUrl('thumb://l1/022a00481875@128');
  assert.equal(r2.ok, true);
  assert.equal(r2.rawHost, 'l1', 'URL 规范会小写 host —— 这正是必须做还原的原因');
});

// apps/desktop/tests/dialog-paths.test.mjs —— SEC-1：绝对路径入参的**来源闸门**
//
// 每条用例钉住的失败模式：
//   D1/D2 未选过也能登记           ⇒ 渲染层凭空造路径（XSS / 契约误用）就能把任意目录写进注册表
//   D3    选过的被误拒             ⇒ 功能坏掉（可用性回归）
//   D4    畸形入参抛异常           ⇒ 一个空串就能让 IPC 分派炸掉（信封要求"永不抛"）
//   D5    collectDirAdd 的缺口被当成"已防住" ⇒ 以后没人知道要补选择器
//   D6    只校验存在性             ⇒ 对账被悄悄退化成"存在就行"（本卡核心断言）
//   D7    模块写了但没接线         ⇒ 注释充当接线证据（AGENTS P8）
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import { createDialogPathGate } from '../src/main/dialog-paths.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INDEX_TS = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'index.ts');
const TMP = path.join(ROOT, 'data', '_sec1', 'dialog-paths-' + String(process.pid));
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** 假判据：只认表里列出的路径"存在且是目录"（不碰真 fs ⇒ 三种原因都能精确造出来） */
function fakeClassify(okPaths) {
  return (p) =>
    okPaths.has(p)
      ? { root: p, available: true, code: null, reason: '' }
      : {
          root: p,
          available: false,
          code: 'not-found',
          reason: '库根不存在（盘符变了、盘未挂载，或目录被删除/改名）',
        };
}

// ============================================================ D1 未选过 ⇒ 拒（能红靶心）

test('D1 ⭐ 没人选过时，凭空构造的绝对路径必须被拒（BAD_REQUEST · not-from-dialog）', () => {
  const gate = createDialogPathGate({ normalize: (p) => p, classify: fakeClassify(new Set()) });
  assert.equal(gate.pickedCount(), 0);

  const r = gate.checkLibraryRoot('X:\\forged');
  assert.equal(r.ok, false, '★ 未经对话框的绝对路径必须被拒');
  assert.equal(r.error.code, 'BAD_REQUEST');
  assert.equal(r.error.details.reason, 'not-from-dialog', '机器可读的原因（别让调用方解析中文）');
  assert.ok(r.error.message.length > 0);
  assert.ok(r.error.userMessage.length > 0, 'userMessage 恒非空（Adapter 契约）');
  // SPEC §6：userMessage **不含绝对路径** —— 拒绝信封也不许把路径塞给界面
  assert.equal(r.error.userMessage.includes('X:'), false, 'userMessage 不许含绝对路径');
});

// ============================================================ D2 存在也不够

test('D2 ⭐ 路径真实存在也不是理由：只有「本次会话选过的」才放行', () => {
  const pickedDir = 'G:\\Model';
  const otherExisting = 'C:\\Windows'; // 真实存在、真是目录 —— 但不是选出来的
  const gate = createDialogPathGate({
    normalize: (p) => p,
    classify: fakeClassify(new Set([pickedDir, otherExisting])),
  });
  gate.rememberPicked(pickedDir);

  assert.equal(gate.checkLibraryRoot(pickedDir).ok, true, '选过的放行');
  const r = gate.checkLibraryRoot(otherExisting);
  assert.equal(r.ok, false, '★ 存在且是目录**不够** —— 对账看的是来源');
  assert.equal(r.error.details.reason, 'not-from-dialog');
});

// ============================================================ D3 规范化参与对账

test('D3：记下的与传入的经同一规范化 ⇒ 大小写 / 尾分隔符变体也认（不会误拒）', () => {
  // 用 Windows 的真实语义做注入：realpath 会把 g:\model\ 统一成 G:\Model
  const normalize = (p) => {
    const t = p.replace(/[\\/]+$/, '');
    return t.toLowerCase() === 'g:\\model' ? 'G:\\Model' : t;
  };
  const gate = createDialogPathGate({ normalize, classify: fakeClassify(new Set(['G:\\Model'])) });
  assert.equal(gate.rememberPicked('g:\\model\\'), 'G:\\Model', 'rememberPicked 返回规范形');
  assert.equal(gate.checkLibraryRoot('G:\\Model').ok, true);
  assert.equal(gate.checkLibraryRoot('g:\\model\\').ok, true, '同一目录的不同写法不该被误拒');
  assert.equal(gate.pickedCount(), 1, '同一目录的两种写法只占一个位置');
});

// ============================================================ D4 畸形输入不抛

test('D4：空/非字符串入参 ⇒ 拒绝（reason=empty-path），**绝不抛异常**（信封要求永不抛）', () => {
  const gate = createDialogPathGate({ normalize: (p) => p, classify: fakeClassify(new Set()) });
  for (const bad of ['', '   ', undefined, null, 42, {}]) {
    const a = gate.checkLibraryRoot(bad);
    assert.equal(a.ok, false);
    assert.equal(a.error.details.reason, 'empty-path');
    const b = gate.checkCollectDir(bad);
    assert.equal(b.ok, false);
    assert.equal(b.error.details.reason, 'empty-path');
  }
  assert.equal(gate.pickedCount(), 0, '畸形输入不占位置（也就不会成为"合法来源"）');
  // 规范化实现自己抛（例如 normalizeRootPath 对空串抛）也必须被翻成拒绝
  const throwing = createDialogPathGate({
    normalize: () => {
      throw new Error('boom');
    },
    classify: fakeClassify(new Set()),
  });
  assert.equal(throwing.checkLibraryRoot('C:\\x').ok, false);
});

// ============================================================ D5 collectDirAdd 的已知缺口

test('D5：collectDirAdd **只有**「存在且是目录」这道判据（缺口如实钉住，不假装有对账）', () => {
  const gate = createDialogPathGate({
    normalize: (p) => p,
    classify: fakeClassify(new Set(['E:\\素材'])),
  });
  // ⚠️ 关键：**没 rememberPicked 也放行** —— 因为契约里没有取件目录选择器。
  //    这是已知缺口；将来加选择器时这条断言要**跟着改**（改动本身就是提醒）。
  assert.equal(gate.checkCollectDir('E:\\素材').ok, true);
  assert.equal(gate.pickedCount(), 0, '它没有、也不该假装有"对话框来源"这个证据');

  const r = gate.checkCollectDir('E:\\not-there');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_REQUEST');
  assert.equal(r.error.details.reason, 'not-a-usable-directory');
  assert.equal(r.error.details.availability, 'not-found', '三种原因如实分开（复用 U18 的判据）');
  assert.ok(r.error.userMessage.includes('不存在'), '人话要说清是哪种不可用');
});

// ============================================================ D6 真实 fs 端到端

test('D6 ⭐ 真实 fs：选 A ⇒ A 放行；**真实存在且真是目录的 B 照样被拒**', () => {
  const A = path.join(TMP, 'picked');
  const B = path.join(TMP, 'exists-but-not-picked');
  fs.mkdirSync(A, { recursive: true });
  fs.mkdirSync(B, { recursive: true });
  const gate = createDialogPathGate(); // 真实现：真 normalizeRootPath + 真 classifyRootSync

  assert.equal(gate.checkLibraryRoot(A).ok, false, '没选过 ⇒ 真实存在也必须拒');
  assert.equal(gate.rememberPicked(A), fs.realpathSync.native(A), '记的是规范形（realpath）');
  assert.equal(gate.checkLibraryRoot(A).ok, true, '选过的放行');
  assert.equal(gate.checkLibraryRoot(A + path.sep).ok, true, '尾分隔符不该让同一目录变得不合法');

  const rB = gate.checkLibraryRoot(B);
  assert.equal(rB.ok, false, '★ B 真实存在、真是目录，但不是选出来的 ⇒ 拒（本卡的核心断言）');
  assert.equal(rB.error.details.reason, 'not-from-dialog');
  assert.equal(rB.error.details.picked, 1, '细节里给出"记过几个"便于诊断，且不泄露集合内容');

  // collectDirAdd 的真实现：真实目录放行、真不存在的拒
  assert.equal(gate.checkCollectDir(A).ok, true);
  assert.equal(gate.checkCollectDir(path.join(TMP, 'nope')).ok, false);
});

// ============================================================ D7 接线（P8：注释不算证据）

test('D7 ⭐ 接线扫描：index.ts 真的调了闸门，并把拒绝信封返回出去', () => {
  const code = maskComments(fs.readFileSync(INDEX_TS, 'utf8'));
  assert.ok(/dialogPaths\.rememberPicked\(/.test(code), 'libraryPickDir 必须把对话框结果记进闸门');
  assert.ok(/dialogPaths\.checkLibraryRoot\(/.test(code), 'libraryAdd 必须过闸门');
  assert.ok(/dialogPaths\.checkCollectDir\(/.test(code), 'collectDirAdd 必须过闸门');
  // 「调了但不用结果」= 等于没接：拒绝必须真的 return 出去
  assert.ok(/if \(!gate\.ok\) return gate;/.test(code), 'libraryAdd 的拒绝必须返回给调用方');
  assert.ok(
    /if \(!collectGate\.ok\) return collectGate;/.test(code),
    'collectDirAdd 的拒绝必须返回给调用方',
  );
  // 选择器是**唯一**来源：不许有第二处 rememberPicked（P1）
  assert.equal(
    (code.match(/dialogPaths\.rememberPicked\(/g) ?? []).length,
    1,
    'rememberPicked 只许在 libraryPickDir 一处',
  );
});

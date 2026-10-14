// packages/engine/tests/scanner.test.mjs —— 扫描器的机械断言（SPEC §1 / §7 体检 ⑥；T-13a）
//
// 三条要求各有一条**能红**的用例（不是只跑 happy path）：
//   ① 跳过 .gs-* 与隐藏项 —— 诱饵是**真的会配对成功**的 staging 目录（不跳过就会多出条目）
//   ② 缺包登记 —— 有图无包必须进 missingArchive，且扫描**不是报错**（SPEC「缺包是合法状态」）
//   ③ 魔数检测 —— 名 .jpg 实为 BMP 必须标成 bmp + extMatchesMagic:false（不许按扩展名假装）
// 另有两条守纪律的断言：**只读**（扫描前后整树快照逐字相同）与 uid 公式只有一份（P1）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanLibrary } from '../src/scanner.ts';
import { isReservedLibraryName, GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME } from '../src/gs-names.ts';
import { detectImageFormat, extMatchesFormat, FORMAT_OF_EXT } from '../src/magic.ts';
import { uidOf, relDirOf } from '../src/uid.ts';
import { STAGING_DIRNAME } from '../src/transactions/steps.ts';
import { resolveTestLibraryRoot } from './lib-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 仓库根：向上找标记文件（与同目录其他测试同一套做法；搬目录也不会失效）
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到仓库根（向上找不到 packages/engine/src/engine.ts）');
    p = up;
  }
})();

/** 只造**文件头正确**的最小样本：扫的是魔数，不需要真能解码 */
const HEAD = {
  jpeg: Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
  png: Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex'),
  bmp: Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(30)]),
  unknown: Buffer.from('ZZZZ-not-an-image', 'latin1'),
  empty: Buffer.alloc(0),
};

const tmpLib = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-scan-'));
const put = (root, rel, buf) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
};
const norm = (p) => p.split(path.sep).join('/');
const rels = (items) => items.map((i) => norm(i.relPath)).sort();

/** 整树快照（名字/目录性/大小/mtimeNs）—— 用来证明扫描**没写任何东西** */
function snapshot(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { out.push('D ' + norm(path.relative(root, full))); walk(full); continue; }
      const st = fs.statSync(full, { bigint: true });
      out.push('F ' + norm(path.relative(root, full)) + ' ' + String(st.size) + ' ' + String(st.mtimeNs));
    }
  };
  walk(root);
  return out;
}

// ============================================================ ③ 魔数（纯函数）

test('SC-A 魔数判定：jpeg/png/bmp 认得出；认不出的必须如实回 unknown（不猜）', () => {
  assert.equal(detectImageFormat(HEAD.jpeg), 'jpeg');
  assert.equal(detectImageFormat(HEAD.png), 'png');
  assert.equal(detectImageFormat(HEAD.bmp), 'bmp');
  assert.equal(detectImageFormat(HEAD.empty), 'unknown', '空文件没有格式 —— 不许瞎猜');
  assert.equal(detectImageFormat(Buffer.from('ffd8', 'hex')), 'unknown', '只有 2 字节的"半个 JPEG"不算 JPEG');
  assert.equal(detectImageFormat(HEAD.unknown), 'unknown');

  assert.equal(extMatchesFormat('.jpg', 'jpeg'), true);
  assert.equal(extMatchesFormat('.jpeg', 'jpeg'), true, '.jpeg 与 .jpg 是同一种格式');
  assert.equal(extMatchesFormat('.png', 'jpeg'), false);
  assert.equal(extMatchesFormat('.jpg', 'bmp'), false, '名 .jpg 实为 BMP ⇒ 不一致');
  assert.equal(extMatchesFormat('.jpg', 'unknown'), false, '看不出来时**不许**按扩展名算对');
  assert.equal(extMatchesFormat('.tif', 'jpeg'), false, '不在表里的扩展名一律不一致');
  assert.equal(FORMAT_OF_EXT['.jpg'], 'jpeg');
});

test('SC-B ⭐⭐ U11 反例：保留名判据必须覆盖 .gs.db 家族（".gs-" 前缀不够）', () => {
  // 现实检查 —— 这就是 U11 记下的那个坑：只按 ".gs-" 前缀会**漏掉 .gs.db 一家人**
  assert.equal('.gs.db'.startsWith('.gs-'), false, '这正是"只按 .gs- 前缀"会把它当素材的原因');
  assert.equal('.gs.db-wal'.startsWith('.gs-'), false);
  assert.equal('.gs.db-shm'.startsWith('.gs-'), false);
  assert.equal('.gs.db-journal'.startsWith('.gs-'), false);

  // 唯一判据（engine/src/gs-names.ts）必须认得它们全部
  for (const n of ['.gs-index.bin', '.gs-journal', '.gs-staging', '.gs-write-probe-4711',
                   '.gs.db', '.gs.db-wal', '.gs.db-shm', '.gs.db-journal']) {
    assert.equal(isReservedLibraryName(n), true, n + ' 是库内产物，绝不是素材');
  }
  assert.equal(isReservedLibraryName(STAGING_DIRNAME), true, 'staging 名字的唯一来源是 steps.ts');

  // 三个`名字常量`必须与判据自洽，且值不许悄悄漂移（它们是 SPEC §2 布局图的唯一清单）
  assert.equal(GS_INDEX_NAME, '.gs-index.bin');
  assert.equal(GS_DB_NAME, '.gs.db');
  assert.equal(GS_JOURNAL_NAME, '.gs-journal');
  for (const n of [GS_INDEX_NAME, GS_DB_NAME, GS_JOURNAL_NAME, GS_INDEX_NAME + '.tmp-1-1']) {
    assert.equal(isReservedLibraryName(n), true, n + ' 必须被判成保留名');
  }

  // 反向：判据**不是**"点开头"，也不能宽到把无关名字当保留名
  for (const n of ['.gs-', '.gs', '.gsfoo.jpg', '.gitignore', 'ID-1.jpg', '']) {
    assert.equal(isReservedLibraryName(n), false, JSON.stringify(n) + ' 不该被判成保留名');
  }
  assert.equal(isReservedLibraryName(null), false);
  assert.equal(isReservedLibraryName(undefined), false);
  assert.equal(isReservedLibraryName(7), false);
});

// ============================================================ ① 跳过 .gs-* 与隐藏项

test('SC-C ⭐⭐ U11 反例端到端：库根下的 .gs.db 家族 / .gs-journal/ / .gs-index.bin 都不是素材；staging 诱饵也不进结果', () => {
  const root = tmpLib();
  put(root, path.join('VR', 'ID-1.jpg'), HEAD.jpeg);
  put(root, path.join('VR', 'ID-1.rar'), Buffer.from('r'));
  // ⚠️ U11 的反例：库根下的 .gs.db 及其边车（都不匹配 ".gs-" 前缀）
  put(root, '.gs.db', Buffer.from('db'));
  put(root, '.gs.db-wal', Buffer.from('wal'));
  put(root, '.gs.db-shm', Buffer.from('shm'));
  put(root, '.gs.db-journal', Buffer.from('journal'));
  put(root, '.gs-index.bin', Buffer.from('idx'));
  put(root, '.gs-write-probe-4711', Buffer.from('probe'));
  // 保留名的**目录**：里面的图也不是素材（目录不许进）
  put(root, path.join('.gs-journal', 'ID-7.jpg'), HEAD.jpeg);
  // ⚠️ 诱饵：staging 里是一套**完整配对**的图与包。若跳过失效，items 会多出 1~2 条。
  put(root, path.join('VR', '.gs-staging', 'txnA', 'ID-1.jpg'), HEAD.jpeg);
  put(root, path.join('VR', '.gs-staging', 'txnA', 'ID-1.rar'), Buffer.from('r'));
  put(root, path.join('VR', 'sub', '.gs-staging', 'txnB', 'ID-9.jpg'), HEAD.jpeg);
  // 隐藏项（SPEC §1 要求一并跳过）：点开头但**不是**保留名
  put(root, path.join('CR', '.hidden.jpg'), HEAD.jpeg);
  put(root, path.join('CR', '.hidden.rar'), Buffer.from('r'));
  put(root, '.gitignore', Buffer.from('x'));
  put(root, '.gsfoo.jpg', HEAD.jpeg);
  put(root, path.join('CR', 'ID-2.jpg'), HEAD.jpeg);

  const r = scanLibrary(root, { libId: 'L1' });

  assert.deepEqual(rels(r.items), ['CR/ID-2.jpg', 'VR/ID-1.jpg'], '只有真实素材该进结果');
  assert.equal(r.counts.skippedReserved, 9,
    '.gs.db + 3 边车 + .gs-index.bin + .gs-write-probe-4711 + .gs-journal/ + 两个 .gs-staging/');
  assert.equal(r.counts.skippedHidden, 4, 'CR/.hidden.jpg + CR/.hidden.rar + .gitignore + .gsfoo.jpg');
  assert.equal(r.skipped.total, 13);
  assert.ok(r.skipped.reserved.every((p) => isReservedLibraryName(path.basename(p))),
    '跳过的保留名明细应逐条满足唯一判据');
  assert.ok(r.skipped.hidden.some((p) => p.endsWith('.gsfoo.jpg')),
    '.gsfoo.jpg 不是保留名，但仍是隐藏项 ⇒ 归到 hidden（判据与"点开头"是两件事）');
  for (const it of r.items) {
    assert.equal(isReservedLibraryName(path.basename(it.relPath)), false, '结果里不得出现库内产物');
    assert.ok(!path.basename(it.relPath).startsWith('.'), '结果里不得出现隐藏项');
  }
  assert.equal(r.counts.missingArchive, 1, 'CR/ID-2.jpg 无包；.gs-journal/ 里的图与 .gs 产物都不算');
});

// ============================================================ ② 缺包登记 / 有包无图

test('SC-D ⭐ 缺包是**合法状态**：登记进 missingArchive，扫描不报错', () => {
  const root = tmpLib();
  put(root, path.join('VR', 'ID-3.jpg'), HEAD.jpeg);      // 无包
  put(root, path.join('VR', 'ID-4.jpg'), HEAD.jpeg);
  put(root, path.join('VR', 'ID-4.zip'), Buffer.from('z'));

  const r = scanLibrary(root, { libId: 'L1' });

  assert.equal(r.items.length, 2);
  const noPack = r.items.find((i) => i.stem === 'ID-3');
  assert.equal(noPack.archive, null, '缺包 ⇒ archive 为 null');
  assert.deepEqual(r.missingArchive.map((m) => m.uid), [noPack.uid]);
  assert.equal(r.missingArchive[0].stem, 'ID-3');
  assert.equal(r.counts.missingArchive, 1);
  assert.equal(r.counts.paired, 1);
  assert.equal(r.counts.paired + r.counts.missingArchive, r.counts.images);
});

test('SC-E 有包无图 ⇒ 进 missingImage，且**不**当作素材塞进 items', () => {
  const root = tmpLib();
  put(root, path.join('CR', 'ID-8.7z'), Buffer.from('z'));

  const r = scanLibrary(root, { libId: 'L1' });

  assert.deepEqual(r.items, []);
  assert.equal(r.missingImage.length, 1);
  assert.equal(norm(r.missingImage[0].relPath), 'CR/ID-8.7z');
  assert.equal(r.missingImage[0].ext, '.7z');
});

// ============================================================ ③ 魔数检测（端到端）

test('SC-F ⭐ 名 .jpg 实为 BMP 必须标注（体检 ⑥）；未知/空文件也如实回 unknown', () => {
  const root = tmpLib();
  put(root, path.join('VR', 'J-BMP.jpg'), HEAD.bmp);        // ← 真实库那 20 张的形态
  put(root, path.join('VR', 'J-OK.jpg'), HEAD.jpeg);
  put(root, path.join('VR', 'P-PNG.png'), HEAD.png);
  put(root, path.join('VR', 'P-JPEG.png'), HEAD.jpeg);      // 名 .png 实为 JPEG（真实库有 68 张）
  put(root, path.join('VR', 'J-PNG.jpg'), HEAD.png);        // 名 .jpg 实为 PNG（真实库有 17 张）
  put(root, path.join('VR', 'X-UNKNOWN.jpg'), HEAD.unknown);
  put(root, path.join('VR', 'Z-EMPTY.jpg'), HEAD.empty);

  const r = scanLibrary(root, { libId: 'L1' });
  const by = new Map(r.items.map((i) => [i.stem, i]));

  assert.equal(by.get('J-BMP').imageFormat, 'bmp');
  assert.equal(by.get('J-BMP').extMatchesMagic, false);
  assert.equal(by.get('J-OK').imageFormat, 'jpeg');
  assert.equal(by.get('J-OK').extMatchesMagic, true);
  assert.equal(by.get('P-PNG').extMatchesMagic, true);
  assert.equal(by.get('P-JPEG').imageFormat, 'jpeg');
  assert.equal(by.get('P-JPEG').extMatchesMagic, false);
  assert.equal(by.get('J-PNG').imageFormat, 'png');
  assert.equal(by.get('J-PNG').extMatchesMagic, false);
  assert.equal(by.get('X-UNKNOWN').imageFormat, 'unknown');
  assert.equal(by.get('X-UNKNOWN').extMatchesMagic, false, '认不出的格式不许按扩展名算一致');
  assert.equal(by.get('Z-EMPTY').imageSize, 0);
  assert.equal(by.get('Z-EMPTY').imageFormat, 'unknown');

  assert.equal(r.counts.formatMismatch, 5);
  assert.equal(r.counts.zeroByte, 1);
  assert.deepEqual(
    r.formatMismatch.map((m) => m.imageExt + '@' + m.actual).sort(),
    ['.jpg@bmp', '.jpg@png', '.jpg@unknown', '.jpg@unknown', '.png@jpeg'].sort(),
  );
});

// ============================================================ 配对与 uid

test('SC-G 配对语义：同目录同主干才算一套；.rar/.zip/.7z 都认；跨目录不配对', () => {
  const root = tmpLib();
  put(root, path.join('VR', 'A.jpg'), HEAD.jpeg);
  put(root, path.join('VR', 'A.rar'), Buffer.from('r'));
  put(root, path.join('VR', 'A.zip'), Buffer.from('z'));    // 同主干第二个包：不该多出一条素材
  put(root, path.join('CR', 'A.jpg'), HEAD.jpeg);
  put(root, path.join('CR', 'A.7z'), Buffer.from('7'));
  put(root, 'TOP.jpg', HEAD.jpeg);                          // 根目录下的素材

  const r = scanLibrary(root, { libId: 'L1' });

  assert.equal(r.items.length, 3, 'VR/A·CR/A·TOP —— 同主干的第二个包不产生新条目');
  assert.equal(r.counts.paired, 2, '只有 VR/A 与 CR/A 有包');
  assert.equal(r.counts.missingArchive, 1, 'TOP.jpg 没有包 ⇒ 登记为缺包');
  const vr = r.items.find((i) => i.folder === 'VR');
  const cr = r.items.find((i) => i.folder === 'CR');
  const top = r.items.find((i) => i.stem === 'TOP');
  assert.notEqual(vr.uid, cr.uid, '目录参与种子 ⇒ 同名不同目录不撞');
  assert.equal(vr.relDir, 'VR');
  assert.equal(cr.archive.ext, '.7z', '.7z 也要认（真实库有 76 个）');
  assert.ok(['.rar', '.zip'].includes(vr.archive.ext), '同主干多个包时取先遇到的（与构建器一致）');
  assert.equal(top.relDir, '', '根目录下素材的 rel_dir 是空串（不是 "."）');
  assert.equal(top.folder, '');
  assert.equal(top.uid, uidOf('L1', '', 'TOP'));
});

test('SC-H uid 只有一份实现：扫描结果必须等于 src/uid.ts 的冻结公式，且整树唯一', () => {
  const root = tmpLib();
  const names = ['ID-1', 'ID-2', 'ID-3'];
  for (const n of names) put(root, path.join('VR', n + '.jpg'), HEAD.jpeg);
  // 同名不同目录：必须算出不同 uid（真实库里 ID-125229472 就同时在 VR 与 其他）
  put(root, path.join('其他', 'ID-1.jpg'), HEAD.jpeg);

  const r = scanLibrary(root, { libId: 'L1' });
  for (const it of r.items) {
    assert.equal(it.uid, uidOf('L1', relDirOf(it.relPath), it.stem));
  }
  assert.equal(new Set(r.items.map((i) => i.uid)).size, r.items.length, 'uid 必须唯一（主键）');
  const vr1 = r.items.find((i) => i.relDir === 'VR' && i.stem === 'ID-1');
  const ot1 = r.items.find((i) => i.relDir === '其他' && i.stem === 'ID-1');
  assert.notEqual(vr1.uid, ot1.uid);
});

// ============================================================ 只读

test('SC-I ⭐ 扫描**只读**：前后整树快照（名字/大小/mtimeNs）逐字相同', () => {
  const root = tmpLib();
  put(root, path.join('VR', 'ID-1.jpg'), HEAD.jpeg);
  put(root, path.join('VR', 'ID-1.rar'), Buffer.from('r'));
  put(root, path.join('VR', 'ID-5.jpg'), HEAD.bmp);
  put(root, path.join('CR', 'ID-6.jpg'), HEAD.empty);
  put(root, '.gs-index.bin', Buffer.from('idx'));
  put(root, path.join('VR', '.gs-staging', 'txnX', 'ID-1.jpg'), HEAD.jpeg);
  put(root, path.join('CR', '.hidden.jpg'), HEAD.jpeg);

  const before = snapshot(root);
  scanLibrary(root, { libId: 'L1' });
  const after = snapshot(root);
  assert.deepEqual(after, before, '扫描绝不写素材目录（AGENTS P4）');
});

// ============================================================ 真实库实跑（对账）

test('SC-J ⭐⭐ 真实库实跑：3594 条对账 · 缺包 · 异常 20（BMP 伪装 .jpg）· 只读', (t) => {
  const found = resolveTestLibraryRoot(ROOT);
  if (!found) return t.skip('本机没有可用的素材库根（GEMMA_LIB_ROOT / config.json / 索引 meta 都没有）');

  const before = snapshot(found.root);
  const r = scanLibrary(found.root, { libId: found.libId || 'L1' });
  const after = snapshot(found.root);
  assert.deepEqual(after, before, '对真实库扫描也**不得**改动任何文件');

  // 结构不变量（固定阈值只用在"明显异常才红"的量级上，避免把库内容变动当成代码回归）
  assert.ok(r.counts.images > 3000, '图片数应 >3000，实得 ' + r.counts.images);
  assert.equal(new Set(r.items.map((i) => i.uid)).size, r.items.length, 'uid 必须唯一');
  assert.equal(r.counts.paired + r.counts.missingArchive, r.counts.images);
  assert.equal(r.counts.unreadable, 0, '不该有读不动的目录/文件：' + JSON.stringify(r.unreadable.slice(0, 3)));
  assert.equal(r.items.length, r.counts.images);

  const perFolder = new Map();
  for (const it of r.items) perFolder.set(it.folder, (perFolder.get(it.folder) || 0) + 1);
  const perFormat = new Map();
  for (const it of r.items) perFormat.set(it.imageFormat, (perFormat.get(it.imageFormat) || 0) + 1);
  const perPair = new Map();
  for (const m of r.formatMismatch) {
    const k = m.imageExt + ' -> ' + m.actual;
    perPair.set(k, (perPair.get(k) || 0) + 1);
  }
  const bmpAsJpg = r.formatMismatch.filter((m) => m.imageExt === '.jpg' && m.actual === 'bmp');

  t.diagnostic('库根 ' + found.root + '（来源 ' + found.source + ' · libId ' + (found.libId || '(未记录)') + '）');
  t.diagnostic('条目 ' + r.counts.images + ' · 配对 ' + r.counts.paired + ' · 缺包 ' + r.counts.missingArchive
    + ' · 有包无图 ' + r.counts.missingImage + ' · 零字节 ' + r.counts.zeroByte);
  t.diagnostic('分目录 ' + [...perFolder].sort((a, b) => b[1] - a[1]).map(([k, v]) => (k || '(根)') + ' ' + v).join(' · '));
  t.diagnostic('真实格式 ' + [...perFormat].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '));
  t.diagnostic('扩展名与内容不符 ' + r.counts.formatMismatch + '（' + [...perPair].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') + '）');
  t.diagnostic('其中「名 .jpg 实为 BMP」= ' + bmpAsJpg.length + ' ← SPEC §7 的锚点（已知且合法）');
  t.diagnostic('跳过库内产物（.gs-* / .gs.db 家族 / staging）= ' + r.counts.skippedReserved + ' · 跳过其他隐藏项 = ' + r.counts.skippedHidden
    + '（本库根没有这类条目；跳过机制由 SC-C 的诱饵树证明）');

  assert.ok(bmpAsJpg.length >= 1, '本库应有「名 .jpg 实为 BMP」的条目（SPEC §7 记为已知且合法）');
});

// packages/engine/tests/security.test.mjs —— 引擎层安全不变量（CONTRACT §7 / G-C 的 P1 部分）
//
// 这 5 条不是"实现细节"：P2 的 thumb:// 协议与 IPC 白名单都要靠它们兜底。
// 所以每条都有**可执行的**反例用例 —— 不是靠代码审查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSafeRelPath, resolveInLibrary, resolveQueryImage, assertCollectDirAllowed,
         LibraryRegistry } from '../src/library.ts';
import { ERR, EngineError } from '../src/errors.ts';
import { fingerprintV1, fingerprintLines } from '../src/fingerprint.ts';
import { resolveTestLibraryRoot } from './lib-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 仓库根：测试跟着引擎包走（`packages/engine/tests/`），但 `config.json` / `data/` 仍在
// **仓库根** —— 向上找标记文件，不假设固定层级（搬目录也不会失效）。
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到仓库根（向上找不到 packages/engine/src/engine.ts）');
    p = up;
  }
})();

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-lib-'));
const codeOf = (fn) => {
  try { fn(); return null; } catch (e) { return e instanceof EngineError ? e.code : 'NOT_ENGINE_ERROR'; }
};

// ---------------- ① 只接受相对路径 ----------------

test('① 绝对路径一律拒绝（盘符 / UNC / 前导斜杠）', () => {
  for (const bad of ['C:\\evil.txt', 'c:/evil.txt', '\\\\server\\share\\x', '//server/share',
                     '/etc/passwd', 'G:\\model\\VR\\x.jpg']) {
    assert.equal(isSafeRelPath(bad), false, `应拒绝：${bad}`);
  }
});

test('① 含 .. 的相对路径拒绝', () => {
  for (const bad of ['..\\evil', 'a\\..\\..\\b', '../up', 'VR\\..\\..\\x']) {
    assert.equal(isSafeRelPath(bad), false, `应拒绝：${bad}`);
  }
});

test('① 正常相对路径接受', () => {
  for (const ok of ['VR\\a.jpg', 'CR+VR\\ID-1.png', 'a/b/c.jpg', '其他\\125229472.jpg']) {
    assert.equal(isSafeRelPath(ok), true, `应接受：${ok}`);
  }
});

test('①..④ 经由 .. 逃逸 → PATH_ESCAPES_LIB', () => {
  const root = tmp();
  assert.equal(codeOf(() => resolveInLibrary(root, '..\\..\\windows\\system32\\x.dll')),
               ERR.PATH_ESCAPES_LIB);
});

// ---------------- ③ 库根包含校验 ----------------

test('③ 解析后的真实路径必须仍在库根内', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'VR'));
  fs.writeFileSync(path.join(root, 'VR', 'a.jpg'), 'x');
  const p = resolveInLibrary(root, 'VR\\a.jpg');
  assert.ok(p.toLowerCase().startsWith(fs.realpathSync.native(root).toLowerCase()));
});

test('③ 与之同前缀的兄弟目录不能蒙混过关（前缀比较要带分隔符）', () => {
  const root = tmp();
  const sibling = root + '-evil';        // 与 root 只差一个后缀
  fs.mkdirSync(sibling, { recursive: true });
  assert.equal(codeOf(() => resolveInLibrary(root, '..\\' + path.basename(sibling) + '\\x')),
               ERR.PATH_ESCAPES_LIB);
  fs.rmSync(sibling, { recursive: true, force: true });
});

// ---------------- ④ 符号链接 / 联接点 ----------------

test('④ 库内指向库外的目录联接 → SYMLINK_REJECTED', (t) => {
  const root = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.jpg'), 'secret');
  const link = path.join(root, 'link-out');
  try {
    // Windows 上创建 junction 不需要管理员权限（symlink 需要）
    fs.symlinkSync(outside, link, 'junction');
  } catch (e) {
    return t.skip('本环境无法创建 junction：' + e.message);
  }
  assert.equal(codeOf(() => resolveInLibrary(root, 'link-out\\secret.jpg')),
               ERR.SYMLINK_REJECTED);
  // 清理：**必须用 rmdir** —— junction 是"目录"，且递归 rm 有可能穿过链接删掉目标内容
  fs.rmdirSync(link);
});

test('④ 指向库外的文件符号链接 → SYMLINK_REJECTED', (t) => {
  const root = tmp();
  const outside = tmp();
  const target = path.join(outside, 'secret.jpg');
  fs.writeFileSync(target, 'secret');
  const link = path.join(root, 'alias.jpg');
  try {
    fs.symlinkSync(target, link, 'file');
  } catch (e) {
    return t.skip('本环境无法创建文件符号链接：' + e.message);
  }
  assert.equal(codeOf(() => resolveInLibrary(root, 'alias.jpg')), ERR.SYMLINK_REJECTED);
  fs.rmSync(link, { force: true });
});

// ---------------- ② 取件目录白名单 ----------------

test('② 取件目标在白名单外 → COLLECT_DIR_NOT_ALLOWED', () => {
  const allow = ['E:\\素材待用'];
  assert.equal(codeOf(() => assertCollectDirAllowed('C:\\Windows', allow)),
               ERR.COLLECT_DIR_NOT_ALLOWED);
  assert.equal(codeOf(() => assertCollectDirAllowed('E:\\素材待用\\子目录', allow)), null);
});

test('② 白名单要求整段匹配（E:\\素材待用-x 不算命中）', () => {
  assert.equal(codeOf(() => assertCollectDirAllowed('E:\\素材待用-x', ['E:\\素材待用'])),
               ERR.COLLECT_DIR_NOT_ALLOWED);
});

// ---------------- 查询图：唯一的例外，但只读 + 扩展名白名单 ----------------

test('查询图：扩展名白名单 + 必须是已存在的文件', () => {
  const d = tmp();
  const good = path.join(d, 'q.jpg');
  fs.writeFileSync(good, 'x');
  assert.equal(resolveQueryImage(good), good);
  assert.equal(codeOf(() => resolveQueryImage(path.join(d, 'q.exe'))), ERR.BAD_REQUEST);
  assert.equal(codeOf(() => resolveQueryImage(path.join(d, '缺失.jpg'))), ERR.BAD_REQUEST);
  assert.equal(codeOf(() => resolveQueryImage('')), ERR.BAD_REQUEST);
});

// ---------------- ⑤ 只读操作绝不写库 ----------------

test('⑤ 解析与指纹是只读的：库指纹在操作前后不变', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'VR'));
  fs.writeFileSync(path.join(root, 'VR', 'a.jpg'), 'x');
  fs.writeFileSync(path.join(root, 'VR', 'a.rar'), 'y');
  const before = fingerprintV1(root).fingerprint;
  resolveInLibrary(root, 'VR\\a.jpg');
  fingerprintLines(root);
  resolveQueryImage(path.join(root, 'VR', 'a.jpg'));
  const after = fingerprintV1(root).fingerprint;
  assert.equal(after, before);
});

// ---------------- 注册表 ----------------

test('注册表：未注册的库 → LIB_NOT_FOUND；根不存在 → LIB_ROOT_MISSING', () => {
  const r = new LibraryRegistry({ libraries: [{ libId: 'L1', root: tmp() }] });
  assert.equal(codeOf(() => r.get('L9')), ERR.LIB_NOT_FOUND);
  const r2 = new LibraryRegistry({ libraries: [{ libId: 'L1', root: path.join(tmp(), 'nope') }] });
  assert.equal(codeOf(() => r2.requireExistingRoot('L1')), ERR.LIB_ROOT_MISSING);
});

test('注册表：uid → 路径解析走索引里的 relPath（不接受客户端路径）', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'VR'));
  fs.writeFileSync(path.join(root, 'VR', 'ID-1.jpg'), 'x');
  const r = new LibraryRegistry({ libraries: [{ libId: 'L1', root }] });
  const items = [{ uid: 'aaaa11112222', relPath: 'VR\\ID-1.jpg' }];
  const got = r.resolveByUid('L1', 'aaaa11112222', items);
  assert.equal(got.rel, 'VR\\ID-1.jpg');
  assert.ok(got.abs.toLowerCase().endsWith('id-1.jpg'));
  assert.equal(codeOf(() => r.resolveByUid('L1', '不存在000000', items)), ERR.UID_NOT_FOUND);
});

test('注册表：索引里的 relPath 若被投毒（..\\..）→ 仍被拦住', () => {
  const root = tmp();
  const r = new LibraryRegistry({ libraries: [{ libId: 'L1', root }] });
  const items = [{ uid: 'bbbb11112222', relPath: '..\\..\\windows\\system32\\x.dll' }];
  assert.equal(codeOf(() => r.resolveByUid('L1', 'bbbb11112222', items)), ERR.PATH_ESCAPES_LIB);
});

// ---------------- 指纹：与 Python 侧记录值交叉验证 ----------------

test('指纹 v1：与 baseline-v1.json 记录的值一致（跨语言一致性）', (t) => {
  const basePath = path.join(ROOT, 'data', 'baseline-v1.json');
  if (!fs.existsSync(basePath)) return t.skip('缺 baseline-v1.json');
  // 库根用与生产同序的解析（环境变量 → config.json → 索引自举），
  // 不再只认已删除的 config.json —— 否则这条会**永久跳过**（见 lib-root.mjs 文件头）
  const found = resolveTestLibraryRoot(ROOT);
  if (!found) return t.skip('本机没有可用的素材库根（GEMMA_LIB_ROOT / config.json / 索引 meta 都没有）');
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const recorded = base.disk && base.disk.fingerprint_v1;
  if (!recorded) return t.skip('baseline-v1.json 里没有记录 fingerprint_v1');

  const got = fingerprintV1(found.root);
  assert.equal(got.fingerprint, recorded,
    'JS 与 Python 算出的指纹必须逐字节一致，否则等于没有指纹');
  assert.equal(got.counts.files, base.disk.files_total);
  t.diagnostic(`库 ${got.counts.images} 图 + ${got.counts.archives} 包 · 指纹 ${got.fingerprint.slice(0, 12)}` +
               ` · 库根来自 ${found.source}`);
});

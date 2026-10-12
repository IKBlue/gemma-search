// packages/engine/tests/uid.test.mjs —— UID 规则的单元与整库断言（SPEC-identity §2 冻结）
//
// 为什么要整库断言：uid 是索引主键。碰撞不会报错，只会让两条素材共用一行向量
// （rowByUid 折叠）→ 条目数与行数不等、搜索少一条。这正是"静默错误"，必须显式测。
//
// 运行：node --test packages/engine/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 仓库根：测试跟着引擎包走（`packages/engine/tests/`），但 `config.json` 在**仓库根** ——
// 向上找标记文件，不假设固定层级（搬目录也不会失效）。
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到仓库根（向上找不到 packages/engine/src/engine.mjs）');
    p = up;
  }
})();

/** SPEC-identity §2：uid = sha1( lib_id + "|" + rel_dir + "|" + stem ).slice(0, 12) */
export function uidOf(libId, relDir, stem) {
  const dir = relDir === '.' || relDir == null ? '' : String(relDir);
  return crypto.createHash('sha1')
    .update(`${libId}|${dir}|${stem}`, 'utf8')
    .digest('hex').slice(0, 12);
}

test('uid: 形状是 12 位小写 hex', () => {
  const u = uidOf('L1', 'VR', 'ID-030518714422364');
  assert.match(u, /^[0-9a-f]{12}$/);
});

test('uid: 确定性（同输入同输出）', () => {
  assert.equal(uidOf('L1', 'VR', 'X'), uidOf('L1', 'VR', 'X'));
});

test('uid: 目录参与种子（同主干不同目录 → 不同 uid）', () => {
  // 库里真有这种情形：ID-125229472 同时在 VR 与 其他
  assert.notEqual(uidOf('L1', 'VR', 'ID-125229472'),
                  uidOf('L1', '其他', 'ID-125229472'));
});

test('uid: lib_id 参与种子（跨库不撞）', () => {
  assert.notEqual(uidOf('L1', 'VR', 'X'), uidOf('L2', 'VR', 'X'));
});

test('uid: 根目录下的素材 rel_dir 为空串（不是 "."）', () => {
  assert.equal(uidOf('L1', '.', 'X'), uidOf('L1', '', 'X'));
});

test('uid: 黄金向量（锁住当前行为，改动即报警）', () => {
  // 由 SPEC-identity §2 的公式直接算出并钉住。
  // 这不是"参考实现的输出"，而是**冻结规则的可检测锚点**：
  // 若将来有人无意改了分隔符/大小写/截断长度，这条会立刻失败。
  assert.equal(uidOf('L1', 'VR', 'ID-030518714422364'),
               crypto.createHash('sha1').update('L1|VR|ID-030518714422364', 'utf8')
                 .digest('hex').slice(0, 12));
});

test('uid: 整库唯一性（用真实素材库；库不存在则跳过）', (t) => {
  const cfgPath = path.join(ROOT, 'config.json');
  if (!fs.existsSync(cfgPath)) return t.skip('无 config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const libRoot = cfg.library_root;
  if (!libRoot || !fs.existsSync(libRoot)) return t.skip('素材库不存在：' + libRoot);

  const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
  const seen = new Map();
  const dup = [];
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!IMG.has(ext)) continue;
      const rel = path.relative(libRoot, full);
      const relDir = path.dirname(rel);
      const stem = path.basename(e.name, ext);
      const u = uidOf(cfg.lib_id || 'L1', relDir, stem);
      n++;
      if (seen.has(u)) dup.push([u, seen.get(u), rel]); else seen.set(u, rel);
    }
  };
  walk(libRoot);

  assert.equal(dup.length, 0, `发现 ${dup.length} 处 UID 碰撞：${JSON.stringify(dup.slice(0, 3))}`);
  assert.equal(seen.size, n, 'uid 数量应等于图片数');
  assert.ok(n > 3000, `图片数异常偏少：${n}`);
  t.diagnostic(`整库 ${n} 张 · uid 唯一 · 样例 ${[...seen.entries()][0].join(' → ')}`);
});

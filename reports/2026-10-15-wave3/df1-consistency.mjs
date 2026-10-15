// reports/2026-10-15-wave3/df1-consistency.mjs —— DF-1：**指纹 vs 素材摘要** 的一致性核对（同一库）
//
// 判据（P1：同一件事只能有一套跳过口径）：
//     fingerprintLines(root).counts.files === materialDigest(root).count
//   前者是引擎侧「库指纹」的文件集（SPEC-identity §5）；后者是 main 侧「重建前后素材摘要」的文件集
//   （library-rebuild.materialDigest）。两者都必须用 gs-names.ts 的 isReservedLibraryName 跳过
//   `.gs-*` / `.gs.db`(+边车) / staging —— 否则索引一重建，"库指纹"就变（假"库被改过"）。
//
// 用法（仓库根）: node reports/2026-10-15-wave3/df1-consistency.mjs <库根> [<库根> ...]
// 退出码: 0 = 全部一致；1 = 有不一致（对账失败）
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintLines, fingerprintV1 } from '../../packages/engine/src/fingerprint.ts';
import { materialDigest } from '../../apps/desktop/src/main/library-rebuild.ts';

const roots = process.argv.slice(2);
if (roots.length === 0) { console.error('用法: node reports/2026-10-15-wave3/df1-consistency.mjs <库根> [...]'); process.exit(2); }
let bad = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) { console.log('SKIP ' + root + '：不存在'); continue; }
  const fp = fingerprintLines(root);
  const md = materialDigest(root);
  // 磁盘上的**全部**文件（含保留命名空间）—— 用来说明"漏跳过会多算多少"
  let all = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else all++;
    }
  };
  walk(root);
  const ok = fp.counts.files === md.count;
  if (!ok) bad++;
  console.log('[' + (ok ? 'OK  ' : 'FAIL') + '] ' + root);
  console.log('    fingerprint.files   = ' + fp.counts.files + '（图 ' + fp.counts.images + ' · 包 ' + fp.counts.archives + ' · 其他 ' + fp.counts.other + '）');
  console.log('    materialDigest.count = ' + md.count);
  console.log('    磁盘全部文件（含保留命名空间）= ' + all + ' ⇒ 其中保留命名空间 = ' + (all - md.count) + ' 个（materialDigest 已排除）');
  console.log('    指纹多算 = ' + (fp.counts.files - md.count) + '（修好后应为 0）');
  console.log('    fingerprint_v1 = ' + fingerprintV1(root).fingerprint.slice(0, 12) + '…');
}
process.exit(bad ? 1 : 0);

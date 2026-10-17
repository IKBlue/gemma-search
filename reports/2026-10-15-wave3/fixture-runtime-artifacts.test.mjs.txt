// apps/desktop/tests/fixture-runtime-artifacts.test.mjs —— FIXTURE-DB-1（task-124）的**防复发断言**
//
// 背景（2026-10-17 实测）：e2e 曾把**被跟踪的夹具目录** `apps/desktop/e2e/fixtures/lib-mini`
// 直接当库根交给主进程 ⇒ 产品按 SPEC §3 在**库根**写 `.gs.db` ⇒ **运行期产物落进仓库**：
//   · 未跟踪 ⇒ 差点被 `git add -A` 误提交；
//   · 而且 11 个 spec 每轮都在**同一个** `.gs.db` 上叠加 ⇒ **跨 run 状态污染**。
//
// 修法：`e2e/helpers/app.mjs` 的 `makeFixtureLibCopy()`（库根改指 `data/_e2e-tmp/` 下的副本）。
// 本测试是**机械守卫**：**被跟踪的夹具目录里不许出现任何「保留命名空间」文件**。
// 判据用引擎的 `isReservedLibraryName`（单一来源，AGENTS §8 P1）⇒ 将来新增的产物类型
// （`.gs-index.bin` / `.gs-journal/` / staging / `.gs.db-wal`…）**自动被覆盖**，
// 不需要维护一张 ignore 清单（那正是「下个月又冒一个」的来源）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReservedLibraryName } from '../../../packages/engine/src/gs-names.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 被跟踪的夹具目录（= 仓库输入，不得被运行期改写） */
const TRACKED_FIXTURE_DIRS = [
  path.join(ROOT, 'fixtures'),
  path.join(ROOT, 'apps', 'desktop', 'e2e', 'fixtures'),
];

/** 递归收集保留命名空间条目（**相对路径**，便于报错定位） */
function findReserved(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (isReservedLibraryName(ent.name)) found.push(path.relative(ROOT, abs));
    if (ent.isDirectory()) findReserved(abs, found);
  }
  return found;
}

test('FX1 ⭐ 被跟踪的夹具目录里**不许**有运行期产物（判据 = 引擎的保留命名空间，单一来源）', () => {
  const found = TRACKED_FIXTURE_DIRS.flatMap((d) => findReserved(d));
  assert.deepEqual(
    found,
    [],
    '夹具目录里出现了保留命名空间文件/目录（运行期产物）：\n  ' +
      found.join('\n  ') +
      '\n⇒ 修法：e2e 一律用 helpers/app.mjs 的 makeFixtureLibCopy() 当库根（不要把库根指回夹具目录）；' +
      '\n⇒ 不要靠「删掉它」消红 —— 那只是把下一条留给下一次 git add -A。',
  );
});

test('FX2 防空跑假绿：被跟踪的 e2e 夹具库**必须存在且真的有图**（否则 FX1 是空的绿）', () => {
  const libDir = path.join(ROOT, 'apps', 'desktop', 'e2e', 'fixtures', 'lib-mini');
  assert.equal(fs.existsSync(libDir), true, 'e2e 夹具库不存在 ⇒ FX1 会在空目录上白过（假绿）');
  let images = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(jpg|jpeg|png|webp|bmp)$/i.test(ent.name)) images += 1;
    }
  };
  walk(libDir);
  assert.ok(images >= 3, '夹具库只有 ' + images + ' 张图（要求 >= 3）⇒ 「有库」场景会退化成空库');
});

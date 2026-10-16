// apps/desktop/tests/deps.test.mjs —— 依赖清账的**机械断言**（T4）
//
// 为什么要有它：旧审查文档（已随 v2 清除）与 `SPEC.md` §6 都记过
// 「**声明了但零 import**」的偏离 —— 2026-10-13 实测重数：**28 个**依赖零 import（25 生产 + 12 开发里的）。
// 那**不是一次性的历史问题，而是一种会反复发生的漂移**：有人为了"以后可能用"先装上，
// 然后再也没有然后。⇒ 把它变成断言，以后新增声明时 `npm test` 会立刻提醒。
//
// ⚠️ 两类"零 import 但必须留"的依赖（**不能一概删**）：
//   ① **隐式工具链**：`tsc`（typescript）· `esbuild/vite`（vite）· `electron-builder`（CLI 脚本）
//      · `@types/*`（由 tsconfig 的 `types` 解析，代码里绝不出现 import）
//   ② **peer / 引擎**：`tailwindcss` 由 `@tailwindcss/vite` 当 peer 用；CSS 引擎不经 JS import
//   ⇒ 所以断言不是"零 import 就报错"，而是"**零 import 必须在白名单里、且白名单必须写清理由**"。
//
// ⚠️ 扫描必须**同时覆盖静态与动态 import**。实测教训：第一版只匹配 `from`/`require`，
//    于是 `sharp`（`bmp_decode.mjs:139` 的 `await import('sharp')`）与 `bmp-js`（`:55`）
//    都被判成"零 import" —— **差一点就把编码路径的依赖删了**。见 `D-C` 那条用例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

const SKIP = /^(node_modules|out|data|docs|reports|\.git|\.npm-cache)/;
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(rel(p))) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
/**
 * 扫描范围：**排除本文件自己**。
 *
 * ⚠️ 为什么必须排除（这不是"放宽检查"，是修一个自指的坑）：本文件为了写断言，
 * 必须把依赖名当**数据**写出来（`importers('@tanstack/react-virtual')`、"已在 T4 删除"这类）。
 * 若把自己算进扫描范围，那些字符串会被当成"有 import" ⇒ **D-A 永远绿、D-C 永远红**，
 * 断言变成自我实现。实测就是先踩了这个：删掉 `@tanstack/react-virtual` 后它仍报"有 import"。
 * ⇒ 排除的只有这一个"把依赖名当数据"的文件；`tests/` 下其余文件照常参与扫描。
 */
const SELF = 'apps/desktop/tests/deps.test.mjs';
const files = walk(ROOT).filter((f) => rel(f) !== SELF);

/** 在**非注释**部分找这个依赖被引用的地方（静态 / 动态 / require / 子路径都算） */
function importers(dep) {
  // 用 maskComments：依赖名写在**字符串**里（`from 'x'`），maskNonCode 会把它们抹掉
  const re = new RegExp(
    `['"]${dep.replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m)}(?:/[^'"]*)?['"]`,
  );
  return files.filter((f) => re.test(maskComments(fs.readFileSync(f, 'utf8')))).map(rel);
}

/**
 * 零 import 但**必须留**的依赖 —— 每条都要有理由。
 * ⚠️ 往这里加东西之前先问：真的没有别的办法了吗？（它就是这份断言的"后门"，别让它变垃圾场）
 */
const IMPLICIT = {
  typescript: '`npm run typecheck` 跑 `tsc`；代码里不需要 import 编译器',
  vite: 'electron-vite / @vitejs/plugin-react 的 peer，且是实际打包器；不写 import',
  tailwindcss: '`@tailwindcss/vite` 的 peer，且是 CSS 引擎本身 —— 样式不经 JS import',
  'electron-builder': '`build:win` / `build:unpack` 脚本调它的 CLI',
  '@types/node': '由 tsconfig 的 `types` 解析，代码里绝不出现 import',
  '@types/react': '同上',
  '@types/react-dom': '同上',

  // ── T-09 静态门禁（2026-10-15）：这两条是 **CLI 工具链**，由 npm 脚本调用，
  //    源码里绝不 import —— 与上面的 `tsc` / `electron-builder` 同一类。
  //    ⚠️ 它们的「接线证据」不在 import 里，而在**脚本真的能跑**：
  //       `npm run lint` / `npm run format:check`；原始输出归档在
  //       `reports/2026-10-15-wave3/t09.txt`。下面 D-A 的判据**没有被削弱** ——
  //       **运行时**依赖声明了却零 import，仍然照常报 orphan。
  //    ⚠️ 同批装的 `@eslint/js` 与 `globals` **刻意不列在这里**：它们被
  //       `eslint.config.mjs` 真实 import，D-A 因此不会报；列进来只会让白名单烂成垃圾场。
  eslint: '`npm run lint` 调它的 CLI；规则写在 eslint.config.mjs，代码里不 import',
  prettier: '`npm run format` / `npm run format:check` 调它的 CLI；配置在 .prettierrc',

  // ── P4 界面补齐（TASKS §6，所有者 2026-10-15 批准）：依赖**一次加齐**，
  //    接线按卡片的依赖顺序（task-45…task-50）逐张来。
  //    ⚠️ 这里只是「已声明、还没 import」的过渡态 —— 每张卡片落地时**必须**把它从这条名单里删掉、
  //       改成真实 import（D-A 会在有人忘记删时提醒；D-I 会钉住这条纪律本身）。
  // ⚠️ 2026-10-15（P4-2）：`@tanstack/react-virtual` **已接线**（`search/BrowseGrid.tsx` 用它做虚拟滚动）
  //    ⇒ 已从这条白名单**删除**。删掉的理由是白名单不许变成会烂掉的垃圾场（D-B 只管「还声明着」，
  //    D-A 因为有真实 import 也不会报）—— 所以「接线完成就删」这件事靠人遵守 + 这行注释留痕。
  '@tanstack/react-table': 'P4-2 浏览页 F2 的筛选/排序（同上）',
  'react-hook-form': 'P4-4 设置中心 / P4-5 向导的表单（TASKS §6 目标 4/5）',
  '@hookform/resolvers': '同上：zod 解析器（契约唯一来源是 shared/ipc.ts）',
  sonner: 'P4 各页的统一 toast（替换自研 ui/Toast 的过渡期）',
  cmdk: 'P4-6 命令面板（TASKS §6 目标 6）',
  'lucide-react': 'P4 各页图标（替换 emoji 前缀图标）',
  'yet-another-react-lightbox': 'P4-3 详情页大图灯箱（TASKS §6 目标 3）',
  motion: 'P4 动效；HIG 要求尊重 reduced-motion，故只在必要时用',
};

// ============================================================ D-A 不许有"已装零 import"

test('D-A ⭐ 每个声明的依赖：要么有真实 import，要么在白名单里且写了理由', () => {
  const orphans = [];
  for (const dep of Object.keys(declared)) {
    if (importers(dep).length > 0) continue;
    if (IMPLICIT[dep]) continue;
    orphans.push(dep);
  }
  assert.deepEqual(
    orphans,
    [],
    `这些依赖声明了但全仓零 import，也没在白名单里 —— 要么接上、要么删掉：\n    ${orphans.join('\n    ')}`,
  );
});

test('D-B 白名单不许变成垃圾场：里面每个包都必须**仍然被声明**', () => {
  const stale = Object.keys(IMPLICIT).filter((d) => !declared[d]);
  assert.deepEqual(
    stale,
    [],
    `白名单里这些包已经不在 package.json 里了，删掉它们：${stale.join(', ')}`,
  );
});

test('D-C ⭐⭐ 断言本身有效：能看见**动态** `import()`（差点因此删错依赖）', () => {
  // 这条是"断言的断言"。实测教训：只匹配静态 import 时，sharp / bmp-js 会被误判为零 import。
  for (const [dep, file] of [
    ['sharp', 'packages/indexer/src/bmp_decode.ts'],
    ['bmp-js', 'packages/indexer/src/bmp_decode.ts'],
  ]) {
    const hits = importers(dep);
    assert.ok(
      hits.includes(file),
      `${dep} 应被认出用在 ${file}（动态 import）—— 实得 ${JSON.stringify(hits)}`,
    );
  }
  // ⚠️ 2026-10-15（P4-1）：**判据本身被改了** —— 旧版断言「@tanstack/react-virtual / lucide-react 应报零 import
  //    **且**不该被声明回来」。那在 T4 当时是对的（当时的台账口径是「声明了却零 import = 漂移」），
  //    但 P4 界面补齐（TASKS §6，所有者批准）**明确要求把它们一次加齐**、按卡片顺序接线。
  //    ⇒ 继续拦它们就是拦住已批准的工作。**这不是放宽**：'没人用' 这条判据留了下来（importers === 0），
  //      只是把「不许声明」换成「**必须仍在白名单里 + 白名单必须给理由**」（见下面的 D-I）。
  for (const dep of ['lucide-react']) {
    assert.equal(
      importers(dep).length,
      0,
      `${dep} 在接线前应报零 import（接线后本行会提醒你把它从白名单删掉）`,
    );
    assert.ok(IMPLICIT[dep], `${dep} 已声明 ⇒ 必须在 IMPLICIT 白名单里并写明用途`);
    assert.ok(!orphanAllowed(dep), `${dep} 不该出现在"零 import 且不在白名单"的名单里`);
  }
});

// ============================================================ D-I P4 依赖：白名单条条有理由 + 「零 import」判据仍有效

/** 把 D-A 的判据抽成一个函数，供 D-I 复用（**同一份判定**，不是抄第二遍） */
function orphanAllowed(dep) {
  return importers(dep).length === 0 && !IMPLICIT[dep];
}

test('D-I ⭐ P4 依赖白名单：每条都有非空理由，且「零 import」这条判据仍然有效', () => {
  const P4 = [
    '@tanstack/react-virtual',
    '@tanstack/react-table',
    'react-hook-form',
    '@hookform/resolvers',
    'sonner',
    'cmdk',
    'lucide-react',
    'yet-another-react-lightbox',
    'motion',
  ];
  // ⚠️ 2026-10-15（P4-2）：白名单是**过渡态**（「已声明、还没 import」）。
  //    接线完成的包**必须**从白名单删掉 —— 所以下面分两支判，而不是一律要求它在白名单里：
  //      · 还没有真实 import ⇒ **必须**在白名单里且写明用途；
  //      · 已经有真实 import ⇒ **必须**已经不在白名单里（否则白名单会烂成垃圾场）。
  //    「零 import 且不在白名单」由 D-A 报（orphan），这里不重复报同一件事。
  for (const dep of P4) {
    assert.ok(declared[dep], `${dep} 应已在 package.json 声明（P4 一次加齐）`);
    const wired = importers(dep).length > 0;
    if (wired) {
      assert.ok(
        !IMPLICIT[dep],
        `${dep} 已经接线 ⇒ 必须从白名单删掉（白名单是过渡态，不许留成垃圾场）`,
      );
    } else {
      assert.ok(
        typeof IMPLICIT[dep] === 'string' && IMPLICIT[dep].length >= 8,
        `${dep} 还没接线 ⇒ 必须在白名单里，且理由写成一句人话（谁用、在哪张卡）`,
      );
    }
  }
  // 反向：白名单里**不属于** P4 的那些，理由同样不许空着（避免后门变成垃圾桶）
  for (const [dep, why] of Object.entries(IMPLICIT)) {
    assert.ok(typeof why === 'string' && why.trim().length > 0, `${dep} 的白名单理由不许是空串`);
  }
});

// ============================================================ D-D class 合并只有一份（A-4 / P1）

test('D-D ⭐ class 合并**只有一份实现**（`cn()`）—— `cx.js` 不得复活（A-4 的收口）', () => {
  const ui = fs.readdirSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui'));
  const impls = ui.filter((f) => /^(cx|cn|classnames?|clsx)\.(js|ts)$/i.test(f));
  assert.deepEqual(
    impls,
    ['cn.ts'],
    `ui/ 下应只有 cn.ts 一份 class 合并实现，实得 ${JSON.stringify(impls)}`,
  );

  // 全渲染层不许再有人从别处挪一个 cx 回来
  const strays = files
    .filter((f) => f.includes('renderer') && /\.(js|jsx|ts|tsx)$/.test(f))
    .filter((f) => /from\s+['"][^'"]*\bcx\.js['"]/.test(maskComments(fs.readFileSync(f, 'utf8'))))
    .map(rel);
  assert.deepEqual(strays, [], `这些文件还在 import 已删除的 cx.js：${strays.join(', ')}`);
});

test('D-E `cn()` 真的用了 clsx + tailwind-merge（不是自己手拼字符串）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/cn.ts'), 'utf8');
  assert.match(src, /from 'clsx'/, 'cn 必须用 clsx');
  assert.match(src, /from 'tailwind-merge'/, 'cn 必须用 tailwind-merge（消解同组工具类冲突）');
  assert.match(src, /twMerge\(clsx\(/, 'cn 的实现应是 twMerge(clsx(...))');
});

// ============================================================ D-F 无障碍缺口真的补上了

test('D-F ⭐ Chip 用的是 `aria-pressed` 语义，不只是 class（T4 补的无障碍缺口）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/src/ui/Chip.tsx'), 'utf8');
  assert.match(
    src,
    /aria-pressed=\{active\}/,
    '切换按钮必须暴露 aria-pressed（class 名对屏幕阅读器不可见）',
  );
});

test('D-G 确认弹窗真的用 Radix 的**可访问原语**（不是手写 overlay 冒充）', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'apps/desktop/src/renderer/src/ui/ConfirmDialog.tsx'),
    'utf8',
  );
  // 这几件是手写 overlay 最容易漏、也最难自己实现的（角色 / 焦点陷阱 / ESC / 焦点归还）
  for (const prim of [
    'AlertDialog.Root',
    'AlertDialog.Overlay',
    'AlertDialog.Content',
    'AlertDialog.Title',
    'AlertDialog.Description',
    'AlertDialog.Cancel',
    'AlertDialog.Action',
  ]) {
    assert.ok(src.includes(prim), `确认弹窗必须用 ${prim}（换成普通 div 就丢了角色与焦点管理）`);
  }
  assert.match(src, /data-testid="confirm-dialog"/, '需要一个稳定的测试挂点（E2E / 断言都用它）');
});

test('D-H 破坏性操作走"请求 → 确认"，不再直接执行（取件会写文件）', () => {
  const page = fs.readFileSync(
    path.join(ROOT, 'apps/desktop/src/renderer/src/pages/SearchPage.tsx'),
    'utf8',
  );
  assert.match(page, /onCollect=\{requestCollect\}/, '取件必须先经过 requestCollect（弹确认框）');
  assert.ok(
    !/onCollect=\{\(item\) => collect\(/.test(page),
    '不许再直接调 collect —— 那会绕过确认',
  );
  assert.match(page, /<ConfirmDialog/, 'SearchPage 必须挂确认弹窗');
});

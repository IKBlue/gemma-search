// tools/verify_renderer_dom.mjs —— React 渲染层的**真跑**验收（jsdom，不需要 Electron）
//
// 2026-10-10 起界面按原型套件的设计重写（原型现已归档到 `docs/archive/prototype/`），
// 类名体系换成了原型的 `.sidebar/.main/.topbar/.panel/.metrics/.gallery/.photo-card/.tag/.score`，
// 本守卫同步按新 DOM 断言。它检：
//   1) 启动：indexStatus 被调用；侧栏读到库根；指标卡显示真实条数与精度/设备
//   2) 文字检索：参数正确（含分类筛选"全部 = 四个目录"与单选某一类）
//   3) 以图搜图：选文件后 search 带上 queryImagePath；未选时被拦下且不发 IPC
//   4) 结果卡：缩略图走 thumb://、分类标签、分数、动作按钮接线与禁用规则
//   5) 事件：encoder.ready → 指标卡出现设备名（webgpu）
//
// ⚠️ 它**不能**证明：CSS 真的生效、thumb:// 真能取到图、真实 IPC、真实窗口。
//    那几件事由 `reports/G-D-p2-electron/` 的实跑证据负责。
//
// 用法：npm run build && node tools/verify_renderer_dom.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.mjs'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到项目根（向上找不到 packages/engine/src/engine.mjs）');
    p = up;
  }
})();

const OUT_R = path.join(ROOT, 'out', 'renderer');
const SRC_HTML = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'index.html');

const problems = [];
const ok = (cond, label, detail = '') => {
  console.log(`  [${cond ? 'OK  ' : 'FAIL'}] ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) problems.push(label);
};

// ---------------------------------------------------------------- 1) jsdom + 真实 HTML
const html = fs.readFileSync(SRC_HTML, 'utf8');
if (!/id="root"/.test(html)) {
  console.error('apps/desktop/src/renderer/index.html 缺少挂载点 #root');
  process.exit(1);
}
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

const defineGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
defineGlobal('window', window);
defineGlobal('document', window.document);
defineGlobal('navigator', window.navigator);
defineGlobal('HTMLElement', window.HTMLElement);
defineGlobal('Element', window.Element);
defineGlobal('Node', window.Node);
defineGlobal('Event', window.Event);
defineGlobal('KeyboardEvent', window.KeyboardEvent);
defineGlobal('MouseEvent', window.MouseEvent);
defineGlobal('getComputedStyle', window.getComputedStyle.bind(window));

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const byText = (sel, text) =>
  [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text);

/** 模拟输入：**必须**用原型 setter，否则 React 的 value-tracker 会吃掉这次变更 */
function typeInto(el, text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, text);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------- 2) mock 主进程
const calls = [];
const MOCK_RESULTS = [
  { libId: 'L1', uid: '022a00481875', score: 0.9312, band: 'high', folder: 'VR', stem: 'ID-032109719124396',
    relPath: 'VR\\ID-032109719124396.png', archive: { ext: '.rar', name: 'ID-032109719124396.rar', size: 2400000 }, imageSize: 0 },
  { libId: 'L1', uid: '022a00481876', score: 0.81, band: 'mid', folder: 'CR', stem: 'ID-11',
    relPath: 'CR\\ID-11.jpg', archive: null, imageSize: 1200000 },
  // 第三条刻意既无包也无图路径：这时「定位」必须已被禁用（防误操作）
  { libId: 'L1', uid: '022a00481877', score: 0.5, band: 'low', folder: '其他', stem: '',
    relPath: null, archive: null, imageSize: 0 },
];

let eventCb = null;
window.api = {
  async invoke(method, params) {
    calls.push({ method, params });
    if (method === 'indexStatus') {
      return { ok: true, data: { libs: [{ libId: 'L1', label: '主库', root: 'G:\\model', rootExists: true,
        indexed: 3594, encoded: 3594, dim: 768, failed: 0, healthy: true, problems: [],
        compat: 'onnx-community/embeddinggemma-2-ONNX|daa72c51243991dfcaf9f9137d2c573d8f7790c0|fp32|2|140|768|l2|mean_soft_tokens' }] } };
    }
    if (method === 'search') return { ok: true, data: { results: MOCK_RESULTS, tookMs: 42, libsSkipped: [] } };
    if (method === 'collect') return { ok: true, data: { succeeded: ['a'], skipped: [], failed: [], targetDir: 'G:\\取件\\2026' } };
    if (method === 'reveal') return { ok: true, data: {} };
    return { ok: false, error: { code: 'INTERNAL', userMessage: 'mock 未实现：' + method } };
  },
  onEvent(cb) { eventCb = cb; return () => {}; },
};

// ---------------------------------------------------------------- 3) 跑构建产物
const assetsDir = path.join(OUT_R, 'assets');
const bundle = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).find((f) => f.endsWith('.js')) : null;
if (!bundle) {
  console.error('找不到 out/renderer/assets/*.js —— 先跑 `npm run build`');
  process.exit(1);
}
const bundlePath = path.join(assetsDir, bundle);

console.log('='.repeat(96));
console.log('React 渲染层验收（jsdom，原型版界面）');
console.log('  HTML   :', path.relative(ROOT, SRC_HTML));
console.log('  bundle :', path.relative(ROOT, bundlePath), `(${fs.statSync(bundlePath).size} B)`);

let bootError = null;
try {
  await import(pathToFileURL(bundlePath).href);
  await tick(140);
} catch (e) {
  bootError = e;
}

console.log('\n--- 1) 启动路径 ---');
const root = () => document.getElementById('root');
ok(!bootError, 'bundle 载入 + React 挂载不抛错', bootError ? String(bootError.message) : '');
ok(!!root() && root().children.length > 0, 'React 真的渲染出了内容');
ok(calls.some((c) => c.method === 'indexStatus'), '启动时调了 indexStatus');

const sidebarText = document.querySelector('.sidebar')?.textContent || '';
ok(/G:\\model/.test(sidebarText), '侧栏显示图库根', sidebarText.replace(/\s+/g, ' ').slice(0, 60));
ok(/100% 已建立索引/.test(sidebarText), '侧栏显示索引百分比');

const metricsText = () => document.querySelector('.metrics')?.textContent || '';
ok(/3,594/.test(metricsText()), '指标卡显示真实条数 3,594', metricsText().replace(/\s+/g, ' ').slice(0, 80));
ok(/fp32/.test(metricsText()) && /seq140/.test(metricsText()), '指标卡显示精度与 seq', metricsText().replace(/\s+/g, ' ').slice(0, 80));

console.log('\n--- 2) 文字检索 ---');
const input = document.querySelector('#query');
ok(!!input, '找到检索输入框 #query');
const searchBtn = byText('button', '搜索图片 →');
ok(!!searchBtn, '找到「搜索图片 →」按钮');

typeInto(input, '北欧吊灯');
click(searchBtn);
await tick(140);

const searchCall = calls.find((c) => c.method === 'search');
ok(!!searchCall, '点了搜索 → 调了 search');
ok(searchCall && searchCall.params.mode === 'text' && searchCall.params.text === '北欧吊灯',
  '参数正确（mode/text）', searchCall ? JSON.stringify({ mode: searchCall.params.mode, text: searchCall.params.text }) : '');
const allFolders = ['VR', 'CR', 'CR+VR', '其他'];
ok(searchCall && JSON.stringify(searchCall.params.filters.folders) === JSON.stringify(allFolders),
  '「全部」时不下发分类过滤（发四个目录）', searchCall ? JSON.stringify(searchCall.params.filters.folders) : '');

const cards = () => [...document.querySelectorAll('.photo-card')];
ok(cards().length === MOCK_RESULTS.length, `结果卡渲染出 ${MOCK_RESULTS.length} 张`, `实际 ${cards().length}`);
ok(!document.querySelector('.hint'), '检索后引导块消失');

const first = cards()[0];
const img = first?.querySelector('img.photo-img');
ok(!!img && String(img.getAttribute('src')).startsWith('thumb://L1/022a00481875@256'),
  '缩略图 URL 形状正确', img ? String(img.getAttribute('src')) : '(无 img)');
ok(!!first?.querySelector('.tag.VR'), '分类标签正确（.tag.VR）');
ok(/0\.9312/.test(first?.textContent || ''), '分数被显示（4 位）',
  JSON.stringify((first?.textContent || '').replace(/\s+/g, ' ').slice(0, 70)));

console.log('\n--- 3) 分类筛选（单选）---');
const vrChip = byText('button', 'VR');
calls.length = 0;
click(vrChip);
await tick(40);            // 等 React 提交分类状态
click(searchBtn);
await tick(140);
const filtered = calls.find((c) => c.method === 'search');
ok(filtered && JSON.stringify(filtered.params.filters.folders) === JSON.stringify(['VR']),
  '选中 VR → 只下发 VR', filtered ? JSON.stringify(filtered.params.filters.folders) : '');
click(byText('button', '全部'));

console.log('\n--- 4) 拦截与提示 ---');
calls.length = 0;
typeInto(input, '   ');
click(searchBtn);
await tick(60);
ok(!calls.some((c) => c.method === 'search'), '空查询不去打主进程');
ok(/请输入要查找的内容/.test(document.querySelector('.toast')?.textContent || ''),
  '空查询给了提示', JSON.stringify(document.querySelector('.toast')?.textContent));

console.log('\n--- 5) 以图搜图路径 ---');
const pickBtn = [...document.querySelectorAll('button')].find((b) => /以图搜图/.test(b.textContent || ''));
ok(!!pickBtn, '找到「以图搜图」入口');
const fileInput = document.querySelector('input[type=file]');
ok(!!fileInput, '页面上有文件选择器');
calls.length = 0;
if (pickBtn) click(pickBtn);
await tick(40);            // 等 React 提交查询方式
click(searchBtn);
await tick(60);
ok(!calls.some((c) => c.method === 'search'), '未选参考图时不发 IPC');
ok(/请先选择一张参考图/.test(document.querySelector('.toast')?.textContent || ''),
  '提示"先选参考图"', JSON.stringify(document.querySelector('.toast')?.textContent));

// 伪造一次文件选择（jsdom 的 input.files 是只读的，用 defineProperty 造出来）
Object.defineProperty(fileInput, 'files', { value: [{ name: 'ref.jpg', path: 'C:\\tmp\\ref.jpg' }], configurable: true });
fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(60);
calls.length = 0;
click(searchBtn);
await tick(140);
const imgCall = calls.find((c) => c.method === 'search');
ok(imgCall && imgCall.params.mode === 'image' && imgCall.params.queryImagePath === 'C:\\tmp\\ref.jpg',
  '选图后 search 带上 queryImagePath', imgCall ? JSON.stringify({ mode: imgCall.params.mode, p: imgCall.params.queryImagePath }) : '');

console.log('\n--- 6) 卡片动作 ---');
typeInto(input, '北欧吊灯');
click(searchBtn);
await tick(140);
const acts = (i) => [...cards()[i].querySelectorAll('.card-acts button')];
ok(acts(0)[0].disabled === false, '有包的卡片「定位」可用');
ok(acts(2)[0].disabled === true, '既无包也无图路径的卡片「定位」被禁用（防误操作）',
  `disabled=${acts(2)[0].disabled}`);
calls.length = 0;
click(acts(0)[1]);
await tick(80);
ok(calls.some((c) => c.method === 'collect'), '点「取件」→ 调了 collect');
ok(/取件：成功 1/.test(document.querySelector('.toast')?.textContent || ''),
  '取件结果被反馈到 toast', JSON.stringify(document.querySelector('.toast')?.textContent));

console.log('\n--- 7) 主进程事件 ---');
if (eventCb) eventCb({ type: 'encoder.ready', device: 'webgpu', loadMs: 2400 });
await tick(80);
ok(/webgpu/.test(metricsText()), 'encoder.ready → 指标卡显示设备（webgpu）', metricsText().replace(/\s+/g, ' ').slice(0, 90));

console.log('\n' + '='.repeat(96));
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('React 渲染层逻辑全过（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件）。');
console.log('**这只排除了"渲染逻辑写错"，不等于界面好看或可用** —— CSS 生效与真实窗口');
console.log('由 `reports/G-D-p2-electron/` 的自截图证据负责（GS_CAPTURE=<png>）。');

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

// `libraryConfig` 是 D2 修复引入的**启动首个调用**：它决定显示首启向导还是检索页。
// 默认给"已有库"，这样下面所有检索相关断言走的都是**有库时的真实路径**。
// 要测"无库 → 向导"这条分支，在 `__mockEmptyLibrary` 置真即可（见 §9）。
let mockEmptyLibrary = false;
// F-01：`reveal` 的成败要能被切换 —— 否则"界面把失败当成功"这条回归**测不出来**。
// 默认成功（正常路径），置真则返回引擎在端口未注入时给的 `PORT_MISSING`。
let mockRevealError = null;
const MOCK_LIBRARIES = [{ libId: 'L1', root: 'G:\\model', label: '主库', source: 'index-meta' }];

window.api = {
  async invoke(method, params) {
    calls.push({ method, params });
    if (method === 'libraryConfig') {
      return { ok: true, data: {
        libraries: mockEmptyLibrary ? [] : MOCK_LIBRARIES,
        collect: { dirs: { 素材待用: 'E:\\素材待用' }, default: '素材待用' },
        chosen: mockEmptyLibrary ? null : 'index-meta',
        diagnostics: [], warnings: [],
        registryPath: 'C:\\Users\\x\\AppData\\Roaming\\gemma-search\\library-registry.json',
      } };
    }
    if (method === 'libraryPickDir') return { ok: true, data: { canceled: false, path: 'G:\\model' } };
    if (method === 'libraryAdd') return { ok: true, data: { added: { libId: 'L1', root: 'G:\\model' }, libraries: MOCK_LIBRARIES } };
    if (method === 'indexStatus') {
      return { ok: true, data: { libs: [{ libId: 'L1', label: '主库', root: 'G:\\model', rootExists: true,
        indexed: 3594, encoded: 3594, dim: 768, failed: 0, healthy: true, problems: [],
        compat: 'onnx-community/embeddinggemma-2-ONNX|daa72c51243991dfcaf9f9137d2c573d8f7790c0|fp32|2|140|768|l2|mean_soft_tokens' }] } };
    }
    if (method === 'search') return { ok: true, data: { results: MOCK_RESULTS, tookMs: 42, libsSkipped: [] } };
    if (method === 'collect') return { ok: true, data: { succeeded: ['a'], skipped: [], failed: [], targetDir: 'G:\\取件\\2026' } };
    if (method === 'reveal') {
      if (mockRevealError) return { ok: false, error: mockRevealError };
      return { ok: true, data: { revealed: true, path: 'G:\\model\\VR\\ID-032109719124396.rar' } };
    }
    return { ok: false, error: { code: 'INTERNAL', userMessage: 'mock 未实现：' + method } };
  },
  onEvent(cb) { eventCb = cb; return () => {}; },
  /** 仅供本守卫内部切换 mock 行为（渲染层不会调用它） */
  __setEmptyLibrary(v) { mockEmptyLibrary = v; },
  __setRevealError(e) { mockRevealError = e; },
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
// 用 getter 而不是一次性快照：§8 之后应用会被卸载再装回来，
// 快照会指向已脱离文档的旧节点（那时 dispatchEvent 不冒泡到 React 的根，点了等于没点）。
const q = () => document.querySelector('#query');
const sBtn = () => byText('button', '搜索图片 →');
const input = q();
ok(!!input, '找到检索输入框 #query');
const searchBtn = sBtn();
ok(!!searchBtn, '找到「搜索图片 →」按钮');

typeInto(q(), '北欧吊灯');
click(sBtn());
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
click(sBtn());
await tick(140);
const filtered = calls.find((c) => c.method === 'search');
ok(filtered && JSON.stringify(filtered.params.filters.folders) === JSON.stringify(['VR']),
  '选中 VR → 只下发 VR', filtered ? JSON.stringify(filtered.params.filters.folders) : '');
click(byText('button', '全部'));

console.log('\n--- 4) 拦截与提示 ---');
calls.length = 0;
typeInto(q(), '   ');
click(sBtn());
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
click(sBtn());
await tick(60);
ok(!calls.some((c) => c.method === 'search'), '未选参考图时不发 IPC');
ok(/请先选择一张参考图/.test(document.querySelector('.toast')?.textContent || ''),
  '提示"先选参考图"', JSON.stringify(document.querySelector('.toast')?.textContent));

// 伪造一次文件选择（jsdom 的 input.files 是只读的，用 defineProperty 造出来）
Object.defineProperty(fileInput, 'files', { value: [{ name: 'ref.jpg', path: 'C:\\tmp\\ref.jpg' }], configurable: true });
fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(60);
calls.length = 0;
click(sBtn());
await tick(140);
const imgCall = calls.find((c) => c.method === 'search');
ok(imgCall && imgCall.params.mode === 'image' && imgCall.params.queryImagePath === 'C:\\tmp\\ref.jpg',
  '选图后 search 带上 queryImagePath', imgCall ? JSON.stringify({ mode: imgCall.params.mode, p: imgCall.params.queryImagePath }) : '');

console.log('\n--- 6) 卡片动作 ---');
typeInto(q(), '北欧吊灯');
click(sBtn());
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

console.log('\n--- 8) 首启向导（D2 修复：一个库都没有时必须先向导，不能直接进检索页）---');// 怎么测这条分支：`main.jsx` 在 bundle 上挂了 `__DSH_RENDER` 钩子，可**按源码相对路径**
// 重新挂载任意渲染层组件（用 Vite 的 import.meta.glob 在构建期收集，无需在守卫里写 import 路径，
// 也不会把任何调试入口带进产物之外的开放面）。这样就不必真的去写用户注册表。
{
  window.api.__setEmptyLibrary(true);

  const gateSrc = 'pages/LibraryGate.jsx';
  if (typeof window.__DSH_RENDER !== 'function' || !window.__DSH_ROOT) {
    ok(false, 'main.jsx 提供了 __DSH_RENDER / __DSH_ROOT（否则向导分支无法被验证）');
  } else {
    // **从零复现首启**：先卸掉应用本体，再用同一个 #root 挂 LibraryGate。
    // 不这么做就是在"装饰"一个已经渲染好的检索页，测不出"无库时不该进检索页"。
    window.__DSH_ROOT.unmount();
    calls.length = 0;

    const mounted = await window.__DSH_RENDER(gateSrc, window.__DSH_ROOT.element);
    if (!mounted || !mounted.ok) {
      ok(false, `能挂载 ${gateSrc}`, JSON.stringify(mounted));
    } else {
      await tick(160);
      ok(document.querySelector('.wizard-overlay') !== null, '空库时渲染出向导遮挡层');
      ok(document.querySelector('.sidebar') === null,
        '空库时**不**渲染检索界面 —— 整个文档里没有侧栏（不是只看某个容器）');
      const btns = [...document.querySelectorAll('.wizard button')];
      const labels = btns.map((b) => b.textContent.trim());
      ok(labels.some((t) => t.includes('选择文件夹')), '向导有「选择文件夹…」按钮', labels.join(' | '));
      const addBtn = btns.find((b) => b.textContent.includes('添加这个库'));
      ok(!!addBtn, '向导有「添加这个库」按钮', labels.join(' | '));
      ok(addBtn && addBtn.disabled === true, '未选目录时「添加这个库」被禁用（不能提交空路径）');

      // 点「选择文件夹…」→ 必须真的去调主进程（mock 会回一个路径）
      calls.length = 0;
      const pickBtn = btns.find((b) => b.textContent.includes('选择文件夹'));
      if (pickBtn) { pickBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(140); }
      ok(calls.some((c) => c.method === 'libraryPickDir'), '点「选择文件夹…」→ 调了 libraryPickDir',
        calls.map((c) => c.method).join(','));
      // 选到路径后「添加这个库」必须变为可用
      const addBtn2 = [...document.querySelectorAll('.wizard button')].find((b) => b.textContent.includes('添加这个库'));
      ok(addBtn2 && addBtn2.disabled === false, '选到目录后「添加这个库」变为可用');

      mounted.unmount();
    }
  }
  window.api.__setEmptyLibrary(false);
}

console.log('\n--- 9) 定位的失败路径（F-01：失败必须显示失败，不许静默假成功）---');
{
  // §8 把应用卸掉换成了向导。后面两段要接着用检索界面，所以先把应用**装回来**
  // （mock 的空库开关已复位 ⇒ LibraryGate 会渲染 SearchPage）。
  const remount = await window.__DSH_RENDER('pages/LibraryGate.jsx', window.__DSH_ROOT.element);
  await tick(160);
  ok(!!remount && remount.ok, '把应用装回来（§8 卸载后的恢复）', remount ? `ok=${remount.ok}` : 'undefined');

  // F-01 的原始症状：引擎在端口缺失时**照样**返回 ok({revealed:true})，
  // 于是界面显示「已在资源管理器中定位」而资源管理器毫无动静。
  // 这条断言就是那个症状的**回归锁定**：mock 给出 PORT_MISSING 时，界面绝不能显示成功。
  window.api.__setRevealError({
    code: 'PORT_MISSING',
    message: '未注入 shell 端口',
    userMessage: '这个功能在当前环境里不可用（缺少所需的系统接口）。',
    details: { port: 'shell' },
  });
  typeInto(q(), '北欧吊灯');
  click(sBtn());
  await tick(160);

  calls.length = 0;
  const card0 = cards()[0];
  const locateBtn = card0 && [...card0.querySelectorAll('.card-acts button')][0];
  ok(!!locateBtn, '检索后有卡片可取「定位」按钮');
  if (locateBtn) { click(locateBtn); await tick(140); }
  const revealCall = calls.find((c) => c.method === 'reveal');
  ok(!!revealCall, '点「定位」→ 调了 reveal', calls.map((c) => c.method).join(','));
  ok(revealCall && revealCall.params && revealCall.params.libId === 'L1'
     && typeof revealCall.params.uid === 'string'
     && (revealCall.params.target === 'archive' || revealCall.params.target === 'image'),
    'reveal 请求形状符合契约 §2.4（libId / uid / target）',
    revealCall ? JSON.stringify(revealCall.params) : '');
  const toastText = () => (document.querySelector('.toast')?.textContent || '');
  ok(!/已在资源管理器中定位/.test(toastText()),
    '⭐ 失败时**不得**显示「已在资源管理器中定位」（F-01 的静默假成功回归）', toastText());
  ok(/不可用|系统接口/.test(toastText()),
    '失败时显示主进程给的 userMessage（不是自编文案）', toastText());
  window.api.__setRevealError(null);

  // ⭐ 成功路径也要断言（F-01 复核 R-1）：成功文案**不得声称已定位** ——
  // 引擎只保证「文件在盘上 + 端口被调用过」，`shell.showItemInFolder` 不报告结果。
  // 原先这条路径**全仓无断言**，所以"成功提示过度声称"一直没人发现。
  // 注意：toast 没有"清空"接口且消息会保留，所以这里靠**文案内容不同**来区分 ——
  // 上一轮是失败文案，若成功文案没被写出来，断言会看到旧失败文案而失败。这比"非空"强。
  typeInto(q(), '北欧吊灯');
  click(sBtn());
  await tick(160);
  const okBtn = cards()[0] && [...cards()[0].querySelectorAll('.card-acts button')][0];
  if (okBtn) { click(okBtn); await tick(140); }
  const okToast = toastText();
  ok(!/不可用|系统接口/.test(okToast), '成功时不再显示上一轮的失败文案（说明成功路径真的写了反馈）', okToast);
  ok(!/已在资源管理器中定位/.test(okToast),
    '⭐ 成功文案**不得**写成「已在资源管理器中定位」（我们并不知道资源管理器做了什么）', okToast);
  ok(/已请求|定位/.test(okToast), '成功文案说清楚"已请求"而不是断言结果', okToast);
}

console.log('\n--- 10) 档位来自引擎（F-02：界面不得自算阈值）---');
{
  // mock 里第一条是 score=0.9312 / band='high'，第二条是 0.81 / band='mid'。
  // 用**引擎的真实阈值**看：0.81 在文本模态下是 mid（≥0.65），压根不是「较弱」。
  // 界面原先自写 0.97/0.93 ⇒ 两条都会被标成「较弱」——这正是 F-02 的原始症状。
  const badges = () => [...document.querySelectorAll('.score')];
  const textOf = (el) => (el?.textContent || '');
  await tick(40);
  typeInto(q(), '北欧吊灯');
  click(sBtn());
  await tick(140);
  const bs = badges();
  ok(bs.length >= 2, `渲染出 ${bs.length} 个分数徽标`, `实际 ${bs.length}`);
  if (bs.length < 2) {
    // 拿不到两条就明确判失败并跳过下面几条 —— 不要让 `bs[1].dataset` 崩栈，
    // 那样后面的断言全被跳过，看起来像"守卫没跑完"而不是"这里有问题"。
    ok(false, '至少需要 2 条结果才能验证档位映射');
  } else {
  const b0 = bs[0], b1 = bs[1];
  ok(/同款区间/.test(textOf(b0)), "band='high' → 文案「同款区间」", textOf(b0));
  ok(/很接近/.test(textOf(b1)), "band='mid' → 文案「很接近」", textOf(b1));
  ok(!/较弱/.test(textOf(b1)), '⭐ band=mid 的那条**不得**出现「较弱」（F-02 原始症状）', textOf(b1));
  ok(b0.dataset.band === 'high' && b1.dataset.band === 'mid',
    'data-band 原样反映引擎给的档位（不是界面换算出来的）',
    `${b0.dataset.band} / ${b1.dataset.band}`);
  }

  // 诚实降级：引擎不给 band ⇒ 只显示分数，不猜档位。
  // 用注入式渲染单独挂一个「无 band」的徽标，而不是指望 mock 数据里恰好有一条。
  const host = document.createElement('div');
  document.body.appendChild(host);
  const one = await window.__DSH_RENDER('ui/Score.jsx', host, { score: 0.81 });
  if (!one || !one.ok) {
    ok(false, '能单独挂载 Score.jsx 以验证缺 band 的降级', one ? `ok=${one.ok} err=${one.error || ''}` : 'undefined');
  } else {
    await tick(60);
    const t = host.textContent || '';
    ok(!/同款区间|很接近|较弱/.test(t),
      '⭐ 缺 band 时只显示分数，**不猜档位**（诚实降级）', t);
    ok(/0\.8100/.test(t), '缺 band 时分数本身仍显示', t);
    one.unmount();
  }
  host.remove();
}

console.log('\n' + '='.repeat(96));
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('React 渲染层逻辑全过（启动 / 文字检索 / 分类 / 以图搜图 / 卡片动作 / 事件）。');
console.log('**这只排除了"渲染逻辑写错"，不等于界面好看或可用** —— CSS 生效与真实窗口');
console.log('由 `reports/G-D-p2-electron/` 的自截图证据负责（GS_CAPTURE=<png>）。');

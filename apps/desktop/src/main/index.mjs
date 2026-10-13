// apps/desktop/src/main/index.mjs —— Electron 主进程（P2）
//
// 职责（SPEC-security §2–§5）：
//   · 组装引擎（注入 ONNX 编码器端口）—— 库来源见 library-config.mjs（D2 修复）
//   · 只开两个 IPC 通道：engine:invoke / engine:event
//   · 每个调用先做**来源校验**，再过**zod 白名单**，最后才打引擎
//   · 窗口姿态：nodeIntegration:false / contextIsolation:true / sandbox:true
//   · 拒绝新窗口与外部导航
//
// 刻意不做：不引 HTTP 端口、不加载任何远程内容、不自动更新。
//
// ── 本文件是 `app/main/index.mjs` 的迁移版（2026-10-10，electron-vite 工程化）──
// 行为保持逐条一致，只改三类事：① 资源路径（out/ 布局）② dev 态加载方式
// （`ELECTRON_RENDERER_URL`，见 electron.vite.config.mjs）③ 编码器改成**按需动态导入**
// （这样 transformers 的导入期失败可被捕获并报给界面，而不是让进程无声消失）。
//
// Electron 的 `electron` 模块在 ESM 下用默认导入再解构最稳：**具名导入会在
// 实例化阶段抛**，那时任何日志都来不及写（见下面的自愈分支）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, log } from './log.mjs';   // ← 必须最先导入：导入即初始化日志
import { createEngine } from '../../../../packages/engine/src/engine.mjs';
import { CH_INVOKE, CH_EVENT, validateCall, METHOD_NAMES } from '../shared/ipc.mjs';
import { resolveLibraries, loadRegistry, saveRegistry, normalizeLibraries, registryPath } from './library-config.mjs';
import { createRevealPort } from './ports.mjs';
import { parseThumbUrl, createLibIdResolver, thumbFailureStatus } from './thumb-url.mjs';
import {
  isTrustedSender as isTrustedSenderImpl,
  decideWindowOpen,
  decideNavigation,
} from './window-security.mjs';

import electron from 'electron';
const { app, BrowserWindow, ipcMain, protocol, nativeImage, dialog, shell } = electron;
/** 本文件所在目录：dev/预览态是 `<根>/out/main`，打包态在 asar 内 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** dev 态页面地址（由 electron-vite dev 注入；打包/预览态为空） */
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || '';

// ---------------------------------------------------------------- 运行环境自愈（§9 排障）
//
// `ELECTRON_RUN_AS_NODE=1` 会让 Electron 以**纯 Node** 运行，于是 `electron`
// 解析到 npm 包装包（一个 75 字符的 electron.exe 路径字符串），报错极具误导性：
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@huggingface/transformers'
//   SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
//   TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
// 对"这是一个 Electron 应用"而言意图毫无歧义，所以这里去掉该变量重新拉起自己。
if (process.env.ELECTRON_RUN_AS_NODE || !app || typeof app.whenReady !== 'function') {
  if (DEV_RENDERER_URL) {
    // dev 态**不能**自愈：dev server 由父进程（electron-vite）持有，
    // 重生一个 detached 实例会立刻失去它 —— 结果是"窗口开了但一片空白"。
    log('!! dev 态下 ELECTRON_RUN_AS_NODE 生效，无法自愈（重生会丢掉 dev server）');
    log('   处理：用 `npm run dev`（该脚本会先清掉这个变量），或先 $env:ELECTRON_RUN_AS_NODE=$null');
    process.exit(3);
  }
  log('ELECTRON_RUN_AS_NODE 生效（或 Electron API 不可用）→ 去掉该变量后重新拉起自身');
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, process.argv.slice(1), { env: cleanEnv, detached: true, stdio: 'ignore' });
    child.unref();
    log('已拉起新进程 pid =', child.pid);
    process.exit(0);
  } catch (e) {
    log('!! 自愈失败：', e);
    process.exit(3);
  }
}

// ---------------------------------------------------------------- 配置（D2 修复：见 library-config.mjs 文件头）
//
// 库从哪来 = 四条路按优先级：GEMMA_LIB_ROOT > userData 注册表 > config.json > 已有索引自举。
// 其中「索引自举」让**已有索引的机器零配置可用**（索引的 meta.json 本就存着 lib_id + lib_root）。
//
// ⚠️ `config.json` **不是要求用户去配的东西** —— 它只是最下面那条兼容回退。
//    它已随 Python 档退役被删除，仓库里也没有模板，所以正常情况下这一层就是空的。
function loadConfig() {
  const candidates = [process.env.GEMMA_CONFIG, path.join(ROOT, 'config.json')].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const c = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
        log('配置来源', p);
        return { data: c, path: p };
      } catch (e) {
        log('配置读取失败', p, e.message);
      }
    }
  }
  return { data: {}, path: null };
}

const _cfg = loadConfig();
const config = _cfg.data;
const CONFIG_PATH = _cfg.path;
const DATA_DIR = config.data_dir || path.join(ROOT, 'data');

// userData：`app.getPath` 在 app ready 之前不可靠，所以延到 whenReady 里再解析。
// 但 `buildEngine()` 需要库列表，故用**惰性** getter —— 模块加载期零副作用，
// 也不会"只是启动了一下"就往用户目录写东西（写注册表只发生在 libraryAdd 被调用时）。
let USER_DATA_DIR = null;
let RESOLVED = null;
function librariesResolved() {
  if (!RESOLVED) {
    RESOLVED = resolveLibraries({
      dataDir: DATA_DIR,
      userDataDir: USER_DATA_DIR,
      config,
      configPath: CONFIG_PATH,
      envLibRoot: process.env.GEMMA_LIB_ROOT || '',
    });
  }
  return RESOLVED;
}

/** 注册表变了（libraryAdd）后让解析结果与引擎一起失效重建 */
function invalidateLibraries() { RESOLVED = null; engine = null; }

/** 模型目录：config 指定，或从 model_cache 下按 revision 找 fp32。 */
function resolveModelDir() {
  if (config.onnx_model_dir && fs.existsSync(config.onnx_model_dir)) return config.onnx_model_dir;
  const base = path.join(config.model_cache || path.join(ROOT, '..', 'model-cache'),
                         'onnx', 'embeddinggemma-2');
  if (!fs.existsSync(base)) return null;
  for (const rev of fs.readdirSync(base)) {
    const d = path.join(base, rev, 'fp32');
    if (fs.existsSync(path.join(d, 'onnx', 'model.onnx'))) return d;
  }
  return null;
}

// ---------------------------------------------------------------- 引擎
let engine = null;
let encoder = null;
let encoderError = null;
const winRef = { win: null };

function emit(evt) {
  if (winRef.win && !winRef.win.isDestroyed()) winRef.win.webContents.send(CH_EVENT, evt);
}

function buildEngine() {
  const r = librariesResolved();
  engine = createEngine({
    config: { libraries: r.libraries, data_dir: DATA_DIR, collect: r.collect },
    encoder: {
      // 延迟到真正检索时才载模型：冷启动要 ≤5s，不能把 2.6s 的模型载入挡在出窗之前
      async encodeText(t) { const e = await ensureEncoder(); return e.encodeText(t); },
      async encodeImage(p) { const e = await ensureEncoder(); return e.encodeImage(p); },
    },
    onEvent: emit,
    // ⚠️ **必须注入**（F-01）：不注入的话引擎会返回 PORT_MISSING 而不是静默假成功。
    // 引擎不 import electron，所以"在资源管理器里定位"这个能力只能由外壳这样交进去。
    // 端口本身只负责调用；成功/失败的判定在引擎里（见 ports.mjs 的注释）。
    shell: createRevealPort(shell),
  });
  log('引擎就绪 · 库', r.libraries.map((l) => `${l.libId}=${l.root}[${l.source}]`).join(', ') || '(无)');
  // 诊断与警告写进日志：出问题时第一手材料就是 data/_app.log
  for (const d of r.diagnostics) log('[cfg]', d);
  for (const w of r.warnings) log('[cfg][warn]', w);
  log('[cfg] 取件白名单', JSON.stringify(r.collect.dirs), '默认', r.collect.default);
  return r;
}

async function ensureEncoder() {
  if (encoder) return encoder;
  if (encoderError) throw encoderError;
  const modelDir = resolveModelDir();
  if (!modelDir) {
    encoderError = Object.assign(new Error('未找到 ONNX 模型目录（config.onnx_model_dir / model_cache）'),
                                 { code: 'MODEL_MISSING' });
    throw encoderError;
  }
  try {
    // **动态导入**：编码器模块图会拉 `@huggingface/transformers` + 原生 onnxruntime。
    // 若它载入失败（原生模块缺失、路径不对…），动态导入才**catch 得到** ——
    // 静态导入会在模块实例化阶段抛出，那时连一行日志都不会留下。
    const { createEncoder } = await import('./encoder.mjs');
    encoder = await createEncoder({ modelDir, seq: 140, device: config.device || 'webgpu', log });
    emit({ type: 'encoder.ready', device: encoder.device, loadMs: encoder.loadMs });
    return encoder;
  } catch (e) {
    encoderError = e;
    log('!! 编码器不可用：', e && e.stack ? e.stack : e);
    emit({ type: 'encoder.failed', message: e.message, code: e.code || 'INTERNAL' });
    throw e;
  }
}

// ---------------------------------------------------------------- 应用自身地址（§2 + §5）
// 判据与"开新窗口/导航/来源校验"的**决策**都在 `main/window-security.mjs`（可脱离 Electron 单测）；
// 这里只做**接线**，并把 DEV_RENDERER_URL 作为参数喂进去。
function isTrustedSender(event) {
  const w = winRef.win;
  return isTrustedSenderImpl(event, w, DEV_RENDERER_URL);
}

// ---------------------------------------------------------------- IPC（§2 + §4）
function registerIpc() {
  ipcMain.handle(CH_INVOKE, async (event, payload) => {
    const started = Date.now();
    if (!isTrustedSender(event)) {
      log('拒绝来源不明的调用');
      return { ok: false, error: { code: 'BAD_REQUEST', userMessage: '请求来源不被信任。', message: 'untrusted sender', details: {} } };
    }
    const method = payload && payload.method;
    const params = payload && payload.params;
    const v = validateCall(method, params);
    if (!v.ok) {
      return { ok: false, error: { code: 'BAD_REQUEST', message: v.reason,
                                   userMessage: '请求参数不合法。', details: { reason: v.reason } } };
    }
    if (!engine) buildEngine();

    // 库配置是由主进程处理的方法（不是引擎方法）——首启向导用
    if (v.method === 'libraryConfig' || v.method === 'libraryAdd' || v.method === 'libraryPickDir') {
      const res = await handleLibraryMethod(v.method, v.params);
      log(`invoke ${v.method} ${(Date.now() - started)}ms → ${res && res.ok ? 'ok' : (res && res.error && res.error.code)}`);
      return res;
    }

    // 引擎里还没实现的方法在这里显式拒绝，避免"静默什么都不做"
    const missing = ['ingest', 'mutate', 'indexStart', 'indexCancel'];
    if (missing.includes(v.method)) {
      return { ok: false, error: { code: 'INTERNAL', message: `方法尚未实现：${v.method}`,
                                   userMessage: '这个功能还没做好。', details: { method: v.method } } };
    }
    const fn = engine[v.method];
    if (typeof fn !== 'function') {
      return { ok: false, error: { code: 'BAD_REQUEST', message: `引擎无此方法：${v.method}`,
                                   userMessage: '请求参数不合法。', details: {} } };
    }
    const res = await fn(v.params);
    log(`invoke ${v.method} ${(Date.now() - started)}ms → ${res && res.ok ? 'ok' : (res && res.error && res.error.code)}`);
    return res;
  });
  log('IPC 已注册 · 允许的方法：', METHOD_NAMES.join(', '));
}

// ---------------------------------------------------------------- 库配置 IPC（D2 修复）
//
// 为什么要单独一组方法：用户要能**在应用内**把库加进来（决策 9：注册表存应用数据目录）。
// 这三个方法**不经引擎** —— 引擎是传输无关的，它只接受"给我一组库"，
// 而"库从哪来 + 存哪儿"是外壳的事（`packages/engine/src/library.mjs:137` 自己写着
// 「P1 从 config 派生单库；P5 扩为真正的多库注册表」，持久化不在引擎职责内）。
//
// 安全：仍然走同一条 `isTrustedSender` + zod 白名单；`libraryPickDir` 是唯一一个
// 让用户**主动**选目录的入口，且它只把结果交给主进程自己处理，**不把路径能力授予渲染层**
// —— 渲染层本来就拿不到 `dialog`，这个方法是它唯一的、需用户亲自点击的间接通道。
async function handleLibraryMethod(method, params) {
  if (method === 'libraryConfig') {
    const r = librariesResolved();
    return { ok: true, data: {
      libraries: r.libraries.map(({ libId, root, label, source }) => ({ libId, root, label, source })),
      collect: r.collect,
      chosen: r.chosen,
      diagnostics: r.diagnostics,
      warnings: r.warnings,
      registryPath: r.registryPath,
    } };
  }

  if (method === 'libraryPickDir') {
    const w = winRef.win;
    const picked = await dialog.showOpenDialog(w && !w.isDestroyed() ? w : undefined, {
      title: '选择素材库根目录',
      properties: ['openDirectory'],
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
      return { ok: true, data: { canceled: true, path: null } };
    }
    return { ok: true, data: { canceled: false, path: picked.filePaths[0] } };
  }

  // libraryAdd
  const root = path.resolve(String(params.root));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, error: { code: 'LIB_NOT_FOUND', message: `目录不存在：${root}`,
      userMessage: '这个目录不存在，或不是文件夹。请重新选择。', details: { root } } };
  }
  if (!USER_DATA_DIR) {
    return { ok: false, error: { code: 'INTERNAL', message: 'userData 未初始化',
      userMessage: '应用还没准备好，请稍后重试。', details: {} } };
  }

  const reg = loadRegistry(USER_DATA_DIR);
  const existing = normalizeLibraries(reg && reg.data ? reg.data.libraries : []).kept;
  const { kept: incoming } = normalizeLibraries([{ libId: params.libId || '', root, label: params.label }]);
  if (!incoming.length) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: '库条目不合法',
      userMessage: '请求参数不合法。', details: { root } } };
  }
  let entry = incoming[0];

  // 省略 libId 时自动分配：L1、L2…（跳过已占用的）
  if (!params.libId) {
    const used = new Set(existing.map((l) => l.libId));
    let n = 1; while (used.has(`L${n}`)) n++;
    entry = { ...entry, libId: `L${n}` };
  }

  const next = existing.filter((l) => l.libId !== entry.libId).concat([entry]);
  const saved = saveRegistry(USER_DATA_DIR, {
    libraries: next,
    collect: (reg && reg.data && reg.data.collect) || undefined,
  });
  if (!saved.ok) {
    return { ok: false, error: { code: 'INTERNAL', message: `注册表写入失败：${saved.error}`,
      userMessage: '保存失败，库没有加上。请检查磁盘权限或空间。', details: { path: saved.path } } };
  }

  invalidateLibraries();          // 解析结果与引擎都作废，下次调用会用新列表重建
  log('已注册库', entry.libId, '→', entry.root, '（注册表', saved.path, '）');
  const r = librariesResolved();
  return { ok: true, data: { added: entry, registryPath: saved.path,
    libraries: r.libraries, warnings: r.warnings, diagnostics: r.diagnostics } };
}

// ---------------------------------------------------------------- thumb:// 协议（SPEC-security §3）
//
// 形状**只允许** `thumb://<libId>/<uid>@<size>`。
// 路径绝不从 URL 取，而是由「注册表 + 索引」反查后再做包含校验 —— 这样
// 渲染进程无法用它读任意文件（它连"一个路径"都传不进来）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const THUMB_DIR = path.join(DATA_DIR, 'thumbs');

// ⚠️ 形状解析、尺寸白名单**与失败状态码映射**已抽到 `main/thumb-url.mjs`
// （SPEC-security §8 的 S4–S6）。抽出去的理由只有一个：`index.mjs` import 了 electron，
// `node:test` 加载不了它 ⇒ 这段代码本来**零自动化覆盖**。它是渲染进程唯一能"指定读哪个文件"的表面。
// **行为变更（唯一一处，已记录）**：原实现把"库 id 无法还原"与"形状不对"合并成 400；
// 按 `SPEC-security.md` §3 的表（`libId` 不在注册表 ⇒ 404）现在拆成 404。这是**对齐 §3**。
async function listRegisteredLibIds() {
  if (!engine) return [];
  const st = await engine.indexStatus({});
  return ((st && st.ok && st.data && st.data.libs) || []).map((l) => l.libId);
}
const resolveLibId = createLibIdResolver({ listLibIds: listRegisteredLibIds, log });
/** 引擎未就绪时不尝试还原（还原器本身对"空结果"也不会缓存，见 thumb-url.mjs） */
async function canonicalLibId(host) {
  if (!engine) return '';
  return resolveLibId(host);
}

async function handleThumb(request) {
  // thumb://L1/<uid>@256  → host=libId, pathname=/<uid>@256
  const p = parseThumbUrl(request.url);
  // ⚠️ **顺序是契约**：先判形状（400），再判库（404）。写成
  // `thumbFailureStatus(p.ok ? 400 : p.status, libId)` 会让形状错也返回 404 ——
  // 实测被 `tools/verify_main_wiring.mjs`（**已移除 2026-10-13**） 抓到（调用真实产物，`@999` 回了 404 而非 §3 要求的 400）。
  const libId = p.ok ? await canonicalLibId(p.rawHost) : '';
  const status = thumbFailureStatus({ shapeOk: p.ok, libId });
  if (status !== null) {
    log('thumb 拒绝', p.ok ? `库 id 无法还原：${p.rawHost}` : p.reason, '→', status);
    return new Response('bad shape', { status });
  }
  const uid = p.uid;
  const size = p.size;
  log('thumb 请求', libId, uid, size);
  if (!engine) return new Response('engine not ready', { status: 503 });

  const cachePath = path.join(THUMB_DIR, libId, `${uid}@${size}.jpg`);
  try {
    if (fs.existsSync(cachePath)) {
      const hit = fs.readFileSync(cachePath);
      log('thumb 缓存命中', libId, uid, size, hit.length);
      return new Response(hit, { headers: { 'content-type': 'image/jpeg' } });
    }
  } catch { /* 缓存读失败就重生成 */ }

  let src;
  try {
    src = engine.absPathFor(libId, uid);         // 内含 库根包含 + 符号链接校验
  } catch (e) {
    log('thumb 取路径失败', libId, uid, e.code || e.message);
    return new Response('not found', { status: e.code === 'SYMLINK_REJECTED' ? 403 : 404 });
  }
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) { log('thumb 解码失败', src); return new Response('decode failed', { status: 415 }); }

  const { width, height } = img.getSize();
  const scale = size / Math.max(width, height);
  const out = scale < 1
    ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
    : img;
  const jpg = out.toJPEG(82);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, jpg);
  } catch (e) { log('缩略图缓存写入失败', e.message); }
  log('thumb 生成成功', libId, uid, size, `${width}x${height}→${out.getSize().width}x${out.getSize().height}`, jpg.length);
  return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' } });
}

// ---------------------------------------------------------------- 窗口（§5）
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1040, minHeight: 680,
    backgroundColor: '#f5f5f7',
    title: 'gemma-search · 素材库语义检索',
    show: false,
    webPreferences: {
      // preload 是 electron-vite 产出的 **CJS**（`out/preload/index.cjs`）：
      // `sandbox: true` 下渲染进程不加载 ESM preload，见 electron.vite.config.mjs。
      preload: path.join(HERE, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      webviewTag: false,
      devTools: true,          // 决定 3：生产态也保留（理由见 SPEC-security §9）
    },
  });
  winRef.win = win;

  win.once('ready-to-show', () => win.show());           // 冷启动不闪白
  // 决策在 window-security.mjs（可单测），这里只接线
  win.webContents.setWindowOpenHandler(() => decideWindowOpen());
  win.webContents.on('will-navigate', (e, url) => {
    if (!decideNavigation(url, DEV_RENDERER_URL)) { e.preventDefault(); log('阻止导航', url); }
  });
  win.webContents.on('render-process-gone', (_e, d) => log('渲染进程结束', JSON.stringify(d)));

  // 渲染进程的诊断信息也落到**同一个日志文件**：
  // 首次运行要用户"把日志发我"，如果 console 里的报错只在 DevTools 里，就得让他多跑一趟。
  // （Electron ≥37 的 `console-message` 传单个事件对象，旧版是 (event, level, message, …)；
  //   两种形状都兜住，免得升级 Electron 后这里静默丢日志。）
  // 开发/验收用：应用**自己**截自己（GS_CAPTURE=<png 路径>）。
  // 用系统截屏抓窗口不可靠：窗口被别的窗口盖住时，抓到的会是最上层那个应用（实测踩过）。
  win.webContents.on('did-finish-load', () => {
    log('渲染页加载完成');
    const target = process.env.GS_CAPTURE || '';
    if (!target) return;
    const delayMs = Number(process.env.GS_CAPTURE_DELAY_MS || 4000);
    setTimeout(async () => {
      try {
        // 可选：截图前先跑一次检索，让证据里能看到结果区（GS_CAPTURE_QUERY=<查询词>）
        const q = process.env.GS_CAPTURE_QUERY || '';
        if (q) {
          await win.webContents.executeJavaScript(
            '(() => {' +
            '  const i = document.getElementById("query");' +
            '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;' +
            '  setter.call(i, ' + JSON.stringify(q) + ');' +
            '  i.dispatchEvent(new Event("input", { bubbles: true }));' +
            '  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "搜索图片 →");' +
            '  if (btn) btn.click();' +
            '  return true;' +
            '})()');
          await new Promise((r) => setTimeout(r, 2500));   // 等检索 + 缩略图渲染
        }
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, img.toPNG());
        const { width, height } = img.getSize();
        log('已截图', target, `${width}x${height}`);
      } catch (e) {
        log('截图失败', e && e.message ? e.message : String(e));
      }
      if (process.env.GS_CAPTURE_EXIT !== '0') app.quit();
    }, delayMs);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('!! 渲染页加载失败', code, desc, url));
  win.webContents.on('console-message', (...args) => {
    const a = args[0];
    const e = a && typeof a === 'object' && 'message' in a ? a : { level: args[1], message: args[2] };
    log('[renderer]', e.level ?? '', e.message ?? '');
  });

  // F12 → DevTools（生产态也留：本机自用工具，排障收益 > 风险，见 SPEC-security §9 决定 3）
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  if (DEV_RENDERER_URL) {
    // dev：electron-vite 的 dev server（HMR）。**只**用注入的地址，不做任何拼接。
    win.loadURL(DEV_RENDERER_URL);
    log('窗口已创建 →', DEV_RENDERER_URL, '(dev server)');
  } else {
    const page = path.join(HERE, '..', 'renderer', 'index.html');
    win.loadFile(page);
    log('窗口已创建 →', page);
  }
  return win;
}

// ---------------------------------------------------------------- 生命周期
app.setAppUserModelId('com.gemmasearch.app');

app.whenReady().then(async () => {
  log('app ready');
  // userData 只能在这之后取；库解析（含注册表）也就从这里才真正开始
  try {
    USER_DATA_DIR = app.getPath('userData');
    log('userData', USER_DATA_DIR);
    log('注册表路径', registryPath(USER_DATA_DIR));
  } catch (e) {
    log('!! userData 解析失败（会退到索引自举）:', e.message);
  }
  try {
    protocol.handle('thumb', handleThumb);        // 必须在窗口加载渲染页之前
    log('thumb:// 已注册');
    registerIpc();
    buildEngine();
    log('引擎阶段完成');
    createWindow();
    log('启动流程完成（窗口已创建）');
  } catch (e) {
    log('!! 启动流程异常:', e && e.stack ? e.stack : String(e));
    throw e;
  }

  // 启动就绪后**后台**载模型（不挡出窗）；失败也不致命，检索时会再试并报错
  setTimeout(() => { ensureEncoder().catch((e) => log('预热失败', e.message)); }, 1500);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });        // 关窗即退出（不做托盘）
process.on('uncaughtException', (e) => log('未捕获异常', e && e.stack ? e.stack : String(e)));
process.on('unhandledRejection', (e) => log('未处理的 rejection', e && e.stack ? e.stack : String(e)));

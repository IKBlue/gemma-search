// apps/desktop/src/main/index.mjs —— Electron 主进程（P2）
//
// 职责（SPEC-security §2–§5）：
//   · 按 config.json 组装引擎（注入 ONNX 编码器端口）
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

import electron from 'electron';
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = electron;

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

// ---------------------------------------------------------------- 配置
function loadConfig() {
  const candidates = [
    process.env.GEMMA_CONFIG,
    path.join(ROOT, 'config.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const c = JSON.parse(fs.readFileSync(p, 'utf8'));
        log('配置来源', p);
        return c;
      } catch (e) {
        log('配置读取失败', p, e.message);
      }
    }
  }
  log('未找到 config.json，用默认（库根为空 → indexStatus 会报 LIB_NOT_FOUND）');
  return {};
}

const config = loadConfig();
const DATA_DIR = config.data_dir || path.join(ROOT, 'data');
const LIB_ROOT = config.library_root || '';
const LIB_ID = config.lib_id || 'L1';

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
  const libraries = LIB_ROOT ? [{ libId: LIB_ID, root: LIB_ROOT, label: '主库' }] : [];
  engine = createEngine({
    config: { libraries, data_dir: DATA_DIR, collect: config.collect || { dirs: {} } },
    encoder: {
      // 延迟到真正检索时才载模型：冷启动要 ≤5s，不能把 2.6s 的模型载入挡在出窗之前
      async encodeText(t) { const e = await ensureEncoder(); return e.encodeText(t); },
      async encodeImage(p) { const e = await ensureEncoder(); return e.encodeImage(p); },
    },
    onEvent: emit,
  });
  log('引擎就绪 · 库', libraries.map((l) => `${l.libId}=${l.root}`).join(', ') || '(无)');
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
function isAppUrl(u) {
  if (!u) return false;
  if (u.startsWith('file://')) return true;                             // 打包/预览态
  if (DEV_RENDERER_URL && u.startsWith(DEV_RENDERER_URL)) return true;  // dev 态（electron-vite）
  return false;
}

function isTrustedSender(event) {
  const w = winRef.win;
  if (!w || w.isDestroyed()) return false;
  if (event.sender !== w.webContents) return false;              // 只认主窗口
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame.parent !== null) return false;                        // 拒 iframe
  return isAppUrl(frame.url || '');
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

// ---------------------------------------------------------------- thumb:// 协议（SPEC-security §3）
//
// 形状**只允许** `thumb://<libId>/<uid>@<size>`。
// 路径绝不从 URL 取，而是由「注册表 + 索引」反查后再做包含校验 —— 这样
// 渲染进程无法用它读任意文件（它连"一个路径"都传不进来）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const ALLOWED_SIZE = new Set([128, 256, 512]);

/** host（URL 规范会小写）→ 引擎注册时的 libId 写法；带缓存，避免每个缩略图都查一次 */
const LIB_ID_CANON = new Map();
async function canonicalLibId(host) {
  if (!engine) return '';
  if (LIB_ID_CANON.size === 0) {
    const st = await engine.indexStatus({});
    for (const l of ((st && st.ok && st.data && st.data.libs) || [])) {
      LIB_ID_CANON.set(String(l.libId).toLowerCase(), l.libId);
    }
    log('thumb 库 id 映射', JSON.stringify([...LIB_ID_CANON.entries()]));
  }
  return LIB_ID_CANON.get(String(host).toLowerCase()) || '';
}

async function handleThumb(request) {
  // thumb://L1/<uid>@256  → host=libId, pathname=/<uid>@256
  let url;
  try { url = new URL(request.url); } catch { return new Response('bad url', { status: 400 }); }
  // ⚠️ URL 的 host **一律小写**（URL 规范如此），而引擎的 libId 是大小写敏感的（`L1`）——
  // 实测 `thumb://L1/...` 到这里会变成 `l1`，引擎回 LIB_NOT_FOUND，界面全是"无预览"。
  const rawHost = decodeURIComponent(url.host || '');
  const libId = rawHost ? await canonicalLibId(rawHost) : '';
  const m = /^\/([0-9a-f]{12})@(\d+)$/.exec(url.pathname || '');
  if (!libId || !m) {
    log('thumb 拒绝：库 id 无法还原或形状不对', rawHost, url.pathname);
    return new Response('bad shape', { status: 400 });
  }
  const uid = m[1];
  const size = Number(m[2]);
  log('thumb 请求', libId, uid, size);
  if (!ALLOWED_SIZE.has(size)) { log('thumb 拒绝：尺寸不合法', size); return new Response('bad size', { status: 400 }); }
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) { e.preventDefault(); log('阻止导航', url); }
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

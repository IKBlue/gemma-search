// app/main/index.mjs —— Electron 主进程
//
// 职责（SPEC-security §2–§5）：
//   · 按 config.json 组装引擎（注入 ONNX 编码器端口）
//   · 只开两个 IPC 通道：engine:invoke / engine:event
//   · 每个调用先做**来源校验**，再过**zod 白名单**，最后才打引擎
//   · 窗口姿态：nodeIntegration:false / contextIsolation:true / sandbox:true
//   · 拒绝新窗口与外部导航
//
// 刻意不做：不引 HTTP 端口、不加载任何远程内容、不自动更新。
// Electron 的 `electron` 模块是 CJS（导出动态定义），用默认导入再解构最稳。
//
// ⚠️ 排障记录：最初写成 `import { app, BrowserWindow } from 'electron'`，
//    报 "does not provide an export named 'BrowserWindow'"；改成默认导入后
//    `protocol` 又是 undefined，且 `Object.keys(electron)` 得到 75 个键、API 全 undefined
//    —— 那其实是**一个 75 字符的字符串**（npm 包装包导出的 electron.exe 路径）。
//    真正的原因在环境：**`ELECTRON_RUN_AS_NODE=1`** 让 Electron 以纯 Node 运行，
//    于是 `electron` 解析到 npm 包装包而不是运行时 API。下面先把这个情况显式报出来。
import electron from 'electron';
const { app, BrowserWindow, ipcMain, shell, protocol, net, nativeImage } = electron;

if (!app || typeof app.whenReady !== 'function') {
  const msg = [
    'Electron 运行时 API 不可用。',
    process.env.ELECTRON_RUN_AS_NODE
      ? '检测到 ELECTRON_RUN_AS_NODE 已设置 —— 这会让 Electron 以纯 Node 运行（拿不到 app/BrowserWindow）。'
      : '未检测到 ELECTRON_RUN_AS_NODE，请确认是用 `electron .` 而不是 `node .` 启动的。',
    '解决：清除该变量后再启动，例如 PowerShell 里  $env:ELECTRON_RUN_AS_NODE=$null ; npm start',
  ].join('\n  ');
  console.error('[main] ' + msg);
  process.exit(3);
}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createEngine, indexPathFor } from '../../core/engine.mjs';
import { createEncoder } from './encoder.mjs';
import { CH_INVOKE, CH_EVENT, validateCall, METHOD_NAMES } from '../../src/shared/ipc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');          // 项目根

// 日志：写文件 + stdout。**必须写文件** ——
// Windows 上 Electron 是 GUI 子系统程序，主进程 stdout 不连终端，
// 只 console.log 的话在自己的终端里什么也看不到（这是实测踩到的）。
const log = (...a) => {
  if (typeof globalThis.__GS_LOG === 'function') { globalThis.__GS_LOG('main:', ...a); return; }
  console.log('[main]', ...a);
};

// ---------------------------------------------------------------- 配置
function loadConfig() {
  const candidates = [
    process.env.GEMMA_CONFIG,
    path.join(APP_ROOT, 'config.json'),
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
const DATA_DIR = config.data_dir || path.join(APP_ROOT, 'data');
const LIB_ROOT = config.library_root || '';
const LIB_ID = config.lib_id || 'L1';

/** 模型目录：config 指定，或从 model_cache 下按 revision 找 fp32。 */
function resolveModelDir() {
  if (config.onnx_model_dir && fs.existsSync(config.onnx_model_dir)) return config.onnx_model_dir;
  const base = path.join(config.model_cache || path.join(APP_ROOT, '..', 'model-cache'),
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

async function buildEngine() {
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
    encoder = await createEncoder({ modelDir, seq: 140, device: config.device || 'webgpu', log });
    emit({ type: 'encoder.ready', device: encoder.device, loadMs: encoder.loadMs });
    return encoder;
  } catch (e) {
    encoderError = e;
    emit({ type: 'encoder.failed', message: e.message, code: e.code || 'INTERNAL' });
    throw e;
  }
}

// ---------------------------------------------------------------- IPC（§2 + §4）
function isTrustedSender(event) {
  const w = winRef.win;
  if (!w || w.isDestroyed()) return false;
  if (event.sender !== w.webContents) return false;              // 只认主窗口
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame.parent !== null) return false;                        // 拒 iframe
  const url = frame.url || '';
  // 只接受应用自身：开发态 file:// 加载渲染页；将来打包态仍是 file://（asar 内）
  return url.startsWith('file://');
}

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
    if (!engine) await buildEngine();

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

async function handleThumb(request) {
  // thumb://L1/<uid>@256  → host=libId, pathname=/<uid>@256
  let url;
  try { url = new URL(request.url); } catch { return new Response('bad url', { status: 400 }); }
  const libId = decodeURIComponent(url.host || '');
  const m = /^\/([0-9a-f]{12})@(\d+)$/.exec(url.pathname || '');
  if (!libId || !m) return new Response('bad shape', { status: 400 });
  const uid = m[1];
  const size = Number(m[2]);
  if (!ALLOWED_SIZE.has(size)) return new Response('bad size', { status: 400 });
  if (!engine) return new Response('engine not ready', { status: 503 });

  const cachePath = path.join(THUMB_DIR, libId, `${uid}@${size}.jpg`);
  try {
    if (fs.existsSync(cachePath)) {
      return new Response(fs.readFileSync(cachePath), { headers: { 'content-type': 'image/jpeg' } });
    }
  } catch { /* 缓存读失败就重生成 */ }

  let src;
  try {
    src = engine.absPathFor(libId, uid);         // 内含 库根包含 + 符号链接校验
  } catch (e) {
    return new Response('not found', { status: e.code === 'SYMLINK_REJECTED' ? 403 : 404 });
  }
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) return new Response('decode failed', { status: 415 });

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
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
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
    if (!url.startsWith('file://')) { e.preventDefault(); log('阻止导航', url); }
  });
  win.webContents.on('render-process-gone', (_e, d) => log('渲染进程结束', JSON.stringify(d)));

  const page = path.join(__dirname, '..', 'renderer', 'index.html');
  win.loadURL(pathToFileURL(page).href);
  log('窗口已创建 →', page);
  return win;
}

// ---------------------------------------------------------------- 生命周期
app.whenReady().then(async () => {
  protocol.handle('thumb', handleThumb);          // 必须在窗口加载渲染页之前
  registerIpc();
  await buildEngine();
  createWindow();

  // 启动就绪后**后台**载模型（不挡出窗）；失败也不致命，检索时会再试并报错
  setTimeout(() => { ensureEncoder().catch((e) => log('预热失败', e.message)); }, 1500);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });        // 关窗即退出（不做托盘）
process.on('uncaughtException', (e) => log('未捕获异常', e && e.stack ? e.stack : String(e)));

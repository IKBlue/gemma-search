// apps/desktop/e2e/perf.spec.mjs —— T-19b：性能基线的**可复跑件**（默认不跑，不是门禁）
//
// ── 怎么复跑（三步，可直接抄）──────────────────────────────────────────────
//  1. 先构建产物（e2e 跑的是 out/）：
//       npm run build
//     ✅ 2026-10-16（BUILD-1 / 审查 S1 收口）：**构建已自给自足** —— `electron.vite.config.mjs` 的 build 段
//        自己把 `TEMP` / `TMP` / `TMPDIR` 指到仓库内 `data/_esbuild-tmp`，**不再需要任何手动重定向**。
//        （历史上这里写过「build 必须手工设 TEMP/TMP」，那是环境依赖的绕法，已随 BUILD-1 退役。）
//     ℹ️ **e2e 默认可不设** `TEMP`/`TMP`（2026-10-16 实测）：清空这两个变量跑**全量 e2e**
//        ⇒ 68 passed / 1 skipped / 0 failed。**只有沙箱限制写入时才需要**把它指到仓库内 ——
//        历史现象是 `AppData` 下 `EPERM`、`electron.exe` 秒退（见 TASKS.md §5）。
//        ⚠️ 那是**当时那个文件策略下**的事实，**不是常量**：本会话策略（`danger-full-access`）下已不复现。
//        判据（为什么它确实在用那个目录）：同一次实验里，复用默认临时目录 e2e 耗时 3.6m → 7.2m。
//        换句话说：**默认不设；出问题（electron 起不来 / 秒退）时再设下面这行**。
//       $env:TEMP='<仓库>/data/_esbuild-tmp'; $env:TMP=$env:TEMP   # 仅故障时；该目录由上面的 npm run build 建出
//  2. 打开开关，只跑这一条（**默认 GEMMA_PERF 未设 ⇒ skip**，不给全量 e2e 加时间）：
//       $env:GEMMA_PERF='1'; npx playwright test -c apps/desktop/e2e/playwright.config.mjs perf.spec.mjs
//  3. 读输出：结论表搜 '[perf] TABLE'，原始逐次计时搜 '[perf] RAW'。
//
// ── 需要什么（缺哪一项就 **skip 并写明原因**，不会红）─────────────────────
//   · data/libraries/L1/{items.json,meta.json,index.bin}（真库：3594 条 · 768 维）
//   · model-cache/onnx/embeddinggemma-2/daa72c51243991dfcaf9f9137d2c573d8f7790c0/fp32/onnx/model.onnx
//
// ── 取数方法（与 T-19 的 reports/2026-10-15-wave3/19.txt 完全同口径）──────
//   · 冷启动分段：读**应用自己的日志** data/_app.log 的 HH:MM:SS.mmm 时间戳，每段 = 该行 − 首行。
//     ⚠️ log.ts 每次启动**重写**该文件；playwright.config 是 workers:1 串行 ⇒ 读到的一定是本次启动。
//     **里程碑行名（写死在这里；改日志格式必须同步改这几条正则）**：
//       [..] === gemma-search 启动 ===                         ← 日志首行（约等于进程起：导入 log.ts 即写）
//       [..] app ready
//       [..] 窗口已创建 → out/renderer/index.html
//       [..] 引擎阶段完成
//       [..] invoke indexStatus <n>ms → ok                      ← **库就绪**
//       [..] 载入完成 <n>s · 请求=cpu · 实际=cpu · 已验证 EP=cpu    ← **编码器就绪**
//     ⚠️ 首行只是"进程起"的**代理**（真实进程创建 → 日志首行之间还有 Electron 引导时间，测不到）；
//        另给一条 harness 口径（launch() 返回 / 首窗口 / 主界面 #query 可见）并列。
//   · 检索延迟：真窗口里逐次 win.evaluate(() => window.api.invoke('search', …)) + performance.now()，
//     含 **IPC + zod + 引擎（编码 + 3594×768 点积 + 排序）**；首次（含模型载入）单独列。
//   · 内存：主进程 app.getAppMetrics() 的 workingSetSize / **peakWorkingSetSize**（进程生命周期峰值，
//     不是采样曲线）；渲染 JS 堆用 performance.memory。
//
// ── 这个文件**不是门禁**（TASKS §4；阈值还没定，见 U14）──────────────────────
//   它**不做任何阈值断言**：只测量 + 打表，人自己抄。数值只在一个环境下成立（表格里的 硬件/模式 行就是它）：
//   非打包态 · CPU provider · 单库 3594 条 · **文件系统缓存是热的**（应用冷启动 ≠ 冷盘启动）·
//   图像检索用一条真 1×1 JPEG（**时延量级可用，不能据此评价检索质量**）·
//   内存是**单次峰值，不是泄漏结论**。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { test, expect } from '@playwright/test';

import { launchApp, firstWindow, ROOT } from './helpers/launch.mjs';
// ⚠️ 用**生产导入代码**建 .gs.db（T-11b），不在测试里手写 SQL / 造第二份形状
import { openGsDb, importItemsFromJson } from '../src/main/db/index.ts';

const REAL_LIB = path.join(ROOT, 'data', 'libraries', 'L1');
const MODEL_DIR = path.join(
  ROOT,
  'model-cache',
  'onnx',
  'embeddinggemma-2',
  'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
  'fp32',
);
const APP_LOG = path.join(ROOT, 'data', '_app.log');
const QUERY = '坦克 装甲车';
const TEXT_RUNS = 20;
const IMAGE_RUNS = 20;
/** 真 1×1 JPEG（103 字节）—— 假字节会让 encodeImage/thumb 走不通，那会把夹具问题伪装成性能问题 */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const say = (...a) => console.log('[perf]', ...a);
const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[i];
};
const stats = (arr) => ({
  n: arr.length,
  min: Number(Math.min(...arr).toFixed(1)),
  p50: Number(pct(arr, 50).toFixed(1)),
  p95: Number(pct(arr, 95).toFixed(1)),
  max: Number(Math.max(...arr).toFixed(1)),
  mean: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1)),
});
const kbToMb = (kb) => (kb === null || kb === undefined ? null : Number((kb / 1024).toFixed(1)));

test('T-19b 性能基线：冷启动分段 + 文本/图像检索 P50·P95 + 内存峰值（只测量，不打阈值）', async () => {
  test.setTimeout(300_000);
  test.skip(
    process.env.GEMMA_PERF !== '1',
    '性能基线默认不跑（设 GEMMA_PERF=1 开启）—— 见文件头"怎么复跑"',
  );

  const missing = [
    ['data/libraries/L1/items.json', path.join(REAL_LIB, 'items.json')],
    ['data/libraries/L1/index.bin', path.join(REAL_LIB, 'index.bin')],
    ['data/libraries/L1/meta.json', path.join(REAL_LIB, 'meta.json')],
    ['model onnx/model.onnx', path.join(MODEL_DIR, 'onnx', 'model.onnx')],
  ]
    .filter(([, p]) => !fs.existsSync(p))
    .map(([n]) => n);
  test.skip(missing.length > 0, '缺真库/真模型：' + missing.join(' / ') + ' —— 性能基线无法执行');

  // ── 夹具：仓库内库根副本（沙箱把 electron 的写限制在仓库内；产品落点由 T-04 决定）
  const work = fs.mkdtempSync(path.join(ROOT, 'data', '_perf-'));
  const libDir = path.join(work, 'lib');
  const outDir = path.join(work, 'out');
  fs.mkdirSync(libDir, { recursive: true });
  const meta = JSON.parse(fs.readFileSync(path.join(REAL_LIB, 'meta.json'), 'utf8'));
  const itemsJsonPath = path.join(libDir, 'items.json');
  fs.copyFileSync(path.join(REAL_LIB, 'items.json'), itemsJsonPath);
  fs.copyFileSync(path.join(REAL_LIB, 'meta.json'), path.join(libDir, 'meta.json'));
  fs.copyFileSync(path.join(REAL_LIB, 'index.bin'), path.join(libDir, '.gs-index.bin'));
  const items = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'));
  {
    const opened = openGsDb({ dbPath: path.join(libDir, '.gs.db') });
    try {
      const rep = importItemsFromJson({
        db: opened.db,
        library: { libId: meta.lib_id, root: libDir },
        itemsJsonPath,
        expectedCount: meta.count,
      });
      expect(rep.dbCount, '.gs.db 应当装下全部条目').toBe(meta.count);
    } finally {
      opened.db.close();
    }
  }
  // 图像检索要一条**盘上真有**的素材
  const imgItem = items[0];
  const imgAbs = path.join(libDir, ...String(imgItem.relPath).split('\\'));
  fs.mkdirSync(path.dirname(imgAbs), { recursive: true });
  fs.writeFileSync(imgAbs, TINY_JPEG);

  const cfgPath = path.join(work, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      data_dir: path.join(work, 'data'),
      onnx_model_dir: MODEL_DIR,
      device: 'cpu',
    }),
    'utf8',
  );

  const tLaunch0 = performance.now();
  const app = await launchApp({
    env: {
      GEMMA_CONFIG: cfgPath,
      GEMMA_LIB_ROOT: libDir,
      GEMMA_COLLECT_DIRS: 'out=' + outDir,
      GEMMA_FAKE: '',
      GEMMA_PERF: '1',
    },
  });
  const tLaunched = performance.now();

  try {
    const win = await firstWindow(app, 60_000);
    const tWindow = performance.now();
    const pageErrors = [];
    win.on('pageerror', (e) => pageErrors.push(String(e && e.message)));

    await win.waitForSelector('#query', { timeout: 60_000 });
    const tUi = performance.now();

    const invoke = (method, params) =>
      win.evaluate(([m, p]) => window.api.invoke(m, p), [method, params]);
    async function waitForHealthy(timeoutMs = 60_000) {
      const t0 = performance.now();
      for (;;) {
        const r = await invoke('indexStatus', {});
        if (
          r &&
          r.ok &&
          r.data &&
          Array.isArray(r.data.libs) &&
          r.data.libs[0] &&
          r.data.libs[0].healthy
        ) {
          return { ms: performance.now() - t0, lib: r.data.libs[0] };
        }
        if (performance.now() - t0 > timeoutMs) throw new Error('indexStatus 一直不 healthy');
        await new Promise((r2) => setTimeout(r2, 200));
      }
    }
    const healthy = await waitForHealthy();

    // 文本检索：首次（含模型载入）单列，然后 TEXT_RUNS 次稳态
    const tFirst0 = performance.now();
    const first = await invoke('search', { mode: 'text', text: QUERY, topK: 50 });
    const firstTextMs = performance.now() - tFirst0;
    expect(first.ok, '首次文本检索必须成功：' + JSON.stringify(first.error)).toBe(true);
    const textTimes = [];
    for (let i = 0; i < TEXT_RUNS; i++) {
      const t0 = performance.now();
      const r = await invoke('search', { mode: 'text', text: QUERY, topK: 50 });
      textTimes.push(performance.now() - t0);
      if (!r.ok) throw new Error('文本检索失败：' + JSON.stringify(r.error));
    }

    // 图像检索（同一模态一个库内 uid）
    let firstImageMs = null;
    const imageTimes = [];
    let imageNote = '';
    try {
      const t0 = performance.now();
      const r0 = await invoke('search', {
        mode: 'image',
        imageRef: { libId: meta.lib_id, uid: imgItem.uid },
        topK: 50,
      });
      firstImageMs = performance.now() - t0;
      if (!r0.ok) throw new Error(JSON.stringify(r0.error));
      for (let i = 0; i < IMAGE_RUNS; i++) {
        const t1 = performance.now();
        const r = await invoke('search', {
          mode: 'image',
          imageRef: { libId: meta.lib_id, uid: imgItem.uid },
          topK: 50,
        });
        imageTimes.push(performance.now() - t1);
        if (!r.ok) throw new Error(JSON.stringify(r.error));
      }
    } catch (e) {
      imageNote = '图像检索没跑成：' + (e && e.message ? e.message : String(e));
    }

    // 内存（峰值）
    const metrics = await app.evaluate(({ app: a }) =>
      a.getAppMetrics().map((m) => ({
        type: m.type,
        pid: m.pid,
        workingSetKb: m.memory ? m.memory.workingSetSize : null,
        peakWorkingSetKb: m.memory ? m.memory.peakWorkingSetSize : null,
      })),
    );
    const jsHeap = await win.evaluate(() =>
      performance.memory
        ? { usedMb: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) }
        : null,
    );

    // 应用日志：冷启动分段
    const logLines = (fs.existsSync(APP_LOG) ? fs.readFileSync(APP_LOG, 'utf8') : '')
      .split(/\r?\n/)
      .filter(Boolean);
    const timeOf = (line) => {
      const m = /^\[(\d\d):(\d\d):(\d\d)\.(\d\d\d)\]/.exec(line);
      return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : null;
    };
    const find = (re) => logLines.find((l) => re.test(l)) || null;
    const MILESTONES = [
      ['进程起（日志首行，代理）', () => logLines[0] || null],
      ['app ready', () => find(/\] app ready$/)],
      ['窗口已创建', () => find(/\] 窗口已创建/)],
      ['引擎阶段完成', () => find(/\] 引擎阶段完成/)],
      ['库就绪（invoke indexStatus → ok）', () => find(/invoke indexStatus .*→ ok/)],
      ['编码器就绪（载入完成）', () => find(/载入完成/)],
    ];
    const base = timeOf(logLines[0] || '');
    const coldStart = {};
    for (const [name, get] of MILESTONES) {
      const line = get();
      const t = line ? timeOf(line) : null;
      coldStart[name] = t === null || base === null ? null : t - base;
    }
    const encoderLines = logLines
      .filter((l) => /载入|已验证 EP|设备决策/.test(l))
      .map((l) => l.replace(/^\[[^\]]+\]\s*/, ''));

    // ── 结论表（人直接抄）＋原始数组
    const openCount = logLines.filter((l) => /invoke search/.test(l)).length;
    const text = stats(textTimes);
    const image = imageTimes.length ? stats(imageTimes) : null;
    const browser = metrics.find((m) => m.type === 'Browser') || null;
    const tab = metrics.find((m) => m.type === 'Tab') || null;
    say('TABLE');
    say('| 指标 | 本次 |');
    say('|---|---|');
    say(
      '| 硬件 | ' +
        os.cpus()[0].model +
        ' · ' +
        String(os.cpus().length) +
        ' 逻辑核 · ' +
        (os.totalmem() / 1073741824).toFixed(1) +
        ' GB · ' +
        process.platform +
        '/' +
        process.arch +
        ' |',
    );
    say(
      '| 模式 | 真实模式（非 fake）· device=cpu · 库=' +
        meta.lib_id +
        ' ' +
        String(meta.count) +
        ' 条/' +
        String(meta.dim) +
        ' 维 · **非打包态** |',
    );
    say('| 冷启动 harness：launch() 返回 | ' + Math.round(tLaunched - tLaunch0) + ' ms |');
    say('| 冷启动 harness：首窗口+domcontentloaded | ' + Math.round(tWindow - tLaunch0) + ' ms |');
    say('| 冷启动 harness：主界面 #query 可见 | ' + Math.round(tUi - tLaunch0) + ' ms |');
    for (const [name] of MILESTONES)
      say(
        '| 冷启动 日志：' +
          name +
          ' | ' +
          (coldStart[name] === null ? '(缺)' : String(coldStart[name]) + ' ms') +
          ' |',
      );
    say('| 文本检索 首次（含模型载入） | ' + Math.round(firstTextMs) + ' ms |');
    say(
      '| 文本检索 稳态 n=' +
        String(text.n) +
        ' | P50 ' +
        text.p50 +
        ' · P95 ' +
        text.p95 +
        ' · max ' +
        text.max +
        ' · min ' +
        text.min +
        ' · mean ' +
        text.mean +
        ' ms |',
    );
    say(
      '| 图像检索 首次 | ' +
        (firstImageMs === null ? '(未跑成)' : Math.round(firstImageMs) + ' ms') +
        ' |',
    );
    say(
      '| 图像检索 稳态 | ' +
        (image
          ? 'n=' +
            String(image.n) +
            ' · P50 ' +
            image.p50 +
            ' · P95 ' +
            image.p95 +
            ' · max ' +
            image.max +
            ' · mean ' +
            image.mean +
            ' ms'
          : imageNote || '(未跑成)') +
        ' |',
    );
    say(
      '| 内存峰值 主进程 Browser | ' +
        (browser && browser.peakWorkingSetKb !== null
          ? String(kbToMb(browser.peakWorkingSetKb)) +
            ' MiB（peakWorkingSetSize=' +
            String(browser.peakWorkingSetKb) +
            ' KB）'
          : '(缺)') +
        ' |',
    );
    say(
      '| 内存峰值 渲染 Tab | ' +
        (tab && tab.peakWorkingSetKb !== null
          ? String(kbToMb(tab.peakWorkingSetKb)) + ' MiB'
          : '(缺)') +
        ' |',
    );
    say('| 渲染 JS 堆 used | ' + (jsHeap ? String(jsHeap.usedMb) + ' MB' : '(缺)') + ' |');
    say('| 编码器 | ' + (encoderLines.join(' || ') || '(日志里没有编码器行)') + ' |');
    say('| pageerror | ' + String(pageErrors.length) + ' |');
    say(
      'RAW ' +
        JSON.stringify({
          coldStartLogMs: coldStart,
          coldStartHarnessMs: {
            launchReturn: Math.round(tLaunched - tLaunch0),
            firstWindow: Math.round(tWindow - tLaunch0),
            mainUi: Math.round(tUi - tLaunch0),
          },
          healthyWaitMs: Math.round(healthy.ms),
          lib: {
            libId: healthy.lib.libId,
            indexed: healthy.lib.indexed,
            encoded: healthy.lib.encoded,
            dim: healthy.lib.dim,
          },
          textFirstMs: Math.round(firstTextMs),
          textTimesMs: textTimes.map((x) => Number(x.toFixed(1))),
          imageFirstMs: firstImageMs === null ? null : Math.round(firstImageMs),
          imageTimesMs: imageTimes.map((x) => Number(x.toFixed(1))),
          imageNote: imageNote || null,
          metrics,
          jsHeap,
          invokeSearchLines: openCount,
          pageErrors,
        }),
    );

    // ⚠️ **故意没有阈值断言**（阈值未定，见 U14）：本 spec 只测量。
    // 唯一的结构性断言：结果非空 + 没有真的 JS 异常（否则"数字"是假的）。
    expect(textTimes.length).toBe(TEXT_RUNS);
    expect(pageErrors, '不许有真的 JS 异常（有异常的数字没有意义）').toEqual([]);
  } finally {
    await app.close();
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

// apps/desktop/e2e/first-paint.spec.mjs —— **PERF-1 第 0 步：首屏计时基线**（默认不跑，不是门禁）
//
// ── 为什么单独一个文件（而不是塞进 perf.spec.mjs）────────────────────────────
//   `perf.spec.mjs`（T-19b）量的是**整机冷启动 + 检索延迟 + 内存**，它要真库 + 真模型，
//   一次跑几十秒、还带 40 次检索。而 PERF-1 要回答的是**窄得多**的一个问题：
//     「把路由级页面拆成按需 chunk 之后，**首屏**快了没有？」
//   ⇒ 需要的是一个**小而可复跑**的量具：同一模式、多次启动、取**中位数**、
//     并把「首屏」拆成 renderer 侧可归因的几段。
//
// ── 量什么（都来自浏览器自己记录的时间戳，不是我们掐表）─────────────────────
//   · `first-paint` / `first-contentful-paint`：`performance.getEntriesByType('paint')`
//     —— 相对 navigationStart，**这正是"首屏"最没有争议的定义**；
//   · `domInteractive` / `domContentLoadedEventEnd` / `loadEventEnd`：
//     `performance.getEntriesByType('navigation')[0]`；
//   · harness 侧墙钟：`launch()` 返回 → 首窗口 → 主界面 `#query` 可见
//     （含主进程/引擎那一段；paint 时间戳**不含**它，两者一起看才知道首屏卡在哪一层）；
//   · `body.innerHTML` 长度：**证明界面真的渲染出来了**（不是白屏靠不报错蒙混）；
//   · 控制台错误数 + pageerror 数：数字有异常就没有意义；
//   · 产物 chunk 清单：**lazy 是否真的发生**的唯一硬证据（BUILD-2 已用「只有一个 chunk」反证过）。
//
// ── 怎么复跑 ──────────────────────────────────────────────────────────────
//   npm run build                                   # e2e 跑的是 out/
//   $env:GEMMA_PERF='1'
//   npx playwright test -c apps/desktop/e2e/playwright.config.mjs first-paint.spec.mjs
//   读输出：结论表搜 '[perf1] TABLE'，原始逐次数据搜 '[perf1] RAW'。
//
// ⚠️ **默认不跑**（`GEMMA_PERF` 未设 ⇒ skip）：它要启 6 次 Electron，不该给全量 e2e 加时间。
// ⚠️ 本文件**不打性能阈值**（阈值未定，同 U14 口径）—— 只测量 + 打表，人自己抄。
//    唯一的**结构性**断言是：拿到了 N 个样本、且控制台/JS 异常为 0。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { test, expect } from '@playwright/test';

import { launchWithLibrary } from './helpers/app.mjs';
import { firstWindow, collectConsoleErrors, ROOT } from './helpers/launch.mjs';

/** 启动次数（取中位数，抗单次抖动） */
const RUNS = 6;
const say = (...a) => console.log('[perf1]', ...a);

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const r1 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(1)));

const APP_LOG = path.join(ROOT, 'data', '_app.log');

/**
 * 主进程时间线（读应用自己的日志）—— 用来**归因**首屏那几秒花在哪一层。
 *
 * ⚠️ 必须**每次启动后立刻读**：`log.ts` 每次启动都会**重写** `data/_app.log`，
 *    而 playwright.config 是 `workers: 1` 串行 ⇒ 读到的一定是本次启动那一份。
 * ⚠️ 每条 = 该行时间戳 − 日志首行时间戳。首行只是「进程起」的**代理**
 *    （真实进程创建 → 日志首行之间还有 Electron 引导时间，测不到）。
 */
function readLogMilestones() {
  if (!fs.existsSync(APP_LOG)) return null;
  const lines = fs.readFileSync(APP_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
  const timeOf = (line) => {
    const m = /^\[(\d\d):(\d\d):(\d\d)\.(\d\d\d)\]/.exec(line);
    return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : null;
  };
  const base = timeOf(lines[0] || '');
  const at = (re) => {
    const line = lines.find((l) => re.test(l)) || null;
    const t = line ? timeOf(line) : null;
    return t === null || base === null ? null : r1(t - base);
  };
  return {
    appReady: at(/\] app ready$/),
    windowCreated: at(/\] 窗口已创建/),
    engineDone: at(/\] 引擎阶段完成/),
    libReady: at(/invoke indexStatus .*→ ok/),
    encoderReady: at(/载入完成/),
    firstLine: (lines[0] || '').replace(/^\[[^\]]+\]\s*/, ''),
  };
}

/** 当前产物里的渲染层 JS chunk 清单 —— lazy 生效与否的**机械判据** */
function rendererChunks() {
  const assets = path.join(ROOT, 'out', 'renderer', 'assets');
  if (!fs.existsSync(assets)) return null;
  return fs
    .readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(assets, f)).size }))
    .sort((a, b) => b.bytes - a.bytes);
}

test('PERF-1 第 0 步：首屏计时基线（多次启动取中位；只测量，不打阈值）', async () => {
  test.setTimeout(300_000);
  test.skip(
    process.env.GEMMA_PERF !== '1',
    '首屏基线默认不跑（设 GEMMA_PERF=1 开启）—— 见文件头"怎么复跑"',
  );

  const chunks = rendererChunks();
  const runs = [];

  for (let i = 0; i < RUNS; i++) {
    // ⚠️ t0 必须在 launchWithLibrary() **之前** —— 否则 launchReturnMs ≈ 0（第一版就踩了这个，
    //    表里出现 0.0003 ms 这种自欺数字）。
    const t0 = performance.now();
    const launched = await launchWithLibrary();
    const tLaunchReturn = performance.now();
    const errors = [];
    try {
      const app = launched.app;
      const win = await firstWindow(app, 60_000);
      const tFirstWindow = performance.now();
      errors.push(...collectConsoleErrors(win));

      await win.waitForSelector('#query', { timeout: 60_000 });
      const tQuery = performance.now();
      // 立刻读日志（下一次启动会覆盖它）—— 主进程时间线
      const logMilestones = readLogMilestones();

      // 浏览器自己记录的时间戳（相对 navigationStart）—— 首屏最没有争议的口径
      // ⚠️ 还抓 resource timing：**首屏那 6 秒到底花在哪**必须能归因，否则"变快/不变"无法解释。
      //    （第一版只有 paint/navigation 两个口径，看到 domInteractive=37ms 而 DCL=6147ms
      //      这样的"6 秒空档"却指不出花在哪 —— 那种基线没法用来判断 lazy 有没有用。）
      const nav = await win.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0] || null;
        const paints = Object.fromEntries(
          performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]),
        );
        const resources = performance
          .getEntriesByType('resource')
          .map((e) => ({
            name: String(e.name).replace(/^file:\/\/.*?\/out\/renderer\//, ''),
            initiatorType: e.initiatorType,
            startTime: Number(e.startTime.toFixed(1)),
            responseEnd: Number(e.responseEnd.toFixed(1)),
            duration: Number(e.duration.toFixed(1)),
            decodedBodySize: e.decodedBodySize,
          }))
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 12);
        return {
          paints,
          resources,
          nowAtEval: Number(performance.now().toFixed(1)),
          domInteractive: n ? n.domInteractive : null,
          dcl: n ? n.domContentLoadedEventEnd : null,
          loadEnd: n ? n.loadEventEnd : null,
          responseEnd: n ? n.responseEnd : null,
          innerHtmlLen: document.body.innerHTML.length,
          hasRootChild: !!(
            document.getElementById('root') && document.getElementById('root').firstElementChild
          ),
        };
      });

      runs.push({
        launchReturnMs: tLaunchReturn - t0,
        firstWindowMs: tFirstWindow - t0,
        queryVisibleMs: tQuery - t0,
        firstPaint: nav.paints['first-paint'] ?? null,
        fcp: nav.paints['first-contentful-paint'] ?? null,
        domInteractive: nav.domInteractive,
        dcl: nav.dcl,
        loadEnd: nav.loadEnd,
        responseEnd: nav.responseEnd,
        innerHtmlLen: nav.innerHtmlLen,
        hasRootChild: nav.hasRootChild,
        nowAtEval: nav.nowAtEval,
        topResources: nav.resources,
        logMilestones,
        consoleErrors: errors.length,
      });
      say(
        `run ${i + 1}/${RUNS} 墙钟 ${Math.round(tQuery - t0)} ms · first-paint ${r1(nav.paints['first-paint'])} ms · DCL ${r1(nav.dcl)} ms · innerHTML ${nav.innerHtmlLen} · 控制台错误 ${errors.length}`,
      );
    } finally {
      await launched.cleanup();
      await launched.app.close().catch(() => {});
    }
  }

  const col = (k) => runs.map((r) => r[k]).filter((v) => typeof v === 'number');
  // ⚠️ 空集合要返回 null 而不是 NaN：Chromium 在 file:// 下**不产出 first-contentful-paint**
  //    （实测：paint 条目里只有 first-paint）—— 第一版直接 median([]) ⇒ 表里出现 "NaN ms"。
  const med = (k) => (col(k).length ? r1(median(col(k))) : null);
  const fmtMs = (v) => (v === null ? '(缺)' : String(v) + ' ms');
  const allConsoleErrors = runs.reduce((s, r) => s + r.consoleErrors, 0);
  const innerHtmlLens = [...new Set(runs.map((r) => r.innerHtmlLen))];

  say('TABLE');
  say('| 指标 | 中位数（' + String(RUNS) + ' 次启动） |');
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
  say('| 模式 | 真实模式（`GEMMA_FAKE=""`）· 夹具库 lib-mini · **非打包态** · 文件系统缓存热 |');
  say(
    '| **first-paint**（相对 navigationStart，**主口径**） | **' +
      fmtMs(med('firstPaint')) +
      '** |',
  );
  say(
    '| first-contentful-paint | ' +
      fmtMs(med('fcp')) +
      '（file:// 下 Chromium 不产出该条目——实测） |',
  );
  say('| domInteractive（HTML 解析完） | ' + fmtMs(med('domInteractive')) + ' |');
  say('| DOMContentLoaded（**含 1.2MB 主 chunk 的解析+执行**） | ' + fmtMs(med('dcl')) + ' |');
  say('| loadEventEnd | ' + fmtMs(med('loadEnd')) + ' |');
  say(
    '| 主界面 #query 可见（harness 墙钟，含主进程/引擎） | ' + fmtMs(med('queryVisibleMs')) + ' |',
  );
  say('| 首窗口出现（harness 墙钟） | ' + fmtMs(med('firstWindowMs')) + ' |');
  say('| `launch()` 返回（harness 墙钟） | ' + fmtMs(med('launchReturnMs')) + ' |');
  say(
    '| **DCL − domInteractive**（≈ 主 chunk 的取回+解析+执行） | ' +
      fmtMs(
        med('dcl') !== null && med('domInteractive') !== null
          ? med('dcl') - med('domInteractive')
          : null,
      ) +
      ' |',
  );
  say(
    '| body.innerHTML 长度 | ' +
      (innerHtmlLens.length === 1
        ? String(innerHtmlLens[0])
        : JSON.stringify(innerHtmlLens) + '（各次不一致）') +
      ' |',
  );
  say(
    '| 渲染层 JS chunk 数 | ' +
      (chunks ? String(chunks.length) : '(没有 out/renderer/assets)') +
      ' |',
  );
  say(
    '| 渲染层 JS chunk 合计 | ' +
      (chunks ? String(chunks.reduce((s, c) => s + c.bytes, 0)) + ' B' : '(缺)') +
      ' |',
  );
  // ── 归因：首屏那几秒究竟花在哪个资源上（取第一次运行的 top 资源）──────────────
  //    没有这一栏，"首屏 6 秒"就只是个数字；有了它才能回答"lazy 之后少掉的那部分去哪儿了"。
  const topRes = (runs[0] && runs[0].topResources) || [];
  say(
    '| 最慢资源（run 1，前 5） | ' +
      (topRes.length
        ? topRes
            .slice(0, 5)
            .map((x) => x.name + ' ' + String(x.duration) + 'ms/' + String(x.decodedBodySize) + 'B')
            .join(' · ')
        : '(没有 resource 条目)') +
      ' |',
  );
  // ── 主进程时间线（run 1）—— 把"首屏 6 秒"归因到具体一层 ─────────────────────
  const lm = (runs[0] && runs[0].logMilestones) || null;
  const lmf = (v) => (v === null || v === undefined ? '(缺)' : String(v) + ' ms');
  say('| 主进程日志：app ready | ' + (lm ? lmf(lm.appReady) : '(没读到 data/_app.log)') + ' |');
  say('| 主进程日志：窗口已创建 | ' + (lm ? lmf(lm.windowCreated) : '(缺)') + ' |');
  say('| 主进程日志：引擎阶段完成 | ' + (lm ? lmf(lm.engineDone) : '(缺)') + ' |');
  say('| 主进程日志：库就绪（indexStatus ok） | ' + (lm ? lmf(lm.libReady) : '(缺)') + ' |');
  say('| 主进程日志：编码器就绪（载入完成） | ' + (lm ? lmf(lm.encoderReady) : '(缺)') + ' |');
  say('| 控制台错误合计 | ' + String(allConsoleErrors) + ' |');

  say(
    'RAW ' +
      JSON.stringify({
        runs,
        medians: {
          firstPaint: med('firstPaint'),
          fcp: med('fcp'),
          domInteractive: med('domInteractive'),
          dcl: med('dcl'),
          loadEnd: med('loadEnd'),
          queryVisibleMs: med('queryVisibleMs'),
          firstWindowMs: med('firstWindowMs'),
          launchReturnMs: med('launchReturnMs'),
        },
        innerHtmlLens,
        chunks,
        consoleErrorsTotal: allConsoleErrors,
      }),
  );

  // 结构性断言（不是性能阈值）：样本齐、界面真的渲染了、没有异常
  expect(runs.length).toBe(RUNS);
  expect(
    runs.every((r) => r.hasRootChild),
    '每次都必须真的渲染出 #root 的子节点（白屏的数字没有意义）',
  ).toBe(true);
  expect(allConsoleErrors, '不许有控制台/JS 异常（有异常的数字没有意义）').toBe(0);
});

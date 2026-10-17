// apps/desktop/e2e/start1-probe.spec.mjs —— START-1 **归因量具**（默认不跑，GEMMA_PERF=1 开启）
//
// 要回答的**唯一**问题：那 6.1 s（domInteractive → DCL）到底卡在**哪一层**？
//   · 三个场景**加载的是同一个 bundle**（同一个 out/renderer）⇒ 若三者都 ~6 s，问题在**渲染层/产物**；
//     若只有 real 慢，问题在**主进程/引擎**那一段。
//   · 每个场景都读**主进程日志里程碑**（窗口已创建 / 引擎阶段完成 / 库就绪）+ 渲染层 navigation/paint 时间戳。
//
// ⚠️ 这是**量具**，不打性能阈值（阈值未定，同 U14 口径）：只测量 + 打表。
// 跑法：
//   npm run build
//   $env:GEMMA_PERF='1'; $env:GEMMA_PROBE_RUNS='2'
//   npx playwright test -c apps/desktop/e2e/playwright.config.mjs start1-probe.spec.mjs
import fs from 'node:fs';

import { test, expect } from '@playwright/test';

import { launchWithLibrary, launchFake, launchWithoutLibrary } from './helpers/app.mjs';
import { firstWindow, collectConsoleErrors } from './helpers/launch.mjs';

const RUNS = Number(process.env.GEMMA_PROBE_RUNS || '2');
const say = (...a) => console.log('[start1]', ...a);
const r1 = (x) => (x === null || x === undefined ? null : Number(Number(x).toFixed(1)));
// TESTISO-1：每个启动的日志落点跟着它自己的 data_dir（helper 返回 logPath），不读共享日志
function readLogMilestones(appLog) {
  if (!appLog || !fs.existsSync(appLog)) return null;
  const lines = fs.readFileSync(appLog, 'utf8').split(/\r?\n/).filter(Boolean);
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

const SCENARIOS = [
  { key: 'real', launch: launchWithLibrary, ready: '#query' },
  { key: 'fake', launch: launchFake, ready: '#query' },
  { key: 'nolib', launch: launchWithoutLibrary, ready: null },
];

test('START-1 归因：三个场景的同一段首屏计时（同一 bundle）', async () => {
  test.setTimeout(600_000);
  test.skip(process.env.GEMMA_PERF !== '1', 'START-1 归因量具默认不跑（设 GEMMA_PERF=1）');

  const rows = [];
  for (const sc of SCENARIOS) {
    for (let i = 0; i < RUNS; i++) {
      const launched = await sc.launch();
      const errors = [];
      try {
        const win = await firstWindow(launched.app, 60_000);
        errors.push(...collectConsoleErrors(win));
        // ⚠️ 刻意**不**等 `#query`：三个场景落到哪个屏不一样（fake/无库会落首启向导），
        //    等一个具体选择器会把"量首屏"变成"量某个页面什么时候出现"（第一版就这么挂过一次）。
        //    这里只等文档 load 完（DCL/load 是浏览器自己记的时间戳，等完才读得到）。
        await win.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
        await win.waitForTimeout(300);
        const log = readLogMilestones(launched.logPath);
        const nav = await win.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0] || null;
          const paints = Object.fromEntries(
            performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]),
          );
          const resources = performance.getEntriesByType('resource');
          return {
            paints,
            resourceCount: resources.length,
            resources: resources
              .map((e) => ({
                name: String(e.name).split('/').pop(),
                start: e.startTime,
                end: e.responseEnd,
              }))
              .slice(0, 6),
            domInteractive: n ? n.domInteractive : null,
            dcl: n ? n.domContentLoadedEventEnd : null,
            loadEnd: n ? n.loadEventEnd : null,
            responseEnd: n ? n.responseEnd : null,
            innerHtmlLen: document.body.innerHTML.length,
            readyState: document.readyState,
            // 落到哪个屏（归因要看"同一个 bundle 在不同场景下挂载到哪"）
            url: String(location.href).split('/').pop(),
            hasQuery: !!document.getElementById('query'),
            hasWizard: !!document.querySelector('[data-testid*="wizard"],[data-wizard],form'),
            bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 60),
          };
        });
        const row = {
          scenario: sc.key,
          run: i + 1,
          firstPaint: r1(nav.paints['first-paint'] ?? null),
          domInteractive: r1(nav.domInteractive),
          dcl: r1(nav.dcl),
          gap: r1((nav.dcl ?? 0) - (nav.domInteractive ?? 0)),
          load: r1(nav.loadEnd),
          responseEnd: r1(nav.responseEnd),
          resources: nav.resourceCount,
          innerHtmlLen: nav.innerHtmlLen,
          hasQuery: nav.hasQuery,
          hasWizard: nav.hasWizard,
          bodyHead: nav.bodyHead,
          windowCreated: log ? log.windowCreated : null,
          engineDone: log ? log.engineDone : null,
          libReady: log ? log.libReady : null,
          consoleErrors: errors.length,
        };
        rows.push(row);
        say('RUN ' + JSON.stringify(row));
      } finally {
        await launched.cleanup();
        await launched.app.close().catch(() => {});
      }
    }
  }

  say('TABLE');
  say(
    '| 场景 | first-paint | domInteractive | DCL | DCL−dI（空档） | 主进程:窗口 | 主进程:引擎 | 主进程:库就绪 | resource 条目 | innerHTML |',
  );
  say('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    say(
      '| ' +
        r.scenario +
        ' #' +
        String(r.run) +
        ' | ' +
        String(r.firstPaint) +
        ' | ' +
        String(r.domInteractive) +
        ' | ' +
        String(r.dcl) +
        ' | **' +
        String(r.gap) +
        '** | ' +
        String(r.windowCreated) +
        ' | ' +
        String(r.engineDone) +
        ' | ' +
        String(r.libReady) +
        ' | ' +
        String(r.resources) +
        ' | ' +
        String(r.innerHtmlLen) +
        ' |',
    );
  }
  say('RAW ' + JSON.stringify(rows));
  expect(rows.length).toBe(SCENARIOS.length * RUNS);
  expect(
    rows.reduce((s, r) => s + r.consoleErrors, 0),
    '不许有控制台异常',
  ).toBe(0);
});

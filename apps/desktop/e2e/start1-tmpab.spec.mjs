// apps/desktop/e2e/start1-tmpab.spec.mjs —— START-1 归因第二步：TEMP 与 userData **解耦**试验
//
// 背景：三场景试验证明 6.1 s 停摆与产品代码路径无关（连"无库/向导"场景也一样），
//   而它随 **TEMP 指向哪里** 出现：仓库内 ⇒ ~0.3 s；仓库外 ⇒ ~6.1 s。
// 但 e2e 的 helper 里 TEMP 与 --user-data-dir **是同一个来源**（都来自 os.tmpdir()）⇒
//   必须解耦才知道**产品侧能动哪个杠杆**（app.setPath('temp') 还是 userData）。
//
// 四组，每组 1 次启动（仓库内 = IN，仓库外 = OUT）：
//   A: TEMP=IN  userData=IN   （预期快）
//   B: TEMP=OUT userData=OUT  （预期慢）
//   C: TEMP=IN  userData=OUT
//   D: TEMP=OUT userData=IN
// 跑法：$env:GEMMA_PERF='1'; npx playwright test -c apps/desktop/e2e/playwright.config.mjs start1-tmpab.spec.mjs
import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import { firstWindow, collectConsoleErrors, launchApp, ROOT } from './helpers/launch.mjs';
import { makeFixtureLibCopy } from './helpers/app.mjs';

const say = (...a) => console.log('[tmpab]', ...a);
const r1 = (x) => (x === null || x === undefined ? null : Number(Number(x).toFixed(1)));
// FIXTURE-DB-1：库根用**副本**（不要把 .gs.db 写进被跟踪的夹具目录）
const FIXTURE = makeFixtureLibCopy();
// 副本在整个 spec 结束后才清理（CONFIGS 循环里多次复用它）
test.afterAll(() => FIXTURE.cleanup());
const TMP_IN = path.join(ROOT, 'data', '_tmpab-in');
const TMP_OUT = 'D:\\_tmpab-out';

const CONFIGS = [
  { key: 'A: TEMP=IN  userData=IN', temp: TMP_IN, ud: 'IN' },
  { key: 'B: TEMP=OUT userData=OUT', temp: TMP_OUT, ud: 'OUT' },
  { key: 'C: TEMP=IN  userData=OUT', temp: TMP_IN, ud: 'OUT' },
  { key: 'D: TEMP=OUT userData=IN', temp: TMP_OUT, ud: 'IN' },
];

test('START-1 归因：TEMP × userData 四组对照', async () => {
  test.setTimeout(300_000);
  test.skip(process.env.GEMMA_PERF !== '1', 'START-1 解耦试验默认不跑（设 GEMMA_PERF=1）');
  fs.mkdirSync(TMP_IN, { recursive: true });
  fs.mkdirSync(TMP_OUT, { recursive: true });

  const rows = [];
  for (const cfg of CONFIGS) {
    const base = cfg.ud === 'IN' ? TMP_IN : TMP_OUT;
    const ud = fs.mkdtempSync(path.join(base, 'ud-'));
    const app = await launchApp({
      env: {
        GEMMA_CONFIG: '',
        GEMMA_LIB_ROOT: FIXTURE.root,
        GEMMA_FAKE: '',
        TEMP: cfg.temp,
        TMP: cfg.temp,
        TMPDIR: cfg.temp,
      },
      extraArgs: ['--user-data-dir=' + ud],
    });
    const errors = [];
    try {
      const win = await firstWindow(app, 60_000);
      errors.push(...collectConsoleErrors(win));
      await win.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
      await win.waitForTimeout(300);
      const nav = await win.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0] || null;
        const paints = Object.fromEntries(
          performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]),
        );
        return {
          firstPaint: paints['first-paint'] ?? null,
          domInteractive: n ? n.domInteractive : null,
          dcl: n ? n.domContentLoadedEventEnd : null,
          innerHtmlLen: document.body.innerHTML.length,
          hasQuery: !!document.getElementById('query'),
        };
      });
      const row = {
        config: cfg.key,
        firstPaint: r1(nav.firstPaint),
        domInteractive: r1(nav.domInteractive),
        dcl: r1(nav.dcl),
        gap: r1((nav.dcl ?? 0) - (nav.domInteractive ?? 0)),
        innerHtmlLen: nav.innerHtmlLen,
        hasQuery: nav.hasQuery,
        consoleErrors: errors.length,
      };
      rows.push(row);
      say('RUN ' + JSON.stringify(row));
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(ud, { recursive: true, force: true });
    }
  }
  say('TABLE');
  for (const r of rows) {
    say(
      '| ' +
        r.config +
        ' | dI=' +
        String(r.domInteractive) +
        ' | DCL=' +
        String(r.dcl) +
        ' | 空档=' +
        String(r.gap) +
        ' | innerHTML=' +
        String(r.innerHtmlLen) +
        ' | #query=' +
        String(r.hasQuery) +
        ' |',
    );
  }
  expect(rows.length).toBe(CONFIGS.length);
  expect(rows.reduce((s, r) => s + r.consoleErrors, 0)).toBe(0);
});

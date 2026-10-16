// apps/desktop/e2e/playwright.config.mjs —— Playwright 配置（**E2E，不是守卫**）
//
// 为什么需要它（2026-10-13）：渲染层的 DOM 守卫（`verify_renderer_dom.mjs`）与接线守卫
// （`verify_main_wiring.mjs`）都已按所有者指令移除 ⇒ **真实渲染、导航、真窗口行为全都没有自动化**，
// 只能靠人工 `npm run dev`。Playwright 把这一层补回来，而且比原来那套强：
// 它是**真的启动 Electron**，测的是真 IPC / 真 preload / 真窗口，不是假 `electron` 桩。
//
// ⚠️ 与 `npm test` 的关系：**两条独立的门禁**，不要混。
//   `npm test`  —— `node:test`，纯逻辑，快，无 GUI 依赖（164 条）
//   `npm run e2e` —— Playwright，真启动 Electron，慢，**需要能出窗的环境**
//   本沙箱出窗需要 `--no-sandbox` + 提权（本沙箱实测结论：需 `--no-sandbox` 且提权；原始 README 未入库）。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // Electron 启动很重，且应用是单实例语义 ⇒ 串行
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // 故意的：不配 `projects`/`webServer` —— 我们不测浏览器，只测 Electron 里的构建产物
});

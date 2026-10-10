// electron.vite.config.mjs —— electron-vite 三端一体构建（P2 工程化 · React 渲染层）
//
// 布局遵循 electron-vite 约定：`src/main` · `src/preload` · `src/renderer`。
// 引擎仍在 `core/`（传输无关、零依赖），由主进程相对导入后**打进主进程 bundle**。
// 渲染层是 React（`src/renderer/src/main.jsx` → `App.jsx`），由 `@vitejs/plugin-react` 提供 JSX 转换与 Fast Refresh。
//
// ── 三个不显然但必须这么写的点 ─────────────────────────────────────────────
// 1) **依赖不打包进主进程**（`externalizeDepsPlugin`）。
//    electron-vite 5 的默认是 `ssr.noExternal = true`（把 node_modules 全打进去）。
//    对本项目**不行**：`@huggingface/transformers` 会拉 `onnxruntime-node`，
//    `resize_compat` 会拉 `sharp` —— 两者都带原生 `.node` 二进制，打进 bundle 必坏。
//    所以把 `package.json` 的 dependencies 全部列为 external，运行时从 node_modules 解析。
// 2) **preload 必须是 CJS**。`package.json` 是 `"type": "module"`，electron-vite 于是
//    默认把 main/preload 都产出 ESM；但 `sandbox: true` 的渲染进程**不加载 ESM preload**
//    （SPEC-security §5 要求 sandbox，所以这里显式把它压回 CJS + `.cjs` 扩展名）。
// 3) **插件版本跟着 Vite 走**：本工程是 Vite 7（electron-vite 5），
//    所以 `@vitejs/plugin-react` 锁 **^5**（v6 的 peer 要求 Vite 8，装了会 ERESOLVE）。
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

/**
 * 仅开发态放宽 CSP 的 `connect-src`（serve-only，**不进生产产物**）。
 *
 * 为什么：dev 态的页面来自 `http://localhost:5173`，HMR 走 `ws://` 长连接。
 * `connect-src 'self'` 是否覆盖同源的 `ws:` 在各实现间并不一致，一旦不覆盖，
 * 表现是"页面能开但热更新静默失效"——很难往 CSP 上想。
 * 生产态（`file://`）保持 SPEC-security §5 的严格 CSP，一个字都不改。
 */
function devCspRelax() {
  return {
    name: 'gs:dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self'",
        "connect-src 'self' ws://localhost:* http://localhost:*",
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src', 'main', 'index.mjs') },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src', 'preload', 'index.js') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    // 渲染层是 React：JSX 转换 + Fast Refresh。
    // 令牌仍是全仓唯一来源 `static/prototype/tokens.css`，由 main.jsx 直接 import
    // （跨出 renderer root 但仍在工作区内，Vite 允许；**不复制第二份**，避免两份漂移）。
    plugins: [react(), devCspRelax()],
    resolve: {
      alias: { '@renderer': resolve(root, 'src', 'renderer', 'src') },
    },
  },
});

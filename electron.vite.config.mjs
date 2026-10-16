// electron.vite.config.mjs —— electron-vite 三端一体构建（monorepo 布局 · React 渲染层）
//
// 目录（v2 重构后冻结；权威描述见 AGENTS.md §3「目录职责与放置规则」）：
//   主进程 / preload / 渲染层的 root 分别在 `apps/desktop/src/{main,preload,renderer}`；
//   引擎在 `packages/engine/src`（零依赖、传输无关），索引兼容层在 `packages/indexer/src`；
//   两者都由主进程**相对导入后打进主进程 bundle**，不额外产出包。
//   视觉令牌在 `packages/design-tokens/tokens.css`（唯一来源），由 main.jsx 跨 root 直接 import。
//
// ── 四个不显然但必须这么写的点 ─────────────────────────────────────────────
// 1) **产物必须落在 `<仓库根>/out/`**（**不是** `apps/desktop/out/`）。
//    electron-vite 5 的默认 outDir 是 `path.resolve(<electron-vite root>, 'out', <段名>)`，
//    而它的 root 就是**本配置文件所在目录**（见 node_modules/electron-vite/dist/chunks/
//    lib-q6ns0vZr.js:292 / :399 / :529）。也就是说：配置一旦被挪进 `apps/desktop/`，
//    默认产物就会跟着落到 `apps/desktop/out/` —— 7 个守卫的路径断言与
//    electron-builder.yml 的假设会**同时**静默失配。所以下面三段都**显式**把 outDir
//    写成本仓库根的绝对路径：outDir 为绝对路径时 Vite 原样采用，不被任何 root 二次解析
//    （实测：`vite.resolveConfig` 下相对值保持相对、由各段自己的 root 解析；绝对值原样保留）。
// 2) **依赖不打包进主进程**（`externalizeDepsPlugin`）。
//    electron-vite 5 的默认是 `ssr.noExternal = true`（把 node_modules 全打进去）。
//    对本项目**不行**：`@huggingface/transformers` 会拉 `onnxruntime-node`，
//    `resize_compat` 会拉 `sharp` —— 两者都带原生 `.node` 二进制，打进 bundle 必坏。
//    所以把 `package.json` 的 dependencies 全部列为 external，运行时从 node_modules 解析。
// 3) **preload 必须是 CJS**。`package.json` 是 `"type": "module"`，electron-vite 于是
//    默认把 main/preload 都产出 ESM；但 `sandbox: true` 的渲染进程**不加载 ESM preload**
//    （`AGENTS.md` §1（preload `.cjs` / `sandbox: true` 硬约束） 要求 sandbox，所以这里显式把它压回 CJS + `.cjs` 扩展名）。
// 4) **插件版本跟着 Vite 走**：本工程是 Vite 7（electron-vite 5），
//    所以 `@vitejs/plugin-react` 锁 **^5**（v6 的 peer 要求 Vite 8，装了会 ERESOLVE）。
// 5) **Tailwind 只加在渲染层**（2026-10-13，T3）。它是**构建期**插件：`tailwindcss()` 扫源码
//    里的类名、生成 CSS。所以
//      · 它**不能**进 main / preload 两段（那两段跑 `externalizeDepsPlugin`，且没有 CSS）；
//      · 它也不该被 external —— 渲染层的构建不需要 external 逻辑（只有 main/preload 用）。
//    入口是 `apps/desktop/src/renderer/src/styles/tailwind.css`，由 `main.jsx` 在
//    `renderer.css` **之前** import（生成层在前、手写层在后 ⇒ 手写样式仍能覆盖工具类，
//    迁移期这是必要的；顺序写反会让现有外观被工具类意外改掉）。
import fs from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 本配置文件就在仓库根 ⇒ import.meta.dirname 即仓库根。
const root = import.meta.dirname;
/** 段名 → `<仓库根>/out/<段名>`（绝对路径，见文件头第 1 点） */
const out = (segment) => resolve(root, 'out', segment);
/** `apps/desktop/<...>` 的绝对路径（三段 input/root 都用它，避免各段 root 各不相同带来的相对路径歧义） */
const desktop = (...parts) => resolve(root, 'apps', 'desktop', ...parts);

/**
 * 构建期临时目录 —— **不许依赖 `os.tmpdir()`（Windows 上就是环境变量 `TEMP`）**。
 *
 * ── 为什么必须自己指定（2026-10-16 实测；S1 的根因）────────────────────────
 *   esbuild 会在 `%TEMP%` 下建一个 `esbuild-<32 字节 hex>` 目录，**退出时删不掉**：
 *       [vite:esbuild-transpile] remove C:\Users\…\Temp\esbuild-<hash>: Access is denied.
 *   于是**渲染层**那一段构建直接失败（`out/renderer` 空），而 main / preload 已经构建成功 ——
 *   现象上很像"渲染层坏了"，其实是临时目录不可用。
 *
 *   ⚠️ 这条一直没被发现，是因为门禁脚本**手动**把 `TEMP`+`TMP` 都指到了仓库内：
 *      默认 TEMP                 ⇒ Build failed（EXIT≠0）
 *      TEMP + TMP 都指仓库内     ⇒ EXIT=0
 *      **只**改 TMP、TEMP 留默认 ⇒ **仍然失败** ← 审查者"换 TMP 仍复现"的真因
 *   ⇒ 这是**环境依赖**，不是产品缺陷；换一台机器或 CI（没人手设这两个变量）就会红。
 *
 * ── 做法 ──────────────────────────────────────────────────────────────
 *   构建时把**三个**变量都指到仓库内的 `data/_esbuild-tmp`：
 *     · Windows 读 `TEMP`（`TMP` 只是回退），POSIX 读 `TMPDIR` ⇒ 都设上，别只设一个；
 *     · `data/_*` 已被 `.gitignore` 与 `.prettierignore` 忽略 ⇒ 不会污染仓库、不会被格式化；
 *     · Node 的 `os.tmpdir()` **不缓存**（实测：先调一次再改 `process.env.TEMP`，下次调用即返回新值），
 *       而本配置文件在 electron-vite 真正开始构建**之前**求值 ⇒ 覆盖一定生效。
 *
 * ── ⚠️ 只在 `command === 'build'` 时重定向（不无条件改）────────────────────
 *   dev / preview 会由 electron-vite 拉起 **Electron**，子进程继承这份环境；
 *   那时改 `TEMP` 等于把 Electron 自己的临时目录（GPU 缓存 / 崩溃转储 / `app.getPath('temp')`）
 *   也搬进仓库 —— 那才是真的**行为改变**，而 dev 并不需要这条修复。
 */
const BUILD_TMP = resolve(root, 'data', '_esbuild-tmp');
function useRepoLocalTempDir() {
  fs.mkdirSync(BUILD_TMP, { recursive: true });
  process.env.TEMP = BUILD_TMP;
  process.env.TMP = BUILD_TMP;
  process.env.TMPDIR = BUILD_TMP;
}

/**
 * 仅开发态放宽 CSP 的 `connect-src`（serve-only，**不进生产产物**）。
 *
 * 为什么：dev 态的页面来自 `http://localhost:5173`，HMR 走 `ws://` 长连接。
 * `connect-src 'self'` 是否覆盖同源的 `ws:` 在各实现间并不一致，一旦不覆盖，
 * 表现是"页面能开但热更新静默失效"——很难往 CSP 上想。
 * 生产态（`file://`）保持 `AGENTS.md` §1（preload `.cjs` / `sandbox: true` 硬约束） 的严格 CSP，一个字都不改。
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

export default defineConfig(({ command }) => {
  // 构建期把临时目录收回仓库内（理由见 useRepoLocalTempDir）；dev / preview 不动环境。
  if (command === 'build') useRepoLocalTempDir();

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: {
        outDir: out('main'),
        rollupOptions: {
          input: { index: desktop('src', 'main', 'index.ts') },
        },
      },
    },

    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        outDir: out('preload'),
        rollupOptions: {
          input: { index: desktop('src', 'preload', 'index.ts') }, // 2026-10-14：preload 源码转 TS（产物仍是 index.cjs）
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },

    renderer: {
      // 渲染层是 React：JSX 转换 + Fast Refresh。
      // 显式 root：electron-vite 的默认值是 `./src/renderer`（相对 cwd），新布局下不存在。
      root: desktop('src', 'renderer'),
      plugins: [react(), tailwindcss(), devCspRelax()],
      resolve: {
        alias: { '@renderer': desktop('src', 'renderer', 'src') },
      },
      server: {
        // 令牌仍是全仓唯一来源，现在在 `packages/design-tokens/tokens.css` —— 已在 renderer root
        // **之外**，由 main.jsx 直接 import（跨 root，Vite 允许；**不复制第二份**，避免两份漂移）。
        // dev 态该文件经 `/@fs/` 提供，要过 Vite 的 fs.allow；默认值是"自动探测的工作区根"，
        // 这里显式写成仓库根：monorepo 多一层目录，靠自动探测容易误判成 403。
        fs: { allow: [root] },
      },
      build: {
        outDir: out('renderer'),
        // 不写 input 就要靠 electron-vite 的默认探测 `<CLI root>/src/renderer/index.html`；
        // 新布局下那个路径不存在（探测落空 → input 为空 → 构建直接失败），所以显式给出。
        rollupOptions: {
          input: desktop('src', 'renderer', 'index.html'),
        },
      },
    },
  };
});

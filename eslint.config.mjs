// eslint.config.mjs —— ESLint flat config（T-09，2026-10-15）
//
// ── 定位：**报告制**，不是修复制 ──────────────────────────────────────────
//   本卡只要求「能跑通并产出违规清单」，**不在本卡修**（修法另开卡 —— 否则 T-09 会爆炸）。
//   所以这里刻意只取**保守集**：@eslint/js 的 recommended。
//   不开会引发大规模重写的规则（类型感知规则族、strict-boolean-expressions、
//   no-floating-promises、各类 stylistic 规则……），那些按需另开卡引入。
//
// ── ⚠️ 为什么**没有** typescript-eslint（实测结论，不是图省事）──────────────
//   仓库锁定 typescript@7.0.2，而 typescript-eslint **import 即抛**：
//     $ node -e "require('typescript-eslint')"
//     Error: typescript-eslint does not support TS 7.0.        (dist/index.js:45-53)
//   底层 @typescript-eslint/parser 与 @typescript-eslint/eslint-plugin **同样**抛（都实测过）；
//   已发布的 latest(8.71.2) 与 canary(8.71.3-alpha.5) 的 peer 都是 typescript <6.1.0 ⇒ **无版本可用**。
//   官方提示的出路是「并行装 TS6，走 TS6 API」，那会给仓库引入**第二个 TypeScript 大版本**
//   （overrides 对整棵依赖树生效、编辑器与工具里出现「两个 tsc」）——
//   所有者 2026-10-15 裁定**不引入**（收益与代价不成比例）。
//   ⇒ 本配置只覆盖 **JS 家族**（.js / .mjs / .cjs / .jsx）。
//     **TS 规则另见 task-79**，启动条件 = 上游支持 TS >= 7.1，或所有者批准并行 TS6。
//   ⚠️ 别为了「让 .ts 也被检查」把 typescript-eslint 装回来 —— 它 import 就崩，那是死依赖。
//      （TASKS.md §5「工具链限制」已把这条连同实测输出记下。）
//
// ── 忽略口径与 .prettierignore 保持一致：派生物 / 本机数据 / 历史证据 / 夹具 / 归档 ──
//   ESLint 默认不读 .gitignore，必须显式列。
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'release/**',
      '.npm-cache/**',
      'model-cache/**',
      'data/**',
      'reports/**',
      'fixtures/**',
      'prototypes/**',
      'docs/**', // 旧文档体系（v2 之前），不是源码 —— 与 .prettierignore 同口径
    ],
  },

  // ---- ESM 家族：.js / .mjs / .jsx（本仓库 "type": "module"）----
  {
    files: ['**/*.{js,mjs,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // ---- CJS：.cjs 必须按 commonjs 解析，否则 require/module 会被误报 ----
  {
    files: ['**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // ---- 浏览器全局：渲染层 + Playwright 规格 ----
  //   ⚠️ 为什么 e2e 也要：Playwright 的 `page.evaluate(() => window…)` / `page.$eval` 回调
  //      是在**页面上下文**里求值的，那里的 `window` / `document` / `getComputedStyle` / `location`
  //      是真实存在的全局。只给 node 全局会把它们全判成 no-undef（实测 56 条**全是这一类**）。
  //      flat config 对同文件的多条 `languageOptions.globals` 是**合并**的 ⇒
  //      这里补 browser 不会丢掉上面那份 node 全局（规格文件本身仍是 Node 里跑的 ESM）。
  //   ⚠️ 现行渲染层是 .tsx（本卡不覆盖 TS），这条留给将来 TS 规则接上时复用。
  {
    files: ['apps/desktop/src/renderer/**/*.{js,jsx}', 'apps/desktop/e2e/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];

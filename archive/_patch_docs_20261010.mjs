// _stage/patch-docs.mjs —— 把文档改成与实跑一致（一次性；带命中数校验，命中不符即中止）
//
// 为什么用脚本而不是手改：README / TASK-PLAN / src/README 里带中文引号与长表格行，
// 手工替换容易"改到一半静默不匹配"。这里每条补丁都先断言**恰好命中 1 次**，
// 任何一条不命中就整体中止、不写盘（宁可报错，不要半改）。
//
// 归档：跑完由调用方复制到 archive/_patch_docs_20261010.mjs（一次性脚本按仓库惯例归档，不删）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const patches = [];
const P = (file, re, to, label) => patches.push({ file, re, to, label });

// ---------------------------------------------------------------- README.md
P('README.md',
  /^\| \*\*B\. 独立桌面应用（Node \+ ONNX）\*\* .*$/m,
  '| **B. 独立桌面应用（Electron + Vite + React）** | ✅ **已在 Electron 内实跑出窗（React 渲染 + WebGPU 载入；证据 `reports/G-D-p2-electron/`）** | 取代 A：Electron 应用，不再依赖 DSH。引擎 `core/`（68 测全过）与 electron-vite 三端主体（`src/main` · `src/preload` · `src/renderer`）已就位；渲染层 2026-10-10 由手写 DOM 迁到 **React**，并在本机 Electron 内实跑（受限沙箱需 `--no-sandbox`）。规格见下方文档索引 |',
  'README 状态表 B 行');

P('README.md',
  /^> \*\*Node 档是新应用\*\*.*$/m,
  '> **Node 档是新应用**（引擎 `core/` + Electron/React 主体 `src/`）。旧档到 P7 才退役。',
  'README 新旧两档说明');

P('README.md',
  /^### 文档索引$/m,
  `#### 应用实跑结论（2026-10-10 · 证据 \`reports/G-D-p2-electron/\`）

\`\`\`powershell
npm run build     # 三端：main / preload / renderer（React）
npm run dev       # 你自己的终端：dev server + Electron 窗口 + HMR
npm start         # 跑构建产物（file://），最接近打包态
\`\`\`

- **已实跑**：Electron 出窗（标题「gemma-search · 素材库语义检索」）· React 渲染层挂载 ·
  \`invoke indexStatus\` 打通 · 编码器**在 Electron 内以 WebGPU 载入（2.4 s）**
  —— 这一条同时是 P1.5 的核心问题（WebGPU 能否在 Electron 里起来）的答案。
- **受限沙箱内**必须加 \`--no-sandbox\`（Chromium 的进程沙箱起不来 → \`0x80000003\` 秒退）；
  **普通终端不需要**，也不要把它固化进产品。
- **\`web/\` 已删除**（2026-10-10）：它是浏览器预览的过渡产物，与根工程构成两套依赖、
  两份令牌的相互污染。React 界面直接住在 \`src/renderer\`，令牌仍是唯一来源
  \`static/prototype/tokens.css\`（不复制第二份）。
- 界面能开、IPC 通，但**检索还出不了结果**：引擎报 \`INDEX_MISSING\`（索引尚未登记，属 P0.5-c）。

### 文档索引`,
  'README 插入实跑结论');

// ---------------------------------------------------------------- src/README.md
P('src/README.md',
  /^│   ├── index\.html .*$/m,
  '│   ├── index.html      CSP + 挂载点 #root（DOM 结构由 React 生成）',
  'src/README 目录树 index.html');

P('src/README.md',
  /^│   └── src\/main\.js .*$/m,
  `│   ├── src/main.jsx    React 入口（挂载 + 加载令牌与样式）
│   ├── src/App.jsx     检索界面（React 组件；原 main.js 的逐行为对照迁移）
│   └── src/app.css     界面样式（取设计令牌，未改）`,
  'src/README 目录树 renderer');

P('src/README.md',
  /(## 6\.[\s\S]*?)(?=\n## 7\.)/,
  `## 6. Electron 内实跑结果（2026-10-10 · 证据 \`reports/G-D-p2-electron/\`）

**能跑。** 根目录 Electron 应用在 1440×920 窗口里渲染 React 界面：

- 窗口标题 \`gemma-search · 素材库语义检索\`；关窗即退出，无残留进程
- \`[renderer] info [ui] React 已挂载 · react 19.3.0\` → 渲染层在 Electron 里跑的是 React（不是旧的手写 DOM）
- \`invoke indexStatus 2ms → ok\` → preload 白名单 + 来源校验 + zod 校验 + 引擎，整条链路打通
- \`载入模型 dtype=fp32 seq=140 device=webgpu\` / \`载入完成 2.4s\` → **P1.5 的核心问题已答：WebGPU 在 Electron 内能起来**
- 界面显示「模型就绪 · webgpu · 2.6s」

**本环境的硬约束**：Chromium 的进程沙箱起不来，Electron 必须加 \`--no-sandbox\` 才能出窗
（不加则 \`0x80000003\` 秒退；判据见 \`tools/probe_electron_start/README.md\`）。
**这是承载环境的限制，不是应用的配置** —— 你自己的终端用 \`npm run dev\` 即可。

仍未验的（不声称可用）：

- [ ] 冷启动 ≤5 s（未计时）· 打包态（asar）内的 WebGPU（P6）
- [x] 产品态（\`file://\`）能出窗 —— 已实跑
- [x] 渲染层是 React 并已挂载 —— 已实跑
- [x] **WebGPU 在 Electron 内能起来** —— 已实跑
- [~] 侧栏读数：IPC 通了，但引擎报 **INDEX_MISSING**（\`0/0 · dim null\`）—— 索引尚未登记（P0.5-c）
- [ ] 中文检索出结果 / 缩略图零 404 —— 依赖上一条
`,
  'src/README §6 换成实跑结果');

P('src/README.md',
  /^\| 2 \| 界面仍是普通 JS \+ DOM .*$/m,
  '| 2 | ~~界面仍是普通 JS + DOM~~ **已迁 React**（2026-10-10：`main.jsx` + `App.jsx`，`app.css` 与令牌未改） | 迁移与 React 化已经一起做完；设计系统（Tailwind + shadcn/ui + 令牌接进 Tailwind）仍是 P3a 的活 | P3a |',
  'src/README §7 界面行');

// ---------------------------------------------------------------- TASK-PLAN.md
P('TASK-PLAN.md',
  /^> 最后更新：.*$/m,
  '> 最后更新：2026-10-10（Electron + Vite + React 实跑后）· 状态：**P0 完成（G-A 通过）· P0.5 v2 全量重建已完成（3594/3594 · 0 失败，待出 G-B）· P1 引擎与 P2 骨架已提前推进 · 渲染层已迁 React 并在 Electron 内实跑出窗（WebGPU 载入成功，证据 `reports/G-D-p2-electron/`）**',
  'TASK-PLAN 抬头状态');

P('TASK-PLAN.md',
  /^\| electron-vite 工程化.*$/m,
  '| electron-vite 工程化（`src/` 三端 + 构建配置 + 产物形状核对） | ✅ 已迁（`npm run build` 三端产出成功；main=ESM / preload=CJS / 依赖全 external）；**渲染层 2026-10-10 迁 React**（`@vitejs/plugin-react@^5`，v6 要求 Vite 8 与本工程冲突） |',
  'TASK-PLAN P2 工程化行');

P('TASK-PLAN.md',
  /^\| \*\*在 Electron 里真跑一次\*\*.*$/m,
  '| **在 Electron 里真跑一次**（P1.5 冒烟：WebGPU 能否在 Electron/asar 内起来） | ✅ **已实跑（2026-10-10）**：窗口出 · React 挂载 · `indexStatus ok` · **WebGPU 载入 2.4 s**；asar 打包态仍待 P6。证据 `reports/G-D-p2-electron/`（受限环境需 `--no-sandbox`） |',
  'TASK-PLAN P2 实跑行');

P('TASK-PLAN.md',
  /^\| 门禁 \| \*\*G-D\*\*（并入 P2 前）\|$/m,
  `| 门禁 | **G-D**（并入 P2 前）|

**结果（2026-10-10）：✅ 已过** —— Electron 内出窗、React 渲染、IPC 通、**WebGPU 载入成功**。
asar 打包态与冷启动计时留到 P6；证据 \`reports/G-D-p2-electron/\`。`,
  'TASK-PLAN P1.5 结果');

// ---------------------------------------------------------------- 探针判读表
P('tools/probe_electron_start/README.md',
  /^(# 最小 Electron 探针)$/m,
  `$1

## 本机实测补充（2026-10-10）—— 「起不来」已定性

| 观察 | 含义 |
|---|---|
| \`electron.exe --version\` → \`0x80000003\`，无任何输出 | **Chromium 进程沙箱初始化失败**。排除法：二进制完好（版本 44.7.0 / 246 MB / dist 齐全）、\`ELECTRON_RUN_AS_NODE\` 已清 |
| 同一条命令加 \`--no-sandbox\` → \`exit=0\` 并打印 \`v44.7.0\` | 卡住的就是**沙箱初始化** |
| \`electron --no-sandbox out\\main\\index.js\` | **应用正常出窗**：React 渲染、IPC 通、WebGPU 载入 2.4 s（证据 \`reports/G-D-p2-electron/\`） |
| 同一会话里记事本能出窗；\`LOCALAPPDATA\` 可写 | 排除"没有图形会话 / 权限不足" |

> 结论：本环境下「Electron 起不来」= **Chromium 沙箱与本承载环境不兼容**，与项目代码无关。
> 用户自己的终端**不需要** \`--no-sandbox\`；不要把它固化进产品配置。`,
  '探针判读表补充',
);

// ---------------------------------------------------------------- 执行（全命中才写盘）
const mode = process.argv[2] || 'apply';
const changed = new Map();
const failures = [];

for (const p of patches) {
  const file = path.join(ROOT, p.file);
  const src = changed.has(p.file) ? changed.get(p.file) : fs.readFileSync(file, 'utf8');
  const m = src.match(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'));
  const n = m ? m.length : 0;
  if (n !== 1) {
    failures.push(`${p.label}：命中 ${n} 次（应为 1）· 文件 ${p.file}`);
    continue;
  }
  changed.set(p.file, src.replace(new RegExp(p.re.source, p.re.flags), p.to));
  console.log(`  [OK  ] ${p.label}`);
}

if (failures.length) {
  console.error('\n有补丁没命中，**一个文件都没写**：');
  for (const f of failures) console.error('  · ' + f);
  process.exit(1);
}

if (mode === 'dry-run') {
  console.log(`\n${patches.length} 条补丁全部可命中（dry-run，未写盘）`);
  process.exit(0);
}

for (const [rel, content] of changed) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  console.log(`  写入 ${rel}`);
}
console.log(`\n${patches.length} 条补丁已应用，涉及 ${changed.size} 个文件。`);

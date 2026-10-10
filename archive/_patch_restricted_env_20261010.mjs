// _stage3/patch-all.mjs —— 一次性补丁（每条校验命中数，任一不命中即整体中止、不写盘）
//
// 做三件事：
//   1) package.json：加 dev:restricted / start:restricted，去掉临时的 start:here
//   2) README / src/README：把"受限环境怎么起"写清楚（此前只说了"起不来"）
//   3) DEBT-CLEANUP 与 G-D 证据：记下 electron-vite 的两个开关与实测对照
import fs from 'node:fs';

const patches = [
  {
    file: 'README.md',
    label: 'README 跑应用块：补受限环境命令',
    find: "npm run dev      # dev server + HMR（改渲染进程代码即时生效）\n" +
      "npm run build    # 产出 out/main · out/preload · out/renderer\n" +
      "npm start        # = electron-vite preview：跑刚 build 出来的产物（接近打包态）\n" +
      "```\n" +
      "\n" +
      "> `dev`/`start` 走的是 `scripts/electron-vite.mjs`：它会先摘掉 `ELECTRON_RUN_AS_NODE`。",
    repl: "npm run dev      # dev server + HMR（改渲染进程代码即时生效）\n" +
      "npm run build    # 产出 out/main · out/preload · out/renderer\n" +
      "npm start        # = electron-vite preview：跑刚 build 出来的产物（接近打包态）\n" +
      "\n" +
      "# 受限环境（Chromium 的进程沙箱起不来 → Electron 秒退、日志一行都不生成）：\n" +
      "npm run dev:restricted      # = dev --noSandbox --entry out/main/index.js\n" +
      "npm run start:restricted    # 同上，但跑构建产物（file://）\n" +
      "```\n" +
      "\n" +
      "> 上面那两个 `:restricted` 只是把 electron-vite **自带的**开关显式写出来；\n" +
      "> 正常情况下**不需要**用它们 —— `scripts/electron-vite.mjs` 启动前会探测一次\n" +
      "> （`electron --version` 失败、加 `--no-sandbox` 正常 = 本机沙箱不可用），探测到就\n" +
      "> **只为这一次启动**附加那两个开关，并把判断依据打印出来。普通机器上不会出现这一行。\n" +
      "\n" +
      "> `dev`/`start` 走的是 `scripts/electron-vite.mjs`：它会先摘掉 `ELECTRON_RUN_AS_NODE`。",
  },
  {
    file: 'src/README.md',
    label: 'src/README §6：补受限环境命令',
    find: "**这是承载环境的限制，不是应用的配置** —— 你自己的终端用 `npm run dev` 即可。",
    repl: "**这是承载环境的限制，不是应用的配置**。`scripts/electron-vite.mjs` 启动前会探测一次：\n" +
      "探测到沙箱不可用就**只为本次**附加 `--noSandbox --entry out/main/index.js` 并打印判断依据；\n" +
      "也可显式用 `npm run dev:restricted`（跑构建产物则是 `npm run start:restricted`）。",
  },
];

// ---------------------------------------------------------------- 1) package.json
{
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  delete p.scripts['start:here'];
  p.scripts['dev:restricted'] = 'node scripts/electron-vite.mjs dev --noSandbox --entry out/main/index.js';
  p.scripts['start:restricted'] = 'node scripts/electron-vite.mjs preview --noSandbox --entry out/main/index.js';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n', 'utf8');
  console.log('  [OK  ] package.json：+ dev:restricted / start:restricted，- start:here');
}

// ---------------------------------------------------------------- 2) 文档补丁（先全命中再写）
const changed = new Map();
const failed = [];
for (const p of patches) {
  const src = changed.has(p.file) ? changed.get(p.file) : fs.readFileSync(p.file, 'utf8');
  const n = src.split(p.find).length - 1;
  if (n !== 1) { failed.push(`${p.label}（命中 ${n} 次）`); continue; }
  changed.set(p.file, src.replace(p.find, p.repl));
  console.log(`  [OK  ] ${p.label}`);
}
if (failed.length) {
  console.error('\n有补丁没命中（package.json 已改，文档未改）：');
  for (const f of failed) console.error('  · ' + f);
  process.exit(1);
}
for (const [file, content] of changed) {
  fs.writeFileSync(file, content, 'utf8');
  console.log(`  写入 ${file}`);
}

// ---------------------------------------------------------------- 3) 追加债务与证据
fs.appendFileSync('DEBT-CLEANUP.md',
  '\n| 11 | electron-vite 的 dev 默认把入口传成 `.`（目录形式） | 本机实测该形式会以 `0xC0000005` 崩在 `app.whenReady()` 之前；' +
  '`scripts/electron-vite.mjs` 探测到受限环境时会自动补 `--entry out/main/index.js` | 已修（工具内） |\n' +
  '| 12 | 官方开关一直存在但没人用 | electron-vite 自带 `--noSandbox`（`cli.js` → `NO_SANDBOX=1` → 给 Electron 加 `--no-sandbox`）' +
  '与全局 `--entry`。此前 README 只写了"沙箱里起不了 Electron"，**没写"那怎么起"** | ✅ 已写进 README 与脚本 |\n', 'utf8');
console.log('  [OK  ] DEBT-CLEANUP.md 追加 2 行');

fs.appendFileSync('reports/G-D-p2-electron/README.md',
  '\n## 7. 追加：受限环境下的**可用命令**（2026-10-10 晚，实测）\n\n' +
  '```powershell\nnpm run dev:restricted      # = dev --noSandbox --entry out/main/index.js\n```\n\n' +
  '实测：dev server 起在 5173、Electron 出窗、`[ui] React 已挂载 · react 19.3.0`、' +
  '`invoke indexStatus → ok`、**WebGPU 载入 2.5 s**。界面上点「搜索」会走到引擎并**如实报错**：\n\n' +
  '```\ninvoke search 728ms → INDEX_MISSING\ndetails.skipped[0].detail = 索引不存在：...\\data\\libraries\\L1\\index.bin\n```\n\n' +
  '**这就是检索还不可用的全部原因**：引擎按 `<data_dir>/libraries/<libId>/` 找索引，' +
  '而 v2 索引在 `data/idx-full-v2/`，尚未走 P0.5-c 的"接受"。\n\n' +
  '两个开关各自的必要性（同一台机器上的对照）：\n\n' +
  '| 命令 | 结果 |\n|---|---|\n' +
  '| `electron .` | 秒退，日志一行都没有（沙箱断言 `0x80000003`） |\n' +
  '| `electron . --no-sandbox` | 进到 JS、写 7 行日志，然后 `0xC0000005` 崩在 ready 前（目录形式） |\n' +
  '| `electron out\\main\\index.js --no-sandbox` | **正常出窗** |\n' +
  '| `npm run dev -- --noSandbox --entry out/main/index.js` | **正常出窗（dev + HMR）** |\n', 'utf8');
console.log('  [OK  ] G-D 证据追加可用命令与对照表');
console.log('\n完成。');

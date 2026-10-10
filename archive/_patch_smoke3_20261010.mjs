// _fix/patch-smoke3.mjs —— 一次性补丁（校验命中数）
//
// 对照实验（本环境实测）：
//   electron.exe . --no-sandbox                      → 秒退（0xC0000005，主进程崩在 ready 前）
//   electron.exe --no-sandbox out\main\index.js      → 正常出窗（标题「gemma-search · 素材库语义检索」）
// 所以冒烟脚本改成把**主脚本路径**传给 Electron，而不是目录 `.`。
import fs from 'node:fs';

const TARGET = 'tools/smoke_app.mjs';
const find = "const child = spawn(electronPath, ['.', ...(NO_SANDBOX ? ['--no-sandbox'] : [])],";
const repl = `// 传**主脚本路径**而不是目录 \`.\`：本环境实测目录形式会让主进程以 0xC0000005 崩在 ready 之前，
// 而脚本路径形式正常出窗（对照记录在 reports/G-D-p2-electron/README.md）。
const child = spawn(electronPath, [MAIN, ...(NO_SANDBOX ? ['--no-sandbox'] : [])],`;

const src = fs.readFileSync(TARGET, 'utf8');
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error(`命中数 ${n}（应为 1），未修改`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已改为主脚本路径形式：', TARGET);

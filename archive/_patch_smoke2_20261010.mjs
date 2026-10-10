// _fix/patch-smoke2.mjs —— 一次性补丁（校验命中数）
//
// 症状：tools/smoke_app.mjs 用 `stdio: ['ignore','pipe','pipe']` 拉起 Electron 时，
// 主进程在 `app.whenReady()` 之前以 **0xC0000005（访问冲突）** 退出；
// 换成文件重定向/不使用管道的那次同样参数下却正常出窗。
// Windows 上 Electron 是 GUI 子系统程序，主进程 stdout 本来就不连终端 ——
// 日志的真正来源是 GEMMA_APP_LOG，所以直接不用管道最稳。
import fs from 'node:fs';

const TARGET = 'tools/smoke_app.mjs';
const find = `const child = spawn(electronPath, ['.', ...(NO_SANDBOX ? ['--no-sandbox'] : [])],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
const out = [];
const push = (tag) => (buf) => { const s = String(buf); out.push(\`[\${tag}] \${s}\`); process.stdout.write(s); };
child.stdout.on('data', push('stdout'));
child.stderr.on('data', push('stderr'));`;

const repl = `// **刻意不用管道**接子进程 stdio：本环境实测 Electron 在 \`stdio: 'pipe'\` 下会以
// 0xC0000005（访问冲突）崩在 ready 之前，同样的参数改成不使用管道就正常出窗。
// 而 Windows 上 Electron 是 GUI 子系统程序，主进程 stdout 本来也不连终端 ——
// 日志的真正来源是 GEMMA_APP_LOG 指定的那个文件（下面会把它打印出来）。
const child = spawn(electronPath, ['.', ...(NO_SANDBOX ? ['--no-sandbox'] : [])],
  { cwd: ROOT, env, stdio: 'ignore' });`;

const src = fs.readFileSync(TARGET, 'utf8');
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error(`命中数 ${n}（应为 1），未修改`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已改为不使用管道：', TARGET);

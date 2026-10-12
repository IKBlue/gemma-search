// _stage9/patch-capture.mjs —— 给主进程加"应用自截图"开关（一次性，带命中数校验）
//
// 动机（本次实测）：用系统截屏抓窗口不可靠 —— 窗口被别的窗口盖住时，
// CopyFromScreen 抓到的是**最上层**的像素（我第一次就抓到了一张原型页）。
// 正确做法是让应用截自己：webContents.capturePage()，与窗口前后台无关。
//
// 开关：
//   GS_CAPTURE=<png 路径>        页面加载完成后截图存盘
//   GS_CAPTURE_DELAY_MS=<毫秒>   延迟（默认 4000，让编码器预热完、侧栏显示状态）
//   GS_CAPTURE_EXIT=0            截完不退出（默认退出，便于脚本化）
import fs from 'node:fs';

const TARGET = 'src/main/index.mjs';
const find = "  win.webContents.on('did-finish-load', () => log('渲染页加载完成'));";
const repl = `  // 开发/验收用：应用**自己**截自己（GS_CAPTURE=<png 路径>）。
  // 用系统截屏抓窗口不可靠：窗口被别的窗口盖住时，抓到的会是最上层那个应用（实测踩过）。
  win.webContents.on('did-finish-load', () => {
    log('渲染页加载完成');
    const target = process.env.GS_CAPTURE || '';
    if (!target) return;
    const delayMs = Number(process.env.GS_CAPTURE_DELAY_MS || 4000);
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, img.toPNG());
        const { width, height } = img.getSize();
        log('已截图', target, \`\${width}x\${height}\`);
      } catch (e) {
        log('截图失败', e && e.message ? e.message : String(e));
      }
      if (process.env.GS_CAPTURE_EXIT !== '0') app.quit();
    }, delayMs);
  });`;

const src = fs.readFileSync(TARGET, 'utf8');
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error(`命中数 ${n}（应为 1），未修改：${TARGET}`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已加 GS_CAPTURE 自截图开关：', TARGET);

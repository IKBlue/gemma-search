// _stageE/patch-capture-query.mjs —— 给自截图加"截图前先跑一次检索"（一次性，命中数校验）
//
// 为什么要：空态截图看不出结果区（.gallery/.photo-card）的设计。
// GS_CAPTURE_QUERY=<文字> 时，截图前在渲染进程里把查询词填进 #query 并点「搜索图片 →」，
// 等结果渲染完再截 —— 这样证据里能看到真实结果的排版。
import fs from 'node:fs';

const TARGET = 'src/main/index.mjs';
const find = `    const delayMs = Number(process.env.GS_CAPTURE_DELAY_MS || 4000);
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();`;
const repl = `    const delayMs = Number(process.env.GS_CAPTURE_DELAY_MS || 4000);
    setTimeout(async () => {
      try {
        // 可选：截图前先跑一次检索，让证据里能看到结果区（GS_CAPTURE_QUERY=<查询词>）
        const q = process.env.GS_CAPTURE_QUERY || '';
        if (q) {
          await win.webContents.executeJavaScript(
            '(() => {' +
            '  const i = document.getElementById("query");' +
            '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;' +
            '  setter.call(i, ' + JSON.stringify(q) + ');' +
            '  i.dispatchEvent(new Event("input", { bubbles: true }));' +
            '  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "搜索图片 →");' +
            '  if (btn) btn.click();' +
            '  return true;' +
            '})()');
          await new Promise((r) => setTimeout(r, 2500));   // 等检索 + 缩略图渲染
        }
        const img = await win.webContents.capturePage();`;

const src = fs.readFileSync(TARGET, 'utf8');
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error(`命中数 ${n}（应为 1），未修改：${TARGET}`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已加 GS_CAPTURE_QUERY：', TARGET);

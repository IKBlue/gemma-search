// 最小 Electron 探针：只做三件事，全部写进文件（GUI 子系统没有 stdout）
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, 'probe.log');
const w = (m) => {
  try {
    fs.appendFileSync(LOG, m + '\n');
  } catch {
    // ⚠️ LINT-1（2026-10-16）**故意留空**：这是启动探针，日志写不进去就没得写 ——
    //    探针绝不能因为一次 appendFileSync 失败而崩（那会把「探针失效」伪装成「应用起不来」）。
    //    no-empty 对**含注释**的空块不报（注释就是这里要说明的「为什么是空的」）。
  }
};
w('--- probe start ---');
w('execPath=' + process.execPath);
w('ELECTRON_RUN_AS_NODE=' + JSON.stringify(process.env.ELECTRON_RUN_AS_NODE || null));
let electron = null;
try {
  electron = require('electron');
} catch (e) {
  w('!! require(electron) 抛错: ' + e.message);
}
w('typeof electron=' + typeof electron);
const { app, BrowserWindow } = electron && typeof electron === 'object' ? electron : {};
w('app=' + typeof app + ' BrowserWindow=' + typeof BrowserWindow);
if (!app || typeof app.whenReady !== 'function') {
  w('!! 拿不到运行时 API');
  process.exit(9);
}
app.whenReady().then(() => {
  w('app ready ✓');
  const win = new BrowserWindow({ width: 420, height: 260, show: false });
  win.loadURL('data:text/html,<h1>electron probe ok</h1>');
  win.webContents.once('did-finish-load', () => {
    w('窗口加载完成 ✓');
    setTimeout(() => {
      w('--- probe end (ok) ---');
      app.quit();
    }, 800);
  });
});
setTimeout(() => {
  w('!! 3s 超时未就绪');
  process.exit(10);
}, 3000);

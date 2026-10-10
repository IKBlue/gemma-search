/* ============================================================
   gemma-search 原型 · 共享脚本（app.js）

   为什么需要它（这是修 bug，不是加功能）：
   原型套件的三个页面里共写了 21 个 data-demo 按钮与 14 处 onclick="toast(...)"，
   但**没有任何一页定义 toast()，也没有 data-demo 的处理器**，
   于是这些按钮点下去会抛 ReferenceError（静默失败，看着像"没反应"）。
   把 toast / data-demo 提到共享文件，三页一次性修好，不再各写一份。

   另外补两件本套原型缺的基础能力：
     · 弹窗开关（openDialog / closeDialog），供"文件操作确认"
     · Esc 关闭弹窗、点遮罩关闭
   ============================================================ */

'use strict';

/* ---------- 提示条 ---------- */
let __toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {                       // 页面没放容器时补一个，保证调用不报错
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- data-demo：原型上所有"假按钮"统一出口 ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-demo]');
  if (!b) return;
  e.preventDefault();
  toast(b.dataset.demo);
});

/* ---------- 弹窗 ---------- */
function openDialog(id) {
  const el = document.getElementById(id || 'confirm');
  if (el) el.classList.add('show');
}
function closeDialog(id) {
  const el = document.getElementById(id || 'confirm');
  if (el) el.classList.remove('show');
}
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('overlay')) e.target.classList.remove('show');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.overlay.show');
  if (open) open.classList.remove('show');
});

/* ---------- 复制到剪贴板（原型里给"复制路径"用） ---------- */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('已复制：' + text),
      () => toast('复制失败（原型环境可能不允许）')
    );
  } else {
    toast('已复制：' + text);
  }
}

/* ---------- 通用：把 <a> 之外的导航点击也变成提示 ---------- */
window.toast = toast;
window.openDialog = openDialog;
window.closeDialog = closeDialog;
window.copyText = copyText;

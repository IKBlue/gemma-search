// app/renderer/renderer.js —— 界面逻辑（沙箱渲染进程，只能通过 window.api 访问能力）
//
// 两条硬规矩（SPEC-security §6 不变量）：
//   1) 引擎返回的**任何字符串**都按纯文本渲染 —— 素材文件名来自互联网，
//      含 < > & 完全可能。所以这里 **不用 innerHTML 拼用户/引擎数据**，
//      一律 textContent / createElement。
//   2) 路径只出现在"详情"里，不主动外发。
'use strict';

const $ = (id) => document.getElementById(id);
const state = { mode: 'text', queryImagePath: null, busy: false, lastCount: 0 };

// ---------------------------------------------------------------- 工具
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = String(msg);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** 纯文本建元素（**不用 innerHTML**） */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

const bandLabel = { high: '高', mid: '中', low: '低' };

function folderBadgeClass(folder) {
  if (folder === 'VR') return 'badge VR';
  if (folder === 'CR') return 'badge CR';
  if (folder === 'CR+VR') return 'badge CRVR';
  return 'badge';
}

// ---------------------------------------------------------------- 启动信息
async function refreshStatus() {
  const r = await window.api.invoke('indexStatus', {});
  if (!r.ok) {
    $('lib-info').textContent = '不可用';
    $('index-info').textContent = (r.error && r.error.userMessage) || '读取失败';
    return;
  }
  const libs = r.data.libs || [];
  if (!libs.length) {
    $('lib-info').textContent = '未配置（config.json 的 library_root）';
    $('index-info').textContent = '—';
    return;
  }
  const l = libs[0];
  const info = $('lib-info');
  info.textContent = '';
  info.append(el('div', null, l.label || l.libId));
  info.append(el('div', 'sub', l.root));
  const idx = $('index-info');
  idx.textContent = '';
  idx.append(el('div', null, `${l.encoded} / ${l.indexed} 条已编码`));
  idx.append(el('div', 'sub', l.healthy ? '健康' : `问题：${(l.problems[0] && l.problems[0].code) || '未知'}`));
  idx.append(el('div', 'sub', `dim ${l.dim} · 失败 ${l.failed}`));
}

// ---------------------------------------------------------------- 重建结果
function renderResults(results, tookMs, mode) {
  const box = $('results');
  box.textContent = '';
  box.hidden = false;
  $('hint').hidden = true;

  if (!results.length) {
    const e = el('div', 'empty');
    e.append(el('div', null, '没有匹配的素材。'));
    e.append(el('div', null, '可以换个说法，或检查侧栏的分类筛选是否把结果排除了。'));
    box.append(e);
    return;
  }

  for (const r of results) {
    const card = el('div', 'card');

    const thumb = el('div', 'thumb');
    const img = document.createElement('img');
    img.alt = '';                                   // 装饰性
    img.loading = 'lazy';
    img.src = `thumb://${encodeURIComponent(r.libId)}/${r.uid}@256`;
    img.addEventListener('error', () => {
      img.remove();
      thumb.append(el('div', 'fallback', '无预览'));
    });
    thumb.append(img);
    const b = el('span', folderBadgeClass(r.folder), r.folder || '—');
    thumb.append(b);
    thumb.append(el('span', 'score', Number(r.score).toFixed(3)));
    card.append(thumb);

    const body = el('div', 'card-body');
    body.append(el('div', 'name', r.stem || r.relPath));
    const sub = el('div', 'sub', r.relPath);
    body.append(sub);
    body.append(el('div', 'sub',
      `相关度 ${bandLabel[r.band] || r.band}${r.archive ? ' · 有包 ' + r.archive.ext : ' · 无包'}`));

    const acts = el('div', 'acts');
    const mkBtn = (label, fn, disabled) => {
      const btn = el('button', null, label);
      if (disabled) btn.disabled = true;
      else btn.addEventListener('click', fn);
      acts.append(btn);
      return btn;
    };
    mkBtn('定位', async () => {
      const rr = await window.api.invoke('reveal', { libId: r.libId, uid: r.uid, target: r.archive ? 'archive' : 'image' });
      toast(rr.ok ? '已在资源管理器中定位' : (rr.error.userMessage || '定位失败'));
    }, !(r.archive || r.relPath));
    mkBtn('取件', async () => {
      const rr = await window.api.invoke('collect', { libId: r.libId, uids: [r.uid] });
      if (rr.ok) {
        const n = rr.data.succeeded.length;
        const sk = rr.data.skipped.length;
        toast(`取件：成功 ${n} · 跳过 ${sk} · 失败 ${rr.data.failed.length} → ${rr.data.targetDir}`);
      } else {
        toast(rr.error.userMessage || '取件失败');
      }
    });
    body.append(acts);
    card.append(body);
    box.append(card);
  }
}

// ---------------------------------------------------------------- 搜索
async function doSearch() {
  if (state.busy) return;
  const mode = state.mode;
  const folders = [...document.querySelectorAll('.chk input:checked')].map((i) => i.dataset.folder);

  const params = { mode, topK: 60, filters: { folders } };
  if (mode === 'text') {
    const text = $('q').value.trim();
    if (!text) { toast('请输入要查找的内容'); $('q').focus(); return; }
    params.text = text;
  } else {
    if (!state.queryImagePath) { toast('请先选择一张参考图'); return; }
    params.queryImagePath = state.queryImagePath;
  }

  state.busy = true;
  $('go').disabled = true;
  $('meta').textContent = '检索中…（首次会载入模型，约 3 秒）';
  try {
    const r = await window.api.invoke('search', params);
    if (!r.ok) {
      $('meta').textContent = '';
      const e = el('div', 'empty');
      e.append(el('div', null, r.error.userMessage || '检索失败'));
      e.append(el('div', 'sub', r.error.code));
      const box = $('results');
      box.textContent = ''; box.hidden = false; $('hint').hidden = true;
      box.append(e);
      return;
    }
    state.lastCount = r.data.results.length;
    $('meta').textContent = `${r.data.results.length} 条 · ${r.data.tookMs} ms`;
    renderResults(r.data.results, r.data.tookMs, mode);
    const skipped = r.data.libsSkipped || [];
    if (skipped.length) toast(`有 ${skipped.length} 个库被跳过：${skipped[0].reason.userMessage}`);
  } finally {
    state.busy = false;
    $('go').disabled = false;
  }
}

// ---------------------------------------------------------------- 事件绑定
function bind() {
  $('go').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  for (const btn of document.querySelectorAll('#mode-seg button')) {
    btn.addEventListener('click', () => {
      for (const o of document.querySelectorAll('#mode-seg button')) o.classList.remove('on');
      btn.classList.add('on');
      state.mode = btn.dataset.mode;
      $('pick-image').classList.toggle('hidden', state.mode !== 'image');
      $('q').placeholder = state.mode === 'text'
        ? '用一句中文描述你要找的素材，例如：中古风木质吸顶灯'
        : '已选参考图后点搜索；也可直接在框里输入文字切换为文字检索';
    });
  }

  // 选参考图：沙箱渲染进程拿不到 dialog，走主进程能力没有暴露，
  // 这里先用 `<input type=file>`（浏览器能力）取到路径 —— 仅开发期便利，
  // P2 会改为主进程 dialog 并把"库外图"纳入安全规格的既有例外。
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.jpg,.jpeg,.png,.webp,.bmp';
  fileInput.style.display = 'none';
  document.body.append(fileInput);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    // Electron 里 File 对象带真实路径（非标准但可用）
    state.queryImagePath = f.path || null;
    toast(state.queryImagePath ? '已选：' + f.name : '无法取得真实路径');
  });
  $('pick-image').addEventListener('click', () => fileInput.click());

  window.api.onEvent((evt) => {
    if (!evt || !evt.type) return;
    if (evt.type === 'encoder.ready') {
      $('engine-state').textContent = `模型就绪 · ${evt.device} · ${(evt.loadMs / 1000).toFixed(1)}s`;
    } else if (evt.type === 'encoder.failed') {
      $('engine-state').textContent = `模型载入失败：${evt.message}`;
    } else if (evt.type === 'index.progress') {
      $('engine-state').textContent = `索引中 ${evt.done}/${evt.total}`;
    } else if (evt.type === 'recovery.report') {
      toast(`上次操作未收尾：${(evt.needsAttention || []).length} 项待处理`);
    }
  });
}

// ---------------------------------------------------------------- 启动
(async function boot() {
  bind();
  await refreshStatus();
  $('q').focus();
  $('engine-state').textContent = '引擎就绪 · 模型按需载入';
})();

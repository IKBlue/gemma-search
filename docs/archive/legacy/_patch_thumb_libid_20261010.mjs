// _stageI/patch-thumb-libid.mjs —— 修 thumb:// 的库 id 大小写（一次性，命中数校验）
//
// 根因（实测日志）：URL 规范规定 **host 一律小写**，`thumb://L1/<uid>@256` 到处理器手里
// 变成 host=`l1`；而引擎的 libId 是大小写敏感的 `L1` → `absPathFor('l1', uid)` 抛
// LIB_NOT_FOUND → 404 → 界面全部"无预览"。
//
// 修法：在协议层按引擎注册表把 host 还原成注册时的写法（带小写映射缓存）。
// 修在这里而不是改引擎：URL 是唯一会丢大小写的那一环，引擎的严格 id 语义不该被放宽。
import fs from 'node:fs';

const TARGET = 'src/main/index.mjs';
let src = fs.readFileSync(TARGET, 'utf8');

const edits = [
  {
    label: '插入 canonicalLibId 助手',
    find: 'async function handleThumb(request) {',
    repl: `/** host（URL 规范会小写）→ 引擎注册时的 libId 写法；带缓存，避免每个缩略图都查一次 */
const LIB_ID_CANON = new Map();
async function canonicalLibId(host) {
  if (!engine) return '';
  if (LIB_ID_CANON.size === 0) {
    const st = await engine.indexStatus({});
    for (const l of ((st && st.ok && st.data && st.data.libs) || [])) {
      LIB_ID_CANON.set(String(l.libId).toLowerCase(), l.libId);
    }
    log('thumb 库 id 映射', JSON.stringify([...LIB_ID_CANON.entries()]));
  }
  return LIB_ID_CANON.get(String(host).toLowerCase()) || '';
}

async function handleThumb(request) {`,
  },
  {
    label: 'host → 还原大小写',
    find: `  const libId = decodeURIComponent(url.host || '');
  const m = /^\\/([0-9a-f]{12})@(\\d+)$/.exec(url.pathname || '');
  if (!libId || !m) return new Response('bad shape', { status: 400 });`,
    repl: `  // ⚠️ URL 的 host **一律小写**（URL 规范如此），而引擎的 libId 是大小写敏感的（\`L1\`）——
  // 实测 \`thumb://L1/...\` 到这里会变成 \`l1\`，引擎回 LIB_NOT_FOUND，界面全是"无预览"。
  const rawHost = decodeURIComponent(url.host || '');
  const libId = rawHost ? await canonicalLibId(rawHost) : '';
  const m = /^\\/([0-9a-f]{12})@(\\d+)$/.exec(url.pathname || '');
  if (!libId || !m) {
    log('thumb 拒绝：库 id 无法还原或形状不对', rawHost, url.pathname);
    return new Response('bad shape', { status: 400 });
  }`,
  },
];

for (const e of edits) {
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error(`命中 ${n} 次（应为 1）：${e.label}`);
    process.exit(1);
  }
  src = src.replace(e.find, e.repl);
  console.log(`  [OK  ] ${e.label}`);
}

fs.writeFileSync(TARGET, src, 'utf8');
console.log('已修 thumb 库 id 大小写：', TARGET);

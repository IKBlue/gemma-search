// _stageH/patch-thumb-log.mjs —— 给 thumb:// 处理器补日志（一次性，命中数校验）
//
// 为什么：缩略图失败在界面上只表现为"无预览"，日志里**一行都没有**——
// 没人能判断是"请求没到处理器"还是"取路径/解码失败"。补三类日志：
//   ① 请求到达（含 libId/uid/size）  ② 各失败分支的原因  ③ 成功的字节数
import fs from 'node:fs';

const TARGET = 'src/main/index.mjs';
let src = fs.readFileSync(TARGET, 'utf8');

const edits = [
  {
    label: '① 请求到达',
    find: '  const size = Number(m[2]);\n  if (!ALLOWED_SIZE.has(size)) return new Response(\'bad size\', { status: 400 });',
    repl: '  const size = Number(m[2]);\n' +
      "  log('thumb 请求', libId, uid, size);\n" +
      "  if (!ALLOWED_SIZE.has(size)) { log('thumb 拒绝：尺寸不合法', size); return new Response('bad size', { status: 400 }); }",
  },
  {
    label: '② 缓存命中',
    find: "      return new Response(fs.readFileSync(cachePath), { headers: { 'content-type': 'image/jpeg' } });",
    repl: "      const hit = fs.readFileSync(cachePath);\n" +
      "      log('thumb 缓存命中', libId, uid, size, hit.length);\n" +
      "      return new Response(hit, { headers: { 'content-type': 'image/jpeg' } });",
  },
  {
    label: '③ 解码失败 / 取路径失败',
    find: "    return new Response('not found', { status: e.code === 'SYMLINK_REJECTED' ? 403 : 404 });",
    repl: "    log('thumb 取路径失败', libId, uid, e.code || e.message);\n" +
      "    return new Response('not found', { status: e.code === 'SYMLINK_REJECTED' ? 403 : 404 });",
  },
  {
    label: '④ 成功返回',
    find: "  return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' } });",
    repl: "  log('thumb 生成成功', libId, uid, size, `${width}x${height}→${out.getSize().width}x${out.getSize().height}`, jpg.length);\n" +
      "  return new Response(jpg, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' } });",
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

// empty 分支也加一条（原文里没有 return 之外的信息）
const emptyFind = "  if (img.isEmpty()) return new Response('decode failed', { status: 415 });";
if (src.split(emptyFind).length !== 2) {
  console.error('命中数不为 1：⑤ 解码失败分支');
  process.exit(1);
}
src = src.replace(emptyFind, "  if (img.isEmpty()) { log('thumb 解码失败', src); return new Response('decode failed', { status: 415 }); }");
console.log('  [OK  ] ⑤ 解码失败分支');

fs.writeFileSync(TARGET, src, 'utf8');
console.log('已补日志：', TARGET);

// _stageG/patch-styles-guard.mjs —— 修新守卫的两个误报源（一次性，命中数校验）
//
// ① 悬空变量误报：renderer.css 的**注释**里写了 `var(--space-*)` 这类说明，
//    被正则当成真实引用（`--space-` 当然查不到定义）。
// ② 裸 px 误报：注释里提到"35px 图标按钮"也被统计。
// 处置：扫之前先剥掉 CSS/JS 注释；变量正则也收紧为「后面必须跟 ) 或 ,」。
import fs from 'node:fs';

const TARGET = 'tools/verify_renderer_styles.mjs';
let src = fs.readFileSync(TARGET, 'utf8');
const edits = [
  {
    label: '插入 stripComments',
    find: "const rel = (p) => path.relative(ROOT, p);",
    repl: "const rel = (p) => path.relative(ROOT, p);\n\n" +
      "/** 扫之前先剥掉注释：注释里会写「不要用 #fff」「只用 var(--space-*)」这类示例，别当成违规 */\n" +
      "const stripComments = (s) => s\n" +
      "  .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')\n" +
      "  .replace(/(^|[^:])\\/\\/.*$/gm, '$1');",
  },
  {
    label: '① 颜色检查用去注释文本',
    find: "  const lines = fs.readFileSync(f, 'utf8').split(/\\r?\\n/);\n  const hits = lines",
    repl: "  const lines = stripComments(fs.readFileSync(f, 'utf8')).split(/\\r?\\n/);\n  const hits = lines",
  },
  {
    label: '③ 变量检查用去注释文本 + 收紧正则',
    find: "  for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\\((--[a-z0-9-]+)/g)) {",
    repl: "  for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/var\\((--[a-z0-9-]+)\\s*[),]/g)) {",
  },
  {
    label: '④ 裸 px 报告用去注释文本',
    find: "  fs.readFileSync(f, 'utf8').split(/\\r?\\n/).forEach((line, i) => {",
    repl: "  stripComments(fs.readFileSync(f, 'utf8')).split(/\\r?\\n/).forEach((line, i) => {",
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
console.log('已修守卫：', TARGET);

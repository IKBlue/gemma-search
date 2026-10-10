// _fix/patch-guard2.mjs —— 修守卫里一条**写错的断言**（一次性，带命中数校验）
//
// 原断言：/\b0\.931\b/ —— 卡片文本实际是 `VR0.931ID-...`，
// `R` 与 `0` 都是单词字符，之间没有 \b 边界，于是断言假失败（界面本身是对的）。
// 改成不带边界的 /0\.931/，并把"别乱加边界"的理由写在这里。
import fs from 'node:fs';

const TARGET = 'tools/verify_renderer_dom.mjs';
const find = "ok(/\\b0\\.931\\b/.test(firstCard?.textContent || ''), '分数被显示（保留 3 位）',";
const repl = "// 注意：**不要**给分数加 \\b 边界 —— 卡片里它紧跟在徽标文字后面（如 `VR0.931ID-...`），\n" +
  "// 两侧都是单词字符，\\b 根本不成立，会假失败。\n" +
  "ok(/0\\.931/.test(firstCard?.textContent || ''), '分数被显示（保留 3 位）',";

const src = fs.readFileSync(TARGET, 'utf8');
const hits = src.split(find).length - 1;
if (hits !== 1) {
  console.error(`命中数 ${hits}（应为 1），未修改`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已修正分数断言：', TARGET);

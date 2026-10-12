// _stageC/patch-guard-input.mjs —— 修守卫里的模拟输入（一次性，命中数校验）
//
// 症状：新守卫里用 `input.value = X` + dispatch('input')，React **不触发 onChange**。
// 原因：React 会给 input 打一层 value setter 用来维护 value-tracker；
//       直接赋值会让 tracker 与 DOM 值一致，React 便认为"没变化"，onChange 不触发。
// 正确做法（旧守卫就是这么写的，我这次漏了）：用**原型上的** value setter 写值，绕过 React 那层。
import fs from 'node:fs';

const TARGET = 'tools/verify_renderer_dom.mjs';
let src = fs.readFileSync(TARGET, 'utf8');

// 1) 插入 typeInto 辅助
const anchor = "const byText = (sel, text) =>\n  [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text);";
if (src.split(anchor).length !== 2) {
  console.error('找不到 byText 锚点，未修改');
  process.exit(1);
}
src = src.replace(anchor, anchor + `

/** 模拟输入：**必须**用原型 setter，否则 React 的 value-tracker 会吃掉这次变更 */
function typeInto(el, text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, text);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}`);

// 2) 把所有 "input.value = X; dispatch('input')" 换成 typeInto
const pattern = /input\.value = ('[^']*');\s*\n\s*input\.dispatchEvent\(new window\.Event\('input', \{ bubbles: true \}\)\);/g;
const hits = (src.match(pattern) || []).length;
if (hits === 0) {
  console.error('没有找到可替换的输入模拟，未修改');
  process.exit(1);
}
src = src.replace(pattern, (_m, lit) => `typeInto(input, ${lit});`);

fs.writeFileSync(TARGET, src, 'utf8');
console.log(`已修守卫：插入 typeInto，替换 ${hits} 处模拟输入`);

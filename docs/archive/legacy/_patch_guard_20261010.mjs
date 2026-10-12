// _fix/patch-guard.mjs —— 修 tools/verify_renderer_dom.mjs 的 Node 24 兼容问题（一次性，带命中数校验）
//
// 症状：`globalThis.navigator = window.navigator` 在 Node 24 抛
//   TypeError: Cannot set property navigator of #<Object> which has only a getter
// 修法：一律走 Object.defineProperty（可覆盖只读访问器，且语义更明确）。
import fs from 'node:fs';

const TARGET = process.argv[2] || 'tools/verify_renderer_dom.mjs';

const find = `globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);`;

const repl = `// Node 24 的 globalThis 上 navigator 是**只读访问器**：直接赋值会抛
// "Cannot set property navigator of #<Object> which has only a getter"。
// 统一用 defineProperty —— 既能覆盖只读访问器，也把"我们确实要替换它"写明白。
const defineGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

defineGlobal('window', window);
defineGlobal('document', window.document);
defineGlobal('navigator', window.navigator);
defineGlobal('HTMLElement', window.HTMLElement);
defineGlobal('Element', window.Element);
defineGlobal('Node', window.Node);
defineGlobal('Event', window.Event);
defineGlobal('KeyboardEvent', window.KeyboardEvent);
defineGlobal('MouseEvent', window.MouseEvent);
defineGlobal('getComputedStyle', window.getComputedStyle.bind(window));`;

const src = fs.readFileSync(TARGET, 'utf8');
if (src.split(find).length !== 2) {
  console.error(`命中数不为 1（${src.split(find).length - 1}），未修改：${TARGET}`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(find, repl), 'utf8');
console.log('已修正 navigator 只读问题：', TARGET);

// _stageD/patch-guard-tick.mjs —— 守卫时序修正（一次性，命中数校验）
//
// 现象：先点"改状态"的控件（分类 chip / 以图搜图），紧接着点搜索，
//       search 用的是**上一轮**的参数（分类仍是四个、mode 仍是 text）。
// 原因：这两处点击之间没有让 React 提交；jsdom 里没有真实的两帧间隔。
// 处置：在改状态的点击之后 await 一个 tick —— 这是测试写法问题，不是界面 bug
//      （真实用户不可能在同一微任务里连点两次）。
import fs from 'node:fs';

const TARGET = 'tools/verify_renderer_dom.mjs';
let src = fs.readFileSync(TARGET, 'utf8');
let hits = 0;

const pairs = [
  ['calls.length = 0;\nclick(vrChip);\nclick(searchBtn);',
   'calls.length = 0;\nclick(vrChip);\nawait tick(40);            // 等 React 提交分类状态\nclick(searchBtn);'],
  ['if (pickBtn) click(pickBtn);\nclick(searchBtn);',
   'if (pickBtn) click(pickBtn);\nawait tick(40);            // 等 React 提交查询方式\nclick(searchBtn);'],
];

for (const [find, repl] of pairs) {
  const n = src.split(find).length - 1;
  if (n !== 1) {
    console.error(`命中数 ${n}（应为 1），未修改：${JSON.stringify(find.slice(0, 40))}`);
    process.exit(1);
  }
  src = src.replace(find, repl);
  hits += 1;
}

fs.writeFileSync(TARGET, src, 'utf8');
console.log(`已修守卫时序：${hits} 处`);

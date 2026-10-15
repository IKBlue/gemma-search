// apps/desktop/tests/source-scan.test.mjs —— 扫描器**自检**
//
// 为什么必须单独测它：`layering.test.mjs` 的全部结论都建立在"扫描器能正确区分代码与注释"之上。
// 如果扫描器坏了（例如把注释也算进去，或反过来把真的代码漏掉），分层检查会**静默通过** ——
// 那正是本仓库反复栽的坑（"断言看起来对，其实没测"）。
//
// 所以这里用的是**当年真栽过的用例**，不是编的：
//   · `TODO.md` C-12 记录：`verify_app_build` §1b 的剥注释器**不认识正则字面量**，
//     含引号的正则（`/["']/g`）会让朴素实现误入字符串模式 ⇒ 被注释掉的接线重新可匹配。
//   · 同一份记录里的另一半：**注释掉一行正是禁用接线的常见手法** ⇒ 注释里的不能算。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  maskNonCode,
  maskComments,
  findInCode,
  findOutsideComments,
} from './helpers/source-scan.mjs';

const count = (src) => findInCode(src, /window\.api/g).length;

test('S1：注释里的 `window.api` **不算**（行注释 / 块注释 / 多行块注释）', () => {
  assert.equal(count('// 渲染层只有 window.api\nconst a = 1;'), 0);
  assert.equal(count('/* window.api */ const a = 1;'), 0);
  assert.equal(count('/*\n window.api\n*/\nconst a = 1;'), 0);
});

test('S2：⭐ 被**注释掉**的接线不算（反向陷阱：注释掉一行是禁用接线的常见手法）', () => {
  assert.equal(count('// window.api.invoke(1)\nconst a = 1;'), 0);
  assert.equal(count('/* window.api.invoke(1) */'), 0);
});

test('S3：字符串 / 模板字面量里的不算；但**模板插值里的算**', () => {
  assert.equal(count("const s = 'window.api';"), 0);
  assert.equal(count('const s = "window.api";'), 0);
  assert.equal(count('const s = `window.api`;'), 0);
  assert.equal(count('const s = `${window.api.platform}`;'), 1, '插值里是**真代码**，必须算');
});

test('S4：⭐ 含引号的正则字面量之后仍能正确识别（当年栽过的那条）', () => {
  assert.equal(count('const re = /["\']/g; window.api.invoke(1);'), 1);
  assert.equal(count('const re = /[\\/]/g; window.api.x();'), 1);
});

test('S5：除法不被误判成正则起始', () => {
  assert.equal(count('const a = b / c; window.api.x();'), 1);
});

test('S6：行号准确（多行块注释不能把行号带偏）', () => {
  const hits = findInCode('/*\n window.api\n*/\nconst z = window.api.invoke();', /window\.api/g);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 4);
});

test('S7：maskNonCode 与原串**等长同结构**（否则行号与列号会全错）', () => {
  for (const src of [
    'const s = "abc"; // x\nconst t = 1;',
    '/* a\nb */\nconst x = `t${1}y`;',
    'const re = /["\']/g;\nconst y = 2;',
  ]) {
    const m = maskNonCode(src);
    assert.equal(m.length, src.length, '长度必须一致');
    assert.equal(m.split('\n').length, src.split('\n').length, '行数必须一致');
  }
});

test('S8：真正的代码**必须**被找到（否则检查会静默通过 —— 这是最危险的方向）', () => {
  assert.equal(count('const r = await window.api.invoke("x");'), 1);
  assert.equal(count('window.api.onEvent(cb)'), 1);
  assert.equal(count('const a = 1; const b = 2;'), 0);
});

// ============================================================ maskComments（只抹注释）
//
// 为什么需要第二个掩码：**色值 / 类名这类违例真实就写在字符串里**
// （`style={{ color: '#0071e3' }}`、`className="btn"`、Tailwind 任意值 `bg-[#0071e3]`）。
// 用 `maskNonCode` 查它们会**永远查不到** —— 2026-10-13 双向验证实测到这一步，差点交出一条空断言。

const colors = (src) => [...maskComments(src).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].length;

test('S9：⭐ 字符串里的色值 maskComments **能找到**、而 maskNonCode **找不到**', () => {
  const src = "const s = { color: '#ff0000' }\n";
  assert.equal(colors(src), 1, 'maskComments 必须能看见字符串里的色值');
  // 反向：maskNonCode 看不见 —— 这正是它不能用于查色值的原因（记在这里防回退）
  assert.equal([...maskNonCode(src).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length, 0);
});

test('S10：maskComments 仍然正确跳过注释（两类注释都要）', () => {
  assert.equal(colors('// #ff0000\nconst a = 1'), 0);
  assert.equal(colors('/* #ff0000 */ const a = 1'), 0);
  assert.equal(colors('/*\n #ff0000\n*/'), 0);
});

test('S11：maskComments 不会把字符串里的 `//` 当成行注释（URL 用例）', () => {
  // 若把 'http://x' 当注释，后面那行代码会被整段吃掉 ⇒ 漏报
  const src = "const u = 'http://localhost/x'\nconst c = '#00ff00'\n";
  assert.equal(colors(src), 1, "'http://' 不该让后面的色值消失");
});

test('S12：maskComments 与原串**等长同结构**（行号才不会错）', () => {
  for (const src of [
    'const s = "abc"; // x\n',
    '/* a\nb */\nconst x = `t${1}y`;',
    "const a = '#fff';\nconst b = 2;",
  ]) {
    const m = maskComments(src);
    assert.equal(m.length, src.length);
    assert.equal(m.split('\n').length, src.split('\n').length);
  }
});

// ============================================================ 模板插值（2026-10-13 修的真缺陷）
//
// ⚠️⚠️ **这四条是给一个"假阴 + 假阳双向"的真缺陷立的碑，别删。**
//   旧版 `scan()` 处理完模板串的 `${...}` 之后 `continue` 回了**主循环**，从没回到模板串。
//   后果：模板的**收尾反引号被当成新模板的起始反引号**，一路吞到下一个反引号（甚至文件尾）⇒
//     · **假阴**：`SearchPage.jsx:55+`、`TasksPage.jsx:76+` 等区域被整段抹成空格，
//       基于本扫描器的 L1–L7 / T1–T6 断言在那些地方**恒为真**（剧场）；
//     · **假阳**：注释里的反引号内容会漏出来再匹配一次（L6 曾被自己的注释绊倒）。
//   修法：插值递归扫到配对的 `}` 就返回，然后**留在模板串里继续**（`scanCore`）。
//   判据是"**模板之后的东西还看得见**"—— 这条不成立，上面那些断言就都不算数。

test('S13 ⭐⭐ maskNonCode：模板插值**之后**的代码仍被识别（旧版从此整段失明）', () => {
  // ⚠️⚠️ 这条我写坏过一次，教训值得留：第一版用 `colors()`（= `maskComments`）断言，
  //    而 `maskComments` **保留字符串内容** —— 失步的表现恰好是"后面被当成字符串"，
  //    于是在那个视图下**完全看不见**，注入旧缺陷后照样通过。
  //    ⇒ 必须断在 `maskNonCode`（= `maskStrings:true`）上：它抹非代码文本，
  //      代码骨架还在不在，一眼可判。L1–L7 / L6 用的也正是它。
  const src = 'const s = `a${x}b`\nconst c = "#ff0000"\n';
  const m = maskNonCode(src);
  assert.match(m, /const c =/, '模板之后的**代码骨架**必须保留 —— 丢了就说明扫描器失步了');
  assert.match(m, /\$\{x\}/, '插值里的代码要保留（它是代码，不是字符串内容）');
  assert.equal(m.includes('#ff0000'), false, '第二行的色值在字符串里，该被抹掉');

  // 真实形态：两个插值 + 插值里有除法（SearchPage 原样）
  const real =
    'show(`模型就绪 · ${evt.device} · ${(evt.loadMs / 1000).toFixed(1)}s`)\nconst after = 3\n';
  const rm = maskNonCode(real);
  assert.match(rm, /const after = 3/, '两个插值 + 除法之后也要看得见代码');
  assert.match(rm, /evt\.device/, '插值里的标识符要保留');
});

test('S14 ⭐⭐ maskNonCode：注释里的**反引号**不得漏出来（旧版会漏 ⇒ 假阳性）', () => {
  const src = '// 说明 `#ff0000` 是危险写法\nconst a = 1\n';
  assert.equal(
    findInCode(src, /#ff0000/g).length,
    0,
    'maskNonCode 不该把注释里的内容漏出来 —— 那会让"解释规则的注释"自己踩中规则',
  );
  assert.match(maskNonCode(src), /const a = 1/, '注释之后仍是代码，不能被吞');

  // 同一行里既有注释又有真违例：只该报真的那个
  const mixed = "const a = '#ff0000' // `#00ff00` 只是说明\n";
  assert.equal(findOutsideComments(mixed, /#ff0000/g).length, 1, '真违例要报');
  assert.equal(findOutsideComments(mixed, /#00ff00/g).length, 0, '注释里的不报');

  // ⚠️ 上面那两条**在旧缺陷下也通过**（输入里没有模板 ⇒ 触不到失步）。
  //    要真正钉住"注释里的内容漏出来"这条路径，前面必须有一个带插值的模板 ——
  //    旧版在那里失步，之后的一切（含这行注释）都被当成模板串的延续。
  const withTemplate = 'const s = `a${x}b`\n// 说明 `#ff0000` 是危险写法\nconst a = 1\n';
  assert.equal(
    findInCode(withTemplate, /#ff0000/g).length,
    0,
    '模板之后那行注释里的内容同样不许漏出来',
  );
  assert.match(maskNonCode(withTemplate), /const a = 1/, '模板+注释之后的代码仍要可见');
});

test('S15 插值里的**字符串**按 maskStrings 走：maskNonCode 抹、maskComments 保留', () => {
  const src = 'const s = `x${fn("SECRET")}y`\n';
  assert.equal(maskNonCode(src).includes('SECRET'), false, 'maskNonCode 连字符串内容一起抹');
  assert.equal(maskComments(src).includes('SECRET'), true, 'maskComments 保留字符串内容');
  // 插值里的**代码**两边都要保留（否则"有没有调用 fn"会漏报）
  assert.match(maskNonCode(src), /fn\s*\(/);
  assert.match(maskComments(src), /fn\s*\(/);
});

test('S16 插值里含嵌套花括号/字符串/切片时，配平仍然正确', () => {
  // `${ {k: "}"} }` —— 朴素括号计数会在字符串里的 `"}"` 上错位
  const src = 'const s = `a${ {k: "}"} }b`\nconst c = 1\n';
  assert.match(
    maskNonCode(src),
    /const c = 1/,
    '插值里的 "}" 不该提前结束插值，后面的代码仍要可见',
  );
  assert.match(maskNonCode(src), /k:/, '插值里的对象字面量是代码，要保留');

  // 模板里再套模板。⚠️ 内层模板的**文本**（这里的 b/d）本来就该被抹 —— 那是字符串内容；
  //    要保留的是它里面的**插值**。第一版我断言 `b` 还在，那是错的。
  const nested = 'const s = `a${`b${c}d`}e`\nconst d = 1\n';
  assert.match(maskNonCode(nested), /const d = 1/, '嵌套模板之后仍要看得见代码');
  assert.match(maskNonCode(nested), /\$\{\s*c\s*\}/, '内层模板的**插值**按代码保留');

  // 插值里带箭头函数与索引（真实模板串里常见）
  const fn = 'const s = `x${arr[i].map((v) => v + 1)}y`\nconst e = 1\n';
  assert.match(maskNonCode(fn), /const e = 1/, '复杂插值之后也要看得见代码');
  assert.match(maskNonCode(fn), /arr\[i\]\.map/, '插值里的成员访问要保留');
});

test('S16b 未闭合的模板不会把文件"吞掉"到越界（健壮性）', () => {
  const src = 'const s = `没闭合\nconst c = "#ff0000"\n';
  const m = maskNonCode(src);
  assert.equal(m.length, src.length, '等长不变，行号才准');
  assert.equal(m.split('\n').length, src.split('\n').length);
});

// _stageF1/patch-tokens.mjs —— 给令牌表补字号/布局/控件变量（一次性，命中数校验）
//
// 依据 docs/design/DESIGN-tokens.md：
//   §3.2 字号阶梯、§4.2 布局、§7 控件尺寸 —— 文档里有成文数值，但 §10 的变量表里没有对应变量。
//   §12 明确：「新增值之前先找最近的现有令牌，找不到再加，并标注来源」。
// 所以在这里补成变量（**单一来源**仍是 tokens.css），由渲染层消费；
// 原型 style.css 里那些裸 px 不动（它是原型自己的历史产物），接入时按 §4.1 就近取整。
import fs from 'node:fs';

const TARGET = 'static/prototype/tokens.css';
const anchor = `  /* ---------- 3) 旧变量桥接 ----------`;
const block = `  /* ---------- 2.5) 字号 / 布局 / 控件（**本项目新增**，来源：DESIGN-tokens §3.2 · §4.2 · §7） ----------
     §10 的变量表只给了颜色/字体族/间距/圆角/阴影；字号阶梯、布局尺寸、控件尺寸在文档里
     有成文数值却没有变量。按 §12「找不到再加，并标注来源」补成变量，供渲染层使用。
     阶梯外的原型值（22px 边距、35px 图标按钮、23px 指标值…）按 §4.1「就近取整」处理，
     取整结果写在括号里。 */
  --type-h1: 27px;                    /* 应用主标题（文档阶梯无此档，取自原型并登记） */
  --type-title2: 24px;                /* §3.2 title2 */
  --type-title2-lh: 1.25;
  --type-title2-ls: -0.01em;
  --type-metric: 23px;                /* 指标卡数值（取自原型；文档阶梯无此档） */
  --type-lede: 19px;                  /* §3.2 lede */
  --type-lede-lh: 1.4;
  --type-body-app: 16px;              /* §3.2 body.app（搜索框输入） */
  --type-body-app-lh: 1.5;
  --type-callout: 14px;               /* §3.2 callout（导航项、卡片包名） */
  --type-callout-lh: 1.4;
  --type-caption: 13px;               /* §3.2 caption（元信息、胶囊、小按钮） */
  --type-caption-lh: 1.4;
  --type-micro: 11px;                 /* 指标卡注释 / 侧栏小字（文档阶梯最小 13px，按 §12 登记） */

  --layout-sidebar-width: 220px;      /* §4.2 layout.sidebar.width（原型 230px → 取文档值） */
  --layout-grid-min-card: 240px;      /* §4.2 layout.grid.min-card */
  --layout-page-padding: 24px;        /* §4.2 是 22px → §4.1 就近取整到 24 */
  --layout-content-max: 1500px;       /* 应用是整窗，取原型的内容上限 */
  --layout-topbar-height: 68px;       /* 原型 68px（§4.2 的 nav.height 48px 是网页吸顶导航） */

  --radius-circle: 50%;               /* §5 radius.circle */
  --control-icon-size: 18px;          /* §7 control.icon.size */
  --control-icon-btn: 36px;           /* 原型 35px → 就近取整 36 */
  --control-search-height: var(--touch-min);   /* §7 control.search.height = 44px */
  --control-segment-height: 38px;     /* §7 control.segment.height */
  --control-chip-padding: 8px 16px;   /* §7 是 9px 16px → §4.1 就近取整到 8px 16px */

`;

const src = fs.readFileSync(TARGET, 'utf8');
const n = src.split(anchor).length - 1;
if (n !== 1) {
  console.error(`锚点命中 ${n} 次（应为 1），未修改`);
  process.exit(1);
}
fs.writeFileSync(TARGET, src.replace(anchor, block + anchor), 'utf8');
console.log('已补令牌：', TARGET);

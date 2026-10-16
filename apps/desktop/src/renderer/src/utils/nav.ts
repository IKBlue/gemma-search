// utils/nav.ts —— 侧栏导航的**配置与判据**（纯数据 + 纯函数，无 React、无 JSX）
//
// 为什么把这张表从 `SearchSidebar.tsx` 里搬出来（IA-1 · 2026-10-16）：
//   `.tsx` 在 `node:test` 里加载不了 ⇒ **「某个门控项存在且禁用、且写清了进入条件」这件事没法自动化**，
//   只能靠人在界面上看。搬成纯数据之后，它就能被单测钉住（IA1–IA4），
//   而组件那边只剩「把这份数据渲染出来」—— 与 `utils/browse.ts` / `utils/index-state.ts` 同一套路。
//
// 口径（Lead 2026-10-16 · IA-1）：
//   · **门控项 = 禁用 + 原因**。原因必须写清**进入条件**（与 `TASKS.md` 的 🔒 条目同一口径），
//     不许写「即将上线 / 敬请期待」这类**空承诺** —— 空承诺没有可判定的完成条件，
//     等于把「永远不做」伪装成「快好了」。
//   · `SPEC §4` 的信息架构里侧栏**含「文档」**，而界面此前连入口都没有 ⇒ 规格说有的东西不存在。
//     本文件把「文档」按门控项补上（**不是**改 SPEC：改规格 = 改需求，得先报 Lead）。
import type { UiNavItem } from '../ui/types.ts';

/**
 * 一条门控项：**没有 `to`**（不可达）且**必须**给出 `reason`（进入条件）。
 * `to` 与 `reason` **互斥** —— 由 `assertNavItems()` 在模块加载时机械保证。
 */
export type NavEntry = UiNavItem;

/**
 * 侧栏导航表（**唯一来源**）。`SearchSidebar` 只渲染它，不再自己写一份。
 * ⚠️ 已实现项给 `to`；未实现项给 `reason`，两者都不给 = 违规（`assertNavItems` 会抛）。
 */
export const NAV: readonly NavEntry[] = Object.freeze([
  Object.freeze({ key: 'search', icon: '⌕', label: '语义搜索', to: '/' }),
  // 「图片详情」不是顶层可达页面：它要 libId + uid（/item/:libId/:uid），只能从结果卡点进去
  Object.freeze({
    key: 'detail',
    icon: '▣',
    label: '图片详情',
    reason: 'P3c（从结果卡进入）',
  }),
  // 2026-10-15（P4-2）：「本地图库」= F2 浏览页（整库浏览 · 筛选 · 排序）**已实现** ⇒ 给它 to
  Object.freeze({ key: 'browse', icon: '▦', label: '浏览图库', to: '/browse' }),
  // S6（2026-10-15）：`ingest` 已从契约删除（它写的意图层表本轮没建）⇒ 保持门控（点了给说明、不静默）
  Object.freeze({
    key: 'ingest',
    icon: '＋',
    label: '入库与增量',
    reason: 'P4（等对应的数据表上线）',
  }),
  Object.freeze({ key: 'tasks', icon: '◴', label: '索引任务', to: '/tasks' }),
  Object.freeze({ key: 'records', icon: '↺', label: '操作记录', to: '/activity' }),
  // 2026-10-16（IA-1）：`SPEC §4` 的信息架构里侧栏**含「文档」**，而界面此前连入口都没有。
  //   它按**门控项**补上：进入条件抄 `TASKS.md` 的 🔒 条目（T-34/T-35 那条），**不写「即将上线」**。
  Object.freeze({
    key: 'docs',
    icon: '☰',
    label: '文档',
    reason: 'F7 门控：需先取得 10–30 份真实文档并确认格式分布（条件不满足就不开工）',
  }),
  // 2026-10-15（T-15b）：诊断页**真的可达**（体检 + 重建元数据）⇒ 给它 to；「设置」仍是门控项
  Object.freeze({ key: 'health', icon: '⚕', label: '诊断与重建', to: '/health' }),
  Object.freeze({ key: 'settings', icon: '⚙', label: '设置', reason: 'P3d' }),
]);

/** 一条项是不是**已实现**（有路由） */
export function isReachable(item: NavEntry): boolean {
  return typeof item.to === 'string' && item.to.length > 0;
}

/**
 * 门控项对用户/辅助技术的**可访问名**：`标签（原因）`。
 * 为什么带上原因：禁用项光看名字（「文档」）看不出**为什么**点不动，
 * 而 `title` 只有悬停才出现 ⇒ 可访问名里也带上，屏幕阅读器念得到。
 */
export function navAccessibleName(item: NavEntry): string {
  return isReachable(item) ? item.label : item.label + '（' + String(item.reason ?? '') + '）';
}

/**
 * 机械校验（模块加载即执行）：**要么可达、要么写清原因**，不许两头空。
 * 这条是 IA-1 的「不许静默」落到代码上：忘了写原因 ⇒ 应用**起不来**（而不是悄悄少一个说明）。
 */
export function assertNavItems(items: readonly NavEntry[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) throw new Error('侧栏导航项 key 重复：' + item.key);
    seen.add(item.key);
    if (isReachable(item)) continue;
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!reason) throw new Error('门控项必须写清进入条件（不许静默）：' + item.key);
  }
}

assertNavItems(NAV);

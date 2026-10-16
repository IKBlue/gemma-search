// apps/desktop/src/main/library-view.ts —— `libraryList` 的行形状与**纯**合并逻辑（U18）
//
// 为什么把这段从 index.ts 搬出来：index.ts import 了 electron ⇒ node:test 加载不了它，
// 而"已登记但路径不见了的库**必须仍然出现在列表里**（U18 的核心）正是最该被断言钉住的行为。
// 搬出来之后它可以被纯函数测试覆盖：给 {发现结果, 注册表意图, 可用性探测} ⇒ 得到行。
//
// ⚠️ 合并口径（沿用 S6 的裁定，本卡不改）：
//   · 注册表（app.db）是**用户意图**的权威（enabled / sort_order / display_name），
//     库根仍来自发现来源（env / 注册表 / config / 自举）；**缺行 = 默认启用**；
//   · 登记过但这次**没被任何来源发现**的库（盘拔了 / 被移走）**也要列出来** —— U18 之前它就是这样进来的，
//     只是**没有可用性字段**，界面因此看不出"它为什么没内容"；
//   · 排序：sort_order 升序，其次 libId 升序（确定性）。
//
// ⚠️ 本卡只**加显示**：不清理、不重建、不改注册表（`enabled` 与 `root` 一个字节都不动）。

import type { RootAvailability, RootAvailabilityCode } from './library-availability.ts';

/** 发现来源给的一条库（与 library-config 的 LibraryEntry 同形，只取这里要用的字段） */
export interface DiscoveredLibrary {
  libId: string;
  root: string;
  label: string;
  source: string;
  count?: number;
}

/** app.db `library_registry` 里的一行（用户意图） */
export interface RegistryIntentRow {
  libId: string;
  root: string;
  displayName: string;
  enabled: boolean;
  sortOrder: number;
}

/** 合并后的一行（**不含**可用性——可用性由 applyAvailability 贴上去） */
export interface LibraryRowBase {
  libId: string;
  root: string;
  label: string;
  source: string;
  enabled: boolean;
  sortOrder: number;
  itemCount: number | null;
  registered: boolean;
}

/** 对外的一行（U18 之后多了三个字段；`available` 恒有，另两个是 null 或非空） */
export interface LibraryView extends LibraryRowBase {
  available: boolean;
  unavailableCode: RootAvailabilityCode | null;
  unavailableReason: string | null;
}

export interface BuildLibraryRowsInput {
  discovered: readonly DiscoveredLibrary[];
  registry: readonly RegistryIntentRow[];
}

/**
 * 合并发现结果与注册表意图 ⇒ 行（**纯函数**）。
 * 注册表里没被发现的库会被追加进来（**这就是"拔了盘的库仍然可见"的实现处**）。
 */
export function buildLibraryRows(input: BuildLibraryRowsInput): LibraryRowBase[] {
  const byLibId = new Map<string, RegistryIntentRow>();
  for (const row of input.registry) byLibId.set(row.libId, row);

  const rows: LibraryRowBase[] = input.discovered.map((l) => {
    const row = byLibId.get(l.libId);
    return {
      libId: l.libId,
      root: l.root,
      label: row ? row.displayName : l.label,
      source: l.source,
      enabled: row ? row.enabled : true,
      sortOrder: row ? row.sortOrder : 0,
      itemCount: typeof l.count === 'number' ? l.count : null,
      registered: row !== undefined,
    };
  });

  // 登记过、但四条来源都没发现它（盘没挂 / 被移走）⇒ **也要列出来**：
  // 否则用户会以为「明明加过，怎么没了」。
  for (const row of input.registry) {
    if (rows.some((r) => r.libId === row.libId)) continue;
    rows.push({
      libId: row.libId,
      root: row.root,
      label: row.displayName,
      source: 'registry',
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      itemCount: null,
      registered: true,
    });
  }

  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.libId.localeCompare(b.libId));
  return rows;
}

/**
 * 贴上可用性。
 * ⚠️ `probes` 里**缺一行** ⇒ 按可用处理（契约口径：`available` 缺失时视为可用，向后兼容）；
 *    但本卡的调用方会**给每一行都探测**，所以线上不会走到这条兜底。
 */
export function applyAvailability(
  rows: readonly LibraryRowBase[],
  probes: ReadonlyMap<string, RootAvailability>,
): LibraryView[] {
  return rows.map((row) => {
    const a = probes.get(row.root);
    if (!a) {
      return { ...row, available: true, unavailableCode: null, unavailableReason: null };
    }
    return {
      ...row,
      available: a.available,
      unavailableCode: a.code,
      unavailableReason: a.available ? null : a.reason,
    };
  });
}

/** 列表里**不可用**的那些（界面要如实说「还有 N 个不可用」，不静默） */
export function unavailableLibraries(views: readonly LibraryView[]): LibraryView[] {
  return views.filter((v) => v.available === false);
}

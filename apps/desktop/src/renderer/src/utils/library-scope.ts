// utils/library-scope.ts —— **「范围」与「写落点」是两个变量**（U32 · Operation 层，纯函数）
//
// ── 为什么必须拆（TASKS.md U32 的裁定：「认同」）────────────────────────────
//   把两者混成一个变量，就会出现这句**含糊**：
//     「在『全部库』范围下点了收/重建，东西到底收到哪去了？」
//   而这**不是措辞问题，是写操作的可解释性问题**：读错了再读一次就行；
//   写错了会落到一个用户没指定的地方。⇒ 两个概念必须各有一个变量。
//
// ── 两个概念 ───────────────────────────────────────────────────────────────
//   · `ReadScope`  —— **看/查的范围**，**可以是「全部库」**（检索本来就是跨库的；
//                      浏览/体检这类"看一个库"的读操作只是把它收窄到一个库）。
//   · `WriteTarget` —— **写落点**，**必须是一个具体库**且该库**可用**。
//                      它**没有**「全部库」这个取值 —— 不存在"写到所有库"这种操作，
//                      所以这个取值根本不该被表示出来（不是靠运行时再拒绝）。
//
// ── 组合约束（本文件的**唯一**一条硬规则）──────────────────────────────────
//   **scope = 全部库 且 writeTarget 未定 ⇒ 写类操作不可执行，并明确提示选目标库。**
//   ⚠️ 关键是**不许拿「全部库」当落点** —— 不能在 `writeTarget ?? scope` 这种兜底里
//      把"全部"悄悄当成一个库。见 `decideWriteGate`：target 为 null 时一律 `allowed: false`，
//      与 scope 是不是 'all' **无关地**拒绝，只是**提示文案**按 scope 分别给。
//
// ── 为什么放在 utils（而不是 .tsx）────────────────────────────────────────
//   AGENTS §2：领域判断不许写进 `.tsx`（组件在 `node:test` 里加载不了）。
//   这里全是纯函数 ⇒ 「组合约束能红」是一条**可断言**的测试，而不是只能靠人点。
import type { LibraryConfigData, LibraryEntry } from '../hooks/useLibraryConfig.ts';

/** 看得见的库条目（只取本模块用到的字段；其余原样透出） */
function listEntries(data: LibraryConfigData | null | undefined): LibraryEntry[] {
  const raw = data && Array.isArray(data.libraries) ? data.libraries : [];
  return raw.filter((e): e is LibraryEntry => Boolean(e) && typeof e === 'object');
}

/** `available` 缺失按可用处理（契约口径：可选字段缺失 = 兼容旧载荷） */
function isUsable(e: LibraryEntry): boolean {
  return e.available !== false;
}

function libIdOf(e: LibraryEntry): string {
  return typeof e.libId === 'string' ? e.libId.trim() : '';
}

/**
 * 用户/主进程指定的那个库（`chosen` 可能是 libId，也可能是 root —— 与 libraryConfig 的语义一致）。
 * 只认`chosen`，**不猜**。
 */
function chosenEntry(data: LibraryConfigData | null | undefined): LibraryEntry | null {
  const chosen = data?.chosen;
  if (typeof chosen !== 'string' || !chosen) return null;
  return listEntries(data).find((e) => libIdOf(e) === chosen || e.root === chosen) ?? null;
}

/** 读范围：可以是「全部库」 */
export type ReadScope =
  | { kind: 'all' }
  | {
      kind: 'lib';
      libId: string;
      root: string;
      available: boolean;
      unavailableReason: string | null;
    };

/** 写落点：**只有具体库**（没有 'all' —— 该取值在类型上就不存在） */
export type WriteTarget = {
  libId: string;
  root: string;
  available: boolean;
  unavailableReason: string | null;
};

function toDetail(e: LibraryEntry) {
  return {
    libId: libIdOf(e),
    root: typeof e.root === 'string' ? e.root : '',
    available: isUsable(e),
    unavailableReason:
      typeof e.unavailableReason === 'string' && e.unavailableReason ? e.unavailableReason : null,
  };
}

/**
 * **读范围**（看/查用）。
 *
 * 规则（与原先 `resolveLibrary` 的**读**语义一致，别在这里发明第二条规则）：
 *   ① 有 `chosen` 且可用 ⇒ 它；② 否则第一个**可用**的；③ 都没有 ⇒ 退回 `chosen`/第一个；
 *   ④ 一个库都没有 ⇒ `{ kind: 'all' }`（没有可收窄的对象 —— 范围就是"全部库"，虽然后面也没有结果）。
 *
 * ⚠️ 这里**允许**"猜一个库"（比如多库时取第一个可用的）：读错一次再读一次就行，
 *    而且浏览页需要有个默认视野。**写落点不许这样猜** —— 见 `deriveWriteTarget`。
 */
export function deriveReadScope(data: LibraryConfigData | null | undefined): ReadScope {
  const list = listEntries(data);
  if (list.length === 0) return { kind: 'all' };
  const chosen = chosenEntry(data);
  const pick =
    (chosen && isUsable(chosen) ? chosen : null) ?? list.find(isUsable) ?? chosen ?? list[0];
  if (!pick) return { kind: 'all' };
  const detail = toDetail(pick);
  if (!detail.libId) return { kind: 'all' };
  return { kind: 'lib', ...detail };
}

/**
 * **写落点**（收件/重建这类会落盘的操作用）。`null` = **还没定，别写**。
 *
 * 规则比读**严**得多，因为写错无法"再写一次"抵掉：
 *   ① `chosen` **明确指了一个可用的库** ⇒ 它（用户指定过，不算猜）；
 *   ② `chosen` 指了、但那个库**不可用** ⇒ 一律 `null`。
 *      ⚠️ **不许**在此情形下"换一个能用的库顶上" —— 用户明确选过 A，你悄悄写到 B，
 *         正是本卡要消灭的那种含糊（单测 U32-e2 就是钉这条）；而且那个库不可用这件事本身
 *         要**如实告诉**用户（界面据 `reason` 显示），不是替他绕过。
 *   ③ 没指定 `chosen` 时：全库**只有一个可用**的 ⇒ 它（唯一解，不算猜）；
 *   ④ 其余一律 `null` —— 多库且没指定 ⇒ **不替用户挑**。
 */
export function deriveWriteTarget(data: LibraryConfigData | null | undefined): WriteTarget | null {
  const list = listEntries(data);
  const usable = list.filter(isUsable).filter((e) => libIdOf(e));
  if (usable.length === 0) return null;

  const chosen = chosenEntry(data);
  if (chosen) {
    // 指定过：只能在"指定的那个可用"时用它；不可用 ⇒ null（不换库顶上，见上面 ②）
    return isUsable(chosen) && libIdOf(chosen) ? toDetail(chosen) : null;
  }

  if (usable.length === 1) return toDetail(usable[0]);
  return null; // 多库且没指定 ⇒ 不猜（等用户在界面上选）
}

/** 写操作的闸门 */
export type WriteGate = {
  allowed: boolean;
  /** 不允许时给用户看的**人话原因**（allowed 时为 ''） */
  reason: string;
};

/**
 * **组合约束**：scope 与 target 一起决定"这个写操作能不能执行"。
 *
 * ⚠️ 注意这里的判据**只看 `target`** —— scope 是全部库**不会**让写操作变得"更允许"，
 *    也不会被当成落点。scope 只影响**提示文案**（告诉用户"你现在看的是全部库，所以得先选一个"）。
 *    ⇒ 所以「不许拿全部库当落点」在这条判据下是**结构上成立的**，不是靠一处特判。
 */
export function decideWriteGate(scope: ReadScope, target: WriteTarget | null): WriteGate {
  if (!target) {
    return {
      allowed: false,
      reason:
        scope.kind === 'all'
          ? '当前范围是「全部库」——写操作必须指定一个具体的目标库，请先在上方选择'
          : '还没有可用的目标库（先去首启向导添加一个素材库）',
    };
  }
  if (!target.available) {
    return {
      allowed: false,
      reason: `目标库 ${target.libId} 当前不可用：${target.unavailableReason || '库根不可访问'}`,
    };
  }
  return { allowed: true, reason: '' };
}

/** 范围的人话文案（界面上"范围"那一行显示它） */
export function describeScope(scope: ReadScope): string {
  if (scope.kind === 'all') return '全部库';
  const tail = scope.available ? '' : '（不可用）';
  return `${scope.libId}${tail}`;
}

/** 写落点的人话文案（界面上"收到哪里 / 重建目标"那一行显示它） */
export function describeWriteTarget(target: WriteTarget | null): string {
  return target ? `${target.libId}` : '未定 —— 请先选择目标库';
}

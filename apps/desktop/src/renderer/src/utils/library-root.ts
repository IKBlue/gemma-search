// utils/library-root.ts —— 从 `libraryConfig` 的 data 里挑出「当前库」的 libId 与 root（Operation 层，纯函数）
//
// ── 为什么要有这个纯函数（T-15b，2026-10-15）────────────────────────────────
//   体检/重建这两条 IPC 只要 `{ libId }`（契约 **`.strict()`**：多传 root 会被拒）。
//   而界面必须先知道「哪个库、库根在哪」才能：
//     · 把 libId 递给主进程（库根的解析仍归主进程 T-04 —— 渲染进程只传 id，不传路径）；
//     · 在页面上**如实显示**当前体检的是哪个库/哪个目录（否则用户分不清他在修哪个库）。
//   这段挑选逻辑如果写在 `.tsx` 里，`node:test` 就加载不到它（AGENTS §2：领域判断不进 .tsx）。
//
// ── 挑选顺序（与 `libraryConfig` 的语义一致，别自己发明第二条规则）────────────
//   ① `chosen` 指的库（主进程说「这就是当前选的」）；
//   ② 否则列表里的第一个（只有一个库时就是它）。
//   两种都没有 ⇒ 返回 null（调用方要显示「还没有可体检的库」，**不猜、不编一个假 libId**）。
import type { LibraryConfigData, LibraryEntry } from '../hooks/useLibraryConfig.ts';

export type ResolvedLibrary = {
  libId: string;
  root: string;
  /** U18：库根是否可用（`available` 缺失 ⇒ 按可用处理，向后兼容） */
  available: boolean;
  /** 不可用时的人话原因（可用时为 null）—— 界面据它显示「为什么用不了」 */
  unavailableReason: string | null;
};

/** U18：`available` 缺失按可用处理（契约口径：可选字段缺失 = 兼容旧载荷） */
export function isAvailableEntry(e: LibraryEntry): boolean {
  return e.available !== false;
}

function pickEntry(data: LibraryConfigData | null | undefined): LibraryEntry | null {
  const list = (data && Array.isArray(data.libraries) ? data.libraries : []).filter(
    (e): e is LibraryEntry => Boolean(e) && typeof e === 'object',
  );
  if (list.length === 0) return null;
  const chosen = data?.chosen;
  const chosenHit =
    typeof chosen === 'string' && chosen
      ? list.find((e) => e.libId === chosen || e.root === chosen)
      : undefined;
  // U18：用户选中的库**可用**就用它；它不可用时**不要硬用**（整个界面会卡在一条死路径上）——
  // 改挑一个可用的；一个可用的都没有才退回它，那时界面会**如实显示它为什么不可用**。
  if (chosenHit && isAvailableEntry(chosenHit)) return chosenHit;
  return list.find(isAvailableEntry) ?? chosenHit ?? list[0];
}

/**
 * 当前库：`libId` 必须在（主进程就是按它解析库根的）；`root` 只用于**显示**，可能缺。
 * @param data `libraryConfig` 的响应载荷（或任何同形状的注入源）
 */
export function resolveLibrary(data: LibraryConfigData | null | undefined): ResolvedLibrary | null {
  const entry = pickEntry(data);
  if (!entry) return null;
  const libId = typeof entry.libId === 'string' ? entry.libId.trim() : '';
  if (!libId) return null;
  return {
    libId,
    root: typeof entry.root === 'string' ? entry.root : '',
    available: isAvailableEntry(entry),
    unavailableReason:
      typeof entry.unavailableReason === 'string' && entry.unavailableReason
        ? entry.unavailableReason
        : null,
  };
}

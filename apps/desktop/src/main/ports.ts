// apps/desktop/src/main/ports.ts —— 外壳注入给引擎的能力端口
//
// 为什么单独一个模块：引擎是**传输无关**的（`AGENTS.md` §1 S5），它不 import `electron`，
// 而是声明"我需要一个能定位文件的东西"，由外壳注入。当前只有 `reveal` 需要端口。
//
// 为什么构造函数**接收 `shell` 而不是自己 import**：这样它能在 `node:test` 里被直接测，
// 不需要 Electron。F-01 的教训正是"接线没人测"——引擎单测自己注入了 shell（所以绿），
// 而应用侧从未注入（所以假成功）。**修法的关键不是把 `shell:` 加一行，而是让那一行可被验证。**
//
// 2026-10-14：本文件由 `ports.mjs` 转为 `.ts`（全量 TypeScript）。**语义逐字未改**，只补类型。

/** Electron `shell` 模块里本端口用到的那一个方法（注入后即可在 `node:test` 里直接测） */
export interface RevealShell {
  showItemInFolder: (p: string) => void;
}

/** 端口形状（与 `packages/engine/src/engine.ts` 的 `ShellPort` 结构性一致） */
export interface RevealPort {
  reveal: (absPath: string) => void;
}

/**
 * 造 `{ reveal(absPath) }` 端口。
 *
 * ⚠️ 这个端口**只负责"调用"，不负责判定**：
 *   · Electron 的 `shell.showItemInFolder(fullPath)` **返回 void、不报告失败**
 *     （对比 `shell.openPath` 才返回错误串）。所以这里**没有**"成功了没"这个概念；
 *   · 成功/失败的判定（文件在不在、端口有没有接上）全部归引擎：`PORT_MISSING` / `ITEM_MISSING_ON_DISK`。
 *     **不要**在这里再造一套判定或第二份文案 —— 那就是"同一件事两处说法"。
 *
 * @param shell Electron 的 `shell` 模块
 * @returns 只含 `reveal` 的端口
 */
export function createRevealPort(shell: RevealShell): RevealPort {
  return {
    // 参数**原样转发**，不做路径加工：路径的合法性（库根包含校验、符号链接拒绝）
    // 已经在引擎里由 `resolveInLibrary()` 做完，这里再"清洗"一遍只会掩盖上游的 bug。
    reveal(absPath: string): void {
      // 不吞异常：抛出去由引擎的 `envelope()` 归成 INTERNAL 信封。
      // 静默 catch 会让"资源管理器调用炸了"变成另一个静默假成功。
      shell.showItemInFolder(absPath);
    },
  };
}

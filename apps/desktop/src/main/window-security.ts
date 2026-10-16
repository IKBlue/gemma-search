// apps/desktop/src/main/window-security.ts —— 窗口姿态的两个决策 + 调用来源判定
//
// 为什么单独成模块：`main/index.ts` import 了 `electron`，`node:test` 加载不了它。
// 于是 `SPEC.md` §6 的 S11/S12/S13 **一条测试都没有** —— 而这三条恰好是
// "渲染进程能去哪里、能不能开新窗口、iframe 能不能冒充主窗口"这类**边界**判定。
// 抽出来之后，这些判定可以用**普通对象**喂真值，不必启动 Electron。
//
// ⚠️ 抽的是**决策**，不是 Electron 接线：
//   `index.ts` 负责 `webContents.setWindowOpenHandler(...)` / `.on('will-navigate', ...)`
//   的注册，那部分由 `tools/verify_app_build.mjs`（**已移除 2026-10-13**） 在构建产物上**结构断言**（真的注册了、
//   deny 动作是 'deny'）。本模块只保证"注册的那个函数在给定输入下返回什么"。
//   两者合起来才是完整证据；单看任何一个都会把"接线掉了"或"判定写错了"漏掉。
//
// 2026-10-14：本文件由 `window-security.mjs` 转为 `.ts`（全量 TypeScript）。
// **语义逐字未改**，只补类型；类型刻意用**结构化**的本地接口，不 import electron ——
// 这样本模块仍能被 `node:test` 直接加载，且判定可脱离 Electron 单测（文件头的设计约束）。

/** IpcMainInvokeEvent 里本模块用到的两个字段（结构化，不绑 Electron 类型） */
export interface SenderFrameLike {
  parent: unknown;
  url?: string;
}

export interface InvokeEventLike {
  sender: unknown;
  senderFrame?: SenderFrameLike | null;
}

/** 主窗口里本模块用到的两个字段（结构化，不绑 BrowserWindow 类型） */
export interface WindowLike {
  isDestroyed?: () => boolean;
  webContents: unknown;
}

/** 判断一个 URL 是否属于应用自身（§2 来源校验 + §5 导航拦截共用同一判据） */
export function isAppUrl(u: string | null | undefined, devUrl = ''): boolean {
  if (!u) return false;
  if (u.startsWith('file://')) return true; // 打包/预览态
  if (devUrl && u.startsWith(devUrl)) return true; // dev 态（electron-vite）
  return false;
}

/**
 * 开新窗口永远 deny（S11）。
 *
 * ⚠️ 参数一律忽略是**刻意的**：Electron 的 `setWindowOpenHandler((details) => …)` 会把
 * 目标 URL / disposition / features 都送进来，任何"只放行某些 URL"的白名单都会随时间腐化。
 * 本应用不需要任何新窗口 —— 所以正确策略是**无条件 deny**，而不是"判断后大多 deny"。
 */
export function decideWindowOpen(): { action: 'deny' } {
  return { action: 'deny' };
}

/**
 * 导航决策（S12）：库外 URL 一律阻止。
 * @returns true = 允许导航
 */
export function decideNavigation(url: string | null | undefined, devUrl = ''): boolean {
  return isAppUrl(url, devUrl);
}

/**
 * 调用来源是否可信（S13）。
 *
 * 三条同时成立才算可信：① 就是主窗口那一个 webContents ② 不是 iframe ③ 地址属于应用自身。
 * 顺序有意为之：**先比 webContents**（最便宜、最能挡掉绝大多数伪造），再查 frame。
 *
 * @param event Electron 的 IpcMainInvokeEvent（这里只用到两个字段）
 * @param win 主窗口
 */
export function isTrustedSender(
  event: InvokeEventLike | null | undefined,
  win: WindowLike | null | undefined,
  devUrl = '',
): boolean {
  if (!win || !event) return false;
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
  if (event.sender !== win.webContents) return false; // 只认主窗口
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame.parent !== null) return false; // 拒 iframe（顶层 frame 的 parent 为 null）
  return isAppUrl(frame.url || '', devUrl);
}

// apps/desktop/src/main/library-availability.ts —— 「库根还能不能用」的**唯一判据**（U18）
//
// 为什么要有它：已登记但路径不见了的库（拔盘 / 改名 / 未挂载）此前**完全不可见** ——
//   用户会以为库被删了。A 方案（所有者批准）只加**显示**：如实说「不可用 + 为什么」，
//   不自动清理、不自动重建、不改注册表（「重新定位」是功能，另排期）。
//
// ⚠️ 三种原因**必须分开**（合成一句用户就分不清该插盘、该改权限、还是该处理那个同名文件）：
//   · not-found       路径不存在（盘符变了 / 盘没挂载 / 目录被删或改名）
//   · not-a-directory 路径在，但它**不是目录**（同名文件占位）
//   · inaccessible    在，但**访问不了**（权限 / 网络 / IO 错误 / **探测超时**）
//
// ⚠️ **不阻塞启动**：库根可能在断开的网络盘上，statSync 会卡到 SMB 超时（几十秒）。
//   所以给 libraryList 用的是 **async 探测 + 有界等待**：超时即报 inaccessible（文案写明「探测超时」），
//   绝不让「列个库」把启动挂住。同步版给**本机路径**场景（诊断/警告）用。
//
// ⚠️ 判据只有这一份（P1）：libraryList 的结构化行与 library-config 的警告都走它。

import fs from 'node:fs';

/** 三种不可用原因（**稳定字符串**：界面/测试按它分支，不去解析中文文案） */
export type RootAvailabilityCode = 'not-found' | 'not-a-directory' | 'inaccessible';

export interface RootAvailability {
  root: string;
  available: boolean;
  /** 可用时为 null */
  code: RootAvailabilityCode | null;
  /** 人话理由（可用时为空串；不可用时**非空**） */
  reason: string;
}

/** 同步探测用到的最小 fs 能力（可注入 ⇒ 测试能真造出 EACCES，而不是靠运气） */
export interface RootProbeFs {
  statSync(p: string): { isDirectory(): boolean };
}

/** 生产默认 */
export const NODE_ROOT_PROBE_FS: RootProbeFs = Object.freeze({
  statSync: (p: string): { isDirectory(): boolean } => fs.statSync(p),
});

/**
 * 网络/慢盘上的有界等待（毫秒）。
 * ⚠️ 取值理由：本机路径 stat 是微秒级，400ms 足够；而断开的 SMB 首次触达要**几十秒** ⇒
 *    有界等待把它变成「400ms 后如实说探测超时」，而不是把启动挂住。
 */
export const DEFAULT_PROBE_TIMEOUT_MS: number = 400;

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null | undefined)?.code;
  return typeof c === 'string' ? c : '';
};
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 「stat 抛错」→ 不可用结论。**唯一**一份码→文案映射（同步与异步两条路都调它，P2）。
 */
export function classifyStatError(root: string, e: unknown): RootAvailability {
  const code = codeOf(e);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return {
      root,
      available: false,
      code: 'not-found',
      reason: '库根不存在（盘符变了、盘未挂载，或目录被删除/改名）',
    };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      root,
      available: false,
      code: 'inaccessible',
      reason: '库根不可访问：权限不足（' + code + '）',
    };
  }
  return {
    root,
    available: false,
    code: 'inaccessible',
    reason: '库根不可访问：' + (code ? code + ' ' : '') + msgOf(e),
  };
}

/**
 * 同步判据：**不抛**，任何异常都翻成一个不可用结论（带原因）。
 * 本机路径用它足够；可能挂在网络盘上的调用点请用 `probeRootAvailability`。
 */
export function classifyRootSync(
  root: string,
  fsImpl: RootProbeFs = NODE_ROOT_PROBE_FS,
): RootAvailability {
  const raw = typeof root === 'string' ? root : '';
  if (!raw.trim()) {
    return {
      root: raw,
      available: false,
      code: 'not-found',
      reason: '库根是空的（注册表里没记路径）',
    };
  }
  let st: { isDirectory(): boolean };
  try {
    st = fsImpl.statSync(raw);
  } catch (e) {
    return classifyStatError(raw, e);
  }
  if (!st.isDirectory()) {
    return {
      root: raw,
      available: false,
      code: 'not-a-directory',
      reason: '库根不是目录（同名文件占位？）',
    };
  }
  return { root: raw, available: true, code: null, reason: '' };
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** 异步 stat（可注入；默认 fs.promises.stat） */
  statAsync?: (p: string) => Promise<{ isDirectory(): boolean }>;
  /** 同步判据（可注入；默认 classifyRootSync）—— 空路径在这里就地判掉 */
  classify?: (root: string) => RootAvailability;
}

/**
 * **有界**异步探测：能判就判，判不了（超时）就如实说「不可用 + 探测超时」。**永不抛**。
 * 返回值的 `reason` 一定写明是哪一种，界面直接显示。
 */
export async function probeRootAvailability(
  root: string,
  opts: ProbeOptions = {},
): Promise<RootAvailability> {
  const raw = typeof root === 'string' ? root : '';
  const classify = opts.classify ?? ((r: string): RootAvailability => classifyRootSync(r));
  if (!raw.trim()) return classify(raw);

  const statAsync = opts.statAsync ?? ((p: string) => fs.promises.stat(p));
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    // 别让这个定时器把进程钉住（Electron 主进程里尤其重要）
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  try {
    const raced = await Promise.race([
      statAsync(raw).then((st) => ({ kind: 'stat' as const, st })),
      timeout.then(() => ({ kind: 'timeout' as const })),
    ]);
    if (raced.kind === 'timeout') {
      return {
        root: raw,
        available: false,
        code: 'inaccessible',
        reason: '库根探测超时（' + String(timeoutMs) + 'ms 内没回应；网络盘未挂载时常是这样）',
      };
    }
    if (!raced.st.isDirectory()) {
      return {
        root: raw,
        available: false,
        code: 'not-a-directory',
        reason: '库根不是目录（同名文件占位？）',
      };
    }
    return { root: raw, available: true, code: null, reason: '' };
  } catch (e) {
    return classifyStatError(raw, e);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 批量探测（libraryList 用）：**并发**、每个都有界、**互不影响** ——
 * 一个库卡住/坏掉不许影响其它库（这就是「其余库照常可用」）。
 */
export async function probeRoots(
  roots: readonly string[],
  opts: ProbeOptions = {},
): Promise<Map<string, RootAvailability>> {
  const out = new Map<string, RootAvailability>();
  const results = await Promise.all(
    roots.map(async (r) => [r, await probeRootAvailability(r, opts)] as const),
  );
  for (const [r, a] of results) out.set(r, a);
  return out;
}

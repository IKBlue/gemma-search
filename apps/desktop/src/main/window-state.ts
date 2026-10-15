// apps/desktop/src/main/window-state.ts —— 窗口尺寸 / 位置的记忆与越界回落（T-10b）
//
// 为什么需要这个模块：
//   窗口位置存进 userData、下次启动恢复，听起来是个小功能，但**存下来的坐标不保证还看得见**：
//   显示器拔了、分辨率调小了、副屏换了位置、远程桌面进来又出去 —— 都会让旧坐标落在屏幕外。
//   照搬的后果是"应用启动了，窗口不见了"，而且**没有任何提示**（正是本项目最怕的静默失败）。
//
//   所以这里只做两件事：
//     ① 把**不可信的外部 JSON** 收成合法 bounds（形状不对就整条不用，不猜、不部分采用）；
//     ② 判定它是否还落在某块屏幕的**工作区**里 —— 不满足就回落到默认值（交给 Electron 居中），
//        并把「为什么」写成一句人能读懂的话。
//
//   ⚠️ 存的位置是 **userData**，不是素材库：SPEC §2.1 的库内写入不变式不允许往库里写窗口状态。
//
//   纯逻辑 + 可注入：decideWindowBounds() 不 import electron、不读任何全局单例，
//   输入就是"存下来的 JSON + 屏幕工作区列表"。这样它能在 node:test 里喂假数据直接跑
//   （真机上没法干净地拔一块显示器来造这个场景）。

import fs from 'node:fs';
import path from 'node:path';

/** userData 下的状态文件名 */
export const WINDOW_STATE_FILE: string = 'window-state.json';
/** 文件格式版本（结构变化时递增；读端只认 1，其它一律当"读不懂"处理） */
export const WINDOW_STATE_VERSION: number = 1;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一块屏幕的可用区域（Electron screen.display.workArea 的形状：已扣掉任务栏） */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecideWindowBoundsOptions {
  /** 从 userData 读到的原始 JSON（**形状不可信**） */
  saved: unknown;
  /** 当前所有屏幕的工作区；空数组 = 拿不到屏幕信息 */
  workAreas: WorkArea[];
  minWidth: number;
  minHeight: number;
  /** 宽和高都至少要露出这么多像素，才算"用户看得见、抓得着"（标题栏量级） */
  minVisible: number;
}

export interface BoundsDecision {
  /** null = 用 Electron 默认（按尺寸居中）—— 也就是"回落" */
  bounds: WindowBounds | null;
  source: 'saved' | 'default';
  /** 人读：为什么是这个结果（直接进日志） */
  reason: string;
}

/** unknown → 整数（有限数才要；非整数四舍五入，避免 1.5px 这种噪声） */
function toInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * 外部 JSON → 合法 bounds。
 *
 * **任一字段不合法就整条不用**（返回 null）—— 理由：只采用一半会产生"看起来恢复了、
 * 其实位置是编的"这种更坏的结果；整条不用至少行为可预测（居中 + 默认尺寸 + 日志写明）。
 */
export function parseSavedBounds(raw: unknown): { bounds: WindowBounds | null; why: string } {
  if (raw === null || raw === undefined) return { bounds: null, why: '没有存过窗口位置' };
  if (typeof raw !== 'object') return { bounds: null, why: '不是对象' };
  const rec = raw as Record<string, unknown>;
  const ver = toInt(rec.version);
  if (ver !== WINDOW_STATE_VERSION)
    return { bounds: null, why: '版本不认识（version=' + String(rec.version) + '）' };
  const x = toInt(rec.x);
  const y = toInt(rec.y);
  const width = toInt(rec.width);
  const height = toInt(rec.height);
  if (x === null || y === null || width === null || height === null) {
    return { bounds: null, why: 'x/y/width/height 里有缺失或非有限数' };
  }
  return { bounds: { x, y, width, height }, why: '' };
}

/** 两个矩形的交叠面积（不相交 = 0） */
function overlap(a: WorkArea, b: WindowBounds): { w: number; h: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * 决定这次用哪个窗口矩形。
 *
 * 判定顺序（每一步失败都回落默认值，并给出可读理由）：
 *   ① JSON 能不能用；
 *   ② 尺寸是否不小于最小尺寸；
 *   ③ 有没有屏幕信息；
 *   ④ 旧位置是否还在某块屏幕的可用区里露出至少 minVisible × minVisible（够看见 + 够抓着标题栏）；
 *   ⑤ 尺寸超过所在屏幕时**夹到屏幕大小**（"分辨率调小了"的场景：能自动适配就别整个丢掉）。
 */
export function decideWindowBounds(opts: DecideWindowBoundsOptions): BoundsDecision {
  const parsed = parseSavedBounds(opts.saved);
  if (!parsed.bounds) {
    return {
      bounds: null,
      source: 'default',
      reason: '不恢复上次位置（' + parsed.why + '）⇒ 用默认尺寸并居中',
    };
  }
  const b = parsed.bounds;

  if (b.width < opts.minWidth || b.height < opts.minHeight) {
    return {
      bounds: null,
      source: 'default',
      reason:
        '存下来的尺寸 ' +
        b.width +
        'x' +
        b.height +
        ' 小于最小尺寸 ' +
        opts.minWidth +
        'x' +
        opts.minHeight +
        ' ⇒ 用默认尺寸并居中',
    };
  }

  if (!opts.workAreas.length) {
    return {
      bounds: null,
      source: 'default',
      reason: '拿不到屏幕工作区信息（screen API 没返回显示器）⇒ 用默认尺寸并居中',
    };
  }

  // 找出"露得最多"的那块屏幕（可能有多块）
  let best: WorkArea | null = null;
  let bestVisible = 0;
  for (const a of opts.workAreas) {
    const o = overlap(a, b);
    const visible = Math.min(o.w, o.h);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = a;
    }
  }

  if (best === null || bestVisible < opts.minVisible) {
    return {
      bounds: null,
      source: 'default',
      reason:
        '上次的位置 ' +
        b.x +
        ',' +
        b.y +
        '（' +
        b.width +
        'x' +
        b.height +
        '）已经露不出 ' +
        opts.minVisible +
        'px（最多 ' +
        bestVisible +
        'px）—— 显示器变了或窗口在屏幕外 ⇒ 用默认尺寸并居中',
    };
  }

  // 尺寸夹到该屏幕的可用区（"分辨率调小了" ⇒ 适配，而不是丢到看不见的地方）
  const width = Math.max(opts.minWidth, Math.min(b.width, best.width));
  const height = Math.max(opts.minHeight, Math.min(b.height, best.height));
  const clamped = width !== b.width || height !== b.height;
  const bounds: WindowBounds = { x: b.x, y: b.y, width, height };
  return {
    bounds,
    source: 'saved',
    reason:
      '恢复上次位置 ' +
      bounds.x +
      ',' +
      bounds.y +
      ' ' +
      bounds.width +
      'x' +
      bounds.height +
      '（可见 ' +
      bestVisible +
      'px，屏幕 ' +
      best.width +
      'x' +
      best.height +
      '）' +
      (clamped ? '；尺寸超过当前屏幕 ⇒ 已夹到屏幕可用区' : ''),
  };
}

/**
 * 读 userData 里的窗口状态。
 * **不抛**：文件不存在 = 正常（第一次启动）；读坏 = 当成没有（由 decideWindowBounds 回落）。
 */
export function readSavedBounds(userDataDir: string): {
  path: string;
  raw: unknown;
  error: string | null;
} {
  const p = path.join(userDataDir, WINDOW_STATE_FILE);
  if (!userDataDir) return { path: p, raw: null, error: 'userData 不可用' };
  if (!fs.existsSync(p)) return { path: p, raw: null, error: null };
  try {
    return {
      path: p,
      raw: JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')),
      error: null,
    };
  } catch (e) {
    return { path: p, raw: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 写窗口状态（**只在用户动过窗口之后**调用，启动路径不写）。
 * **不抛**：写失败只回一个 error，由调用方记日志 —— 记不住窗口位置不该让应用出问题。
 */
export function persistBounds(
  userDataDir: string,
  bounds: WindowBounds,
): { ok: boolean; path: string; error: string | null } {
  const p = path.join(userDataDir, WINDOW_STATE_FILE);
  if (!userDataDir) return { ok: false, path: p, error: 'userData 不可用' };
  const payload = {
    version: WINDOW_STATE_VERSION,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { ok: true, path: p, error: null };
  } catch (e) {
    return { ok: false, path: p, error: e instanceof Error ? e.message : String(e) };
  }
}

// apps/desktop/src/main/thumb-cache.ts —— thumb:// 的**缓存与失败状态码**（T-18）
//
// 为什么单独成模块：`main/index.ts` import 了 electron ⇒ `node:test` **加载不了它**，
// 而 thumb:// 处理器里有两件必须能测的事：
//   ① 缓存读写 —— 缓存是**派生数据**（可整目录删除，删掉只是重算；不进事务、不需迁移），
//      而且**绝不写进素材目录**（SPEC §2.1：除 .gs-* 与 .gs-staging/ 外，素材目录只读）。
//   ② 失败 → HTTP 状态码的映射，尤其是「**别把我们的 bug 伪装成 404**」这一条。
//
// ── 失败 → 状态码：这张表就是本模块的契约（逐行有用例钉住，见 thumb-cache.test.mjs）──
//   | 情况                                            | 状态码 | 为什么                                  |
//   |------------------------------------------------|-------|----------------------------------------|
//   | URL/形状/尺寸不合法                              | 400   | 请求本身就不对（复用 thumb-url.ts）      |
//   | 形状合法但库 id 还原不出来                        | 404   | 库没登记                                |
//   | 引擎未就绪                                       | 503   | 只是"暂时不能"，不是"没有"                |
//   | UID_NOT_FOUND / LIB_NOT_FOUND                    | 404   | 素材/库**确实不在**                      |
//   | PATH_ESCAPES_LIB / SYMLINK_REJECTED              | 403   | **安全拒绝**：不是"不存在"，是"不许"      |
//   | 解码失败（nativeImage.isEmpty）                   | 415   | 文件在，但它不是能解码的图片              |
//   | **其余一切（含我们自己的异常）**                    | 500   | 如实说「是我们的问题」，**不许伪装成 404** |
//
//   ⚠️ 改动前的现状是 `codeText(e) === 'SYMLINK_REJECTED' ? 403 : 404` ——
//      它把 **PATH_ESCAPES_LIB（越界拒绝）** 和 **任何内部异常** 都变成 404，
//      等于对用户说"这张图不存在"，而真实原因可能是我们自己的代码坏了（静默的典型）。
//
// ⚠️ 本模块**不重新实现**形状解析 / 尺寸白名单 / 库 id 还原：那些继续用 `thumb-url.ts` 的
//    **唯一实现**（parseThumbUrl · ALLOWED_SIZE · thumbFailureStatus）；这里只补"形状通过之后"的两件事。
//
// ⚠️ 缓存落点 `<dataDir>/thumbs/<libId>/<uid>@<size>.jpg` —— **保持既有布局不变**
//    （只把它从 index.ts 里搬进一个有名字、可单测的函数）。dataDir 是**程序数据目录**，
//    不是素材库 ⇒ 不受 §2.1 的库内写入不变式约束。

import fs from 'node:fs';
import path from 'node:path';

import { codeOf, messageOf } from './errors.ts';
import { thumbFailureStatus } from './thumb-url.ts';

/** 缓存目录名（在 dataDir 之下） */
export const THUMB_CACHE_DIRNAME: string = 'thumbs';

/** 缓存文件后缀（既有布局就是 jpg；改了会让老缓存全部失效，别随手改） */
export const THUMB_CACHE_EXT: string = '.jpg';

/** 缓存键：libId/uid/size 三元组 + 数据目录 */
export interface ThumbCacheKey {
  dataDir: string;
  libId: string;
  uid: string;
  size: number;
}

/**
 * 缓存文件的**唯一**路径实现（index.ts 与测试都调它，不各拼一份 —— P2）。
 * 布局：`<dataDir>/thumbs/<libId>/<uid>@<size>.jpg`
 */
export function thumbCachePath(k: ThumbCacheKey): string {
  return path.join(k.dataDir, THUMB_CACHE_DIRNAME, k.libId, k.uid + '@' + k.size + THUMB_CACHE_EXT);
}

/** 读缓存的结果 */
export interface ThumbCacheRead {
  hit: boolean;
  bytes: Buffer | null;
  /** 人读理由（进日志；未命中也要有理由，不静默） */
  reason: string;
}

/**
 * 读缓存。**不抛**：文件不存在、权限不足、半截文件都只是"没命中"，并把原因带上。
 *
 * ⚠️ **0 字节算未命中**：写缓存可能被进程中途杀掉而留下 0 字节文件；
 *    把它当命中会让界面拿到一张空图，而且**永远不会再重算**（比慢一点坏得多）。
 */
export function readCachedThumb(cachePath: string): ThumbCacheRead {
  try {
    const bytes = fs.readFileSync(cachePath);
    if (!bytes || bytes.length === 0) {
      return { hit: false, bytes: null, reason: '缓存文件是 0 字节（当作未命中，重新生成）' };
    }
    return { hit: true, bytes, reason: '缓存命中（' + bytes.length + ' 字节）' };
  } catch (e) {
    // ENOENT 是最常见的一种（本来就没缓存），不当错误看；其它码也照实写进理由
    return { hit: false, bytes: null, reason: '缓存未命中：' + codeOf(e) };
  }
}

/** 写缓存的结果 */
export interface ThumbCacheWrite {
  ok: boolean;
  path: string;
  error: string | null;
}

/**
 * 写缓存。**不抛**：写不进去只回一个 error。
 * 理由：缓存只是加速，**记不住缩略图绝不能让这次请求失败**（用户要的是图，不是缓存）。
 */
export function writeCachedThumb(cachePath: string, bytes: Buffer | Uint8Array): ThumbCacheWrite {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes);
    return { ok: true, path: cachePath, error: null };
  } catch (e) {
    return { ok: false, path: cachePath, error: codeOf(e) + ': ' + messageOf(e) };
  }
}

// ---------------------------------------------------------------- 失败 → 状态码

/** 引擎的「这条素材 / 这个库确实不在」⇒ 404（如实回答"没有"，不是"不许"） */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['UID_NOT_FOUND', 'LIB_NOT_FOUND']);

/** 引擎的「安全拒绝」⇒ 403（路径越界 / 符号链接指向库外）—— **不是 404**，否则用户以为文件没了 */
const FORBIDDEN_CODES: ReadonlySet<string> = new Set(['SYMLINK_REJECTED', 'PATH_ESCAPES_LIB']);

/** `thumbServeStatus` 的输入（都是"事实"，不是推断） */
export interface ThumbStatusInput {
  /** 形状/尺寸/URL 是否合法（来自 parseThumbUrl） */
  shapeOk: boolean;
  /** 还原后的库 id；空串 = 未注册/无法还原 */
  libId?: string;
  /** 引擎是否可用 */
  engineReady?: boolean;
  /** `absPathFor` 抛出的引擎错误码；没抛错就是空串 */
  resolveCode?: string;
  /** 解码是否成功（`nativeImage.isEmpty()` 的反面）；未尝试解码就传 undefined */
  decoded?: boolean;
}

/** 判定结果 */
export interface ThumbStatusDecision {
  /** null = 可以继续出图 */
  status: number | null;
  /** 机器可读 + 人读的原因（进日志、进证据） */
  reason: string;
  /** 是否属于"我们自己的问题"（500 一类）—— 调用方可据此额外告警 */
  internal: boolean;
}

/**
 * 形状通过之后，把"哪一步失败了"翻成**明确的状态码**（表见文件头）。
 *
 * 判定顺序（**顺序是契约的一部分**，与 index.ts 既有行为一致）：
 *   ① 形状/尺寸/URL 错 ⇒ 400（与"库在不在"无关 —— 由 thumb-url.thumbFailureStatus 说了算，不在这里重写）
 *   ② 形状合法但库还原不出来 ⇒ 404
 *   ③ 引擎没就绪 ⇒ 503
 *   ④ 取路径失败：素材不在 ⇒ 404 · 安全拒绝 ⇒ 403 · **其它一律 500**（不许伪装成 404）
 *   ⑤ 解不出图 ⇒ 415（文件在、但它不是能解码的图片）
 *   ⑥ 都过了 ⇒ null（出图）
 */
export function thumbServeStatus(f: ThumbStatusInput): ThumbStatusDecision {
  // ①② 复用 thumb-url.ts 的唯一实现：形状/尺寸 → 400，库还原不出 → 404
  const base = thumbFailureStatus({ shapeOk: f.shapeOk, libId: f.libId });
  if (base === 400) return { status: 400, reason: '形状或尺寸不合法（400）', internal: false };
  if (base === 404) return { status: 404, reason: '库 id 无法还原（404）', internal: false };

  // ③ 引擎没就绪：这是"暂时不能"，不是"没有" ⇒ 503（也不是我们的 bug）
  if (!f.engineReady) return { status: 503, reason: '引擎未就绪（503）', internal: false };

  // ④ 取路径失败
  const code = f.resolveCode || '';
  if (code) {
    if (NOT_FOUND_CODES.has(code)) {
      return { status: 404, reason: '素材不在索引/库里：' + code + '（404）', internal: false };
    }
    if (FORBIDDEN_CODES.has(code)) {
      return { status: 403, reason: '安全拒绝：' + code + '（403）', internal: false };
    }
    return {
      status: 500,
      reason: '未预期的失败：' + code + ' ⇒ 500（**这是我们的问题，不许伪装成 404**）',
      internal: true,
    };
  }

  // ⑤ 文件在，但解不出图
  if (f.decoded === false) return { status: 415, reason: '文件无法解码成图片（415）', internal: false };

  // ⑥ 出图
  return { status: null, reason: '可以出图', internal: false };
}

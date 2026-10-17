// apps/desktop/src/renderer/src/utils/image-intake.ts —— 「拖进窗口 / 粘贴进来的东西能不能当查询图」（UX-1c）
//
// 为什么抽成纯函数（Operation 层）：判定 + 拒绝理由是**业务规则**，写进 .tsx 就等于放弃自动化
// （组件在 node:test 里加载不了）。这里只做判断与文案，不发 IPC、不碰 window.api。
//
// 三条口径（卡面要求）：
//   ① 只收**图片文件**（扩展名白名单与主进程同一份：`shared/image-ext.ts`；大小写不敏感）；
//   ② 拿不到真实绝对路径就**明确拒绝**——典型情形是"剪贴板里是位图（截图）而不是文件"：
//      那种输入需要主进程把字节落成临时文件（= 新 IPC，属契约变更，尚未获批），
//      **不许**假装能搜；拒绝理由要告诉用户可行的替代动作；
//   ③ 拒绝一律给**可显示的理由**（不静默、不 "undefined"）。
import { isImageFileName } from '../../../shared/image-ext.ts';

/** 我们只关心 File 的这三个字段（Electron 的 File 额外带 `path`；普通浏览器没有） */
export interface IntakeFileLike {
  name?: string;
  /** MIME（可能为空：某些拖拽/粘贴来源不给） */
  type?: string;
  /** Electron 特有：真实绝对路径。**安全边界**：渲染层只能"收下"它，不能自己编一条 */
  path?: string;
}

export type IntakeResult =
  | { ok: true; path: string; name: string }
  | { ok: false; code: 'EMPTY' | 'NOT_IMAGE' | 'NO_PATH'; reason: string };

/** 看起来像图片吗：MIME 优先（image/*），MIME 缺失时退回扩展名白名单（大小写不敏感） */
export function looksLikeImage(f: IntakeFileLike): boolean {
  const type = String(f.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return isImageFileName(String(f.name || ''));
}

/**
 * 从一次拖拽/粘贴的文件列表里挑出**可用的查询图文件**。
 *
 * @returns 成功 = `{ok:true, path, name}`；失败 = `{ok:false, code, reason}`（reason 可直接展示）
 */
export function classifyImageFiles(
  files: ArrayLike<IntakeFileLike> | null | undefined,
): IntakeResult {
  const list: IntakeFileLike[] = files ? Array.from(files) : [];
  if (list.length === 0) {
    return {
      ok: false,
      code: 'EMPTY',
      reason: '没有收到文件：拖拽或粘贴里没有可用的图片',
    };
  }

  // 只看**第一个**文件：拖多张进来时"用哪张"不是本卡能替用户决定的事；
  // 先把第一张的判定做对（多选留给以后的批量入口）。
  const first = list[0];
  const name = String(first.name || '').trim() || '（未命名文件）';
  if (!looksLikeImage(first)) {
    return {
      ok: false,
      code: 'NOT_IMAGE',
      reason: '只支持图片文件（jpg / jpeg / png / webp / bmp）：' + name + ' 不是图片',
    };
  }

  const p = typeof first.path === 'string' ? first.path.trim() : '';
  if (!p) {
    // 典型场景：从聊天/截图工具复制的**位图**（剪贴板里没有文件路径）。
    // 要做的话得在主进程把字节写成临时文件再返回路径 —— 那是新增 IPC（契约变更），未获批前先如实拒绝。
    return {
      ok: false,
      code: 'NO_PATH',
      reason:
        '粘贴的是剪贴板里的图片内容，不是文件：请先把截图保存成文件，再把它拖进窗口（或复制文件后粘贴）',
    };
  }

  return { ok: true, path: p, name };
}

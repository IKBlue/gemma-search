// apps/desktop/src/shared/image-ext.ts —— 「什么算图片扩展名」的**唯一来源**（UX-1c）
//
// 为什么放在 shared（而不是各层各写一份，P1）：
//   · 渲染层要判定"拖进窗口/粘贴进来的东西是不是图片"（`renderer/src/utils/image-intake.ts`）；
//   · 主进程要判定"queryImagePath 的扩展名是不是图片"（`main/encoder.ts` 的 `IMG_EXT`）；
//   两处必须对同一份清单，否则会出现"界面收下了、主进程却拒绝解码"这种**看起来像 bug 的分歧**。
//
// ⚠️ 引擎侧还有一份扫描清单（`packages/engine/src/fingerprint.ts` 的 `IMG_EXT`）——
//   那是"**库内扫描**"的权威，而引擎是零依赖、传输无关的，**不能 import 本仓 app 层**
//   ⇒ 两份同名清单在架构上是允许的（用途不同：库内扫描 vs 用户传入查询图），不是漏改。
//   本文件只统一**app 内**的判定，别把它当成引擎那份的替代品。
export const IMAGE_EXT: ReadonlySet<string> = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

/** 文件名 → 小写扩展名（含点）；没有扩展名返回空串 */
export function imageExtOf(name: string): string {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  if (i <= 0 || i === s.length - 1) return '';
  return s.slice(i).toLowerCase();
}

/** 这个文件名是不是图片（只看扩展名；大小写不敏感） */
export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.has(imageExtOf(name));
}

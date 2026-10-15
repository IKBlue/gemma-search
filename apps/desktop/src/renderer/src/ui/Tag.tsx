// Tag —— 分类标签（原型：.tag.VR / .tag.CR / .tag.CRVR；其余落默认灰）
//
// `.tag.VR` 这类类名是**渲染层守卫的契约**之一（断言结果卡片的分类），别改成哈希类名。
import type { ReactNode } from 'react';

const CLASS: Record<string, string> = { VR: 'VR', CR: 'CR', 'CR+VR': 'CRVR' };

export type TagProps = { folder?: string | null; children?: ReactNode };

export default function Tag({ folder, children }: TagProps) {
  const cls = (folder && CLASS[folder]) || '';
  return <span className={cls ? `tag ${cls}` : 'tag'}>{children ?? folder ?? '—'}</span>;
}

// Topbar —— 顶栏（原型：.topbar > .crumb + .top-actions）
import type { ReactNode } from 'react';

export type TopbarProps = { crumb?: ReactNode; actions?: ReactNode };

export default function Topbar({ crumb, actions }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="crumb">{crumb}</div>
      {actions ? <div className="top-actions">{actions}</div> : null}
    </header>
  );
}

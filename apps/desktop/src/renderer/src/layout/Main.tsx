// Main —— 主工作区容器（原型：.main）
import type { ReactNode } from 'react';

export default function Main({ children }: { children?: ReactNode }) {
  return <main className="main">{children}</main>;
}

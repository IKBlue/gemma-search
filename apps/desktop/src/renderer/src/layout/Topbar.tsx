// Topbar —— 顶栏（原型：.topbar > .crumb + .top-actions）
//
// ── 应用自身健康入口（U27 · 2026-10-16）────────────────────────────────────
//   它**无条件**渲染在这里，**不是**一个可选 prop —— Lead 明确裁过，理由很硬：
//     · 「本次进程是否出现过未处理异常」是**进程级事实**，不是页面级事实；
//     · 做成可选 prop ⇒ **哪个页面忘了传，那个页面上的标记就静默消失** ——
//       而「同一件事在不同页面表现不一致」正是本项目要消灭的静默形态（用户看到的是实现细节，不是事实）；
//     · 一处定义 > 6 处 prop（P1/P2 同一思路：将来不会漂移）。
//   形态**低调**：健康时就是一个普通入口文字；出过事时多一个数字与一个 ⚠ ——
//   **不弹窗、不阻塞**（未处理异常常常是已经被兜住的一次抖动，弹窗会把用户训练成无脑关掉）。
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { LABELS, PATHS } from '../router/paths.ts';
import useAppHealth from '../hooks/useAppHealth.ts';
import { entryText } from '../store/app-health.ts';

export type TopbarProps = { crumb?: ReactNode; actions?: ReactNode };

export default function Topbar({ crumb, actions }: TopbarProps) {
  const { data } = useAppHealth();
  const bad = data !== null && data.unhealthy === true;
  return (
    <header className="topbar">
      <div className="crumb">{crumb}</div>
      <div className="flex items-center gap-2">
        <Link
          to={PATHS.health}
          data-testid="app-health-entry"
          data-unhealthy={bad ? 'yes' : 'no'}
          className={bad ? 'text-caption tone-warn' : 'text-caption muted'}
          aria-label={LABELS.health + '：' + entryText(data)}
          title={
            bad
              ? '本次运行出现过未处理异常：点开诊断页看原因与次数'
              : '应用自身健康（只读）：点开诊断页'
          }
        >
          <span aria-hidden="true">{bad ? '⚠ ' : ''}</span>
          <span>{entryText(data)}</span>
        </Link>
        {actions ? <div className="top-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

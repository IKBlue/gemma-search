// TasksPage —— 索引任务 + 操作记录（P3d 的**占位页**）
//
// ⚠️ 这不是 P3d 的实现。它存在的理由（与 ItemPage 同）：
//   ① **路由骨架先立** —— P3d 是侧栏「索引任务」那一项，没有 `/tasks` 它就只能永远 disabled。
//   ② **让"多页"这件事现在就是真的** —— 侧栏能点、地址栏能换、返回能回，
//      而不是等 P3d 铺开时才第一次验证路由。
//
// 真做 P3d 时要补（见 `docs/plan/ROADMAP.md` §3 的 P3d 行）：
//   阶段条 / 进度 / ETA（误差 <30%）· 失败项可展开 · 取消（边界生效）· 续跑 · 本次元数据；
//   事务表 + 撤销 + 待处理（`RECOVERY_NEEDED`）三条路。
//   ⚠️ 进度是**主进程推来的事件流**（`onEvent`）—— 那部分状态届时归 Zustand store
//   （`renderer/src/store/`），不要塞进组件。
import { Link } from 'react-router'

import AppShell from '../layout/AppShell.jsx'
import Main from '../layout/Main.jsx'
import PageHead from '../layout/PageHead.jsx'
import Topbar from '../layout/Topbar.jsx'
import Button from '../ui/Button.jsx'
import SearchSidebar from '../search/SearchSidebar.jsx'

export default function TasksPage() {
  return (
    <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={<>工作区 <span className="crumb-sep">/</span> <strong>索引任务</strong></>}
          actions={<Button variant="icon" aria-label="返回搜索" title="返回搜索"><Link to="/">←</Link></Button>}
        />
        <div className="content">
          <PageHead
            eyebrow="TASKS"
            title="索引任务与操作记录"
            subtitle="这一页还没做（P3d）。路由已通 —— 侧栏那一项现在可以点了。"
          />
          <div className="panel">
            <p className="muted small">
              P3d 将在这里显示阶段条、进度与 ETA、可展开的失败项、取消/续跑，以及事务表与撤销。
              进度来自主进程的**事件流**，届时归 <span className="mono">renderer/src/store/</span>。
            </p>
            <Button><Link to="/">← 回到搜索</Link></Button>
          </div>
        </div>
      </Main>
    </AppShell>
  )
}

// pages/TasksPage.tsx —— 索引任务（开始 / 取消 / 续跑）
//
// ⚠️⚠️ 2026-10-15 · S6（所有者批准的设计基线 §2.2）：indexStart / indexCancel / indexResume
//   已从契约删除 —— 它们对应的 job 表本轮没有建（"绿地口径：契约只暴露 6 张表支持得了的方法"）。
//
//   所以本页改成诚实态：不留假按钮。真实的索引进度要靠 job 表，那张表随功能上线。
//   （indexStatus 仍然保留 —— 它读的是 asset_index_state，是这 6 张表里的一张。）
//
//   ⚠️ 外壳（AppShell + SearchSidebar + Topbar + 返回搜索链接）**必须保留**：
//      实测（S6 全量 e2e）—— 第一版我把整页换成一段裸文本，侧栏就此消失，
//      于是 a11y E5-b / uiux E12-e / routing E2-e / E6-b 全红。页面改文案，外壳不许动。
import { Link } from 'react-router'

import AppShell from '../layout/AppShell.tsx'
import Main from '../layout/Main.tsx'
import PageHead from '../layout/PageHead.tsx'
import Topbar from '../layout/Topbar.tsx'
import Button from '../ui/Button.tsx'
import SearchSidebar from '../search/SearchSidebar.tsx'
import { LABELS } from '../router/paths.ts'
import { useDocumentTitle } from '../utils/useDocumentTitle.ts'

export default function TasksPage() {
  useDocumentTitle(LABELS.tasks)

  return (
    <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={<>工作区 <span className="crumb-sep">/</span> <strong>索引任务</strong></>}
          actions={<Button variant="icon" asChild><Link to="/" aria-label="返回搜索" title="返回搜索">←</Link></Button>}
        />

        <div className="content">
          <PageHead
            eyebrow="TASKS"
            title={LABELS.tasks}
            subtitle="索引任务要一张 job 表（状态 / 进度 / 取消 / 续跑）—— 它在绿地数据模型里还没有建。"
          />

          <div className="panel empty" data-testid="tasks-unavailable">
            <p className="text-ink">该功能等对应的数据表上线。</p>
            <p className="muted small mt-2">
              契约里已经没有 indexStart / indexCancel / indexResume（2026-10-15 按基线 §2.2 重列），
              所以这里现在没有「开始索引」按钮可点。
            </p>
            <p className="muted small mt-2">
              ⚠️ 灰色的假按钮比没有按钮更坏 —— 点了不动的按钮会让人以为应用坏了。
            </p>
          </div>
        </div>
      </Main>
    </AppShell>
  )
}

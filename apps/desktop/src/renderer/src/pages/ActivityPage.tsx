// pages/ActivityPage.tsx —— 操作记录（事务台账）
//
// ⚠️⚠️ 2026-10-15 · S6（所有者批准的设计基线 §2.2）：transactions / mutate 已从契约删除 ——
//   它们对应的意图层表（事务 / 标注）本轮没有建（"绿地口径：契约只暴露 6 张表支持得了的方法"）。
//
//   所以这个页面不再有数据源。按 Lead 的裁定：改成诚实态 ——
//   不留假按钮、不显示一张空表假装"你没有记录"，而是如实说明"等对应的表上线"。
//
//   ⚠️ 外壳（AppShell + SearchSidebar + Topbar + 返回搜索链接）**必须保留**（同 TasksPage 的教训）。
import { Link } from 'react-router';

import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import { LABELS } from '../router/paths.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';

export default function ActivityPage() {
  useDocumentTitle(LABELS.activity);

  return (
    <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={
            <>
              工作区 <span className="crumb-sep">/</span> <strong>操作记录</strong>
            </>
          }
          actions={
            <Button variant="icon" asChild>
              <Link to="/" aria-label="返回搜索" title="返回搜索">
                ←
              </Link>
            </Button>
          }
        />

        <div className="content">
          <PageHead
            eyebrow="ACTIVITY"
            title={LABELS.activity}
            subtitle="操作记录要读事务台账表 —— 那张表在本轮绿地数据模型里还没有建。"
          />

          <div className="panel empty" data-testid="activity-unavailable">
            <p className="text-ink">该功能等对应的数据表上线。</p>
            <p className="muted small mt-2">
              契约里已经没有 transactions / mutate 两个方法（2026-10-15 按基线 §2.2 重列），
              所以在表建好之前这里不会有任何记录。
            </p>
            <p className="muted small mt-2">
              ⚠️ 我们不会给你看一张空表：那会让「没有记录」和「功能还没做」看起来一样。
            </p>
          </div>
        </div>
      </Main>
    </AppShell>
  );
}

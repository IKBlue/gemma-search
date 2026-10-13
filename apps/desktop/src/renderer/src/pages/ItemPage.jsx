// ItemPage —— 图片详情（P3c 的**占位页**，通往真实实现的路由已经通了）
//
// ⚠️ 这不是 P3c 的实现。它存在的理由有两个，都很具体：
//   ① **路由骨架必须先立** —— P3c 是"从结果卡点进一张图的详情"，没有 `/item/:libId/:uid`
//      这条路由，P3b 的结果卡就只能是个死链接。占位页让"卡 → 详情"这条路**现在就能走通**。
//   ② **参数解析必须被真跑过** —— `:libId` / `:uid` 能不能正确取出、非法值怎么办，
//      现在就能验证；等 P3c 铺开时不用同时调路由与业务。
//
// 真做 P3c 时要补（见 `docs/plan/ROADMAP.md` §3 的 P3c 行）：
//   大图 · 两条绝对路径（图 + 包）· 索引状态 · 按「是否需重编码」分区的动作 · 危险区。
import { useParams, Link } from 'react-router'

import AppShell from '../layout/AppShell.jsx'
import Main from '../layout/Main.jsx'
import PageHead from '../layout/PageHead.jsx'
import Topbar from '../layout/Topbar.jsx'
import Button from '../ui/Button.jsx'
import SearchSidebar from '../search/SearchSidebar.jsx'

export default function ItemPage() {
  // 路由参数：形状合法性由契约层保证（LibId / Uid 的 zod 正则），这里只如实显示
  const { libId, uid } = useParams()

  return (
    <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={<>工作区 <span className="crumb-sep">/</span> <strong>图片详情</strong></>}
          actions={<Button variant="icon" aria-label="返回搜索" title="返回搜索"><Link to="/">←</Link></Button>}
        />
        <div className="content">
          <PageHead
            eyebrow="ITEM"
            title="图片详情"
            subtitle="这一页还没做（P3c）。下面是从路由里真实取到的参数 —— 它证明这条路已经通了。"
          />
          <div className="panel">
            <dl className="mono small">
              <dt>libId</dt>
              <dd data-testid="route-libId">{libId ?? '(缺)'}</dd>
              <dt>uid</dt>
              <dd data-testid="route-uid">{uid ?? '(缺)'}</dd>
            </dl>
            <p className="muted small">
              P3c 将在这里显示大图、两条绝对路径与索引状态，并把动作按「是否需重编码」分区。
              见 <span className="mono">docs/plan/ROADMAP.md</span> §3。
            </p>
            <Button><Link to="/">← 回到搜索</Link></Button>
          </div>
        </div>
      </Main>
    </AppShell>
  )
}

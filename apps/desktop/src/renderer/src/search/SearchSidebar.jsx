// SearchSidebar —— 侧栏内容（原型：品牌 + 工作区导航 + 当前图库说明）
//
// **已实现**的导航项给 `to`（走路由，地址栏会变、`NavLink` 自己管 active）；
// **未实现**的仍然 disabled + title 说明阶段（点了会 toast，不会静默）。
// ⚠️ 「图片详情」不是顶层可达页面 —— 它要 `libId + uid`（`/item/:libId/:uid`），
//    只能从结果卡点进去，所以这里仍然 disabled。
// 视觉值全走类（renderer.css 消费令牌）；图标装饰性 → aria-hidden。
import Sidebar, { Brand, Nav, NavItem, NavLabel, SideNote } from '../layout/Sidebar.jsx'
import Progress from '../ui/Progress.jsx'

const NAV = [
  { key: 'search', icon: '⌕', label: '语义搜索', to: '/' },
  { key: 'detail', icon: '▣', label: '图片详情', phase: 'P3c（从结果卡进入）' },
  { key: 'library', icon: '▦', label: '本地图库', phase: 'P3d' },
  { key: 'ingest', icon: '＋', label: '入库与增量', phase: 'P4' },
  { key: 'tasks', icon: '◴', label: '索引任务', to: '/tasks' },
  { key: 'records', icon: '↺', label: '操作记录', to: '/activity' },
  { key: 'settings', icon: '⚙', label: '设置', phase: 'P3d' },
]

export default function SearchSidebar({ lib, indexLoading, indexError, onNotImplemented }) {
  const indexed = Number(lib?.indexed || 0)
  const encoded = Number(lib?.encoded || 0)
  const pct = indexed > 0 ? Math.round((encoded / indexed) * 100) : 0
  const healthy = Boolean(lib?.healthy)

  return (
    <Sidebar>
      <Brand />

      <div>
        <NavLabel>工作区 WORKSPACE</NavLabel>
        <Nav>
          {NAV.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              to={item.to}
              disabled={!item.to}
              title={item.to ? undefined : `${item.phase} 尚未实现`}
              onClick={() => !item.to && onNotImplemented && onNotImplemented(item)}
            >
              {item.label}
            </NavItem>
          ))}
        </Nav>
      </div>

      <SideNote>
        <strong>当前图库</strong>
        <div className="mono small side-root">
          {indexLoading ? '读取中…' : (lib?.root || (indexError ? '不可用' : '未配置'))}
        </div>
        <div className="side-state">
          <span className={healthy ? 'dot dot-ok' : 'dot'} aria-hidden="true" />
          {indexLoading ? ' 读取索引状态…' : healthy ? ' 索引状态正常' : ' 索引状态需要处理'}
        </div>
        <Progress percent={pct} />
        <div className="side-pct">{pct}% 已建立索引</div>
      </SideNote>
    </Sidebar>
  )
}

// SearchSidebar —— 侧栏内容（品牌 + 工作区导航 + 当前图库说明）
//
// **已实现**的导航项给 `to`（走路由，地址栏会变、`NavLink` 自己管 active）；
// **门控项**（未实现）不给 `to` ⇒ `NavItem` 渲染成 disabled + 说明，点了会 toast，不会静默。
// ⚠️ 「图片详情」不是顶层可达页面 —— 它要 `libId + uid`（`/item/:libId/:uid`），
//    只能从结果卡点进去，所以它仍是门控项。
// 视觉值全走类（renderer.css 消费令牌）；图标装饰性 → aria-hidden。
//
// ⚠️ 2026-10-16（IA-1）：导航表**搬到 `utils/nav.ts`**（纯数据）。
//    原因：`.tsx` 在 `node:test` 里加载不了 ⇒「门控项存在且禁用、且写清了进入条件」没法自动化；
//    现在是纯数据，单测能直接钉（IA1–IA4），组件只剩渲染。
import Sidebar, { Brand, Nav, NavItem, NavLabel, SideNote } from '../layout/Sidebar.tsx';
import Progress from '../ui/Progress.tsx';
import { NAV, isReachable, navAccessibleName } from '../utils/nav.ts';
import type { UiNavItem } from '../ui/types.ts';
import type { LibStatus } from '../hooks/useEngine.ts';

export type SearchSidebarProps = {
  lib: LibStatus | null;
  indexLoading?: boolean;
  indexError?: { userMessage: string } | null;
  onNotImplemented?: (item: UiNavItem) => void;
};

export default function SearchSidebar({
  lib,
  indexLoading,
  indexError,
  onNotImplemented,
}: SearchSidebarProps) {
  const indexed = Number(lib?.indexed || 0);
  const encoded = Number(lib?.encoded || 0);
  const pct = indexed > 0 ? Math.round((encoded / indexed) * 100) : 0;
  const healthy = Boolean(lib?.healthy);

  return (
    <Sidebar>
      <Brand />

      <div>
        <NavLabel>工作区 WORKSPACE</NavLabel>
        <Nav>
          {NAV.map((item) => {
            const reachable = isReachable(item);
            return (
              <NavItem
                key={item.key}
                data-nav={item.key}
                icon={item.icon}
                to={item.to}
                disabled={!reachable}
                // 门控项的说明要**能被找到**（悬停 = title）+ **能被念出来**（可访问名 = aria-label）——
                // ⚠️ 只写 title **不够**：`title` 在可访问名计算里优先级最低，会被**内容文本覆盖**
                //    （实测：`toHaveAccessibleName` 拿到的是「文档」，不是「文档（F7 门控…）」）。
                title={reachable ? undefined : navAccessibleName(item)}
                aria-label={reachable ? undefined : navAccessibleName(item)}
                onClick={() => {
                  if (!reachable) onNotImplemented?.(item);
                }}
              >
                {item.label}
              </NavItem>
            );
          })}
        </Nav>
      </div>

      <SideNote>
        <strong>当前图库</strong>
        <div className="mono small side-root">
          {indexLoading ? '读取中…' : lib?.root || (indexError ? '不可用' : '未配置')}
        </div>
        <div className="side-state">
          <span className={healthy ? 'dot dot-ok' : 'dot'} aria-hidden="true" />
          {indexLoading ? ' 读取索引状态…' : healthy ? ' 索引状态正常' : ' 索引状态需要处理'}
        </div>
        <Progress percent={pct} />
        <div className="side-pct">{pct}% 已建立索引</div>
      </SideNote>
    </Sidebar>
  );
}

// LibraryGate —— 决定"显示向导还是显示应用"（D2 修复的界面侧）
//
// 为什么要在最外层拦一道：一个库都没有时 `search` 必然 `LIB_NOT_FOUND`，
// 把用户放进检索界面只会让他看到一堆莫名其妙的错误。所以先问清"库有没有"。
//
// `libraryConfig` **只在这里取一次**，再按需把 data 交给向导 ——
// 避免向导自己再取一遍（同一份事实两个来源，正是本项目在消灭的病）。
//
// `configSource` 是**依赖注入点**（默认就是真的那个 hook）：
// 生产代码不传它；测试要测"无库 → 向导"这条分支时可以注入一个假来源，
// 而不必真的去写用户注册表。这与引擎接受注入端口是同一个理由。
// ⚠️ 注入的假来源除了 `{loading, data, error, refresh}`，**还要提供 `pickDir` / `addLibrary`**
// （向导的两个库操作自 2026-10-13 起由 Operation 层注入，见 `FirstRunWizard.jsx` 头部注释）。
//
// 四种状态（**判定逻辑已抽到 `utils/gate.js` 的 `decideGate()`**）：
//   · loading  —— 还没问出来，什么都不显示（不要闪一下向导又消失）
//   · error    —— 连配置都读不到，如实报 + 给重试
//   · wizard   —— 一个库都没有 ⇒ 显示向导（遮挡）
//   · app      —— 有库 ⇒ 交给路由（`router/index.jsx`）
//
// 为什么判定要抽成纯函数：`node:test` **加载不了 `.jsx`**，而"无库必须先给向导"是
// D2 的**核心行为**。抽出来之后它才进得了 `npm test`（见 `apps/desktop/tests/gate.test.mjs`）
// —— 此前这条行为只被已删的 DOM 守卫覆盖过。
//
// ⚠️ 路由装在**门禁之内**（有库才挂载）。这是有意的：一个库都没有时别的页面都不该可达。
import useLibraryConfig from '../hooks/useLibraryConfig.js'
import { decideGate } from '../utils/gate.js'
import Button from '../ui/Button.jsx'
import FirstRunWizard from './FirstRunWizard.jsx'
import AppRouter from '../router/index.jsx'

export default function LibraryGate({ configSource = useLibraryConfig }) {
  const { loading, data, error, refresh, pickDir, addLibrary } = configSource()
  const where = decideGate({ loading, data, error })

  // 还没问出来：留白。宁可空一瞬，也不要"先显示向导再跳走"的闪烁。
  if (where === 'loading') return null

  // 连配置都读不出来（IPC 坏了 / 主进程异常）：如实报，并给重试
  if (where === 'error') {
    return (
      <div className="wizard-overlay" role="alert">
        <div className="wizard">
          <h1 className="wizard-title">读不到库配置</h1>
          <p className="wizard-error">{error}</p>
          <div className="wizard-acts">
            <Button variant="primary" onClick={refresh}>重试</Button>
          </div>
        </div>
      </div>
    )
  }

  if (where === 'wizard') {
    return (
      <FirstRunWizard
        data={data}
        onAdded={refresh}
        onPickDir={pickDir}
        onAddLibrary={addLibrary}
      />
    )
  }

  return <AppRouter />
}

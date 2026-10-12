// LibraryGate —— 决定"显示向导还是显示应用"（D2 修复的界面侧）
//
// 为什么要在最外层拦一道：一个库都没有时 `search` 必然 `LIB_NOT_FOUND`，
// 把用户放进检索界面只会让他看到一堆莫名其妙的错误。所以先问清"库有没有"。
//
// `libraryConfig` **只在这里取一次**，再按需把 data 交给向导 ——
// 避免向导自己再取一遍（同一份事实两个来源，正是本项目在消灭的病）。
//
// `configSource` 是**依赖注入点**（默认就是真的那个 hook）：
// 生产代码不传它；守卫要测"无库 → 向导"这条分支时可以注入一个假来源，
// 而不必真的去写用户注册表。这与引擎接受注入端口是同一个理由。
//
// 四种状态：
//   · loading  —— 还没问出来，什么都不显示（不要闪一下向导又消失）
//   · error    —— 连配置都读不到，如实报 + 给重试
//   · 无库     —— 显示向导（遮挡）
//   · 有库     —— 显示应用
import useLibraryConfig from '../hooks/useLibraryConfig.js'
import FirstRunWizard from './FirstRunWizard.jsx'
import SearchPage from './SearchPage.jsx'

export default function LibraryGate({ configSource = useLibraryConfig }) {
  const { loading, data, error, refresh } = configSource()

  // 还没问出来：留白。宁可空一瞬，也不要"先显示向导再跳走"的闪烁。
  if (loading) return null

  // 连配置都读不出来（IPC 坏了 / 主进程异常）：如实报，并给重试
  if (error) {
    return (
      <div className="wizard-overlay" role="alert">
        <div className="wizard">
          <h1 className="wizard-title">读不到库配置</h1>
          <p className="wizard-error">{error}</p>
          <div className="wizard-acts">
            <button type="button" className="btn primary" onClick={refresh}>重试</button>
          </div>
        </div>
      </div>
    )
  }

  const libs = (data && data.libraries) || []
  if (!libs.length) return <FirstRunWizard data={data} onAdded={refresh} />

  return <SearchPage />
}

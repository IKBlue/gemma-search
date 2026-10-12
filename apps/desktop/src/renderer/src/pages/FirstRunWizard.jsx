// FirstRunWizard —— 首启向导（D2 修复的界面侧）
//
// 为什么需要它：主进程原先读一个**已被删除的** `config.json` 拿库根，
// 于是库列表恒为空、界面永远 `LIB_NOT_FOUND`，而**界面上没有任何地方能把库加进来**
// —— 用户被卡在一个无法自救的状态里。这个向导就是那个缺失的入口。
//
// 设计取舍：
//   · 它是**遮挡式**的（overlay），而不是一个能关掉的提示 —— 因为一个库都没有时，
//     界面上别的功能都不能用。但"不能关"不等于"卡死"：用户随时能退出应用，
//     而本组件**自己不写任何东西**，只有点「添加这个库」才会写注册表。
//   · 错误文案**一律用主进程给的 `userMessage`**，不在这里自编 ——
//     界面与主进程各说一套正是本项目在消灭的病（"同一件事两处说法"）。
//   · 只用 `window.api.invoke`（经 useLibraryConfig 与本组件直接调用），
//     拿不到 dialog / fs / ipcRenderer。
import { useState } from 'react'
import Button from '../ui/Button.jsx'

export default function FirstRunWizard({ data, onAdded }) {
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async () => {
    setError('')
    try {
      const r = await window.api.invoke('libraryPickDir', {})
      if (!r.ok) { setError((r.error && r.error.userMessage) || '打开目录选择器失败'); return }
      if (r.data && r.data.canceled) return          // 用户取消：什么都不做，也不报错
      setPicked((r.data && r.data.path) || '')
    } catch (e) {
      setError(`调用异常：${e && e.message ? e.message : e}`)
    }
  }

  const add = async () => {
    if (!picked) return
    setBusy(true); setError('')
    try {
      const r = await window.api.invoke('libraryAdd', { root: picked })
      if (!r.ok) { setError((r.error && r.error.userMessage) || '添加失败'); return }
      onAdded()                                      // 让 App 重新解析并放行
    } catch (e) {
      setError(`调用异常：${e && e.message ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  // 主进程如实报的警告（例如"库根不存在"）要显示出来，不过滤
  const warnings = (data && data.warnings) || []

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="wizard">
        <h1 id="wizard-title" className="wizard-title">先选一个素材库</h1>
        <p className="wizard-lede">
          应用会在你选的文件夹里找图片，并把同名的压缩包配成一套。
          <strong>只读取 —— 不会移动、改名或删除任何东西。</strong>
        </p>

        <div className="wizard-step">
          <span className="wizard-step-no" aria-hidden="true">1</span>
          <div className="wizard-step-body">
            <div className="wizard-step-title">选择素材库根目录</div>
            <div className="wizard-step-hint">就是那个装着素材的文件夹（里面可以再分子目录）。</div>
          </div>
        </div>

        <div className="wizard-pick">
          <Button variant="primary" onClick={pick} disabled={busy}>选择文件夹…</Button>
          {picked && <code className="wizard-path mono" title={picked}>{picked}</code>}
        </div>

        {error && <p className="wizard-error" role="alert">{error}</p>}

        {warnings.length > 0 && (
          <ul className="wizard-warn">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <div className="wizard-acts">
          <Button variant="primary" onClick={add} disabled={!picked || busy}>
            {busy ? '正在添加…' : '添加这个库'}
          </Button>
        </div>

        {data && data.registryPath && (
          <p className="wizard-foot small muted">
            这个库的位置会记在：<code className="mono">{data.registryPath}</code>
          </p>
        )}
      </div>
    </div>
  )
}

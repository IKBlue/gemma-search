// useEngine —— 渲染进程访问主进程能力的**唯一入口**
//
// 约定（SPEC-security §6）：渲染进程只有 `window.api`（preload 白名单）这一个能力来源；
// 组件里**不要**直接写 window.api —— 能做什么应在一处可见。
import { useCallback, useEffect, useRef, useState } from 'react'

/** 调引擎方法 */
export function useEngine() {
  return {
    invoke: useCallback((method, params) => window.api.invoke(method, params), []),
  }
}

/** 订阅主进程事件；handler 变化不会重复订阅（内部用 ref 转发） */
export function useEngineEvents(handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => window.api.onEvent((evt) => ref.current && ref.current(evt)), [])
}

/**
 * 启动信息：库 + 索引健康度。
 * 结果同时写进渲染进程 console（主进程转发到 data/_app.log）——
 * 这是"界面真的读到了引擎"的可核对证据。
 */
export function useIndexStatus() {
  const [state, setState] = useState({ loading: true, lib: null, error: null })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await window.api.invoke('indexStatus', {})
        if (!alive) return
        if (!r.ok) {
          setState({ loading: false, lib: null, error: r.error || { userMessage: '读取失败' } })
          console.log('[ui] indexStatus 失败', JSON.stringify(r.error || {}))
          return
        }
        const lib = (r.data.libs || [])[0] || null
        setState({
          loading: false,
          lib,
          // 库有无的**权威判定**在 LibraryGate（它调 `libraryConfig`）。
          // 这里只是兜底文案：走到这一步而 lib 为空，说明库配置与索引状态不一致。
          error: lib ? null : { userMessage: '这个库还没有索引（或索引与库配置不一致）' },
        })
        if (lib) {
          console.log(`[ui] indexStatus → ${lib.libId} ${lib.encoded}/${lib.indexed} dim=${lib.dim} healthy=${lib.healthy}`)
        } else {
          console.log('[ui] indexStatus → 未配置任何库')
        }
      } catch (e) {
        if (alive) setState({ loading: false, lib: null, error: { userMessage: '调用异常', code: String(e) } })
      }
    })()
    return () => { alive = false }
  }, [])

  return state
}

// useEngine —— 渲染进程访问主进程能力的 Operation 层入口
//
// 分层（AGENTS.md §0.1）：UI ──> **Operation（本文件）** ──> Adapter（`../adapter/api.js`）──> 主进程。
// 本文件**不再直接碰 `window.api`** —— 那是 Adapter 的唯一职责（2026-10-13 迁移）。
//
// 此前这里自己解一遍信封（`!r.ok` / `r.error || {userMessage:'读取失败'}` / `catch → '调用异常'`），
// 同类逻辑在渲染层复制了 21 处。现在统一走 Adapter：它保证 `userMessage` 永远是可显示字符串，
// 且**永不抛异常** —— 所以调用点只有一种错误处理方式，`catch` 分支整块消失。
import { useCallback, useEffect, useRef, useState } from 'react'

import { invoke as apiInvoke, onEvent as apiOnEvent } from '../adapter/api.js'

/** 调主进程方法（透传 Adapter，保留旧签名供现有调用点使用） */
export function useEngine() {
  return {
    invoke: useCallback((method, params) => apiInvoke(method, params), []),
  }
}

/** 订阅主进程事件；handler 变化不会重复订阅（内部用 ref 转发） */
export function useEngineEvents(handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => apiOnEvent((evt) => ref.current && ref.current(evt)), [])
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
      // Adapter 永不抛 ⇒ 不需要 try/catch，也就不需要第二套"调用异常"文案
      const r = await apiInvoke('indexStatus', {})
      if (!alive) return

      if (!r.ok) {
        // r.error.userMessage 已由 Adapter 保证非空
        setState({ loading: false, lib: null, error: r.error })
        console.log('[ui] indexStatus 失败', JSON.stringify(r.error))
        return
      }

      const lib = (r.data.libs || [])[0] || null
      setState({
        loading: false,
        lib,
        // 库有无的**权威判定**在 LibraryGate（它调 `libraryConfig`）。
        // 这里只是兜底文案：走到这一步而 lib 为空，说明库配置与索引状态不一致。
        error: lib ? null : { code: 'LIB_NOT_INDEXED', message: 'no lib in indexStatus', userMessage: '这个库还没有索引（或索引与库配置不一致）' },
      })
      if (lib) {
        console.log(`[ui] indexStatus → ${lib.libId} ${lib.encoded}/${lib.indexed} dim=${lib.dim} healthy=${lib.healthy}`)
      } else {
        console.log('[ui] indexStatus → 未配置任何库')
      }
    })()
    return () => { alive = false }
  }, [])

  return state
}

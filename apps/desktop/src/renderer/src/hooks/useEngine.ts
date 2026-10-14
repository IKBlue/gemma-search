// useEngine.ts —— 渲染进程访问主进程能力的 Operation 层入口
//
// 分层（AGENTS.md §2）：UI ──> **Operation（本文件）** ──> Adapter（`../adapter/api.ts`）──> 主进程。
// 本文件**不再直接碰 `window.api`** —— 那是 Adapter 的唯一职责（2026-10-13 迁移）。
//
// 此前这里自己解一遍信封（`!r.ok` / `r.error || {userMessage:'读取失败'}` / `catch → '调用异常'`），
// 同类逻辑在渲染层复制了 21 处。现在统一走 Adapter：它保证 `userMessage` 永远是可显示字符串，
// 且**永不抛异常** —— 所以调用点只有一种错误处理方式，`catch` 分支整块消失。
import { useCallback, useEffect, useRef, useState } from 'react'

import { invoke as apiInvoke, onEvent as apiOnEvent } from '../adapter/api.ts'
import type { AdapterError, InvokeResult } from '../adapter/api.ts'
import type { MethodName } from '../../../shared/ipc.ts'

/**
 * 调主进程方法（透传 Adapter）。
 *
 * ⚠️ 2026-10-14（W2-UI 转 TSX）：**保留泛型 `D`**，与 `adapter/api.ts` 的 `invoke<D>` 同口径 ——
 *    「我期望的响应形状」必须由**调用点**写出来；不声明就只能拿到 unknown，取字段会被类型挡下。
 *    原先这里返回 `InvokeResult`（= `InvokeResult<unknown>`），于是每个调用点都得自己断言 ——
 *    那正是本仓库禁止的换绿灯写法。
 */
export function useEngine(): { invoke: <D = unknown>(method: MethodName, params?: Record<string, unknown>) => Promise<InvokeResult<D>> } {
  return {
    invoke: useCallback(<D = unknown>(method: MethodName, params?: Record<string, unknown>) => apiInvoke<D>(method, params), []),
  }
}

/** 订阅主进程事件；handler 变化不会重复订阅（内部用 ref 转发） */
export function useEngineEvents(handler: (evt: unknown) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => apiOnEvent((evt) => ref.current && ref.current(evt)), [])
}

/** `indexStatus` 返回的单个库（`data.libs[]` 的元素，只有界面用到的字段） */
export type LibStatus = {
  libId: string
  encoded: number
  indexed: number
  dim: number
  healthy: boolean
  /**
   * 库根（界面显示「当前图库」用）。
   * ⚠️ 2026-10-14（W2-UI 转 TSX 时补齐）：这两个字段**引擎一直在给**（indexStatus 的 libs[]），
   *    只是 2026-10-13 那版类型只声明了当页用到的五段。TS 把「没声明」当错误 ⇒ 首次转 TSX 时暴露。
   *    它是**补声明**，不是新契约：类型不得比真实数据**窄**，否则界面会被迫写断言（本项目禁止的写法）。
   */
  root?: string
  /** 引擎的 compat 串（8 段，COMPAT_FIELDS）；界面**只原样显示**，不解析 —— 见 TasksPage 注释 */
  compat?: string
}

/** `indexStatus` 的响应载荷（本 hook 消费的部分） */
export type IndexStatusData = { libs?: LibStatus[] }

/** 启动信息状态（`lib` 为 null 且 `loading=false` ⇒ 该报错/该进向导，权威判定仍在 LibraryGate） */
export type IndexStatusState = {
  loading: boolean
  lib: LibStatus | null
  error: AdapterError | null
}

/**
 * 启动信息：库 + 索引健康度。
 * 结果同时写进渲染进程 console（主进程转发到 data/_app.log）——
 * 这是"界面真的读到了引擎"的可核对证据。
 */
export function useIndexStatus(): IndexStatusState {
  const [state, setState] = useState<IndexStatusState>({ loading: true, lib: null, error: null })

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Adapter 永不抛 ⇒ 不需要 try/catch，也就不需要第二套"调用异常"文案
      const r = await apiInvoke<IndexStatusData>('indexStatus', {})
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

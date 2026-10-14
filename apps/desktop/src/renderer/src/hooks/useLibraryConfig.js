// useLibraryConfig —— 读「库从哪来」的解析结果 + 首启向导的两个操作（D2 修复的界面侧）
//
// 为什么单独一个 hook：库的有无决定**整个界面能不能用** ——
// 一个库都没有时，检索必然返回 LIB_NOT_FOUND，此时不该把用户丢进一个没用的搜索框。
// 所以这件事要在最外层（App）先问清楚，而不是等用户点了搜索才发现。
//
// 主进程返回的 `libraries` / `warnings` / `diagnostics` **一律原样透出，不做过滤**：
// 它们就是排障的第一手材料（也同步写在 data/_app.log 里）。
//
// 分层（AGENTS.md §2）：本文件是 **Operation 层**。原先 `pages/FirstRunWizard.jsx` 是 **UI 层**，
// 却直接调了 `window.api` 两次（`libraryPickDir` / `libraryAdd`）—— 那是三层违例，
// 也违反了"UI 不得碰 Adapter"。现在这两个操作收到这里，向导回归纯 UI（只吃 props）。
import { useCallback, useEffect, useState } from 'react'

import { invoke as apiInvoke } from '../adapter/api.js'

export default function useLibraryConfig() {
  const [state, setState] = useState({ loading: true, data: null, error: null })

  const refresh = useCallback(async () => {
    // Adapter 永不抛 ⇒ 不再需要"调用异常"那套并列文案
    const r = await apiInvoke('libraryConfig', {})
    if (!r.ok) {
      setState({ loading: false, data: null, error: r.error.userMessage })
      return
    }
    setState({ loading: false, data: r.data, error: null })
    const n = (r.data.libraries || []).length
    console.log(`[ui] libraryConfig → ${n} 个库 · 来源 ${r.data.chosen || '(无)'}` +
                (r.data.warnings && r.data.warnings.length ? ` · ${r.data.warnings.length} 条警告` : ''))
  }, [])

  /**
   * 首启向导第 1 步：让用户**亲自**选一个目录（主进程弹系统对话框）。
   * 返回 `{ok, canceled?, path?, error?}` —— **不抛**，UI 只管分支。
   */
  const pickDir = useCallback(async () => {
    const r = await apiInvoke('libraryPickDir', {})
    if (!r.ok) return { ok: false, error: r.error.userMessage }
    if (r.data && r.data.canceled) return { ok: true, canceled: true, path: '' }   // 用户取消：不是错误
    return { ok: true, canceled: false, path: (r.data && r.data.path) || '' }
  }, [])

  /** 首启向导第 2 步：注册这个库（写 userData 注册表并重建引擎） */
  const addLibrary = useCallback(async (root) => {
    const r = await apiInvoke('libraryAdd', { root })
    if (!r.ok) return { ok: false, error: r.error.userMessage }
    return { ok: true }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh, pickDir, addLibrary }
}

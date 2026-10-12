// useLibraryConfig —— 读「库从哪来」的解析结果（D2 修复的界面侧）
//
// 为什么单独一个 hook：库的有无决定**整个界面能不能用** ——
// 一个库都没有时，检索必然返回 LIB_NOT_FOUND，此时不该把用户丢进一个没用的搜索框。
// 所以这件事要在最外层（App）先问清楚，而不是等用户点了搜索才发现。
//
// 主进程返回的 `libraries` / `warnings` / `diagnostics` **一律原样透出，不做过滤**：
// 它们就是排障的第一手材料（也同步写在 data/_app.log 里）。
import { useCallback, useEffect, useState } from 'react'

export default function useLibraryConfig() {
  const [state, setState] = useState({ loading: true, data: null, error: null })

  const refresh = useCallback(async () => {
    try {
      const r = await window.api.invoke('libraryConfig', {})
      if (!r.ok) {
        setState({ loading: false, data: null, error: (r.error && r.error.userMessage) || '读取库配置失败' })
        return
      }
      setState({ loading: false, data: r.data, error: null })
      const n = (r.data.libraries || []).length
      console.log(`[ui] libraryConfig → ${n} 个库 · 来源 ${r.data.chosen || '(无)'}` +
                  (r.data.warnings && r.data.warnings.length ? ` · ${r.data.warnings.length} 条警告` : ''))
    } catch (e) {
      setState({ loading: false, data: null, error: `调用异常：${e && e.message ? e.message : e}` })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh }
}

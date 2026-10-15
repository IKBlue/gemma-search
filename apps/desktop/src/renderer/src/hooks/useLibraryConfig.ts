// useLibraryConfig.ts —— 读「库从哪来」的解析结果 + 首启向导的两个操作（D2 修复的界面侧）
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

import { invoke as apiInvoke } from '../adapter/api.ts'

/** 一个已登记的库（只声明界面用到的字段；其余原样透出） */
export type LibraryEntry = { libId?: string; root?: string; label?: string }

/** `libraryConfig` 的响应载荷（本 hook 消费的部分） */
export type LibraryConfigData = {
  libraries?: LibraryEntry[]
  chosen?: string | null
  warnings?: unknown[]
  diagnostics?: unknown[]
  /**
   * 注册表落点（向导末尾「这个库的位置会记在：…」要显示它）。
   * ⚠️ 2026-10-14（W2-UI 转 TSX 时补齐）：主进程**一直在给**这个字段，只是上一版类型没声明。
   *    补声明不是新契约 —— 类型不得比真实数据**窄**（窄了就会逼调用点写断言）。
   */
  registryPath?: string
}

/** 首启向导第 1 步的结果：用户取消**不是错误**（`canceled: true`） */
export type PickDirResult = { ok: true; canceled: boolean; path: string } | { ok: false; error: string }

/** 首启向导第 2 步的结果 */
export type AddLibraryResult = { ok: true } | { ok: false; error: string }

/** hook 的状态（`error` 已经是可以直接显示的字符串） */
export type LibraryConfigState = {
  loading: boolean
  data: LibraryConfigData | null
  error: string | null
}

/** `useLibraryConfig()` 的完整返回 */
export type LibraryConfigApi = LibraryConfigState & {
  refresh: () => Promise<void>
  pickDir: () => Promise<PickDirResult>
  addLibrary: (root: string) => Promise<AddLibraryResult>
}

export default function useLibraryConfig(): LibraryConfigApi {
  const [state, setState] = useState<LibraryConfigState>({ loading: true, data: null, error: null })

  const refresh = useCallback(async (): Promise<void> => {
    // Adapter 永不抛 ⇒ 不再需要"调用异常"那套并列文案
    // ⚠️ S6（2026-10-15）：`libraryConfig` 已改名 `libraryList`（基线 §2.2，删旧名不留两套）。
    //    载荷形状不变：libraries / chosen / warnings / diagnostics / registryPath（发现诊断照旧透出）。
    const r = await apiInvoke<LibraryConfigData>('libraryList', {})
    if (!r.ok) {
      setState({ loading: false, data: null, error: r.error.userMessage })
      return
    }
    setState({ loading: false, data: r.data, error: null })
    const n = (r.data.libraries || []).length
    console.log(`[ui] libraryList → ${n} 个库 · 来源 ${r.data.chosen || '(无)'}` +
                (r.data.warnings && r.data.warnings.length ? ` · ${r.data.warnings.length} 条警告` : ''))
  }, [])

  /**
   * 首启向导第 1 步：让用户**亲自**选一个目录（主进程弹系统对话框）。
   * 返回 `{ok, canceled?, path?, error?}` —— **不抛**，UI 只管分支。
   */
  const pickDir = useCallback(async (): Promise<PickDirResult> => {
    const r = await apiInvoke<{ canceled?: boolean; path?: string }>('libraryPickDir', {})
    if (!r.ok) return { ok: false, error: r.error.userMessage }
    if (r.data && r.data.canceled) return { ok: true, canceled: true, path: '' }   // 用户取消：不是错误
    return { ok: true, canceled: false, path: (r.data && r.data.path) || '' }
  }, [])

  /** 首启向导第 2 步：注册这个库（写 userData 注册表并重建引擎） */
  const addLibrary = useCallback(async (root: string): Promise<AddLibraryResult> => {
    const r = await apiInvoke('libraryAdd', { root })
    if (!r.ok) return { ok: false, error: r.error.userMessage }
    return { ok: true }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh, pickDir, addLibrary }
}

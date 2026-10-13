// store/search.js —— 检索状态（**Zustand** 接管；Operation 层）
//
// 为什么从 `hooks/useSearch.js` 搬到这里（T2，2026-10-13）：
//   检索状态此前挂在 `SearchPage` 组件里 —— 页面一卸载状态就没了，
//   而 P3c/P3d 需要"从结果卡点进详情再返回，筛选与结果还在"。状态必须**离开组件**。
//   `hooks/useSearch.js` 已被**删除**（不是留着当包装）—— 同一件事不留两份实现（P1）。
//
// 分层（`AGENTS.md` §0.1）：本文件是 **Operation 层** —— 它调 Adapter（不做协议细节），
//   并且**不依赖 React**（Zustand 的 vanilla store 在纯 Node 里就能跑 ⇒ 可单测）。
//
// ⚠️ 提示文案（toast）**不进 store**：它是 UI 关切。动作把它当参数收（`run(onToast)`），
//   这样 store 保持与界面无关，也不会出现"状态层偷偷改界面"。
import { create } from 'zustand'

import { invoke as apiInvoke } from '../adapter/api.js'

/** 与库的业务维度一致（素材库的四个目录）；'未分类' 是入库默认目录，索引里可能还没有 */
export const FOLDERS = ['VR', 'CR', 'CR+VR', '其他']
export const CHIPS = ['全部', ...FOLDERS, '未分类']

/**
 * 排序（**纯函数**，导出以便单测）。
 *   score（默认）—— 相关度降序
 *   name         —— 文件名升序
 *   recent       —— 目前与 score 相同（"最近添加"要索引提供 mtime，P3b 再补，界面会给提示）
 */
export function sortResults(list, sort) {
  if (!list) return list
  const out = [...list]
  if (sort === 'name') out.sort((a, b) => String(a.stem || '').localeCompare(String(b.stem || '')))
  else if (sort !== 'recent') out.sort((a, b) => Number(b.score) - Number(a.score))
  return out
}

const initial = {
  mode: 'text',          // text | image
  query: '',
  folder: '全部',
  sort: 'score',
  busy: false,
  meta: '',
  rawResults: null,      // null = 还没搜过（界面据此显示引导块）；[] = 搜过但没结果
  error: null,
  queryImagePath: null,
  /**
   * 待确认的取件项（`null` = 没有待确认的东西）。
   *
   * ⚠️ 2026-10-13（T4）：`collect` 是**破坏性操作**（把文件复制/移动进取件目录），
   * 原先点一下就直接执行、**没有任何确认**。现在走"请求 → 确认"两步：
   *   `requestCollect(item)` 只记下来（弹确认框） · `cancelCollect()` 丢弃 · `confirmCollect()` 真执行。
   * ⚠️ 状态放在 **store** 而不是组件里：这是"该不该执行一个破坏性动作"的**决策**，
   *   它属于 Operation 层；而且放在这里，`npm test` 才能断言"取消 ⇒ 一个 IPC 都没发"。
   */
  pendingCollect: null,
}

export const useSearchStore = create((set, get) => ({
  ...initial,

  setMode: (mode) => set({ mode }),
  setQuery: (query) => set({ query }),
  setFolder: (folder) => set({ folder }),
  setSort: (sort) => set({ sort }),
  setQueryImagePath: (p) => set({ queryImagePath: p || null }),

  /** 清空本次检索（保留查询词以外的都清掉；与页面「清除选择」一致） */
  clear: () => set({ rawResults: null, error: null, meta: '', query: '' }),

  /**
   * 跑一次检索。参数拼装在这里（此前散在 hook 里）。
   * `onToast` 可选 —— 校验失败时要告诉用户，但 store 不 import 任何 UI。
   */
  run: async (onToast) => {
    const { busy, mode, query, folder, queryImagePath } = get()
    if (busy) return

    const params = { mode, topK: 60, filters: { folders: folder === '全部' ? FOLDERS : [folder] } }
    if (mode === 'text') {
      const text = query.trim()
      if (!text) { if (onToast) onToast('请输入要查找的内容'); return }
      params.text = text
    } else {
      if (!queryImagePath) { if (onToast) onToast('请先选择一张参考图'); return }
      params.queryImagePath = queryImagePath
    }

    set({ busy: true, meta: '检索中…（首次会载入模型，约 3 秒）', error: null })

    // Adapter 永不抛 ⇒ 不需要 try/catch（见 `adapter/api.js` 的 A5 断言）
    const r = await apiInvoke('search', params)
    if (!r.ok) {
      set({ busy: false, meta: '', rawResults: [], error: r.error })
      console.log('[ui] search 失败', JSON.stringify(r.error))
      return
    }

    const list = r.data.results || []
    set({ busy: false, rawResults: list, meta: `${list.length} 条 · ${r.data.tookMs} ms` })
    console.log(`[ui] search ${mode} → ${list.length} 条 · ${r.data.tookMs}ms`)

    const skipped = r.data.libsSkipped || []
    if (skipped.length && onToast) onToast(`有 ${skipped.length} 个库被跳过：${skipped[0].reason.userMessage}`)
  },

  reveal: async (item, onToast) => {
    const r = await apiInvoke('reveal', {
      libId: item.libId, uid: item.uid, target: item.archive ? 'archive' : 'image',
    })
    // ⚠️ 成功文案**不能写成「已在资源管理器中定位」**（F-01 独立复核的 R-1）。
    // `r.ok` 只等价于「文件在盘上 + shell 端口被调用过」—— Electron 的
    // `shell.showItemInFolder` **返回 void、不报告失败**，所以我们**不知道**资源管理器有没有真的弹出来。
    // 写「已定位」就是又一次过度声称：用户没看到窗口时会以为是应用的 bug。
    // 见 `packages/engine/src/engine.mjs` reveal 处的注释与 `docs/spec/CONTRACT-engine-v1.md` §2.4。
    if (onToast) {
      onToast(r.ok ? '已请求在资源管理器中定位（系统未回报结果）' : r.error.userMessage,
              r.ok ? 'info' : 'err')
    }
  },

  collect: async (item, onToast) => {
    const r = await apiInvoke('collect', { libId: item.libId, uids: [item.uid] })
    if (!r.ok) { if (onToast) onToast(r.error.userMessage, 'err'); return }
    const d = r.data
    if (onToast) {
      onToast(`取件：成功 ${d.succeeded.length} · 跳过 ${d.skipped.length} · 失败 ${d.failed.length} → ${d.targetDir}`,
        d.failed.length ? 'err' : 'info')
    }
  },

  /** 只给测试用：把 store 回到初始态（避免测试之间互相污染） */
  __reset: () => set({ ...initial }),

  // ============================================================ 破坏性操作的确认（T4）
  // `collect` 会**写文件**（复制/移动进取件目录）。这类动作必须"先问再做"，
  // 而这套状态机刻意放在 store 里 —— 于是"取消 ⇒ 一个 IPC 都没发"是**可断言的**，
  // 而不是只能靠人点着看（见 `apps/desktop/tests/search-store.test.mjs` 的 Z13–Z15）。

  /** 请求取件（只记下来 → 界面据此弹出确认框，**不执行任何 IPC**） */
  requestCollect: (item) => set({ pendingCollect: item || null }),

  /** 取消（丢弃请求 —— 这是"用户拒绝"的唯一路径） */
  cancelCollect: () => set({ pendingCollect: null }),

  /**
   * 确认执行。
   * ⚠️ **先清 `pendingCollect` 再执行**：否则连点两次确认会发两次 IPC，
   *    而取件的第二次调用在语义上是"重复搬同一套素材" —— 不是一个安全的操作。
   */
  confirmCollect: async (onToast) => {
    const item = get().pendingCollect
    if (!item) return                       // 没有待确认项 ⇒ 什么都不做（防误调）
    set({ pendingCollect: null })
    await get().collect(item, onToast)
  },
}))

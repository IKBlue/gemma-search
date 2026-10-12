// useSearch —— 检索状态机（参数拼装 / IPC / 排序 / 错误与提示 / console 证据）
//
// 与界面解耦：界面只调 run()/reveal()/collect() 并读状态。
// 分类筛选按**原型的交互**做成单选（'全部' = 不筛），排序在本地对结果做（原型：相关度优先 / 文件名）。
import { useCallback, useMemo, useRef, useState } from 'react'

/** 与库的业务维度一致（config.json 的四个目录）；'未分类' 是入库默认目录，索引里可能还没有 */
export const FOLDERS = ['VR', 'CR', 'CR+VR', '其他']
export const CHIPS = ['全部', ...FOLDERS, '未分类']

export default function useSearch({ invoke, onToast }) {
  const [mode, setMode] = useState('text')          // text | image
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('全部')
  const [sort, setSort] = useState('score')
  const [busy, setBusy] = useState(false)
  const [meta, setMeta] = useState('')
  const [rawResults, setRawResults] = useState(null)
  const [error, setError] = useState(null)

  const imagePath = useRef(null)
  const setQueryImagePath = useCallback((p) => { imagePath.current = p || null }, [])

  const results = useMemo(() => {
    if (!rawResults) return rawResults
    const list = [...rawResults]
    if (sort === 'name') list.sort((a, b) => String(a.stem || '').localeCompare(String(b.stem || '')))
    else if (sort !== 'recent') list.sort((a, b) => Number(b.score) - Number(a.score))
    return list
  }, [rawResults, sort])

  const run = useCallback(async () => {
    if (busy) return
    const params = { mode, topK: 60, filters: { folders: folder === '全部' ? FOLDERS : [folder] } }

    if (mode === 'text') {
      const text = query.trim()
      if (!text) { onToast('请输入要查找的内容'); return }
      params.text = text
    } else {
      if (!imagePath.current) { onToast('请先选择一张参考图'); return }
      params.queryImagePath = imagePath.current
    }

    setBusy(true)
    setMeta('检索中…（首次会载入模型，约 3 秒）')
    setError(null)
    try {
      const r = await invoke('search', params)
      if (!r.ok) {
        setMeta('')
        setRawResults([])
        setError(r.error || { userMessage: '检索失败' })
        console.log('[ui] search 失败', JSON.stringify(r.error || {}))
        return
      }
      const list = r.data.results || []
      setRawResults(list)
      setMeta(`${list.length} 条 · ${r.data.tookMs} ms`)
      console.log(`[ui] search ${mode} → ${list.length} 条 · ${r.data.tookMs}ms`)
      const skipped = r.data.libsSkipped || []
      if (skipped.length) onToast(`有 ${skipped.length} 个库被跳过：${skipped[0].reason.userMessage}`)
    } catch (e) {
      setMeta('')
      setError({ userMessage: '检索调用异常', code: String(e) })
    } finally {
      setBusy(false)
    }
  }, [busy, folder, invoke, mode, onToast, query])

  const clear = useCallback(() => {
    setRawResults(null)
    setError(null)
    setMeta('')
    setQuery('')
  }, [])

  const reveal = useCallback(async (item) => {
    const r = await invoke('reveal', { libId: item.libId, uid: item.uid, target: item.archive ? 'archive' : 'image' })
    // ⚠️ 成功文案**不能写成「已在资源管理器中定位」**（F-01 独立复核的 R-1）。
    // `r.ok` 只等价于「文件在盘上 + shell 端口被调用过」—— Electron 的
    // `shell.showItemInFolder` **返回 void、不报告失败**，所以我们**不知道**资源管理器有没有真的弹出来。
    // 写「已定位」就是又一次过度声称：用户没看到窗口时会以为是应用的 bug。
    // 见 `packages/engine/src/engine.mjs` reveal 处的注释与 `docs/spec/CONTRACT-engine-v1.md` §2.4。
    onToast(r.ok ? '已请求在资源管理器中定位（系统未回报结果）' : (r.error && r.error.userMessage) || '定位失败',
            r.ok ? 'info' : 'err')
  }, [invoke, onToast])

  const collect = useCallback(async (item) => {
    const r = await invoke('collect', { libId: item.libId, uids: [item.uid] })
    if (!r.ok) { onToast((r.error && r.error.userMessage) || '取件失败', 'err'); return }
    const d = r.data
    onToast(`取件：成功 ${d.succeeded.length} · 跳过 ${d.skipped.length} · 失败 ${d.failed.length} → ${d.targetDir}`,
      d.failed.length ? 'err' : 'info')
  }, [invoke, onToast])

  return {
    mode, setMode,
    query, setQuery,
    folder, setFolder,
    sort, setSort,
    setQueryImagePath,
    busy, meta, results, error,
    run, clear, reveal, collect,
  }
}

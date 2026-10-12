// Gallery —— 结果区（原型：.gallery > .photo-card）
//
// 四种状态：加载（骨架）/ 错误 / 空 / 有结果。未检索时由页面显示引导块。
import PhotoCard from './PhotoCard.jsx'

function SkeletonCard() {
  return (
    <article className="photo-card loading" aria-hidden="true">
      <div className="photo">
        <div className="photo-skeleton" />
      </div>
      <div className="card-info">
        <div className="line-skeleton" />
        <div className="line-skeleton short" />
      </div>
    </article>
  )
}

export default function Gallery({ results, error, loading, emptyCount = 8, onLocate, onCollect, onClear }) {
  if (loading) {
    return (
      <div className="gallery">
        {Array.from({ length: emptyCount }, (_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }
  if (error) {
    return (
      <div className="panel empty">
        <div className="empty-title">{error.userMessage || '检索失败'}</div>
        {error.code ? <div className="muted small mono">{error.code}</div> : null}
      </div>
    )
  }
  if (results && results.length === 0) {
    return (
      <div className="panel empty">
        <div className="empty-title">没有匹配的素材</div>
        <div className="muted small">换个说法，或把渲染器分类切回「全部」。</div>
      </div>
    )
  }
  if (!results) return null

  return (
    <>
      <div className="row mb-4">
        <div>
          <b>搜索结果</b> <span className="muted small">{results.length} 套素材</span>
        </div>
        <button className="btn" type="button" onClick={onClear}>清除选择</button>
      </div>
      <div className="gallery">
        {results.map((item) => (
          <PhotoCard key={item.uid} item={item} onLocate={onLocate} onCollect={onCollect} />
        ))}
      </div>
    </>
  )
}

// PhotoCard —— 结果卡（原型：.photo-card > .photo(img + .card-acts) + .card-info(.card-title + .card-meta)）
//
// 缩略图走 thumb://（主进程只按 libId+uid 反查，渲染进程传不进路径）。
// 「定位」在**既无包也无图路径**时必须 disabled（防误操作）——渲染层守卫会断言这条。
import { useState } from 'react'
import Button from '../ui/Button.jsx'
import Score from '../ui/Score.jsx'
import Tag from '../ui/Tag.jsx'

export default function PhotoCard({ item, onLocate, onCollect }) {
  const [failed, setFailed] = useState(false)
  const canLocate = Boolean(item.archive || item.relPath)
  const title = item.archive ? item.archive.name || `${item.stem}${item.archive.ext || ''}` : (item.stem || item.relPath)

  return (
    <article className="photo-card" data-folder={item.folder} data-score={item.score}>
      <div className="photo">
        {failed ? (
          <div className="photo-fallback">无预览</div>
        ) : (
          <img
            className="photo-img"
            loading="lazy"
            alt={`${item.stem || item.relPath} 预览图`}
            src={`thumb://${encodeURIComponent(item.libId)}/${item.uid}@256`}
            onError={() => setFailed(true)}
          />
        )}
        <span className="card-acts">
          <Button className="pri" disabled={!canLocate} onClick={() => onLocate(item)}>定位</Button>
          <Button onClick={() => onCollect(item)}>取件</Button>
        </span>
      </div>
      <div className="card-info">
        <div className="card-title" title={item.relPath || ''}>{title}</div>
        <div className="card-meta">
          <span><Tag folder={item.folder} /></span>
          <Score score={item.score} size={item.archive ? item.archive.size : item.imageSize} />
        </div>
      </div>
    </article>
  )
}

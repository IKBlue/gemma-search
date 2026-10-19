// PhotoCard —— 结果卡（原型：.photo-card > .photo(img + .card-acts) + .card-info(.card-title + .card-meta)）
//
// 缩略图走 thumb://（主进程只按 libId+uid 反查，渲染进程传不进路径）。
// 「定位」在**既无包也无图路径**时必须 disabled（防误操作）——渲染层守卫会断言这条。
//
// ⚠️ 2026-10-13 加标题链接（Apple Style 审查 **V-28，Critical**）：
//   详情页 `/item/:libId/:uid` 早就实现了，但**从界面根本走不到** ——
//   全仓 `PATHS.item` 只出现在路由表定义里，**没有任何链接指向它** ⇒ 用户只能手打 hash。
//   这里把**标题**做成真链接（最自然的「打开详情」入口，键盘也能 Tab 到），
//   而不是把整张卡包成链接 —— 卡里还有「定位」「取件」两个按钮，
//   链接套按钮会变成嵌套交互元素（HTML 规范禁止、读屏也会念乱）。
import { useState } from 'react';
import { Link } from 'react-router';

import Button from '../ui/Button.tsx';
import Score from '../ui/Score.tsx';
import Tag from '../ui/Tag.tsx';
import { itemPath } from '../router/paths.ts';
import type { SearchItem } from './types.ts';

/** 压缩包（引擎给的对象形状；`archive` 是 `unknown`，故在这里窄化一次） */
type Archive = { name?: string; ext?: string; size?: number };

/** PRD-1 · L0 命中类型的中文标签（显示用；判定在主进程） */
const HIT_LABEL: Readonly<Record<NonNullable<SearchItem['hit']>, string>> = Object.freeze({
  uid: 'ID',
  ext: '扩展名',
  name: '文件名',
  path: '路径',
});

function archiveOf(item: SearchItem): Archive | null {
  const a = item.archive;
  return a && typeof a === 'object' ? (a as Archive) : null;
}

export type PhotoCardProps = {
  item: SearchItem;
  onLocate?: (item: SearchItem) => void;
  onCollect?: (item: SearchItem) => void;
};

export default function PhotoCard({ item, onLocate, onCollect }: PhotoCardProps) {
  const [failed, setFailed] = useState(false);
  const archive = archiveOf(item);
  const canLocate = Boolean(archive || item.relPath);
  const title = archive
    ? archive.name || `${item.stem}${archive.ext || ''}`
    : item.stem || item.relPath;

  return (
    <article className="photo-card" data-folder={item.folder ?? undefined} data-score={item.score}>
      <div className="photo">
        {failed ? (
          <div className="photo-fallback">无预览</div>
        ) : (
          <img
            className="photo-img"
            loading="lazy"
            alt={`${item.stem || item.relPath} 预览图`}
            src={`thumb://${encodeURIComponent(item.libId ?? '')}/${item.uid}@256`}
            onError={() => setFailed(true)}
          />
        )}
        <span className="card-acts">
          {/* 原先是上下文覆盖 `.card-acts .btn` + `.card-acts .btn.pri`（后代选择器）。
              2026-10-13（T3）改为**由组件自己表达**：size="sm" 拿小尺寸、variant="outline-accent"
              拿「只描边不填色」。按钮的样子现在取决于它**是什么**，而不是它在哪个容器里。 */}
          <Button
            size="sm"
            variant="outline-accent"
            disabled={!canLocate}
            onClick={() => onLocate?.(item)}
          >
            定位
          </Button>
          <Button size="sm" onClick={() => onCollect?.(item)}>
            取件
          </Button>
        </span>
      </div>
      <div className="card-info">
        <Link
          className="card-title"
          to={itemPath(item.libId ?? '', item.uid ?? '')}
          title={item.relPath || ''}
          data-testid="card-detail-link"
        >
          {title}
        </Link>
        <div className="card-meta">
          <span>
            <Tag folder={item.folder} />
          </span>
          {/* PRD-1：L0 结果没有 score/band（字面匹配不分档）⇒ 显示**命中类型**，
              避免把"文件名命中"伪装成语义分数；语义/以图搜图结果仍走 Score。 */}
          {item.hit ? (
            <span className="tag" data-testid="hit-type" data-hit={item.hit}>
              {HIT_LABEL[item.hit]}
            </span>
          ) : (
            // band 由**引擎**给（按模态分的档位）。界面不自己算阈值 —— 见 Score.tsx 顶部注释
            <Score
              score={item.score ?? 0}
              band={item.band}
              size={archive ? archive.size : item.imageSize}
            />
          )}
          {/* U39（PHASH-1b 呈现 · 所有者 2026-10-19 裁 B）：近重复角标。
              阈值 k=10 由**主进程**判好（生产解码复核过），界面不重算；距离只放 title 供排查。 */}
          {item.nearDuplicate ? (
            <span
              className="tag"
              data-testid="near-dup"
              data-distance={item.phashDistance ?? ''}
              title={
                typeof item.phashDistance === 'number'
                  ? `与查询图画面高度相似（dHash 汉明距离 ${item.phashDistance}）`
                  : '与查询图画面高度相似'
              }
            >
              近重复
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

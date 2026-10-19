// Gallery —— 结果区（原型：.gallery > .photo-card）
//
// 四种状态：加载（骨架）/ 错误 / 空 / 有结果。未检索时由页面显示引导块。
import Button from '../ui/Button.tsx';
import PhotoCard from './PhotoCard.tsx';
import type { SearchErrorish, SearchItem } from './types.ts';

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
  );
}

export type GalleryProps = {
  results: SearchItem[] | null;
  error: SearchErrorish;
  loading?: boolean;
  emptyCount?: number;
  onLocate?: (item: SearchItem) => void;
  onCollect?: (item: SearchItem) => void;
  onClear?: () => void;
  /** 弱匹配提示（NOMATCH-1 · U38 口径 A）：非空时在结果上方显示（"以下最近 N 条仅供参考"） */
  notice?: string;
  /** 与 notice 配套：只展示最近 N 条（未给 = 展示全部） */
  maxItems?: number;
};

export default function Gallery({
  results,
  error,
  loading,
  emptyCount = 8,
  onLocate,
  onCollect,
  onClear,
  notice,
  maxItems,
}: GalleryProps) {
  if (loading) {
    return (
      <div className="gallery">
        {Array.from({ length: emptyCount }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel empty">
        {/* error 由 Operation 层（useSearch）经 Adapter 归一化，userMessage **保证非空**
            ⇒ UI 不再抄一遍 `|| '检索失败'` 兜底（那是被消灭的 P2 之一） */}
        <div className="empty-title">{error.userMessage}</div>
        {error.code ? <div className="muted small mono">{error.code}</div> : null}
      </div>
    );
  }
  if (results && results.length === 0) {
    return (
      <div className="panel empty">
        <div className="empty-title">没有匹配的素材</div>
        <div className="muted small">换个说法，或把渲染器分类切回「全部」。</div>
      </div>
    );
  }
  if (!results) return null;

  // U38：弱匹配时只展示"最近 N 条"（N 由 Operation 层按 band 判定，界面不自算阈值）
  const shown = typeof maxItems === 'number' && maxItems > 0 ? results.slice(0, maxItems) : results;

  return (
    <>
      {notice ? (
        // 提示不是错误：弱匹配仍然是"有结果"，所以走 status 而不是 alert（与 useToast 的 V-16 口径一致）。
        // 视觉复用既有 `.hint`（tokens.css 的次要文字色）—— 不为它新增一套样式/令牌。
        <p className="hint" role="status" data-testid="shortfall-notice">
          {notice}
        </p>
      ) : null}
      <div className="row mb-4">
        <div>
          <b>搜索结果</b> <span className="muted small">{results.length} 套素材</span>
        </div>
        <Button onClick={onClear}>清除选择</Button>
      </div>
      <div className="gallery">
        {shown.map((item) => (
          <PhotoCard key={item.uid} item={item} onLocate={onLocate} onCollect={onCollect} />
        ))}
      </div>
    </>
  );
}
